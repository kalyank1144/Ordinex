# ANSWER Mode Polish - Remaining Issues

## Current Status
✅ Mission Tab - Clean and working
✅ Stream events hidden from timeline  
✅ Context collected shows properly
✅ Tool events display

## Issues to Fix

### 1. ⚠️ Systems Tab Not Tracking ANSWER Mode

**Problem:** Systems counters show 0 when they should show:
- Files In Scope: 3 (from context_collected)
- Lines Included: 141 (from context_collected)  
- Tool Calls: 1+ (from tool_start events)

**Root Cause:** The `eventsUpdate` message handler doesn't process events to update counters. It only renders.

**Fix Required in `packages/webview/src/index.ts`:**

Add this logic in the `case 'ordinex:eventsUpdate':` handler:

```javascript
// Update counters from events
state.counters = {
  filesInScope: 0,
  filesTouched: 0,
  linesIncluded: 0,
  toolCallsUsed: 0,
  toolCallsMax: 100
};

for (const event of message.events) {
  // Track context_collected (ANSWER mode)
  if (event.type === 'context_collected') {
    const filesCount = (event.payload.files_included || []).length;
    const linesCount = event.payload.total_lines || 0;
    state.counters.filesInScope = Math.max(state.counters.filesInScope, filesCount);
    state.counters.linesIncluded = Math.max(state.counters.linesIncluded, linesCount);
  }
  
  // Track retrieval_started (MISSION mode)
  if (event.type === 'retrieval_started') {
    // Existing logic
  }
  
  // Track tool calls
  if (event.type === 'tool_start') {
    state.counters.toolCallsUsed++;
  }
  
  // Track files touched
  if (event.type === 'diff_applied') {
    const files = (event.payload.files_changed || []).length;
    state.counters.filesTouched += files;
  }
}

renderSystemsCounters(); // Add this call
```

---

### 2. ⚠️ Model Names Too Technical

**Problem:** Shows "claude-3-haiku-20240307" instead of "Claude 3 Haiku"

**Fix Required:**

Add helper function:
```javascript
function humanizeModelName(modelId) {
  const modelMap = {
    'claude-3-haiku': 'Claude 3 Haiku',
    'claude-3-haiku-20240307': 'Claude 3 Haiku',
    'claude-3-sonnet': 'Claude 3 Sonnet',
    'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
    'claude-3-opus': 'Claude 3 Opus',
    'claude-3-opus-20240229': 'Claude 3 Opus',
    'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet'
  };
  return modelMap[modelId] || modelId;
}
```

Update `tool_start` display:
```javascript
if (tool === 'llm_answer') {
  const humanModel = humanizeModelName(model);
  return `Answering (${humanModel})${hasContext ? ' · Project-aware' : ''}`;
}
```

---

### 3. ⚠️ Logs Tab Shows Too Many stream_delta Events

**Problem:** Logs tab shows 100+ individual stream_delta events

**Solution:** Collapse them into grouped rows

**Fix Required:**

In `renderLogs()` function, add grouping logic:

```javascript
function renderLogs() {
  if (state.events.length === 0) {
    eventLogList.innerHTML = '<div>No events yet.</div>';
    return;
  }

  // Group stream_delta events
  const groupedEvents = [];
  let streamGroup = null;
  
  for (const event of state.events) {
    if (event.type === 'stream_delta') {
      if (!streamGroup) {
        streamGroup = { type: 'stream_delta_group', count: 1, firstEvent: event };
      } else {
        streamGroup.count++;
      }
    } else {
      if (streamGroup) {
        groupedEvents.push(streamGroup);
        streamGroup = null;
      }
      groupedEvents.push(event);
    }
  }
  if (streamGroup) groupedEvents.push(streamGroup);

  // Render grouped events
  eventLogList.innerHTML = groupedEvents.map((item, idx) => {
    if (item.type === 'stream_delta_group') {
      return `
        <div class="event-log-item collapsed-group">
          <div class="event-log-header">
            <span class="event-log-type">stream_delta × ${item.count}</span>
            <span class="event-log-timestamp">${formatTimestamp(item.firstEvent.timestamp)}</span>
          </div>
          <div class="event-log-summary" style="color: var(--vscode-descriptionForeground); font-style: italic;">
            Streaming chunks (collapsed for readability)
          </div>
        </div>
      `;
    }
    
    // Regular event rendering
    return `
      <div class="event-log-item" data-event-idx="${idx}">
        ...
      </div>
    `;
  }).join('');
}
```

---

## Implementation Priority

1. **HIGH:** Fix Systems tab counters (breaks truth dashboard)
2. **MEDIUM:** Humanize model names (UX polish)  
3. **LOW:** Collapse stream_delta in Logs (nice-to-have, debug view)

## Testing Checklist

After fixes:
- [ ] Systems tab shows 3 files, 141 lines after ANSWER query
- [ ] Tool calls counter increments
- [ ] Mission tab shows "Claude 3 Haiku" not "claude-3-haiku-20240307"
- [ ] Logs tab groups stream_delta into one collapsed row
- [ ] Reload VS Code window to test

## Files to Modify

- `packages/webview/src/index.ts` - All three fixes in inline JavaScript
