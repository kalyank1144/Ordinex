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

function renderInfluenceBadge(tokensSummary: any): string {
  const confidence = Math.round((tokensSummary.confidence || 0) * 100);
  const moods = tokensSummary.moods?.slice(0, 2)?.join(', ') || '';

  return `
    <div class="influence-badge">
      <span class="influence-icon">\u2728</span>
      <span class="influence-text">
        Influenced by references (${confidence}% confidence)
        ${moods ? ` \u00b7 ${escapeHtml(moods)}` : ''}
      </span>
    </div>
  `;
}

function renderVisualPreview(tokens: any, packName: string, compact: boolean = false): string {
  const c = tokens.colors;
  const fonts = tokens.fonts;
  const radius = tokens.radius || '8px';

  if (compact) {
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
  const designPackId = payload.design_pack_id || '';
  const tokensSummary = payload.design_tokens_summary || '';
  const filesCount = payload.files_count || 0;
  const dirsCount = payload.directories_count || 0;

  const referenceContext = payload.reference_context || null;
  const styleSourceMode = payload.style_source_mode || 'combine_with_design_pack';
  const hasReferences = referenceContext &&
    ((referenceContext.images || []).length > 0 || (referenceContext.urls || []).length > 0);

  const isTBD = (val: string | number) => !val || val === 'TBD' || val === 0;
  const hasDesignPack = !isTBD(designPack) && designPackId;

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

      ${hasDesignPack ? `
        <div class="design-pack-preview">
          <div class="preview-header">
            <span class="preview-label">Design Style</span>
            <button class="change-style-btn" data-action="change_style">
              \u{1F3A8} Change Style
            </button>
          </div>
          <div class="preview-content">
            <div class="preview-image-container">
              <div class="preview-placeholder" data-pack-id="${escapeHtml(designPackId)}">
                <span class="pack-initial">${escapeHtml(designPack.charAt(0).toUpperCase())}</span>
              </div>
            </div>
            <div class="preview-details">
              <div class="pack-name">${escapeHtml(String(designPack))}</div>
              ${tokensSummary ? `<div class="tokens-summary">${escapeHtml(tokensSummary)}</div>` : ''}
            </div>
          </div>
        </div>
      ` : ''}

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
  const filesCount = payload.files_count || 0;
  const dirsCount = payload.directories_count || 0;

  const referenceContext = payload.reference_context || null;
  const styleSourceMode = payload.style_source_mode || 'combine_with_design_pack';
  const hasReferences = referenceContext &&
    ((referenceContext.images || []).length > 0 || (referenceContext.urls || []).length > 0);

  const referenceTokensSummary = payload.reference_tokens_summary || null;
  const styleOverrides = payload.style_overrides || null;

  const isTBD = (val: string | number) => !val || val === 'TBD' || val === 0;
  const hasDesignPack = !isTBD(designPack) && designPackId;

  const options = payload.options || [];
  const proceedOption = options.find((o: any) => o.action === 'proceed') || { label: 'Proceed', disabled: false };
  const cancelOption = options.find((o: any) => o.action === 'cancel') || { label: 'Cancel', disabled: false };
  const changeStyleOption = options.find((o: any) => o.action === 'change_style');

  const packTokens = getDesignPackTokens(designPackId, styleOverrides);

  return `
    <div class="scaffold-card proposal">
      <div class="header">
        <span class="icon">\u{1F4CB}</span>
        <h3>Scaffold Proposal</h3>
        <span class="badge proposal">Ready to Create</span>
      </div>
      <div class="summary-section">
        <div class="prompt-label">Summary</div>
        <div class="summary-text">${escapeHtml(String(summary))}</div>
      </div>

      ${hasReferences ? renderReferenceSection(referenceContext, styleSourceMode) : ''}

      ${hasDesignPack ? `
        <div class="design-pack-preview">
          <div class="preview-header">
            <span class="preview-label">Design Preview</span>
            ${changeStyleOption && !changeStyleOption.disabled ? `
              <button class="change-style-btn" data-action="change_style">
                \u{1F3A8} ${escapeHtml(changeStyleOption.label || 'Change Style')}
              </button>
            ` : ''}
          </div>
          ${referenceTokensSummary && referenceTokensSummary.confidence >= 0.5 ? renderInfluenceBadge(referenceTokensSummary) : ''}
          ${renderVisualPreview(packTokens, designPack, false)}
          <div class="pack-meta">
            <span class="pack-name-badge">${escapeHtml(String(designPack))}</span>
            ${tokensSummary ? `<span class="tokens-hint">${escapeHtml(tokensSummary)}</span>` : ''}
          </div>
        </div>
      ` : ''}

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

function renderStylePicker(event: ScaffoldEvent, payload: Record<string, any>): string {
  const currentPackId = payload.current_pack_id || '';
  const scaffoldId = payload.scaffold_id || '';

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
        <span class="icon">\u{1F3A8}</span>
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
               data-pack-id="${escapeHtml(pack.id)}">
            <div class="pack-preview" style="background: ${pack.gradient};">
              <span class="pack-letter">${escapeHtml(pack.name.charAt(0))}</span>
            </div>
            <div class="pack-info">
              <div class="pack-title">${escapeHtml(pack.name)}</div>
              <div class="pack-vibe">${escapeHtml(pack.vibe)}</div>
            </div>
            ${currentPackId === pack.id ? '<span class="check-mark">\u2713</span>' : ''}
          </div>
        `).join('')}
      </div>
      <div class="picker-actions">
        <button class="btn-secondary" data-action="cancel_picker">\u2190 Back</button>
      </div>
      <div class="timestamp">${formatTimestamp(event.timestamp || '')}</div>
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
