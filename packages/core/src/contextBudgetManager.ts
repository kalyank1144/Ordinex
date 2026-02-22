/**
 * ContextBudgetManager — Dynamic system prompt context allocation.
 *
 * Calculates the available token budget for the system prompt based on the
 * model's context window, then fills context elements in priority order.
 * Lower-priority items are dropped when the budget is tight.
 *
 * Priority order:
 *   1. System base prompt (always included)
 *   2. Scaffold session context (if post-scaffold)
 *   3. Activity context from events
 *   4. Project context / open files
 */

import type { ConversationHistory } from './conversationHistory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextLayer {
  label: string;
  content: string;
  priority: number;
}

export interface ContextBudgetResult {
  systemPrompt: string;
  totalTokensUsed: number;
  layersIncluded: string[];
  layersDropped: string[];
}

// ---------------------------------------------------------------------------
// ContextBudgetManager
// ---------------------------------------------------------------------------

export class ContextBudgetManager {
  private static readonly OUTPUT_RESERVE = 16_000;
  private static readonly TOOL_SCHEMA_RESERVE = 2_000;
  private static readonly CHARS_PER_TOKEN = 4;

  /**
   * Build a system prompt that fits within the available budget.
   *
   * @param layers     - Context layers to include, in priority order
   * @param history    - Conversation history (used to calculate remaining budget)
   * @param modelContextWindow - Total model context window (e.g. 200_000)
   */
  build(
    layers: ContextLayer[],
    history: ConversationHistory,
    modelContextWindow: number,
  ): ContextBudgetResult {
    const historyEstimate = history.estimateTokens();

    const systemBudget = modelContextWindow
      - ContextBudgetManager.OUTPUT_RESERVE
      - ContextBudgetManager.TOOL_SCHEMA_RESERVE
      - historyEstimate;

    const sortedLayers = [...layers].sort((a, b) => a.priority - b.priority);

    const included: ContextLayer[] = [];
    const dropped: string[] = [];
    let tokensUsed = 0;

    for (const layer of sortedLayers) {
      const layerTokens = Math.ceil(layer.content.length / ContextBudgetManager.CHARS_PER_TOKEN);
      if (tokensUsed + layerTokens <= systemBudget) {
        included.push(layer);
        tokensUsed += layerTokens;
      } else {
        dropped.push(layer.label);
      }
    }

    const systemPrompt = included.map(l => l.content).join('\n\n');

    return {
      systemPrompt,
      totalTokensUsed: tokensUsed,
      layersIncluded: included.map(l => l.label),
      layersDropped: dropped,
    };
  }
}
