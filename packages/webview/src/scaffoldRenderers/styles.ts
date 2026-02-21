// ScaffoldCard CSS styles.
// NO import/export — pure script file, concatenated into ScaffoldCard.bundle.js

function scaffoldCardStyles(): string {
  return `
    <style>
      :host { display: block; }
      .scaffold-card {
        border-radius: 8px;
        margin: 8px 0;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        overflow: hidden;
      }

      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .icon { font-size: 16px; line-height: 1; }
      .header h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        flex: 1;
        color: var(--vscode-foreground);
      }
      .badge {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .badge.starting { background: var(--vscode-charts-blue, #3794ff); color: white; }
      .badge.proposal { background: var(--vscode-charts-purple, #b180d7); color: white; }
      .badge.ready { background: var(--vscode-charts-green, #89d185); color: #1e1e1e; }
      .badge.cancelled { background: var(--vscode-charts-yellow, #cca700); color: #1e1e1e; }
      .badge.applying { background: var(--vscode-charts-blue, #3794ff); color: white; }

      .prompt-section, .summary-section { padding: 12px 16px; }
      .prompt-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 4px;
      }
      .prompt-text {
        color: var(--vscode-foreground);
        font-size: 13px;
        line-height: 1.5;
      }
      .summary-text {
        color: var(--vscode-foreground);
        font-size: 13px;
        line-height: 1.5;
      }

      .proposal-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .detail-item {
        background: var(--vscode-input-background);
        padding: 8px 12px;
        border-radius: 6px;
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
        background: rgba(137, 209, 133, 0.08);
        margin: 0 16px 12px;
        border-radius: 6px;
      }
      .completion-section.cancelled {
        background: rgba(204, 167, 0, 0.08);
        margin: 0 16px 12px;
        border-radius: 6px;
      }
      .completion-section.terminal-running {
        background: rgba(55, 148, 255, 0.08);
        margin: 0 16px 12px;
        border-radius: 6px;
      }
      .completion-icon { font-size: 14px; }
      .completion-text { color: var(--vscode-foreground); font-size: 12px; }

      .terminal-notice {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        margin: 0 16px 12px;
        background: rgba(55, 148, 255, 0.06);
        border: 1px dashed rgba(55, 148, 255, 0.3);
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
        padding: 8px 16px;
      }

      .timestamp {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        text-align: right;
        padding: 6px 16px 10px;
      }

      .actions {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--vscode-panel-border);
        flex-wrap: wrap;
      }
      button {
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.15s ease;
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
        margin: 0;
        padding: 12px 16px;
        border-top: 1px solid var(--vscode-panel-border);
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

      /* Style Picker Card */
      .badge.style-pick {
        background: var(--vscode-charts-purple, #a855f7);
        color: white;
      }
      .picker-instruction {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        padding: 12px 16px;
        line-height: 1.5;
      }
      .picker-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }

      /* Style Selected Confirmation */
      .selection-confirm {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        background: rgba(34, 197, 94, 0.08);
        border-radius: 6px;
        margin: 8px 16px;
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

      /* Style Intent Section */
      .style-intent-section {
        margin: 0;
        padding: 12px 16px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .style-intent-header {
        margin-bottom: 8px;
      }
      .style-intent-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        letter-spacing: 0.5px;
      }
      .style-intent-input-group {
        margin-bottom: 8px;
      }
      .style-intent-nl-input {
        width: 100%;
        padding: 7px 10px;
        font-size: 12px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 6px;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.2s;
      }
      .style-intent-nl-input:focus {
        border-color: var(--vscode-focusBorder);
      }
      .style-intent-nl-input::placeholder {
        color: var(--vscode-input-placeholderForeground);
      }
      .style-intent-vibes {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .vibe-btn {
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 14px;
        background: var(--vscode-input-background);
        color: var(--vscode-foreground);
        cursor: pointer;
        transition: all 0.2s;
      }
      .vibe-btn:hover {
        background: var(--vscode-list-hoverBackground);
        border-color: var(--vscode-focusBorder);
      }
      .vibe-btn.active {
        background: rgba(139, 92, 246, 0.2);
        border-color: #8b5cf6;
        color: #a78bfa;
      }
      .style-intent-hex-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .hex-label {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .style-intent-hex-input {
        width: 90px;
        padding: 4px 8px;
        font-size: 12px;
        font-family: var(--vscode-editor-font-family), monospace;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 4px;
        outline: none;
        transition: border-color 0.2s;
      }
      .style-intent-hex-input:focus {
        border-color: var(--vscode-focusBorder);
      }

      /* Blueprint Section */
      .blueprint-section {
        border-top: 1px solid var(--vscode-panel-border);
      }
      .blueprint-header {
        padding: 10px 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .blueprint-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .blueprint-header-left .bp-icon { font-size: 14px; }
      .blueprint-header-left .bp-title {
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-foreground);
      }
      .bp-type-badge {
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      .bp-confidence {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }
      .bp-confidence-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      .bp-pages-section {
        padding: 10px 16px;
      }
      .bp-section-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
      }
      .bp-pages-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .bp-page-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: var(--vscode-input-background);
        border-radius: 6px;
      }
      .bp-page-icon { font-size: 12px; }
      .bp-page-info { flex: 1; min-width: 0; }
      .bp-page-name {
        font-size: 11px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }
      .bp-page-meta {
        font-size: 9px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bp-more-pages {
        text-align: center;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        padding: 4px;
      }
      .bp-models-section {
        padding: 8px 16px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .bp-models-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .bp-model-tag {
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-family: var(--vscode-editor-font-family, monospace);
      }
      .bp-footer {
        padding: 6px 16px;
        border-top: 1px solid var(--vscode-panel-border);
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }

      /* Doctor Card */
      .doctor-card .header { border-bottom: 1px solid var(--vscode-panel-border); }
      .doctor-checks {
        padding: 8px 16px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .doctor-check-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 6px;
        background: var(--vscode-input-background);
      }
      .doctor-check-icon { font-size: 12px; }
      .doctor-check-label {
        flex: 1;
        font-size: 11px;
        font-weight: 500;
        color: var(--vscode-foreground);
      }
      .doctor-check-status {
        font-size: 10px;
        font-weight: 600;
      }
      .doctor-actions {
        padding: 8px 16px;
        border-top: 1px solid var(--vscode-panel-border);
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
    </style>
  `;
}
