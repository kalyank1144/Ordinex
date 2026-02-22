/**
 * Intent Signals — Greenfield Detection + Slash Override
 *
 * Consolidated intent detection helpers. Only two functions remain:
 *   detectGreenfieldIntent(text) — delegates to greenfieldDetector.ts
 *   detectSlashOverride(text)    — detects /scaffold slash command
 */

import { detectGreenfieldIntent as _detectGreenfield } from './greenfieldDetector';

// ============================================================================
// TYPES
// ============================================================================

export interface IntentSignal {
  isMatch: boolean;
  confidence: number;
  reason: string;
  matchedKeywords?: string[];
}

// ============================================================================
// GREENFIELD DETECTION — delegates to greenfieldDetector.ts
// ============================================================================

export function detectGreenfieldIntent(text: string): IntentSignal {
  return _detectGreenfield(text);
}

// ============================================================================
// SLASH OVERRIDE DETECTION
// ============================================================================

export type SlashOverride = 'scaffold' | null;

/**
 * Detect /scaffold slash command. Other slash commands are removed —
 * the LLM in Agent/Plan mode handles everything else naturally.
 */
export function detectSlashOverride(text: string): SlashOverride {
  const trimmed = text.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();

  if (firstWord === '/scaffold' || firstWord === 'scaffold') {
    return 'scaffold';
  }

  return null;
}
