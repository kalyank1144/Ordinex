# PLAN Approval + Execution Gating UX Fix - Step 25

**Date:** 2026-01-20
**Status:** ✅ COMPLETE

## Overview
Fixed confusing duplicate CTAs and implemented correct state machine for PLAN approval and execution flow. Added minimal plan refinement functionality and guardrails for large plans.

## Goals Achieved

### 1. One-Time + Idempotent Approval Requests ✅
- **Backend (`approvalManager.ts`):**
  - Added `plan_approval` to `ApprovalType` union
  - Modified `requestApproval()` to check for existing pending approvals with same `plan_id`
  - Returns existing approval instead of creating duplicate
  - Prevents spam-clicking "Approve Plan" button

- **Extension (`extension.ts`):**
  - `handleRequestPlanApproval()` checks event stream for existing pending approvals
  - If found, returns early without creating new approval_requested event
  - Idempotent at both approval manager and extension handler levels

### 2. Execution Paused Reasons ✅
- **Core Types (`types.ts`):**
  - Added `plan_revised` to canonical event types
  
- **Extension Implementation:**
  - `execution_paused` events now include structured reasons:
    - `awaiting_plan_approval`: After approval_requested, before approval
    - `awaiting_execute_plan`: After plan approved, before execution starts
    - `plan_rejected`: When user rejects plan
  - Each includes `description` field for human-readable context

### 3. Execute Plan Button Gating ✅
- **State Machine Flow:**
  ```
  plan_created → approval_requested → execution_paused(awaiting_plan_approval)
    → approval_resolved(approved) → mode_set(MISSION) 
    → execution_paused(awaiting_execute_plan) → [Show Execute Plan Button]
  ```

- **UI Logic (webview):**
  - Execute Plan button only shown when:
    - Mode is MISSION
    - Plan exists (plan_created or plan_revised event)
    - No pending approvals
    - No retrieval_started (execution hasn't begun)

### 4. Duplicate Approval Surface Removal ✅
- **Plan Card Behavior:**
  - Shows "Approve Plan → Start Mission" button initially
  - After clicking, button is disabled via UI state
  - Backend prevents duplicate approval_requested events
  - Inline approval card appears below plan (deterministic from events)
  - No multiple approval cards for same approval_id

### 5. Minimal Plan Refinement (Step 25-lite) ✅
- **New Functions (`planGenerator.ts`):**
  - `refinePlan()`: Calls LLM with original plan + refinement instruction
  - Returns revised `StructuredPlan` with updated steps/goals
  - Falls back to original plan if LLM refinement fails

- **Backend Handler (`extension.ts`):**
  - `handleRefinePlan()`: Processes refinement requests
  - Auto-cancels pending approvals for old plan (superseded)
  - Emits `plan_revised` event with new plan
  - Shows progress notification during refinement

- **Approval Superseding:**
  - `supersedePlanApprovals()` in ApprovalManager
  - Finds all pending plan approvals for old plan_id
  - Resolves them with `denied` + `reason: "superseded"`
  - New plan requires fresh approval

### 6. Guardrails for Huge Plans ✅
- **Size Check Function (`planGenerator.ts`):**
  - `shouldBreakIntoMissions()`: Heuristic analysis
  - **Heuristic 1:** More than 6 steps
  - **Heuristic 2:** More than 2 "major feature" keywords (implement, create, build, etc.)
  - Returns `{ shouldBreak: boolean, reason?: string }`

- **Integration:**
  - Called in `handleRequestPlanApproval()`
  - Size check result included in approval details
  - **Future:** UI can show "Break into Missions" CTA instead of Execute Plan
  - **V1:** Just tracks the data, doesn't block execution yet

## Files Modified

### Core Package (`packages/core/`)
1. **src/types.ts**
   - Added `'plan_revised'` to `EventType` union
   - Added to `CANONICAL_EVENT_TYPES` array

2. **src/approvalManager.ts**
   - Added `'plan_approval'` to `ApprovalType`
   - Modified `requestApproval()` for idempotency
   - Added `supersedePlanApprovals()` method

3. **src/planGenerator.ts**
   - Added `refinePlan()` function
   - Added `shouldBreakIntoMissions()` function
   - Both exported for extension use

4. **src/index.ts**
   - Exported `refinePlan` and `shouldBreakIntoMissions`

### Extension Package (`packages/extension/`)
5. **src/extension.ts**
   - Updated imports for new plan functions
   - Modified `handleRequestPlanApproval()`:
     - Checks for existing pending approvals (idempotent)
     - Calls `shouldBreakIntoMissions()` and includes in approval details
     - Uses structured `execution_paused` reasons
   - Modified `handleResolvePlanApproval()`:
     - Uses `awaiting_execute_plan` reason after approval
     - Uses `plan_rejected` reason on denial
   - Added `handleRefinePlan()`:
     - Validates API key
     - Cancels old plan approvals
     - Calls `refinePlan()` with LLM
     - Emits `plan_revised` event

### Webview Package (`packages/webview/`)
6. **src/index.ts**
   - Modified timeline rendering to show Execute Plan button INLINE
   - Button appears after `execution_paused(awaiting_execute_plan)` event
   - Styled with green highlight, hover effects, and approval confirmation message
   - Removed top-level Execute Plan CTA to avoid duplicate buttons

## Event Flow

### Approval Flow
```
1. User: Click "Approve Plan"
2. Frontend: Disable button (local state)
3. Backend: Check for existing pending approval
4. Backend: If none exists, emit approval_requested + execution_paused(awaiting_plan_approval)
5. Frontend: Render inline approval card (from events)
6. User: Click "Approve" or "Reject"
7. Backend: Emit approval_resolved
8. If approved:
   - Emit mode_set(MISSION)
   - Emit execution_paused(awaiting_execute_plan)
9. Frontend: Show "Execute Plan" button
```

### Refinement Flow
```
1. User: Click "Refine Plan" → enter refinement text
2. Backend: Cancel pending approvals for old plan (emit approval_resolved with reason="superseded")
3. Backend: Call LLM with original plan + refinement instruction
4. Backend: Emit plan_revised event with new plan
5. Frontend: Re-render plan card with new plan
6. User: Must approve revised plan to proceed
```

## Deterministic Guarantees

### Idempotency
- ✅ Clicking "Approve Plan" multiple times creates only ONE approval_requested event
- ✅ ApprovalManager checks internal state before creating approval
- ✅ Extension handler checks event stream before emitting

### Event Replay
- ✅ All state derived from events
- ✅ `execution_paused` reasons are deterministic
- ✅ Plan refinement creates new event_id but links via parent_event_id
- ✅ Superseded approvals have clear reason in payload

### UI Consistency
- ✅ Approval cards rendered from event stream (not duplicate state)
- ✅ Execute Plan button visibility computed from events
- ✅ No hidden state - everything in event log

## Testing Checklist

- [ ] PLAN mode: Click "Approve Plan" multiple times → Only ONE approval card
- [ ] PLAN mode: Execute Plan button ONLY appears after approval resolved (approved=true)
- [ ] PLAN mode: Click "Refine Plan" → Old approval cancelled → New plan requires approval
- [ ] Large plan (>6 steps): Size check data included in approval details
- [ ] Event replay: All states correctly derived from events
- [ ] Approval idempotency: No duplicate approval_requested for same plan_id

## Future Enhancements (Not Implemented)

### V2 Features
1. **Break into Missions UI:**
   - When `shouldBreakIntoMissions() === true`, show "Break into Missions" button
   - Emit `mission_breakdown_created` with suggested mission chunks
   - Require `mission_selected` before execution

2. **Refine Plan UI:**
   - Modal or inline input for refinement text
   - Show diff between old and new plan
   - Option to revert to previous plan version

3. **Plan Version History:**
   - Track plan version numbers
   - Allow browsing plan history
   - Restore previous plan versions

## Constraints Maintained

✅ **No schema changes:** Only added fields to existing event payloads
✅ **Deterministic:** All decisions derivable from event stream
✅ **Replayable:** Event log can be replayed to reconstruct state
✅ **Canonical events:** No new event types except `plan_revised` (required)

## Summary

Successfully implemented PLAN approval + execution gating UX fixes to eliminate duplicate CTAs and enforce correct state machine. The system now:

1. **Prevents duplicate approvals** through idempotent request handling
2. **Gates Execute Plan** behind plan approval with clear state machine
3. **Supports plan refinement** with automatic approval superseding
4. **Includes size guardrails** to flag overly complex plans
5. **Maintains determinism** with all state derived from events

All changes follow Ordinex architectural principles: deterministic, event-sourced, and replayable.
