export function getMissionActionsJs(): string {
  return `
      // ===== MISSION SELECTION HANDLERS (Step 26) =====
      window.handleSelectMission = function(taskId, missionId) {
        console.log('Select Mission clicked', { taskId, missionId });

        // Send message to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:selectMission',
            task_id: taskId,
            mission_id: missionId
          });
        } else {
          // Demo mode: simulate selection
          console.log('Demo mode: simulating mission selection');
          const event = {
            event_id: generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'mission_selected',
            mode: state.currentMode,
            stage: state.currentStage,
            payload: {
              mission_id: missionId,
              selected_at: new Date().toISOString()
            },
            evidence_ids: [],
            parent_event_id: null
          };
          state.events.push(event);
          renderMission();
          renderLogs();
        }
      };

      window.handleStartMission = function(taskId, missionId) {
        console.log('====================================');
        console.log('[MCB] 🚀 START MISSION CLICKED');
        console.log('[MCB] Task ID:', taskId);
        console.log('[MCB] Mission ID:', missionId);
        console.log('[MCB] Current state.events.length:', state.events.length);
        console.log('====================================');

        // OPTIMISTIC UI UPDATE: Set pending state immediately
        state.missionStartPending = { taskId, missionId };
        console.log('[MCB] ✓ Set pending state:', JSON.stringify(state.missionStartPending));

        // Force immediate UI update
        console.log('[MCB] 📢 Calling updateMissionControlBar()...');
        updateMissionControlBar();
        console.log('[MCB] ✓ updateMissionControlBar() completed');

        // Send message to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:startMission',
            task_id: taskId,
            mission_id: missionId
          });
        } else {
          // Demo mode: simulate mission start
          console.log('Demo mode: simulating mission start');
          updateStatus('running');

          const event = {
            event_id: generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'mission_started',
            mode: 'MISSION',
            stage: 'retrieve',
            payload: {
              mission_id: missionId,
              steps_count: 2,
              goal: 'Execute selected mission'
            },
            evidence_ids: [],
            parent_event_id: null
          };
          state.events.push(event);
          state.missionStartPending = null; // Clear in demo mode
          renderMission();
          renderLogs();
        }
      };

      // ===== APPLY DIFF HANDLER =====
      window.handleApplyDiff = function(diffId, taskId) {
        console.log('Apply Diff clicked', { diffId, taskId });

        // Send message to extension to request apply with approval
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:requestApplyDiff',
            diff_id: diffId,
            task_id: taskId
          });
        } else {
          // Demo mode: simulate approval request
          console.log('Demo mode: simulating apply diff approval request');
          const approvalId = generateId();

          setTimeout(() => {
            // Get diff event to extract files_changed
            const diffEvent = state.events.find(e => e.type === 'diff_proposed' && e.payload.diff_id === diffId);
            const filesChanged = diffEvent ? (diffEvent.payload.files_changed || []) : [];

            addDemoEvent('approval_requested', {
              approval_id: approvalId,
              approval_type: 'apply_diff',
              description: \`Apply diff to \${filesChanged.length} file(s)\`,
              details: {
                diff_id: diffId,
                files_changed: filesChanged,
                summary: 'Applying proposed changes'
              },
              risk_level: 'medium'
            });
            renderMission();
          }, 100);
        }
      };

      // Demo: Add test approval button
      window.testApproval = function(type) {
        const approvalId = generateId();
        let details = {};

        if (type === 'terminal') {
          details = {
            command: 'npm run build',
            working_dir: '/Users/project'
          };
        } else if (type === 'apply_diff') {
          details = {
            files_changed: ['src/index.ts', 'package.json'],
            additions: 25,
            deletions: 10
          };
        } else if (type === 'scope_expansion') {
          details = {
            reason: 'Need access to additional files for analysis',
            requested: {
              max_files: 20,
              max_lines: 2000
            }
          };
        }

        addDemoEvent('approval_requested', {
          approval_id: approvalId,
          approval_type: type,
          description: \`Requesting approval for \${type}\`,
          details: details,
          risk_level: type === 'terminal' ? 'high' : type === 'apply_diff' ? 'medium' : 'low'
        });
        renderMission();
      };
  `;
}
