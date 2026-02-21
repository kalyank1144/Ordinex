/**
 * ScaffoldCard - UI Component for Greenfield Scaffold Flow
 *
 * Minimal custom element with Shadow DOM. Dispatches to render functions
 * defined in scaffoldRenderers/*.ts (concatenated into ScaffoldCard.bundle.js).
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

// Declarations for functions from scaffoldRenderers/*.ts (same IIFE scope after bundling)
declare function escapeHtml(text: string): string;
declare function truncateText(text: string, maxLength: number): string;
declare function truncatePath(path: string, maxLength?: number): string;
declare function formatTimestamp(iso: string): string;
declare function getDesignPackTokens(packId: string, styleOverrides?: any): any;
declare function renderStatusCard(icon: string, title: string, message: string, status: string): string;
declare function scaffoldCardStyles(): string;

// Proposal renderers
declare function renderProposal(event: ScaffoldEvent, payload: Record<string, any>): string;
declare function renderProposalWithActions(event: ScaffoldEvent, payload: Record<string, any>): string;
declare function renderInfluenceBadge(tokensSummary: any): string;
declare function renderVisualPreview(tokens: any, packName: string, compact?: boolean): string;
declare function renderReferenceSection(referenceContext: any, styleSourceMode: string): string;
declare function renderStylePicker(event: ScaffoldEvent, payload: Record<string, any>): string;
declare function renderStyleSelected(payload: Record<string, any>): string;

// Preflight renderers
declare function renderStarted(payload: Record<string, any>): string;
declare function renderPreflightStarted(payload: Record<string, any>): string;
declare function renderPreflightCompleted(payload: Record<string, any>): string;
declare function renderTargetChosen(payload: Record<string, any>): string;
declare function renderBlocked(payload: Record<string, any>): string;

// Execution renderers
declare function renderDecisionResolved(payload: Record<string, any>): string;
declare function renderApplyStarted(payload: Record<string, any>): string;
declare function renderApplied(payload: Record<string, any>): string;
declare function renderCompleted(payload: Record<string, any>): string;
declare function renderCancelled(payload: Record<string, any>): string;

type ScaffoldEvent = {
  event_id?: string;
  type?: string;
  timestamp?: string;
  payload?: Record<string, any>;
};

export class ScaffoldCard extends HTMLElement {
  private _event: ScaffoldEvent | null = null;

  set event(value: ScaffoldEvent | null) {
    this._event = value;
    this.render();
  }

  get event(): ScaffoldEvent | null {
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
      this.shadowRoot.innerHTML = `${scaffoldCardStyles()}<div class="scaffold-card">No event data</div>`;
      return;
    }

    const payload = event.payload || {};
    let body = '';

    switch (event.type) {
      case 'scaffold_started':
        body = renderStarted(payload);
        break;
      case 'scaffold_preflight_started':
        body = renderPreflightStarted(payload);
        break;
      case 'scaffold_preflight_completed':
        body = renderPreflightCompleted(payload);
        break;
      case 'scaffold_target_chosen':
        body = renderTargetChosen(payload);
        break;
      case 'scaffold_proposal_created':
        body = renderProposal(event, payload);
        break;
      case 'scaffold_decision_requested':
        body = renderProposalWithActions(event, payload);
        break;
      case 'scaffold_blocked':
        body = renderBlocked(payload);
        break;
      case 'scaffold_completed':
        body = renderCompleted(payload);
        break;
      case 'scaffold_style_selection_requested':
        body = renderStylePicker(event, payload);
        break;
      case 'scaffold_style_selected':
        body = renderStyleSelected(payload);
        break;
      case 'scaffold_decision_resolved':
        body = renderDecisionResolved(payload);
        break;
      case 'scaffold_apply_started':
        body = renderApplyStarted(payload);
        break;
      case 'scaffold_applied':
        body = renderApplied(payload);
        break;
      case 'scaffold_cancelled':
        body = renderCancelled(payload);
        break;
      // Step 43: Preflight checks events
      case 'scaffold_preflight_checks_started':
        body = renderStatusCard('\u{1F50D}', 'Running Preflight Checks', 'Validating workspace before scaffold...', 'running');
        break;
      case 'scaffold_preflight_checks_completed':
        body = renderStatusCard(
          payload.can_proceed ? '\u2705' : '\u26D4',
          'Preflight Checks Complete',
          payload.can_proceed ? 'All checks passed' : `${payload.blockers_count || 0} blocker(s) found`,
          payload.can_proceed ? 'pass' : 'block'
        );
        break;
      case 'scaffold_preflight_resolution_selected':
        body = renderStatusCard('\u{1F527}', 'Resolution Applied', payload.resolution || 'User resolved preflight issue', 'info');
        break;
      case 'scaffold_quality_gates_passed':
        body = renderStatusCard('\u2705', 'Quality Gates Passed', 'All preflight checks cleared', 'pass');
        break;
      case 'scaffold_quality_gates_failed':
        body = renderStatusCard('\u274C', 'Quality Gates Failed', payload.reason || 'Preflight checks blocked', 'block');
        break;
      case 'scaffold_checkpoint_created':
        body = renderStatusCard('\u{1F4BE}', 'Checkpoint Created', 'Backup saved before scaffold', 'info');
        break;
      case 'scaffold_checkpoint_restored':
        body = renderStatusCard('\u{1F504}', 'Checkpoint Restored', 'Rolled back to pre-scaffold state', 'info');
        break;
      case 'scaffold_apply_completed':
        body = renderStatusCard('\u2705', 'Scaffold Applied', 'Project files created successfully', 'pass');
        break;
      default:
        body = `<div class="scaffold-card">Unknown scaffold event: ${escapeHtml(String(event.type))}</div>`;
        break;
    }

    this.shadowRoot.innerHTML = `${scaffoldCardStyles()}${body}`;
    this.bindActions();
  }

  private bindActions(): void {
    if (!this.shadowRoot || !this._event) return;

    // Bind proceed action
    const proceedBtn = this.shadowRoot.querySelector('[data-action="proceed"]') as HTMLButtonElement | null;
    if (proceedBtn) {
      proceedBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('scaffold-action', {
          detail: {
            action: 'proceed',
            scaffoldId: this._event?.payload?.scaffold_id,
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
        this.dispatchEvent(new CustomEvent('scaffold-action', {
          detail: {
            action: 'cancel',
            scaffoldId: this._event?.payload?.scaffold_id,
            eventId: this._event?.event_id
          },
          bubbles: true,
          composed: true
        }));
      });
    }

    // Bind change style action
    const changeStyleBtn = this.shadowRoot.querySelector('[data-action="change_style"]') as HTMLButtonElement | null;
    if (changeStyleBtn) {
      changeStyleBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('scaffold-action', {
          detail: {
            action: 'change_style',
            scaffoldId: this._event?.payload?.scaffold_id,
            eventId: this._event?.event_id,
            currentPackId: this._event?.payload?.design_pack_id
          },
          bubbles: true,
          composed: true
        }));
      });
    }

    // Bind style source picker actions
    const styleSourceBtns = this.shadowRoot.querySelectorAll('[data-action="style_source"]');
    styleSourceBtns.forEach((btn: any) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        this.dispatchEvent(new CustomEvent('scaffold-action', {
          detail: {
            action: 'change_style_source',
            scaffoldId: this._event?.payload?.scaffold_id,
            eventId: this._event?.event_id,
            styleSourceMode: mode
          },
          bubbles: true,
          composed: true
        }));
      });
    });

    // Bind vibe quick-button actions (Style Intent UI)
    const vibeBtns = this.shadowRoot.querySelectorAll('[data-action="set_style_intent"]');
    vibeBtns.forEach((btn: any) => {
      btn.addEventListener('click', () => {
        vibeBtns.forEach((b: any) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-mode');
        const value = btn.getAttribute('data-value');
        this.dispatchEvent(new CustomEvent('scaffold-action', {
          detail: {
            action: 'set_style_intent',
            scaffoldId: this._event?.payload?.scaffold_id,
            eventId: this._event?.event_id,
            styleInput: { mode, value }
          },
          bubbles: true,
          composed: true
        }));
      });
    });

    // Bind NL style input (submit on Enter)
    const nlInput = this.shadowRoot.querySelector('.style-intent-nl-input') as HTMLInputElement | null;
    if (nlInput) {
      nlInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && nlInput.value.trim()) {
          this.dispatchEvent(new CustomEvent('scaffold-action', {
            detail: {
              action: 'set_style_intent',
              scaffoldId: this._event?.payload?.scaffold_id,
              eventId: this._event?.event_id,
              styleInput: { mode: 'nl', value: nlInput.value.trim() }
            },
            bubbles: true,
            composed: true
          }));
        }
      });
    }

    // Bind hex color input (submit on Enter or valid 7-char hex)
    const hexInput = this.shadowRoot.querySelector('.style-intent-hex-input') as HTMLInputElement | null;
    if (hexInput) {
      hexInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && /^#[0-9a-fA-F]{6}$/.test(hexInput.value)) {
          this.dispatchEvent(new CustomEvent('scaffold-action', {
            detail: {
              action: 'set_style_intent',
              scaffoldId: this._event?.payload?.scaffold_id,
              eventId: this._event?.event_id,
              styleInput: { mode: 'hex', value: hexInput.value }
            },
            bubbles: true,
            composed: true
          }));
        }
      });
    }

    // Bind cancel picker (back button)
    const cancelPickerBtn = this.shadowRoot.querySelector('[data-action="cancel_picker"]') as HTMLButtonElement | null;
    if (cancelPickerBtn) {
      cancelPickerBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('scaffold-action', {
          detail: {
            action: 'cancel_style_change',
            scaffoldId: this._event?.payload?.scaffold_id,
            eventId: this._event?.event_id
          },
          bubbles: true,
          composed: true
        }));
      });
    }
  }
}

if (!customElements.get('scaffold-card')) {
  customElements.define('scaffold-card', ScaffoldCard);
}

/**
 * Check if an event type is a scaffold event that ScaffoldCard handles.
 * S1/S2 events (scaffold_progress, design_pack_applied, next_steps_shown,
 * scaffold_final_complete, feature_* events, verify/autofix events) are
 * handled by ScaffoldProgressCard and ScaffoldCompleteCard respectively.
 */
export function isScaffoldEvent(eventType: string): boolean {
  // NOTE: Build-phase events (scaffold_apply_started, scaffold_applied,
  // scaffold_apply_completed, scaffold_progress, scaffold_doctor_card,
  // design_pack_applied, feature_*, scaffold_verify_*, scaffold_autofix_*,
  // scaffold_checkpoint_created) are handled by ScaffoldProgressCard — not here.
  return [
    'scaffold_started',
    'scaffold_preflight_started',
    'scaffold_preflight_completed',
    'scaffold_target_chosen',
    'scaffold_proposal_created',
    'scaffold_decision_requested',
    'scaffold_decision_resolved',
    'scaffold_blocked',
    'scaffold_completed',
    'scaffold_cancelled',
    'scaffold_style_selection_requested',
    'scaffold_style_selected',
    // Step 43: Preflight checks events
    'scaffold_preflight_checks_started',
    'scaffold_preflight_checks_completed',
    'scaffold_preflight_resolution_selected',
    'scaffold_quality_gates_passed',
    'scaffold_quality_gates_failed',
    'scaffold_checkpoint_restored',
  ].includes(eventType);
}

declare global {
  interface HTMLElementTagNameMap {
    'scaffold-card': ScaffoldCard;
  }
}
