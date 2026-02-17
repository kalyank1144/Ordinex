/**
 * LoopPausedCard Component — AgenticLoop Integration
 *
 * Renders when the AgenticLoop pauses (max_iterations, max_tokens, error).
 * Shows: iteration count, staged files, token usage, action buttons.
 *
 * Actions:
 * - Continue: Resume the loop (if continues remaining)
 * - Approve Partial: Apply currently staged changes to disk
 * - Discard: Throw away all staged changes
 *
 * Stateless rendering function — all data comes from the loop_paused event payload.
 */

import { Event } from '../types';
import { escapeHtml, escapeAttr } from '../utils/cardHelpers';

// ============================================================================
// TYPES
// ============================================================================

interface StagedFileSummary {
  path: string;
  action: 'create' | 'update' | 'delete';
  edit_count: number;
}

// ============================================================================
// RENDERING
// ============================================================================

/**
 * Render a loop paused card with staged files and action buttons.
 */
export function renderLoopPausedCard(event: Event): string {
  const p = event.payload || {};
  const reason = (p.reason as string) || 'unknown';
  const iterationCount = (p.iteration_count as number) || 0;
  const continueCount = (p.continue_count as number) || 0;
  const maxContinues = (p.max_continues as number) || 3;
  const canContinue = p.can_continue !== false && continueCount < maxContinues;
  const remainingContinues = (p.remaining_continues as number) ?? (maxContinues - continueCount);
  const stagedFiles = (p.staged_files as StagedFileSummary[]) || [];
  const totalTokens = p.total_tokens as { input: number; output: number } | undefined;
  const toolCallsCount = (p.tool_calls_count as number) || 0;
  const sessionId = (p.session_id as string) || '';
  const stepId = (p.step_id as string) || '';
  const finalText = (p.final_text as string) || '';

  // Reason label
  const reasonLabel = getReasonLabel(reason);
  const reasonIcon = getReasonIcon(reason);

  // Build staged files list
  const filesHtml = stagedFiles.length > 0
    ? stagedFiles.map(f => {
      const icon = f.action === 'create' ? '+' : f.action === 'delete' ? '−' : '~';
      const color = f.action === 'create' ? '#4ade80' : f.action === 'delete' ? '#f87171' : '#fbbf24';
      return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">
        <span style="color:${color};font-weight:bold;width:14px;text-align:center;">${icon}</span>
        <span style="font-family:monospace;font-size:12px;">${escapeHtml(f.path)}</span>
        <span style="color:var(--vscode-descriptionForeground);font-size:11px;">${f.edit_count} edit${f.edit_count !== 1 ? 's' : ''}</span>
      </div>`;
    }).join('')
    : '<div style="color:var(--vscode-descriptionForeground);font-style:italic;">No files staged</div>';

  // Token usage
  const tokenHtml = totalTokens
    ? `<span style="color:var(--vscode-descriptionForeground);font-size:11px;">
        ${formatTokens(totalTokens.input)} in / ${formatTokens(totalTokens.output)} out
      </span>`
    : '';

  // Summary line
  const finalTextPreview = finalText.length > 200
    ? escapeHtml(finalText.substring(0, 200)) + '…'
    : escapeHtml(finalText);

  // Action buttons
  const continueBtn = canContinue
    ? `<button class="loop-action-btn loop-continue-btn"
        onclick="handleLoopAction('continue_loop', '${escapeAttr(stepId)}', '${escapeAttr(sessionId)}')"
        title="Continue the loop (${remainingContinues} continue${remainingContinues !== 1 ? 's' : ''} remaining)">
        ▶ Continue (${remainingContinues} left)
      </button>`
    : `<button class="loop-action-btn" disabled title="Maximum continues reached">
        ▶ Continue (0 left)
      </button>`;

  const approveBtn = stagedFiles.length > 0
    ? `<button class="loop-action-btn loop-approve-btn"
        onclick="handleLoopAction('approve_partial', '${escapeAttr(stepId)}', '${escapeAttr(sessionId)}')"
        title="Apply staged changes to disk">
        ✓ Approve ${stagedFiles.length} file${stagedFiles.length !== 1 ? 's' : ''}
      </button>`
    : '';

  const discardBtn = `<button class="loop-action-btn loop-discard-btn"
    onclick="handleLoopAction('discard_loop', '${escapeAttr(stepId)}', '${escapeAttr(sessionId)}')"
    title="Discard all staged changes">
    ✕ Discard
  </button>`;

  return `
    <div class="loop-paused-card" data-session-id="${escapeAttr(sessionId)}" data-step-id="${escapeAttr(stepId)}">
      <div class="loop-paused-header">
        <span class="loop-paused-icon">${reasonIcon}</span>
        <span class="loop-paused-title">Loop Paused — ${escapeHtml(reasonLabel)}</span>
      </div>

      <div class="loop-paused-stats">
        <span>${iterationCount} iteration${iterationCount !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>${toolCallsCount} tool call${toolCallsCount !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>${stagedFiles.length} file${stagedFiles.length !== 1 ? 's' : ''} staged</span>
        ${tokenHtml ? `<span>·</span>${tokenHtml}` : ''}
      </div>

      ${finalTextPreview ? `
        <div class="loop-paused-summary">
          <div style="font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:4px;">LLM Summary:</div>
          <div style="font-size:12px;">${finalTextPreview}</div>
        </div>
      ` : ''}

      <div class="loop-paused-files">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Staged Changes:</div>
        ${filesHtml}
      </div>

      <div class="loop-paused-actions">
        ${continueBtn}
        ${approveBtn}
        ${discardBtn}
      </div>
    </div>

    <style>
      .loop-paused-card {
        border: 1px solid var(--vscode-panel-border, #444);
        border-radius: 6px;
        padding: 12px;
        margin: 8px 0;
        background: var(--vscode-editor-background);
      }
      .loop-paused-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .loop-paused-icon {
        font-size: 16px;
      }
      .loop-paused-title {
        font-weight: 600;
        font-size: 13px;
      }
      .loop-paused-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
      }
      .loop-paused-summary {
        padding: 8px;
        border-radius: 4px;
        background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
        margin-bottom: 8px;
      }
      .loop-paused-files {
        padding: 8px;
        border-radius: 4px;
        background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
        margin-bottom: 10px;
        max-height: 150px;
        overflow-y: auto;
      }
      .loop-paused-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .loop-action-btn {
        padding: 4px 12px;
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      .loop-action-btn:hover:not(:disabled) {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      .loop-action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .loop-continue-btn {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .loop-continue-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .loop-approve-btn {
        background: #22863a;
        color: white;
        border-color: #22863a;
      }
      .loop-approve-btn:hover {
        background: #2ea043;
      }
      .loop-discard-btn {
        color: #f87171;
        border-color: #f87171;
        background: transparent;
      }
      .loop-discard-btn:hover {
        background: rgba(248,113,113,0.1);
      }
    </style>
  `;
}

// ============================================================================
// HELPERS
// ============================================================================

function getReasonLabel(reason: string): string {
  switch (reason) {
    case 'max_iterations': return 'Iteration Limit Reached';
    case 'max_tokens': return 'Token Budget Exceeded';
    case 'end_turn': return 'LLM Finished';
    case 'error': return 'Error Occurred';
    case 'user_stop': return 'Stopped by User';
    default: return reason;
  }
}

function getReasonIcon(reason: string): string {
  switch (reason) {
    case 'max_iterations': return '⏸';
    case 'max_tokens': return '📊';
    case 'end_turn': return '✓';
    case 'error': return '⚠';
    case 'user_stop': return '⏹';
    default: return '⏸';
  }
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
