# Complex Prompt Execution Flow Fix

## Issues Fixed

### 1. ❌ Duplicate Failure Events (FIXED ✅)
### 2. ❌ Vague Error Messages (FIXED ✅)

---

## Issue 1: Duplicate Failure Events
**Problem:** When a step failed during mission execution, you saw:
- "Failure Detected: Error occurred"
- "Step Failed: Step 4: Step execution failed"  
- "Failure Detected: Step execution failed"
- "Execution Paused: needs_user_decision"

**Root Cause:** In `missionExecutor.ts`, when `executeStep()` failed:
1. `executeStep()` emitted `failure_detected` + `step_failed` events with detailed error
2. Then `executeStepsSequentially()` called `pauseOnFailure()` 
3. `pauseOnFailure()` emitted ANOTHER `failure_detected` + `execution_paused` with generic "Error occurred"
4. Result: Duplicate failure events, real error message hidden

**Fix Applied:** In `executeStepsSequentially()`:
```typescript
// BEFORE (BROKEN):
if (!result.success) {
  await this.pauseOnFailure(result.error || 'Step execution failed');
  return;
}

// AFTER (FIXED):
if (!result.success) {
  // executeStep() already emitted failure_detected and step_failed
  // Just stop execution here, don't emit duplicate failure events
  console.log('[MissionExecutor] Step failed, stopping execution:', result.error);
  this.executionState.isPaused = true;
  return;
}
```

**Result:** Now only ONE set of failure events per failure, with the actual detailed error message preserved.

---

## Issue 2: Vague Error Messages

**Problem:** When file editing failed, you saw:
- "Failure Detected: 1 file(s) failed after maximum retries"
- "Step Failed: Step 4: 1 file(s) failed after maximum retries: src/pages/"

BUT it didn't tell you WHY the file failed! The actual error was hidden.

**Root Cause:** In `truncationSafeExecutor.ts` → `executeSplitByFile()`:
- When files failed, it collected detailed errors per file
- But the error message shown to users was generic: "Failed to process: file.tsx"
- The actual LLM errors (JSON parse error, truncation, validation, etc.) were in the `details` but not in the message

**Fix Applied:**
```typescript
// BEFORE (VAGUE):
pauseReason: `Failed to process: ${failed.map(f => f.path).join(', ')}`

// AFTER (DETAILED):
const failedDetails = failed.map(f => 
  `${f.path}: ${f.lastError || 'Unknown error'}`
).join('; ');
const fullErrorMsg = `${summaryMsg}: ${failedDetails}`;
pauseReason: fullErrorMsg
```

**Result:** Now you see the ACTUAL error for each failed file:
- "1 file(s) failed after maximum retries: src/pages/Settings.tsx: Missing complete:true sentinel"
- "2 file(s) failed: src/auth.ts: JSON parse failed; src/utils.ts: Truncated: max_tokens"

Users can now understand what went wrong and fix it!

---

### 3. ❌ Mission Control Bar Not Updating (DEBUG ADDED 🔍)
**Problem:** After Mission 1 completes and auto-selects Mission 2:
- Bottom bar still shows "1/4 Foundation & Setup"
- Still shows "⏳ Running..." instead of "▶ Start"
- Doesn't update to "2/4" with Mission 2 name

**Debug Logging Added:** Added 10+ console logs to `getMissionProgress()` in `packages/webview/src/index.ts` to trace:
- Event count
- Mission count
- Number of `mission_selected` events
- Latest selected mission ID and title
- Completed mission count
- `isRunning` calculation
- Final progress object returned

**Next Step:** Test with a complex prompt and check the **Logs tab** for `[MCB DEBUG]` output. This will reveal:
- Are events reaching the webview?
- Is Mission 2 being auto-selected?
- Is `isRunning` being calculated correctly?
- Is the render function being called?

See **MISSION_CONTROL_BAR_DEBUG.md** for detailed diagnostic instructions.

---

## Files Modified

1. **packages/core/src/missionExecutor.ts**
   - Removed duplicate failure event emission
   - Fixed `executeStepsSequentially()` to respect events already emitted by `executeStep()`

2. **packages/webview/src/index.ts**
   - Added comprehensive debug logging to `getMissionProgress()`
   - Logs help diagnose Mission Control Bar update issues

## Testing Instructions

1. **Reload Extension**
   - Press F5 or Command Palette → "Developer: Reload Window"

2. **Test Complex Prompt Flow**
   - Enter complex prompt in PLAN mode
   - Approve plan
   - Switch to MISSION mode
   - Start Mission 1
   - Approve each step
   - **WATCH**: After Mission 1 completes, check if Mission Control Bar updates

3. **Check Debug Logs**
   - Click **Logs** tab in Ordinex panel
   - Look for `[MCB DEBUG]` lines
   - Check `[MissionExecutor]` lines for execution flow

4. **Expected Behavior After Fix**
   - ✅ No duplicate "Error occurred" failure events
   - ✅ Step failures show actual detailed error message
   - ✅ Only ONE `failure_detected` + `step_failed` pair per failure
   - 🔍 Mission Control Bar update (pending diagnosis from debug logs)

## Why This Matters

**Before Fix:**
- Real errors were hidden by generic "Error occurred" messages
- Duplicate events cluttered the timeline
- Hard to debug what actually went wrong

**After Fix:**
- Clear, detailed error messages
- Clean event timeline
- Easy to understand and fix failures
- Proper pause/resume flow

## Open Item

Mission Control Bar sequencing still needs verification with debug logs. Once you test and share the `[MCB DEBUG]` output, I can implement the final fix for mission progression.
