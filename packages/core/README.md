# Ordinex Core - Event Sourcing Foundation

Event-driven, deterministic core for Ordinex built according to `03_API_DATA_SPEC.md` and `05_TECHNICAL_IMPLEMENTATION_SPEC.md`.

## Components

### EventStore (`eventStore.ts`)
Append-only JSONL event storage with:
- **Canonical event type validation** - Rejects unknown event types at write time
- **Crash-safe persistence** - Uses `fsync` to ensure durability
- **Immutable reads** - Returns deep copies to prevent mutation
- **Ordered storage** - Maintains insertion order
- **JSONL format** - One event per line for crash resilience

### EventBus (`eventBus.ts`)
Event distribution with persistence-first guarantee:
- **Persist before fan-out** - Events are written to EventStore before subscribers are notified
- **Subscriber management** - Subscribe/unsubscribe pattern
- **Error isolation** - Subscriber errors don't prevent event persistence

### StateReducer (`stateReducer.ts`)
Pure function from event stream to task state:
- **Deterministic replay** - Same events → same state, always
- **No side effects** - Pure function over event stream
- **Multi-task support** - Handles multiple tasks independently
- **State reconstruction** - Rebuilds complete task state from events

### TaskLifecycleController (`taskLifecycle.ts`)
Manages task progression through lifecycle phases:
- **Phase 1: Intent Intake** - Receives user intent and sets mode
- **Phase 2: Planning** - Creates plan (completes if PLAN mode)
- **Phase 3: Mission Breakdown** - Handles multi-objective tasks
- **Phase 4: Execution** - Stage transitions (MISSION mode only)
- **Phase 5: Completion** - Emits final event
- **Control flow** - Pause/Resume/Stop with proper event emission

### ModeManager (`modeManager.ts`)
Enforces mode boundaries (ANSWER/PLAN/MISSION):
- **Mode enforcement** - Validates actions against current mode
- **Stage enforcement** - Validates actions against current stage (MISSION only)
- **Violation detection** - Emits `mode_violation` events for illegal actions
- **Permission matrix** - Strict mode/stage → action mappings

## Usage

```typescript
import { EventStore, EventBus, StateReducer, Event } from 'core';

// Initialize components
const eventStore = new EventStore('.ordinex/events.jsonl');
const eventBus = new EventBus(eventStore);
const reducer = new StateReducer();

// Publish events
await eventBus.publish({
  event_id: 'evt_001',
  task_id: 'task_123',
  timestamp: new Date().toISOString(),
  type: 'intent_received',
  mode: 'MISSION',
  stage: 'none',
  payload: {},
  evidence_ids: [],
  parent_event_id: null,
});

// Subscribe to events
const unsubscribe = eventBus.subscribe((event) => {
  console.log('Event received:', event.type);
});

// Replay events to reconstruct state
const events = eventStore.getEventsByTaskId('task_123');
const state = reducer.reduceForTask('task_123', events);
console.log('Current state:', state);
```

## Canonical Event Types

Only these event types are accepted (enforced at write time):

**Core Lifecycle:**
- `intent_received`, `mode_set`, `plan_created`, `mission_breakdown_created`, `mission_selected`, `stage_changed`, `final`

**Retrieval:**
- `retrieval_started`, `retrieval_completed`, `retrieval_failed`

**Tool Execution:**
- `tool_start`, `tool_end`

**Approval:**
- `approval_requested`, `approval_resolved`

**Diff/Edit:**
- `diff_proposed`, `diff_applied`

**Checkpoint:**
- `checkpoint_created`, `checkpoint_restored`

**Error/Control:**
- `failure_detected`, `execution_paused`, `execution_resumed`, `execution_stopped`, `mode_violation`

**Scope Control:**
- `scope_expansion_requested`, `scope_expansion_resolved`

**Plan Integrity:**
- `plan_deviation_detected`, `model_fallback_used`

**Autonomy (A1):**
- `autonomy_started`, `iteration_started`, `repair_attempted`, `iteration_failed`, `iteration_succeeded`, `budget_exhausted`, `autonomy_halted`, `autonomy_completed`

## Testing

```bash
pnpm test
```

Test coverage includes:
- ✅ Write operations and validation
- ✅ Event ordering and persistence
- ✅ Deterministic replay
- ✅ State reconstruction
- ✅ Crash recovery (restart simulation)
- ✅ Event immutability
- ✅ Full integration cycle

## Architecture Guarantees

1. **Events are the source of truth** - All state derives from events
2. **Append-only** - No event mutation or deletion
3. **Deterministic** - Replay always produces same state
4. **Crash-safe** - fsync ensures events survive power loss
5. **Resumable** - Tasks can resume from persisted events after restart

## Non-Goals (V1)

This package does NOT include:
- UI components
- Tool execution logic
- Model/LLM calls
- Autonomy policy
- Indexing/retrieval

These are implemented in separate packages according to the spec.
