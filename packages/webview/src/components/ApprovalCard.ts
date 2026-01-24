/**
 * ApprovalCard Component
 * Renders a first-class approval card in Mission tab
 * Displays approval details and allows user to Approve/Reject
 */

import { Event } from '../types';

export interface ApprovalCardProps {
  approvalEvent: Event;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
}

/**
 * Get risk badge based on approval type or payload
 */
function getRiskBadge(approvalEvent: Event): { level: string; color: string } | null {
  const riskLevel = approvalEvent.payload.risk_level as string | undefined;
  
  if (riskLevel) {
    const riskColors = {
      low: 'var(--vscode-charts-green)',
      medium: 'var(--vscode-charts-yellow)',
      high: 'var(--vscode-charts-red)'
    };
    return {
      level: riskLevel.toUpperCase(),
      color: riskColors[riskLevel as keyof typeof riskColors] || 'var(--vscode-charts-orange)'
    };
  }

  // Infer risk from approval type
  const approvalType = approvalEvent.payload.approval_type as string;
  if (approvalType === 'terminal') {
    return { level: 'HIGH', color: 'var(--vscode-charts-red)' };
  } else if (approvalType === 'apply_diff') {
    return { level: 'MEDIUM', color: 'var(--vscode-charts-yellow)' };
  } else if (approvalType === 'scope_expansion') {
    return { level: 'LOW', color: 'var(--vscode-charts-green)' };
  }

  return null;
}

/**
 * Get approval summary text
 */
function getApprovalSummary(approvalEvent: Event): string {
  const description = approvalEvent.payload.description as string | undefined;
  if (description) {
    return description;
  }

  const approvalType = approvalEvent.payload.approval_type as string;
  const details = approvalEvent.payload.details as Record<string, unknown> | undefined;

  if (approvalType === 'terminal') {
    const command = details?.command as string | undefined;
    return command ? `Execute command: ${command}` : 'Execute terminal command';
  } else if (approvalType === 'apply_diff') {
    const filesChanged = (details?.files_changed as unknown[] | undefined)?.length || 0;
    return `Apply diff to ${filesChanged} file(s)`;
  } else if (approvalType === 'scope_expansion') {
    const reason = details?.reason as string | undefined;
    return reason || 'Expand scope contract';
  }

  return 'Approval required';
}

/**
 * Get evidence links if available
 */
function getEvidenceLinks(approvalEvent: Event): string[] {
  return approvalEvent.evidence_ids || [];
}

/**
 * Format approval type for display
 */
function formatApprovalType(type: string): string {
  const typeMap: Record<string, string> = {
    terminal: 'Terminal Execution',
    apply_diff: 'Apply Diff',
    scope_expansion: 'Scope Expansion'
  };
  return typeMap[type] || type;
}

/**
 * Render ApprovalCard component
 */
export function renderApprovalCard(props: ApprovalCardProps): string {
  const { approvalEvent, onApprove, onReject } = props;
  const approvalId = approvalEvent.payload.approval_id as string;
  const approvalType = approvalEvent.payload.approval_type as string;
  const riskBadge = getRiskBadge(approvalEvent);
  const summary = getApprovalSummary(approvalEvent);
  const evidenceLinks = getEvidenceLinks(approvalEvent);
  const details = approvalEvent.payload.details as Record<string, unknown> | undefined;

  return `
    <div class="approval-card" data-approval-id="${approvalId}">
      <div class="approval-card-header">
        <div class="approval-card-header-left">
          <span class="approval-icon">⏸️</span>
          <div class="approval-card-title">
            <div class="approval-type-label">${formatApprovalType(approvalType)}</div>
            <div class="approval-id">ID: ${approvalId.substring(0, 8)}</div>
          </div>
        </div>
        ${riskBadge ? `
          <div class="risk-badge" style="background: ${riskBadge.color};">
            ${riskBadge.level}
          </div>
        ` : ''}
      </div>

      <div class="approval-card-body">
        <div class="approval-summary">${escapeHtml(summary)}</div>
        
        ${details && Object.keys(details).length > 0 ? `
          <div class="approval-details">
            ${renderApprovalDetails(approvalType, details)}
          </div>
        ` : ''}

        ${evidenceLinks.length > 0 ? `
          <div class="approval-evidence">
            <span class="evidence-icon">📎</span>
            <span>${evidenceLinks.length} evidence item(s) available</span>
          </div>
        ` : ''}
      </div>

      <div class="approval-card-actions">
        <button class="approval-btn approve" onclick="handleApproval('${approvalId}', 'approved')">
          ✓ Approve
        </button>
        <button class="approval-btn reject" onclick="handleApproval('${approvalId}', 'rejected')">
          ✗ Reject
        </button>
      </div>
    </div>
  `;
}

/**
 * Render approval-specific details
 */
function renderApprovalDetails(approvalType: string, details: Record<string, unknown>): string {
  if (approvalType === 'terminal') {
    const command = details.command as string | undefined;
    const workingDir = details.working_dir as string | undefined;
    return `
      <div class="detail-row">
        <span class="detail-label">Command:</span>
        <code class="detail-value">${escapeHtml(command || 'N/A')}</code>
      </div>
      ${workingDir ? `
        <div class="detail-row">
          <span class="detail-label">Working Dir:</span>
          <code class="detail-value">${escapeHtml(workingDir)}</code>
        </div>
      ` : ''}
    `;
  }

  if (approvalType === 'apply_diff') {
    // Handle both array and object types for files_changed
    let filesChanged: Array<{path: string; action?: string; added_lines?: number; removed_lines?: number}> = [];
    
    const rawFilesChanged = details.files_changed;
    
    // COMPREHENSIVE LOGGING
    console.log('[ApprovalCard] DEBUG apply_diff details:', JSON.stringify(details, null, 2));
    console.log('[ApprovalCard] rawFilesChanged type:', typeof rawFilesChanged);
    console.log('[ApprovalCard] rawFilesChanged isArray:', Array.isArray(rawFilesChanged));
    console.log('[ApprovalCard] rawFilesChanged value:', rawFilesChanged);
    
    if (Array.isArray(rawFilesChanged)) {
      filesChanged = rawFilesChanged.map(file => {
        console.log('[ApprovalCard] Processing file:', file, 'type:', typeof file);
        
        if (typeof file === 'string') {
          return { path: file };
        } else if (file && typeof file === 'object') {
          const result = {
            path: file.path || String(file),
            action: file.action,
            added_lines: file.added_lines,
            removed_lines: file.removed_lines
          };
          console.log('[ApprovalCard] Mapped to:', result);
          return result;
        }
        console.log('[ApprovalCard] Fallback for:', file);
        return { path: String(file) };
      });
    } else {
      console.error('[ApprovalCard] files_changed is not an array!', typeof rawFilesChanged, rawFilesChanged);
    }
    
    console.log('[ApprovalCard] Final filesChanged:', filesChanged);
    
    const additions = details.additions as number | undefined;
    const deletions = details.deletions as number | undefined;
    
    // Calculate total lines if not provided
    let totalAdded = additions;
    let totalRemoved = deletions;
    if (filesChanged && (totalAdded === undefined || totalRemoved === undefined)) {
      totalAdded = filesChanged.reduce((sum, f) => sum + (f.added_lines || 0), 0);
      totalRemoved = filesChanged.reduce((sum, f) => sum + (f.removed_lines || 0), 0);
    }
    
    console.log('[ApprovalCard] Rendering approval with', filesChanged.length, 'files');
    
    return `
      ${filesChanged && filesChanged.length > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Files:</span>
          <div class="detail-value">
            ${filesChanged.map(f => {
              // Ensure f.path exists and is a string
              const filePath = f && typeof f === 'object' && f.path ? String(f.path) : '[unknown]';
              const addedLines = f && typeof f === 'object' ? (f.added_lines || 0) : 0;
              const removedLines = f && typeof f === 'object' ? (f.removed_lines || 0) : 0;
              
              return `
                <div class="file-change-item">
                  <code>${escapeHtml(filePath)}</code>
                  <span class="file-stats">
                    ${addedLines > 0 ? `<span class="stat-add">+${addedLines}</span>` : ''}
                    ${removedLines > 0 ? `<span class="stat-remove">-${removedLines}</span>` : ''}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
      ${totalAdded !== undefined || totalRemoved !== undefined ? `
        <div class="detail-row">
          <span class="detail-label">Total Changes:</span>
          <span class="detail-value">
            ${totalAdded !== undefined && totalAdded > 0 ? `<span class="stat-add">+${totalAdded}</span>` : ''} 
            ${totalRemoved !== undefined && totalRemoved > 0 ? `<span class="stat-remove">-${totalRemoved}</span>` : ''}
          </span>
        </div>
      ` : ''}
    `;
  }

  if (approvalType === 'scope_expansion') {
    const reason = details.reason as string | undefined;
    const requested = details.requested as Record<string, unknown> | undefined;
    return `
      ${reason ? `
        <div class="detail-row">
          <span class="detail-label">Reason:</span>
          <span class="detail-value">${escapeHtml(reason)}</span>
        </div>
      ` : ''}
      ${requested ? `
        <div class="detail-row">
          <span class="detail-label">Requested:</span>
          <span class="detail-value">${JSON.stringify(requested, null, 2)}</span>
        </div>
      ` : ''}
    `;
  }

  return '';
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
