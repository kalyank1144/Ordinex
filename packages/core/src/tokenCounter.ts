/**
 * Token Counting & Context Window Management (Task #5)
 *
 * Provides improved token estimation, context window validation,
 * and an async TokenCounter interface for real API-based counting.
 *
 * Pure core module (P1 compliant — no FS, no side effects).
 */

import type { ConversationMessage, ContentBlock } from './conversationHistory';
import type { ToolSchema } from './toolSchemas';
import { getContextWindow, getMaxOutputTokens } from './modelRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result from a token counting operation */
export interface TokenCountResult {
  inputTokens: number;
  isEstimate: boolean;
}

/**
 * Async token counter interface.
 * Extension can implement this with the real Anthropic SDK countTokens() API.
 * Core provides a character-based fallback implementation.
 */
export interface TokenCounter {
  countTokens(params: {
    messages: ConversationMessage[];
    system?: string;
    tools?: ToolSchema[];
    model: string;
  }): Promise<TokenCountResult>;
}

/** Result of context window validation */
export interface ContextFitResult {
  /** Whether the messages fit in the context window */
  fits: boolean;
  /** Estimated input token count */
  estimatedInputTokens: number;
  /** Total context window size for the model */
  contextWindowSize: number;
  /** Tokens available for input (window minus reserved output) */
  availableForInput: number;
  /** Tokens reserved for the model's output */
  reservedForOutput: number;
  /** How many tokens over the limit (0 if fits) */
  overflowTokens: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Chars-per-token ratios by content type */
export const CHARS_PER_TOKEN = {
  text: 4.0,
  code: 3.2,
  json: 3.0,
  tool_use: 3.0,
  tool_result: 3.5,
} as const;

/** Fixed token costs for non-text content */
export const FIXED_TOKEN_COSTS = {
  /** Approximate tokens for a base64-encoded image */
  image: 1600,
  /** Overhead tokens per message (role, formatting) */
  messageOverhead: 4,
  /** Approximate tokens per tool schema definition */
  toolSchema: 300,
} as const;

// ---------------------------------------------------------------------------
// Code detection heuristic
// ---------------------------------------------------------------------------

/** Heuristic to detect if a text string is likely source code */
export function isLikelyCode(text: string): boolean {
  if (text.length < 20) return false;

  const codeIndicators = [
    /[{}\[\]];?\s*$/m,          // braces/brackets at end of line
    /=>/,                        // arrow functions
    /\bimport\s+/,               // import statements
    /\bexport\s+/,               // export statements
    /\bfunction\s+\w+/,          // function declarations
    /\bconst\s+\w+\s*=/,         // const declarations
    /\blet\s+\w+\s*=/,           // let declarations
    /\bvar\s+\w+\s*=/,           // var declarations
    /\bclass\s+\w+/,             // class declarations
    /\breturn\s+/,               // return statements
    /;\s*$/m,                    // semicolons at end of line
    /\bif\s*\(/,                 // if statements
    /\bfor\s*\(/,                // for loops
    /\bwhile\s*\(/,              // while loops
    /\b(async|await)\b/,         // async/await
    /\bdef\s+\w+/,               // Python function
    /\bself\.\w+/,               // Python self
  ];

  let matches = 0;
  for (const pattern of codeIndicators) {
    if (pattern.test(text)) {
      matches++;
    }
    if (matches >= 3) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Improved token estimation
// ---------------------------------------------------------------------------

/** Estimate tokens for a single content block */
function estimateBlockTokens(block: ContentBlock): number {
  switch (block.type) {
    case 'text': {
      const ratio = isLikelyCode(block.text) ? CHARS_PER_TOKEN.code : CHARS_PER_TOKEN.text;
      return Math.ceil(block.text.length / ratio);
    }
    case 'image':
      return FIXED_TOKEN_COSTS.image;
    case 'tool_use': {
      const inputStr = JSON.stringify(block.input);
      return Math.ceil((inputStr.length + block.name.length) / CHARS_PER_TOKEN.tool_use);
    }
    case 'tool_result': {
      if (typeof block.content === 'string') {
        return Math.ceil(block.content.length / CHARS_PER_TOKEN.tool_result);
      }
      // Nested content blocks
      let total = 0;
      for (const nested of block.content) {
        total += estimateBlockTokens(nested as ContentBlock);
      }
      return total;
    }
    default:
      return 0;
  }
}

/**
 * Improved token estimation with per-block-type ratios.
 *
 * More accurate than the flat 4 chars/token ratio because:
 * - Code uses 3.2 chars/token (tokens are shorter for code)
 * - JSON/tool data uses 3.0 chars/token
 * - Images have a fixed cost
 * - Per-message overhead is accounted for
 */
export function estimateTokensImproved(
  messages: ConversationMessage[],
  options?: {
    system?: string;
    tools?: ToolSchema[];
  },
): number {
  let total = 0;

  // System prompt
  if (options?.system) {
    const ratio = isLikelyCode(options.system) ? CHARS_PER_TOKEN.code : CHARS_PER_TOKEN.text;
    total += Math.ceil(options.system.length / ratio);
  }

  // Tool schemas overhead
  if (options?.tools) {
    total += options.tools.length * FIXED_TOKEN_COSTS.toolSchema;
  }

  // Messages
  for (const msg of messages) {
    total += FIXED_TOKEN_COSTS.messageOverhead;

    if (typeof msg.content === 'string') {
      const ratio = isLikelyCode(msg.content) ? CHARS_PER_TOKEN.code : CHARS_PER_TOKEN.text;
      total += Math.ceil(msg.content.length / ratio);
    } else {
      for (const block of msg.content) {
        total += estimateBlockTokens(block);
      }
    }
  }

  return total;
}

// ---------------------------------------------------------------------------
// CharacterTokenCounter (sync fallback implementation)
// ---------------------------------------------------------------------------

/**
 * Character-based token counter. Always available, no API calls.
 * Uses the improved per-block-type estimator.
 */
export class CharacterTokenCounter implements TokenCounter {
  async countTokens(params: {
    messages: ConversationMessage[];
    system?: string;
    tools?: ToolSchema[];
    model: string;
  }): Promise<TokenCountResult> {
    const inputTokens = estimateTokensImproved(params.messages, {
      system: params.system,
      tools: params.tools,
    });
    return { inputTokens, isEstimate: true };
  }
}

// ---------------------------------------------------------------------------
// Context window validation
// ---------------------------------------------------------------------------

/**
 * Synchronously check whether messages fit in the context window
 * using character-based estimation.
 */
export function validateContextFitsSync(
  messages: ConversationMessage[],
  model: string,
  options?: {
    system?: string;
    tools?: ToolSchema[];
    maxOutputTokens?: number;
  },
): ContextFitResult {
  const contextWindowSize = getContextWindow(model);
  const reservedForOutput = options?.maxOutputTokens ?? getMaxOutputTokens(model);
  const availableForInput = contextWindowSize - reservedForOutput;

  const estimatedInputTokens = estimateTokensImproved(messages, {
    system: options?.system,
    tools: options?.tools,
  });

  const overflowTokens = Math.max(0, estimatedInputTokens - availableForInput);

  return {
    fits: overflowTokens === 0,
    estimatedInputTokens,
    contextWindowSize,
    availableForInput,
    reservedForOutput,
    overflowTokens,
  };
}

/**
 * Async context window validation using a real TokenCounter.
 * Falls back to sync estimation on counter error.
 */
export async function validateContextFits(
  counter: TokenCounter,
  messages: ConversationMessage[],
  model: string,
  options?: {
    system?: string;
    tools?: ToolSchema[];
    maxOutputTokens?: number;
  },
): Promise<ContextFitResult> {
  const contextWindowSize = getContextWindow(model);
  const reservedForOutput = options?.maxOutputTokens ?? getMaxOutputTokens(model);
  const availableForInput = contextWindowSize - reservedForOutput;

  let estimatedInputTokens: number;
  try {
    const result = await counter.countTokens({
      messages,
      system: options?.system,
      tools: options?.tools,
      model,
    });
    estimatedInputTokens = result.inputTokens;
  } catch {
    // Fallback to sync estimation
    estimatedInputTokens = estimateTokensImproved(messages, {
      system: options?.system,
      tools: options?.tools,
    });
  }

  const overflowTokens = Math.max(0, estimatedInputTokens - availableForInput);

  return {
    fits: overflowTokens === 0,
    estimatedInputTokens,
    contextWindowSize,
    availableForInput,
    reservedForOutput,
    overflowTokens,
  };
}
