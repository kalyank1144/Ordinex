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

interface BlueprintSummary {
  app_name: string;
  app_type: string;
  pages_count: number;
  features_count: number;
  components_count: number;
}

interface DoctorStatusInfo {
  tsc: string;
  lint: string;
  build: string;
}

interface FileChangeInfo {
  path: string;
  action?: string;
  additions?: number;
  deletions?: number;
}

interface DiffSection {
  diffId: string;
  files: FileChangeInfo[];
  totalAdditions: number;
  totalDeletions: number;
}

interface ScaffoldCompleteState {
  scaffoldId: string;
  projectPath: string;
  success: boolean;
  designPackApplied: boolean;
  designPackName: string;
  blueprintSummary?: BlueprintSummary;
  doctorStatus?: DoctorStatusInfo;
  verifyOutcome: 'pass' | 'partial' | 'fail' | 'unknown';
  passCount: number;
  failCount: number;
  warnCount: number;
  nextSteps: NextStep[];
  hasNextSteps: boolean;
  diffSections: DiffSection[];
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

  // Collect diff_applied events for the "Changes Made" section
  const diffSections: DiffSection[] = [];
  if (allEvents) {
    const diffEvents = allEvents.filter((e: any) => e.type === 'diff_applied');
    for (const de of diffEvents) {
      const dp = de.payload || {};
      const files = (dp.files_changed || []).map((f: any) => ({
        path: typeof f === 'string' ? f : (f.path || ''),
        action: f.action,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
      }));
      diffSections.push({
        diffId: dp.diff_id || de.event_id || '',
        files,
        totalAdditions: dp.total_additions || files.reduce((s: number, f: FileChangeInfo) => s + (f.additions || 0), 0),
        totalDeletions: dp.total_deletions || files.reduce((s: number, f: FileChangeInfo) => s + (f.deletions || 0), 0),
      });
    }
  }

  const state: ScaffoldCompleteState = {
    scaffoldId,
    projectPath: payload.project_path || '',
    success: payload.status === 'success' || payload.success === true,
    designPackApplied: !!payload.design_pack_applied,
    designPackName: payload.design_pack_name || '',
    blueprintSummary: payload.blueprint_summary || undefined,
    doctorStatus: payload.doctor_status || undefined,
    verifyOutcome,
    passCount,
    failCount,
    warnCount,
    nextSteps: [],
    hasNextSteps: false,
    diffSections,
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

function hasBuildErrors(ds?: DoctorStatusInfo): boolean {
  return !!ds && (ds.tsc === 'fail' || ds.build === 'fail');
}

function buildCompleteCardHtml(state: ScaffoldCompleteState): string {
  const hasErrors = hasBuildErrors(state.doctorStatus);

  const headerIcon = hasErrors ? '\u26A0\uFE0F' : state.success ? '\uD83D\uDE80' : '\u26A0\uFE0F';
  const headerTitle = hasErrors ? 'Project Created \u2014 needs fixes' : state.success ? 'Project Summary' : 'Project Created (with warnings)';
  const headerClass = hasErrors ? 'warning' : state.success ? 'success' : 'warning';

  const projectName = state.projectPath ? state.projectPath.split('/').pop() || state.projectPath : '';

  const bpHtml = state.blueprintSummary ? buildBlueprintSummaryHtml(state.blueprintSummary) : '';

  // Status badge: use doctor status as the primary indicator when errors exist
  let statusBadgeHtml = '';
  if (hasErrors) {
    statusBadgeHtml = `<div class="sc-badge fail"><span class="sc-badge-icon">\u274C</span> Build errors found</div>`;
  } else if (state.verifyOutcome !== 'unknown') {
    statusBadgeHtml = buildVerifyBadge(state);
  }

  const designHtml = state.designPackApplied
    ? `<div class="sc-badge design"><span class="sc-badge-icon">\u{1F3A8}</span> ${escapeHtml(state.designPackName || 'Design applied')}</div>`
    : '';

  // When errors exist, show doctor details badge; otherwise show the small summary
  const doctorHtml = (!hasErrors && state.doctorStatus) ? buildDoctorBadge(state.doctorStatus) : '';

  // Warning message when build errors exist
  const warningHtml = hasErrors ? `
    <div class="sc-warning">
      <span>\u26A0\uFE0F</span> Build errors were detected. Fix them before starting development.
    </div>` : '';

  // Actions: show "Fix automatically" when errors, normal actions otherwise
  let actionsHtml: string;
  if (hasErrors) {
    actionsHtml = buildFixActions(state.scaffoldId, state.projectPath);
  } else if (state.hasNextSteps) {
    actionsHtml = buildNextStepsHtml(state.nextSteps, state.scaffoldId, state.projectPath);
  } else {
    actionsHtml = buildDefaultActions(state.scaffoldId, state.projectPath);
  }

  return `
    <div class="scaffold-complete-card ${headerClass}" data-scaffold-complete-id="${escapeHtml(state.scaffoldId)}">
      <div class="sc-header">
        <span class="sc-header-icon">${headerIcon}</span>
        <div class="sc-header-text">
          <h3 class="sc-title">${escapeHtml(headerTitle)}</h3>
          ${projectName ? `<span class="sc-project-name">${escapeHtml(projectName)}</span>` : ''}
        </div>
      </div>
      ${bpHtml}
      <div class="sc-badges">
        ${statusBadgeHtml}
        ${designHtml}
        ${doctorHtml}
      </div>
      ${warningHtml}
      ${buildChangesSection(state.diffSections)}
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
        .sc-blueprint-summary {
          background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.1));
          border-radius: 6px;
          padding: 10px 12px;
          margin-bottom: 12px;
        }
        .sc-bp-header {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 6px;
          color: var(--vscode-foreground);
        }
        .sc-bp-type {
          font-weight: 400;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          text-transform: capitalize;
          margin-left: 6px;
        }
        .sc-bp-stats {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .sc-bp-stat {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }
        .sc-changes {
          margin-bottom: 12px;
          border: 1px solid var(--vscode-panel-border, #333);
          border-radius: 6px;
          overflow: hidden;
        }
        .sc-ch-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.08));
          border-bottom: 1px solid var(--vscode-panel-border, #333);
        }
        .sc-ch-icon { font-size: 14px; }
        .sc-ch-stats {
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        .sc-ch-add { color: var(--vscode-testing-iconPassed, #4caf50); font-size: 12px; margin-left: 4px; }
        .sc-ch-del { color: var(--vscode-testing-iconFailed, #f44336); font-size: 12px; margin-left: 4px; }
        .sc-ch-actions { display: flex; gap: 4px; }
        .sc-ch-btn {
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 4px;
          border: 1px solid var(--vscode-panel-border, #555);
          background: var(--vscode-button-secondaryBackground, transparent);
          color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
          cursor: pointer;
        }
        .sc-ch-btn:hover {
          background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1));
        }
        .sc-ch-files { padding: 4px 0; }
        .sc-ch-file {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 12px;
          font-size: 12px;
          cursor: pointer;
        }
        .sc-ch-file:hover {
          background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
        }
        .sc-ch-ext {
          font-size: 10px;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          min-width: 24px;
        }
        .sc-ch-name {
          flex: 1;
          color: var(--vscode-foreground);
        }
        .sc-ch-section-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          padding: 6px 12px 2px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .sc-ch-collapsed {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          cursor: pointer;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          border-top: 1px solid var(--vscode-panel-border, #333);
        }
        .sc-ch-collapsed:hover {
          background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
        }
        .sc-ch-toggle {
          font-size: 10px;
          transition: transform 0.15s ease;
        }
        .sc-ch-collapsed.expanded .sc-ch-toggle {
          transform: rotate(90deg);
        }
        .sc-ch-collapsed-stats {
          margin-left: auto;
          font-size: 11px;
        }
        .sc-ch-collapsed-body {
          display: none;
        }
        .sc-ch-collapsed.expanded + .sc-ch-collapsed-body {
          display: block;
        }
        .sc-warning {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          margin-bottom: 12px;
          border-radius: 6px;
          font-size: 12px;
          background: rgba(255, 152, 0, 0.1);
          color: var(--vscode-editorWarning-foreground, #ff9800);
          border: 1px solid rgba(255, 152, 0, 0.2);
        }
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

function buildBlueprintSummaryHtml(bp: BlueprintSummary): string {
  const items = [
    { icon: '\u{1F4C4}', label: `${bp.pages_count} page${bp.pages_count !== 1 ? 's' : ''}` },
    { icon: '\u2699\uFE0F', label: `${bp.features_count} feature${bp.features_count !== 1 ? 's' : ''}` },
    { icon: '\u{1F9E9}', label: `${bp.components_count} component${bp.components_count !== 1 ? 's' : ''}` },
  ];
  const itemsHtml = items.map(i => `<span class="sc-bp-stat">${i.icon} ${escapeHtml(i.label)}</span>`).join('');
  return `
    <div class="sc-blueprint-summary">
      <div class="sc-bp-header">${escapeHtml(bp.app_name)} <span class="sc-bp-type">${escapeHtml(bp.app_type.replace(/_/g, ' '))}</span></div>
      <div class="sc-bp-stats">${itemsHtml}</div>
    </div>`;
}

function buildDoctorBadge(ds: DoctorStatusInfo): string {
  const allPass = ds.tsc === 'pass' && ds.lint === 'pass' && ds.build === 'pass';
  const icon = allPass ? '\u{1FA7A}' : '\u26A0\uFE0F';
  const cls = allPass ? 'pass' : 'partial';
  const items = [`tsc: ${ds.tsc}`, `lint: ${ds.lint}`, `build: ${ds.build}`];
  return `<div class="sc-badge ${cls}"><span class="sc-badge-icon">${icon}</span> ${escapeHtml(items.join(', '))}</div>`;
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

function buildChangesSection(sections: DiffSection[]): string {
  if (sections.length === 0) return '';

  // Merge all files across sections for cumulative stats
  const allFiles: FileChangeInfo[] = [];
  let totalAdd = 0;
  let totalDel = 0;
  for (const sec of sections) {
    for (const f of sec.files) {
      allFiles.push(f);
    }
    totalAdd += sec.totalAdditions;
    totalDel += sec.totalDeletions;
  }
  if (allFiles.length === 0) return '';

  const statsText = `${allFiles.length} file${allFiles.length !== 1 ? 's' : ''} changed`;
  let statsExtra = '';
  if (totalAdd > 0) statsExtra += `<span class="sc-ch-add">+${totalAdd}</span>`;
  if (totalDel > 0) statsExtra += `<span class="sc-ch-del">-${totalDel}</span>`;

  // Render sections — latest expanded, previous collapsed
  let sectionsHtml = '';
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i];
    const isLatest = i === sections.length - 1;
    const label = sections.length > 1
      ? (isLatest ? 'Latest changes' : `Earlier changes (${i + 1})`)
      : '';
    const labelHtml = label ? `<div class="sc-ch-section-label">${escapeHtml(label)}</div>` : '';

    const fileRows = sec.files.map(f => {
      const basename = f.path.split('/').pop() || f.path;
      const ext = basename.includes('.') ? basename.split('.').pop()?.toUpperCase() || '' : '';
      let statsHtml = '';
      if (f.additions) statsHtml += `<span class="sc-ch-add">+${f.additions}</span>`;
      if (f.deletions) statsHtml += `<span class="sc-ch-del">-${f.deletions}</span>`;
      return `<div class="sc-ch-file" title="${escapeHtml(f.path)}">
        ${ext ? `<span class="sc-ch-ext">${escapeHtml(ext)}</span>` : ''}
        <span class="sc-ch-name">${escapeHtml(basename)}</span>
        ${statsHtml}
      </div>`;
    }).join('');

    if (isLatest || sections.length === 1) {
      sectionsHtml += `${labelHtml}<div class="sc-ch-files">${fileRows}</div>`;
    } else {
      const secAdd = sec.totalAdditions;
      const secDel = sec.totalDeletions;
      const secSummary = `${sec.files.length} files` +
        (secAdd > 0 ? ` +${secAdd}` : '') +
        (secDel > 0 ? ` -${secDel}` : '');
      sectionsHtml += `
        <div class="sc-ch-collapsed" onclick="this.classList.toggle('expanded')">
          <span class="sc-ch-toggle">\u25B6</span>
          <span class="sc-ch-section-label">${escapeHtml(label)}</span>
          <span class="sc-ch-collapsed-stats">${escapeHtml(secSummary)}</span>
        </div>
        <div class="sc-ch-collapsed-body">${fileRows}</div>`;
    }
  }

  const undoBtn = sections.length > 0
    ? `<button class="sc-ch-btn" onclick="handleUndoAction('${escapeHtml(sections[sections.length - 1].diffId)}')">Undo \u21A9</button>`
    : '';
  const reviewBtn = sections.length > 0
    ? `<button class="sc-ch-btn" onclick="handleDiffReview('${escapeHtml(sections[sections.length - 1].diffId)}')">Review \u2197</button>`
    : '';

  return `
    <div class="sc-changes">
      <div class="sc-ch-header">
        <span class="sc-ch-icon">\u{1F4DD}</span>
        <span class="sc-ch-stats">${statsText} ${statsExtra}</span>
        <span class="sc-ch-actions">${undoBtn}${reviewBtn}</span>
      </div>
      ${sectionsHtml}
    </div>`;
}

function buildFixActions(scaffoldId: string, projectPath?: string): string {
  const pp = escapeHtml(projectPath || '');
  const eid = escapeHtml(scaffoldId);
  return `
    <button class="sc-action-btn primary" onclick="(function(){
      var vscode = acquireVsCodeApi ? acquireVsCodeApi() : (window.__vscode || { postMessage: function(){} });
      vscode.postMessage({ type: 'doctor_action', action: 'fix_automatically', project_path: '${pp}', task_id: '' });
    })()">\u{1F527} Fix automatically</button>
    <button class="sc-action-btn secondary" onclick="(function(){
      var vscode = acquireVsCodeApi ? acquireVsCodeApi() : (window.__vscode || { postMessage: function(){} });
      vscode.postMessage({ type: 'doctor_action', action: 'open_logs', task_id: '' });
    })()">Open logs</button>`;
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
