export function getActionsJs(): string {
  return `
      // ===== APPROVAL HANDLER =====
      // Handle approval/rejection from UI
      window.handleApproval = function(approvalId, decision) {
        console.log(\`handleApproval: \${approvalId}, \${decision}\`);

        // Get task_id from events
        let taskId = 'demo-task';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }

        // Find the approval request to determine type
        const approvalRequest = state.events.find(
          e => e.type === 'approval_requested' && e.payload.approval_id === approvalId
        );

        if (approvalRequest && approvalRequest.payload.approval_type === 'plan_approval') {
          // Send to backend for plan approval
          if (typeof vscode !== 'undefined') {
            vscode.postMessage({
              type: 'ordinex:resolvePlanApproval',
              task_id: taskId,
              approval_id: approvalId,
              decision: decision
            });
          } else {
            // Demo mode: simulate locally
            const event = {
              event_id: generateId(),
              task_id: taskId,
              timestamp: new Date().toISOString(),
              type: 'approval_resolved',
              mode: state.currentMode,
              stage: state.currentStage,
              payload: {
                approval_id: approvalId,
                decision: decision,
                decided_at: new Date().toISOString()
              },
              evidence_ids: [],
              parent_event_id: null
            };
            state.events.push(event);
            renderMission();
            renderLogs();
          }
        } else {
          // Other approval types (diff, terminal, etc.) - handle generically
          if (typeof vscode !== 'undefined') {
            vscode.postMessage({
              type: 'ordinex:resolveApproval',
              task_id: taskId,
              approval_id: approvalId,
              decision: decision
            });
          } else {
            // Demo mode: simulate locally
            const event = {
              event_id: generateId(),
              task_id: taskId,
              timestamp: new Date().toISOString(),
              type: 'approval_resolved',
              mode: state.currentMode,
              stage: state.currentStage,
              payload: {
                approval_id: approvalId,
                decision: decision,
                decided_at: new Date().toISOString()
              },
              evidence_ids: [],
              parent_event_id: null
            };
            state.events.push(event);
            renderMission();
            renderLogs();
          }
        }
      };

      // ===== DECISION POINT HANDLER =====
      window.handleDecisionPoint = function(taskId, decisionEventId, action) {
        console.log(\`handleDecisionPoint: \${decisionEventId}, \${action}\`);

        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:resolveDecisionPoint',
            task_id: taskId,
            decision_event_id: decisionEventId,
            action: action
          });
        } else {
          // Demo mode: simulate a resolved decision
          const event = {
            event_id: generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'clarification_received',
            mode: state.currentMode,
            stage: state.currentStage,
            payload: {
              decision_event_id: decisionEventId,
              action: action,
              decided_at: new Date().toISOString()
            },
            evidence_ids: [],
            parent_event_id: null
          };
          state.events.push(event);
          renderMission();
          renderLogs();
        }
      };

      // ===== CRASH RECOVERY HANDLER (Step 47) =====
      window.handleCrashRecovery = function(taskId, action, checkpointId) {
        console.log(\`handleCrashRecovery: task=\${taskId}, action=\${action}, cp=\${checkpointId || 'none'}\`);

        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'crash_recovery',
            task_id: taskId,
            action: action,
            checkpoint_id: checkpointId || null,
          });
        }
      };

      // Global scope expansion handler
      window.handleScopeApproval = function(approved) {
        // Find the pending scope expansion approval ID
        const scopeApproval = getPendingScopeExpansionApproval(state.events);
        if (scopeApproval) {
          handleApproval(scopeApproval.approvalId, approved ? 'approved' : 'rejected');
        } else {
          // Legacy fallback
          if (approved) {
            addDemoEvent('scope_expansion_resolved', { approved: true });
          } else {
            addDemoEvent('scope_expansion_resolved', { approved: false });
          }
          state.pendingScopeExpansion = null;
          renderSystemsCounters();
          renderMission();
        }
      };

      // ===== PROCESS CARD ACTION HANDLER =====
      window.processCardAction = function(action, processId, port) {
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'process_action',
            action: action,
            process_id: processId,
            port: port,
          });
        } else {
          console.log('Demo mode: processCardAction', action, processId, port);
        }
      };

      // ===== GENERATED TOOL ACTION HANDLER (V8) =====
      window.generatedToolAction = function(action, proposalId, taskId) {
        if (typeof vscode !== 'undefined') {
          // Flow through the existing approval pipeline
          vscode.postMessage({
            type: 'ordinex:resolveApproval',
            task_id: taskId,
            approval_id: proposalId,
            decision: action === 'approve' ? 'approved' : 'denied',
          });
        } else {
          console.log('Demo mode: generatedToolAction', action, proposalId, taskId);
        }
      };

      // ===== UNDO ACTION HANDLER (Step 48) =====
      window.handleUndoAction = function(groupId) {
        if (typeof vscode !== 'undefined') {
          // Visual feedback: update the button that triggered the undo
          var undoBtns = document.querySelectorAll('.diff-action-btn');
          for (var i = 0; i < undoBtns.length; i++) {
            var btn = undoBtns[i];
            if (btn.textContent && btn.textContent.indexOf('Undo') !== -1) {
              btn.textContent = 'Undoing...';
              btn.disabled = true;
              btn.style.opacity = '0.6';
            }
          }
          vscode.postMessage({
            type: 'undo_action',
            group_id: groupId,
          });
        } else {
          console.log('Demo mode: handleUndoAction', groupId);
        }
      };

      // ===== DIFF REVIEW HANDLER =====
      // Opens all changed files from a diff_applied event in editor tabs
      window.handleDiffReview = function(diffId) {
        // Find the diff_applied event by diff_id in state.events
        var files = [];
        for (var i = state.events.length - 1; i >= 0; i--) {
          var ev = state.events[i];
          if (ev.type === 'diff_applied' && ev.payload && ev.payload.diff_id === diffId) {
            files = ev.payload.files_changed || [];
            break;
          }
        }

        if (files.length === 0) {
          console.warn('handleDiffReview: No files found for diff_id', diffId);
          return;
        }

        if (typeof vscode !== 'undefined') {
          for (var fi = 0; fi < files.length; fi++) {
            if (files[fi].path) {
              vscode.postMessage({
                type: 'open_file',
                file_path: files[fi].path,
              });
            }
          }
        } else {
          console.log('Demo mode: handleDiffReview', diffId, files);
        }
      };

      // ===== DIFF FILE CLICK HANDLER =====
      // Opens a single file in a new editor tab
      window.handleDiffFileClick = function(filePath) {
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'open_file',
            file_path: filePath,
          });
        } else {
          console.log('Demo mode: handleDiffFileClick', filePath);
        }
      };

      // ===== RECOVERY ACTION HANDLER (Step 49) =====
      window.handleRecoveryAction = function(actionId, eventId, command) {
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'recovery_action',
            action_id: actionId,
            event_id: eventId,
            command: command || '',
          });
        } else {
          console.log('Demo mode: handleRecoveryAction', actionId, eventId, command);
        }
      };

      // ===== OPEN FILE HANDLER (Step 49) =====
      window.handleOpenFile = function(filePath) {
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'open_file',
            file_path: filePath,
          });
        } else {
          console.log('Demo mode: handleOpenFile', filePath);
        }
      };

      // ===== APPROVE PLAN AND EXECUTE (one-click) =====
      window.handleApprovePlanAndExecute = function(taskId, planEventId) {
        console.log('Approve Plan and Execute clicked', { taskId, planEventId });

        // Send single message to extension — it will approve + switch to MISSION + execute
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:approvePlanAndExecute',
            task_id: taskId,
            plan_id: planEventId
          });
          updateStatus('running');
        } else {
          console.log('Demo mode: simulating approve plan and execute');
          updateStatus('running');
          updateStage('retrieve');
          addDemoEvent('stage_changed', { from: 'plan', to: 'retrieve' });
          renderMission();
        }
      };

      // ===== REQUEST PLAN APPROVAL HANDLER (legacy) =====
      window.handleRequestPlanApproval = function(taskId, planEventId) {
        console.log('Request Plan Approval clicked', { taskId, planEventId });

        // Send message to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:requestPlanApproval',
            task_id: taskId,
            plan_id: planEventId
          });
        } else {
          // Demo mode: simulate approval request
          console.log('Demo mode: simulating plan approval request');
          const approvalId = generateId();

          setTimeout(() => {
            addDemoEvent('approval_requested', {
              approval_id: approvalId,
              approval_type: 'plan_approval',
              description: 'Approve plan to start mission',
              details: {
                plan_id: planEventId
              },
              risk_level: 'low'
            });
            renderMission();
          }, 100);
        }
      };

      // ===== EXECUTE PLAN HANDLER =====
      window.handleExecutePlan = function() {
        console.log('Execute Plan clicked');

        // Get task_id from latest event
        let taskId = 'demo-task';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }

        // Send message to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:executePlan',
            taskId: taskId
          });
        } else {
          // Demo mode: simulate execution
          console.log('Demo mode: simulating execute plan');
          setTimeout(() => {
            updateStatus('running');
            updateStage('retrieve');
            addDemoEvent('stage_changed', { from: 'plan', to: 'retrieve' });
            renderMission();
          }, 100);

          setTimeout(() => {
            addDemoEvent('retrieval_started', { query: 'Execute plan context retrieval' });
            renderMission();
          }, 300);

          setTimeout(() => {
            addDemoEvent('retrieval_completed', { results_count: 8 });
            state.counters.filesInScope = 8;
            state.counters.linesIncluded = 245;
            renderMission();
            renderSystemsCounters();
          }, 1000);
        }
      };

      // ===== CLARIFICATION HANDLERS (PLAN mode v2) =====
      // Track selection state to prevent duplicates
      let clarificationSelectionInProgress = false;

      window.handleClarificationSelect = function(taskId, optionId) {
        // Prevent duplicate clicks
        if (clarificationSelectionInProgress) {
          console.log('[ClarificationCard] Selection already in progress, ignoring');
          return;
        }

        const card = document.getElementById('clarification-card-' + taskId);
        if (!card) {
          console.error('[ClarificationCard] Card not found');
          return;
        }

        const currentState = card.getAttribute('data-state');
        if (currentState !== 'idle') {
          console.log('[ClarificationCard] Not in idle state, ignoring click');
          return;
        }

        // Set selecting state immediately
        clarificationSelectionInProgress = true;
        card.setAttribute('data-state', 'selecting');

        // Find and highlight the selected button
        const buttons = card.querySelectorAll('.clarification-btn');
        buttons.forEach(btn => {
          const btnOptionId = btn.getAttribute('data-option-id');
          if (btnOptionId === optionId) {
            btn.classList.add('selected');
            const spinner = btn.querySelector('.clarification-btn-spinner');
            if (spinner) spinner.style.display = 'inline-block';
          }
          btn.disabled = true;
        });

        // Disable skip link
        const skipLink = card.querySelector('.clarification-skip-link');
        if (skipLink) skipLink.disabled = true;

        // Send selection to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:selectClarificationOption',
            task_id: taskId,
            option_id: optionId
          });

          // Transition to processing after short delay
          setTimeout(() => {
            card.setAttribute('data-state', 'processing');
          }, 500);
        } else {
          console.error('[ClarificationCard] VS Code API not available');
          // Reset state on error
          clarificationSelectionInProgress = false;
          card.setAttribute('data-state', 'idle');
          buttons.forEach(btn => {
            btn.classList.remove('selected');
            const spinner = btn.querySelector('.clarification-btn-spinner');
            if (spinner) spinner.style.display = 'none';
            btn.disabled = false;
          });
          if (skipLink) skipLink.disabled = false;
        }
      };

      window.handleClarificationSkip = function(taskId) {
        // Prevent duplicate clicks
        if (clarificationSelectionInProgress) {
          console.log('[ClarificationCard] Selection already in progress, ignoring skip');
          return;
        }

        const card = document.getElementById('clarification-card-' + taskId);
        if (!card) {
          console.error('[ClarificationCard] Card not found');
          return;
        }

        const currentState = card.getAttribute('data-state');
        if (currentState !== 'idle') {
          console.log('[ClarificationCard] Not in idle state, ignoring skip');
          return;
        }

        // Set selecting state immediately
        clarificationSelectionInProgress = true;
        card.setAttribute('data-state', 'selecting');

        // Disable all buttons
        const buttons = card.querySelectorAll('.clarification-btn');
        buttons.forEach(btn => {
          btn.disabled = true;
        });

        const skipLink = card.querySelector('.clarification-skip-link');
        if (skipLink) {
          skipLink.textContent = 'Generating ideas...';
          skipLink.disabled = true;
        }

        // Send skip to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:skipClarification',
            task_id: taskId
          });

          // Transition to processing after short delay
          setTimeout(() => {
            card.setAttribute('data-state', 'processing');
          }, 500);
        } else {
          console.error('[ClarificationCard] VS Code API not available');
          // Reset state on error
          clarificationSelectionInProgress = false;
          card.setAttribute('data-state', 'idle');
          buttons.forEach(btn => {
            btn.disabled = false;
          });
          if (skipLink) {
            skipLink.textContent = 'Skip and let me suggest ideas →';
            skipLink.disabled = false;
          }
        }
      };

      // Handle clarification_requested suggestion button clicks
      // Submits the selected value as a prompt response so the flow continues
      window.handleClarificationResponse = function(taskId, value) {
        console.log('[Clarification] Response selected:', { taskId, value });

        // Disable all sibling buttons in the card to prevent double-click
        var card = document.querySelector('.event-card .event-action-btn');
        if (card) card = card.closest('.event-card');
        if (card) {
          card.querySelectorAll('.event-action-btn').forEach(function(btn) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
          });
        }

        // Submit the value as a prompt — the extension's submitPrompt handler
        // will pick it up and continue the flow
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:submitPrompt',
            text: value,
            userSelectedMode: state.currentMode,
            modelId: state.selectedModel,
          });
        }
      };

      // Reset clarification state when events update
      function resetClarificationState() {
        clarificationSelectionInProgress = false;
      }

      // ===== CANCEL PLAN HANDLER =====
      window.handleCancelPlan = function(taskId) {
        console.log('Cancel Plan clicked', { taskId });
        // No confirm() — webview sandbox blocks modals. Just cancel directly.
        state.events = [];
        state.streamingAnswer = null;
        updateStatus('ready');
        updateStage('none');
        renderMission();
        renderLogs();
      };

      // ===== PLAN REFINEMENT HANDLERS (Step 25) =====
      window.toggleRefinePlanInput = function(taskId, planId, planVersion) {
        console.log('Toggle Refine Plan input', { taskId, planId, planVersion });

        const container = document.getElementById('refine-plan-input-' + planId);
        if (!container) {
          console.error('Refine plan container not found:', planId);
          return;
        }

        // Toggle visibility
        if (container.style.display === 'none') {
          container.style.display = 'block';
          // Focus on textarea
          const textarea = document.getElementById('refinement-instruction-' + planId);
          if (textarea) {
            textarea.focus();
          }
        } else {
          container.style.display = 'none';
        }
      };

      window.submitPlanRefinement = function(taskId, planId, planVersion) {
        console.log('Submit Plan Refinement', { taskId, planId, planVersion });

        // Get refinement instruction text
        const textarea = document.getElementById('refinement-instruction-' + planId);
        if (!textarea) {
          console.error('Refinement textarea not found:', planId);
          return;
        }

        const refinementText = textarea.value.trim();
        if (!refinementText) {
          // Highlight the textarea border to indicate it needs input
          textarea.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
          textarea.focus();
          setTimeout(function() { textarea.style.borderColor = ''; }, 2000);
          return;
        }

        // Send to extension backend
        if (typeof vscode !== 'undefined') {
          updateStatus('running');
          vscode.postMessage({
            type: 'ordinex:refinePlan',
            task_id: taskId,
            plan_id: planId,
            refinement_text: refinementText
          });
        } else {
          console.log('Demo mode: would refine plan with:', refinementText);
        }
      };
  `;
}
