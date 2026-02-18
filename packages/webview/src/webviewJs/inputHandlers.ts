export function getInputHandlersJs(): string {
  return `
      // Add demo event
      function addDemoEvent(type, payload = {}) {
        const event = {
          event_id: generateId(),
          task_id: 'demo-task',
          timestamp: new Date().toISOString(),
          type: type,
          mode: state.currentMode,
          stage: state.currentStage,
          payload: payload,
          evidence_ids: [],
          parent_event_id: null
        };
        state.events.push(event);
        renderLogs();
      }

      // Add demo narration card
      function addDemoNarration(type, title, content) {
        const card = {
          type: type,
          title: title,
          content: content,
          timestamp: new Date().toISOString(),
          event_ids: [generateId()],
          status: type === 'approval' ? 'pending' : undefined
        };
        state.narrationCards.push(card);
        renderMission();
      }

      // Handle Send - Send to backend extension
      sendBtn.addEventListener('click', async () => {
        const prompt = promptInput.value.trim();
        if (!prompt) return;

        // Clear input immediately
        promptInput.value = '';
        autoResizeTextarea();

        // Note: Don't clear state.streamingAnswer here — completed answers should
        // persist in the timeline. It will reset when new streaming starts
        // (streamDelta handler resets when isComplete is true).

        // PHASE 4: Upload all pending attachments BEFORE sending prompt
        let attachmentRefs = [];
        if (state.pendingAttachments.length > 0) {
          console.log('[Attachments] Uploading', state.pendingAttachments.length, 'pending attachments...');
          updateStatus('running'); // Show running while uploading

          const uploadResult = await uploadAllPendingAttachments();

          if (!uploadResult.success) {
            console.error('[Attachments] Some uploads failed:', uploadResult.failed);
            // Continue with successfully uploaded attachments
          }

          // Get refs for all successfully uploaded attachments
          attachmentRefs = getAttachmentRefs();
          console.log('[Attachments] Attachment refs to send:', attachmentRefs.length);
        }

        // Send to extension backend - it will emit all events
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:submitPrompt',
            text: prompt,
            userSelectedMode: state.currentMode,
            modelId: state.selectedModel,
            // PHASE 4: Include attachment references in submit payload
            attachments: attachmentRefs
          });

          // Clear attachments after successful send
          clearAttachments();

          // Update UI to show we're processing
          updateStatus('running');
        } else {
          // Fallback for standalone testing
          console.log('Demo mode: would submit', { prompt, mode: state.currentMode, model: state.selectedModel, attachments: attachmentRefs });
          clearAttachments();
          alert('Extension backend not available. Running in demo mode.');
        }
      });

      // Handle Clear (no confirm() — webview is sandboxed, modals are blocked)
      clearBtn.addEventListener('click', () => {
        if (state.events.length === 0 && state.narrationCards.length === 0) return;

        state.events = [];
        state.narrationCards = [];
        state.counters = {
          filesInScope: 0,
          filesTouched: 0,
          linesIncluded: 0,
          toolCallsUsed: 0,
          toolCallsMax: 100
        };
        updateStatus('ready');
        updateStage('none');
        renderMission();
        renderLogs();
        renderSystemsCounters();
      });

      // Handle New Chat button (header icon)
      if (newChatBtn) {
        newChatBtn.addEventListener('click', function() {
          // Reset all state (no confirm() — webview is sandboxed, modals are blocked)
          state.events = [];
          state.narrationCards = [];
          state.streamingMission = null;
          state._completedMissionBlocks = [];
          state.streamingAnswer = null;
          state._completedAnswers = [];
          state.counters = {
            filesInScope: 0,
            filesTouched: 0,
            linesIncluded: 0,
            toolCallsUsed: 0,
            toolCallsMax: 100
          };
          state.currentStage = 'none';
          state.pendingScopeExpansion = null;

          // Reset UI
          updateStatus('ready');
          updateStage('none');
          renderMission();
          renderLogs();
          renderSystemsCounters();

          // Clear and focus input
          if (promptInput) {
            promptInput.value = '';
            promptInput.focus();
          }
          if (typeof autoResizeTextarea === 'function') {
            autoResizeTextarea();
          }
          if (typeof updateSendStopButton === 'function') {
            updateSendStopButton();
          }

          // Notify extension backend to reset its state
          if (typeof vscode !== 'undefined') {
            vscode.postMessage({ type: 'ordinex:newChat' });
          }

          console.log('[NewChat] Chat cleared and reset');
        });
      }

      // ===== TASK HISTORY HANDLERS =====
      function isHistoryOpen() {
        return historyPanel && historyPanel.style.display === 'flex';
      }

      function openHistoryPanel() {
        if (!historyPanel) return;
        historyPanel.style.display = 'flex';
        // Request task history from backend
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({ type: 'ordinex:getTaskHistory' });
        }
      }

      function closeHistoryPanel() {
        if (!historyPanel) return;
        historyPanel.style.display = 'none';
      }

      if (historyBtn) {
        historyBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          if (isHistoryOpen()) {
            closeHistoryPanel();
          } else {
            openHistoryPanel();
          }
        });
      }

      if (historyCloseBtn) {
        historyCloseBtn.addEventListener('click', function() {
          closeHistoryPanel();
        });
      }

      // Close history panel when clicking outside
      document.addEventListener('click', function(e) {
        if (isHistoryOpen()) {
          if (!historyPanel.contains(e.target) && e.target !== historyBtn && !historyBtn.contains(e.target)) {
            closeHistoryPanel();
          }
        }
      });

      // Switch to a task from history
      window.handleSwitchTask = function(taskId) {
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:switchTask',
            task_id: taskId,
          });
        }
        closeHistoryPanel();
      };

      // Handle Mode Change
      modeSelect.addEventListener('change', () => {
        state.currentMode = modeSelect.value;
      });

      // Handle Model Change
      modelSelect.addEventListener('change', () => {
        state.selectedModel = modelSelect.value;
        // Update model hint text
        const modelHint = document.getElementById('modelHint');
        if (modelHint) {
          const hints = {
            'claude-3-haiku': 'Fast / lightweight',
            'claude-sonnet-4-5': 'Best for building features / multi-file changes'
          };
          modelHint.textContent = hints[modelSelect.value] || '';
        }
      });

      // Handle Export Run
      if (exportRunBtn) {
        exportRunBtn.addEventListener('click', () => {
          // Get task_id from latest event
          let taskId = null;
          if (state.events.length > 0) {
            taskId = state.events[0].task_id;
          }

          if (!taskId) {
            console.warn('No task ID available for export');
            return;
          }

          // Send message to extension
          if (typeof vscode !== 'undefined') {
            vscode.postMessage({
              type: 'ordinex:exportRun',
              taskId: taskId
            });
          } else {
            console.log('Demo mode: would export run for task', taskId);
            alert('Export feature requires VS Code extension backend');
          }
        });
      }

      // Update Export Run button visibility
      function updateExportButtonVisibility() {
        if (exportRunBtn) {
          // Show button if there's at least one event
          exportRunBtn.style.display = state.events.length > 0 ? 'block' : 'none';
        }
      }

      // Auto-resize textarea
      function autoResizeTextarea() {
        promptInput.style.height = 'auto';
        const newHeight = Math.min(promptInput.scrollHeight, 120);
        promptInput.style.height = newHeight + 'px';
      }

      promptInput.addEventListener('input', autoResizeTextarea);

      // Keyboard shortcuts — Enter sends, Shift+Enter inserts newline
      promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      });

      // ===== UI GATING =====
      // Update UI gating based on pending approvals
      function updateUIGating() {
        const pending = hasPendingApprovals(state.events);

        if (pending) {
          // Change status to AWAITING APPROVAL
          updateStatus('awaiting_approval');

          // Disable send button
          sendBtn.disabled = true;
          sendBtn.title = 'Resolve pending approval first';
        } else {
          // Re-enable send button if not running
          if (state.taskStatus === 'awaiting_approval') {
            updateStatus('ready');
          }
          sendBtn.disabled = false;
          sendBtn.title = '';
        }

        // Stop button remains enabled
        stopBtn.disabled = false;

        // Update Systems tab for scope expansion
        const scopeApproval = getPendingScopeExpansionApproval(state.events);
        if (scopeApproval) {
          const details = scopeApproval.requestEvent.payload.details || {};
          state.pendingScopeExpansion = {
            reason: details.reason || 'Scope expansion requested',
            impact_level: 'medium',
            requested: details.requested || {}
          };
          renderSystemsCounters();
        } else if (state.pendingScopeExpansion) {
          state.pendingScopeExpansion = null;
          renderSystemsCounters();
        }
      }
  `;
}
