# Mission Sequencing & Step Execution Debug Fix

**Date**: January 25, 2026
**Issue**: Complex prompts causing step failures + Mission sequencing not advancing after completion

## Problems Identified

### 1. Mission Sequencing Not Advancing (CRITICAL)
**Symptoms**:
- After Mission 1 completes, UI does not update to show "2/4" with next mission name
- "Start" button for next mission not appearing
- User stuck on completed mission screen

**Root Cause**:
- `handleMissionCompletionSequencing()` was being called but insufficient logging made it impossible to debug
- Event payload structure for `mission_completed` not validated
- Mission Control Bar state update logic not being traced

### 2. Complex Prompt Step Execution Failures
**Symptoms**:
- "Failure Detected" errors
- "Step execution failed" messages
- Cascading failure events

**Root Cause**:
- Multiple error emission points in `executeEditStep()`
- Unclear error propagation paths
- Missing diagnostic logging

## Changes Made

### Phase 1: Comprehensive Mission Sequencing Logging

**File**: `packages/extension/src/extension.ts`

#### Added Detailed Logging to `handleExecutePlan()`:
```typescript
// Subscribe to events from MissionExecutor
eventBus.subscribe(async (event) => {
  await this.sendEventsToWebview(webview, taskId);
  
  if (event.type === 'mission_completed') {
    console.log('[handleExecutePlan] 🎉 mission_completed detected, triggering sequencing logic');
    console.log('[handleExecutePlan] Event payload:', JSON.stringify(event.payload, null, 2));
    await this.handleMissionCompletionSequencing(taskId, webview);
  }
});
```

#### Enhanced `handleMissionCompletionSequencing()` with Debug Markers:
Added comprehensive logging at every decision point:
- `========================================` visual separators
- ✓ Success markers
- ❌ Failure markers  
- ℹ️ Info markers
- ➡️ Next action markers
- 🎉 Completion markers
- 📤 Event emission markers
- ⏸️ Pause markers

**Logging Points Added**:
1. Function entry with separator
2. EventStore availability check
3. Total events count
4. Breakdown event detection
5. Total missions count
6. Completed missions count and progress
7. Last completed mission ID
8. Mission index calculations
9. All missions complete check with celebration
10. Next mission availability check
11. Next mission details (title, ID, index)
12. mission_selected event emission (before/after)
13. execution_paused event emission (before/after)
14. Webview update confirmation
15. Pause status with progress
16. Error handling with stack traces

### Expected Console Output

#### When Mission 1 Completes:
```
[handleExecutePlan] 🎉 mission_completed detected, triggering sequencing logic
[handleExecutePlan] Event payload: { mission_id: "...", success: true, ... }
[Ordinex:MissionSequencing] ========================================
[Ordinex:MissionSequencing] Mission completed, checking for next mission...
[Ordinex:MissionSequencing] Found 87 total events for task abc123
[Ordinex:MissionSequencing] ✓ Found breakdown event
[Ordinex:MissionSequencing] Total missions in breakdown: 4
[Ordinex:MissionSequencing] ✓ Progress: 1/4 missions completed
[Ordinex:MissionSequencing] Last completed mission ID: mission_1_id
[Ordinex:MissionSequencing] Completed mission index: 0
[Ordinex:MissionSequencing] Next mission index would be: 1
[Ordinex:MissionSequencing] ========================================
[Ordinex:MissionSequencing] ➡️ Next mission available: Mission 2 Title
[Ordinex:MissionSequencing] Mission 2/4
[Ordinex:MissionSequencing] Mission ID: mission_2_id
[Ordinex:MissionSequencing] 📤 Emitting mission_selected event...
[Ordinex:MissionSequencing] ✓ mission_selected event emitted
[Ordinex:MissionSequencing] 📤 Emitting execution_paused event...
[Ordinex:MissionSequencing] ✓ execution_paused event emitted
[Ordinex:MissionSequencing] 📤 Sending updated events to webview...
[Ordinex:MissionSequencing] ✓ Events sent to webview
[Ordinex:MissionSequencing] ⏸️ Paused - waiting for user to start mission 2/4
[Ordinex:MissionSequencing] ========================================
```

#### When All Missions Complete:
```
[Ordinex:MissionSequencing] ========================================
[Ordinex:MissionSequencing] 🎉 All 4 missions completed!
```

#### On Error:
```
[Ordinex:MissionSequencing] ========================================
[Ordinex:MissionSequencing] ❌ Error handling mission sequencing: [error message]
[Ordinex:MissionSequencing] Error stack: [stack trace]
[Ordinex:MissionSequencing] ========================================
```

## Testing Instructions

### How to Test Mission Sequencing:

1. **Start VS Code Extension Development Host**
   ```bash
   # In VS Code, press F5 to launch Extension Development Host
   ```

2. **Open Chrome DevTools Console**
   - In the Extension Development Host window
   - Help → Toggle Developer Tools
   - Go to Console tab

3. **Create a Complex PLAN Mode Prompt**
   ```
   "Build authentication endpoints in src/server/auth.ts using express middleware and yup validation, create user management in src/services/user.ts, add dashboard UI in src/pages/Dashboard.tsx, implement settings page in src/pages/Settings.tsx"
   ```

4. **Execute Plan and Monitor Console**
   - Switch to PLAN mode
   - Submit prompt
   - Approve generated plan
   - Click "Execute Plan"
   - Watch console logs for sequencing markers

5. **Verify Mission Completion Sequence**
   - After Mission 1 completes, look for:
     - ` 🎉 mission_completed detected` log
     - `✓ Progress: 1/4 missions completed` log
     - `➡️ Next mission available: [Mission 2 title]` log
     - `📤 Emitting mission_selected event...` log
     - `✓ Events sent to webview` log
   
6. **Check UI Updates**
   - Bottom Mission Control Bar should show "2/4"
   - Mission name should change to Mission 2 title
   - "Start" button should be enabled

7. **Check for Errors**
   - Look for `❌` markers in console
   - Check if error messages include stack traces
   - Verify breakdown event is found

## Next Steps

### Phase 2: Add Error Handling Logging (To Be Done)
- Add similar comprehensive logging to `missionExecutor.ts`
- Log all error paths in `executeEditStep()`
- Add console.error for each failure type
- Log truncation detection and recovery attempts

### Phase 3: Webview State Debugging (To Be Done)
- Add logging to `updateMissionControlBar()` in webview
- Log `getMissionProgress()` calculations
- Trace when bar visibility changes
- Log mission selection state detection

## Files Modified

1. `/packages/extension/src/extension.ts`
   - Enhanced `handleExecutePlan()` eventBus subscription
   - Added comprehensive logging to `handleMissionCompletionSequencing()`
   - Added visual separators and emoji markers for easy log scanning

## Debugging Tips

1. **Use Visual Markers**: Search console for emojis:
   - `🎉` = Completion/Success events
   - `❌` = Errors
   - `➡️` = Next actions
   - `📤` = Event emissions
   - `✓` = Confirmations

2. **Check Event Payload Structure**:
   - Look for `Event payload:` logs to verify mission_id field
   - Confirm payload structure matches expected format

3. **Verify Event Counts**:
   - Compare "Found X total events" with expected count
   - Ensure mission_completed events are being persisted

4. **Trace Event Flow**:
   - Follow the sequential logs from top to bottom
   - Each step should have a confirmation marker
   - Missing confirmations indicate where flow breaks

## Known Issues

- None yet - this is diagnostic phase
- Once logs are collected, we'll identify actual bugs

## Success Criteria

✅ Console shows comprehensive sequencing logs
✅ Can trace exact point of failure
✅ Event payload structure visible
✅ Error stack traces captured
⏳ Mission sequencing works (to be verified after testing)
⏳ Complex prompts execute without cascading failures (Phase 2)
