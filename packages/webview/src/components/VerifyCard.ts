/**
 * VerifyCard - UI component for verification events
 *
 * Minimal custom element implementation without external deps.
 */

declare class HTMLElement {
  shadowRoot: any;
  attachShadow(init: { mode: 'open' | 'closed' }): any;
  dispatchEvent(event: any): boolean;
  getAttribute(name: string): string | null;
}

declare class CustomEvent<T = any> {
  constructor(type: string, init?: { detail?: T; bubbles?: boolean; composed?: boolean });
}

declare const customElements: {
  get(name: string): any;
  define(name: string, ctor: any): void;
};

import { escapeHtml } from '../utils/cardHelpers';

type HTMLButtonElement = any;

type VerifyEvent = {
  event_id?: string;
  type?: string;
  payload?: Record<string, any>;
};

export class VerifyCard extends HTMLElement {
  private _event: VerifyEvent | null = null;

  set event(value: VerifyEvent | null) {
    this._event = value;
    this.render();
  }

  get event(): VerifyEvent | null {
    return this._event;
  }

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this.render();
  }

  private render(): void {
    if (!this.shadowRoot) return;

    const event = this._event;
    if (!event) {
      this.shadowRoot.innerHTML = `${this.styles()}<div class="verify-card">No event data</div>`;
      return;
    }

    const payload = event.payload || {};
    let body = '';

    switch (event.type) {
      case 'verify_started':
        body = this.renderStarted(payload);
        break;
      case 'verify_completed':
        body = this.renderCompleted(event, payload);
        break;
      case 'verify_proposed':
        body = this.renderProposed(event, payload);
        break;
      case 'verify_skipped':
        body = this.renderSkipped(payload);
        break;
      default:
        body = `<div class="verify-card">Unknown verify event: ${escapeHtml(String(event.type))}</div>`;
        break;
    }

    this.shadowRoot.innerHTML = `${this.styles()}${body}`;
    this.bindActions();
  }

  private renderStarted(payload: Record<string, any>): string {
    const commands = payload.commands || [];
    const count = payload.count || commands.length;
    const policyMode = payload.policy_mode || 'unknown';

    const commandsHtml = commands.length > 0
      ? `
        <div class="commands">
          ${commands.map((cmd: any) => `
            <div class="command-item">
              <code>${escapeHtml(cmd.name || cmd.command || '')}</code>
            </div>
          `).join('')}
        </div>
      `
      : '';

    return `
      <div class="verify-card running">
        <div class="header">
          <span class="icon">🔍</span>
          <h3>Running Verification</h3>
          <span class="badge">${escapeHtml(String(policyMode))}</span>
        </div>
        ${commandsHtml}
        <p class="status">Executing ${count} command(s)...</p>
      </div>
    `;
  }

  private renderCompleted(event: VerifyEvent, payload: Record<string, any>): string {
    const status = payload.status || 'unknown';
    const isPassed = status === 'pass';
    const commandsExecuted = payload.commands_executed || 0;
    const failedCommand = payload.failed_command;
    const exitCode = payload.exit_code;
    const transcriptId = payload.transcript_evidence_id;

    const failedDetails = !isPassed && failedCommand
      ? `
        <div class="error-details">
          <p><strong>Failed command:</strong> <code>${escapeHtml(String(failedCommand))}</code></p>
          ${exitCode !== undefined ? `<p><strong>Exit code:</strong> ${escapeHtml(String(exitCode))}</p>` : ''}
        </div>
        <div class="actions">
          ${transcriptId ? `<button class="btn-secondary" data-action="view-logs" data-transcript-id="${escapeHtml(String(transcriptId))}">View Logs</button>` : ''}
          <button class="btn-primary" data-action="propose-fix" data-event-id="${escapeHtml(String(event.event_id || ''))}">Propose Fix</button>
        </div>
      `
      : `
        <div class="success-details">
          <p>All verification commands passed successfully</p>
        </div>
      `;

    return `
      <div class="verify-card ${isPassed ? 'passed' : 'failed'}">
        <div class="header">
          <span class="icon">${isPassed ? '✅' : '❌'}</span>
          <h3>Verification ${isPassed ? 'Passed' : 'Failed'}</h3>
        </div>
        <div class="summary">
          <p>Executed ${commandsExecuted} command(s)</p>
        </div>
        ${failedDetails}
      </div>
    `;
  }

  private renderProposed(event: VerifyEvent, payload: Record<string, any>): string {
    const summary = payload.summary || 'Verification commands available';
    const commands = payload.commands || [];

    const commandsHtml = commands.length > 0
      ? `
        <div class="commands">
          ${commands.map((cmd: any) => `
            <div class="command-item">
              <code>${escapeHtml(cmd.name || cmd.command || '')}</code>
            </div>
          `).join('')}
        </div>
      `
      : '';

    return `
      <div class="verify-card proposed">
        <div class="header">
          <span class="icon">🔍</span>
          <h3>Verification Available</h3>
        </div>
        <p class="description">${escapeHtml(String(summary))}</p>
        ${commandsHtml}
        <div class="actions">
          <button class="btn-primary" data-action="run-verify" data-event-id="${escapeHtml(String(event.event_id || ''))}">Run Verification</button>
          <button class="btn-secondary" data-action="skip-once" data-event-id="${escapeHtml(String(event.event_id || ''))}">Skip Once</button>
          <button class="btn-text" data-action="disable-verify" data-event-id="${escapeHtml(String(event.event_id || ''))}">Disable</button>
        </div>
      </div>
    `;
  }

  private renderSkipped(payload: Record<string, any>): string {
    const reason = payload.reason || 'Verification was skipped';
    return `
      <div class="verify-card skipped">
        <div class="header">
          <span class="icon">⏭️</span>
          <h3>Verification Skipped</h3>
        </div>
        <p class="description">${escapeHtml(String(reason))}</p>
      </div>
    `;
  }

  private bindActions(): void {
    if (!this.shadowRoot || !this._event) return;

    const viewLogsBtn = this.shadowRoot.querySelector('[data-action="view-logs"]') as HTMLButtonElement | null;
    if (viewLogsBtn) {
      viewLogsBtn.addEventListener('click', () => {
        const transcriptId = viewLogsBtn.getAttribute('data-transcript-id') || '';
        this.dispatchEvent(new CustomEvent('view-logs', {
          detail: { transcriptId },
          bubbles: true,
          composed: true
        }));
      });
    }

    const proposeFixBtn = this.shadowRoot.querySelector('[data-action="propose-fix"]') as HTMLButtonElement | null;
    if (proposeFixBtn) {
      proposeFixBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('propose-fix', {
          detail: {
            verifyResult: this._event?.payload,
            eventId: this._event?.event_id
          },
          bubbles: true,
          composed: true
        }));
      });
    }

    const actionButtons = this.shadowRoot.querySelectorAll('[data-action="run-verify"], [data-action="skip-once"], [data-action="disable-verify"]');
    actionButtons.forEach((btn: any) => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).getAttribute('data-action') || '';
        const mappedAction = action === 'run-verify'
          ? 'run_verify'
          : action === 'skip-once'
            ? 'skip_once'
            : 'disable_verify';
        this.dispatchEvent(new CustomEvent('user-action', {
          detail: {
            action: mappedAction,
            eventId: this._event?.event_id
          },
          bubbles: true,
          composed: true
        }));
      });
    });
  }

  private styles(): string {
    return `
      <style>
        :host { display: block; }
        .verify-card {
          padding: 16px;
          border-radius: 8px;
          margin: 12px 0;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
        }
        .verify-card.running { background: rgba(33, 150, 243, 0.1); border-left: 4px solid #2196f3; }
        .verify-card.passed { background: rgba(76, 175, 80, 0.1); border-left: 4px solid #4caf50; }
        .verify-card.failed { background: rgba(244, 67, 54, 0.1); border-left: 4px solid #f44336; }
        .verify-card.proposed { background: rgba(255, 152, 0, 0.1); border-left: 4px solid #ff9800; }
        .verify-card.skipped { background: rgba(158, 158, 158, 0.1); border-left: 4px solid #9e9e9e; }
        .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .icon { font-size: 20px; line-height: 1; }
        .header h3 { margin: 0; font-size: 14px; font-weight: 600; flex: 1; color: var(--vscode-foreground); }
        .badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); text-transform: uppercase; }
        .commands { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
        .command-item { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        .command-item code { font-family: var(--vscode-editor-font-family); color: var(--vscode-textPreformat-foreground); }
        .status, .description, .summary p, .error-details p, .success-details p { margin: 8px 0; font-size: 13px; color: var(--vscode-foreground); line-height: 1.5; }
        .error-details { margin: 12px 0; padding: 12px; background: rgba(244, 67, 54, 0.1); border-radius: 4px; }
        .error-details code { font-family: var(--vscode-editor-font-family); background: rgba(0, 0, 0, 0.2); padding: 2px 6px; border-radius: 3px; }
        .success-details { margin: 12px 0; padding: 12px; background: rgba(76, 175, 80, 0.1); border-radius: 4px; }
        .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        button { padding: 6px 12px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn-text { background: transparent; color: var(--vscode-textLink-foreground); padding: 6px 8px; }
        .btn-text:hover { text-decoration: underline; }
      </style>
    `;
  }

}

if (!customElements.get('verify-card')) {
  customElements.define('verify-card', VerifyCard);
}

declare global {
  interface HTMLElementTagNameMap {
    'verify-card': VerifyCard;
  }
}
