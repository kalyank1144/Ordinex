# Systems Tab Step 29 - Summary

## What Was Implemented

### 1. SystemsViewModel Reducer (`packages/core/src/systemsViewModel.ts`)
A pure, deterministic reducer that derives operational truth from events in a single pass.

**Key Features:**
- **No hidden state**: All data derived from events
- **No I/O**: No network calls, no LLM calls  
- **Replay-safe**: Same events → identical output after reload
- **8 organized sections** for comprehensive operational view

**Sections:**
1. **Status** - mission, stage, runStatus (running/paused/completed/cancelled), pausedReason, currentStep
2. **WaitingFor** - pendingApprovals[], pendingDecisionPoints[]
3. **Scope** - workspaceRoots, allowedCreateRoots, deniedPatterns, approvedExpansions, limits
4. **ContextIncluded** - retrievedFiles[], tokenEstimate, totalLines, totalCharacters
5. **Changes** - lastDiffProposed/Applied, filesChangedTotal[], checkpointsCreated
6. **TestsAndRepair** - lastTestRun, testsPassed/Failed, repairAttempts (used/remaining/max), allowlistedCommands
7. **ToolActivity** - counts per tool, totalCalls, lastToolCall
8. **Timeouts** - stageTimeoutMs, lastTimeout, timeoutCount

### 2. Token Estimate in Retrieval (`packages/core/src/retrieval/retriever.ts`)
Added `tokenEstimate` and `totalCharacters` to `retrieval_completed` events:
- Counts total characters from excerpts
- Estimates tokens at ~4 chars/token (conservative for code)
- Enables Systems tab to show context size

### 3. Systems Tab CSS Enhancements (`packages/webview/src/index.ts`)
Added comprehensive CSS for rich Systems tab UI:
- Status badges (running/paused/completed/cancelled/idle)
- File lists with path and line info
- "Show all" expander buttons
- Pending approval/decision cards with warning styling
- Tool activity grid
- Expander/details pattern for technical fields

### 4. Unit Tests (`packages/core/src/__tests__/systemsViewModel.test.ts`)
Comprehensive test coverage:
- Status section (mission, stage, paused, steps)
- WaitingFor section (approvals, decisions)
- Scope section (initialization, expansions)
- ContextIncluded section (retrieval, context_collected)
- Changes section (diffs, checkpoints)
- TestsAndRepair section (tests, repair attempts, failures)
- ToolActivity section (counts, success tracking)
- Timeouts section
- **Replay safety test**: Verifies identical output for same events

### 5. Exports (`packages/core/src/index.ts`)
Exported all SystemsViewModel types and functions:
- `reduceToSystemsViewModel`
- `getTopRetrievedFiles`, `hasMoreRetrievedFiles`
- `getStatusSummary`, `getWaitingSummary`
- `formatTokenEstimate`
- Type exports for all interfaces

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/systemsViewModel.ts` | **NEW** - Pure reducer for Systems tab |
| `packages/core/src/retrieval/retriever.ts` | Added tokenEstimate to retrieval_completed |
| `packages/core/src/index.ts` | Export SystemsViewModel |
| `packages/webview/src/index.ts` | Enhanced CSS for Systems tab sections |
| `packages/core/src/__tests__/systemsViewModel.test.ts` | **NEW** - Unit tests |

## Event Types Handled

The reducer handles these event types:
- `mission_started`, `mission_completed`, `mission_paused`, `mission_cancelled`
- `execution_paused`, `execution_resumed`
- `stage_changed`, `step_started`, `step_completed`, `step_failed`
- `run_scope_initialized`, `scope_expansion_resolved`
- `retrieval_completed`, `context_collected`
- `approval_requested`, `approval_resolved`
- `decision_point_needed`, `clarification_received`
- `diff_proposed`, `diff_applied`, `checkpoint_created`
- `test_started`, `test_completed`, `test_failed`
- `repair_policy_snapshot`, `repair_attempt_started`, `repair_attempt_completed`
- `failure_detected`, `failure_classified`, `repeated_failure_detected`
- `tool_start`, `tool_end`
- `stage_timeout`, `final`

## Definition of Done ✅

- [x] SystemsViewModel reducer - single pass, deterministic, no I/O
- [x] Token estimate added to retrieval_completed
- [x] Show tokenEstimate only if present
- [x] CSS for all 8 UI sections with expanders
- [x] Tests for stage, pending approvals, scope, retrieved files, repair counters
- [x] Replay test: same events → identical output

## Usage Example

```typescript
import { reduceToSystemsViewModel, getStatusSummary } from '@ordinex/core';

// In webview message handler
case 'ordinex:eventsUpdate':
  const vm = reduceToSystemsViewModel(message.events);
  
  // Update UI sections
  updateStatusSection(vm.status);
  updateScopeSection(vm.scope);
  updateContextSection(vm.contextIncluded);
  // etc.
  
  // Friendly status for header
  const statusText = getStatusSummary(vm); // "Running: edit" or "Paused"
```
