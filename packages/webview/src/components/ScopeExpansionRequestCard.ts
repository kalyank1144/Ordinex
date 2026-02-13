/**
 * ScopeExpansionRequestCard Component
 * Based on 01_UI_UX_SPEC.md Section 8.6
 * 
 * Displays approval-gated scope expansion requests with:
 * - What is requested (files/lines/tools/budgets)
 * - Why it is needed (evidence-backed reason)
 * - Impact level (low/medium/high)
 * - Controls (Approve once / Approve for mission / Deny / Edit)
 */

import type { ScopeExpansionRequest } from '../types';
import { escapeHtml } from '../utils/cardHelpers';

export interface ScopeExpansionRequestCardProps {
  approvalId: string;
  request: ScopeExpansionRequest;
  onApprove?: (approvalId: string, scope: 'once' | 'mission') => void;
  onDeny?: (approvalId: string) => void;
  onEdit?: (approvalId: string) => void;
}

/**
 * Render scope expansion request card
 */
export function renderScopeExpansionRequestCard(props: ScopeExpansionRequestCardProps): string {
  const { approvalId, request } = props;
  const { requested, reason, impact_level } = request;

  const impactColor = getImpactColor(impact_level);
  const impactLabel = impact_level.toUpperCase();

  return `
    <div class="scope-expansion-card" data-approval-id="${approvalId}">
      <div class="scope-expansion-header">
        <div class="scope-expansion-title">
          <span class="scope-expansion-icon">⚠️</span>
          <span>Scope Expansion Request</span>
        </div>
        <div class="scope-expansion-impact scope-expansion-impact-${impact_level}">
          ${impactLabel} IMPACT
        </div>
      </div>

      <div class="scope-expansion-body">
        <div class="scope-expansion-section">
          <div class="scope-expansion-label">Requested:</div>
          <ul class="scope-expansion-list">
            ${renderRequestedItems(requested)}
          </ul>
        </div>

        <div class="scope-expansion-section">
          <div class="scope-expansion-label">Reason:</div>
          <div class="scope-expansion-reason">
            ${escapeHtml(reason)}
          </div>
        </div>
      </div>

      <div class="scope-expansion-footer">
        <button 
          class="scope-btn scope-btn-approve-once"
          data-action="approve-once"
          data-approval-id="${approvalId}"
        >
          Approve Once
        </button>
        <button 
          class="scope-btn scope-btn-approve-mission"
          data-action="approve-mission"
          data-approval-id="${approvalId}"
        >
          Approve for Mission
        </button>
        <button 
          class="scope-btn scope-btn-deny"
          data-action="deny"
          data-approval-id="${approvalId}"
        >
          Deny
        </button>
        <button 
          class="scope-btn scope-btn-edit"
          data-action="edit"
          data-approval-id="${approvalId}"
        >
          Edit Request
        </button>
      </div>
    </div>
  `;
}

/**
 * Render requested items list
 */
function renderRequestedItems(requested: ScopeExpansionRequest['requested']): string {
  const items: string[] = [];

  if (requested.files && requested.files.length > 0) {
    items.push(`
      <li class="scope-expansion-item">
        <strong>Files:</strong> ${requested.files.length} additional file(s)
        <ul class="scope-expansion-sublist">
          ${requested.files.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('')}
        </ul>
      </li>
    `);
  }

  if (requested.lines && requested.lines > 0) {
    items.push(`
      <li class="scope-expansion-item">
        <strong>Lines:</strong> +${requested.lines} lines
      </li>
    `);
  }

  if (requested.tools && requested.tools.length > 0) {
    items.push(`
      <li class="scope-expansion-item">
        <strong>Tools:</strong> ${requested.tools.map(t => `<code>${t}</code>`).join(', ')}
      </li>
    `);
  }

  if (requested.budgets) {
    const budgetItems: string[] = [];
    if (requested.budgets.max_iterations) {
      budgetItems.push(`${requested.budgets.max_iterations} iterations`);
    }
    if (requested.budgets.max_tool_calls) {
      budgetItems.push(`${requested.budgets.max_tool_calls} tool calls`);
    }
    if (requested.budgets.max_time_ms) {
      budgetItems.push(`${requested.budgets.max_time_ms / 1000}s time`);
    }
    if (budgetItems.length > 0) {
      items.push(`
        <li class="scope-expansion-item">
          <strong>Budgets:</strong> ${budgetItems.join(', ')}
        </li>
      `);
    }
  }

  return items.length > 0 ? items.join('') : '<li>No specific changes requested</li>';
}

/**
 * Get impact color class
 */
function getImpactColor(level: 'low' | 'medium' | 'high'): string {
  switch (level) {
    case 'low': return '#4ec9b0';
    case 'medium': return '#dcdcaa';
    case 'high': return '#f48771';
  }
}

/**
 * Get scope expansion request card styles
 */
export function getScopeExpansionRequestCardStyles(): string {
  return `
    .scope-expansion-card {
      border: 2px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 6px;
      margin: 12px 0;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }

    .scope-expansion-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: rgba(255, 185, 0, 0.1);
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .scope-expansion-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 14px;
    }

    .scope-expansion-icon {
      font-size: 18px;
    }

    .scope-expansion-impact {
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .scope-expansion-impact-low {
      background: rgba(78, 201, 176, 0.2);
      color: #4ec9b0;
    }

    .scope-expansion-impact-medium {
      background: rgba(220, 220, 170, 0.2);
      color: #dcdcaa;
    }

    .scope-expansion-impact-high {
      background: rgba(244, 135, 113, 0.2);
      color: #f48771;
    }

    .scope-expansion-body {
      padding: 16px;
    }

    .scope-expansion-section {
      margin-bottom: 16px;
    }

    .scope-expansion-section:last-child {
      margin-bottom: 0;
    }

    .scope-expansion-label {
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--vscode-foreground);
    }

    .scope-expansion-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .scope-expansion-item {
      padding: 6px 0;
      color: var(--vscode-foreground);
    }

    .scope-expansion-item strong {
      color: var(--vscode-textLink-foreground);
    }

    .scope-expansion-item code {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 4px;
      border-radius: 3px;
    }

    .scope-expansion-sublist {
      list-style: none;
      padding-left: 20px;
      margin-top: 4px;
    }

    .scope-expansion-sublist li {
      padding: 2px 0;
      font-size: 12px;
    }

    .scope-expansion-reason {
      padding: 12px;
      background: rgba(255, 255, 255, 0.03);
      border-left: 3px solid var(--vscode-textLink-foreground);
      border-radius: 3px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--vscode-foreground);
    }

    .scope-expansion-footer {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.02);
      border-top: 1px solid var(--vscode-panel-border);
      flex-wrap: wrap;
    }

    .scope-btn {
      padding: 6px 12px;
      border: 1px solid var(--vscode-button-border);
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }

    .scope-btn:hover {
      opacity: 0.9;
    }

    .scope-btn:active {
      transform: scale(0.98);
    }

    .scope-btn-approve-once {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .scope-btn-approve-mission {
      background: rgba(78, 201, 176, 0.2);
      color: #4ec9b0;
      border-color: #4ec9b0;
    }

    .scope-btn-deny {
      background: rgba(244, 135, 113, 0.2);
      color: #f48771;
      border-color: #f48771;
    }

    .scope-btn-edit {
      background: transparent;
      color: var(--vscode-button-secondaryForeground);
      border-color: var(--vscode-button-secondaryBorder);
    }
  `;
}

