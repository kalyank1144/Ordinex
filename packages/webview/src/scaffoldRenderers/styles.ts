// ScaffoldCard CSS styles.
// NO import/export — pure script file, concatenated into ScaffoldCard.bundle.js

function scaffoldCardStyles(): string {
  return `
    <style>
      :host { display: block; }
      .scaffold-card {
        padding: 16px;
        border-radius: 8px;
        margin: 12px 0;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
      }
      .scaffold-card.starting { border-left: 4px solid #3794ff; }
      .scaffold-card.proposal { border-left: 4px solid #b180d7; }
      .scaffold-card.ready { border-left: 4px solid #89d185; }
      .scaffold-card.cancelled { border-left: 4px solid #cca700; }
      .scaffold-card.approved { border-left: 4px solid #89d185; }
      .scaffold-card.applying { border-left: 4px solid #3794ff; }
      .scaffold-card.applied { border-left: 4px solid #89d185; }

      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }
      .icon { font-size: 20px; line-height: 1; }
      .header h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        flex: 1;
        color: var(--vscode-foreground);
      }
      .badge {
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
      }
      .badge.starting { background: #3794ff; color: white; }
      .badge.proposal { background: #b180d7; color: white; }
      .badge.ready { background: #89d185; color: #1e1e1e; }
      .badge.cancelled { background: #cca700; color: #1e1e1e; }
      .badge.applying { background: #3794ff; color: white; }

      .prompt-section, .summary-section { margin-bottom: 16px; }
      .prompt-label {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 4px;
      }
      .prompt-text {
        color: var(--vscode-foreground);
        font-style: italic;
        padding: 8px 12px;
        background: var(--vscode-textBlockQuote-background, #2a2a2a);
        border-left: 3px solid #3794ff;
        border-radius: 0 4px 4px 0;
      }
      .summary-text {
        color: var(--vscode-foreground);
        line-height: 1.5;
      }

      .proposal-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-bottom: 16px;
      }
      .detail-item {
        background: var(--vscode-input-background);
        padding: 8px 12px;
        border-radius: 4px;
      }
      .detail-label {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 2px;
      }
      .detail-value {
        color: var(--vscode-foreground);
        font-weight: 500;
      }
      .detail-value.tbd {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }

      .detail-row {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 13px;
      }
      .detail-row .detail-label {
        color: var(--vscode-descriptionForeground);
        text-transform: none;
      }
      .detail-row .detail-value {
        color: var(--vscode-foreground);
      }

      .completion-section {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        border-radius: 4px;
        margin-top: 12px;
      }
      .completion-section.ready {
        background: rgba(137, 209, 133, 0.1);
        border: 1px solid #89d185;
      }
      .completion-section.cancelled {
        background: rgba(204, 167, 0, 0.1);
        border: 1px solid #cca700;
      }
      .completion-section.terminal-running {
        background: rgba(55, 148, 255, 0.1);
        border: 1px solid #3794ff;
      }
      .completion-icon { font-size: 16px; }
      .completion-text { color: var(--vscode-foreground); }

      .terminal-notice {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        margin-top: 12px;
        background: rgba(55, 148, 255, 0.08);
        border: 1px dashed rgba(55, 148, 255, 0.4);
        border-radius: 6px;
        font-size: 12px;
      }
      .terminal-notice .notice-icon {
        font-size: 16px;
      }
      .terminal-notice .notice-text {
        color: var(--vscode-descriptionForeground);
        font-style: normal;
      }

      .placeholder-notice {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        padding: 8px;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 4px;
        margin-bottom: 12px;
      }

      .timestamp {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-align: right;
      }

      .actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
      }
      button {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
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

      /* Design Pack Preview */
      .design-pack-preview {
        margin: 16px 0;
        padding: 12px;
        background: var(--vscode-input-background);
        border-radius: 8px;
        border: 1px solid var(--vscode-panel-border);
      }
      .preview-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .preview-label {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        font-weight: 500;
      }
      .change-style-btn {
        padding: 4px 10px;
        font-size: 12px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .change-style-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      .preview-content {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .preview-image-container {
        flex-shrink: 0;
      }
      .preview-placeholder {
        width: 64px;
        height: 48px;
        background: linear-gradient(135deg, #b180d7 0%, #3794ff 100%);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }
      .pack-initial {
        font-size: 24px;
        font-weight: 700;
        color: white;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }
      .preview-details {
        flex: 1;
        min-width: 0;
      }
      .pack-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-foreground);
        margin-bottom: 4px;
      }
      .tokens-summary {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family), monospace;
      }

      /* Reference Section */
      .reference-section {
        margin: 16px 0;
        padding: 12px;
        background: var(--vscode-input-background);
        border-radius: 8px;
        border: 1px solid var(--vscode-panel-border);
        border-left: 3px solid #e879f9;
      }
      .reference-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }
      .reference-icon {
        font-size: 16px;
      }
      .reference-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--vscode-foreground);
        flex: 1;
      }
      .reference-badge {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: 500;
        background: rgba(232, 121, 249, 0.2);
        color: #e879f9;
        text-transform: uppercase;
      }
      .thumbnail-strip {
        display: flex;
        gap: 8px;
        padding: 8px 0;
        overflow-x: auto;
        margin-bottom: 8px;
      }
      .thumbnail {
        flex-shrink: 0;
        cursor: pointer;
      }
      .thumbnail-placeholder {
        width: 48px;
        height: 48px;
        border-radius: 4px;
        background: rgba(232, 121, 249, 0.15);
        border: 1px solid rgba(232, 121, 249, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .thumbnail-icon {
        font-size: 20px;
      }
      .url-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .url-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
        font-size: 11px;
      }
      .url-favicon {
        font-size: 12px;
      }
      .url-domain {
        color: var(--vscode-textLink-foreground);
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .reference-notice {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px;
        background: rgba(232, 121, 249, 0.1);
        border-radius: 4px;
        margin: 8px 0;
      }
      .notice-icon {
        font-size: 14px;
      }
      .notice-text {
        font-size: 11px;
        color: var(--vscode-foreground);
        font-style: italic;
      }
      .style-source-picker {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
      }
      .picker-label {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-right: 4px;
      }
      .style-option {
        padding: 4px 10px;
        font-size: 11px;
        border-radius: 4px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid transparent;
        cursor: pointer;
        transition: all 0.2s;
      }
      .style-option:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      .style-option.active {
        background: rgba(232, 121, 249, 0.2);
        border-color: #e879f9;
        color: #e879f9;
      }

      /* Design Pack Picker */
      .scaffold-card.style-picker {
        border-left: 4px solid #a855f7;
      }
      .badge.style-pick {
        background: #a855f7;
        color: white;
      }
      .picker-instruction {
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 16px;
        line-height: 1.5;
      }
      .pack-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-bottom: 16px;
      }
      .pack-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        background: var(--vscode-input-background);
        border: 2px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
      }
      .pack-option:hover {
        border-color: var(--vscode-focusBorder);
        background: var(--vscode-list-hoverBackground);
      }
      .pack-option.selected {
        border-color: #a855f7;
        background: rgba(168, 85, 247, 0.1);
      }
      .pack-preview {
        width: 48px;
        height: 36px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
      }
      .pack-letter {
        font-size: 18px;
        font-weight: 700;
        color: white;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }
      .pack-info {
        flex: 1;
        min-width: 0;
      }
      .pack-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--vscode-foreground);
        margin-bottom: 2px;
      }
      .pack-vibe {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
      }
      .check-mark {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 18px;
        height: 18px;
        background: #a855f7;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        color: white;
        font-weight: bold;
      }
      .picker-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }

      /* Style Selected Confirmation */
      .scaffold-card.style-selected {
        border-left: 4px solid #22c55e;
      }
      .selection-confirm {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid #22c55e;
        border-radius: 6px;
      }
      .selection-icon {
        font-size: 20px;
      }
      .selection-text {
        font-size: 13px;
        color: var(--vscode-foreground);
      }
      .selection-text strong {
        color: #22c55e;
      }

      /* Scaffold Execution Event Styles */
      .decision-details {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 8px 0;
      }
      .detail-chip {
        display: inline-block;
        padding: 4px 10px;
        background: var(--vscode-input-background);
        border-radius: 4px;
        font-size: 12px;
        color: var(--vscode-foreground);
      }
      .decision-text {
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }

      .apply-status {
        margin: 12px 0;
      }
      .status-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .status-icon {
        font-size: 16px;
      }
      .status-text {
        color: var(--vscode-foreground);
      }

      .command-preview {
        margin: 12px 0;
        padding: 10px 12px;
        background: var(--vscode-input-background);
        border-radius: 6px;
        border: 1px solid var(--vscode-panel-border);
      }
      .command-label {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        margin-right: 8px;
      }
      .command-text {
        font-family: var(--vscode-editor-font-family), monospace;
        font-size: 12px;
        color: var(--vscode-textLink-foreground);
      }

      .apply-stats {
        display: flex;
        gap: 16px;
        margin: 12px 0;
      }
      .stat-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--vscode-input-background);
        border-radius: 6px;
      }
      .stat-icon {
        font-size: 16px;
      }
      .stat-value {
        font-size: 16px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }
      .stat-label {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      /* Preflight Styles */
      .scaffold-card.preflight { border-left: 4px solid #3794ff; }
      .badge.preflight { background: #3794ff; color: white; }
      .preflight-status { margin: 12px 0; }
      .preflight-results { margin: 12px 0; }
      .result-item {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .result-label {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .result-value {
        font-size: 12px;
        color: var(--vscode-foreground);
      }
      .result-value.safe { color: #89d185; }
      .result-value.warning { color: #cca700; }
      .mono { font-family: var(--vscode-editor-font-family), monospace; }

      .conflicts-section {
        margin-top: 12px;
        padding: 8px;
        background: rgba(204, 167, 0, 0.1);
        border-radius: 4px;
      }
      .conflicts-header {
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .conflict-item {
        display: flex;
        gap: 8px;
        padding: 4px 0;
        font-size: 12px;
      }
      .conflict-type {
        font-weight: 500;
        color: #cca700;
      }
      .conflict-message {
        color: var(--vscode-descriptionForeground);
      }

      /* Target Chosen */
      .scaffold-card.target-chosen { border-left: 4px solid #89d185; }
      .badge.target { background: #89d185; color: #1e1e1e; }
      .target-info { margin: 12px 0; }
      .target-path { margin-bottom: 8px; }
      .path-label {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-right: 8px;
      }
      .path-value {
        font-size: 12px;
        color: var(--vscode-foreground);
      }
      .reason-badge {
        display: inline-block;
        padding: 2px 8px;
        background: var(--vscode-input-background);
        border-radius: 4px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      /* Blocked */
      .scaffold-card.blocked { border-left: 4px solid #f14c4c; }
      .badge.blocked { background: #f14c4c; color: white; }
      .block-info { margin: 12px 0; }
      .block-message {
        font-size: 13px;
        color: var(--vscode-foreground);
        margin-bottom: 8px;
      }
      .block-help {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        margin-top: 8px;
      }

      /* Visual Preview */
      .visual-preview-full {
        margin-bottom: 12px;
      }

      .pack-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 10px;
        padding: 8px 0;
      }

      .pack-name-badge {
        display: inline-block;
        padding: 4px 12px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
      }

      .tokens-hint {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family), monospace;
      }

      .influence-badge {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: linear-gradient(90deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%);
        border-radius: 6px;
        margin-bottom: 12px;
        border: 1px solid rgba(139, 92, 246, 0.3);
      }

      .influence-icon {
        font-size: 16px;
      }

      .influence-text {
        font-size: 11px;
        color: var(--vscode-foreground);
        font-style: italic;
      }
    </style>
  `;
}
