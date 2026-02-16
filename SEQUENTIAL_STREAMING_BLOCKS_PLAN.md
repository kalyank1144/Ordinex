# Sequential Streaming Blocks — Implementation Plan

## Overview

Replace the current "one big Live card" with a clean, sequential feed where narration
appears as paragraph blocks and tool calls appear as their own compact blocks. Tool blocks
update in-place (running -> done/error) without re-rendering the whole Mission UI.

## Commit Map

| Commit | Scope | Files |
|--------|-------|-------|
| 1 | State model + messageHandler conversion (blocks) + markdown throttling | state.ts, messageHandler.ts |
| 2 | Renderer update (sequential block UI) + smart autoscroll behavior | renderers.ts, messageHandler.ts |
| 3 | Loop paused / continue limit UX polish | renderers.ts (loop_paused inline renderer) |
| 4 | Tool correlation IDs + Mermaid fallback + View Logs link fix | missionHandler.ts, renderers.ts |

---

## Commit 1: State Model + Message Handler Conversion

### Files: `packages/webview/src/webviewJs/state.ts`, `packages/webview/src/webviewJs/messageHandler.ts`

### 1A. Update state.ts — New StreamingMission shape

**Current** (`state.streamingMission` when not null):
```js
{
  taskId: string,
  stepId: string,
  iteration: number,
  text: string,       // one big accumulated string
  toolCalls: []       // flat list of {tool, input, status, error?}
}
```

**New**:
```js
{
  taskId: string,
  stepId: string,
  iteration: number,
  blocks: [],               // StreamingBlock[] — sequential blocks
  activeNarrationId: null,  // string|null — for incremental append
}
```

Where each block in `blocks` is one of:
```js
// Narration block (LLM text)
{ id: string, kind: 'narration', text: string, ts: number }

// Tool block (file operation)
{ id: string, kind: 'tool', tool: string, input: object, status: 'running'|'done'|'error', error: string|null, ts: number }
```

**Why no `continuesUsed`/`maxContinues`/`stagedFiles`/`summary` here?**
- These are properties of the *loop_paused event payload*, not the streaming state.
- The streaming card disappears when the loop pauses. The LoopPausedCard renders from the event payload.
- Mixing them creates split-brain state. Keep them separate.

### 1B. Add block helper functions in messageHandler.ts

Add at the top of the message handler module (before the switch statement):

```js
var _blockCounter = 0;
function newBlockId(prefix) {
  // Monotonic in-tab ID; deterministic + cheap for high-frequency streaming
  return prefix + '_' + (++_blockCounter);
}

function ensureStreamingMission(message) {
  if (!state.streamingMission) {
    state.streamingMission = {
      taskId: message.task_id || 'unknown',
      stepId: message.step_id || '',
      iteration: message.iteration || 1,
      blocks: [],
      activeNarrationId: null
    };
  }
}

function appendNarration(delta) {
  var sm = state.streamingMission;
  if (!sm) return;
  if (!sm.activeNarrationId) {
    // Start a new narration block
    var block = { id: newBlockId('nar'), kind: 'narration', text: '', ts: Date.now() };
    sm.blocks.push(block);
    sm.activeNarrationId = block.id;
  }
  // Find the active block and append
  for (var i = sm.blocks.length - 1; i >= 0; i--) {
    if (sm.blocks[i].id === sm.activeNarrationId) {
      sm.blocks[i].text += delta;
      break;
    }
  }
}

function closeNarration() {
  if (state.streamingMission) {
    state.streamingMission.activeNarrationId = null;
  }
}

function getBlockText(sm, blockId) {
  for (var i = sm.blocks.length - 1; i >= 0; i--) {
    if (sm.blocks[i].id === blockId) return sm.blocks[i].text;
  }
  return '';
}

function shouldReparseMarkdown(nextText) {
  // Parse less frequently while keeping UI feeling live.
  // Reparse on size jumps, paragraph/code boundaries, or every Nth delta.
  state._missionDeltaCount = (state._missionDeltaCount || 0) + 1;
  if (!state._missionLastParsedText) return true;
  if (nextText.length - state._missionLastParsedText.length >= 60) return true;
  if (/\n\n|\n```|```/.test(nextText.slice(-8))) return true;
  return (state._missionDeltaCount % 4) === 0;
}

function getNarrationHtmlForStreaming(sm, blockId) {
  var txt = getBlockText(sm, blockId);
  if (shouldReparseMarkdown(txt)) {
    state._missionLastParsedText = txt;
    state._missionLastParsedHtml = simpleMarkdown(txt);
  }
  return (state._missionLastParsedHtml || simpleMarkdown(txt));
}
```

### 1C. Update `ordinex:missionStreamDelta` handler

**Current**: Accumulates into `state.streamingMission.text` + direct DOM update to `.streaming-mission-content`.

**New**:
```js
case 'ordinex:missionStreamDelta':
  ensureStreamingMission(message);
  state.streamingMission.iteration = message.iteration || state.streamingMission.iteration;
  appendNarration(message.delta);

  // RAF-throttled render (no full renderMission per token)
  if (!state._missionRafPending) {
    state._missionRafPending = true;
    requestAnimationFrame(function() {
      state._missionRafPending = false;
      // Try targeted DOM update first
      var container = missionTab.querySelector('.streaming-blocks-container');
      if (container && state.streamingMission) {
        updateLastNarrationBlock(container, state.streamingMission);
      } else {
        renderMission();
      }
    });
  }
  break;
```

The `updateLastNarrationBlock` function does a targeted innerHTML update on only the last narration block div, not the entire card, and uses markdown throttling.

```js
function updateLastNarrationBlock(container, sm) {
  if (!sm.activeNarrationId) return;
  var el = container.querySelector('[data-block-id="' + sm.activeNarrationId + '"]');
  if (el) {
    el.innerHTML = getNarrationHtmlForStreaming(sm, sm.activeNarrationId)
      + '<span style="display:inline-block;width:2px;height:16px;background:var(--vscode-charts-orange);margin-left:2px;animation:blink 1s steps(2,start) infinite;vertical-align:text-bottom;"></span>';
  } else {
    renderMission();  // block element not found, full re-render
  }
}
```

### 1D. Update `ordinex:missionToolActivity` handler

**Current**: Pushes into `toolCalls[]` + direct DOM update to `.streaming-tool-activity`.

**New**:
```js
case 'ordinex:missionToolActivity':
  ensureStreamingMission(message);
  var sm = state.streamingMission;
  if (message.event_type === 'tool_start') {
    closeNarration();  // Tool appears AFTER the narration that triggered it
    sm.blocks.push({
      id: newBlockId('tool'),
      kind: 'tool',
      toolCallId: message.tool_call_id || null,   // stable correlation key
      tool: message.tool,
      input: message.input || {},
      status: 'running',
      error: null,
      ts: Date.now()
    });
    // Schedule render for new block
    scheduleBlockRender();
  } else if (message.event_type === 'tool_end') {
    var matched = null;

    // Preferred: exact match via tool_call_id from backend
    if (message.tool_call_id) {
      for (var i = sm.blocks.length - 1; i >= 0; i--) {
        if (sm.blocks[i].kind === 'tool' &&
            sm.blocks[i].toolCallId === message.tool_call_id &&
            sm.blocks[i].status === 'running') {
          matched = sm.blocks[i];
          break;
        }
      }
    }

    // Backward-compat fallback (only if ID missing)
    if (!matched) {
      for (var j = sm.blocks.length - 1; j >= 0; j--) {
        if (sm.blocks[j].kind === 'tool' && sm.blocks[j].tool === message.tool && sm.blocks[j].status === 'running') {
          matched = sm.blocks[j];
          break;
        }
      }
    }

    if (matched) {
      matched.status = message.success ? 'done' : 'error';
      if (message.error) matched.error = message.error;
      var toolEl = missionTab.querySelector('[data-block-id="' + matched.id + '"]');
      if (toolEl) toolEl.outerHTML = renderToolBlock(matched);
      else scheduleBlockRender();
    } else {
      // Out-of-order or missing start event; fallback to full render to self-heal
      scheduleBlockRender();
    }
  }
  break;
```

Where `scheduleBlockRender()` is a RAF-throttled render:
```js
function scheduleBlockRender() {
  if (!state._missionRafPending) {
    state._missionRafPending = true;
    requestAnimationFrame(function() {
      state._missionRafPending = false;
      renderMission();
    });
  }
}
```

### 1E. Update `ordinex:missionStreamComplete` handler

No structural change needed, just clear the new state shape:
```js
case 'ordinex:missionStreamComplete':
  if (state.streamingMission) {
    state.streamingMission = null;
  }
  renderMission();
  break;
```

### 1F. Update auto-clear on eventsUpdate

No change needed — already nulls `state.streamingMission` on loop_paused/loop_completed events.

### 1G. Add streaming perf/autoscroll state initialization

Add to state.ts:
```js
_missionRafPending: false,
_missionDeltaCount: 0,
_missionLastParsedText: '',
_missionLastParsedHtml: '',
_missionUserPinnedScroll: false,
```

Reset these fields when mission stream ends:
```js
state._missionDeltaCount = 0;
state._missionLastParsedText = '';
state._missionLastParsedHtml = '';
```

### 1H. (Implementation-required) Forward stable tool correlation ID from extension

**File**: `packages/extension/src/handlers/missionHandler.ts`

Update the `ordinex:missionToolActivity` forwarding block to include `tool_call_id`:
```ts
webview.postMessage({
  type: 'ordinex:missionToolActivity',
  tool,
  event_type: event.type,
  tool_call_id: event.payload?.tool_use_id || event.parent_event_id || null,
  input: event.payload.input || {},
  success: event.type === 'tool_end' ? event.payload.status === 'success' : undefined,
  error: event.type === 'tool_end' ? (event.payload.error || undefined) : undefined,
});
```

---

## Commit 2: Renderer Update (Sequential Block UI)

### File: `packages/webview/src/webviewJs/renderers.ts`

### 2A. Replace `renderStreamingMissionCard()` with `renderStreamingBlocksCard()`

**Current**: One big card with streamed text + "File Operations" list at bottom.

**New**: Minimal card header + sequential blocks body.

```js
function renderStreamingBlocksCard() {
  var sm = state.streamingMission;
  if (!sm || sm.blocks.length === 0) return '';

  var stepLabel = sm.stepId ? ' (Step: ' + escapeHtml(sm.stepId) + ')' : '';
  var iterLabel = sm.iteration ? ' Iter ' + sm.iteration : '';

  var blocksHtml = sm.blocks.map(function(block) {
    if (block.kind === 'narration') {
      return renderNarrationBlock(block, block.id === sm.activeNarrationId);
    } else if (block.kind === 'tool') {
      return renderToolBlock(block);
    }
    return '';
  }).join('');

  return '<div class="event-card" style="border-left-color: var(--vscode-charts-orange);">'
    + '<div class="event-card-header">'
    +   '<span class="event-icon" style="color: var(--vscode-charts-orange);">&#9881;&#65039;</span>'
    +   '<span class="event-type">Edit Step' + stepLabel + iterLabel + '</span>'
    +   '<span class="event-timestamp">&#9889; Live</span>'
    + '</div>'
    + '<div class="streaming-blocks-container" style="padding: 8px 16px 8px 24px; max-height: 500px; overflow-y: auto;">'
    +   blocksHtml
    + '</div>'
    + '</div>';
}
```

### 2B. Add `renderNarrationBlock(block, isActive)`

```js
function renderNarrationBlock(block, isActive) {
  var cursor = isActive
    ? '<span style="display:inline-block;width:2px;height:14px;background:var(--vscode-charts-orange);margin-left:2px;animation:blink 1s steps(2,start) infinite;vertical-align:text-bottom;"></span>'
    : '';
  return '<div data-block-id="' + block.id + '" class="stream-narration-block" style="'
    + 'font-size:13px;line-height:1.6;color:var(--vscode-foreground);'
    + 'padding:4px 0;word-break:break-word;'
    + '">' + simpleMarkdown(block.text) + cursor + '</div>';
}
```

### 2C. Add `renderToolBlock(block)`

Compact row with icon + tool name + file path + status pill.

```js
function renderToolBlock(block) {
  var TOOL_ICONS = {
    read_file: '\ud83d\udcd6',     // book
    write_file: '\ud83d\udcdd',    // memo
    edit_file: '\u270f\ufe0f',     // pencil
    search_files: '\ud83d\udd0d',  // magnifier
    list_directory: '\ud83d\udcc2',// folder
    run_command: '\u25b6\ufe0f'    // play
  };

  var statusStyles = {
    running: 'background:var(--vscode-charts-orange);color:#fff;',
    done:    'background:var(--vscode-charts-green);color:#fff;',
    error:   'background:var(--vscode-charts-red);color:#fff;'
  };

  var statusLabels = { running: 'running', done: 'done', error: 'failed' };
  var icon = TOOL_ICONS[block.tool] || '\ud83d\udd27';
  var statusStyle = statusStyles[block.status] || statusStyles.running;
  var statusLabel = statusLabels[block.status] || block.status;

  // Extract display label from input
  var filePath = (block.input && (block.input.path || block.input.file_path || '')) || '';
  var displayLabel = '';
  if (filePath) {
    displayLabel = filePath;
  } else if (block.tool === 'run_command' && block.input && block.input.command) {
    displayLabel = String(block.input.command).substring(0, 60);
  } else if (block.tool === 'search_files' && block.input && block.input.pattern) {
    displayLabel = 'pattern: ' + String(block.input.pattern).substring(0, 40);
  } else {
    displayLabel = block.tool.replace(/_/g, ' ');
  }

  var errorHtml = (block.status === 'error' && block.error)
    ? '<div style="color:var(--vscode-charts-red);font-size:11px;padding:2px 0 0 26px;word-break:break-word;">'
      + escapeHtml(String(block.error).substring(0, 200)) + '</div>'
    : '';

  return '<div data-block-id="' + block.id + '" class="stream-tool-block" style="'
    + 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;'
    + 'padding:4px 0;margin:2px 0;font-size:12px;'
    + 'border-left:2px solid var(--vscode-widget-border);padding-left:8px;'
    + '">'
    +   '<span style="flex-shrink:0;">' + icon + '</span>'
    +   '<span style="color:var(--vscode-foreground);opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px;">'
    +     escapeHtml(displayLabel) + '</span>'
    +   '<span style="' + statusStyle + 'font-size:10px;padding:1px 6px;border-radius:8px;margin-left:auto;flex-shrink:0;">'
    +     statusLabel + '</span>'
    + '</div>'
    + errorHtml;
}
```

### 2D. Update the streaming card insertion point in `renderMissionTimeline()`

**Current** (lines ~1155-1162):
```js
if (state.streamingMission && state.streamingMission.text) {
  items.push(`<div class="assistant-bubble">...renderStreamingMissionCard()...</div>`);
}
```

**New**:
```js
if (state.streamingMission && state.streamingMission.blocks && state.streamingMission.blocks.length > 0) {
  items.push('<div class="assistant-bubble">'
    + '<div class="assistant-bubble-avatar">\u2726</div>'
    + '<div class="assistant-bubble-content">' + renderStreamingBlocksCard() + '</div>'
    + '</div>');
}
```

### 2E. Smart autoscroll for streaming blocks (only if user is near bottom)

**File**: `packages/webview/src/webviewJs/messageHandler.ts`

Add helpers:
```js
function isNearBottom(el, thresholdPx) {
  if (!el) return true;
  return (el.scrollHeight - el.scrollTop - el.clientHeight) <= thresholdPx;
}

function preserveStreamingScrollIntent(container, updateFn) {
  if (!container) return updateFn();
  var shouldAutoStick = isNearBottom(container, 24) && !state._missionUserPinnedScroll;
  updateFn();
  if (shouldAutoStick) container.scrollTop = container.scrollHeight;
}
```

Wrap targeted narration/tool DOM updates with `preserveStreamingScrollIntent(...)` so new blocks auto-follow only when user hasn't intentionally scrolled upward.

Also add a one-time scroll listener when the card first renders:
```js
function attachStreamingScrollListener(container) {
  if (!container || container.dataset.scrollBound === '1') return;
  container.dataset.scrollBound = '1';
  container.addEventListener('scroll', function() {
    state._missionUserPinnedScroll = !isNearBottom(container, 24);
  });
}
```

### 2F. Remove old functions

- Remove `renderStreamingMissionCard()` (replaced by `renderStreamingBlocksCard()`)
- Remove `renderToolActivityHtml()` (replaced by `renderToolBlock()`)

### 2G. Keep old functions as reference (optional)

If paranoid about breakage, rename to `_old_renderStreamingMissionCard` with a `// DEPRECATED` comment and remove after verification.

---

## Commit 3: Loop Paused / Continue Limit UX Polish

### File: `packages/webview/src/webviewJs/renderers.ts`

### 3A. Enhance the inline `renderLoopPausedInline()` function

The current LoopPausedCard already shows Continue/Approve/Discard. What's missing:

1. **After 3 continues (canContinue=false):**
   - Hide the Continue button
   - Show advisory text: "This task may be too large. Consider breaking it into smaller steps."
   - Rename "Approve" to "Approve Partial"
   - Add warning text under Approve Partial: "These changes are incomplete and may not compile."

2. **Show `remainingContinues` on Continue button:**
   - Already have `remaining_continues` in payload
   - Change label: "Continue (2 remaining)" instead of just "Continue"

### 3B. Specific changes to `renderLoopPausedInline()`

Find the action buttons section and modify:

```js
// Continue button — only show if canContinue
var continueBtn = '';
if (canContinue) {
  continueBtn = '<button onclick="handleLoopAction(\'continue_loop\', \'' + stepId + '\', \'' + sessionId + '\')" '
    + 'style="padding:8px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;">'
    + 'Continue (' + remainingContinues + ' remaining)</button>';
}

// Approve button — label changes based on canContinue
var approveLabel = canContinue ? 'Approve ' + stagedFiles.length + ' file(s)' : 'Approve Partial';
var approveBtn = stagedFiles.length > 0
  ? '<button onclick="handleLoopAction(\'approve_partial\', \'' + stepId + '\', \'' + sessionId + '\')" '
    + 'style="padding:8px 16px;background:var(--vscode-charts-green);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">'
    + approveLabel + '</button>'
  : '';

// Warning text when max continues reached
var warningHtml = '';
if (!canContinue) {
  warningHtml = '<div style="margin-top:8px;padding:8px 12px;background:var(--vscode-inputValidation-warningBackground, rgba(255,204,0,0.1));border:1px solid var(--vscode-charts-yellow);border-radius:4px;font-size:12px;color:var(--vscode-foreground);">'
    + '<strong>Continue limit reached.</strong> This task may be too large. Consider breaking it into smaller steps.'
    + (stagedFiles.length > 0 ? '<br>These changes are incomplete and may not compile.' : '')
    + '</div>';
}

// Discard button
var discardBtn = '<button onclick="handleLoopAction(\'discard_loop\', \'' + stepId + '\', \'' + sessionId + '\')" '
  + 'style="padding:8px 16px;background:transparent;color:var(--vscode-charts-red);border:1px solid var(--vscode-charts-red);border-radius:4px;cursor:pointer;font-size:13px;">'
  + 'Discard</button>';

// Build buttons row
var buttonsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">'
  + continueBtn + approveBtn + discardBtn + '</div>' + warningHtml;
```

### 3C. No core changes needed

- `canContinue`, `remainingContinues`, `max_continues` are already in the loop_paused payload
- Backend already enforces max_continues=3 in `continueLoop()`
- No changes to missionExecutor.ts or loopSessionState.ts

---

## Commit 4: Mermaid Fence Fallback + View Logs Link

### File: `packages/webview/src/webviewJs/renderers.ts`

### 4A. Mermaid code block detection in `simpleMarkdown()`

**Current behavior**: Code blocks with language labels render as `<pre>` with a plain label.

**Change**: When language is `mermaid`, add a distinctive label and slightly different styling.

Find the code block rendering section and add a special case:

```js
// Inside the code block close logic (when we encounter closing ```)
if (codeBlockLang === 'mermaid') {
  // Render with special mermaid label
  var langLabel = '<div style="font-size:10px;color:var(--vscode-charts-purple);padding:2px 8px;font-weight:600;">Diagram (Mermaid)</div>';
  result += langLabel + '<pre style="background:var(--vscode-textCodeBlock-background);padding:8px 12px;border-radius:4px;overflow-x:auto;font-size:12px;font-family:var(--vscode-editor-font-family);border:1px solid var(--vscode-charts-purple);margin:4px 0;">'
    + codeContent + '</pre>';
} else {
  // Existing code block rendering (unchanged)
  ...
}
```

This is the minimal fallback. If/when we add mermaid.js later, this block becomes the target for upgrade.

### 4B. "View in Logs" link on LoopPausedCard

Add a small text link at the bottom of the loop paused card:

```js
var viewLogsLink = '<div style="margin-top:8px;text-align:right;">'
  + '<a href="#" onclick="switchTab(\'logs\'); return false;" style="font-size:11px;color:var(--vscode-textLink-foreground);text-decoration:none;">View details in Logs &rarr;</a>'
  + '</div>';
```

**Prerequisite**: Tab switch helper is `switchTab(tabName)` in `utils.ts`; call that exact function.

---

## What's NOT in This Plan (And Why)

### Step 8: Milestone-by-Milestone Execution — DEFERRED

**Reason**: This requires significant changes to `missionExecutor.ts`'s `executeStepsSequentially()`:
- New milestone boundary detection (group steps)
- New event type: `milestone_completed`
- New UI card: MilestoneCompletedCard with "Continue to next milestone" button
- New pause/resume flow at milestone boundaries
- Changes to plan schema (milestone grouping)

**Current alternative**: Ordinex already has `largePlanDetector.ts` + `missionBreakdownGenerator.ts` that auto-split large plans into bounded missions. This is a better architectural fit than modifying the step-by-step loop.

**Recommendation**: After this PR lands, evaluate whether the existing mission breakdown system provides enough granularity. If not, implement milestone boundaries as a separate effort.

### Restore Button — DEFERRED

**Reason**: No pre-loop checkpoint exists today. Adding it requires:
1. `missionExecutor.ts`: Create checkpoint BEFORE `executeEditStepWithLoop()` starts
2. Store `checkpoint_id` in LoopSession
3. Include `checkpoint_id` in loop_paused payload
4. New `restore_checkpoint` action in extension.ts handleLoopAction
5. Call `VSCodeCheckpointManager.rollback(checkpointId)`

**Effort**: ~2-3 hours, touches core. Better as a follow-up PR.

### Per-File Approval — NOT PLANNED

Batch approval at loop end is the right default for Ordinex's trust model. Checkpoint + undo + crash recovery already support safety. Add per-file approval only if users demand it.

---

## Verification Checklist

After implementing all 4 commits:

### Streaming Blocks
- [ ] Start a mission edit step that reads/searches/edits files
- [ ] UI shows sequential blocks: narration -> tool -> narration -> tool
- [ ] Tool blocks update status in-place (running -> done/error) without flicker
- [ ] Streaming feels smooth (RAF throttling, no jank)
- [ ] Large streaming output scrolls within the card (max-height)
- [ ] `tool_end` matches exact tool block via `tool_call_id` (fallback works for older payloads)
- [ ] Out-of-order tool events do not mislabel unrelated tool blocks

### Loop Paused / Continue Limit
- [ ] On first pause: Continue button shows "(3 remaining)"
- [ ] After Continue: button shows "(2 remaining)", then "(1 remaining)"
- [ ] After 3 continues: Continue button hidden
- [ ] "Continue limit reached" warning shown
- [ ] Approve button becomes "Approve Partial" with warning text
- [ ] Approve still works (opens VS Code diffs, applies changes)
- [ ] Discard still works (clears staged changes)

### Mermaid Fallback
- [ ] Code block with ` ```mermaid ` renders with purple "Diagram (Mermaid)" label
- [ ] Content shown as preformatted text (readable)

### Streaming Perf / Scroll UX
- [ ] Markdown parsing is throttled/coalesced during fast deltas (no visual stutter)
- [ ] While user is at bottom, stream auto-scrolls to newest content
- [ ] After user scrolls up, stream does NOT yank scroll position until user returns to bottom

### No Regressions
- [ ] Logs tab still shows all events (unchanged)
- [ ] Systems tab still shows counters (unchanged)
- [ ] Existing event rendering (plan cards, diff cards, approvals) unchanged
- [ ] All 1846 tests pass
- [ ] All 3 packages build clean

---

## File Impact Summary

| File | Changes |
|------|---------|
| `packages/webview/src/webviewJs/state.ts` | Add streaming RAF/markdown/scroll state flags |
| `packages/webview/src/webviewJs/messageHandler.ts` | Block helpers, rewrite 3 handlers, markdown throttling, smart autoscroll |
| `packages/webview/src/webviewJs/renderers.ts` | New block renderers, replace streaming card, loop paused polish, mermaid fallback + logs link fix |
| `packages/extension/src/handlers/missionHandler.ts` | Forward `tool_call_id` for robust tool start/end correlation |
| **Total files touched** | **4 files (3 webview + 1 extension)** |
| **No core changes** | missionExecutor, loopSessionState, agenticLoop — unchanged |
| **Extension changes** | missionHandler only (no core logic changes) |
