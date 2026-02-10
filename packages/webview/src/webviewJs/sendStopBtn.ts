export function getSendStopBtnJs(): string {
  return `
      // ===== SEND/STOP TOGGLE BUTTON =====
      // Update the combined send/stop button state
      function updateSendStopButton() {
        if (!sendStopBtn) return;

        const isRunning = state.taskStatus === 'running';
        const hasText = promptInput.value.trim().length > 0;

        if (isRunning) {
          // Show stop button
          sendStopBtn.className = 'send-stop-btn stop';
          sendStopBtn.innerHTML = '■';
          sendStopBtn.title = 'Stop';
          sendStopBtn.disabled = false;
        } else {
          // Show send button
          sendStopBtn.className = 'send-stop-btn send';
          sendStopBtn.innerHTML = '▶';
          sendStopBtn.title = 'Send';
          sendStopBtn.disabled = !hasText;
        }
      }

      // Handle send/stop button click
      if (sendStopBtn) {
        sendStopBtn.addEventListener('click', () => {
          const isRunning = state.taskStatus === 'running';

          if (isRunning) {
            // Stop action
            console.log('Stop clicked');
            if (typeof vscode !== 'undefined') {
              vscode.postMessage({
                type: 'ordinex:stopExecution'
              });
            }
            updateStatus('ready');
            updateSendStopButton();
          } else {
            // Send action - delegate to existing sendBtn click handler
            sendBtn.click();
          }
        });
      }

      // Update send/stop button when textarea changes
      promptInput.addEventListener('input', () => {
        autoResizeTextarea();
        updateSendStopButton();
      });

      // Update send/stop button when status changes
      const originalUpdateStatus = updateStatus;
      updateStatus = function(status) {
        originalUpdateStatus(status);
        updateSendStopButton();
      };
  `;
}
