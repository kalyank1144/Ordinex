# Mission Control Bar Debug Session

## Issue
After Mission 1 completes and auto-selects Mission 2, the Mission Control Bar (bottom bar) shows:
- ❌ Still displays "1/4 Foundation & Setup"
- ❌ Still shows "⏳ Running..." instead of "▶ Start"
- ❌ Doesn't update to "2/4" with Mission 2 name

## Debug Logging Added

I've added comprehensive console logging to `getMissionProgress()` function in `packages/webview/src/index.ts`. The logs will show:

```javascript
[MCB DEBUG] getMissionProgress called with X events
[MCB DEBUG] Found X missions
[MCB DEBUG] Found X mission_selected events
[MCB DEBUG] Latest selected mission ID: xxx
[MCB DEBUG] Selected mission object: Mission Title
[MCB DEBUG] Completed missions: X IDs: [...]
[MCB DEBUG] Mission started event found: true/false isRunning: true/false
[MCB DEBUG] Current mission index: X / Y
[MCB DEBUG] Returning progress: { ... full object ... }
```

## Next Steps

### 1. Reload Extension
- Press `F5` or use Command Palette → "Developer: Reload Window"
- Or close and reopen VS Code

### 2. Test with Complex Prompt
- Enter a complex prompt in PLAN mode
- Approve the plan → switch to MISSION mode
- Let Mission 1 execute completely
- **CRITICAL**: Check the Logs tab when Mission 1 completes

### 3. Check Debug Logs
Open the **Logs** tab in the Ordinex panel and look for lines starting with `[MCB DEBUG]`

**Key things to check:**

1. **After Mission 1 completes**, you should see:
   ```
   [MCB DEBUG] Completed missions: 1 IDs: [mission-1-id]
   ```

2. **After Mission 2 auto-selects**, you should see:
   ```
   [MCB DEBUG] Found 2 mission_selected events
   [MCB DEBUG] Latest selected mission ID: mission-2-id
   ```

3. **Check isRunning logic**:
   ```
   [MCB DEBUG] Mission started event found: false isRunning: false
   ```
   This should be **false** after Mission 1 completes (before Mission 2 starts)

4. **Check final result**:
   ```json
   {
     "current": 2,
     "total": 3,
     "completed": 1,
     "isRunning": false,
     "selectedMission": { "title": "Mission 2 Name" }
   }
   ```

## Expected Behavior

After Mission 1 completes:
1. ✅ `mission_completed` event emitted for Mission 1
2. ✅ Backend auto-selects Mission 2 → `mission_selected` event
3. ✅ UI calls `getMissionProgress()` and detects:
   - `completed: 1`
   - `current: 2` (Mission 2 index)
   - `isRunning: false` (Mission 2 not started yet)
   - `selectedMission: { title: "Mission 2 Name" }`
4. ✅ Bar updates to show:
   - Count: "2/3"
   - Name: "Mission 2 Name"
   - Button: "▶ Start" (enabled)
   - Progress: 33% (1 of 3 complete)

## Possible Root Causes

If it's still not working, likely causes:

### A. Events Not Reaching Webview
- Check if `ordinex:eventsUpdate` message is being sent from extension
- Check if webview is receiving the updated events array

### B. isRunning Logic Bug
The current logic:
```javascript
const missionStartedEvent = events.find(e => 
  e.type === 'mission_started' && 
  e.payload.mission_id === selectedMissionId
);
const isRunning = missionStartedEvent && !completedMissionIds.has(selectedMissionId);
```

**Potential issue**: This uses `.find()` which returns the FIRST `mission_started` event. If Mission 2 was previously started in an earlier run, it might find that old event.

**Fix**: Use `.filter()` to get all mission_started events, then check the latest one.

### C. Auto-Selection Not Happening
- Check if missionExecutor.ts is emitting `mission_selected` after completion
- Verify the mission_id in the event matches one from the breakdown

### D. Render Not Triggering
- Check if `updateMissionControlBar()` is being called
- Verify it's called in the `ordinex:eventsUpdate` message handler

## Test Case Logs to Share

After testing, please share the console logs showing:
1. The full `[MCB DEBUG]` output after Mission 1 completes
2. The full `[MCB DEBUG]` output after Mission 2 auto-selects
3. Any errors in the console

This will help me pinpoint the exact issue and implement the correct fix.
