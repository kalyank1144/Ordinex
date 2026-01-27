# Mission Completion & Sequencing Fix

## Problem
After completing the first mission in a multi-mission breakdown, the UI showed "Running..." indefinitely instead of prompting the user to start the next mission. The system appeared stuck and provided no way to continue.

## Root Cause
The `completeMission()` function in `MissionExecutor` was emitting a `final` event instead of `mission_completed`. The mission sequencing logic expects the `mission_completed` event to trigger the flow that prompts the user to select the next mission.

## Solution

### 1. Fixed Mission Completion Event (`packages/core/src/missionExecutor.ts`)

**Before:**
```typescript
private async completeMission(): Promise<void> {
  await this.emitEvent({
    type: 'final',  // ❌ Wrong event type
    payload: {
      success: true,
      status: 'complete',
      completed_steps: this.executionState?.completedSteps.length || 0,
      total_steps: this.executionState?.plan.steps.length || 0,
    },
  });
}
```

**After:**
```typescript
private async completeMission(): Promise<void> {
  // Emit mission_completed to trigger sequencing to next mission
  await this.emitEvent({
    type: 'mission_completed',  // ✅ Correct event type
    payload: {
      mission_id: this.executionState?.plan.goal || this.taskId,
      success: true,
      completed_steps: this.executionState?.completedSteps.length || 0,
      total_steps: this.executionState?.plan.steps.length || 0,
      goal: this.executionState?.plan.goal || '',
    },
  });
}
```

### 2. Enhanced Error Display (Previous Fix)

Also improved error propagation to show actual error messages instead of generic "Error occurred":
- Added detailed error logging in step failure handlers
- Enhanced `failure_detected` event payload with `error_details` and `error_type`
- Improved console logging for debugging

## Expected Behavior After Fix

### Mission Completion Flow:
1. ✅ **Mission Executes**: All steps in Mission 1 complete successfully
2. ✅ **Mission Completed Event**: `mission_completed` event is emitted
3. ✅ **UI Updates**: Shows "Mission Complete ✓ Success"
4. ✅ **Next Mission Prompt**: MissionRunner catches the event and prompts user to select next mission
5. ✅ **User Selection**: User clicks "🚀 Select This Mission" on Mission 2
6. ✅ **Continues Execution**: Mission 2 starts automatically

### Multi-Mission Flow Example:
```
Plan (8 steps) → Breakdown into 3 missions:

Mission 1: Foundation & Setup (3 steps)
  → Execute → Complete ✓ 
  → Prompt: "Select next mission"

Mission 2: Implement UI Features (4 steps)  
  → User clicks "Select" → Execute → Complete ✓
  → Prompt: "Select next mission"

Mission 3: Testing & Polish (1 step)
  → User clicks "Select" → Execute → Complete ✓
  → All missions done → Show success summary
```

## Testing Instructions

1. **Reload Extension**: Press **F5** in VS Code (or **Cmd+R** if Extension Development Host is already running)

2. **Test Multi-Mission Flow**:
   - Create a complex plan (6+ steps) that will be broken down into multiple missions
   - Approve the plan → Approve breakdown
   - Let Mission 1 complete fully
   - **Verify**: UI should show "Mission Complete" and buttons to select next mission
   - Click "🚀 Select This Mission" on Mission 2
   - **Verify**: Mission 2 starts automatically
   - Repeat until all missions complete

3. **Check Console Logs**:
   - Open **Help > Toggle Developer Tools**
   - Look for: `[MissionExecutor] Mission completed successfully`
   - Verify `mission_completed` events are emitted

## Files Changed
- `packages/core/src/missionExecutor.ts` - Fixed `completeMission()` to emit correct event type
- `MISSION_COMPLETION_FIX.md` - This documentation

## Related Issues Fixed
- ✅ Mission completion not triggering next mission selection
- ✅ UI stuck showing "Running..." after mission completes
- ✅ No user action available after first mission
- ✅ Error messages now show actual errors instead of generic "Error occurred"

## Architecture Notes

**Event Flow for Mission Sequencing:**
```
MissionExecutor.completeMission()
  └─> Emits: mission_completed
      └─> MissionRunner catches event
          └─> Checks if more missions remain
              ├─> Yes: Emit mission_selection_required
              │   └─> UI shows mission selection cards
              │       └─> User selects → Starts next mission
              └─> No: Emit final (all done)
                  └─> UI shows success summary
```

The `mission_completed` event is the critical signal that allows the system to sequence through multiple missions while maintaining user control and approval gates.
