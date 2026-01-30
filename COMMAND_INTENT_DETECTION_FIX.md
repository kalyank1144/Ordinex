# Command Intent Detection Fix

**Date:** January 29, 2026  
**Issue:** "run the tests" was incorrectly routed to CONTINUE_RUN instead of command execution  
**Root Cause:** Command detection was never integrated into intent analyzer + detectActiveRun was too aggressive

---

## Problem Analysis

### Issue 1: Missing Command Detection
The `detectCommandIntent` function from Step 34.5 was created but **never integrated** into the intent analyzer. When a user typed "run the tests", the system:
1. ❌ Skipped command detection entirely
2. ✅ Detected an old `execution_paused` event
3. ❌ Incorrectly assumed CONTINUE_RUN behavior

### Issue 2: Aggressive Active Run Detection
The `detectActiveRun` function was too aggressive:
- Treated any `execution_paused` event as an active run
- Ignored the pause reason (`awaiting_continue_decision` should NOT be active)
- Didn't check for terminal events like `final` or `mission_completed`

---

## Solution

### Fix 1: Integrate Command Detection (Step 0.5)
Added command detection **early** in the intent analysis flow:

```typescript
// STEP 0.5: Check for command intent (Step 34.5 integration)
const commandDetection = detectCommandIntent(originalPrompt);
if (commandDetection.isCommandIntent && commandDetection.confidence >= 0.75) {
  return createIntentAnalysis(
    'QUICK_ACTION',
    { type: 'fresh' },
    commandDetection.confidence,
    `Command intent detected: ${keywords}`,
    undefined,
    undefined,
    'small',
    commandDetection.inferredCommands
  );
}
```

**Key Points:**
- Runs BEFORE active run check (priority)
- Confidence threshold: 75%
- Returns QUICK_ACTION behavior
- Passes inferred commands through

### Fix 2: Less Aggressive Active Run Detection
Rewrote `detectActiveRun` to be more precise:

```typescript
/**
 * Only consider a run "active" if:
 * 1. There's a mission_started without mission_completed/cancelled
 * 2. There's a decision_point_needed waiting for user input
 * 3. NOT if it's just an old execution_paused with reason "awaiting_continue_decision"
 */
```

**New Logic:**
1. Check for terminal events first (`final`, `mission_completed`, `mission_cancelled`)
2. Find most recent `mission_started`
3. Verify it hasn't been completed/cancelled
4. Look for active decision points (`decision_point_needed`)
5. Ignore pause reasons like `awaiting_continue_decision` and `awaiting_mission_start`

---

## Testing

### Test Case: "run the tests"

**Before Fix:**
```
Input: "run the tests"
↓
detectActiveRun() returns { status: 'paused', reason: 'awaiting_continue_decision' }
↓
Behavior: CONTINUE_RUN ❌
↓
Mode Set to MISSION
↓
Decision Needed: "4 option(s) available" (generic continue prompt)
```

**After Fix:**
```
Input: "run the tests"
↓
detectCommandIntent() returns { isCommandIntent: true, confidence: 0.90 }
↓
Behavior: QUICK_ACTION ✅
↓
Mode Set to MISSION
↓
behaviorHandlers routes to command execution
↓
CommandCard appears with approval prompt
↓
User approves → command runs → logs stream
```

---

## Expected Behavior (Post-Fix)

### Scenario 1: User types "run the tests"
1. ✅ Command intent detected (confidence: 90%)
2. ✅ Behavior: QUICK_ACTION
3. ✅ Routes to command execution handler
4. ✅ CommandCard shows: "⚡ npm test"
5. ✅ User approves
6. ✅ Command executes, logs stream to Logs tab

### Scenario 2: User types message during actual execution
1. ✅ detectActiveRun sees `decision_point_needed` event
2. ✅ Behavior: CONTINUE_RUN
3. ✅ Routes to pause/abort/status handling

### Scenario 3: User types "run tests" after mission completes
1. ✅ detectActiveRun sees `final` or `mission_completed`
2. ✅ Returns null (no active run)
3. ✅ Command detection takes over
4. ✅ Behavior: QUICK_ACTION

---

## Files Modified

### `packages/core/src/intentAnalyzer.ts`
- **Added import:** `import { detectCommandIntent } from './userCommandDetector';`
- **Added Step 0.5:** Command detection before active run check
- **Rewrote detectActiveRun:** More precise active run detection logic

---

## Integration Status

✅ Command detection integrated into intent analyzer  
✅ detectActiveRun fixed to be less aggressive  
✅ Build successful  
⏳ Awaiting UI components (CommandCard, etc.) from Step 34.5 Phases 6-8  

---

## Next Steps

1. **Test in extension:**
   - Reload VS Code extension
   - Type "run the tests"
   - Verify QUICK_ACTION behavior is selected
   - Check that behaviorHandlers routes correctly

2. **Implement remaining Step 34.5 components** (if not done):
   - Phase 6: CommandCard UI component
   - Phase 7: Logs tab streaming
   - Phase 8: Replay safety

3. **Test edge cases:**
   - "npm run dev" (long-running)
   - "rm -rf node_modules" (blocked)
   - "what is npm?" (should be ANSWER, not command)

---

## Verification Checklist

- [x] Command intent detection integrated
- [x] detectActiveRun rewritten
- [x] TypeScript compiles without errors
- [ ] Manual test: "run the tests" → QUICK_ACTION
- [ ] Manual test: command execution flows to UI
- [ ] Manual test: logs stream correctly
- [ ] Manual test: approval gate works
