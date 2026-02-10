/**
 * DesignPreview Component (Step 39)
 * 
 * Renders a visual preview of a design pack using pure CSS/HTML.
 * Shows hero section, component samples, and typography - no images, no network.
 * 
 * CRITICAL RULES:
 * - NO network fetching
 * - Deterministic rendering (<200ms)
 * - UI-only: does NOT affect scaffold files
 * - Uses design tokens for all styling
 */

import { escapeHtml } from '../utils/cardHelpers';

declare class HTMLElement {
  shadowRoot: any;
  attachShadow(init: { mode: 'open' | 'closed' }): any;
  dispatchEvent(event: any): boolean;
  getAttribute(name: string): string | null;
}

declare const customElements: {
  get(name: string): any;
  define(name: string, ctor: any): void;
};

// ============================================================================
// TYPES
// ============================================================================

/**
 * Design tokens structure (matches designPacks.ts)
 */
interface ColorTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  primary_foreground?: string;
  accent_foreground?: string;
  muted_foreground?: string;
}

interface FontTokens {
  heading: string;
  body: string;
}

interface DesignTokens {
  colors: ColorTokens;
  fonts: FontTokens;
  radius: 'sm' | 'md' | 'lg';
  density: 'compact' | 'default' | 'relaxed';
  shadow: 'none' | 'subtle' | 'medium' | 'dramatic';
}

interface DesignPack {
  id: string;
  name: string;
  vibe: string;
  tokens: DesignTokens;
  preview: {
    imageAssetId: string;
    description: string;
  };
}

/**
 * Reference influence summary (Step 38 integration)
 */
interface ReferenceInfluence {
  moods?: string[];
  paletteSummary?: string;
  confidence: number;
}

/**
 * Style overrides from reference tokens
 */
interface StyleOverrides {
  palette?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  shadows?: 'none' | 'subtle' | 'medium' | 'dramatic';
}

/**
 * Preview input data
 */
interface DesignPreviewData {
  designPack: DesignPack;
  referenceInfluence?: ReferenceInfluence;
  styleOverrides?: StyleOverrides;
  componentSystem?: 'shadcn' | 'tailwind-plain' | 'mui' | 'chakra';
  compact?: boolean;
}

// ============================================================================
// DESIGN PREVIEW COMPONENT
// ============================================================================

export class DesignPreview extends HTMLElement {
  private _data: DesignPreviewData | null = null;

  set data(value: DesignPreviewData | null) {
    this._data = value;
    this.render();
  }

  get data(): DesignPreviewData | null {
    return this._data;
  }

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this.render();
  }

  private render(): void {
    if (!this.shadowRoot) return;

    const data = this._data;
    if (!data || !data.designPack) {
      this.shadowRoot.innerHTML = `
        ${this.styles()}
        <div class="preview-placeholder">
          <span class="placeholder-icon">🎨</span>
          <span class="placeholder-text">No design selected</span>
        </div>
      `;
      return;
    }

    const { designPack, referenceInfluence, styleOverrides, compact } = data;
    const tokens = this.applyOverrides(designPack.tokens, styleOverrides);
    const cssVars = this.generateCssVars(tokens);

    this.shadowRoot.innerHTML = `
      ${this.styles()}
      <style>
        :host {
          ${cssVars}
        }
      </style>
      <div class="design-preview ${compact ? 'compact' : 'full'}">
        ${referenceInfluence && referenceInfluence.confidence >= 0.5 ? this.renderInfluenceBadge(referenceInfluence) : ''}
        ${this.renderHeroSection(tokens, compact)}
        ${!compact ? this.renderComponentsRow(tokens) : ''}
        ${!compact ? this.renderTypographyRow(tokens) : ''}
      </div>
    `;
  }

  /**
   * Apply style overrides from reference tokens
   */
  private applyOverrides(tokens: DesignTokens, overrides?: StyleOverrides): DesignTokens {
    if (!overrides) return tokens;

    const merged = JSON.parse(JSON.stringify(tokens)) as DesignTokens;

    // Apply palette overrides
    if (overrides.palette) {
      if (overrides.palette.primary) merged.colors.primary = overrides.palette.primary;
      if (overrides.palette.secondary) merged.colors.secondary = overrides.palette.secondary;
      if (overrides.palette.accent) merged.colors.accent = overrides.palette.accent;
    }

    // Apply radius override
    if (overrides.radius) {
      const radiusMap: Record<string, 'sm' | 'md' | 'lg'> = {
        'none': 'sm',
        'sm': 'sm',
        'md': 'md',
        'lg': 'lg',
        'full': 'lg',
      };
      merged.radius = radiusMap[overrides.radius] || merged.radius;
    }

    // Apply shadow override
    if (overrides.shadows) {
      merged.shadow = overrides.shadows;
    }

    return merged;
  }

  /**
   * Generate CSS variables from tokens
   */
  private generateCssVars(tokens: DesignTokens): string {
    const { colors, fonts, radius, density, shadow } = tokens;

    const radiusMap: Record<string, string> = {
      sm: '4px',
      md: '8px',
      lg: '12px',
    };

    const densityMap: Record<string, { base: string; lg: string }> = {
      compact: { base: '6px', lg: '10px' },
      default: { base: '10px', lg: '16px' },
      relaxed: { base: '14px', lg: '20px' },
    };

    const shadowMap: Record<string, string> = {
      none: 'none',
      subtle: '0 1px 3px rgba(0,0,0,0.1)',
      medium: '0 4px 8px rgba(0,0,0,0.15)',
      dramatic: '0 8px 24px rgba(0,0,0,0.2)',
    };

    return `
      --dp-primary: ${colors.primary};
      --dp-secondary: ${colors.secondary};
      --dp-accent: ${colors.accent};
      --dp-bg: ${colors.background};
      --dp-fg: ${colors.foreground};
      --dp-muted: ${colors.muted};
      --dp-border: ${colors.border};
      --dp-primary-fg: ${colors.primary_foreground || '#ffffff'};
      --dp-accent-fg: ${colors.accent_foreground || '#ffffff'};
      --dp-muted-fg: ${colors.muted_foreground || colors.secondary};
      --dp-font-heading: "${fonts.heading}", system-ui, sans-serif;
      --dp-font-body: "${fonts.body}", system-ui, sans-serif;
      --dp-radius: ${radiusMap[radius]};
      --dp-spacing: ${densityMap[density].base};
      --dp-spacing-lg: ${densityMap[density].lg};
      --dp-shadow: ${shadowMap[shadow]};
    `;
  }

  /**
   * Render influence badge (Step 38 reference tokens)
   */
  private renderInfluenceBadge(influence: ReferenceInfluence): string {
    const confidencePercent = Math.round(influence.confidence * 100);
    const moodTags = influence.moods?.slice(0, 2).join(', ') || 'Custom';

    return `
      <div class="influence-badge">
        <span class="influence-icon">✨</span>
        <span class="influence-text">
          Influenced by references (${confidencePercent}%)
          ${moodTags ? ` · ${escapeHtml(moodTags)}` : ''}
        </span>
      </div>
    `;
  }

  /**
   * Render hero section
   */
  private renderHeroSection(tokens: DesignTokens, compact?: boolean): string {
    return `
      <div class="hero-section">
        <div class="hero-content">
          <h1 class="hero-headline">Build Something Great</h1>
          ${!compact ? '<p class="hero-subtext">Modern, fast, and beautiful applications.</p>' : ''}
          <button class="hero-cta">Get Started</button>
        </div>
        <div class="hero-decoration">
          ${this.renderDecorationShapes(tokens)}
        </div>
      </div>
    `;
  }

  /**
   * Render decorative shapes using design tokens
   */
  private renderDecorationShapes(tokens: DesignTokens): string {
    return `
      <div class="shape shape-1"></div>
      <div class="shape shape-2"></div>
      <div class="shape shape-3"></div>
    `;
  }

  /**
   * Render component samples row
   */
  private renderComponentsRow(tokens: DesignTokens): string {
    return `
      <div class="components-row">
        <div class="component-label">Components</div>
        <div class="components-grid">
          ${this.renderButtonSample()}
          ${this.renderInputSample()}
          ${this.renderCardSample()}
        </div>
      </div>
    `;
  }

  /**
   * Render button sample
   */
  private renderButtonSample(): string {
    return `
      <div class="component-item">
        <button class="sample-btn primary">Primary</button>
        <button class="sample-btn secondary">Secondary</button>
      </div>
    `;
  }

  /**
   * Render input sample
   */
  private renderInputSample(): string {
    return `
      <div class="component-item">
        <input type="text" class="sample-input" placeholder="Email address" />
      </div>
    `;
  }

  /**
   * Render card sample
   */
  private renderCardSample(): string {
    return `
      <div class="component-item">
        <div class="sample-card">
          <div class="card-header">Card Title</div>
          <div class="card-body">Content preview</div>
        </div>
      </div>
    `;
  }

  /**
   * Render typography samples row
   */
  private renderTypographyRow(tokens: DesignTokens): string {
    return `
      <div class="typography-row">
        <div class="component-label">Typography</div>
        <div class="typography-samples">
          <span class="typo-h1">H1</span>
          <span class="typo-h2">H2</span>
          <span class="typo-body">Body</span>
          <span class="typo-mono">mono</span>
        </div>
      </div>
    `;
  }

  /**
   * Generate component styles
   */
  private styles(): string {
    return `
      <style>
        :host {
          display: block;
          --dp-primary: #3b82f6;
          --dp-secondary: #64748b;
          --dp-accent: #8b5cf6;
          --dp-bg: #ffffff;
          --dp-fg: #1e293b;
          --dp-muted: #f1f5f9;
          --dp-border: #e2e8f0;
          --dp-primary-fg: #ffffff;
          --dp-accent-fg: #ffffff;
          --dp-muted-fg: #64748b;
          --dp-font-heading: Inter, system-ui, sans-serif;
          --dp-font-body: Inter, system-ui, sans-serif;
          --dp-radius: 8px;
          --dp-spacing: 10px;
          --dp-spacing-lg: 16px;
          --dp-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }

        .preview-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 120px;
          background: var(--vscode-input-background);
          border-radius: 8px;
          border: 1px dashed var(--vscode-panel-border);
        }

        .placeholder-icon {
          font-size: 24px;
          margin-bottom: 8px;
        }

        .placeholder-text {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }

        .design-preview {
          border-radius: 8px;
          overflow: hidden;
          background: var(--dp-bg);
          border: 1px solid var(--dp-border);
          box-shadow: var(--dp-shadow);
        }

        .design-preview.compact {
          max-height: 80px;
        }

        .design-preview.full {
          min-height: 180px;
        }

        /* Influence Badge */
        .influence-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: linear-gradient(90deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%);
          border-bottom: 1px solid var(--dp-border);
          font-size: 10px;
        }

        .influence-icon {
          font-size: 12px;
        }

        .influence-text {
          color: var(--dp-fg);
          font-family: var(--dp-font-body);
        }

        /* Hero Section */
        .hero-section {
          position: relative;
          padding: var(--dp-spacing-lg);
          background: linear-gradient(135deg, var(--dp-bg) 0%, var(--dp-muted) 100%);
          overflow: hidden;
        }

        .hero-content {
          position: relative;
          z-index: 2;
        }

        .hero-headline {
          margin: 0 0 4px 0;
          font-family: var(--dp-font-heading);
          font-size: 14px;
          font-weight: 700;
          color: var(--dp-fg);
          letter-spacing: -0.02em;
        }

        .compact .hero-headline {
          font-size: 12px;
        }

        .hero-subtext {
          margin: 0 0 8px 0;
          font-family: var(--dp-font-body);
          font-size: 10px;
          color: var(--dp-muted-fg);
        }

        .hero-cta {
          display: inline-block;
          padding: 4px 12px;
          background: var(--dp-primary);
          color: var(--dp-primary-fg);
          border: none;
          border-radius: var(--dp-radius);
          font-family: var(--dp-font-body);
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .compact .hero-cta {
          padding: 3px 8px;
          font-size: 9px;
        }

        /* Hero Decoration */
        .hero-decoration {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 50%;
          overflow: hidden;
          z-index: 1;
        }

        .shape {
          position: absolute;
          border-radius: 50%;
          opacity: 0.15;
        }

        .shape-1 {
          width: 60px;
          height: 60px;
          top: -10px;
          right: 10px;
          background: var(--dp-primary);
        }

        .shape-2 {
          width: 40px;
          height: 40px;
          top: 30px;
          right: 50px;
          background: var(--dp-accent);
        }

        .shape-3 {
          width: 30px;
          height: 30px;
          bottom: 10px;
          right: 20px;
          background: var(--dp-secondary);
        }

        .compact .shape {
          transform: scale(0.6);
        }

        /* Components Row */
        .components-row {
          padding: var(--dp-spacing);
          border-top: 1px solid var(--dp-border);
          background: var(--dp-bg);
        }

        .component-label {
          font-family: var(--dp-font-body);
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--dp-muted-fg);
          margin-bottom: 6px;
          letter-spacing: 0.5px;
        }

        .components-grid {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .component-item {
          display: flex;
          gap: 4px;
          align-items: center;
        }

        /* Sample Button */
        .sample-btn {
          padding: 3px 8px;
          border: none;
          border-radius: calc(var(--dp-radius) * 0.5);
          font-family: var(--dp-font-body);
          font-size: 9px;
          font-weight: 600;
          cursor: pointer;
        }

        .sample-btn.primary {
          background: var(--dp-primary);
          color: var(--dp-primary-fg);
        }

        .sample-btn.secondary {
          background: var(--dp-muted);
          color: var(--dp-fg);
          border: 1px solid var(--dp-border);
        }

        /* Sample Input */
        .sample-input {
          padding: 3px 8px;
          border: 1px solid var(--dp-border);
          border-radius: calc(var(--dp-radius) * 0.5);
          background: var(--dp-bg);
          color: var(--dp-fg);
          font-family: var(--dp-font-body);
          font-size: 9px;
          width: 80px;
        }

        .sample-input::placeholder {
          color: var(--dp-muted-fg);
        }

        /* Sample Card */
        .sample-card {
          padding: 6px 8px;
          border: 1px solid var(--dp-border);
          border-radius: var(--dp-radius);
          background: var(--dp-bg);
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          min-width: 60px;
        }

        .card-header {
          font-family: var(--dp-font-heading);
          font-size: 9px;
          font-weight: 600;
          color: var(--dp-fg);
          margin-bottom: 2px;
        }

        .card-body {
          font-family: var(--dp-font-body);
          font-size: 8px;
          color: var(--dp-muted-fg);
        }

        /* Typography Row */
        .typography-row {
          padding: var(--dp-spacing);
          border-top: 1px solid var(--dp-border);
          background: var(--dp-muted);
        }

        .typography-samples {
          display: flex;
          gap: 12px;
          align-items: baseline;
        }

        .typo-h1 {
          font-family: var(--dp-font-heading);
          font-size: 14px;
          font-weight: 700;
          color: var(--dp-fg);
        }

        .typo-h2 {
          font-family: var(--dp-font-heading);
          font-size: 12px;
          font-weight: 600;
          color: var(--dp-fg);
        }

        .typo-body {
          font-family: var(--dp-font-body);
          font-size: 10px;
          color: var(--dp-fg);
        }

        .typo-mono {
          font-family: 'SF Mono', Consolas, monospace;
          font-size: 9px;
          color: var(--dp-muted-fg);
          background: var(--dp-bg);
          padding: 2px 4px;
          border-radius: 3px;
        }
      </style>
    `;
  }

}

// Register custom element
if (!customElements.get('design-preview')) {
  customElements.define('design-preview', DesignPreview);
}

// ============================================================================
// MINI PREVIEW FOR STYLE PICKER
// ============================================================================

/**
 * MiniDesignPreview - Compact preview for style picker gallery
 * Shows just hero section in a small card
 */
export class MiniDesignPreview extends HTMLElement {
  private _data: DesignPreviewData | null = null;

  set data(value: DesignPreviewData | null) {
    this._data = value;
    this.render();
  }

  get data(): DesignPreviewData | null {
    return this._data;
  }

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this.render();
  }

  private render(): void {
    if (!this.shadowRoot) return;

    const data = this._data;
    if (!data || !data.designPack) {
      this.shadowRoot.innerHTML = `
        ${this.styles()}
        <div class="mini-placeholder">🎨</div>
      `;
      return;
    }

    const { designPack } = data;
    const tokens = designPack.tokens;
    const { colors } = tokens;

    // Generate gradient based on primary/accent
    const gradient = `linear-gradient(135deg, ${colors.background} 0%, ${colors.muted} 50%, ${colors.primary}22 100%)`;

    this.shadowRoot.innerHTML = `
      ${this.styles()}
      <div class="mini-preview" style="background: ${gradient}; border-color: ${colors.border};">
        <div class="mini-content">
          <div class="mini-headline" style="color: ${colors.foreground}; font-family: '${tokens.fonts.heading}', sans-serif;">
            Preview
          </div>
          <div class="mini-btn" style="background: ${colors.primary}; color: ${colors.primary_foreground || '#fff'};">
            Button
          </div>
        </div>
        <div class="mini-shapes">
          <div class="mini-shape s1" style="background: ${colors.primary};"></div>
          <div class="mini-shape s2" style="background: ${colors.accent};"></div>
        </div>
      </div>
    `;
  }

  private styles(): string {
    return `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
        }

        .mini-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          background: var(--vscode-input-background);
          border-radius: 6px;
          font-size: 16px;
        }

        .mini-preview {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 6px;
          border: 1px solid;
          overflow: hidden;
          box-sizing: border-box;
        }

        .mini-content {
          position: relative;
          z-index: 2;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .mini-headline {
          font-size: 9px;
          font-weight: 700;
        }

        .mini-btn {
          display: inline-block;
          width: fit-content;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 7px;
          font-weight: 600;
        }

        .mini-shapes {
          position: absolute;
          top: 0;
          right: 0;
          width: 50%;
          height: 100%;
          overflow: hidden;
          z-index: 1;
        }

        .mini-shape {
          position: absolute;
          border-radius: 50%;
          opacity: 0.2;
        }

        .s1 {
          width: 20px;
          height: 20px;
          top: 2px;
          right: 4px;
        }

        .s2 {
          width: 14px;
          height: 14px;
          top: 18px;
          right: 16px;
        }
      </style>
    `;
  }
}

// Register mini preview
if (!customElements.get('mini-design-preview')) {
  customElements.define('mini-design-preview', MiniDesignPreview);
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Type guard for design preview events
 */
export function isDesignPreviewEvent(eventType: string): boolean {
  return eventType.startsWith('design_preview_');
}

declare global {
  interface HTMLElementTagNameMap {
    'design-preview': DesignPreview;
    'mini-design-preview': MiniDesignPreview;
  }
}
