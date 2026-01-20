/**
 * Evidence Viewer Component - Modal/Panel to view evidence content
 * Renders evidence content by type with appropriate formatting
 */

import { Evidence } from '../types';

/**
 * Render evidence viewer modal/overlay
 * @param evidence - Evidence object to display
 * @param content - Evidence content (may be empty if loading)
 * @param sourceEventId - ID of the event that created this evidence
 */
export function renderEvidenceViewer(
  evidence: Evidence, 
  content: string | null, 
  sourceEventId: string
): string {
  const isLoading = content === null;
  
  return `
    <div class="evidence-viewer-overlay" id="evidenceViewerOverlay" onclick="closeEvidenceViewerOnOverlayClick(event)">
      <div class="evidence-viewer-panel" onclick="event.stopPropagation()">
        <!-- Header -->
        <div class="evidence-viewer-header">
          <div class="evidence-viewer-title">
            <span class="evidence-viewer-icon">${getEvidenceIcon(evidence.type)}</span>
            <span>${evidence.type.toUpperCase()}</span>
            <span class="evidence-viewer-id">ID: ${evidence.evidence_id.substring(0, 8)}</span>
          </div>
          <button class="evidence-viewer-close" onclick="closeEvidenceViewer()">✕</button>
        </div>

        <!-- Metadata -->
        <div class="evidence-viewer-metadata">
          <div class="evidence-metadata-row">
            <span class="evidence-metadata-label">Source Event:</span>
            <span class="evidence-metadata-value">${sourceEventId.substring(0, 8)}</span>
          </div>
          <div class="evidence-metadata-row">
            <span class="evidence-metadata-label">Created:</span>
            <span class="evidence-metadata-value">${formatFullTimestamp(evidence.created_at)}</span>
          </div>
          <div class="evidence-metadata-row">
            <span class="evidence-metadata-label">Summary:</span>
            <span class="evidence-metadata-value">${escapeHtml(evidence.summary)}</span>
          </div>
        </div>

        <!-- Content Area -->
        <div class="evidence-viewer-content">
          ${isLoading 
            ? renderLoadingState() 
            : renderContentByType(evidence.type, content, evidence.content_ref)
          }
        </div>

        <!-- Actions -->
        <div class="evidence-viewer-actions">
          ${!isLoading ? `
            <button class="evidence-action-btn" onclick="copyEvidenceContent()">
              📋 Copy Content
            </button>
            <button class="evidence-action-btn secondary" onclick="toggleLineWrap()">
              ↔️ Toggle Wrap
            </button>
          ` : ''}
          <button class="evidence-action-btn secondary" onclick="closeEvidenceViewer()">
            Close
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render loading state
 */
function renderLoadingState(): string {
  return `
    <div class="evidence-content-loading">
      <div class="loading-spinner">⏳</div>
      <div>Loading evidence content...</div>
    </div>
  `;
}

/**
 * Render content based on evidence type
 */
function renderContentByType(
  type: Evidence['type'], 
  content: string, 
  contentRef: string
): string {
  switch (type) {
    case 'diff':
      return renderDiffContent(content);
    
    case 'log':
    case 'test':
    case 'error':
      return renderLogContent(content);
    
    case 'file':
      return renderFileContent(content, contentRef);
    
    default:
      return renderPlainContent(content);
  }
}

/**
 * Render diff content with unified diff formatting
 */
function renderDiffContent(content: string): string {
  return `
    <div class="evidence-content-area evidence-content-diff" id="evidenceContentArea">
      <pre class="evidence-pre">${escapeHtml(content)}</pre>
    </div>
  `;
}

/**
 * Render log/test/error content (monospace with wrap toggle)
 */
function renderLogContent(content: string): string {
  return `
    <div class="evidence-content-area evidence-content-log" id="evidenceContentArea">
      <pre class="evidence-pre">${escapeHtml(content)}</pre>
    </div>
  `;
}

/**
 * Render file content with filename header
 */
function renderFileContent(content: string, contentRef: string): string {
  // Extract filename from content_ref
  const filename = contentRef.split('/').pop() || 'file';
  
  return `
    <div class="evidence-content-area evidence-content-file" id="evidenceContentArea">
      <div class="evidence-file-header">
        📄 <strong>${escapeHtml(filename)}</strong>
      </div>
      <pre class="evidence-pre">${escapeHtml(content)}</pre>
    </div>
  `;
}

/**
 * Render plain content (fallback)
 */
function renderPlainContent(content: string): string {
  return `
    <div class="evidence-content-area evidence-content-plain" id="evidenceContentArea">
      <pre class="evidence-pre">${escapeHtml(content)}</pre>
    </div>
  `;
}

/**
 * Get evidence type icon
 */
function getEvidenceIcon(type: Evidence['type']): string {
  const icons: Record<Evidence['type'], string> = {
    log: '📋',
    diff: '📝',
    file: '📄',
    test: '🧪',
    error: '❌'
  };
  return icons[type] || '📎';
}

/**
 * Format full timestamp
 */
function formatFullTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', { 
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Escape HTML
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
