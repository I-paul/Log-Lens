(function () {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'showAnalysisOverlay' && message.data) {
      renderOverlay(message.data);
    }
  });

  function renderOverlay(data) {
    let overlay = document.getElementById('loglens-overlay');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loglens-overlay';
      overlay.style.position = 'fixed';
      overlay.style.bottom = '16px';
      overlay.style.right = '16px';
      overlay.style.width = '360px';
      overlay.style.maxHeight = '480px';
      overlay.style.overflowY = 'auto';
      overlay.style.backgroundColor = '#1e1e2e';
      overlay.style.color = '#cdd6f4';
      overlay.style.border = '1px solid #45475a';
      overlay.style.borderRadius = '8px';
      overlay.style.padding = '14px';
      overlay.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
      overlay.style.zIndex = '9999999';
      overlay.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      overlay.style.fontSize = '13px';
      overlay.style.lineHeight = '1.5';

      document.body.appendChild(overlay);
    }

    const steps =
      Array.isArray(data.remediation_steps) && data.remediation_steps.length > 0
        ? data.remediation_steps.map((step) => `<li style="margin-bottom: 4px;">${escapeHtml(step)}</li>`).join('')
        : '<li>No remediation steps available</li>';

    overlay.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #313244; padding-bottom: 8px; margin-bottom: 10px;">
        <strong style="font-size: 14px; color: #89b4fa;">LogLens Analysis</strong>
        <button id="loglens-overlay-close" style="background: none; border: none; color: #a6adc8; font-size: 18px; cursor: pointer; padding: 0 4px;">&times;</button>
      </div>

      <div style="margin-bottom: 8px;">
        <div style="color: #a6adc8; font-size: 11px; text-transform: uppercase; font-weight: 600;">Summary</div>
        <div style="color: #f5e0dc; font-weight: 500; margin-top: 2px;">${escapeHtml(data.summary || 'N/A')}</div>
      </div>

      <div style="margin-bottom: 8px;">
        <div style="color: #a6adc8; font-size: 11px; text-transform: uppercase; font-weight: 600;">File & Line Pointers</div>
        <div style="font-family: monospace; color: #a6e3a1; margin-top: 2px; word-break: break-all;">${escapeHtml(String(data.file_ref || 'unknown'))}:${escapeHtml(String(data.line_ref ?? 0))}</div>
      </div>

      <div>
        <div style="color: #a6adc8; font-size: 11px; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Remediation Steps</div>
        <ul style="margin: 0; padding-left: 18px; color: #cdd6f4;">${steps}</ul>
      </div>
    `;

    const closeBtn = document.getElementById('loglens-overlay-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (overlay) {
          overlay.remove();
        }
      });
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
