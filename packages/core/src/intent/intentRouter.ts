/**
 * Intent Router — LLM-First Workspace-Aware Routing
 *
 * Two intents:
 *   SCAFFOLD — create a new project from scratch
 *   AGENT    — everything else (user's selected mode determines behavior)
 *
 * Routing logic (LLM-first):
 *   1. /scaffold slash override → SCAFFOLD (always, no LLM)
 *   2. Workspace has package.json + fileCount > 10 → AGENT (filesystem quick-reject, no LLM)
 *   3. LLM classification via tool_use (PRIMARY path) → structured SCAFFOLD | AGENT
 *   4. Heuristic fallback (offline only — no API key / no LLM client)
 */

import type { LLMClient } from '../agenticLoop';
import { classifyIntentWithLLM } from './intentClassifier';
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
  /** LLM client for intent classification. When provided, LLM is the PRIMARY classifier. */
  llmClient?: LLMClient;
  /** User's selected model ID. Required when llmClient is provided. */
  modelId?: string;
}

// ============================================================================
// MAIN ROUTING FUNCTION
// ============================================================================

/**
 * Route user intent — LLM-first architecture.
 *
 * 1. Slash override (/scaffold) — always wins, no LLM needed
 * 2. Filesystem quick-reject (hasPackageJson + fileCount > 10) — no LLM needed
 * 3. LLM classification via tool_use (PRIMARY path)
 * 4. Heuristic fallback (offline / no API key)
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

  // 2. Filesystem quick-reject — existing project with many files
  const ws = context.workspace;
  if (ws && ws.hasPackageJson && ws.fileCount > 10) {
    console.log(`${LOG} Quick-reject → AGENT (hasPackageJson=${ws.hasPackageJson}, fileCount=${ws.fileCount})`);
    return {
      intent: 'AGENT',
      source: 'passthrough',
      confidence: 1.0,
      reasoning: 'Workspace has an existing project — use /scaffold to create a new project',
    };
  }

  // 3. LLM classification — PRIMARY path
  if (context.llmClient && context.modelId) {
    console.log(`${LOG} LLM classification (model=${context.modelId})...`);
    try {
      const result = await classifyIntentWithLLM(
        text,
        ws,
        context.llmClient,
        context.modelId,
      );
      console.log(`${LOG} LLM result: intent=${result.intent}, confidence=${result.confidence}, reasoning="${result.reasoning}"`);
      return {
        intent: result.intent,
        source: 'llm',
        confidence: result.confidence,
        reasoning: result.reasoning,
      };
    } catch (err) {
      console.warn(`${LOG} LLM classification failed, falling through to heuristic:`, err);
    }
  }

  // 4. Heuristic fallback — offline / no API key / LLM failure
  const greenfield = detectGreenfieldIntent(text);
  console.log(`${LOG} Heuristic fallback:`, { isMatch: greenfield.isMatch, confidence: greenfield.confidence });

  if (greenfield.isMatch && greenfield.confidence >= 0.6) {
    console.log(`${LOG} Heuristic → SCAFFOLD`);
    return {
      intent: 'SCAFFOLD',
      source: 'heuristic',
      confidence: greenfield.confidence,
      reasoning: `Heuristic fallback: ${greenfield.reason}`,
    };
  }

  // 5. Default — pass through to user's selected mode
  console.log(`${LOG} Default → AGENT`);
  return {
    intent: 'AGENT',
    source: 'passthrough',
    confidence: 1.0,
    reasoning: 'No scaffold intent detected — pass through to user mode',
  };
}
