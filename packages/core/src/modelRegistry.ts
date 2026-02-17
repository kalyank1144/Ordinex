/**
 * Model Registry — Single source of truth for LLM model IDs
 *
 * Consolidates the 3 duplicated MODEL_MAP definitions from:
 *  - llmService.ts
 *  - llmEditTool.ts
 *  - truncationSafeExecutor.ts
 */

/**
 * Maps user-facing model aliases to canonical Anthropic model identifiers.
 * Add new aliases here — all consumers import from this module.
 */
export const MODEL_MAP: Record<string, string> = {
  // Current models
  'claude-haiku-4-5':     'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5':    'claude-sonnet-4-5-20250929',
  'claude-sonnet-4':      'claude-sonnet-4-20250514',

  // Short aliases
  'haiku':                'claude-haiku-4-5-20251001',
  'sonnet':               'claude-sonnet-4-5-20250929',
  'sonnet-4.5':           'claude-sonnet-4-5-20250929',
  'sonnet-4':             'claude-sonnet-4-20250514',

  // Legacy aliases (map to nearest modern equivalent)
  'claude-3-haiku':       'claude-haiku-4-5-20251001',
  'claude-3-sonnet':      'claude-sonnet-4-20250514',
  'claude-3-opus':        'claude-sonnet-4-5-20250929',

  // Non-Anthropic fallbacks (graceful degradation)
  'opus-4.5':             'claude-haiku-4-5-20251001',
  'gpt-5.2':              'claude-haiku-4-5-20251001',
  'gemini-3':             'claude-haiku-4-5-20251001',
};

/** Default model used when no mapping is found */
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/** Fast/cheap model for classification, extraction, lightweight tasks */
export const FAST_MODEL = 'claude-haiku-4-5-20251001';

/** Capable model for code generation, planning, complex reasoning */
export const CAPABLE_MODEL = 'claude-sonnet-4-5-20250929';

/** Model for structured code edits (balance of speed + quality) */
export const EDIT_MODEL = 'claude-sonnet-4-20250514';

/**
 * Resolve a user-provided model string to a canonical Anthropic model ID.
 * Returns the canonical ID if found in MODEL_MAP, otherwise returns DEFAULT_MODEL.
 *
 * If the input already looks like a full model ID (contains a date suffix),
 * it is returned as-is.
 */
export function resolveModel(userModel: string): string {
  // Already a fully-qualified model ID (e.g. "claude-sonnet-4-20250514")
  if (/\d{8}$/.test(userModel)) {
    return userModel;
  }
  return MODEL_MAP[userModel] || DEFAULT_MODEL;
}

/**
 * Returns true if the user model required a fallback (wasn't in MODEL_MAP
 * and wasn't a fully-qualified ID).
 */
export function didModelFallback(userModel: string): boolean {
  if (/\d{8}$/.test(userModel)) return false;
  return !MODEL_MAP[userModel];
}

// ---------------------------------------------------------------------------
// Context window and output token metadata
// ---------------------------------------------------------------------------

/** Context window size (max input tokens) for each canonical model ID */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-haiku-4-5-20251001': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-sonnet-4-20250514':  200_000,
};

/** Default context window for unknown models */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Max output tokens for each canonical model ID */
export const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  'claude-haiku-4-5-20251001': 8192,
  'claude-sonnet-4-5-20250929': 8192,
  'claude-sonnet-4-20250514':  8192,
};

/** Default max output tokens for unknown models */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** Get the context window size for a model (resolves aliases first) */
export function getContextWindow(modelId: string): number {
  const resolved = resolveModel(modelId);
  return MODEL_CONTEXT_WINDOWS[resolved] ?? DEFAULT_CONTEXT_WINDOW;
}

/** Get the max output tokens for a model (resolves aliases first) */
export function getMaxOutputTokens(modelId: string): number {
  const resolved = resolveModel(modelId);
  return MODEL_MAX_OUTPUT_TOKENS[resolved] ?? DEFAULT_MAX_OUTPUT_TOKENS;
}
