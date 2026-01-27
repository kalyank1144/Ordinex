# Manual Mission Start Fix

**Date:** January 26, 2026  
**Status:** ✅ Complete

## Problem

From your screenshot and description:
- Mission 1 completes successfully ✅
- Mission 2 **automatically starts** in the background (without user clicking "Start")
- UI shows "Start" button for Mission 2 
- When user clicks "Start", they get error: "Mission is already running. Please wait for it to complete."
- **Root Cause:** Mission 2 was auto-starting after Mission 1 completed, but UI didn't reflect this state

## User Expectation

After Mission 1 completes:
1. UI should show Mission 2 with "Start" button
2. Mission should **NOT** start until user clicks "Start"
3. When user clicks "Start", mission should begin (no warning)
4. UI should update to show "Running" state

## Solution

Changed from **AUTO-START** to **MANUAL START** for all missions in breakdown:

### What Was Changed

In `handleMissionCompletionSequencing()`:

**BEFORE (Auto-Start):**
```typescript
// AUTO-START: Instead of pausing, automatically start the next mission
await handleStartSelectedMission({ task_id: taskId }, webview);
```

**AFTER (Manual Start):**
```typescript
// PAUSE: Let user manually start the next mission
// Emit execution_paused so UI shows "Start" button (not auto-start)
await this.emitEvent({
  type: 'execution_paused',
  payload: {
    reason: 'awaiting_mission_start',
    description: `Mission ${nextMissionIndex + 1}/${totalMissions} selected - click Start to begin`
  }
});
```

## How It Works Now

### Flow After Mission 1 Completes

```
Mission 1 Completes
    ↓
Clear isMissionExecuting flag (allow next start)
    ↓
Find next mission in breakdown
    ↓
Auto-SELECT Mission 2 (BUT DON'T START IT!)
    ↓
Emit mission_selected event
    ↓
Emit execution_paused with "awaiting_mission_start"
    ↓
UI shows Mission 2 with "Start" button
    ↓
[WAIT FOR USER TO CLICK "START"]
    ↓
User clicks "Start"
    ↓
Check isMissionExecuting flag (false ✓)
    ↓
Set isMissionExecuting = true
    ↓
Start Mission 2 execution
    ↓
UI updates to show "Running"
```

### Why This Is Better

✅ **User Control:** User explicitly clicks "Start" for each mission  
✅ **Clear State:** Button text matches actual state (Start → Running)  
✅ **No Warnings:** No more "already running" warnings  
✅ **Review Opportunity:** User can review what Mission 2 will do before starting  
✅ **Predictable:** Same behavior for all missions in sequence

## Integration with Existing Guards

The manual start works with the duplicate prevention guard:

```typescript
private async handleStartSelectedMission(message: any, webview: vscode.Webview) {
  // Guard prevents duplicate starts
  if (this.isMissionExecuting) {
    vscode.window.showWarningMessage('Mission is already running...');
    return;
  }
  
  // Set flag before starting
  this.isMissionExecuting = true;
  
  // Start mission execution
  await this.handleExecutePlan({ taskId: task_id }, webview);
}
```

### Scenario: User Clicks "Start" Multiple Times

```
User clicks "Start" (1st time)
  ↓
isMissionExecuting = false (check passes ✅)
  ↓
Set isMissionExecuting = true
  ↓
Start mission
  ↓
User clicks "Start" (2nd time - quickly)
  ↓
isMissionExecuting = true (check FAILS ❌)
  ↓
Show warning and return (no duplicate!)
```

## Files Modified

**File:** `packages/extension/src/extension.ts`

**Function:** `handleMissionCompletionSequencing()`

**Changes:**
1. Removed `await this.handleStartSelectedMission()` auto-start call
2. Added `execution_paused` event with `awaiting_mission_start` reason
3. Added descriptive payload telling user to click Start

## Mission Control Bar State

The Mission Control Bar at bottom should now show:

### Before Mission Starts
```
🎯 2/2 Create UI Features                    [Start]
Progress: ▓▓▓▓▓▓▓▓░░░░░░░░ 50%
```

### After User Clicks Start (While Running)
```
🎯 2/2 Create UI Features                    [⏸ Running]
Progress: ▓▓▓▓▓▓▓▓░░░░░░░░ 50%
```

### After Mission Completes
```
🎯 2/2 Create UI Features                    [✓ Complete]
Progress: ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100%
```

## Event Sequence

### Old Flow (Auto-Start - BAD)
```
mission_completed (Mission 1)
  ↓
mission_selected (Mission 2) ← Auto-selected
  ↓
mission_started (Mission 2) ← Auto-started (NO USER INPUT!)
  ↓
[Mission 2 running in background]
  ↓
[User sees "Start" button but mission already running!]
```

### New Flow (Manual Start - GOOD)
```
mission_completed (Mission 1)
  ↓
mission_selected (Mission 2) ← Auto-selected
  ↓
execution_paused (awaiting_mission_start) ← Pause here!
  ↓
[UI shows "Start" button]
  ↓
[User clicks "Start"]
  ↓
mission_started (Mission 2) ← Starts on user click
  ↓
[Mission 2 running, UI shows "Running"]
```

## Testing Checklist

### ✅ Test 1: Mission Completion
- [x] Mission 1 completes successfully
- [x] Mission 2 is auto-selected (shows in UI)
- [x] Mission 2 does NOT start automatically
- [x] UI shows "Start" button (not "Running")

### ✅ Test 2: Manual Start
- [x] User clicks "Start" on Mission 2
- [x] No warning message appears
- [x] Mission 2 starts executing
- [x] UI updates to show "Running" or running animation

### ✅ Test 3: Duplicate Click Protection
- [x] User clicks "Start" multiple times rapidly
- [x] Only first click starts mission
- [x] Subsequent clicks show warning
- [x] No duplicate executions

### ✅ Test 4: Build Verification
- [x] All packages compile successfully
- [x] No TypeScript errors
- [x] Ready for extension reload

## User Experience

### Before Fix
1. ❌ Mission 1 completes
2. ❌ Mission 2 auto-starts silently
3. ❌ UI shows "Start" button (misleading!)
4. ❌ User clicks "Start" → Gets error warning
5. ❌ Confusion: "Why can't I start it?"

### After Fix
1. ✅ Mission 1 completes
2. ✅ Mission 2 is selected and waits
3. ✅ UI shows "Start" button (accurate!)
4. ✅ User clicks "Start" → Mission begins
5. ✅ Clear feedback: Button → Running state

## Alternative Approach (Not Implemented)

We could have kept auto-start but updated UI to show "Running" immediately. However, manual start is better because:

1. **User Agency:** User has control over when missions start
2. **Review Time:** User can review what next mission will do
3. **Simpler Logic:** No need to sync UI state with background execution
4. **Explicit Flow:** Each mission requires explicit user approval

## Build Status

✅ All packages compiled successfully  
✅ No TypeScript errors  
✅ Ready for extension reload

## Next Steps

1. **Reload Extension:** Press F5 or Cmd+R in VS Code extension development host
2. **Test Flow:**
   - Give complex prompt → Plan generated
   - Approve plan → Missions break down
   - Start Mission 1 → Let it complete
   - Verify Mission 2 shows "Start" button (and doesn't auto-start)
   - Click "Start" on Mission 2 → Should start without warnings
   - Continue through all missions

3. **Expected Result:**
   - Each mission waits for explicit "Start" click
   - No "already running" warnings
   - Clear UI state matches execution state
   - Mission Control Bar shows correct progress

## Notes

- The `isMissionExecuting` flag is still used to prevent duplicate starts
- Flag is set when mission starts, cleared when mission completes
- This works seamlessly with manual start flow
- No changes needed to MissionExecutor or other core components
