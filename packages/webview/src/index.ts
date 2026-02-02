import { readFileSync } from 'fs';
import { join } from 'path';

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

export function getWebviewContent(): string {
  const scaffoldCardScript = getScaffoldCardScript();
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

    /* ===== MISSION TAB - Timeline Feed ===== */
    .mission-empty {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      padding: 40px 20px;
      font-size: 13px;
    }

    /* Stage Headers */
    .stage-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin: 16px 0 8px 0;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 3px solid var(--vscode-focusBorder);
      border-radius: 4px;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stage-header:first-child {
      margin-top: 0;
    }

    .stage-icon {
      font-size: 16px;
    }

    .stage-title {
      color: var(--vscode-foreground);
    }

    /* Event Cards */
    .event-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 8px;
      animation: fadeIn 0.2s ease-in;
      transition: all 0.15s ease;
    }

    .event-card:hover {
      background: var(--vscode-list-hoverBackground);
      border-left-color: var(--vscode-focusBorder);
    }

    .event-card.approval-required {
      border-left-color: var(--vscode-charts-yellow);
      background: var(--vscode-inputValidation-warningBackground);
    }

    .event-card.failure {
      border-left-color: var(--vscode-charts-red);
      background: var(--vscode-inputValidation-errorBackground);
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .event-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .event-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .event-type {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-foreground);
      flex: 1;
    }

    .event-timestamp {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }

    .event-summary {
      font-size: 12px;
      line-height: 1.4;
      color: var(--vscode-descriptionForeground);
      padding-left: 24px;
    }

    .event-evidence {
      margin-top: 6px;
      padding-left: 24px;
      font-size: 10px;
      color: var(--vscode-charts-blue);
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .event-evidence:hover {
      text-decoration: underline;
    }

    .event-card.expanded {
      background: var(--vscode-list-hoverBackground);
    }

    /* ===== EVIDENCE LIST ===== */
    .evidence-list {
      margin-top: 8px;
      padding: 8px 12px;
      padding-left: 24px;
      background: var(--vscode-input-background);
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .evidence-list-empty {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-style: italic;
    }

    .evidence-item {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
    }

    .evidence-item-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .evidence-icon {
      font-size: 14px;
    }

    .evidence-type-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-foreground);
      flex: 1;
    }

    .evidence-timestamp {
      font-size: 9px;
      color: var(--vscode-descriptionForeground);
    }

    .evidence-summary {
      font-size: 11px;
      line-height: 1.3;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }

    .evidence-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .evidence-btn {
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
    }

    .evidence-btn-open {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .evidence-btn-open:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .evidence-btn-copy {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .evidence-btn-copy:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    /* ===== EVIDENCE VIEWER MODAL ===== */
    .evidence-viewer-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      animation: fadeIn 0.15s ease-in;
    }

    .evidence-viewer-panel {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      width: 90%;
      max-width: 800px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      animation: slideUp 0.2s ease-out;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .evidence-viewer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      border-radius: 6px 6px 0 0;
    }

    .evidence-viewer-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 13px;
    }

    .evidence-viewer-icon {
      font-size: 18px;
    }

    .evidence-viewer-id {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-weight: 400;
      margin-left: 6px;
    }

    .evidence-viewer-close {
      padding: 4px 8px;
      font-size: 16px;
      line-height: 1;
      background: transparent;
      color: var(--vscode-foreground);
      border: none;
      cursor: pointer;
      border-radius: 3px;
    }

    .evidence-viewer-close:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .evidence-viewer-metadata {
      padding: 10px 14px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px;
    }

    .evidence-metadata-row {
      margin: 4px 0;
      display: flex;
      gap: 8px;
    }

    .evidence-metadata-label {
      color: var(--vscode-descriptionForeground);
      min-width: 90px;
      font-weight: 600;
    }

    .evidence-metadata-value {
      color: var(--vscode-foreground);
      flex: 1;
    }

    .evidence-viewer-content {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      min-height: 200px;
    }

    .evidence-content-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }

    .loading-spinner {
      font-size: 24px;
      animation: spin 2s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .evidence-content-area {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
    }

    .evidence-file-header {
      padding: 8px 12px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      color: var(--vscode-foreground);
    }

    .evidence-pre {
      margin: 0;
      padding: 12px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
      color: var(--vscode-editor-foreground);
    }

    .evidence-pre.wrap {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .evidence-viewer-actions {
      display: flex;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      border-radius: 0 0 6px 6px;
    }

    .evidence-action-btn {
      padding: 6px 12px;
      font-size: 11px;
    }

    /* ===== SYSTEMS TAB ===== */
    .systems-section {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    }

    .systems-section:last-child {
      margin-bottom: 0;
    }

    .systems-section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .systems-section-icon {
      font-size: 14px;
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

    .systems-value.success {
      color: var(--vscode-charts-green);
    }

    .systems-value.warning {
      color: var(--vscode-charts-yellow);
    }

    .systems-value.error {
      color: var(--vscode-charts-red);
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

    .systems-file-list {
      max-height: 200px;
      overflow-y: auto;
      font-size: 11px;
    }

    .systems-file-item {
      padding: 4px 8px;
      background: var(--vscode-input-background);
      border-radius: 3px;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .systems-file-path {
      color: var(--vscode-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .systems-file-lines {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      margin-left: 8px;
      flex-shrink: 0;
    }

    .systems-show-all {
      padding: 6px 12px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      margin-top: 8px;
      width: 100%;
    }

    .systems-show-all:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .systems-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }

    .systems-badge.running {
      background: var(--vscode-charts-green);
      color: #fff;
    }

    .systems-badge.paused {
      background: var(--vscode-charts-yellow);
      color: #000;
    }

    .systems-badge.completed {
      background: var(--vscode-charts-blue);
      color: #fff;
    }

    .systems-badge.cancelled {
      background: var(--vscode-charts-red);
      color: #fff;
    }

    .systems-badge.idle {
      background: var(--vscode-descriptionForeground);
      color: #fff;
    }

    .systems-pending-item {
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 6px;
      font-size: 11px;
    }

    .systems-pending-type {
      font-weight: 600;
      color: var(--vscode-editor-warningForeground);
    }

    .systems-pending-desc {
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }

    .systems-tool-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 6px;
    }

    .systems-tool-item {
      background: var(--vscode-input-background);
      border-radius: 4px;
      padding: 6px 8px;
      text-align: center;
    }

    .systems-tool-name {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }

    .systems-tool-count {
      font-size: 14px;
      font-weight: 700;
      color: var(--vscode-foreground);
    }

    .systems-expander {
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--vscode-textLink-foreground);
      margin-top: 8px;
    }

    .systems-expander:hover {
      text-decoration: underline;
    }

    .systems-details {
      margin-top: 8px;
      padding: 8px;
      background: var(--vscode-input-background);
      border-radius: 4px;
      font-size: 10px;
      font-family: monospace;
      display: none;
    }

    .systems-details.expanded {
      display: block;
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

    /* ===== LOGS TAB (Step 30: Raw Debug Surface) ===== */
    .logs-filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 12px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 8px;
      border-radius: 4px;
      align-items: center;
    }

    .logs-filter-bar label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .logs-search-input {
      flex: 1;
      min-width: 150px;
      padding: 5px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 11px;
      outline: none;
    }

    .logs-search-input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .logs-search-input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .logs-filter-select {
      padding: 4px 8px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
      min-width: 80px;
    }

    .logs-filter-select:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    .logs-stats {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-left: auto;
      padding: 4px 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 10px;
    }

    .event-log-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: calc(100vh - 300px);
      overflow-y: auto;
    }

    .event-log-item {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 11px;
      transition: background 0.1s ease;
    }

    .event-log-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .event-log-item.expanded {
      background: var(--vscode-editor-background);
      border-color: var(--vscode-focusBorder);
    }

    .log-row-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      cursor: pointer;
    }

    .log-expand-icon {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
      width: 12px;
      transition: transform 0.15s ease;
    }

    .event-log-item.expanded .log-expand-icon {
      transform: rotate(90deg);
    }

    .event-log-type {
      font-weight: 600;
      color: var(--vscode-foreground);
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
    }

    .event-log-meta {
      display: flex;
      gap: 6px;
      flex: 1;
      align-items: center;
    }

    .log-badge {
      padding: 1px 6px;
      border-radius: 8px;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .log-badge.mode {
      background: var(--vscode-charts-purple);
      color: #fff;
    }

    .log-badge.stage {
      background: var(--vscode-charts-blue);
      color: #fff;
    }

    .log-badge.tool {
      background: var(--vscode-charts-orange);
      color: #fff;
    }

    .event-log-timestamp {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-family: monospace;
      flex-shrink: 0;
    }

    .log-evidence-ids {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px 10px 8px 30px;
    }

    .evidence-token {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 6px;
      background: var(--vscode-textLink-foreground);
      color: #fff;
      border-radius: 10px;
      font-size: 9px;
      font-family: monospace;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .evidence-token:hover {
      background: var(--vscode-textLink-activeForeground);
      transform: scale(1.05);
    }

    .evidence-token-icon {
      font-size: 10px;
    }

    .evidence-token-copied {
      background: var(--vscode-charts-green) !important;
    }

    .log-payload-container {
      padding: 0 10px 10px 30px;
      display: none;
    }

    .event-log-item.expanded .log-payload-container {
      display: block;
    }

    .log-payload-pre {
      margin: 0;
      padding: 10px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
      font-size: 10px;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
      color: var(--vscode-editor-foreground);
      max-height: 400px;
      overflow-y: auto;
    }

    .log-copy-btn {
      margin-top: 6px;
      padding: 4px 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
    }

    .log-copy-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    /* Stream Delta Group Styling */
    .stream-group {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-color: var(--vscode-charts-blue);
    }

    .stream-group-badge {
      padding: 2px 8px;
      background: var(--vscode-charts-blue);
      color: #fff;
      border-radius: 10px;
      font-size: 9px;
      font-weight: 700;
    }

    .stream-group-content {
      padding: 10px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
      font-size: 11px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
    }

    .stream-toggle-mode {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }

    .stream-toggle-btn {
      padding: 3px 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
    }

    .stream-toggle-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    /* Virtual scroll placeholder */
    .logs-virtual-spacer {
      height: 0;
      flex-shrink: 0;
    }

    .event-log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
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
      padding: 8px 12px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
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

    .composer-controls-spacer {
      flex: 1;
    }

    .attach-btn {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      font-size: 16px;
      padding: 4px 6px;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.15s ease;
    }

    .attach-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
      color: var(--vscode-foreground);
    }

    .attach-btn.has-attachments {
      color: var(--vscode-charts-blue);
    }

    /* ===== ATTACHMENT PREVIEWS ===== */
    .attachments-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 0;
      margin-top: 4px;
    }

    .attachment-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 4px 8px;
      max-width: 140px;
      position: relative;
      animation: fadeIn 0.2s ease-in;
    }

    .attachment-chip.uploading {
      opacity: 0.6;
      border-color: var(--vscode-charts-blue);
    }

    .attachment-chip.uploaded {
      border-color: var(--vscode-charts-green);
    }

    .attachment-chip.error {
      border-color: var(--vscode-charts-red);
      background: var(--vscode-inputValidation-errorBackground);
    }

    .attachment-thumb {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .attachment-info {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }

    .attachment-name {
      font-size: 10px;
      color: var(--vscode-foreground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }

    .attachment-size {
      font-size: 9px;
      color: var(--vscode-descriptionForeground);
    }

    .attachment-status {
      font-size: 10px;
    }

    .attachment-status.uploading {
      color: var(--vscode-charts-blue);
    }

    .attachment-status.error {
      color: var(--vscode-charts-red);
    }

    .attachment-remove {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--vscode-charts-red);
      color: #fff;
      border: none;
      font-size: 10px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .attachment-chip:hover .attachment-remove {
      opacity: 1;
    }

    .attachment-remove:hover {
      background: #dc3545;
      transform: scale(1.1);
    }

    .attachments-count {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      padding: 4px 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 10px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .attachments-count.at-limit {
      color: var(--vscode-charts-yellow);
    }

    /* Toast notification for errors */
    .toast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-foreground);
      padding: 10px 16px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 9999;
      animation: slideUp 0.3s ease-out, fadeOut 0.3s ease-in 2.7s forwards;
      max-width: 300px;
      text-align: center;
    }

    .toast.warning {
      background: var(--vscode-inputValidation-warningBackground);
      border-color: var(--vscode-inputValidation-warningBorder);
    }

    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; visibility: hidden; }
    }

    .composer-input-wrapper {
      position: relative;
      display: flex;
      align-items: flex-end;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 12px;
      padding: 6px 8px;
      transition: border-color 0.15s ease;
    }

    .composer-input-wrapper:focus-within {
      border-color: var(--vscode-focusBorder);
    }

    .composer-input-wrapper textarea {
      flex: 1;
      background: transparent;
      color: var(--vscode-input-foreground);
      border: none;
      padding: 4px 8px;
      font-size: 12px;
      font-family: inherit;
      resize: none;
      min-height: 32px;
      max-height: 100px;
      line-height: 1.4;
      outline: none;
    }

    .composer-input-wrapper textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    /* Send/Stop Toggle Button - Inside Input */
    .send-stop-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: all 0.2s ease;
      flex-shrink: 0;
      margin-left: 4px;
    }

    .send-stop-btn.send {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .send-stop-btn.send:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
      transform: scale(1.05);
    }

    .send-stop-btn.stop {
      background: var(--vscode-charts-red);
      color: #fff;
      animation: stopPulse 1.5s ease-in-out infinite;
    }

    .send-stop-btn.stop:hover:not(:disabled) {
      background: #dc3545;
    }

    .send-stop-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    @keyframes stopPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.4); }
      50% { box-shadow: 0 0 0 6px rgba(220, 53, 69, 0); }
    }

    /* Hide old button container */
    .composer-buttons {
      display: none;
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

    /* ===== APPROVAL CARDS ===== */
    .approval-card {
      background: var(--vscode-inputValidation-warningBackground);
      border: 2px solid var(--vscode-charts-yellow);
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 12px;
      animation: pulseGlow 2s ease-in-out infinite;
    }

    @keyframes pulseGlow {
      0%, 100% { box-shadow: 0 0 8px rgba(255, 193, 7, 0.3); }
      50% { box-shadow: 0 0 16px rgba(255, 193, 7, 0.6); }
    }

    .approval-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .approval-card-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
    }

    .approval-icon {
      font-size: 24px;
      flex-shrink: 0;
    }

    .approval-card-title {
      flex: 1;
    }

    .approval-type-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-foreground);
      margin-bottom: 2px;
    }

    .approval-id {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-family: monospace;
    }

    .risk-badge {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 9px;
      font-weight: 700;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }

    .approval-card-body {
      margin-bottom: 12px;
    }

    .approval-summary {
      font-size: 13px;
      line-height: 1.5;
      color: var(--vscode-foreground);
      margin-bottom: 10px;
      font-weight: 500;
    }

    .approval-details {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 8px;
    }

    .detail-row {
      margin: 6px 0;
      font-size: 11px;
      display: flex;
      gap: 8px;
    }

    .detail-row:first-child {
      margin-top: 0;
    }

    .detail-row:last-child {
      margin-bottom: 0;
    }

    .detail-label {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      min-width: 80px;
    }

    .detail-value {
      color: var(--vscode-foreground);
      flex: 1;
      word-break: break-word;
    }

    .detail-value code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
    }

    .approval-evidence {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--vscode-charts-blue);
      margin-top: 8px;
    }

    .approval-card-actions {
      display: flex;
      gap: 10px;
    }

    .approval-btn {
      flex: 1;
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 4px;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }

    .approval-btn.approve {
      background: var(--vscode-charts-green);
      color: #fff;
    }

    .approval-btn.approve:hover {
      background: #28a745;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(40, 167, 69, 0.4);
    }

    .approval-btn.reject {
      background: var(--vscode-charts-red);
      color: #fff;
    }

    .approval-btn.reject:hover {
      background: #dc3545;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(220, 53, 69, 0.4);
    }

    .approval-section-header {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-charts-yellow);
      margin: 16px 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 2px solid var(--vscode-charts-yellow);
    }

    .approval-warning {
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--vscode-editor-warningForeground);
    }

    .approval-warning-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    /* ===== CLARIFICATION CARD (PLAN mode v2) ===== */
    .clarification-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 16px;
      margin: 12px 0;
    }

    .clarification-card[data-state="selecting"] .clarification-btn:not(.selected) {
      opacity: 0.5;
      pointer-events: none;
    }

    .clarification-card[data-state="processing"] .clarification-options,
    .clarification-card[data-state="processing"] .clarification-skip {
      display: none;
    }

    .clarification-card[data-state="processing"] .clarification-processing {
      display: flex !important;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 20px;
      color: var(--vscode-descriptionForeground);
    }

    .clarification-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 14px;
      color: var(--vscode-editor-foreground);
    }

    .clarification-icon {
      font-size: 18px;
    }

    .clarification-card-subtitle {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin: 8px 0 16px 0;
    }

    .clarification-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .clarification-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 12px;
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
      color: var(--vscode-editor-foreground);
      transition: background 0.15s, border-color 0.15s;
    }

    .clarification-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    .clarification-btn:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .clarification-btn.selected {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .clarification-btn-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }

    .clarification-btn-title {
      font-weight: 600;
      font-size: 13px;
    }

    .clarification-btn-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .clarification-btn-evidence {
      font-size: 10px;
      color: var(--vscode-textLink-foreground);
      font-style: italic;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 280px;
    }

    .clarification-btn-spinner {
      animation: spin 1s linear infinite;
    }

    .clarification-skip {
      margin-top: 12px;
      text-align: center;
    }

    .clarification-skip-link {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      font-size: 12px;
      cursor: pointer;
      padding: 4px 8px;
    }

    .clarification-skip-link:hover {
      text-decoration: underline;
    }

    .clarification-processing {
      padding: 20px;
      text-align: center;
    }

    .processing-spinner {
      animation: spin 1s linear infinite;
      display: inline-block;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
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

      .approval-card-actions {
        flex-direction: column;
      }
    }

    /* ===== MISSION CONTROL BAR (Bottom Sticky) ===== */
    .mission-control-bar {
      display: none;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      background: var(--vscode-sideBar-background);
      border-top: 1px solid var(--vscode-panel-border);
      border-bottom: 1px solid var(--vscode-panel-border);
      height: 32px;
      flex-shrink: 0;
    }

    .mission-control-bar.visible {
      display: flex;
    }

    .mission-control-bar.running {
      border-top-color: var(--vscode-charts-blue);
      animation: missionBarPulse 2s ease-in-out infinite;
    }

    .mission-control-bar.complete {
      border-top-color: var(--vscode-charts-green);
      background: var(--vscode-inputValidation-infoBackground);
    }

    .mission-control-bar.all-done {
      border-top-color: var(--vscode-charts-green);
      background: linear-gradient(90deg, var(--vscode-inputValidation-infoBackground) 0%, var(--vscode-sideBar-background) 100%);
    }

    @keyframes missionBarPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.85; }
    }

    .mcb-status {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .mcb-status-icon {
      font-size: 14px;
    }

    .mcb-status-icon.spinning {
      animation: spin 1s linear infinite;
    }

    .mcb-count {
      color: var(--vscode-foreground);
      font-weight: 700;
    }

    .mcb-divider {
      width: 1px;
      height: 16px;
      background: var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .mcb-mission-name {
      font-size: 11px;
      color: var(--vscode-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 60px;
    }

    .mcb-progress {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .mcb-progress-bar {
      width: 50px;
      height: 4px;
      background: var(--vscode-panel-border);
      border-radius: 2px;
      overflow: hidden;
    }

    .mcb-progress-fill {
      height: 100%;
      background: var(--vscode-charts-blue);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .mcb-progress-fill.complete {
      background: var(--vscode-charts-green);
    }

    .mcb-cta {
      padding: 3px 10px;
      font-size: 10px;
      font-weight: 700;
      border-radius: 3px;
      cursor: pointer;
      border: none;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }

    .mcb-cta.start {
      background: var(--vscode-charts-green);
      color: #fff;
    }

    .mcb-cta.start:hover {
      background: #28a745;
    }

    .mcb-cta.running {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      cursor: default;
    }

    .mcb-cta.done {
      background: transparent;
      color: var(--vscode-charts-green);
      border: 1px solid var(--vscode-charts-green);
    }
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
      // ===== ATTACHMENT CONSTANTS =====
      const ATTACHMENT_CONFIG = {
        MAX_FILES: 10, // Step 37: Increased from 5 to support reference-based enhancements
        MAX_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB per file
        ALLOWED_MIME_TYPES: [
          'image/png', 'image/jpeg', 'image/gif', 'image/webp',
          'text/plain', 'application/json', 'application/pdf',
          'text/markdown', 'text/csv'
        ],
        ALLOWED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.json', '.pdf', '.md', '.csv']
      };

      // State
      const state = {
        activeTab: 'mission',
        taskStatus: 'ready',
        currentStage: 'none',
        currentMode: 'ANSWER',
        narrationCards: [],
        // PHASE 1: Pending Attachments State
        pendingAttachments: [], // { id, file, name, size, mimeType, status: 'pending'|'uploading'|'uploaded'|'error', thumbnailUrl?, evidenceId?, errorMsg? }
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
        evidence: {}, // Evidence objects keyed by evidence_id
        evidenceContent: {}, // Cached content keyed by evidence_id
        expandedEvents: new Set(), // Track which event cards are expanded
        selectedModel: 'claude-3-haiku',
        streamingAnswer: null, // { taskId: string, text: string } | null
        counters: {
          filesInScope: 0,
          filesTouched: 0,
          linesIncluded: 0,
          toolCallsUsed: 0,
          toolCallsMax: 100
        },
        // Track optimistic mission start for immediate UI feedback
        missionStartPending: null, // { taskId, missionId } | null
        // Step 30: Logs tab state
        logsFilter: {
          search: '',
          eventType: 'all',
          stage: 'all',
          mode: 'all',
          tool: 'all'
        },
        expandedLogEvents: new Set(), // Track which log rows are expanded
        expandedStreamGroups: new Set(), // Track which stream groups are expanded
        streamGroupViewMode: {} // 'text' | 'raw' per group index
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
      const exportRunBtn = document.getElementById('exportRunBtn');
      const sendStopBtn = document.getElementById('sendStopBtn');
      const attachBtn = document.getElementById('attachBtn');

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

      // Humanize model names for user display
      function humanizeModelName(modelId) {
        if (!modelId) return '';
        const modelMap = {
          'claude-3-haiku': 'Claude 3 Haiku',
          'claude-3-haiku-20240307': 'Claude 3 Haiku',
          'claude-sonnet-4-5': 'Claude Sonnet 4',
          'claude-sonnet-4-20250514': 'Claude Sonnet 4',
          'claude-3-sonnet': 'Claude 3 Sonnet',
          'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
          'claude-3-opus': 'Claude 3 Opus',
          'claude-3-opus-20240229': 'Claude 3 Opus',
          'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
          'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet'
        };
        return modelMap[modelId] || modelId;
      }

      // Update Status Pill
      function updateStatus(status) {
        state.taskStatus = status;
        statusPill.className = 'status-pill ' + status;
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
        stageLabel.textContent = stage === 'none' ? '' : 'Stage: ' + stage;
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

      // ===== APPROVAL SELECTORS =====
      // Deterministic selectors to compute pending approvals from events
      function getPendingApprovals(events) {
        const pendingApprovals = [];
        const resolvedApprovalIds = new Set();

        // First pass: collect all resolved approval IDs
        for (const event of events) {
          if (event.type === 'approval_resolved') {
            const approvalId = event.payload.approval_id;
            if (approvalId) {
              resolvedApprovalIds.add(approvalId);
            }
          }
        }

        // Second pass: find approval_requested events that are not resolved
        for (const event of events) {
          if (event.type === 'approval_requested') {
            const approvalId = event.payload.approval_id;
            if (approvalId && !resolvedApprovalIds.has(approvalId)) {
              pendingApprovals.push({
                approvalId,
                approvalType: event.payload.approval_type,
                requestEvent: event,
                requestedAt: event.timestamp,
              });
            }
          }
        }

        return pendingApprovals;
      }

      function hasPendingApprovals(events) {
        return getPendingApprovals(events).length > 0;
      }

      function getPendingScopeExpansionApproval(events) {
        const pending = getPendingApprovals(events);
        return pending.find(p => p.approvalType === 'scope_expansion') || null;
      }

      // ===== APPROVAL CARD RENDERING =====
      function renderApprovalCard(approvalEvent) {
        const approvalId = approvalEvent.payload.approval_id;
        const approvalType = approvalEvent.payload.approval_type;
        const description = approvalEvent.payload.description || '';
        const details = approvalEvent.payload.details || {};
        const riskLevel = approvalEvent.payload.risk_level;

        // Get risk badge
        let riskBadge = '';
        if (riskLevel) {
          const riskColors = {
            low: 'var(--vscode-charts-green)',
            medium: 'var(--vscode-charts-yellow)',
            high: 'var(--vscode-charts-red)'
          };
          const color = riskColors[riskLevel] || 'var(--vscode-charts-orange)';
          riskBadge = \`<div class="risk-badge" style="background: \${color};">\${riskLevel.toUpperCase()}</div>\`;
        } else {
          // Infer risk from approval type
          if (approvalType === 'terminal') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-red);">HIGH</div>';
          } else if (approvalType === 'apply_diff') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-yellow);">MEDIUM</div>';
          } else if (approvalType === 'scope_expansion') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-green);">LOW</div>';
          }
        }

        // Get summary
        let summary = description;
        if (!summary) {
          if (approvalType === 'terminal') {
            const command = details.command || '';
            summary = command ? \`Execute command: \${command}\` : 'Execute terminal command';
          } else if (approvalType === 'apply_diff') {
            const filesChanged = (details.files_changed || []).length;
            summary = \`Apply diff to \${filesChanged} file(s)\`;
          } else if (approvalType === 'scope_expansion') {
            summary = details.reason || 'Expand scope contract';
          } else {
            summary = 'Approval required';
          }
        }

        // Format approval type
        const typeLabels = {
          terminal: 'Terminal Execution',
          apply_diff: 'Apply Diff',
          scope_expansion: 'Scope Expansion'
        };
        const typeLabel = typeLabels[approvalType] || approvalType;

        // Render details
        let detailsHtml = '';
        if (Object.keys(details).length > 0) {
          if (approvalType === 'terminal') {
            detailsHtml = '<div class="approval-details">';
            if (details.command) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Command:</span><code class="detail-value">\${escapeHtml(details.command)}</code></div>\`;
            }
            if (details.working_dir) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Working Dir:</span><code class="detail-value">\${escapeHtml(details.working_dir)}</code></div>\`;
            }
            detailsHtml += '</div>';
          } else if (approvalType === 'apply_diff') {
            detailsHtml = '<div class="approval-details">';
            if (details.files_changed && details.files_changed.length > 0) {
              // FIX: files_changed is an array of objects {path: string}, not strings
              const fileList = details.files_changed.map(f => {
                if (typeof f === 'string') return f;
                if (f && typeof f === 'object' && f.path) return f.path;
                return '[unknown]';
              }).join(', ');
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Files:</span><span class="detail-value">\${fileList}</span></div>\`;
            }
            if (details.additions !== undefined || details.deletions !== undefined) {
              const changes = [];
              if (details.additions !== undefined) changes.push(\`+\${details.additions}\`);
              if (details.deletions !== undefined) changes.push(\`-\${details.deletions}\`);
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Changes:</span><span class="detail-value">\${changes.join(' ')}</span></div>\`;
            }
            detailsHtml += '</div>';
          } else if (approvalType === 'scope_expansion') {
            detailsHtml = '<div class="approval-details">';
            if (details.reason) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Reason:</span><span class="detail-value">\${escapeHtml(details.reason)}</span></div>\`;
            }
            if (details.requested) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Requested:</span><span class="detail-value">\${JSON.stringify(details.requested, null, 2)}</span></div>\`;
            }
            detailsHtml += '</div>';
          }
        }

        const evidenceCount = approvalEvent.evidence_ids.length;
        const evidenceHtml = evidenceCount > 0 
          ? \`<div class="approval-evidence"><span class="evidence-icon">📎</span><span>\${evidenceCount} evidence item(s) available</span></div>\`
          : '';

        return \`
          <div class="approval-card" data-approval-id="\${approvalId}">
            <div class="approval-card-header">
              <div class="approval-card-header-left">
                <span class="approval-icon">⏸️</span>
                <div class="approval-card-title">
                  <div class="approval-type-label">\${typeLabel}</div>
                  <div class="approval-id">ID: \${approvalId.substring(0, 8)}</div>
                </div>
              </div>
              \${riskBadge}
            </div>
            <div class="approval-card-body">
              <div class="approval-summary">\${escapeHtml(summary)}</div>
              \${detailsHtml}
              \${evidenceHtml}
            </div>
            <div class="approval-card-actions">
              <button class="approval-btn approve" onclick="handleApproval('\${approvalId}', 'approved')">
                ✓ Approve
              </button>
              <button class="approval-btn reject" onclick="handleApproval('\${approvalId}', 'rejected')">
                ✗ Reject
              </button>
            </div>
          </div>
        \`;
      }

      function hydrateScaffoldCards() {
        const cards = missionTab.querySelectorAll('scaffold-card[data-event]');
        console.log('[hydrateScaffoldCards] Found cards:', cards.length);
        console.log('[hydrateScaffoldCards] customElements.get scaffold-card:', !!customElements.get('scaffold-card'));
        
        // If custom element not defined yet, try to wait for it
        if (!customElements.get('scaffold-card') && cards.length > 0) {
          console.log('[hydrateScaffoldCards] Waiting for custom element definition...');
          // Retry after a short delay
          setTimeout(hydrateScaffoldCards, 100);
          return;
        }
        
        cards.forEach((card) => {
          try {
            const eventJson = card.getAttribute('data-event');
            if (!eventJson) {
              console.log('[hydrateScaffoldCards] No event data on card');
              return;
            }
            const eventData = JSON.parse(decodeURIComponent(eventJson));
            console.log('[hydrateScaffoldCards] Setting event data for type:', eventData.type);
            card.event = eventData;
            card.removeAttribute('data-event');
          } catch (error) {
            console.error('[ScaffoldCard] Failed to parse event data:', error);
          }
        });
      }

      // Render Mission Tab - Event Timeline
      function renderMission() {
        missionTab.innerHTML = renderMissionTimeline(state.events);
        hydrateScaffoldCards();
        updateUIGating(); // Update UI gating whenever mission is rendered
        updateExportButtonVisibility(); // Update export button visibility
        updateMissionControlBar(); // Update compact bottom bar for mission progress
      }

      // Render Streaming Answer Card
      function renderStreamingAnswerCard() {
        if (!state.streamingAnswer || !state.streamingAnswer.text) {
          return '';
        }

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-blue); animation: pulse 1.5s ease-in-out infinite;">
            <div class="event-card-header">
              <span class="event-icon" style="color: var(--vscode-charts-blue);">💬</span>
              <span class="event-type">Streaming Answer</span>
              <span class="event-timestamp">⚡ Live</span>
            </div>
            <div class="streaming-answer-content" style="padding-left: 24px; font-size: 13px; line-height: 1.6; color: var(--vscode-foreground); white-space: pre-wrap; word-break: break-word;">\${escapeHtml(state.streamingAnswer.text)}<span style="display: inline-block; width: 2px; height: 16px; background: var(--vscode-charts-blue); margin-left: 2px; animation: blink 1s steps(2, start) infinite;"></span></div>
          </div>
          <style>
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.7; }
            }
            @keyframes blink {
              to { visibility: hidden; }
            }
          </style>
        \`;
      }

      // Mission Timeline Rendering (from MissionFeed component)
      function renderMissionTimeline(events) {
        if (events.length === 0) {
          return '<div class="mission-empty">No mission yet. Start a conversation to begin.</div>';
        }

        const items = [];
        const pendingApprovals = getPendingApprovals(events);

        // OPTIONAL: Show pending approvals summary at the top (not interactive, just FYI)
        if (pendingApprovals.length > 0) {
          items.push(\`<div class="approval-section-header" style="background: var(--vscode-inputValidation-warningBackground); padding: 8px 12px; border-radius: 4px; font-size: 11px; margin-bottom: 12px;">⚠️ \${pendingApprovals.length} Pending Approval(s) - see below in timeline</div>\`);
        }

        // NO top-level Execute Plan button - only inline after execution_paused event

        let currentStage = 'none';

        // Internal/technical events to hide from Mission timeline (still visible in Logs tab)
        const internalEventTypes = new Set([
          'preflight_complete',
          'truncation_detected', 
          'edit_split_triggered',
          'edit_chunk_started',
          'edit_chunk_completed',
          'edit_chunk_failed',
          'edit_step_paused',
          'stale_context_detected',
          'run_scope_initialized',
          'repair_policy_snapshot'
        ]);

        for (const event of events) {
          // Skip rendering stream_delta and stream_complete events entirely
          // These are for real-time updates only, not timeline display
          if (event.type === 'stream_delta' || event.type === 'stream_complete') {
            continue;
          }
          
          // Skip internal/technical events in Mission timeline
          // They're still visible in Logs tab for debugging
          if (internalEventTypes.has(event.type)) {
            continue;
          }
          
          // Insert stage header when stage changes
          if (event.type === 'stage_changed' && event.payload.to) {
            const newStage = event.payload.to;
            if (newStage !== currentStage) {
              items.push(renderStageHeader(newStage));
              currentStage = newStage;
            }
          }

          // Render event card
          items.push(renderEventCard(event));
          
          // INLINE APPROVAL: After approval_requested event, render inline approval card
          if (event.type === 'approval_requested') {
            const approvalId = event.payload.approval_id;
            // Check if this approval is still pending
            const isPending = pendingApprovals.find(p => p.approvalId === approvalId);
            if (isPending) {
              items.push(renderApprovalCard(event));
            }
          }
          
          // INLINE EXECUTE BUTTON: After execution_paused with reason=awaiting_execute_plan, show Execute Plan button inline
          if (event.type === 'execution_paused') {
            const reason = event.payload.reason || '';
            // ONLY show inline button when reason is awaiting_execute_plan (after plan approval)
            if (reason === 'awaiting_execute_plan') {
              items.push(\`
                <div style="margin: 16px 0; padding: 16px; background: var(--vscode-editor-inactiveSelectionBackground); border: 2px solid var(--vscode-charts-green); border-radius: 6px; animation: fadeIn 0.3s ease-in;">
                  <button 
                    onclick="handleExecutePlan()" 
                    style="
                      width: 100%; 
                      padding: 12px 20px; 
                      font-size: 14px; 
                      font-weight: 700; 
                      background: var(--vscode-charts-green); 
                      color: #fff; 
                      border: none; 
                      border-radius: 6px; 
                      cursor: pointer; 
                      transition: all 0.2s ease; 
                      box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
                    " 
                    onmouseover="this.style.transform = 'translateY(-2px)'; this.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.5)';" 
                    onmouseout="this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 2px 8px rgba(40, 167, 69, 0.3)';"
                  >
                    🚀 Execute Plan
                  </button>
                  <div style="text-align: center; margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
                    ✓ Plan approved - Click to begin execution
                  </div>
                </div>
              \`);
            }
          }
          
          // Show streaming answer card after tool_start for llm_answer
          // Only show if we have streaming data AND this is the tool_start event
          if (event.type === 'tool_start' && event.payload.tool === 'llm_answer' && state.streamingAnswer && state.streamingAnswer.text) {
            items.push(renderStreamingAnswerCard());
          }
          
          // MISSION BREAKDOWN: After mission_selected - DO NOT render inline button
          // The compact bottom Mission Control Bar handles the "Start" action now
          // This prevents UX confusion with duplicate CTAs
        }

        return items.join('');
      }

      // REMOVED: renderExecutePlanCTA() - Execute Plan button is now ONLY rendered inline after execution_paused event

      // Render Stage Header
      function renderStageHeader(stage) {
        const stageConfig = {
          plan: { title: 'Planning', icon: '📋', color: 'var(--vscode-charts-purple)' },
          retrieve: { title: 'Retrieval', icon: '🔍', color: 'var(--vscode-charts-blue)' },
          edit: { title: 'Editing', icon: '✏️', color: 'var(--vscode-charts-yellow)' },
          test: { title: 'Testing', icon: '🧪', color: 'var(--vscode-charts-green)' },
          repair: { title: 'Repair', icon: '🔧', color: 'var(--vscode-charts-orange)' },
          none: { title: 'Initializing', icon: '⚡', color: 'var(--vscode-descriptionForeground)' }
        };
        const config = stageConfig[stage] || stageConfig.none;
        return \`
          <div class="stage-header">
            <span class="stage-icon" style="color: \${config.color}">\${config.icon}</span>
            <span class="stage-title">\${config.title}</span>
          </div>
        \`;
      }

      // Render Detailed Plan Card
      function renderPlanCard(event, plan) {
        // Render steps
        const stepsHtml = (plan.steps || []).map((step, index) => {
          // Build step metadata (stage, effort)
          const metadata = [];
          if (step.stage) metadata.push(\`Stage: \${step.stage}\`);
          if (step.estimated_effort) metadata.push(\`Effort: \${step.estimated_effort}\`);
          if (step.expected_evidence && Array.isArray(step.expected_evidence)) {
            metadata.push(...step.expected_evidence);
          }
          
          const metadataHtml = metadata.length > 0 
            ? \`<div style="margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground);">
                <ul style="margin: 0; padding-left: 20px;">
                  \${metadata.map(m => \`<li>\${escapeHtml(m)}</li>\`).join('')}
                </ul>
              </div>\`
            : '';
          
          return \`
            <div style="background: var(--vscode-input-background); padding: 10px; border-radius: 4px; margin-bottom: 8px;">
              <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px;">
                <span style="background: var(--vscode-charts-purple); color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700;">\${index + 1}</span>
                <span style="font-size: 12px; font-weight: 600; flex: 1;">\${escapeHtml(step.description || '')}</span>
              </div>
              \${metadataHtml}
            </div>
          \`;
        }).join('');

        // Render assumptions
        const assumptionsHtml = (plan.assumptions && plan.assumptions.length > 0)
          ? \`<div style="margin-top: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--vscode-descriptionForeground); margin-bottom: 6px;">Assumptions</div>
              <ul style="margin: 0; padding-left: 20px; font-size: 12px;">
                \${plan.assumptions.map(a => \`<li>\${escapeHtml(a)}</li>\`).join('')}
              </ul>
            </div>\`
          : '';

        // Render success criteria
        const criteriaText = typeof plan.success_criteria === 'string' ? plan.success_criteria : (plan.success_criteria || []).join(', ');
        const successCriteriaHtml = criteriaText
          ? \`<div style="margin-top: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--vscode-descriptionForeground); margin-bottom: 6px;">Success Criteria</div>
              <div style="font-size: 12px; padding: 8px; background: var(--vscode-input-background); border-radius: 4px;">\${escapeHtml(criteriaText)}</div>
            </div>\`
          : '';

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-purple); padding: 14px;">
            <div class="event-card-header" style="margin-bottom: 12px;">
              <span class="event-icon" style="color: var(--vscode-charts-purple); font-size: 20px;">📋</span>
              <span class="event-type" style="font-size: 13px; font-weight: 700;">Plan Created</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            
            <div style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-charts-purple); margin-bottom: 8px;">Goal</div>
              <div style="font-size: 13px; line-height: 1.5; color: var(--vscode-foreground);">\${escapeHtml(plan.goal || '')}</div>
            </div>

            \${assumptionsHtml}

            <div style="margin-top: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--vscode-descriptionForeground); margin-bottom: 8px;">Implementation Steps (\${(plan.steps || []).length})</div>
              \${stepsHtml}
            </div>

            \${successCriteriaHtml}

            <div style="margin-top: 16px; display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border);">
              <button 
                onclick="handleRequestPlanApproval('\${event.task_id}', '\${event.event_id}')"
                style="flex: 1; padding: 8px 16px; background: var(--vscode-charts-green); color: #fff; border: none; border-radius: 4px; font-size: 12px; font-weight: 700; cursor: pointer;">
                ✓ Approve Plan → Start Mission
              </button>
              <button 
                onclick="toggleRefinePlanInput('\${event.task_id}', '\${event.event_id}', 1)"
                style="padding: 8px 16px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer;">
                ✏️ Refine Plan
              </button>
              <button 
                onclick="handleCancelPlan('\${event.task_id}')"
                style="padding: 8px 16px; background: transparent; color: var(--vscode-descriptionForeground); border: none; font-size: 12px; cursor: pointer; text-decoration: underline;">
                ✕ Cancel
              </button>
            </div>

            <!-- Refine Plan Input (hidden by default) -->
            <div id="refine-plan-input-\${event.event_id}" style="display: none; margin-top: 16px; padding: 16px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0; color: var(--vscode-charts-purple);">Refine This Plan</h4>
                <button onclick="toggleRefinePlanInput('\${event.task_id}', '\${event.event_id}', 1)" style="background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 16px;">✕</button>
              </div>
              <div style="margin-bottom: 12px;">
                <label for="refinement-instruction-\${event.event_id}" style="font-weight: 500; color: var(--vscode-foreground); display: block; margin-bottom: 6px;">What changes would you like?</label>
                <textarea 
                  id="refinement-instruction-\${event.event_id}"
                  placeholder="Examples:
• Add error handling to each step
• Break step 3 into smaller sub-steps
• Add a testing phase before deployment
• Focus more on security considerations"
                  rows="4"
                  style="width: 100%; padding: 8px 12px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; color: var(--vscode-foreground); font-family: inherit; font-size: 12px; resize: vertical;"
                ></textarea>
              </div>
              <div style="display: flex; gap: 8px;">
                <button 
                  onclick="submitPlanRefinement('\${event.task_id}', '\${event.event_id}', 1)"
                  style="flex: 1; padding: 8px 16px; background: var(--vscode-charts-purple); color: #fff; border: none; border-radius: 4px; font-size: 12px; font-weight: 700; cursor: pointer;">
                  🔄 Generate Refined Plan
                </button>
                <button 
                  onclick="toggleRefinePlanInput('\${event.task_id}', '\${event.event_id}', 1)"
                  style="padding: 8px 16px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                  Cancel
                </button>
              </div>
              <p style="margin-top: 10px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
                ℹ️ Refining will generate a new plan version and require re-approval.
              </p>
            </div>

            <div style="margin-top: 10px; padding: 8px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
              💡 Review this plan carefully before switching to MISSION mode to execute.
            </div>
          </div>
        \`;
      }

      // Render Clarification Card (PLAN mode v2)
      function renderClarificationCard(event) {
        const taskId = event.task_id;
        const options = event.payload.options || [];
        const anchorFilesCount = event.payload.anchor_files_count || 0;
        const fallbackOptionId = event.payload.fallback_option_id || 'fallback-suggest';

        // Build header text based on context quality
        const headerText = anchorFilesCount > 0
          ? \`Based on your project structure • \${anchorFilesCount} relevant files found\`
          : 'Based on project analysis • Limited context available';

        // Build option buttons HTML
        const optionsHtml = options.map(opt => {
          const evidenceText = (opt.evidence || []).length > 0
            ? opt.evidence.slice(0, 3).join(', ')
            : '';
          
          const isSkip = opt.id === fallbackOptionId || opt.id === 'fallback-suggest';
          const buttonClass = isSkip ? 'clarification-btn skip-btn' : 'clarification-btn';
          
          return \`
            <button 
              class="\${buttonClass}" 
              data-option-id="\${escapeHtml(opt.id)}"
              data-task-id="\${escapeHtml(taskId)}"
              onclick="handleClarificationSelect('\${escapeHtml(taskId)}', '\${escapeHtml(opt.id)}')"
            >
              <div class="clarification-btn-content">
                <span class="clarification-btn-title">\${escapeHtml(opt.title)}</span>
                <span class="clarification-btn-desc">\${escapeHtml(opt.description)}</span>
                \${evidenceText ? \`<span class="clarification-btn-evidence">\${escapeHtml(evidenceText)}</span>\` : ''}
              </div>
              <span class="clarification-btn-spinner" style="display: none;">⏳</span>
            </button>
          \`;
        }).join('');

        return \`
          <div class="clarification-card" id="clarification-card-\${escapeHtml(taskId)}" data-state="idle">
            <div class="clarification-card-header">
              <span class="clarification-icon">🎯</span>
              <span class="clarification-title">Choose a Focus Area</span>
            </div>
            <div class="clarification-card-subtitle">
              \${escapeHtml(headerText)}
            </div>
            <div class="clarification-options">
              \${optionsHtml}
            </div>
            <div class="clarification-skip">
              <button 
                class="clarification-skip-link" 
                onclick="handleClarificationSkip('\${escapeHtml(taskId)}')"
              >
                Skip and let me suggest ideas →
              </button>
            </div>
            <div class="clarification-processing" style="display: none;">
              <span class="processing-spinner">⏳</span>
              <span class="processing-text">Generating plan...</span>
            </div>
          </div>
        \`;
      }

      // ===== MISSION BREAKDOWN CARD RENDERERS =====
      // Render Large Plan Detected explanation card
      function renderLargePlanDetectedCard(event) {
        const taskId = event.task_id;
        const reasons = event.payload.reasons || [];
        const metrics = event.payload.metrics || {};
        const stepCount = metrics.stepCount || 0;
        const riskFlags = metrics.riskFlags || [];
        const domains = metrics.domains || [];

        // Build reasons list
        const reasonsHtml = reasons.map(r => \`<li>\${escapeHtml(r)}</li>\`).join('');

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-orange); padding: 16px; background: var(--vscode-inputValidation-warningBackground);">
            <div class="event-card-header" style="margin-bottom: 12px;">
              <span class="event-icon" style="color: var(--vscode-charts-orange); font-size: 20px;">⚠️</span>
              <span class="event-type" style="font-size: 14px; font-weight: 700;">Large Plan Detected</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            
            <div style="background: var(--vscode-editor-background); padding: 12px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid var(--vscode-charts-orange);">
              \${reasons.length > 0 ? \`
                <ul style="margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.6;">
                  \${reasonsHtml}
                </ul>
              \` : '<p style="margin: 0; font-size: 12px;">Plan complexity exceeds safe execution threshold.</p>'}
            </div>

            <div style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 14px; border-radius: 6px; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                <span style="font-size: 16px;">💡</span>
                <span style="font-size: 12px; font-weight: 700; color: var(--vscode-charts-orange);">Why Mission Breakdown?</span>
              </div>
              <div style="font-size: 12px; line-height: 1.6; color: var(--vscode-descriptionForeground);">
                <p style="margin: 0 0 8px 0;">
                  Your plan has <strong>\${stepCount} steps</strong>\${domains.length > 0 ? ' spanning <strong>' + domains.join(', ') + '</strong>' : ''}. 
                  Executing all at once increases the risk of failures that are hard to debug.
                </p>
                <p style="margin: 0 0 8px 0;">
                  We'll group your steps into focused missions that can be executed and verified one at a time:
                </p>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>✓ Each mission is small enough to review carefully</li>
                  <li>✓ You can verify each works before moving on</li>
                  <li>✓ If something fails, you know exactly which mission caused it</li>
                </ul>
                <p style="margin: 10px 0 0 0; font-style: italic;">
                  Your original steps are preserved – just organized into safer execution chunks.
                </p>
              </div>
            </div>

            <div style="text-align: center; padding: 8px; font-size: 11px; color: var(--vscode-descriptionForeground);">
              ⏳ Generating mission breakdown...
            </div>
          </div>
        \`;
      }

      // Render Mission Breakdown interactive selection card
      function renderMissionBreakdownCard(event, events) {
        const taskId = event.task_id;
        const missions = event.payload.missions || [];
        const planStepCount = event.payload.plan_step_count || 0;
        
        // Check if a mission has already been selected
        const selectedMissionEvent = events.find(e => e.type === 'mission_selected');
        const selectedMissionId = selectedMissionEvent?.payload?.mission_id;

        // Determine first mission (recommended) - usually lowest dependency count
        const recommendedMissionId = missions.length > 0 ? missions[0].missionId : null;

        // Build missions HTML
        const missionsHtml = missions.map((mission, idx) => {
          const isRecommended = mission.missionId === recommendedMissionId && idx === 0;
          const isSelected = mission.missionId === selectedMissionId;
          
          // Size badge color
          const sizeColors = { S: 'var(--vscode-charts-green)', M: 'var(--vscode-charts-yellow)', L: 'var(--vscode-charts-orange)' };
          const sizeColor = sizeColors[mission.estimate?.size] || 'var(--vscode-descriptionForeground)';
          
          // Risk badge color
          const riskColors = { low: 'var(--vscode-charts-green)', med: 'var(--vscode-charts-yellow)', high: 'var(--vscode-charts-red)' };
          const riskColor = riskColors[mission.risk?.level] || 'var(--vscode-descriptionForeground)';

          // Included steps summary
          const stepsText = (mission.includedSteps || []).map(s => s.title || s.stepId || 'Step').slice(0, 3).join(', ');
          const stepsOverflow = (mission.includedSteps || []).length > 3 ? \` (+\${mission.includedSteps.length - 3} more)\` : '';

          return \`
            <div style="
              background: \${isSelected ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-editor-background)'};
              border: 2px solid \${isSelected ? 'var(--vscode-charts-green)' : 'var(--vscode-panel-border)'};
              border-radius: 8px;
              padding: 12px;
              margin-bottom: 10px;
              \${isSelected ? 'box-shadow: 0 0 8px rgba(40, 167, 69, 0.3);' : ''}
            ">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 16px;">\${idx === 0 ? '🔐' : idx === 1 ? '💪' : idx === 2 ? '📊' : '🎯'}</span>
                  <span style="font-size: 13px; font-weight: 700; color: var(--vscode-foreground);">\${escapeHtml(mission.title || 'Mission ' + (idx + 1))}</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <span style="padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; background: \${sizeColor}; color: #fff;">\${mission.estimate?.size || 'M'}</span>
                  <span style="padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; background: \${riskColor}; color: #fff;">\${(mission.risk?.level || 'med').toUpperCase()}</span>
                </div>
              </div>
              
              <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; line-height: 1.4;">
                \${escapeHtml(mission.intent || '')}
              </div>

              <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 10px;">
                <strong>Includes:</strong> \${escapeHtml(stepsText)}\${stepsOverflow}
              </div>

              \${isSelected ? \`
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px;">
                  <span style="color: var(--vscode-charts-green);">✅</span>
                  <span style="font-size: 11px; font-weight: 600; color: var(--vscode-charts-green);">Selected</span>
                </div>
              \` : \`
                <button 
                  onclick="handleSelectMission('\${taskId}', '\${mission.missionId}')"
                  style="
                    width: 100%;
                    padding: 8px 16px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s ease;
                  "
                  onmouseover="this.style.background = 'var(--vscode-button-hoverBackground)'"
                  onmouseout="this.style.background = 'var(--vscode-button-background)'"
                >
                  🚀 Select This Mission
                </button>
              \`}

              \${isRecommended && !isSelected ? \`
                <div style="margin-top: 8px; font-size: 10px; color: var(--vscode-charts-green); font-style: italic;">
                  ⭐ Recommended: Foundation for other missions
                </div>
              \` : ''}
            </div>
          \`;
        }).join('');

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-purple); padding: 16px;">
            <div class="event-card-header" style="margin-bottom: 12px;">
              <span class="event-icon" style="color: var(--vscode-charts-purple); font-size: 20px;">🎯</span>
              <span class="event-type" style="font-size: 14px; font-weight: 700;">Mission Breakdown</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            
            <div style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <p style="margin: 0; font-size: 12px; color: var(--vscode-foreground);">
                Your \${planStepCount} steps have been organized into <strong>\${missions.length} focused missions</strong>.
                \${selectedMissionId ? '' : 'Select <strong>ONE mission</strong> to execute:'}
              </p>
            </div>

            <div style="max-height: 400px; overflow-y: auto; padding-right: 8px;">
              \${missionsHtml}
            </div>

            \${!selectedMissionId ? \`
              <div style="margin-top: 12px; padding: 10px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px; font-size: 11px; color: var(--vscode-descriptionForeground);">
                📝 After completing a mission, come back to select the next one.
              </div>
            \` : ''}
          </div>
        \`;
      }

      // Render Start Mission button after selection
      function renderStartMissionButton(selectedMissionEvent, breakdownEvent, taskId) {
        if (!selectedMissionEvent || !breakdownEvent) return '';

        const selectedMissionId = selectedMissionEvent.payload.mission_id;
        const missions = breakdownEvent.payload.missions || [];
        const selectedMission = missions.find(m => m.missionId === selectedMissionId);

        if (!selectedMission) return '';

        return \`
          <div style="margin: 16px 0; padding: 16px; background: var(--vscode-editor-inactiveSelectionBackground); border: 2px solid var(--vscode-charts-green); border-radius: 6px; animation: fadeIn 0.3s ease-in;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <span style="font-size: 18px;">✅</span>
              <span style="font-size: 13px; font-weight: 700; color: var(--vscode-charts-green);">Mission Selected: \${escapeHtml(selectedMission.title)}</span>
            </div>
            <button 
              onclick="handleStartMission('\${taskId}', '\${selectedMissionId}')" 
              style="
                width: 100%; 
                padding: 12px 20px; 
                font-size: 14px; 
                font-weight: 700; 
                background: var(--vscode-charts-green); 
                color: #fff; 
                border: none; 
                border-radius: 6px; 
                cursor: pointer; 
                transition: all 0.2s ease; 
                box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
              " 
              onmouseover="this.style.transform = 'translateY(-2px)'; this.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.5)';" 
              onmouseout="this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 2px 8px rgba(40, 167, 69, 0.3)';"
            >
              🚀 Start Mission: \${escapeHtml(selectedMission.title)}
            </button>
            <div style="text-align: center; margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
              This will execute \${(selectedMission.includedSteps || []).length} step(s). Other missions remain queued.
            </div>
          </div>
        \`;
      }

      // Render Event Card
      function renderEventCard(event) {
        // SCAFFOLD EVENTS: Use ScaffoldCard web component (PRIORITY CHECK)
        const scaffoldEventTypes = [
'scaffold_started',
'scaffold_preflight_started',
          'scaffold_preflight_completed',
          'scaffold_target_chosen',
          'scaffold_proposal_created',
          'scaffold_decision_requested',
          'scaffold_decision_resolved',
          'scaffold_style_selection_requested',
          'scaffold_style_selected',
          'scaffold_apply_started',
          'scaffold_applied',
          'scaffold_blocked',
          'scaffold_completed',
          'scaffold_cancelled',
          // Post-scaffold orchestration events
          'scaffold_progress',
          'design_pack_applied',
          'next_steps_shown',
          'scaffold_final_complete'
        ];
        
        if (scaffoldEventTypes.includes(event.type)) {
          // Use the ScaffoldCard custom element (already defined globally in ScaffoldCard.ts)
          const eventId = event.event_id || 'evt_' + Date.now();
          const cardId = 'scaffold-' + escapeHtml(eventId);
          const eventJson = encodeURIComponent(JSON.stringify(event));

          // Attach event JSON as a data attribute to avoid inline scripts in HTML.
          // Use double quotes for the attribute value to avoid template literal issues
          return '<scaffold-card id="' + cardId + '" data-event="' + eventJson + '"></scaffold-card>';
        }
        
        // Special handling for clarification_presented - render interactive card
        if (event.type === 'clarification_presented') {
          return renderClarificationCard(event);
        }

        // Special handling for clarification_received - simple confirmation
        if (event.type === 'clarification_received') {
          const title = event.payload.title || 'Selection made';
          return \`
            <div class="event-card" style="border-left-color: var(--vscode-charts-green);">
              <div class="event-card-header">
                <span class="event-icon" style="color: var(--vscode-charts-green);">✅</span>
                <span class="event-type">Focus Selected</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">\${escapeHtml(title)}</div>
            </div>
          \`;
        }

        // Special handling for decision_point_needed - render action buttons
        if (event.type === 'decision_point_needed') {
          return renderDecisionPointCard(event);
        }

        // Special handling for plan_large_detected - render explanation card
        if (event.type === 'plan_large_detected') {
          return renderLargePlanDetectedCard(event);
        }

        // Special handling for mission_breakdown_created - render interactive selection card
        if (event.type === 'mission_breakdown_created') {
          return renderMissionBreakdownCard(event, state.events);
        }

        // Special handling for plan_created and plan_revised - render detailed PlanCard
        if (event.type === 'plan_created' || event.type === 'plan_revised') {
          console.log('🔍 [PLAN DEBUG] plan_created event detected!');
          console.log('🔍 [PLAN DEBUG] event.payload:', JSON.stringify(event.payload, null, 2));
          const plan = event.payload;
          console.log('🔍 [PLAN DEBUG] plan object:', plan);
          console.log('🔍 [PLAN DEBUG] plan.goal:', plan?.goal);
          console.log('🔍 [PLAN DEBUG] plan.steps:', plan?.steps);
          console.log('🔍 [PLAN DEBUG] Array.isArray(plan.steps):', Array.isArray(plan?.steps));
          
          if (plan && plan.goal && plan.steps && Array.isArray(plan.steps)) {
            console.log('✅ [PLAN DEBUG] Condition passed! Rendering detailed PlanCard');
            return renderPlanCard(event, plan);
          } else {
            console.log('❌ [PLAN DEBUG] Condition FAILED! Rendering simple card');
            console.log('❌ [PLAN DEBUG] Condition check: plan exists?', !!plan, 'has goal?', !!plan?.goal, 'has steps?', !!plan?.steps, 'is array?', Array.isArray(plan?.steps));
          }
        }

        const config = getEventCardConfig(event.type);
        if (!config) {
          return \`
            <div class="event-card">
              <div class="event-card-header">
                <span class="event-icon">❓</span>
                <span class="event-type">\${event.type}</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">Unknown event type</div>
            </div>
          \`;
        }

        const summary = config.getSummary(event);
        const hasEvidence = event.evidence_ids.length > 0;
        const isApproval = event.type === 'approval_requested';
        const isFailure = event.type.includes('fail') || event.type === 'failure_detected';

        return \`
          <div class="event-card \${isApproval ? 'approval-required' : ''} \${isFailure ? 'failure' : ''}">
            <div class="event-card-header">
              <span class="event-icon" style="color: \${config.color}">\${config.icon}</span>
              <span class="event-type">\${config.title}</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            <div class="event-summary">\${escapeHtml(summary)}</div>
            \${hasEvidence ? \`<div class="event-evidence">📎 \${event.evidence_ids.length} evidence item(s)</div>\` : ''}
          </div>
        \`;
      }

      function renderDecisionPointCard(event) {
        const title = event.payload.title || 'Decision Needed';
        const description = event.payload.description || event.payload.reason || 'Choose an action to continue.';
        const rawOptions = event.payload.options || [];
        const decisionId = event.event_id;
        const taskId = event.task_id;

        const options = rawOptions.map(option => {
          if (typeof option === 'string') {
            return { label: option, action: option, description: '' };
          }
          return {
            label: option.label || option.action || 'Choose',
            action: option.action || option.label || '',
            description: option.description || ''
          };
        });

        const actionsHtml = options.length > 0
          ? options.map(option => {
              return \`
                <button class="approval-btn approve" onclick="handleDecisionPoint('\${escapeJsString(taskId)}', '\${escapeJsString(decisionId)}', '\${escapeJsString(option.action || '')}')">
                  \${escapeHtml(option.label)}
                </button>
              \`;
            }).join('')
          : \`
            <button class="approval-btn approve" onclick="handleDecisionPoint('\${escapeJsString(taskId)}', '\${escapeJsString(decisionId)}', 'continue')">
              Continue
            </button>
          \`;

        const descriptionsHtml = options.some(o => o.description)
          ? \`
            <div class="approval-details">
              \${options.map(o => o.description ? \`<div class="detail-row"><span class="detail-label">\${escapeHtml(o.label)}:</span><span class="detail-value">\${escapeHtml(o.description)}</span></div>\` : '').join('')}
            </div>
          \`
          : '';

        return \`
          <div class="approval-card" data-decision-id="\${escapeHtml(decisionId)}">
            <div class="approval-card-header">
              <div class="approval-card-header-left">
                <span class="approval-icon">🤔</span>
                <div class="approval-card-title">
                  <div class="approval-type-label">\${escapeHtml(title)}</div>
                  <div class="approval-id">ID: \${escapeHtml(String(decisionId).substring(0, 8))}</div>
                </div>
              </div>
            </div>
            <div class="approval-card-body">
              <div class="approval-summary">\${escapeHtml(description)}</div>
              \${descriptionsHtml}
            </div>
            <div class="approval-card-actions">
              \${actionsHtml}
            </div>
          </div>
        \`;
      }

      // Get Event Card Configuration
      function getEventCardConfig(type) {
        const eventCardMap = {
          intent_received: {
            icon: '💬',
            title: 'Intent Received',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => e.payload.prompt || 'User intent captured'
          },
          mode_set: {
            icon: '⚙️',
            title: 'Mode Set',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => \`Mode: \${e.payload.mode || e.mode}\`
          },
          model_fallback_used: {
            icon: '🔄',
            title: 'Model Fallback',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const requested = e.payload.requested_model || e.payload.userSelectedModel || 'unknown';
              const fallback = e.payload.fallback_model || e.payload.actualModel || 'used fallback';
              // If we don't have fallback but have actualModel, show that
              if (!e.payload.fallback_model && e.payload.actualModel) {
                return \`Using: \${fallback}\`;
              }
              return \`\${requested} → \${fallback}\`;
            }
          },
          prompt_assessed: {
            icon: '🔍',
            title: 'Prompt Assessed',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const clarity = e.payload.clarity || 'unknown';
              const intent = e.payload.intent || e.payload.detected_intent || 'plan_like';
              const score = e.payload.clarity_score;
              return \`Clarity: \${clarity}\${score !== undefined ? ' (' + score + ')' : ''} | Intent: \${intent}\`;
            }
          },
          clarification_requested: {
            icon: '❓',
            title: 'Clarification Requested',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const questions = e.payload.questions || [];
              const missingInfo = e.payload.missing_info || [];
              if (questions.length > 0) {
                return \`\${questions.length} question(s) - please provide more details\`;
              }
              if (missingInfo.length > 0) {
                return \`Missing: \${missingInfo.join(', ')}\`;
              }
              return 'Please provide more details';
            }
          },
          clarification_received: {
            icon: '✅',
            title: 'Clarification Received',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.clarification || 'User provided clarification'
          },
          plan_created: {
            icon: '📋',
            title: 'Plan Created',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const steps = e.payload.steps || [];
              const criteria = e.payload.success_criteria;
              return \`\${steps.length} steps\${criteria ? ' | ' + criteria : ''}\`;
            }
          },
          stage_changed: {
            icon: '🔄',
            title: 'Stage Changed',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`\${e.payload.from || 'none'} → \${e.payload.to || e.stage}\`
          },
          final: {
            icon: '✅',
            title: 'Mission Complete',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => (e.payload.success ? '✓ Success' : '✗ Failed')
          },
          retrieval_started: {
            icon: '🔍',
            title: 'Retrieving Context',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const query = e.payload.query;
              return query ? \`Query: \${query.substring(0, 60)}...\` : 'Context retrieval started';
            }
          },
          retrieval_completed: {
            icon: '📄',
            title: 'Context Retrieved',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const count = e.payload.results_count;
              return count ? \`\${count} results found\` : 'Retrieval complete';
            }
          },
          tool_start: {
            icon: '🔧',
            title: 'Tool Started',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const tool = e.payload.tool || e.payload.tool_name || 'unknown';
              const model = e.payload.model;
              const hasContext = e.payload.has_context;
              
              if (tool === 'llm_answer') {
                const humanModel = model ? humanizeModelName(model) : '';
                return \`Answering (\${humanModel || 'LLM'})\${hasContext ? ' · Project-aware' : ''}\`;
              }
              
              const target = e.payload.target;
              return \`\${tool}\${target ? ': ' + target : ''}\`;
            }
          },
          tool_end: {
            icon: '✓',
            title: 'Tool Finished',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const tool = e.payload.tool || e.payload.tool_name || 'unknown';
              const duration = e.payload.duration_ms;
              const success = e.payload.success !== false;
              
              if (tool === 'llm_answer') {
                return \`Answer \${success ? 'completed' : 'failed'}\${duration ? ' (' + Math.round(duration / 1000) + 's)' : ''}\`;
              }
              
              return \`\${tool}\${duration ? ' (' + duration + 'ms)' : ''}\`;
            }
          },
          approval_requested: {
            icon: '⏸️',
            title: 'Approval Required',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const type = e.payload.approval_type || 'action';
              return \`Type: \${type}\`;
            }
          },
          approval_resolved: {
            icon: '▶️',
            title: 'Approval Resolved',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => (e.payload.approved ? '✓ Approved' : '✗ Denied')
          },
          diff_proposed: {
            icon: '📝',
            title: 'Diff Proposed',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const files = e.payload.files_changed || [];
              return \`\${files.length} file(s) to be modified\`;
            }
          },
          checkpoint_created: {
            icon: '💾',
            title: 'Checkpoint Created',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const id = e.payload.checkpoint_id || 'unknown';
              return \`ID: \${id.substring(0, 8)}\`;
            }
          },
          diff_applied: {
            icon: '✅',
            title: 'Diff Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const files = e.payload.files_changed || [];
              const success = e.payload.success !== false;
              return \`\${success ? '✓' : '✗'} \${files.length} file(s) modified\`;
            }
          },
          failure_detected: {
            icon: '❌',
            title: 'Failure Detected',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.error || 'Error occurred'
          },
          execution_paused: {
            icon: '⏸️',
            title: 'Execution Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Paused'
          },
          execution_resumed: {
            icon: '▶️',
            title: 'Execution Resumed',
            color: 'var(--vscode-charts-green)',
            getSummary: () => 'Continuing execution'
          },
          scope_expansion_requested: {
            icon: '🔓',
            title: 'Scope Expansion Requested',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Scope expansion needed'
          },
          scope_expansion_resolved: {
            icon: '🔒',
            title: 'Scope Expansion Resolved',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => (e.payload.approved ? '✓ Approved' : '✗ Denied')
          },
          context_collected: {
            icon: '📚',
            title: 'Project Context Collected',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              // Check if this is PLAN mode light context
              if (e.payload.level === 'light') {
                const filesScanned = e.payload.files_scanned || 0;
                const anchorFiles = (e.payload.anchor_files || []).length;
                const stack = e.payload.stack || 'unknown';
                const todoCount = e.payload.todo_count;
                return \`\${filesScanned} files scanned, \${anchorFiles} anchor files\${stack !== 'unknown' ? ' | Stack: ' + stack : ''}\${todoCount ? ' | TODOs: ' + todoCount : ''}\`;
              }
              // ANSWER mode context
              const filesCount = (e.payload.files_included || []).length;
              const totalLines = e.payload.total_lines || 0;
              const stack = (e.payload.inferred_stack || []).join(', ');
              return \`\${filesCount} files, \${totalLines} lines\${stack ? ' | Stack: ' + stack : ''}\`;
            }
          },
          mission_started: {
            icon: '🚀',
            title: 'Mission Started',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const stepsCount = e.payload.steps_count || 0;
              const goal = e.payload.goal || '';
              return \`\${stepsCount} steps | \${goal}\`;
            }
          },
          step_started: {
            icon: '▶️',
            title: 'Step Started',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const stepIndex = e.payload.step_index || 0;
              const description = e.payload.description || '';
              return \`Step \${stepIndex + 1}: \${description}\`;
            }
          },
          step_completed: {
            icon: '✅',
            title: 'Step Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const success = e.payload.success !== false;
              const stepIndex = e.payload.step_index || 0;
              return \`Step \${stepIndex + 1} \${success ? 'completed successfully' : 'failed'}\`;
            }
          },
          step_failed: {
            icon: '❌',
            title: 'Step Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const stepIndex = e.payload.step_index || 0;
              const error = e.payload.error || 'Step execution failed';
              return \`Step \${stepIndex + 1}: \${error.substring(0, 50)}\`;
            }
          },
          clarification_presented: {
            icon: '🎯',
            title: 'Choose Focus Area',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const options = (e.payload.options || []);
              return \`\${options.length} options available\`;
            }
          },
          clarification_received: {
            icon: '✅',
            title: 'Focus Selected',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.title || 'Selection made'
          },
          plan_revised: {
            icon: '🔄',
            title: 'Plan Revised',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const version = e.payload.plan_version || 2;
              const steps = e.payload.steps || [];
              return \`v\${version} • \${steps.length} steps\`;
            }
          },
          plan_large_detected: {
            icon: '⚠️',
            title: 'Large Plan Detected',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const score = e.payload.score || 0;
              const reasons = e.payload.reasons || [];
              return \`Score: \${score}/100 • \${reasons.length > 0 ? reasons[0] : 'Requires mission breakdown'}\`;
            }
          },
          mission_breakdown_created: {
            icon: '🎯',
            title: 'Mission Breakdown Created',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const missions = e.payload.missions || [];
              return \`\${missions.length} missions generated\`;
            }
          },
          mission_selected: {
            icon: '✅',
            title: 'Mission Selected',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const missionId = e.payload.mission_id || 'unknown';
              return \`Mission: \${missionId.substring(0, 8)}...\`;
            }
          },
          // Step 30: Truncation-Safe Edit Execution Events
          preflight_complete: {
            icon: '✈️',
            title: 'Preflight Complete',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const splitNeeded = e.payload.split_needed;
              const files = (e.payload.target_files || []).length;
              return splitNeeded ? \`Split mode: \${files} files\` : 'Single-call mode';
            }
          },
          truncation_detected: {
            icon: '⚠️',
            title: 'Truncation Detected',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const recovered = e.payload.recovered;
              return recovered ? 'Output truncated (will retry)' : 'Output truncated (recovery failed)';
            }
          },
          edit_split_triggered: {
            icon: '✂️',
            title: 'Split Mode',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const files = (e.payload.files || []).length;
              return \`Processing \${files} file(s) separately\`;
            }
          },
          edit_chunk_started: {
            icon: '📝',
            title: 'Editing File',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const file = e.payload.file || 'unknown';
              const index = e.payload.chunk_index;
              const total = e.payload.total_chunks;
              return \`\${file} (\${index + 1}/\${total})\`;
            }
          },
          edit_chunk_completed: {
            icon: '✅',
            title: 'File Edited',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.file || 'unknown'
          },
          edit_chunk_failed: {
            icon: '❌',
            title: 'Edit Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const file = e.payload.file || 'unknown';
              const error = e.payload.error || '';
              return \`\${file}: \${error.substring(0, 30)}...\`;
            }
          },
          edit_step_paused: {
            icon: '⏸️',
            title: 'Edit Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'awaiting decision'
          },
          // Step 27: Mission Execution Harness Events
          stale_context_detected: {
            icon: '⚠️',
            title: 'Stale Context',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const files = (e.payload.stale_files || []).length;
              return files > 0 ? \`\${files} file(s) changed\` : 'Context may be outdated';
            }
          },
          stage_timeout: {
            icon: '⏱️',
            title: 'Stage Timeout',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const stage = e.payload.stage || 'unknown';
              const duration = e.payload.duration_ms;
              return \`\${stage}\${duration ? ' (' + Math.round(duration/1000) + 's)' : ''}\`;
            }
          },
          repair_attempt_started: {
            icon: '🔧',
            title: 'Repair Started',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`Attempt #\${e.payload.attempt || 1}\`
          },
          repair_attempt_completed: {
            icon: '✓',
            title: 'Repair Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.success ? 'Repair successful' : 'Repair failed'
          },
          repeated_failure_detected: {
            icon: '🔴',
            title: 'Repeated Failure',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => \`\${e.payload.failure_count || 0} consecutive failures\`
          },
          test_started: {
            icon: '🧪',
            title: 'Test Started',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const command = e.payload.command || '';
              return command.length > 40 ? command.substring(0, 40) + '...' : command || 'Running tests';
            }
          },
          test_completed: {
            icon: '✅',
            title: 'Test Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => \`\${e.payload.passed || 0} passed, \${e.payload.failed || 0} failed\`
          },
          test_failed: {
            icon: '❌',
            title: 'Test Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const error = e.payload.error || '';
              return error.length > 50 ? error.substring(0, 50) + '...' : error || 'Tests failed';
            }
          },
          mission_completed: {
            icon: '🎉',
            title: 'Mission Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.success ? '✓ Mission successful' : '✗ Mission failed'
          },
          mission_paused: {
            icon: '⏸️',
            title: 'Mission Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Mission paused'
          },
          mission_cancelled: {
            icon: '⛔',
            title: 'Mission Cancelled',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.reason || 'Mission cancelled'
          },
          // Step 28: Self-Correction Loop Events
          failure_classified: {
            icon: '🔍',
            title: 'Failure Classified',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`Type: \${e.payload.classification || 'unknown'}\`
          },
          decision_point_needed: {
            icon: '🤔',
            title: 'Decision Needed',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => \`\${(e.payload.options || []).length} option(s) available\`
          },
          // Command Execution Events (Step 34.5)
          command_proposed: {
            icon: '💻',
            title: 'Command Proposed',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const cmds = e.payload.commands || [];
              if (cmds.length === 0) return 'No commands proposed';
              const first = cmds[0]?.command || cmds[0] || '';
              return cmds.length === 1 ? first : \`\${cmds.length} commands proposed\`;
            }
          },
          command_started: {
            icon: '▶️',
            title: 'Command Started',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const cmd = e.payload.command || '';
              return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd || 'Running command';
            }
          },
          command_progress: {
            icon: '📄',
            title: 'Command Output',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const output = e.payload.output || e.payload.stdout || e.payload.stderr || '';
              const lines = output.split('\\n').filter(l => l.trim()).length;
              return \`\${lines} line(s) of output\`;
            }
          },
          command_completed: {
            icon: '✅',
            title: 'Command Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const exitCode = e.payload.exit_code;
              const success = exitCode === 0 || e.payload.success;
              return success ? 'Completed successfully' : \`Exit code: \${exitCode}\`;
            }
          },
          command_failed: {
            icon: '❌',
            title: 'Command Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const error = e.payload.error || e.payload.stderr || '';
              return error.length > 50 ? error.substring(0, 50) + '...' : error || 'Command failed';
            }
          },
          // Step 29: Systems Tab Events
          run_scope_initialized: {
            icon: '📋',
            title: 'Scope Initialized',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => \`Max \${e.payload.max_files || 0} files\`
          },
          repair_policy_snapshot: {
            icon: '⚙️',
            title: 'Repair Policy',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => \`Max \${e.payload.max_attempts || 0} attempts\`
          },
          // Step 35 Scaffold Events
          scaffold_started: {
            icon: '🏗️',
            title: 'Scaffold Started',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const userPrompt = e.payload.user_prompt || '';
              // Truncate prompt for display
              if (userPrompt.length > 50) {
                return userPrompt.substring(0, 50) + '...';
              }
              return userPrompt || 'Greenfield project setup';
            }
          },
          scaffold_proposal_created: {
            icon: '📋',
            title: 'Scaffold Proposal Ready',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const summary = e.payload.summary || '';
              // Use the generated summary from scaffoldFlow.ts
              if (summary) {
                return summary.length > 60 ? summary.substring(0, 60) + '...' : summary;
              }
              // Fallback
              const recipe = e.payload.recipe_id || e.payload.recipe || 'TBD';
              const designPack = e.payload.design_pack_id || e.payload.design_pack || '';
              if (recipe === 'TBD' && designPack === 'TBD') {
                return 'Ready for approval - details coming in Step 35.4';
              }
              return designPack ? \`\${recipe} + \${designPack}\` : recipe;
            }
          },
          scaffold_decision_resolved: {
            icon: '✅',
            title: 'Scaffold Decision',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const decision = e.payload.decision || 'proceed';
              const recipe = e.payload.recipe_id || e.payload.recipe || 'auto';
              const nextSteps = e.payload.next_steps || [];
              if (decision === 'cancel') return 'User cancelled scaffold';
              if (decision === 'change_style') return 'Style customization requested';
              return \`Approved • Recipe: \${recipe}\${nextSteps.length ? ' • Next: ' + nextSteps[0] : ''}\`;
            }
          },
          scaffold_approved: {
            icon: '✅',
            title: 'Scaffold Approved',
            color: 'var(--vscode-charts-green)',
            getSummary: () => 'User approved scaffold'
          },
          scaffold_cancelled: {
            icon: '❌',
            title: 'Scaffold Cancelled',
            color: 'var(--vscode-charts-red)',
            getSummary: () => 'User cancelled scaffold'
          },
          scaffold_completed: {
            icon: '🎉',
            title: 'Scaffold Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const status = e.payload.status || 'completed';
              const reason = e.payload.reason || '';
              if (status === 'cancelled') return reason || 'Scaffold cancelled';
              if (status === 'ready_for_step_35_2') return 'Ready for scaffold setup';
              return reason || 'Scaffold completed';
            }
          },
          scaffold_applied: {
            icon: '🎉',
            title: 'Scaffold Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const filesCount = (e.payload.files_created || []).length;
              return \`\${filesCount} files created\`;
            }
          },
          scaffold_failed: {
            icon: '❌',
            title: 'Scaffold Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.error || 'Scaffold failed'
          },
          // Vision Analysis Events (Step 38)
          vision_analysis_started: {
            icon: '👁️',
            title: 'Analyzing References',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const imagesCount = e.payload.images_count || 0;
              const urlsCount = e.payload.urls_count || 0;
              return \`\${imagesCount} images, \${urlsCount} URLs\`;
            }
          },
          vision_analysis_completed: {
            icon: '✅',
            title: 'Reference Analysis Complete',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const status = e.payload.status || 'complete';
              if (status === 'skipped') return 'Skipped: ' + (e.payload.reason || 'disabled');
              if (status === 'error') return 'Error: ' + (e.payload.reason || 'failed');
              return 'Analysis complete';
            }
          },
          reference_tokens_extracted: {
            icon: '🎨',
            title: 'Style Tokens Extracted',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const confidence = e.payload.confidence || 0;
              const moods = (e.payload.moods || []).slice(0, 2).join(', ');
              return \`\${Math.round(confidence * 100)}% confidence\${moods ? ' • ' + moods : ''}\`;
            }
          },
          reference_tokens_used: {
            icon: '✨',
            title: 'Tokens Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const usedIn = e.payload.used_in || 'scaffold';
              const overridesApplied = e.payload.overrides_applied;
              return \`Applied to \${usedIn}\${overridesApplied ? ' (with overrides)' : ''}\`;
            }
          }
        };
        return eventCardMap[type];
      }

      // Escape HTML
      function escapeHtml(text) {
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function escapeJsString(value) {
        const backslash = String.fromCharCode(92);
        return String(value)
          .split(backslash).join(backslash + backslash)
          .split("'").join(backslash + "'");
      }

      // ===== SYSTEMS VIEW MODEL REDUCER (Inline for webview) =====
      function reduceToSystemsViewModel(events) {
        const vm = {
          status: { mission: null, stage: 'none', runStatus: 'idle', pausedReason: null, currentStep: null },
          waitingFor: { pendingApprovals: [], pendingDecisionPoints: [] },
          scope: { workspaceRoots: [], allowedCreateRoots: [], deniedPatterns: [], approvedExpansions: [], limits: {} },
          contextIncluded: { retrievedFiles: [], tokenEstimate: 0, totalLines: 0, totalCharacters: 0 },
          changes: { lastDiffProposed: null, lastDiffApplied: null, filesChangedTotal: [], checkpointsCreated: 0 },
          testsAndRepair: { lastTestRun: null, testsPassed: 0, testsFailed: 0, repairAttempts: { used: 0, remaining: 3, max: 3 }, allowlistedCommands: [] },
          toolActivity: { counts: {}, totalCalls: 0, lastToolCall: null },
          timeouts: { stageTimeoutMs: 300000, lastTimeout: null, timeoutCount: 0 }
        };
        
        const resolvedApprovalIds = new Set();
        const resolvedDecisionIds = new Set();
        
        for (const event of events) {
          const p = event.payload || {};
          switch (event.type) {
            case 'mission_started': vm.status.mission = p.goal || p.mission_id || 'active'; vm.status.runStatus = 'running'; break;
            case 'mission_completed': vm.status.runStatus = 'completed'; break;
            case 'mission_paused': vm.status.runStatus = 'paused'; vm.status.pausedReason = p.reason || 'paused'; break;
            case 'mission_cancelled': vm.status.runStatus = 'cancelled'; break;
            case 'execution_paused': vm.status.runStatus = 'paused'; vm.status.pausedReason = p.reason || 'paused'; break;
            case 'execution_resumed': vm.status.runStatus = 'running'; vm.status.pausedReason = null; break;
            case 'stage_changed': vm.status.stage = p.to || event.stage || 'none'; break;
            case 'step_started': vm.status.currentStep = { index: p.step_index, description: p.description }; break;
            case 'step_completed': vm.status.currentStep = null; break;
            case 'run_scope_initialized': vm.scope.workspaceRoots = p.workspace_roots || []; vm.scope.limits = p.limits || {}; break;
            case 'scope_expansion_resolved': if (p.approved) vm.scope.approvedExpansions.push(p); break;
            case 'retrieval_completed':
              vm.contextIncluded.retrievedFiles = (p.results || []).map(r => ({ path: r.path, lines: r.lines || r.excerpt?.split('\\n').length || 0 }));
              vm.contextIncluded.tokenEstimate = p.tokenEstimate || 0;
              vm.contextIncluded.totalCharacters = p.totalCharacters || 0;
              break;
            case 'context_collected':
              vm.contextIncluded.totalLines = p.total_lines || 0;
              vm.contextIncluded.retrievedFiles = (p.files_included || []).map(f => ({ path: f.path || f, lines: f.lines || 0 }));
              break;
            case 'approval_requested': vm.waitingFor.pendingApprovals.push({ id: p.approval_id, type: p.approval_type, description: p.description }); break;
            case 'approval_resolved': resolvedApprovalIds.add(p.approval_id); break;
            case 'decision_point_needed': vm.waitingFor.pendingDecisionPoints.push({ id: p.decision_id, question: p.question }); break;
            case 'clarification_received': resolvedDecisionIds.add(p.decision_id); break;
            case 'diff_proposed': vm.changes.lastDiffProposed = { diffId: p.diff_id, files: p.files_changed || [] }; break;
            case 'diff_applied':
              vm.changes.lastDiffApplied = { diffId: p.diff_id, files: p.files_changed || [] };
              (p.files_changed || []).forEach(f => { const path = typeof f === 'string' ? f : f.path; if (path && !vm.changes.filesChangedTotal.includes(path)) vm.changes.filesChangedTotal.push(path); });
              break;
            case 'checkpoint_created': vm.changes.checkpointsCreated++; break;
            case 'test_completed':
              vm.testsAndRepair.lastTestRun = { passed: p.passed, failed: p.failed, timestamp: event.timestamp };
              vm.testsAndRepair.testsPassed = p.passed || 0;
              vm.testsAndRepair.testsFailed = p.failed || 0;
              break;
            case 'repair_attempt_started': vm.testsAndRepair.repairAttempts.used++; vm.testsAndRepair.repairAttempts.remaining = Math.max(0, vm.testsAndRepair.repairAttempts.max - vm.testsAndRepair.repairAttempts.used); break;
            case 'repair_policy_snapshot': vm.testsAndRepair.repairAttempts.max = p.max_attempts || 3; vm.testsAndRepair.allowlistedCommands = p.allowlisted_commands || []; break;
            case 'tool_start':
              vm.toolActivity.totalCalls++;
              vm.toolActivity.counts[p.tool] = (vm.toolActivity.counts[p.tool] || 0) + 1;
              vm.toolActivity.lastToolCall = { tool: p.tool, timestamp: event.timestamp };
              break;
            case 'stage_timeout': vm.timeouts.lastTimeout = { stage: p.stage, at: event.timestamp }; vm.timeouts.timeoutCount++; break;
          }
        }
        // Filter resolved approvals/decisions
        vm.waitingFor.pendingApprovals = vm.waitingFor.pendingApprovals.filter(a => !resolvedApprovalIds.has(a.id));
        vm.waitingFor.pendingDecisionPoints = vm.waitingFor.pendingDecisionPoints.filter(d => !resolvedDecisionIds.has(d.id));
        return vm;
      }

      // Render Systems Tab with all 8 sections
      function renderSystemsTab() {
        const vm = reduceToSystemsViewModel(state.events);
        const container = document.getElementById('systemsContent');
        if (!container) return;
        
        // Build HTML for all 8 sections
        let html = '';
        
        // 1. STATUS SECTION
        const statusBadgeClass = vm.status.runStatus || 'idle';
        const stageDisplay = vm.status.stage !== 'none' ? vm.status.stage : '—';
        html += \`
          <div class="systems-section">
            <div class="systems-section-title"><span class="systems-section-icon">📊</span> Status</div>
            <div class="systems-row"><span class="systems-label">Run Status</span><span class="systems-badge \${statusBadgeClass}">\${statusBadgeClass.toUpperCase()}</span></div>
            <div class="systems-row"><span class="systems-label">Stage</span><span class="systems-value">\${stageDisplay}</span></div>
            \${vm.status.mission ? \`<div class="systems-row"><span class="systems-label">Mission</span><span class="systems-value">\${escapeHtml(String(vm.status.mission).substring(0, 50))}</span></div>\` : ''}
            \${vm.status.pausedReason ? \`<div class="systems-row"><span class="systems-label">Paused</span><span class="systems-value warning">\${escapeHtml(vm.status.pausedReason)}</span></div>\` : ''}
            \${vm.status.currentStep ? \`<div class="systems-row"><span class="systems-label">Current Step</span><span class="systems-value">\${vm.status.currentStep.index + 1}: \${escapeHtml(vm.status.currentStep.description || '')}</span></div>\` : ''}
          </div>
        \`;
        
        // 2. WAITING FOR SECTION
        const hasPending = vm.waitingFor.pendingApprovals.length > 0 || vm.waitingFor.pendingDecisionPoints.length > 0;
        if (hasPending) {
          html += \`<div class="systems-section" style="border-color: var(--vscode-inputValidation-warningBorder);">
            <div class="systems-section-title" style="color: var(--vscode-charts-yellow);"><span class="systems-section-icon">⏳</span> Waiting For</div>\`;
          vm.waitingFor.pendingApprovals.forEach(a => {
            html += \`<div class="systems-pending-item"><div class="systems-pending-type">\${escapeHtml(a.type || 'approval')}</div><div class="systems-pending-desc">\${escapeHtml(a.description || 'Pending approval')}</div></div>\`;
          });
          vm.waitingFor.pendingDecisionPoints.forEach(d => {
            html += \`<div class="systems-pending-item"><div class="systems-pending-type">Decision Needed</div><div class="systems-pending-desc">\${escapeHtml(d.question || 'Awaiting input')}</div></div>\`;
          });
          html += \`</div>\`;
        }
        
        // 3. SCOPE SECTION
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">📁</span> Scope</div>
          <div class="systems-row"><span class="systems-label">Workspace Roots</span><span class="systems-value">\${vm.scope.workspaceRoots.length || 1}</span></div>
          \${vm.scope.limits.max_files ? \`<div class="systems-row"><span class="systems-label">Max Files</span><span class="systems-value">\${vm.scope.limits.max_files}</span></div>\` : ''}
          \${vm.scope.limits.max_lines ? \`<div class="systems-row"><span class="systems-label">Max Lines</span><span class="systems-value">\${vm.scope.limits.max_lines}</span></div>\` : ''}
          \${vm.scope.approvedExpansions.length > 0 ? \`<div class="systems-row"><span class="systems-label">Approved Expansions</span><span class="systems-value success">\${vm.scope.approvedExpansions.length}</span></div>\` : ''}
        </div>\`;
        
        // 4. CONTEXT INCLUDED SECTION
        const topFiles = vm.contextIncluded.retrievedFiles.slice(0, 5);
        const hasMoreFiles = vm.contextIncluded.retrievedFiles.length > 5;
        const tokenDisplay = vm.contextIncluded.tokenEstimate ? \`~\${Math.round(vm.contextIncluded.tokenEstimate / 1000)}k tokens\` : '';
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">📄</span> Context Included</div>
          <div class="systems-counters">
            <div class="counter-box"><div class="counter-label">Files</div><div class="counter-value">\${vm.contextIncluded.retrievedFiles.length}</div></div>
            <div class="counter-box"><div class="counter-label">Lines</div><div class="counter-value">\${vm.contextIncluded.totalLines}</div></div>
          </div>
          \${tokenDisplay ? \`<div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Token Estimate</span><span class="systems-value">\${tokenDisplay}</span></div>\` : ''}
          \${topFiles.length > 0 ? \`<div class="systems-file-list" style="margin-top: 8px;">\${topFiles.map(f => \`<div class="systems-file-item"><span class="systems-file-path">\${escapeHtml(f.path)}</span><span class="systems-file-lines">\${f.lines} lines</span></div>\`).join('')}</div>\` : ''}
          \${hasMoreFiles ? \`<button class="systems-show-all" onclick="alert('Full file list: ' + JSON.stringify(\${JSON.stringify(vm.contextIncluded.retrievedFiles.map(f => f.path))}))">Show all \${vm.contextIncluded.retrievedFiles.length} files</button>\` : ''}
        </div>\`;
        
        // 5. CHANGES SECTION
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">✏️</span> Changes</div>
          <div class="systems-counters">
            <div class="counter-box"><div class="counter-label">Files Changed</div><div class="counter-value">\${vm.changes.filesChangedTotal.length}</div></div>
            <div class="counter-box"><div class="counter-label">Checkpoints</div><div class="counter-value">\${vm.changes.checkpointsCreated}</div></div>
          </div>
          \${vm.changes.lastDiffApplied ? \`<div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Last Diff</span><span class="systems-value success">Applied (\${vm.changes.lastDiffApplied.files.length} files)</span></div>\` : ''}
          \${vm.changes.lastDiffProposed && !vm.changes.lastDiffApplied ? \`<div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Pending Diff</span><span class="systems-value warning">Proposed (\${vm.changes.lastDiffProposed.files.length} files)</span></div>\` : ''}
        </div>\`;
        
        // 6. TESTS & REPAIR SECTION
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">🧪</span> Tests & Repair</div>
          <div class="systems-counters">
            <div class="counter-box"><div class="counter-label">Tests Passed</div><div class="counter-value \${vm.testsAndRepair.testsPassed > 0 ? 'success' : ''}">\${vm.testsAndRepair.testsPassed}</div></div>
            <div class="counter-box"><div class="counter-label">Tests Failed</div><div class="counter-value \${vm.testsAndRepair.testsFailed > 0 ? 'error' : ''}">\${vm.testsAndRepair.testsFailed}</div></div>
          </div>
          <div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Repair Attempts</span><span class="systems-value">\${vm.testsAndRepair.repairAttempts.used} / \${vm.testsAndRepair.repairAttempts.max}</span></div>
          \${vm.testsAndRepair.repairAttempts.remaining === 0 ? \`<div class="systems-row"><span class="systems-label">Status</span><span class="systems-value error">No repairs remaining</span></div>\` : ''}
        </div>\`;
        
        // 7. TOOL ACTIVITY SECTION
        const toolNames = Object.keys(vm.toolActivity.counts);
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">🔧</span> Tool Activity</div>
          <div class="systems-row"><span class="systems-label">Total Calls</span><span class="systems-value">\${vm.toolActivity.totalCalls}</span></div>
          \${toolNames.length > 0 ? \`<div class="systems-tool-grid" style="margin-top: 8px;">\${toolNames.map(t => \`<div class="systems-tool-item"><div class="systems-tool-name">\${escapeHtml(t)}</div><div class="systems-tool-count">\${vm.toolActivity.counts[t]}</div></div>\`).join('')}</div>\` : ''}
          \${vm.toolActivity.lastToolCall ? \`<div class="systems-row" style="margin-top: 8px;"><span class="systems-label">Last Tool</span><span class="systems-value">\${escapeHtml(vm.toolActivity.lastToolCall.tool)}</span></div>\` : ''}
        </div>\`;
        
        // 8. TIMEOUTS SECTION
        html += \`<div class="systems-section">
          <div class="systems-section-title"><span class="systems-section-icon">⏱️</span> Timeouts</div>
          <div class="systems-row"><span class="systems-label">Stage Timeout</span><span class="systems-value">\${Math.round(vm.timeouts.stageTimeoutMs / 1000)}s</span></div>
          <div class="systems-row"><span class="systems-label">Timeout Count</span><span class="systems-value \${vm.timeouts.timeoutCount > 0 ? 'warning' : ''}">\${vm.timeouts.timeoutCount}</span></div>
          \${vm.timeouts.lastTimeout ? \`<div class="systems-row"><span class="systems-label">Last Timeout</span><span class="systems-value warning">\${escapeHtml(vm.timeouts.lastTimeout.stage)}</span></div>\` : ''}
        </div>\`;
        
        container.innerHTML = html;
      }

      // Legacy function for backward compatibility
      function renderSystemsCounters() {
        renderSystemsTab();
      }

      // ===== STEP 30: LOGS TAB - RAW DEBUG SURFACE =====
      // Render Logs Tab with filters, search, expandable rows, evidence_ids
      function renderLogs() {
        const logsStats = document.getElementById('logsStats');
        const typeFilter = document.getElementById('logsTypeFilter');
        
        if (state.events.length === 0) {
          eventLogList.innerHTML = '<div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 20px;">No events yet.</div>';
          if (logsStats) logsStats.textContent = '0 events';
          return;
        }

        // Populate type filter dynamically from events
        const eventTypes = [...new Set(state.events.map(e => e.type))].sort();
        if (typeFilter && typeFilter.options.length <= 1) {
          eventTypes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            typeFilter.appendChild(opt);
          });
        }

        // Apply filters
        let filtered = state.events.filter(e => {
          const f = state.logsFilter;
          if (f.eventType !== 'all' && e.type !== f.eventType) return false;
          if (f.stage !== 'all' && e.stage !== f.stage) return false;
          if (f.mode !== 'all' && e.mode !== f.mode) return false;
          if (f.search) {
            const q = f.search.toLowerCase();
            const typeMatch = e.type.toLowerCase().includes(q);
            const payloadMatch = JSON.stringify(e.payload).toLowerCase().includes(q);
            if (!typeMatch && !payloadMatch) return false;
          }
          return true;
        });

        // Group consecutive stream_delta events (UI-only grouping)
        const grouped = [];
        let streamGroup = null;
        let groupIndex = 0;
        
        for (const event of filtered) {
          if (event.type === 'stream_delta' || event.type === 'stream_complete') {
            if (!streamGroup) {
              streamGroup = { type: 'stream_group', events: [event], groupIndex: groupIndex++ };
            } else {
              streamGroup.events.push(event);
            }
          } else {
            if (streamGroup) { grouped.push(streamGroup); streamGroup = null; }
            grouped.push({ ...event, groupIndex: groupIndex++ });
          }
        }
        if (streamGroup) grouped.push(streamGroup);

        // Update stats
        if (logsStats) logsStats.textContent = \`\${filtered.length} of \${state.events.length} events\`;

        // Render
        eventLogList.innerHTML = grouped.map((item, idx) => {
          if (item.type === 'stream_group') {
            const isExpanded = state.expandedStreamGroups.has(idx);
            const accumulated = item.events.filter(e => e.type === 'stream_delta').map(e => e.payload.delta || '').join('');
            return \`
              <div class="event-log-item stream-group \${isExpanded ? 'expanded' : ''}" data-group-idx="\${idx}" onclick="toggleStreamGroup(\${idx})">
                <div class="log-row-header">
                  <span class="log-expand-icon">\${isExpanded ? '▼' : '▶'}</span>
                  <span class="event-log-type">stream_delta</span>
                  <span class="stream-group-badge">×\${item.events.length}</span>
                  <div class="event-log-meta"></div>
                  <span class="event-log-timestamp">\${formatTime(item.events[0].timestamp)}</span>
                </div>
                <div class="log-payload-container" style="display:\${isExpanded ? 'block' : 'none'};">
                  <div class="stream-group-content">\${escapeHtml(accumulated)}</div>
                  <button class="log-copy-btn" onclick="copyToClipboard(this, \${JSON.stringify(accumulated).replace(/"/g, '&quot;')})">📋 Copy Text</button>
                </div>
              </div>
            \`;
          }

          // Regular event
          const isExpanded = state.expandedLogEvents.has(item.event_id);
          const toolName = item.payload?.tool || item.payload?.tool_name || null;
          const evidenceIds = item.evidence_ids || [];
          
          return \`
            <div class="event-log-item \${isExpanded ? 'expanded' : ''}" data-event-id="\${item.event_id}" onclick="toggleLogEvent('\${item.event_id}')">
              <div class="log-row-header">
                <span class="log-expand-icon">\${isExpanded ? '▼' : '▶'}</span>
                <span class="event-log-type">\${item.type}</span>
                <div class="event-log-meta">
                  <span class="log-badge mode">\${item.mode}</span>
                  <span class="log-badge stage">\${item.stage}</span>
                  \${toolName ? \`<span class="log-badge tool">\${toolName}</span>\` : ''}
                </div>
                <span class="event-log-timestamp">\${formatTime(item.timestamp)}</span>
              </div>
              \${evidenceIds.length > 0 ? \`
                <div class="log-evidence-ids">
                  \${evidenceIds.map(id => \`<span class="evidence-token" onclick="event.stopPropagation(); copyEvidenceId('\${id}', this)" title="Click to copy"><span class="evidence-token-icon">📎</span>\${id.substring(0, 10)}...</span>\`).join('')}
                </div>
              \` : ''}
              <div class="log-payload-container" style="display:\${isExpanded ? 'block' : 'none'};">
                <pre class="log-payload-pre">\${escapeHtml(JSON.stringify(item, null, 2))}</pre>
                <button class="log-copy-btn" onclick="event.stopPropagation(); copyEventJson('\${item.event_id}')">📋 Copy JSON</button>
              </div>
            </div>
          \`;
        }).join('');
      }

      // Toggle log event expansion
      window.toggleLogEvent = function(eventId) {
        if (state.expandedLogEvents.has(eventId)) {
          state.expandedLogEvents.delete(eventId);
        } else {
          state.expandedLogEvents.add(eventId);
        }
        renderLogs();
      };

      // Toggle stream group expansion
      window.toggleStreamGroup = function(groupIdx) {
        if (state.expandedStreamGroups.has(groupIdx)) {
          state.expandedStreamGroups.delete(groupIdx);
        } else {
          state.expandedStreamGroups.add(groupIdx);
        }
        renderLogs();
      };

      // Copy evidence ID to clipboard
      window.copyEvidenceId = function(id, el) {
        navigator.clipboard.writeText(id).then(() => {
          el.classList.add('evidence-token-copied');
          setTimeout(() => el.classList.remove('evidence-token-copied'), 1000);
        });
      };

      // Copy event JSON to clipboard
      window.copyEventJson = function(eventId) {
        const event = state.events.find(e => e.event_id === eventId);
        if (event) {
          navigator.clipboard.writeText(JSON.stringify(event, null, 2));
        }
      };

      // Copy text to clipboard
      window.copyToClipboard = function(btn, text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btn.textContent;
          btn.textContent = '✓ Copied!';
          setTimeout(() => btn.textContent = orig, 1000);
        });
      };

      // Setup logs filter listeners
      function setupLogsFilters() {
        const searchInput = document.getElementById('logsSearchInput');
        const typeFilter = document.getElementById('logsTypeFilter');
        const stageFilter = document.getElementById('logsStageFilter');
        const modeFilter = document.getElementById('logsModeFilter');
        
        if (searchInput) {
          searchInput.addEventListener('input', (e) => {
            state.logsFilter.search = e.target.value;
            renderLogs();
          });
        }
        if (typeFilter) {
          typeFilter.addEventListener('change', (e) => {
            state.logsFilter.eventType = e.target.value;
            renderLogs();
          });
        }
        if (stageFilter) {
          stageFilter.addEventListener('change', (e) => {
            state.logsFilter.stage = e.target.value;
            renderLogs();
          });
        }
        if (modeFilter) {
          modeFilter.addEventListener('change', (e) => {
            state.logsFilter.mode = e.target.value;
            renderLogs();
          });
        }
      }
      
      // Call setup after DOM ready
      setTimeout(setupLogsFilters, 100);

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

      // Handle Send - Send to backend extension
      sendBtn.addEventListener('click', async () => {
        const prompt = promptInput.value.trim();
        if (!prompt) return;

        // Clear input immediately
        promptInput.value = '';
        autoResizeTextarea();

        // Clear previous streaming answer when starting new task
        state.streamingAnswer = null;

        // PHASE 4: Upload all pending attachments BEFORE sending prompt
        let attachmentRefs = [];
        if (state.pendingAttachments.length > 0) {
          console.log('[Attachments] Uploading', state.pendingAttachments.length, 'pending attachments...');
          updateStatus('running'); // Show running while uploading
          
          const uploadResult = await uploadAllPendingAttachments();
          
          if (!uploadResult.success) {
            console.error('[Attachments] Some uploads failed:', uploadResult.failed);
            // Continue with successfully uploaded attachments
          }
          
          // Get refs for all successfully uploaded attachments
          attachmentRefs = getAttachmentRefs();
          console.log('[Attachments] Attachment refs to send:', attachmentRefs.length);
        }

        // Send to extension backend - it will emit all events
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:submitPrompt',
            text: prompt,
            userSelectedMode: state.currentMode,
            modelId: state.selectedModel,
            // PHASE 4: Include attachment references in submit payload
            attachments: attachmentRefs
          });
          
          // Clear attachments after successful send
          clearAttachments();
          
          // Update UI to show we're processing
          updateStatus('running');
        } else {
          // Fallback for standalone testing
          console.log('Demo mode: would submit', { prompt, mode: state.currentMode, model: state.selectedModel, attachments: attachmentRefs });
          clearAttachments();
          alert('Extension backend not available. Running in demo mode.');
        }
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
      });

      // Handle Model Change
      modelSelect.addEventListener('change', () => {
        state.selectedModel = modelSelect.value;
        // Update model hint text
        const modelHint = document.getElementById('modelHint');
        if (modelHint) {
          const hints = {
            'claude-3-haiku': 'Fast / lightweight',
            'claude-sonnet-4-5': 'Best for building features / multi-file changes'
          };
          modelHint.textContent = hints[modelSelect.value] || '';
        }
      });

      // ===== MESSAGE HANDLERS FROM BACKEND =====
      // Listen for messages from extension backend
      if (typeof vscode !== 'undefined') {
        window.addEventListener('message', event => {
          const message = event.data;
          
          switch (message.type) {
            case 'ordinex:eventsUpdate':
              console.log('');
              console.log('[EVENTS] ╔════════════════════════════════════════╗');
              console.log('[EVENTS] ║  📨 EVENTS UPDATE FROM BACKEND        ║');
              console.log('[EVENTS] ╚════════════════════════════════════════╝');
              
              // Backend sent updated events - replace our state
              if (message.events) {
                console.log('[EVENTS] Received', message.events.length, 'events');
                console.log('[EVENTS] Previous events count:', state.events.length);
                
                // Log last 3 events for debugging
                const lastThree = message.events.slice(-3);
                console.log('[EVENTS] Last 3 events:');
                lastThree.forEach((e, idx) => {
                  console.log(\`[EVENTS]   \${idx + 1}. \${e.type}\`, e.payload?.mission_id ? \`(mission: \${e.payload.mission_id.substring(0, 8)}...)\` : '');
                });
                
                state.events = message.events;
                console.log('[EVENTS] ✓ Events state updated');
                
                // CRITICAL: Update Mission Control Bar BEFORE clearing optimistic state
                // This ensures the UI reflects the running state from actual events
                console.log('[EVENTS] 🔄 Calling updateMissionControlBar()...');
                updateMissionControlBar();
                console.log('[EVENTS] ✓ updateMissionControlBar() completed');
                
                // Then clear optimistic mission start if we received actual mission_started event
                // Do this AFTER UI update so we don't lose the running indicator
                if (state.missionStartPending) {
                  console.log('[EVENTS] Checking if should clear optimistic state...');
                  console.log('[EVENTS] Looking for mission_started with ID:', state.missionStartPending.missionId);
                  const actualStart = message.events.find(e => 
                    e.type === 'mission_started' && 
                    e.payload?.mission_id === state.missionStartPending.missionId
                  );
                  if (actualStart) {
                    console.log('[EVENTS] ✓ Found actual mission_started event, clearing optimistic state');
                    state.missionStartPending = null;
                  } else {
                    console.log('[EVENTS] ⚠️ No matching mission_started event found yet');
                  }
                }
                
                // Update counters from events (Systems tab)
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
                  
                  // Track retrieval_completed (MISSION mode)
                  if (event.type === 'retrieval_completed') {
                    const count = event.payload.results_count || 0;
                    state.counters.filesInScope = Math.max(state.counters.filesInScope, count);
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
                
                renderMission();
                renderLogs();
                renderSystemsCounters(); // Update Systems tab
                
                // AUTO-SCROLL: Scroll to bottom of content area when new events arrive
                // This keeps the latest event visible during mission execution
                setTimeout(() => {
                  const contentArea = document.querySelector('.content');
                  if (contentArea) {
                    contentArea.scrollTop = contentArea.scrollHeight;
                  }
                }, 100); // Small delay to ensure rendering is complete
                
                // Update status based on last event
                const lastEvent = state.events[state.events.length - 1];
                if (lastEvent) {
                  if (lastEvent.type === 'final') {
                    updateStatus('ready');
                  } else if (lastEvent.type === 'failure_detected') {
                    updateStatus('error');
                  } else if (lastEvent.type === 'tool_end' && lastEvent.payload.tool === 'llm_answer') {
                    updateStatus('ready');
                  }
                }
              }
              break;

            case 'ordinex:streamDelta':
              // LLM is streaming - accumulate text
              console.log('Stream delta:', message.delta);
              
              // Initialize streaming answer if needed
              if (!state.streamingAnswer) {
                state.streamingAnswer = {
                  taskId: message.task_id || 'unknown',
                  text: ''
                };
              }
              
              // Accumulate text
              state.streamingAnswer.text += message.delta;
              
              // CRITICAL: Update ONLY the streaming text content, don't re-render entire timeline
              // Find the streaming answer content div and update it directly
              const streamingContentDiv = missionTab.querySelector('.streaming-answer-content');
              if (streamingContentDiv) {
                streamingContentDiv.textContent = state.streamingAnswer.text;
              }
              break;

            case 'ordinex:streamComplete':
              // LLM streaming finished
              console.log('Stream complete');
              
              // Mark as complete but don't clear yet
              // It will be cleared when events update arrives
              if (state.streamingAnswer) {
                state.streamingAnswer.isComplete = true;
              }
              
              // Re-render to show completion state
              renderMission();
              
              updateStatus('ready');
              break;

            case 'ordinex:exportComplete':
              if (message.success) {
                console.log('Export completed:', message.zipPath);
              } else {
                console.error('Export failed:', message.error);
              }
              break;

            case 'ordinex:attachmentUploaded':
              // Attachment upload completed successfully
              console.log('Attachment uploaded:', message.attachmentId, message.evidenceId);
              {
                const pendingUpload = window.__pendingAttachmentUploads && window.__pendingAttachmentUploads[message.attachmentId];
                if (pendingUpload) {
                  const { resolve, attachment } = pendingUpload;
                  attachment.status = 'uploaded';
                  attachment.evidenceId = message.evidenceId;
                  renderAttachments();
                  resolve({ success: true, evidenceId: message.evidenceId });
                  delete window.__pendingAttachmentUploads[message.attachmentId];
                }
              }
              break;

            case 'ordinex:attachmentError':
              // Attachment upload failed
              console.error('Attachment upload error:', message.attachmentId, message.error);
              {
                const pendingUpload = window.__pendingAttachmentUploads && window.__pendingAttachmentUploads[message.attachmentId];
                if (pendingUpload) {
                  const { resolve, attachment } = pendingUpload;
                  attachment.status = 'error';
                  attachment.errorMsg = message.error || 'Upload failed';
                  renderAttachments();
                  showToast(attachment.errorMsg);
                  resolve({ success: false, error: attachment.errorMsg });
                  delete window.__pendingAttachmentUploads[message.attachmentId];
                }
              }
              break;

            default:
              console.log('Unknown message from backend:', message.type);
          }
        });
      }

      // Handle Export Run
      if (exportRunBtn) {
        exportRunBtn.addEventListener('click', () => {
          // Get task_id from latest event
          let taskId = null;
          if (state.events.length > 0) {
            taskId = state.events[0].task_id;
          }

          if (!taskId) {
            console.warn('No task ID available for export');
            return;
          }

          // Send message to extension
          if (typeof vscode !== 'undefined') {
            vscode.postMessage({
              type: 'ordinex:exportRun',
              taskId: taskId
            });
          } else {
            console.log('Demo mode: would export run for task', taskId);
            alert('Export feature requires VS Code extension backend');
          }
        });
      }

      // Update Export Run button visibility
      function updateExportButtonVisibility() {
        if (exportRunBtn) {
          // Show button if there's at least one event
          exportRunBtn.style.display = state.events.length > 0 ? 'block' : 'none';
        }
      }

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

      // ===== UI GATING =====
      // Update UI gating based on pending approvals
      function updateUIGating() {
        const pending = hasPendingApprovals(state.events);
        
        if (pending) {
          // Change status to AWAITING APPROVAL
          updateStatus('awaiting_approval');
          
          // Disable send button
          sendBtn.disabled = true;
          sendBtn.title = 'Resolve pending approval first';
        } else {
          // Re-enable send button if not running
          if (state.taskStatus === 'awaiting_approval') {
            updateStatus('ready');
          }
          sendBtn.disabled = false;
          sendBtn.title = '';
        }

        // Stop button remains enabled
        stopBtn.disabled = false;

        // Update Systems tab for scope expansion
        const scopeApproval = getPendingScopeExpansionApproval(state.events);
        if (scopeApproval) {
          const details = scopeApproval.requestEvent.payload.details || {};
          state.pendingScopeExpansion = {
            reason: details.reason || 'Scope expansion requested',
            impact_level: 'medium',
            requested: details.requested || {}
          };
          renderSystemsCounters();
        } else if (state.pendingScopeExpansion) {
          state.pendingScopeExpansion = null;
          renderSystemsCounters();
        }
      }

      // ===== APPROVAL HANDLER =====
      // Handle approval/rejection from UI
      window.handleApproval = function(approvalId, decision) {
        console.log(\`handleApproval: \${approvalId}, \${decision}\`);
        
        // Get task_id from events
        let taskId = 'demo-task';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }
        
        // Find the approval request to determine type
        const approvalRequest = state.events.find(
          e => e.type === 'approval_requested' && e.payload.approval_id === approvalId
        );
        
        if (approvalRequest && approvalRequest.payload.approval_type === 'plan_approval') {
          // Send to backend for plan approval
          if (typeof vscode !== 'undefined') {
            vscode.postMessage({
              type: 'ordinex:resolvePlanApproval',
              task_id: taskId,
              approval_id: approvalId,
              decision: decision
            });
          } else {
            // Demo mode: simulate locally
            const event = {
              event_id: generateId(),
              task_id: taskId,
              timestamp: new Date().toISOString(),
              type: 'approval_resolved',
              mode: state.currentMode,
              stage: state.currentStage,
              payload: {
                approval_id: approvalId,
                decision: decision,
                decided_at: new Date().toISOString()
              },
              evidence_ids: [],
              parent_event_id: null
            };
            state.events.push(event);
            renderMission();
            renderLogs();
          }
        } else {
          // Other approval types (diff, terminal, etc.) - handle generically
          if (typeof vscode !== 'undefined') {
            vscode.postMessage({
              type: 'ordinex:resolveApproval',
              task_id: taskId,
              approval_id: approvalId,
              decision: decision
            });
          } else {
            // Demo mode: simulate locally
            const event = {
              event_id: generateId(),
              task_id: taskId,
              timestamp: new Date().toISOString(),
              type: 'approval_resolved',
              mode: state.currentMode,
              stage: state.currentStage,
              payload: {
                approval_id: approvalId,
                decision: decision,
                decided_at: new Date().toISOString()
              },
              evidence_ids: [],
              parent_event_id: null
            };
            state.events.push(event);
            renderMission();
            renderLogs();
          }
        }
      };

      // ===== DECISION POINT HANDLER =====
      window.handleDecisionPoint = function(taskId, decisionEventId, action) {
        console.log(\`handleDecisionPoint: \${decisionEventId}, \${action}\`);

        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:resolveDecisionPoint',
            task_id: taskId,
            decision_event_id: decisionEventId,
            action: action
          });
        } else {
          // Demo mode: simulate a resolved decision
          const event = {
            event_id: generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'clarification_received',
            mode: state.currentMode,
            stage: state.currentStage,
            payload: {
              decision_event_id: decisionEventId,
              action: action,
              decided_at: new Date().toISOString()
            },
            evidence_ids: [],
            parent_event_id: null
          };
          state.events.push(event);
          renderMission();
          renderLogs();
        }
      };

      // Global scope expansion handler
      window.handleScopeApproval = function(approved) {
        // Find the pending scope expansion approval ID
        const scopeApproval = getPendingScopeExpansionApproval(state.events);
        if (scopeApproval) {
          handleApproval(scopeApproval.approvalId, approved ? 'approved' : 'rejected');
        } else {
          // Legacy fallback
          if (approved) {
            addDemoEvent('scope_expansion_resolved', { approved: true });
          } else {
            addDemoEvent('scope_expansion_resolved', { approved: false });
          }
          state.pendingScopeExpansion = null;
          renderSystemsCounters();
          renderMission();
        }
      };

      // ===== REQUEST PLAN APPROVAL HANDLER =====
      window.handleRequestPlanApproval = function(taskId, planEventId) {
        console.log('Request Plan Approval clicked', { taskId, planEventId });
        
        // Send message to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:requestPlanApproval',
            task_id: taskId,
            plan_id: planEventId
          });
        } else {
          // Demo mode: simulate approval request
          console.log('Demo mode: simulating plan approval request');
          const approvalId = generateId();
          
          setTimeout(() => {
            addDemoEvent('approval_requested', {
              approval_id: approvalId,
              approval_type: 'plan_approval',
              description: 'Approve plan to start mission',
              details: {
                plan_id: planEventId
              },
              risk_level: 'low'
            });
            renderMission();
          }, 100);
        }
      };

      // ===== EXECUTE PLAN HANDLER =====
      window.handleExecutePlan = function() {
        console.log('Execute Plan clicked');
        
        // Get task_id from latest event
        let taskId = 'demo-task';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }

        // Send message to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:executePlan',
            taskId: taskId
          });
        } else {
          // Demo mode: simulate execution
          console.log('Demo mode: simulating execute plan');
          setTimeout(() => {
            updateStatus('running');
            updateStage('retrieve');
            addDemoEvent('stage_changed', { from: 'plan', to: 'retrieve' });
            renderMission();
          }, 100);

          setTimeout(() => {
            addDemoEvent('retrieval_started', { query: 'Execute plan context retrieval' });
            renderMission();
          }, 300);

          setTimeout(() => {
            addDemoEvent('retrieval_completed', { results_count: 8 });
            state.counters.filesInScope = 8;
            state.counters.linesIncluded = 245;
            renderMission();
            renderSystemsCounters();
          }, 1000);
        }
      };

      // ===== CLARIFICATION HANDLERS (PLAN mode v2) =====
      // Track selection state to prevent duplicates
      let clarificationSelectionInProgress = false;

      window.handleClarificationSelect = function(taskId, optionId) {
        // Prevent duplicate clicks
        if (clarificationSelectionInProgress) {
          console.log('[ClarificationCard] Selection already in progress, ignoring');
          return;
        }

        const card = document.getElementById('clarification-card-' + taskId);
        if (!card) {
          console.error('[ClarificationCard] Card not found');
          return;
        }

        const currentState = card.getAttribute('data-state');
        if (currentState !== 'idle') {
          console.log('[ClarificationCard] Not in idle state, ignoring click');
          return;
        }

        // Set selecting state immediately
        clarificationSelectionInProgress = true;
        card.setAttribute('data-state', 'selecting');

        // Find and highlight the selected button
        const buttons = card.querySelectorAll('.clarification-btn');
        buttons.forEach(btn => {
          const btnOptionId = btn.getAttribute('data-option-id');
          if (btnOptionId === optionId) {
            btn.classList.add('selected');
            const spinner = btn.querySelector('.clarification-btn-spinner');
            if (spinner) spinner.style.display = 'inline-block';
          }
          btn.disabled = true;
        });

        // Disable skip link
        const skipLink = card.querySelector('.clarification-skip-link');
        if (skipLink) skipLink.disabled = true;

        // Send selection to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:selectClarificationOption',
            task_id: taskId,
            option_id: optionId
          });
          
          // Transition to processing after short delay
          setTimeout(() => {
            card.setAttribute('data-state', 'processing');
          }, 500);
        } else {
          console.error('[ClarificationCard] VS Code API not available');
          // Reset state on error
          clarificationSelectionInProgress = false;
          card.setAttribute('data-state', 'idle');
          buttons.forEach(btn => {
            btn.classList.remove('selected');
            const spinner = btn.querySelector('.clarification-btn-spinner');
            if (spinner) spinner.style.display = 'none';
            btn.disabled = false;
          });
          if (skipLink) skipLink.disabled = false;
        }
      };

      window.handleClarificationSkip = function(taskId) {
        // Prevent duplicate clicks
        if (clarificationSelectionInProgress) {
          console.log('[ClarificationCard] Selection already in progress, ignoring skip');
          return;
        }

        const card = document.getElementById('clarification-card-' + taskId);
        if (!card) {
          console.error('[ClarificationCard] Card not found');
          return;
        }

        const currentState = card.getAttribute('data-state');
        if (currentState !== 'idle') {
          console.log('[ClarificationCard] Not in idle state, ignoring skip');
          return;
        }

        // Set selecting state immediately
        clarificationSelectionInProgress = true;
        card.setAttribute('data-state', 'selecting');

        // Disable all buttons
        const buttons = card.querySelectorAll('.clarification-btn');
        buttons.forEach(btn => {
          btn.disabled = true;
        });

        const skipLink = card.querySelector('.clarification-skip-link');
        if (skipLink) {
          skipLink.textContent = 'Generating ideas...';
          skipLink.disabled = true;
        }

        // Send skip to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:skipClarification',
            task_id: taskId
          });
          
          // Transition to processing after short delay
          setTimeout(() => {
            card.setAttribute('data-state', 'processing');
          }, 500);
        } else {
          console.error('[ClarificationCard] VS Code API not available');
          // Reset state on error
          clarificationSelectionInProgress = false;
          card.setAttribute('data-state', 'idle');
          buttons.forEach(btn => {
            btn.disabled = false;
          });
          if (skipLink) {
            skipLink.textContent = 'Skip and let me suggest ideas →';
            skipLink.disabled = false;
          }
        }
      };

      // Reset clarification state when events update
      function resetClarificationState() {
        clarificationSelectionInProgress = false;
      }

      // ===== EDIT/CANCEL PLAN HANDLERS =====
      window.handleEditPlan = function(taskId, planEventId) {
        console.log('Edit Plan clicked (not implemented yet)', { taskId, planEventId });
        alert('Plan editing will be available in a future version');
      };

      window.handleCancelPlan = function(taskId) {
        console.log('Cancel Plan clicked', { taskId });
        if (confirm('Are you sure you want to cancel this plan? This will clear the current task.')) {
          // Clear events and reset
          state.events = [];
          state.streamingAnswer = null;
          updateStatus('ready');
          updateStage('none');
          renderMission();
          renderLogs();
        }
      };

      // ===== PLAN REFINEMENT HANDLERS (Step 25) =====
      window.toggleRefinePlanInput = function(taskId, planId, planVersion) {
        console.log('Toggle Refine Plan input', { taskId, planId, planVersion });
        
        const container = document.getElementById('refine-plan-input-' + planId);
        if (!container) {
          console.error('Refine plan container not found:', planId);
          return;
        }
        
        // Toggle visibility
        if (container.style.display === 'none') {
          container.style.display = 'block';
          // Focus on textarea
          const textarea = document.getElementById('refinement-instruction-' + planId);
          if (textarea) {
            textarea.focus();
          }
        } else {
          container.style.display = 'none';
        }
      };

      window.submitPlanRefinement = function(taskId, planId, planVersion) {
        console.log('Submit Plan Refinement', { taskId, planId, planVersion });
        
        // Get refinement instruction text
        const textarea = document.getElementById('refinement-instruction-' + planId);
        if (!textarea) {
          console.error('Refinement textarea not found:', planId);
          return;
        }
        
        const refinementText = textarea.value.trim();
        if (!refinementText) {
          alert('Please enter a refinement instruction describing what changes you want to the plan.');
          return;
        }
        
        // Disable the button to prevent double-submit
        const submitBtn = event.target;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '⏳ Refining...';
        }
        
        // Send to extension backend
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:refinePlan',
            task_id: taskId,
            plan_id: planId,
            refinement_text: refinementText
          });
        } else {
          // Demo mode
          console.log('Demo mode: would refine plan with:', refinementText);
          alert('Plan refinement requires VS Code extension backend');
          
          // Re-enable button
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '🔄 Generate Refined Plan';
          }
        }
      };

      // ===== MISSION CONTROL BAR STATE LOGIC (Compact Bottom Bar) =====
      // Compute mission progress from events (PHASE 1: FIXED - Uses event stream reduction)
      function getMissionProgress(events) {
        console.log('[getMissionProgress] Called with', events.length, 'events');
        
        // Edge case: no events
        if (!events || events.length === 0) {
          console.log('[getMissionProgress] ❌ No events, returning null');
          return null;
        }
        
        // Find breakdown event
        const breakdownEvent = events.find(e => e.type === 'mission_breakdown_created');
        if (!breakdownEvent) {
          console.log('[getMissionProgress] ❌ No breakdown event, returning null');
          return null; // No missions, bar hidden
        }
        console.log('[getMissionProgress] ✓ Found breakdown event');

        const missions = breakdownEvent.payload?.missions || [];
        const totalMissions = missions.length;
        console.log('[getMissionProgress] Total missions:', totalMissions);
        if (totalMissions === 0) return null;

        // CRITICAL FIX: Get LATEST mission_selected event by filtering then taking last
        const selectedEvents = events.filter(e => e.type === 'mission_selected');
        console.log('[getMissionProgress] Found', selectedEvents.length, 'mission_selected events');
        const selectedEvent = selectedEvents[selectedEvents.length - 1]; // Last = Latest
        const selectedMissionId = selectedEvent?.payload?.mission_id;
        console.log('[getMissionProgress] Selected mission ID:', selectedMissionId);
        
        // Edge case: mission ID points to non-existent mission
        const selectedMission = missions.find(m => m.missionId === selectedMissionId);
        if (selectedMissionId && !selectedMission) {
          console.warn('[MCB] Selected mission not found:', selectedMissionId);
          return null; // Fail safely
        }

        // Count completed missions (reduce over events for accuracy)
        const completedMissionIds = new Set();
        events.forEach(e => {
          if (e.type === 'mission_completed') {
            const mid = e.payload?.mission_id;
            if (mid) completedMissionIds.add(mid);
          }
        });
        const completedCount = completedMissionIds.size;

        // Check if CURRENT mission is running (started AND not completed)
        // CRITICAL FIX: Only check for missions that match the SELECTED mission
        const isMissionCompleted = selectedMissionId && completedMissionIds.has(selectedMissionId);
        console.log('[getMissionProgress] Is mission completed?', isMissionCompleted);
        
        // Check if mission started for the SELECTED mission
        const missionStartedEvents = events.filter(e => 
          e.type === 'mission_started' && 
          e.payload?.mission_id === selectedMissionId
        );
        const hasMissionStarted = missionStartedEvents.length > 0;
        const lastMissionStarted = missionStartedEvents[missionStartedEvents.length - 1];
        console.log('[getMissionProgress] Has mission started?', hasMissionStarted, '(', missionStartedEvents.length, 'events)');
        
        // OPTIMISTIC UI: Check if we have a pending mission start for this mission
        const hasPendingStart = state.missionStartPending && 
                               state.missionStartPending.missionId === selectedMissionId;
        console.log('[getMissionProgress] Has pending start?', hasPendingStart);
        
        // Check for execution pause/block states AFTER the mission started
        // CRITICAL FIX: Only consider pause events that came AFTER the mission started
        let isPaused = false;
        if (hasMissionStarted && lastMissionStarted) {
          const startIndex = events.indexOf(lastMissionStarted);
          const eventsAfterStart = events.slice(startIndex + 1);
          
          // Find if there's a pause event after start that hasn't been resumed
          const lastPauseAfterStart = [...eventsAfterStart].reverse().find(e => 
            e.type === 'execution_paused' || e.type === 'mission_paused'
          );
          
          if (lastPauseAfterStart) {
            const pauseIndex = events.indexOf(lastPauseAfterStart);
            const eventsAfterPause = events.slice(pauseIndex + 1);
            // Check if there's a resume or new mission_started after the pause
            isPaused = !eventsAfterPause.some(e => 
              e.type === 'execution_resumed' || e.type === 'mission_started'
            );
          }
        }
        
        // isRunning = (started OR pending start) AND not completed AND not paused
        const isRunning = (hasMissionStarted || hasPendingStart) && !isMissionCompleted && !isPaused;
        console.log('[getMissionProgress] 🎯 IS RUNNING?', isRunning);
        console.log('[getMissionProgress]   - hasMissionStarted:', hasMissionStarted);
        console.log('[getMissionProgress]   - hasPendingStart:', hasPendingStart);
        console.log('[getMissionProgress]   - isMissionCompleted:', isMissionCompleted);
        console.log('[getMissionProgress]   - isPaused:', isPaused);

        // Determine current mission index (1-based, handle missing selection)
        const currentMissionIndex = selectedMission 
          ? missions.findIndex(m => m.missionId === selectedMissionId) + 1
          : Math.min(completedCount + 1, totalMissions);

        const result = {
          total: totalMissions,
          current: Math.min(currentMissionIndex, totalMissions),
          completed: completedCount,
          selectedMission: selectedMission,
          isRunning: isRunning,
          isPaused: isPaused,
          allDone: completedCount >= totalMissions,
          taskId: events[0]?.task_id || 'unknown'
        };
        
        console.log('[getMissionProgress] 📦 Returning:', JSON.stringify(result, null, 2));
        console.log('[getMissionProgress] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return result;
      }

      // Update Mission Control Bar UI
      function updateMissionControlBar() {
        console.log('');
        console.log('[MCB] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('[MCB] 🔄 UPDATE MISSION CONTROL BAR CALLED');
        console.log('[MCB] state.events.length:', state.events.length);
        console.log('[MCB] state.missionStartPending:', JSON.stringify(state.missionStartPending));
        
        const bar = document.getElementById('missionControlBar');
        const statusIcon = document.getElementById('mcbStatusIcon');
        const count = document.getElementById('mcbCount');
        const missionName = document.getElementById('mcbMissionName');
        const progressFill = document.getElementById('mcbProgressFill');
        const cta = document.getElementById('mcbCta');

        console.log('[MCB] 📊 Calling getMissionProgress()...');
        const progress = getMissionProgress(state.events);
        console.log('[MCB] 📊 Progress result:', JSON.stringify(progress, null, 2));

        if (!progress) {
          // Hide bar if no mission breakdown
          bar.classList.remove('visible', 'running', 'complete', 'all-done');
          return;
        }

        // Show bar
        bar.classList.add('visible');

        // Update count display (e.g., "2/4")
        count.textContent = progress.current + '/' + progress.total;

        // Update progress bar fill (percentage)
        const pct = Math.round((progress.completed / progress.total) * 100);
        progressFill.style.width = pct + '%';

        // Determine state and update accordingly
        if (progress.allDone) {
          // All missions complete
          console.log('[MCB] State: All Done');
          bar.classList.remove('running', 'complete');
          bar.classList.add('all-done');
          statusIcon.textContent = '🎉';
          statusIcon.classList.remove('spinning');
          missionName.textContent = 'All Complete!';
          progressFill.classList.add('complete');
          cta.textContent = '✓ Done';
          cta.className = 'mcb-cta done';
          cta.disabled = true;
        } else if (progress.isRunning) {
          // Currently running a mission
          console.log('[MCB] State: Running');
          bar.classList.remove('complete', 'all-done');
          bar.classList.add('running');
          statusIcon.textContent = '🔄';
          statusIcon.classList.add('spinning');
          missionName.textContent = progress.selectedMission?.title || 'Running...';
          progressFill.classList.remove('complete');
          cta.textContent = '⏳ Running...';
          cta.className = 'mcb-cta running';
          cta.disabled = true;
        } else if (progress.selectedMission) {
          // Mission selected, ready to start
          console.log('[MCB] State: Ready to Start');
          bar.classList.remove('running', 'all-done');
          bar.classList.add('complete'); // "ready" state
          statusIcon.textContent = '🚀';
          statusIcon.classList.remove('spinning');
          missionName.textContent = progress.selectedMission.title;
          progressFill.classList.remove('complete');
          cta.textContent = '▶ Start';
          cta.className = 'mcb-cta start';
          cta.disabled = false;
          cta.setAttribute('data-task-id', progress.taskId);
          cta.setAttribute('data-mission-id', progress.selectedMission.missionId);
        } else {
          // No mission selected yet
          console.log('[MCB] State: No Selection');
          bar.classList.remove('running', 'complete', 'all-done');
          statusIcon.textContent = '🎯';
          statusIcon.classList.remove('spinning');
          missionName.textContent = 'Select a mission...';
          progressFill.classList.remove('complete');
          cta.textContent = '↑ Select';
          cta.className = 'mcb-cta secondary';
          cta.disabled = true;
        }
      }

      // Handle Mission Control Bar CTA click
      window.handleMcbCtaClick = function() {
        const cta = document.getElementById('mcbCta');
        const taskId = cta.getAttribute('data-task-id');
        const missionId = cta.getAttribute('data-mission-id');
        
        if (taskId && missionId && !cta.disabled) {
          handleStartMission(taskId, missionId);
        }
      };

      // ===== MISSION SELECTION HANDLERS (Step 26) =====
      window.handleSelectMission = function(taskId, missionId) {
        console.log('Select Mission clicked', { taskId, missionId });
        
        // Send message to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:selectMission',
            task_id: taskId,
            mission_id: missionId
          });
        } else {
          // Demo mode: simulate selection
          console.log('Demo mode: simulating mission selection');
          const event = {
            event_id: generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'mission_selected',
            mode: state.currentMode,
            stage: state.currentStage,
            payload: {
              mission_id: missionId,
              selected_at: new Date().toISOString()
            },
            evidence_ids: [],
            parent_event_id: null
          };
          state.events.push(event);
          renderMission();
          renderLogs();
        }
      };

      window.handleStartMission = function(taskId, missionId) {
        console.log('====================================');
        console.log('[MCB] 🚀 START MISSION CLICKED');
        console.log('[MCB] Task ID:', taskId);
        console.log('[MCB] Mission ID:', missionId);
        console.log('[MCB] Current state.events.length:', state.events.length);
        console.log('====================================');
        
        // OPTIMISTIC UI UPDATE: Set pending state immediately
        state.missionStartPending = { taskId, missionId };
        console.log('[MCB] ✓ Set pending state:', JSON.stringify(state.missionStartPending));
        
        // Force immediate UI update
        console.log('[MCB] 📢 Calling updateMissionControlBar()...');
        updateMissionControlBar();
        console.log('[MCB] ✓ updateMissionControlBar() completed');
        
        // Send message to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:startMission',
            task_id: taskId,
            mission_id: missionId
          });
        } else {
          // Demo mode: simulate mission start
          console.log('Demo mode: simulating mission start');
          updateStatus('running');
          
          const event = {
            event_id: generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'mission_started',
            mode: 'MISSION',
            stage: 'retrieve',
            payload: {
              mission_id: missionId,
              steps_count: 2,
              goal: 'Execute selected mission'
            },
            evidence_ids: [],
            parent_event_id: null
          };
          state.events.push(event);
          state.missionStartPending = null; // Clear in demo mode
          renderMission();
          renderLogs();
        }
      };

      // ===== APPLY DIFF HANDLER =====
      window.handleApplyDiff = function(diffId, taskId) {
        console.log('Apply Diff clicked', { diffId, taskId });
        
        // Send message to extension to request apply with approval
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:requestApplyDiff',
            diff_id: diffId,
            task_id: taskId
          });
        } else {
          // Demo mode: simulate approval request
          console.log('Demo mode: simulating apply diff approval request');
          const approvalId = generateId();
          
          setTimeout(() => {
            // Get diff event to extract files_changed
            const diffEvent = state.events.find(e => e.type === 'diff_proposed' && e.payload.diff_id === diffId);
            const filesChanged = diffEvent ? (diffEvent.payload.files_changed || []) : [];
            
            addDemoEvent('approval_requested', {
              approval_id: approvalId,
              approval_type: 'apply_diff',
              description: \`Apply diff to \${filesChanged.length} file(s)\`,
              details: {
                diff_id: diffId,
                files_changed: filesChanged,
                summary: 'Applying proposed changes'
              },
              risk_level: 'medium'
            });
            renderMission();
          }, 100);
        }
      };

      // Demo: Add test approval button
      window.testApproval = function(type) {
        const approvalId = generateId();
        let details = {};
        
        if (type === 'terminal') {
          details = {
            command: 'npm run build',
            working_dir: '/Users/project'
          };
        } else if (type === 'apply_diff') {
          details = {
            files_changed: ['src/index.ts', 'package.json'],
            additions: 25,
            deletions: 10
          };
        } else if (type === 'scope_expansion') {
          details = {
            reason: 'Need access to additional files for analysis',
            requested: {
              max_files: 20,
              max_lines: 2000
            }
          };
        }

        addDemoEvent('approval_requested', {
          approval_id: approvalId,
          approval_type: type,
          description: \`Requesting approval for \${type}\`,
          details: details,
          risk_level: type === 'terminal' ? 'high' : type === 'apply_diff' ? 'medium' : 'low'
        });
        renderMission();
      };

      // ===== SEND/STOP TOGGLE BUTTON =====
      // Update the combined send/stop button state
      function updateSendStopButton() {
        if (!sendStopBtn) return;
        
        const isRunning = state.taskStatus === 'running';
        const hasText = promptInput.value.trim().length > 0;
        
        if (isRunning) {
          // Show stop button
          sendStopBtn.className = 'send-stop-btn stop';
          sendStopBtn.innerHTML = '■';
          sendStopBtn.title = 'Stop';
          sendStopBtn.disabled = false;
        } else {
          // Show send button
          sendStopBtn.className = 'send-stop-btn send';
          sendStopBtn.innerHTML = '▶';
          sendStopBtn.title = 'Send';
          sendStopBtn.disabled = !hasText;
        }
      }

      // Handle send/stop button click
      if (sendStopBtn) {
        sendStopBtn.addEventListener('click', () => {
          const isRunning = state.taskStatus === 'running';
          
          if (isRunning) {
            // Stop action
            console.log('Stop clicked');
            if (typeof vscode !== 'undefined') {
              vscode.postMessage({
                type: 'ordinex:stopExecution'
              });
            }
            updateStatus('ready');
            updateSendStopButton();
          } else {
            // Send action - delegate to existing sendBtn click handler
            sendBtn.click();
          }
        });
      }

      // ===== ATTACHMENT SYSTEM (MVP) =====
      
      // Format file size for display
      function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      }
      
      // Show toast notification
      function showToast(message, type = 'error') {
        // Remove existing toasts
        document.querySelectorAll('.toast').forEach(t => t.remove());
        
        const toast = document.createElement('div');
        toast.className = 'toast' + (type === 'warning' ? ' warning' : '');
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Auto-remove after animation completes
        setTimeout(() => toast.remove(), 3000);
      }
      
      // Validate file for attachment
      function validateFile(file) {
        // Check count limit
        if (state.pendingAttachments.length >= ATTACHMENT_CONFIG.MAX_FILES) {
          return { valid: false, error: \`Maximum \${ATTACHMENT_CONFIG.MAX_FILES} files allowed\` };
        }
        
        // Check file size
        if (file.size > ATTACHMENT_CONFIG.MAX_SIZE_BYTES) {
          return { valid: false, error: \`File too large. Maximum \${formatFileSize(ATTACHMENT_CONFIG.MAX_SIZE_BYTES)}\` };
        }
        
        // Check file type
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        const isAllowedType = ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES.includes(file.type) ||
                             ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS.includes(ext);
        if (!isAllowedType) {
          return { valid: false, error: \`File type not supported: \${ext}\` };
        }
        
        // Check for duplicate (same name and size)
        const isDuplicate = state.pendingAttachments.some(
          a => a.name === file.name && a.size === file.size
        );
        if (isDuplicate) {
          return { valid: false, error: 'File already attached' };
        }
        
        return { valid: true };
      }
      
      // Generate thumbnail for image files
      function generateThumbnail(file) {
        return new Promise((resolve) => {
          if (!file.type.startsWith('image/')) {
            // Return placeholder icon for non-images
            const iconMap = {
              'application/json': '📄',
              'application/pdf': '📕',
              'text/plain': '📝',
              'text/markdown': '📝',
              'text/csv': '📊'
            };
            resolve({ type: 'icon', icon: iconMap[file.type] || '📎' });
            return;
          }
          
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve({ type: 'image', url: e.target.result });
          };
          reader.onerror = () => {
            resolve({ type: 'icon', icon: '🖼️' });
          };
          reader.readAsDataURL(file);
        });
      }
      
      // Add file to pending attachments
      async function addAttachment(file) {
        const validation = validateFile(file);
        if (!validation.valid) {
          showToast(validation.error);
          return;
        }
        
        const id = generateId();
        const thumbnail = await generateThumbnail(file);
        
        const attachment = {
          id,
          file,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          status: 'pending',
          thumbnailUrl: thumbnail.type === 'image' ? thumbnail.url : null,
          thumbnailIcon: thumbnail.type === 'icon' ? thumbnail.icon : null,
          evidenceId: null,
          errorMsg: null
        };
        
        state.pendingAttachments.push(attachment);
        renderAttachments();
        updateAttachButtonState();
      }
      
      // Remove attachment from pending list
      function removeAttachment(attachmentId) {
        state.pendingAttachments = state.pendingAttachments.filter(a => a.id !== attachmentId);
        renderAttachments();
        updateAttachButtonState();
      }
      
      // Update attach button visual state
      function updateAttachButtonState() {
        if (!attachBtn) return;
        
        if (state.pendingAttachments.length > 0) {
          attachBtn.classList.add('has-attachments');
          attachBtn.title = \`\${state.pendingAttachments.length} file(s) attached\`;
        } else {
          attachBtn.classList.remove('has-attachments');
          attachBtn.title = 'Attach files';
        }
      }
      
      // Render attachment previews
      function renderAttachments() {
        // Find or create attachments container
        let container = document.getElementById('attachmentsContainer');
        if (!container) {
          container = document.createElement('div');
          container.id = 'attachmentsContainer';
          container.className = 'attachments-container';
          // Insert before the input wrapper
          const inputWrapper = document.querySelector('.composer-input-wrapper');
          if (inputWrapper) {
            inputWrapper.parentNode.insertBefore(container, inputWrapper);
          }
        }
        
        if (state.pendingAttachments.length === 0) {
          container.style.display = 'none';
          return;
        }
        
        container.style.display = 'flex';
        
        const chipsHtml = state.pendingAttachments.map(att => {
          const statusClass = att.status === 'uploading' ? 'uploading' : 
                             att.status === 'uploaded' ? 'uploaded' :
                             att.status === 'error' ? 'error' : '';
          
          const thumbHtml = att.thumbnailUrl 
            ? \`<img class="attachment-thumb" src="\${att.thumbnailUrl}" alt="\${escapeHtml(att.name)}">\`
            : \`<div class="attachment-thumb" style="display: flex; align-items: center; justify-content: center; font-size: 20px; background: var(--vscode-input-background);">\${att.thumbnailIcon || '📎'}</div>\`;
          
          const statusHtml = att.status === 'uploading' 
            ? '<span class="attachment-status uploading">⏳</span>'
            : att.status === 'error' 
            ? \`<span class="attachment-status error" title="\${escapeHtml(att.errorMsg || 'Error')}"">⚠️</span>\`
            : '';
          
          return \`
            <div class="attachment-chip \${statusClass}" data-attachment-id="\${att.id}">
              \${thumbHtml}
              <div class="attachment-info">
                <span class="attachment-name" title="\${escapeHtml(att.name)}">\${escapeHtml(att.name)}</span>
                <span class="attachment-size">\${formatFileSize(att.size)}</span>
              </div>
              \${statusHtml}
              <button class="attachment-remove" onclick="event.stopPropagation(); removeAttachmentById('\${att.id}')" title="Remove">×</button>
            </div>
          \`;
        }).join('');
        
        // Add count badge if near limit
        const countHtml = state.pendingAttachments.length >= ATTACHMENT_CONFIG.MAX_FILES - 1
          ? \`<div class="attachments-count \${state.pendingAttachments.length >= ATTACHMENT_CONFIG.MAX_FILES ? 'at-limit' : ''}">
              📎 \${state.pendingAttachments.length}/\${ATTACHMENT_CONFIG.MAX_FILES}
            </div>\`
          : '';
        
        container.innerHTML = chipsHtml + countHtml;
      }
      
      // Global function to remove attachment (called from onclick)
      window.removeAttachmentById = function(attachmentId) {
        removeAttachment(attachmentId);
      };
      
      // Create hidden file input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.accept = ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS.join(',') + ',' + ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES.join(',');
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);
      
      // Handle file selection
      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
          await addAttachment(file);
        }
        // Reset input so same file can be selected again
        fileInput.value = '';
      });
      
      // Handle attach button click
      if (attachBtn) {
        attachBtn.addEventListener('click', () => {
          // Check if at limit
          if (state.pendingAttachments.length >= ATTACHMENT_CONFIG.MAX_FILES) {
            showToast(\`Maximum \${ATTACHMENT_CONFIG.MAX_FILES} files reached\`, 'warning');
            return;
          }
          fileInput.click();
        });
      }
      
      // Handle drag and drop on composer
      const composer = document.querySelector('.composer');
      if (composer) {
        composer.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          composer.style.borderColor = 'var(--vscode-focusBorder)';
        });
        
        composer.addEventListener('dragleave', (e) => {
          e.preventDefault();
          e.stopPropagation();
          composer.style.borderColor = '';
        });
        
        composer.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          composer.style.borderColor = '';
          
          const files = Array.from(e.dataTransfer?.files || []);
          for (const file of files) {
            await addAttachment(file);
          }
        });
      }
      
      // Clear attachments when prompt is sent
      function clearAttachments() {
        state.pendingAttachments = [];
        renderAttachments();
        updateAttachButtonState();
      }
      
      // Get attachment references for sending with prompt
      function getAttachmentRefs() {
        return state.pendingAttachments
          .filter(a => a.status === 'uploaded' && a.evidenceId)
          .map(a => ({
            evidence_id: a.evidenceId,
            name: a.name,
            mime_type: a.mimeType,
            size: a.size
          }));
      }
      
      // Upload a single attachment to the extension
      async function uploadAttachment(attachment) {
        // Mark as uploading
        attachment.status = 'uploading';
        renderAttachments();
        
        return new Promise((resolve) => {
          // Read file as base64
          const reader = new FileReader();
          reader.onload = () => {
            const base64Data = reader.result.split(',')[1]; // Remove data:... prefix
            
            // Send to extension
            if (typeof vscode !== 'undefined') {
              // Store callback reference for this attachment
              window.__pendingAttachmentUploads = window.__pendingAttachmentUploads || {};
              window.__pendingAttachmentUploads[attachment.id] = {
                resolve,
                attachment
              };
              
              vscode.postMessage({
                type: 'ordinex:uploadAttachment',
                attachment: {
                  id: attachment.id,
                  name: attachment.name,
                  mimeType: attachment.mimeType,
                  data: base64Data
                }
              });
            } else {
              // Demo mode: simulate successful upload
              setTimeout(() => {
                attachment.status = 'uploaded';
                attachment.evidenceId = 'demo_' + attachment.id.substring(0, 8);
                renderAttachments();
                resolve({ success: true, evidenceId: attachment.evidenceId });
              }, 500);
            }
          };
          reader.onerror = () => {
            attachment.status = 'error';
            attachment.errorMsg = 'Failed to read file';
            renderAttachments();
            resolve({ success: false, error: 'Failed to read file' });
          };
          reader.readAsDataURL(attachment.file);
        });
      }
      
      // Upload all pending attachments before sending prompt
      async function uploadAllPendingAttachments() {
        const pendingUploads = state.pendingAttachments.filter(a => a.status === 'pending');
        
        if (pendingUploads.length === 0) {
          return { success: true, failed: [] };
        }
        
        const results = await Promise.all(pendingUploads.map(uploadAttachment));
        const failed = results.filter(r => !r.success);
        
        return {
          success: failed.length === 0,
          failed: failed.map(r => r.error)
        };
      }

      // Update send/stop button when textarea changes
      promptInput.addEventListener('input', () => {
        autoResizeTextarea();
        updateSendStopButton();
      });

      // Update send/stop button when status changes
      const originalUpdateStatus = updateStatus;
      updateStatus = function(status) {
        originalUpdateStatus(status);
        updateSendStopButton();
      };

      // ===== SCAFFOLD-ACTION EVENT LISTENER =====
      // Listen for scaffold-action events from ScaffoldCard web component
      // and forward them to the extension via vscode.postMessage
      document.addEventListener('scaffold-action', (event) => {
        const detail = event.detail || {};
        
        console.log('[ScaffoldAction] Event received:', detail);
        
        const { action, scaffoldId, eventId, currentPackId, styleSourceMode, selectedPackId } = detail;
        
        // Get task_id from state
        let taskId = 'unknown';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }
        
        // Find the decision_requested event to get the proper event_id
        const decisionEvent = state.events.find(e => 
          e.type === 'scaffold_decision_requested' && 
          e.payload?.scaffold_id === scaffoldId
        );
        
        const decisionEventId = decisionEvent?.event_id || eventId;
        
        console.log('[ScaffoldAction] Forwarding to extension:', {
          taskId,
          decisionEventId,
          action,
          scaffoldId
        });
        
        // Send to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:resolveDecisionPoint',
            task_id: taskId,
            decision_event_id: decisionEventId,
            action: action,
            // Include extra context for scaffold actions
            scaffold_context: {
              scaffold_id: scaffoldId,
              current_pack_id: currentPackId,
              style_source_mode: styleSourceMode,
              selected_pack_id: selectedPackId
            }
          });
        } else {
          console.log('[ScaffoldAction] Demo mode - would send:', { action, scaffoldId });
        }
      });

      // Initialize
      updateStatus('ready');
      updateStage('none');
      renderMission();
      renderSystemsCounters();
      renderLogs();
      updateSendStopButton();
      promptInput.focus();

      // Add test buttons to composer for demo purposes
      if (window.location.search.includes('demo')) {
        const demoControls = document.createElement('div');
        demoControls.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 0;';
        demoControls.innerHTML = \`
          <button onclick="testApproval('terminal')" class="secondary" style="padding: 4px 8px; font-size: 10px;">
            Test Terminal Approval
          </button>
          <button onclick="testApproval('apply_diff')" class="secondary" style="padding: 4px 8px; font-size: 10px;">
            Test Diff Approval
          </button>
          <button onclick="testApproval('scope_expansion')" class="secondary" style="padding: 4px 8px; font-size: 10px;">
            Test Scope Approval
          </button>
        \`;
        document.querySelector('.composer-controls').appendChild(demoControls);
      }
    })();
  </script>
</body>
</html>`;
}
