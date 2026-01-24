# Real-Life Changes Implementation Progress

## ✅ Completed Phases

### Phase 1: ApprovalManager (Promise-based) ✅
- Made `resolveApproval()` idempotent (warns instead of throws)
- Added `cancelAllPending(taskId, reason)` for abort/restart
- Already had Promise-based `requestApproval()` - no changes needed!

**Files Modified:**
- `packages/core/src/approvalManager.ts`

### Phase 2: Core Adapter Interfaces ✅
- Created `packages/core/src/workspaceAdapter.ts` with:
  - `FilePatch` type
  - `WorkspaceWriter` interface
  - `CheckpointManager` interface (renamed to avoid conflict with existing)
  - `CheckpointResult`, `RollbackResult` types
- Exported from `packages/core/src/index.ts`
- NO vscode imports - pure interfaces

**Files Created:**
- `packages/core/src/workspaceAdapter.ts`

**Files Modified:**
- `packages/core/src/index.ts`

## 🚧 In Progress

### Phase 3: Update LLM Output Schema
**Current Schema:**
```typescript
touched_files: Array<{
  path: string;
  reason: string;
  base_sha: string;
}>
```

**Needed Schema (V1 full content):**
```typescript
touched_files: Array<{
  path: string;
  action: "create" | "update" | "delete";
  new_content?: string;  // REQUIRED for create/update
  base_sha?: string;
}>
```

**Changes Needed:**
1. Update `LLMEditStepOutput` interface in `llmEditTool.ts`
2. Update system prompt to require full `new_content`
3. Update validation in `parseOutput()` to check `new_content` presence
4. Update diff validation logic

**File to Modify:**
- `packages/core/src/llmEditTool.ts`

## 📋 Remaining Phases

### Phase 4: MissionExecutor Integration
- Add `appliedDiffIds: Set<string>` for idempotency
- Make approval awaitable
- Implement `applyApprovedChangeSet()`:
  - Checkpoint creation
  - Staleness validation
  - Apply patches via WorkspaceWriter
  - Open files beside
  - Emit events
  - Error handling + rollback

**File to Modify:**
- `packages/core/src/missionExecutor.ts`

### Phase 5: Extension Adapters (VS Code APIs)
**Files to Create:**
- `packages/extension/src/vscodeWorkspaceWriter.ts`
- `packages/extension/src/vscodeCheckpointManager.ts`

### Phase 6: Wire Up in Extension
**File to Modify:**
- `packages/extension/src/extension.ts`

### Phase 7: Webview Approval Wiring
**File to Modify:**
- `packages/webview/src/components/ApprovalCard.ts`

## 🎯 Success Criteria
- [ ] Files appear on disk after approval
- [ ] Changed file opens beside editor
- [ ] Reject makes no disk changes
- [ ] Staleness check pauses before apply
- [ ] Apply failure triggers rollback
- [ ] Double-approve doesn't double-apply
- [ ] Create + rollback deletes file
- [ ] Delete + rollback restores file

## 📊 Progress: 2/7 Phases Complete (29%)

Next: Continue Phase 3 - Update LLM schema for full content strategy
