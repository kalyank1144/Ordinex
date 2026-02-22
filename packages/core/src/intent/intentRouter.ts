/**
 * Intent Router — Workspace-Aware Scaffold Detection + Pass-Through
 *
 * Simplified routing: only two intents exist:
 *   SCAFFOLD — create a new project from scratch
 *   AGENT    — everything else (user's selected mode determines behavior)
 *
 * The old 10-step pipeline with LLM classification, command detection,
 * edit-scale analysis, and confidence thresholds is gone. The LLM itself,
 * guided by its system prompt, decides how to handle any non-scaffold request.
 */

import {
  detectGreenfieldIntent,
  detectSlashOverride,
  IntentSignal,
} from './intentSignals';

// ============================================================================
// TYPES
// ============================================================================

export type RoutedIntent = 'SCAFFOLD' | 'AGENT';

export type RoutingSource = 'slash' | 'heuristic' | 'passthrough';

export interface IntentRoutingResult {
  intent: RoutedIntent;
  source: RoutingSource;
  confidence: number;
  reasoning: string;
}

export interface WorkspaceState {
  fileCount: number;
  hasPackageJson: boolean;
  hasGitRepo: boolean;
}

export interface RoutingContext {
  workspace?: WorkspaceState;
}

// ============================================================================
// MAIN ROUTING FUNCTION
// ============================================================================

/**
 * Route user intent: scaffold detection + pass-through.
 *
 * 1. Slash override (power users: /scaffold)
 * 2. Workspace-aware greenfield check
 * 3. Pass through to user's selected mode
 */
export async function routeIntent(
  input: string,
  context: RoutingContext = {},
): Promise<IntentRoutingResult> {
  const text = input.trim();
  const LOG = '[IntentRouter]';

  // 1. Slash override — always wins
  const slashOverride = detectSlashOverride(text);
  if (slashOverride === 'scaffold') {
    console.log(`${LOG} Slash override → SCAFFOLD`);
    return {
      intent: 'SCAFFOLD',
      source: 'slash',
      confidence: 1.0,
      reasoning: 'Slash override: /scaffold',
    };
  }

  // 2. Workspace-aware scaffold detection
  const ws = context.workspace;
  const greenfield = detectGreenfieldIntent(text);

  console.log(`${LOG} Greenfield detection:`, {
    isMatch: greenfield.isMatch,
    confidence: greenfield.confidence,
    reason: greenfield.reason,
    matchedKeywords: greenfield.matchedKeywords,
  });
  console.log(`${LOG} Workspace state:`, ws ?? 'undefined (no workspace info)');

  if (ws) {
    if (ws.hasPackageJson || ws.fileCount > 10) {
      console.log(`${LOG} QUICK REJECT → AGENT (hasPackageJson=${ws.hasPackageJson}, fileCount=${ws.fileCount})`);
      return {
        intent: 'AGENT',
        source: 'passthrough',
        confidence: 1.0,
        reasoning: 'Workspace has project files — use /scaffold to create a new project',
      };
    }

    if (ws.fileCount <= 3 && greenfield.isMatch && greenfield.confidence >= 0.6) {
      console.log(`${LOG} Empty workspace + greenfield → SCAFFOLD`);
      return {
        intent: 'SCAFFOLD',
        source: 'heuristic',
        confidence: greenfield.confidence,
        reasoning: `Empty workspace + greenfield intent: ${greenfield.reason}`,
      };
    }
  } else {
    if (greenfield.isMatch && greenfield.confidence >= 0.8) {
      console.log(`${LOG} No workspace info + high confidence greenfield → SCAFFOLD`);
      return {
        intent: 'SCAFFOLD',
        source: 'heuristic',
        confidence: greenfield.confidence,
        reasoning: `Greenfield detected: ${greenfield.reason}`,
      };
    }
  }

  // 3. Pass through — user's selected mode determines the handler
  console.log(`${LOG} Pass through → AGENT`);
  return {
    intent: 'AGENT',
    source: 'passthrough',
    confidence: 1.0,
    reasoning: 'No scaffold intent — pass through to user mode',
  };
}
