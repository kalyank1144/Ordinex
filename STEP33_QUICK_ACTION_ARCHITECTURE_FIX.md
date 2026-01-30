# Step 33: QUICK_ACTION Architecture Fix Required

## Critical Finding ⚠️

The current QUICK_ACTION implementation is **architecturally wrong**. It's trying to create a minimal plan and execute through MissionExecutor, but this causes it to skip the actual work and mark as complete.

## Event Log Analysis

```
📋 Plan Created → 1 step plan
🚀 Mission Started
▶️ Step Started
🔄 Stage Changed → repair (NOT edit!)
✅ Step Completed (without doing anything)
🎉 Mission Completed
```

**Problem**: Mission jumped to "repair" stage and completed without performing any edits.

## Root Cause

According to Step 33 spec:
- **QUICK_ACTION**: "Small, obvious change → **gated diff/tool**"

This means QUICK_ACTION should:
- ✅ Generate diff **directly**
- ✅ Show for approval
- ✅ Apply changes
- ❌ **NOT** create a plan and run through MissionExecutor

## Current (Wrong) Approach

```typescript
case 'QUICK_ACTION':
  // Create a 1-step plan
  const quickPlan: StructuredPlan = { ... };
  
  // Emit plan_created event
  await this.emitEvent({ type: 'plan_created', payload: quickPlan });
  
  // User approves plan
  // handleExecutePlan() called
  // MissionExecutor tries to execute but has no real work to do
  // Marks as complete without doing anything
```

**Why this fails**:
1. MissionExecutor is designed for multi-step operations
2. The 1-step plan doesn't have enough detail for MissionExecutor to know what to do
3. It skips the actual LLM call to generate the fix
4. No diff is ever generated

## Correct Approach (Step 33 Spec)

```typescript
case 'QUICK_ACTION':
  // 1. Call LLM directly to analyze and generate fix
  const llmService = new LLMService(...);
  const fixPrompt = `Analyze ${referencedFiles.join(', ')} and fix: ${text}`;
  const fixResponse = await llmService.generateEdit(fixPrompt, referencedFiles);
  
  // 2. Generate diff proposal from LLM response
  const diffProposal = parseDiffFromResponse(fixResponse);
  
  // 3. Emit diff_proposed event (NOT plan_created)
  await this.emitEvent({
    type: 'diff_proposed',
    payload: {
      diff_id: this.generateId(),
      files_changed: diffProposal.files,
      summary: `Quick fix: ${text}`,
      patch: diffProposal.patch
    }
  });
  
  // 4. Request approval
  await this.emitEvent({
    type: 'approval_requested',
    payload: {
      approval_type: 'diff_approval',
      ...
    }
  });
  
  // 5. On approval → apply diff
  // handleResolveApproval() → applyDiff()
```

## Behavior Comparison

| Step | PLAN Behavior | QUICK_ACTION Behavior (Correct) |
|------|---------------|--------------------------------|
| 1 | Create multi-step plan | Call LLM to generate fix |
| 2 | Request plan approval | Generate diff |
| 3 | Execute mission (multi-step) | Request diff approval |
| 4 | Each step calls LLM | Apply diff |
| 5 | Test, repair, iterate | Done ✓ |

**Key Difference**: PLAN goes through full mission execution with multiple LLM calls. QUICK_ACTION makes ONE LLM call to generate the fix, then applies it.

## Why 1-Step Plan Doesn't Work

The MissionExecutor expects plan steps to have:
- Stage classification (edit, test, retrieve, etc.)
- Sufficient detail to guide LLM calls
- Context about what files to read
- Specific instructions on what to change

Our minimal 1-step plan has:
```typescript
{
  step_id: 'step_1',
  description: 'Getting some typo errors in exercise.ts file, can you fix it?',
  expected_evidence: ['file_modified', 'change_complete']
}
```

This doesn't tell MissionExecutor:
- ❌ What file to read (`exercise.ts` is just in the description string)
- ❌ What specific changes to make
- ❌ How to analyze the code
- ❌ What stage this is (retrieve? edit?)

So MissionExecutor:
1. Can't determine the stage → defaults to "repair"
2. Has no work to do → marks step as complete
3. Mission completes without doing anything

## Recommended Fix

**Option 1**: Implement QUICK_ACTION as direct diff generation (per spec)
- Bypass plan creation entirely
- Call LLM once to generate fix
- Create diff proposal
- Request approval
- Apply

**Option 2**: Keep plan-based approach but enhance it
- Add "stage" field to steps: `stage: 'edit'`
- Add "target_files" field: `target_files: ['exercise.ts']`
- Add "action_type" field: `action_type: 'fix_typo'`
- MissionExecutor recognizes `quick_action: true` flag and handles differently

**Recommendation**: **Option 1** is better because:
- ✅ Matches Step 33 spec exactly
- ✅ Simpler, faster execution
- ✅ Clear separation from PLAN behavior
- ✅ No need to modify MissionExecutor

## Implementation Path

1. **Remove** the plan creation from QUICK_ACTION handler
2. **Add** direct LLM call to generate fix
3. **Emit** diff_proposed instead of plan_created
4. **Reuse** existing diff approval flow
5. **Apply** diff on approval

This makes QUICK_ACTION truly "quick" - one LLM call, one diff, done.

## Summary

**Current State**: QUICK_ACTION creates a 1-step plan that MissionExecutor can't execute properly

**Root Cause**: Using wrong architecture - trying to force quick actions through multi-step mission pipeline

**Solution**: Bypass plan creation, generate diff directly, request approval, apply

**Impact**: QUICK_ACTION will actually work and make the requested changes
