export function getWebviewContent(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ordinex Mission Control</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }

    /* ===== HEADER BAR ===== */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      flex-shrink: 0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-pill.ready {
      background: var(--vscode-charts-blue);
      color: #fff;
    }

    .status-pill.running {
      background: var(--vscode-charts-green);
      color: #fff;
    }

    .status-pill.paused {
      background: var(--vscode-charts-orange);
      color: #fff;
    }

    .status-pill.awaiting_approval {
      background: var(--vscode-charts-yellow);
      color: #000;
    }

    .status-pill.error {
      background: var(--vscode-errorForeground);
      color: #fff;
    }

    .stage-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    /* ===== TAB BAR ===== */
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      flex-shrink: 0;
    }

    .tab {
      flex: 1;
      padding: 8px 12px;
      text-align: center;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground);
      transition: all 0.15s ease;
    }

    .tab:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-foreground);
    }

    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder);
      background: var(--vscode-editor-background);
    }

    /* ===== CONTENT AREA ===== */
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ===== MISSION TAB ===== */
    .mission-empty {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      padding: 40px 20px;
      font-size: 13px;
    }

    .narration-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      animation: fadeIn 0.2s ease-in;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .narration-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .narration-card-type {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 7px;
      border-radius: 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }

    .narration-card-type.intent { background: var(--vscode-charts-blue); color: #fff; }
    .narration-card-type.plan { background: var(--vscode-charts-purple); color: #fff; }
    .narration-card-type.evidence { background: var(--vscode-charts-green); color: #fff; }
    .narration-card-type.tool_run { background: var(--vscode-charts-orange); color: #fff; }
    .narration-card-type.diff_proposed { background: var(--vscode-charts-yellow); color: #000; }
    .narration-card-type.approval { background: var(--vscode-charts-red); color: #fff; }
    .narration-card-type.result { background: var(--vscode-charts-green); color: #fff; }

    .narration-card-timestamp {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }

    .narration-card-title {
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 12px;
    }

    .narration-card-content {
      font-size: 12px;
      line-height: 1.5;
      color: var(--vscode-foreground);
      white-space: pre-wrap;
    }

    .narration-card-status {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      font-weight: 600;
    }

    .narration-card-status.pending { color: var(--vscode-charts-yellow); }
    .narration-card-status.approved { color: var(--vscode-charts-green); }
    .narration-card-status.rejected { color: var(--vscode-charts-red); }
    .narration-card-status.complete { color: var(--vscode-charts-blue); }

    /* ===== SYSTEMS TAB ===== */
    .systems-section {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
    }

    .systems-section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 10px;
    }

    .systems-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .systems-row:last-child {
      border-bottom: none;
    }

    .systems-label {
      color: var(--vscode-descriptionForeground);
    }

    .systems-value {
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .systems-counters {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .counter-box {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px 10px;
      text-align: center;
    }

    .counter-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 4px;
    }

    .counter-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--vscode-foreground);
    }

    .scope-expansion-request {
      background: var(--vscode-editor-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 6px;
      padding: 12px;
    }

    .scope-expansion-header {
      font-weight: 700;
      font-size: 12px;
      margin-bottom: 8px;
      color: var(--vscode-editor-warningForeground);
    }

    .scope-expansion-reason {
      font-size: 12px;
      margin-bottom: 10px;
      line-height: 1.4;
    }

    .scope-expansion-actions {
      display: flex;
      gap: 8px;
    }

    /* ===== LOGS TAB ===== */
    .event-log-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .event-log-item {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px 10px;
      cursor: pointer;
      transition: background 0.1s ease;
      font-size: 11px;
    }

    .event-log-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .event-log-item.selected {
      background: var(--vscode-list-activeSelectionBackground);
      border-color: var(--vscode-focusBorder);
    }

    .event-log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .event-log-type {
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .event-log-timestamp {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }

    .event-log-summary {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.3;
    }

    .event-log-details {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .event-log-details-row {
      margin: 4px 0;
    }

    /* ===== COMPOSER BAR ===== */
    .composer {
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      padding: 10px 12px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .composer-controls {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 11px;
    }

    .composer-controls label {
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
      margin-right: 4px;
    }

    .composer-controls select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      padding: 3px 6px;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
    }

    .composer-controls select:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    .composer-input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }

    .composer-input-row textarea {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 6px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-family: inherit;
      resize: none;
      min-height: 40px;
      max-height: 120px;
      line-height: 1.4;
    }

    .composer-input-row textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    .composer-input-row textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .composer-buttons {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.1s ease;
    }

    button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    button.secondary:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    button.danger {
      background: var(--vscode-inputValidation-errorBackground);
      color: #fff;
    }

    button.approve {
      background: var(--vscode-charts-green);
      color: #fff;
    }

    button.reject {
      background: var(--vscode-charts-red);
      color: #fff;
    }

    /* ===== SCROLLBAR ===== */
    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: var(--vscode-scrollbarSlider-background);
    }

    ::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-hoverBackground);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-activeBackground);
    }

    /* ===== RESPONSIVE ===== */
    @media (max-width: 350px) {
      .composer-controls {
        flex-direction: column;
        align-items: stretch;
      }
      
      .systems-counters {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <!-- Header Bar -->
  <div class="header">
    <div class="header-left">
      <div class="header-title">Ordinex Mission Control</div>
      <div class="status-pill ready" id="statusPill">Ready</div>
    </div>
    <div class="stage-label" id="stageLabel">none</div>
  </div>

  <!-- Tab Bar -->
  <div class="tab-bar">
    <div class="tab active" data-tab="mission">Mission</div>
    <div class="tab" data-tab="systems">Systems</div>
    <div class="tab" data-tab="logs">Logs</div>
  </div>

  <!-- Content Area -->
  <div class="content">
    <!-- Mission Tab -->
    <div class="tab-content active" id="missionTab">
      <div class="mission-empty">No mission yet. Start a conversation to begin.</div>
    </div>

    <!-- Systems Tab -->
    <div class="tab-content" id="systemsTab">
      <!-- Scope Contract -->
      <div class="systems-section">
        <div class="systems-section-title">Scope Contract</div>
        <div class="systems-row">
          <span class="systems-label">Max Files:</span>
          <span class="systems-value" id="maxFiles">10</span>
        </div>
        <div class="systems-row">
          <span class="systems-label">Max Lines:</span>
          <span class="systems-value" id="maxLines">1000</span>
        </div>
        <div class="systems-row">
          <span class="systems-label">Allowed Tools:</span>
          <span class="systems-value" id="allowedTools">read, write, exec</span>
        </div>
        <div class="systems-row">
          <span class="systems-label">Max Iterations:</span>
          <span class="systems-value" id="maxIterations">10</span>
        </div>
        <div class="systems-row">
          <span class="systems-label">Max Tool Calls:</span>
          <span class="systems-value" id="maxToolCalls">100</span>
        </div>
      </div>

      <!-- Live Counters -->
      <div class="systems-section">
        <div class="systems-section-title">Live Counters</div>
        <div class="systems-counters">
          <div class="counter-box">
            <div class="counter-label">Files In Scope</div>
            <div class="counter-value" id="filesInScope">0</div>
          </div>
          <div class="counter-box">
            <div class="counter-label">Files Touched</div>
            <div class="counter-value" id="filesTouched">0</div>
          </div>
          <div class="counter-box">
            <div class="counter-label">Lines Included</div>
            <div class="counter-value" id="linesIncluded">0</div>
          </div>
          <div class="counter-box">
            <div class="counter-label">Tool Calls</div>
            <div class="counter-value" id="toolCalls">0/100</div>
          </div>
        </div>
      </div>

      <!-- Checkpoint Status -->
      <div class="systems-section">
        <div class="systems-section-title">Checkpoint Status</div>
        <div class="systems-row">
          <span class="systems-label">Latest Checkpoint:</span>
          <span class="systems-value" id="checkpointId">None</span>
        </div>
        <div class="systems-row">
          <span class="systems-label">Event Count:</span>
          <span class="systems-value" id="checkpointEvents">0</span>
        </div>
      </div>

      <!-- Scope Expansion Request (hidden by default) -->
      <div class="scope-expansion-request" id="scopeExpansionRequest" style="display: none;">
        <div class="scope-expansion-header">⚠️ Scope Expansion Requested</div>
        <div class="scope-expansion-reason" id="expansionReason">Reason goes here...</div>
        <div class="scope-expansion-actions">
          <button class="approve" onclick="handleScopeApproval(true)">Approve</button>
          <button class="reject" onclick="handleScopeApproval(false)">Reject</button>
        </div>
      </div>
    </div>

    <!-- Logs Tab -->
    <div class="tab-content" id="logsTab">
      <div class="event-log-list" id="eventLogList">
        <div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 20px;">
          No events yet.
        </div>
      </div>
    </div>
  </div>

  <!-- Composer Bar -->
  <div class="composer">
    <div class="composer-controls">
      <label>Mode:</label>
      <select id="modeSelect">
        <option value="ANSWER">ANSWER</option>
        <option value="PLAN">PLAN</option>
        <option value="MISSION">MISSION</option>
      </select>
      <label>Model:</label>
      <select id="modelSelect">
        <option value="sonnet-4.5">Sonnet 4.5</option>
        <option value="opus-4.5">Opus 4.5</option>
        <option value="gpt-5.2">GPT-5.2</option>
        <option value="gemini-3">Gemini 3</option>
      </select>
    </div>
    <div class="composer-input-row">
      <textarea id="promptInput" placeholder="Enter your prompt..." rows="2"></textarea>
      <div class="composer-buttons">
        <button id="sendBtn">Send</button>
        <button id="stopBtn" class="secondary" disabled>Stop</button>
        <button id="clearBtn" class="danger">Clear</button>
      </div>
    </div>
  </div>

  <script>
    (function() {
      // State
      const state = {
        activeTab: 'mission',
        taskStatus: 'ready',
        currentStage: 'none',
        currentMode: 'ANSWER',
        narrationCards: [],
        scopeSummary: {
          contract: {
            max_files: 10,
            max_lines: 1000,
            allowed_tools: ['read', 'write', 'exec'],
            budgets: {
              max_iterations: 10,
              max_tool_calls: 100,
              max_time_ms: 300000
            }
          },
          in_scope_files: [],
          touched_files: [],
          lines_retrieved: 0,
          tools_used: []
        },
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
      };

      // DOM Elements
      const statusPill = document.getElementById('statusPill');
      const stageLabel = document.getElementById('stageLabel');
      const tabs = document.querySelectorAll('.tab');
      const tabContents = document.querySelectorAll('.tab-content');
      const missionTab = document.getElementById('missionTab');
      const eventLogList = document.getElementById('eventLogList');
      const promptInput = document.getElementById('promptInput');
      const sendBtn = document.getElementById('sendBtn');
      const stopBtn = document.getElementById('stopBtn');
      const clearBtn = document.getElementById('clearBtn');
      const modeSelect = document.getElementById('modeSelect');
      const modelSelect = document.getElementById('modelSelect');

      // Utility Functions
      function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
      }

      function formatTime(isoString) {
        const date = new Date(isoString);
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          second: '2-digit'
        });
      }

      function formatTimestamp(isoString) {
        const date = new Date(isoString);
        return date.toLocaleString('en-US', { 
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      // Update Status Pill
      function updateStatus(status) {
        state.taskStatus = status;
        statusPill.className = \`status-pill \${status}\`;
        const labels = {
          ready: 'Ready',
          running: 'Running',
          paused: 'Paused',
          awaiting_approval: 'Awaiting Approval',
          error: 'Error'
        };
        statusPill.textContent = labels[status] || status;
      }

      // Update Stage Label
      function updateStage(stage) {
        state.currentStage = stage;
        stageLabel.textContent = stage === 'none' ? '' : \`Stage: \${stage}\`;
      }

      // Tab Switching
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const tabName = tab.dataset.tab;
          switchTab(tabName);
        });
      });

      function switchTab(tabName) {
        state.activeTab = tabName;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        tabContents.forEach(tc => {
          tc.classList.toggle('active', tc.id === tabName + 'Tab');
        });
      }

      // Render Mission Tab
      function renderMission() {
        if (state.narrationCards.length === 0) {
          missionTab.innerHTML = '<div class="mission-empty">No mission yet. Start a conversation to begin.</div>';
          return;
        }

        missionTab.innerHTML = state.narrationCards.map(card => \`
          <div class="narration-card">
            <div class="narration-card-header">
              <span class="narration-card-type \${card.type}">\${card.type.replace('_', ' ')}</span>
              <span class="narration-card-timestamp">\${formatTimestamp(card.timestamp)}</span>
            </div>
            <div class="narration-card-title">\${card.title}</div>
            <div class="narration-card-content">\${card.content}</div>
            \${card.status ? \`<div class="narration-card-status \${card.status}">Status: \${card.status}</div>\` : ''}
          </div>
        \`).join('');
      }

      // Render Systems Tab Counters
      function renderSystemsCounters() {
        document.getElementById('filesInScope').textContent = state.counters.filesInScope;
        document.getElementById('filesTouched').textContent = state.counters.filesTouched;
        document.getElementById('linesIncluded').textContent = state.counters.linesIncluded;
        document.getElementById('toolCalls').textContent = \`\${state.counters.toolCallsUsed}/\${state.counters.toolCallsMax}\`;
        
        if (state.latestCheckpoint) {
          document.getElementById('checkpointId').textContent = state.latestCheckpoint.checkpoint_id.substring(0, 8);
          document.getElementById('checkpointEvents').textContent = state.latestCheckpoint.event_count;
        }

        // Scope expansion
        const expansionDiv = document.getElementById('scopeExpansionRequest');
        if (state.pendingScopeExpansion) {
          document.getElementById('expansionReason').textContent = state.pendingScopeExpansion.reason;
          expansionDiv.style.display = 'block';
        } else {
          expansionDiv.style.display = 'none';
        }
      }

      // Render Logs Tab
      function renderLogs() {
        if (state.events.length === 0) {
          eventLogList.innerHTML = '<div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 20px;">No events yet.</div>';
          return;
        }

        eventLogList.innerHTML = state.events.map((event, idx) => \`
          <div class="event-log-item" data-event-idx="\${idx}">
            <div class="event-log-header">
              <span class="event-log-type">\${event.type}</span>
              <span class="event-log-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            <div class="event-log-summary">
              Mode: \${event.mode} | Stage: \${event.stage} | ID: \${event.event_id.substring(0, 8)}
            </div>
          </div>
        \`).join('');

        // Add click handlers
        document.querySelectorAll('.event-log-item').forEach(item => {
          item.addEventListener('click', () => {
            document.querySelectorAll('.event-log-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
          });
        });
      }

      // Add demo event
      function addDemoEvent(type, payload = {}) {
        const event = {
          event_id: generateId(),
          task_id: 'demo-task',
          timestamp: new Date().toISOString(),
          type: type,
          mode: state.currentMode,
          stage: state.currentStage,
          payload: payload,
          evidence_ids: [],
          parent_event_id: null
        };
        state.events.push(event);
        renderLogs();
      }

      // Add demo narration card
      function addDemoNarration(type, title, content) {
        const card = {
          type: type,
          title: title,
          content: content,
          timestamp: new Date().toISOString(),
          event_ids: [generateId()],
          status: type === 'approval' ? 'pending' : undefined
        };
        state.narrationCards.push(card);
        renderMission();
      }

      // Handle Send
      sendBtn.addEventListener('click', () => {
        const prompt = promptInput.value.trim();
        if (!prompt) return;

        // Add intent event
        addDemoEvent('intent_received', { prompt });

        // Add intent narration card
        addDemoNarration('intent', 'User Intent Received', prompt);

        // Simulate a plan response
        updateStatus('running');
        updateStage('plan');
        
        setTimeout(() => {
          addDemoEvent('plan_created', { 
            plan: 'Demo plan: Will analyze the request and provide appropriate response'
          });
          addDemoNarration('plan', 'Plan Created', \`Demo plan for: "\${prompt}"\n\nThis is a demonstration. LLM integration pending.\`);
          
          // Simulate completion
          setTimeout(() => {
            addDemoEvent('final', { success: true });
            addDemoNarration('result', 'Mission Complete', 'Demo mission completed successfully. Ready for next task.');
            updateStatus('ready');
            updateStage('none');
            
            // Update counters
            state.counters.toolCallsUsed += 2;
            renderSystemsCounters();
          }, 1000);
        }, 800);

        promptInput.value = '';
        autoResizeTextarea();
      });

      // Handle Clear
      clearBtn.addEventListener('click', () => {
        if (state.events.length === 0 && state.narrationCards.length === 0) return;
        
        if (confirm('Clear all mission data?')) {
          state.events = [];
          state.narrationCards = [];
          state.counters = {
            filesInScope: 0,
            filesTouched: 0,
            linesIncluded: 0,
            toolCallsUsed: 0,
            toolCallsMax: 100
          };
          updateStatus('ready');
          updateStage('none');
          renderMission();
          renderLogs();
          renderSystemsCounters();
        }
      });

      // Handle Mode Change
      modeSelect.addEventListener('change', () => {
        state.currentMode = modeSelect.value;
        addDemoEvent('mode_set', { mode: state.currentMode });
      });

      // Handle Model Change
      modelSelect.addEventListener('change', () => {
        state.selectedModel = modelSelect.value;
      });

      // Auto-resize textarea
      function autoResizeTextarea() {
        promptInput.style.height = 'auto';
        const newHeight = Math.min(promptInput.scrollHeight, 120);
        promptInput.style.height = newHeight + 'px';
      }

      promptInput.addEventListener('input', autoResizeTextarea);

      // Keyboard shortcuts
      promptInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          sendBtn.click();
        }
      });

      // Global scope expansion handler
      window.handleScopeApproval = function(approved) {
        if (approved) {
          addDemoEvent('scope_expansion_resolved', { approved: true });
          state.pendingScopeExpansion = null;
          renderSystemsCounters();
        } else {
          addDemoEvent('scope_expansion_resolved', { approved: false });
          state.pendingScopeExpansion = null;
          renderSystemsCounters();
        }
      };

      // Initialize
      updateStatus('ready');
      updateStage('none');
      renderMission();
      renderSystemsCounters();
      renderLogs();
      promptInput.focus();
    })();
  </script>
</body>
</html>`;
}
