# Real-Life Changes Implementation Plan

## Goal
After user approves a diff in MISSION mode, apply changes to disk and show them in VS Code editor with checkpoint + rollback support.

## Architecture Rules
- **packages/core** - NO vscode imports, defines interfaces, orchestrates logic
- **packages/extension** - Implements VS Code adapters, wires up UI
- **packages/webview** - Approval UI wiring

## V1 Strategy
- LLM outputs **FULL FILE CONTENT** for create/update (not hunks)
- `unified_diff` is for **display/review only**
- Apply uses `touched_files[].new_content` (complete file content)

## Implementation Phases

### Phase 1: ApprovalManager (Promise-based)
**File:** `packages/core/src/approvalManager.ts`
- [ ] Make `requestApproval()` return `Promise<ApprovalDecision>`
- [ ] Implement `resolveApproval(id, decision)` to resolve promise
- [ ] Add `cancelAllPending(taskId, reason)` for abort/restart
- [ ] Make resolve idempotent (warn if already resolved)

### Phase 2: Core Adapter Interfaces
**File:** `packages/core/src/workspaceAdapter.ts` (NEW)
- [ ] Define `WorkspaceWriter` interface:
  - `applyPatches(patches: FilePatch[]): Promise<void>`
  - `openFilesBeside(paths: string[]): Promise<void>`
- [ ] Define `CheckpointManager` interface:
  - `createCheckpoint(patches): Promise<{checkpointId, files[]}>`
  - `rollback(checkpointId): Promise<{filesRestored[]}>`
- [ ] Define `FilePatch` type:
  ```typescript
  { path: string, action: "create"|"update"|"delete", newContent?: string, baseSha?: string }
  ```

### Phase 3: Update LLM Output Schema
**File:** `packages/core/src/llmEditTool.ts`
- [ ] Update `LLMEditStepOutput` schema:
  ```typescript
  {
    unified_diff: string,
    touched_files: Array<{
      path: string,
      action: "create" | "update" | "delete",
      new_content?: string,  // REQUIRED for create/update
      base_sha?: string
    }>,
    confidence: "low" | "medium" | "high",
    validation_status: "ok" | "stale_context" | "cannot_edit",
    notes?: string
  }
  ```
- [ ] Update system prompt to require full `new_content`
- [ ] Validate `new_content` is present for create/update

### Phase 4: MissionExecutor Integration
**File:** `packages/core/src/missionExecutor.ts`
- [ ] Add `appliedDiffIds: Set<string>` for idempotency
- [ ] Make approval awaitable: `const approval = await requestApproval(...)`
- [ ] Implement `applyApprovedChangeSet(step, patches, diffId)`:
  1. Check idempotency (skip if already applied)
  2. Create checkpoint
  3. Validate staleness (base_sha check)
  4. Apply patches via WorkspaceWriter
  5. Open first file beside
  6. Emit events (checkpoint_created, diff_applied, step_completed)
  7. On error: rollback + emit failure events
- [ ] Handle rejection path (no changes, pause)

### Phase 5: Extension Adapters (VS Code APIs)
**File:** `packages/extension/src/vscodeWorkspaceWriter.ts` (NEW)
- [ ] Implement `WorkspaceWriter`:
  - For create/update: `vscode.workspace.fs.writeFile()`
  - For delete: `vscode.workspace.fs.delete()`
  - Ensure directories exist
  - Refresh open documents, save if dirty
- [ ] Implement `openFilesBeside()` with `ViewColumn.Beside`

**File:** `packages/extension/src/vscodeCheckpointManager.ts` (NEW)
- [ ] Implement checkpoint creation:
  - Store `existedBefore` boolean
  - Store `originalContent` (if existed)
  - Persist to `.ordinex/checkpoints/<id>.json`
- [ ] Implement rollback:
  - If `existedBefore`: restore `originalContent`
  - Else: delete file
  - Return `filesRestored[]`

### Phase 6: Wire Up in Extension
**File:** `packages/extension/src/extension.ts`
- [ ] Create `workspaceWriter` instance
- [ ] Create `checkpointManager` instance  
- [ ] Inject into `MissionExecutor` constructor
- [ ] Export to core package

### Phase 7: Webview Approval Wiring
**File:** `packages/webview/src/components/ApprovalCard.ts`
- [ ] Ensure approve/reject call `resolveApproval(id, {approved})`
- [ ] Add guard against duplicate clicks

## Event Flow
```
approve_diff 
  → approval_resolved {approved: true}
  → checkpoint_created
  → diff_applied
  → step_completed

[ON FAILURE]
  → failure_detected
  → rollback_completed
  → execution_paused
```

## Acceptance Criteria
- [ ] After approval, file content appears on disk
- [ ] Changed file opens beside current editor
- [ ] Reject makes no disk changes
- [ ] Staleness check pauses before apply
- [ ] Apply failure triggers rollback
- [ ] Double-approve doesn't double-apply
- [ ] Create + rollback deletes file
- [ ] Delete + rollback restores file

## Implementation Order
1. Phase 1 (ApprovalManager async)
2. Phase 2 (Core interfaces)
3. Phase 3 (LLM schema update)
4. Phase 5 (Extension adapters - can be parallel)
5. Phase 4 (MissionExecutor integration)
6. Phase 6 (Wire in extension.ts)
7. Phase 7 (Webview wiring)

## Success Criteria
User approves diff → File appears in workspace → Opens beside editor → User sees the change live!
