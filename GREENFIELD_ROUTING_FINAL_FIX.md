# Greenfield Routing Final Fix

## Problem

When entering "Creating a new fitness app" in MISSION mode:
1. Greenfield WAS detected correctly (`flow_kind: 'scaffold'`)
2. BUT the behavior classification was `QUICK_ACTION` (not `PLAN`)
3. Scaffold routing was only inside the `case 'PLAN':` branch
4. So greenfield requests went to QUICK_ACTION → MissionExecutor → ENOENT errors

## Root Cause from Logs

```
[Step35] Flow kind: scaffold           ✅ Detected correctly!
[Step35] Is greenfield request: true   ✅ Detected correctly!
[Step33] Intent analysis: {behavior: 'QUICK_ACTION', ...}  ❌ Wrong behavior!
```

The `analyzeIntent()` function returned `behavior: 'QUICK_ACTION'` because `detectScope()` 
classified the prompt as `scope: 'trivial'` - which triggers QUICK_ACTION for simple tasks.

The scaffold check was nested inside `case 'PLAN':`, so it never ran.

## Fix Applied

**Moved scaffold check BEFORE the behavior switch:**

```typescript
// 5. STEP 35 FIX: SCAFFOLD CHECK BEFORE BEHAVIOR SWITCH
// Greenfield requests MUST route to scaffold flow regardless of behavior classification
if (analysisWithFlow.flow_kind === 'scaffold') {
  console.log('[Step35] 🏗️ SCAFFOLD flow detected - routing DIRECTLY to scaffold handler');
  await this.handleScaffoldFlow(text, taskId, modelId, webview, attachments);
  return; // Exit early - scaffold flow handles everything
}

// 6. STEP 33: Handle behavior-specific logic (non-scaffold)
switch (analysis.behavior) {
  case 'PLAN': ...
  case 'QUICK_ACTION': ...
}
```

## Files Changed

| File | Change |
|------|--------|
| `packages/extension/src/extension.ts` | Added scaffold check BEFORE behavior switch, removed redundant check in PLAN case |

## Why This Works

1. `analyzeIntentWithFlow()` returns `flow_kind: 'scaffold'` for greenfield prompts
2. The early return ensures scaffold flow runs regardless of behavior classification
3. Non-scaffold prompts continue to the normal behavior switch

## Expected Behavior After Fix

```
[Step35] Flow kind: scaffold
[Step35] 🏗️ SCAFFOLD flow detected - routing DIRECTLY to scaffold handler
[Step35] Bypassing behavior switch (was: QUICK_ACTION)
[Ordinex:ScaffoldFlow] === SCAFFOLD FLOW START ===
```

## Test

1. Reload the extension
2. Enter: "Create a new fitness app"
3. Should see scaffold proposal card (not QUICK_ACTION / MissionExecutor errors)

## Date

2025-01-31
