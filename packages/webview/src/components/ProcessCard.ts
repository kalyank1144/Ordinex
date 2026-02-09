/**
 * W2: ProcessCard Component
 *
 * Rich card for running processes. Shows command, status badge, port (if detected),
 * last 5 lines of output (expandable), and action buttons.
 *
 * Renders for process_started events. Self-updates via ProcessCard.update() when
 * subsequent process_ready/output/stopped/failed events arrive for the same process_id.
 *
 * Output buffer capped at 50 lines.
 */

import { Event } from '../types';

// ============================================================================
// TYPES
// ============================================================================

type ProcessCardStatus = 'starting' | 'running' | 'ready' | 'stopped' | 'failed';

interface ProcessCardState {
  processId: string;
  command: string;
  projectPath: string;
  status: ProcessCardStatus;
  port?: number;
  exitCode?: number;
  error?: string;
  outputLines: string[];
  startedAt: string;
}

// ============================================================================
// MODULE STATE — keyed by processId, updated by ProcessCard.update()
// ============================================================================

const MAX_OUTPUT_LINES = 50;
const VISIBLE_OUTPUT_LINES = 5;

const processStates: Map<string, ProcessCardState> = new Map();

// ============================================================================
// RENDER
// ============================================================================

/**
 * Render a ProcessCard for a process_started event.
 * Initializes the card state and returns HTML.
 */
export function renderProcessCard(event: Event): string {
  const processId = (event.payload.process_id as string) || event.event_id;
  const command = (event.payload.command as string) || 'unknown command';
  const projectPath = (event.payload.project_path as string) || '';

  // Initialize state
  const state: ProcessCardState = {
    processId,
    command,
    projectPath,
    status: 'starting',
    outputLines: [],
    startedAt: event.timestamp,
  };
  processStates.set(processId, state);

  return buildProcessCardHtml(state);
}

/**
 * Update an existing ProcessCard when a follow-up process event arrives.
 * Returns true if this event was handled (caller should re-render the card).
 */
export function updateProcessCard(event: Event): { handled: boolean; processId?: string } {
  const processId = event.payload.process_id as string;
  if (!processId) return { handled: false };

  const state = processStates.get(processId);
  if (!state) return { handled: false };

  switch (event.type) {
    case 'process_ready':
      state.status = 'ready';
      if (event.payload.port) {
        state.port = event.payload.port as number;
      }
      break;

    case 'process_output': {
      const lines = (event.payload.lines as string[]) || [];
      state.outputLines.push(...lines);
      if (state.outputLines.length > MAX_OUTPUT_LINES) {
        state.outputLines = state.outputLines.slice(-MAX_OUTPUT_LINES);
      }
      // If we're getting output, we're at least running
      if (state.status === 'starting') {
        state.status = 'running';
      }
      break;
    }

    case 'process_stopped':
      state.status = 'stopped';
      if (event.payload.exit_code !== undefined) {
        state.exitCode = event.payload.exit_code as number;
      }
      break;

    case 'process_failed':
      state.status = 'failed';
      state.error = (event.payload.error as string) || 'Unknown error';
      break;

    default:
      return { handled: false };
  }

  return { handled: true, processId };
}

/**
 * Get the current HTML for a process card by processId.
 */
export function getProcessCardHtml(processId: string): string | null {
  const state = processStates.get(processId);
  if (!state) return null;
  return buildProcessCardHtml(state);
}

/**
 * Check if an event type is a process event that should be routed to ProcessCard.
 */
export function isProcessEvent(eventType: string): boolean {
  return [
    'process_started',
    'process_ready',
    'process_output',
    'process_stopped',
    'process_failed',
  ].includes(eventType);
}

// ============================================================================
// HTML BUILDER
// ============================================================================

function buildProcessCardHtml(state: ProcessCardState): string {
  const statusBadge = getStatusBadge(state.status);
  const portInfo = state.port ? ` on port ${state.port}` : '';
  const isAlive = state.status === 'starting' || state.status === 'running' || state.status === 'ready';
  const hasPort = !!state.port;

  // Last N visible lines of output
  const visibleLines = state.outputLines.slice(-VISIBLE_OUTPUT_LINES);
  const totalLines = state.outputLines.length;
  const hasMoreLines = totalLines > VISIBLE_OUTPUT_LINES;

  // All lines for the expanded view
  const allLinesHtml = state.outputLines
    .map(l => escapeHtml(l))
    .join('\n');

  const visibleLinesHtml = visibleLines
    .map(l => escapeHtml(l))
    .join('\n');

  return `
    <div class="process-card" data-process-id="${escapeHtml(state.processId)}" style="
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 2px solid ${getBorderColor(state.status)};
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    ">
      <!-- Header: icon + command + status badge -->
      <div style="
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      ">
        <span style="font-size: 18px;">${getStatusIcon(state.status)}</span>
        <code style="
          font-family: monospace;
          font-size: 12px;
          font-weight: 700;
          color: var(--vscode-foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        ">${escapeHtml(state.command)}</code>
        ${statusBadge}
      </div>

      <!-- Port / path info -->
      <div style="
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 12px;
      ">
        ${state.projectPath ? `<span>📁 ${escapeHtml(shortenPath(state.projectPath))}</span>` : ''}
        ${hasPort ? `<span style="color: var(--vscode-charts-green); font-weight: 700;">🌐 localhost:${state.port}</span>` : ''}
        ${state.exitCode !== undefined ? `<span>Exit code: ${state.exitCode}</span>` : ''}
        ${state.error ? `<span style="color: var(--vscode-errorForeground);">${escapeHtml(state.error)}</span>` : ''}
      </div>

      <!-- Output area -->
      ${totalLines > 0 ? `
        <details ${hasMoreLines ? '' : 'open'} style="margin-bottom: 8px;">
          <summary style="
            cursor: pointer;
            font-size: 10px;
            font-weight: 700;
            color: var(--vscode-descriptionForeground);
            user-select: none;
            margin-bottom: 4px;
          ">
            OUTPUT (${totalLines} line${totalLines !== 1 ? 's' : ''})
          </summary>
          <pre style="
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px;
            margin: 4px 0 0 0;
            font-family: monospace;
            font-size: 10px;
            line-height: 1.5;
            overflow-x: auto;
            max-height: 300px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-all;
            color: var(--vscode-foreground);
          ">${allLinesHtml}</pre>
        </details>
      ` : `
        ${isAlive ? `
          <div style="
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            margin-bottom: 8px;
          ">Waiting for output...</div>
        ` : ''}
      `}

      <!-- Recent output preview (when collapsed / no details open) -->
      ${totalLines > 0 && !hasMoreLines ? '' : totalLines > 0 ? `
        <div style="
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
          padding: 6px 8px;
          margin-bottom: 8px;
          font-family: monospace;
          font-size: 10px;
          line-height: 1.4;
          color: var(--vscode-foreground);
          max-height: 80px;
          overflow: hidden;
        ">
          <pre style="margin: 0; white-space: pre-wrap; word-break: break-all;">${visibleLinesHtml}</pre>
        </div>
      ` : ''}

      <!-- Action buttons -->
      <div style="
        display: flex;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--vscode-panel-border);
        flex-wrap: wrap;
      ">
        ${hasPort ? `
          <button
            onclick="window.processCardAction('open_browser', '${escapeAttr(state.processId)}', ${state.port})"
            style="
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              border: none;
              padding: 4px 10px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 11px;
              font-weight: 600;
            "
          >🌐 Open in Browser</button>
        ` : ''}

        ${isAlive ? `
          <button
            onclick="window.processCardAction('terminate', '${escapeAttr(state.processId)}')"
            style="
              background: var(--vscode-statusBarItem-errorBackground, #c53434);
              color: var(--vscode-statusBarItem-errorForeground, #fff);
              border: none;
              padding: 4px 10px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 11px;
              font-weight: 600;
            "
          >⏹ Terminate</button>
        ` : ''}
      </div>
    </div>
  `;
}

// ============================================================================
// HELPERS
// ============================================================================

function getStatusBadge(status: ProcessCardStatus): string {
  const config: Record<ProcessCardStatus, { label: string; bg: string; fg: string }> = {
    starting: { label: 'Starting...', bg: 'var(--vscode-charts-blue)', fg: '#fff' },
    running:  { label: 'Running',     bg: 'var(--vscode-charts-blue)', fg: '#fff' },
    ready:    { label: 'Ready',       bg: 'var(--vscode-charts-green)', fg: '#fff' },
    stopped:  { label: 'Stopped',     bg: 'var(--vscode-charts-yellow)', fg: '#000' },
    failed:   { label: 'Failed',      bg: 'var(--vscode-charts-red)', fg: '#fff' },
  };
  const c = config[status];
  return `<span style="
    display: inline-block;
    background: ${c.bg};
    color: ${c.fg};
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  ">${c.label}</span>`;
}

function getStatusIcon(status: ProcessCardStatus): string {
  const icons: Record<ProcessCardStatus, string> = {
    starting: '⏳',
    running: '🔄',
    ready: '✅',
    stopped: '⏹️',
    failed: '❌',
  };
  return icons[status];
}

function getBorderColor(status: ProcessCardStatus): string {
  const colors: Record<ProcessCardStatus, string> = {
    starting: 'var(--vscode-charts-blue)',
    running: 'var(--vscode-charts-blue)',
    ready: 'var(--vscode-charts-green)',
    stopped: 'var(--vscode-charts-yellow)',
    failed: 'var(--vscode-charts-red)',
  };
  return colors[status];
}

function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return p;
  return '.../' + parts.slice(-2).join('/');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(text: string): string {
  return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
}
