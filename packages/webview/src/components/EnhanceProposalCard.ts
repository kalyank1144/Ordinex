/**
 * Enhance Proposal Card (Step 36.6)
 * 
 * Compact UI card shown before enhancing an existing project.
 * Displays detected stack, files to read, verify commands, and reassurances.
 * 
 * Design: Clear, minimal, confidence-building for non-greenfield workflows.
 * Uses vanilla TS custom elements to match existing codebase pattern.
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

type HTMLButtonElement = any;

/**
 * Enhance proposal event structure
 */
type EnhanceProposalEvent = {
  event_id?: string;
  type?: string;
  timestamp?: string;
  payload?: Record<string, any>;
};

export class EnhanceProposalCard extends HTMLElement {
  private _event: EnhanceProposalEvent | null = null;
  private _filesExpanded: boolean = false;

  set event(value: EnhanceProposalEvent | null) {
    this._event = value;
    this.render();
  }

  get event(): EnhanceProposalEvent | null {
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
      this.shadowRoot.innerHTML = `${this.styles()}<div class="enhance-card">No event data</div>`;
      return;
    }

    const payload = event.payload || {};
    const body = this.renderProposal(payload);

    this.shadowRoot.innerHTML = `${this.styles()}${body}`;
    this.bindActions();
  }

  private renderProposal(payload: Record<string, any>): string {
    const title = payload.title || 'Enhance Existing Project';
    const detectedStack = payload.detected_stack || 'Unknown project';
    const filesCount = payload.files_count || 0;
    const filesToRead = payload.files_to_read || [];
    const verifyCommands = payload.verify_commands || [];
    const reassurances = payload.reassurances || [];

    return `
      <div class="enhance-card">
        <!-- Header -->
        <div class="header">
          <span class="icon">🔧</span>
          <h3>${this.escapeHtml(title)}</h3>
          <span class="badge enhance">Enhance</span>
        </div>

        <!-- Detected Stack Badge -->
        <div class="stack-badge">
          <span class="stack-icon">📦</span>
          ${this.escapeHtml(detectedStack)}
        </div>

        <!-- Info Section -->
        <div class="info-section">
          <!-- Files to Read -->
          <div class="info-row">
            <span class="info-label">📄 Files to read</span>
            <span class="info-right">
              <span class="info-value">${filesCount}</span>
              <button class="view-link" data-action="toggle_files">
                ${this._filesExpanded ? 'Hide' : 'View'}
              </button>
            </span>
          </div>

          <!-- Expandable File List -->
          <div class="file-list ${this._filesExpanded ? 'expanded' : ''}">
            ${filesToRead.map((file: string) => `
              <div class="file-item">${this.escapeHtml(file)}</div>
            `).join('')}
          </div>

          <!-- Verify Commands -->
          ${verifyCommands.length > 0 ? `
            <div class="info-row">
              <span class="info-label">✅ Verify commands</span>
            </div>
            <div class="verify-commands">
              ${verifyCommands.map((cmd: string) => `
                <span class="verify-tag">${this.escapeHtml(cmd)}</span>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Reassurances -->
        <div class="reassurances">
          ${reassurances.map((msg: string) => `
            <div class="reassurance-item">
              <span class="check-icon">✓</span>
              ${this.escapeHtml(msg)}
            </div>
          `).join('')}
        </div>

        <div class="divider"></div>

        <!-- Buttons -->
        <div class="button-row">
          <button class="btn btn-primary" data-action="continue">
            Continue
          </button>
          <button class="btn btn-secondary" data-action="change_focus">
            Change Focus
          </button>
          <button class="btn btn-text" data-action="cancel">
            Cancel
          </button>
        </div>
      </div>
    `;
  }

  private bindActions(): void {
    if (!this.shadowRoot || !this._event) return;

    // Bind toggle files
    const toggleFilesBtn = this.shadowRoot.querySelector('[data-action="toggle_files"]') as HTMLButtonElement | null;
    if (toggleFilesBtn) {
      toggleFilesBtn.addEventListener('click', () => {
        this._filesExpanded = !this._filesExpanded;
        this.render();
      });
    }

    // Bind continue action
    const continueBtn = this.shadowRoot.querySelector('[data-action="continue"]') as HTMLButtonElement | null;
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('enhance-action', {
          detail: {
            action: 'continue',
            eventId: this._event?.event_id
          },
          bubbles: true,
          composed: true
        }));
      });
    }

    // Bind change focus action
    const changeFocusBtn = this.shadowRoot.querySelector('[data-action="change_focus"]') as HTMLButtonElement | null;
    if (changeFocusBtn) {
      changeFocusBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('enhance-action', {
          detail: {
            action: 'change_focus',
            eventId: this._event?.event_id
          },
          bubbles: true,
          composed: true
        }));
      });
    }

    // Bind cancel action
    const cancelBtn = this.shadowRoot.querySelector('[data-action="cancel"]') as HTMLButtonElement | null;
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('enhance-action', {
          detail: {
            action: 'cancel',
            eventId: this._event?.event_id
          },
          bubbles: true,
          composed: true
        }));
      });
    }
  }

  private styles(): string {
    return `
      <style>
        :host { display: block; }
        
        .enhance-card {
          padding: 16px;
          border-radius: 8px;
          margin: 12px 0;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-left: 4px solid #4fc3f7;
        }
        
        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        
        .icon {
          font-size: 20px;
          line-height: 1;
        }
        
        .header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          flex: 1;
          color: var(--vscode-foreground);
        }
        
        .badge {
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
          text-transform: uppercase;
        }
        
        .badge.enhance {
          background: #4fc3f7;
          color: #1e1e1e;
        }
        
        .stack-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--vscode-badge-background, #4d4d4d);
          color: var(--vscode-badge-foreground, #ffffff);
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          margin-bottom: 12px;
        }
        
        .stack-icon {
          font-size: 14px;
        }
        
        .info-section {
          margin-bottom: 12px;
        }
        
        .info-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 0;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }
        
        .info-label {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .info-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .info-value {
          color: var(--vscode-foreground);
          font-weight: 500;
        }
        
        .view-link {
          color: var(--vscode-textLink-foreground, #3794ff);
          cursor: pointer;
          background: none;
          border: none;
          font-size: 11px;
          padding: 0;
        }
        
        .view-link:hover {
          text-decoration: underline;
        }
        
        .file-list {
          background: var(--vscode-input-background, #3c3c3c);
          border-radius: 4px;
          padding: 8px;
          margin-top: 8px;
          max-height: 150px;
          overflow-y: auto;
          display: none;
        }
        
        .file-list.expanded {
          display: block;
        }
        
        .file-item {
          font-size: 11px;
          font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
          color: var(--vscode-foreground);
          padding: 2px 0;
        }
        
        .verify-commands {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 4px;
        }
        
        .verify-tag {
          background: rgba(137, 209, 133, 0.15);
          color: #89d185;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
        }
        
        .reassurances {
          background: rgba(75, 139, 190, 0.1);
          border-left: 3px solid #3794ff;
          border-radius: 0 4px 4px 0;
          padding: 10px 12px;
          margin: 12px 0;
        }
        
        .reassurance-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--vscode-foreground);
          padding: 3px 0;
        }
        
        .check-icon {
          color: #89d185;
          font-size: 14px;
        }
        
        .divider {
          height: 1px;
          background: var(--vscode-panel-border, #454545);
          margin: 12px 0;
        }
        
        .button-row {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
        
        .btn {
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }
        
        .btn-primary {
          background: var(--vscode-button-background, #0e639c);
          color: var(--vscode-button-foreground, #ffffff);
        }
        
        .btn-primary:hover {
          background: var(--vscode-button-hoverBackground, #1177bb);
        }
        
        .btn-secondary {
          background: var(--vscode-button-secondaryBackground, #3a3d41);
          color: var(--vscode-button-secondaryForeground, #cccccc);
        }
        
        .btn-secondary:hover {
          background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        
        .btn-text {
          background: transparent;
          color: var(--vscode-textLink-foreground, #3794ff);
          padding: 6px 8px;
        }
        
        .btn-text:hover {
          text-decoration: underline;
        }
      </style>
    `;
  }

  private escapeHtml(text: string): string {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Register custom element
if (!customElements.get('enhance-proposal-card')) {
  customElements.define('enhance-proposal-card', EnhanceProposalCard);
}

/**
 * Check if an event type is an enhance proposal event
 */
export function isEnhanceProposalEvent(eventType: string): boolean {
  return eventType === 'enhance_proposal_ready';
}

declare global {
  interface HTMLElementTagNameMap {
    'enhance-proposal-card': EnhanceProposalCard;
  }
}
