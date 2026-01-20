# Plan Card Display Debug - Step-by-Step

## Issue Summary
When using PLAN mode, the system creates a plan and shows "4 steps | A clear, actionable plan is created and approved" in the timeline, but the detailed plan card is not displaying. We need to debug why the PlanCard component is not rendering.

## Debug Logging Added

### 1. MissionFeed.ts
Added comprehensive logging in the `renderEventCard` function to track:
- When `plan_created` events are detected
- The full event payload structure
- The extracted plan object
- All validation checks (existence, type, goal, steps, array checks)
- Whether PlanCard rendering is triggered or skipped

**Location**: `packages/webview/src/components/MissionFeed.ts` (lines ~220-240)

**Console markers**:
- 🔍 `[MissionFeed] plan_created event detected`
- 🔍 `[MissionFeed] event.payload:` - Full payload
- 🔍 `[MissionFeed] extracted plan:` - Extracted plan object
- 🔍 `[MissionFeed] plan checks:` - All validation checks
- ✅ `[MissionFeed] Rendering PlanCard` - Success path
- ❌ `[MissionFeed] NOT rendering PlanCard - condition failed` - Failure path

### 2. PlanCard.ts
Added logging at the start of the `renderPlanCard` function to track:
- When the function is called
- The full event object received
- The raw plan extracted from the payload

**Location**: `packages/webview/src/components/PlanCard.ts` (lines ~17-23)

**Console markers**:
- 🎨 `[PlanCard] renderPlanCard called`
- 🎨 `[PlanCard] event:` - Full event
- 🎨 `[PlanCard] rawPlan:` - Extracted raw plan

## How to Test

1. **Press F5** in VS Code to launch the extension development host
2. **Open the Ordinex Mission Control panel** (Activity Bar)
3. **Select PLAN mode** from the dropdown
4. **Enter a prompt** like "plan next features" and click Send
5. **Open the Developer Tools console** (Help > Toggle Developer Tools)
6. **Check the Console tab** for the debug logs

## What to Look For

### Scenario A: PlanCard is being rendered but not displayed
If you see:
```
🔍 [MissionFeed] plan_created event detected
🔍 [MissionFeed] event.payload: {...}
🔍 [MissionFeed] extracted plan: {...}
🔍 [MissionFeed] plan checks: { exists: true, isObject: true, hasGoal: true, ... }
✅ [MissionFeed] Rendering PlanCard
🎨 [PlanCard] renderPlanCard called
🎨 [PlanCard] event: {...}
🎨 [PlanCard] rawPlan: {...}
```

**This means**: The logic is working, but the HTML/CSS rendering is broken.
**Next step**: Check for CSS styling issues or HTML injection problems.

### Scenario B: Plan structure validation failing
If you see:
```
🔍 [MissionFeed] plan_created event detected
🔍 [MissionFeed] event.payload: {...}
🔍 [MissionFeed] extracted plan: {...}
🔍 [MissionFeed] plan checks: { exists: true, isObject: true, hasGoal: false, ... }
❌ [MissionFeed] NOT rendering PlanCard - condition failed
```

**This means**: The plan object structure doesn't match expectations.
**Next step**: Look at the payload structure and fix the data format.

### Scenario C: No plan_created event
If you don't see ANY `[MissionFeed]` logs:
**This means**: The event is not being emitted or not reaching the webview.
**Next step**: Check extension.ts for event emission issues.

## Expected Plan Structure

The code expects EITHER of these structures:

### Option 1: Structured Plan (from LLM)
```json
{
  "goal": "Complete the task",
  "assumptions": ["..."],
  "success_criteria": ["..."],
  "scope_contract": {...},
  "steps": [
    {
      "id": "step_1",
      "description": "...",
      "expected_evidence": ["..."]
    }
  ],
  "risks": ["..."]
}
```

### Option 2: Template Plan (from generateTemplatePlan)
```json
{
  "goal": "Complete: ...",
  "assumptions": ["..."],
  "success_criteria": "A clear, actionable plan...",
  "scope_contract": {...},
  "steps": [
    {
      "step_id": "step_1",
      "description": "...",
      "stage": "plan",
      "estimated_effort": "low"
    }
  ]
}
```

## Current Implementation

Looking at `extension.ts` (line ~260):
```typescript
const plan = generateTemplatePlan(text, userSelectedMode);

await this.emitEvent({
  event_id: this.generateId(),
  task_id: taskId,
  timestamp: new Date().toISOString(),
  type: 'plan_created',
  mode: userSelectedMode,
  stage: this.currentStage,
  payload: plan as unknown as Record<string, unknown>,  // <-- Plan is the entire payload
  evidence_ids: [],
  parent_event_id: null,
});
```

The plan is being set as the entire payload (not nested under `payload.plan`).

## Next Steps After Testing

1. **Run the test** and collect the console logs
2. **Share the logs** showing what structure the plan actually has
3. Based on the logs, we'll either:
   - Fix the data structure in `generateTemplatePlan`
   - Fix the validation logic in `MissionFeed.ts`
   - Fix the CSS/HTML rendering in `PlanCard.ts`
   - Fix the event emission in `extension.ts`

## Files Modified

1. ✅ `packages/webview/src/components/MissionFeed.ts` - Added debug logging
2. ✅ `packages/webview/src/components/PlanCard.ts` - Added debug logging
3. ✅ Built successfully with `pnpm run build`

## Ready to Test!

Press F5 to launch the extension and try creating a plan in PLAN mode. The console logs will tell us exactly what's happening!
