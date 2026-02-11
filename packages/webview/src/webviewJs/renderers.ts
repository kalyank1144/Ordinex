export function getRenderersJs(): string {
  return `
      // ===== APPROVAL CARD RENDERING =====
      function renderApprovalCard(approvalEvent) {
        const approvalId = approvalEvent.payload.approval_id;
        const approvalType = approvalEvent.payload.approval_type;
        const description = approvalEvent.payload.description || '';
        const details = approvalEvent.payload.details || {};
        const riskLevel = approvalEvent.payload.risk_level;

        // Get risk badge
        let riskBadge = '';
        if (riskLevel) {
          const riskColors = {
            low: 'var(--vscode-charts-green)',
            medium: 'var(--vscode-charts-yellow)',
            high: 'var(--vscode-charts-red)'
          };
          const color = riskColors[riskLevel] || 'var(--vscode-charts-orange)';
          riskBadge = \`<div class="risk-badge" style="background: \${color};">\${riskLevel.toUpperCase()}</div>\`;
        } else {
          // Infer risk from approval type
          if (approvalType === 'terminal') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-red);">HIGH</div>';
          } else if (approvalType === 'apply_diff') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-yellow);">MEDIUM</div>';
          } else if (approvalType === 'scope_expansion') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-green);">LOW</div>';
          }
        }

        // Get summary
        let summary = description;
        if (!summary) {
          if (approvalType === 'terminal') {
            const command = details.command || '';
            summary = command ? \`Execute command: \${command}\` : 'Execute terminal command';
          } else if (approvalType === 'apply_diff') {
            const filesChanged = (details.files_changed || []).length;
            summary = \`Apply diff to \${filesChanged} file(s)\`;
          } else if (approvalType === 'scope_expansion') {
            summary = details.reason || 'Expand scope contract';
          } else {
            summary = 'Approval required';
          }
        }

        // Format approval type
        const typeLabels = {
          terminal: 'Terminal Execution',
          apply_diff: 'Apply Diff',
          scope_expansion: 'Scope Expansion'
        };
        const typeLabel = typeLabels[approvalType] || approvalType;

        // Render details
        let detailsHtml = '';
        if (Object.keys(details).length > 0) {
          if (approvalType === 'terminal') {
            detailsHtml = '<div class="approval-details">';
            if (details.command) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Command:</span><code class="detail-value">\${escapeHtml(details.command)}</code></div>\`;
            }
            if (details.working_dir) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Working Dir:</span><code class="detail-value">\${escapeHtml(details.working_dir)}</code></div>\`;
            }
            detailsHtml += '</div>';
          } else if (approvalType === 'apply_diff') {
            detailsHtml = '<div class="approval-details">';
            if (details.files_changed && details.files_changed.length > 0) {
              // FIX: files_changed is an array of objects {path: string}, not strings
              const fileList = details.files_changed.map(f => {
                if (typeof f === 'string') return f;
                if (f && typeof f === 'object' && f.path) return f.path;
                return '[unknown]';
              }).join(', ');
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Files:</span><span class="detail-value">\${fileList}</span></div>\`;
            }
            if (details.additions !== undefined || details.deletions !== undefined) {
              const changes = [];
              if (details.additions !== undefined) changes.push(\`+\${details.additions}\`);
              if (details.deletions !== undefined) changes.push(\`-\${details.deletions}\`);
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Changes:</span><span class="detail-value">\${changes.join(' ')}</span></div>\`;
            }
            detailsHtml += '</div>';
          } else if (approvalType === 'scope_expansion') {
            detailsHtml = '<div class="approval-details">';
            if (details.reason) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Reason:</span><span class="detail-value">\${escapeHtml(details.reason)}</span></div>\`;
            }
            if (details.requested) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Requested:</span><span class="detail-value">\${JSON.stringify(details.requested, null, 2)}</span></div>\`;
            }
            detailsHtml += '</div>';
          }
        }

        const evidenceCount = approvalEvent.evidence_ids.length;
        const evidenceHtml = evidenceCount > 0 
          ? \`<div class="approval-evidence"><span class="evidence-icon">📎</span><span>\${evidenceCount} evidence item(s) available</span></div>\`
          : '';

        return \`
          <div class="approval-card" data-approval-id="\${approvalId}">
            <div class="approval-card-header">
              <div class="approval-card-header-left">
                <span class="approval-icon">⏸️</span>
                <div class="approval-card-title">
                  <div class="approval-type-label">\${typeLabel}</div>
                  <div class="approval-id">ID: \${approvalId.substring(0, 8)}</div>
                </div>
              </div>
              \${riskBadge}
            </div>
            <div class="approval-card-body">
              <div class="approval-summary">\${escapeHtml(summary)}</div>
              \${detailsHtml}
              \${evidenceHtml}
            </div>
            <div class="approval-card-actions">
              <button class="approval-btn approve" onclick="handleApproval('\${approvalId}', 'approved')">
                ✓ Approve
              </button>
              <button class="approval-btn reject" onclick="handleApproval('\${approvalId}', 'rejected')">
                ✗ Reject
              </button>
            </div>
          </div>
        \`;
      }

      function hydrateScaffoldCards() {
        const cards = missionTab.querySelectorAll('scaffold-card[data-event]');
        cards.forEach((card) => {
          try {
            if (!customElements.get('scaffold-card')) {
              return;
            }
            const eventJson = card.getAttribute('data-event');
            if (!eventJson) return;
            card.event = JSON.parse(decodeURIComponent(eventJson));
            card.removeAttribute('data-event');
          } catch (error) {
            console.error('[ScaffoldCard] Failed to parse event data:', error);
          }
        });
      }

      // Render Mission Tab - Event Timeline
      function renderMission() {
        missionTab.innerHTML = renderMissionTimeline(state.events);
        hydrateScaffoldCards();
        updateUIGating(); // Update UI gating whenever mission is rendered
        updateExportButtonVisibility(); // Update export button visibility
        updateMissionControlBar(); // Update compact bottom bar for mission progress
      }

      // Render Streaming Answer Card
      function renderStreamingAnswerCard() {
        if (!state.streamingAnswer || !state.streamingAnswer.text) {
          return '';
        }

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-blue); animation: pulse 1.5s ease-in-out infinite;">
            <div class="event-card-header">
              <span class="event-icon" style="color: var(--vscode-charts-blue);">💬</span>
              <span class="event-type">Streaming Answer</span>
              <span class="event-timestamp">⚡ Live</span>
            </div>
            <div class="streaming-answer-content" style="padding-left: 24px; font-size: 13px; line-height: 1.6; color: var(--vscode-foreground); white-space: pre-wrap; word-break: break-word;">\${escapeHtml(state.streamingAnswer.text)}<span style="display: inline-block; width: 2px; height: 16px; background: var(--vscode-charts-blue); margin-left: 2px; animation: blink 1s steps(2, start) infinite;"></span></div>
          </div>
          <style>
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.7; }
            }
            @keyframes blink {
              to { visibility: hidden; }
            }
          </style>
        \`;
      }

      // R1: Event tier classification — determines visibility in Mission tab
      // 'user' = full card (always visible), 'progress' = collapsible group, 'system' = Logs tab only
      const USER_TIER_EVENTS = new Set([
        'intent_received',
        'plan_created', 'plan_revised',
        'approval_requested', 'approval_resolved',
        'diff_proposed', 'diff_applied',
        'test_completed',
        'failure_detected',
        'decision_point_needed',
        'clarification_presented', 'clarification_received',
        'mission_started', 'mission_completed', 'mission_cancelled', 'mission_paused',
        'scaffold_proposal_created', 'scaffold_completed', 'scaffold_cancelled',
        'scaffold_blocked',
        'process_started', 'process_ready',
        'execution_paused', 'execution_resumed', 'execution_stopped',
        'generated_tool_proposed',
        'task_interrupted',
        'scope_expansion_requested', 'scope_expansion_resolved',
        'next_steps_shown',
        'autonomy_loop_detected',
        'mission_breakdown_created',
        'scaffold_final_complete',
        'plan_large_detected',
        'repeated_failure_detected'
      ]);

      const PROGRESS_TIER_EVENTS = new Set([
        'step_started', 'step_completed', 'step_failed',
        'iteration_started', 'iteration_succeeded', 'iteration_failed',
        'scaffold_apply_started', 'scaffold_applied',
        'scaffold_started',
        'feature_extraction_started', 'feature_extraction_completed',
        'feature_code_generating', 'feature_code_applied', 'feature_code_error',
        'scaffold_verify_started', 'scaffold_verify_step_completed', 'scaffold_verify_completed',
        'scaffold_autofix_started', 'scaffold_autofix_applied', 'scaffold_autofix_failed',
        'scaffold_progress', 'design_pack_applied',
        'command_started', 'command_completed',
        'tool_start', 'tool_end',
        'repair_attempt_started', 'repair_attempt_completed', 'repair_attempted',
        'test_started',
        'verify_started', 'verify_completed', 'verify_proposed',
        'context_collected',
        'retrieval_started', 'retrieval_completed',
        'scaffold_decision_resolved',
        'scaffold_preflight_started', 'scaffold_preflight_completed',
        'scaffold_preflight_checks_started', 'scaffold_preflight_checks_completed',
        'scaffold_quality_gates_passed', 'scaffold_quality_gates_failed',
        'scaffold_apply_completed',
        'scaffold_target_chosen'
      ]);

      function getEventTier(eventType) {
        if (USER_TIER_EVENTS.has(eventType)) return 'user';
        if (PROGRESS_TIER_EVENTS.has(eventType)) return 'progress';
        return 'system';
      }

      // R1: Get a human-readable label for a progress event
      function getProgressLabel(event) {
        const type = event.type;
        const p = event.payload || {};
        switch (type) {
          case 'step_started': return \`Step \${(p.step_index || 0) + 1}: \${p.description || 'processing...'}\`;
          case 'step_completed': return \`Step \${(p.step_index || 0) + 1} \${p.success ? 'completed' : 'failed'}\`;
          case 'step_failed': return \`Step \${(p.step_index || 0) + 1} failed\`;
          case 'iteration_started': return \`Iterating... (attempt \${p.iteration || '?'}\${p.max_iterations ? '/' + p.max_iterations : ''})\`;
          case 'iteration_succeeded': return 'Iteration passed';
          case 'iteration_failed': return \`Attempt \${p.iteration || '?'} failed\${p.reason ? ': ' + String(p.reason).substring(0, 50) : ''}\`;
          case 'scaffold_apply_started': return 'Creating project files...';
          case 'scaffold_applied': return \`\${p.files_created || 0} file(s) created\`;
          case 'scaffold_started': return 'Scaffold starting...';
          case 'feature_extraction_started': return 'Analyzing features...';
          case 'feature_extraction_completed': return \`\${p.features_count || 0} feature(s) detected\`;
          case 'feature_code_generating': return p.message || 'Generating components...';
          case 'feature_code_applied': return \`\${p.total_files || 0} file(s) generated\`;
          case 'feature_code_error': return 'Feature generation skipped';
          case 'scaffold_verify_started': return 'Running verification...';
          case 'scaffold_verify_step_completed': return p.message || \`\${p.step_name}: \${p.step_status}\`;
          case 'scaffold_verify_completed': return \`Verification: \${p.outcome || 'complete'}\`;
          case 'scaffold_autofix_started': return 'Auto-fixing errors...';
          case 'scaffold_autofix_applied': return \`Fixed \${p.files_fixed || 0} file(s)\`;
          case 'scaffold_autofix_failed': return 'Auto-fix failed';
          case 'scaffold_progress': return p.message || p.phase || 'Creating project...';
          case 'design_pack_applied': return \`Design pack applied (\${p.design_pack || p.design_pack_id || 'custom'})\`;
          case 'command_started': return \`Running: \${(p.command || '').substring(0, 50)}\`;
          case 'command_completed': {
            const cmd = (p.command || '').substring(0, 30);
            return \`\${p.exit_code === 0 ? '✓' : '✗'} \${cmd} → exit \${p.exit_code}\`;
          }
          case 'tool_start': return \`\${p.tool || p.tool_name || 'tool'}\${p.target ? ': ' + p.target : ''}\`;
          case 'tool_end': return \`\${p.tool || p.tool_name || 'tool'} finished\`;
          case 'repair_attempt_started': return \`Attempting fix... (attempt \${p.attempt || 1}\${p.max_attempts ? '/' + p.max_attempts : ''})\`;
          case 'repair_attempt_completed': return p.success ? 'Repair successful' : 'Repair failed';
          case 'repair_attempted': return \`Attempting fix\${p.repair_type ? ': ' + p.repair_type : ''}\`;
          case 'test_started': return \`Running tests: \${(p.command || '').substring(0, 40)}\`;
          case 'verify_started': return 'Starting verification...';
          case 'verify_completed': return p.success ? 'Verification passed' : 'Verification failed';
          case 'verify_proposed': return \`\${(p.commands || []).length} verification command(s)\`;
          case 'context_collected': {
            const fc = (p.files_included || []).length;
            return \`Context collected (\${fc} files)\`;
          }
          case 'retrieval_started': return 'Retrieving context...';
          case 'retrieval_completed': return \`\${p.results_count || 0} results found\`;
          case 'scaffold_decision_resolved': return p.decision === 'proceed' ? 'User approved' : 'Decision: ' + (p.decision || '');
          default: return type.replace(/_/g, ' ');
        }
      }

      // R1: Get a summary icon for a progress event
      function getProgressIcon(event) {
        const type = event.type;
        if (type.includes('completed') || type.includes('succeeded') || type.includes('applied') || type === 'retrieval_completed') return '✅';
        if (type.includes('failed') || type.includes('error')) return '❌';
        if (type.includes('started') || type.includes('generating')) return '⏳';
        return '•';
      }

      // R1: Infer a group title from accumulated progress events
      function inferProgressGroupTitle(progressEvents) {
        // Look at the first event to determine the group's context
        const types = progressEvents.map(e => e.type);
        if (types.some(t => t.startsWith('scaffold_verify'))) return 'Verifying project...';
        if (types.some(t => t.startsWith('scaffold_autofix'))) return 'Auto-fixing issues...';
        if (types.some(t => t.startsWith('feature_'))) return 'Generating features...';
        if (types.some(t => t.startsWith('scaffold_'))) return 'Setting up project...';
        if (types.some(t => t.startsWith('iteration_'))) {
          var lastIter = progressEvents.filter(function(e) { return e.type === 'iteration_started' || e.type === 'iteration_failed'; }).pop();
          if (lastIter && lastIter.payload) {
            var iter = lastIter.payload.iteration || '?';
            var maxIter = lastIter.payload.max_iterations;
            return 'Iterating... (attempt ' + iter + (maxIter ? '/' + maxIter : '') + ')';
          }
          return 'Iterating...';
        }
        if (types.some(t => t.startsWith('step_'))) return 'Executing steps...';
        if (types.some(t => t.startsWith('repair_'))) {
          var lastRepair = progressEvents.filter(function(e) { return e.type === 'repair_attempt_started'; }).pop();
          if (lastRepair && lastRepair.payload) {
            var att = lastRepair.payload.attempt || 1;
            var maxAtt = lastRepair.payload.max_attempts;
            return 'Fixing errors... (attempt ' + att + (maxAtt ? '/' + maxAtt : '') + ')';
          }
          return 'Fixing errors...';
        }
        if (types.some(t => t === 'command_started' || t === 'command_completed')) return 'Running commands...';
        if (types.some(t => t === 'tool_start' || t === 'tool_end')) return 'Working...';
        if (types.some(t => t.startsWith('retrieval_') || t === 'context_collected')) return 'Gathering context...';
        if (types.some(t => t.startsWith('test_') || t.startsWith('verify_'))) return 'Running tests...';
        return 'Processing...';
      }

      // R1: Render a collapsible progress group
      // S1/S2: Inline scaffold build/complete card rendering
      const SCAFFOLD_BUILD_EVENTS = new Set([
        'scaffold_apply_started', 'scaffold_applied', 'scaffold_apply_completed',
        'scaffold_progress', 'design_pack_applied',
        'feature_extraction_started', 'feature_extraction_completed',
        'feature_code_generating', 'feature_code_applied', 'feature_code_error',
        'scaffold_verify_started', 'scaffold_verify_step_completed', 'scaffold_verify_completed',
        'scaffold_autofix_started', 'scaffold_autofix_applied', 'scaffold_autofix_failed',
        'scaffold_checkpoint_created'
      ]);

      function isScaffoldBuildEvent(type) { return SCAFFOLD_BUILD_EVENTS.has(type); }

      function renderScaffoldProgressInline(events) {
        const stages = [
          { id: 'create', label: 'Creating project files', status: 'pending', detail: '' },
          { id: 'design', label: 'Applying design system', status: 'pending', detail: '' },
          { id: 'features', label: 'Generating features', status: 'pending', detail: '' },
          { id: 'verify', label: 'Verifying project', status: 'pending', detail: '' }
        ];
        function findS(id) { return stages.find(function(s) { return s.id === id; }); }
        for (var i = 0; i < events.length; i++) {
          var e = events[i], p = e.payload || {};
          switch (e.type) {
            case 'scaffold_apply_started': findS('create').status = 'active'; break;
            case 'scaffold_progress':
              if (p.status === 'creating') findS('create').status = 'active';
              else if (p.status === 'applying_design') { findS('create').status = 'done'; findS('design').status = 'active'; }
              break;
            case 'scaffold_applied': case 'scaffold_apply_completed': findS('create').status = 'done'; break;
            case 'design_pack_applied':
              findS('design').status = 'done';
              if (p.design_pack_name) findS('design').detail = escapeHtml(String(p.design_pack_name));
              break;
            case 'feature_extraction_started': findS('features').status = 'active'; break;
            case 'feature_extraction_completed':
              findS('features').detail = (p.features_count || 0) + ' features';
              break;
            case 'feature_code_generating': findS('features').status = 'active'; break;
            case 'feature_code_applied':
              findS('features').status = 'done';
              if (p.files_created || p.files_count) findS('features').detail = (p.files_created || p.files_count) + ' files';
              break;
            case 'feature_code_error':
              findS('features').status = 'failed';
              findS('features').detail = 'Fell back to generic scaffold';
              break;
            case 'scaffold_verify_started': findS('verify').status = 'active'; break;
            case 'scaffold_verify_completed':
              findS('verify').status = (p.outcome === 'pass' || p.outcome === 'partial') ? 'done' : 'failed';
              findS('verify').detail = (p.pass_count || 0) + ' passed, ' + (p.fail_count || 0) + ' failed';
              break;
            case 'scaffold_autofix_started': findS('verify').detail = 'Auto-fixing...'; break;
          }
        }
        var doneCount = stages.filter(function(s) { return s.status === 'done'; }).length;
        var pct = Math.round((doneCount / 4) * 100);
        var allDone = stages.every(function(s) { return s.status === 'done' || s.status === 'failed' || s.status === 'skipped'; });
        var stageIcons = { pending: '\u25CB', active: '\u23F3', done: '\u2705', failed: '\u274C', skipped: '\u23ED\uFE0F' };
        var stagesHtml = stages.map(function(s) {
          var det = s.detail ? '<span style="margin-left:auto;font-size:11px;color:var(--vscode-descriptionForeground)">' + s.detail + '</span>' : '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;' + (s.status === 'pending' ? 'color:var(--vscode-descriptionForeground)' : '') + '">' +
            '<span style="width:20px;text-align:center">' + stageIcons[s.status] + '</span>' +
            '<span' + (s.status === 'active' ? ' style="font-weight:500"' : '') + '>' + escapeHtml(s.label) + '</span>' +
            det + '</div>';
        }).join('');
        return '<div class="scaffold-progress-card" style="background:var(--vscode-editor-background);border:1px solid ' + (allDone ? 'var(--vscode-testing-iconPassed,#4caf50)' : 'var(--vscode-panel-border,#333)') + ';border-radius:8px;padding:12px 16px;margin:8px 0;font-size:13px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
            '<span style="font-size:18px">' + (allDone ? '\u2705' : '\u{1F3D7}\uFE0F') + '</span>' +
            '<h3 style="flex:1;margin:0;font-size:14px;font-weight:600">' + (allDone ? 'Project Built' : 'Building Project') + '</h3>' +
            '<span style="font-size:12px;color:var(--vscode-descriptionForeground)">' + events.length + ' steps</span>' +
          '</div>' +
          '<div style="height:4px;background:var(--vscode-panel-border,#333);border-radius:2px;overflow:hidden;margin-bottom:12px">' +
            '<div style="height:100%;width:' + pct + '%;background:var(--vscode-progressBar-background,#0078d4);border-radius:2px;transition:width 0.3s"></div>' +
          '</div>' +
          stagesHtml +
        '</div>';
      }

      function renderScaffoldCompleteInline(event, allEvents) {
        var p = event.payload || {};
        var scaffoldId = p.scaffold_id || event.task_id || 'default';
        var success = p.status === 'success' || p.success === true;
        var projectName = (p.project_path || '').split('/').pop() || '';
        // Find verification data
        var verifyEvt = allEvents ? allEvents.find(function(e) { return e.type === 'scaffold_verify_completed'; }) : null;
        var verifyHtml = '';
        if (verifyEvt) {
          var vp = verifyEvt.payload || {};
          var outcome = vp.outcome || 'unknown';
          var icon = outcome === 'pass' ? '\u2705' : outcome === 'partial' ? '\u26A0\uFE0F' : '\u274C';
          var label = outcome === 'pass' ? 'All ' + (vp.pass_count || 0) + ' checks passed' :
            (vp.pass_count || 0) + ' passed, ' + (vp.fail_count || 0) + ' failed';
          var bcolor = outcome === 'pass' ? 'rgba(76,175,80,0.15)' : outcome === 'partial' ? 'rgba(255,152,0,0.15)' : 'rgba(244,67,54,0.15)';
          verifyHtml = '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;font-size:12px;background:' + bcolor + '">' + icon + ' ' + escapeHtml(label) + '</span>';
        }
        // Find next steps
        var nextEvt = allEvents ? allEvents.find(function(e) { return e.type === 'next_steps_shown'; }) : null;
        var actionsHtml = '';
        if (nextEvt && nextEvt.payload) {
          var steps = nextEvt.payload.steps || nextEvt.payload.next_steps || [];
          actionsHtml = steps.map(function(s, i) {
            var cls = i === 0 ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none' : 'background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)';
            return '<button style="padding:6px 14px;border-radius:4px;font-size:13px;cursor:pointer;' + cls + '" onclick="vscode.postMessage({type:\\'next_step_selected\\',scaffold_id:\\'' + escapeHtml(scaffoldId) + '\\',step_id:\\'' + escapeHtml(s.id || s.action || '') + '\\',command:\\'' + escapeHtml(s.command || '') + '\\'})">'+  escapeHtml(s.label || s.title || s.action || '') + '</button>';
          }).join('');
        }
        if (!actionsHtml) {
          actionsHtml = '<button style="padding:6px 14px;border-radius:4px;font-size:13px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none" onclick="vscode.postMessage({type:\\'next_step_selected\\',scaffold_id:\\'' + escapeHtml(scaffoldId) + '\\',step_id:\\'dev_server\\'})">Start Dev Server</button>' +
            '<button style="padding:6px 14px;border-radius:4px;font-size:13px;cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)" onclick="vscode.postMessage({type:\\'next_step_selected\\',scaffold_id:\\'' + escapeHtml(scaffoldId) + '\\',step_id:\\'open_editor\\'})">Open in Editor</button>';
        }
        var designHtml = p.design_pack_applied ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;font-size:12px;background:rgba(156,39,176,0.12)">\u{1F3A8} ' + escapeHtml(p.design_pack_name || 'Design applied') + '</span>' : '';
        return '<div class="scaffold-complete-card" style="background:var(--vscode-editor-background);border:1px solid ' + (success ? 'var(--vscode-testing-iconPassed,#4caf50)' : 'var(--vscode-editorWarning-foreground,#ff9800)') + ';border-radius:8px;padding:16px;margin:8px 0;font-size:13px">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
            '<span style="font-size:24px">' + (success ? '\u2705' : '\u26A0\uFE0F') + '</span>' +
            '<div style="flex:1"><h3 style="margin:0;font-size:16px;font-weight:600">' + (success ? 'Project Ready' : 'Project Created (with warnings)') + '</h3>' +
            (projectName ? '<span style="font-size:12px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family,monospace)">' + escapeHtml(projectName) + '</span>' : '') +
            '</div></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">' + verifyHtml + designHtml + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px">' + actionsHtml + '</div>' +
        '</div>';
      }

      function renderProgressGroup(progressEvents, groupIndex) {
        if (progressEvents.length === 0) return '';
        // S1: Scaffold build events → ScaffoldProgressCard
        if (progressEvents.some(function(e) { return isScaffoldBuildEvent(e.type); })) {
          var scaffoldEvents = progressEvents.filter(function(e) { return isScaffoldBuildEvent(e.type); });
          var otherEvents = progressEvents.filter(function(e) { return !isScaffoldBuildEvent(e.type); });
          var html = renderScaffoldProgressInline(scaffoldEvents);
          // If there are non-scaffold events mixed in, render them as a separate group
          if (otherEvents.length > 0) {
            html += renderProgressGroup(otherEvents, groupIndex + 1000);
          }
          return html;
        }
        // Single progress event — render as a compact one-liner
        if (progressEvents.length === 1) {
          const e = progressEvents[0];
          const icon = getProgressIcon(e);
          const label = getProgressLabel(e);
          return \`
            <div class="progress-group" style="border-left-color: var(--vscode-descriptionForeground);">
              <div class="progress-group-header" style="cursor: default;">
                <span class="progress-group-item-icon">\${icon}</span>
                <span class="progress-group-label">\${escapeHtml(label)}</span>
                <span class="event-timestamp">\${formatTimestamp(e.timestamp)}</span>
              </div>
            </div>
          \`;
        }

        const title = inferProgressGroupTitle(progressEvents);
        const itemsHtml = progressEvents.map(e => {
          const icon = getProgressIcon(e);
          const label = getProgressLabel(e);
          return \`
            <div class="progress-group-item">
              <span class="progress-group-item-icon">\${icon}</span>
              <span class="progress-group-item-text">\${escapeHtml(label)}</span>
            </div>
          \`;
        }).join('');

        return \`
          <div class="progress-group" id="pg-\${groupIndex}">
            <div class="progress-group-header" onclick="toggleProgressGroup(\${groupIndex})">
              <span class="progress-group-toggle">▶</span>
              <span class="progress-group-label">\${escapeHtml(title)}</span>
              <span class="progress-group-count">\${progressEvents.length} events</span>
              <span class="event-timestamp">\${formatTimestamp(progressEvents[0].timestamp)}</span>
            </div>
            <div class="progress-group-details">
              \${itemsHtml}
            </div>
            <div class="progress-group-view-details" onclick="switchToLogsTab()">
              View details in Logs tab
            </div>
          </div>
        \`;
      }

      // R1: Toggle progress group expand/collapse
      window.toggleProgressGroup = function(groupIndex) {
        const el = document.getElementById('pg-' + groupIndex);
        if (el) el.classList.toggle('expanded');
      };

      // R1: Switch to Logs tab
      window.switchToLogsTab = function() {
        const logsTab = document.querySelector('[data-tab="logs"]');
        if (logsTab) logsTab.click();
      };

      // I3: Approval types that have inline buttons in their triggering card
      // These do NOT need a standalone ApprovalCard — suppress both event card + ApprovalCard
      const INLINE_APPROVAL_TYPES = new Set([
        'plan_approval', 'apply_diff', 'diff',
        'generated_tool', 'generated_tool_run', 'scope_expansion'
      ]);

      // Mission Timeline Rendering — R1 tiered
      function renderMissionTimeline(events) {
        if (events.length === 0) {
          return '<div class="mission-empty">No mission yet. Start a conversation to begin.</div>';
        }

        const items = [];
        const pendingApprovals = getPendingApprovals(events);

        // Show pending approvals summary at the top
        if (pendingApprovals.length > 0) {
          items.push(\`<div class="approval-section-header" style="background: var(--vscode-inputValidation-warningBackground); padding: 8px 12px; border-radius: 4px; font-size: 11px; margin-bottom: 12px;">⚠️ \${pendingApprovals.length} Pending Approval(s) - see below in timeline</div>\`);
        }

        let currentStage = 'none';
        let progressBuffer = []; // accumulate consecutive Tier 2 events
        let progressGroupIndex = 0;

        // Flush accumulated progress events as a collapsible group
        function flushProgressBuffer() {
          if (progressBuffer.length > 0) {
            items.push(renderProgressGroup(progressBuffer, progressGroupIndex++));
            progressBuffer = [];
          }
        }

        for (const event of events) {
          // Always skip stream events
          if (event.type === 'stream_delta' || event.type === 'stream_complete') {
            continue;
          }

          const tier = getEventTier(event.type);

          // Tier 3 (system): skip entirely in Mission tab — visible in Logs tab
          if (tier === 'system') {
            // But still track stage changes for stage headers
            if (event.type === 'stage_changed' && event.payload.to) {
              const newStage = event.payload.to;
              if (newStage !== currentStage) {
                flushProgressBuffer();
                items.push(renderStageHeader(newStage));
                currentStage = newStage;
              }
            }
            continue;
          }

          // Tier 2 (progress): accumulate into progress group
          if (tier === 'progress') {
            // Stage changes within progress still get tracked
            if (event.type === 'stage_changed' && event.payload.to) {
              const newStage = event.payload.to;
              if (newStage !== currentStage) {
                flushProgressBuffer();
                items.push(renderStageHeader(newStage));
                currentStage = newStage;
              }
            }
            progressBuffer.push(event);
            continue;
          }

          // Tier 1 (user): flush any pending progress group, then render full card
          flushProgressBuffer();

          // Insert stage header when stage changes (for Tier 1 stage_changed — unlikely but safe)
          if (event.type === 'stage_changed' && event.payload.to) {
            const newStage = event.payload.to;
            if (newStage !== currentStage) {
              items.push(renderStageHeader(newStage));
              currentStage = newStage;
            }
          }

          // I3: Skip rendering approval_requested event card for types handled inline
          if (event.type === 'approval_requested' && INLINE_APPROVAL_TYPES.has(event.payload.approval_type || '')) {
            continue;
          }

          // I3: Skip awaiting_plan_approval pause (redundant, PlanCard handles approval inline)
          if (event.type === 'execution_paused' && event.payload.reason === 'awaiting_plan_approval') {
            continue;
          }

          // I1: Render intent_received as a user chat bubble
          if (event.type === 'intent_received') {
            const prompt = event.payload.prompt || '';
            items.push(\`
              <div class="user-bubble">
                <div class="user-bubble-avatar">U</div>
                <div class="user-bubble-content">\${escapeHtml(prompt)}</div>
              </div>
              <div class="user-bubble-meta">\${formatTimestamp(event.timestamp)}</div>
            \`);
            continue;
          }

          // I2+I3: Render plan_created/plan_revised as assistant bubble wrapping PlanCard
          // I3: If a pending plan_approval exists for this plan, pass approvalId so buttons resolve directly
          if (event.type === 'plan_created' || event.type === 'plan_revised') {
            const planApproval = pendingApprovals.find(p =>
              p.approvalType === 'plan_approval' &&
              p.requestEvent.payload.details && p.requestEvent.payload.details.plan_id === event.event_id
            );
            const cardHtml = planApproval
              ? renderPlanCardWithApproval(event, planApproval.approvalId)
              : renderEventCard(event);
            items.push(\`
              <div class="assistant-bubble">
                <div class="assistant-bubble-avatar">\u2726</div>
                <div class="assistant-bubble-content">\${cardHtml}</div>
              </div>
              <div class="assistant-bubble-meta">\${formatTimestamp(event.timestamp)}</div>
            \`);
            continue;
          }

          // I3: Render diff_proposed with inline Accept/Reject buttons when pending approval exists
          if (event.type === 'diff_proposed') {
            const diffId = event.payload.diff_id || event.payload.proposal_id || '';
            const diffApproval = pendingApprovals.find(p =>
              (p.approvalType === 'apply_diff' || p.approvalType === 'diff') &&
              (!p.requestEvent.payload.details || !p.requestEvent.payload.details.diff_id || p.requestEvent.payload.details.diff_id === diffId)
            );
            const cardHtml = renderEventCard(event);
            if (diffApproval) {
              const approvalButtons = \`
                <div style="display: flex; gap: 8px; margin-top: 8px; padding: 0 12px 10px;">
                  <button class="approval-btn approve" onclick="handleApproval('\${diffApproval.approvalId}', 'approved')">✓ Accept Changes</button>
                  <button class="approval-btn reject" onclick="handleApproval('\${diffApproval.approvalId}', 'rejected')">✗ Reject</button>
                </div>
              \`;
              items.push(cardHtml + approvalButtons);
            } else {
              items.push(cardHtml);
            }
            continue;
          }

          // I5: Intercept test_completed — compact green banner if all pass, expanded card if failures
          if (event.type === 'test_completed') {
            const passed = event.payload.pass_count || event.payload.passed || 0;
            const failed = event.payload.fail_count || event.payload.failed || 0;
            const total = passed + failed;

            if (failed === 0 && total > 0) {
              items.push(\`
                <div class="event-card" style="border-left: 3px solid var(--vscode-charts-green, #4caf50); padding: 10px 14px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--vscode-charts-green, #4caf50); font-size: 16px;">\u2705</span>
                    <span style="font-size: 13px; font-weight: 600; color: var(--vscode-charts-green, #4caf50);">All \${total} test\${total !== 1 ? 's' : ''} passed</span>
                    <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
                  </div>
                </div>
              \`);
              continue;
            }

            if (failed > 0) {
              const failingTests = event.payload.failing_tests || [];
              let failListHtml = '';
              if (failingTests.length > 0) {
                const listItems = failingTests.slice(0, 10).map(function(t) {
                  return '<li style="margin: 2px 0; font-size: 12px; color: var(--vscode-errorForeground, #f44336);">' + escapeHtml(String(t)) + '</li>';
                }).join('');
                failListHtml = '<ul style="margin: 6px 0 0; padding-left: 20px;">' + listItems + '</ul>';
                if (failingTests.length > 10) {
                  failListHtml += '<div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px;">...and ' + (failingTests.length - 10) + ' more</div>';
                }
              }
              items.push(\`
                <div class="event-card" style="border-left: 3px solid var(--vscode-charts-red, #f44336); padding: 12px 14px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                    <span style="font-size: 16px;">\u274C</span>
                    <span style="font-size: 13px; font-weight: 600; color: var(--vscode-charts-red, #f44336);">\${failed} of \${total} test\${total !== 1 ? 's' : ''} failed</span>
                    <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
                  </div>
                  <div style="font-size: 12px; color: var(--vscode-charts-green, #4caf50); margin-bottom: 4px;">\u2713 \${passed} passed</div>
                  \${failListHtml}
                  <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px; font-style: italic;">Check terminal output for full details</div>
                </div>
              \`);
              continue;
            }
            // total === 0 or no data: fall through to generic card
          }

          // Render event card
          items.push(renderEventCard(event));

          // INLINE APPROVAL: After approval_requested event, render inline approval card
          // I3: Only for types NOT handled inline by their triggering card (e.g. terminal)
          if (event.type === 'approval_requested') {
            const approvalId = event.payload.approval_id;
            const approvalType = event.payload.approval_type || '';
            const isPending = pendingApprovals.find(p => p.approvalId === approvalId);
            if (isPending && !INLINE_APPROVAL_TYPES.has(approvalType)) {
              items.push(renderApprovalCard(event));
            }
          }

          // INLINE EXECUTE BUTTON: After execution_paused with reason=awaiting_execute_plan
          if (event.type === 'execution_paused') {
            const reason = event.payload.reason || '';
            if (reason === 'awaiting_execute_plan') {
              items.push(\`
                <div style="margin: 16px 0; padding: 16px; background: var(--vscode-editor-inactiveSelectionBackground); border: 2px solid var(--vscode-charts-green); border-radius: 6px; animation: fadeIn 0.3s ease-in;">
                  <button
                    onclick="handleExecutePlan()"
                    style="
                      width: 100%;
                      padding: 12px 20px;
                      font-size: 14px;
                      font-weight: 700;
                      background: var(--vscode-charts-green);
                      color: #fff;
                      border: none;
                      border-radius: 6px;
                      cursor: pointer;
                      transition: all 0.2s ease;
                      box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
                    "
                    onmouseover="this.style.transform = 'translateY(-2px)'; this.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.5)';"
                    onmouseout="this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 2px 8px rgba(40, 167, 69, 0.3)';"
                  >
                    🚀 Execute Plan
                  </button>
                  <div style="text-align: center; margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
                    ✓ Plan approved - Click to begin execution
                  </div>
                </div>
              \`);
            }
          }

          // I2: Show streaming answer card after tool_start for llm_answer, wrapped in assistant bubble
          if (event.type === 'tool_start' && event.payload.tool === 'llm_answer' && state.streamingAnswer && state.streamingAnswer.text) {
            items.push(\`
              <div class="assistant-bubble">
                <div class="assistant-bubble-avatar">\u2726</div>
                <div class="assistant-bubble-content">\${renderStreamingAnswerCard()}</div>
              </div>
            \`);
          }
        }

        // Flush any remaining progress events
        flushProgressBuffer();

        return items.join('');
      }

      // REMOVED: renderExecutePlanCTA() - Execute Plan button is now ONLY rendered inline after execution_paused event

      // Render Stage Header
      function renderStageHeader(stage) {
        const stageConfig = {
          plan: { title: 'Planning', icon: '📋', color: 'var(--vscode-charts-purple)' },
          retrieve: { title: 'Retrieval', icon: '🔍', color: 'var(--vscode-charts-blue)' },
          edit: { title: 'Editing', icon: '✏️', color: 'var(--vscode-charts-yellow)' },
          test: { title: 'Testing', icon: '🧪', color: 'var(--vscode-charts-green)' },
          repair: { title: 'Repair', icon: '🔧', color: 'var(--vscode-charts-orange)' },
          none: { title: 'Initializing', icon: '⚡', color: 'var(--vscode-descriptionForeground)' }
        };
        const config = stageConfig[stage] || stageConfig.none;
        return \`
          <div class="stage-header">
            <span class="stage-icon" style="color: \${config.color}">\${config.icon}</span>
            <span class="stage-title">\${config.title}</span>
          </div>
        \`;
      }

      // Render Detailed Plan Card
      function renderPlanCard(event, plan) {
        // Render steps
        const stepsHtml = (plan.steps || []).map((step, index) => {
          // Build step metadata (stage, effort)
          const metadata = [];
          if (step.stage) metadata.push(\`Stage: \${step.stage}\`);
          if (step.estimated_effort) metadata.push(\`Effort: \${step.estimated_effort}\`);
          if (step.expected_evidence && Array.isArray(step.expected_evidence)) {
            metadata.push(...step.expected_evidence);
          }
          
          const metadataHtml = metadata.length > 0 
            ? \`<div style="margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground);">
                <ul style="margin: 0; padding-left: 20px;">
                  \${metadata.map(m => \`<li>\${escapeHtml(m)}</li>\`).join('')}
                </ul>
              </div>\`
            : '';
          
          return \`
            <div style="background: var(--vscode-input-background); padding: 10px; border-radius: 4px; margin-bottom: 8px;">
              <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px;">
                <span style="background: var(--vscode-charts-purple); color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700;">\${index + 1}</span>
                <span style="font-size: 12px; font-weight: 600; flex: 1;">\${escapeHtml(step.description || '')}</span>
              </div>
              \${metadataHtml}
            </div>
          \`;
        }).join('');

        // Render assumptions
        const assumptionsHtml = (plan.assumptions && plan.assumptions.length > 0)
          ? \`<div style="margin-top: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--vscode-descriptionForeground); margin-bottom: 6px;">Assumptions</div>
              <ul style="margin: 0; padding-left: 20px; font-size: 12px;">
                \${plan.assumptions.map(a => \`<li>\${escapeHtml(a)}</li>\`).join('')}
              </ul>
            </div>\`
          : '';

        // Render success criteria
        const criteriaText = typeof plan.success_criteria === 'string' ? plan.success_criteria : (plan.success_criteria || []).join(', ');
        const successCriteriaHtml = criteriaText
          ? \`<div style="margin-top: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--vscode-descriptionForeground); margin-bottom: 6px;">Success Criteria</div>
              <div style="font-size: 12px; padding: 8px; background: var(--vscode-input-background); border-radius: 4px;">\${escapeHtml(criteriaText)}</div>
            </div>\`
          : '';

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-purple); padding: 14px;">
            <div class="event-card-header" style="margin-bottom: 12px;">
              <span class="event-icon" style="color: var(--vscode-charts-purple); font-size: 20px;">📋</span>
              <span class="event-type" style="font-size: 13px; font-weight: 700;">Plan Created</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            
            <div style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-charts-purple); margin-bottom: 8px;">Goal</div>
              <div style="font-size: 13px; line-height: 1.5; color: var(--vscode-foreground);">\${escapeHtml(plan.goal || '')}</div>
            </div>

            \${assumptionsHtml}

            <div style="margin-top: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--vscode-descriptionForeground); margin-bottom: 8px;">Implementation Steps (\${(plan.steps || []).length})</div>
              \${stepsHtml}
            </div>

            \${successCriteriaHtml}

            <div style="margin-top: 16px; display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border);">
              <button 
                onclick="handleRequestPlanApproval('\${event.task_id}', '\${event.event_id}')"
                style="flex: 1; padding: 8px 16px; background: var(--vscode-charts-green); color: #fff; border: none; border-radius: 4px; font-size: 12px; font-weight: 700; cursor: pointer;">
                ✓ Approve Plan → Start Mission
              </button>
              <button 
                onclick="toggleRefinePlanInput('\${event.task_id}', '\${event.event_id}', 1)"
                style="padding: 8px 16px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer;">
                ✏️ Refine Plan
              </button>
              <button 
                onclick="handleCancelPlan('\${event.task_id}')"
                style="padding: 8px 16px; background: transparent; color: var(--vscode-descriptionForeground); border: none; font-size: 12px; cursor: pointer; text-decoration: underline;">
                ✕ Cancel
              </button>
            </div>

            <!-- Refine Plan Input (hidden by default) -->
            <div id="refine-plan-input-\${event.event_id}" style="display: none; margin-top: 16px; padding: 16px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0; color: var(--vscode-charts-purple);">Refine This Plan</h4>
                <button onclick="toggleRefinePlanInput('\${event.task_id}', '\${event.event_id}', 1)" style="background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 16px;">✕</button>
              </div>
              <div style="margin-bottom: 12px;">
                <label for="refinement-instruction-\${event.event_id}" style="font-weight: 500; color: var(--vscode-foreground); display: block; margin-bottom: 6px;">What changes would you like?</label>
                <textarea 
                  id="refinement-instruction-\${event.event_id}"
                  placeholder="Examples:
• Add error handling to each step
• Break step 3 into smaller sub-steps
• Add a testing phase before deployment
• Focus more on security considerations"
                  rows="4"
                  style="width: 100%; padding: 8px 12px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; color: var(--vscode-foreground); font-family: inherit; font-size: 12px; resize: vertical;"
                ></textarea>
              </div>
              <div style="display: flex; gap: 8px;">
                <button 
                  onclick="submitPlanRefinement('\${event.task_id}', '\${event.event_id}', 1)"
                  style="flex: 1; padding: 8px 16px; background: var(--vscode-charts-purple); color: #fff; border: none; border-radius: 4px; font-size: 12px; font-weight: 700; cursor: pointer;">
                  🔄 Generate Refined Plan
                </button>
                <button 
                  onclick="toggleRefinePlanInput('\${event.task_id}', '\${event.event_id}', 1)"
                  style="padding: 8px 16px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                  Cancel
                </button>
              </div>
              <p style="margin-top: 10px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
                ℹ️ Refining will generate a new plan version and require re-approval.
              </p>
            </div>

            <div style="margin-top: 10px; padding: 8px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
              💡 Review this plan carefully before switching to MISSION mode to execute.
            </div>
          </div>
        \`;
      }

      // I3: Render PlanCard with inline approval buttons (replaces "Approve Plan" with direct approval resolution)
      function renderPlanCardWithApproval(event, approvalId) {
        var baseHtml = renderPlanCard(event, event.payload);
        // Replace the "Approve Plan" button onclick to resolve the pending approval directly
        baseHtml = baseHtml.replace(
          /onclick="handleRequestPlanApproval\([^)]*\)"/,
          'onclick="handleApproval(\\\'' + approvalId + '\\\', \\\'approved\\\')"'
        );
        // Replace the "Cancel" button to reject the approval
        baseHtml = baseHtml.replace(
          /onclick="handleCancelPlan\([^)]*\)"/,
          'onclick="handleApproval(\\\'' + approvalId + '\\\', \\\'rejected\\\')"'
        );
        // Add a visual indicator that approval is pending
        baseHtml = baseHtml.replace(
          '<span class="event-type" style="font-size: 13px; font-weight: 700;">Plan Created</span>',
          '<span class="event-type" style="font-size: 13px; font-weight: 700;">Plan Created</span><span style="margin-left: 8px; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; background: var(--vscode-charts-orange); color: #fff;">Awaiting Approval</span>'
        );
        return baseHtml;
      }

      // Render Clarification Card (PLAN mode v2)
      function renderClarificationCard(event) {
        const taskId = event.task_id;
        const options = event.payload.options || [];
        const anchorFilesCount = event.payload.anchor_files_count || 0;
        const fallbackOptionId = event.payload.fallback_option_id || 'fallback-suggest';

        // Build header text based on context quality
        const headerText = anchorFilesCount > 0
          ? \`Based on your project structure • \${anchorFilesCount} relevant files found\`
          : 'Based on project analysis • Limited context available';

        // Build option buttons HTML
        const optionsHtml = options.map(opt => {
          const evidenceText = (opt.evidence || []).length > 0
            ? opt.evidence.slice(0, 3).join(', ')
            : '';
          
          const isSkip = opt.id === fallbackOptionId || opt.id === 'fallback-suggest';
          const buttonClass = isSkip ? 'clarification-btn skip-btn' : 'clarification-btn';
          
          return \`
            <button 
              class="\${buttonClass}" 
              data-option-id="\${escapeHtml(opt.id)}"
              data-task-id="\${escapeHtml(taskId)}"
              onclick="handleClarificationSelect('\${escapeHtml(taskId)}', '\${escapeHtml(opt.id)}')"
            >
              <div class="clarification-btn-content">
                <span class="clarification-btn-title">\${escapeHtml(opt.title)}</span>
                <span class="clarification-btn-desc">\${escapeHtml(opt.description)}</span>
                \${evidenceText ? \`<span class="clarification-btn-evidence">\${escapeHtml(evidenceText)}</span>\` : ''}
              </div>
              <span class="clarification-btn-spinner" style="display: none;">⏳</span>
            </button>
          \`;
        }).join('');

        return \`
          <div class="clarification-card" id="clarification-card-\${escapeHtml(taskId)}" data-state="idle">
            <div class="clarification-card-header">
              <span class="clarification-icon">🎯</span>
              <span class="clarification-title">Choose a Focus Area</span>
            </div>
            <div class="clarification-card-subtitle">
              \${escapeHtml(headerText)}
            </div>
            <div class="clarification-options">
              \${optionsHtml}
            </div>
            <div class="clarification-skip">
              <button 
                class="clarification-skip-link" 
                onclick="handleClarificationSkip('\${escapeHtml(taskId)}')"
              >
                Skip and let me suggest ideas →
              </button>
            </div>
            <div class="clarification-processing" style="display: none;">
              <span class="processing-spinner">⏳</span>
              <span class="processing-text">Generating plan...</span>
            </div>
          </div>
        \`;
      }

      // ===== MISSION BREAKDOWN CARD RENDERERS =====
      // Render Large Plan Detected explanation card
      function renderLargePlanDetectedCard(event) {
        const taskId = event.task_id;
        const reasons = event.payload.reasons || [];
        const metrics = event.payload.metrics || {};
        const stepCount = metrics.stepCount || 0;
        const riskFlags = metrics.riskFlags || [];
        const domains = metrics.domains || [];

        // Build reasons list
        const reasonsHtml = reasons.map(r => \`<li>\${escapeHtml(r)}</li>\`).join('');

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-orange); padding: 16px; background: var(--vscode-inputValidation-warningBackground);">
            <div class="event-card-header" style="margin-bottom: 12px;">
              <span class="event-icon" style="color: var(--vscode-charts-orange); font-size: 20px;">⚠️</span>
              <span class="event-type" style="font-size: 14px; font-weight: 700;">Large Plan Detected</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            
            <div style="background: var(--vscode-editor-background); padding: 12px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid var(--vscode-charts-orange);">
              \${reasons.length > 0 ? \`
                <ul style="margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.6;">
                  \${reasonsHtml}
                </ul>
              \` : '<p style="margin: 0; font-size: 12px;">Plan complexity exceeds safe execution threshold.</p>'}
            </div>

            <div style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 14px; border-radius: 6px; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                <span style="font-size: 16px;">💡</span>
                <span style="font-size: 12px; font-weight: 700; color: var(--vscode-charts-orange);">Why Mission Breakdown?</span>
              </div>
              <div style="font-size: 12px; line-height: 1.6; color: var(--vscode-descriptionForeground);">
                <p style="margin: 0 0 8px 0;">
                  Your plan has <strong>\${stepCount} steps</strong>\${domains.length > 0 ? ' spanning <strong>' + domains.join(', ') + '</strong>' : ''}. 
                  Executing all at once increases the risk of failures that are hard to debug.
                </p>
                <p style="margin: 0 0 8px 0;">
                  We'll group your steps into focused missions that can be executed and verified one at a time:
                </p>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>✓ Each mission is small enough to review carefully</li>
                  <li>✓ You can verify each works before moving on</li>
                  <li>✓ If something fails, you know exactly which mission caused it</li>
                </ul>
                <p style="margin: 10px 0 0 0; font-style: italic;">
                  Your original steps are preserved – just organized into safer execution chunks.
                </p>
              </div>
            </div>

            <div style="text-align: center; padding: 8px; font-size: 11px; color: var(--vscode-descriptionForeground);">
              ⏳ Generating mission breakdown...
            </div>
          </div>
        \`;
      }

      // Render Mission Breakdown interactive selection card
      function renderMissionBreakdownCard(event, events) {
        const taskId = event.task_id;
        const missions = event.payload.missions || [];
        const planStepCount = event.payload.plan_step_count || 0;
        
        // Check if a mission has already been selected
        const selectedMissionEvent = events.find(e => e.type === 'mission_selected');
        const selectedMissionId = selectedMissionEvent?.payload?.mission_id;

        // Determine first mission (recommended) - usually lowest dependency count
        const recommendedMissionId = missions.length > 0 ? missions[0].missionId : null;

        // Build missions HTML
        const missionsHtml = missions.map((mission, idx) => {
          const isRecommended = mission.missionId === recommendedMissionId && idx === 0;
          const isSelected = mission.missionId === selectedMissionId;
          
          // Size badge color
          const sizeColors = { S: 'var(--vscode-charts-green)', M: 'var(--vscode-charts-yellow)', L: 'var(--vscode-charts-orange)' };
          const sizeColor = sizeColors[mission.estimate?.size] || 'var(--vscode-descriptionForeground)';
          
          // Risk badge color
          const riskColors = { low: 'var(--vscode-charts-green)', med: 'var(--vscode-charts-yellow)', high: 'var(--vscode-charts-red)' };
          const riskColor = riskColors[mission.risk?.level] || 'var(--vscode-descriptionForeground)';

          // Included steps summary
          const stepsText = (mission.includedSteps || []).map(s => s.title || s.stepId || 'Step').slice(0, 3).join(', ');
          const stepsOverflow = (mission.includedSteps || []).length > 3 ? \` (+\${mission.includedSteps.length - 3} more)\` : '';

          return \`
            <div style="
              background: \${isSelected ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-editor-background)'};
              border: 2px solid \${isSelected ? 'var(--vscode-charts-green)' : 'var(--vscode-panel-border)'};
              border-radius: 8px;
              padding: 12px;
              margin-bottom: 10px;
              \${isSelected ? 'box-shadow: 0 0 8px rgba(40, 167, 69, 0.3);' : ''}
            ">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 16px;">\${idx === 0 ? '🔐' : idx === 1 ? '💪' : idx === 2 ? '📊' : '🎯'}</span>
                  <span style="font-size: 13px; font-weight: 700; color: var(--vscode-foreground);">\${escapeHtml(mission.title || 'Mission ' + (idx + 1))}</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <span style="padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; background: \${sizeColor}; color: #fff;">\${mission.estimate?.size || 'M'}</span>
                  <span style="padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; background: \${riskColor}; color: #fff;">\${(mission.risk?.level || 'med').toUpperCase()}</span>
                </div>
              </div>
              
              <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; line-height: 1.4;">
                \${escapeHtml(mission.intent || '')}
              </div>

              <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 10px;">
                <strong>Includes:</strong> \${escapeHtml(stepsText)}\${stepsOverflow}
              </div>

              \${isSelected ? \`
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px;">
                  <span style="color: var(--vscode-charts-green);">✅</span>
                  <span style="font-size: 11px; font-weight: 600; color: var(--vscode-charts-green);">Selected</span>
                </div>
              \` : \`
                <button 
                  onclick="handleSelectMission('\${taskId}', '\${mission.missionId}')"
                  style="
                    width: 100%;
                    padding: 8px 16px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s ease;
                  "
                  onmouseover="this.style.background = 'var(--vscode-button-hoverBackground)'"
                  onmouseout="this.style.background = 'var(--vscode-button-background)'"
                >
                  🚀 Select This Mission
                </button>
              \`}

              \${isRecommended && !isSelected ? \`
                <div style="margin-top: 8px; font-size: 10px; color: var(--vscode-charts-green); font-style: italic;">
                  ⭐ Recommended: Foundation for other missions
                </div>
              \` : ''}
            </div>
          \`;
        }).join('');

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-purple); padding: 16px;">
            <div class="event-card-header" style="margin-bottom: 12px;">
              <span class="event-icon" style="color: var(--vscode-charts-purple); font-size: 20px;">🎯</span>
              <span class="event-type" style="font-size: 14px; font-weight: 700;">Mission Breakdown</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            
            <div style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <p style="margin: 0; font-size: 12px; color: var(--vscode-foreground);">
                Your \${planStepCount} steps have been organized into <strong>\${missions.length} focused missions</strong>.
                \${selectedMissionId ? '' : 'Select <strong>ONE mission</strong> to execute:'}
              </p>
            </div>

            <div style="max-height: 400px; overflow-y: auto; padding-right: 8px;">
              \${missionsHtml}
            </div>

            \${!selectedMissionId ? \`
              <div style="margin-top: 12px; padding: 10px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px; font-size: 11px; color: var(--vscode-descriptionForeground);">
                📝 After completing a mission, come back to select the next one.
              </div>
            \` : ''}
          </div>
        \`;
      }

      // Render Start Mission button after selection
      function renderStartMissionButton(selectedMissionEvent, breakdownEvent, taskId) {
        if (!selectedMissionEvent || !breakdownEvent) return '';

        const selectedMissionId = selectedMissionEvent.payload.mission_id;
        const missions = breakdownEvent.payload.missions || [];
        const selectedMission = missions.find(m => m.missionId === selectedMissionId);

        if (!selectedMission) return '';

        return \`
          <div style="margin: 16px 0; padding: 16px; background: var(--vscode-editor-inactiveSelectionBackground); border: 2px solid var(--vscode-charts-green); border-radius: 6px; animation: fadeIn 0.3s ease-in;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <span style="font-size: 18px;">✅</span>
              <span style="font-size: 13px; font-weight: 700; color: var(--vscode-charts-green);">Mission Selected: \${escapeHtml(selectedMission.title)}</span>
            </div>
            <button 
              onclick="handleStartMission('\${taskId}', '\${selectedMissionId}')" 
              style="
                width: 100%; 
                padding: 12px 20px; 
                font-size: 14px; 
                font-weight: 700; 
                background: var(--vscode-charts-green); 
                color: #fff; 
                border: none; 
                border-radius: 6px; 
                cursor: pointer; 
                transition: all 0.2s ease; 
                box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
              " 
              onmouseover="this.style.transform = 'translateY(-2px)'; this.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.5)';" 
              onmouseout="this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 2px 8px rgba(40, 167, 69, 0.3)';"
            >
              🚀 Start Mission: \${escapeHtml(selectedMission.title)}
            </button>
            <div style="text-align: center; margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
              This will execute \${(selectedMission.includedSteps || []).length} step(s). Other missions remain queued.
            </div>
          </div>
        \`;
      }

      // Render Event Card
      function renderEventCard(event) {
        // S2: Scaffold Complete Card — intercept before old ScaffoldCard
        if (event.type === 'scaffold_final_complete') {
          return renderScaffoldCompleteInline(event, state.events);
        }
        if (event.type === 'next_steps_shown') {
          // Consumed by renderScaffoldCompleteInline via allEvents lookup — skip standalone render
          return '';
        }

        // SCAFFOLD EVENTS: Use ScaffoldCard web component (PRIORITY CHECK)
        // Events still handled by ScaffoldCard web component (pre-build UI flow)
        // S1/S2 events are handled above (progress groups + scaffold_final_complete/next_steps_shown)
        const scaffoldEventTypes = [
          'scaffold_started',
          'scaffold_preflight_started',
          'scaffold_preflight_completed',
          'scaffold_target_chosen',
          'scaffold_proposal_created',
          'scaffold_decision_requested',
          'scaffold_decision_resolved',
          'scaffold_apply_started',
          'scaffold_applied',
          'scaffold_style_selection_requested',
          'scaffold_style_selected',
          'scaffold_blocked',
          'scaffold_completed',
          'scaffold_cancelled',
          // Step 43: Preflight checks events
          'scaffold_preflight_checks_started',
          'scaffold_preflight_checks_completed',
          'scaffold_preflight_resolution_selected',
          'scaffold_quality_gates_passed',
          'scaffold_quality_gates_failed',
          'scaffold_checkpoint_created',
          'scaffold_checkpoint_restored',
          'scaffold_apply_completed',
        ];
        
        if (scaffoldEventTypes.includes(event.type)) {
          // Use the ScaffoldCard custom element (already defined globally in ScaffoldCard.ts)
          const eventId = event.event_id || 'evt_' + Date.now();
          const cardId = 'scaffold-' + escapeHtml(eventId);
          const eventJson = encodeURIComponent(JSON.stringify(event));

          // Attach event JSON as a data attribute to avoid inline scripts in HTML.
          // Use double quotes for the attribute value to avoid template literal issues
          return '<scaffold-card id="' + cardId + '" data-event="' + eventJson + '"></scaffold-card>';
        }
        
        // Special handling for clarification_presented - render interactive card
        if (event.type === 'clarification_presented') {
          return renderClarificationCard(event);
        }

        // Special handling for clarification_received - simple confirmation
        if (event.type === 'clarification_received') {
          const title = event.payload.title || 'Selection made';
          return \`
            <div class="event-card" style="border-left-color: var(--vscode-charts-green);">
              <div class="event-card-header">
                <span class="event-icon" style="color: var(--vscode-charts-green);">✅</span>
                <span class="event-type">Focus Selected</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">\${escapeHtml(title)}</div>
            </div>
          \`;
        }

        // Special handling for decision_point_needed - render action buttons
        if (event.type === 'decision_point_needed') {
          return renderDecisionPointCard(event);
        }

        // Special handling for plan_large_detected - render explanation card
        if (event.type === 'plan_large_detected') {
          return renderLargePlanDetectedCard(event);
        }

        // Special handling for mission_breakdown_created - render interactive selection card
        if (event.type === 'mission_breakdown_created') {
          return renderMissionBreakdownCard(event, state.events);
        }

        // Special handling for plan_created and plan_revised - render detailed PlanCard
        if (event.type === 'plan_created' || event.type === 'plan_revised') {
          console.log('🔍 [PLAN DEBUG] plan_created event detected!');
          console.log('🔍 [PLAN DEBUG] event.payload:', JSON.stringify(event.payload, null, 2));
          const plan = event.payload;
          console.log('🔍 [PLAN DEBUG] plan object:', plan);
          console.log('🔍 [PLAN DEBUG] plan.goal:', plan?.goal);
          console.log('🔍 [PLAN DEBUG] plan.steps:', plan?.steps);
          console.log('🔍 [PLAN DEBUG] Array.isArray(plan.steps):', Array.isArray(plan?.steps));
          
          if (plan && plan.goal && plan.steps && Array.isArray(plan.steps)) {
            console.log('✅ [PLAN DEBUG] Condition passed! Rendering detailed PlanCard');
            return renderPlanCard(event, plan);
          } else {
            console.log('❌ [PLAN DEBUG] Condition FAILED! Rendering simple card');
            console.log('❌ [PLAN DEBUG] Condition check: plan exists?', !!plan, 'has goal?', !!plan?.goal, 'has steps?', !!plan?.steps, 'is array?', Array.isArray(plan?.steps));
          }
        }

        const config = getEventCardConfig(event.type);
        if (!config) {
          return \`
            <div class="event-card">
              <div class="event-card-header">
                <span class="event-icon">❓</span>
                <span class="event-type">\${event.type}</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">Unknown event type</div>
            </div>
          \`;
        }

        const summary = config.getSummary(event);
        const hasEvidence = event.evidence_ids.length > 0;
        const isApproval = event.type === 'approval_requested';
        const isFailure = event.type.includes('fail') || event.type === 'failure_detected';

        return \`
          <div class="event-card \${isApproval ? 'approval-required' : ''} \${isFailure ? 'failure' : ''}">
            <div class="event-card-header">
              <span class="event-icon" style="color: \${config.color}">\${config.icon}</span>
              <span class="event-type">\${config.title}</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            <div class="event-summary">\${escapeHtml(summary)}</div>
            \${hasEvidence ? \`<div class="event-evidence">📎 \${event.evidence_ids.length} evidence item(s)</div>\` : ''}
          </div>
        \`;
      }

      function renderDecisionPointCard(event) {
        const title = event.payload.title || 'Decision Needed';
        const description = event.payload.description || event.payload.reason || 'Choose an action to continue.';
        const rawOptions = event.payload.options || [];
        const decisionId = event.event_id;
        const taskId = event.task_id;

        const options = rawOptions.map(option => {
          if (typeof option === 'string') {
            return { label: option, action: option, description: '' };
          }
          return {
            label: option.label || option.action || 'Choose',
            action: option.action || option.label || '',
            description: option.description || ''
          };
        });

        const actionsHtml = options.length > 0
          ? options.map(option => {
              return \`
                <button class="approval-btn approve" onclick="handleDecisionPoint('\${escapeJsString(taskId)}', '\${escapeJsString(decisionId)}', '\${escapeJsString(option.action || '')}')">
                  \${escapeHtml(option.label)}
                </button>
              \`;
            }).join('')
          : \`
            <button class="approval-btn approve" onclick="handleDecisionPoint('\${escapeJsString(taskId)}', '\${escapeJsString(decisionId)}', 'continue')">
              Continue
            </button>
          \`;

        const descriptionsHtml = options.some(o => o.description)
          ? \`
            <div class="approval-details">
              \${options.map(o => o.description ? \`<div class="detail-row"><span class="detail-label">\${escapeHtml(o.label)}:</span><span class="detail-value">\${escapeHtml(o.description)}</span></div>\` : '').join('')}
            </div>
          \`
          : '';

        return \`
          <div class="approval-card" data-decision-id="\${escapeHtml(decisionId)}">
            <div class="approval-card-header">
              <div class="approval-card-header-left">
                <span class="approval-icon">🤔</span>
                <div class="approval-card-title">
                  <div class="approval-type-label">\${escapeHtml(title)}</div>
                  <div class="approval-id">ID: \${escapeHtml(String(decisionId).substring(0, 8))}</div>
                </div>
              </div>
            </div>
            <div class="approval-card-body">
              <div class="approval-summary">\${escapeHtml(description)}</div>
              \${descriptionsHtml}
            </div>
            <div class="approval-card-actions">
              \${actionsHtml}
            </div>
          </div>
        \`;
      }

      // Get Event Card Configuration
      function getEventCardConfig(type) {
        const eventCardMap = {
          intent_received: {
            icon: '💬',
            title: 'Intent Received',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => e.payload.prompt || 'User intent captured'
          },
          mode_set: {
            icon: '⚙️',
            title: 'Mode Set',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => \`Mode: \${e.payload.mode || e.mode}\`
          },
          model_fallback_used: {
            icon: '🔄',
            title: 'Model Fallback',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const requested = e.payload.requested_model || e.payload.userSelectedModel || 'unknown';
              const fallback = e.payload.fallback_model || e.payload.actualModel || 'used fallback';
              // If we don't have fallback but have actualModel, show that
              if (!e.payload.fallback_model && e.payload.actualModel) {
                return \`Using: \${fallback}\`;
              }
              return \`\${requested} → \${fallback}\`;
            }
          },
          prompt_assessed: {
            icon: '🔍',
            title: 'Prompt Assessed',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const clarity = e.payload.clarity || 'unknown';
              const intent = e.payload.intent || e.payload.detected_intent || 'plan_like';
              const score = e.payload.clarity_score;
              return \`Clarity: \${clarity}\${score !== undefined ? ' (' + score + ')' : ''} | Intent: \${intent}\`;
            }
          },
          clarification_requested: {
            icon: '❓',
            title: 'Clarification Requested',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const questions = e.payload.questions || [];
              const missingInfo = e.payload.missing_info || [];
              if (questions.length > 0) {
                return \`\${questions.length} question(s) - please provide more details\`;
              }
              if (missingInfo.length > 0) {
                return \`Missing: \${missingInfo.join(', ')}\`;
              }
              return 'Please provide more details';
            }
          },
          clarification_received: {
            icon: '✅',
            title: 'Clarification Received',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.clarification || 'User provided clarification'
          },
          plan_created: {
            icon: '📋',
            title: 'Plan Created',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const steps = e.payload.steps || [];
              const criteria = e.payload.success_criteria;
              return \`\${steps.length} steps\${criteria ? ' | ' + criteria : ''}\`;
            }
          },
          stage_changed: {
            icon: '🔄',
            title: 'Stage Changed',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`\${e.payload.from || 'none'} → \${e.payload.to || e.stage}\`
          },
          final: {
            icon: '✅',
            title: 'Mission Complete',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => (e.payload.success ? '✓ Success' : '✗ Failed')
          },
          retrieval_started: {
            icon: '🔍',
            title: 'Retrieving Context',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const query = e.payload.query;
              return query ? \`Query: \${query.substring(0, 60)}...\` : 'Context retrieval started';
            }
          },
          retrieval_completed: {
            icon: '📄',
            title: 'Context Retrieved',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const count = e.payload.results_count;
              return count ? \`\${count} results found\` : 'Retrieval complete';
            }
          },
          tool_start: {
            icon: '🔧',
            title: 'Tool Started',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const tool = e.payload.tool || e.payload.tool_name || 'unknown';
              const model = e.payload.model;
              const hasContext = e.payload.has_context;
              
              if (tool === 'llm_answer') {
                const humanModel = model ? humanizeModelName(model) : '';
                return \`Answering (\${humanModel || 'LLM'})\${hasContext ? ' · Project-aware' : ''}\`;
              }
              
              const target = e.payload.target;
              return \`\${tool}\${target ? ': ' + target : ''}\`;
            }
          },
          tool_end: {
            icon: '✓',
            title: 'Tool Finished',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const tool = e.payload.tool || e.payload.tool_name || 'unknown';
              const duration = e.payload.duration_ms;
              const success = e.payload.success !== false;
              
              if (tool === 'llm_answer') {
                return \`Answer \${success ? 'completed' : 'failed'}\${duration ? ' (' + Math.round(duration / 1000) + 's)' : ''}\`;
              }
              
              return \`\${tool}\${duration ? ' (' + duration + 'ms)' : ''}\`;
            }
          },
          approval_requested: {
            icon: '⏸️',
            title: 'Approval Required',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const type = e.payload.approval_type || 'action';
              return \`Type: \${type}\`;
            }
          },
          approval_resolved: {
            icon: '▶️',
            title: 'Approval Resolved',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => (e.payload.approved ? '✓ Approved' : '✗ Denied')
          },
          diff_proposed: {
            icon: '📝',
            title: 'Diff Proposed',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const files = e.payload.files_changed || [];
              return \`\${files.length} file(s) to be modified\`;
            }
          },
          checkpoint_created: {
            icon: '💾',
            title: 'Checkpoint Created',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const id = e.payload.checkpoint_id || 'unknown';
              return \`ID: \${id.substring(0, 8)}\`;
            }
          },
          diff_applied: {
            icon: '✅',
            title: 'Diff Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const files = e.payload.files_changed || [];
              const success = e.payload.success !== false;
              return \`\${success ? '✓' : '✗'} \${files.length} file(s) modified\`;
            }
          },
          failure_detected: {
            icon: '❌',
            title: 'Failure Detected',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.error || 'Error occurred'
          },
          execution_paused: {
            icon: '⏸️',
            title: 'Execution Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Paused'
          },
          execution_resumed: {
            icon: '▶️',
            title: 'Execution Resumed',
            color: 'var(--vscode-charts-green)',
            getSummary: () => 'Continuing execution'
          },
          scope_expansion_requested: {
            icon: '🔓',
            title: 'Scope Expansion Requested',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Scope expansion needed'
          },
          scope_expansion_resolved: {
            icon: '🔒',
            title: 'Scope Expansion Resolved',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => (e.payload.approved ? '✓ Approved' : '✗ Denied')
          },
          context_collected: {
            icon: '📚',
            title: 'Project Context Collected',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              // Check if this is PLAN mode light context
              if (e.payload.level === 'light') {
                const filesScanned = e.payload.files_scanned || 0;
                const anchorFiles = (e.payload.anchor_files || []).length;
                const stack = e.payload.stack || 'unknown';
                const todoCount = e.payload.todo_count;
                return \`\${filesScanned} files scanned, \${anchorFiles} anchor files\${stack !== 'unknown' ? ' | Stack: ' + stack : ''}\${todoCount ? ' | TODOs: ' + todoCount : ''}\`;
              }
              // ANSWER mode context
              const filesCount = (e.payload.files_included || []).length;
              const totalLines = e.payload.total_lines || 0;
              const stack = (e.payload.inferred_stack || []).join(', ');
              return \`\${filesCount} files, \${totalLines} lines\${stack ? ' | Stack: ' + stack : ''}\`;
            }
          },
          mission_started: {
            icon: '🚀',
            title: 'Mission Started',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const stepsCount = e.payload.steps_count || 0;
              const goal = e.payload.goal || '';
              return \`\${stepsCount} steps | \${goal}\`;
            }
          },
          step_started: {
            icon: '▶️',
            title: 'Step Started',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const stepIndex = e.payload.step_index || 0;
              const description = e.payload.description || '';
              return \`Step \${stepIndex + 1}: \${description}\`;
            }
          },
          step_completed: {
            icon: '✅',
            title: 'Step Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const success = e.payload.success !== false;
              const stepIndex = e.payload.step_index || 0;
              return \`Step \${stepIndex + 1} \${success ? 'completed successfully' : 'failed'}\`;
            }
          },
          step_failed: {
            icon: '❌',
            title: 'Step Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const stepIndex = e.payload.step_index || 0;
              const error = e.payload.error || 'Step execution failed';
              return \`Step \${stepIndex + 1}: \${error.substring(0, 50)}\`;
            }
          },
          clarification_presented: {
            icon: '🎯',
            title: 'Choose Focus Area',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const options = (e.payload.options || []);
              return \`\${options.length} options available\`;
            }
          },
          clarification_received: {
            icon: '✅',
            title: 'Focus Selected',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.title || 'Selection made'
          },
          plan_revised: {
            icon: '🔄',
            title: 'Plan Revised',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const version = e.payload.plan_version || 2;
              const steps = e.payload.steps || [];
              return \`v\${version} • \${steps.length} steps\`;
            }
          },
          plan_large_detected: {
            icon: '⚠️',
            title: 'Large Plan Detected',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const score = e.payload.score || 0;
              const reasons = e.payload.reasons || [];
              return \`Score: \${score}/100 • \${reasons.length > 0 ? reasons[0] : 'Requires mission breakdown'}\`;
            }
          },
          mission_breakdown_created: {
            icon: '🎯',
            title: 'Mission Breakdown Created',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const missions = e.payload.missions || [];
              return \`\${missions.length} missions generated\`;
            }
          },
          mission_selected: {
            icon: '✅',
            title: 'Mission Selected',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const missionId = e.payload.mission_id || 'unknown';
              return \`Mission: \${missionId.substring(0, 8)}...\`;
            }
          },
          // Step 30: Truncation-Safe Edit Execution Events
          preflight_complete: {
            icon: '✈️',
            title: 'Preflight Complete',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const splitNeeded = e.payload.split_needed;
              const files = (e.payload.target_files || []).length;
              return splitNeeded ? \`Split mode: \${files} files\` : 'Single-call mode';
            }
          },
          truncation_detected: {
            icon: '⚠️',
            title: 'Truncation Detected',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const recovered = e.payload.recovered;
              return recovered ? 'Output truncated (will retry)' : 'Output truncated (recovery failed)';
            }
          },
          edit_split_triggered: {
            icon: '✂️',
            title: 'Split Mode',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const files = (e.payload.files || []).length;
              return \`Processing \${files} file(s) separately\`;
            }
          },
          edit_chunk_started: {
            icon: '📝',
            title: 'Editing File',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const file = e.payload.file || 'unknown';
              const index = e.payload.chunk_index;
              const total = e.payload.total_chunks;
              return \`\${file} (\${index + 1}/\${total})\`;
            }
          },
          edit_chunk_completed: {
            icon: '✅',
            title: 'File Edited',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.file || 'unknown'
          },
          edit_chunk_failed: {
            icon: '❌',
            title: 'Edit Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const file = e.payload.file || 'unknown';
              const error = e.payload.error || '';
              return \`\${file}: \${error.substring(0, 30)}...\`;
            }
          },
          edit_step_paused: {
            icon: '⏸️',
            title: 'Edit Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'awaiting decision'
          },
          // Step 27: Mission Execution Harness Events
          stale_context_detected: {
            icon: '⚠️',
            title: 'Stale Context',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const files = (e.payload.stale_files || []).length;
              return files > 0 ? \`\${files} file(s) changed\` : 'Context may be outdated';
            }
          },
          stage_timeout: {
            icon: '⏱️',
            title: 'Stage Timeout',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const stage = e.payload.stage || 'unknown';
              const duration = e.payload.duration_ms;
              return \`\${stage}\${duration ? ' (' + Math.round(duration/1000) + 's)' : ''}\`;
            }
          },
          repair_attempt_started: {
            icon: '🔧',
            title: 'Repair Started',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`Attempt #\${e.payload.attempt || 1}\`
          },
          repair_attempt_completed: {
            icon: '✓',
            title: 'Repair Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.success ? 'Repair successful' : 'Repair failed'
          },
          repeated_failure_detected: {
            icon: '🔴',
            title: 'Repeated Failure',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => \`\${e.payload.failure_count || 0} consecutive failures\`
          },
          test_started: {
            icon: '🧪',
            title: 'Test Started',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const command = e.payload.command || '';
              return command.length > 40 ? command.substring(0, 40) + '...' : command || 'Running tests';
            }
          },
          test_completed: {
            icon: '✅',
            title: 'Test Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => \`\${e.payload.passed || 0} passed, \${e.payload.failed || 0} failed\`
          },
          test_failed: {
            icon: '❌',
            title: 'Test Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const error = e.payload.error || '';
              return error.length > 50 ? error.substring(0, 50) + '...' : error || 'Tests failed';
            }
          },
          mission_completed: {
            icon: '🎉',
            title: 'Mission Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.success ? '✓ Mission successful' : '✗ Mission failed'
          },
          mission_paused: {
            icon: '⏸️',
            title: 'Mission Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Mission paused'
          },
          mission_cancelled: {
            icon: '⛔',
            title: 'Mission Cancelled',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.reason || 'Mission cancelled'
          },
          // Step 28: Self-Correction Loop Events
          failure_classified: {
            icon: '🔍',
            title: 'Failure Classified',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`Type: \${e.payload.classification || 'unknown'}\`
          },
          decision_point_needed: {
            icon: '🤔',
            title: 'Decision Needed',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => \`\${(e.payload.options || []).length} option(s) available\`
          },
          // Command Execution Events (Step 34.5)
          command_proposed: {
            icon: '💻',
            title: 'Command Proposed',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const cmds = e.payload.commands || [];
              if (cmds.length === 0) return 'No commands proposed';
              const first = cmds[0]?.command || cmds[0] || '';
              return cmds.length === 1 ? first : \`\${cmds.length} commands proposed\`;
            }
          },
          command_started: {
            icon: '▶️',
            title: 'Command Started',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const cmd = e.payload.command || '';
              return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd || 'Running command';
            }
          },
          command_progress: {
            icon: '📄',
            title: 'Command Output',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const output = e.payload.output || e.payload.stdout || e.payload.stderr || '';
              const lines = output.split('\\n').filter(l => l.trim()).length;
              return \`\${lines} line(s) of output\`;
            }
          },
          command_completed: {
            icon: '✅',
            title: 'Command Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const exitCode = e.payload.exit_code;
              const success = exitCode === 0 || e.payload.success;
              return success ? 'Completed successfully' : \`Exit code: \${exitCode}\`;
            }
          },
          command_failed: {
            icon: '❌',
            title: 'Command Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const error = e.payload.error || e.payload.stderr || '';
              return error.length > 50 ? error.substring(0, 50) + '...' : error || 'Command failed';
            }
          },
          // Step 29: Systems Tab Events
          run_scope_initialized: {
            icon: '📋',
            title: 'Scope Initialized',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => \`Max \${e.payload.max_files || 0} files\`
          },
          repair_policy_snapshot: {
            icon: '⚙️',
            title: 'Repair Policy',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => \`Max \${e.payload.max_attempts || 0} attempts\`
          },
          // Step 35 Scaffold Events
          scaffold_started: {
            icon: '🏗️',
            title: 'Scaffold Started',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const userPrompt = e.payload.user_prompt || '';
              // Truncate prompt for display
              if (userPrompt.length > 50) {
                return userPrompt.substring(0, 50) + '...';
              }
              return userPrompt || 'Greenfield project setup';
            }
          },
          scaffold_proposal_created: {
            icon: '📋',
            title: 'Scaffold Proposal Ready',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const summary = e.payload.summary || '';
              // Use the generated summary from scaffoldFlow.ts
              if (summary) {
                return summary.length > 60 ? summary.substring(0, 60) + '...' : summary;
              }
              // Fallback
              const recipe = e.payload.recipe_id || e.payload.recipe || 'TBD';
              const designPack = e.payload.design_pack_id || e.payload.design_pack || '';
              if (recipe === 'TBD' && designPack === 'TBD') {
                return 'Ready for approval';
              }
              return designPack ? \`\${recipe} + \${designPack}\` : recipe;
            }
          },
          scaffold_decision_resolved: {
            icon: '✅',
            title: 'Scaffold Decision',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const decision = e.payload.decision || 'proceed';
              const recipe = e.payload.recipe_id || e.payload.recipe || 'auto';
              const nextSteps = e.payload.next_steps || [];
              if (decision === 'cancel') return 'User cancelled scaffold';
              if (decision === 'change_style') return 'Style customization requested';
              return \`Approved • Recipe: \${recipe}\${nextSteps.length ? ' • Next: ' + nextSteps[0] : ''}\`;
            }
          },
          scaffold_approved: {
            icon: '✅',
            title: 'Scaffold Approved',
            color: 'var(--vscode-charts-green)',
            getSummary: () => 'User approved scaffold'
          },
          scaffold_cancelled: {
            icon: '❌',
            title: 'Scaffold Cancelled',
            color: 'var(--vscode-charts-red)',
            getSummary: () => 'User cancelled scaffold'
          },
          scaffold_completed: {
            icon: '🎉',
            title: 'Scaffold Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const status = e.payload.status || 'completed';
              const reason = e.payload.reason || '';
              if (status === 'cancelled') return reason || 'Scaffold cancelled';
              if (status === 'ready_for_step_35_2') return 'Scaffold approved — setting up project';
              return reason || 'Scaffold completed';
            }
          },
          scaffold_applied: {
            icon: '🎉',
            title: 'Scaffold Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const filesCount = (e.payload.files_created || []).length;
              return \`\${filesCount} files created\`;
            }
          },
          scaffold_failed: {
            icon: '❌',
            title: 'Scaffold Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.error || 'Scaffold failed'
          },
          // Vision Analysis Events (Step 38)
          vision_analysis_started: {
            icon: '👁️',
            title: 'Analyzing References',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const imagesCount = e.payload.images_count || 0;
              const urlsCount = e.payload.urls_count || 0;
              return \`\${imagesCount} images, \${urlsCount} URLs\`;
            }
          },
          vision_analysis_completed: {
            icon: '✅',
            title: 'Reference Analysis Complete',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const status = e.payload.status || 'complete';
              if (status === 'skipped') return 'Skipped: ' + (e.payload.reason || 'disabled');
              if (status === 'error') return 'Error: ' + (e.payload.reason || 'failed');
              return 'Analysis complete';
            }
          },
          reference_tokens_extracted: {
            icon: '🎨',
            title: 'Style Tokens Extracted',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const confidence = e.payload.confidence || 0;
              const moods = (e.payload.moods || []).slice(0, 2).join(', ');
              return \`\${Math.round(confidence * 100)}% confidence\${moods ? ' • ' + moods : ''}\`;
            }
          },
          reference_tokens_used: {
            icon: '✨',
            title: 'Tokens Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const usedIn = e.payload.used_in || 'scaffold';
              const overridesApplied = e.payload.overrides_applied;
              return \`Applied to \${usedIn}\${overridesApplied ? ' (with overrides)' : ''}\`;
            }
          }
        };
        return eventCardMap[type];
      }
  `;
}
