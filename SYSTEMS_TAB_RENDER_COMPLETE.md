# Systems Tab renderSystemsTab() - Complete

## What Was Implemented

### `renderSystemsTab()` Function
A comprehensive render function that displays all 8 sections of the Systems tab dynamically from events.

### 8 Sections Rendered:

1. **📊 Status**
   - Run Status badge (idle/running/paused/completed/cancelled)
   - Current Stage
   - Mission goal (if active)
   - Paused reason (if paused)
   - Current step (if executing)

2. **⏳ Waiting For** (conditional - only shows if pending items exist)
   - Pending Approvals list
   - Pending Decision Points list
   - Warning styling for urgency

3. **📁 Scope**
   - Workspace Roots count
   - Max Files limit (if set)
   - Max Lines limit (if set)
   - Approved Expansions count

4. **📄 Context Included**
   - Files count (counter box)
   - Lines count (counter box)
   - Token Estimate (~Xk tokens)
   - File list (top 5 with path and line counts)
   - "Show all" button for more than 5 files

5. **✏️ Changes**
   - Files Changed total (counter box)
   - Checkpoints Created (counter box)
   - Last Diff status (Applied/Proposed)

6. **🧪 Tests & Repair**
   - Tests Passed (counter box, green if > 0)
   - Tests Failed (counter box, red if > 0)
   - Repair Attempts (used / max)
   - "No repairs remaining" warning

7. **🔧 Tool Activity**
   - Total Calls count
   - Per-tool grid (tool name + count)
   - Last Tool used

8. **⏱️ Timeouts**
   - Stage Timeout (seconds)
   - Timeout Count (warning if > 0)
   - Last Timeout (if any)

### `reduceToSystemsViewModel(events)` Function
An inline reducer in the webview that processes events to derive the 8-section view model. Handles:
- `mission_started`, `mission_completed`, `mission_paused`, `mission_cancelled`
- `execution_paused`, `execution_resumed`
- `stage_changed`, `step_started`, `step_completed`
- `run_scope_initialized`, `scope_expansion_resolved`
- `retrieval_completed`, `context_collected`
- `approval_requested`, `approval_resolved`
- `decision_point_needed`, `clarification_received`
- `diff_proposed`, `diff_applied`, `checkpoint_created`
- `test_completed`
- `repair_attempt_started`, `repair_policy_snapshot`
- `tool_start`
- `stage_timeout`

### Backward Compatibility
`renderSystemsCounters()` now delegates to `renderSystemsTab()` so all existing call sites work.

## Files Changed

| File | Change |
|------|--------|
| `packages/webview/src/index.ts` | Added `reduceToSystemsViewModel()` and `renderSystemsTab()` |

## Usage

The Systems tab automatically updates whenever events change:
- User clicks "Systems" tab → sees all 8 sections
- Events update → `renderSystemsCounters()` → `renderSystemsTab()` re-renders

## Visual Design

- Uses existing CSS classes: `.systems-section`, `.systems-badge`, `.counter-box`, etc.
- Status badges with color coding (running=green, paused=yellow, etc.)
- Warning borders for Waiting For section
- File list with path ellipsis and line counts
- Tool activity grid layout
- Responsive design for narrow panels

## Definition of Done ✅

- [x] `reduceToSystemsViewModel()` inline reducer
- [x] `renderSystemsTab()` renders all 8 sections
- [x] Status section with badge
- [x] WaitingFor section (conditional)
- [x] Scope section with limits
- [x] Context Included with file list
- [x] Changes section with diff status
- [x] Tests & Repair with counters
- [x] Tool Activity with grid
- [x] Timeouts section
- [x] Backward compatible with `renderSystemsCounters()`
