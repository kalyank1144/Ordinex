# Mission Control UI Refactor — Implementation Summary

## Overview
Refactored the Ordinex Mission Control UI from a single chat interface to a proper 3-tab layout (Mission / Systems / Logs) with event-driven rendering architecture. This UI is ready to connect to the event stream while remaining functional as a standalone demonstration.

## Changes Made

### 1. Updated Types (`packages/webview/src/types.ts`)

**Removed:** Chat-based types (ChatMessage, MessageRole, etc.)

**Added:** Event-driven types matching core architecture:
- `Mode`: 'ANSWER' | 'PLAN' | 'MISSION'
- `Stage`: 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'none'
- `TaskStatus`: 'ready' | 'running' | 'paused' | 'awaiting_approval' | 'error'
- `TabName`: 'mission' | 'systems' | 'logs'
- `EventType`: Canonical event types (intent_received, plan_created, tool_start, etc.)
- `Event`: Complete event structure with event_id, task_id, timestamp, type, mode, stage, payload, evidence_ids, parent_event_id
- `NarrationCard`: Mission feed cards (intent, plan, evidence, tool_run, diff_proposed, approval, result)
- `CheckpointInfo`: Checkpoint metadata
- `MissionControlState`: Complete UI state management

### 2. Complete UI Refactor (`packages/webview/src/index.ts`)

Replaced the chat-style UI with a proper Mission Control layout:

#### **Header Bar**
- Title: "Ordinex Mission Control"
- Status pill with 5 states:
  - Ready (blue)
  - Running (green)
  - Paused (orange)
  - Awaiting Approval (yellow)
  - Error (red)
- Stage label showing current stage (plan/retrieve/edit/test/repair/none)

#### **Tab Bar**
- 3 tabs: Mission | Systems | Logs
- Active tab highlighting with bottom border
- Smooth transitions
- Tab switching preserves state

#### **Mission Tab**
- Event-derived narration cards in canonical order:
  - Intent → Plan → Evidence → Tool Runs → Diff Proposed → Approval → Result
- Each card shows:
  - Type badge (color-coded)
  - Timestamp
  - Title
  - Content (with proper formatting)
  - Status (for approval cards: pending/approved/rejected/complete)
- Empty state: "No mission yet. Start a conversation to begin."
- Smooth fade-in animations

#### **Systems Tab**
- **Scope Contract Section:**
  - Max Files
  - Max Lines
  - Allowed Tools
  - Max Iterations
  - Max Tool Calls
- **Live Counters (2x2 grid):**
  - Files In Scope
  - Files Touched
  - Lines Included
  - Tool Calls (usage/max)
- **Checkpoint Status:**
  - Latest Checkpoint ID
  - Event Count
- **Scope Expansion Request (conditional):**
  - Warning header
  - Reason display
  - Approve/Reject buttons
  - Hidden when no pending request

#### **Logs Tab**
- Raw event log list
- Each event shows:
  - Event type (bold)
  - Timestamp
  - Mode, Stage, and Event ID summary
- Clickable items (selectable with highlight)
- Empty state: "No events yet."

#### **Composer Bar (Bottom)**
- **Controls Row:**
  - Mode dropdown: ANSWER / PLAN / MISSION
  - Model dropdown: Sonnet 4.5, Opus 4.5, GPT-5.2, Gemini 3
- **Input Row:**
  - Textarea (2 rows default, auto-expands to 6 rows max)
  - Button group (vertical):
    - Send (primary)
    - Stop (secondary, disabled)
    - Clear (danger)
- Minimal height to maximize content area
- Keyboard shortcut: Ctrl/Cmd+Enter to send

### 3. State Management

**Comprehensive local state:**
```javascript
{
  activeTab: 'mission',
  taskStatus: 'ready',
  currentStage: 'none',
  currentMode: 'ANSWER',
  narrationCards: [],
  scopeSummary: { contract, in_scope_files, touched_files, ... },
  latestCheckpoint: null,
  pendingScopeExpansion: null,
  events: [],
  selectedModel: 'sonnet-4.5',
  counters: {
    filesInScope: 0,
    filesTouched: 0,
    linesIncluded: 0,
    toolCallsUsed: 0,
    toolCallsMax: 100
  }
}
```

### 4. Demo/Simulation Flow

Since LLM integration isn't ready, implemented a demo flow:

1. **User sends prompt** → Creates `intent_received` event + Intent narration card
2. **Status changes to "running"**, Stage to "plan"
3. **After 800ms** → Creates `plan_created` event + Plan narration card
4. **After 1800ms total** → Creates `final` event + Result narration card
5. **Status returns to "ready"**, Stage to "none"
6. **Tool call counter increments** by 2

All events are recorded in the Logs tab and can be viewed.

### 5. Rendering Functions

**Event-driven rendering:**
- `renderMission()`: Renders narration cards from state
- `renderSystemsCounters()`: Updates live counters and checkpoint info
- `renderLogs()`: Renders event list with click handlers
- All views render from state, ready to be driven by real events

### 6. Styling

**Professional, compact design:**
- Full VS Code theme variable integration
- Responsive for narrow side panels (350px breakpoint)
- Minimal padding/spacing for vertical space efficiency
- Color-coded status pills and narration card types
- Smooth animations and transitions
- Custom scrollbar styling
- Accessible focus states

## UI Features Implemented

### ✅ Header & Status
- [x] Mission Control title
- [x] 5-state status pill (ready/running/paused/awaiting_approval/error)
- [x] Stage indicator (plan/retrieve/edit/test/repair/none)

### ✅ Tab Navigation
- [x] 3 tabs: Mission, Systems, Logs
- [x] Active tab highlighting
- [x] Tab switching functionality

### ✅ Mission Tab
- [x] Event-driven narration cards
- [x] Card types: intent, plan, evidence, tool_run, diff_proposed, approval, result
- [x] Status indicators on approval cards
- [x] Empty state message
- [x] Timestamps and formatting

### ✅ Systems Tab
- [x] Scope Contract display (5 metrics)
- [x] Live Counters (4 counters in 2x2 grid)
- [x] Checkpoint status (ID + event count)
- [x] Scope expansion request UI (conditional)
- [x] Approve/Reject actions

### ✅ Logs Tab
- [x] Raw event list rendering
- [x] Event metadata display
- [x] Selectable event items
- [x] Empty state message

### ✅ Composer
- [x] Mode selector (ANSWER/PLAN/MISSION)
- [x] Model selector (4 options)
- [x] Auto-resizing textarea (40-120px)
- [x] Send button
- [x] Stop button (disabled placeholder)
- [x] Clear button
- [x] Ctrl/Cmd+Enter shortcut
- [x] Compact layout

### ✅ Interactions
- [x] Send creates events and narration
- [x] Clear resets all state
- [x] Mode changes recorded as events
- [x] Tab switching
- [x] Event selection in Logs
- [x] Scope expansion approval/rejection

## NOT Implemented (As Required)
- ❌ LLM provider integration
- ❌ Tool execution
- ❌ Real event stream connection
- ❌ Message passing to extension backend
- ❌ Persistence
- ❌ Stop functionality

## Technical Details

### Event Structure
All demo events follow the canonical schema:
```javascript
{
  event_id: string,
  task_id: string,
  timestamp: ISO-8601 string,
  type: EventType,
  mode: Mode,
  stage: Stage,
  payload: object,
  evidence_ids: string[],
  parent_event_id: string | null
}
```

### Narration Card Derivation
Mission cards are derived from events but abstracted for user-friendly display:
- Events are low-level (intent_received, plan_created)
- Cards are high-level (Intent, Plan, Result)
- Multiple events can contribute to one card
- Cards maintain event_ids for traceability

### Responsive Design
- Works well in 320px+ width panels
- 2x2 counter grid collapses to 1 column < 350px
- Composer controls stack vertically < 350px
- Tab bar scales proportionally

## Build Status
✅ **All packages compile successfully:**
```
packages/core build: Done in 746ms
packages/webview build: Done in 591ms
packages/extension build: Done in 388ms
```

## Testing Instructions

1. **Launch Extension:**
   - Press F5 in VS Code
   - Open Command Palette (Cmd/Ctrl+Shift+P)
   - Run "Ordinex: Open Mission Control" OR click Ordinex icon in Activity Bar

2. **Test Mission Tab:**
   - Type a message in composer
   - Click Send or Ctrl/Cmd+Enter
   - Watch narration cards appear (Intent → Plan → Result)
   - Verify status changes: Ready → Running → Ready
   - Verify stage changes: none → plan → none

3. **Test Systems Tab:**
   - Click "Systems" tab
   - Verify Scope Contract displays
   - Verify Live Counters show 0 initially
   - After sending a message, verify Tool Calls increments to 2/100
   - Verify Checkpoint Status shows "None"

4. **Test Logs Tab:**
   - Click "Logs" tab
   - Verify events appear (intent_received, plan_created, final)
   - Click an event to select it
   - Verify event metadata displays (mode, stage, ID)

5. **Test Composer:**
   - Change Mode dropdown (verify event recorded in Logs)
   - Change Model dropdown
   - Type multi-line text (verify auto-resize)
   - Use Ctrl/Cmd+Enter shortcut

6. **Test Clear:**
   - Click Clear button
   - Confirm dialog
   - Verify all tabs reset
   - Verify counters reset to 0

7. **Test Tab Switching:**
   - Switch between Mission/Systems/Logs tabs
   - Verify state persists when switching back
   - Verify active tab highlighting

8. **Test Responsiveness:**
   - Resize panel to narrow width
   - Verify layout adapts
   - Verify counters stack on narrow widths

## Architecture Benefits

### Event-Driven Design
- UI renders from events, not from chat messages
- Ready to connect to real event stream
- Events provide audit trail
- State can be reconstructed from events

### Separation of Concerns
- Mission tab: User-facing narration
- Systems tab: Technical metrics
- Logs tab: Developer/debug view
- Each serves different audience needs

### Extensibility
- Easy to add new event types
- Easy to add new narration card types
- Easy to add new counters
- Easy to wire to real backend

## Next Steps (Future Work)

1. **Event Stream Integration:**
   - Connect to extension backend via postMessage
   - Subscribe to real event stream
   - Render from actual events instead of demo

2. **Message Passing:**
   - Send user prompts to backend
   - Receive events from backend
   - Handle approval requests bidirectionally

3. **LLM Integration:**
   - Wire composer to actual LLM calls
   - Stream responses
   - Handle errors

4. **Tool Execution:**
   - Display tool execution in progress
   - Show tool results
   - Handle tool approvals

5. **Advanced Features:**
   - Evidence viewer (click to see files/diffs)
   - Checkpoint restore UI
   - Filter/search in Logs tab
   - Export event log

## Stop Condition: ✅ ACHIEVED

UI matches the Mission Control layout specification:
- ✅ Header with status pill and stage label
- ✅ 3 tabs: Mission / Systems / Logs
- ✅ Event-driven Mission feed with narration cards
- ✅ Systems tab with scope contract, counters, checkpoint status
- ✅ Logs tab with raw event list
- ✅ Compact composer with mode/model selectors
- ✅ Professional styling for narrow side panels
- ✅ Ready to connect to events (currently stubbed with demo)
- ✅ No LLM calls, no tool execution (as required)
- ✅ Clean, maintainable code structure

The UI is now ready to be wired to the actual event stream and backend services.
