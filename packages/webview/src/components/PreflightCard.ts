/**
 * PreflightCard (Step 43)
 *
 * Renders the preflight checks UI card:
 * - Blockers at top (red) - must be resolved before proceed
 * - Warnings (yellow) - informational, can proceed
 * - Pass (green, collapsed)
 * - Resolution option buttons for blockers/warnings
 * - Inline destructive confirm for replace_all
 *
 * Wire actions back to extension via postMessage:
 *   { type: 'preflight_resolution_selected', runId, checkId, optionId, modifications }
 *
 * CRITICAL UX RULES:
 * - Blockers MUST be resolved before scaffold can proceed
 * - Destructive options require inline confirm step
 * - All decisions are recorded as events (replay-safe)
 */

// ============================================================================
// TYPES (local to avoid cross-package imports)
// ============================================================================

interface PreflightCheck {
  id: string;
  name: string;
  status: 'pass' | 'warn' | 'block';
  message: string;
  resolution?: {
    options: ResolutionOption[];
  };
}

interface ResolutionOption {
  id: string;
  label: string;
  description: string;
  action: 'proceed' | 'modify' | 'cancel';
  modifications?: {
    targetDir?: string;
    mergeMode?: string;
    monorepoPlacement?: string;
  };
}

interface PreflightCardPayload {
  scaffold_id: string;
  run_id: string;
  target_directory: string;
  can_proceed: boolean;
  checks: PreflightCheck[];
  blockers_count: number;
  warnings_count: number;
}

// ============================================================================
// MAIN RENDER
// ============================================================================

/**
 * Render the preflight checks card.
 *
 * Groups checks by status: blockers (red), warnings (yellow), passed (green collapsed).
 *
 * @param payload - Preflight card data from event
 * @returns HTML string for the card
 */
export function renderPreflightCard(payload: PreflightCardPayload): string {
  const { scaffold_id, target_directory, can_proceed, checks, blockers_count, warnings_count } = payload;

  const blockers = checks.filter(c => c.status === 'block');
  const warnings = checks.filter(c => c.status === 'warn');
  const passed = checks.filter(c => c.status === 'pass');

  const statusIcon = can_proceed ? '\u2705' : '\u26D4';
  const statusText = can_proceed
    ? 'All checks passed'
    : `${blockers_count} blocker(s) must be resolved`;

  return `
    <div class="preflight-card" data-scaffold-id="${esc(scaffold_id)}">
      <div class="preflight-card-header">
        <div class="preflight-card-icon">${statusIcon}</div>
        <div class="preflight-card-title">
          <h3>Preflight Checks</h3>
          <span class="preflight-card-subtitle">${esc(statusText)}</span>
        </div>
      </div>

      <div class="preflight-card-target">
        <span class="preflight-card-label">Target:</span>
        <code>${esc(target_directory)}</code>
      </div>

      ${blockers.length > 0 ? renderCheckGroup('Blockers', 'block', blockers, scaffold_id) : ''}
      ${warnings.length > 0 ? renderCheckGroup('Warnings', 'warn', warnings, scaffold_id) : ''}
      ${passed.length > 0 ? renderPassedGroup(passed) : ''}

      ${can_proceed ? renderProceedButton(scaffold_id) : ''}

      <div class="preflight-card-footer">
        <small>All decisions are recorded for audit and replay.</small>
      </div>
    </div>

    ${getPreflightCardStyles()}
  `;
}

// ============================================================================
// GROUP RENDERERS
// ============================================================================

function renderCheckGroup(
  title: string,
  status: 'block' | 'warn',
  checks: PreflightCheck[],
  scaffoldId: string
): string {
  const colorClass = status === 'block' ? 'check-group-block' : 'check-group-warn';
  const icon = status === 'block' ? '\u274C' : '\u26A0\uFE0F';

  return `
    <div class="check-group ${colorClass}">
      <div class="check-group-header">
        <span class="check-group-icon">${icon}</span>
        <span class="check-group-title">${esc(title)} (${checks.length})</span>
      </div>
      <div class="check-group-items">
        ${checks.map(c => renderCheckItem(c, scaffoldId)).join('')}
      </div>
    </div>
  `;
}

function renderPassedGroup(checks: PreflightCheck[]): string {
  return `
    <details class="check-group check-group-pass">
      <summary class="check-group-header">
        <span class="check-group-icon">\u2705</span>
        <span class="check-group-title">Passed (${checks.length})</span>
      </summary>
      <div class="check-group-items">
        ${checks.map(c => renderPassedItem(c)).join('')}
      </div>
    </details>
  `;
}

function renderCheckItem(check: PreflightCheck, scaffoldId: string): string {
  const statusClass = check.status === 'block' ? 'check-item-block' : 'check-item-warn';

  return `
    <div class="check-item ${statusClass}" data-check-id="${esc(check.id)}">
      <div class="check-item-header">
        <strong>${esc(check.name)}</strong>
      </div>
      <div class="check-item-message">${esc(check.message)}</div>
      ${check.resolution ? renderResolutionOptions(check, scaffoldId) : ''}
    </div>
  `;
}

function renderPassedItem(check: PreflightCheck): string {
  return `
    <div class="check-item check-item-pass">
      <div class="check-item-header">
        <strong>${esc(check.name)}</strong>
      </div>
      <div class="check-item-message">${esc(check.message)}</div>
    </div>
  `;
}

// ============================================================================
// RESOLUTION OPTIONS
// ============================================================================

function renderResolutionOptions(check: PreflightCheck, scaffoldId: string): string {
  if (!check.resolution) return '';

  return `
    <div class="resolution-options" data-check-id="${esc(check.id)}">
      <div class="resolution-label">Choose a resolution:</div>
      ${check.resolution.options.map(opt => renderResolutionButton(opt, check.id, scaffoldId)).join('')}
    </div>
  `;
}

function renderResolutionButton(
  option: ResolutionOption,
  checkId: string,
  scaffoldId: string
): string {
  const isDestructive = option.modifications?.mergeMode === 'replace_all';
  const btnClass = isDestructive ? 'resolution-btn resolution-btn-danger' :
                   option.action === 'cancel' ? 'resolution-btn resolution-btn-secondary' :
                   'resolution-btn resolution-btn-primary';

  // For destructive options, render inline confirm step
  if (isDestructive) {
    return `
      <div class="resolution-btn-container">
        <button
          class="${btnClass}"
          data-scaffold-id="${esc(scaffoldId)}"
          data-check-id="${esc(checkId)}"
          data-option-id="${esc(option.id)}"
          data-destructive="true"
          onclick="showDestructiveConfirm(this)"
        >
          ${esc(option.label)}
        </button>
        <div class="destructive-confirm hidden" id="confirm-${esc(checkId)}-${esc(option.id)}">
          <p class="destructive-warn-text">
            This will delete existing files in the target directory. Are you sure?
          </p>
          <div class="destructive-confirm-actions">
            <button
              class="resolution-btn resolution-btn-danger-confirm"
              data-scaffold-id="${esc(scaffoldId)}"
              data-check-id="${esc(checkId)}"
              data-option-id="${esc(option.id)}"
              data-modifications='${escAttr(JSON.stringify(option.modifications || {}))}'
              onclick="selectResolution(this)"
            >
              Confirm Replace
            </button>
            <button
              class="resolution-btn resolution-btn-secondary"
              onclick="hideDestructiveConfirm(this)"
            >
              Back
            </button>
          </div>
        </div>
        <div class="resolution-description">${esc(option.description)}</div>
      </div>
    `;
  }

  return `
    <div class="resolution-btn-container">
      <button
        class="${btnClass}"
        data-scaffold-id="${esc(scaffoldId)}"
        data-check-id="${esc(checkId)}"
        data-option-id="${esc(option.id)}"
        data-modifications='${escAttr(JSON.stringify(option.modifications || {}))}'
        onclick="selectResolution(this)"
      >
        ${esc(option.label)}
      </button>
      <div class="resolution-description">${esc(option.description)}</div>
    </div>
  `;
}

function renderProceedButton(scaffoldId: string): string {
  return `
    <div class="preflight-proceed">
      <button
        class="proceed-btn"
        data-scaffold-id="${esc(scaffoldId)}"
        onclick="proceedWithScaffold(this)"
      >
        Continue to Scaffold
      </button>
    </div>
  `;
}

// ============================================================================
// CLIENT-SIDE SCRIPTS (injected into webview)
// ============================================================================

/**
 * Get client-side JavaScript for preflight card interactions.
 *
 * Provides:
 * - selectResolution(btn) -> postMessage to extension
 * - showDestructiveConfirm(btn) -> inline confirm UI
 * - hideDestructiveConfirm(btn) -> hide confirm UI
 * - proceedWithScaffold(btn) -> postMessage to proceed
 */
export function getPreflightCardScripts(): string {
  return `
    <script>
      function selectResolution(btn) {
        const scaffoldId = btn.dataset.scaffoldId;
        const checkId = btn.dataset.checkId;
        const optionId = btn.dataset.optionId;
        let modifications = {};
        try {
          modifications = JSON.parse(btn.dataset.modifications || '{}');
        } catch {}

        // Send message to extension
        const vscode = acquireVsCodeApi ? acquireVsCodeApi() : null;
        if (vscode) {
          vscode.postMessage({
            type: 'preflight_resolution_selected',
            scaffoldId,
            checkId,
            optionId,
            modifications,
          });
        }

        // Visual feedback: disable all buttons in this check group
        const container = btn.closest('.resolution-options');
        if (container) {
          container.querySelectorAll('button').forEach(b => {
            b.disabled = true;
            b.classList.add('disabled');
          });
          btn.classList.add('selected');
        }
      }

      function showDestructiveConfirm(btn) {
        const checkId = btn.dataset.checkId;
        const optionId = btn.dataset.optionId;
        const confirmEl = document.getElementById('confirm-' + checkId + '-' + optionId);
        if (confirmEl) {
          confirmEl.classList.remove('hidden');
          btn.classList.add('hidden');
        }
      }

      function hideDestructiveConfirm(btn) {
        const confirmContainer = btn.closest('.destructive-confirm');
        if (confirmContainer) {
          confirmContainer.classList.add('hidden');
          const parentBtn = confirmContainer.previousElementSibling;
          if (parentBtn) {
            parentBtn.classList.remove('hidden');
          }
        }
      }

      function proceedWithScaffold(btn) {
        const scaffoldId = btn.dataset.scaffoldId;
        const vscode = acquireVsCodeApi ? acquireVsCodeApi() : null;
        if (vscode) {
          vscode.postMessage({
            type: 'preflight_proceed',
            scaffoldId,
          });
        }
        btn.disabled = true;
        btn.textContent = 'Proceeding...';
      }
    </script>
  `;
}

// ============================================================================
// STYLES
// ============================================================================

function getPreflightCardStyles(): string {
  return `
    <style>
      .preflight-card {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 16px;
        margin: 8px 0;
        font-family: var(--vscode-font-family);
        font-size: 13px;
      }

      .preflight-card-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }

      .preflight-card-icon {
        font-size: 20px;
      }

      .preflight-card-title h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }

      .preflight-card-subtitle {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .preflight-card-target {
        background: var(--vscode-textCodeBlock-background);
        padding: 8px 12px;
        border-radius: 4px;
        margin-bottom: 16px;
      }

      .preflight-card-label {
        font-weight: 500;
        margin-right: 8px;
        color: var(--vscode-descriptionForeground);
      }

      .preflight-card-target code {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        word-break: break-all;
      }

      /* Check Groups */
      .check-group {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        margin-bottom: 12px;
        overflow: hidden;
      }

      .check-group-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        font-weight: 500;
        cursor: pointer;
      }

      .check-group-block {
        border-color: var(--vscode-inputValidation-errorBorder);
      }

      .check-group-block .check-group-header {
        background: var(--vscode-inputValidation-errorBackground);
        color: var(--vscode-inputValidation-errorForeground);
      }

      .check-group-warn {
        border-color: var(--vscode-inputValidation-warningBorder);
      }

      .check-group-warn .check-group-header {
        background: var(--vscode-inputValidation-warningBackground);
        color: var(--vscode-inputValidation-warningForeground);
      }

      .check-group-pass {
        border-color: var(--vscode-inputValidation-infoBorder);
      }

      .check-group-pass .check-group-header {
        background: var(--vscode-inputValidation-infoBackground);
        color: var(--vscode-inputValidation-infoForeground);
      }

      .check-group-items {
        padding: 8px 12px;
      }

      /* Check Items */
      .check-item {
        padding: 8px 0;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .check-item:last-child {
        border-bottom: none;
      }

      .check-item-header {
        margin-bottom: 4px;
      }

      .check-item-message {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
      }

      /* Resolution Options */
      .resolution-options {
        padding: 8px 0;
      }

      .resolution-label {
        font-size: 12px;
        font-weight: 500;
        margin-bottom: 6px;
        color: var(--vscode-descriptionForeground);
      }

      .resolution-btn-container {
        margin-bottom: 6px;
      }

      .resolution-btn {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        border: 1px solid transparent;
        font-family: var(--vscode-font-family);
      }

      .resolution-btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-button-background);
      }

      .resolution-btn-primary:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .resolution-btn-secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border-color: var(--vscode-button-border);
      }

      .resolution-btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }

      .resolution-btn-danger {
        background: var(--vscode-inputValidation-errorBackground);
        color: var(--vscode-inputValidation-errorForeground);
        border-color: var(--vscode-inputValidation-errorBorder);
      }

      .resolution-btn-danger:hover {
        filter: brightness(1.1);
      }

      .resolution-btn-danger-confirm {
        background: #d32f2f;
        color: #fff;
        border: none;
        font-weight: 500;
      }

      .resolution-btn.disabled,
      .resolution-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .resolution-btn.selected {
        outline: 2px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }

      .resolution-description {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 2px;
        padding-left: 2px;
      }

      /* Destructive Confirm */
      .destructive-confirm {
        background: var(--vscode-inputValidation-errorBackground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        border-radius: 4px;
        padding: 10px;
        margin-top: 4px;
      }

      .destructive-warn-text {
        margin: 0 0 8px 0;
        font-size: 12px;
        font-weight: 500;
        color: var(--vscode-inputValidation-errorForeground);
      }

      .destructive-confirm-actions {
        display: flex;
        gap: 8px;
      }

      .hidden {
        display: none !important;
      }

      /* Proceed Button */
      .preflight-proceed {
        margin-top: 16px;
        text-align: center;
      }

      .proceed-btn {
        padding: 10px 24px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        font-family: var(--vscode-font-family);
      }

      .proceed-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .proceed-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Footer */
      .preflight-card-footer {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--vscode-panel-border);
      }

      .preflight-card-footer small {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }
    </style>
  `;
}

// ============================================================================
// HELPERS
// ============================================================================

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#039;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  PreflightCardPayload,
};
