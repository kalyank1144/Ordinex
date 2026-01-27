# Step 30: Logs Tab - Raw Debug Surface

## Summary

Implemented a comprehensive "Raw Debug Surface" for the Logs tab, transforming it from a basic event list into a powerful debugging tool for developers and support engineers.

## Files Changed

- `packages/webview/src/index.ts` - Enhanced Logs tab with filters, search, expandable rows, evidence tokens, and stream grouping

## Features Implemented

### 1. Filter Bar (Step 30 Spec)
- **Text search** over event `type` and `payload` (case-insensitive)
- **Type filter**: Dynamically populated dropdown from unique event types
- **Stage filter**: Dropdown with all stages (none, plan, retrieve, edit, test, repair)
- **Mode filter**: Dropdown with ANSWER, PLAN, MISSION
- **Stats badge**: Shows "X of Y events" based on filter results

### 2. Expandable Log Rows
- Click any row to expand and see full JSON payload
- Expand/collapse icon (▶/▼) with smooth rotation animation
- Expanded state shows:
  - Full JSON payload in `<pre>` with monospace font
  - "Copy JSON" button to copy event to clipboard

### 3. Evidence ID Display
- Events with evidence_ids show clickable tokens below the header
- Click a token → copies evidence_id to clipboard
- Visual feedback: token turns green briefly when copied
- Truncated display (first 10 chars with "...")

### 4. Stream Delta Grouping (UI-only)
- Consecutive `stream_delta` and `stream_complete` events are grouped
- Shows as single row: "stream_delta ×42"
- Expand to see accumulated text (all deltas concatenated)
- "Copy Text" button to copy accumulated content
- **No backend changes** - grouping is purely UI-side transformation

### 5. Mode/Stage/Tool Badges
- Each log row shows colored badges:
  - **Mode badge** (purple): ANSWER, PLAN, MISSION
  - **Stage badge** (blue): current stage
  - **Tool badge** (orange): if event has tool name in payload

### 6. Filter State Management
- State stored in `state.logsFilter` object
- `state.expandedLogEvents` Set tracks expanded event IDs
- `state.expandedStreamGroups` Set tracks expanded group indices
- Filters persist during session (until page reload)

## CSS Additions

```css
/* Filter bar styling */
.logs-filter-bar { ... }
.logs-search-input { ... }
.logs-filter-select { ... }
.logs-stats { ... }

/* Log row styling */
.event-log-item { ... }
.log-row-header { ... }
.log-expand-icon { ... }
.event-log-type { ... }
.log-badge { ... }
.log-badge.mode/.stage/.tool { ... }

/* Evidence tokens */
.evidence-token { ... }
.evidence-token:hover { ... }
.evidence-token-copied { ... }

/* Stream group styling */
.stream-group { ... }
.stream-group-badge { ... }
.stream-group-content { ... }

/* Payload container */
.log-payload-container { ... }
.log-payload-pre { ... }
.log-copy-btn { ... }
```

## JavaScript Functions Added

```typescript
// Render function (rewritten)
renderLogs() - Full render with filters, grouping, expansion

// Toggle handlers
toggleLogEvent(eventId) - Expand/collapse individual events
toggleStreamGroup(groupIdx) - Expand/collapse stream groups

// Copy handlers
copyEvidenceId(id, el) - Copy evidence ID to clipboard
copyEventJson(eventId) - Copy full event JSON to clipboard
copyToClipboard(btn, text) - Generic clipboard copy with feedback

// Filter setup
setupLogsFilters() - Attaches event listeners to filter controls
```

## State Schema

```typescript
state.logsFilter = {
  search: '',      // Text search query
  eventType: 'all', // Selected event type filter
  stage: 'all',    // Selected stage filter
  mode: 'all',     // Selected mode filter
  tool: 'all'      // (Reserved for future tool filter)
};

state.expandedLogEvents = new Set<string>();  // event_ids
state.expandedStreamGroups = new Set<number>(); // group indices
state.streamGroupViewMode = {};  // (Reserved for text/raw toggle)
```

## UX Behavior

1. **Filtering**: Real-time filtering as user types/selects
2. **Stream grouping**: Consecutive stream_delta events collapse into one row
3. **Click to expand**: Shows full JSON with syntax highlighting
4. **Evidence tokens**: Click to copy, visual feedback on success
5. **Stats update**: "X of Y events" updates with each filter change

## Design Rationale

- **No backend changes**: All transformations are UI-only
- **Deterministic**: Same events → same display (no random IDs in groups)
- **Performance**: Virtual scrolling placeholder CSS exists for future optimization
- **Accessibility**: Semantic HTML, keyboard-navigable filters

## Not Implemented (Future V2)

- Virtual scrolling for 10k+ events
- Full-text search across entire evidence content
- Export filtered events as JSON
- Tool-specific filter dropdown
- Evidence viewer modal from Logs tab

## Testing Notes

1. Load extension with events
2. Switch to Logs tab
3. Test search: type "tool" → see only tool_start/tool_end events
4. Test type filter: select "approval_requested"
5. Test stage filter: select "edit"
6. Click any row → expands with JSON
7. Click evidence token → copies ID, turns green
8. Find stream_delta group → expand to see accumulated text
