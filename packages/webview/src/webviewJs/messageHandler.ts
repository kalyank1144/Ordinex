export function getMessageHandlerJs(): string {
  return `
      // ===== STREAMING BLOCK HELPERS =====
      var _blockCounter = 0;
      function newBlockId(prefix) {
        return prefix + '_' + (++_blockCounter);
      }

      function ensureStreamingMission(message) {
        // If previous session is complete, or step/iteration changed, start fresh
        if (!state.streamingMission || state.streamingMission.isComplete) {
          // Snapshot completed blocks for timeline persistence
          if (state.streamingMission && state.streamingMission.isComplete && state.streamingMission.blocks.length > 0) {
            if (!state._completedMissionBlocks) state._completedMissionBlocks = [];
            state._completedMissionBlocks.push({
              stepId: state.streamingMission.stepId,
              iteration: state.streamingMission.iteration,
              blocks: state.streamingMission.blocks
            });
          }
          state.streamingMission = {
            taskId: message.task_id || 'unknown',
            stepId: message.step_id || '',
            iteration: message.iteration || 1,
            blocks: [],
            activeNarrationId: null,
            isComplete: false
          };
          // Reset perf state for new session
          state._missionDeltaCount = 0;
          state._missionLastParsedText = '';
          state._missionLastParsedHtml = '';
          state._missionUserPinnedScroll = false;
        }
      }

      function appendNarration(delta) {
        var sm = state.streamingMission;
        if (!sm) return;
        if (!sm.activeNarrationId) {
          var block = { id: newBlockId('nar'), kind: 'narration', text: '', ts: Date.now() };
          sm.blocks.push(block);
          sm.activeNarrationId = block.id;
        }
        for (var i = sm.blocks.length - 1; i >= 0; i--) {
          if (sm.blocks[i].id === sm.activeNarrationId) {
            sm.blocks[i].text += delta;
            break;
          }
        }
      }

      function closeNarration() {
        if (state.streamingMission) {
          state.streamingMission.activeNarrationId = null;
        }
      }

      function getBlockText(sm, blockId) {
        for (var i = sm.blocks.length - 1; i >= 0; i--) {
          if (sm.blocks[i].id === blockId) return sm.blocks[i].text;
        }
        return '';
      }

      function shouldReparseMarkdown(nextText) {
        state._missionDeltaCount = (state._missionDeltaCount || 0) + 1;
        if (!state._missionLastParsedText) return true;
        if (nextText.length - state._missionLastParsedText.length >= 60) return true;
        if (/\\n\\n|\\n\\\`\\\`\\\`|\\\`\\\`\\\`/.test(nextText.slice(-8))) return true;
        return (state._missionDeltaCount % 4) === 0;
      }

      function getNarrationHtmlForStreaming(sm, blockId) {
        var txt = getBlockText(sm, blockId);
        if (shouldReparseMarkdown(txt)) {
          state._missionLastParsedText = txt;
          state._missionLastParsedHtml = simpleMarkdown(txt);
        }
        return (state._missionLastParsedHtml || simpleMarkdown(txt));
      }

      function updateLastNarrationBlock(container, sm) {
        if (!sm.activeNarrationId) return;
        var el = container.querySelector('[data-block-id="' + sm.activeNarrationId + '"]');
        if (el) {
          preserveStreamingScrollIntent(container, function() {
            el.innerHTML = getNarrationHtmlForStreaming(sm, sm.activeNarrationId)
              + '<span style="display:inline-block;width:2px;height:16px;background:var(--vscode-charts-orange);margin-left:2px;animation:blink 1s steps(2,start) infinite;vertical-align:text-bottom;"></span>';
          });
        } else {
          renderMission();
        }
      }

      function scheduleBlockRender() {
        if (!state._missionRafPending) {
          state._missionRafPending = true;
          requestAnimationFrame(function() {
            state._missionRafPending = false;
            // Try incremental DOM update: append new blocks to existing container
            var container = missionTab.querySelector('.streaming-blocks-container');
            if (container && state.streamingMission && state.streamingMission.blocks.length > 0) {
              // Count how many blocks the DOM already has
              var existingEls = container.querySelectorAll('[data-block-id]');
              var domCount = existingEls.length;
              var stateCount = state.streamingMission.blocks.length;
              if (stateCount > domCount) {
                // Append only the NEW blocks (avoid full re-render)
                var scrollEl = getScrollableContent();
                var shouldAutoScroll = scrollEl && isNearBottom(scrollEl, 300) && !state._missionUserPinnedScroll;
                for (var bi = domCount; bi < stateCount; bi++) {
                  var block = state.streamingMission.blocks[bi];
                  var html = '';
                  if (block.kind === 'narration') {
                    html = renderNarrationBlock(block, block.id === state.streamingMission.activeNarrationId);
                  } else if (block.kind === 'tool') {
                    html = renderToolBlock(block);
                  }
                  if (html) {
                    var wrapper = document.createElement('div');
                    wrapper.innerHTML = html;
                    while (wrapper.firstChild) {
                      container.appendChild(wrapper.firstChild);
                    }
                  }
                }
                if (shouldAutoScroll && scrollEl) {
                  // Instant scroll for new blocks during streaming
                  scrollEl.scrollTop = scrollEl.scrollHeight;
                }
                return;
              }
            }
            // Fallback: full re-render (e.g., container doesn't exist yet)
            renderMission();
          });
        }
      }

      // ===== SMART AUTOSCROLL =====
      // Targets the .content scrollable parent (not the streaming container itself)
      function getScrollableContent() {
        return document.querySelector('.content');
      }

      function isNearBottom(el, thresholdPx) {
        if (!el) return true;
        return (el.scrollHeight - el.scrollTop - el.clientHeight) <= (thresholdPx || 300);
      }

      function preserveStreamingScrollIntent(container, updateFn) {
        var scrollEl = getScrollableContent();
        if (!scrollEl) return updateFn();
        var shouldAutoStick = isNearBottom(scrollEl, 300) && !state._missionUserPinnedScroll;
        updateFn();
        if (shouldAutoStick) {
          // Use instant scroll during rapid streaming — smooth scroll can't keep up
          // with 60fps content updates and causes isNearBottom to return false
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      }

      function attachStreamingScrollListener(container) {
        var scrollEl = getScrollableContent();
        if (!scrollEl || scrollEl.dataset.streamScrollBound === '1') return;
        scrollEl.dataset.streamScrollBound = '1';
        scrollEl.addEventListener('scroll', function() {
          state._missionUserPinnedScroll = !isNearBottom(scrollEl, 300);
        }, { passive: true });
      }

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

              // Backend sent updated events — merge with existing to preserve cross-task continuity
              if (message.events) {
                console.log('[EVENTS] Received', message.events.length, 'events');
                console.log('[EVENTS] Previous events count:', state.events.length);

                // Log last 3 events for debugging
                var lastThree = message.events.slice(-3);
                console.log('[EVENTS] Last 3 events:');
                lastThree.forEach(function(e, idx) {
                  var missionInfo = (e.payload && e.payload.mission_id) ? '(mission: ' + e.payload.mission_id.substring(0, 8) + '...)' : '';
                  console.log('[EVENTS]   ' + (idx + 1) + '. ' + e.type, missionInfo);
                });

                // Smart merge: keep events from tasks NOT in the incoming batch,
                // then append incoming events. This preserves scaffold timeline
                // when a follow-up prompt creates a new task_id.
                var incomingTaskIds = {};
                message.events.forEach(function(e) { if (e.task_id) incomingTaskIds[e.task_id] = true; });
                var preserved = state.events.filter(function(e) { return e.task_id && !incomingTaskIds[e.task_id]; });
                if (preserved.length > 0) {
                  console.log('[EVENTS] Preserving', preserved.length, 'events from previous tasks');
                }
                state.events = preserved.concat(message.events);
                console.log('[EVENTS] \u2713 Events state updated (merged:', state.events.length, 'total)');

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

                // Auto-clear streaming states when completion events arrive
                // Answer streaming: mark as complete (don't null — card must persist as final answer)
                if (state.streamingAnswer && !state.streamingAnswer.isComplete) {
                  const hasAnswerEnd = message.events.some(e =>
                    (e.type === 'tool_end' && e.payload && e.payload.tool === 'llm_answer') ||
                    e.type === 'final'
                  );
                  if (hasAnswerEnd) {
                    state.streamingAnswer.isComplete = true;
                  }
                }
                // Plan streaming: clear when plan_created appears (plan generation done)
                if (state.streamingPlan) {
                  const hasPlanCreated = message.events.some(e =>
                    e.type === 'plan_created' || e.type === 'plan_revised'
                  );
                  if (hasPlanCreated) {
                    state.streamingPlan = null;
                  }
                }
                // Mission streaming: mark complete on loop_paused/loop_completed (edit step done)
                // Don't null — blocks persist in the timeline above the LoopPaused card.
                if (state.streamingMission && !state.streamingMission.isComplete) {
                  const hasLoopEnd = message.events.some(e =>
                    e.type === 'loop_paused' || e.type === 'loop_completed'
                  );
                  if (hasLoopEnd) {
                    state.streamingMission.isComplete = true;
                    state.streamingMission.activeNarrationId = null;
                    state._missionDeltaCount = 0;
                    state._missionLastParsedText = '';
                    state._missionLastParsedHtml = '';
                    state._missionUserPinnedScroll = false;
                  }
                }

                // CRITICAL: During active streaming, do NOT call renderMission().
                // renderMission() replaces the entire missionTab.innerHTML which:
                //   1. Destroys the live streaming blocks container → visual flash
                //   2. Resets scroll position → scroll jumps
                //   3. Breaks RAF-throttled streaming updates
                // Instead, only update lightweight UI (control bar, logs, counters).
                // The streaming UI is managed by missionStreamDelta / missionToolActivity handlers.
                var isActivelyStreaming = state.streamingMission && !state.streamingMission.isComplete;
                if (isActivelyStreaming) {
                  // Lightweight updates only — don't touch missionTab DOM
                  updateMissionControlBar();
                  renderLogs();
                  renderSystemsCounters();
                } else {
                  renderMission();
                  renderLogs();
                  renderSystemsCounters();

                  // AUTO-SCROLL: Smooth scroll to bottom when new events arrive (non-streaming)
                  requestAnimationFrame(() => {
                    const contentArea = document.querySelector('.content');
                    if (contentArea) {
                      contentArea.scrollTo({ top: contentArea.scrollHeight, behavior: 'smooth' });
                    }
                  });
                }

                // ALWAYS check status based on recent events — even during streaming.
                // This ensures the UI resets to "ready" when terminal events arrive.
                var READY_EVENT_TYPES = [
                  'final', 'scaffold_final_complete', 'failure_detected',
                  'execution_paused', 'clarification_requested', 'loop_paused',
                  'plan_created', 'plan_ready', 'decision_point_needed',
                  'command_proposed', 'mission_completed', 'mission_cancelled',
                  'loop_completed', 'answer_completed',
                  'diff_proposed', 'diff_applied'
                ];
                var recentEvents = state.events.slice(-5);
                var hasReadyEvent = recentEvents.some(function(ev) {
                  return READY_EVENT_TYPES.indexOf(ev.type) !== -1
                    || (ev.type === 'tool_end' && ev.payload && ev.payload.tool === 'llm_answer');
                });
                var lastEvent = state.events[state.events.length - 1];
                if (lastEvent && lastEvent.type === 'failure_detected') {
                  updateStatus('error');
                } else if (hasReadyEvent) {
                  updateStatus('ready');
                }
              }
              break;

            case 'ordinex:streamDelta':
              // LLM is streaming - accumulate text

              // Initialize or reset streaming answer (reset if previous was completed)
              if (!state.streamingAnswer || state.streamingAnswer.isComplete) {
                state.streamingAnswer = {
                  taskId: message.task_id || 'unknown',
                  text: ''
                };
              }

              // Accumulate text
              state.streamingAnswer.text += message.delta;

              // Try direct DOM update with markdown rendering
              {
                const streamingContentDiv = missionTab.querySelector('.streaming-answer-content');
                if (streamingContentDiv) {
                  streamingContentDiv.innerHTML = simpleMarkdown(state.streamingAnswer.text) + '<span style="display:inline-block;width:2px;height:16px;background:var(--vscode-charts-blue);margin-left:2px;animation:blink 1s steps(2,start) infinite;vertical-align:text-bottom;"></span>';
                } else {
                  // DOM element doesn't exist yet — re-render to create streaming card
                  renderMission();
                }
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

            // ===== A6: PLAN MODE STREAMING =====
            case 'ordinex:planStreamDelta':
              // Plan generation is streaming — accumulate text and show clean progress
              if (!state.streamingPlan) {
                state.streamingPlan = {
                  taskId: message.task_id || 'unknown',
                  text: ''
                };
              }

              state.streamingPlan.text += message.delta;

              // Update the streaming plan card with progressive step content
              {
                const planStreamDiv = missionTab.querySelector('.streaming-plan-content');
                if (planStreamDiv) {
                  planStreamDiv.innerHTML = buildStreamingPlanInnerHtml(state.streamingPlan.text);
                } else {
                  // DOM element doesn't exist yet — re-render to create streaming card
                  renderMission();
                }
              }
              break;

            case 'ordinex:planStreamComplete':
              console.log('Plan stream complete');
              if (state.streamingPlan) {
                state.streamingPlan = null;
              }
              // Full re-render to show the final PlanCard (arrives via eventsUpdate)
              renderMission();
              break;

            // ===== A6: MISSION EDIT STEP STREAMING (Sequential Blocks) =====
            case 'ordinex:missionStreamDelta':
              ensureStreamingMission(message);
              state.streamingMission.iteration = message.iteration || state.streamingMission.iteration;
              appendNarration(message.delta);

              // RAF-throttled render (no full renderMission per token)
              if (!state._missionRafPending) {
                state._missionRafPending = true;
                requestAnimationFrame(function() {
                  state._missionRafPending = false;
                  var container = missionTab.querySelector('.streaming-blocks-container');
                  if (container && state.streamingMission) {
                    attachStreamingScrollListener();
                    updateLastNarrationBlock(container, state.streamingMission);
                  } else {
                    renderMission();
                    // After full re-render, auto-scroll to bottom
                    var scrollEl = getScrollableContent();
                    if (scrollEl && !state._missionUserPinnedScroll) {
                      scrollEl.scrollTop = scrollEl.scrollHeight;
                    }
                  }
                });
              }
              break;

            case 'ordinex:missionStreamComplete':
              console.log('Mission stream complete');
              if (state.streamingMission) {
                // Mark complete — don't null. Blocks persist in the timeline.
                state.streamingMission.isComplete = true;
                state.streamingMission.activeNarrationId = null;
              }
              // Reset streaming perf state
              state._missionDeltaCount = 0;
              state._missionLastParsedText = '';
              state._missionLastParsedHtml = '';
              state._missionUserPinnedScroll = false;
              renderMission();
              // Reset status to ready — the agent has finished this streaming phase
              updateStatus('ready');
              break;

            // Phase 2: Inline tool activity — sequential blocks model
            case 'ordinex:missionToolActivity':
              ensureStreamingMission(message);
              {
                var sm = state.streamingMission;
                if (message.event_type === 'tool_start') {
                  closeNarration();
                  sm.blocks.push({
                    id: newBlockId('tool'),
                    kind: 'tool',
                    toolCallId: message.tool_call_id || null,
                    tool: message.tool,
                    input: message.input || {},
                    status: 'running',
                    error: null,
                    ts: Date.now()
                  });
                  scheduleBlockRender();
                } else if (message.event_type === 'tool_end') {
                  var matched = null;

                  // Preferred: exact match via tool_call_id from backend
                  if (message.tool_call_id) {
                    for (var ci = sm.blocks.length - 1; ci >= 0; ci--) {
                      if (sm.blocks[ci].kind === 'tool' &&
                          sm.blocks[ci].toolCallId === message.tool_call_id &&
                          sm.blocks[ci].status === 'running') {
                        matched = sm.blocks[ci];
                        break;
                      }
                    }
                  }

                  // Backward-compat fallback (only if ID missing)
                  if (!matched) {
                    for (var cj = sm.blocks.length - 1; cj >= 0; cj--) {
                      if (sm.blocks[cj].kind === 'tool' && sm.blocks[cj].tool === message.tool && sm.blocks[cj].status === 'running') {
                        matched = sm.blocks[cj];
                        break;
                      }
                    }
                  }

                  if (matched) {
                    matched.status = message.success ? 'done' : 'error';
                    if (message.error) matched.error = message.error;
                    var toolEl = missionTab.querySelector('[data-block-id="' + matched.id + '"]');
                    if (toolEl) {
                      preserveStreamingScrollIntent(null, function() {
                        toolEl.outerHTML = renderToolBlock(matched);
                      });
                    } else {
                      scheduleBlockRender();
                    }
                  } else {
                    scheduleBlockRender();
                  }
                }
              }
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

            // A9: Onboarding flow trigger from extension
            case 'ordinex:showOnboarding':
              console.log('[A9] Received showOnboarding message');
              if (typeof checkOnboarding === 'function') {
                checkOnboarding(true);
              }
              break;

            // Task History: Populate the history panel with task summaries
            case 'ordinex:taskHistory':
              console.log('[TaskHistory] Received', (message.tasks || []).length, 'task summaries');
              if (historyPanelList && message.tasks) {
                var tasks = message.tasks;
                var currentTid = message.currentTaskId || null;
                if (tasks.length === 0) {
                  historyPanelList.innerHTML = '<div class="history-empty">No previous tasks.</div>';
                } else {
                  var html = '';
                  for (var ti = 0; ti < tasks.length; ti++) {
                    var t = tasks[ti];
                    var truncTitle = t.title.length > 60 ? t.title.substring(0, 57) + '...' : t.title;
                    var isActive = (currentTid && t.task_id === currentTid);
                    var modeBadge = t.mode || 'ANSWER';
                    var modeClass = 'history-mode-' + modeBadge.toLowerCase();
                    var relTime = formatRelativeTime(t.last_event_at);
                    html += '<div class="history-item' + (isActive ? ' history-item-active' : '') + '" onclick="handleSwitchTask(\\'';
                    html += escapeJsString(t.task_id);
                    html += '\\')" title="' + escapeHtml(t.title) + '">';
                    html += '<div class="history-item-top">';
                    html += '<span class="history-item-title">' + escapeHtml(truncTitle) + '</span>';
                    html += '</div>';
                    html += '<div class="history-item-meta">';
                    html += '<span class="history-mode-badge ' + modeClass + '">' + escapeHtml(modeBadge) + '</span>';
                    html += '<span class="history-item-time">' + escapeHtml(relTime) + '</span>';
                    if (isActive) {
                      html += '<span class="history-active-badge">Active</span>';
                    }
                    html += '</div>';
                    html += '</div>';
                  }
                  historyPanelList.innerHTML = html;
                }
              }
              break;

            // Task History: Restore a previously completed task
            case 'ordinex:taskSwitched':
              console.log('[TaskHistory] Task switched to:', message.task_id);
              // Replace events with the switched task's events
              state.events = message.events || [];
              state.narrationCards = [];
              state.streamingMission = null;
              state._completedMissionBlocks = [];
              state.streamingAnswer = null;
              if (state._completedAnswers) state._completedAnswers = [];
              state.currentStage = message.stage || 'none';
              state.currentMode = message.mode || 'ANSWER';
              state.pendingScopeExpansion = null;

              // Reset counters and recalculate from loaded events
              state.counters = {
                filesInScope: 0,
                filesTouched: 0,
                linesIncluded: 0,
                toolCallsUsed: 0,
                toolCallsMax: 100
              };
              for (var sei = 0; sei < state.events.length; sei++) {
                var sev = state.events[sei];
                if (sev.type === 'context_collected') {
                  var fc = (sev.payload.files_included || []).length;
                  var lc = sev.payload.total_lines || 0;
                  state.counters.filesInScope = Math.max(state.counters.filesInScope, fc);
                  state.counters.linesIncluded = Math.max(state.counters.linesIncluded, lc);
                }
                if (sev.type === 'retrieval_completed') {
                  state.counters.filesInScope = Math.max(state.counters.filesInScope, sev.payload.results_count || 0);
                }
                if (sev.type === 'tool_start') {
                  state.counters.toolCallsUsed++;
                }
                if (sev.type === 'diff_applied') {
                  var dfc = (sev.payload.files_changed || []).length;
                  state.counters.filesTouched += dfc;
                }
              }

              // Update mode selector to match the loaded task
              if (modeSelect && message.mode) {
                modeSelect.value = message.mode;
              }

              // Re-render everything
              updateStatus('ready');
              updateStage(state.currentStage);
              renderMission();
              renderLogs();
              renderSystemsCounters();

              console.log('[TaskHistory] Rendered', state.events.length, 'events for task', message.task_id);
              break;

            // Step 52: Keyboard shortcut — focus the prompt input
            case 'ordinex:focusInput':
              console.log('[Step52] Focus input triggered');
              if (promptInput) {
                promptInput.focus();
              }
              break;

            // Step 52: Keyboard shortcut — new chat (clear + focus)
            case 'ordinex:newChat':
              console.log('[Step52] New chat triggered via keyboard shortcut');
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
              updateStatus('ready');
              updateStage('none');
              renderMission();
              renderLogs();
              renderSystemsCounters();
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
              // Notify extension backend
              if (typeof vscode !== 'undefined') {
                vscode.postMessage({ type: 'ordinex:newChat' });
              }
              break;

            // Step 52: Keyboard shortcut — stop execution (Escape)
            case 'ordinex:triggerStop':
              console.log('[Step52] Stop execution triggered via keyboard');
              if (state.taskStatus === 'running') {
                if (typeof vscode !== 'undefined') {
                  vscode.postMessage({ type: 'ordinex:stopExecution' });
                }
                updateStatus('ready');
                if (typeof updateSendStopButton === 'function') {
                  updateSendStopButton();
                }
              }
              break;

            default:
              console.log('Unknown message from backend:', message.type);
          }
        });
      }
  `;
}
