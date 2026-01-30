# Step 33: Mode Behavior Refinement (FINAL)

## Summary

Implemented a pre-execution intelligence layer that:
- Understands user intent
- Checks completeness
- Evaluates scope
- Resolves context ("this", "it")
- Selects the correct execution behavior

**Core Concept**: Mode is no longer selected first. **Behavior is selected first**. Mode is a downstream consequence.

## The 5 Behaviors

| Behavior | Purpose | Derived Mode |
|----------|---------|--------------|
| ANSWER | Discussion, explanation, opinions | ANSWER |
| CLARIFY | Missing info → ask + offer tools | ANSWER |
| QUICK_ACTION | Small, obvious change → gated diff/tool | MISSION |
| PLAN | Large or greenfield work | PLAN |
| CONTINUE_RUN | Mid-execution interruption handling | MISSION |

## Behavior Selection Algorithm

```
User Input
    ↓
0. Is there a user override command (/chat, /do, /plan, etc.)?
   → YES → Use overridden behavior

1. Is there an active run?
   → YES → CONTINUE_RUN

2. Is this a pure question?
   → YES → ANSWER

3. Is required information missing?
   → YES → CLARIFY (max 2 attempts)

4. Determine scope (heuristics first)
   → trivial / small → QUICK_ACTION
   → medium / large → PLAN

5. Resolve references ("this", "it")
   Priority:
   - last_applied_diff
   - last_open_editor
   - last_artifact_proposed
   - else → CLARIFY
```

## Files Created/Modified

### New Files
| File | Description |
|------|-------------|
| `packages/core/src/intentAnalyzer.ts` | Core intent analysis algorithm with behavior selection |
| `packages/core/src/behaviorHandlers.ts` | 5 behavior pipeline handlers |
| `packages/core/src/__tests__/intentAnalyzer.test.ts` | Comprehensive unit tests |

### Modified Files
| File | Changes |
|------|---------|
| `packages/core/src/types.ts` | Added Behavior, IntentAnalysis, ClarificationOption, ContextSource, etc. |
| `packages/core/src/index.ts` | Export new modules |

## Key Types Added (types.ts)

```typescript
// The 5 behaviors
type Behavior = 'ANSWER' | 'CLARIFY' | 'QUICK_ACTION' | 'PLAN' | 'CONTINUE_RUN';

// Intent analysis result (output contract)
interface IntentAnalysis {
  behavior: Behavior;
  context_source: ContextSource;
  clarification?: ClarificationRequest;
  confidence: number;
  reasoning: string;
  derived_mode: Mode;
  detected_scope?: 'trivial' | 'small' | 'medium' | 'large';
  referenced_files?: string[];
  user_override?: string;
}

// Context source tracking
interface ContextSource {
  type: 'fresh' | 'follow_up' | 'explicit_reference';
  files?: string[];
  previous_task_id?: string;
}

// Clarification options for UI
interface ClarificationOption {
  label: string;
  action: 'provide_file' | 'provide_scope' | 'confirm_intent' | 'cancel';
  value?: string;
}
```

## User Override Commands

Support explicit overrides that bypass intent analysis:

| Command | Behavior |
|---------|----------|
| `/chat`, `/ask` | ANSWER |
| `/do`, `/edit` | QUICK_ACTION |
| `/run` | CONTINUE_RUN |
| `/plan`, `/mission` | PLAN |

## Behavior → Pipeline Mapping

### ANSWER Pipeline
- No execution
- No tools
- No state mutation
- Stream response directly

### CLARIFY Pipeline
- Ask question with action buttons
- Wait for user input
- Re-run intent analysis after response
- Max 2 clarification attempts

### QUICK_ACTION Pipeline
- Retrieve minimal context
- Generate diff / tool proposal
- **Always gated** (approval required)
- Approve → Apply → Done

### PLAN Pipeline
- Existing PLAN → approve → MISSION pipeline
- Used for greenfield, major features, multi-module

### CONTINUE_RUN Pipeline
- Show current status
- Offer: Resume, Pause, Abort, Propose fix
- **Never restart plan automatically**

## Scope Detection Rules

Use keyword + pattern heuristics first (no LLM calls):

| Scope | Criteria |
|-------|----------|
| Trivial | Fix typo, rename, add import, simple changes |
| Small | 1-3 files, clear intent, well-scoped |
| Medium | 4-10 files, some dependencies |
| Large | 10+ files, cross-domain, greenfield |

**Default bias**: small → QUICK_ACTION (not PLAN)

## Reference Resolution Priority

When prompt contains "this", "it", "the file", etc.:

1. `last_applied_diff` - Files from most recent diff
2. `last_open_editor` - Currently open file in VS Code
3. `last_artifact_proposed` - Last proposed plan/diff/checkpoint
4. else → CLARIFY (ask user to specify)

## Event System Alignment

**No breaking changes**. Behaviors are encoded via:

- `intent_received` event with `behavior` field in payload
- Existing `mode_set` event (downstream of behavior)
- Existing approval + execution events

Example event payload:
```json
{
  "type": "intent_received",
  "payload": {
    "behavior": "QUICK_ACTION",
    "context_source": { "type": "fresh" },
    "confidence": 0.85,
    "reasoning": "Scope: small (1 action verb(s), single file scope)",
    "detected_scope": "small",
    "referenced_files": ["src/index.ts"]
  }
}
```

## Test Coverage

Comprehensive unit tests for:
- User override commands (6 tests)
- Active run detection (2 tests)
- Pure question detection (6 tests)
- Missing information / CLARIFY (4 tests)
- Scope detection QUICK_ACTION vs PLAN (5 tests)
- isPureQuestion function (6 tests)
- resolveReferences function (5 tests)
- detectScope function (5 tests)
- extractReferencedFiles function (4 tests)
- detectActiveRun function (5 tests)
- Derived mode mapping (5 tests)
- Configuration validation (2 tests)

## Usage Example

```typescript
import { 
  analyzeIntent, 
  executeBehavior,
  IntentAnalysisContext 
} from '@ordinex/core';

// Analyze user intent
const context: IntentAnalysisContext = {
  clarificationAttempts: 0,
  lastOpenEditor: 'src/index.ts',
};

const analysis = analyzeIntent('Fix the typo in this file', context);
// Returns:
// {
//   behavior: 'QUICK_ACTION',
//   derived_mode: 'MISSION',
//   confidence: 0.9,
//   reasoning: 'Scope: trivial (trivial action verb detected)',
//   detected_scope: 'trivial',
//   referenced_files: ['src/index.ts']
// }

// Execute the behavior handler
const result = await executeBehavior({
  taskId: 'task_123',
  prompt: 'Fix the typo in this file',
  intentAnalysis: analysis,
  eventBus,
  analysisContext: context,
});
// result.next_action === 'propose_diff'
```

## Key Design Decisions

1. **Behavior-first, Mode-downstream**: IntentAnalyzer outputs `behavior`, mode is derived
2. **Heuristics-first**: No LLM calls for scope detection unless truly ambiguous
3. **Default bias toward QUICK_ACTION**: Small scope → QUICK_ACTION (not PLAN)
4. **Max 2 clarification attempts**: Prevent infinite loops
5. **Event-compatible**: No breaking changes to event system
6. **Deterministic + Fast**: Intent analysis must be <10ms

## Stop Condition

✅ Step 33 complete when:
- `analyzeIntent()` returns correct behavior for all 5 cases
- Context resolution follows priority stack correctly
- User override commands bypass intent analysis
- CLARIFY behavior re-runs analysis after user response
- CONTINUE_RUN detects active/paused missions
- Scope detection defaults to QUICK_ACTION for small work
- All behaviors emit correct events
- Unit tests pass for all scenarios
