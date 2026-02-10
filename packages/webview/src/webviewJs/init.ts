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
