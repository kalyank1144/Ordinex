# Step 28: Self-Correction Loop (V1 Safe Version) - Summary

## Overview

Step 28 implements a bounded, deterministic self-correction cycle that automatically attempts to fix test failures while maintaining all safety guarantees. When tests fail, the system enters a repair loop: Diagnose → Retrieve minimal context → Propose fix diff → Request approval → Apply → Rerun tests.

## Non-Negotiables (Enforced)

- ✅ **ONE mission at a time, ONE stage at a time**
- ✅ **NEVER auto-apply diffs** - All diffs require explicit approval
- ✅ **NEVER run unknown commands** - Only allowlisted test commands auto-run
- ✅ **NEVER expand scope without approval** - Explicit approval for out-of-scope files
- ✅ **NO infinite loops** - Bounded by iteration limit and repeat detection
- ✅ **Replayable from events** - Full event sourcing
- ✅ **User can cancel anytime**
- ✅ **Prefer pause over guessing** - Decision points for ambiguous situations

## Files Changed

### New Files

1. **`packages/core/src/failureClassifier.ts`** (~380 lines)
   - `classifyFailure(output)` - Classifies test output into failure types
   - `normalizeOutput(output)` - Strips volatile data for stable signatures
   - `FailureType` - TEST_ASSERTION | TYPECHECK | LINT | BUILD_COMPILE | TOOLING_ENV | TIMEOUT | UNKNOWN
   - `FailureClassification` - Full classification result with signature
   - `ConsecutiveFailureTracker` - Tracks repeated failures for loop detection

2. **`packages/core/src/selfCorrectionPolicy.ts`** (~340 lines)
   - `SelfCorrectionPolicy` - Configurable policy interface
   - `DEFAULT_SELF_CORRECTION_POLICY` - Safe V1 defaults
   - `RepairLoopState` - Full repair loop execution state
   - `checkStopConditions()` - Deterministic stop condition checks
   - `generateDecisionOptions()` - Context-aware user options
   - State update functions for proper iteration tracking

3. **`packages/core/src/selfCorrectionRunner.ts`** (~540 lines)
   - `SelfCorrectionRunner` - Main orchestrator class
   - `startRepairLoop()` - Entry point for repair cycle
   - Callback-based integration for diff generation, application, and testing
   - Full event emission for all actions
   - Decision point generation for pauses

4. **`packages/core/src/__tests__/selfCorrection.test.ts`** (~580 lines)
   - Tests for failure classification
   - Tests for consecutive failure detection
   - Tests for stop conditions
   - Tests for iteration limit enforcement
   - Tests for scope expansion handling
   - Tests for cancellation
   - Tests for event emission

### Modified Files

1. **`packages/core/src/types.ts`**
   - Added `failure_classified` event type
   - Added `decision_point_needed` event type

2. **`packages/core/src/missionRunner.ts`**
   - Added imports for new modules
   - Enhanced repair_loop integration

3. **`packages/core/src/index.ts`**
   - Exported all new types and functions

## Self-Correction Policy (Configurable)

```typescript
interface SelfCorrectionPolicy {
  maxRepairIterations: number;           // Default: 2
  maxConsecutiveSameFailure: number;     // Default: 2
  allowAutoRerunAllowlistedTests: boolean; // Default: true
  stopOnScopeExpansionDenied: boolean;   // Default: true
  stopOnRepeatedStaleContext: boolean;   // Default: true
  repairDiagnosisTimeoutMs: number;      // Default: 60000
  repairDiffGenTimeoutMs: number;        // Default: 120000
  timeoutRetryOnce: boolean;             // Default: true
}
```

**REMOVED for V1** (per spec):
- `allowAutoRetryOnKnownTransient` - Not implemented

## Failure Classification

### Failure Types

| Type | Description | Code Fixable |
|------|-------------|--------------|
| `TEST_ASSERTION` | Test assertions (expect, assert) | ✅ Yes |
| `TYPECHECK` | TypeScript/type errors | ✅ Yes |
| `LINT` | ESLint/TSLint errors | ✅ Yes |
| `BUILD_COMPILE` | Build/compilation errors | ✅ Yes |
| `TOOLING_ENV` | Missing deps, wrong node version | ❌ No |
| `TIMEOUT` | Command timed out | ❌ No |
| `UNKNOWN` | Cannot classify | ❌ No |

### Normalization (Signature Stability)

The classifier strips volatile data before generating signatures:
- Timestamps → `[TIMESTAMP]`
- Absolute paths → `[HOME]/...`
- PIDs → `[PID]`
- UUIDs → `[UUID]`
- Memory addresses → `[ADDR]`
- Durations → `[DURATION]`

This ensures identical logical failures produce identical signatures.

## Repair Loop Flow

```
test_failed
    │
    ▼
┌──────────────────┐
│ Classify Failure │ → emit failure_classified
└──────────────────┘
    │
    ▼
┌──────────────────┐
│ Check Stop       │ → Budget exhausted? Repeated failure? Tooling issue?
│ Conditions       │
└──────────────────┘
    │ (continue)
    ▼
┌──────────────────┐
│ Need Scope       │ → emit scope_expansion_requested
│ Expansion?       │ → await approval
└──────────────────┘
    │ (approved)
    ▼
┌──────────────────┐
│ Generate         │ → Timeout? → retry once → then pause
│ Repair Diff      │
└──────────────────┘
    │
    ▼
┌──────────────────┐
│ Empty Diff?      │ → emit repair_attempt_completed { result: no_fix_found }
│                  │ → decrement iteration → continue or pause
└──────────────────┘
    │ (has diff)
    ▼
┌──────────────────┐
│ Diff Approval    │ → emit diff_proposed, approval_requested
│                  │ → await user approval
└──────────────────┘
    │ (approved)
    ▼
┌──────────────────┐
│ Apply Diff       │ → emit diff_applied
│                  │ → decrement iteration HERE (only on apply)
└──────────────────┘
    │
    ▼
┌──────────────────┐
│ Rerun Tests      │ → Auto-run if allowlisted
│                  │
└──────────────────┘
    │
    ▼
Pass? → mission_completed
Fail? → Loop back (subject to limits)
```

## Stop Conditions

The repair loop stops and creates a decision point when:

1. **Budget Exhausted** - `repairRemaining == 0`
2. **Repeated Failure** - Same signature N times consecutively
3. **Tooling/Env Failure** - Cannot be fixed by code changes
4. **Scope Expansion Denied** - User declined required files
5. **Repeated Stale Context** - Context became stale multiple times
6. **Diagnosis Timeout** - After one retry
7. **Diff Gen Timeout** - After one retry
8. **Multiple Empty Diffs** - LLM couldn't generate a fix

## Decision Points (User-First)

When pausing, the system generates context-aware options:

```typescript
interface DecisionPoint {
  reason: StopReason;
  message: string;
  options: DecisionOption[];
  context: {
    iteration: number;
    remaining: number;
    failureSignature?: string;
    pendingScopeFiles?: string[];
  };
}
```

Example options for `budget_exhausted`:
- Try one more repair
- Retry tests
- Stop mission
- Export run

Example options for `tooling_env_failure`:
- Change test command
- Retry tests (after fixing environment)
- Stop mission
- Export run

## Events Emitted

| Event | When | Key Payload |
|-------|------|-------------|
| `failure_classified` | Failure analyzed | failureType, failureSignature, summary |
| `repair_attempt_started` | Starting iteration | attempt, remaining, failureSignature |
| `repair_attempt_completed` | Iteration done | attempt, result, failureSignature |
| `repeated_failure_detected` | Same failure N times | failureSignature, occurrences |
| `scope_expansion_requested` | Need out-of-scope files | files, reason |
| `diff_proposed` | Repair diff ready | diffId, kind:"repair", attempt |
| `decision_point_needed` | User decision required | reason, options |

## Test Coverage

All 8 required tests implemented:

1. ✅ Consecutive repeat detection pauses correctly
2. ✅ Iteration limit enforced; decrement only on diff_applied
3. ✅ Empty diff → no_fix_found path works and decrements
4. ✅ Tooling/env failure pauses immediately (no decrement)
5. ✅ Diagnosis/diffgen timeout: retry once, then pause
6. ✅ Out-of-scope repair diff triggers scope_expansion_requested; deny pauses
7. ✅ Allowlisted test rerun runs without extra approval
8. ✅ Cancel during repair → exits cleanly

## Integration Points

The `SelfCorrectionRunner` uses callbacks for flexibility:

```typescript
runner.setRepairDiffGenerator(async (classification, context) => {
  // Call LLM to generate repair diff
  return { diffId, unifiedDiff, filesAffected, summary };
});

runner.setDiffApplicator(async (diffProposal) => {
  // Apply diff to workspace
  return true; // success
});

runner.setTestRunner(async (command) => {
  // Run tests, return null if pass, failure if fail
  return { rawOutput, command, exitCode, timestamp };
});
```

## Definition of Done

✅ Common failures get fixed within N attempts with approvals
✅ No infinite loops (bounded by policy + repeat detection)
✅ No unauthorized writes/tests/scope expansions
✅ Pauses are actionable and clear (decision points)
✅ Full sequence is replayable from events

## Usage Example

```typescript
import {
  SelfCorrectionRunner,
  DEFAULT_SELF_CORRECTION_POLICY,
} from '@ordinex/core';

const runner = new SelfCorrectionRunner(
  taskId,
  missionId,
  eventBus,
  approvalManager,
  workspaceRoot,
  DEFAULT_SELF_CORRECTION_POLICY
);

// Configure callbacks
runner.setRepairDiffGenerator(myDiffGenerator);
runner.setDiffApplicator(myDiffApplicator);
runner.setTestRunner(myTestRunner);

// Start repair loop
const decisionPoint = await runner.startRepairLoop(
  testFailure,
  allowedScope,
  'npm test'
);

if (decisionPoint === null) {
  // Tests passed!
} else {
  // User decision required
  console.log(decisionPoint.message);
  console.log(decisionPoint.options);
}
```
