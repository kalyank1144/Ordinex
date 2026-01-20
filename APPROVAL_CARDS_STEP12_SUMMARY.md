# Step 12: Approval Cards + UI Gating Implementation Summary

**Date**: January 19, 2026  
**Status**: ✅ Complete

## Overview

Implemented a complete approval system with first-class Approval Cards in Mission Control UI, including UI gating that blocks execution until approvals are resolved. The system is event-driven and deterministic, computing pending approvals from the event stream.

## Implementation

### 1. ApprovalCard Component
**File**: `packages/webview/src/components/ApprovalCard.ts`

**Features**:
- First-class approval card UI with visual prominence (pulsing glow animation)
- Displays approval type (terminal / apply_diff / scope_expansion)
- Shows summary of requested action
- Risk level badge (low/med/high) with color-coding
- Evidence links display (if available)
- Approve/Reject action buttons
- Type-specific detail rendering:
  - **Terminal**: Command + working directory
  - **Apply Diff**: Files changed, additions/deletions
  - **Scope Expansion**: Reason + requested changes

**Risk Badge Logic**:
- Reads `risk_level` from event payload if present
- Infers risk from approval type if not specified:
  - `terminal` → HIGH (red)
  - `apply_diff` → MEDIUM (yellow)
  - `scope_expansion` → LOW (green)

### 2. Approval Selectors
**File**: `packages/webview/src/selectors/approvalSelectors.ts`

**Deterministic Pairing Rule**:
```typescript
// A pending approval exists when:
// - approval_requested(approval_id=X) exists
// - AND no approval_resolved(approval_id=X) exists yet
```

**Functions**:
- `getPendingApprovals(events)` - Returns all pending approvals
- `hasPendingApprovals(events)` - Boolean check for any pending approvals
- `getPendingApprovalById(events, id)` - Get specific pending approval
- `getPendingScopeExpansionApproval(events)` - Get scope expansion approval for Systems tab

**Two-Pass Algorithm**:
1. **Pass 1**: Collect all resolved approval IDs
2. **Pass 2**: Find approval_requested events not in resolved set

### 3. UI Gating Logic
**File**: `packages/webview/src/index.ts` (integrated)

**Gating Behavior**:
- When pending approvals exist:
  - Status pill changes to **"AWAITING APPROVAL"** (yellow)
  - Send button **disabled** with tooltip "Resolve pending approval first"
  - Stop button remains **enabled**
  - Mission timeline remains **viewable**
  - Systems and Logs tabs remain **accessible**

- When approvals resolved:
  - Status returns to **"Ready"**
  - Send button **re-enabled**
  - Normal operation resumes

**UX Gating Only**:
- This is UI-level gating for user experience
- Runtime gating exists in core ApprovalManager (blocks execution via Promise)
- No duplication of runtime logic in UI

### 4. Mission Tab Integration
**File**: `packages/webview/src/index.ts`

**Rendering Flow**:
```
renderMissionTimeline()
  ├── Check for pending approvals
  ├── If pending: Render "⚠️ Pending Approvals" section header
  ├── Render each pending approval as ApprovalCard
  └── Render normal event timeline below
```

**Approval Cards Placement**:
- Always shown **at the top** of Mission tab
- Separate "Pending Approvals" section with distinct styling
- Event timeline continues below approval cards

### 5. Systems Tab Integration
**File**: `packages/webview/src/index.ts`

**Scope Expansion Approvals**:
- Detects `scope_expansion` approval type
- Shows in existing "Scope Expansion Request" section
- Displays reason + requested changes
- Approve/Reject buttons call same `handleApproval()` function
- Automatically updates when approval resolved

### 6. Logs Tab Enhancement
**File**: `packages/webview/src/index.ts`

**Event Display**:
- Shows both `approval_requested` and `approval_resolved` events
- Displays:
  - Event type name
  - Timestamp
  - Mode + Stage + Event ID
- Events clickable for selection (visual feedback)

### 7. Message Contract (Webview ↔ Extension)
**Defined but not yet wired** (prepared for backend integration)

**Messages**:
```javascript
// Webview → Extension: Resolve approval
vscode.postMessage({
  type: 'ordinex:resolveApproval',
  approval_id: string,
  decision: 'approved' | 'rejected'
});

// Extension → Webview: Acknowledgment (optional)
{
  type: 'ordinex:approvalResolvedAck',
  approval_id: string
}
```

**Current Behavior**:
- Demo mode: Updates local event list directly
- Interface kept identical to real backend wiring
- Easy to switch to extension integration later

### 8. Event Emission
**Approval Resolution**:
```javascript
{
  event_id: string,
  task_id: string,
  timestamp: ISO string,
  type: 'approval_resolved',
  mode: Mode,
  stage: Stage,
  payload: {
    approval_id: string,
    decision: 'approved' | 'rejected',
    decided_at: ISO string,
    note?: string  // Optional field
  },
  evidence_ids: [],
  parent_event_id: null
}
```

## Testing Features

### Demo Test Buttons
Added test buttons (shown when `?demo` in URL):
- **Test Terminal Approval** - Creates terminal execution approval
- **Test Diff Approval** - Creates diff apply approval  
- **Test Scope Approval** - Creates scope expansion approval

Each generates appropriate event with realistic payload.

## Architecture Decisions

### 1. Event-Driven Computation
✅ Approvals computed from events, not stored in ephemeral state  
✅ Deterministic pairing of request/resolved events  
✅ Survives state resets and re-renders

### 2. UI Separation
✅ ApprovalCard is pure presentational component  
✅ Selectors are pure functions (testable)  
✅ UI gating separate from runtime gating

### 3. Flexibility
✅ Risk level can be explicit or inferred  
✅ Evidence links optional  
✅ Type-specific detail rendering  
✅ Extensible to new approval types

## Visual Design

### Approval Card Styling
- **Background**: Warning yellow background
- **Border**: 2px solid yellow with pulsing glow animation
- **Risk Badge**: Colored pill (green/yellow/red) in top-right
- **Icon**: ⏸️ (pause) to indicate waiting state
- **Buttons**: 
  - Approve: Green with hover lift effect
  - Reject: Red with hover lift effect

### Status Pill
- **Awaiting Approval**: Yellow background, black text
- Distinct from other states (Ready, Running, Paused, Error)

## File Changes

### New Files
1. `packages/webview/src/components/ApprovalCard.ts` - Approval card component
2. `packages/webview/src/selectors/approvalSelectors.ts` - Approval selectors
3. `APPROVAL_CARDS_STEP12_SUMMARY.md` - This document

### Modified Files
1. `packages/webview/src/index.ts` - Integrated approval system into webview
   - Added approval selectors (inline)
   - Added approval card rendering
   - Added UI gating logic
   - Added approval handlers
   - Added test buttons for demo

## Stop Conditions Met

✅ **Creating `approval_requested` event causes Approval Card to appear**  
   - Card renders at top of Mission tab
   - Shows all approval details

✅ **Clicking Approve/Reject emits `approval_resolved` and removes pending card**  
   - Event emitted with correct payload
   - Card disappears (no longer pending)
   - Timeline updated with resolved event

✅ **UI shows AWAITING APPROVAL status and gates Send while pending**  
   - Status pill changes to yellow "Awaiting Approval"
   - Send button disabled with tooltip
   - Stop button remains enabled
   - All tabs remain accessible

## Integration Notes

### Backend Wiring (Future)
When connecting to real extension backend:

1. Uncomment message posting in `handleApproval()`:
```javascript
vscode.postMessage({
  type: 'ordinex:resolveApproval',
  approval_id: approvalId,
  decision: decision
});
```

2. Extension receives message and calls `ApprovalManager.resolveApproval()`

3. `ApprovalManager` emits `approval_resolved` event via EventBus

4. EventBus updates webview with new event

5. Webview re-renders, removing approval card

### Testing
Current demo mode sufficient for testing:
- Use `testApproval('terminal')` to create approval
- Click Approve/Reject in UI
- Verify card disappears
- Verify events in Logs tab
- Verify status changes

## Constraints Followed

✅ No tool execution implemented here  
✅ No diff applying implemented here  
✅ No terminal commands run here  
✅ No new event types added  
✅ No invented approvals (only from events)  
✅ Canonical event types used (`approval_requested`, `approval_resolved`)

## Next Steps

1. Wire extension backend to handle `ordinex:resolveApproval` messages
2. Connect extension to ApprovalManager for real approval flow
3. Add evidence viewer integration for approval evidence links
4. Add approval history view (optional)
5. Add "always approve this type" preference (optional, V2)

## Conclusion

The approval system is fully functional in demo mode with complete UI, gating logic, and event handling. The interface is designed to seamlessly integrate with backend when ready, with no changes required to the UI layer.

**Demo Verification**:
1. Run webview with `?demo` parameter
2. Click "Test Terminal Approval" button
3. Observe glowing approval card at top of Mission tab
4. Observe "AWAITING APPROVAL" status
5. Observe Send button disabled
6. Click Approve or Reject
7. Observe card disappears
8. Observe status returns to "Ready"
9. Observe Send button re-enabled
10. Check Logs tab for both events
