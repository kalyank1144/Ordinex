/**
 * Step 38: Reference Tokens Card
 * 
 * Displays extracted reference tokens in MissionFeed.
 * Shows: reference_tokens_extracted, reference_tokens_used events
 * 
 * IMPORTANT: Shows compact palette chips + moods + confidence only.
 * Never displays raw base64 or full JSON.
 */

import type { Event } from '../types';

// Use string template function like other webview components
function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((result, str, i) => result + str + (values[i] ?? ''), '');
}

// ============================================================================
// TYPES
// ============================================================================

interface ReferenceTokensExtractedPayload {
  run_id: string;
  reference_context_id: string;
  evidence_ref?: string;
  palette_summary?: string;
  moods?: string[];
  confidence: number;
  warnings?: string[];
  tokens_summary?: string;
  overrides_applied?: boolean;
}

interface ReferenceTokensUsedPayload {
  run_id: string;
  reference_context_id?: string;
  used_in: 'scaffold_proposal' | 'quick_action' | 'plan';
  mode: 'use_reference' | 'combine' | 'ignore';
  design_pack_id?: string;
  overrides_applied: boolean;
}

// ============================================================================
// REFERENCE TOKENS EXTRACTED CARD
// ============================================================================

/**
 * Render reference_tokens_extracted event
 * Shows palette chips + moods + confidence compactly
 */
export function renderReferenceTokensExtractedCard(event: Event): string {
  const payload = event.payload as unknown as ReferenceTokensExtractedPayload;
  const confidence = Math.round((payload.confidence || 0) * 100);
  const moods = payload.moods || [];
  const warnings = payload.warnings || [];
  const paletteSummary = payload.palette_summary || '';

  // Parse palette colors from summary (format: "#1a1a1a, #3b82f6")
  const paletteColors = paletteSummary
    .split(',')
    .map(c => c.trim())
    .filter(c => c.startsWith('#'));

  const confidenceClass = confidence >= 70 ? 'high' : confidence >= 50 ? 'medium' : 'low';

  return html`
    <div class="tokens-card">
      <div class="tokens-header">
        <span class="tokens-icon">🎨</span>
        <span class="tokens-title">Style Tokens Extracted</span>
        <span class="confidence-badge ${confidenceClass}">${confidence}%</span>
      </div>
      
      ${paletteColors.length > 0 ? html`
        <div class="palette-section">
          <span class="section-label">Palette</span>
          <div class="color-chips">
            ${paletteColors.map(color => html`
              <div class="color-chip" style="background: ${escapeHtml(color)};" title="${escapeHtml(color)}">
                <span class="color-code">${escapeHtml(color)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      ${moods.length > 0 ? html`
        <div class="moods-section">
          <span class="section-label">Style Moods</span>
          <div class="mood-tags">
            ${moods.slice(0, 5).map(mood => html`
              <span class="mood-tag">${escapeHtml(mood)}</span>
            `).join('')}
            ${moods.length > 5 ? html`<span class="mood-more">+${moods.length - 5}</span>` : ''}
          </div>
        </div>
      ` : ''}
      
      ${warnings.length > 0 ? html`
        <div class="warnings-section">
          ${warnings.map(w => html`
            <div class="warning-item">
              <span class="warning-icon">⚠️</span>
              <span class="warning-text">${escapeHtml(formatWarning(w))}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${payload.tokens_summary ? html`
        <div class="summary-text">${escapeHtml(payload.tokens_summary)}</div>
      ` : ''}
    </div>
    <style>
      .tokens-card {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-left: 3px solid #a855f7;
        border-radius: 6px;
        padding: 12px;
        margin: 8px 0;
      }
      .tokens-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }
      .tokens-icon {
        font-size: 16px;
      }
      .tokens-title {
        font-weight: 500;
        color: var(--vscode-foreground);
        flex: 1;
        font-size: 13px;
      }
      .confidence-badge {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
      }
      .confidence-badge.high {
        background: rgba(34, 197, 94, 0.2);
        color: #22c55e;
      }
      .confidence-badge.medium {
        background: rgba(250, 204, 21, 0.2);
        color: #facc15;
      }
      .confidence-badge.low {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
      }
      
      .section-label {
        font-size: 10px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 6px;
        display: block;
      }
      
      .palette-section {
        margin-bottom: 10px;
      }
      .color-chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .color-chip {
        width: 32px;
        height: 24px;
        border-radius: 4px;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        position: relative;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        cursor: default;
      }
      .color-code {
        font-size: 8px;
        font-family: monospace;
        color: white;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        padding: 1px 2px;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .color-chip:hover .color-code {
        opacity: 1;
      }
      
      .moods-section {
        margin-bottom: 10px;
      }
      .mood-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .mood-tag {
        padding: 3px 8px;
        background: rgba(168, 85, 247, 0.15);
        color: #a855f7;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
      }
      .mood-more {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        align-self: center;
      }
      
      .warnings-section {
        margin-top: 8px;
      }
      .warning-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: rgba(250, 204, 21, 0.1);
        border-radius: 4px;
        margin-bottom: 4px;
      }
      .warning-icon {
        font-size: 12px;
      }
      .warning-text {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      
      .summary-text {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 8px;
        font-family: monospace;
        padding: 6px 8px;
        background: var(--vscode-input-background);
        border-radius: 4px;
      }
    </style>
  `;
}

// ============================================================================
// REFERENCE TOKENS USED CARD
// ============================================================================

/**
 * Render reference_tokens_used event
 * Shows how tokens influenced the outcome
 */
export function renderReferenceTokensUsedCard(event: Event): string {
  const payload = event.payload as unknown as ReferenceTokensUsedPayload;
  const usedIn = payload.used_in || 'scaffold_proposal';
  const mode = payload.mode || 'combine';
  const designPackId = payload.design_pack_id || '';
  const overridesApplied = payload.overrides_applied || false;

  const usedInLabels: Record<string, string> = {
    'scaffold_proposal': 'Scaffold Design',
    'quick_action': 'Quick Action',
    'plan': 'Plan Generation',
  };

  const modeLabels: Record<string, { label: string; icon: string }> = {
    'use_reference': { label: 'Reference-based', icon: '🎯' },
    'combine': { label: 'Combined', icon: '🔀' },
    'ignore': { label: 'Ignored', icon: '⏭️' },
  };

  const modeInfo = modeLabels[mode] || { label: mode, icon: '?' };

  return html`
    <div class="tokens-used-card">
      <div class="tokens-used-header">
        <span class="tokens-used-icon">${modeInfo.icon}</span>
        <span class="tokens-used-title">Reference Style Applied</span>
        <span class="used-in-badge">${escapeHtml(usedInLabels[usedIn] || usedIn)}</span>
      </div>
      <div class="tokens-used-content">
        <div class="mode-info">
          <span class="mode-label">Mode:</span>
          <span class="mode-value">${escapeHtml(modeInfo.label)}</span>
        </div>
        ${designPackId ? html`
          <div class="pack-info">
            <span class="pack-label">Design Pack:</span>
            <span class="pack-value">${escapeHtml(designPackId)}</span>
          </div>
        ` : ''}
        <div class="overrides-info">
          <span class="overrides-icon">${overridesApplied ? '✅' : '➖'}</span>
          <span class="overrides-text">
            ${overridesApplied ? 'Style overrides applied' : 'Using default pack styles'}
          </span>
        </div>
      </div>
    </div>
    <style>
      .tokens-used-card {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-left: 3px solid #22c55e;
        border-radius: 6px;
        padding: 12px;
        margin: 8px 0;
      }
      .tokens-used-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .tokens-used-icon {
        font-size: 16px;
      }
      .tokens-used-title {
        font-weight: 500;
        color: var(--vscode-foreground);
        flex: 1;
        font-size: 13px;
      }
      .used-in-badge {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: 500;
        background: rgba(34, 197, 94, 0.2);
        color: #22c55e;
        text-transform: uppercase;
      }
      
      .tokens-used-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .mode-info, .pack-info {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
      }
      .mode-label, .pack-label {
        color: var(--vscode-descriptionForeground);
      }
      .mode-value, .pack-value {
        color: var(--vscode-foreground);
        font-weight: 500;
      }
      .overrides-info {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        padding: 4px 8px;
        background: var(--vscode-input-background);
        border-radius: 4px;
        margin-top: 4px;
      }
      .overrides-icon {
        font-size: 12px;
      }
      .overrides-text {
        color: var(--vscode-descriptionForeground);
      }
    </style>
  `;
}

// ============================================================================
// HELPERS
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatWarning(warning: string): string {
  const warningLabels: Record<string, string> = {
    'url_not_fetched': 'URLs were not fetched (only domain/path analyzed)',
    'max_images_exceeded': 'Maximum images limit reached',
    'max_total_upload_exceeded_dropped_images': 'Upload limit exceeded, some images dropped',
    'invalid_json': 'Vision response parsing failed',
    'low_confidence': 'Low confidence in extracted styles',
  };
  return warningLabels[warning] || warning;
}

// ============================================================================
// CARD FACTORY
// ============================================================================

/**
 * Render reference tokens event
 */
export function renderReferenceTokensCard(event: Event): string {
  if (event.type === 'reference_tokens_extracted') {
    return renderReferenceTokensExtractedCard(event);
  }
  if (event.type === 'reference_tokens_used') {
    return renderReferenceTokensUsedCard(event);
  }
  return html`<!-- Unknown reference tokens event type -->`;
}

/**
 * Check if an event type is a reference tokens event
 */
export function isReferenceTokensEvent(eventType: string): boolean {
  return [
    'reference_tokens_extracted',
    'reference_tokens_used',
  ].includes(eventType);
}
