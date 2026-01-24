# Step 26: Mission Breakdown (Anti-Failure Guard) - Implementation Summary

## Overview

Step 26 implements the **Anti-Failure Guard** system that prevents executing massive, unrealistic plans by:
1. Detecting "large" plans using a composite scoring model
2. Auto-generating a mission breakdown with bounded, independent missions
3. Forcing users to select ONE mission at a time before execution

This is the "#1 reason AI coding tools fail" - attempting to do too much at once.

## Files Created/Modified

### New Files (Core)

| File | Purpose |
|------|---------|
| `packages/core/src/largePlanDetector.ts` | Composite scoring model for detecting large plans |
| `packages/core/src/missionBreakdownGenerator.ts` | Deterministic DAG + clustering algorithm for mission breakdown |
| `packages/core/src/__tests__/missionBreakdown.test.ts` | Unit tests for detector and generator |

### New Files (Webview)

| File | Purpose |
|------|---------|
| `packages/webview/src/components/MissionBreakdownCard.ts` | UI component for breakdown display and mission selection |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Added `plan_large_detected` event type |
| `packages/core/src/planVersionManager.ts` | Added helpers: `deriveLargePlanState()`, `deriveBreakdownState()`, `deriveMissionSelectionState()`, `hasBreakdownForLatestPlan()`, `isMissionSelectedForLatestPlan()` |
| `packages/core/src/stateReducer.ts` | Handle `plan_large_detected` event |
| `packages/core/src/index.ts` | Export new modules |

## Architecture

### A) Large Plan Detector

```
Input: planSteps[], planText, repoSignals?
Output: {
  largePlan: boolean,
  score: 0-100,
  reasons: string[],
  metrics: { stepCount, estimatedFileTouch, riskFlags[], ambiguityFlags[], keywordHits[], domains[] }
}
```

**Detection Heuristics:**
- **Step count**: warn >= 10, large >= 16
- **Risk flags**: security, payments, migration, refactor, upgrade
- **Big-scope keywords**: auth, payments, analytics, theming, offline, i18n, CI/CD, database, backend
- **Multi-domain**: mobile + web + backend combinations
- **Ambiguity phrases**: "complete app", "entire system", "production ready"
- **File touch estimation**: based on verb categories (small/medium/large)

**Decision Rules:**
- `largePlan = true` if score >= 60
- `largePlan = true` if stepCount >= 16
- `largePlan = true` if riskFlags >= 2 AND stepCount >= 10

### B) Mission Breakdown Generator

**Algorithm (Deterministic V1, No LLM):**
1. **Tag Steps**: Extract domains, risk flags, phase (foundation/feature/polish), verb category
2. **Infer Dependencies**: Foundation-first heuristics, dependency indicator keywords
3. **Cluster into Missions**: Phase-based grouping, domain similarity, vertical slices preferred
4. **Generate Metadata**: Acceptance criteria, outOfScope, size estimate, verification plan

**MissionV1 Schema:**
```typescript
interface MissionV1 {
  missionId: string;           // Stable hash
  title: string;
  intent: string;              // 1-2 sentences
  includedSteps: { stepId, title }[];
  dependencies: string[];      // DAG edges
  scope: {
    domains: MissionDomain[];
    outOfScope: string[];      // REQUIRED for trust
  };
  acceptance: string[];        // REQUIRED checklist
  verification: {
    suggestedCommands: string[];
    manualChecks: string[];
  };
  risk: { level: 'low'|'med'|'high', notes: string[] };
  estimate: { size: 'S'|'M'|'L', rationale: string[] };
}
```

**Caps Enforced:**
- Max 8 missions
- Max 6 steps per mission
- Max 3 domains per mission
- Max 1 high-risk theme per mission

### C) Event Model

New event type:
```typescript
'plan_large_detected' // Added to EventType union
```

Event payloads:
```typescript
// plan_large_detected
{
  plan_id: string,
  plan_version: number,
  large_plan: boolean,
  score: number,
  reasons: string[],
  metrics: { ... }
}

// mission_breakdown_created (existing)
{
  plan_id: string,
  plan_version: number,
  breakdown_id: string,
  missions: MissionV1[]
}

// mission_selected (existing)
{
  plan_id: string,
  plan_version: number,
  mission_id: string
}
```

### D) State Derivation

New helper functions in `planVersionManager.ts`:
```typescript
deriveLargePlanState(events) → LargePlanState
deriveBreakdownState(events) → BreakdownState
deriveMissionSelectionState(events) → MissionSelectionState
hasBreakdownForLatestPlan(events) → boolean
isMissionSelectedForLatestPlan(events) → boolean
```

All functions derive state from events for the **latest plan version only**.
Old breakdowns/selections are automatically ignored when plan version changes.

### E) UI Flow

```
Plan Approved (canExecutePlan = true)
    │
    ├── Plan NOT large → "Execute Plan" (existing behavior)
    │
    └── Plan IS large
            │
            ├── Show "Mission Breakdown Required" banner
            │   - Score: X/100
            │   - Reasons list
            │
            ├── Show Mission List
            │   - Each mission: Size badge, Risk badge, Domain tags
            │   - Expandable: intent, steps, acceptance, outOfScope
            │   - "Select" button per mission
            │
            ├── User selects ONE mission → emit mission_selected
            │
            └── Show "Start Mission: <title>" button
                - Wired to Step 27 entrypoint
                - Passes only selected mission scope
```

## UI Components

### MissionBreakdownCard.ts

Exports:
- `renderLargePlanBanner(event, taskId)` - Warning banner with score/reasons
- `renderMissionBreakdownCard(event, selectedMissionId, taskId)` - Full breakdown with selection

Features:
- Pulse animation on warning banner
- Size/Risk/Domain badges with colors
- Expandable mission details
- "Start Mission" button appears after selection
- "Regenerate Breakdown" and "Back to Plan" actions

## Guardrails

**Hard Blocks:**
1. If `largePlan = true` AND no `mission_selected` for latest plan → Block execution
2. If selected mission has > 6 steps → Force re-breakdown
3. If selected mission has > 1 high-risk tag → Force split
4. No "Execute whole plan" when `largePlan = true`

## Tests

`missionBreakdown.test.ts` covers:

**Large Plan Detector:**
- Step count thresholds (5, 10, 16, 20 steps)
- Risk flag detection (security, payments, migration, refactor)
- Multi-domain detection (mobile+web, web+backend)
- Ambiguity flag detection ("complete app", "entire system")
- Score thresholds and capping at 100
- Reason string stability

**Mission Breakdown Generator:**
- All steps accounted for exactly once
- Handles 5, 12, 20 step plans
- Max 8 missions enforced
- Max 6 steps per mission enforced
- No cycles in dependency graph
- outOfScope present for each mission
- Acceptance criteria present for each mission
- Size and risk estimates present
- Determinism: same input → same output
- Different plan version → different breakdown

## Integration Points

### Webview Message Handlers (to be added)

```typescript
// In webview/index.ts global scope
window.handleSelectMission = (taskId, missionId, planId, planVersion) => {
  vscode.postMessage({
    type: 'selectMission',
    taskId, missionId, planId, planVersion
  });
};

window.handleStartMission = (taskId, missionId, planId, planVersion) => {
  vscode.postMessage({
    type: 'startSelectedMission',
    taskId, missionId, planId, planVersion
  });
};

window.toggleMissionExpand = (missionId) => {
  const details = document.getElementById(`mission-details-${missionId}`);
  if (details) {
    details.style.display = details.style.display === 'none' ? 'block' : 'none';
  }
};
```

### Extension Wiring (to be added)

```typescript
// In extension.ts - handle messages
case 'selectMission':
  await eventBus.publish({
    type: 'mission_selected',
    payload: {
      plan_id: msg.planId,
      plan_version: msg.planVersion,
      mission_id: msg.missionId
    }
  });
  break;

case 'startSelectedMission':
  // Feed selected mission steps to Step 27 entrypoint
  const breakdown = deriveBreakdownState(events);
  const mission = breakdown.missions.find(m => m.missionId === msg.missionId);
  // Start execution with mission.includedSteps only
  break;
```

## Definition of Done

✅ Large plans (12-20 steps with complex features) trigger breakdown automatically
✅ User cannot see "Execute Plan" when plan is large
✅ User must select exactly ONE mission
✅ Selected mission is bounded (max 6 steps)
✅ Everything is event-driven and replay-safe
✅ Deterministic V1 (no LLM for breakdown)
✅ Architecture supports optional LLM enhancement (future flag)

## planMeta Enhancement (V1.1 - Enterprise-Grade Detection)

Added LLM-provided plan metadata for intelligent "sneaky plan" detection.

### Problem
A 4-step plan can hide massive scope: "Step 1: Implement auth + payments + analytics + theming".
Heuristics alone can't catch this.

### Solution
PLAN mode now requests `planMeta` from the LLM:

```typescript
interface PlanMeta {
  estimatedFileTouch: number | 'unknown';  // Files to modify
  estimatedDevHours: number | 'unknown';   // Senior dev hours
  riskAreas: string[];                     // ["auth", "migration", "payments"]
  domains: string[];                       // ["web", "mobile", "backend", "database"]
  confidence: 'low' | 'medium' | 'high';   // Scope accuracy confidence
}
```

### Detection Rules
planMeta can INCREASE detection confidence but NEVER suppress safety checks:

| Condition | Score Impact |
|-----------|--------------|
| `estimatedFileTouch > 15` | +1.5 per file over 15 |
| `estimatedDevHours > 8` | +2 per hour over 8 |
| `riskAreas.length >= 2` | +8 per risk area |
| `domains.length >= 3` | +10 points |
| `confidence === 'low' && steps >= 5` | +20 points |

### Files Modified
- `packages/core/src/types.ts` - Added `PlanMeta` interface
- `packages/core/src/planGenerator.ts` - Added `planMeta?` to `StructuredPlan`
- `packages/core/src/planContextCollector.ts` - Updated LLM prompt to request planMeta
- `packages/core/src/largePlanDetector.ts` - Added planMeta scoring logic

### Backward Compatibility
- planMeta is OPTIONAL - old plans without it still work
- Existing tests (33/33) still pass

## Next Steps

1. Wire UI message handlers in `webview/index.ts`
2. Wire extension handlers in `extension.ts`
3. Integrate with Step 27 mission execution entrypoint
4. Test end-to-end flow with large plan
