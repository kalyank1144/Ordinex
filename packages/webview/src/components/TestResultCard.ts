/**
 * TestResultCard - Specialized card for test execution results
 * Shows test command, exit code, duration, and evidence link
 */

import { Event } from '../types';

/**
 * Render a test result card for tool_end events with terminal commands
 */
export function renderTestResultCard(event: Event): string {
  const command = event.payload.command as string || 'unknown command';
  const exitCode = event.payload.exit_code as number;
  const success = event.payload.success as boolean;
  const durationMs = event.payload.duration_ms as number;
  const hasEvidence = event.evidence_ids.length > 0;

  const statusIcon = success ? '✅' : '❌';
  const statusText = success ? 'PASSED' : 'FAILED';
  const statusColor = success ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)';

  return `
    <div class="event-card test-result-card ${success ? 'test-passed' : 'test-failed'}">
      <div class="event-card-header">
        <span class="event-icon" style="color: ${statusColor}">${statusIcon}</span>
        <span class="event-type">Tests ${statusText}</span>
        <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
      </div>
      <div class="test-details">
        <div class="test-command">
          <code>${escapeHtml(command)}</code>
        </div>
        <div class="test-metadata">
          <span class="test-exit-code">Exit code: ${exitCode}</span>
          ${durationMs ? `<span class="test-duration">Duration: ${formatDuration(durationMs)}</span>` : ''}
        </div>
      </div>
      ${hasEvidence ? `
        <div class="test-evidence">
          <button class="evidence-link" onclick="window.postVscodeMessage({type: 'ordinex:viewEvidence', evidenceId: '${event.evidence_ids[0]}'})">
            📋 View Test Output
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render a "No Test Runner" info card
 */
export function renderNoTestRunnerCard(event: Event): string {
  const message = event.payload.message as string || 'No test runner detected';
  
  return `
    <div class="event-card test-info-card">
      <div class="event-card-header">
        <span class="event-icon">ℹ️</span>
        <span class="event-type">Test Detection</span>
        <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
      </div>
      <div class="test-info">
        ${escapeHtml(message)}
      </div>
      <div class="test-info-help">
        Add a <code>test</code>, <code>lint</code>, or <code>typecheck</code> script to your package.json to enable test execution.
      </div>
    </div>
  `;
}

/**
 * Render "Run Tests" action button
 * Shows after diff_applied or when in test stage
 */
export function renderRunTestsButton(taskId: string): string {
  return `
    <div class="action-card test-action-card">
      <div class="action-header">
        <span class="action-icon">🧪</span>
        <span class="action-title">Validation Ready</span>
      </div>
      <div class="action-description">
        Run tests to validate the changes you've made.
      </div>
      <div class="action-buttons">
        <button 
          class="action-button primary" 
          onclick="window.postVscodeMessage({type: 'ordinex:runTests', taskId: '${taskId}'})"
        >
          Run Tests
        </button>
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

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
