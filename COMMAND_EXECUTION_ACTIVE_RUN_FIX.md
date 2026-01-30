# Command Execution Fix: "run the app" Issue

## Problem

When user typed "run the app", the system incorrectly showed "Decision Needed" with no visible options. The UI was broken.

### Root Cause

The Intent Analyzer was incorrectly detecting an "active run" from leftover state (execution_paused with "awaiting_continue_decision"), which caused:
1. Prompt classified as CONTINUE_RUN behavior (instead of QUICK_ACTION)
2. Emitted decision_point_needed event with 4 options
3. But NO UI card exists for CONTINUE_RUN decisions
4. Result: Empty "Decision Needed" card with no buttons

## The Fix

### Changed: `detect ActiveRun()` Function

Made it **ultra-conservative** - only treats a run as "active" if there's CLEAR blocking state:

**BEFORE** (Too Aggressive):
- Checked for any execution_paused event
- Included old "awaiting_continue_decision" states
- Result: False positives from leftover state

**AFTER** (Ultra-Conservative):
1. Only considers **unresolved approval_requested** events
2. Only considers **unhandled decision_point_needed** events (excluding continue_run context)
3. Ignores ALL old paused states
4. Ignores awaiting_mission_start (user clicks button)
5. Ignores awaiting_continue_decision (old pattern)

### Flow Now

**User types: "run the app"**

1. ✅ Command detector: `isCommandIntent: true` (confidence: 0.95)
2. ✅ Intent Analyzer: Behavior = QUICK_ACTION (Step 0.5 - before active run check)
3. ✅ Routes to command execution phase
4. ✅ Shows command approval prompt (if policy = prompt)
5. ✅ Executes command safely
6. ✅ Stores output as evidence

**NO MORE**:
- ❌ Incorrectly detecting active run
- ❌ Routing to CONTINUE_RUN
- ❌ Empty decision cards

## Code Changes

### File: `packages/core/src/intentAnalyzer.ts`

```typescript
export function detectActiveRun(events: Event[]): ActiveRunStatus | null {
  if (!events.length) return null;
  
  // STEP 1: Find terminal events
  const latestTerminalTime = /* ... */;
  
  // STEP 2: Find unresolved approval requests (BLOCKING)
  for (const approval of approvalRequests) {
    if (!resolved) {
      return { /* active run */ };
    }
  }
  
  // STEP 3: Find unhandled decision points (BLOCKING)
  for (const decision of decisionEvents) {
    // Skip old continue_run patterns
    if (context === 'continue_run' || context === 'awaiting_continue_decision') {
      continue;
    }
    return { /* active run */ };
  }
  
  // STEP 4: Everything else = NO active run
  return null;
}
```

## Testing

### Before Fix:
```
User: "run the app"
→ detectActiveRun: true (false positive)
→ Behavior: CONTINUE_RUN
→ UI: Decision Needed (4 options) - BROKEN
```

### After Fix:
```
User: "run the app"  
→ detectActiveRun: null (correct)
→ Command detection: true
→ Behavior: QUICK_ACTION
→ Routes to command execution
→ UI: Works correctly
```

## Impact

✅ **Fixes**: "run the app" now works as expected
✅ **Fixes**: No more false positives from leftover state
✅ **Improves**: Command execution reliability
✅ **Prevents**: Empty decision cards in UI

## Related

- Step 34.5: Command Execution Phase
- Step 33: Intent Analysis & Behavior Selection
- Command Detection: `detectCommandIntent()`
- Active Run Detection: `detectActiveRun()`
