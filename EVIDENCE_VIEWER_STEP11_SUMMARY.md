# Evidence Viewer Implementation - Step 11 Summary

## Completed Components

### 1. Evidence Type Definitions (packages/webview/src/types.ts)
✅ Added `Evidence` interface mirroring core type
✅ Added `evidence` and `evidenceContent` to MissionControlState
✅ Supports all evidence types: log, diff, file, test, error

### 2. Evidence List Component (packages/webview/src/components/EvidenceList.ts)
✅ Renders evidence summaries with type icons and colors
✅ Shows evidence metadata (type, timestamp, summary)
✅ Provides "Open" and "Copy Summary" actions
✅ Sorts evidence by created_at ascending

### 3. Evidence Viewer Component (packages/webview/src/components/EvidenceViewer.ts)
✅ Modal overlay for viewing evidence content
✅ Type-specific rendering:
  - **diff**: Monospace with preserved whitespace
  - **log/test/error**: Monospace with line wrap toggle
  - **file**: File header + excerpt
✅ Loading state for async content fetch
✅ Copy content and toggle wrap actions

### 4. Updated Webview (packages/webview/src/index.ts)
✅ Added CSS for evidence list and viewer modal
✅ Added state management for evidence and expanded events
✅ Event cards show evidence indicator when evidence_ids present

## Remaining Implementation

The main webview file (index.ts) needs the following JavaScript functionality added to the `<script>` section:

### Required JavaScript Functions

```javascript
// 1. Evidence Viewer State
let currentEvidenceViewer = null;

// 2. Toggle Event Card Evidence Expansion
window.toggleEventEvidence = function(eventId) {
  if (state.expandedEvents.has(eventId)) {
    state.expandedEvents.delete(eventId);
  } else {
    state.expandedEvents.add(eventId);
  }
  renderMission();
};

// 3. Render Evidence List for Expanded Event
function renderEvidenceListForEvent(event) {
  const evidenceItems = event.evidence_ids
    .map(id => state.evidence[id])
    .filter(Boolean)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  if (evidenceItems.length === 0) {
    return '<div class="evidence-list-empty">No evidence attached.</div>';
  }
  
  return evidenceItems.map(evidence => renderEvidenceItem(evidence, event.event_id)).join('');
}

// 4. Render Evidence Item
function renderEvidenceItem(evidence, eventId) {
  const icons = {log: '📋', diff: '📝', file: '📄', test: '🧪', error: '❌'};
  const colors = {
    log: 'var(--vscode-charts-blue)',
    diff: 'var(--vscode-charts-yellow)',
    file: 'var(--vscode-charts-purple)',
    test: 'var(--vscode-charts-green)',
    error: 'var(--vscode-charts-red)'
  };
  
  return \`
    <div class="evidence-item">
      <div class="evidence-item-header">
        <span class="evidence-icon" style="color: \${colors[evidence.type]}">\${icons[evidence.type]}</span>
        <span class="evidence-type-label">\${evidence.type}</span>
        <span class="evidence-timestamp">\${formatTime(evidence.created_at)}</span>
      </div>
      <div class="evidence-summary">\${escapeHtml(evidence.summary)}</div>
      <div class="evidence-actions">
        <button class="evidence-btn evidence-btn-open" onclick="openEvidenceViewer('\${evidence.evidence_id}', '\${eventId}')">
          👁️ Open
        </button>
        <button class="evidence-btn evidence-btn-copy" onclick="copyEvidenceSummary('\${evidence.evidence_id}')">
          📋 Copy Summary
        </button>
      </div>
    </div>
  \`;
}

// 5. Open Evidence Viewer
window.openEvidenceViewer = async function(evidenceId, eventId) {
  const evidence = state.evidence[evidenceId];
  if (!evidence) return;
  
  // Show viewer with loading state
  showEvidenceViewerModal(evidence, null, eventId);
  
  // Load content if not cached
  if (!state.evidenceContent[evidenceId]) {
    // Request content from extension (if needed for file-backed evidence)
    // For demo, use stub content
    await loadEvidenceContent(evidenceId);
  }
  
  // Update viewer with content
  showEvidenceViewerModal(evidence, state.evidenceContent[evidenceId], eventId);
};

// 6. Load Evidence Content
async function loadEvidenceContent(evidenceId) {
  // In production: send message to extension to read file
  // vscode.postMessage({ type: 'getEvidenceContent', evidenceId });
  
  // Demo: simulate loading
  await new Promise(resolve => setTimeout(resolve, 300));
  state.evidenceContent[evidenceId] = getDemoEvidenceContent(evidenceId);
}

// 7. Show Evidence Viewer Modal
function showEvidenceViewerModal(evidence, content, eventId) {
  const isLoading = content === null;
  const icons = {log: '📋', diff: '📝', file: '📄', test: '🧪', error: '❌'};
  
  let contentHTML = '';
  if (isLoading) {
    contentHTML = '<div class="evidence-content-loading"><div class="loading-spinner">⏳</div><div>Loading...</div></div>';
  } else {
    contentHTML = renderEvidenceContent(evidence.type, content, evidence.content_ref);
  }
  
  const viewerHTML = \`
    <div class="evidence-viewer-overlay" onclick="closeEvidenceViewerOnOverlayClick(event)">
      <div class="evidence-viewer-panel" onclick="event.stopPropagation()">
        <div class="evidence-viewer-header">
          <div class="evidence-viewer-title">
            <span class="evidence-viewer-icon">\${icons[evidence.type]}</span>
            <span>\${evidence.type.toUpperCase()}</span>
            <span class="evidence-viewer-id">ID: \${evidence.evidence_id.substring(0, 8)}</span>
          </div>
          <button class="evidence-viewer-close" onclick="closeEvidenceViewer()">✕</button>
        </div>
        <div class="evidence-viewer-metadata">
          <div class="evidence-metadata-row">
            <span class="evidence-metadata-label">Source Event:</span>
            <span class="evidence-metadata-value">\${eventId.substring(0, 8)}</span>
          </div>
          <div class="evidence-metadata-row">
            <span class="evidence-metadata-label">Summary:</span>
            <span class="evidence-metadata-value">\${escapeHtml(evidence.summary)}</span>
          </div>
        </div>
        <div class="evidence-viewer-content">\${contentHTML}</div>
        <div class="evidence-viewer-actions">
          \${!isLoading ? \`
            <button class="evidence-action-btn" onclick="copyEvidenceContent()">📋 Copy Content</button>
            <button class="evidence-action-btn secondary" onclick="toggleLineWrap()">↔️ Toggle Wrap</button>
          \` : ''}
          <button class="evidence-action-btn secondary" onclick="closeEvidenceViewer()">Close</button>
        </div>
      </div>
    </div>
  \`;
  
  // Remove existing viewer
  const existing = document.getElementById('evidenceViewerOverlay');
  if (existing) existing.remove();
  
  // Add new viewer
  document.body.insertAdjacentHTML('beforeend', viewerHTML);
  currentEvidenceViewer = evidenceId;
}

// 8. Render Evidence Content by Type
function renderEvidenceContent(type, content, contentRef) {
  switch (type) {
    case 'diff':
      return \`<div class="evidence-content-area evidence-content-diff"><pre class="evidence-pre">\${escapeHtml(content)}</pre></div>\`;
    case 'log':
    case 'test':
    case 'error':
      return \`<div class="evidence-content-area evidence-content-log"><pre class="evidence-pre">\${escapeHtml(content)}</pre></div>\`;
    case 'file':
      const filename = contentRef.split('/').pop() || 'file';
      return \`
        <div class="evidence-content-area evidence-content-file">
          <div class="evidence-file-header">📄 <strong>\${escapeHtml(filename)}</strong></div>
          <pre class="evidence-pre">\${escapeHtml(content)}</pre>
        </div>
      \`;
    default:
      return \`<div class="evidence-content-area"><pre class="evidence-pre">\${escapeHtml(content)}</pre></div>\`;
  }
}

// 9. Close Evidence Viewer
window.closeEvidenceViewer = function() {
  const viewer = document.getElementById('evidenceViewerOverlay');
  if (viewer) viewer.remove();
  currentEvidenceViewer = null;
};

window.closeEvidenceViewerOnOverlayClick = function(event) {
  if (event.target.classList.contains('evidence-viewer-overlay')) {
    closeEvidenceViewer();
  }
};

// 10. Copy Evidence Functions
window.copyEvidenceSummary = function(evidenceId) {
  const evidence = state.evidence[evidenceId];
  if (evidence) {
    navigator.clipboard.writeText(evidence.summary);
  }
};

window.copyEvidenceContent = function() {
  if (currentEvidenceViewer) {
    const content = state.evidenceContent[currentEvidenceViewer];
    if (content) {
      navigator.clipboard.writeText(content);
    }
  }
};

// 11. Toggle Line Wrap
window.toggleLineWrap = function() {
  const pre = document.querySelector('.evidence-pre');
  if (pre) {
    pre.classList.toggle('wrap');
  }
};

// 12. Demo Evidence Content
function getDemoEvidenceContent(evidenceId) {
  const evidence = state.evidence[evidenceId];
  switch (evidence.type) {
    case 'diff':
      return \`--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 Line 1
-Line 2
+Line 2 modified
+New line 3
 Line 4\`;
    case 'log':
      return \`[INFO] Operation started
[DEBUG] Processing items...
[INFO] Complete: 42 items processed\`;
    case 'test':
      return \`✓ test_feature_a PASSED
✓ test_feature_b PASSED
✗ test_feature_c FAILED
  Expected: true
  Received: false\`;
    case 'error':
      return \`Error: Division by zero
  at calculate (file.ts:42:15)
  at process (file.ts:88:5)\`;
    case 'file':
      return \`function hello() {
  console.log("Hello, world!");
  return 42;
}\`;
    default:
      return 'Content preview...';
  }
}

// 13. Update renderEventCard to include expand behavior
// Modify the existing renderEventCard function to:
// - Add data-event-id attribute
// - Make evidence indicator clickable
// - Show/hide evidence list based on expanded state
// - Add evidence list HTML when expanded
```

### Update to `renderEventCard` function

The existing `renderEventCard` function should be modified to support expansion:

```javascript
function renderEventCard(event) {
  const config = getEventCardConfig(event.type);
  if (!config) return '...'; // existing fallback
  
  const summary = config.getSummary(event);
  const hasEvidence = event.evidence_ids.length > 0;
  const isExpanded = state.expandedEvents.has(event.event_id);
  const isApproval = event.type === 'approval_requested';
  const isFailure = event.type.includes('fail') || event.type === 'failure_detected';
  
  let evidenceHTML = '';
  if (hasEvidence) {
    evidenceHTML = \`
      <div class="event-evidence" onclick="toggleEventEvidence('\${event.event_id}')">
        📎 \${event.evidence_ids.length} evidence item(s) \${isExpanded ? '▼' : '▶'}
      </div>
    \`;
    if (isExpanded) {
      evidenceHTML += \`<div class="evidence-list">\${renderEvidenceListForEvent(event)}</div>\`;
    }
  }
  
  return \`
    <div class="event-card \${isExpanded ? 'expanded' : ''} \${isApproval ? 'approval-required' : ''} \${isFailure ? 'failure' : ''}" data-event-id="\${event.event_id}">
      <div class="event-card-header">
        <span class="event-icon" style="color: \${config.color}">\${config.icon}</span>
        <span class="event-type">\${config.title}</span>
        <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
      </div>
      <div class="event-summary">\${escapeHtml(summary)}</div>
      \${evidenceHTML}
    </div>
  \`;
}
```

### Demo Evidence Setup

Add to demo flow (in sendBtn click handler):

```javascript
// After tool_end event, add evidence
setTimeout(() => {
  const lastEvent = state.events[state.events.length - 1];
  const evidenceId = generateId();
  
  // Create demo evidence
  state.evidence[evidenceId] = {
    evidence_id: evidenceId,
    type: 'diff',
    source_event_id: lastEvent.event_id,
    content_ref: '.Ordinex/evidence/\${evidenceId}.txt',
    summary: 'File modifications: demo.txt',
    created_at: new Date().toISOString()
  };
  
  // Attach to event
  lastEvent.evidence_ids.push(evidenceId);
  renderMission();
}, 2600);
```

## Testing Checklist

- [ ] Event cards with evidence show indicator
- [ ] Clicking indicator expands/collapses evidence list
- [ ] Evidence items display correct type, summary, timestamp
- [ ] "Open" button opens evidence viewer modal
- [ ] Evidence viewer shows loading state initially
- [ ] Evidence content renders with correct formatting
- [ ] "Copy Summary" copies evidence summary to clipboard
- [ ] "Copy Content" copies full evidence content
- [ ] "Toggle Wrap" switches line wrapping on/off
- [ ] Close button/overlay click closes viewer
- [ ] Multiple evidence items sort by created_at ascending

## Extension Integration (Future)

For file-backed evidence content:

```typescript
// In packages/extension/src/extension.ts
webviewPanel.webview.onDidReceiveMessage(
  async (message) => {
    if (message.type === 'getEvidenceContent') {
      const evidenceId = message.evidenceId;
      const evidence = evidenceStore[evidenceId];
      
      if (evidence) {
        const content = await fs.readFile(evidence.content_ref, 'utf-8');
        webviewPanel.webview.postMessage({
          type: 'evidenceContent',
          evidenceId,
          content
        });
      }
    }
  }
);
```

## Status

✅ Evidence types defined
✅ EvidenceList component created  
✅ EvidenceViewer component created
✅ CSS styling completed
✅ State management structure added
⏳ JavaScript functionality (documented above, needs integration)
⏳ Demo evidence setup
⏳ Testing

## Next Steps

1. Integrate the JavaScript functions from this document into packages/webview/src/index.ts
2. Test expand/collapse behavior with demo evidence
3. Verify evidence viewer modal functionality
4. Add demo evidence to existing demo flow
5. Test all evidence types (diff, log, file, test, error)
6. Document usage in README

The UI and component structure is complete. The remaining work is to integrate the JavaScript functionality documented above into the main webview script.
