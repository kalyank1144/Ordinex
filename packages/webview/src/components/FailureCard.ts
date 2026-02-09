/**
 * FailureCard Component - Step 49: Error Recovery UX
 *
 * Rich error recovery card rendering for failure events.
 * Shows: title, human-friendly message, suggestion, file references,
 * failing tests, raw error (collapsed), and action buttons.
 *
 * The card merges information from two sources:
 * 1. ErrorDescriptor from failureClassifier.ts (primary - controls actions)
 * 2. ErrorPatternMatch from errorPatterns.ts (supplementary - UX polish)
 *
 * Stateless rendering function — all data comes from the event payload.
 */

import { Event } from '../types';

// ============================================================================
// TYPES (mirrored from core for webview independence)
// ============================================================================

interface RecoveryAction {
  id: string;
  label: string;
  type: 'retry' | 'alternative' | 'checkpoint' | 'manual' | 'command';
  command?: string;
  disabled?: boolean;
  tooltip?: string;
}

interface ErrorPatternMatch {
  pattern_id: string;
  category: string;
  title: string;
  message: string;
  suggestion: string;
  actions: RecoveryAction[];
}

interface ErrorDescriptorLike {
  category?: string;
  retryable?: boolean;
  suggested_action?: string;
  user_message?: string;
  code?: string;
  developer_details?: {
    raw_error?: string;
    stack_preview?: string;
    context?: Record<string, unknown>;
  };
}

// ============================================================================
// RENDERING
// ============================================================================

/**
 * Render a rich failure card with recovery actions.
 *
 * @param event - The failure event (failure_detected, failure_classified, etc.)
 * @param errorMatch - Optional pattern match (from errorPatterns.matchErrorPattern)
 * @param descriptor - Optional error descriptor (from failureClassifier.classifyError)
 * @param actions - Pre-merged recovery actions (from mergeRecoveryActions)
 */
export function renderFailureCard(
  event: Event,
  errorMatch?: ErrorPatternMatch | null,
  descriptor?: ErrorDescriptorLike | null,
  actions?: RecoveryAction[]
): string {
  // Derive display values with graceful fallbacks
  const title = errorMatch?.title
    || getCategoryTitle(descriptor?.category)
    || getEventTitle(event);

  const message = errorMatch?.message
    || descriptor?.user_message
    || extractErrorMessage(event);

  const suggestion = errorMatch?.suggestion || '';

  const category = errorMatch?.category
    || descriptor?.category?.toLowerCase()
    || '';

  const retryable = descriptor?.retryable ?? false;

  const rawError = descriptor?.developer_details?.raw_error
    || (event.payload.error as string)
    || (event.payload.reason as string)
    || '';

  const fileReferences = extractFileReferences(event);
  const failingTests = extractFailingTests(event);
  const recoveryActions = actions || [];

  const categoryColor = getCategoryColor(category);
  const categoryIcon = getCategoryIcon(category);

  return `
    <div class="failure-card" style="
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 2px solid var(--vscode-charts-red);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    ">
      <!-- Header -->
      <div style="
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      ">
        <span style="font-size: 18px;">${categoryIcon}</span>
        <span style="font-weight: 700; color: var(--vscode-charts-red);">
          ${escapeHtml(title)}
        </span>
        ${category ? `
          <span style="
            margin-left: 8px;
            padding: 2px 6px;
            font-size: 9px;
            font-weight: 600;
            border-radius: 3px;
            background: ${categoryColor};
            color: #fff;
            text-transform: uppercase;
          ">${escapeHtml(category)}</span>
        ` : ''}
        ${retryable ? `
          <span style="
            padding: 2px 6px;
            font-size: 9px;
            font-weight: 600;
            border-radius: 3px;
            background: var(--vscode-charts-green);
            color: #fff;
          ">RETRYABLE</span>
        ` : ''}
        <span style="
          margin-left: auto;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
        ">${formatTimestamp(event.timestamp)}</span>
      </div>

      <!-- Message -->
      <div style="
        font-size: 12px;
        color: var(--vscode-foreground);
        margin-bottom: 8px;
        line-height: 1.4;
      ">
        ${escapeHtml(truncate(message, 500))}
      </div>

      ${suggestion ? `
        <!-- Suggestion -->
        <div style="
          font-size: 11px;
          color: var(--vscode-charts-blue);
          margin-bottom: 8px;
          padding: 6px 8px;
          background: var(--vscode-textCodeBlock-background);
          border-radius: 3px;
        ">
          <strong>Suggestion:</strong> ${escapeHtml(suggestion)}
        </div>
      ` : ''}

      ${fileReferences.length > 0 ? `
        <!-- File References -->
        <div style="
          font-size: 11px;
          margin-bottom: 8px;
          color: var(--vscode-descriptionForeground);
        ">
          <strong>Files:</strong>
          ${fileReferences.map(f => `
            <span onclick="handleOpenFile('${escapeAttr(f)}')" style="
              cursor: pointer;
              text-decoration: underline;
              color: var(--vscode-textLink-foreground);
              margin-left: 4px;
            ">${escapeHtml(f)}</span>
          `).join(', ')}
        </div>
      ` : ''}

      ${failingTests.length > 0 ? `
        <!-- Failing Tests -->
        <div style="
          font-size: 11px;
          margin-bottom: 8px;
          color: var(--vscode-descriptionForeground);
        ">
          <strong>Failing tests:</strong>
          <ul style="margin: 4px 0 0 18px; padding: 0;">
            ${failingTests.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${rawError ? `
        <!-- Raw Error (collapsed) -->
        <details style="
          margin-bottom: 8px;
          font-size: 11px;
        ">
          <summary style="
            cursor: pointer;
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
          ">Raw Error</summary>
          <pre style="
            margin-top: 4px;
            padding: 8px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 3px;
            white-space: pre-wrap;
            word-break: break-all;
            font-size: 10px;
            max-height: 200px;
            overflow-y: auto;
            color: var(--vscode-foreground);
          ">${escapeHtml(truncate(rawError, 2000))}</pre>
        </details>
      ` : ''}

      ${recoveryActions.length > 0 ? `
        <!-- Action Buttons -->
        <div style="
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid var(--vscode-panel-border);
        ">
          ${recoveryActions.map(action => renderActionButton(action, event.event_id)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ============================================================================
// ACTION BUTTON RENDERING
// ============================================================================

function renderActionButton(action: RecoveryAction, eventId: string): string {
  const isDisabled = action.disabled === true;
  const tooltipAttr = action.tooltip ? `title="${escapeAttr(action.tooltip)}"` : '';
  const bgColor = getActionBgColor(action.type);
  const fgColor = getActionFgColor(action.type);

  return `
    <button
      onclick="${isDisabled ? '' : `handleRecoveryAction('${escapeAttr(action.id)}', '${escapeAttr(eventId)}', '${escapeAttr(action.command || '')}')`}"
      ${tooltipAttr}
      ${isDisabled ? 'disabled' : ''}
      style="
        padding: 4px 10px;
        font-size: 11px;
        background: ${bgColor};
        color: ${fgColor};
        border: 1px solid ${isDisabled ? 'var(--vscode-disabledForeground)' : 'var(--vscode-button-border, transparent)'};
        border-radius: 3px;
        cursor: ${isDisabled ? 'not-allowed' : 'pointer'};
        opacity: ${isDisabled ? '0.5' : '1'};
      "
    >${escapeHtml(action.label)}</button>
  `;
}

function getActionBgColor(type: string): string {
  switch (type) {
    case 'retry': return 'var(--vscode-button-background)';
    case 'alternative': return 'var(--vscode-button-secondaryBackground)';
    case 'checkpoint': return 'var(--vscode-button-secondaryBackground)';
    case 'command': return 'var(--vscode-button-secondaryBackground)';
    case 'manual': return 'var(--vscode-button-secondaryBackground)';
    default: return 'var(--vscode-button-secondaryBackground)';
  }
}

function getActionFgColor(type: string): string {
  switch (type) {
    case 'retry': return 'var(--vscode-button-foreground)';
    default: return 'var(--vscode-button-secondaryForeground)';
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function getCategoryTitle(category?: string): string {
  if (!category) return '';
  const titles: Record<string, string> = {
    'USER_INPUT': 'Input Error',
    'WORKSPACE_STATE': 'Workspace Error',
    'LLM_TRUNCATION': 'Output Truncated',
    'LLM_OUTPUT_INVALID': 'Invalid Response',
    'TOOL_FAILURE': 'Tool Failure',
    'APPLY_CONFLICT': 'Apply Conflict',
    'VERIFY_FAILURE': 'Verification Failed',
    'NETWORK_TRANSIENT': 'Network Error',
    'RATE_LIMIT': 'Rate Limited',
    'PERMISSION': 'Permission Denied',
    'INTERNAL_BUG': 'Unexpected Error',
  };
  return titles[category] || '';
}

function getEventTitle(event: Event): string {
  switch (event.type) {
    case 'failure_detected': return 'Failure Detected';
    case 'failure_classified': return 'Failure Classified';
    case 'step_failed': return 'Step Failed';
    case 'iteration_failed': return 'Iteration Failed';
    case 'test_failed': return 'Test Failed';
    default: return 'Error';
  }
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'module_resolution': '#3B82F6',
    'typescript': '#6366F1',
    'runtime': '#EF4444',
    'permissions': '#F59E0B',
    'filesystem': '#F59E0B',
    'network': '#8B5CF6',
    'process': '#EC4899',
    'build': '#F97316',
    'test': '#EF4444',
  };
  return colors[category] || 'var(--vscode-charts-red)';
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    'module_resolution': '📦',
    'typescript': '🔵',
    'runtime': '💥',
    'permissions': '🔒',
    'filesystem': '📂',
    'network': '🌐',
    'process': '⚙️',
    'build': '🏗️',
    'test': '🧪',
  };
  return icons[category] || '❌';
}

function extractErrorMessage(event: Event): string {
  const error = event.payload.error as string | undefined;
  const reason = event.payload.reason as string | undefined;
  const details = event.payload.details as Record<string, unknown> | undefined;
  const detailsMessage = details?.message as string | undefined;

  return error || detailsMessage || reason || 'An error occurred';
}

function extractFileReferences(event: Event): string[] {
  const files = event.payload.file_references as string[] | undefined;
  if (files && Array.isArray(files)) return files.slice(0, 10);

  // Try to extract from error text
  const errorText = (event.payload.error as string) || '';
  const pattern = /([a-zA-Z0-9_\-.\/]+\.(?:ts|tsx|js|jsx|mjs|cjs))(?::(\d+))?/g;
  const found = new Set<string>();
  let match;
  while ((match = pattern.exec(errorText)) !== null) {
    if (!match[0].includes('node_modules')) {
      found.add(match[0]);
    }
    if (found.size >= 5) break;
  }
  return Array.from(found);
}

function extractFailingTests(event: Event): string[] {
  const tests = event.payload.failing_tests as string[] | undefined;
  if (tests && Array.isArray(tests)) return tests.slice(0, 5);
  return [];
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}
