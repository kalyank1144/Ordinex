# Mission Sequencing Fix

## Problem

When a mission from a breakdown completes successfully (e.g., Mission 1/4), the system gets stuck:
- "Mission Complete ✓ Success" shows
- Bottom banner shows "1/4 Foundation & Setup" with "Running..." status
- System does NOT automatically transition to Mission 2/4
- No "Start Next Mission" button appears
- User is stuck with no way to proceed

## Root Cause

The `MissionRunner` handles ONE mission at a time. When `mission_completed` event is emitted, the runner simply ends - there was no sequencing logic to:
1. Check if more missions exist in the breakdown
2. Auto-select the next mission
3. Emit appropriate events to pause and wait for user to start next mission

## Solution

Added `handleMissionCompletionSequencing` method in `extension.ts` that is called when `mission_completed` event is received:

```typescript
// In eventBus subscription during handleExecutePlan
eventBus.subscribe(async (event) => {
  await this.sendEventsToWebview(webview, taskId);
  
  // CRITICAL: Handle mission completion to trigger next mission in breakdown
  if (event.type === 'mission_completed') {
    await this.handleMissionCompletionSequencing(taskId, webview);
  }
});
```

### Sequencing Logic

The new `handleMissionCompletionSequencing` method:

1. **Finds breakdown** - Checks if there's a `mission_breakdown_created` event
2. **Counts progress** - Counts `mission_completed` events to determine N/M progress
3. **Finds next mission** - Identifies the next mission in the breakdown sequence
4. **Handles completion cases**:
   - If all missions complete → emits `final` event with success message + shows celebration notification
   - If more missions remain → auto-selects next mission + emits `execution_paused` with `awaiting_mission_start`

### Events Emitted

**When more missions remain:**
```json
{
  "type": "mission_selected",
  "payload": {
    "mission_id": "<next_mission_id>",
    "mission_index": 1,
    "total_missions": 4,
    "auto_selected": true,
    "previous_mission_completed": true
  }
}

{
  "type": "execution_paused",
  "payload": {
    "reason": "awaiting_mission_start",
    "description": "Mission 1/4 complete - Ready to start: Create UI Features",
    "next_mission_title": "Create UI Features",
    "progress": "1/4"
  }
}
```

**When all missions complete:**
```json
{
  "type": "final",
  "payload": {
    "success": true,
    "total_missions": 4,
    "completed_missions": 4,
    "message": "All 4 missions completed successfully"
  }
}
```

## Files Changed

1. **packages/extension/src/extension.ts**
   - Added `handleMissionCompletionSequencing` method (~80 lines)
   - Updated eventBus subscription in `handleExecutePlan` to call sequencing handler on `mission_completed`

## UX Flow After Fix

1. Mission 1/4 completes → "Mission Complete ✓ Success"
2. System auto-selects Mission 2/4
3. Bottom banner updates to "2/4 Create UI Features"
4. "Start" button appears
5. User clicks "Start" to begin Mission 2/4
6. Repeat until all 4 missions complete
7. Final celebration: "🎉 All 4 missions completed successfully!"

## Testing

- Build: ✅ Passed
- Mission completion now properly triggers next mission selection
- Progress tracking (N/M) works correctly
- Final completion notification shows when all done

---

# Truncation-Safe Error Display Fix (Additional)

## Problem

When the TruncationSafeExecutor fails (e.g., LLM API error, validation error), the UI only showed generic "Truncation-safe execution failed" without the actual error message.

## Root Cause

1. In `truncationSafeExecutor.ts`, when `executeSingleCall` fails and there are no target files to split, the error message was being lost:
   - `pauseReason` was generic: "Unable to determine target files for split recovery"
   - The actual error from the LLM call was buried in `result.error?.message`

2. In `missionExecutor.ts`, the error message extraction was:
   ```typescript
   const errorMessage = truncationResult.error?.message || 'Truncation-safe execution failed';
   ```
   This ignored the more detailed `pauseReason` field.

## Fix Applied

### 1. truncationSafeExecutor.ts
Now includes the actual error message in pauseReason:
```typescript
const actualErrorMessage = result.error?.message || 'Unknown error';
const pauseReasonWithError = result.truncationDetected 
  ? `Output truncated and unable to split: ${actualErrorMessage}`
  : `LLM edit failed: ${actualErrorMessage}`;

return {
  success: false,
  pauseReason: pauseReasonWithError,
  error: result.error || { type: 'llm_error', message: actualErrorMessage },
  ...
};
```

### 2. missionExecutor.ts
Now prefers pauseReason (which contains the detailed error):
```typescript
const errorMessage = truncationResult.pauseReason || truncationResult.error?.message || 'Truncation-safe execution failed';
```

## Result

Now when an LLM API call fails, the UI will show:
- "LLM edit failed: 401 Unauthorized" (instead of generic "Truncation-safe execution failed")
- "LLM edit failed: Rate limit exceeded" 
- "Output truncated and unable to split: max_tokens"

This helps users understand exactly what went wrong and take appropriate action.
