/**
 * Intent Router — Workspace-Aware Routing
 *
 * Two intents:
 *   SCAFFOLD — create a new project from scratch
 *   AGENT    — everything else (user's selected mode determines behavior)
 *
 * Routing logic:
 *   1. /scaffold slash override → SCAFFOLD (always)
 *   2. Workspace has project files → AGENT (pure filesystem check)
 *   3. Workspace is empty + llmClassify provided → LLM decides BUILD vs QUESTION
 *   4. Workspace is empty + no llmClassify → fall back to heuristic greenfield detector
 */

import {
  detectGreenfieldIntent,
  detectSlashOverride,
} from './intentSignals';

// ============================================================================
// TYPES
// ============================================================================

export type RoutedIntent = 'SCAFFOLD' | 'AGENT';

export type RoutingSource = 'slash' | 'llm' | 'heuristic' | 'passthrough';

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
  /** LLM-based classifier for empty workspaces. Returns 'BUILD' or 'QUESTION'. */
  llmClassify?: (prompt: string) => Promise<'BUILD' | 'QUESTION'>;
}

// ============================================================================
// MAIN ROUTING FUNCTION
// ============================================================================

/**
 * Route user intent.
 *
 * 1. Slash override (/scaffold)
 * 2. Existing project quick-reject (hasPackageJson or fileCount > 10)
 * 3. Empty workspace + LLM classification (if llmClassify provided)
 * 4. Empty workspace + heuristic fallback (tests / no API key)
 * 5. Pass through to user's selected mode
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

  // 2. Existing project quick-reject (pure filesystem logic, no keywords)
  const ws = context.workspace;

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

    // 3. Empty workspace — use LLM classification if available
    if (ws.fileCount <= 3 && context.llmClassify) {
      console.log(`${LOG} Empty workspace — calling LLM to classify intent...`);
      try {
        const classification = await context.llmClassify(text);
        console.log(`${LOG} LLM classification: ${classification}`);

        if (classification === 'BUILD') {
          return {
            intent: 'SCAFFOLD',
            source: 'llm',
            confidence: 1.0,
            reasoning: 'LLM classified empty-workspace prompt as BUILD → scaffold',
          };
        }

        return {
          intent: 'AGENT',
          source: 'llm',
          confidence: 1.0,
          reasoning: 'LLM classified empty-workspace prompt as QUESTION → agent',
        };
      } catch (err) {
        console.warn(`${LOG} LLM classification failed, falling through to heuristic:`, err);
      }
    }

    // 4. Empty workspace — heuristic fallback (no LLM client, e.g. tests)
    if (ws.fileCount <= 3) {
      const greenfield = detectGreenfieldIntent(text);
      console.log(`${LOG} Heuristic fallback:`, { isMatch: greenfield.isMatch, confidence: greenfield.confidence });

      if (greenfield.isMatch && greenfield.confidence >= 0.6) {
        console.log(`${LOG} Empty workspace + greenfield heuristic → SCAFFOLD`);
        return {
          intent: 'SCAFFOLD',
          source: 'heuristic',
          confidence: greenfield.confidence,
          reasoning: `Empty workspace + greenfield intent: ${greenfield.reason}`,
        };
      }
    }
  } else {
    // No workspace info — heuristic only (edge case)
    const greenfield = detectGreenfieldIntent(text);
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

  // 5. Pass through — user's selected mode determines the handler
  console.log(`${LOG} Pass through → AGENT`);
  return {
    intent: 'AGENT',
    source: 'passthrough',
    confidence: 1.0,
    reasoning: 'No scaffold intent — pass through to user mode',
  };
}
