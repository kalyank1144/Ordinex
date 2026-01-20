# Plan Card Display Fix

## Issue
The Plan Card was not displaying the full detailed plan when created in PLAN mode. Instead, it was only showing a summary line like "4 steps | A clear, actionable plan is created and approved" without expanding to show the actual plan content (goal, assumptions, steps, success criteria, etc.).

## Root Cause
The issue was in `packages/webview/src/components/MissionFeed.ts`:

1. **Too Strict Rendering Condition**: The condition to render the detailed PlanCard was:
   ```typescript
   if (event.type === 'plan_created' && event.payload.plan && event.mode === 'PLAN')
   ```
   This required `event.mode === 'PLAN'`, but the mode might not always be properly set on the event object.

2. **Incorrect Data Access in getSummary**: The fallback summary function was accessing:
   ```typescript
   const steps = (e.payload.steps as any[]) || [];
   ```
   But the plan data is actually nested at `e.payload.plan.steps`.

## Fix Applied

### 1. Improved Plan Detection Logic
Changed the condition from strict mode checking to content-based detection:

```typescript
// PLAN mode specialized renderer
// Check if we have a structured plan (either at payload.plan or directly in payload)
if (event.type === 'plan_created') {
  const plan = (event.payload.plan || event.payload) as any;
  // Check if this looks like a structured plan with goal and steps
  if (plan && typeof plan === 'object' && plan.goal && plan.steps && Array.isArray(plan.steps)) {
    return renderPlanCard(event);
  }
}
```

This approach:
- Checks for plan data at both `payload.plan` and directly in `payload`
- Validates the structure by checking for `goal` and `steps` properties
- No longer depends on the `mode` field being set correctly

### 2. Fixed getSummary Function
Updated the `plan_created` summary function to properly access plan data:

```typescript
plan_created: {
  icon: '📋',
  title: 'Plan Created',
  color: 'var(--vscode-charts-purple)',
  getSummary: (e) => {
    // Try to get plan from payload.plan or directly from payload
    const plan = (e.payload.plan || e.payload) as any;
    const steps = plan?.steps || [];
    const criteria = plan?.success_criteria;
    const criteriaStr = Array.isArray(criteria) ? criteria.join(', ') : (criteria || '');
    return `${steps.length} steps${criteriaStr ? ' | ' + criteriaStr : ' | A clear, actionable plan is created and approved'}`;
  }
},
```

## Result
Now when a `plan_created` event is received:
1. The system detects if it contains a structured plan
2. If yes, it renders the full detailed PlanCard showing:
   - Goal
   - Assumptions (if any)
   - Implementation Steps with expected evidence
   - Success Criteria
   - Scope Contract (max files, max lines, allowed tools)
   - Risks (if any)
   - Action buttons (Approve Plan, Edit Plan, Cancel)

The plan is no longer hidden behind just a summary line - users can see the complete planning details.

## Root Cause - Update

After further investigation, I discovered the real issue:

1. **Wrong Plan Generator**: The extension is using `generateTemplatePlan()` which returns a `PlanPayload` structure, but `PlanCard` was designed for `StructuredPlan` format (from LLM)
2. **Structure Incompatibility**: 
   - `PlanPayload` has `step_id`, `stage`, `estimated_effort` in steps
   - `StructuredPlan` has `id`, `expected_evidence` in steps
   - `PlanPayload` has `success_criteria` as a string
   - `StructuredPlan` has `success_criteria` as an array

## Final Fix Applied

### 1. Updated PlanCard.ts to Handle Both Formats
Added normalization logic that:
- Accepts both `PlanPayload` (template) and `StructuredPlan` (LLM) formats
- Maps `step_id` → `id`
- Converts `stage` → `expected_evidence: ["Stage: {stage}"]`
- Handles both string and array `success_criteria`
- Properly handles `assumptions` as both string and array

### 2. MissionFeed.ts Detection Logic
Already updated to detect plans based on content structure rather than mode field.

## Files Modified
- `packages/webview/src/components/PlanCard.ts` - Added format normalization for both PlanPayload and StructuredPlan
- `packages/webview/src/components/MissionFeed.ts` - Fixed plan detection and rendering logic

## Testing Recommendation
1. Enter PLAN mode
2. Ask to plan for a new feature implementation
3. Verify that the Plan Card displays with full details (not just a summary)
4. Verify all sections are visible and properly formatted
5. Verify action buttons are rendered
