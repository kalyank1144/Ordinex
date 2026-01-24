# Real MISSION EDIT Execution Implementation

## Summary

Implemented spec-compliant MISSION EDIT execution with:
- **Unified diff format** from LLM (not simple patches)
- **SHA-256 base_sha validation** for staleness detection
- **Deterministic excerpt selection** for file context
- **Atomic apply with rollback** using temp files
- **Evidence persistence** with .diff and .manifest.json files
- **Comprehensive validation pipeline** (parse, safety, sha_match, scope)

## Files Changed

### New Files Created (6)
1. **`packages/core/src/unifiedDiffParser.ts`**
   - Parse unified diff format
   - Validate diff structure (safety, scope)
   - Apply diff hunks to file content
   - Generate unified diff from content changes

2. **`packages/core/src/shaUtils.ts`**
   - Compute SHA-256 hash (12 char truncated)
   - Staleness detection utilities
   - Batch SHA computation

3. **`packages/core/src/excerptSelector.ts`**
   - Deterministic file selection (retrieval > open editors > fallback)
   - Excerpt extraction (imports, exports, keyword matches)
   - Line budget management (max 6 files, 400 lines)
   - Evidence generation for context selection

4. **`packages/core/src/atomicDiffApply.ts`**
   - Checkpoint creation before apply
   - Stale check immediately before apply
   - Atomic apply using temp files → rename
   - Rollback on failure

5. **`packages/core/src/llmEditTool.ts`**
   - `llm_edit_step` tool implementation
   - Spec-compliant system prompt
   - Strict JSON output validation
   - Diff validation against constraints

6. **`packages/core/src/editEvidenceManager.ts`**
   - Write .diff files (raw unified diff)
   - Write .manifest.json (validation report, stats)
   - Write .apply.json (apply evidence)
   - Evidence directory management

### Modified Files (2)
1. **`packages/core/src/missionExecutor.ts`**
   - Added imports for new modules
   - Rewrote `executeEditStep()` with spec-compliant flow

2. **`packages/core/src/index.ts`**
   - Added exports for all new modules

## Event Flow (Per Spec)

```
step_started
→ stage_changed { stage: "edit" }
→ tool_start { tool: "llm_edit_step" }
→ tool_end { tool: "llm_edit_step", status: "success" | "failed" }
→ diff_proposed { diff_id, files_changed, summary, evidence_id }
→ approval_requested { approval_id, type: "apply_diff", diff_id }
→ approval_resolved { approval_id, approved: true | false }

IF APPROVED:
→ checkpoint_created { checkpoint_id, files }
→ diff_applied { diff_id, files_changed, evidence_id }
→ step_completed

IF REJECTED:
→ execution_paused { reason: "diff_rejected", diff_id }

IF FAILED:
→ failure_detected { reason: "...", details }
→ execution_paused { reason: "needs_user_decision" }
```

## Validation Pipeline

| Check | Description | Failure Event |
|-------|-------------|---------------|
| Parse | Valid unified diff format | `failure_detected { reason: "invalid_diff_format" }` |
| Safety | No create/delete/rename/mode | `failure_detected { reason: "unsafe_diff" }` |
| SHA Match | LLM base_sha matches sent | `failure_detected { reason: "sha_mismatch" }` |
| Scope | max_files=3, max_changed_lines=100 | `failure_detected { reason: "scope_violation" }` |
| Empty | Non-empty diff | `failure_detected { reason: "empty_diff" }` |
| Stale | SHA unchanged before apply | `failure_detected { reason: "stale_context" }` |
| Hunk | Context lines match | `failure_detected { reason: "hunk_mismatch" }` |

## Evidence Files

```
.ordinex/evidence/
├── diff_<taskId>_<stepId>_<timestamp>.diff       # Raw unified diff
├── diff_<taskId>_<stepId>_<timestamp>.manifest.json  # Validation report
├── diff_<taskId>_<stepId>_<timestamp>.apply.json     # Apply result
└── context_<stepId>_<timestamp>.json              # Context selection
```

## LLM Output Schema

```json
{
  "unified_diff": "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -10,7 +10,8 @@\n...",
  "touched_files": [
    { "path": "src/foo.ts", "reason": "Renamed function", "base_sha": "abc123def456" }
  ],
  "confidence": "low" | "medium" | "high",
  "notes": "Short summary",
  "validation_status": "ok" | "stale_context" | "cannot_edit"
}
```

## Default Constraints

```typescript
{
  max_files: 3,
  max_changed_lines: 100,
  forbid_create: true,
  forbid_delete: true,
  forbid_rename: true
}
```

## Acceptance Test Matrix

| Test | Scenario | Expected Behavior |
|------|----------|-------------------|
| A | Basic edit happy path | tool_start/tool_end → diff_proposed → approval → checkpoint → diff_applied |
| B | Invalid diff from LLM | failure_detected { reason: "invalid_diff_format" } → execution_paused |
| C | Scope limit (files) | failure_detected { reason: "scope_violation", type: "max_files" } |
| D | Scope limit (lines) | failure_detected { reason: "scope_violation", type: "max_changed_lines" } |
| E | User rejects diff | execution_paused { reason: "diff_rejected" } |
| F | Stale file detection | failure_detected { reason: "stale_context" } |
| G | Partial apply rollback | failure_detected { reason: "hunk_mismatch", rollback: "success" } |
| H | Empty diff | failure_detected { reason: "empty_diff" } |

## Hard Constraints Respected

✅ Did NOT change ANSWER mode
✅ Did NOT change PLAN mode pipeline
✅ Did NOT change existing event store schema
✅ Reused existing approval infrastructure
✅ Reused existing Mission timeline UI structure
✅ No silent edits - changes only after explicit approval

## Build Status

✅ `pnpm run build` - All packages compile successfully
