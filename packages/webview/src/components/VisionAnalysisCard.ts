/**
 * Step 38: Vision Analysis Card
 * 
 * Displays vision analysis status in MissionFeed.
 * Shows: vision_analysis_started, vision_analysis_completed events
 * 
 * IMPORTANT: Never displays raw base64 or full JSON.
 * Shows compact status and summary only.
 */

import type { Event } from '../types';

// Use string template function like other webview components
function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((result, str, i) => result + str + (values[i] ?? ''), '');
}

// ============================================================================
// TYPES
// ============================================================================

interface VisionStartedPayload {
  run_id: string;
  reference_context_id: string;
  images_count: number;
  urls_count: number;
}

interface VisionCompletedPayload {
  run_id: string;
  reference_context_id: string;
  status: 'complete' | 'skipped' | 'error';
  reason?: string;
  duration_ms?: number;
}

// ============================================================================
// VISION ANALYSIS STARTED CARD
// ============================================================================

/**
 * Render vision_analysis_started event
 */
export function renderVisionAnalysisStartedCard(event: Event) {
  const payload = event.payload as unknown as VisionStartedPayload;
  const totalRefs = payload.images_count + payload.urls_count;

  return html`
    <div class="vision-card vision-started">
      <div class="vision-header">
        <span class="vision-icon">🔍</span>
        <span class="vision-title">Analyzing references...</span>
      </div>
      <div class="vision-content">
        <span class="vision-count">${totalRefs} reference(s)</span>
        <span class="vision-spinner"></span>
      </div>
    </div>
    <style>
      .vision-card {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 12px;
        margin: 8px 0;
      }
      .vision-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .vision-icon {
        font-size: 16px;
      }
      .vision-title {
        font-weight: 500;
        color: var(--vscode-foreground);
      }
      .vision-content {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .vision-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid var(--vscode-progressBar-background);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;
}

// ============================================================================
// VISION ANALYSIS COMPLETED CARD
// ============================================================================

/**
 * Render vision_analysis_completed event
 */
export function renderVisionAnalysisCompletedCard(event: Event) {
  const payload = event.payload as unknown as VisionCompletedPayload;
  
  const statusConfig = getStatusConfig(payload.status);
  const durationText = payload.duration_ms 
    ? `${(payload.duration_ms / 1000).toFixed(1)}s`
    : '';

  return html`
    <div class="vision-card vision-completed vision-${payload.status}">
      <div class="vision-header">
        <span class="vision-icon">${statusConfig.icon}</span>
        <span class="vision-title">${statusConfig.title}</span>
        ${durationText ? html`<span class="vision-duration">${durationText}</span>` : ''}
      </div>
      ${payload.reason ? html`
        <div class="vision-reason">${formatReason(payload.reason)}</div>
      ` : ''}
    </div>
    <style>
      .vision-completed {
        border-left: 3px solid var(--status-color, var(--vscode-panel-border));
      }
      .vision-complete {
        --status-color: var(--vscode-terminal-ansiGreen);
      }
      .vision-skipped {
        --status-color: var(--vscode-terminal-ansiYellow);
      }
      .vision-error {
        --status-color: var(--vscode-terminal-ansiRed);
      }
      .vision-duration {
        margin-left: auto;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }
      .vision-reason {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        margin-top: 4px;
      }
    </style>
  `;
}

// ============================================================================
// HELPERS
// ============================================================================

function getStatusConfig(status: string): { icon: string; title: string } {
  switch (status) {
    case 'complete':
      return { icon: '✓', title: 'References analyzed' };
    case 'skipped':
      return { icon: '⏭', title: 'Analysis skipped' };
    case 'error':
      return { icon: '⚠', title: 'Analysis failed' };
    default:
      return { icon: '?', title: 'Unknown status' };
  }
}

function formatReason(reason: string): string {
  const reasons: Record<string, string> = {
    'disabled': 'Vision analysis is disabled in settings',
    'no_images': 'No images to analyze',
    'replay_mode': 'Using cached results (replay mode)',
    'replay_no_cache': 'No cached results available for replay',
    'user_declined': 'User declined analysis',
  };
  return reasons[reason] || reason;
}

// ============================================================================
// CARD FACTORY
// ============================================================================

/**
 * Render vision analysis event
 */
export function renderVisionAnalysisCard(event: Event) {
  if (event.type === 'vision_analysis_started') {
    return renderVisionAnalysisStartedCard(event);
  }
  if (event.type === 'vision_analysis_completed') {
    return renderVisionAnalysisCompletedCard(event);
  }
  return html`<!-- Unknown vision event type -->`;
}
