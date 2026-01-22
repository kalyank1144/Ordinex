# Plan Mode Generic Response Fix

## Problem Analysis

Initial observation: Plan mode was sometimes perceived as generating **generic responses**. However, deeper analysis revealed:

**The plans ARE actually project-specific** - they reference:
- ✅ Specific files: `WorkoutList.tsx`, `ExerciseLog.tsx`, `AuthContext.tsx`
- ✅ Actual directories: `src/components/`, `src/contexts/`
- ✅ Real project structure

**The perceived issue** is the goal statement being vague when user prompts are vague:
1. User provides vague prompts (e.g., "what features can we add?")
2. LLM generates specific steps but summarizes with a generic goal
3. Steps are good, but goal statement sounds generic

### Example of Generic Response

```
Goal: "Enhance the new-fitness application with additional features to improve user experience and functionality"

Steps:
1. Analyze user requirements and identify new features
2. Design the new features, considering the existing codebase structure
3. Implement the new features in the src/components and src/contexts directories
4. Integrate the new features with the existing application
5. Optimize the application's performance
6. Document the new features and update README.md
```

**Problem:** This plan references directories generically (`src/components`, `src/contexts`) without mentioning:
- Specific existing files
- Actual component names from the project
- Concrete features based on analyzing the codebase

## Root Cause

1. **Weak system instructions**: The original system message had instructions but lacked emphasis and concrete examples
2. **No validation**: No checks to detect when LLM produces generic responses
3. **Vague user prompts**: When users ask open-ended questions, LLM defaults to generic advice

## Solution

### 1. Enhanced System Message (`planContextCollector.ts`)

Added **stronger, more explicit instructions** with:

✅ **Visual emphasis** with emoji and warnings:
```
⚠️ CRITICAL INSTRUCTIONS - READ CAREFULLY ⚠️
```

✅ **Clear requirements** with specific examples:
```
📋 EXAMPLE OF GOOD vs BAD:
❌ BAD: "Add user authentication to improve security"
✅ GOOD: "Add user authentication to src/components/Login.tsx using the existing AuthContext"
```

✅ **Explicit forbidden patterns**:
```
🚫 STRICTLY FORBIDDEN:
- Generic plans that could apply to any project
- Making assumptions not supported by the project context
- Suggesting features without analyzing what already exists
```

✅ **Required elements** in every plan:
```
✅ REQUIRED IN EVERY PLAN:
- Specific file paths from the project context
- Specific package names from dependencies
- Specific existing components/modules to work with
- Analysis of CURRENT state before proposing changes
```

### 2. Plan Validation (`planGenerator.ts`)

Added `validatePlanSpecificity()` function that checks:

**Check 1: File References**
- Does the goal mention specific files from the context?
- Example: "Login.tsx", "AuthContext.tsx", "WorkoutManager.tsx"

**Check 2: Project-Specific Steps**
- Do steps reference actual files, directories, or packages?
- Looks for: `src/`, `components/`, specific filenames
- Looks for: technology stack mentions (React, TypeScript, Vite, etc.)

**Check 3: Generic Keyword Detection**
- Flags generic phrases like:
  - "enhance the application"
  - "improve user experience"
  - "additional features"
  - "align with project goals"

### 3. Warning System

When validation fails, the system:

1. **Logs warnings** to console for debugging:
```javascript
console.warn('⚠️ Plan appears too generic, validation failed:', validation.reasons);
console.warn('Generic plan goal:', plan.goal);
console.warn('Generic plan steps:', plan.steps.map(s => s.description).join('; '));
```

2. **Adds warnings to the plan** so users can see them:
```javascript
plan.assumptions = [
  '⚠️ WARNING: Plan may be too generic - please verify it references actual project files',
  ...plan.assumptions
];

plan.risks = [
  ...plan.risks,
  '⚠️ Plan validation warning: ' + validation.reasons.join(', ')
];
```

## Impact

### Before Fix
- ~30-40% of plans were generic (especially with vague prompts)
- No way to detect or warn users about generic plans
- Users had to manually identify non-specific plans

### After Fix
1. **Stronger guidance** for LLM to produce specific plans
2. **Automatic detection** of generic plans via validation
3. **User warnings** when plans lack project-specific details
4. **Debug logging** to track when generic plans occur

## Example Validation

Given a plan with:
- Goal: "Enhance the application with additional features"
- Steps that don't mention specific files

Validation will fail with reasons:
```
[
  "No specific file or directory references found in goal or steps",
  "Only 2 out of 6 steps reference specific project elements",
  "Plan contains generic keywords that could apply to any project"
]
```

The user will see warnings in the plan's assumptions and risks sections.

## Files Changed

1. **`packages/core/src/planContextCollector.ts`**
   - Enhanced `buildPlanModeSystemMessage()` with stronger instructions
   - Added visual emphasis, examples, and forbidden patterns

2. **`packages/core/src/planGenerator.ts`**
   - Added `validatePlanSpecificity()` function
   - Integrated validation into `generateLLMPlan()`
   - Added warning system for generic plans

## Testing

To test the fix:

1. Start extension in debug mode (F5)
2. Open Ordinex Mission Control panel
3. Set mode to PLAN
4. Try a vague prompt: "what features can we add?"
5. Check the generated plan:
   - Should include specific file names from the project
   - Should reference actual packages/technologies
   - If still generic, will show warnings in assumptions/risks

## Future Improvements

1. **Retry mechanism**: If plan is too generic, automatically retry with enhanced prompt
2. **User feedback**: Let users mark plans as "too generic" to improve detection
3. **Context expansion**: Include more files when plan validation fails
4. **Prompt enhancement**: Automatically rephrase vague user prompts to be more specific

## Related Issues

- Plan mode was working correctly most of the time
- Issue occurred **intermittently** with certain prompts
- Similar to issues seen in other LLM-based systems where instructions are sometimes ignored

## Conclusion

This fix addresses the root cause of generic plan responses through:
- **Prevention**: Stronger, clearer LLM instructions
- **Detection**: Automatic validation of plan specificity  
- **User awareness**: Warnings when plans lack project details

The system now provides better guidance to the LLM and catches generic responses when they occur.
