/**
 * Step 47: CrashRecoveryCard — Stateless card for task_interrupted events.
 *
 * All data comes from the event payload. No additional fetches.
 * Renders recovery options with action buttons.
 */

import type { Event } from '../types';

/**
 * Render a crash recovery card from a task_interrupted event.
 * The payload carries everything the card needs.
 */
export function renderCrashRecoveryCard(event: Event): string {
  const p = event.payload;
  const taskId = (p.task_id as string) || event.task_id;
  const wasCleanExit = p.was_clean_exit as boolean;
  const isLikelyCrash = p.is_likely_crash as boolean;
  const isStale = p.is_stale as boolean;
  const recommendedAction = p.recommended_action as string;
  const options = (p.options as any[]) || [];
  const lastCheckpointId = p.last_checkpoint_id as string | null;
  const lastUpdatedAt = p.last_updated_at as string;
  const mode = p.mode as string;
  const stage = p.stage as string;
  const eventCount = (p.event_count as number) || 0;
  const timeSinceMs = (p.time_since_interruption_ms as number) || 0;
  const reason = (p.reason as string) || '';

  const title = isLikelyCrash
    ? 'Interrupted Task Found'
    : 'Paused Task Found';
  const icon = isLikelyCrash ? '⚠️' : '⏸️';
  const borderColor = isLikelyCrash
    ? 'var(--vscode-charts-orange)'
    : 'var(--vscode-charts-yellow)';

  const timeSinceStr = formatDuration(timeSinceMs);
  const lastUpdatedStr = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleString()
    : 'unknown';

  const detailsHtml = `
    <div class="approval-details" style="margin: 8px 0;">
      <div class="detail-row">
        <span class="detail-label">Mode:</span>
        <span class="detail-value">${escapeHtml(mode || 'ANSWER')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Stage:</span>
        <span class="detail-value">${escapeHtml(stage || 'none')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Events:</span>
        <span class="detail-value">${eventCount}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Interrupted:</span>
        <span class="detail-value">${timeSinceStr} ago (${escapeHtml(lastUpdatedStr)})</span>
      </div>
      ${lastCheckpointId ? `
      <div class="detail-row">
        <span class="detail-label">Checkpoint:</span>
        <span class="detail-value">${escapeHtml(lastCheckpointId.substring(0, 12))}...</span>
      </div>
      ` : ''}
    </div>
  `;

  const buttonsHtml = options
    .filter((opt: any) => opt.enabled)
    .map((opt: any) => {
      const isRecommended = opt.id === recommendedAction;
      const btnClass = isRecommended ? 'approval-btn approve' : 'approval-btn';
      const checkpointArg = opt.id === 'restore_checkpoint' && lastCheckpointId
        ? `, '${escapeJsString(lastCheckpointId)}'`
        : '';
      return `
        <button
          class="${btnClass}"
          onclick="handleCrashRecovery('${escapeJsString(taskId)}', '${escapeJsString(opt.id)}'${checkpointArg})"
          style="flex: 1; padding: 8px 12px; border: none; cursor: pointer; border-radius: 3px;
                 background: ${isRecommended ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)'};
                 color: ${isRecommended ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)'};">
          ${escapeHtml(opt.label)}${isRecommended ? ' (Recommended)' : ''}
        </button>
      `;
    })
    .join('');

  return `
    <div class="approval-card" data-task-id="${escapeHtml(taskId)}" style="border: 2px solid ${borderColor};">
      <div class="approval-card-header">
        <div class="approval-card-header-left">
          <span class="approval-icon">${icon}</span>
          <div class="approval-card-title">
            <div class="approval-type-label">${escapeHtml(title)}</div>
            <div class="approval-id">Task: ${escapeHtml(taskId.substring(0, 12))}...</div>
          </div>
        </div>
      </div>
      <div class="approval-card-body">
        <div class="approval-summary">${escapeHtml(reason)}</div>
        ${detailsHtml}
      </div>
      <div class="approval-card-actions" style="display: flex; gap: 8px; margin-top: 8px;">
        ${buttonsHtml}
      </div>
    </div>
  `;
}

/**
 * Render a simple info card for task_recovery_started.
 */
export function renderTaskRecoveryStartedCard(event: Event): string {
  const action = (event.payload.action as string) || 'resume';
  return `
    <div class="event-card">
      <div class="event-card-header">
        <span class="event-icon" style="color: var(--vscode-charts-green)">▶️</span>
        <span class="event-type">Task Resumed</span>
        <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
      </div>
      <div class="event-summary">Task recovered via: ${escapeHtml(action)}</div>
    </div>
  `;
}

/**
 * Render a simple info card for task_discarded.
 */
export function renderTaskDiscardedCard(event: Event): string {
  return `
    <div class="event-card">
      <div class="event-card-header">
        <span class="event-icon" style="color: var(--vscode-descriptionForeground)">🗑️</span>
        <span class="event-type">Task Discarded</span>
        <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
      </div>
      <div class="event-summary">Interrupted task cleared — ready for a fresh start</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86400_000) return `${(ms / 3600_000).toFixed(1)}h`;
  return `${(ms / 86400_000).toFixed(1)}d`;
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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

function escapeJsString(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
