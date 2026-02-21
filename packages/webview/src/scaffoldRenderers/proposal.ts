// Proposal-related scaffold renderers.
// NO import/export — pure script file, concatenated into ScaffoldCard.bundle.js

declare function escapeHtml(text: string): string;
declare function truncateText(text: string, maxLength: number): string;
declare function formatTimestamp(iso: string): string;
declare function getDesignPackTokens(packId: string, styleOverrides?: any): any;

type ScaffoldEvent = {
  event_id?: string;
  type?: string;
  timestamp?: string;
  payload?: Record<string, any>;
};

// Legacy renderVisualPreview and renderInfluenceBadge removed per SCAFFOLD_IMPROVEMENT_PLAN.md
// Static design previews are replaced by the App Blueprint Card + Style Intent UI.

function renderReferenceSection(referenceContext: any, styleSourceMode: string): string {
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
        <span class="reference-icon">\u{1F4CE}</span>
        <span class="reference-label">Design References</span>
        <span class="reference-badge">${escapeHtml(intentLabels[intent] || 'Reference')}</span>
      </div>

      ${images.length > 0 ? `
        <div class="thumbnail-strip">
          ${images.map((img: any) => `
            <div class="thumbnail" title="${escapeHtml(img.path || img.id)}">
              <div class="thumbnail-placeholder">
                <span class="thumbnail-icon">\u{1F5BC}\uFE0F</span>
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
              <div class="url-item" title="${escapeHtml(url)}">
                <span class="url-favicon">\u{1F517}</span>
                <span class="url-domain">${escapeHtml(domain)}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      <div class="reference-notice">
        <span class="notice-icon">\u2728</span>
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

function renderProposal(event: ScaffoldEvent, payload: Record<string, any>): string {
  const summary = payload.summary || 'Project scaffold proposal';
  const recipe = payload.recipe || 'TBD';
  const designPack = payload.design_pack || payload.design_pack_name || 'TBD';
  const filesCount = payload.files_count || 0;
  const dirsCount = payload.directories_count || 0;

  const referenceContext = payload.reference_context || null;
  const styleSourceMode = payload.style_source_mode || 'combine_with_design_pack';
  const hasReferences = referenceContext &&
    ((referenceContext.images || []).length > 0 || (referenceContext.urls || []).length > 0);

  const isTBD = (val: string | number) => !val || val === 'TBD' || val === 0;
  const hasDesignPack = !isTBD(designPack);

  return `
    <div class="scaffold-card proposal">
      <div class="header">
        <span class="icon">\u{1F4CB}</span>
        <h3>Scaffold Proposal</h3>
        <span class="badge proposal">Review</span>
      </div>
      <div class="summary-section">
        <div class="prompt-label">Summary</div>
        <div class="summary-text">${escapeHtml(String(summary))}</div>
      </div>

      ${hasReferences ? renderReferenceSection(referenceContext, styleSourceMode) : ''}

      <div class="proposal-grid">
        <div class="detail-item">
          <div class="detail-label">Recipe</div>
          <div class="detail-value ${isTBD(recipe) ? 'tbd' : ''}">${escapeHtml(String(recipe))}</div>
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
          \u{1F4CC} Recipe and design pack will be selected after approval
        </div>
      ` : ''}
      <div class="timestamp">${formatTimestamp(event.timestamp || '')}</div>
    </div>
  `;
}

function renderProposalWithActions(event: ScaffoldEvent, payload: Record<string, any>): string {
  const summary = payload.summary || 'Project scaffold proposal';
  const recipe = payload.recipe || 'TBD';
  const designPack = payload.design_pack || payload.design_pack_name || 'TBD';
  const designPackId = payload.design_pack_id || '';
  const tokensSummary = payload.design_tokens_summary || '';
  const filesCount = payload.scope_files || payload.files_count || 0;
  const dirsCount = payload.directories_count || 0;

  const referenceContext = payload.reference_context || null;
  const styleSourceMode = payload.style_source_mode || 'combine_with_design_pack';
  const hasReferences = referenceContext &&
    ((referenceContext.images || []).length > 0 || (referenceContext.urls || []).length > 0);

  const referenceTokensSummary = payload.reference_tokens_summary || null;
  const styleOverrides = payload.style_overrides || null;

  // Scaffold Improvement Plan: Blueprint data
  const blueprint = payload.blueprint || null;
  const blueprintConfidence = payload.blueprint_confidence || 0;
  const hasBlueprint = blueprint && blueprint.pages && blueprint.pages.length > 0;

  const isTBD = (val: string | number) => !val || val === 'TBD' || val === 0;
  const hasDesignPack = !isTBD(designPack) && designPackId;

  const scaffoldId = payload.scaffold_id || '';
  const options = payload.options || [];
  const proceedOption = options.find((o: any) => o.action === 'proceed') || { label: 'Proceed', disabled: false };
  const cancelOption = options.find((o: any) => o.action === 'cancel') || { label: 'Cancel', disabled: false };

  return `
    <div class="scaffold-card proposal">
      <div class="header">
        <span class="icon">${hasBlueprint ? '\u{1F9E9}' : '\u{1F4CB}'}</span>
        <h3>${hasBlueprint ? 'App Blueprint' : 'Scaffold Proposal'}</h3>
        <span class="badge proposal">Ready to Create</span>
      </div>
      <div class="summary-section">
        <div class="prompt-label">Summary</div>
        <div class="summary-text">${escapeHtml(String(summary))}</div>
      </div>

      ${hasReferences ? renderReferenceSection(referenceContext, styleSourceMode) : ''}

      ${hasBlueprint ? renderBlueprintSection(blueprint, blueprintConfidence) : ''}

      ${renderStyleIntentSection(scaffoldId)}

      <div class="proposal-grid">
        <div class="detail-item">
          <div class="detail-label">Recipe</div>
          <div class="detail-value ${isTBD(recipe) ? 'tbd' : ''}">${escapeHtml(String(recipe))}</div>
        </div>
        ${hasBlueprint ? `
          <div class="detail-item">
            <div class="detail-label">Pages</div>
            <div class="detail-value">${blueprint.pages.length}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Components</div>
            <div class="detail-value">${payload.scope_components || new Set(blueprint.pages.flatMap((p: any) => p.key_components || [])).size}</div>
          </div>
        ` : `
          ${!hasDesignPack ? `
            <div class="detail-item">
              <div class="detail-label">Design Pack</div>
              <div class="detail-value tbd">TBD</div>
            </div>
          ` : ''}
        `}
        <div class="detail-item">
          <div class="detail-label">Files to Create</div>
          <div class="detail-value ${filesCount === 0 ? 'tbd' : ''}">${filesCount > 0 ? '~' + filesCount : 'TBD'}</div>
        </div>
      </div>

      <div class="actions">
        <button class="btn-primary" data-action="proceed" ${proceedOption.disabled ? 'disabled' : ''}>
          \u2705 ${escapeHtml(proceedOption.label || 'Create Project')}
        </button>
        <button class="btn-secondary" data-action="cancel" ${cancelOption.disabled ? 'disabled' : ''}>
          ${escapeHtml(cancelOption.label || 'Cancel')}
        </button>
      </div>

      <div class="timestamp">${formatTimestamp(event.timestamp || '')}</div>
    </div>
  `;
}

function renderStyleIntentSection(scaffoldId: string): string {
  return `
    <div class="style-intent-section">
      <div class="style-intent-header">
        <span class="style-intent-label">\u{1F3A8} Style (optional)</span>
      </div>
      <div class="style-intent-input-group">
        <input type="text" class="style-intent-nl-input"
               id="style-intent-nl-${escapeHtml(scaffoldId)}"
               placeholder="Describe your style: dark modern, like Linear..."
               data-scaffold-id="${escapeHtml(scaffoldId)}" />
      </div>
      <div class="style-intent-vibes">
        <button class="vibe-btn" data-action="set_style_intent" data-mode="vibe" data-value="minimal">Clean</button>
        <button class="vibe-btn" data-action="set_style_intent" data-mode="vibe" data-value="vibrant">Bold</button>
        <button class="vibe-btn" data-action="set_style_intent" data-mode="vibe" data-value="warm">Warm</button>
        <button class="vibe-btn" data-action="set_style_intent" data-mode="vibe" data-value="dark_modern">Dark</button>
        <button class="vibe-btn" data-action="set_style_intent" data-mode="vibe" data-value="glass">Glass</button>
        <button class="vibe-btn" data-action="set_style_intent" data-mode="vibe" data-value="neo">Neon</button>
      </div>
      <div class="style-intent-hex-group">
        <span class="hex-label">Or primary color:</span>
        <input type="text" class="style-intent-hex-input"
               id="style-intent-hex-${escapeHtml(scaffoldId)}"
               placeholder="#8b5cf6"
               maxlength="7"
               data-scaffold-id="${escapeHtml(scaffoldId)}" />
      </div>
    </div>
  `;
}

function renderStylePicker(event: ScaffoldEvent, payload: Record<string, any>): string {
  const scaffoldId = payload.scaffold_id || '';
  return `
    <div class="scaffold-card style-picker">
      <div class="header">
        <span class="icon">\u{1F3A8}</span>
        <h3>Style Your App</h3>
        <span class="badge style-pick">Optional</span>
      </div>
      <div class="picker-instruction">
        Describe your style, pick a vibe, or paste a color. Each combination generates a unique palette.
      </div>
      ${renderStyleIntentSection(scaffoldId)}
      <div class="picker-actions">
        <button class="btn-secondary" data-action="cancel_picker">\u2190 Back</button>
      </div>
      <div class="timestamp">${formatTimestamp(event.timestamp || '')}</div>
    </div>
  `;
}

// ==========================================================================
// BLUEPRINT CARD (Scaffold Improvement Plan)
// Renders a context-specific app plan instead of static preview
// ==========================================================================

function renderBlueprintSection(blueprint: any, confidence: number): string {
  if (!blueprint) return '';

  const pages = blueprint.pages || [];
  const dataModels = blueprint.data_models || [];
  const appType = blueprint.app_type || 'web_app';
  const layoutType = blueprint.layout_type || 'sidebar';

  const confidencePercent = Math.round((confidence || 0) * 100);
  const confidenceColor = confidencePercent >= 70 ? '#22c55e'
    : confidencePercent >= 40 ? '#eab308'
    : '#ef4444';

  const pageIcons: Record<string, string> = {
    dashboard: '\u{1F4CA}',
    settings: '\u2699\uFE0F',
    profile: '\u{1F464}',
    login: '\u{1F512}',
    home: '\u{1F3E0}',
    list: '\u{1F4CB}',
    detail: '\u{1F50D}',
    form: '\u{1F4DD}',
  };

  function guessPageIcon(pageName: string): string {
    const lower = pageName.toLowerCase();
    for (const [key, icon] of Object.entries(pageIcons)) {
      if (lower.includes(key)) return icon;
    }
    return '\u{1F4C4}';
  }

  return `
    <div class="blueprint-section">
      <div class="blueprint-header">
        <div class="blueprint-header-left">
          <span class="bp-icon">\u{1F9E9}</span>
          <span class="bp-title">App Blueprint</span>
          <span class="bp-type-badge">${escapeHtml(appType.replace(/_/g, ' '))}</span>
        </div>
        <div class="bp-confidence">
          <div class="bp-confidence-dot" style="background: ${confidenceColor};"></div>
          <span>${confidencePercent}% confidence</span>
        </div>
      </div>

      ${pages.length > 0 ? `
        <div class="bp-pages-section">
          <div class="bp-section-label">Pages (${pages.length})</div>
          <div class="bp-pages-list">
            ${pages.slice(0, 6).map((page: any) => `
              <div class="bp-page-item">
                <span class="bp-page-icon">${guessPageIcon(page.name || '')}</span>
                <div class="bp-page-info">
                  <div class="bp-page-name">${escapeHtml(page.name || 'Page')}</div>
                  <div class="bp-page-meta">
                    ${escapeHtml(page.route || '')} \u00b7 ${(page.key_components || []).length} components
                  </div>
                </div>
              </div>
            `).join('')}
            ${pages.length > 6 ? `
              <div class="bp-more-pages">+${pages.length - 6} more pages</div>
            ` : ''}
          </div>
        </div>
      ` : ''}

      ${dataModels.length > 0 ? `
        <div class="bp-models-section">
          <div class="bp-section-label">Data Models (${dataModels.length})</div>
          <div class="bp-models-list">
            ${dataModels.slice(0, 8).map((model: any) => `
              <span class="bp-model-tag">${escapeHtml(typeof model === 'string' ? model : model.name || 'Model')}</span>
            `).join('')}
            ${dataModels.length > 8 ? `<span class="bp-more-pages">+${dataModels.length - 8}</span>` : ''}
          </div>
        </div>
      ` : ''}

      <div class="bp-footer">
        <span>\u{1F4D0} Layout: ${escapeHtml(layoutType)}</span>
        <span>\u{1F4C4} ~${pages.length * 2 + (new Set(pages.flatMap((p: any) => p.key_components || [])).size) + dataModels.length + 5} files</span>
      </div>
    </div>
  `;
}

function renderDoctorCard(doctorCard: any): string {
  if (!doctorCard) return '';

  const checks = doctorCard.checks || [];
  const overallStatus = doctorCard.overall_status || 'unknown';
  const actions = doctorCard.actions || [];

  const statusColors: Record<string, string> = {
    pass: '#22c55e',
    fail: '#ef4444',
    warn: '#eab308',
    unknown: '#94a3b8',
    not_started: '#94a3b8',
  };

  const statusIcons: Record<string, string> = {
    pass: '\u2705',
    fail: '\u274C',
    warn: '\u26A0\uFE0F',
    unknown: '\u2753',
    not_started: '\u23F8\uFE0F',
  };

  return `
    <div class="scaffold-card doctor-card">
      <div class="header">
        <span class="icon">\u{1FA7A}</span>
        <h3>Project Health</h3>
        <span class="badge" style="background: ${statusColors[overallStatus] || '#94a3b8'}20; color: ${statusColors[overallStatus] || '#94a3b8'};">
          ${overallStatus === 'pass' ? 'Healthy' : overallStatus === 'fail' ? 'Issues Found' : overallStatus === 'warn' ? 'Warnings' : 'Checking...'}
        </span>
      </div>
      <div class="doctor-checks">
        ${checks.map((check: any) => `
          <div class="doctor-check-item">
            <span class="doctor-check-icon">${statusIcons[check.status] || '\u2753'}</span>
            <span class="doctor-check-label">${escapeHtml(check.label || check.name || 'Check')}</span>
            <span class="doctor-check-status" style="color: ${statusColors[check.status] || '#94a3b8'};">${escapeHtml((check.status || 'unknown').toUpperCase())}</span>
          </div>
        `).join('')}
      </div>
      ${actions.length > 0 ? `
        <div class="doctor-actions">
          ${actions.map((action: any) => `
            <button class="btn-secondary" data-action="${escapeHtml(action.id || action.action || '')}" style="font-size: 10px; padding: 4px 10px;">
              ${escapeHtml(action.label || action.id || 'Action')}
            </button>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderStyleSelected(payload: Record<string, any>): string {
  const packId = payload.selected_pack_id || '';
  const packName = payload.selected_pack_name || packId;

  return `
    <div class="scaffold-card style-selected">
      <div class="header">
        <span class="icon">\u2728</span>
        <h3>Style Updated</h3>
        <span class="badge style-pick">Selected</span>
      </div>
      <div class="selection-confirm">
        <span class="selection-icon">\u{1F3A8}</span>
        <span class="selection-text">Design style changed to <strong>${escapeHtml(packName)}</strong></span>
      </div>
    </div>
  `;
}
