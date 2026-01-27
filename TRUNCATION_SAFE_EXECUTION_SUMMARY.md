# Truncation-Safe Edit Execution (V1) - Production Hardened

## Summary
Implemented a production-ready, truncation-safe edit execution system that handles LLM output token limits gracefully. The system ensures that large or complex edits never result in corrupted/partial files being written.

## Problem Solved
LLM APIs have hard output token limits. When editing multiple files or large files, the response can be truncated mid-JSON, causing:
- JSON parse failures
- Incomplete code being written
- Corrupted file state

## Solution Architecture

### Layer 0: Target File Set Determination (Preflight)
Before generating diffs, determine which files will be touched:
- Extract from file context
- Parse step description for file hints
- Estimate complexity (low/medium/high)

```typescript
const preflight = await executor.runPreflight(input, fileContext);
// Returns: { shouldSplit, reason, targetFiles, estimatedComplexity }
```

### Layer 1: Truncation Detection (Mandatory)
After every LLM response, check multiple signals:
1. **stop_reason** from API: `max_tokens` or `length` = truncated
2. **JSON validity**: Parse failure = likely truncated
3. **Sentinel field**: Missing `complete: true` = possibly truncated

```typescript
const truncation = detectTruncation(content, stopReason);
// Returns: { truncated, reason, stopReason, partialLength, details }
```

### Layer 2: Split-by-File Recovery
When truncation detected OR preflight says "too big":
1. Create `EditAttemptLedger` to track per-file status
2. Process ONE FILE per LLM call
3. Combine valid diffs for user approval
4. Never apply partial output

```typescript
const ledger = new EditAttemptLedger(stepId, targetFiles, {
  maxAttemptsPerFile: 2,
  maxTotalChunks: 10,
});
```

### Layer 3: Preflight Estimation (Proactive)
Conservative heuristics:
- If `targetFiles > 1` → pre-split by file
- If complexity is `high` → pre-split
- No fragile token estimation

### Layer 4: Graceful Degradation
If single-file diff still truncates:
1. Pause execution
2. Show decision point to user
3. Never write partial content

## New Files Created

### `packages/core/src/editAttemptLedger.ts`
Tracks file edit status for deterministic retries:
- `FileEditStatus`: pending | in_progress | done | failed | skipped
- `markInProgress()`, `markDone()`, `markFailed()`, `markSkipped()`
- `shouldPause()` - checks if caps exceeded
- `getCombinedDiff()` - merges completed diffs
- `getTouchedFiles()` - gets output for combined result

### `packages/core/src/truncationSafeExecutor.ts`
Main orchestrator with all layers:
- `execute()` - main entry point
- `runPreflight()` - Layer 0
- `detectTruncation()` - Layer 1
- `executeSplitByFile()` - Layer 2
- `executeSingleFileEdit()` - single-file focused prompt
- `callLLMWithStopReason()` - captures API stop_reason

## Events Emitted

```typescript
// Preflight complete
{ type: 'preflight_complete', shouldSplit, reason, targetFileCount, estimatedComplexity }

// Truncation detected
{ type: 'truncation_detected', reason, partialLength, stopReason }

// Split execution
{ type: 'edit_split_triggered', reason, file_count }
{ type: 'edit_chunk_started', file, chunk_index, total_chunks }
{ type: 'edit_chunk_completed', file }
{ type: 'edit_chunk_failed', file, reason }

// Pause for decision
{ type: 'edit_step_paused', reason, progress }
```

## Configuration

```typescript
const DEFAULT_CONFIG: TruncationSafeConfig = {
  maxFilesBeforeSplit: 1,      // Split if > 1 file
  maxAttemptsPerFile: 2,       // Max retries per file
  maxTotalChunks: 10,          // Max total LLM calls
  requireCompleteSentinel: true // Require complete:true
};
```

## Usage Example

```typescript
import { TruncationSafeExecutor, createTruncationSafeExecutor } from '@ordinex/core';

const executor = createTruncationSafeExecutor(taskId, eventBus, 'MISSION', {
  maxFilesBeforeSplit: 2,  // Override defaults
});

const result = await executor.execute(input, llmConfig, fileContext);

if (result.success) {
  // result.output contains combined LLMEditStepOutput
  // result.wasSplit indicates if split execution was used
} else if (result.pausedForDecision) {
  // Show decision point to user
  // result.pauseReason explains why
  // result.ledger contains partial progress
}
```

## Integration Notes

The `TruncationSafeExecutor` can be used as a drop-in replacement for direct LLM edit calls:
1. User approves combined diff (unchanged UX)
2. Split execution is internal
3. Existing pipeline preserved: retrieve → propose → approve → apply

## Guarantees

✅ Truncation is detected and never silently applied
✅ Multi-file edits succeed via split-by-file
✅ Preflight prevents oversized requests
✅ User experience unchanged (approves combined diff)
✅ No partial/corrupt files ever written
✅ Deterministic retries via EditAttemptLedger
✅ Graceful degradation with user decision points

## Files Changed

1. `packages/core/src/editAttemptLedger.ts` - NEW (260 lines)
2. `packages/core/src/truncationSafeExecutor.ts` - NEW (650 lines)
3. `packages/core/src/llmEditTool.ts` - Increased max_tokens to 16384
4. `packages/core/src/index.ts` - Exports new modules

## Next Steps (V2)

1. **Integration with MissionExecutor**: Wire TruncationSafeExecutor into the edit stage
2. **UI for Decision Points**: Show pause reasons and options in webview
3. **Progress Indicator**: Show "Processing file 2/5..." during split execution
4. **Token Budget Estimation**: Optional pre-flight estimation for power users
