document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const lastResultDiv = document.getElementById('lastResult');
  const resultSummary = document.getElementById('resultSummary');
  const resultFile = document.getElementById('resultFile');

  function updateUI(isCapturing) {
    if (isCapturing) {
      statusBadge.classList.add('active');
      statusText.textContent = 'Capturing';
      toggleBtn.textContent = 'Stop Capture';
      toggleBtn.classList.add('active');
    } else {
      statusBadge.classList.remove('active');
      statusText.textContent = 'Disconnected';
      toggleBtn.textContent = 'Start Capture';
      toggleBtn.classList.remove('active');
    }
  }

  function showLastResult(analysis) {
    if (!analysis) {
      lastResultDiv.style.display = 'none';
      return;
    }
    lastResultDiv.style.display = 'block';
    const summary = analysis.error_summary || analysis.summary || 'N/A';
    const file = analysis.root_cause_file || analysis.file_ref || 'unknown';
    const line = analysis.root_cause_line || analysis.line_ref || 0;
    resultSummary.textContent = summary;
    resultFile.textContent = file + ':' + line;
  }

  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response) {
      chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
        if (!activeTab) return;
        const isCapturingCurrentTab =
          !!response.isCapturing && response.attachedTabId === activeTab.id;
        updateUI(isCapturingCurrentTab);
      });
      showLastResult(response.lastAnalysis);
    }
  });

  toggleBtn.addEventListener('click', () => {
    toggleBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'toggleCapture' }, (response) => {
      toggleBtn.disabled = false;

      if (chrome.runtime.lastError) {
        console.error('[LogLens Popup] Error:', chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        updateUI(response.isCapturing);
      } else if (response && response.error) {
        alert('Failed to toggle capture: ' + response.error);
      }
    });
  });
});
