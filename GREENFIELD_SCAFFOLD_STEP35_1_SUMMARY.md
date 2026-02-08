# Step 35.1: Greenfield Scaffold Flow - Foundation Complete

## Summary

Step 35.1 implements the **foundation for greenfield project scaffolding** in Ordinex. This includes routing detection, event types, scaffold flow coordinator, and UI rendering — all without actual file creation or terminal execution.

## What Was Implemented

### A) Greenfield Detection in Intent Analyzer

**File**: `packages/core/src/intentAnalyzer.ts`

Added flow kind routing with deterministic greenfield detection:

```typescript
// New exports
export function isGreenfieldRequest(prompt: string): boolean
export function detectFlowKind(prompt: string): FlowKind
export function analyzeIntentWithFlow(prompt, context): IntentAnalysisWithFlow
```

**Greenfield patterns detected**:
- "create a new app/project"
- "start a new project/app" 
- "from scratch"
- "greenfield", "scaffold", "bootstrap"
- Framework-specific: "new nextjs app", "new vite app", "new expo app", etc.

**User override handling**:
- `/plan`, `/do`, `/edit` overrides bypass scaffold routing
- CONTINUE_RUN behavior takes precedence
- Pure questions (ANSWER) don't route to scaffold

### B) New Scaffold Event Types

**File**: `packages/core/src/types.ts`

Added 4 new canonical event types:

| Event Type | Purpose |
|------------|---------|
| `scaffold_started` | Marks beginning of scaffold flow |
| `scaffold_proposal_created` | Contains proposal with placeholders |
| `scaffold_applied` | For Step 35.2+ when files are created |
| `scaffold_completed` | Terminal event with status |

**Payload interfaces**:
- `ScaffoldStartedPayload` - scaffold_id, run_id, user_prompt, target_directory
- `ScaffoldProposalCreatedPayload` - recipe, design_pack, files_count, summary
- `ScaffoldAppliedPayload` - status: 'noop', files_created (empty in 35.1)
- `ScaffoldCompletedPayload` - status: 'cancelled' | 'ready_for_step_35_2'

**Flow kind type**:
```typescript
export type FlowKind = 'scaffold' | 'standard';
```

### C) Scaffold Flow Coordinator

**File**: `packages/core/src/scaffoldFlow.ts`

Created `ScaffoldFlowCoordinator` class with:

```typescript
class ScaffoldFlowCoordinator {
  async startScaffoldFlow(runId, userPrompt, targetDirectory?): Promise<ScaffoldFlowState>
  async handleUserAction(action: 'proceed' | 'cancel' | 'change_style'): Promise<ScaffoldFlowState>
  getState(): ScaffoldFlowState | null
  isAwaitingDecision(): boolean
}
```

**Event emission order**:
1. `scaffold_started`
2. `scaffold_proposal_created` (with placeholder values)
3. `decision_point_needed` (scaffold_approval type)
4. *[user clicks Proceed/Cancel]*
5. `scaffold_completed`

**Helper functions**:
- `deriveScaffoldFlowState(events)` - Replay-safe state derivation
- `isScaffoldDecisionPoint(event)` - Check if event is scaffold decision
- `extractScaffoldId(event)` - Get scaffold ID from event

### D) Event Normalizer Mappings

**File**: `packages/core/src/eventNormalizer.ts`

Added normalization mappings:

```typescript
scaffold_started: { type: 'run_started', kind: 'scaffold', ui_hint: 'scaffold_card' }
scaffold_proposal_created: { type: 'artifact_proposed', kind: 'scaffold_proposal', ui_hint: 'scaffold_card' }
scaffold_applied: { type: 'artifact_applied', kind: 'scaffold', ui_hint: 'scaffold_card' }
scaffold_completed: { type: 'run_completed', kind: 'scaffold', ui_hint: 'scaffold_card' }
```

### E) UI ScaffoldCard Component

**File**: `packages/webview/src/components/ScaffoldCard.ts`

Minimal custom element (no external deps) rendering:

- **scaffold_started**: "Create New Project" card with user prompt
- **scaffold_proposal_created**: Proposal card with Recipe/Design placeholders
- **scaffold_completed**: Success (ready) or cancelled state

Visual features:
- Color-coded badges (blue/purple/green/orange)
- Placeholder notice for Step 35.4 features
- Clean grid layout for proposal details

### F) Tests

**File**: `packages/core/src/__tests__/scaffoldFlow.test.ts`

Comprehensive test coverage:
- Greenfield detection patterns (18+ patterns)
- Flow kind routing with overrides
- `analyzeIntentWithFlow` integration
- ScaffoldFlowCoordinator event emission
- Decision point options (Proceed/Cancel/Change Style)
- Replay-safe state derivation
- Helper function behavior

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Added FlowKind, scaffold event types, payload interfaces |
| `packages/core/src/intentAnalyzer.ts` | Added greenfield detection, analyzeIntentWithFlow |
| `packages/core/src/scaffoldFlow.ts` | **NEW** - Scaffold flow coordinator |
| `packages/core/src/eventNormalizer.ts` | Added scaffold event mappings |
| `packages/core/src/index.ts` | Added exports for new modules |
| `packages/webview/src/components/ScaffoldCard.ts` | **NEW** - UI component |
| `packages/core/src/__tests__/scaffoldFlow.test.ts` | **NEW** - Test suite |

## What This Step Does NOT Do (Strict)

Per spec, Step 35.1 explicitly excludes:
- ❌ No actual file creation
- ❌ No terminal command execution  
- ❌ No recipe selection logic
- ❌ No design packs
- ❌ No preview images
- ❌ No verify/repair integration
- ❌ No monorepo detection
- ❌ No non-empty directory checks

These are reserved for Steps 35.2-35.6.

## Stop Condition Validation

When user types: **"Create a new app from scratch"**

✅ Ordinex emits `scaffold_started` + `scaffold_proposal_created`  
✅ UI shows ScaffoldCard with Proceed/Cancel  
✅ Clicking Proceed emits `scaffold_completed` status=ready_for_step_35_2  
✅ Clicking Cancel emits `scaffold_completed` status=cancelled  
✅ No files are created, no terminal commands run, no verify runs  

## Architecture Diagram

```
User Input: "Create a new app from scratch"
        │
        ▼
┌─────────────────────────┐
│   Intent Analyzer       │
│   analyzeIntentWithFlow │
│   flow_kind: 'scaffold' │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────────┐
│  ScaffoldFlowCoordinator    │
│  startScaffoldFlow()        │
└───────────┬─────────────────┘
            │
   ┌────────┴────────┐
   │                 │
   ▼                 ▼
scaffold_started  scaffold_proposal_created
   │                 │
   └────────┬────────┘
            │
            ▼
   decision_point_needed
   (scaffold_approval)
            │
            ▼
    ┌───────────────┐
    │  ScaffoldCard │ ◄─── UI renders Proceed/Cancel
    │    (Webview)  │
    └───────┬───────┘
            │
   User clicks Proceed/Cancel
            │
            ▼
   scaffold_completed
   (ready_for_step_35_2 | cancelled)
```

## Next Steps (Step 35.2+)

1. **Step 35.2**: Monorepo detection, non-empty directory handling
2. **Step 35.3**: Recipe selection (framework templates)
3. **Step 35.4**: Design pack selection, Change Style button enabled
4. **Step 35.5**: File creation & apply phase
5. **Step 35.6**: Verify integration for scaffolded projects

## Integration Notes

To wire scaffold flow into the router/extension:

```typescript
import { analyzeIntentWithFlow, ScaffoldFlowCoordinator } from '@ordinex/core';

const analysis = analyzeIntentWithFlow(userPrompt, context);

if (analysis.flow_kind === 'scaffold') {
  const coordinator = new ScaffoldFlowCoordinator(eventBus);
  await coordinator.startScaffoldFlow(runId, userPrompt);
  // UI will show ScaffoldCard via decision_point_needed event
}
```

Decision point actions are handled via existing `user_action_taken` event pattern.
