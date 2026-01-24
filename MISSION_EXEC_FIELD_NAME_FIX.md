# MISSION Execution - Field Name Mismatch Fix

## Problem
The `.slice()` error was caused by a **field name mismatch** between TypeScript interfaces and runtime data:

```
TypeError: Cannot read properties of undefined (reading 'slice')
at createDiffId (/Users/kalyankumarchindam/Documents/Ordinex/packages/core/dist/atomicDiffApply.js:343:49)
```

### Root Cause
The code was accessing `step.id` but the actual plan structure uses `step.step_id`:

**Runtime Data (from LLM):**
```json
{
  "steps": [
    {
      "step_id": "step_1",  ← Field is "step_id"
      "description": "Gather requirements and context",
      "stage": "retrieve"
    }
  ]
}
```

**TypeScript Interface (before fix):**
```typescript
export interface StructuredPlan {
  steps: Array<{
    id: string;  ← Was "id" but should be "step_id"
    description: string;
    expected_evidence: string[];
  }>;
}
```

This caused `step.id` to be `undefined`, which then caused `.slice()` to fail when trying to create diff IDs.

## Solution

### File 1: `packages/core/src/planGenerator.ts`
**Changed StructuredPlan interface to match runtime data:**

```typescript
export interface StructuredPlan {
  goal: string;
  assumptions: string[];
  success_criteria: string[];
  scope_contract: {
    max_files: number;
    max_lines: number;
    allowed_tools: string[];
  };
  steps: Array<{
    step_id: string;  // ← Changed from "id" to "step_id"
    description: string;
    expected_evidence: string[];
  }>;
  risks: string[];
}
```

Also fixed fallback plan generation to use `step_id`:
```typescript
steps: [
  {
    step_id: 'step_1',  // ← Changed from "id"
    description: 'Analyze requirements',
    expected_evidence: ['Project files examined']
  },
  // ...
]
```

### File 2: `packages/core/src/missionExecutor.ts`
**Replaced all references from `step.id` to `step.step_id`:**

Changed 16 occurrences throughout the file using bulk replacement:
```bash
sed -i '' 's/step\.id/step.step_id/g' packages/core/src/missionExecutor.ts
```

Examples of what was changed:
```typescript
// Before:
const stepId = step.id;
const diffId = createDiffId(this.taskId, step.id);
this.executionState.completedSteps.push(step.id);

// After:
const stepId = step.step_id;
const diffId = createDiffId(this.taskId, step.step_id);
this.executionState.completedSteps.push(step.step_id);
```

## Files Modified
1. **packages/core/src/planGenerator.ts**
   - Updated `StructuredPlan` interface (line 33)
   - Fixed fallback plan generation (lines 185-195)

2. **packages/core/src/missionExecutor.ts**
   - Replaced all 16 occurrences of `step.id` with `step.step_id`

## Build Status
```bash
$ pnpm run build
✅ packages/core build: Done in 1.1s
✅ packages/webview build: Done in 843ms  
✅ packages/extension build: Done in 560ms
```

All TypeScript errors resolved!

## Testing Instructions
1. **Reload VS Code window** (Cmd+Shift+P → "Reload Window")
2. **Set mode to MISSION**
3. **Create a plan** (e.g., "create user login functionality")
4. **Approve the plan**
5. **Execute the plan**
6. **Verify:**
   - No more "Cannot read properties of undefined (reading 'slice')" error
   - EDIT stage now executes properly
   - Diff proposals are generated correctly
   - Timeline shows correct events

## Related Fixes
This complements the comprehensive reliability fixes documented in:
- `MISSION_EXEC_RELIABILITY_FIX.md` - Core backend fixes (Phases 1-5)
- `MISSION_EXEC_UI_FIX.md` - UI support for new event types (`step_failed`)

## Summary
The issue was a simple but critical field name mismatch between the TypeScript interface definition and the actual runtime data structure. The LLM generates plans with `step_id`, but the code was expecting `id`. This fix aligns the interface with reality.
