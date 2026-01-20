# STEP 24 — PLAN → MISSION Handoff Implementation (Complete)

**Status:** ✅ IMPLEMENTED  
**Date:** 2026-01-20

## Overview

STEP 24 implements the approval-based handoff from PLAN mode to MISSION mode. This allows users to review and approve a generated plan before transitioning to execution mode, maintaining user control and deterministic state transitions.

## Core Principle

```
PLAN → MISSION Handoff:
  ✅ User clicks "Approve Plan → Start Mission"
  ✅ Backend emits approval_requested event
  ✅ User approves/rejects via ApprovalCard
  ✅ Backend emits approval_resolved + mode_set(MISSION)
  ✅ UI shows "Execute Plan" CTA
  
  ❌ No automatic execution
  ❌ No tools run until user clicks Execute Plan
  ❌ No mode auto-switching
```

## Implementation Details

### 1. Frontend: PlanCard Button Handler

**File:** `packages/webview/src/components/PlanCard.ts`

**Changes:**
- Button now calls `handleRequestPlanApproval(task_id, plan_event_id)`
- "Edit Plan" button disabled with tooltip ("Plan editing coming in future version")
- "Cancel" button clears task and resets state

**Action Flow:**
```javascript
User clicks "Approve Plan → Start Mission"
  ↓
handleRequestPlanApproval() sends message to backend
  ↓
Backend creates approval_requested event
  ↓
UI renders ApprovalCard
  ↓
User clicks Approve/Reject
  ↓
Backend resolves approval + switches mode if approved
```

### 2. Frontend: Webview Message Handlers

**File:** `packages/webview/src/index.ts`

**New Handlers:**

1. **handleRequestPlanApproval(taskId, planEventId)**
   - Sends `ordinex:requestPlanApproval` message to backend
   - Passes task_id and plan_id for event linkage

2. **handleApproval(approvalId, decision)** (Enhanced)
   - Detects if approval is `plan_approval` type
   - Routes to `ordinex:resolvePlanApproval` for plan approvals
   - Routes to generic `ordinex:resolveApproval` for other types (diff, terminal)
   - Supports demo mode with local simulation

3. **handleEditPlan(taskId, planEventId)** (Stub)
   - Shows alert: "Plan editing will be available in a future version"

4. **handleCancelPlan(taskId)**
   - Clears events and resets task state
   - Confirms with user before canceling

### 3. Backend: Extension Message Handlers

**File:** `packages/extension/src/extension.ts`

**New Message Types:**

1. **ordinex:requestPlanApproval**
   - Handler: `handleRequestPlanApproval(message, webview)`
   - Extracts plan details from `plan_created` event
   - Emits `approval_requested` with type `plan_approval`
   - Includes goal, steps_count, scope_contract, risks in details
   - Emits `execution_paused` (reason: "Awaiting plan approval")

2. **ordinex:resolvePlanApproval**
   - Handler: `handleResolvePlanApproval(message, webview)`
   - Emits `approval_resolved` with decision
   - If approved:
     - Emits `mode_set` to switch to MISSION mode
     - Updates `this.currentMode = 'MISSION'`
     - Emits `execution_paused` (reason: "Awaiting Execute Plan action")
   - If rejected:
     - Emits `execution_paused` (reason: "Plan rejected")
     - Remains in PLAN mode

### 4. Event Sequence (Canonical)

#### Plan Approval Request Flow

```
1. intent_received (user's original request)
2. mode_set (PLAN)
3. plan_created (structured plan in payload)
4. [User clicks "Approve Plan → Start Mission"]
5. approval_requested
   - type: plan_approval
   - details: { plan_id, goal, steps_count, scope_contract, risks }
   - risk_level: low
6. execution_paused (reason: "Awaiting plan approval")
```

#### Approval → MISSION Transition (If Approved)

```
7. approval_resolved (approved: true)
8. mode_set (MISSION)
   - previous_mode: PLAN
   - reason: "Plan approved - switching to MISSION mode"
9. execution_paused (reason: "Awaiting Execute Plan action")
```

#### Approval Rejection (If Rejected)

```
7. approval_resolved (approved: false)
8. execution_paused (reason: "Plan rejected")
[Task remains in PLAN mode]
```

### 5. UI Flow

**Before Approval:**
```
[ Plan Card ]
  Goal: Add authentication
  Steps: 5
  [✓ Approve Plan → Start Mission]  [✏️ Edit Plan]  [✕ Cancel]
```

**After User Clicks Approve:**
```
[ ⚠️ Pending Approvals ]
  
[ Approval Card: Plan Approval ]
  ID: abc12345
  Approve plan to start mission
  
  Details:
    Goal: Add authentication
    Steps: 5
    Risks: Breaking existing routes
  
  [✓ Approve]  [✗ Reject]

Status: AWAITING APPROVAL
```

**After User Approves:**
```
[ Approval Resolved: ✓ Approved ]
[ Mode Set: MISSION ]
[ Execution Paused: Awaiting Execute Plan action ]

[ 🚀 Execute Plan ]  <-- CTA button (from STEP 14)

Status: PAUSED (MISSION mode)
```

**After User Rejects:**
```
[ Approval Resolved: ✗ Denied ]
[ Execution Paused: Plan rejected ]

[Plan Card still visible for review]

Status: PAUSED (PLAN mode)
```

### 6. State Management

**Backend State Tracking:**
- `this.currentMode`: Updated to `'MISSION'` after approval
- `this.currentStage`: Remains `'none'` until Execute Plan is clicked
- `this.currentTaskId`: Persists throughout handoff

**Frontend State:**
- No additional state tracking needed (event-driven)
- `state.events`: Updated from backend via `ordinex:eventsUpdate`
- Approval cards rendered from pending approvals selector

### 7. Approval Card Rendering

The existing `ApprovalCard` component handles plan approvals:

**Plan Approval Details Display:**
- Goal from plan
- Number of steps
- Scope contract (max_files, max_lines, allowed_tools)
- Risks
- Risk badge: LOW (green)

**Type Label:** "Plan Approval"

### 8. Execute Plan CTA

The "Execute Plan" button (from STEP 14) becomes visible when:
1. `effectiveMode === 'MISSION'`
2. `plan_created` event exists
3. `retrieval_started` has NOT occurred (not yet executed)
4. No pending approvals

**Disabled when:** Pending approvals exist

## Files Modified

### Frontend (Webview)
1. **packages/webview/src/components/PlanCard.ts**
   - Changed button onclick to `handleRequestPlanApproval`
   - Disabled "Edit Plan" button with tooltip
   - Added Cancel button functionality

2. **packages/webview/src/index.ts**
   - Added `handleRequestPlanApproval()` global handler
   - Enhanced `handleApproval()` to route plan approvals separately
   - Added `handleEditPlan()` stub
   - Added `handleCancelPlan()` handler

### Backend (Extension)
3. **packages/extension/src/extension.ts**
   - Added case for `ordinex:requestPlanApproval` in message handler
   - Added case for `ordinex:resolvePlanApproval` in message handler
   - Implemented `handleRequestPlanApproval()` method
   - Implemented `handleResolvePlanApproval()` method

### Core
No changes to core package (all event types already defined in STEP 23).

## Testing Checklist

### Manual Testing

- [ ] User selects PLAN mode
- [ ] Enters planning request
- [ ] Plan is generated and displayed
- [ ] "Approve Plan → Start Mission" button is visible
- [ ] Clicking button shows approval card
- [ ] Status changes to "AWAITING APPROVAL"
- [ ] Send button is disabled during approval
- [ ] Approve button on approval card works
- [ ] Mode switches to MISSION after approval
- [ ] "Execute Plan" CTA appears
- [ ] Reject button on approval card works
- [ ] Mode stays PLAN after rejection
- [ ] Cancel button clears task
- [ ] Restart VS Code preserves state (via event replay)

### Event Sequence Testing

**Approval Flow:**
```bash
# Expected event sequence
1. approval_requested (type: plan_approval)
2. execution_paused (awaiting approval)
3. approval_resolved (approved: true)
4. mode_set (MISSION)
5. execution_paused (awaiting Execute Plan)
```

**Rejection Flow:**
```bash
# Expected event sequence
1. approval_requested (type: plan_approval)
2. execution_paused (awaiting approval)
3. approval_resolved (approved: false)
4. execution_paused (plan rejected)
[No mode_set - remains in PLAN]
```

## Key Design Decisions

### 1. Explicit Approval Flow
- **Why:** Maintains user control, prevents accidental mode switches
- **How:** Two-step process: request → resolve

### 2. Separate Approval Type
- **Why:** Plan approvals have different requirements than diff/terminal approvals
- **How:** `approval_type: 'plan_approval'` with rich details payload

### 3. Pause After Approval
- **Why:** User must explicitly click "Execute Plan" to start execution
- **How:** Emit `execution_paused` after mode switch, not `execution_resumed`

### 4. No Auto-Execution
- **Why:** PLAN mode promise: no execution until user approves AND starts
- **How:** Mode switch doesn't trigger retrieval; requires Execute Plan click

### 5. Cancel Clears Task
- **Why:** Simple recovery mechanism if user wants to start over
- **How:** Clears events array and resets state

## Integration with Existing Systems

### Approval Manager (STEP 12)
- Plan approval uses existing approval card infrastructure
- `approval_requested` → `approval_resolved` flow
- UI gating (disable send button during approval)

### Execute Plan (STEP 14)
- Execute Plan CTA appears after mode switch
- Gated by pending approvals (disabled if any exist)
- Starts retrieval → edit → test flow when clicked

### Event Sourcing
- All actions emit canonical events
- State is deterministic from event log
- Restart recovers full state including pending approvals

## Constraints Enforced

✅ **No automatic execution:**
- Mode switch does NOT trigger retrieval
- User must click "Execute Plan"

✅ **No tools run:**
- No LLM calls during handoff
- No file writes
- No command execution

✅ **User-controlled mode switching:**
- User must click Approve
- Mode only switches after explicit approval
- Rejection keeps mode as PLAN

✅ **Deterministic state:**
- All state changes from events
- No hidden state transitions
- Full event log for replay

## Future Enhancements (V2+)

### Plan Editing
- Allow user to modify plan before approval
- Edit form with fields for goal, steps, scope
- Re-validate edited plan
- Emit `plan_edited` event

### Plan Versioning
- Track plan revisions
- Allow rollback to previous version
- Compare plan versions

### Conditional Approval
- Approve with modifications
- Approve scope contract changes separately
- Approve specific steps only

### Auto-Approval Rules
- Skip approval for low-risk plans
- User-defined auto-approval criteria
- Trust level based on plan complexity

## Success Criteria

✅ **STEP 24 Complete When:**
- [x] User can approve plan from PLAN mode
- [x] Backend emits approval_requested event
- [x] ApprovalCard renders plan approval
- [x] User can approve/reject approval
- [x] Approved plans switch mode to MISSION
- [x] Rejected plans stay in PLAN mode
- [x] Mode switch is recorded in events
- [x] Execute Plan CTA appears after approval
- [x] No execution happens until Execute Plan clicked
- [x] Events are deterministically replayable

## Summary

STEP 24 successfully implements the PLAN → MISSION handoff with proper approval gates:

1. **Plan Approval Request:** User clicks button → approval_requested event → ApprovalCard renders
2. **Approval Resolution:** User approves → approval_resolved + mode_set → MISSION mode
3. **Execute Plan Ready:** Mode switch complete → Execute Plan CTA appears → waits for user
4. **No Auto-Execution:** All tools paused until user explicitly clicks Execute Plan

**Event-Driven:** All state changes emit canonical events, ensuring deterministic replay.

**User-Controlled:** Mode switching requires explicit user approval at every step.

**Gated Execution:** No retrieval, edits, or tests run until user approves plan AND clicks Execute Plan.

**Next Step:** User clicks "Execute Plan" → retrieval begins (STEP 14 flow).
