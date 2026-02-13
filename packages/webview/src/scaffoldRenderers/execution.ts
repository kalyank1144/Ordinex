// Execution-phase scaffold renderers.
// NO import/export — pure script file, concatenated into ScaffoldCard.bundle.js

declare function escapeHtml(text: string): string;
declare function truncateText(text: string, maxLength: number): string;
declare function truncatePath(path: string, maxLength?: number): string;

function renderDecisionResolved(payload: Record<string, any>): string {
  const decision = payload.decision || 'proceed';
  const recipe = payload.recipe_id || payload.recipe || '';
  const designPack = payload.design_pack_id || payload.design_pack || '';
  const nextCommand = payload.next_command || '';

  const isApproved = decision === 'proceed';

  return `
    <div class="scaffold-card ${isApproved ? 'approved' : 'cancelled'}">
      <div class="header">
        <span class="icon">${isApproved ? '\u2705' : '\u26D4'}</span>
        <h3>Scaffold Decision</h3>
        <span class="badge ${isApproved ? 'ready' : 'cancelled'}">${isApproved ? 'Approved' : 'Rejected'}</span>
      </div>
      <div class="decision-details">
        ${isApproved ? `
          ${recipe ? `<span class="detail-chip">Recipe: ${escapeHtml(recipe)}</span>` : ''}
          ${nextCommand ? `<span class="detail-chip">Next: ${escapeHtml(truncateText(nextCommand, 40))}</span>` : ''}
        ` : `
          <span class="decision-text">User rejected the scaffold proposal</span>
        `}
      </div>
    </div>
  `;
}

function renderApplyStarted(payload: Record<string, any>): string {
  const recipe = payload.recipe_id || payload.recipe || 'unknown';
  const command = payload.command || '';
  const filesCount = payload.files_count || 0;

  return `
    <div class="scaffold-card applying">
      <div class="header">
        <span class="icon">\u2699\uFE0F</span>
        <h3>Creating Project</h3>
        <span class="badge applying">In Progress</span>
      </div>
      <div class="apply-status">
        <div class="status-item">
          <span class="status-icon">\u{1F504}</span>
          <span class="status-text">Setting up ${escapeHtml(recipe)} project...</span>
        </div>
      </div>
      ${command ? `
        <div class="command-preview">
          <span class="command-label">Running:</span>
          <code class="command-text">${escapeHtml(command)}</code>
        </div>
      ` : ''}
      ${filesCount > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Files to create:</span>
          <span class="detail-value">${filesCount}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function renderApplied(payload: Record<string, any>): string {
  const filesCreated = payload.files_created || 0;
  const dirsCreated = payload.directories_created || 0;
  const targetDir = payload.target_directory || '';
  const recipe = payload.recipe_id || payload.recipe || '';
  const method = payload.method || '';
  const command = payload.command || '';
  const message = payload.message || '';

  const isTerminalMethod = method === 'vscode_terminal';

  if (isTerminalMethod) {
    return `
      <div class="scaffold-card applying">
        <div class="header">
          <span class="icon">\u{1F5A5}\uFE0F</span>
          <h3>Scaffold Running in Terminal</h3>
          <span class="badge applying">Interactive</span>
        </div>
        <div class="completion-section terminal-running">
          <span class="completion-icon">\u{1F446}</span>
          <span class="completion-text">
            ${message || 'Follow the prompts in the terminal to complete project setup.'}
          </span>
        </div>
        ${command ? `
          <div class="command-preview">
            <span class="command-label">Command:</span>
            <code class="command-text">${escapeHtml(command)}</code>
          </div>
        ` : ''}
        <div class="terminal-notice">
          <span class="notice-icon">\u{1F4A1}</span>
          <span class="notice-text">
            The scaffold CLI is interactive. Check the VS Code terminal panel to complete setup.
          </span>
        </div>
      </div>
    `;
  }

  return `
    <div class="scaffold-card applied">
      <div class="header">
        <span class="icon">\u{1F389}</span>
        <h3>Project Created</h3>
        <span class="badge ready">Complete</span>
      </div>
      <div class="completion-section ready">
        <span class="completion-icon">\u2705</span>
        <span class="completion-text">
          ${recipe ? `${escapeHtml(recipe)} scaffold applied successfully!` : 'Scaffold applied successfully!'}
        </span>
      </div>
      <div class="apply-stats">
        ${filesCreated > 0 ? `
          <div class="stat-item">
            <span class="stat-icon">\u{1F4C4}</span>
            <span class="stat-value">${filesCreated}</span>
            <span class="stat-label">files created</span>
          </div>
        ` : ''}
        ${dirsCreated > 0 ? `
          <div class="stat-item">
            <span class="stat-icon">\u{1F4C1}</span>
            <span class="stat-value">${dirsCreated}</span>
            <span class="stat-label">directories</span>
          </div>
        ` : ''}
      </div>
      ${targetDir ? `
        <div class="detail-row">
          <span class="detail-label">Location:</span>
          <span class="detail-value mono">${escapeHtml(truncatePath(targetDir))}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function renderCompleted(payload: Record<string, any>): string {
  const status = payload.status || 'cancelled';
  const reason = payload.reason || '';
  const isReady = status === 'ready_for_step_35_2';

  return `
    <div class="scaffold-card ${isReady ? 'ready' : 'cancelled'}">
      <div class="header">
        <span class="icon">${isReady ? '\u2705' : '\u23F8\uFE0F'}</span>
        <h3>Scaffold ${isReady ? 'Ready' : 'Cancelled'}</h3>
        <span class="badge ${isReady ? 'ready' : 'cancelled'}">${isReady ? 'Ready' : 'Cancelled'}</span>
      </div>
      <div class="completion-section ${isReady ? 'ready' : 'cancelled'}">
        <span class="completion-icon">${isReady ? '\u{1F680}' : '\u{1F519}'}</span>
        <span class="completion-text">
          ${isReady
            ? 'Scaffold approved! Setting up your project...'
            : escapeHtml(reason || 'Scaffold was cancelled')}
        </span>
      </div>
    </div>
  `;
}

function renderCancelled(payload: Record<string, any>): string {
  const reason = payload.reason || 'User cancelled';

  return `
    <div class="scaffold-card cancelled">
      <div class="header">
        <span class="icon">\u26D4</span>
        <h3>Scaffold Cancelled</h3>
        <span class="badge cancelled">Cancelled</span>
      </div>
      <div class="completion-section cancelled">
        <span class="completion-icon">\u{1F519}</span>
        <span class="completion-text">${escapeHtml(reason)}</span>
      </div>
    </div>
  `;
}
