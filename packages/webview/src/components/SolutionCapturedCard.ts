/**
 * V5: SolutionCapturedCard Component
 * Renders solution_captured events showing proven solutions.
 * Follows CheckpointCreatedCard pattern.
 */

import { Event } from '../types';
import { escapeHtml, formatTimestamp } from '../utils/cardHelpers';

export function renderSolutionCapturedCard(event: Event): string {
  const problem = (event.payload.problem as string) || 'Unknown problem';
  const fix = (event.payload.fix as string) || 'Unknown fix';
  const filesChanged = (event.payload.files_changed as string[]) || [];
  const tags = (event.payload.tags as string[]) || [];
  const verification = event.payload.verification as {
    type?: string;
    command?: string;
    summary?: string;
  } | undefined;
  const verType = verification?.type || 'manual';
  const verCommand = verification?.command || 'unknown';
  const verSummary = verification?.summary || '';

  const verIcon = verType === 'tests' ? '✅' : verType === 'build' ? '🔨' : verType === 'lint' ? '🔍' : '✋';

  const tagBadges = tags.map(t => `<span style="
    display: inline-block;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    margin-right: 4px;
    margin-bottom: 2px;
  ">${escapeHtml(t)}</span>`).join('');

  return `
    <div class="solution-captured-card" style="
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 2px solid var(--vscode-charts-green);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    ">
      <div style="
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      ">
        <span style="font-size: 20px;">💡</span>
        <span style="font-weight: 700; color: var(--vscode-charts-green);">
          Solution Captured
        </span>
        <span style="
          margin-left: auto;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
        ">
          ${formatTimestamp(event.timestamp)}
        </span>
      </div>

      <div style="
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 8px;
        margin-bottom: 8px;
      ">
        <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 2px; font-weight: 700;">
          PROBLEM
        </div>
        <div style="font-size: 12px; color: var(--vscode-foreground); line-height: 1.4;">
          ${escapeHtml(problem)}
        </div>
      </div>

      <div style="
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 8px;
        margin-bottom: 8px;
      ">
        <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 2px; font-weight: 700;">
          FIX
        </div>
        <div style="font-size: 12px; color: var(--vscode-foreground); line-height: 1.4;">
          ${escapeHtml(fix)}
        </div>
      </div>

      <div style="
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-charts-green);
        border-radius: 4px;
        padding: 6px 8px;
        margin-bottom: 8px;
        font-size: 11px;
      ">
        <span>${verIcon}</span>
        <strong style="color: var(--vscode-charts-green);">Verified:</strong>
        <code style="
          background: var(--vscode-textCodeBlock-background);
          padding: 1px 4px;
          border-radius: 3px;
          font-family: monospace;
          font-size: 10px;
        ">${escapeHtml(verCommand)}</code>
        <span style="color: var(--vscode-descriptionForeground);">(${escapeHtml(verType)})</span>
        ${verSummary ? `<span style="color: var(--vscode-descriptionForeground); margin-left: auto;">${escapeHtml(verSummary)}</span>` : ''}
      </div>

      ${filesChanged.length > 0 ? `
        <details style="margin-bottom: 8px;">
          <summary style="
            cursor: pointer;
            font-size: 10px;
            font-weight: 700;
            color: var(--vscode-descriptionForeground);
            user-select: none;
          ">
            FILES CHANGED (${filesChanged.length})
          </summary>
          <ul style="
            margin: 6px 0 0 0;
            padding-left: 18px;
            font-size: 11px;
            color: var(--vscode-foreground);
          ">
            ${filesChanged.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('')}
          </ul>
        </details>
      ` : ''}

      ${tags.length > 0 ? `
        <div style="margin-bottom: 8px;">
          ${tagBadges}
        </div>
      ` : ''}

      <div style="
        padding-top: 8px;
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <span>🧠</span>
        <span>This solution will be suggested if a similar problem occurs</span>
      </div>
    </div>
  `;
}

