export function getMissionControlBarJs(): string {
  return `
      // ===== MISSION CONTROL BAR STATE LOGIC (Compact Bottom Bar) =====
      // Compute mission progress from events (PHASE 1: FIXED - Uses event stream reduction)
      function getMissionProgress(events) {
        console.log('[getMissionProgress] Called with', events.length, 'events');

        // Edge case: no events
        if (!events || events.length === 0) {
          console.log('[getMissionProgress] ❌ No events, returning null');
          return null;
        }

        // Find breakdown event
        const breakdownEvent = events.find(e => e.type === 'mission_breakdown_created');
        if (!breakdownEvent) {
          console.log('[getMissionProgress] ❌ No breakdown event, returning null');
          return null; // No missions, bar hidden
        }
        console.log('[getMissionProgress] ✓ Found breakdown event');

        const missions = breakdownEvent.payload?.missions || [];
        const totalMissions = missions.length;
        console.log('[getMissionProgress] Total missions:', totalMissions);
        if (totalMissions === 0) return null;

        // CRITICAL FIX: Get LATEST mission_selected event by filtering then taking last
        const selectedEvents = events.filter(e => e.type === 'mission_selected');
        console.log('[getMissionProgress] Found', selectedEvents.length, 'mission_selected events');
        const selectedEvent = selectedEvents[selectedEvents.length - 1]; // Last = Latest
        const selectedMissionId = selectedEvent?.payload?.mission_id;
        console.log('[getMissionProgress] Selected mission ID:', selectedMissionId);

        // Edge case: mission ID points to non-existent mission
        const selectedMission = missions.find(m => m.missionId === selectedMissionId);
        if (selectedMissionId && !selectedMission) {
          console.warn('[MCB] Selected mission not found:', selectedMissionId);
          return null; // Fail safely
        }

        // Count completed missions (reduce over events for accuracy)
        const completedMissionIds = new Set();
        events.forEach(e => {
          if (e.type === 'mission_completed') {
            const mid = e.payload?.mission_id;
            if (mid) completedMissionIds.add(mid);
          }
        });
        const completedCount = completedMissionIds.size;

        // Check if CURRENT mission is running (started AND not completed)
        // CRITICAL FIX: Only check for missions that match the SELECTED mission
        const isMissionCompleted = selectedMissionId && completedMissionIds.has(selectedMissionId);
        console.log('[getMissionProgress] Is mission completed?', isMissionCompleted);

        // Check if mission started for the SELECTED mission
        const missionStartedEvents = events.filter(e =>
          e.type === 'mission_started' &&
          e.payload?.mission_id === selectedMissionId
        );
        const hasMissionStarted = missionStartedEvents.length > 0;
        const lastMissionStarted = missionStartedEvents[missionStartedEvents.length - 1];
        console.log('[getMissionProgress] Has mission started?', hasMissionStarted, '(', missionStartedEvents.length, 'events)');

        // OPTIMISTIC UI: Check if we have a pending mission start for this mission
        const hasPendingStart = state.missionStartPending &&
                               state.missionStartPending.missionId === selectedMissionId;
        console.log('[getMissionProgress] Has pending start?', hasPendingStart);

        // Check for execution pause/block states AFTER the mission started
        // CRITICAL FIX: Only consider pause events that came AFTER the mission started
        let isPaused = false;
        if (hasMissionStarted && lastMissionStarted) {
          const startIndex = events.indexOf(lastMissionStarted);
          const eventsAfterStart = events.slice(startIndex + 1);

          // Find if there's a pause event after start that hasn't been resumed
          const lastPauseAfterStart = [...eventsAfterStart].reverse().find(e =>
            e.type === 'execution_paused' || e.type === 'mission_paused'
          );

          if (lastPauseAfterStart) {
            const pauseIndex = events.indexOf(lastPauseAfterStart);
            const eventsAfterPause = events.slice(pauseIndex + 1);
            // Check if there's a resume or new mission_started after the pause
            isPaused = !eventsAfterPause.some(e =>
              e.type === 'execution_resumed' || e.type === 'mission_started'
            );
          }
        }

        // isRunning = (started OR pending start) AND not completed AND not paused
        const isRunning = (hasMissionStarted || hasPendingStart) && !isMissionCompleted && !isPaused;
        console.log('[getMissionProgress] 🎯 IS RUNNING?', isRunning);
        console.log('[getMissionProgress]   - hasMissionStarted:', hasMissionStarted);
        console.log('[getMissionProgress]   - hasPendingStart:', hasPendingStart);
        console.log('[getMissionProgress]   - isMissionCompleted:', isMissionCompleted);
        console.log('[getMissionProgress]   - isPaused:', isPaused);

        // Determine current mission index (1-based, handle missing selection)
        const currentMissionIndex = selectedMission
          ? missions.findIndex(m => m.missionId === selectedMissionId) + 1
          : Math.min(completedCount + 1, totalMissions);

        const result = {
          total: totalMissions,
          current: Math.min(currentMissionIndex, totalMissions),
          completed: completedCount,
          selectedMission: selectedMission,
          isRunning: isRunning,
          isPaused: isPaused,
          allDone: completedCount >= totalMissions,
          taskId: events[0]?.task_id || 'unknown'
        };

        console.log('[getMissionProgress] 📦 Returning:', JSON.stringify(result, null, 2));
        console.log('[getMissionProgress] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return result;
      }

      // Update Mission Control Bar UI
      function updateMissionControlBar() {
        console.log('');
        console.log('[MCB] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('[MCB] 🔄 UPDATE MISSION CONTROL BAR CALLED');
        console.log('[MCB] state.events.length:', state.events.length);
        console.log('[MCB] state.missionStartPending:', JSON.stringify(state.missionStartPending));

        const bar = document.getElementById('missionControlBar');
        const statusIcon = document.getElementById('mcbStatusIcon');
        const count = document.getElementById('mcbCount');
        const missionName = document.getElementById('mcbMissionName');
        const progressFill = document.getElementById('mcbProgressFill');
        const cta = document.getElementById('mcbCta');

        console.log('[MCB] 📊 Calling getMissionProgress()...');
        const progress = getMissionProgress(state.events);
        console.log('[MCB] 📊 Progress result:', JSON.stringify(progress, null, 2));

        if (!progress) {
          // Hide bar if no mission breakdown
          bar.classList.remove('visible', 'running', 'complete', 'all-done');
          return;
        }

        // Show bar
        bar.classList.add('visible');

        // Update count display (e.g., "2/4")
        count.textContent = progress.current + '/' + progress.total;

        // Update progress bar fill (percentage)
        const pct = Math.round((progress.completed / progress.total) * 100);
        progressFill.style.width = pct + '%';

        // Determine state and update accordingly
        if (progress.allDone) {
          // All missions complete
          console.log('[MCB] State: All Done');
          bar.classList.remove('running', 'complete');
          bar.classList.add('all-done');
          statusIcon.textContent = '🎉';
          statusIcon.classList.remove('spinning');
          missionName.textContent = 'All Complete!';
          progressFill.classList.add('complete');
          cta.textContent = '✓ Done';
          cta.className = 'mcb-cta done';
          cta.disabled = true;
        } else if (progress.isRunning) {
          // Currently running a mission
          console.log('[MCB] State: Running');
          bar.classList.remove('complete', 'all-done');
          bar.classList.add('running');
          statusIcon.textContent = '🔄';
          statusIcon.classList.add('spinning');
          missionName.textContent = progress.selectedMission?.title || 'Running...';
          progressFill.classList.remove('complete');
          cta.textContent = '⏳ Running...';
          cta.className = 'mcb-cta running';
          cta.disabled = true;
        } else if (progress.selectedMission) {
          // Mission selected, ready to start
          console.log('[MCB] State: Ready to Start');
          bar.classList.remove('running', 'all-done');
          bar.classList.add('complete'); // "ready" state
          statusIcon.textContent = '🚀';
          statusIcon.classList.remove('spinning');
          missionName.textContent = progress.selectedMission.title;
          progressFill.classList.remove('complete');
          cta.textContent = '▶ Start';
          cta.className = 'mcb-cta start';
          cta.disabled = false;
          cta.setAttribute('data-task-id', progress.taskId);
          cta.setAttribute('data-mission-id', progress.selectedMission.missionId);
        } else {
          // No mission selected yet
          console.log('[MCB] State: No Selection');
          bar.classList.remove('running', 'complete', 'all-done');
          statusIcon.textContent = '🎯';
          statusIcon.classList.remove('spinning');
          missionName.textContent = 'Select a mission...';
          progressFill.classList.remove('complete');
          cta.textContent = '↑ Select';
          cta.className = 'mcb-cta secondary';
          cta.disabled = true;
        }
      }

      // Handle Mission Control Bar CTA click
      window.handleMcbCtaClick = function() {
        const cta = document.getElementById('mcbCta');
        const taskId = cta.getAttribute('data-task-id');
        const missionId = cta.getAttribute('data-mission-id');

        if (taskId && missionId && !cta.disabled) {
          handleStartMission(taskId, missionId);
        }
      };
  `;
}
