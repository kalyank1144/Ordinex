// Preflight-related scaffold renderers.
// NO import/export — pure script file, concatenated into ScaffoldCard.bundle.js

declare function escapeHtml(text: string): string;
declare function truncateText(text: string, maxLength: number): string;
declare function truncatePath(path: string, maxLength?: number): string;
declare function formatTimestamp(iso: string): string;

function renderStarted(payload: Record<string, any>): string {
  const userPrompt = payload.user_prompt || '';
  const targetDir = payload.target_directory;
  const createdAt = payload.created_at_iso || '';

  return `
    <div class="scaffold-card starting">
      <div class="header">
        <span class="icon">\u{1F3D7}\uFE0F</span>
        <h3>Create New Project</h3>
        <span class="badge starting">Starting</span>
      </div>
      <div class="prompt-section">
        <div class="prompt-label">Your Request</div>
        <div class="prompt-text">${escapeHtml(truncateText(userPrompt, 150))}</div>
      </div>
      ${targetDir ? `
        <div class="detail-row">
          <span class="detail-label">Target Directory:</span>
          <span class="detail-value">${escapeHtml(String(targetDir))}</span>
        </div>
      ` : ''}
      <div class="timestamp">Started: ${formatTimestamp(createdAt)}</div>
    </div>
  `;
}

function renderPreflightStarted(payload: Record<string, any>): string {
  const workspaceRoot = payload.workspace_root || '';
  const createdAt = payload.created_at_iso || '';

  return `
    <div class="scaffold-card preflight">
      <div class="header">
        <span class="icon">\u{1F50D}</span>
        <h3>Safety Preflight</h3>
        <span class="badge preflight">Checking</span>
      </div>
      <div class="preflight-status">
        <div class="status-item">
          <span class="status-icon">\u231B</span>
          <span class="status-text">Checking workspace safety...</span>
        </div>
      </div>
      ${workspaceRoot ? `
        <div class="detail-row">
          <span class="detail-label">Workspace:</span>
          <span class="detail-value mono">${escapeHtml(truncatePath(workspaceRoot))}</span>
        </div>
      ` : ''}
      <div class="timestamp">Started: ${formatTimestamp(createdAt)}</div>
    </div>
  `;
}

function renderPreflightCompleted(payload: Record<string, any>): string {
  const targetDir = payload.target_directory || '';
  const isEmpty = payload.is_empty_dir;
  const hasPackageJson = payload.has_package_json;
  const isMonorepo = payload.detected_monorepo;
  const monorepoType = payload.monorepo_type;
  const conflicts = payload.conflicts || [];

  const hasConflicts = conflicts.length > 0;
  const statusClass = hasConflicts ? 'warning' : 'safe';
  const statusLabel = hasConflicts ? 'Needs Attention' : 'Safe';

  return `
    <div class="scaffold-card preflight-complete ${statusClass}">
      <div class="header">
        <span class="icon">${hasConflicts ? '\u26A0\uFE0F' : '\u2705'}</span>
        <h3>Preflight Complete</h3>
        <span class="badge ${statusClass}">${statusLabel}</span>
      </div>

      <div class="preflight-results">
        <div class="result-item">
          <span class="result-label">Target Directory</span>
          <span class="result-value mono">${escapeHtml(truncatePath(targetDir))}</span>
        </div>
        <div class="result-item">
          <span class="result-label">Directory Status</span>
          <span class="result-value ${isEmpty ? 'safe' : 'warning'}">
            ${isEmpty ? '\u2713 Empty (safe)' : hasPackageJson ? '\u26A0\uFE0F Has package.json' : '\u26A0\uFE0F Not empty'}
          </span>
        </div>
        ${isMonorepo ? `
          <div class="result-item">
            <span class="result-label">Monorepo Detected</span>
            <span class="result-value">${monorepoType ? escapeHtml(monorepoType) : 'Yes'}</span>
          </div>
        ` : ''}
      </div>

      ${hasConflicts ? `
        <div class="conflicts-section">
          <div class="conflicts-header">\u26A0\uFE0F Conflicts Detected</div>
          ${conflicts.map((c: any) => `
            <div class="conflict-item">
              <span class="conflict-type">${escapeHtml(c.type)}</span>
              <span class="conflict-message">${escapeHtml(c.message)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderTargetChosen(payload: Record<string, any>): string {
  const targetDir = payload.target_directory || '';
  const reason = payload.reason || 'default';
  const appName = payload.app_name || '';

  const reasonLabels: Record<string, string> = {
    'default': 'Default location',
    'monorepo_choice': 'Monorepo convention',
    'user_selected': 'User selected',
    'workspace_root': 'Workspace root'
  };

  return `
    <div class="scaffold-card target-chosen">
      <div class="header">
        <span class="icon">\u{1F4CD}</span>
        <h3>Target Selected</h3>
        <span class="badge target">${appName || 'Project'}</span>
      </div>
      <div class="target-info">
        <div class="target-path">
          <span class="path-label">Creating project at:</span>
          <span class="path-value mono">${escapeHtml(targetDir)}</span>
        </div>
        <div class="target-reason">
          <span class="reason-badge">${escapeHtml(reasonLabels[reason] || reason)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderBlocked(payload: Record<string, any>): string {
  const targetDir = payload.target_directory || '';
  const reason = payload.reason || 'unknown';
  const message = payload.message || 'Scaffold was blocked';

  const reasonIcons: Record<string, string> = {
    'non_empty_dir': '\u{1F4C1}',
    'monorepo_ambiguous': '\u{1F500}',
    'user_cancelled': '\u{1F6AB}'
  };

  const reasonLabels: Record<string, string> = {
    'non_empty_dir': 'Directory Not Empty',
    'monorepo_ambiguous': 'Monorepo Ambiguous',
    'user_cancelled': 'User Cancelled'
  };

  return `
    <div class="scaffold-card blocked">
      <div class="header">
        <span class="icon">${reasonIcons[reason] || '\u26D4'}</span>
        <h3>Scaffold Blocked</h3>
        <span class="badge blocked">${reasonLabels[reason] || 'Blocked'}</span>
      </div>
      <div class="block-info">
        <div class="block-message">${escapeHtml(message)}</div>
        ${targetDir ? `
          <div class="detail-row">
            <span class="detail-label">Target:</span>
            <span class="detail-value mono">${escapeHtml(truncatePath(targetDir))}</span>
          </div>
        ` : ''}
      </div>
      <div class="block-help">
        Choose a different location or cancel the scaffold operation.
      </div>
    </div>
  `;
}
