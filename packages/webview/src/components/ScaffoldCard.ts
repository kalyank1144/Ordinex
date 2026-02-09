/**
 * ScaffoldCard - UI Component for Greenfield Scaffold Flow (Step 35.1 + 35.2 + 39)
 *
 * Minimal custom element implementation without external deps.
 * 
 * Renders scaffold events as clean, actionable cards:
 * - scaffold_started: Shows "Creating new project" state
 * - scaffold_preflight_started: Shows preflight check starting
 * - scaffold_preflight_completed: Shows preflight results with target directory
 * - scaffold_target_chosen: Shows selected target directory
 * - scaffold_proposal_created: Shows proposal with recipe/design + VISUAL PREVIEW (Step 39)
 * - scaffold_blocked: Shows safety block with options
 * - scaffold_completed: Shows completion status
 * 
 * Step 39 Enhancements:
 * - Real rendered visual preview (hero, components, typography)
 * - Mini previews in style picker gallery
 * - Reference influence badge when tokens present
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
      case 'scaffold_decision_requested':
        body = this.renderProposalWithActions(event, payload);
        break;
      case 'scaffold_blocked':
        body = this.renderBlocked(payload);
        break;
      case 'scaffold_completed':
        body = this.renderCompleted(payload);
        break;
      case 'scaffold_style_selection_requested':
        body = this.renderStylePicker(event, payload);
        break;
      case 'scaffold_style_selected':
        body = this.renderStyleSelected(payload);
        break;
      case 'scaffold_decision_resolved':
        body = this.renderDecisionResolved(payload);
        break;
      case 'scaffold_apply_started':
        body = this.renderApplyStarted(payload);
        break;
      case 'scaffold_applied':
        body = this.renderApplied(payload);
        break;
      case 'scaffold_cancelled':
        body = this.renderCancelled(payload);
        break;
      // Post-scaffold orchestration events
      case 'scaffold_progress':
        body = this.renderProgress(payload);
        break;
      case 'design_pack_applied':
        body = this.renderDesignPackApplied(payload);
        break;
      case 'next_steps_shown':
        body = this.renderNextStepsShown(payload);
        break;
      case 'scaffold_final_complete':
        body = this.renderFinalComplete(payload);
        break;
      // Feature Intelligence events (LLM-powered feature generation)
      case 'feature_extraction_started':
        body = this.renderStatusCard('\u{1F9E0}', 'Extracting Features', `Analyzing prompt for ${this.escapeHtml(String(payload.recipe_id || ''))} features...`, 'running');
        break;
      case 'feature_extraction_completed':
        body = this.renderStatusCard('\u2705', 'Features Extracted', `Detected ${this.escapeHtml(String(payload.app_type || 'app'))}: ${payload.features_count || 0} features, ${payload.pages_count || 0} pages`, 'pass');
        break;
      case 'feature_code_generating':
        body = this.renderStatusCard('\u{1F528}', 'Generating Code', this.escapeHtml(String(payload.message || 'Generating feature components...')), 'running');
        break;
      case 'feature_code_applied':
        body = this.renderFeatureCodeApplied(payload);
        break;
      case 'feature_code_error':
        body = this.renderStatusCard('\u26A0\uFE0F', 'Feature Generation Skipped', this.escapeHtml(String(payload.error || 'Falling back to generic scaffold')), 'warn');
        break;
      // Process events are now handled by ProcessCard (W2)
      // Auto-fix events
      case 'scaffold_autofix_started':
        body = this.renderStatusCard('🔧', 'Auto-Fixing Errors',
          `Analyzing ${payload.error_count || 0} error(s) and generating fixes...`, 'running');
        break;
      case 'scaffold_autofix_applied':
        body = this.renderStatusCard('✅', 'Auto-Fix Applied',
          `Fixed ${payload.files_fixed || 0} file(s). Re-running verification...`, 'pass');
        break;
      case 'scaffold_autofix_failed':
        body = this.renderStatusCard('⚠️', 'Auto-Fix Failed',
          this.escapeHtml(String(payload.error || 'Could not automatically fix errors')), 'warn');
        break;
      // Streaming verification events
      case 'scaffold_verify_started':
        body = this.renderStatusCard('🔍', 'Verifying Project',
          `Running post-scaffold verification (${this.escapeHtml(String(payload.recipe_id || ''))})...`, 'running');
        break;
      case 'scaffold_verify_step_completed': {
        const stepStatus = String(payload.step_status || 'pass');
        const stepIcon = stepStatus === 'pass' ? '✅' : stepStatus === 'warn' ? '⚠️' : stepStatus === 'fail' ? '❌' : '⏭️';
        body = this.renderStatusCard(stepIcon, `Verify: ${this.escapeHtml(String(payload.step_name || ''))}`,
          this.escapeHtml(String(payload.message || '')), stepStatus === 'fail' ? 'fail' : stepStatus === 'warn' ? 'warn' : 'pass');
        break;
      }
      case 'scaffold_verify_completed': {
        const vOutcome = String(payload.outcome || 'pass');
        const vIcon = vOutcome === 'pass' ? '✅' : vOutcome === 'partial' ? '⚠️' : '❌';
        const vTitle = vOutcome === 'pass' ? 'Verification Passed' : vOutcome === 'partial' ? 'Verification: Warnings' : 'Verification Failed';
        const totalSteps = payload.total_steps || 0;
        const durationSec = Math.round((payload.duration_ms || 0) / 1000);
        const passCount = payload.pass_count || 0;
        const failCount = payload.fail_count || 0;
        body = this.renderStatusCard(vIcon, vTitle,
          `${totalSteps} checks completed in ${durationSec}s (${passCount} passed, ${failCount} failed)`,
          vOutcome === 'fail' ? 'fail' : vOutcome === 'partial' ? 'warn' : 'pass');
        break;
      }
      // Step 43: Preflight checks events
      case 'scaffold_preflight_checks_started':
        body = this.renderStatusCard('\u{1F50D}', 'Running Preflight Checks', 'Validating workspace before scaffold...', 'running');
        break;
      case 'scaffold_preflight_checks_completed':
        body = this.renderStatusCard(
          payload.can_proceed ? '\u2705' : '\u26D4',
          'Preflight Checks Complete',
          payload.can_proceed ? 'All checks passed' : `${payload.blockers_count || 0} blocker(s) found`,
          payload.can_proceed ? 'pass' : 'block'
        );
        break;
      case 'scaffold_preflight_resolution_selected':
        body = this.renderStatusCard('\u{1F527}', 'Resolution Applied', payload.resolution || 'User resolved preflight issue', 'info');
        break;
      case 'scaffold_quality_gates_passed':
        body = this.renderStatusCard('\u2705', 'Quality Gates Passed', 'All preflight checks cleared', 'pass');
        break;
      case 'scaffold_quality_gates_failed':
        body = this.renderStatusCard('\u274C', 'Quality Gates Failed', payload.reason || 'Preflight checks blocked', 'block');
        break;
      case 'scaffold_checkpoint_created':
        body = this.renderStatusCard('\u{1F4BE}', 'Checkpoint Created', 'Backup saved before scaffold', 'info');
        break;
      case 'scaffold_checkpoint_restored':
        body = this.renderStatusCard('\u{1F504}', 'Checkpoint Restored', 'Rolled back to pre-scaffold state', 'info');
        break;
      case 'scaffold_apply_completed':
        body = this.renderStatusCard('\u2705', 'Scaffold Applied', 'Project files created successfully', 'pass');
        break;
      case 'settings_changed':
        body = this.renderStatusCard('\u2699\uFE0F', 'Settings Updated', `${payload.setting || 'Setting'} changed`, 'info');
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
            📌 Recipe and design pack will be selected after approval
          </div>
        ` : ''}
        <div class="timestamp">${this.formatTimestamp(event.timestamp || '')}</div>
      </div>
    `;
  }

  private renderProposalWithActions(event: ScaffoldEvent, payload: Record<string, any>): string {
    // Get the proposal content (reuse existing method logic)
    const summary = payload.summary || 'Project scaffold proposal';
    const recipe = payload.recipe || 'TBD';
    const designPack = payload.design_pack || payload.design_pack_name || 'TBD';
    const designPackId = payload.design_pack_id || '';
    const tokensSummary = payload.design_tokens_summary || '';
    const filesCount = payload.files_count || 0;
    const dirsCount = payload.directories_count || 0;
    
    const referenceContext = payload.reference_context || null;
    const styleSourceMode = payload.style_source_mode || 'combine_with_design_pack';
    const hasReferences = referenceContext && 
      ((referenceContext.images || []).length > 0 || (referenceContext.urls || []).length > 0);
    
    // Step 39: Reference tokens influence
    const referenceTokensSummary = payload.reference_tokens_summary || null;
    const styleOverrides = payload.style_overrides || null;

    const isTBD = (val: string | number) => !val || val === 'TBD' || val === 0;
    const hasDesignPack = !isTBD(designPack) && designPackId;
    
    // Get action options from payload
    const options = payload.options || [];
    const proceedOption = options.find((o: any) => o.action === 'proceed') || { label: 'Proceed', disabled: false };
    const cancelOption = options.find((o: any) => o.action === 'cancel') || { label: 'Cancel', disabled: false };
    const changeStyleOption = options.find((o: any) => o.action === 'change_style');
    
    // Step 39: Get design pack tokens for visual preview
    const packTokens = this.getDesignPackTokens(designPackId, styleOverrides);

    return `
      <div class="scaffold-card proposal">
        <div class="header">
          <span class="icon">📋</span>
          <h3>Scaffold Proposal</h3>
          <span class="badge proposal">Ready to Create</span>
        </div>
        <div class="summary-section">
          <div class="prompt-label">Summary</div>
          <div class="summary-text">${this.escapeHtml(String(summary))}</div>
        </div>
        
        ${hasReferences ? this.renderReferenceSection(referenceContext, styleSourceMode) : ''}
        
        ${hasDesignPack ? `
          <div class="design-pack-preview">
            <div class="preview-header">
              <span class="preview-label">Design Preview</span>
              ${changeStyleOption && !changeStyleOption.disabled ? `
                <button class="change-style-btn" data-action="change_style">
                  🎨 ${this.escapeHtml(changeStyleOption.label || 'Change Style')}
                </button>
              ` : ''}
            </div>
            ${referenceTokensSummary && referenceTokensSummary.confidence >= 0.5 ? this.renderInfluenceBadge(referenceTokensSummary) : ''}
            ${this.renderVisualPreview(packTokens, designPack, false)}
            <div class="pack-meta">
              <span class="pack-name-badge">${this.escapeHtml(String(designPack))}</span>
              ${tokensSummary ? `<span class="tokens-hint">${this.escapeHtml(tokensSummary)}</span>` : ''}
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
        
        <div class="actions">
          <button class="btn-primary" data-action="proceed" ${proceedOption.disabled ? 'disabled' : ''}>
            ✅ ${this.escapeHtml(proceedOption.label || 'Create Project')}
          </button>
          <button class="btn-secondary" data-action="cancel" ${cancelOption.disabled ? 'disabled' : ''}>
            ${this.escapeHtml(cancelOption.label || 'Cancel')}
          </button>
        </div>
        
        <div class="timestamp">${this.formatTimestamp(event.timestamp || '')}</div>
      </div>
    `;
  }
  
  // ========== STEP 39: Visual Preview Methods ==========
  
  /**
   * Render influence badge (Step 39 - reference tokens)
   */
  private renderInfluenceBadge(tokensSummary: any): string {
    const confidence = Math.round((tokensSummary.confidence || 0) * 100);
    const moods = tokensSummary.moods?.slice(0, 2)?.join(', ') || '';
    
    return `
      <div class="influence-badge">
        <span class="influence-icon">✨</span>
        <span class="influence-text">
          Influenced by references (${confidence}% confidence)
          ${moods ? ` · ${this.escapeHtml(moods)}` : ''}
        </span>
      </div>
    `;
  }
  
  /**
   * Get design pack tokens by ID (Step 39)
   * Returns tokens for visual preview rendering
   */
  private getDesignPackTokens(packId: string, styleOverrides?: any): any {
    // Hardcoded design pack tokens (mirrors designPacks.ts)
    const PACK_TOKENS: Record<string, any> = {
      'minimal-light': {
        colors: { primary: '#0f172a', secondary: '#64748b', accent: '#0ea5e9', background: '#ffffff', foreground: '#0f172a', muted: '#f1f5f9', border: '#e2e8f0', primary_fg: '#ffffff' },
        fonts: { heading: 'Inter', body: 'Inter' },
        radius: '8px'
      },
      'minimal-dark': {
        colors: { primary: '#f8fafc', secondary: '#94a3b8', accent: '#38bdf8', background: '#0f172a', foreground: '#f8fafc', muted: '#1e293b', border: '#334155', primary_fg: '#0f172a' },
        fonts: { heading: 'Inter', body: 'Inter' },
        radius: '8px'
      },
      'enterprise-blue': {
        colors: { primary: '#1e40af', secondary: '#3b82f6', accent: '#0284c7', background: '#ffffff', foreground: '#1e293b', muted: '#f8fafc', border: '#e2e8f0', primary_fg: '#ffffff' },
        fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans' },
        radius: '4px'
      },
      'vibrant-neon': {
        colors: { primary: '#a855f7', secondary: '#22d3ee', accent: '#f472b6', background: '#18181b', foreground: '#fafafa', muted: '#27272a', border: '#3f3f46', primary_fg: '#000000' },
        fonts: { heading: 'Space Grotesk', body: 'Space Grotesk' },
        radius: '8px'
      },
      'gradient-ocean': {
        colors: { primary: '#0284c7', secondary: '#06b6d4', accent: '#8b5cf6', background: '#f0f9ff', foreground: '#0c4a6e', muted: '#e0f2fe', border: '#bae6fd', primary_fg: '#ffffff' },
        fonts: { heading: 'Montserrat', body: 'Inter' },
        radius: '12px'
      },
      'neo-brutalist': {
        colors: { primary: '#000000', secondary: '#000000', accent: '#facc15', background: '#ffffff', foreground: '#000000', muted: '#f5f5f5', border: '#000000', primary_fg: '#ffffff' },
        fonts: { heading: 'DM Sans', body: 'DM Sans' },
        radius: '4px'
      },
      'vibrant-pop': {
        colors: { primary: '#7c3aed', secondary: '#ec4899', accent: '#f59e0b', background: '#fefce8', foreground: '#1c1917', muted: '#fef3c7', border: '#fde047', primary_fg: '#ffffff' },
        fonts: { heading: 'Poppins', body: 'Poppins' },
        radius: '12px'
      },
      'warm-sand': {
        colors: { primary: '#92400e', secondary: '#b45309', accent: '#dc2626', background: '#fffbeb', foreground: '#451a03', muted: '#fef3c7', border: '#fde68a', primary_fg: '#ffffff' },
        fonts: { heading: 'Playfair Display', body: 'Source Sans Pro' },
        radius: '8px'
      },
      'enterprise-slate': {
        colors: { primary: '#334155', secondary: '#64748b', accent: '#0d9488', background: '#ffffff', foreground: '#1e293b', muted: '#f8fafc', border: '#cbd5e1', primary_fg: '#ffffff' },
        fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans' },
        radius: '4px'
      },
      'gradient-sunset': {
        colors: { primary: '#f97316', secondary: '#ec4899', accent: '#a855f7', background: '#fffbeb', foreground: '#1c1917', muted: '#fff7ed', border: '#fed7aa', primary_fg: '#ffffff' },
        fonts: { heading: 'Montserrat', body: 'Inter' },
        radius: '12px'
      },
      'glassmorphism': {
        colors: { primary: '#6366f1', secondary: '#8b5cf6', accent: '#ec4899', background: '#f8fafc', foreground: '#1e293b', muted: 'rgba(255,255,255,0.4)', border: 'rgba(255,255,255,0.3)', primary_fg: '#ffffff' },
        fonts: { heading: 'Inter', body: 'Inter' },
        radius: '12px'
      },
      'warm-olive': {
        colors: { primary: '#3f6212', secondary: '#65a30d', accent: '#ca8a04', background: '#fefce8', foreground: '#1a2e05', muted: '#ecfccb', border: '#bef264', primary_fg: '#ffffff' },
        fonts: { heading: 'Merriweather', body: 'Source Sans Pro' },
        radius: '8px'
      }
    };
    
    let tokens = PACK_TOKENS[packId] || PACK_TOKENS['minimal-light'];
    
    // Apply style overrides from reference tokens
    if (styleOverrides?.palette) {
      tokens = { ...tokens, colors: { ...tokens.colors } };
      if (styleOverrides.palette.primary) tokens.colors.primary = styleOverrides.palette.primary;
      if (styleOverrides.palette.secondary) tokens.colors.secondary = styleOverrides.palette.secondary;
      if (styleOverrides.palette.accent) tokens.colors.accent = styleOverrides.palette.accent;
    }
    if (styleOverrides?.radius) {
      const radiusMap: Record<string, string> = { 'none': '0px', 'sm': '4px', 'md': '8px', 'lg': '12px', 'full': '9999px' };
      tokens.radius = radiusMap[styleOverrides.radius] || tokens.radius;
    }
    
    return tokens;
  }
  
  /**
   * Render visual preview using design pack tokens (Step 39)
   * Pure CSS/HTML - no images, no network
   */
  private renderVisualPreview(tokens: any, packName: string, compact: boolean = false): string {
    const c = tokens.colors;
    const fonts = tokens.fonts;
    const radius = tokens.radius || '8px';
    
    if (compact) {
      // Mini preview for style picker
      return `
        <div class="visual-preview-mini" style="
          background: linear-gradient(135deg, ${c.background} 0%, ${c.muted} 50%, ${c.primary}15 100%);
          border: 1px solid ${c.border};
          border-radius: 6px;
          overflow: hidden;
          position: relative;
          height: 50px;
        ">
          <div style="padding: 6px; position: relative; z-index: 2;">
            <div style="font-family: '${fonts.heading}', sans-serif; font-size: 9px; font-weight: 700; color: ${c.foreground}; margin-bottom: 3px;">Preview</div>
            <div style="display: inline-block; padding: 2px 6px; background: ${c.primary}; color: ${c.primary_fg || '#fff'}; border-radius: 3px; font-size: 7px; font-weight: 600;">Button</div>
          </div>
          <div style="position: absolute; top: 0; right: 0; width: 50%; height: 100%; overflow: hidden; z-index: 1;">
            <div style="position: absolute; width: 20px; height: 20px; border-radius: 50%; background: ${c.primary}; opacity: 0.2; top: 2px; right: 4px;"></div>
            <div style="position: absolute; width: 14px; height: 14px; border-radius: 50%; background: ${c.accent}; opacity: 0.2; top: 18px; right: 16px;"></div>
          </div>
        </div>
      `;
    }
    
    // Full preview for proposal card
    return `
      <div class="visual-preview-full" style="
        background: ${c.background};
        border: 1px solid ${c.border};
        border-radius: ${radius};
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      ">
        <!-- Hero Section -->
        <div style="
          position: relative;
          padding: 16px;
          background: linear-gradient(135deg, ${c.background} 0%, ${c.muted} 100%);
          overflow: hidden;
        ">
          <div style="position: relative; z-index: 2;">
            <div style="font-family: '${fonts.heading}', sans-serif; font-size: 14px; font-weight: 700; color: ${c.foreground}; margin-bottom: 4px; letter-spacing: -0.02em;">
              Build Something Great
            </div>
            <div style="font-family: '${fonts.body}', sans-serif; font-size: 10px; color: ${c.secondary || c.foreground}80; margin-bottom: 8px;">
              Modern, fast, and beautiful applications.
            </div>
            <button style="
              display: inline-block;
              padding: 5px 14px;
              background: ${c.primary};
              color: ${c.primary_fg || '#ffffff'};
              border: none;
              border-radius: calc(${radius} / 2);
              font-family: '${fonts.body}', sans-serif;
              font-size: 10px;
              font-weight: 600;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            ">Get Started</button>
          </div>
          <!-- Decorative shapes -->
          <div style="position: absolute; top: 0; right: 0; width: 50%; height: 100%; overflow: hidden; z-index: 1;">
            <div style="position: absolute; width: 50px; height: 50px; border-radius: 50%; background: ${c.primary}; opacity: 0.12; top: -8px; right: 8px;"></div>
            <div style="position: absolute; width: 32px; height: 32px; border-radius: 50%; background: ${c.accent}; opacity: 0.12; top: 24px; right: 42px;"></div>
            <div style="position: absolute; width: 24px; height: 24px; border-radius: 50%; background: ${c.secondary}; opacity: 0.12; bottom: 8px; right: 16px;"></div>
          </div>
        </div>
        
        <!-- Components Row -->
        <div style="padding: 10px 16px; border-top: 1px solid ${c.border}; background: ${c.background};">
          <div style="font-family: '${fonts.body}', sans-serif; font-size: 9px; font-weight: 600; text-transform: uppercase; color: ${c.secondary || c.foreground}80; margin-bottom: 6px; letter-spacing: 0.5px;">
            Components
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button style="padding: 3px 8px; background: ${c.primary}; color: ${c.primary_fg || '#fff'}; border: none; border-radius: calc(${radius} / 2); font-size: 9px; font-weight: 600;">Primary</button>
            <button style="padding: 3px 8px; background: ${c.muted}; color: ${c.foreground}; border: 1px solid ${c.border}; border-radius: calc(${radius} / 2); font-size: 9px;">Secondary</button>
            <input type="text" placeholder="Input" style="padding: 3px 8px; border: 1px solid ${c.border}; border-radius: calc(${radius} / 2); background: ${c.background}; color: ${c.foreground}; font-size: 9px; width: 60px;">
            <div style="padding: 5px 8px; border: 1px solid ${c.border}; border-radius: ${radius}; background: ${c.background}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
              <div style="font-size: 9px; font-weight: 600; color: ${c.foreground};">Card</div>
              <div style="font-size: 8px; color: ${c.secondary || c.foreground}80;">Preview</div>
            </div>
          </div>
        </div>
        
        <!-- Typography Row -->
        <div style="padding: 8px 16px; border-top: 1px solid ${c.border}; background: ${c.muted};">
          <div style="display: flex; gap: 12px; align-items: baseline;">
            <span style="font-family: '${fonts.heading}', sans-serif; font-size: 14px; font-weight: 700; color: ${c.foreground};">H1</span>
            <span style="font-family: '${fonts.heading}', sans-serif; font-size: 12px; font-weight: 600; color: ${c.foreground};">H2</span>
            <span style="font-family: '${fonts.body}', sans-serif; font-size: 10px; color: ${c.foreground};">Body</span>
            <span style="font-family: 'SF Mono', Consolas, monospace; font-size: 9px; color: ${c.secondary || c.foreground}80; background: ${c.background}; padding: 2px 4px; border-radius: 3px;">mono</span>
          </div>
        </div>
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
              ? 'Scaffold approved! Setting up your project...'
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

  // ========== STEP 35.5: Design Pack Picker Methods ==========

  private renderStylePicker(event: ScaffoldEvent, payload: Record<string, any>): string {
    const currentPackId = payload.current_pack_id || '';
    const scaffoldId = payload.scaffold_id || '';
    
    // Hardcoded design pack options (from getDefaultPacksForPicker)
    const packs = [
      { id: 'minimal-light', name: 'Minimal Light', vibe: 'minimal', description: 'Clean, modern design with plenty of whitespace', gradient: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)' },
      { id: 'minimal-dark', name: 'Minimal Dark', vibe: 'minimal', description: 'Sleek dark theme with cool accents', gradient: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' },
      { id: 'enterprise-blue', name: 'Enterprise Blue', vibe: 'enterprise', description: 'Professional blue theme for business apps', gradient: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)' },
      { id: 'vibrant-neon', name: 'Vibrant Neon', vibe: 'vibrant', description: 'Dark theme with electric neon colors', gradient: 'linear-gradient(135deg, #a855f7 0%, #22d3ee 100%)' },
      { id: 'gradient-ocean', name: 'Gradient Ocean', vibe: 'gradient', description: 'Cool blue to cyan ocean tones', gradient: 'linear-gradient(135deg, #0284c7 0%, #06b6d4 100%)' },
      { id: 'neo-brutalist', name: 'Neo Brutalist', vibe: 'neo', description: 'Bold black borders with punchy yellow accents', gradient: 'linear-gradient(135deg, #000000 0%, #facc15 100%)' },
    ];

    return `
      <div class="scaffold-card style-picker">
        <div class="header">
          <span class="icon">🎨</span>
          <h3>Choose Design Style</h3>
          <span class="badge style-pick">Pick One</span>
        </div>
        <div class="picker-instruction">
          Select a design pack for your new project. This determines colors, typography, and overall visual style.
        </div>
        <div class="pack-grid">
          ${packs.map(pack => `
            <div class="pack-option ${currentPackId === pack.id ? 'selected' : ''}" 
                 data-action="select_pack" 
                 data-pack-id="${this.escapeHtml(pack.id)}">
              <div class="pack-preview" style="background: ${pack.gradient};">
                <span class="pack-letter">${this.escapeHtml(pack.name.charAt(0))}</span>
              </div>
              <div class="pack-info">
                <div class="pack-title">${this.escapeHtml(pack.name)}</div>
                <div class="pack-vibe">${this.escapeHtml(pack.vibe)}</div>
              </div>
              ${currentPackId === pack.id ? '<span class="check-mark">✓</span>' : ''}
            </div>
          `).join('')}
        </div>
        <div class="picker-actions">
          <button class="btn-secondary" data-action="cancel_picker">← Back</button>
        </div>
        <div class="timestamp">${this.formatTimestamp(event.timestamp || '')}</div>
      </div>
    `;
  }

  private renderStyleSelected(payload: Record<string, any>): string {
    const packId = payload.selected_pack_id || '';
    const packName = payload.selected_pack_name || packId;
    
    return `
      <div class="scaffold-card style-selected">
        <div class="header">
          <span class="icon">✨</span>
          <h3>Style Updated</h3>
          <span class="badge style-pick">Selected</span>
        </div>
        <div class="selection-confirm">
          <span class="selection-icon">🎨</span>
          <span class="selection-text">Design style changed to <strong>${this.escapeHtml(packName)}</strong></span>
        </div>
      </div>
    `;
  }

  // ========== SCAFFOLD EXECUTION EVENTS ==========

  private renderDecisionResolved(payload: Record<string, any>): string {
    const decision = payload.decision || 'proceed';
    const recipe = payload.recipe_id || payload.recipe || '';
    const designPack = payload.design_pack_id || payload.design_pack || '';
    const nextCommand = payload.next_command || '';

    const isApproved = decision === 'proceed';
    
    return `
      <div class="scaffold-card ${isApproved ? 'approved' : 'cancelled'}">
        <div class="header">
          <span class="icon">${isApproved ? '✅' : '⛔'}</span>
          <h3>Scaffold Decision</h3>
          <span class="badge ${isApproved ? 'ready' : 'cancelled'}">${isApproved ? 'Approved' : 'Rejected'}</span>
        </div>
        <div class="decision-details">
          ${isApproved ? `
            ${recipe ? `<span class="detail-chip">Recipe: ${this.escapeHtml(recipe)}</span>` : ''}
            ${nextCommand ? `<span class="detail-chip">Next: ${this.escapeHtml(this.truncateText(nextCommand, 40))}</span>` : ''}
          ` : `
            <span class="decision-text">User rejected the scaffold proposal</span>
          `}
        </div>
      </div>
    `;
  }

  private renderApplyStarted(payload: Record<string, any>): string {
    const recipe = payload.recipe_id || payload.recipe || 'unknown';
    const command = payload.command || '';
    const filesCount = payload.files_count || 0;

    return `
      <div class="scaffold-card applying">
        <div class="header">
          <span class="icon">⚙️</span>
          <h3>Creating Project</h3>
          <span class="badge applying">In Progress</span>
        </div>
        <div class="apply-status">
          <div class="status-item">
            <span class="status-icon">🔄</span>
            <span class="status-text">Setting up ${this.escapeHtml(recipe)} project...</span>
          </div>
        </div>
        ${command ? `
          <div class="command-preview">
            <span class="command-label">Running:</span>
            <code class="command-text">${this.escapeHtml(command)}</code>
          </div>
        ` : ''}
        ${filesCount > 0 ? `
          <div class="detail-row">
            <span class="detail-label">Files to create:</span>
            <span class="detail-value">${filesCount}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderApplied(payload: Record<string, any>): string {
    const filesCreated = payload.files_created || 0;
    const dirsCreated = payload.directories_created || 0;
    const targetDir = payload.target_directory || '';
    const recipe = payload.recipe_id || payload.recipe || '';
    const method = payload.method || '';
    const command = payload.command || '';
    const message = payload.message || '';

    // If method is vscode_terminal, the CLI is running interactively
    // Show a "running in terminal" message instead of "Complete"
    const isTerminalMethod = method === 'vscode_terminal';

    if (isTerminalMethod) {
      return `
        <div class="scaffold-card applying">
          <div class="header">
            <span class="icon">🖥️</span>
            <h3>Scaffold Running in Terminal</h3>
            <span class="badge applying">Interactive</span>
          </div>
          <div class="completion-section terminal-running">
            <span class="completion-icon">👆</span>
            <span class="completion-text">
              ${message || 'Follow the prompts in the terminal to complete project setup.'}
            </span>
          </div>
          ${command ? `
            <div class="command-preview">
              <span class="command-label">Command:</span>
              <code class="command-text">${this.escapeHtml(command)}</code>
            </div>
          ` : ''}
          <div class="terminal-notice">
            <span class="notice-icon">💡</span>
            <span class="notice-text">
              The scaffold CLI is interactive. Check the VS Code terminal panel to complete setup.
            </span>
          </div>
        </div>
      `;
    }

    // Direct file creation (files_created > 0) - show completion
    return `
      <div class="scaffold-card applied">
        <div class="header">
          <span class="icon">🎉</span>
          <h3>Project Created</h3>
          <span class="badge ready">Complete</span>
        </div>
        <div class="completion-section ready">
          <span class="completion-icon">✅</span>
          <span class="completion-text">
            ${recipe ? `${this.escapeHtml(recipe)} scaffold applied successfully!` : 'Scaffold applied successfully!'}
          </span>
        </div>
        <div class="apply-stats">
          ${filesCreated > 0 ? `
            <div class="stat-item">
              <span class="stat-icon">📄</span>
              <span class="stat-value">${filesCreated}</span>
              <span class="stat-label">files created</span>
            </div>
          ` : ''}
          ${dirsCreated > 0 ? `
            <div class="stat-item">
              <span class="stat-icon">📁</span>
              <span class="stat-value">${dirsCreated}</span>
              <span class="stat-label">directories</span>
            </div>
          ` : ''}
        </div>
        ${targetDir ? `
          <div class="detail-row">
            <span class="detail-label">Location:</span>
            <span class="detail-value mono">${this.escapeHtml(this.truncatePath(targetDir))}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderCancelled(payload: Record<string, any>): string {
    const reason = payload.reason || 'User cancelled';
    
    return `
      <div class="scaffold-card cancelled">
        <div class="header">
          <span class="icon">⛔</span>
          <h3>Scaffold Cancelled</h3>
          <span class="badge cancelled">Cancelled</span>
        </div>
        <div class="completion-section cancelled">
          <span class="completion-icon">🔙</span>
          <span class="completion-text">${this.escapeHtml(reason)}</span>
        </div>
      </div>
    `;
  }

  // ========== POST-SCAFFOLD ORCHESTRATION EVENTS ==========

  private renderProgress(payload: Record<string, any>): string {
    const phase = payload.phase || '';
    const message = payload.message || 'Creating project...';
    const progress = payload.progress || 0;

    return `
      <div class="scaffold-card applying">
        <div class="header">
          <span class="icon">⏳</span>
          <h3>Scaffold Progress</h3>
          <span class="badge applying">In Progress</span>
        </div>
        <div class="progress-section">
          <div class="progress-message">${this.escapeHtml(message)}</div>
          ${phase ? `<div class="progress-phase">Phase: ${this.escapeHtml(phase)}</div>` : ''}
          ${progress > 0 ? `
            <div class="progress-bar-container">
              <div class="progress-bar" style="width: ${progress}%"></div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderDesignPackApplied(payload: Record<string, any>): string {
    const designPack = payload.design_pack || payload.design_pack_id || 'Custom';
    const filesModified = payload.files_modified || (payload.modified_files as string[])?.length || 0;
    const modifiedFiles = payload.modified_files || [];

    return `
      <div class="scaffold-card applied">
        <div class="header">
          <span class="icon">🎨</span>
          <h3>Design Pack Applied</h3>
          <span class="badge ready">Styled</span>
        </div>
        <div class="design-applied-section">
          <div class="design-applied-info">
            <span class="design-icon">✨</span>
            <span class="design-text">Applied <strong>${this.escapeHtml(designPack)}</strong> styling</span>
          </div>
          ${filesModified > 0 ? `
            <div class="files-modified-count">${filesModified} file(s) styled</div>
          ` : ''}
          ${modifiedFiles.length > 0 ? `
            <div class="modified-files-list">
              ${modifiedFiles.slice(0, 3).map((f: string) => `
                <div class="modified-file">📄 ${this.escapeHtml(this.truncatePath(f, 40))}</div>
              `).join('')}
              ${modifiedFiles.length > 3 ? `<div class="more-files">+${modifiedFiles.length - 3} more</div>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderNextStepsShown(payload: Record<string, any>): string {
    const steps = payload.suggestions || payload.steps || [];
    const projectPath = payload.target_directory || payload.project_path || '';

    return `
      <div class="scaffold-card ready">
        <div class="header">
          <span class="icon">🚀</span>
          <h3>Next Steps</h3>
          <span class="badge ready">${steps.length} Actions</span>
        </div>
        <div class="next-steps-section">
          <div class="next-steps-intro">
            Your project is ready! Here are recommended next steps:
          </div>
          ${steps.length > 0 ? `
            <div class="next-steps-list">
              ${steps.slice(0, 6).map((step: any, idx: number) => `
                <div class="next-step-item">
                  <span class="step-number">${idx + 1}</span>
                  <div class="step-content">
                    <span class="step-title">${this.escapeHtml(step.title || step.label || String(step))}</span>
                    ${step.description ? `<span class="step-desc" style="font-size:11px;color:var(--vscode-descriptionForeground);display:block;margin-top:2px">${this.escapeHtml(step.description)}</span>` : ''}
                  </div>
                </div>
              `).join('')}
              ${steps.length > 6 ? `<div class="more-steps">+${steps.length - 6} more steps</div>` : ''}
            </div>
          ` : ''}
          ${projectPath ? `
            <div class="project-path-note">
              <span class="path-icon">📁</span>
              <span class="path-text">${this.escapeHtml(this.truncatePath(projectPath, 50))}</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderFeatureCodeApplied(payload: Record<string, any>): string {
    const createdFiles: string[] = payload.created_files || [];
    const modifiedFiles: string[] = payload.modified_files || [];
    const totalFiles = payload.total_files || (createdFiles.length + modifiedFiles.length);
    const summary = payload.summary || 'Feature code generated';

    return `
      <div class="scaffold-card applied">
        <div class="header">
          <span class="icon">\u2728</span>
          <h3>Feature Code Applied</h3>
          <span class="badge ready">${totalFiles} file${totalFiles !== 1 ? 's' : ''}</span>
        </div>
        <div class="status-message" style="padding:8px 16px 4px;font-size:12px;color:var(--vscode-descriptionForeground);">
          ${this.escapeHtml(summary)}
        </div>
        ${createdFiles.length > 0 ? `
          <div style="padding:4px 16px 8px;font-size:11px;color:var(--vscode-descriptionForeground);">
            <div style="font-weight:600;margin-bottom:2px;">Created:</div>
            ${createdFiles.map(f => `<div style="padding-left:8px;font-family:monospace;">\u2795 ${this.escapeHtml(f)}</div>`).join('')}
          </div>
        ` : ''}
        ${modifiedFiles.length > 0 ? `
          <div style="padding:0 16px 12px;font-size:11px;color:var(--vscode-descriptionForeground);">
            <div style="font-weight:600;margin-bottom:2px;">Modified:</div>
            ${modifiedFiles.map(f => `<div style="padding-left:8px;font-family:monospace;">\u{270F}\uFE0F ${this.escapeHtml(f)}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderFinalComplete(payload: Record<string, any>): string {
    const success = payload.success !== false;
    const projectPath = payload.project_path || '';
    const designPackApplied = payload.design_pack_applied;
    const recipe = payload.recipe_id || payload.recipe || '';

    const projectName = projectPath ? projectPath.split('/').pop() : 'project';

    return `
      <div class="scaffold-card ${success ? 'applied' : 'cancelled'}">
        <div class="header">
          <span class="icon">${success ? '✅' : '❌'}</span>
          <h3>Project Ready</h3>
          <span class="badge ${success ? 'ready' : 'cancelled'}">${success ? 'Complete' : 'Failed'}</span>
        </div>
        <div class="final-complete-section ${success ? 'success' : 'failure'}">
          <div class="final-icon">${success ? '🎉' : '⚠️'}</div>
          <div class="final-message">
            ${success 
              ? `<strong>${this.escapeHtml(projectName)}</strong> is ready for development!`
              : 'Project setup encountered an issue'}
          </div>
        </div>
        ${success ? `
          <div class="final-details">
            ${recipe ? `<span class="detail-chip">📦 ${this.escapeHtml(recipe)}</span>` : ''}
            ${designPackApplied ? `<span class="detail-chip">🎨 Design Applied</span>` : ''}
          </div>
          <div class="final-hint">
            <span class="hint-icon">💡</span>
            <span class="hint-text">Open a terminal and run <code>cd ${this.escapeHtml(projectName)}</code> to get started</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderStatusCard(icon: string, title: string, message: string, status: string): string {
    const badgeClass = status === 'pass' ? 'ready' : status === 'block' ? 'cancelled' : status === 'running' ? 'starting' : 'ready';
    const badgeText = status === 'pass' ? 'Passed' : status === 'block' ? 'Blocked' : status === 'running' ? 'Running' : 'Done';
    return `
      <div class="scaffold-card ${status === 'pass' ? 'applied' : status === 'block' ? 'cancelled' : 'starting'}">
        <div class="header">
          <span class="icon">${icon}</span>
          <h3>${this.escapeHtml(title)}</h3>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        ${message ? `<div class="status-message" style="padding:8px 16px 12px;font-size:12px;color:var(--vscode-descriptionForeground);">${this.escapeHtml(message)}</div>` : ''}
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

    // Step 35.5: Bind pack selection actions (design pack picker)
    const packOptions = this.shadowRoot.querySelectorAll('[data-action="select_pack"]');
    packOptions.forEach((opt: any) => {
      opt.addEventListener('click', () => {
        const packId = opt.getAttribute('data-pack-id');
        this.dispatchEvent(new CustomEvent('scaffold-action', {
          detail: {
            action: 'select_style',
            scaffoldId: this._event?.payload?.scaffold_id,
            eventId: this._event?.event_id,
            selectedPackId: packId
          },
          bubbles: true,
          composed: true
        }));
      });
    });

    // Step 35.5: Bind cancel picker (back button)
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
        .scaffold-card.approved { border-left: 4px solid #89d185; }
        .scaffold-card.applying { border-left: 4px solid #3794ff; }
        .scaffold-card.applied { border-left: 4px solid #89d185; }
        
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
        .badge.applying { background: #3794ff; color: white; }
        
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
        .completion-section.terminal-running {
          background: rgba(55, 148, 255, 0.1);
          border: 1px solid #3794ff;
        }
        .completion-icon { font-size: 16px; }
        .completion-text { color: var(--vscode-foreground); }
        
        .terminal-notice {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          margin-top: 12px;
          background: rgba(55, 148, 255, 0.08);
          border: 1px dashed rgba(55, 148, 255, 0.4);
          border-radius: 6px;
          font-size: 12px;
        }
        .terminal-notice .notice-icon {
          font-size: 16px;
        }
        .terminal-notice .notice-text {
          color: var(--vscode-descriptionForeground);
          font-style: normal;
        }
        
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
        
        /* Step 35.5: Design Pack Picker Styles */
        .scaffold-card.style-picker {
          border-left: 4px solid #a855f7;
        }
        .badge.style-pick {
          background: #a855f7;
          color: white;
        }
        .picker-instruction {
          font-size: 13px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 16px;
          line-height: 1.5;
        }
        .pack-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 16px;
        }
        .pack-option {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          background: var(--vscode-input-background);
          border: 2px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }
        .pack-option:hover {
          border-color: var(--vscode-focusBorder);
          background: var(--vscode-list-hoverBackground);
        }
        .pack-option.selected {
          border-color: #a855f7;
          background: rgba(168, 85, 247, 0.1);
        }
        .pack-preview {
          width: 48px;
          height: 36px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        .pack-letter {
          font-size: 18px;
          font-weight: 700;
          color: white;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }
        .pack-info {
          flex: 1;
          min-width: 0;
        }
        .pack-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--vscode-foreground);
          margin-bottom: 2px;
        }
        .pack-vibe {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
        }
        .check-mark {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 18px;
          height: 18px;
          background: #a855f7;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: white;
          font-weight: bold;
        }
        .picker-actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
        
        /* Step 35.5: Style Selected Confirmation */
        .scaffold-card.style-selected {
          border-left: 4px solid #22c55e;
        }
        .selection-confirm {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid #22c55e;
          border-radius: 6px;
        }
        .selection-icon {
          font-size: 20px;
        }
        .selection-text {
          font-size: 13px;
          color: var(--vscode-foreground);
        }
        .selection-text strong {
          color: #22c55e;
        }
        
        /* Scaffold Execution Event Styles */
        .decision-details {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 0;
        }
        .detail-chip {
          display: inline-block;
          padding: 4px 10px;
          background: var(--vscode-input-background);
          border-radius: 4px;
          font-size: 12px;
          color: var(--vscode-foreground);
        }
        .decision-text {
          font-size: 13px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
        }
        
        .apply-status {
          margin: 12px 0;
        }
        .status-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }
        .status-icon {
          font-size: 16px;
        }
        .status-text {
          color: var(--vscode-foreground);
        }
        
        .command-preview {
          margin: 12px 0;
          padding: 10px 12px;
          background: var(--vscode-input-background);
          border-radius: 6px;
          border: 1px solid var(--vscode-panel-border);
        }
        .command-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          margin-right: 8px;
        }
        .command-text {
          font-family: var(--vscode-editor-font-family), monospace;
          font-size: 12px;
          color: var(--vscode-textLink-foreground);
        }
        
        .apply-stats {
          display: flex;
          gap: 16px;
          margin: 12px 0;
        }
        .stat-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: var(--vscode-input-background);
          border-radius: 6px;
        }
        .stat-icon {
          font-size: 16px;
        }
        .stat-value {
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        .stat-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }
        
        /* Post-Scaffold Orchestration Styles */
        .progress-section {
          padding: 12px;
          background: var(--vscode-input-background);
          border-radius: 6px;
        }
        .progress-message {
          font-size: 13px;
          color: var(--vscode-foreground);
          margin-bottom: 8px;
        }
        .progress-phase {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 8px;
        }
        .progress-bar-container {
          height: 4px;
          background: rgba(55, 148, 255, 0.2);
          border-radius: 2px;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          background: #3794ff;
          border-radius: 2px;
          transition: width 0.3s ease;
        }
        
        .design-applied-section {
          padding: 12px;
          background: rgba(137, 209, 133, 0.1);
          border-radius: 6px;
          border: 1px solid rgba(137, 209, 133, 0.3);
        }
        .design-applied-info {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .design-icon {
          font-size: 16px;
        }
        .design-text {
          font-size: 13px;
          color: var(--vscode-foreground);
        }
        .design-text strong {
          color: #89d185;
        }
        .files-modified-count {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 8px;
        }
        .modified-files-list {
          padding: 8px;
          background: var(--vscode-input-background);
          border-radius: 4px;
        }
        .modified-file {
          font-size: 11px;
          color: var(--vscode-foreground);
          padding: 2px 0;
          font-family: var(--vscode-editor-font-family), monospace;
        }
        .more-files {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          padding: 2px 0;
        }
        
        .next-steps-section {
          padding: 12px;
        }
        .next-steps-intro {
          font-size: 13px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 12px;
        }
        .next-steps-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .next-step-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: var(--vscode-input-background);
          border-radius: 6px;
          border: 1px solid var(--vscode-panel-border);
        }
        .step-number {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #89d185;
          color: #1e1e1e;
          border-radius: 50%;
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .step-title {
          font-size: 13px;
          color: var(--vscode-foreground);
        }
        .more-steps {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          text-align: center;
          padding: 4px;
        }
        .project-path-note {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          padding: 8px 12px;
          background: var(--vscode-input-background);
          border-radius: 4px;
          font-size: 12px;
        }
        .path-icon {
          font-size: 16px;
        }
        .path-text {
          font-family: var(--vscode-editor-font-family), monospace;
          color: var(--vscode-descriptionForeground);
        }
        
        .final-complete-section {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border-radius: 6px;
          margin: 12px 0;
        }
        .final-complete-section.success {
          background: rgba(137, 209, 133, 0.1);
          border: 1px solid #89d185;
        }
        .final-complete-section.failure {
          background: rgba(204, 167, 0, 0.1);
          border: 1px solid #cca700;
        }
        .final-icon {
          font-size: 28px;
        }
        .final-message {
          font-size: 14px;
          color: var(--vscode-foreground);
        }
        .final-message strong {
          color: #89d185;
        }
        .final-details {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin: 12px 0;
        }
        .final-hint {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: var(--vscode-input-background);
          border-radius: 6px;
          font-size: 12px;
        }
        .hint-icon {
          font-size: 16px;
        }
        .hint-text {
          color: var(--vscode-descriptionForeground);
        }
        .hint-text code {
          background: rgba(55, 148, 255, 0.2);
          padding: 2px 6px;
          border-radius: 3px;
          font-family: var(--vscode-editor-font-family), monospace;
          color: var(--vscode-textLink-foreground);
        }
        
        /* Step 39: Visual Preview Styles */
        .visual-preview-full {
          margin-bottom: 12px;
        }
        
        .pack-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 10px;
          padding: 8px 0;
        }
        
        .pack-name-badge {
          display: inline-block;
          padding: 4px 12px;
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }
        
        .tokens-hint {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-family: var(--vscode-editor-font-family), monospace;
        }
        
        .influence-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: linear-gradient(90deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%);
          border-radius: 6px;
          margin-bottom: 12px;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }
        
        .influence-icon {
          font-size: 16px;
        }
        
        .influence-text {
          font-size: 11px;
          color: var(--vscode-foreground);
          font-style: italic;
        }
        
        /* Step 39: Enhanced Style Picker with Mini Previews */
        .pack-option-enhanced {
          display: flex;
          flex-direction: column;
          padding: 8px;
          background: var(--vscode-input-background);
          border: 2px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          min-height: 90px;
        }
        
        .pack-option-enhanced:hover {
          border-color: var(--vscode-focusBorder);
          background: var(--vscode-list-hoverBackground);
        }
        
        .pack-option-enhanced.selected {
          border-color: #a855f7;
          background: rgba(168, 85, 247, 0.1);
        }
        
        .pack-mini-preview {
          width: 100%;
          height: 50px;
          border-radius: 4px;
          margin-bottom: 6px;
          overflow: hidden;
        }
        
        .pack-meta-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        
        .pack-name-small {
          font-size: 11px;
          font-weight: 600;
          color: var(--vscode-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .pack-vibe-tag {
          padding: 2px 6px;
          background: rgba(168, 85, 247, 0.15);
          color: #a855f7;
          border-radius: 8px;
          font-size: 9px;
          font-weight: 500;
          text-transform: uppercase;
        }
        
        .pack-palette-strip {
          display: flex;
          gap: 3px;
          margin-top: 4px;
        }
        
        .palette-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 1px solid rgba(0, 0, 0, 0.1);
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
    'scaffold_decision_requested',
    'scaffold_decision_resolved',
    'scaffold_apply_started',
    'scaffold_applied',
    'scaffold_blocked',
    'scaffold_completed',
    'scaffold_cancelled',
    'scaffold_style_selection_requested',
    'scaffold_style_selected',
    // Post-scaffold orchestration events
    'scaffold_progress',
    'design_pack_applied',
    'next_steps_shown',
    'scaffold_final_complete',
    // Feature Intelligence events
    'feature_extraction_started',
    'feature_extraction_completed',
    'feature_code_generating',
    'feature_code_applied',
    'feature_code_error',
    // Process events are handled by ProcessCard (W2), NOT here
    // Auto-fix events
    'scaffold_autofix_started',
    'scaffold_autofix_applied',
    'scaffold_autofix_failed',
    // Verification streaming events
    'scaffold_verify_started',
    'scaffold_verify_step_completed',
    'scaffold_verify_completed',
  ].includes(eventType);
}

declare global {
  interface HTMLElementTagNameMap {
    'scaffold-card': ScaffoldCard;
  }
}
