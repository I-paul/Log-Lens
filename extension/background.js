const INGEST_URL = 'http://localhost:4000/ingest/browser';

/**
 * Serializes Chrome Debugger exceptionDetails into a readable stackTrace string.
 */
function formatStackTrace(exceptionDetails) {
  if (exceptionDetails.exception && exceptionDetails.exception.description) {
    return exceptionDetails.exception.description;
  }

  if (exceptionDetails.stackTrace && Array.isArray(exceptionDetails.stackTrace.callFrames)) {
    const frames = exceptionDetails.stackTrace.callFrames.map(
      (f) => `${f.functionName || '(anonymous)'}@${f.url || 'unknown'}:${f.lineNumber}:${f.columnNumber}`
    );
    return frames.join('\n');
  }

  return exceptionDetails.text || 'No stack trace available';
}

/**
 * Sends captured log payload to middleware ingest endpoint and forwards analysis response to content script.
 */
async function postToIngest(payload, tabId) {
  try {
    const response = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const analyzeResult = await response.json();
      console.log('[LogLens Extension] Ingestion & analysis complete:', analyzeResult);

      if (tabId) {
        chrome.tabs.sendMessage(
          tabId,
          { action: 'showAnalysisOverlay', data: analyzeResult },
          () => {
            if (chrome.runtime.lastError) {
              console.warn(
                '[LogLens Extension] Overlay message warning:',
                chrome.runtime.lastError.message
              );
            }
          }
        );
      }
    } else {
      console.error('[LogLens Extension] Middleware returned error status:', response.status);
    }
  } catch (err) {
    console.error('[LogLens Extension] Failed to POST log to middleware:', err);
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

    const payload = {
      message,
      stackTrace,
      url,
      timestamp
    };

    postToIngest(payload, tabId);
  } else if (method === 'Network.responseReceived') {
    const response = params.response || {};
    if (response.status && response.status >= 400) {
      const status = response.status;
      const url = response.url || 'unknown';
      const statusText = response.statusText || 'Error';
      const message = `HTTP ${status}: ${statusText} ${url}`;
      const stackTrace = `HTTP ${status} (${statusText}) response received from ${url}`;
      const timestamp = new Date(
        params.timestamp ? params.timestamp * 1000 : Date.now()
      ).toISOString();

      const payload = {
        message,
        stackTrace,
        url,
        timestamp
      };

      postToIngest(payload, tabId);
    }
  }
});

// Reset storage state if debugger is detached
chrome.debugger.onDetach.addListener((source) => {
  chrome.storage.local.get(['attachedTabId'], (data) => {
    if (data.attachedTabId === source.tabId) {
      chrome.storage.local.set({ isCapturing: false, attachedTabId: null });
      console.log('[LogLens Extension] Debugger detached from tab:', source.tabId);
    }
  });
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStatus') {
    chrome.storage.local.get(['isCapturing', 'attachedTabId'], (data) => {
      sendResponse({
        isCapturing: !!data.isCapturing,
        attachedTabId: data.attachedTabId || null
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
          // Detach debugger
          chrome.debugger.detach({ tabId }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[LogLens Extension] Detach warning:', chrome.runtime.lastError.message);
            }
            chrome.storage.local.set({ isCapturing: false, attachedTabId: null }, () => {
              sendResponse({ success: true, isCapturing: false });
            });
          });
        } else {
          // Attach debugger
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
});
