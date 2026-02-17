export function getInitJs(): string {
  return `
      // Initialize
      updateStatus('ready');
      updateStage('none');
      renderMission();
      renderSystemsCounters();
      renderLogs();
      updateSendStopButton();
      promptInput.focus();

      // Step 52: Global keyboard shortcuts within the webview
      document.addEventListener('keydown', function(e) {
        // Cmd+L / Ctrl+L — focus prompt input
        if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
          e.preventDefault();
          if (promptInput) {
            promptInput.focus();
            promptInput.select();
          }
        }
        // Escape — stop execution if running, otherwise blur input
        if (e.key === 'Escape') {
          if (state.taskStatus === 'running') {
            e.preventDefault();
            if (typeof vscode !== 'undefined') {
              vscode.postMessage({ type: 'ordinex:stopExecution' });
            }
            updateStatus('ready');
            if (typeof updateSendStopButton === 'function') {
              updateSendStopButton();
            }
          } else if (document.activeElement === promptInput) {
            promptInput.blur();
          }
        }
      });

      // Add test buttons to composer for demo purposes
      if (window.location.search.includes('demo')) {
        const demoControls = document.createElement('div');
        demoControls.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 0;';
        demoControls.innerHTML = \`
          <button onclick="testApproval('terminal')" class="secondary" style="padding: 4px 8px; font-size: 10px;">
            Test Terminal Approval
          </button>
          <button onclick="testApproval('apply_diff')" class="secondary" style="padding: 4px 8px; font-size: 10px;">
            Test Diff Approval
          </button>
          <button onclick="testApproval('scope_expansion')" class="secondary" style="padding: 4px 8px; font-size: 10px;">
            Test Scope Approval
          </button>
        \`;
        document.querySelector('.composer-controls').appendChild(demoControls);
      }
  `;
}
