export function getMissionActivityJs(): string {
  return `
      // ===== MISSION ACTIVITY INDICATOR =====
      // Themed rotating messages tied to the mission-control metaphor
      var missionActivityEl = document.getElementById('missionActivity');
      var missionActivityText = document.getElementById('missionActivityText');
      var _missionMsgInterval = null;
      var _missionMsgIndex = 0;

      var MISSION_MESSAGES = {
        plan: [
          'Charting mission trajectory\\u2026',
          'Scanning mission parameters\\u2026',
          'Computing optimal approach\\u2026',
          'Mapping execution path\\u2026'
        ],
        retrieve: [
          'Gathering intel\\u2026',
          'Acquiring mission targets\\u2026',
          'Scanning project terrain\\u2026',
          'Collecting reconnaissance data\\u2026'
        ],
        edit: [
          'Executing mission edits\\u2026',
          'Deploying payload\\u2026',
          'Applying mission modifications\\u2026',
          'Writing changes to target\\u2026'
        ],
        test: [
          'Running mission verification\\u2026',
          'Validating mission integrity\\u2026',
          'Testing deployment outcome\\u2026'
        ],
        repair: [
          'Initiating repair sequence\\u2026',
          'Rerouting mission path\\u2026',
          'Diagnosing mission anomaly\\u2026'
        ],
        none: [
          'Mission in progress\\u2026',
          'Ordinex processing\\u2026',
          'Agent dispatched\\u2026',
          'Awaiting mission telemetry\\u2026'
        ]
      };

      function getMissionMessages() {
        var stage = state.currentStage || 'none';
        return MISSION_MESSAGES[stage] || MISSION_MESSAGES['none'];
      }

      function showMissionActivity() {
        if (!missionActivityEl) return;
        _missionMsgIndex = 0;
        var msgs = getMissionMessages();
        if (missionActivityText) {
          missionActivityText.textContent = msgs[0];
        }
        missionActivityEl.classList.add('active');
        missionActivityEl.style.display = 'block';

        // Rotate messages every 3 seconds
        clearInterval(_missionMsgInterval);
        _missionMsgInterval = setInterval(function() {
          var currentMsgs = getMissionMessages();
          _missionMsgIndex = (_missionMsgIndex + 1) % currentMsgs.length;
          if (missionActivityText) {
            missionActivityText.textContent = currentMsgs[_missionMsgIndex];
            // Re-trigger fade animation
            missionActivityText.style.animation = 'none';
            void missionActivityText.offsetHeight;
            missionActivityText.style.animation = 'missionTextFade 0.4s ease-in-out';
          }
        }, 3000);
      }

      function hideMissionActivity() {
        if (!missionActivityEl) return;
        missionActivityEl.classList.remove('active');
        missionActivityEl.style.display = 'none';
        clearInterval(_missionMsgInterval);
        _missionMsgInterval = null;
      }

      // Hook into updateStatus to show/hide indicator
      var _prevUpdateStatusForActivity = updateStatus;
      updateStatus = function(status) {
        _prevUpdateStatusForActivity(status);
        if (status === 'running') {
          showMissionActivity();
        } else {
          hideMissionActivity();
        }
      };

      // Also hook into updateStage to refresh messages when stage changes mid-run
      var _prevUpdateStageForActivity = updateStage;
      updateStage = function(stage) {
        _prevUpdateStageForActivity(stage);
        if (state.taskStatus === 'running' && missionActivityEl && missionActivityEl.classList.contains('active')) {
          // Stage changed while running — update message immediately
          var msgs = getMissionMessages();
          _missionMsgIndex = 0;
          if (missionActivityText) {
            missionActivityText.textContent = msgs[0];
            missionActivityText.style.animation = 'none';
            void missionActivityText.offsetHeight;
            missionActivityText.style.animation = 'missionTextFade 0.4s ease-in-out';
          }
        }
      };
  `;
}
