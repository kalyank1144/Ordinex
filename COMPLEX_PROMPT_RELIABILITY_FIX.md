# Complex Prompt Execution Reliability Fix

## Task Overview
Fix critical reliability issues in complex prompt → plan → mission breakdown → execution flow.

## Issues to Fix
1. ❌ Mission Control Bar shows stale state (e.g., "1/4 Running" when Mission 2 is selected)
2. ❌ File edit failures on non-existent files (e.g., `src/server/auth.ts`)
3. ❌ "Fix one, break one" regression cycle due to no E2E tests

## Implementation Phases

### PHASE 1: Mission Control Bar State Derivation ✅
**Files Modified:**
- `packages/webview/src/index.ts` - Fix getMissionProgress()

**Changes:**
- ✅ Use LATEST mission_selected event (not first with .find())
- ✅ Compute derived state from event stream
- ✅ Fix isRunning logic (check if current mission started AND not completed/paused)
- ✅ Add edge case handling (no missions, missing selection, invalid mission ID)
- ✅ Ensure bar updates on: mission_selected, mission_started, mission_completed, execution_paused

### PHASE 2: Edit Execution Robustness
**Files Modified:**
- `packages/core/src/excerptSelector.ts` - Add file existence check
- `packages/core/src/missionExecutor.ts` - Improve error handling
- `packages/core/src/truncationSafeExecutor.ts` - Better error messages
- `packages/extension/src/vscodeWorkspaceWriter.ts` - Auto-create directories

**Changes:**
- [ ] Add explicit exists=true/false classification before edit
- [ ] Auto-create parent directories for create operations
- [ ] Improve error messages with exact failure reason
- [ ] Add decision_point_needed for non-retryable errors

### PHASE 3: Mission Sequencing Safety
**Files Modified:**
- `packages/core/src/missionExecutor.ts` - Auto-select next mission
- `packages/extension/src/extension.ts` - Emit mission_selected event

**Changes:**
- [ ] After mission_completed, auto-emit mission_selected for next mission
- [ ] Only auto-select if no pending approval/decision point
- [ ] Trigger immediate UI update

### PHASE 4: E2E Regression Test
**Files Created:**
- `packages/core/src/__tests__/complexPromptFlow.test.ts`

**Coverage:**
- [ ] Complex prompt → plan → breakdown → mission 1 → mission 2
- [ ] Assert mission control bar state at each transition
- [ ] Include edit step with non-existent file
- [ ] Assert error messages are actionable

## Success Criteria
- ✅ Mission control bar always shows current mission (no stale "1/4")
- [ ] Edit pipeline handles missing files robustly
- [ ] No impossible retry loops
- [ ] Actionable error messages
- [ ] E2E test prevents regressions
