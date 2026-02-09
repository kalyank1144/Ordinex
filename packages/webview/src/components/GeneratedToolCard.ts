/**
 * V8: GeneratedToolCard — UI card for generated_tool_proposed events.
 *
 * Shows tool name, description, code preview, and Approve/Reject buttons
 * that flow through the existing approval pipeline (ordinex:resolveApproval).
 *
 * For generated_tool_run_completed, shows stdout/stderr preview and timing.
 */

import { Event } from '../types';

/**
 * Render a card for generated_tool_proposed events.
 * Includes code preview (collapsed by default) and approval buttons.
 */
export function renderGeneratedToolProposedCard(event: Event): string {
  const name = (event.payload.name as string) || 'unnamed';
  const description = (event.payload.description as string) || '';
  const code = (event.payload.code as string) || '';
  const proposalId = (event.payload.proposal_id as string) || '';
  const readme = (event.payload.readme as string) || '';

  // Truncate code preview
  const codePreview = code.length > 500 ? code.substring(0, 500) + '\n// ...' : code;
  const escapedCode = escapeHtml(codePreview);

  return `
    <div class="generated-tool-card" data-proposal-id="${proposalId}" style="
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin: 8px 0;
      background: var(--vscode-editor-background);
    ">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="font-size: 16px;">🔨</span>
        <span style="font-weight: 600; color: var(--vscode-foreground);">Tool Proposed: ${escapeHtml(name)}</span>
      </div>
      ${description ? `<div style="color: var(--vscode-descriptionForeground); margin-bottom: 8px; font-size: 12px;">${escapeHtml(description)}</div>` : ''}
      ${readme ? `<div style="color: var(--vscode-descriptionForeground); margin-bottom: 8px; font-size: 11px; font-style: italic;">${escapeHtml(readme.substring(0, 200))}</div>` : ''}
      <details style="margin-bottom: 10px;">
        <summary style="cursor: pointer; color: var(--vscode-textLink-foreground); font-size: 12px;">
          View Code (${code.split('\n').length} lines)
        </summary>
        <pre style="
          background: var(--vscode-textCodeBlock-background);
          padding: 8px;
          border-radius: 4px;
          overflow-x: auto;
          font-size: 11px;
          margin-top: 4px;
          max-height: 300px;
          overflow-y: auto;
        "><code>${escapedCode}</code></pre>
      </details>
      <div class="tool-approval-actions" style="display: flex; gap: 8px;">
        <button onclick="window.generatedToolAction('approve', '${proposalId}', '${event.task_id}')" style="
          padding: 4px 12px;
          border-radius: 4px;
          border: none;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          cursor: pointer;
          font-size: 12px;
        ">Approve</button>
        <button onclick="window.generatedToolAction('reject', '${proposalId}', '${event.task_id}')" style="
          padding: 4px 12px;
          border-radius: 4px;
          border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border));
          background: transparent;
          color: var(--vscode-foreground);
          cursor: pointer;
          font-size: 12px;
        ">Reject</button>
      </div>
    </div>
  `;
}

/**
 * Render a card for generated_tool_run_completed events.
 * Shows output preview and execution timing.
 */
export function renderGeneratedToolRunCard(event: Event): string {
  const name = (event.payload.tool_name as string) || 'unknown';
  const exitCode = (event.payload.exit_code as number) ?? -1;
  const durationMs = (event.payload.duration_ms as number) || 0;
  const stdout = (event.payload.stdout_preview as string) || '';
  const stderr = (event.payload.stderr_preview as string) || '';
  const isSuccess = exitCode === 0;

  const statusColor = isSuccess
    ? 'var(--vscode-charts-green)'
    : 'var(--vscode-charts-red)';

  return `
    <div class="generated-tool-run-card" style="
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid ${statusColor};
      border-radius: 6px;
      padding: 12px;
      margin: 8px 0;
      background: var(--vscode-editor-background);
    ">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <span style="font-size: 14px;">${isSuccess ? '✅' : '❌'}</span>
        <span style="font-weight: 600; color: var(--vscode-foreground);">${escapeHtml(name)}</span>
        <span style="font-size: 11px; color: var(--vscode-descriptionForeground);">
          exit ${exitCode} | ${durationMs}ms
        </span>
      </div>
      ${stdout ? `
        <details>
          <summary style="cursor: pointer; color: var(--vscode-textLink-foreground); font-size: 12px;">stdout</summary>
          <pre style="
            background: var(--vscode-textCodeBlock-background);
            padding: 6px;
            border-radius: 4px;
            font-size: 11px;
            max-height: 200px;
            overflow-y: auto;
            margin-top: 4px;
          ">${escapeHtml(stdout)}</pre>
        </details>
      ` : ''}
      ${stderr ? `
        <details>
          <summary style="cursor: pointer; color: var(--vscode-charts-red); font-size: 12px;">stderr</summary>
          <pre style="
            background: var(--vscode-textCodeBlock-background);
            padding: 6px;
            border-radius: 4px;
            font-size: 11px;
            max-height: 200px;
            overflow-y: auto;
            margin-top: 4px;
          ">${escapeHtml(stderr)}</pre>
        </details>
      ` : ''}
    </div>
  `;
}

/**
 * Check if an event type is a generated tool event.
 */
export function isGeneratedToolEvent(eventType: string): boolean {
  return eventType.startsWith('generated_tool_');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
