/**
 * Evidence List Component - Renders evidence items for an event
 * Shows evidence summaries with actions to open/copy
 */

import { Evidence } from '../types';
import { escapeHtml, formatTimestamp } from '../utils/cardHelpers';

/**
 * Evidence type icon mapping
 */
const EVIDENCE_TYPE_ICONS: Record<Evidence['type'], string> = {
  log: '📋',
  diff: '📝',
  file: '📄',
  test: '🧪',
  error: '❌'
};

/**
 * Evidence type color mapping
 */
const EVIDENCE_TYPE_COLORS: Record<Evidence['type'], string> = {
  log: 'var(--vscode-charts-blue)',
  diff: 'var(--vscode-charts-yellow)',
  file: 'var(--vscode-charts-purple)',
  test: 'var(--vscode-charts-green)',
  error: 'var(--vscode-charts-red)'
};

/**
 * Render an evidence list for a set of evidence items
 * @param evidenceItems - Array of evidence objects sorted by created_at
 * @param eventId - Source event ID for reference
 */
export function renderEvidenceList(evidenceItems: Evidence[], eventId: string): string {
  if (evidenceItems.length === 0) {
    return '<div class="evidence-list-empty">No evidence attached to this event.</div>';
  }

  // Sort by created_at ascending
  const sortedItems = [...evidenceItems].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return `
    <div class="evidence-list">
      ${sortedItems.map(evidence => renderEvidenceItem(evidence, eventId)).join('')}
    </div>
  `;
}

/**
 * Render a single evidence item
 */
function renderEvidenceItem(evidence: Evidence, eventId: string): string {
  const icon = EVIDENCE_TYPE_ICONS[evidence.type] || '📎';
  const color = EVIDENCE_TYPE_COLORS[evidence.type] || 'var(--vscode-foreground)';
  const timestamp = formatTimestamp(evidence.created_at);

  return `
    <div class="evidence-item" data-evidence-id="${evidence.evidence_id}">
      <div class="evidence-item-header">
        <span class="evidence-icon" style="color: ${color}">${icon}</span>
        <span class="evidence-type-label">${evidence.type}</span>
        <span class="evidence-timestamp">${timestamp}</span>
      </div>
      <div class="evidence-summary">${escapeHtml(evidence.summary)}</div>
      <div class="evidence-actions">
        <button class="evidence-btn evidence-btn-open" onclick="openEvidenceViewer('${evidence.evidence_id}', '${eventId}')">
          👁️ Open
        </button>
        <button class="evidence-btn evidence-btn-copy" onclick="copyEvidenceSummary('${evidence.evidence_id}')">
          📋 Copy Summary
        </button>
      </div>
    </div>
  `;
}

