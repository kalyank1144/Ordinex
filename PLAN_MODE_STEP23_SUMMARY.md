# STEP 23 — PLAN Mode with Project-Aware Retrieval (Complete)

**Status:** ✅ IMPLEMENTED  
**Date:** 2026-01-20

## Overview

STEP 23 implements PLAN mode as a read-only, reasoning-first mode that produces structured plans without touching the filesystem or executing tools. PLAN mode = **thinking + proposing, not doing**.

## Core Principle

```
PLAN mode:
  ✅ Read project files
  ✅ Analyze structure
  ✅ Propose steps
  ✅ Define scope contracts
  ✅ Produce structured plans
  
  ❌ Write files
  ❌ Run commands
  ❌ Create checkpoints
  ❌ Execute tools
  ❌ Apply diffs
```

## Implementation Details

### 1. Backend: Plan Context Collector

**File:** `packages/core/src/planContextCollector.ts`

- Similar to `answerContextCollector.ts` but with broader scope
- Collects:
  - `package.json` (high priority)
  - `README.md` (high priority)
  - Config files (`tsconfig.json`, `vite.config.ts`, etc.)
  - File tree (depth ≤ 3, deeper than ANSWER mode)
  - Open files
  - Stack inference (React, TypeScript, Vite, etc.)

**Key Differences from ANSWER Mode:**
- Max file lines: 300 (vs 200 in ANSWER)
- Max tree depth: 3 (vs 2 in ANSWER)
- Includes config files for better context
- Tracks total files scanned and lines included

**Exports:**
- `collectPlanContext()` - Main context collection function
- `buildPlanModeSystemMessage()` - Builds LLM system prompt with PLAN constraints
- `PlanContextBundle` - Context data structure
- `PlanContextCollectionOptions` - Configuration options

### 2. Backend: Plan Generator (Enhanced)

**File:** `packages/core/src/planGenerator.ts`

**New Features:**

1. **LLM-Based Plan Generation (`generateLLMPlan`)**
   - Calls LLM with project context
   - Enforces strict JSON output format
   - Parses and validates structured plan
   - Fallback to basic plan structure on parse failure
   - Emits `context_collected` event

2. **Structured Plan Schema (`StructuredPlan`)**
   ```typescript
   interface StructuredPlan {
     goal: string;
     assumptions: string[];
     success_criteria: string[];
     scope_contract: {
       max_files: number;
       max_lines: number;
       allowed_tools: string[];
     };
     steps: Array<{
       id: string;
       description: string;
       expected_evidence: string[];
     }>;
     risks: string[];
   }
   ```

3. **Legacy Support**
   - `generateTemplatePlan()` remains for MISSION mode
   - `PlanPayload` type maintained for backward compatibility

**System Prompt (Mandatory):**
```
You are in PLAN mode.

Your job is to propose a clear, structured plan for the user's request.

You MUST NOT:
- edit files
- suggest running commands
- apply changes

You MUST:
- reason using the provided project context
- produce a step-by-step plan
- define scope and success criteria
- stop after planning

OUTPUT FORMAT (MANDATORY):
You must output ONLY valid JSON matching the StructuredPlan schema.
```

### 3. Backend: State Reducer Updates

**File:** `packages/core/src/stateReducer.ts`

**Changes:**
- `plan_created` event in PLAN mode sets status to `'paused'`
  - User must explicitly approve plan before switching to MISSION mode
  - Mode switching remains user-controlled
- Added support for `context_collected`, `stream_delta`, and `stream_complete` events

### 4. Backend: Core Exports

**File:** `packages/core/src/index.ts`

**New Exports:**
```typescript
export {
  generateLLMPlan,
  StructuredPlan
} from './planGenerator';

export {
  collectPlanContext,
  buildPlanModeSystemMessage,
  PlanContextBundle,
  PlanContextCollectionOptions
} from './planContextCollector';
```

### 5. Frontend: PlanCard Component

**File:** `packages/webview/src/components/PlanCard.ts`

**Features:**
- Renders structured plan from `plan_created` event
- Sections:
  - **Goal** - Clear objective statement
  - **Assumptions** - What we're assuming about the project
  - **Implementation Steps** - Numbered steps with expected evidence
  - **Success Criteria** - How we know when done
  - **Scope Contract** - Resource limits (max files, lines, tools)
  - **Risks** - Potential issues to watch for

**Action Buttons:**
- ✓ **Approve Plan → Start Mission** - Switches to MISSION mode
- ✏️ **Edit Plan** - Allows modification (future)
- ✕ **Cancel** - Abandons the plan

**User Note:**
> "This plan was generated in PLAN mode. Review it carefully before switching to MISSION mode to execute."

### 6. Frontend: Mission Feed Integration

**File:** `packages/webview/src/components/MissionFeed.ts`

**Changes:**
- Added import: `import { renderPlanCard } from './PlanCard';`
- Added specialized renderer check:
  ```typescript
  if (event.type === 'plan_created' && event.payload.plan && event.mode === 'PLAN') {
    return renderPlanCard(event);
  }
  ```
- PlanCard only renders for `plan_created` events in PLAN mode
- MISSION mode plan_created events use default rendering

## Event Flow

### PLAN Mode Sequence

```
1. intent_received
   ↓
2. mode_set (mode: PLAN)
   ↓
3. context_collected
   - Files scanned
   - Lines included  
   - Stack inferred
   ↓
4. tool_start (tool: llm_answer)
   ↓
5. [stream_delta events] (LLM generates plan)
   ↓
6. stream_complete
   ↓
7. tool_end (tool: llm_answer)
   ↓
8. plan_created
   - payload.plan: StructuredPlan
   - State becomes 'paused'
   ↓
9. execution_paused
   - Waiting for user approval
```

### Events Emitted (PLAN Mode Only)

✅ **Canonical Events:**
- `intent_received`
- `mode_set`
- `context_collected` (NEW - shows project context scope)
- `plan_created` (with structured plan in payload)
- `execution_paused` (after plan creation)

❌ **NO Events:**
- `tool_execution`
- `diff_proposed`
- `diff_applied`
- `checkpoint_created`
- `stage_changed` (stages are MISSION-only)

## Mode Boundaries (Enforced)

**ModeManager Permissions:**
```typescript
PLAN: new Set(['read_file', 'retrieve', 'plan'])
```

**Forbidden in PLAN Mode:**
- `write_file`
- `execute_command`
- `diff`
- `checkpoint`

Any attempt to perform forbidden actions triggers:
```typescript
{
  type: 'mode_violation',
  payload: {
    violation: {
      reason: "Action 'write_file' is not permitted in PLAN mode",
      currentMode: 'PLAN',
      attemptedAction: 'write_file'
    }
  }
}
```

## UI/UX Flow

### User Journey

1. **User selects PLAN mode** from dropdown
2. **User enters request**: "How should I refactor this authentication module?"
3. **System collects project context**:
   - Reads package.json, README.md
   - Scans file tree
   - Identifies tech stack
4. **LLM generates structured plan** using project context
5. **PlanCard displays** with:
   - Clear goal
   - Assumptions made
   - Step-by-step implementation plan
   - Scope limits
   - Potential risks
6. **User reviews plan** and either:
   - ✓ **Approves** → Switches to MISSION mode to execute
   - ✏️ **Edits** → Modifies plan (future feature)
   - ✕ **Cancels** → Starts over

### Important Guardrail

If user asks: **"Please fix this bug"**

In PLAN mode:
- ✅ Explains how it would be fixed
- ✅ Proposes implementation steps
- ❌ Does NOT switch modes automatically
- ❌ Does NOT apply changes

Mode switching remains **explicit and user-controlled**.

## Files Created/Modified

### New Files Created ✨
1. `packages/core/src/planContextCollector.ts` - PLAN mode context collection
2. `packages/webview/src/components/PlanCard.ts` - UI component for displaying plans

### Files Modified 🔧
1. `packages/core/src/planGenerator.ts` - Added LLM-based plan generation
2. `packages/core/src/stateReducer.ts` - Handle PLAN mode events
3. `packages/core/src/index.ts` - Export new functions
4. `packages/webview/src/components/MissionFeed.ts` - Integrate PlanCard renderer

### Files Not Modified (Intentional) ✓
- `packages/core/src/llmService.ts` - Already supports system messages
- `packages/core/src/modeManager.ts` - PLAN permissions already defined
- `packages/core/src/types.ts` - All required events already defined
- `packages/webview/src/index.ts` - Existing styles sufficient (card-based)

## Testing Considerations

### Manual Testing Checklist

- [ ] User selects PLAN mode from dropdown
- [ ] Enters planning request
- [ ] System emits `context_collected` event
- [ ] System emits `plan_created` event with structured plan
- [ ] PlanCard renders with all sections
- [ ] Action buttons are present and labeled correctly
- [ ] Task status becomes 'paused' after plan creation
- [ ] Mode violation emitted if write attempted in PLAN mode
- [ ] Restarting VS Code preserves plan state (via event replay)

### Integration Testing

**Scenario:** User asks "How should I add authentication?"

Expected behavior:
1. Mode: PLAN
2. Context collected: package.json shows Express.js project
3. Plan generated with:
   - Goal: "Add authentication to Express.js application"
   - Assumptions: ["Using JWT tokens", "Has user database"]
   - Steps: ["Install passport.js", "Create auth middleware", ...]
   - Scope: {max_files: 8, max_lines: 600, allowed_tools: ['read']}
   - Risks: ["Breaking existing routes", "Session management complexity"]
4. Status: paused
5. No files modified
6. No commands executed

## Comparison: ANSWER vs PLAN vs MISSION

| Feature | ANSWER Mode | PLAN Mode | MISSION Mode |
|---------|-------------|-----------|--------------|
| **Purpose** | Quick Q&A | Strategic planning | Actual execution |
| **Context Depth** | Shallow (2 levels) | Medium (3 levels) | Deep (full project) |
| **LLM Output** | Natural language | Structured JSON | Mixed |
| **File Writes** | ❌ No | ❌ No | ✅ Yes |
| **Tool Execution** | ❌ No | ❌ No | ✅ Yes |
| **Project Awareness** | ✅ Yes | ✅ Yes (more) | ✅ Yes (full) |
| **Stages** | None | None | plan → retrieve → edit → test → repair |
| **Approvals** | None | Plan approval | Tool approvals (diff, exec) |
| **Max Context Lines** | 200 | 300 | Unlimited |
| **Produces** | Answer text | Structured plan | Working code |

## Next Steps (Future)

### V2 Features (Not in STEP 23)
- **Plan Editing**: Allow user to modify generated plan before approval
- **Plan Templates**: Pre-defined plan structures for common tasks
- **Multi-Plan Comparison**: Generate multiple approaches, user selects best
- **Plan Validation**: Check plan feasibility against scope limits
- **Plan Persistence**: Save/load plans for reuse
- **Auto-approve Low-Risk Plans**: Skip approval for simple, safe plans

### Integration Points (Deferred)
- **Extension Integration**: Wire up PlanCard button handlers to backend
- **VS Code Commands**: Add command palette entries for PLAN mode
- **Webview Messaging**: Handle `handleApprovePlan`, `handleEditPlan`, `handleCancelPlan`

## Success Metrics

✅ **STEP 23 Complete When:**
- [x] PLAN mode collects project context
- [x] LLM generates structured JSON plans
- [x] PlanCard renders with all required sections
- [x] Mode violations prevent file writes
- [x] Plan creation pauses execution
- [x] Events are deterministically replayable
- [x] No breaking changes to existing modes

## Architecture Integrity

✅ **Maintains Ordinex Principles:**
- **Event-driven**: All actions emit canonical events
- **Deterministic**: Same events → same state
- **Mode-enforced**: ModeManager prevents violations
- **Approval-gated**: User must approve plan before execution
- **Replayable**: Restart VS Code = full state recovery

## Summary

STEP 23 successfully implements PLAN mode as a "think before you act" layer that:

1. **Collects** broader project context than ANSWER mode
2. **Reasons** using LLM with strict PLAN mode constraints
3. **Produces** structured, JSON-formatted plans
4. **Displays** plans in a rich, actionable UI card
5. **Pauses** execution for user review and approval
6. **Forbids** all file writes and command execution
7. **Emits** canonical events for full traceability

**User Benefit:** Users can now ask "How should I build this?" and get a thoughtful, context-aware plan before committing to changes—reducing risk and increasing confidence.

**Next:** Mode switching between PLAN → MISSION will be handled by the extension backend when user clicks "Approve Plan → Start Mission".
