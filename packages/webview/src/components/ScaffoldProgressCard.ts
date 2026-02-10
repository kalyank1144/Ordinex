/**
 * S1: ScaffoldProgressCard — aggregates scaffold build-phase events into a
 * single updating card with a staged checklist.
 *
 * Replaces 15+ individual event cards (scaffold_apply_started through
 * scaffold_verify_completed) with one card that updates in-place.
 *
 * Pattern: Same update-in-place pattern as ProcessCard (W2).
 */

import { escapeHtml, formatDuration } from '../utils/cardHelpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScaffoldStage {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  detail?: string;
}

interface ScaffoldProgressState {
  scaffoldId: string;
  stages: ScaffoldStage[];
  eventCount: number;
  startTime: string;
  lastUpdate: string;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const progressStates = new Map<string, ScaffoldProgressState>();

/** Events that belong to the scaffold build phase (handled by this card). */
const SCAFFOLD_PROGRESS_EVENT_SET = new Set([
  'scaffold_apply_started',
  'scaffold_applied',
  'scaffold_apply_completed',
  'scaffold_progress',
  'design_pack_applied',
  'feature_extraction_started',
  'feature_extraction_completed',
  'feature_code_generating',
  'feature_code_applied',
  'feature_code_error',
  'scaffold_verify_started',
  'scaffold_verify_step_completed',
  'scaffold_verify_completed',
  'scaffold_autofix_started',
  'scaffold_autofix_applied',
  'scaffold_autofix_failed',
  'scaffold_checkpoint_created',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check if an event type belongs to the scaffold build phase. */
export function isScaffoldProgressEvent(eventType: string): boolean {
  return SCAFFOLD_PROGRESS_EVENT_SET.has(eventType);
}

/**
 * Render the initial ScaffoldProgressCard (called for `scaffold_apply_started`
 * or the first scaffold progress event).
 */
export function renderScaffoldProgressCard(event: any): string {
  const scaffoldId = event.payload?.scaffold_id || event.task_id || 'default';

  const state: ScaffoldProgressState = {
    scaffoldId,
    stages: createInitialStages(),
    eventCount: 1,
    startTime: event.timestamp || new Date().toISOString(),
    lastUpdate: event.timestamp || new Date().toISOString(),
  };

  applyEvent(state, event);
  progressStates.set(scaffoldId, state);

  return buildCardHtml(state);
}

/**
 * Update an existing ScaffoldProgressCard with a follow-up event.
 * Returns `{ handled, scaffoldId }` — caller uses scaffoldId to find the DOM
 * element and replace its HTML.
 */
export function updateScaffoldProgress(event: any): { handled: boolean; scaffoldId: string | null } {
  const scaffoldId = event.payload?.scaffold_id || event.task_id || 'default';
  let state = progressStates.get(scaffoldId);

  if (!state) {
    // First event for this scaffold — create state
    state = {
      scaffoldId,
      stages: createInitialStages(),
      eventCount: 0,
      startTime: event.timestamp || new Date().toISOString(),
      lastUpdate: event.timestamp || new Date().toISOString(),
    };
    progressStates.set(scaffoldId, state);
  }

  state.eventCount++;
  state.lastUpdate = event.timestamp || new Date().toISOString();
  applyEvent(state, event);

  return { handled: true, scaffoldId };
}

/** Get the current HTML for a scaffold progress card (for DOM replacement). */
export function getScaffoldProgressCardHtml(scaffoldId: string): string | null {
  const state = progressStates.get(scaffoldId);
  if (!state) return null;
  return buildCardHtml(state);
}

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

function createInitialStages(): ScaffoldStage[] {
  return [
    { id: 'create', label: 'Creating project files', status: 'pending' },
    { id: 'design', label: 'Applying design system', status: 'pending' },
    { id: 'features', label: 'Generating features', status: 'pending' },
    { id: 'verify', label: 'Verifying project', status: 'pending' },
  ];
}

function applyEvent(state: ScaffoldProgressState, event: any): void {
  const payload = event.payload || {};
  const stages = state.stages;

  switch (event.type) {
    case 'scaffold_apply_started':
      setStageActive(stages, 'create');
      break;

    case 'scaffold_progress': {
      const status = payload.status;
      if (status === 'creating') {
        setStageActive(stages, 'create');
      } else if (status === 'applying_design') {
        setStageDone(stages, 'create');
        setStageActive(stages, 'design');
      }
      break;
    }

    case 'scaffold_applied':
    case 'scaffold_apply_completed':
      setStageDone(stages, 'create');
      break;

    case 'design_pack_applied':
      setStageDone(stages, 'design');
      if (payload.design_pack_name) {
        findStage(stages, 'design')!.detail = escapeHtml(String(payload.design_pack_name));
      }
      break;

    case 'feature_extraction_started':
      setStageActive(stages, 'features');
      break;

    case 'feature_extraction_completed':
      // Features extracted but code not yet generated — keep active
      findStage(stages, 'features')!.detail =
        `${payload.features_count || 0} features, ${payload.pages_count || 0} pages`;
      break;

    case 'feature_code_generating':
      setStageActive(stages, 'features');
      break;

    case 'feature_code_applied': {
      setStageDone(stages, 'features');
      const fc = payload.files_created || payload.files_count || 0;
      if (fc) findStage(stages, 'features')!.detail = `${fc} files created`;
      break;
    }

    case 'feature_code_error':
      setStageStatus(stages, 'features', 'failed');
      findStage(stages, 'features')!.detail = 'Fell back to generic scaffold';
      break;

    case 'scaffold_verify_started':
      setStageActive(stages, 'verify');
      break;

    case 'scaffold_verify_step_completed': {
      // Keep verify active, update detail with latest step
      const stepStatus = payload.step_status || 'pass';
      const stepName = payload.step_name || '';
      const icon = stepStatus === 'pass' ? 'pass' : stepStatus === 'fail' ? 'fail' : 'warn';
      findStage(stages, 'verify')!.detail = `${stepName}: ${icon}`;
      break;
    }

    case 'scaffold_verify_completed': {
      const outcome = payload.outcome || 'pass';
      setStageStatus(stages, 'verify', outcome === 'pass' ? 'done' : outcome === 'partial' ? 'done' : 'failed');
      findStage(stages, 'verify')!.detail =
        `${payload.pass_count || 0} passed, ${payload.fail_count || 0} failed`;
      break;
    }

    case 'scaffold_autofix_started':
      findStage(stages, 'verify')!.detail = 'Auto-fixing errors...';
      setStageActive(stages, 'verify');
      break;

    case 'scaffold_autofix_applied':
      findStage(stages, 'verify')!.detail = 'Fixed, re-verifying...';
      break;

    case 'scaffold_autofix_failed':
      findStage(stages, 'verify')!.detail = 'Auto-fix failed';
      break;

    // scaffold_checkpoint_created: no stage change, just count event
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

function findStage(stages: ScaffoldStage[], id: string): ScaffoldStage | undefined {
  return stages.find(s => s.id === id);
}

function setStageActive(stages: ScaffoldStage[], id: string): void {
  const stage = findStage(stages, id);
  if (stage && stage.status === 'pending') stage.status = 'active';
}

function setStageDone(stages: ScaffoldStage[], id: string): void {
  const stage = findStage(stages, id);
  if (stage) stage.status = 'done';
}

function setStageStatus(stages: ScaffoldStage[], id: string, status: ScaffoldStage['status']): void {
  const stage = findStage(stages, id);
  if (stage) stage.status = status;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function buildCardHtml(state: ScaffoldProgressState): string {
  const doneCount = state.stages.filter(s => s.status === 'done').length;
  const total = state.stages.length;
  const progressPct = Math.round((doneCount / total) * 100);

  const elapsed = new Date(state.lastUpdate).getTime() - new Date(state.startTime).getTime();
  const isAllDone = state.stages.every(s => s.status === 'done' || s.status === 'failed' || s.status === 'skipped');

  const stagesHtml = state.stages.map(s => {
    const icon = stageIcon(s.status);
    const detailHtml = s.detail ? `<span class="stage-detail">${escapeHtml(s.detail)}</span>` : '';
    return `
      <div class="stage ${s.status}">
        <span class="stage-icon">${icon}</span>
        <span class="stage-label">${escapeHtml(s.label)}</span>
        ${detailHtml}
      </div>`;
  }).join('');

  return `
    <div class="scaffold-progress-card ${isAllDone ? 'complete' : ''}" data-scaffold-id="${escapeHtml(state.scaffoldId)}">
      <div class="sp-header">
        <span class="sp-icon">${isAllDone ? '\u2705' : '\u{1F3D7}\uFE0F'}</span>
        <h3 class="sp-title">${isAllDone ? 'Project Built' : 'Building Project'}</h3>
        <span class="sp-elapsed">${formatDuration(elapsed)}</span>
      </div>
      <div class="sp-progress-bar">
        <div class="sp-progress-fill" style="width: ${progressPct}%"></div>
      </div>
      <div class="sp-stages">
        ${stagesHtml}
      </div>
      <div class="sp-footer">
        <span class="sp-events">${state.eventCount} events</span>
      </div>
      <style>
        .scaffold-progress-card {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border, #333);
          border-radius: 8px;
          padding: 12px 16px;
          margin: 8px 0;
          font-family: var(--vscode-font-family);
          font-size: 13px;
        }
        .scaffold-progress-card.complete {
          border-color: var(--vscode-testing-iconPassed, #4caf50);
        }
        .sp-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .sp-icon { font-size: 18px; }
        .sp-title {
          flex: 1;
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        .sp-elapsed {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }
        .sp-progress-bar {
          height: 4px;
          background: var(--vscode-progressBar-background, #333);
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .sp-progress-fill {
          height: 100%;
          background: var(--vscode-progressBar-background, #0078d4);
          border-radius: 2px;
          transition: width 0.3s ease;
        }
        .sp-stages {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .stage {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
        }
        .stage-icon { width: 20px; text-align: center; font-size: 14px; }
        .stage-label {
          color: var(--vscode-foreground);
          font-size: 13px;
        }
        .stage.pending .stage-label {
          color: var(--vscode-descriptionForeground);
        }
        .stage.active .stage-label {
          color: var(--vscode-foreground);
          font-weight: 500;
        }
        .stage-detail {
          margin-left: auto;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }
        .sp-footer {
          margin-top: 8px;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }
      </style>
    </div>`;
}

function stageIcon(status: ScaffoldStage['status']): string {
  switch (status) {
    case 'pending': return '\u25CB'; // ○
    case 'active': return '\u23F3';  // ⏳
    case 'done': return '\u2705';    // ✅
    case 'failed': return '\u274C';  // ❌
    case 'skipped': return '\u23ED\uFE0F'; // ⏭️
  }
}
