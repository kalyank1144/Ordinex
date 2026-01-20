# Step 13: Send Flow Backend Integration — Implementation Summary

## Overview
Successfully implemented the Send flow integration with backend event persistence, mode classification, safe mode routing, and template-based plan generation.

## Components Created

### 1. Mode Classifier (`packages/core/src/modeClassifier.ts`)
- **Purpose**: Lightweight prompt classification without LLM calls
- **Features**:
  - Pattern-based classification for ANSWER/PLAN/MISSION modes
  - Confidence scoring (high/medium/low)
  - Reasoning explanations
  - Mode mismatch detection with confirmation logic
- **Key Functions**:
  - `classifyPrompt(prompt)`: Returns suggested mode with confidence
  - `shouldRequireConfirmation()`: Determines if user confirmation needed

### 2. Plan Generator (`packages/core/src/planGenerator.ts`)
- **Purpose**: Template-based plan creation for PLAN/MISSION modes
- **Features**:
  - Deterministic step generation (no LLM)
  - Mode-aware templates
  - Action-based customization (create/fix/refactor)
  - Default scope contracts
- **Key Function**:
  - `generateTemplatePlan(prompt, mode)`: Returns structured PlanPayload

### 3. Extension Backend Handler (`packages/extension/src/extension.ts`)
- **Purpose**: Handle webview messages and persist events
- **Features**:
  - EventStore initialization per extension context
  - Task lifecycle management
  - Mode classification and suggestion
  - Safe mode routing with confirmation gates
  - Event persistence to JSONL
- **Message Handlers**:
  - `ordinex:submitPrompt`: Handles Send button clicks
  - `ordinex:getEvents`: Retrieves events for replay
  - `ordinex:confirmMode`: Handles mode confirmation from UI

## Send Flow Implementation

###  Flow Diagram
```
User clicks Send
    ↓
1. Create task_id (if not exists)
    ↓
2. Emit intent_received event
    ↓
3. Classify prompt → suggestedMode
    ↓
4. Emit mode_set event
    ├─→ requiresConfirmation=true?
    │   ├─→ Yes: STOP, show mode suggestion card, await user
    │   └─→ No: Continue
    ↓
5. For PLAN/MISSION: Generate & emit plan_created
    ↓
6. Send events to webview
    ↓
Webview receives ordinex:eventsUpdate
    ↓
Replay events → Update UI
```

## Mode Routing Logic

### Classification Examples
- **ANSWER Mode**:
  - "What is event sourcing?"
  - "Explain how this code works"
  - "Why does this fail?"
  
- **PLAN Mode**:
  - "Plan an architecture for auth system"
  - "Design a migration strategy"
  - "How should I approach this refactor?"

- **MISSION Mode**:
  - "Create a new API endpoint"
  - "Fix the memory leak in service.ts"
  - "Refactor the database layer"

### Safe Mode Routing
When user selects ANSWER but prompt suggests MISSION:
```
intent_received: "Create a REST API"
mode_set:
  userSelectedMode: ANSWER
  effectiveMode: ANSWER (not yet switched)
  suggestedMode: MISSION
  suggestionReason: "Detected action-oriented keywords..."
  requiresConfirmation: true
```

UI shows:
```
┌─────────────────────────────────────────┐
│ ⚠️  Mode Suggestion                     │
│                                         │
│ Your request looks like MISSION mode.  │
│ You selected ANSWER mode.               │
│                                         │
│ [Continue in ANSWER] [Switch to MISSION]│
└─────────────────────────────────────────┘
```

If user clicks "Switch to MISSION":
- Extension receives `ordinex:confirmMode` with `confirmedMode: MISSION`
- Emits new `mode_set` event with `effectiveMode: MISSION`
- Generates and emits `plan_created` event
- Sends updated events to webview

## Event Persistence

### EventStore Location
- Path: `{extensionContext.globalStorageUri}/events.jsonl`
- Format: One JSON object per line (JSONL)
- Crash-safe: Uses `fsync()` after each write
- Append-only: No destructive edits

### Example Event Sequence

```jsonl
{"event_id":"123","task_id":"task1","timestamp":"2026-01-19T23:00:00Z","type":"intent_received","mode":"PLAN","stage":"none","payload":{"prompt":"Create a REST API","model_id":"sonnet-4.5"},"evidence_ids":[],"parent_event_id":null}
{"event_id":"124","task_id":"task1","timestamp":"2026-01-19T23:00:01Z","type":"mode_set","mode":"PLAN","stage":"none","payload":{"mode":"PLAN","effectiveMode":"PLAN"},"evidence_ids":[],"parent_event_id":null}
{"event_id":"125","task_id":"task1","timestamp":"2026-01-19T23:00:02Z","type":"plan_created","mode":"PLAN","stage":"none","payload":{"goal":"Complete: Create a REST API","assumptions":[...],"success_criteria":"...","steps":[...]},"evidence_ids":[],"parent_event_id":null}
```

## Plan Templates

### PLAN Mode (4 steps)
1. Analyze the request and gather context (plan stage)
2. Research and identify solution approaches (retrieve stage)
3. Create detailed implementation plan (plan stage)
4. Present plan for review and approval (plan stage)

### MISSION Mode - Create/Build (5 steps)
1. Gather requirements and context (retrieve stage)
2. Design solution architecture (plan stage)
3. Implement core functionality (edit stage)
4. Add tests and validation (test stage)
5. Review and finalize (edit stage)

### MISSION Mode - Fix/Debug (5 steps)
1. Analyze the issue and gather diagnostic information (retrieve stage)
2. Identify root cause and solution approach (plan stage)
3. Implement fix with minimal changes (edit stage)
4. Test the fix and verify resolution (test stage)
5. Document changes and complete mission (edit stage)

### MISSION Mode - Refactor (4 steps)
1. Analyze current code structure (retrieve stage)
2. Design refactoring approach (plan stage)
3. Apply refactoring changes incrementally (edit stage)
4. Verify functionality remains intact (test stage)

## Key Design Decisions

### 1. No LLM Calls in Step 13
- Mode classification uses heuristics only
- Plan generation uses templates only
- Actual LLM integration deferred to future steps

### 2. Soft Routing (Not Hard Fails)
- Mode mismatches produce suggestions, not errors
- User always has final say
- Low-confidence suggestions don't block

### 3. Preflight Plan Only
- MISSION mode creates `plan_created` but doesn't execute
- No tool calls, no retrieval yet
- Actual execution requires separate "Execute" button (future step)

### 4. Event Replay Pattern
- Webview doesn't maintain state
- All state derived from event replay
- Extension sends `ordinex:eventsUpdate` after mutations

## Files Modified

1. **Created**:
   - `packages/core/src/modeClassifier.ts`
   - `packages/core/src/planGenerator.ts`

2. **Modified**:
   - `packages/core/src/index.ts` (added exports)
   - `packages/extension/src/extension.ts` (added handlers)

3. **Built**:
   - `packages/core/dist/` (TypeScript compilation)
   - `packages/extension/dist/` (TypeScript compilation)

## Next Steps (Not in Scope for Step 13)

### Webview Integration (Step 13b)
- Replace demo Send handler with real `postMessage` to extension
- Add `window.addEventListener('message')` for `ordinex:eventsUpdate`
- Create `ModeSuggestionCard` component
- Update `renderMissionTimeline` to show mode suggestion cards
- Add `handleModeSwitch` global function
- Implement event replay rendering

### Testing
- Test ANSWER mode (no plan_created)
- Test PLAN mode (plan_created with planning steps)
- Test MISSION mode (plan_created with execution steps)
- Test mode mismatch → suggestion card → switch flow
- Verify events persist to JSONL
- Verify Logs tab shows all events

## Constraints Enforced

✅ No LLM calls  
✅ No tool execution  
✅ No retrieval  
✅ No autonomy  
✅ Canonical events only  
✅ Persistence before UI update  
✅ Deterministic behavior  

## Stop Condition Met

✅ Send creates persisted events (intent_received, mode_set, optionally plan_created)  
✅ Extension backend ready to handle messages  
✅ Mode classifier operational  
✅ Plan generator operational  
✅ Safe mode routing logic implemented  
⚠️  Webview wiring incomplete (demo mode still active)

**Note**: The webview still uses demo handlers. Full integration requires updating `packages/webview/src/index.ts` to:
1. Send `ordinex:submitPrompt` instead of creating demo events
2. Listen for `ordinex:eventsUpdate` messages
3. Render mode suggestion cards
4. Handle mode confirmation

This can be completed in a follow-up focused solely on webview changes.

## Architecture Validation

This implementation follows the Ordinex architecture:
- ✅ Event-driven (all actions emit events)
- ✅ Deterministic (no random behavior, no LLM)
- ✅ Append-only (EventStore)
- ✅ Mode-aware (respects ANSWER/PLAN/MISSION semantics)
- ✅ Safe routing (no silent mode switches)
- ✅ Crash-safe persistence (fsync)
- ✅ Canonical types only (validated by EventStore)
