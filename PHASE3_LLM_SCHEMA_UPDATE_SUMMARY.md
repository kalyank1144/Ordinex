# Phase 3: LLM Schema Update - COMPLETE ✅

## Goal
Update LLM Edit Tool to use V1 Full Content Strategy where `new_content` contains complete file content instead of relying on diff hunks.

## Changes Made

### 1. Updated LLMEditStepOutput Interface
**File:** `packages/core/src/llmEditTool.ts`

**Before:**
```typescript
touched_files: Array<{
  path: string;
  reason: string;
  base_sha: string;
}>
```

**After:**
```typescript
touched_files: Array<{
  path: string;
  action: 'create' | 'update' | 'delete';
  new_content?: string;  // REQUIRED for create/update
  base_sha?: string | null;  // null for newly created files
}>
```

### 2. Updated System Prompt
**Key Changes:**
- Explicitly requires `action` field ("create" | "update" | "delete")
- Mandates `new_content` with **FULL file content** for create/update
- Clarifies that `unified_diff` is **display-only**
- Emphasizes complete file content, not just changes

**Critical Rules Added:**
1. For update: `new_content` = FULL file with changes applied
2. For create: `new_content` = COMPLETE new file
3. For delete: `new_content` = omitted/undefined

### 3. Added Validation Logic
**New Validation:**
- Checks `new_content` presence for create/update actions
- Fails with `schema_error` if missing
- Converts touched_files for legacy diff validation

**Validation Flow:**
```
1. Parse JSON output
2. Check validation_status (ok/stale_context/cannot_edit)
3. Validate new_content presence for create/update ← NEW
4. Validate unified_diff format (display only)
5. Return success/failure
```

## Files Modified
- **packages/core/src/llmEditTool.ts**
  - Updated `LLMEditStepOutput` interface
  - Updated `buildSystemPrompt()` method
  - Added `new_content` validation in `execute()` method
  - Added conversion logic for legacy diff validation

## Build Status
```bash
✅ packages/core: Done in 977ms
✅ packages/webview: Done in 698ms
✅ packages/extension: Done in 524ms
```

## Next Phase
**Phase 4: MissionExecutor Integration** (largest phase)
- Add `appliedDiffIds: Set<string>` for idempotency
- Make approval awaitable
- Implement `applyApprovedChangeSet()`:
  - Create checkpoint
  - Validate staleness
  - Apply patches via WorkspaceWriter
  - Open files beside
  - Emit events
  - Handle errors + rollback

## Impact
- **Breaking Change:** LLM must now return full file content
- **Reliability:** Eliminates hunk application errors
- **Simplicity:** No need to parse/apply hunks - just write content
- **Safety:** Validation ensures new_content is always present

## Testing Notes
After Phase 4-6 implementation, verify:
- LLM returns `new_content` with full file
- Files are written with complete content
- No hunk parsing/application errors
