# Step 40: Production-Grade Intent Routing - COMPLETE

## Overview
Step 40 implements a unified, replay-safe intent routing system that consolidates all intent detection logic into a single authoritative pipeline. This eliminates duplicate greenfield detection code and provides a deterministic routing algorithm.

## Files Created

### 1. `packages/core/src/intent/intentSignals.ts`
Single source of truth for all intent detection heuristics:
- `normalizeUserInput(text)` - Input normalization
- `detectGreenfieldIntent(text)` - Greenfield project detection
- `detectCommandIntent(text)` - Command execution detection
- `detectEditScale(text)` - Edit scope detection (trivial/small/medium/large)
- `detectSlashOverride(text)` - Slash command detection (/scaffold, /plan, etc.)

### 2. `packages/core/src/intent/intentRouter.ts`
Hybrid routing algorithm with exact order:
1. **Replay check** - Use cached result if replaying
2. **Slash override** - Always wins (/scaffold, /plan, /run, /answer)
3. **Heuristic pass** - Fast, free detection
4. **High confidence shortcuts** - Confidence ≥ 0.85 routes immediately
5. **Ambiguity check** - Determine if LLM needed
6. **LLM classification** - Only for ambiguous cases
7. **Heuristic fallback** - Medium confidence routing
8. **Behavior fallback** - Step 33 integration
9. **Ultimate fallback** - Default to ANSWER

Exports:
- `routeIntent(input, context)` - Main routing function
- `isDefinitelyScaffold(text)` - Quick high-confidence check
- `isDefinitelyRunCommand(text)` - Quick command check
- `shouldCallLLM(text, confidence)` - LLM trigger check
- `generateClarificationQuestion(signals)` - Ambiguity UX

### 3. `packages/core/src/__tests__/intentRouter.test.ts`
Comprehensive test suite covering:
- Input normalization
- Greenfield detection (strong/weak patterns, exclusions)
- Command detection
- Edit scale detection
- Slash override detection
- Router integration tests
- Real-world prompt test cases

## Event Type Added

### `intent_routed`
Added to `packages/core/src/types.ts`:
```typescript
| 'intent_routed'  // Step 40: Production-Grade Intent Routing
```

Payload structure:
```typescript
{
  intent: 'SCAFFOLD' | 'RUN_COMMAND' | 'PLAN' | 'QUICK_ACTION' | 'ANSWER' | 'CLARIFY',
  source: 'slash' | 'heuristic' | 'llm' | 'behavior',
  confidence: number,
  reasoning: string,
  llmCalled: boolean
}
```

## Routing Algorithm Details

### Priority Order
1. **Slash overrides** (confidence = 1.0)
   - `/scaffold` → SCAFFOLD
   - `/plan` → PLAN
   - `/run`, `/do` → RUN_COMMAND
   - `/answer`, `/chat`, `/ask` → ANSWER

2. **High confidence heuristics** (≥ 0.85)
   - Greenfield patterns → SCAFFOLD
   - Command patterns → RUN_COMMAND

3. **LLM classification** (for ambiguous cases)
   - Only called when:
     - Greenfield confidence 0.3–0.85
     - Command/greenfield close (gap < 0.2)
     - Behavior confidence < 0.6
   - Uses Haiku model for speed (256 max tokens)

4. **Fallback chain**
   - Medium greenfield (≥ 0.65) → SCAFFOLD
   - Medium command (≥ 0.65) → RUN_COMMAND
   - Large/medium edit scale → PLAN
   - Small/trivial edit scale → QUICK_ACTION
   - Default → ANSWER

### Replay Safety
- Router checks for existing `intent_routed` events in context
- When `isReplay: true`, uses cached result without LLM calls
- Reasoning prefixed with `[REPLAY]` for traceability

## Integration Points

### Existing Code Compatibility
The new router integrates with existing systems:
- **Step 33 (Intent Analyzer)**: Uses same behavior types
- **Step 35 (Scaffold Flow)**: Routes SCAFFOLD intent
- **Step 34.5 (Command Phase)**: Routes RUN_COMMAND intent
- **LLM Intent Classifier**: Reused for ambiguous cases

### Backward Compatibility
- Existing `greenfieldDetector.ts` remains for direct consumers
- Existing `intentAnalyzer.ts` can be updated to use new router
- All detection patterns consolidated but compatible

## Test Coverage

### Detection Tests
- Greenfield strong patterns (5 cases)
- Greenfield exclusion patterns (4 cases)
- Command detection (5 cases)
- Edit scale detection (3 cases)
- Slash override detection (5 cases)

### Router Tests
- Slash override routing (4 cases)
- Heuristic routing (6 cases)
- Replay detection (1 case)
- Helper functions (6 cases)
- Clarification question generation (3 cases)

### Real-World Prompts
- 5 greenfield prompts → SCAFFOLD
- 3 command prompts → RUN_COMMAND
- 3 question prompts → ANSWER
- 3 edit prompts → QUICK_ACTION/PLAN

## Stop Condition Verification
- ✅ User prompt "Creating a new fitness app" routes to SCAFFOLD
- ✅ Slash commands override heuristics
- ✅ Questions route to ANSWER
- ✅ Commands route to RUN_COMMAND
- ✅ Replay uses cached result without LLM
- ✅ Events persisted for replay safety

## Integration Status

### Core Exports Added to index.ts
The following are now available from `@ordinex/core`:

**Functions:**
- `routeIntent(input, context)` - Main routing function
- `isDefinitelyScaffold(text)` - Quick high-confidence greenfield check
- `isDefinitelyRunCommand(text)` - Quick command check
- `shouldCallLLM(text, confidence)` - LLM trigger decision
- `generateClarificationQuestion(signals)` - Ambiguity UX
- `detectGreenfieldSignal(text)` - Consolidated greenfield detection
- `detectCommandSignal(text)` - Consolidated command detection
- `detectEditScale(text)` - Edit scope detection
- `detectSlashOverride(text)` - Slash command parsing
- `normalizeUserInput(text)` - Input normalization

**Types:**
- `RoutedIntent` - Intent type union
- `RoutingContext` - Context for routing
- `IntentRoutingResult` - Full routing result

### Backward Compatibility
The existing `intentAnalyzer.ts` and `greenfieldDetector.ts` remain fully functional.
The new router can be used alongside or as a replacement when ready.

## Summary
Step 40 creates a unified intent routing system with:
- **Single source of truth** for all intent detection
- **Hybrid algorithm** combining heuristics + LLM
- **Replay safety** via event persistence
- **Comprehensive tests** for reliability
- **Backward compatibility** with existing systems
