export function getMessageHandlerJs(): string {
  return `
      // ===== MESSAGE HANDLERS FROM BACKEND =====
      // Listen for messages from extension backend
      if (typeof vscode !== 'undefined') {
        window.addEventListener('message', event => {
          const message = event.data;

          switch (message.type) {
            case 'ordinex:eventsUpdate':
              console.log('');
              console.log('[EVENTS] \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
              console.log('[EVENTS] \u2551  \ud83d\udce8 EVENTS UPDATE FROM BACKEND        \u2551');
              console.log('[EVENTS] \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');

              // Backend sent updated events - replace our state
              if (message.events) {
                console.log('[EVENTS] Received', message.events.length, 'events');
                console.log('[EVENTS] Previous events count:', state.events.length);

                // Log last 3 events for debugging
                const lastThree = message.events.slice(-3);
                console.log('[EVENTS] Last 3 events:');
                lastThree.forEach((e, idx) => {
                  console.log(\`[EVENTS]   \${idx + 1}. \${e.type}\`, e.payload?.mission_id ? \`(mission: \${e.payload.mission_id.substring(0, 8)}...)\` : '');
                });

                state.events = message.events;
                console.log('[EVENTS] \u2713 Events state updated');

                // CRITICAL: Update Mission Control Bar BEFORE clearing optimistic state
                // This ensures the UI reflects the running state from actual events
                console.log('[EVENTS] \ud83d\udd04 Calling updateMissionControlBar()...');
                updateMissionControlBar();
                console.log('[EVENTS] \u2713 updateMissionControlBar() completed');

                // Then clear optimistic mission start if we received actual mission_started event
                // Do this AFTER UI update so we don't lose the running indicator
                if (state.missionStartPending) {
                  console.log('[EVENTS] Checking if should clear optimistic state...');
                  console.log('[EVENTS] Looking for mission_started with ID:', state.missionStartPending.missionId);
                  const actualStart = message.events.find(e =>
                    e.type === 'mission_started' &&
                    e.payload?.mission_id === state.missionStartPending.missionId
                  );
                  if (actualStart) {
                    console.log('[EVENTS] \u2713 Found actual mission_started event, clearing optimistic state');
                    state.missionStartPending = null;
                  } else {
                    console.log('[EVENTS] \u26a0\ufe0f No matching mission_started event found yet');
                  }
                }

                // Update counters from events (Systems tab)
                state.counters = {
                  filesInScope: 0,
                  filesTouched: 0,
                  linesIncluded: 0,
                  toolCallsUsed: 0,
                  toolCallsMax: 100
                };

                for (const event of message.events) {
                  // Track context_collected (ANSWER mode)
                  if (event.type === 'context_collected') {
                    const filesCount = (event.payload.files_included || []).length;
                    const linesCount = event.payload.total_lines || 0;
                    state.counters.filesInScope = Math.max(state.counters.filesInScope, filesCount);
                    state.counters.linesIncluded = Math.max(state.counters.linesIncluded, linesCount);
                  }

                  // Track retrieval_completed (MISSION mode)
                  if (event.type === 'retrieval_completed') {
                    const count = event.payload.results_count || 0;
                    state.counters.filesInScope = Math.max(state.counters.filesInScope, count);
                  }

                  // Track tool calls
                  if (event.type === 'tool_start') {
                    state.counters.toolCallsUsed++;
                  }

                  // Track files touched
                  if (event.type === 'diff_applied') {
                    const files = (event.payload.files_changed || []).length;
                    state.counters.filesTouched += files;
                  }
                }

                renderMission();
                renderLogs();
                renderSystemsCounters(); // Update Systems tab

                // AUTO-SCROLL: Scroll to bottom of content area when new events arrive
                // This keeps the latest event visible during mission execution
                setTimeout(() => {
                  const contentArea = document.querySelector('.content');
                  if (contentArea) {
                    contentArea.scrollTop = contentArea.scrollHeight;
                  }
                }, 100); // Small delay to ensure rendering is complete

                // Update status based on last event
                const lastEvent = state.events[state.events.length - 1];
                if (lastEvent) {
                  if (lastEvent.type === 'final' || lastEvent.type === 'scaffold_final_complete') {
                    updateStatus('ready');
                  } else if (lastEvent.type === 'failure_detected') {
                    updateStatus('error');
                  } else if (lastEvent.type === 'tool_end' && lastEvent.payload.tool === 'llm_answer') {
                    updateStatus('ready');
                  }
                }
              }
              break;

            case 'ordinex:streamDelta':
              // LLM is streaming - accumulate text
              console.log('Stream delta:', message.delta);

              // Initialize streaming answer if needed
              if (!state.streamingAnswer) {
                state.streamingAnswer = {
                  taskId: message.task_id || 'unknown',
                  text: ''
                };
              }

              // Accumulate text
              state.streamingAnswer.text += message.delta;

              // CRITICAL: Update ONLY the streaming text content, don't re-render entire timeline
              // Find the streaming answer content div and update it directly
              const streamingContentDiv = missionTab.querySelector('.streaming-answer-content');
              if (streamingContentDiv) {
                streamingContentDiv.textContent = state.streamingAnswer.text;
              }
              break;

            case 'ordinex:streamComplete':
              // LLM streaming finished
              console.log('Stream complete');

              // Mark as complete but don't clear yet
              // It will be cleared when events update arrives
              if (state.streamingAnswer) {
                state.streamingAnswer.isComplete = true;
              }

              // Re-render to show completion state
              renderMission();

              updateStatus('ready');
              break;

            case 'ordinex:exportComplete':
              if (message.success) {
                console.log('Export completed:', message.zipPath);
              } else {
                console.error('Export failed:', message.error);
              }
              break;

            case 'ordinex:attachmentUploaded':
              // Attachment upload completed successfully
              console.log('Attachment uploaded:', message.attachmentId, message.evidenceId);
              {
                const pendingUpload = window.__pendingAttachmentUploads && window.__pendingAttachmentUploads[message.attachmentId];
                if (pendingUpload) {
                  const { resolve, attachment } = pendingUpload;
                  attachment.status = 'uploaded';
                  attachment.evidenceId = message.evidenceId;
                  renderAttachments();
                  resolve({ success: true, evidenceId: message.evidenceId });
                  delete window.__pendingAttachmentUploads[message.attachmentId];
                }
              }
              break;

            case 'ordinex:attachmentError':
              // Attachment upload failed
              console.error('Attachment upload error:', message.attachmentId, message.error);
              {
                const pendingUpload = window.__pendingAttachmentUploads && window.__pendingAttachmentUploads[message.attachmentId];
                if (pendingUpload) {
                  const { resolve, attachment } = pendingUpload;
                  attachment.status = 'error';
                  attachment.errorMsg = message.error || 'Upload failed';
                  renderAttachments();
                  showToast(attachment.errorMsg);
                  resolve({ success: false, error: attachment.errorMsg });
                  delete window.__pendingAttachmentUploads[message.attachmentId];
                }
              }
              break;

            case 'ordinex:preflightCard':
              // Step 43: Render PreflightCard inline in mission tab
              console.log('[PREFLIGHT] Received preflight card data:', message.payload);
              {
                const payload = message.payload;
                if (payload && missionTab) {
                  const cardHtml = renderPreflightCardInline(payload);
                  const cardContainer = document.createElement('div');
                  cardContainer.className = 'preflight-card-container';
                  cardContainer.innerHTML = cardHtml;
                  missionTab.appendChild(cardContainer);
                  // Scroll to the card
                  cardContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
              }
              break;

            case 'ordinex:verificationCard':
              // Step 44: Render VerificationCard inline in mission tab
              console.log('[VERIFY] Received verification card data:', message.payload);
              {
                const vPayload = message.payload;
                if (vPayload && missionTab) {
                  const vCardContainer = document.createElement('div');
                  vCardContainer.className = 'verification-card-container';
                  vCardContainer.innerHTML = renderVerificationCardInline(vPayload);
                  missionTab.appendChild(vCardContainer);
                  vCardContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
              }
              break;

            // Step 48: Undo state updates from extension
            case 'updateUndoState':
              window.__ordinexUndoState = {
                undoable_group_ids: message.undoable_group_ids || [],
                top_undoable_group_id: message.top_undoable_group_id || null,
              };
              break;

            default:
              console.log('Unknown message from backend:', message.type);
          }
        });
      }
  `;
}
