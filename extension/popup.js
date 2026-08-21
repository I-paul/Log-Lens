document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');

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

  // Check current capture state on load
  chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
    if (!activeTab || !activeTab.id) return;

    chrome.storage.local.get(['isCapturing', 'attachedTabId'], (data) => {
      const isCapturingCurrentTab =
        !!data.isCapturing && data.attachedTabId === activeTab.id;
      updateUI(isCapturingCurrentTab);
    });
  });

  // Handle toggle button click
  toggleBtn.addEventListener('click', () => {
    toggleBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'toggleCapture' }, (response) => {
      toggleBtn.disabled = false;

      if (chrome.runtime.lastError) {
        console.error('[LogLens Popup] Error sending message:', chrome.runtime.lastError.message);
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
