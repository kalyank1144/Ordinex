/**
 * VerificationCard (Step 44)
 *
 * Renders the post-scaffold verification pipeline results.
 * Shows step-by-step status (pass/warn/fail/skipped/running),
 * error output on failure, and action buttons.
 *
 * Actions:
 *   - Retry: re-run the full verification pipeline
 *   - Restore Checkpoint: rollback scaffold and restore previous state
 *   - Continue Anyway: dismiss failures and proceed (if allowed)
 *
 * Wire actions back to extension via postMessage:
 *   { type: 'verification_retry', scaffoldId }
 *   { type: 'verification_restore', scaffoldId }
 *   { type: 'verification_continue', scaffoldId }
 */

// ============================================================================
// TYPES (local to avoid cross-package imports)
// ============================================================================

interface VerifyStepResult {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped' | 'running';
  message: string;
  command?: string;
  output?: string;
  durationMs: number;
  retried?: boolean;
}

interface VerificationCardPayload {
  scaffold_id: string;
  run_id: string;
  outcome: 'pass' | 'partial' | 'fail';
  steps: VerifyStepResult[];
  total_duration_ms: number;
  package_manager: string;
  from_replay: boolean;
  allow_continue: boolean;
}

// ============================================================================
// MAIN RENDER
// ============================================================================

/**
 * Render the full VerificationCard HTML
 */
export function renderVerificationCard(payload: VerificationCardPayload): string {
  const {
    scaffold_id,
    outcome,
    steps,
    total_duration_ms,
    package_manager,
    from_replay,
    allow_continue,
  } = payload;

  const statusIcon = outcome === 'pass' ? '&#9989;' : outcome === 'partial' ? '&#9888;&#65039;' : '&#10060;';
  const statusLabel = outcome === 'pass' ? 'All Checks Passed' : outcome === 'partial' ? 'Passed with Warnings' : 'Verification Failed';
  const statusClass = outcome === 'pass' ? 'verify-pass' : outcome === 'partial' ? 'verify-partial' : 'verify-fail';
  const durationSec = (total_duration_ms / 1000).toFixed(1);

  const stepsHtml = steps.map(step => renderStep(step)).join('\n');

  const actionsHtml = outcome === 'pass'
    ? ''
    : renderActions(scaffold_id, outcome, allow_continue);

  const replayBadge = from_replay
    ? '<span class="verify-replay-badge">Replay</span>'
    : '';

  return `
<div class="verify-card ${statusClass}">
  <div class="verify-header">
    <div class="verify-icon">${statusIcon}</div>
    <div class="verify-title">
      <h3>Post-Scaffold Verification ${replayBadge}</h3>
      <span class="verify-subtitle">${statusLabel} &middot; ${durationSec}s &middot; ${package_manager}</span>
    </div>
  </div>

  <div class="verify-steps">
    ${stepsHtml}
  </div>

  ${actionsHtml}

  <div class="verify-footer">
    <small>Verification results are recorded for audit.</small>
  </div>
</div>

<style>
  .verify-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 16px;
    margin: 8px 0;
    background: var(--vscode-editor-background);
  }
  .verify-card.verify-pass { border-left: 4px solid #4caf50; }
  .verify-card.verify-partial { border-left: 4px solid #ff9800; }
  .verify-card.verify-fail { border-left: 4px solid #f44336; }

  .verify-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .verify-icon { font-size: 20px; }
  .verify-title h3 { margin: 0; font-size: 14px; }
  .verify-subtitle {
    font-size: 12px;
    opacity: 0.7;
  }
  .verify-replay-badge {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    margin-left: 6px;
    vertical-align: middle;
  }

  .verify-steps {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }

  .verify-step {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--vscode-input-background);
  }
  .verify-step-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
  .verify-step-body { flex: 1; min-width: 0; }
  .verify-step-label {
    font-weight: 600;
    font-size: 12px;
  }
  .verify-step-message {
    font-size: 11px;
    opacity: 0.8;
    margin-top: 2px;
  }
  .verify-step-duration {
    font-size: 10px;
    opacity: 0.5;
    margin-left: auto;
    flex-shrink: 0;
  }
  .verify-step-cmd {
    font-size: 10px;
    opacity: 0.6;
    font-family: monospace;
    margin-top: 2px;
  }
  .verify-step-output {
    font-size: 10px;
    font-family: monospace;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
    padding: 6px;
    margin-top: 4px;
    max-height: 120px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--vscode-inputValidation-errorForeground, #f44336);
  }
  .verify-step-retried {
    font-size: 10px;
    color: var(--vscode-inputValidation-warningForeground, #ff9800);
    margin-top: 2px;
  }

  .verify-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .verify-actions .btn {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .verify-actions .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .verify-actions .btn-primary:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .verify-actions .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .verify-actions .btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .verify-actions .btn-danger {
    background: var(--vscode-inputValidation-errorBackground);
    color: var(--vscode-inputValidation-errorForeground, #fff);
  }

  .verify-footer {
    margin-top: 10px;
    font-size: 10px;
    opacity: 0.5;
  }
</style>

<script>
  function verifyRetry(btn) {
    btn.disabled = true;
    btn.textContent = 'Retrying...';
    const vscode = acquireVsCodeApi();
    vscode.postMessage({
      type: 'verification_retry',
      scaffoldId: '${scaffold_id}',
    });
  }

  function verifyRestore(btn) {
    btn.disabled = true;
    btn.textContent = 'Restoring...';
    const vscode = acquireVsCodeApi();
    vscode.postMessage({
      type: 'verification_restore',
      scaffoldId: '${scaffold_id}',
    });
  }

  function verifyContinue(btn) {
    btn.disabled = true;
    btn.textContent = 'Continuing...';
    const vscode = acquireVsCodeApi();
    vscode.postMessage({
      type: 'verification_continue',
      scaffoldId: '${scaffold_id}',
    });
  }
</script>
`;
}

// ============================================================================
// STEP RENDERING
// ============================================================================

function renderStep(step: VerifyStepResult): string {
  const icon = stepIcon(step.status);
  const durationStr = step.durationMs < 1000
    ? `${step.durationMs}ms`
    : `${(step.durationMs / 1000).toFixed(1)}s`;

  const cmdHtml = step.command
    ? `<div class="verify-step-cmd">${escapeHtml(step.command)}</div>`
    : '';

  const outputHtml = step.output
    ? `<div class="verify-step-output">${escapeHtml(step.output)}</div>`
    : '';

  const retriedHtml = step.retried
    ? '<div class="verify-step-retried">Retried once</div>'
    : '';

  return `
    <div class="verify-step">
      <span class="verify-step-icon">${icon}</span>
      <div class="verify-step-body">
        <div class="verify-step-label">${escapeHtml(step.label)}</div>
        <div class="verify-step-message">${escapeHtml(step.message)}</div>
        ${cmdHtml}
        ${retriedHtml}
        ${outputHtml}
      </div>
      <span class="verify-step-duration">${durationStr}</span>
    </div>
  `;
}

function stepIcon(status: string): string {
  switch (status) {
    case 'pass': return '&#9989;';
    case 'warn': return '&#9888;&#65039;';
    case 'fail': return '&#10060;';
    case 'skipped': return '&#9898;';
    case 'running': return '&#9203;';
    default: return '&#9898;';
  }
}

// ============================================================================
// ACTIONS
// ============================================================================

function renderActions(scaffoldId: string, outcome: string, allowContinue: boolean): string {
  const continueBtn = allowContinue
    ? `<button class="btn btn-secondary" onclick="verifyContinue(this)">Continue Anyway</button>`
    : '';

  return `
    <div class="verify-actions">
      <button class="btn btn-primary" onclick="verifyRetry(this)">Retry Verification</button>
      <button class="btn btn-danger" onclick="verifyRestore(this)">Restore Checkpoint</button>
      ${continueBtn}
    </div>
  `;
}

// ============================================================================
// UTILS
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
