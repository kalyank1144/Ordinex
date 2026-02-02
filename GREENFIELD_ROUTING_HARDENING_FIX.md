# Greenfield Routing Hardening Fix

**Date:** January 31, 2026  
**Issue:** Greenfield requests like "Creating a new fitness app" were routing to command execution instead of scaffold flow  
**Root Cause:** Multiple conflicting keyword lists across files; command detector had `'start'` and `'app'` which matched greenfield prompts

## Problem Analysis

From the screenshots provided:
1. User entered: "Creating a new fitness app with all the features"
2. System set Mode: MISSION
3. Stage Changed: none → **command** (WRONG! Should be scaffold)
4. Command Proposed: `npm run dev` (makes no sense - project doesn't exist!)
5. Command completed with "0 line(s) of output" (obviously, nothing was scaffolded)

**Why this happened:**
- The `userCommandDetector.ts` had `'start'` in COMMAND_VERBS and `'app'` in COMMAND_TARGETS
- "Creating" triggered `'start'` (via regex matching intent patterns)
- "app" triggered `'app'` target
- Combined confidence was enough to trigger command flow instead of greenfield

## Solution: Single Source of Truth Architecture

### Phase 1: Create `greenfieldDetector.ts` (Single Source of Truth)

New file: `packages/core/src/intent/greenfieldDetector.ts`

```typescript
// STRONG_PATTERNS (confidence ~0.9):
// - "create|build|make|start|scaffold..." + "app|project|website..."
// - "new|fresh|blank" + project nouns
// - "from scratch|greenfield|starter template"
// - Framework scaffolding patterns

// EXCLUSION_PATTERNS (prevent false positives):
// - "run|execute|start|launch" + "dev|server|tests|build"
// - "fix|debug|repair|update" + "the|this|my|our"
// - Questions: "why|what|how|where|when"
```

**Key export:**
```typescript
export function detectGreenfieldIntent(text: string): IntentSignal {
  // Returns: { isMatch, confidence (0-1), reason, matchedKeywords }
}
```

### Phase 2: Fix `userCommandDetector.ts`

**Removed ambiguous words:**
- Removed `'start'` and `'build'` from COMMAND_VERBS (too ambiguous)
- Removed `'app'`, `'application'`, `'project'` from COMMAND_TARGETS (these trigger on greenfield prompts)

**Added greenfield pre-check:**
```typescript
const greenfieldResult = detectGreenfieldIntent(prompt);
if (greenfieldResult.isMatch && greenfieldResult.confidence >= 0.65) {
  return { isCommandIntent: false, ... };  // NOT a command!
}
```

### Phase 3: Create `llmIntentClassifier.ts` (Ambiguity Handler)

For edge cases where heuristics are uncertain, a cheap LLM call can disambiguate:

```typescript
export async function llmClassifyIntent(args: LlmClassifyArgs): Promise<LlmIntentResult> {
  // Returns: { intent: 'SCAFFOLD' | 'RUN_COMMAND' | 'PLAN' | ..., confidence, reason }
}
```

### Phase 4: Update `behaviorHandlers.ts`

Added import for greenfield detector to ensure proper routing order:

```typescript
import { detectGreenfieldIntent } from './intent/greenfieldDetector';
```

### Phase 5: Export from `index.ts`

```typescript
export {
  detectGreenfieldIntent,
  isDefinitelyGreenfield,
  isAmbiguousGreenfield,
  IntentSignal,
} from './intent/greenfieldDetector';

export {
  llmClassifyIntent,
  needsLlmClassification,
  LlmIntent,
  LlmIntentResult,
} from './intent/llmIntentClassifier';
```

## Routing Priority (NEW)

The correct routing order for greenfield detection is now:

1. **Greenfield check FIRST** - `detectGreenfieldIntent()` 
   - If confidence >= 0.85 → route to SCAFFOLD flow
   - If confidence >= 0.65 → definitely NOT a command
   
2. **Exclusion patterns** - Reject if user is asking a question or fixing existing code

3. **Command detection** - Only AFTER greenfield is ruled out

4. **LLM Classification** - For ambiguous cases (0.3 < confidence < 0.85)

## Test Cases

| Input | Expected Behavior | Expected Mode |
|-------|-------------------|---------------|
| "Creating a new fitness app" | SCAFFOLD → preflight | MISSION (scaffold stage) |
| "Build a dashboard from scratch" | SCAFFOLD → preflight | MISSION (scaffold stage) |
| "run npm test" | RUN_COMMAND | MISSION (command stage) |
| "start the dev server" | RUN_COMMAND | MISSION (command stage) |
| "make the button blue" | QUICK_ACTION → diff | MISSION (edit stage) |
| "what does this function do" | ANSWER | ANSWER |

## Files Changed

1. **NEW:** `packages/core/src/intent/greenfieldDetector.ts` - Single source of truth for greenfield detection
2. **NEW:** `packages/core/src/intent/llmIntentClassifier.ts` - LLM-based ambiguity handler
3. **MODIFIED:** `packages/core/src/userCommandDetector.ts` - Added greenfield pre-check, removed ambiguous keywords
4. **MODIFIED:** `packages/core/src/behaviorHandlers.ts` - Import greenfield detector
5. **MODIFIED:** `packages/core/src/index.ts` - Export new modules

## Summary

The fix establishes a **single source of truth** for greenfield detection (`greenfieldDetector.ts`) that:

1. Uses layered confidence scoring (strong patterns → weak signals → exclusions)
2. Is checked FIRST before any command detection
3. Prevents false positives on greenfield requests by removing ambiguous keywords from command detection
4. Provides an LLM fallback for genuinely ambiguous cases

This ensures "Creating a new fitness app" will correctly route to the scaffold flow instead of trying to run `npm run dev` on a non-existent project.
