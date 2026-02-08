/**
 * NextStepsCard - Post-Scaffold "What's Next?" Panel (Step 35.6)
 * 
 * Displays actionable suggestions after scaffold completes successfully.
 * Clean UI with buttons that route to appropriate pipelines:
 * - command: routes to Step 34.5 command execution
 * - quick_action: routes to Step 33 QUICK_ACTION with diff proposal
 * - plan: routes to Step 33 PLAN mode with approval-gated diffs
 * 
 * IMPORTANT: This is NOT a chat message dump. It's a focused momentum UX panel.
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
 * Suggestion as received from next_steps_shown event
 */
interface NextStepSuggestion {
  id: string;
  title: string;
  description?: string;
  kind: 'command' | 'quick_action' | 'plan';
  safety: 'safe' | 'prompt' | 'risky';
  icon?: string;
  primary?: boolean;
}

/**
 * Event payload from next_steps_shown
 */
interface NextStepsShownPayload {
  scaffold_id: string;
  recipe_id: string;
  design_pack_id?: string;
  suggestions: NextStepSuggestion[];
}

type NextStepsEvent = {
  event_id?: string;
  type?: string;
  timestamp?: string;
  payload?: NextStepsShownPayload & Record<string, any>;
};

export class NextStepsCard extends HTMLElement {
  private _event: NextStepsEvent | null = null;
  private _dismissed: boolean = false;
  private _loadingStepId: string | null = null;

  set event(value: NextStepsEvent | null) {
    this._event = value;
    this.render();
  }

  get event(): NextStepsEvent | null {
    return this._event;
  }

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this.render();
  }

  /**
   * Set a step as loading (for UI feedback)
   */
  setStepLoading(stepId: string | null): void {
    this._loadingStepId = stepId;
    this.render();
  }

  /**
   * Dismiss the card
   */
  dismiss(reason?: string): void {
    this._dismissed = true;
    this.render();
    
    // Emit dismissed event
    this.dispatchEvent(new CustomEvent('next-step-dismissed', {
      detail: {
        scaffoldId: this._event?.payload?.scaffold_id,
        reason,
      },
      bubbles: true,
      composed: true,
    }));
  }

  private render(): void {
    if (!this.shadowRoot) return;

    // Handle dismissed state
    if (this._dismissed) {
      this.shadowRoot.innerHTML = '';
      return;
    }

    const event = this._event;
    if (!event || event.type !== 'next_steps_shown') {
      this.shadowRoot.innerHTML = `${this.styles()}<div class="next-steps-card empty">No suggestions available</div>`;
      return;
    }

    const payload = event.payload;
    if (!payload || !payload.suggestions || payload.suggestions.length === 0) {
      this.shadowRoot.innerHTML = `${this.styles()}<div class="next-steps-card empty">No suggestions available</div>`;
      return;
    }

    const suggestions = payload.suggestions;
    const recipeId = payload.recipe_id || 'unknown';

    // Separate primary and secondary actions
    const primaryActions = suggestions.filter(s => s.primary || s.id === 'start_dev_server');
    const secondaryActions = suggestions.filter(s => !s.primary && s.id !== 'start_dev_server');
    const quickLinks = secondaryActions.filter(s => s.kind === 'command' && s.safety === 'safe');
    const featureActions = secondaryActions.filter(s => s.kind !== 'command' || s.safety !== 'safe');

    this.shadowRoot.innerHTML = `
      ${this.styles()}
      <div class="next-steps-card">
        <button class="dismiss-btn" data-action="dismiss" title="Dismiss">×</button>
        
        <div class="header">
          <span class="icon">✅</span>
          <h3>Project created. What's next?</h3>
        </div>
        
        <p class="subtitle">Pick one to continue building your ${this.getRecipeName(recipeId)}.</p>
        
        ${primaryActions.length > 0 ? `
          <div class="primary-actions">
            ${primaryActions.map(s => this.renderActionButton(s, true)).join('')}
          </div>
        ` : ''}
        
        ${featureActions.length > 0 ? `
          <div class="feature-actions">
            <div class="section-label">Add Features</div>
            <div class="action-grid">
              ${featureActions.map(s => this.renderActionButton(s, false)).join('')}
            </div>
          </div>
        ` : ''}
        
        ${quickLinks.length > 0 ? `
          <div class="quick-links">
            ${quickLinks.map(s => this.renderQuickLink(s)).join('')}
          </div>
        ` : ''}
      </div>
    `;
    
    this.bindActions();
  }

  private renderActionButton(suggestion: NextStepSuggestion, isPrimary: boolean): string {
    const isLoading = this._loadingStepId === suggestion.id;
    const icon = suggestion.icon || this.getDefaultIcon(suggestion.id);
    const kindBadge = this.getKindBadge(suggestion.kind);
    const safetyHint = suggestion.safety === 'prompt' ? '(approval required)' : '';
    
    return `
      <button 
        class="action-btn ${isPrimary ? 'primary' : 'secondary'} ${isLoading ? 'loading' : ''}"
        data-action="select-step"
        data-step-id="${this.escapeHtml(suggestion.id)}"
        data-step-kind="${this.escapeHtml(suggestion.kind)}"
        ${isLoading ? 'disabled' : ''}
      >
        <span class="btn-icon">${isLoading ? '⏳' : icon}</span>
        <span class="btn-content">
          <span class="btn-title">${this.escapeHtml(suggestion.title)}</span>
          ${suggestion.description ? `<span class="btn-desc">${this.escapeHtml(suggestion.description)}</span>` : ''}
        </span>
        ${kindBadge ? `<span class="kind-badge ${suggestion.kind}">${kindBadge}</span>` : ''}
      </button>
    `;
  }

  private renderQuickLink(suggestion: NextStepSuggestion): string {
    const isLoading = this._loadingStepId === suggestion.id;
    const icon = suggestion.icon || this.getDefaultIcon(suggestion.id);
    
    return `
      <button 
        class="quick-link ${isLoading ? 'loading' : ''}"
        data-action="select-step"
        data-step-id="${this.escapeHtml(suggestion.id)}"
        data-step-kind="${this.escapeHtml(suggestion.kind)}"
        ${isLoading ? 'disabled' : ''}
      >
        <span class="link-icon">${isLoading ? '⏳' : icon}</span>
        <span class="link-text">${this.escapeHtml(suggestion.title)}</span>
      </button>
    `;
  }

  private getDefaultIcon(stepId: string): string {
    const icons: Record<string, string> = {
      'start_dev_server': '🚀',
      'run_lint': '🔍',
      'run_tests': '🧪',
      'run_build': '📦',
      'open_readme': '📖',
      'add_auth': '🔐',
      'add_database': '🗄️',
      'create_page': '📄',
      'add_deploy_config': '☁️',
    };
    return icons[stepId] || '▸';
  }

  private getKindBadge(kind: string): string | null {
    switch (kind) {
      case 'plan':
        return 'Plan';
      case 'quick_action':
        return 'Quick';
      default:
        return null;
    }
  }

  private getRecipeName(recipeId: string): string {
    const names: Record<string, string> = {
      'nextjs_app_router': 'Next.js app',
      'vite_react': 'Vite app',
      'expo': 'Expo app',
    };
    return names[recipeId] || 'project';
  }

  private bindActions(): void {
    if (!this.shadowRoot || !this._event) return;

    // Bind dismiss button
    const dismissBtn = this.shadowRoot.querySelector('[data-action="dismiss"]') as HTMLButtonElement | null;
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        this.dismiss('user_clicked_dismiss');
      });
    }

    // Bind step selection buttons
    const stepBtns = this.shadowRoot.querySelectorAll('[data-action="select-step"]');
    Array.from(stepBtns).forEach((btn: any) => {
      btn.addEventListener('click', () => {
        const stepId = btn.getAttribute('data-step-id');
        const stepKind = btn.getAttribute('data-step-kind');
        
        if (stepId && stepKind) {
          // Find the full suggestion
          const suggestion = this._event?.payload?.suggestions?.find(
            (s: NextStepSuggestion) => s.id === stepId
          );
          
          this.dispatchEvent(new CustomEvent('next-step-selected', {
            detail: {
              scaffoldId: this._event?.payload?.scaffold_id,
              suggestionId: stepId,
              kind: stepKind,
              suggestion,
            },
            bubbles: true,
            composed: true,
          }));
        }
      });
    });
  }

  private styles(): string {
    return `
      <style>
        :host { display: block; }
        
        .next-steps-card {
          position: relative;
          padding: 20px;
          border-radius: 12px;
          margin: 16px 0;
          background: linear-gradient(135deg, 
            var(--vscode-editor-background) 0%, 
            rgba(137, 209, 133, 0.05) 100%
          );
          border: 1px solid rgba(137, 209, 133, 0.3);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .next-steps-card.empty {
          text-align: center;
          color: var(--vscode-descriptionForeground);
          padding: 24px;
        }
        
        .dismiss-btn {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 24px;
          height: 24px;
          border: none;
          background: transparent;
          color: var(--vscode-descriptionForeground);
          font-size: 18px;
          cursor: pointer;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .dismiss-btn:hover {
          background: var(--vscode-toolbar-hoverBackground);
          color: var(--vscode-foreground);
        }
        
        .header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        
        .header .icon {
          font-size: 24px;
          line-height: 1;
        }
        
        .header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        
        .subtitle {
          margin: 0 0 16px 0;
          font-size: 13px;
          color: var(--vscode-descriptionForeground);
        }
        
        .primary-actions {
          margin-bottom: 16px;
        }
        
        .action-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 12px 16px;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: all 0.2s;
          margin-bottom: 8px;
        }
        
        .action-btn.primary {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
        }
        
        .action-btn.primary:hover {
          background: var(--vscode-button-hoverBackground);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        .action-btn.secondary {
          background: var(--vscode-input-background);
          color: var(--vscode-foreground);
          border: 1px solid var(--vscode-panel-border);
        }
        
        .action-btn.secondary:hover {
          background: var(--vscode-list-hoverBackground);
          border-color: var(--vscode-focusBorder);
        }
        
        .action-btn.loading {
          opacity: 0.7;
          cursor: wait;
        }
        
        .action-btn:disabled {
          pointer-events: none;
        }
        
        .btn-icon {
          font-size: 20px;
          flex-shrink: 0;
          width: 28px;
          text-align: center;
        }
        
        .btn-content {
          flex: 1;
          min-width: 0;
        }
        
        .btn-title {
          display: block;
          font-weight: 600;
          font-size: 14px;
        }
        
        .btn-desc {
          display: block;
          font-size: 12px;
          opacity: 0.8;
          margin-top: 2px;
        }
        
        .kind-badge {
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          flex-shrink: 0;
        }
        
        .kind-badge.plan {
          background: rgba(177, 128, 215, 0.2);
          color: #b180d7;
        }
        
        .kind-badge.quick_action {
          background: rgba(55, 148, 255, 0.2);
          color: #3794ff;
        }
        
        .feature-actions {
          margin-bottom: 16px;
        }
        
        .section-label {
          font-size: 11px;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 8px;
          font-weight: 500;
          letter-spacing: 0.5px;
        }
        
        .action-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }
        
        @media (max-width: 400px) {
          .action-grid {
            grid-template-columns: 1fr;
          }
        }
        
        .quick-links {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding-top: 12px;
          border-top: 1px solid var(--vscode-panel-border);
        }
        
        .quick-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 16px;
          border: none;
          background: transparent;
          color: var(--vscode-textLink-foreground);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .quick-link:hover {
          background: var(--vscode-textLink-foreground);
          color: var(--vscode-editor-background);
        }
        
        .quick-link.loading {
          opacity: 0.7;
          cursor: wait;
        }
        
        .link-icon {
          font-size: 14px;
        }
        
        .link-text {
          font-weight: 500;
        }
        
        /* Animation for card appearance */
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .next-steps-card:not(.empty) {
          animation: slideIn 0.3s ease-out;
        }
      </style>
    `;
  }

  private escapeHtml(text: string): string {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Register custom element
if (!customElements.get('next-steps-card')) {
  customElements.define('next-steps-card', NextStepsCard);
}

/**
 * Check if an event is a next steps event
 */
export function isNextStepsEvent(eventType: string): boolean {
  return ['next_steps_shown', 'next_step_selected', 'next_step_dismissed'].includes(eventType);
}

declare global {
  interface HTMLElementTagNameMap {
    'next-steps-card': NextStepsCard;
  }
}
