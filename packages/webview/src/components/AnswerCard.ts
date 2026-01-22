/**
 * Answer Card Component
 * Displays streaming LLM answers in ANSWER mode
 */

import { Event } from '../types';

/**
 * Render Answer Card for context_collected event
 * Handles both ANSWER mode (files_included) and PLAN mode (light context)
 */
export function renderContextCollectedCard(event: Event): string {
  // Check if this is a PLAN mode light context
  const isLightContext = event.payload.level === 'light';

  if (isLightContext) {
    // PLAN mode light context
    const stack = event.payload.stack as string || 'unknown';
    const anchorFiles = (event.payload.anchor_files as string[]) || [];
    const filesScanned = event.payload.files_scanned as number || 0;
    const scanDuration = event.payload.scan_duration_ms as number || 0;
    const todoCount = event.payload.todo_count as number | null;
    const topDirs = (event.payload.top_dirs as string[]) || [];

    return `
      <div class="event-card answer-context-card">
        <div class="event-card-header">
          <span class="event-icon" style="color: var(--vscode-charts-blue)">📚</span>
          <span class="event-type">Project Context Collected</span>
          <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
        </div>
        <div class="context-summary">
          <div class="context-stat">
            <span class="stat-label">Files Scanned:</span>
            <span class="stat-value">${filesScanned}</span>
          </div>
          <div class="context-stat">
            <span class="stat-label">Anchor Files:</span>
            <span class="stat-value">${anchorFiles.length}</span>
          </div>
          ${todoCount !== null ? `
          <div class="context-stat">
            <span class="stat-label">TODOs:</span>
            <span class="stat-value">${todoCount}</span>
          </div>
          ` : ''}
          <div class="context-stat">
            <span class="stat-label">Scan Time:</span>
            <span class="stat-value">${scanDuration}ms</span>
          </div>
        </div>
        ${stack !== 'unknown' ? `
          <div class="context-stack">
            <strong>Stack:</strong> ${escapeHtml(stack)}
          </div>
        ` : ''}
        ${topDirs.length > 0 ? `
          <details class="context-files">
            <summary>Directories (${topDirs.length})</summary>
            <ul>
              ${topDirs.slice(0, 10).map(d => `<li>${escapeHtml(d)}</li>`).join('')}
            </ul>
          </details>
        ` : ''}
        ${anchorFiles.length > 0 ? `
          <details class="context-files">
            <summary>Anchor Files (${anchorFiles.length})</summary>
            <ul>
              ${anchorFiles.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
            </ul>
          </details>
        ` : ''}
      </div>
    `;
  }

  // ANSWER mode context (original logic)
  const filesIncluded = (event.payload.files_included as string[]) || [];
  const openFilesCount = event.payload.open_files_count as number || 0;
  const totalLines = event.payload.total_lines as number || 0;
  const inferredStack = (event.payload.inferred_stack as string[]) || [];

  return `
    <div class="event-card answer-context-card">
      <div class="event-card-header">
        <span class="event-icon" style="color: var(--vscode-charts-blue)">📚</span>
        <span class="event-type">Project Context Collected</span>
        <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
      </div>
      <div class="context-summary">
        <div class="context-stat">
          <span class="stat-label">Files:</span>
          <span class="stat-value">${filesIncluded.length}</span>
        </div>
        <div class="context-stat">
          <span class="stat-label">Open Files:</span>
          <span class="stat-value">${openFilesCount}</span>
        </div>
        <div class="context-stat">
          <span class="stat-label">Total Lines:</span>
          <span class="stat-value">${totalLines}</span>
        </div>
      </div>
      ${inferredStack.length > 0 ? `
        <div class="context-stack">
          <strong>Stack:</strong> ${inferredStack.join(', ')}
        </div>
      ` : ''}
      ${filesIncluded.length > 0 ? `
        <details class="context-files">
          <summary>Files Included (${filesIncluded.length})</summary>
          <ul>
            ${filesIncluded.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
          </ul>
        </details>
      ` : ''}
    </div>
  `;
}

/**
 * Render streaming answer output area
 * This is shown when tool_start(llm_answer) is detected in ANSWER mode
 */
export function renderAnswerStreamCard(event: Event, taskId: string): string {
  const model = event.payload.model as string || 'unknown';
  const hasContext = event.payload.has_context as boolean || false;

  return `
    <div class="event-card answer-stream-card" id="answer-stream-${taskId}">
      <div class="event-card-header">
        <span class="event-icon" style="color: var(--vscode-charts-green)">💬</span>
        <span class="event-type">ANSWER ${hasContext ? '(Project-Aware)' : '(Read-Only)'}</span>
        <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
      </div>
      <div class="answer-meta">
        <span class="answer-model">Model: ${escapeHtml(model)}</span>
        ${hasContext ? '<span class="answer-badge">✓ Context Injected</span>' : ''}
      </div>
      <div class="answer-content" id="answer-content-${taskId}"></div>
      <div class="answer-status" id="answer-status-${taskId}">
        <span class="streaming-indicator">⚡ Streaming...</span>
      </div>
    </div>
  `;
}

/**
 * Utility functions
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
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
