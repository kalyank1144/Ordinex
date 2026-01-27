# Truncation-Safe Execution Wiring - Phase 1 Complete

## Summary
Successfully wired `TruncationSafeExecutor` into `MissionExecutor.executeEditStep()` to provide automatic truncation detection and split-by-file recovery.

## What Changed

### File Modified: `packages/core/src/missionExecutor.ts`

**Before:**
```typescript
const llmEditTool = new LLMEditTool(this.taskId, this.eventBus, this.mode);
const llmResult = await llmEditTool.execute(llmInput, this.llmConfig);
```

**After:**
```typescript
const truncationSafeExecutor = createTruncationSafeExecutor(
  this.taskId,
  this.eventBus,
  this.mode,
  {
    maxFilesBeforeSplit: 2,     // Split if > 2 files
    maxAttemptsPerFile: 2,       // Max retries per file
    maxTotalChunks: 10,          // Max total API calls
    requireCompleteSentinel: true, // Require complete:true in output
  }
);

const truncationResult = await truncationSafeExecutor.execute(
  llmInput,
  this.llmConfig,
  contextResult.file_context
);
```

## What This Enables

### Automatic Truncation Detection
- Checks `stop_reason` from API (max_tokens, length = truncation)
- Validates JSON completeness
- Requires `complete:true` sentinel in LLM output

### Automatic Split-by-File Recovery
When truncation is detected or preflight determines step is too complex:
1. Preflight analyzes step to extract target files
2. If > 2 files OR high complexity → triggers split mode
3. Processes files one at a time with focused prompts
4. Combines results into single diff_proposed
5. Uses EditAttemptLedger to track progress (prevents duplicates)

### Graceful Degradation
- If split still fails → pauses with `decision_point_needed`
- Never applies partial/corrupt output
- User can retry or break step further

## Configuration

```typescript
interface TruncationSafeConfig {
  maxFilesBeforeSplit: number;      // Default: 2
  maxAttemptsPerFile: number;       // Default: 2
  maxTotalChunks: number;           // Default: 10
  requireCompleteSentinel: boolean; // Default: true
}
```

## Events Emitted

New events from TruncationSafeExecutor:
- `preflight_complete` - Reports whether split is needed
- `truncation_detected` - When output truncation detected
- `edit_split_triggered` - When split-by-file mode activated
- `edit_chunk_started` - When processing individual file
- `edit_chunk_completed` - When file processed successfully
- `edit_chunk_failed` - When file processing failed
- `edit_step_paused` - When execution paused for decision

## Next Steps (Remaining Phases)

- [x] **Phase 1**: Wire TruncationSafeExecutor into MissionExecutor
- [ ] **Phase 2**: Add complete:true sentinel to LLM prompts (already in TruncationSafeExecutor)
- [ ] **Phase 3**: Bounded budget preflight (already implemented)
- [ ] **Phase 4**: Split-by-file recovery with EditAttemptLedger (already implemented)
- [ ] **Phase 5**: Staleness validation via base_sha check (existing in MissionExecutor)

## Testing

To test truncation recovery:
1. Use a complex step that creates 4+ files
2. System should automatically split into per-file calls
3. Check logs for `TruncationSafeExecutor` messages
4. Verify combined diff_proposed contains all files

## Build Status
✅ Build successful - no type errors
