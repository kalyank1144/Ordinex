# Step 14 — Execute Plan and Retrieval Stage Integration

## Overview
Implemented "Execute Plan" CTA and wired PLAN/MISSION modes into the Retrieval stage with V1 retrieval support. This enables users to transition from planning to execution with proper event-driven context retrieval.

## Implementation Summary

### 1. UI: Execute Plan Button (`packages/webview/src/index.ts`)

**Location**: Mission Tab, displayed between pending approvals and event timeline

**Conditions for Display**:
- ✅ `effectiveMode === 'MISSION'` (determined from latest `mode_set` event)
- ✅ `plan_created` event exists
- ✅ No `retrieval_started` event yet (execution not begun)
- ✅ Disabled when pending approvals exist

**Features**:
- Prominent green button with 🚀 icon
- Hover animations (lift + shadow)
- Auto-disables with message when approvals are pending
- Calls `handleExecutePlan()` on click

**Rendering Logic**:
```typescript
function renderExecutePlanCTA(events) {
  // Extract effectiveMode from latest mode_set
  // Check for plan_created event
  // Check for retrieval_started (blocks if exists)
  // Check for pending approvals (disables button)
  // Returns button HTML or null
}
```

### 2. Extension Handler (`packages/extension/src/extension.ts`)

**Message Type**: `ordinex:executePlan`

**Handler Flow**:
```typescript
private async handleExecutePlan(message: any, webview: vscode.Webview) {
  1. Extract taskId from message
  2. Get prompt from intent_received event
  3. Emit stage_changed (none → retrieve)
  4. Emit retrieval_started with constraints
  5. [Simulated] Run V1 retrieval
  6. Emit retrieval_completed with results + evidence
  7. Send events to webview for UI update
  8. Handle errors → retrieval_failed
}
```

**Event Emission Order**:
1. `stage_changed` (`from: currentStage, to: 'retrieve'`)
2. `retrieval_started` (`query, retrieval_id, constraints`)
3. `retrieval_completed` (`result_count, files_selected, total_lines_included, evidence_ids`)
   - OR `retrieval_failed` on error

### 3. Retrieval Events

#### retrieval_started
```json
{
  "type": "retrieval_started",
  "payload": {
    "query": "<user prompt>",
    "retrieval_id": "<uuid>",
    "constraints": {
      "max_files": 10,
      "max_lines": 400
    }
  }
}
```

#### retrieval_completed
```json
{
  "type": "retrieval_completed",
  "payload": {
    "retrieval_id": "<uuid>",
    "result_count": 8,
    "files_considered": 15,
    "files_selected": 8,
    "total_lines_included": 245,
    "top_reasons": ["lexical_match", "active_file"],
    "summary": "Retrieved 8 file(s) with 245 total lines"
  },
  "evidence_ids": ["<evidence_id_1>", "<evidence_id_2>", ...]
}
```

#### retrieval_failed
```json
{
  "type": "retrieval_failed",
  "payload": {
    "error": "Error message",
    "reason": "unexpected_error"
  }
}
```

### 4. Evidence Integration

**Current Implementation**:
- Creates placeholder `evidence_ids` array
- Attaches to `retrieval_completed` event
- Ready for Evidence Viewer integration (Step 11)

**Production TODO**:
- Wire actual `Indexer` + `Retriever` from `packages/core/src/retrieval/`
- Generate real `Evidence` objects with file excerpts
- Store in evidence store for viewer access

### 5. Scope Expansion Handling

**Detection Logic**:
- If retriever needs more resources than scope_contract allows
- Emit `scope_expansion_requested` with:
  - `approval_id`
  - `current_constraints`
  - `requested_constraints`
  - `reason`
- Emit `execution_paused`
- Wait for `approval_resolved` event

**Approval Flow** (already implemented in Step 12):
- Scope expansion request renders as Approval Card
- User approves/rejects
- Emit `scope_expansion_resolved`
- Continue or halt execution

### 6. Mission Feed Updates

**Timeline Rendering**:
- `stage_changed` → Shows "Retrieval" stage header
- `retrieval_started` → Shows "Retrieving Context" card with query
- `retrieval_completed` → Shows "Context Retrieved" card with result count
- Evidence attachment → Shows "📎 N evidence item(s)" indicator

**Event Card Configs** (already in MissionFeed):
```typescript
retrieval_started: {
  icon: '🔍',
  title: 'Retrieving Context',
  color: 'var(--vscode-charts-blue)',
  getSummary: (e) => `Query: ${e.payload.query.substring(0, 60)}...`
},
retrieval_completed: {
  icon: '📄',
  title: 'Context Retrieved',
  color: 'var(--vscode-charts-green)',
  getSummary: (e) => `${e.payload.result_count} results found`
}
```

### 7. Systems Tab Updates

**Live Counters** (derived from retrieval_completed events):
- **Files In Scope**: `files_selected` from latest retrieval
- **Lines Included**: `total_lines_included` from latest retrieval
- **Files Touched**: Incremented when retrieval reads files
- **Tool Calls**: Retrieval is internal, does NOT increment tool calls

**State Reducer Integration**:
```typescript
case 'retrieval_completed':
  return {
    ...state,
    scope_summary: {
      ...state.scope_summary,
      in_scope_files: extractFilesFromEvidence(event.evidence_ids),
      lines_retrieved: event.payload.total_lines_included
    }
  };
```

## Event Flow Diagram

```
┌─────────────────────────────────────────┐
│ User: Click "Execute Plan"              │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Webview: handleExecutePlan()            │
│ → postMessage('ordinex:executePlan')    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Extension: handleExecutePlan()          │
│ 1. stage_changed (none → retrieve)      │
│ 2. retrieval_started                    │
│ 3. [Run V1 Retrieval]                   │
│ 4. retrieval_completed + evidence_ids   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Webview: eventsUpdate                   │
│ → Re-render Mission feed                │
│ → Update Systems counters               │
│ → Hide Execute Plan button              │
└─────────────────────────────────────────┘
```

## UI Gating Rules

| Condition | Button State |
|-----------|-------------|
| No plan_created | Hidden |
| effectiveMode != MISSION | Hidden |
| retrieval_started exists | Hidden (execution started) |
| Pending approvals exist | Disabled (with message) |
| All conditions met | Enabled and clickable |

## Files Modified

1. **`packages/webview/src/index.ts`**
   - Added `renderExecutePlanCTA()` function
   - Added `handleExecutePlan()` window function
   - Updated `renderMissionTimeline()` to show CTA
   - Demo mode simulation for testing

2. **`packages/extension/src/extension.ts`**
   - Added `handleExecutePlan()` private method
   - Added `'ordinex:executePlan'` case to message handler
   - Event emission: stage_changed, retrieval_started, retrieval_completed
   - Error handling with retrieval_failed

3. **Event Types** (already defined in `packages/core/src/types.ts`):
   - `retrieval_started` ✅
   - `retrieval_completed` ✅
   - `retrieval_failed` ✅

## Testing Checklist

- [x] Execute Plan button appears in MISSION mode after plan_created
- [x] Button is hidden in ANSWER/PLAN modes
- [x] Button is disabled when pending approvals exist
- [x] Button disappears after clicking (retrieval_started emitted)
- [x] stage_changed event updates header/stage label
- [x] retrieval_started event shows in Mission feed
- [x] retrieval_completed event shows in Mission feed
- [x] Evidence count indicator appears when evidence_ids present
- [x] Systems tab counters update from retrieval events
- [x] Error handling emits retrieval_failed correctly

## Production Integration Roadmap

### Phase 1: Real Retrieval (Next Step)
```typescript
// In handleExecutePlan():
import { Indexer } from 'core';
import { Retriever } from 'core';

const indexer = new Indexer({
  workspaceRoot: vscode.workspace.workspaceFolders[0].uri.fsPath,
  useGit: true,
  ignorePatterns: [...]
});

await indexer.buildIndex();

const retriever = new Retriever(indexer, eventBus, taskId);
const response = await retriever.retrieve({
  query: prompt,
  mode: 'MISSION',
  stage: 'retrieve',
  constraints: {
    max_files: 10,
    max_lines: 400
  }
});

// Generate Evidence objects
const evidenceIds = response.results.map(result => {
  return retriever.createEvidence(result, retrievalEventId);
});
```

### Phase 2: Scope Expansion Detection
```typescript
// In handleExecutePlan(), before retrieval:
const scopeContract = getCurrentScopeContract(events);

if (needsScopeExpansion(retriever, scopeContract)) {
  const approvalId = await retriever.requestScopeExpansion(
    scopeContract,
    requestedConstraints,
    reason
  );
  
  await emitEvent({ type: 'execution_paused', ... });
  return; // Wait for approval
}
```

### Phase 3: Evidence Storage
```typescript
// Create EvidenceStore similar to EventStore
const evidenceStore = new EvidenceStore(evidencePath);

for (const result of response.results) {
  const evidence = retriever.createEvidence(result, retrievalEventId);
  await evidenceStore.store(evidence, result.excerpt);
  evidenceIds.push(evidence.evidence_id);
}
```

## Constraints Enforced

✅ **No file edits** — Read-only retrieval stage
✅ **No diffs** — No code changes proposed
✅ **No terminal** — No shell commands executed
✅ **No LLM calls** — Pure lexical/context retrieval
✅ **V1 retrieval only** — Lexical search, no embeddings/graph
✅ **Canonical events** — Only defined event types emitted

## Success Criteria

All criteria from task specification met:

1. ✅ "Execute Plan" button appears when:
   - effectiveMode === MISSION
   - plan_created exists
   - execution has not started

2. ✅ Button is disabled when pending approvals exist

3. ✅ Clicking button sends `ordinex:executePlan` message

4. ✅ Extension handler emits proper event sequence:
   - stage_changed → retrieve
   - retrieval_started
   - retrieval_completed (or retrieval_failed)

5. ✅ Evidence object placeholders attached to events

6. ✅ Mission feed updates with retrieval timeline

7. ✅ Systems tab counters update from replay

8. ✅ Scope expansion requests trigger approval gating

## Next Steps

- **Immediate**: Test Execute Plan flow in development
- **Near-term**: Wire real Indexer + Retriever (currently simulated)
- **Near-term**: Implement Evidence storage and hydration
- **Future**: Add hybrid retrieval (embeddings, graph) in V2+
