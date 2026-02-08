/**
 * Settings Panel (Step 45)
 *
 * Full-page editor-tab settings UI with left sidebar navigation and right content area.
 * Sections: Integrations (API Keys), Preferences (Policies), Account (read-only info).
 *
 * Communication:
 *   Webview -> Extension: ordinex:settings:* messages
 *   Extension -> Webview: ordinex:settings:update / ordinex:settings:saveResult
 */

export function getSettingsPanelContent(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ordinex Settings</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

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

    /* ── Top Bar ── */
    .settings-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    .settings-topbar h1 {
      font-size: 16px;
      font-weight: 600;
    }

    /* ── Layout ── */
    .settings-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* ── Sidebar ── */
    .settings-sidebar {
      width: 200px;
      min-width: 200px;
      border-right: 1px solid var(--vscode-panel-border, #333);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 12px 0;
      overflow-y: auto;
    }
    .sidebar-section-label {
      padding: 6px 16px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      letter-spacing: 0.5px;
    }
    .sidebar-item {
      padding: 8px 16px 8px 24px;
      cursor: pointer;
      font-size: 13px;
      color: var(--vscode-foreground);
      border-left: 2px solid transparent;
    }
    .sidebar-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .sidebar-item.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
      border-left-color: var(--vscode-focusBorder, #007acc);
    }

    /* ── Content ── */
    .settings-content {
      flex: 1;
      padding: 24px 32px;
      overflow-y: auto;
    }
    .content-header {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 20px;
    }
    .settings-section {
      display: none;
    }
    .settings-section.active {
      display: block;
    }
    .section-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    /* ── Form Elements ── */
    .setting-group {
      margin-bottom: 24px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    .setting-group:last-child {
      border-bottom: none;
    }
    .setting-label {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .setting-help {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .setting-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .setting-input {
      flex: 1;
      max-width: 400px;
      padding: 6px 10px;
      font-size: 13px;
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px;
      outline: none;
    }
    .setting-input:focus {
      border-color: var(--vscode-focusBorder, #007acc);
    }
    .setting-select {
      padding: 6px 10px;
      font-size: 13px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px;
      outline: none;
      min-width: 180px;
    }
    .setting-select:focus {
      border-color: var(--vscode-focusBorder, #007acc);
    }

    /* ── Buttons ── */
    .btn {
      padding: 6px 14px;
      font-size: 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .btn-danger {
      background: var(--vscode-errorForeground, #f44);
      color: #fff;
    }
    .btn-danger:hover {
      opacity: 0.9;
    }
    .btn-icon {
      background: transparent;
      border: 1px solid var(--vscode-input-border, #555);
      color: var(--vscode-foreground);
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .btn-icon:hover {
      background: var(--vscode-list-hoverBackground);
    }

    /* ── Status Badge ── */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 12px;
      font-weight: 500;
    }
    .status-badge.connected {
      background: rgba(40, 167, 69, 0.15);
      color: var(--vscode-charts-green, #28a745);
    }
    .status-badge.not-configured {
      background: rgba(255, 165, 0, 0.15);
      color: var(--vscode-charts-orange, #e8a317);
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
    }
    .status-badge.connected .status-dot { background: var(--vscode-charts-green, #28a745); }
    .status-badge.not-configured .status-dot { background: var(--vscode-charts-orange, #e8a317); }

    /* ── Security Note ── */
    .security-note {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* ── Toggle Switch ── */
    .toggle-container {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .toggle-switch {
      position: relative;
      width: 36px;
      height: 20px;
      cursor: pointer;
    }
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 10px;
      transition: background 0.2s;
    }
    .toggle-slider::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      left: 2px;
      bottom: 2px;
      background: var(--vscode-foreground);
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .toggle-switch input:checked + .toggle-slider {
      background: var(--vscode-button-background);
      border-color: var(--vscode-button-background);
    }
    .toggle-switch input:checked + .toggle-slider::before {
      transform: translateX(16px);
      background: var(--vscode-button-foreground);
    }
    .toggle-label {
      font-size: 13px;
    }

    /* ── Account Info ── */
    .info-grid {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 8px 16px;
      font-size: 13px;
    }
    .info-label {
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
    }
    .info-value {
      font-family: var(--vscode-editor-font-family, monospace);
      word-break: break-all;
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 10px 18px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.3s, transform 0.3s;
      z-index: 100;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    .toast.success {
      background: rgba(40, 167, 69, 0.9);
      color: #fff;
    }
    .toast.error {
      background: rgba(220, 53, 69, 0.9);
      color: #fff;
    }
  </style>
</head>
<body>
  <!-- Top Bar -->
  <div class="settings-topbar">
    <h1>Ordinex Settings</h1>
  </div>

  <div class="settings-layout">
    <!-- Sidebar Navigation -->
    <div class="settings-sidebar">
      <div class="sidebar-section-label">Integrations</div>
      <div class="sidebar-item active" data-section="services">Services</div>

      <div class="sidebar-section-label" style="margin-top: 12px;">Preferences</div>
      <div class="sidebar-item" data-section="policies">Policies</div>

      <div class="sidebar-section-label" style="margin-top: 12px;">Account</div>
      <div class="sidebar-item" data-section="account">Info</div>
    </div>

    <!-- Content Area -->
    <div class="settings-content">
      <!-- ═══════ Services Section ═══════ -->
      <div class="settings-section active" id="section-services">
        <div class="content-header">Integrations &gt; Services</div>
        <div class="section-title">API Keys</div>

        <div class="setting-group">
          <div class="setting-label">Anthropic API Key</div>
          <div class="setting-help">Required for all AI features. Your key is stored securely in VS Code SecretStorage and never sent to any server other than Anthropic.</div>

          <div class="setting-row">
            <input
              type="password"
              class="setting-input"
              id="apiKeyInput"
              placeholder="sk-ant-..."
              autocomplete="off"
            />
            <button class="btn-icon" id="toggleKeyVisibility" title="Show/hide key">&#128065;</button>
            <button class="btn btn-primary" id="saveApiKeyBtn">Save</button>
          </div>

          <div style="display: flex; align-items: center; gap: 12px; margin-top: 4px;">
            <div id="apiKeyStatus"></div>
            <button class="btn btn-danger" id="clearApiKeyBtn" style="display: none; font-size: 11px; padding: 4px 10px;">Clear Key</button>
          </div>

          <div class="security-note">
            &#128274; Stored in VS Code SecretStorage
          </div>
        </div>
      </div>

      <!-- ═══════ Policies Section ═══════ -->
      <div class="settings-section" id="section-policies">
        <div class="content-header">Preferences &gt; Policies</div>
        <div class="section-title">Execution Policies</div>

        <div class="setting-group">
          <div class="setting-label">Command Execution Policy</div>
          <div class="setting-help">
            Controls how terminal commands are executed during plan and mission execution.<br>
            <strong>off</strong> &mdash; Never run commands automatically<br>
            <strong>prompt</strong> &mdash; Ask for approval before each command (default)<br>
            <strong>auto</strong> &mdash; Run commands without asking (use with caution)
          </div>
          <select class="setting-select" id="commandPolicySelect">
            <option value="off">Off</option>
            <option value="prompt" selected>Prompt</option>
            <option value="auto">Auto</option>
          </select>
        </div>

        <div class="setting-group">
          <div class="setting-label">Autonomy Level</div>
          <div class="setting-help">
            Controls how aggressively the AI operates during mission execution.<br>
            <strong>conservative</strong> &mdash; Minimal autonomy, confirm every step (default)<br>
            <strong>balanced</strong> &mdash; Moderate autonomy, confirm risky steps only<br>
            <strong>aggressive</strong> &mdash; Maximum autonomy, minimal confirmations
          </div>
          <select class="setting-select" id="autonomyLevelSelect">
            <option value="conservative" selected>Conservative</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </div>

        <div class="setting-group">
          <div class="setting-label">Session Persistence</div>
          <div class="setting-help">
            When enabled, session context (project type, detected tools, diagnostics) is persisted to disk and restored across VS Code restarts.
          </div>
          <div class="toggle-container">
            <label class="toggle-switch">
              <input type="checkbox" id="sessionPersistenceToggle" />
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label" id="sessionPersistenceLabel">Off</span>
          </div>
        </div>
      </div>

      <!-- ═══════ Account Section ═══════ -->
      <div class="settings-section" id="section-account">
        <div class="content-header">Account &gt; Info</div>
        <div class="section-title">Environment</div>

        <div class="setting-group">
          <div class="info-grid">
            <span class="info-label">Extension Version</span>
            <span class="info-value" id="infoVersion">—</span>

            <span class="info-label">Workspace Path</span>
            <span class="info-value" id="infoWorkspace">—</span>

            <span class="info-label">Event Store Path</span>
            <span class="info-value" id="infoEventStore">—</span>

            <span class="info-label">Events Count</span>
            <span class="info-value" id="infoEventsCount">—</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast notification -->
  <div class="toast" id="toast"></div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();

      // ── DOM references ──
      const apiKeyInput = document.getElementById('apiKeyInput');
      const toggleKeyBtn = document.getElementById('toggleKeyVisibility');
      const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
      const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');
      const apiKeyStatus = document.getElementById('apiKeyStatus');
      const commandPolicySelect = document.getElementById('commandPolicySelect');
      const autonomyLevelSelect = document.getElementById('autonomyLevelSelect');
      const sessionPersistenceToggle = document.getElementById('sessionPersistenceToggle');
      const sessionPersistenceLabel = document.getElementById('sessionPersistenceLabel');
      const toast = document.getElementById('toast');

      let keyVisible = false;

      // ── Sidebar navigation ──
      document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
          document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
          document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
          item.classList.add('active');
          const sectionId = 'section-' + item.getAttribute('data-section');
          const section = document.getElementById(sectionId);
          if (section) section.classList.add('active');
        });
      });

      // ── Toggle API key visibility ──
      toggleKeyBtn.addEventListener('click', () => {
        keyVisible = !keyVisible;
        apiKeyInput.type = keyVisible ? 'text' : 'password';
        toggleKeyBtn.textContent = keyVisible ? '\\u{1F6AB}' : '\\u{1F441}';
      });

      // ── Save API key ──
      saveApiKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (!key) return;
        if (!key.startsWith('sk-ant-')) {
          showToast('Invalid key format (must start with sk-ant-)', 'error');
          return;
        }
        vscode.postMessage({ type: 'ordinex:settings:saveApiKey', apiKey: key });
        saveApiKeyBtn.textContent = 'Saving...';
        saveApiKeyBtn.disabled = true;
      });

      // ── Clear API key ──
      clearApiKeyBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'ordinex:settings:clearApiKey' });
      });

      // ── Policy dropdowns ──
      commandPolicySelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'ordinex:settings:setCommandPolicy', mode: commandPolicySelect.value });
      });

      autonomyLevelSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'ordinex:settings:setAutonomyLevel', level: autonomyLevelSelect.value });
      });

      // ── Session persistence toggle ──
      sessionPersistenceToggle.addEventListener('change', () => {
        const enabled = sessionPersistenceToggle.checked;
        sessionPersistenceLabel.textContent = enabled ? 'On' : 'Off';
        vscode.postMessage({ type: 'ordinex:settings:setSessionPersistence', enabled });
      });

      // ── Receive messages from extension ──
      window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'ordinex:settings:update':
            applySettings(msg);
            break;
          case 'ordinex:settings:saveResult':
            handleSaveResult(msg);
            break;
        }
      });

      function applySettings(data) {
        // API key status
        if (data.apiKeyConfigured) {
          apiKeyStatus.innerHTML = '<span class="status-badge connected"><span class="status-dot"></span>Connected</span>';
          apiKeyInput.placeholder = data.apiKeyPreview || 'sk-ant-...****';
          apiKeyInput.value = '';
          clearApiKeyBtn.style.display = 'inline-block';
        } else {
          apiKeyStatus.innerHTML = '<span class="status-badge not-configured"><span class="status-dot"></span>Not configured</span>';
          apiKeyInput.placeholder = 'sk-ant-...';
          clearApiKeyBtn.style.display = 'none';
        }

        // Policies
        if (data.commandPolicy) commandPolicySelect.value = data.commandPolicy;
        if (data.autonomyLevel) autonomyLevelSelect.value = data.autonomyLevel;
        if (typeof data.sessionPersistence === 'boolean') {
          sessionPersistenceToggle.checked = data.sessionPersistence;
          sessionPersistenceLabel.textContent = data.sessionPersistence ? 'On' : 'Off';
        }

        // Account info
        if (data.extensionVersion) document.getElementById('infoVersion').textContent = data.extensionVersion;
        if (data.workspacePath) document.getElementById('infoWorkspace').textContent = data.workspacePath;
        if (data.eventStorePath) document.getElementById('infoEventStore').textContent = data.eventStorePath;
        if (typeof data.eventsCount === 'number') document.getElementById('infoEventsCount').textContent = String(data.eventsCount);

        // Reset save button state
        saveApiKeyBtn.textContent = 'Save';
        saveApiKeyBtn.disabled = false;
      }

      function handleSaveResult(msg) {
        saveApiKeyBtn.textContent = 'Save';
        saveApiKeyBtn.disabled = false;
        if (msg.success) {
          showToast(msg.setting + ' saved', 'success');
          // Request fresh state
          vscode.postMessage({ type: 'ordinex:settings:getAll' });
        } else {
          showToast('Failed: ' + (msg.error || 'unknown error'), 'error');
        }
      }

      function showToast(text, kind) {
        toast.textContent = text;
        toast.className = 'toast ' + kind + ' show';
        setTimeout(() => { toast.className = 'toast'; }, 3000);
      }

      // ── Request initial state ──
      vscode.postMessage({ type: 'ordinex:settings:getAll' });
    })();
  </script>
</body>
</html>`;
}
