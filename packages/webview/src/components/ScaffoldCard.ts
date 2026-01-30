/**
 * ScaffoldCard - UI Component for Greenfield Scaffold Flow (Step 35.1 + 35.2)
 *
 * Minimal custom element implementation without external deps.
 * 
 * Renders scaffold events as clean, actionable cards:
 * - scaffold_started: Shows "Creating new project" state
 * - scaffold_preflight_started: Shows preflight check starting
 * - scaffold_preflight_completed: Shows preflight results with target directory
 * - scaffold_target_chosen: Shows selected target directory
 * - scaffold_proposal_created: Shows proposal with recipe/design placeholders
 * - scaffold_blocked: Shows safety block with options
 * - scaffold_completed: Shows completion status
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
      this.shadowRoot.innerHTML = `${this.styles()}<div class="scaffold-card">No event data</div>`;
      return;
    }

    const payload = event.payload || {};
    let body = '';

    switch (event.type) {
      case 'scaffold_started':
        body = this.renderStarted(payload);
        break;
      case 'scaffold_preflight_started':
        body = this.renderPreflightStarted(payload);
        break;
      case 'scaffold_preflight_completed':
        body = this.renderPreflightCompleted(payload);
        break;
      case 'scaffold_target_chosen':
        body = this.renderTargetChosen(payload);
        break;
      case 'scaffold_proposal_created':
        body = this.renderProposal(event, payload);
        break;
      case 'scaffold_blocked':
        body = this.renderBlocked(payload);
        break;
      case 'scaffold_completed':
        body = this.renderCompleted(payload);
        break;
      default:
        body = `<div class="scaffold-card">Unknown scaffold event: ${this.escapeHtml(String(event.type))}</div>`;
        break;
    }

    this.shadowRoot.innerHTML = `${this.styles()}${body}`;
    this.bindActions();
  }

  private renderStarted(payload: Record<string, any>): string {
    const userPrompt = payload.user_prompt || '';
    const targetDir = payload.target_directory;
    const createdAt = payload.created_at_iso || '';

    return `
      <div class="scaffold-card starting">
        <div class="header">
          <span class="icon">🏗️</span>
          <h3>Create New Project</h3>
          <span class="badge starting">Starting</span>
        </div>
        <div class="prompt-section">
          <div class="prompt-label">Your Request</div>
          <div class="prompt-text">${this.escapeHtml(this.truncateText(userPrompt, 150))}</div>
        </div>
        ${targetDir ? `
          <div class="detail-row">
            <span class="detail-label">Target Directory:</span>
            <span class="detail-value">${this.escapeHtml(String(targetDir))}</span>
          </div>
        ` : ''}
        <div class="timestamp">Started: ${this.formatTimestamp(createdAt)}</div>
      </div>
    `;
  }

  private renderProposal(event: ScaffoldEvent, payload: Record<string, any>): string {
    const summary = payload.summary || 'Project scaffold proposal';
    const recipe = payload.recipe || 'TBD';
    const designPack = payload.design_pack || payload.design_pack_name || 'TBD';
    const designPackId = payload.design_pack_id || '';
    const previewAssetId = payload.preview_asset_id || '';
    const tokensSummary = payload.design_tokens_summary || '';
    const filesCount = payload.files_count || 0;
    const dirsCount = payload.directories_count || 0;
    
    // Step 37: Reference-based enhancements
    const referenceContext = payload.reference_context || null;
    const styleSourceMode = payload.style_source_mode || 'combine_with_design_pack';
    const hasReferences = referenceContext && 
      ((referenceContext.images || []).length > 0 || (referenceContext.urls || []).length > 0);

    const isTBD = (val: string | number) => !val || val === 'TBD' || val === 0;
    const hasDesignPack = !isTBD(designPack) && designPackId;

    return `
      <div class="scaffold-card proposal">
        <div class="header">
          <span class="icon">📋</span>
          <h3>Scaffold Proposal</h3>
          <span class="badge proposal">Review</span>
        </div>
        <div class="summary-section">
          <div class="prompt-label">Summary</div>
          <div class="summary-text">${this.escapeHtml(String(summary))}</div>
        </div>
        
        ${hasReferences ? this.renderReferenceSection(referenceContext, styleSourceMode) : ''}
        
        ${hasDesignPack ? `
          <div class="design-pack-preview">
            <div class="preview-header">
              <span class="preview-label">Design Style</span>
              <button class="change-style-btn" data-action="change_style">
                🎨 Change Style
              </button>
            </div>
            <div class="preview-content">
              <div class="preview-image-container">
                <div class="preview-placeholder" data-pack-id="${this.escapeHtml(designPackId)}">
                  <span class="pack-initial">${this.escapeHtml(designPack.charAt(0).toUpperCase())}</span>
                </div>
              </div>
              <div class="preview-details">
                <div class="pack-name">${this.escapeHtml(String(designPack))}</div>
                ${tokensSummary ? `<div class="tokens-summary">${this.escapeHtml(tokensSummary)}</div>` : ''}
              </div>
            </div>
          </div>
        ` : ''}
        
        <div class="proposal-grid">
          <div class="detail-item">
            <div class="detail-label">Recipe</div>
            <div class="detail-value ${isTBD(recipe) ? 'tbd' : ''}">${this.escapeHtml(String(recipe))}</div>
          </div>
          ${!hasDesignPack ? `
            <div class="detail-item">
              <div class="detail-label">Design Pack</div>
              <div class="detail-value tbd">TBD</div>
            </div>
          ` : ''}
          <div class="detail-item">
            <div class="detail-label">Files to Create</div>
            <div class="detail-value ${filesCount === 0 ? 'tbd' : ''}">${filesCount > 0 ? filesCount : 'TBD'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Directories</div>
            <div class="detail-value ${dirsCount === 0 ? 'tbd' : ''}">${dirsCount > 0 ? dirsCount : 'TBD'}</div>
          </div>
        </div>
        ${!hasDesignPack ? `
          <div class="placeholder-notice">
            📌 Recipe and design pack selection coming in Step 35.5
          </div>
        ` : ''}
        <div class="timestamp">${this.formatTimestamp(event.timestamp || '')}</div>
      </div>
    `;
  }

  private renderCompleted(payload: Record<string, any>): string {
    const status = payload.status || 'cancelled';
    const reason = payload.reason || '';
    const isReady = status === 'ready_for_step_35_2';

    return `
      <div class="scaffold-card ${isReady ? 'ready' : 'cancelled'}">
        <div class="header">
          <span class="icon">${isReady ? '✅' : '⏸️'}</span>
          <h3>Scaffold ${isReady ? 'Ready' : 'Cancelled'}</h3>
          <span class="badge ${isReady ? 'ready' : 'cancelled'}">${isReady ? 'Ready' : 'Cancelled'}</span>
        </div>
        <div class="completion-section ${isReady ? 'ready' : 'cancelled'}">
          <span class="completion-icon">${isReady ? '🚀' : '🔙'}</span>
          <span class="completion-text">
            ${isReady 
              ? 'Scaffold approved! Ready for file creation in Step 35.2.' 
              : this.escapeHtml(reason || 'Scaffold was cancelled')}
          </span>
        </div>
      </div>
    `;
  }

  // ========== STEP 35.2: Preflight Render Methods ==========

  private renderPreflightStarted(payload: Record<string, any>): string {
    const workspaceRoot = payload.workspace_root || '';
    const createdAt = payload.created_at_iso || '';

    return `
      <div class="scaffold-card preflight">
        <div class="header">
          <span class="icon">🔍</span>
          <h3>Safety Preflight</h3>
          <span class="badge preflight">Checking</span>
        </div>
        <div class="preflight-status">
          <div class="status-item">
            <span class="status-icon">⏳</span>
            <span class="status-text">Checking workspace safety...</span>
          </div>
        </div>
        ${workspaceRoot ? `
          <div class="detail-row">
            <span class="detail-label">Workspace:</span>
            <span class="detail-value mono">${this.escapeHtml(this.truncatePath(workspaceRoot))}</span>
          </div>
        ` : ''}
        <div class="timestamp">Started: ${this.formatTimestamp(createdAt)}</div>
      </div>
    `;
  }

  private renderPreflightCompleted(payload: Record<string, any>): string {
    const targetDir = payload.target_directory || '';
    const isEmpty = payload.is_empty_dir;
    const hasPackageJson = payload.has_package_json;
    const isMonorepo = payload.detected_monorepo;
    const monorepoType = payload.monorepo_type;
    const conflicts = payload.conflicts || [];

    const hasConflicts = conflicts.length > 0;
    const statusClass = hasConflicts ? 'warning' : 'safe';
    const statusLabel = hasConflicts ? 'Needs Attention' : 'Safe';

    return `
      <div class="scaffold-card preflight-complete ${statusClass}">
        <div class="header">
          <span class="icon">${hasConflicts ? '⚠️' : '✅'}</span>
          <h3>Preflight Complete</h3>
          <span class="badge ${statusClass}">${statusLabel}</span>
        </div>
        
        <div class="preflight-results">
          <div class="result-item">
            <span class="result-label">Target Directory</span>
            <span class="result-value mono">${this.escapeHtml(this.truncatePath(targetDir))}</span>
          </div>
          <div class="result-item">
            <span class="result-label">Directory Status</span>
            <span class="result-value ${isEmpty ? 'safe' : 'warning'}">
              ${isEmpty ? '✓ Empty (safe)' : hasPackageJson ? '⚠️ Has package.json' : '⚠️ Not empty'}
            </span>
          </div>
          ${isMonorepo ? `
            <div class="result-item">
              <span class="result-label">Monorepo Detected</span>
              <span class="result-value">${monorepoType ? this.escapeHtml(monorepoType) : 'Yes'}</span>
            </div>
          ` : ''}
        </div>
        
        ${hasConflicts ? `
          <div class="conflicts-section">
            <div class="conflicts-header">⚠️ Conflicts Detected</div>
            ${conflicts.map((c: any) => `
              <div class="conflict-item">
                <span class="conflict-type">${this.escapeHtml(c.type)}</span>
                <span class="conflict-message">${this.escapeHtml(c.message)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderTargetChosen(payload: Record<string, any>): string {
    const targetDir = payload.target_directory || '';
    const reason = payload.reason || 'default';
    const appName = payload.app_name || '';

    const reasonLabels: Record<string, string> = {
      'default': 'Default location',
      'monorepo_choice': 'Monorepo convention',
      'user_selected': 'User selected',
      'workspace_root': 'Workspace root'
    };

    return `
      <div class="scaffold-card target-chosen">
        <div class="header">
          <span class="icon">📍</span>
          <h3>Target Selected</h3>
          <span class="badge target">${appName || 'Project'}</span>
        </div>
        <div class="target-info">
          <div class="target-path">
            <span class="path-label">Creating project at:</span>
            <span class="path-value mono">${this.escapeHtml(targetDir)}</span>
          </div>
          <div class="target-reason">
            <span class="reason-badge">${this.escapeHtml(reasonLabels[reason] || reason)}</span>
          </div>
        </div>
      </div>
    `;
  }

  // ========== STEP 37: Reference-Based Enhancement Methods ==========

  private renderReferenceSection(referenceContext: any, styleSourceMode: string): string {
    const images = referenceContext?.images || [];
    const urls = referenceContext?.urls || [];
    const intent = referenceContext?.intent || 'unknown';

    const intentLabels: Record<string, string> = {
      visual_style: 'Visual Style',
      layout: 'Layout Reference',
      branding: 'Branding',
      unknown: 'Design Reference'
    };

    const modeLabels: Record<string, string> = {
      use_reference: 'Use Reference Only',
      ignore_reference: 'Ignore Reference',
      combine_with_design_pack: 'Combine with Design Pack'
    };

    return `
      <div class="reference-section">
        <div class="reference-header">
          <span class="reference-icon">📎</span>
          <span class="reference-label">Design References</span>
          <span class="reference-badge">${this.escapeHtml(intentLabels[intent] || 'Reference')}</span>
        </div>
        
        ${images.length > 0 ? `
          <div class="thumbnail-strip">
            ${images.map((img: any) => `
              <div class="thumbnail" title="${this.escapeHtml(img.path || img.id)}">
                <div class="thumbnail-placeholder">
                  <span class="thumbnail-icon">🖼️</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        ${urls.length > 0 ? `
          <div class="url-list">
            ${urls.map((urlRef: any) => {
              const url = urlRef.url || '';
              let domain = '';
              try {
                domain = new URL(url).hostname;
              } catch {
                domain = url.substring(0, 30);
              }
              return `
                <div class="url-item" title="${this.escapeHtml(url)}">
                  <span class="url-favicon">🔗</span>
                  <span class="url-domain">${this.escapeHtml(domain)}</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
        
        <div class="reference-notice">
          <span class="notice-icon">✨</span>
          <span class="notice-text">Design will be influenced by provided references</span>
        </div>
        
        <div class="style-source-picker">
          <span class="picker-label">Style Source:</span>
          <button class="style-option ${styleSourceMode === 'use_reference' ? 'active' : ''}" 
                  data-action="style_source" data-mode="use_reference">
            Reference
          </button>
          <button class="style-option ${styleSourceMode === 'ignore_reference' ? 'active' : ''}" 
                  data-action="style_source" data-mode="ignore_reference">
            Ignore
          </button>
          <button class="style-option ${styleSourceMode === 'combine_with_design_pack' ? 'active' : ''}" 
                  data-action="style_source" data-mode="combine_with_design_pack">
            Combined
          </button>
        </div>
      </div>
    `;
  }

  private renderBlocked(payload: Record<string, any>): string {
    const targetDir = payload.target_directory || '';
    const reason = payload.reason || 'unknown';
    const message = payload.message || 'Scaffold was blocked';

    const reasonIcons: Record<string, string> = {
      'non_empty_dir': '📁',
      'monorepo_ambiguous': '🔀',
      'user_cancelled': '🚫'
    };

    const reasonLabels: Record<string, string> = {
      'non_empty_dir': 'Directory Not Empty',
      'monorepo_ambiguous': 'Monorepo Ambiguous',
      'user_cancelled': 'User Cancelled'
    };

    return `
      <div class="scaffold-card blocked">
        <div class="header">
          <span class="icon">${reasonIcons[reason] || '⛔'}</span>
          <h3>Scaffold Blocked</h3>
          <span class="badge blocked">${reasonLabels[reason] || 'Blocked'}</span>
        </div>
        <div class="block-info">
          <div class="block-message">${this.escapeHtml(message)}</div>
          ${targetDir ? `
            <div class="detail-row">
              <span class="detail-label">Target:</span>
              <span class="detail-value mono">${this.escapeHtml(this.truncatePath(targetDir))}</span>
            </div>
          ` : ''}
        </div>
        <div class="block-help">
          Choose a different location or cancel the scaffold operation.
        </div>
      </div>
    `;
  }

  private truncatePath(path: string, maxLength: number = 50): string {
    if (!path) return '';
    if (path.length <= maxLength) return path;
    // Show last part of path
    const parts = path.split('/');
    let result = parts[parts.length - 1];
    for (let i = parts.length - 2; i >= 0; i--) {
      const candidate = parts[i] + '/' + result;
      if (candidate.length > maxLength - 3) {
        return '...' + '/' + result;
      }
      result = candidate;
    }
    return result;
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

    // Bind change style action (Step 35.5)
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

    // Step 37: Bind style source picker actions
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
  }

  private styles(): string {
    return `
      <style>
        :host { display: block; }
        .scaffold-card {
          padding: 16px;
          border-radius: 8px;
          margin: 12px 0;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
        }
        .scaffold-card.starting { border-left: 4px solid #3794ff; }
        .scaffold-card.proposal { border-left: 4px solid #b180d7; }
        .scaffold-card.ready { border-left: 4px solid #89d185; }
        .scaffold-card.cancelled { border-left: 4px solid #cca700; }
        
        .header { 
          display: flex; 
          align-items: center; 
          gap: 8px; 
          margin-bottom: 12px; 
        }
        .icon { font-size: 20px; line-height: 1; }
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
        .badge.starting { background: #3794ff; color: white; }
        .badge.proposal { background: #b180d7; color: white; }
        .badge.ready { background: #89d185; color: #1e1e1e; }
        .badge.cancelled { background: #cca700; color: #1e1e1e; }
        
        .prompt-section, .summary-section { margin-bottom: 16px; }
        .prompt-label { 
          font-size: 11px; 
          text-transform: uppercase; 
          color: var(--vscode-descriptionForeground); 
          margin-bottom: 4px; 
        }
        .prompt-text { 
          color: var(--vscode-foreground); 
          font-style: italic; 
          padding: 8px 12px; 
          background: var(--vscode-textBlockQuote-background, #2a2a2a); 
          border-left: 3px solid #3794ff; 
          border-radius: 0 4px 4px 0; 
        }
        .summary-text { 
          color: var(--vscode-foreground); 
          line-height: 1.5; 
        }
        
        .proposal-grid { 
          display: grid; 
          grid-template-columns: repeat(2, 1fr); 
          gap: 12px; 
          margin-bottom: 16px; 
        }
        .detail-item { 
          background: var(--vscode-input-background); 
          padding: 8px 12px; 
          border-radius: 4px; 
        }
        .detail-label { 
          font-size: 11px; 
          text-transform: uppercase; 
          color: var(--vscode-descriptionForeground); 
          margin-bottom: 2px; 
        }
        .detail-value { 
          color: var(--vscode-foreground); 
          font-weight: 500; 
        }
        .detail-value.tbd { 
          color: var(--vscode-descriptionForeground); 
          font-style: italic; 
        }
        
        .detail-row {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .detail-row .detail-label { 
          color: var(--vscode-descriptionForeground); 
          text-transform: none;
        }
        .detail-row .detail-value { 
          color: var(--vscode-foreground); 
        }
        
        .completion-section { 
          display: flex; 
          align-items: center; 
          gap: 8px; 
          padding: 12px; 
          border-radius: 4px; 
          margin-top: 12px; 
        }
        .completion-section.ready { 
          background: rgba(137, 209, 133, 0.1); 
          border: 1px solid #89d185; 
        }
        .completion-section.cancelled { 
          background: rgba(204, 167, 0, 0.1); 
          border: 1px solid #cca700; 
        }
        .completion-icon { font-size: 16px; }
        .completion-text { color: var(--vscode-foreground); }
        
        .placeholder-notice { 
          font-size: 11px; 
          color: var(--vscode-descriptionForeground); 
          font-style: italic; 
          padding: 8px; 
          background: rgba(255, 255, 255, 0.02); 
          border-radius: 4px; 
          margin-bottom: 12px;
        }
        
        .timestamp { 
          font-size: 11px; 
          color: var(--vscode-descriptionForeground); 
          text-align: right; 
        }
        
        .actions { 
          display: flex; 
          gap: 8px; 
          margin-top: 12px; 
          flex-wrap: wrap; 
        }
        button { 
          padding: 6px 12px; 
          border-radius: 4px; 
          font-size: 13px; 
          font-weight: 500; 
          cursor: pointer; 
          border: none; 
          transition: all 0.2s; 
        }
        .btn-primary { 
          background: var(--vscode-button-background); 
          color: var(--vscode-button-foreground); 
        }
        .btn-primary:hover { 
          background: var(--vscode-button-hoverBackground); 
        }
        .btn-secondary { 
          background: var(--vscode-button-secondaryBackground); 
          color: var(--vscode-button-secondaryForeground); 
        }
        .btn-secondary:hover { 
          background: var(--vscode-button-secondaryHoverBackground); 
        }
        
        /* Step 35.5: Design Pack Preview Styles */
        .design-pack-preview {
          margin: 16px 0;
          padding: 12px;
          background: var(--vscode-input-background);
          border-radius: 8px;
          border: 1px solid var(--vscode-panel-border);
        }
        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .preview-label {
          font-size: 11px;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
          font-weight: 500;
        }
        .change-style-btn {
          padding: 4px 10px;
          font-size: 12px;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .change-style-btn:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }
        .preview-content {
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .preview-image-container {
          flex-shrink: 0;
        }
        .preview-placeholder {
          width: 64px;
          height: 48px;
          background: linear-gradient(135deg, #b180d7 0%, #3794ff 100%);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        .pack-initial {
          font-size: 24px;
          font-weight: 700;
          color: white;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }
        .preview-details {
          flex: 1;
          min-width: 0;
        }
        .pack-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--vscode-foreground);
          margin-bottom: 4px;
        }
        .tokens-summary {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-editor-font-family), monospace;
        }
        
        /* Step 37: Reference Section Styles */
        .reference-section {
          margin: 16px 0;
          padding: 12px;
          background: var(--vscode-input-background);
          border-radius: 8px;
          border: 1px solid var(--vscode-panel-border);
          border-left: 3px solid #e879f9;
        }
        .reference-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .reference-icon {
          font-size: 16px;
        }
        .reference-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--vscode-foreground);
          flex: 1;
        }
        .reference-badge {
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 500;
          background: rgba(232, 121, 249, 0.2);
          color: #e879f9;
          text-transform: uppercase;
        }
        .thumbnail-strip {
          display: flex;
          gap: 8px;
          padding: 8px 0;
          overflow-x: auto;
          margin-bottom: 8px;
        }
        .thumbnail {
          flex-shrink: 0;
          cursor: pointer;
        }
        .thumbnail-placeholder {
          width: 48px;
          height: 48px;
          border-radius: 4px;
          background: rgba(232, 121, 249, 0.15);
          border: 1px solid rgba(232, 121, 249, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .thumbnail-icon {
          font-size: 20px;
        }
        .url-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .url-item {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          font-size: 11px;
        }
        .url-favicon {
          font-size: 12px;
        }
        .url-domain {
          color: var(--vscode-textLink-foreground);
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .reference-notice {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px;
          background: rgba(232, 121, 249, 0.1);
          border-radius: 4px;
          margin: 8px 0;
        }
        .notice-icon {
          font-size: 14px;
        }
        .notice-text {
          font-size: 11px;
          color: var(--vscode-foreground);
          font-style: italic;
        }
        .style-source-picker {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
        }
        .picker-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-right: 4px;
        }
        .style-option {
          padding: 4px 10px;
          font-size: 11px;
          border-radius: 4px;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: 1px solid transparent;
          cursor: pointer;
          transition: all 0.2s;
        }
        .style-option:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }
        .style-option.active {
          background: rgba(232, 121, 249, 0.2);
          border-color: #e879f9;
          color: #e879f9;
        }
      </style>
    `;
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  private formatTimestamp(iso: string): string {
    if (!iso) return '';
    try {
      const date = new Date(iso);
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return iso;
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

if (!customElements.get('scaffold-card')) {
  customElements.define('scaffold-card', ScaffoldCard);
}

/**
 * Check if an event type is a scaffold event
 */
export function isScaffoldEvent(eventType: string): boolean {
  return [
    'scaffold_started',
    'scaffold_preflight_started',
    'scaffold_preflight_completed',
    'scaffold_target_chosen',
    'scaffold_proposal_created',
    'scaffold_applied',
    'scaffold_blocked',
    'scaffold_completed'
  ].includes(eventType);
}

declare global {
  interface HTMLElementTagNameMap {
    'scaffold-card': ScaffoldCard;
  }
}
