# Mode Confirmation Bug Fix

## Issue Discovered
When entering "Add error handling to src/api.ts" in PLAN mode, the system stopped after showing "Mode Set" and never proceeded to generate a plan.

## Root Cause Analysis

### What Happened:
1. User entered prompt: "Add error handling to src/api.ts"
2. User selected: **PLAN** mode
3. System classified prompt as: **MISSION** mode (high confidence)
   - Detected "Add" keyword → action-oriented → MISSION
4. `shouldRequireConfirmation()` returned `true` (PLAN vs MISSION with high confidence)
5. Extension emitted `mode_set` event with `requiresConfirmation: true`
6. **Extension stopped and waited for confirmation**
7. **But webview never rendered the confirmation card!**

### From the logs:
```
Checking requiresConfirmation: true
Confirmation required - sending events to webview and returning
Events sent, returning early
```

The code correctly detected the mode mismatch and stopped, but the UI had no handler for it.

## The Fix

### File Changed: `packages/webview/src/components/MissionFeed.ts`

Added mode confirmation card renderer that triggers when:
- Event type is `mode_set`
- Event payload has `requiresConfirmation: true`

The new card shows:
```
⚠️ Mode Confirmation Needed

You selected: PLAN mode
System suggests: MISSION mode
Reason: Detected action-oriented keywords suggesting implementation work.

[✓ Keep PLAN]  [→ Switch to MISSION]
```

## How It Works Now

### For "Add error handling to src/api.ts":
1. System detects MISSION mode is better
2. Shows confirmation card
3. User choices:
   - **Keep PLAN**: Generates a planning document (no code changes)
   - **Switch to MISSION**: Directly implements the error handling

### For Vague Prompts:
Prompts like "plan next features" score lower and don't trigger confirmation - they go straight to PLAN mode's clarification flow.

## Testing Instructions

### Test 1: Confirmation Card (Action-Oriented Prompt in PLAN Mode)
1. Reload VS Code extension (Cmd+Shift+P → "Developer: Reload Window")
2. Select **PLAN** mode
3. Enter: `Add error handling to src/api.ts`
4. **Expected**: Mode confirmation card appears
5. Click **"Keep PLAN"** or **"Switch to MISSION"**
6. System proceeds with selected mode

### Test 2: No Confirmation (Exploratory Prompt)
1. Select **PLAN** mode
2. Enter: `plan next features that we can implement`
3. **Expected**: NO confirmation, goes directly to clarification options

### Test 3: Full PLAN → MISSION → Edit Flow
1. Select **PLAN** mode
2. Enter: `Add error handling to src/api.ts`
3. Click **"Keep PLAN"** on confirmation
4. Wait for plan generation (shows `context_collected`, `prompt_assessed`, `tool_start`, `plan_created`)
5. Click **[Approve]** on Plan Card
6. Mode switches to MISSION, shows **[Execute Plan]** button
7. Click **[Execute Plan]**
8. For each step: `diff_proposed` → **[Approve]** → REAL file changes!

## What Was Also Completed

This fix was part of the larger MISSION EDIT implementation task:

### Completed Components:
✅ Unified diff parser with validation (safety checks, scope limits)
✅ SHA-based staleness detection
✅ Deterministic excerpt selection strategy
✅ Atomic diff application with checkpoint/rollback
✅ Evidence persistence (.diff + .manifest.json files)
✅ LLM edit tool with spec-compliant system prompt
✅ Full event flow (34/34 tests passing)
✅ Error handling for high-clarity prompts
✅ **Mode confirmation UI**

## Files Modified
1. `packages/extension/src/extension.ts` - Added try/catch for high-clarity LLM failures
2. `packages/webview/src/components/MissionFeed.ts` - Added mode confirmation card renderer

## Build Status
✅ All packages built successfully
✅ TypeScript compilation clean
✅ 34/34 mission edit tests pass
✅ 197 total tests pass
