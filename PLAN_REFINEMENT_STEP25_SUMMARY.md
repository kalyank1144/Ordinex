# STEP 25 — PLAN REFINEMENT (Enterprise-grade, Event-sourced)

## Summary

Implemented "Refine Plan" functionality that allows users to revise a plan without restarting, while preserving deterministic replay and preventing stale approvals from applying to the wrong plan.

## Files Changed

### Core Package

1. **packages/core/src/planVersionManager.ts** (NEW)
   - `PlanVersionManager` class for plan versioning orchestration
   - `derivePlanState()` - Pure function to derive current plan state from events
   - `VersionedPlanPayload` interface with plan_id, plan_version, refinement_of fields
   - `createVersionedPlanPayload()` for generating new versioned plans
   - Tracks highest plan version from events (deterministic replay)

2. **packages/core/src/decisionStore.ts** (NEW)
   - `DecisionStore` class for persisting decisions to `.Ordinex/state/decisions.json`
   - Records: `PlanRefinementDecision`, `PlanApprovalDecision`, `ModeSwitchDecision`
   - `generateChangesSummary()` - Deterministic summary of plan differences
   - Audit trail for all refinement operations

3. **packages/core/src/stateReducer.ts** (MODIFIED)
   - Added import for `derivePlanState` from planVersionManager
   - Added `plan_revised` event type handling (same as plan_created)
   - Plan version tracking happens via derivePlanState() pure function

4. **packages/core/src/index.ts** (MODIFIED)
   - Exported `PlanVersionManager`, `derivePlanState`, `CurrentPlanState`, `VersionedPlanPayload`
   - Exported `DecisionStore`, `generateChangesSummary`, `DecisionRecord`, etc.

### Webview Package

5. **packages/webview/src/components/PlanCard.ts** (MODIFIED)
   - Added plan version badge display (`v1`, `v2`, etc.)
   - Added "Refine Plan" button next to Approve/Cancel buttons
   - Added refinement input form (hidden by default, toggled on click)
   - Shows refinement instruction when plan is a refinement
   - Shows warning that refinement will require re-approval
   - Added CSS for version badge, refinement info, and refine form

6. **packages/webview/src/index.ts** (MODIFIED)
   - Added `toggleRefinePlanInput()` - Toggle visibility of refinement input
   - Added `submitPlanRefinement()` - Submit refinement to backend
   - Sends `ordinex:refinePlan` message to extension

## Architecture

### Plan Versioning Flow
```
1. User creates plan → plan_created event (version 1)
2. User clicks "Refine Plan" → enters refinement instruction
3. Submit refinement:
   - Backend generates new plan with LLM
   - Emits plan_created event with version 2
   - Old pending approvals are auto-canceled
   - Emits execution_paused with reason "awaiting_plan_approval"
4. User must approve new plan before execution
```

### Event Payload Extension (plan_created)
```typescript
interface VersionedPlanPayload {
  plan_id: string;          // uuid for this plan
  plan_version: number;     // 1, 2, 3, etc.
  refinement_of_plan_id: string | null;  // previous plan's id
  refinement_of_plan_version: number | null;
  refinement_instruction: string | null;  // user's refinement text
  plan: StructuredPlan;     // the actual plan
}
```

### Approval Cancellation
When plan is refined:
1. Find all pending approvals for older plan versions
2. Emit `approval_resolved` with:
   - `approved: false`
   - `reason: "superseded_by_plan_version"`
   - `superseded_by_plan_id`, `superseded_by_plan_version`

### Decision Record (decisions.json)
```json
{
  "type": "plan_refinement",
  "task_id": "...",
  "from_plan_id": "...",
  "from_version": 1,
  "to_plan_id": "...",
  "to_version": 2,
  "instruction": "Add error handling steps",
  "summary_of_changes": "2 step(s) added; Risks: 1 → 2",
  "timestamp": "2026-01-23T..."
}
```

## Hard Constraints Followed

✅ Do NOT introduce new event types - using existing `plan_created`, `approval_resolved`, `execution_paused`  
✅ Plan refinement represented as NEW plan_created with plan_version++  
✅ PLAN behavior only - no file writes, no commands, no checkpoints  
✅ Execution pauses after refinement requiring explicit re-approval  
✅ Deterministic replay - derivePlanState() is pure function over events  

## UI Changes

### PlanCard Display
- Version badge shows "v1", "v2", etc.
- Refinement section shows original refinement instruction
- Three action buttons: Approve, Refine Plan, Cancel

### Refine Plan Flow
1. Click "✏️ Refine Plan" button
2. Text area appears with placeholder examples
3. Enter refinement instruction
4. Click "🔄 Generate Refined Plan"
5. New plan card appears with incremented version
6. Old plan approval buttons disabled
7. Must approve new plan to proceed

## Testing

To verify implementation:
1. Create a plan in PLAN mode
2. Click "Refine Plan" on PlanCard
3. Enter refinement text (e.g., "Add a testing step")
4. Submit - observe version increment (v1 → v2)
5. Check old approvals are canceled
6. Check execution is paused awaiting new approval
7. Reload extension - verify state reconstructs from events

## Dependencies

- Existing: EventStore, EventBus, ApprovalManager (supersedePlanApprovals)
- Existing: PlanGenerator (refinePlan function)
- New: PlanVersionManager, DecisionStore
