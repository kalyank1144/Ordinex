/**
 * Clarification Card Component
 * 
 * Renders the grounded multiple-choice clarification card for PLAN mode.
 * 
 * Features:
 * - Deterministic option ordering (stable IDs)
 * - Click safety (prevents spam-clicks / duplicate selections)
 * - State machine: idle → selecting → processing → complete
 * - Error handling with toast messages
 * - Dynamic header based on anchor files count
 */

import { Event } from '../types';

/**
 * State machine for clarification card
 */
type ClarificationState = 'idle' | 'selecting' | 'processing' | 'complete';

/**
 * Clarification option from backend
 */
interface ClarificationOption {
  id: string;
  title: string;
  description: string;
  evidence: string[];
}

/**
 * Render the clarification card from a clarification_presented event
 */
export function renderClarificationCard(
  event: Event,
  taskId: string
): string {
  const options = event.payload.options as ClarificationOption[];
  const fallbackOptionId = event.payload.fallback_option_id as string || 'fallback-suggest';
  const anchorFilesCount = event.payload.anchor_files_count as number || 0;

  // Build header text based on context quality
  const headerText = anchorFilesCount > 0
    ? `Based on your project structure • ${anchorFilesCount} relevant files found`
    : 'Based on project analysis • Limited context available';

  // Build option buttons HTML
  const optionsHtml = options.map(opt => {
    const evidenceText = opt.evidence.length > 0
      ? opt.evidence.slice(0, 3).map(e => escapeHtml(e)).join(', ')
      : '';
    
    const isSkip = opt.id === fallbackOptionId || opt.id === 'fallback-suggest';
    const buttonClass = isSkip ? 'clarification-btn skip-btn' : 'clarification-btn';
    
    return `
      <button 
        class="${buttonClass}" 
        data-option-id="${escapeHtml(opt.id)}"
        data-task-id="${escapeHtml(taskId)}"
        onclick="handleClarificationSelect('${escapeHtml(taskId)}', '${escapeHtml(opt.id)}')"
      >
        <div class="clarification-btn-content">
          <span class="clarification-btn-title">${escapeHtml(opt.title)}</span>
          <span class="clarification-btn-desc">${escapeHtml(opt.description)}</span>
          ${evidenceText ? `<span class="clarification-btn-evidence">${evidenceText}</span>` : ''}
        </div>
        <span class="clarification-btn-spinner" style="display: none;">⏳</span>
      </button>
    `;
  }).join('');

  return `
    <div class="clarification-card" id="clarification-card-${escapeHtml(taskId)}" data-state="idle">
      <div class="clarification-card-header">
        <span class="clarification-icon">🎯</span>
        <span class="clarification-title">Where should we focus?</span>
      </div>
      <div class="clarification-card-subtitle">
        ${escapeHtml(headerText)}<br/>
        <span style="font-style: italic;">Select an area to plan specific changes, or skip for feature suggestions</span>
      </div>
      <div class="clarification-options">
        ${optionsHtml}
      </div>
      <div class="clarification-actions">
        <button 
          class="clarification-action-btn clarification-skip-link" 
          onclick="handleClarificationSkip('${escapeHtml(taskId)}')"
        >
          Skip and suggest ideas
        </button>
        <button 
          class="clarification-action-btn clarification-edit-link" 
          onclick="handleClarificationEdit('${escapeHtml(taskId)}')"
        >
          ✏️ Edit prompt
        </button>
        <button 
          class="clarification-action-btn clarification-cancel-link" 
          onclick="handleClarificationCancel('${escapeHtml(taskId)}')"
        >
          ✕ Cancel
        </button>
      </div>
      <div class="clarification-processing" style="display: none;">
        <span class="processing-spinner">⏳</span>
        <span class="processing-text">Generating plan...</span>
      </div>
    </div>
  `;
}

/**
 * Get CSS styles for clarification card
 */
export function getClarificationCardStyles(): string {
  return `
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

    .clarification-actions {
      display: flex;
      gap: 12px;
      margin-top: 16px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .clarification-action-btn {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      font-size: 12px;
      cursor: pointer;
      padding: 6px 12px;
      border-radius: 4px;
      transition: background 0.15s;
    }

    .clarification-action-btn:hover {
      background: var(--vscode-button-secondaryBackground);
    }

    .clarification-action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .clarification-skip-link {
      color: var(--vscode-textLink-foreground);
    }

    .clarification-edit-link {
      color: var(--vscode-descriptionForeground);
    }

    .clarification-cancel-link {
      color: var(--vscode-errorForeground);
    }

    .clarification-card[data-state="selecting"] .clarification-actions,
    .clarification-card[data-state="processing"] .clarification-actions {
      display: none;
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
  `;
}

/**
 * JavaScript handler functions for clarification interactions
 * These are injected into the webview
 */
export function getClarificationHandlerScript(): string {
  return `
    // Track selection state to prevent duplicates
    let clarificationSelectionInProgress = false;

    function handleClarificationSelect(taskId, optionId) {
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
          btn.querySelector('.clarification-btn-spinner').style.display = 'inline-block';
        }
        btn.disabled = true;
      });

      // Disable skip link
      const skipLink = card.querySelector('.clarification-skip-link');
      if (skipLink) skipLink.disabled = true;

      // Send selection to extension
      try {
        vscode.postMessage({
          type: 'ordinex:selectClarificationOption',
          task_id: taskId,
          option_id: optionId
        });
        
        // Transition to processing after short delay
        setTimeout(() => {
          card.setAttribute('data-state', 'processing');
        }, 500);

      } catch (error) {
        console.error('[ClarificationCard] Failed to send selection:', error);
        
        // Reset state on error
        clarificationSelectionInProgress = false;
        card.setAttribute('data-state', 'idle');
        buttons.forEach(btn => {
          btn.classList.remove('selected');
          btn.querySelector('.clarification-btn-spinner').style.display = 'none';
          btn.disabled = false;
        });
        if (skipLink) skipLink.disabled = false;
        
        // Show error toast
        showToast('Failed to send selection. Please try again.');
      }
    }

    function handleClarificationSkip(taskId) {
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
      try {
        vscode.postMessage({
          type: 'ordinex:skipClarification',
          task_id: taskId
        });
        
        // Transition to processing after short delay
        setTimeout(() => {
          card.setAttribute('data-state', 'processing');
        }, 500);

      } catch (error) {
        console.error('[ClarificationCard] Failed to send skip:', error);
        
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
        
        // Show error toast
        showToast('Failed to send selection. Please try again.');
      }
    }

    function showToast(message) {
      // Create toast element if it doesn't exist
      let toast = document.getElementById('ordinex-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ordinex-toast';
        toast.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--vscode-notifications-background); color: var(--vscode-notifications-foreground); padding: 12px 20px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 1000; opacity: 0; transition: opacity 0.3s;';
        document.body.appendChild(toast);
      }
      
      toast.textContent = message;
      toast.style.opacity = '1';
      
      setTimeout(() => {
        toast.style.opacity = '0';
      }, 3000);
    }

    function handleClarificationEdit(taskId) {
      // Prevent duplicate clicks
      if (clarificationSelectionInProgress) {
        console.log('[ClarificationCard] Selection already in progress, ignoring edit');
        return;
      }

      const card = document.getElementById('clarification-card-' + taskId);
      if (!card) {
        console.error('[ClarificationCard] Card not found');
        return;
      }

      const currentState = card.getAttribute('data-state');
      if (currentState !== 'idle') {
        console.log('[ClarificationCard] Not in idle state, ignoring edit');
        return;
      }

      console.log('[ClarificationCard] Edit prompt requested for task:', taskId);

      // Send edit request to extension
      try {
        vscode.postMessage({
          type: 'ordinex:editClarificationPrompt',
          task_id: taskId
        });
        
        // Hide the card (extension will focus input)
        card.style.display = 'none';

      } catch (error) {
        console.error('[ClarificationCard] Failed to send edit request:', error);
        showToast('Failed to edit prompt. Please try again.');
      }
    }

    function handleClarificationCancel(taskId) {
      // Prevent duplicate clicks
      if (clarificationSelectionInProgress) {
        console.log('[ClarificationCard] Selection already in progress, ignoring cancel');
        return;
      }

      const card = document.getElementById('clarification-card-' + taskId);
      if (!card) {
        console.error('[ClarificationCard] Card not found');
        return;
      }

      const currentState = card.getAttribute('data-state');
      if (currentState !== 'idle') {
        console.log('[ClarificationCard] Not in idle state, ignoring cancel');
        return;
      }

      console.log('[ClarificationCard] Cancel requested for task:', taskId);

      // Send cancel request to extension
      try {
        vscode.postMessage({
          type: 'ordinex:cancelClarification',
          task_id: taskId
        });
        
        // Remove the card from DOM
        card.remove();

      } catch (error) {
        console.error('[ClarificationCard] Failed to send cancel request:', error);
        showToast('Failed to cancel. Please try again.');
      }
    }

    // Reset clarification state when new events arrive
    function resetClarificationState() {
      clarificationSelectionInProgress = false;
    }
  `;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
