/**
 * PreflightDecisionCard (Step 35.7)
 * 
 * UI component for scaffold preflight decisions:
 * - Non-empty directory detection
 * - Monorepo placement selection
 * - Destructive replace confirmation
 * 
 * CRITICAL UX RULES:
 * - Default to safe options (create subfolder)
 * - Destructive actions require typed confirmation
 * - All decisions emit events for replay
 */

import { escapeHtml } from '../utils/cardHelpers';

// Using local Event interface to avoid cross-package import issues
interface Event {
  event_id: string;
  task_id: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface PreflightDecisionOption {
  id: string;
  label: string;
  description?: string;
  dangerous?: boolean;
  requires_typed_confirm?: boolean;
  default?: boolean;
  data?: Record<string, unknown>;
}

export interface PreflightDecisionPayload {
  scaffold_id: string;
  target_directory: string;
  problem: 'NON_EMPTY_DIR' | 'EXISTING_PROJECT' | 'MONOREPO_AMBIGUOUS';
  summary: string;
  options: PreflightDecisionOption[];
}

/**
 * The exact text required for destructive replace confirmation
 */
const DESTRUCTIVE_CONFIRM_TEXT = 'DELETE_AND_REPLACE';

/**
 * Render the preflight decision card
 */
export function renderPreflightDecisionCard(
  event: Event,
  onAction: (payload: { scaffold_id: string; option_id: string; selected_path?: string; typed_confirm_text?: string }) => void
): string {
  const payload = event.payload as unknown as PreflightDecisionPayload;
  const { scaffold_id, target_directory, problem, summary, options } = payload;

  // Determine badge and colors based on problem type
  const badgeInfo = getBadgeInfo(problem);
  
  return `
    <div class="preflight-decision-card" data-scaffold-id="${scaffold_id}">
      <div class="preflight-header">
        <div class="preflight-icon">⚠️</div>
        <div class="preflight-title">
          <span class="preflight-badge ${badgeInfo.class}">${badgeInfo.text}</span>
          <h3>Scaffold Target Requires Decision</h3>
        </div>
      </div>
      
      <div class="preflight-summary">
        <p>${escapeHtml(summary)}</p>
        <div class="preflight-path">
          <code>${escapeHtml(target_directory)}</code>
        </div>
      </div>
      
      <div class="preflight-options">
        ${options.map(opt => renderOption(scaffold_id, opt)).join('')}
      </div>
      
      <div class="preflight-hint">
        <small>💡 Recommended action is highlighted. All decisions are recorded for audit.</small>
      </div>
    </div>
    
    <style>
      .preflight-decision-card {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 16px;
        margin: 8px 0;
      }
      
      .preflight-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 12px;
      }
      
      .preflight-icon {
        font-size: 24px;
      }
      
      .preflight-title h3 {
        margin: 4px 0 0 0;
        font-size: 14px;
        font-weight: 600;
      }
      
      .preflight-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      
      .badge-warning {
        background: var(--vscode-inputValidation-warningBackground);
        color: var(--vscode-inputValidation-warningForeground);
        border: 1px solid var(--vscode-inputValidation-warningBorder);
      }
      
      .badge-info {
        background: var(--vscode-inputValidation-infoBackground);
        color: var(--vscode-inputValidation-infoForeground);
        border: 1px solid var(--vscode-inputValidation-infoBorder);
      }
      
      .badge-monorepo {
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      
      .preflight-summary {
        margin-bottom: 16px;
      }
      
      .preflight-summary p {
        margin: 0 0 8px 0;
        color: var(--vscode-descriptionForeground);
      }
      
      .preflight-path {
        background: var(--vscode-textCodeBlock-background);
        padding: 8px 12px;
        border-radius: 4px;
      }
      
      .preflight-path code {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        word-break: break-all;
      }
      
      .preflight-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .preflight-option {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .preflight-option:hover {
        background: var(--vscode-list-hoverBackground);
        border-color: var(--vscode-focusBorder);
      }
      
      .preflight-option.default {
        border-color: var(--vscode-button-background);
        border-width: 2px;
      }
      
      .preflight-option.dangerous {
        border-color: var(--vscode-inputValidation-errorBorder);
      }
      
      .preflight-option.dangerous:hover {
        background: var(--vscode-inputValidation-errorBackground);
      }
      
      .preflight-option.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .option-radio {
        width: 16px;
        height: 16px;
        border: 2px solid var(--vscode-input-border);
        border-radius: 50%;
        flex-shrink: 0;
      }
      
      .preflight-option.default .option-radio {
        border-color: var(--vscode-button-background);
        background: var(--vscode-button-background);
      }
      
      .option-content {
        flex: 1;
      }
      
      .option-label {
        font-weight: 500;
        margin-bottom: 2px;
      }
      
      .option-description {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      
      .option-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        margin-left: 8px;
      }
      
      .badge-recommended {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      
      .badge-danger {
        background: var(--vscode-inputValidation-errorBackground);
        color: var(--vscode-inputValidation-errorForeground);
      }
      
      .badge-coming-soon {
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      
      .preflight-hint {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      
      .preflight-hint small {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }
    </style>
  `;
}

/**
 * Render the typed confirmation modal for destructive replace
 */
export function renderTypedConfirmModal(
  scaffold_id: string,
  target_directory: string,
  onConfirm: (payload: { scaffold_id: string; option_id: string; typed_confirm_text: string }) => void,
  onCancel: () => void
): string {
  return `
    <div class="typed-confirm-modal" data-scaffold-id="${scaffold_id}">
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-icon">🚨</div>
          <h3>Confirm Destructive Action</h3>
        </div>
        
        <div class="modal-body">
          <div class="warning-box">
            <p><strong>This action will permanently delete all files in:</strong></p>
            <code>${escapeHtml(target_directory)}</code>
          </div>
          
          <p>To confirm, type <strong>${DESTRUCTIVE_CONFIRM_TEXT}</strong> below:</p>
          
          <input 
            type="text" 
            class="confirm-input" 
            id="destructive-confirm-input-${scaffold_id}"
            placeholder="Type ${DESTRUCTIVE_CONFIRM_TEXT} to confirm"
            autocomplete="off"
          />
          
          <div class="input-hint" id="confirm-hint-${scaffold_id}"></div>
        </div>
        
        <div class="modal-actions">
          <button class="btn-secondary" id="cancel-btn-${scaffold_id}">Go Back</button>
          <button class="btn-danger" id="confirm-btn-${scaffold_id}" disabled>
            Delete and Replace
          </button>
        </div>
      </div>
    </div>
    
    <style>
      .typed-confirm-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
      }
      
      .modal-content {
        position: relative;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 24px;
        max-width: 480px;
        width: 90%;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      }
      
      .modal-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      
      .modal-icon {
        font-size: 28px;
      }
      
      .modal-header h3 {
        margin: 0;
        color: var(--vscode-inputValidation-errorForeground);
      }
      
      .warning-box {
        background: var(--vscode-inputValidation-errorBackground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
      }
      
      .warning-box p {
        margin: 0 0 8px 0;
      }
      
      .warning-box code {
        font-family: var(--vscode-editor-font-family);
        word-break: break-all;
      }
      
      .confirm-input {
        width: 100%;
        padding: 10px 12px;
        border: 2px solid var(--vscode-input-border);
        border-radius: 4px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-family: var(--vscode-editor-font-family);
        font-size: 14px;
        margin-bottom: 8px;
      }
      
      .confirm-input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
      }
      
      .confirm-input.valid {
        border-color: var(--vscode-inputValidation-infoBackground);
      }
      
      .confirm-input.invalid {
        border-color: var(--vscode-inputValidation-errorBorder);
      }
      
      .input-hint {
        font-size: 12px;
        min-height: 18px;
        margin-bottom: 16px;
      }
      
      .input-hint.valid {
        color: var(--vscode-inputValidation-infoForeground);
      }
      
      .input-hint.invalid {
        color: var(--vscode-inputValidation-errorForeground);
      }
      
      .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      
      .btn-secondary {
        padding: 8px 16px;
        border: 1px solid var(--vscode-button-border);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
      }
      
      .btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      
      .btn-danger {
        padding: 8px 16px;
        border: none;
        background: var(--vscode-inputValidation-errorBackground);
        color: var(--vscode-inputValidation-errorForeground);
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
      }
      
      .btn-danger:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      
      .btn-danger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    </style>
  `;
}

/**
 * Initialize event handlers for the typed confirm modal
 */
export function initTypedConfirmModal(
  scaffold_id: string,
  onConfirm: (typed_text: string) => void,
  onCancel: () => void
): void {
  const input = document.getElementById(`destructive-confirm-input-${scaffold_id}`) as HTMLInputElement;
  const hint = document.getElementById(`confirm-hint-${scaffold_id}`);
  const confirmBtn = document.getElementById(`confirm-btn-${scaffold_id}`) as HTMLButtonElement;
  const cancelBtn = document.getElementById(`cancel-btn-${scaffold_id}`);
  
  if (!input || !hint || !confirmBtn || !cancelBtn) return;
  
  input.addEventListener('input', () => {
    const value = input.value.trim();
    const isValid = value === DESTRUCTIVE_CONFIRM_TEXT;
    
    input.classList.toggle('valid', isValid);
    input.classList.toggle('invalid', value.length > 0 && !isValid);
    hint.classList.toggle('valid', isValid);
    hint.classList.toggle('invalid', value.length > 0 && !isValid);
    
    if (isValid) {
      hint.textContent = '✓ Confirmation text matches';
    } else if (value.length > 0) {
      hint.textContent = '✗ Text does not match exactly';
    } else {
      hint.textContent = '';
    }
    
    confirmBtn.disabled = !isValid;
  });
  
  confirmBtn.addEventListener('click', () => {
    onConfirm(input.value.trim());
  });
  
  cancelBtn.addEventListener('click', () => {
    onCancel();
  });
  
  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function renderOption(scaffold_id: string, option: PreflightDecisionOption): string {
  const isDisabled = option.data?.disabled === true;
  const classes = [
    'preflight-option',
    option.default ? 'default' : '',
    option.dangerous ? 'dangerous' : '',
    isDisabled ? 'disabled' : '',
  ].filter(Boolean).join(' ');
  
  let badge = '';
  if (option.default) {
    badge = '<span class="option-badge badge-recommended">Recommended</span>';
  } else if (option.dangerous) {
    badge = '<span class="option-badge badge-danger">Destructive</span>';
  } else if (isDisabled) {
    badge = `<span class="option-badge badge-coming-soon">${option.data?.disabledReason || 'Coming Soon'}</span>`;
  }
  
  const dataPath = option.data?.suggestedPath 
    ? `data-path="${escapeHtml(String(option.data.suggestedPath))}"` 
    : '';
  
  return `
    <div 
      class="${classes}" 
      data-option-id="${option.id}"
      data-scaffold-id="${scaffold_id}"
      data-requires-confirm="${option.requires_typed_confirm || false}"
      ${dataPath}
      ${isDisabled ? 'data-disabled="true"' : ''}
    >
      <div class="option-radio"></div>
      <div class="option-content">
        <div class="option-label">
          ${escapeHtml(option.label)}
          ${badge}
        </div>
        ${option.description ? `<div class="option-description">${escapeHtml(option.description)}</div>` : ''}
      </div>
    </div>
  `;
}

function getBadgeInfo(problem: string): { text: string; class: string } {
  switch (problem) {
    case 'NON_EMPTY_DIR':
      return { text: 'Non-Empty Directory', class: 'badge-warning' };
    case 'EXISTING_PROJECT':
      return { text: 'Existing Project Detected', class: 'badge-warning' };
    case 'MONOREPO_AMBIGUOUS':
      return { text: 'Monorepo Detected', class: 'badge-monorepo' };
    default:
      return { text: 'Decision Required', class: 'badge-info' };
  }
}


// ============================================================================
// EXPORTS
// ============================================================================

export {
  DESTRUCTIVE_CONFIRM_TEXT,
};
