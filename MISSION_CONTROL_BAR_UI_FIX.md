# Mission Control Bar UI Update Fix

**Date:** January 26, 2026  
**Status:** ✅ Complete

## Problem

From your screenshot and feedback:
- Mission 1 completes successfully ✅
- User clicks "Start" on Mission 2
- **Mission IS running** in the background (backend working correctly)
- **UI NOT updating** - Still shows "Start" button instead of "Running" state
- Mission Control Bar icon (🚀 2/2) not showing loading animation

## Root Cause

The `isPaused` logic in `getMissionProgress()` was **incorrectly detecting the mission as paused** even after it started running.

### The Bug

```javascript
// BEFORE (Buggy Logic)
const lastExecutionPausedEvent = [...events].reverse().find(e => 
  e.type === 'execution_paused' || e.type === 'mission_paused'
);
const isPaused = lastExecutionPausedEvent && 
  !events.slice(events.indexOf(lastExecutionPausedEvent) + 1)
    .some(e => e.type === 'execution_resumed' || e.type === 'mission_started');
```

**Why it failed:**
1. Mission 1 completes → emits `execution_paused` (for awaiting next mission)
2. User clicks "Start" on Mission 2 → emits `mission_started`
3. But `isPaused` logic found the OLD pause event (from Mission 1 completion)
4. It checked if `mission_started` came after the pause, but didn't check if it was for the SAME mission
5. Result: `isPaused = true` even though Mission 2 is actively running!

## Solution

Changed the logic to **only check pause events that occur AFTER the mission started**:

```javascript
// AFTER (Fixed Logic)
// Check if mission started for the SELECTED mission
const missionStartedEvents = events.filter(e => 
  e.type === 'mission_started' && 
  e.payload?.mission_id === selectedMissionId
);
const hasMissionStarted = missionStartedEvents.length > 0;
const lastMissionStarted = missionStartedEvents[missionStartedEvents.length - 1];

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
```

### Key Improvements

1. **Mission-Specific Check:** Only look at `mission_started` events for the SELECTED mission
2. **Temporal Scoping:** Only check pause events that occurred AFTER the mission started
3. **Proper State Calculation:** `isRunning = started AND not completed AND not paused`

## Event Flow Example

### Scenario: Mission 1 → Mission 2

```
[Mission 1 completes]
  execution_paused (reason: awaiting_mission_start)
  mission_selected (Mission 2)
  
[User clicks Start]
  mission_started (Mission 2) ← START INDEX for pause checking
  step_started
  stage_changed → edit
  
[Check isPaused]
  ✓ Find mission_started for Mission 2 at index 10
  ✓ Look at events AFTER index 10 (sliced events)
  ✓ No execution_paused found after mission_started
  ✓ Result: isPaused = false
  ✓ Result: isRunning = true
```

## UI States

### Before Fix
```
[Mission running in background]
UI shows: "▶ Start" button (misleading!)
Icon: 🚀 (static, no animation)
```

### After Fix
```
[Mission running in background]
UI shows: "⏳ Running..." button (disabled)
Icon: 🔄 (spinning animation)
Bar: Blue pulsing border
```

## Files Modified

**File:** `packages/webview/src/index.ts`

**Function:** `getMissionProgress()` 

**Changes:**
1. Added mission-specific filtering for `mission_started` events
2. Changed pause detection to only check events AFTER mission started
3. Properly scoped temporal logic to avoid cross-mission contamination

## Build Status

✅ All packages compiled successfully  
✅ No TypeScript errors  
✅ Ready for extension reload

## Testing Steps

1. **Reload Extension:** Press F5 in extension development host
2. **Test Flow:**
   - Give complex prompt → Plan generated
   - Approve plan → Missions break down (2 missions)
   - Start Mission 1 → Let it complete
   - Mission 2 auto-selected, shows "Start" button
   - **Click "Start" on Mission 2**
   - **Verify UI updates:**
     - Button changes to "⏳ Running..."
     - Icon changes to 🔄 with spinning animation
     - Border pulses blue
   - Mission 2 completes
   - **Verify completion state:**
     - Button changes to "✓ Done"
     - Icon changes to 🎉
     - Progress bar fills to 100%

## Expected Results

✅ **Start Button → Running State:** UI immediately reflects when mission starts  
✅ **Loading Animation:** Icon spins during execution  
✅ **Visual Feedback:** Border pulses to indicate active state  
✅ **No False Pause Detection:** Old pause events don't affect new missions  
✅ **Proper State Transitions:** Start → Running → Complete

## Technical Details

### State Machine

```
Mission Selected (not started)
  ↓ [User clicks Start]
isRunning = false, isPaused = false
Button: "▶ Start"
Icon: 🚀 (static)
  
Mission Running
  ↓ [mission_started event]
isRunning = true, isPaused = false
Button: "⏳ Running..." (disabled)
Icon: 🔄 (spinning)
Bar: Blue pulsing animation
  
Mission Paused (if pause event after start)
  ↓ [execution_paused event AFTER start]
isRunning = false, isPaused = true
Button: "⏸️ Paused"
Icon: ⏸️ (static)
  
Mission Completed
  ↓ [mission_completed event]
isRunning = false, isPaused = false
Button: "✓ Done" or "▶ Start" (next mission)
Icon: ✅ or 🚀 (next mission)
```

### Edge Cases Handled

1. **Multiple Missions:** Each mission tracks its own start/pause state
2. **Rapid Clicks:** Duplicate prevention still works (separate guard)
3. **Late UI Updates:** Events processed in order, state always consistent
4. **Cross-Mission Contamination:** Pause events from previous missions don't affect current mission

## Related Fixes

This fix builds on previous work:
- `DUPLICATE_MISSION_START_FIX.md` - Prevents duplicate starts
- `MANUAL_MISSION_START_FIX.md` - Ensures user clicks Start manually

All three fixes work together to provide a robust mission execution UX.
