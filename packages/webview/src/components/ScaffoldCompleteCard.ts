/**
 * S2: ScaffoldCompleteCard — clean "Project Ready" summary card.
 *
 * Aggregates scaffold_final_complete + next_steps_shown into one card
 * with verification results and prominent action buttons.
 *
 * Pattern: Same update-in-place pattern as ProcessCard (W2).
 */

import { escapeHtml } from '../utils/cardHelpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NextStep {
  id: string;
  label: string;
  description?: string;
  command?: string;
  kind?: string;
}

interface ScaffoldCompleteState {
  scaffoldId: string;
  projectPath: string;
  success: boolean;
  designPackApplied: boolean;
  designPackName: string;
  // Verification summary
  verifyOutcome: 'pass' | 'partial' | 'fail' | 'unknown';
  passCount: number;
  failCount: number;
  warnCount: number;
  // Next steps
  nextSteps: NextStep[];
  hasNextSteps: boolean;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const completeStates = new Map<string, ScaffoldCompleteState>();

/** Events that belong to the scaffold completion phase. */
const SCAFFOLD_COMPLETE_EVENT_SET = new Set([
  'scaffold_final_complete',
  'next_steps_shown',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check if an event type belongs to the scaffold completion phase. */
export function isScaffoldCompleteEvent(eventType: string): boolean {
  return SCAFFOLD_COMPLETE_EVENT_SET.has(eventType);
}

/**
 * Render the ScaffoldCompleteCard (called for `scaffold_final_complete`).
 */
export function renderScaffoldCompleteCard(event: any, allEvents?: any[]): string {
  const payload = event.payload || {};
  const scaffoldId = payload.scaffold_id || event.task_id || 'default';

  // Try to find verification data from prior events
  let verifyOutcome: ScaffoldCompleteState['verifyOutcome'] = 'unknown';
  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;

  if (allEvents) {
    const verifyEvent = allEvents.find((e: any) => e.type === 'scaffold_verify_completed');
    if (verifyEvent) {
      verifyOutcome = (verifyEvent.payload?.outcome || 'unknown') as ScaffoldCompleteState['verifyOutcome'];
      passCount = verifyEvent.payload?.pass_count || 0;
      failCount = verifyEvent.payload?.fail_count || 0;
      warnCount = verifyEvent.payload?.warn_count || 0;
    }
  }

  const state: ScaffoldCompleteState = {
    scaffoldId,
    projectPath: payload.project_path || '',
    success: payload.status === 'success' || payload.success === true,
    designPackApplied: !!payload.design_pack_applied,
    designPackName: payload.design_pack_name || '',
    verifyOutcome,
    passCount,
    failCount,
    warnCount,
    nextSteps: [],
    hasNextSteps: false,
  };

  completeStates.set(scaffoldId, state);
  return buildCompleteCardHtml(state);
}

/**
 * Update a ScaffoldCompleteCard with next_steps_shown data.
 * Returns `{ handled, scaffoldId }` for DOM replacement.
 */
export function updateScaffoldComplete(event: any): { handled: boolean; scaffoldId: string | null } {
  const payload = event.payload || {};
  const scaffoldId = payload.scaffold_id || event.task_id || 'default';
  const state = completeStates.get(scaffoldId);

  if (!state) {
    return { handled: false, scaffoldId: null };
  }

  if (event.type === 'next_steps_shown') {
    const steps = (payload.suggestions || payload.steps || payload.next_steps || []) as any[];
    state.nextSteps = steps.map((s: any) => ({
      id: s.id || s.action || '',
      label: s.label || s.title || s.action || '',
      description: s.description || '',
      // command may be a NextStepCommand object {cmd, cwd, longRunning} or a string
      command: typeof s.command === 'string' ? s.command : (s.command?.cmd || ''),
      kind: s.kind || '',
    }));
    state.hasNextSteps = state.nextSteps.length > 0;
  }

  return { handled: true, scaffoldId };
}

/** Get the current HTML for a scaffold complete card (for DOM replacement). */
export function getScaffoldCompleteCardHtml(scaffoldId: string): string | null {
  const state = completeStates.get(scaffoldId);
  if (!state) return null;
  return buildCompleteCardHtml(state);
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function buildCompleteCardHtml(state: ScaffoldCompleteState): string {
  const headerIcon = state.success ? '\u2705' : '\u26A0\uFE0F';
  const headerTitle = state.success ? 'Project Ready' : 'Project Created (with warnings)';
  const headerClass = state.success ? 'success' : 'warning';

  // Project path display
  const projectName = state.projectPath ? state.projectPath.split('/').pop() || state.projectPath : '';

  // Verification badge
  const verifyHtml = state.verifyOutcome !== 'unknown' ? buildVerifyBadge(state) : '';

  // Design pack badge
  const designHtml = state.designPackApplied
    ? `<div class="sc-badge design"><span class="sc-badge-icon">\u{1F3A8}</span> ${escapeHtml(state.designPackName || 'Design applied')}</div>`
    : '';

  // Next steps actions
  const actionsHtml = state.hasNextSteps ? buildNextStepsHtml(state.nextSteps, state.scaffoldId, state.projectPath) : buildDefaultActions(state.scaffoldId, state.projectPath);

  return `
    <div class="scaffold-complete-card ${headerClass}" data-scaffold-complete-id="${escapeHtml(state.scaffoldId)}">
      <div class="sc-header">
        <span class="sc-header-icon">${headerIcon}</span>
        <div class="sc-header-text">
          <h3 class="sc-title">${escapeHtml(headerTitle)}</h3>
          ${projectName ? `<span class="sc-project-name">${escapeHtml(projectName)}</span>` : ''}
        </div>
      </div>
      <div class="sc-badges">
        ${verifyHtml}
        ${designHtml}
      </div>
      <div class="sc-actions">
        ${actionsHtml}
      </div>
      <style>
        .scaffold-complete-card {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-testing-iconPassed, #4caf50);
          border-radius: 8px;
          padding: 16px;
          margin: 8px 0;
          font-family: var(--vscode-font-family);
          font-size: 13px;
        }
        .scaffold-complete-card.warning {
          border-color: var(--vscode-editorWarning-foreground, #ff9800);
        }
        .sc-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .sc-header-icon { font-size: 24px; }
        .sc-header-text { flex: 1; }
        .sc-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        .sc-project-name {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-editor-font-family, monospace);
        }
        .sc-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 14px;
        }
        .sc-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          background: var(--vscode-badge-background, #333);
          color: var(--vscode-badge-foreground, #fff);
        }
        .sc-badge.pass { background: rgba(76, 175, 80, 0.15); color: var(--vscode-testing-iconPassed, #4caf50); }
        .sc-badge.partial { background: rgba(255, 152, 0, 0.15); color: var(--vscode-editorWarning-foreground, #ff9800); }
        .sc-badge.fail { background: rgba(244, 67, 54, 0.15); color: var(--vscode-testing-iconFailed, #f44336); }
        .sc-badge.design { background: rgba(156, 39, 176, 0.12); color: var(--vscode-foreground); }
        .sc-badge-icon { font-size: 13px; }
        .sc-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .sc-action-btn {
          padding: 6px 14px;
          border: 1px solid var(--vscode-button-border, transparent);
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
          font-family: var(--vscode-font-family);
        }
        .sc-action-btn.primary {
          background: var(--vscode-button-background, #0078d4);
          color: var(--vscode-button-foreground, #fff);
          border: none;
        }
        .sc-action-btn.primary:hover {
          background: var(--vscode-button-hoverBackground, #005a9e);
        }
        .sc-action-btn.secondary {
          background: var(--vscode-button-secondaryBackground, #3a3d41);
          color: var(--vscode-button-secondaryForeground, #fff);
        }
        .sc-action-btn.secondary:hover {
          background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
      </style>
    </div>`;
}

function buildVerifyBadge(state: ScaffoldCompleteState): string {
  const outcome = state.verifyOutcome;
  const icon = outcome === 'pass' ? '\u2705' : outcome === 'partial' ? '\u26A0\uFE0F' : '\u274C';
  const label = outcome === 'pass'
    ? `All ${state.passCount} checks passed`
    : outcome === 'partial'
      ? `${state.passCount} passed, ${state.warnCount} warnings`
      : `${state.passCount} passed, ${state.failCount} failed`;
  return `<div class="sc-badge ${outcome}"><span class="sc-badge-icon">${icon}</span> ${escapeHtml(label)}</div>`;
}

function buildNextStepsHtml(steps: NextStep[], scaffoldId: string, projectPath?: string): string {
  // First step gets primary styling, rest get secondary
  const pp = escapeHtml(projectPath || '');
  return steps.map((step, i) => {
    const cls = i === 0 ? 'primary' : 'secondary';
    const eid = escapeHtml(scaffoldId);
    const sid = escapeHtml(step.id);
    const cmd = escapeHtml(step.command || '');
    const kind = escapeHtml(step.kind || '');
    return `<button class="sc-action-btn ${cls}" onclick="(function(){
      const vscode = acquireVsCodeApi ? acquireVsCodeApi() : (window.__vscode || { postMessage: function(){} });
      vscode.postMessage({ type: 'next_step_selected', scaffold_id: '${eid}', step_id: '${sid}', kind: '${kind}', command: '${cmd}', project_path: '${pp}' });
    })()">${escapeHtml(step.label)}</button>`;
  }).join('');
}

function buildDefaultActions(scaffoldId: string, projectPath?: string): string {
  const eid = escapeHtml(scaffoldId);
  const pp = escapeHtml(projectPath || '');
  return `
    <button class="sc-action-btn primary" onclick="(function(){
      var vscode = acquireVsCodeApi ? acquireVsCodeApi() : (window.__vscode || { postMessage: function(){} });
      vscode.postMessage({ type: 'next_step_selected', scaffold_id: '${eid}', step_id: 'dev_server', project_path: '${pp}' });
    })()">Start Dev Server</button>
    <button class="sc-action-btn secondary" onclick="(function(){
      var vscode = acquireVsCodeApi ? acquireVsCodeApi() : (window.__vscode || { postMessage: function(){} });
      vscode.postMessage({ type: 'next_step_selected', scaffold_id: '${eid}', step_id: 'open_editor', project_path: '${pp}' });
    })()">Open in Editor</button>`;
}
