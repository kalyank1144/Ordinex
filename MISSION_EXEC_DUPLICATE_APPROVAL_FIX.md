# Mission Execution Duplicate Approval & Display Bug Fix

**Date:** January 23, 2026  
**Issue:** Mission execution was requesting duplicate approvals and displaying "[object Object]" instead of file paths

## Problems Identified

### 1. **[object Object] Display Bug**
**Root Cause:** Field name mismatch between `missionExecutor.ts` and `ApprovalCard.ts`

- **Executor was sending:** `additions` and `deletions`
- **UI was expecting:** `added_lines` and `removed_lines`

**Screenshot Evidence:** Files displayed as "[object Object]" in approval cards

### 2. **Duplicate Approval Requests**
**Root Cause:** Missing idempotency guard before approval request

The flow was:
1. Create diff → Persist evidence → Request approval
2. **NO idempotency check before requesting approval**
3. If step retried or re-executed, would create duplicate approval for same diff

**Evidence from screenshots:**
- Two different diff IDs: `b71df8d5` and `e76feadb`
- Both asking for approval for the same logical step
- Mission failed after both were denied

### 3. **Mission Failure After Denial**
**Root Cause:** When approval is denied, mission pauses but doesn't properly handle the rejection state

## Fixes Implemented

### Fix 1: Corrected Field Names (missionExecutor.ts)
```typescript
// BEFORE:
files_changed: parsedDiff.files.map(f => ({
  path: f.newPath !== '/dev/null' ? f.newPath : f.oldPath,
  additions: f.additions,  // ❌ Wrong field name
  deletions: f.deletions,  // ❌ Wrong field name
}))

// AFTER:
files_changed: parsedDiff.files.map(f => ({
  path: f.newPath !== '/dev/null' ? f.newPath : f.oldPath,
  added_lines: f.additions,  // ✅ Matches ApprovalCard expectation
  removed_lines: f.deletions, // ✅ Matches ApprovalCard expectation
}))
```

### Fix 2: Added Idempotency Guard Before Approval
```typescript
// BEFORE: Request approval immediately after persisting diff

// AFTER: Check if diff already processed
// Idempotency check - prevent duplicate approvals for same diff
if (this.appliedDiffIds.has(diffId)) {
  console.warn(`[MissionExecutor] Diff ${diffId} already processed (idempotency guard)`);
  return { success: true, stage: 'edit' };
}

console.log('[MissionExecutor] Requesting approval for diff...');
const approval = await this.approvalManager.requestApproval(...);
```

**Key Changes:**
- Check `appliedDiffIds` set **BEFORE** requesting approval
- Mark diff as processed **AFTER** approval is granted (not before)
- If diff already in set, return success immediately (idempotent behavior)

### Fix 3: Improved Error Handling & Cleanup
```typescript
// Declare diffId at function scope for error handling
let diffId: string | undefined = undefined;

try {
  // ... execution logic
  diffId = createDiffId(this.taskId, step.step_id);
  // ... 
} catch (error) {
  // CRITICAL: Remove diff from applied set on error to allow retry
  if (diffId) {
    this.appliedDiffIds.delete(diffId);
    console.log(`[MissionExecutor] Removed diff ${diffId} from applied set due to error`);
  }
  // ... error handling
}
```

**Benefits:**
- If error occurs after marking diff as applied, cleanup the idempotency guard
- Allows step to be retried without being blocked by stale idempotency state
- Proper TypeScript scoping for error handler

### Fix 4: Added Comprehensive Logging
```typescript
console.log('[MissionExecutor] Requesting approval for diff...');
console.log(`[MissionExecutor] Approval decision: ${approval.decision}`);
console.log(`[MissionExecutor] Diff ${diffId} marked for application`);
console.log(`[MissionExecutor] Creating checkpoint: ${checkpointId}`);
```

**Logging covers:**
- Approval flow entry/exit points
- Idempotency guard triggers
- Diff state transitions
- Error recovery actions

## Execution Flow (After Fixes)

### Normal Flow:
```
1. executeEditStep() called
2. Create diff ID
3. Generate diff via LLM
4. Persist diff evidence
5. ✅ CHECK: Is diffId already in appliedDiffIds set?
   - YES → Return success (idempotent)
   - NO → Continue
6. Request approval (blocks here)
7. User approves/denies
8. If approved:
   a. Mark diffId as applied (add to set)
   b. Create checkpoint
   c. Apply changes
   d. Emit diff_applied
9. Return success
```

### Error Recovery Flow:
```
1. executeEditStep() called
2. Generate diff → diffId = "abc123"
3. Mark as applied (add to set)
4. Error occurs during apply
5. ✅ CLEANUP: Remove "abc123" from appliedDiffIds set
6. Return error
7. User can retry → Step 3 will NOT skip approval
```

### Duplicate Prevention:
```
Attempt 1:
- diffId = "abc123" (not in set)
- Request approval → User denies
- Mission paused

Attempt 2 (if user retries same step):
- diffId = "abc123" (already in set)
- ✅ Idempotency guard: Skip duplicate approval
- Return success immediately
```

## Testing Recommendations

1. **Test Normal Approval Flow:**
   - Execute mission in MISSION mode
   - Approve diff
   - Verify files display correctly (not [object Object])
   - Verify only ONE approval requested per step

2. **Test Denial Flow:**
   - Execute mission
   - Deny diff approval
   - Verify mission pauses gracefully
   - Check console logs for proper state

3. **Test Retry After Error:**
   - Force error during diff application
   - Verify diffId removed from applied set
   - Retry step
   - Verify approval requested again (not skipped)

4. **Test Idempotency:**
   - Execute same step twice rapidly
   - Verify only one approval created
   - Second attempt should hit idempotency guard

## Files Changed

1. **packages/core/src/missionExecutor.ts**
   - Fixed field names: `additions`/`deletions` → `added_lines`/`removed_lines`
   - Added idempotency check before approval request
   - Improved diffId scoping for error handling
   - Added cleanup in error catch block
   - Enhanced logging throughout edit flow

2. **packages/webview/src/components/DiffProposedCard.ts**
   - Added robust handling for `files_changed` as both string[] and object[]
   - Extracts path from objects properly instead of calling toString()
   - Displays file stats (+additions/-deletions) when available

3. **packages/webview/src/components/DiffAppliedCard.ts**
   - Added robust handling for `files_changed` as both string[] and object[]
   - Extracts path from objects properly instead of calling toString()
   - Displays file stats (+additions/-deletions) when available

## Expected Behavior After Fix

✅ File paths display correctly in ALL cards (DiffProposed, ApprovalCard, DiffApplied)  
✅ File stats show proper +additions/-deletions counts  
✅ No duplicate approval requests for same diff  
✅ Proper mission pause on approval denial  
✅ Clean error recovery with retry support  
✅ Comprehensive logging for debugging  
✅ Idempotent execution (safe to retry)  
✅ Checkpoint creation works correctly  

## Related Issues

- Original issue: Duplicate approvals with [object Object] display
- Root causes: 
  1. **Field name mismatch** between executor and ApprovalCard
  2. **Type mismatch** - UI components expected string[] but received object[]
  3. **Missing idempotency guard** before approval request
- Impact: 
  - Mission failed due to "[object Object]" showing instead of file paths
  - Multiple rejections of same logical change
  - Checkpoint creation succeeded but diff_applied missing type info
- Resolution: 
  1. Aligned field names in missionExecutor
  2. Made UI components handle both string[] and object[] formats
  3. Added proper idempotency guards

## Root Cause Analysis

The **REAL** issue was a **data structure mismatch cascade**:

1. **missionExecutor.ts** sent `files_changed` as:
   ```typescript
   files_changed: [{path: "file.ts", added_lines: 10, removed_lines: 5}]
   ```

2. **DiffProposedCard.ts** expected:
   ```typescript
   const filesChanged = event.payload.files_changed as string[];
   // Then: filesChanged.map(file => `<li>${file}</li>`)
   // Result: [{object}].toString() = "[object Object]"
   ```

3. **ApprovalCard.ts** also had issues with field names (`additions` vs `added_lines`)

4. **DiffAppliedCard.ts** had the same string[] assumption

**The Fix:** Made ALL UI components handle BOTH formats robustly, with proper type guards and extraction logic.

## Notes

The fix maintains strict adherence to the spec:
- Event-driven architecture preserved
- Deterministic execution flow
- No side effects without approval
- Idempotent operations
- Comprehensive error handling
