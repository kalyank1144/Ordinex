# Plan Mode Improvement Strategy

## Current State (After Fix)

### What Was Done
1. **Enhanced System Message** - Added stronger, clearer instructions for LLM with visual emphasis and examples
2. **Validation Added** - Created internal validation to detect generic plans (logs to console only)
3. **No UI Warnings** - Validation runs silently; does not show warnings to users

### Files Modified
- `packages/core/src/planContextCollector.ts` - Enhanced system message
- `packages/core/src/planGenerator.ts` - Added validation (console logging only)

## Problem Analysis

The real issue is **not the plans themselves** - looking at the screenshot, the plan IS project-specific:
- ✅ Mentions specific files: `WorkoutList.tsx`, `ExerciseLog.tsx`, `AuthContext.tsx`, `WorkoutManager.tsx`, `Login.tsx`
- ✅ References actual directories: `src/components/`, `src/contexts/`
- ✅ Based on real project structure

The perceived "generic" aspect is actually the **goal statement**: *"Enhance the new-fitness project with additional features..."*

This happens when:
1. User gives vague prompt: "what features can we add?"
2. LLM analyzes the project and suggests specific features
3. The **steps are specific**, but the **goal summarizes the vague prompt**

## Proposed Better Strategy

### Option 1: Automatic Prompt Enhancement (RECOMMENDED)

**When vague prompt detected, enhance it before sending to LLM:**

```typescript
function detectVaguePrompt(prompt: string): boolean {
  const vaguePatterns = [
    /what (?:features|improvements|changes) (?:can|should) (?:we|i) add/i,
    /suggest (?:some |)(?:features|improvements)/i,
    /ideas? for/i,
    /how (?:can|should) (?:we|i) improve/i
  ];
  return vaguePatterns.some(pattern => pattern.test(prompt));
}

function enhanceVaguePrompt(prompt: string, projectContext: PlanContextBundle): string {
  const projectName = extractProjectName(projectContext);
  const mainFiles = projectContext.open_files.map(f => f.path).join(', ');
  
  return `${prompt}

CONTEXT: This is for the "${projectName}" project. 
Current focus files: ${mainFiles}

Please:
1. Analyze the existing codebase structure
2. Identify gaps or areas for improvement
3. Suggest 2-3 concrete, specific features based on what you see
4. Reference actual files and components in your suggestions`;
}
```

**Benefits:**
- Handles vague prompts proactively
- No user-visible warnings
- Better LLM outputs automatically

### Option 2: Two-Pass Planning

**First pass: Analyze project, Second pass: Generate plan**

```typescript
async function generateLLMPlanWithAnalysis(prompt: string, ...): Promise<StructuredPlan> {
  // Pass 1: Project analysis
  const analysisPrompt = `Analyze the ${projectName} project and identify:
1. Main features currently implemented
2. Obvious gaps or missing functionality
3. Natural next steps for development

Based on codebase analysis only.`;
  
  const analysis = await llmService.call(analysisPrompt, systemContext);
  
  // Pass 2: Generate plan with analysis context
  const planPrompt = `${prompt}

Project Analysis:
${analysis}

Now create a specific plan referencing actual files and components.`;
  
  const plan = await llmService.call(planPrompt, systemContext);
  return plan;
}
```

**Benefits:**
- Forces LLM to analyze first, then plan
- More deliberate, thoughtful plans
- **Downside:** 2x LLM calls (slower, more expensive)

### Option 3: Interactive Clarification

**Ask user to clarify vague prompts before generating plan:**

```typescript
if (detectVaguePrompt(prompt)) {
  // Emit clarification_needed event
  await eventBus.publish({
    type: 'clarification_needed',
    payload: {
      original_prompt: prompt,
      suggestions: [
        'Be more specific about which features',
        'Which file/component to enhance',
        'What problem are you trying to solve'
      ]
    }
  });
  
  // UI shows: "Your prompt is quite open-ended. Consider being more specific..."
  // User can either refine or proceed
}
```

**Benefits:**
- Educates users to write better prompts
- No wasted LLM calls on vague requests
- **Downside:** Extra friction, might annoy users

### Option 4: Goal Rewriting

**Keep current flow, but rewrite generic goals post-generation:**

```typescript
function rewriteGenericGoal(plan: StructuredPlan): StructuredPlan {
  const genericGoalPatterns = [
    /enhance (?:the )?(?:\w+ )?(?:application|project) with/i,
    /add (?:additional )?features/i,
    /improve user experience/i
  ];
  
  const isGenericGoal = genericGoalPatterns.some(p => p.test(plan.goal));
  
  if (isGenericGoal && plan.steps.length > 0) {
    // Extract concrete features from steps
    const features = plan.steps
      .map(s => extractMainAction(s.description))
      .slice(0, 2)
      .join(' and ');
    
    plan.goal = `Implement ${features} for the project`;
  }
  
  return plan;
}
```

**Benefits:**
- Minimal changes to existing flow
- Fixes generic goals without retry
- **Downside:** Heuristic-based, might miss edge cases

## Recommendation

**Implement Option 1 (Automatic Prompt Enhancement) + Option 4 (Goal Rewriting)**

### Implementation Plan

1. **Add prompt detection and enhancement** in `planGenerator.ts`:
   ```typescript
   // Before calling LLM
   if (detectVaguePrompt(prompt)) {
     prompt = enhanceVaguePrompt(prompt, contextBundle);
     console.log('[PLAN] Enhanced vague prompt:', prompt);
   }
   ```

2. **Add goal rewriting** after plan generation:
   ```typescript
   // After successful parse
   plan = rewriteGenericGoal(plan);
   ```

3. **Keep existing validation** for monitoring:
   - Logs to console for debugging
   - Helps track when enhancements work/don't work
   - No user-facing warnings

## Benefits of This Approach

✅ **Transparent** - Works behind the scenes
✅ **No false positives** - Doesn't warn about valid plans
✅ **Proactive** - Enhances prompts before LLM call
✅ **Measurable** - Logs allow tracking improvement
✅ **Non-breaking** - Doesn't change user flow

## Future Enhancements

1. **User feedback loop** - Let users rate plan quality
2. **Prompt templates** - Suggest common plan types
3. **Learning system** - Track which prompt patterns produce better plans
4. **Context expansion** - Automatically include more files for vague prompts

## Summary

The current system messages and validation are **good improvements**, but we should:
- Keep the enhanced system message (better LLM guidance)
- Keep validation for logging/debugging only
- Add prompt enhancement for vague requests
- Add goal rewriting to fix generic goal statements
- Never show validation warnings to users (trust LLM output)
