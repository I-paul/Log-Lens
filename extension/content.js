(function () {
  const PANEL_ID = 'loglens-sidebar';

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'showAnalysis' && message.data) {
      renderSidebar(message.data);
    }
  });

  function renderSidebar(data) {
    let panel = document.getElementById(PANEL_ID);

    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      Object.assign(panel.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        width: '380px',
        height: '100vh',
        overflowY: 'auto',
        backgroundColor: '#1e1e2e',
        color: '#cdd6f4',
        borderLeft: '2px solid #45475a',
        padding: '0',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
        zIndex: '9999999',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        lineHeight: '1.5',
        transition: 'transform 0.3s ease',
      });
      document.body.appendChild(panel);
    }

    const confidence = data.confidence || 0;
    const confidencePercent = Math.round(confidence * 100);
    const confidenceColor = confidence >= 0.7 ? '#a6e3a1' : confidence >= 0.4 ? '#f9e2af' : '#f38ba8';

    const fileRef = data.root_cause_file || data.file_ref || 'unknown';
    const lineRef = data.root_cause_line || data.line_ref || 0;
    const summary = data.error_summary || data.summary || 'N/A';
    const explanation = data.detailed_explanation || '';
    const githubUrl = data.github_url || '';

    const steps = Array.isArray(data.remediation_steps) && data.remediation_steps.length > 0
      ? data.remediation_steps.map((s) => '<li style="margin-bottom:6px;">' + esc(s) + '</li>').join('')
      : '<li>No remediation steps available</li>';

    const githubLink = githubUrl
      ? '<a href="' + esc(githubUrl) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#313244;color:#89b4fa;border-radius:6px;text-decoration:none;font-size:12px;font-weight:500;margin-top:4px;border:1px solid #45475a;">'
        + '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'
        + 'View in GitHub: ' + esc(fileRef) + ':' + lineRef
        + '</a>'
      : '';

    panel.innerHTML =
      '<div style="padding:14px 16px;">'
      // Header
      + '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #313244;padding-bottom:10px;margin-bottom:14px;">'
        + '<strong style="font-size:15px;color:#89b4fa;">LogLens Analysis</strong>'
        + '<button id="loglens-close" style="background:none;border:none;color:#a6adc8;font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>'
      + '</div>'

      // Confidence badge
      + '<div style="margin-bottom:14px;">'
        + '<div style="display:flex;align-items:center;gap:8px;">'
          + '<div style="flex:1;height:6px;background:#313244;border-radius:3px;overflow:hidden;">'
            + '<div style="width:' + confidencePercent + '%;height:100%;background:' + confidenceColor + ';border-radius:3px;"></div>'
          + '</div>'
          + '<span style="font-size:11px;color:' + confidenceColor + ';font-weight:600;">' + confidencePercent + '%</span>'
        + '</div>'
        + '<div style="font-size:10px;color:#6c7086;margin-top:2px;">Confidence Score</div>'
      + '</div>'

      // Summary
      + '<div style="margin-bottom:14px;">'
        + '<div style="color:#a6adc8;font-size:11px;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">Summary</div>'
        + '<div style="color:#f5e0dc;font-weight:500;margin-top:4px;">' + esc(summary) + '</div>'
      + '</div>'

      // File & Line Pointers
      + '<div style="margin-bottom:14px;">'
        + '<div style="color:#a6adc8;font-size:11px;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">File & Line Pointers</div>'
        + '<div style="font-family:\'Cascadia Code\',Consolas,monospace;color:#a6e3a1;margin-top:4px;word-break:break-all;font-size:12px;">' + esc(fileRef) + ':' + lineRef + '</div>'
        + githubLink
      + '</div>'

      // Detailed Explanation
      + (explanation
        ? '<div style="margin-bottom:14px;">'
          + '<div style="color:#a6adc8;font-size:11px;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">Detailed Explanation</div>'
          + '<div style="color:#cdd6f4;margin-top:4px;font-size:12px;line-height:1.6;">' + esc(explanation) + '</div>'
        + '</div>'
        : '')

      // Remediation Steps
      + '<div style="margin-bottom:14px;">'
        + '<div style="color:#a6adc8;font-size:11px;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:6px;">Remediation Steps</div>'
        + '<ul style="margin:0;padding-left:18px;color:#cdd6f4;font-size:12px;">' + steps + '</ul>'
      + '</div>'
    + '</div>';

    var closeBtn = document.getElementById('loglens-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (panel) panel.remove();
      });
    }
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
