// R3: Decomposed webview entry — CSS from files, JS from modules
import { readFileSync } from 'fs';
import { join } from 'path';

export { getSettingsPanelContent } from './settingsPanel';

// JS module imports
import { getStateJs } from './webviewJs/state';
import { getUtilsJs } from './webviewJs/utils';
import { getRenderersJs } from './webviewJs/renderers';
import { getPreflightVerifyJs } from './webviewJs/preflightVerify';
import { getSystemsTabJs } from './webviewJs/systemsTab';
import { getLogsTabJs } from './webviewJs/logsTab';
import { getInputHandlersJs } from './webviewJs/inputHandlers';
import { getMessageHandlerJs } from './webviewJs/messageHandler';
import { getActionsJs } from './webviewJs/actions';
import { getMissionControlBarJs } from './webviewJs/missionControlBar';
import { getMissionActionsJs } from './webviewJs/missionActions';
import { getSendStopBtnJs } from './webviewJs/sendStopBtn';
import { getAttachmentsJs } from './webviewJs/attachments';
import { getScaffoldListenersJs } from './webviewJs/scaffoldListeners';
import { getInitJs } from './webviewJs/init';

// ===== CSS Loader =====
const CSS_FILES = [
  'base.css',
  'header.css',
  'tabs.css',
  'timeline.css',
  'evidence.css',
  'systems.css',
  'logs.css',
  'composer.css',
  'scrollbar.css',
  'approvals.css',
  'clarification.css',
  'responsive.css',
  'missionControlBar.css',
];

let cssCache: string | null = null;

function loadAllCss(): string {
  if (cssCache !== null) {
    return cssCache;
  }

  const stylesDir = join(__dirname, 'styles');
  const parts: string[] = [];

  for (const file of CSS_FILES) {
    try {
      parts.push(readFileSync(join(stylesDir, file), 'utf8'));
    } catch (error) {
      console.warn(`[webview] Failed to load CSS file ${file}:`, error);
    }
  }

  cssCache = parts.join('\n');
  return cssCache;
}

// ===== ScaffoldCard Script Loader =====
let scaffoldCardScriptCache: string | null = null;

function getScaffoldCardScript(): string {
  if (scaffoldCardScriptCache !== null) {
    return scaffoldCardScriptCache;
  }

  try {
    const scriptPath = join(__dirname, 'components', 'ScaffoldCard.js');
    const rawScript = readFileSync(scriptPath, 'utf8');
    const sanitizedScript = rawScript
      .replace(/<\/script>/g, '<\\/script>')
      .replace(/\/\/# sourceMappingURL=.*$/gm, '');
    scaffoldCardScriptCache = `(function(){ const exports = {}; ${sanitizedScript} })();`;
  } catch (error) {
    console.warn('[webview] Failed to load ScaffoldCard script:', error);
    scaffoldCardScriptCache = '';
  }

  return scaffoldCardScriptCache;
}

// ===== Main Entry Point =====
export function getWebviewContent(): string {
  const css = loadAllCss();
  const scaffoldCardScript = getScaffoldCardScript();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ordinex Mission Control</title>
  <style>
${css}
  </style>
  ${scaffoldCardScript ? `<script>${scaffoldCardScript}</script>` : ''}
</head>
<body>
  <!-- Header Bar -->
  <div class="header">
    <div class="header-left">
      <div class="header-title">Ordinex Mission Control</div>
      <div class="status-pill ready" id="statusPill">Ready</div>
    </div>
    <div class="header-right" style="display: flex; align-items: center; gap: 10px;">
      <button id="exportRunBtn" class="secondary" style="display: none; padding: 4px 10px; font-size: 11px;">
        📦 Export Run
      </button>
      <div class="stage-label" id="stageLabel">none</div>
    </div>
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

    <!-- Systems Tab (Dynamic 8-Section Layout from Events) -->
    <div class="tab-content" id="systemsTab">
      <div id="systemsContent">
        <!-- Will be populated by renderSystemsTab() -->
        <div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 20px;">
          Loading systems view...
        </div>
      </div>
    </div>

    <!-- Logs Tab -->
    <div class="tab-content" id="logsTab">
      <!-- Filter Bar -->
      <div class="logs-filter-bar" id="logsFilterBar">
        <input type="text" class="logs-search-input" id="logsSearchInput" placeholder="🔍 Search events..." />
        <label>Type:</label>
        <select class="logs-filter-select" id="logsTypeFilter">
          <option value="all">All Types</option>
        </select>
        <label>Stage:</label>
        <select class="logs-filter-select" id="logsStageFilter">
          <option value="all">All</option>
          <option value="none">none</option>
          <option value="plan">plan</option>
          <option value="retrieve">retrieve</option>
          <option value="edit">edit</option>
          <option value="test">test</option>
          <option value="repair">repair</option>
        </select>
        <label>Mode:</label>
        <select class="logs-filter-select" id="logsModeFilter">
          <option value="all">All</option>
          <option value="ANSWER">ANSWER</option>
          <option value="PLAN">PLAN</option>
          <option value="MISSION">MISSION</option>
        </select>
        <span class="logs-stats" id="logsStats">0 events</span>
      </div>
      <div class="event-log-list" id="eventLogList">
        <div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 20px;">
          No events yet.
        </div>
      </div>
    </div>
  </div>

  <!-- Mission Control Bar (Compact Bottom Sticky) -->
  <div class="mission-control-bar" id="missionControlBar">
    <div class="mcb-status">
      <span class="mcb-status-icon" id="mcbStatusIcon">🚀</span>
      <span class="mcb-count" id="mcbCount">1/4</span>
    </div>
    <div class="mcb-divider"></div>
    <div class="mcb-mission-name" id="mcbMissionName">Auth & Security</div>
    <div class="mcb-progress">
      <div class="mcb-progress-bar">
        <div class="mcb-progress-fill" id="mcbProgressFill" style="width: 25%;"></div>
      </div>
    </div>
    <button class="mcb-cta start" id="mcbCta" onclick="handleMcbCtaClick()">▶ Start</button>
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
      <select id="modelSelect" title="Select LLM model">
        <option value="claude-3-haiku" title="Fast / lightweight">Claude 3 Haiku</option>
        <option value="claude-sonnet-4-5" title="Best for building features / multi-file changes">Claude Sonnet 4.5</option>
      </select>
      <span class="model-hint" id="modelHint" style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-left: 4px; font-style: italic;">Fast / lightweight</span>
      <div class="composer-controls-spacer"></div>
      <button class="attach-btn" id="attachBtn" title="Attach file (coming soon)">📎</button>
    </div>
    <div class="composer-input-wrapper">
      <textarea id="promptInput" placeholder="Enter your prompt..." rows="2"></textarea>
      <button class="send-stop-btn send" id="sendStopBtn" title="Send">▶</button>
    </div>
    <!-- Hidden buttons for backward compatibility -->
    <div class="composer-buttons" style="display: none;">
      <button id="sendBtn">Send</button>
      <button id="stopBtn" class="secondary" disabled>Stop</button>
      <button id="clearBtn" class="danger">Clear</button>
    </div>
  </div>

  <script>
    // Acquire VS Code API
    const vscode = acquireVsCodeApi();

    (function() {
      ${getStateJs()}
      ${getUtilsJs()}
      ${getRenderersJs()}
      ${getPreflightVerifyJs()}
      ${getSystemsTabJs()}
      ${getLogsTabJs()}
      ${getInputHandlersJs()}
      ${getMessageHandlerJs()}
      ${getActionsJs()}
      ${getMissionControlBarJs()}
      ${getMissionActionsJs()}
      ${getSendStopBtnJs()}
      ${getAttachmentsJs()}
      ${getScaffoldListenersJs()}
      ${getInitJs()}
    })();
  </script>
</body>
</html>`;
}
