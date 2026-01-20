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
  </style>
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
        <option value="claude-3-haiku">Claude 3 Haiku</option>
        <option value="claude-3-sonnet">Claude 3 Sonnet</option>
        <option value="claude-3-opus">Claude 3 Opus</option>
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
    // Acquire VS Code API
    const vscode = acquireVsCodeApi();
    
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
      const exportRunBtn = document.getElementById('exportRunBtn');

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
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Files:</span><span class="detail-value">\${details.files_changed.join(', ')}</span></div>\`;
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

      // Render Mission Tab - Event Timeline
      function renderMission() {
        missionTab.innerHTML = renderMissionTimeline(state.events);
        updateUIGating(); // Update UI gating whenever mission is rendered
        updateExportButtonVisibility(); // Update export button visibility
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

        // Show pending approvals at the top
        if (pendingApprovals.length > 0) {
          items.push('<div class="approval-section-header">⚠️ Pending Approvals</div>');
          for (const approval of pendingApprovals) {
            items.push(renderApprovalCard(approval.requestEvent));
          }
        }

        // Show "Execute Plan" CTA if conditions are met
        const executePlanCTA = renderExecutePlanCTA(events);
        if (executePlanCTA) {
          items.push(executePlanCTA);
        }

        let currentStage = 'none';

        for (const event of events) {
          // Skip rendering stream_delta and stream_complete events entirely
          // These are for real-time updates only, not timeline display
          if (event.type === 'stream_delta' || event.type === 'stream_complete') {
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
          
          // Show streaming answer card after tool_start for llm_answer
          // Only show if we have streaming data AND this is the tool_start event
          if (event.type === 'tool_start' && event.payload.tool === 'llm_answer' && state.streamingAnswer && state.streamingAnswer.text) {
            items.push(renderStreamingAnswerCard());
          }
        }

        return items.join('');
      }

      // Render "Execute Plan" CTA when appropriate
      function renderExecutePlanCTA(events) {
        // Conditions:
        // 1. effectiveMode === MISSION
        // 2. plan_created exists
        // 3. execution has not started yet (no retrieval_started)
        // 4. no pending approvals

        // Get effective mode from latest mode_set event
        let effectiveMode = null;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].type === 'mode_set') {
            effectiveMode = events[i].payload.effectiveMode || events[i].payload.mode;
            break;
          }
        }

        if (effectiveMode !== 'MISSION') {
          return null;
        }

        // Check if plan_created exists
        const hasPlan = events.some(e => e.type === 'plan_created');
        if (!hasPlan) {
          return null;
        }

        // Check if retrieval has started (execution started)
        const retrievalStarted = events.some(e => e.type === 'retrieval_started');
        if (retrievalStarted) {
          return null;
        }

        // Check for pending approvals
        const pendingApprovals = hasPendingApprovals(events);
        const isDisabled = pendingApprovals;

        return \`
          <div style="margin: 16px 0;">
            <button 
              id="executePlanBtn" 
              class="execute-plan-btn" 
              onclick="handleExecutePlan()"
              \${isDisabled ? 'disabled' : ''}
              style="
                width: 100%;
                padding: 12px 20px;
                font-size: 14px;
                font-weight: 700;
                background: var(--vscode-charts-green);
                color: #fff;
                border: none;
                border-radius: 6px;
                cursor: \${isDisabled ? 'not-allowed' : 'pointer'};
                transition: all 0.2s ease;
                opacity: \${isDisabled ? '0.5' : '1'};
                box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
              "
              onmouseover="if (!this.disabled) this.style.transform = 'translateY(-2px)'; if (!this.disabled) this.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.5)';"
              onmouseout="this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 2px 8px rgba(40, 167, 69, 0.3)';"
            >
              🚀 Execute Plan
            </button>
            \${isDisabled ? '<div style="text-align: center; margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground);">Resolve pending approvals first</div>' : ''}
          </div>
        \`;
      }

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
                onclick="handleCancelPlan('\${event.task_id}')"
                style="padding: 8px 16px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer;">
                ✕ Cancel
              </button>
            </div>

            <div style="margin-top: 10px; padding: 8px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
              💡 Review this plan carefully before switching to MISSION mode to execute.
            </div>
          </div>
        \`;
      }

      // Render Event Card
      function renderEventCard(event) {
        // Special handling for plan_created - render detailed PlanCard
        if (event.type === 'plan_created') {
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
              const filesCount = (e.payload.files_included || []).length;
              const totalLines = e.payload.total_lines || 0;
              const stack = (e.payload.inferred_stack || []).join(', ');
              return \`\${filesCount} files, \${totalLines} lines\${stack ? ' | Stack: ' + stack : ''}\`;
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

        // Group consecutive stream_delta events
        const groupedEvents = [];
        let streamGroup = null;
        
        for (const event of state.events) {
          if (event.type === 'stream_delta' || event.type === 'stream_complete') {
            if (!streamGroup) {
              streamGroup = { 
                type: 'stream_group', 
                count: 1, 
                firstEvent: event,
                lastEvent: event 
              };
            } else {
              streamGroup.count++;
              streamGroup.lastEvent = event;
            }
          } else {
            // Push accumulated stream group if exists
            if (streamGroup) {
              groupedEvents.push(streamGroup);
              streamGroup = null;
            }
            // Push regular event
            groupedEvents.push(event);
          }
        }
        // Don't forget last stream group
        if (streamGroup) {
          groupedEvents.push(streamGroup);
        }

        // Render grouped events
        eventLogList.innerHTML = groupedEvents.map((item, idx) => {
          if (item.type === 'stream_group') {
            return \`
              <div class="event-log-item collapsed-group" data-event-idx="\${idx}">
                <div class="event-log-header">
                  <span class="event-log-type">stream_delta × \${item.count}</span>
                  <span class="event-log-timestamp">\${formatTimestamp(item.firstEvent.timestamp)}</span>
                </div>
                <div class="event-log-summary" style="color: var(--vscode-descriptionForeground); font-style: italic;">
                  Streaming chunks (collapsed for readability)
                </div>
              </div>
            \`;
          }
          
          // Regular event
          return \`
            <div class="event-log-item" data-event-idx="\${idx}">
              <div class="event-log-header">
                <span class="event-log-type">\${item.type}</span>
                <span class="event-log-timestamp">\${formatTimestamp(item.timestamp)}</span>
              </div>
              <div class="event-log-summary">
                Mode: \${item.mode} | Stage: \${item.stage} | ID: \${item.event_id.substring(0, 8)}
              </div>
            </div>
          \`;
        }).join('');

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

      // Handle Send - Send to backend extension
      sendBtn.addEventListener('click', () => {
        const prompt = promptInput.value.trim();
        if (!prompt) return;

        // Clear input immediately
        promptInput.value = '';
        autoResizeTextarea();

        // Clear previous streaming answer when starting new task
        state.streamingAnswer = null;

        // Send to extension backend - it will emit all events
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:submitPrompt',
            text: prompt,
            userSelectedMode: state.currentMode,
            modelId: state.selectedModel
          });
          
          // Update UI to show we're processing
          updateStatus('running');
        } else {
          // Fallback for standalone testing
          console.log('Demo mode: would submit', { prompt, mode: state.currentMode, model: state.selectedModel });
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
      });

      // ===== MESSAGE HANDLERS FROM BACKEND =====
      // Listen for messages from extension backend
      if (typeof vscode !== 'undefined') {
        window.addEventListener('message', event => {
          const message = event.data;
          
          switch (message.type) {
            case 'ordinex:eventsUpdate':
              // Backend sent updated events - replace our state
              if (message.events) {
                state.events = message.events;
                
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

      // Initialize
      updateStatus('ready');
      updateStage('none');
      renderMission();
      renderSystemsCounters();
      renderLogs();
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
