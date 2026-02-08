# Step 35.4: Scaffold Apply + Evidence + Post-Apply Verify

## Summary

Implemented atomic, rollback-safe scaffold apply functionality with conflict detection, checkpoint-based rollback, and manifest evidence storage. The system ensures files are never overwritten silently and integrates with Step 34's verify/repair infrastructure.

## Files Created/Modified

### New Files

1. **packages/core/src/scaffold/scaffoldApplyManifest.ts**
   - `ScaffoldApplyManifest` interface for tracking apply operations
   - `ManifestFile` interface with SHA256 hashes
   - `computeContentHash()` - SHA256 hash computation
   - `createManifestFile()` - Create manifest entry from file content
   - `writeManifestEvidence()` - Store manifest to evidence directory
   - `loadManifestEvidence()` - Load manifest from evidence
   - `wasScaffoldApplied()` - Replay safety check
   - `generateManifestSummary()` - Human-readable summary
   - `validateManifestIntegrity()` - Post-apply validation

2. **packages/core/src/scaffold/scaffoldConflictCheck.ts**
   - `ConflictReason` type: 'exists' | 'dir_not_empty' | 'outside_workspace'
   - `ScaffoldConflict` interface
   - `ConflictAction` type: 'choose_new_dir' | 'merge_safe_only' | 'replace_all' | 'cancel'
   - `ConflictCheckResult` interface
   - `isInsideWorkspace()` - Path containment check
   - `checkScaffoldConflicts()` - Main conflict detection
   - `buildConflictDecisionOptions()` - UI decision options
   - `buildReplaceConfirmationOptions()` - Second confirmation for destructive ops
   - `filterForMergeSafeOnly()` - Filter files for merge mode
   - `clearDirectoryContents()` - Safe directory cleanup

3. **packages/core/src/scaffold/scaffoldApplyExecutor.ts**
   - `ConflictMode` type
   - `ApplyStage` type: 'precheck' | 'mkdir' | 'write' | 'finalize'
   - `ScaffoldApplyContext` interface
   - `ScaffoldApplyResult` interface
   - `applyScaffoldPlan()` - Main apply function with:
     - Replay safety check
     - Conflict detection
     - Checkpoint creation before writes
     - Atomic file creation
     - Rollback on failure
     - Manifest evidence storage
   - Simple checkpoint implementation for rollback

4. **packages/core/src/__tests__/scaffoldApply.test.ts**
   - Unit tests for conflict detection
   - Unit tests for manifest operations
   - Integration tests for apply executor

### Modified Files

1. **packages/core/src/types.ts**
   - Added new event types:
     - `scaffold_apply_started`
     - `scaffold_conflict_detected`
     - `scaffold_apply_failed`

2. **packages/core/src/eventNormalizer.ts**
   - Added normalization mappings for new scaffold apply events

## Event Schemas

### scaffold_apply_started
```typescript
{
  scaffold_id: string;
  recipe_id: string;
  target_directory: string;
  files_count: number;
  directories_count: number;
}
```

### scaffold_conflict_detected
```typescript
{
  scaffold_id: string;
  target_directory: string;
  conflicts: Array<{ path: string; reason: 'exists'|'dir_not_empty'|'outside_workspace' }>;
  suggested_actions: Array<'choose_new_dir'|'merge_safe_only'|'replace_all'|'cancel'>;
}
```

### scaffold_applied
```typescript
{
  scaffold_id: string;
  recipe_id: string;
  target_directory: string;
  files_created: string[];
  dirs_created: string[];
  manifest_evidence_ref: string;
  checkpoint_id?: string;
  skipped_files?: string[];
}
```

### scaffold_apply_failed
```typescript
{
  scaffold_id: string;
  target_directory: string;
  stage: 'precheck'|'mkdir'|'write'|'finalize';
  error_message: string;
  failed_path?: string;
}
```

### scaffold_completed
```typescript
{
  scaffold_id: string;
  status: 'success'|'failure';
  verify_status?: 'pass'|'fail'|'skipped';
}
```

## Apply Manifest Schema

```typescript
interface ScaffoldApplyManifest {
  scaffold_id: string;
  recipe_id: string;
  target_directory: string;
  created_at: string; // ISO
  files: Array<{
    path: string;      // relative
    sha256: string;    // content hash
    bytes: number;
    mode?: number;
  }>;
  dirs: string[];
  policy_snapshot?: { verify_mode: string; command_mode: string };
  commands_planned?: Array<{ label: string; cmd: string; when: string }>;
  skipped_files?: string[];
  checkpoint_id?: string;
  strategy: 'checkpoint' | 'temp_staging';
  duration_ms: number;
}
```

## Critical Rules Implemented

1. **Approval-Gated**: Only apply after `approval_resolved(approved=true)`
2. **Atomic + Rollback-Safe**: Checkpoint created before writes, restored on failure
3. **No Silent Overwrite**: Conflicts trigger `decision_point_needed`
4. **Replay-Safe**: Check manifest evidence before applying
5. **No Auto Dev Server**: Commands with `when: 'user_explicit'` not auto-run
6. **Post-Apply Verify**: Designed to trigger Step 34 verify phase

## Conflict Resolution Flow

```
1. User approves scaffold proposal
2. applyScaffoldPlan() called
3. Check if already applied (manifest exists) → skip if yes
4. Run conflict check
5. If conflicts:
   a. Emit scaffold_conflict_detected
   b. Emit decision_point_needed with options:
      - Choose Different Folder (recommended)
      - Merge (Skip Existing)
      - Replace All (requires 2nd confirmation)
      - Cancel
   c. Return needsInput=true
6. On user decision:
   - cancel → emit failed, return
   - choose_new_dir → return needsInput for folder picker
   - merge_safe_only → filter files, create only missing
   - replace_all + not confirmed → emit confirm decision
   - replace_all + confirmed → clear dir, create all
7. Create checkpoint
8. Create directories
9. Write files
10. Store manifest evidence
11. Emit scaffold_applied
12. Emit scaffold_completed
13. (Future) Trigger verify phase
```

## Rollback Strategy

Uses simple checkpoint system:
- Before any writes, capture current target directory state
- On any failure during write phase:
  1. Restore checkpoint
  2. Emit checkpoint_restored event
  3. Emit scaffold_apply_failed
  4. Return error result

## Integration Points

- **ScaffoldFlow** (Step 35.1): Call applyScaffoldPlan after approval
- **VerifyPhase** (Step 34): Trigger post-apply verification
- **CommandPhase** (Step 34.5): Run install/build commands
- **MissionFeed**: Render scaffold cards with conflict UI

## Test Coverage

- `isInsideWorkspace()` - path containment
- `checkScaffoldConflicts()` - conflict detection
- `filterForMergeSafeOnly()` - merge mode filtering
- `computeContentHash()` - SHA256 consistency
- `createManifestFile()` - manifest entry creation
- `generateManifestSummary()` - human-readable output
- Replay mode blocks execution
- Conflict detection triggers decision point
- Cancel action handling
- Replace all requires second confirmation

## UI Rendering

Events normalize to `scaffold_card` ui_hint for unified rendering in MissionFeed:
- `scaffold_apply_started` → step_started (kind: scaffold_apply)
- `scaffold_conflict_detected` → decision_point_needed (kind: scaffold_conflict)
- `scaffold_apply_failed` → error_raised (code: SCAFFOLD_APPLY_FAILED)
- `scaffold_applied` → artifact_applied (kind: scaffold)
- `scaffold_completed` → run_completed (kind: scaffold)

## Stop Condition Met

✅ Files created in selected target directory safely
✅ Manifest evidence stored
✅ Verify designed to trigger via Step 34
✅ No dev server auto-run
✅ Conflicts handled via decision points
✅ Replay doesn't write anything
