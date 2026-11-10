const INGEST_URL = 'http://localhost:4000/ingest/browser';

function formatStackTrace(exceptionDetails) {
  if (exceptionDetails.exception && exceptionDetails.exception.description) {
    return exceptionDetails.exception.description;
  }

  if (exceptionDetails.stackTrace && Array.isArray(exceptionDetails.stackTrace.callFrames)) {
    return exceptionDetails.stackTrace.callFrames.map(
      (f) => `${f.functionName || '(anonymous)'}@${f.url || 'unknown'}:${f.lineNumber}:${f.columnNumber}`
    ).join('\n');
  }

  return exceptionDetails.text || 'No stack trace available';
}

async function postToIngest(payload, tabId) {
  try {
    const response = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = await response.json();
      console.log('[LogLens] Analysis complete:', result);

      if (tabId) {
        chrome.tabs.sendMessage(
          tabId,
          { action: 'showAnalysis', data: result },
          () => {
            if (chrome.runtime.lastError) {
              console.warn('[LogLens] Overlay message warning:', chrome.runtime.lastError.message);
            }
          }
        );
      }

      // Store latest result for popup access
      chrome.storage.local.set({ lastAnalysis: result });
    } else {
      console.error('[LogLens] Middleware error status:', response.status);
    }
  } catch (err) {
    console.error('[LogLens] Failed to POST to middleware:', err);
  }
}

// Listen for Debugger events
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source ? source.tabId : null;

  if (method === 'Runtime.exceptionThrown') {
    const details = params.exceptionDetails || {};
    const message =
      details.text ||
      (details.exception && details.exception.description) ||
      'Runtime Exception';
    const stackTrace = formatStackTrace(details);
    const url = details.url || 'unknown';
    const timestamp = new Date(params.timestamp || Date.now()).toISOString();

    postToIngest({ message, stackTrace, url, timestamp }, tabId);
  } else if (method === 'Network.responseReceived') {
    const response = params.response || {};
    if (response.status && response.status >= 500) {
      const status = response.status;
      const url = response.url || 'unknown';
      const statusText = response.statusText || 'Error';
      const message = `HTTP ${status}: ${statusText} ${url}`;
      const stackTrace = `HTTP ${status} (${statusText}) response received from ${url}`;
      const timestamp = new Date(
        params.timestamp ? params.timestamp * 1000 : Date.now()
      ).toISOString();

      postToIngest({ message, stackTrace, url, timestamp }, tabId);
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  chrome.storage.local.get(['attachedTabId'], (data) => {
    if (data.attachedTabId === source.tabId) {
      chrome.storage.local.set({ isCapturing: false, attachedTabId: null });
      console.log('[LogLens] Debugger detached from tab:', source.tabId);
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStatus') {
    chrome.storage.local.get(['isCapturing', 'attachedTabId', 'lastAnalysis'], (data) => {
      sendResponse({
        isCapturing: !!data.isCapturing,
        attachedTabId: data.attachedTabId || null,
        lastAnalysis: data.lastAnalysis || null,
      });
    });
    return true;
  }

  if (request.action === 'toggleCapture') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
      if (!activeTab || !activeTab.id) {
        sendResponse({ success: false, error: 'No active tab found' });
        return;
      }

      const tabId = activeTab.id;

      chrome.storage.local.get(['isCapturing', 'attachedTabId'], (data) => {
        const currentlyCapturing = !!data.isCapturing && data.attachedTabId === tabId;

        if (currentlyCapturing) {
          chrome.debugger.detach({ tabId }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[LogLens] Detach warning:', chrome.runtime.lastError.message);
            }
            chrome.storage.local.set({ isCapturing: false, attachedTabId: null }, () => {
              sendResponse({ success: true, isCapturing: false });
            });
          });
        } else {
          chrome.debugger.attach({ tabId }, '1.3', () => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
              return;
            }

            chrome.debugger.sendCommand({ tabId }, 'Runtime.enable', {}, () => {
              chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
                chrome.storage.local.set({ isCapturing: true, attachedTabId: tabId }, () => {
                  sendResponse({ success: true, isCapturing: true, tabId });
                });
              });
            });
          });
        }
      });
    });

    return true;
  }

  if (request.action === 'clearAnalysis') {
    chrome.storage.local.remove('lastAnalysis');
    sendResponse({ success: true });
    return true;
  }
});
