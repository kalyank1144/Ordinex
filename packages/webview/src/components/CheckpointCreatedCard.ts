/**
 * CheckpointCreatedCard Component - Step 16
 * Renders checkpoint_created events showing workspace snapshots
 */

import { Event } from '../types';

/**
 * Render a checkpoint created card showing backup information
 */
export function renderCheckpointCreatedCard(event: Event): string {
  const checkpointId = event.payload.checkpoint_id as string || '';
  const description = event.payload.description as string || 'Checkpoint created';
  const scope = (event.payload.scope as string[]) || [];
  const restoreMethod = event.payload.restore_method as string || 'snapshot';
  const createdAt = event.timestamp;

  const methodIcon = restoreMethod === 'git' ? '🔀' : '💾';
  const methodLabel = restoreMethod === 'git' ? 'Git' : 'Snapshot';

  return `
    <div class="checkpoint-created-card" style="
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 2px solid var(--vscode-charts-blue);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    ">
      <div class="checkpoint-header" style="
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      ">
        <span class="checkpoint-icon" style="font-size: 20px;">${methodIcon}</span>
        <span class="checkpoint-title" style="font-weight: 700; color: var(--vscode-charts-blue);">
          Checkpoint Created
        </span>
        <span class="checkpoint-timestamp" style="
          margin-left: auto;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
        ">
          ${formatTimestamp(createdAt)}
        </span>
      </div>
      
      <div class="checkpoint-description" style="
        font-size: 12px;
        color: var(--vscode-foreground);
        margin-bottom: 10px;
        line-height: 1.4;
      ">
        ${escapeHtml(description)}
      </div>
      
      <div class="checkpoint-details" style="
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 8px;
        margin-bottom: 8px;
      ">
        <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">
          <strong>Checkpoint ID:</strong> <code style="
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
          ">${checkpointId.substring(0, 16)}</code>
        </div>
        
        <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">
          <strong>Method:</strong> ${methodLabel}
        </div>
        
        <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">
          <strong>Files Protected:</strong> ${scope.length}
        </div>
      </div>
      
      ${scope.length > 0 && scope.length <= 10 ? `
        <details style="margin-top: 8px;">
          <summary style="
            cursor: pointer;
            font-size: 10px;
            font-weight: 700;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
            user-select: none;
          ">
            VIEW PROTECTED FILES (${scope.length})
          </summary>
          <ul style="
            margin: 6px 0 0 0;
            padding-left: 18px;
            font-size: 11px;
            color: var(--vscode-foreground);
          ">
            ${scope.map(file => `<li><code>${escapeHtml(file)}</code></li>`).join('')}
          </ul>
        </details>
      ` : scope.length > 10 ? `
        <div style="
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          margin-top: 8px;
        ">
          ${scope.length} files protected (list too long to display)
        </div>
      ` : ''}
      
      <div class="checkpoint-footer" style="
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 11px;
        color: var(--vscode-charts-blue);
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <span>🛡️</span>
        <span>Workspace state saved - can be restored if needed</span>
      </div>
    </div>
  `;
}

/**
 * Utility functions
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
