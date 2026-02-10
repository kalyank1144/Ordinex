/**
 * DiffProposedCard Component - Step 15
 * Renders diff_proposed events with View Diff and Request Apply buttons
 */

import { Event } from '../types';
import { escapeHtml, formatTimestamp } from '../utils/cardHelpers';

/**
 * Render a diff proposed card with actions
 */
export function renderDiffProposedCard(event: Event, taskId: string): string {
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
  
  const summary = event.payload.summary as string || 'Diff proposed';
  const changeIntent = event.payload.change_intent as string || '';
  const riskLevel = event.payload.risk_level as string || 'medium';
  const rationale = (event.payload.rationale as string[]) || [];
  const diffId = event.payload.diff_id as string || '';

  const riskColor = 
    riskLevel === 'low' ? 'var(--vscode-charts-green)' :
    riskLevel === 'high' ? 'var(--vscode-charts-red)' :
    'var(--vscode-charts-yellow)';

  return `
    <div class="diff-proposed-card">
      <div class="diff-proposed-header">
        <span class="diff-icon" style="color: var(--vscode-charts-yellow)">📝</span>
        <span class="diff-title">Diff Proposed</span>
        <span class="diff-timestamp">${formatTimestamp(event.timestamp)}</span>
      </div>
      
      <div class="diff-summary">
        <strong>${escapeHtml(summary)}</strong>
      </div>
      
      ${changeIntent ? `<div class="diff-intent">${escapeHtml(changeIntent)}</div>` : ''}
      
      <div class="diff-files">
        <strong>Files Changed (${filesChanged.length}):</strong>
        <ul class="diff-file-list">
          ${filesChanged.map(file => {
            const stats = (file.additions !== undefined && file.deletions !== undefined) 
              ? ` <span class="file-stats"><span class="stat-add">+${file.additions}</span><span class="stat-remove">-${file.deletions}</span></span>`
              : '';
            return `<li><code>${escapeHtml(file.path)}</code>${stats}</li>`;
          }).join('')}
        </ul>
      </div>
      
      <div class="diff-risk">
        <strong>Risk Level:</strong> 
        <span class="risk-badge" style="color: ${riskColor}">
          ${riskLevel.toUpperCase()}
        </span>
      </div>
      
      ${rationale.length > 0 ? `
        <div class="diff-rationale">
          <strong>Rationale:</strong>
          <ul class="rationale-list">
            ${rationale.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      
      <div class="diff-actions">
        <button 
          class="diff-action-button view-diff-btn" 
          data-event-id="${event.event_id}"
          data-diff-id="${diffId}"
        >
          👁️ View Diff
        </button>
        <button 
          class="diff-action-button apply-diff-btn" 
          data-event-id="${event.event_id}"
          data-diff-id="${diffId}"
          data-task-id="${taskId}"
          onclick="handleApplyDiff('${diffId}', '${taskId}')"
        >
          ✅ Apply Diff
        </button>
      </div>
      
      <div class="diff-warning">
        ⚠️ No files will be modified until you click "Request Apply" and approve the changes.
      </div>
    </div>
  `;
}

/**
 * Check if a "Propose Changes" button should be shown
 * Requirements:
 * - effectiveMode == MISSION
 * - retrieval_completed exists
 * - no pending approvals
 * - execution not stopped
 * - no diff_proposed exists for current stage
 */
export function shouldShowProposeButton(events: Event[]): boolean {
  // Check if in MISSION mode
  const hasMissionMode = events.some(e => 
    e.type === 'mode_set' && (e.payload.mode === 'MISSION' || e.payload.effectiveMode === 'MISSION')
  );
  
  if (!hasMissionMode) {
    return false;
  }

  // Check if retrieval completed
  const hasRetrievalCompleted = events.some(e => e.type === 'retrieval_completed');
  
  if (!hasRetrievalCompleted) {
    return false;
  }

  // Check for pending approvals
  const hasPendingApproval = events.some(e => {
    if (e.type === 'approval_requested') {
      // Check if it was resolved
      const resolved = events.some(resolveEvent => 
        resolveEvent.type === 'approval_resolved' && 
        resolveEvent.timestamp > e.timestamp
      );
      return !resolved;
    }
    return false;
  });

  if (hasPendingApproval) {
    return false;
  }

  // Check if execution is stopped
  const isStopped = events.some(e => e.type === 'execution_stopped');
  
  if (isStopped) {
    return false;
  }

  // Check if diff already proposed for current stage
  const hasDiffProposed = events.some(e => e.type === 'diff_proposed');
  
  if (hasDiffProposed) {
    return false;
  }

  return true;
}

/**
 * Render the "Propose Changes" button
 */
export function renderProposeButton(taskId: string): string {
  return `
    <div class="propose-changes-container">
      <button 
        class="propose-changes-btn primary-action-btn" 
        data-task-id="${taskId}"
      >
        ✨ Propose Changes
      </button>
      <p class="propose-hint">
        Ready to generate a diff proposal based on the retrieved context.
      </p>
    </div>
  `;
}

