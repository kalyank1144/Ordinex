export function getSystemsTabJs(): string {
  return `
      // ===== SYSTEMS VIEW MODEL REDUCER (Inline for webview) =====
      function reduceToSystemsViewModel(events) {
        const vm = {
          status: { mission: null, stage: 'none', runStatus: 'idle', pausedReason: null, currentStep: null },
          waitingFor: { pendingApprovals: [], pendingDecisionPoints: [] },
          scope: { workspaceRoots: [], allowedCreateRoots: [], deniedPatterns: [], approvedExpansions: [], limits: {} },
          contextIncluded: { retrievedFiles: [], tokenEstimate: 0, totalLines: 0, totalCharacters: 0 },
          changes: { lastDiffProposed: null, lastDiffApplied: null, filesChangedTotal: [], checkpointsCreated: 0 },
          testsAndRepair: { lastTestRun: null, testsPassed: 0, testsFailed: 0, repairAttempts: { used: 0, remaining: 3, max: 3 }, allowlistedCommands: [] },
          toolActivity: { counts: {}, totalCalls: 0, lastToolCall: null },
          timeouts: { stageTimeoutMs: 300000, lastTimeout: null, timeoutCount: 0 }
        };

        const resolvedApprovalIds = new Set();
        const resolvedDecisionIds = new Set();

        for (const event of events) {
          const p = event.payload || {};
          switch (event.type) {
            case 'mission_started': vm.status.mission = p.goal || p.mission_id || 'active'; vm.status.runStatus = 'running'; break;
            case 'mission_completed': vm.status.runStatus = 'completed'; break;
            case 'mission_paused': vm.status.runStatus = 'paused'; vm.status.pausedReason = p.reason || 'paused'; break;
            case 'mission_cancelled': vm.status.runStatus = 'cancelled'; break;
            case 'execution_paused': vm.status.runStatus = 'paused'; vm.status.pausedReason = p.reason || 'paused'; break;
            case 'execution_resumed': vm.status.runStatus = 'running'; vm.status.pausedReason = null; break;
            case 'stage_changed': vm.status.stage = p.to || event.stage || 'none'; break;
            case 'step_started': vm.status.currentStep = { index: p.step_index, description: p.description }; break;
            case 'step_completed': vm.status.currentStep = null; break;
            case 'run_scope_initialized': vm.scope.workspaceRoots = p.workspace_roots || []; vm.scope.limits = p.limits || {}; break;
            case 'scope_expansion_resolved': if (p.approved) vm.scope.approvedExpansions.push(p); break;
            case 'retrieval_completed':
              vm.contextIncluded.retrievedFiles = (p.results || []).map(r => ({ path: r.path, lines: r.lines || r.excerpt?.split('\\n').length || 0 }));
              vm.contextIncluded.tokenEstimate = p.tokenEstimate || 0;
              vm.contextIncluded.totalCharacters = p.totalCharacters || 0;
              break;
            case 'context_collected':
              vm.contextIncluded.totalLines = p.total_lines || 0;
              vm.contextIncluded.retrievedFiles = (p.files_included || []).map(f => ({ path: f.path || f, lines: f.lines || 0 }));
              break;
            case 'approval_requested': vm.waitingFor.pendingApprovals.push({ id: p.approval_id, type: p.approval_type, description: p.description }); break;
            case 'approval_resolved': resolvedApprovalIds.add(p.approval_id); break;
            case 'decision_point_needed': vm.waitingFor.pendingDecisionPoints.push({ id: p.decision_id, question: p.question }); break;
            case 'clarification_received': resolvedDecisionIds.add(p.decision_id); break;
            case 'diff_proposed': vm.changes.lastDiffProposed = { diffId: p.diff_id, files: p.files_changed || [] }; break;
            case 'diff_applied':
              vm.changes.lastDiffApplied = { diffId: p.diff_id, files: p.files_changed || [] };
              (p.files_changed || []).forEach(f => { const path = typeof f === 'string' ? f : f.path; if (path && !vm.changes.filesChangedTotal.includes(path)) vm.changes.filesChangedTotal.push(path); });
              break;
            case 'checkpoint_created': vm.changes.checkpointsCreated++; break;
            case 'test_completed':
              vm.testsAndRepair.lastTestRun = { passed: p.passed, failed: p.failed, timestamp: event.timestamp };
              vm.testsAndRepair.testsPassed = p.passed || 0;
              vm.testsAndRepair.testsFailed = p.failed || 0;
              break;
            case 'repair_attempt_started': vm.testsAndRepair.repairAttempts.used++; vm.testsAndRepair.repairAttempts.remaining = Math.max(0, vm.testsAndRepair.repairAttempts.max - vm.testsAndRepair.repairAttempts.used); break;
            case 'repair_policy_snapshot': vm.testsAndRepair.repairAttempts.max = p.max_attempts || 3; vm.testsAndRepair.allowlistedCommands = p.allowlisted_commands || []; break;
            case 'tool_start':
              vm.toolActivity.totalCalls++;
              vm.toolActivity.counts[p.tool] = (vm.toolActivity.counts[p.tool] || 0) + 1;
              vm.toolActivity.lastToolCall = { tool: p.tool, timestamp: event.timestamp };
              break;
            case 'stage_timeout': vm.timeouts.lastTimeout = { stage: p.stage, at: event.timestamp }; vm.timeouts.timeoutCount++; break;
          }
        }
        // Filter resolved approvals/decisions
        vm.waitingFor.pendingApprovals = vm.waitingFor.pendingApprovals.filter(a => !resolvedApprovalIds.has(a.id));
        vm.waitingFor.pendingDecisionPoints = vm.waitingFor.pendingDecisionPoints.filter(d => !resolvedDecisionIds.has(d.id));
        return vm;
      }

      // Render Systems Tab with all 8 sections
      function renderSystemsTab() {
        const vm = reduceToSystemsViewModel(state.events);
        const container = document.getElementById('systemsContent');
        if (!container) return;

        // Build HTML for all 8 sections
        let html = '';

        // 1. STATUS SECTION
        const statusBadgeClass = vm.status.runStatus || 'idle';
        const stageDisplay = vm.status.stage !== 'none' ? vm.status.stage : '—';
        html += \`
          <div class="systems-section">
            <div class="systems-section-title"><span class="systems-section-icon">📊</span> Status</div>
            <div class="systems-row"><span class="systems-label">Run Status</span><span class="systems-badge \${statusBadgeClass}">\${statusBadgeClass.toUpperCase()}</span></div>
            <div class="systems-row"><span class="systems-label">Stage</span><span class="systems-value">\${stageDisplay}</span></div>
            \${vm.status.mission ? \`<div class="systems-row"><span class="systems-label">Mission</span><span class="systems-value">\${escapeHtml(String(vm.status.mission).substring(0, 50))}</span></div>\` : ''}
            \${vm.status.pausedReason ? \`<div class="systems-row"><span class="systems-label">Paused</span><span class="systems-value warning">\${escapeHtml(vm.status.pausedReason)}</span></div>\` : ''}
            \${vm.status.currentStep ? \`<div class="systems-row"><span class="systems-label">Current Step</span><span class="systems-value">\${vm.status.currentStep.index + 1}: \${escapeHtml(vm.status.currentStep.description || '')}</span></div>\` : ''}
          </div>
        \`;

        // 2. WAITING FOR SECTION
        const hasPending = vm.waitingFor.pendingApprovals.length > 0 || vm.waitingFor.pendingDecisionPoints.length > 0;
        if (hasPending) {
          html += \`<div class="systems-section" style="border-color: var(--vscode-inputValidation-warningBorder);">
            <div class="systems-section-title" style="color: var(--vscode-charts-yellow);"><span class="systems-section-icon">⏳</span> Waiting For</div>\`;
          vm.waitingFor.pendingApprovals.forEach(a => {
            html += \`<div class="systems-pending-item"><div class="systems-pending-type">\${escapeHtml(a.type || 'approval')}</div><div class="systems-pending-desc">\${escapeHtml(a.description || 'Pending approval')}</div></div>\`;
          });
          vm.waitingFor.pendingDecisionPoints.forEach(d => {
            html += \`<div class="systems-pending-item"><div class="systems-pending-type">Decision Needed</div><div class="systems-pending-desc">\${escapeHtml(d.question || 'Awaiting input')}</div></div>\`;
          });
          html += \`</div>\`;
        }

        // 3. SCOPE SECTION
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">📁</span> Scope</div>
          <div class="systems-row"><span class="systems-label">Workspace Roots</span><span class="systems-value">\${vm.scope.workspaceRoots.length || 1}</span></div>
          \${vm.scope.limits.max_files ? \`<div class="systems-row"><span class="systems-label">Max Files</span><span class="systems-value">\${vm.scope.limits.max_files}</span></div>\` : ''}
          \${vm.scope.limits.max_lines ? \`<div class="systems-row"><span class="systems-label">Max Lines</span><span class="systems-value">\${vm.scope.limits.max_lines}</span></div>\` : ''}
          \${vm.scope.approvedExpansions.length > 0 ? \`<div class="systems-row"><span class="systems-label">Approved Expansions</span><span class="systems-value success">\${vm.scope.approvedExpansions.length}</span></div>\` : ''}
        </div>\`;

        // 4. CONTEXT INCLUDED SECTION
        const topFiles = vm.contextIncluded.retrievedFiles.slice(0, 5);
        const hasMoreFiles = vm.contextIncluded.retrievedFiles.length > 5;
        const tokenDisplay = vm.contextIncluded.tokenEstimate ? \`~\${Math.round(vm.contextIncluded.tokenEstimate / 1000)}k tokens\` : '';
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">📄</span> Context Included</div>
          <div class="systems-counters">
            <div class="counter-box"><div class="counter-label">Files</div><div class="counter-value">\${vm.contextIncluded.retrievedFiles.length}</div></div>
            <div class="counter-box"><div class="counter-label">Lines</div><div class="counter-value">\${vm.contextIncluded.totalLines}</div></div>
          </div>
          \${tokenDisplay ? \`<div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Token Estimate</span><span class="systems-value">\${tokenDisplay}</span></div>\` : ''}
          \${topFiles.length > 0 ? \`<div class="systems-file-list" style="margin-top: 8px;">\${topFiles.map(f => \`<div class="systems-file-item"><span class="systems-file-path">\${escapeHtml(f.path)}</span><span class="systems-file-lines">\${f.lines} lines</span></div>\`).join('')}</div>\` : ''}
          \${hasMoreFiles ? \`<button class="systems-show-all" onclick="alert('Full file list: ' + JSON.stringify(\${JSON.stringify(vm.contextIncluded.retrievedFiles.map(f => f.path))}))">Show all \${vm.contextIncluded.retrievedFiles.length} files</button>\` : ''}
        </div>\`;

        // 5. CHANGES SECTION
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">✏️</span> Changes</div>
          <div class="systems-counters">
            <div class="counter-box"><div class="counter-label">Files Changed</div><div class="counter-value">\${vm.changes.filesChangedTotal.length}</div></div>
            <div class="counter-box"><div class="counter-label">Checkpoints</div><div class="counter-value">\${vm.changes.checkpointsCreated}</div></div>
          </div>
          \${vm.changes.lastDiffApplied ? \`<div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Last Diff</span><span class="systems-value success">Applied (\${vm.changes.lastDiffApplied.files.length} files)</span></div>\` : ''}
          \${vm.changes.lastDiffProposed && !vm.changes.lastDiffApplied ? \`<div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Pending Diff</span><span class="systems-value warning">Proposed (\${vm.changes.lastDiffProposed.files.length} files)</span></div>\` : ''}
        </div>\`;

        // 6. TESTS & REPAIR SECTION
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">🧪</span> Tests & Repair</div>
          <div class="systems-counters">
            <div class="counter-box"><div class="counter-label">Tests Passed</div><div class="counter-value \${vm.testsAndRepair.testsPassed > 0 ? 'success' : ''}">\${vm.testsAndRepair.testsPassed}</div></div>
            <div class="counter-box"><div class="counter-label">Tests Failed</div><div class="counter-value \${vm.testsAndRepair.testsFailed > 0 ? 'error' : ''}">\${vm.testsAndRepair.testsFailed}</div></div>
          </div>
          <div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Repair Attempts</span><span class="systems-value">\${vm.testsAndRepair.repairAttempts.used} / \${vm.testsAndRepair.repairAttempts.max}</span></div>
          \${vm.testsAndRepair.repairAttempts.remaining === 0 ? \`<div class="systems-row"><span class="systems-label">Status</span><span class="systems-value error">No repairs remaining</span></div>\` : ''}
        </div>\`;

        // 7. TOOL ACTIVITY SECTION
        const toolNames = Object.keys(vm.toolActivity.counts);
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">🔧</span> Tool Activity</div>
          <div class="systems-row"><span class="systems-label">Total Calls</span><span class="systems-value">\${vm.toolActivity.totalCalls}</span></div>
          \${toolNames.length > 0 ? \`<div class="systems-tool-grid" style="margin-top: 8px;">\${toolNames.map(t => \`<div class="systems-tool-item"><div class="systems-tool-name">\${escapeHtml(t)}</div><div class="systems-tool-count">\${vm.toolActivity.counts[t]}</div></div>\`).join('')}</div>\` : ''}
          \${vm.toolActivity.lastToolCall ? \`<div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Last Tool</span><span class="systems-value">\${escapeHtml(vm.toolActivity.lastToolCall.tool)}</span></div>\` : ''}
        </div>\`;

        // 8. TIMEOUTS SECTION
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">⏱️</span> Timeouts</div>
          <div class="systems-row"><span class="systems-label">Stage Timeout</span><span class="systems-value">\${Math.round(vm.timeouts.stageTimeoutMs / 1000)}s</span></div>
          <div class="systems-row"><span class="systems-label">Timeout Count</span><span class="systems-value \${vm.timeouts.timeoutCount > 0 ? 'warning' : ''}">\${vm.timeouts.timeoutCount}</span></div>
          \${vm.timeouts.lastTimeout ? \`<div class="systems-row"><span class="systems-label">Last Timeout</span><span class="systems-value warning">\${escapeHtml(vm.timeouts.lastTimeout.stage)}</span></div>\` : ''}
        </div>\`;

        container.innerHTML = html;
      }

      // Legacy function for backward compatibility
      function renderSystemsCounters() {
        renderSystemsTab();
      }
  `;
}
