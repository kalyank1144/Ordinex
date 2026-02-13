/**
 * ScopeSummary Component
 * Based on 01_UI_UX_SPEC.md Section 8.3
 * 
 * Displays compact, always-visible scope information:
 * - Files: current/max
 * - Lines: current/max
 * - Tools: allowed categories
 * - Iterations: current/max
 */

import type { ScopeSummary } from '../types';
import { escapeHtml } from '../utils/cardHelpers';

export interface ScopeSummaryProps {
  summary: ScopeSummary;
  currentIteration: number;
}

/**
 * Render compact scope summary
 * Example: "SCOPE: 3 files | 200 lines | Tools: read+exec | Iterations: 2/3"
 */
export function renderScopeSummary(props: ScopeSummaryProps): string {
  const { summary, currentIteration } = props;
  const { contract, in_scope_files, lines_retrieved, tools_used } = summary;

  const filesDisplay = `${in_scope_files.length}/${contract.max_files} files`;
  const linesDisplay = `${lines_retrieved}/${contract.max_lines} lines`;
  const toolsDisplay = tools_used.length > 0 
    ? tools_used.join('+') 
    : contract.allowed_tools.join('+');
  const iterationsDisplay = `${currentIteration}/${contract.budgets.max_iterations}`;

  return `
    <div class="scope-summary" role="status" aria-label="Scope summary">
      <div class="scope-label">SCOPE:</div>
      <div class="scope-details">
        <span class="scope-item" title="Files in scope">${filesDisplay}</span>
        <span class="scope-separator">|</span>
        <span class="scope-item" title="Lines retrieved">${linesDisplay}</span>
        <span class="scope-separator">|</span>
        <span class="scope-item" title="Tool categories">Tools: ${toolsDisplay}</span>
        <span class="scope-separator">|</span>
        <span class="scope-item" title="Iteration progress">Iterations: ${iterationsDisplay}</span>
      </div>
    </div>
  `;
}

/**
 * Render detailed scope breakdown (expandable section)
 */
export function renderDetailedScope(summary: ScopeSummary): string {
  const { in_scope_files, touched_files } = summary;

  return `
    <div class="scope-detailed">
      <details class="scope-section">
        <summary class="scope-section-header">In Scope (${in_scope_files.length})</summary>
        <ul class="scope-file-list">
          ${in_scope_files.map(file => `
            <li class="scope-file-item">
              <code>${escapeHtml(file)}</code>
            </li>
          `).join('')}
        </ul>
      </details>

      <details class="scope-section">
        <summary class="scope-section-header">Touched (${touched_files.length})</summary>
        <ul class="scope-file-list">
          ${touched_files.map(file => `
            <li class="scope-file-item">
              <code>${escapeHtml(file.path)}</code>
              <div class="scope-operations">
                ${file.operations.map(op => `
                  <span class="scope-op scope-op-${op.type}" title="${op.timestamp}">
                    ${op.type}${op.line_range ? ` (L${op.line_range.start}-${op.line_range.end})` : ''}
                  </span>
                `).join('')}
              </div>
            </li>
          `).join('')}
        </ul>
      </details>
    </div>
  `;
}

/**
 * Get scope summary styles
 */
export function getScopeSummaryStyles(): string {
  return `
    .scope-summary {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.05);
      border-left: 3px solid var(--vscode-charts-blue);
      font-size: 12px;
      font-family: var(--vscode-editor-font-family);
      margin: 8px 0;
      gap: 8px;
    }

    .scope-label {
      font-weight: 600;
      color: var(--vscode-charts-blue);
      white-space: nowrap;
    }

    .scope-details {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .scope-item {
      white-space: nowrap;
      color: var(--vscode-foreground);
    }

    .scope-separator {
      color: var(--vscode-descriptionForeground);
      opacity: 0.5;
    }

    .scope-detailed {
      margin: 12px 0;
      font-size: 13px;
    }

    .scope-section {
      margin: 8px 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
    }

    .scope-section-header {
      padding: 8px 12px;
      background: var(--vscode-editor-background);
      cursor: pointer;
      font-weight: 500;
      user-select: none;
    }

    .scope-section-header:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .scope-file-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .scope-file-item {
      padding: 6px 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .scope-file-item code {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      color: var(--vscode-textLink-foreground);
    }

    .scope-operations {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }

    .scope-op {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-family: var(--vscode-editor-font-family);
      text-transform: uppercase;
    }

    .scope-op-read {
      background: rgba(75, 185, 255, 0.2);
      color: #4bb9ff;
    }

    .scope-op-write {
      background: rgba(255, 185, 75, 0.2);
      color: #ffb94b;
    }

    .scope-op-execute {
      background: rgba(185, 75, 255, 0.2);
      color: #b94bff;
    }
  `;
}

