/**
 * DiffAppliedCard Component - Step 16
 * Renders diff_applied events after successful application
 */

import { Event } from '../types';

/**
 * Render a diff applied card showing successful application
 */
export function renderDiffAppliedCard(event: Event): string {
  const diffId = event.payload.diff_id as string || '';
  
  // FIX: files_changed can be either string[] or object[]
  const rawFilesChanged = event.payload.files_changed;
  let filesChanged: Array<{path: string; additions?: number; deletions?: number}> = [];
  
  // Handle both formats
  if (Array.isArray(rawFilesChanged)) {
    filesChanged = rawFilesChanged.map(file => {
      if (typeof file === 'string') {
        return { path: file };
      } else if (file && typeof file === 'object') {
        return {
          path: file.path || String(file),
          additions: file.additions,
          deletions: file.deletions
        };
      }
      return { path: String(file) };
    });
  }
  
  const appliedAt = event.payload.applied_at as string || event.timestamp;
  const checkpointId = event.payload.checkpoint_id as string || '';
  const success = event.payload.success !== false;

  const statusIcon = success ? '✅' : '⚠️';
  const statusColor = success ? 'var(--vscode-charts-green)' : 'var(--vscode-charts-orange)';
  const statusText = success ? 'Successfully Applied' : 'Partially Applied';

  return `
    <div class="diff-applied-card" style="
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 2px solid ${statusColor};
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    ">
      <div class="diff-applied-header" style="
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      ">
        <span class="diff-applied-icon" style="font-size: 20px;">${statusIcon}</span>
        <span class="diff-applied-title" style="font-weight: 700; color: ${statusColor};">
          ${statusText}
        </span>
        <span class="diff-applied-timestamp" style="
          margin-left: auto;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
        ">
          ${formatTimestamp(appliedAt)}
        </span>
      </div>
      
      <div class="diff-applied-details" style="margin-bottom: 8px;">
        <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">
          <strong>Diff ID:</strong> <code style="
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
          ">${diffId.substring(0, 12)}</code>
        </div>
        
        <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">
          <strong>Files Modified:</strong> ${filesChanged.length}
        </div>
        
        ${checkpointId ? `
          <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">
            <strong>Checkpoint:</strong> <code style="
              background: var(--vscode-textCodeBlock-background);
              padding: 2px 6px;
              border-radius: 3px;
            ">${checkpointId.substring(0, 12)}</code>
          </div>
        ` : ''}
      </div>
      
      ${filesChanged.length > 0 ? `
        <div class="diff-applied-files" style="
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
          padding: 8px;
          margin-top: 8px;
        ">
          <div style="font-size: 10px; font-weight: 700; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">
            MODIFIED FILES:
          </div>
          <ul style="
            margin: 0;
            padding-left: 18px;
            font-size: 11px;
            color: var(--vscode-foreground);
          ">
            ${filesChanged.map(file => {
              const stats = (file.additions !== undefined && file.deletions !== undefined) 
                ? ` <span class="file-stats"><span class="stat-add">+${file.additions}</span><span class="stat-remove">-${file.deletions}</span></span>`
                : '';
              return `<li><code>${escapeHtml(file.path)}</code>${stats}</li>`;
            }).join('')}
          </ul>
        </div>
      ` : ''}
      
      <div class="diff-applied-footer" style="
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 11px;
        color: var(--vscode-charts-green);
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <span>💾</span>
        <span>Changes have been written to disk</span>
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
