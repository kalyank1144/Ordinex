/**
 * Step 40: Intent Signals - Single Source of Truth
 *
 * This module consolidates ALL intent detection logic into one place.
 * Everyone should use these helpers - no duplicate detection elsewhere.
 *
 * Detection functions delegate to canonical sources:
 * - Greenfield: greenfieldDetector.ts
 * - Command: userCommandDetector.ts
 *
 * Exports:
 * - detectGreenfieldIntent(text)
 * - detectCommandIntent(text)
 * - detectEditScale(text)
 * - normalizeUserInput(text)
 */

import { detectGreenfieldIntent as _detectGreenfield } from './greenfieldDetector';
import { detectCommandIntent as _detectCommand } from '../userCommandDetector';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Generic signal result for all intent detectors
 */
export interface IntentSignal {
  /** Whether the intent was detected */
  isMatch: boolean;
  /** Confidence level (0.0 - 1.0) */
  confidence: number;
  /** Human-readable reason for the detection */
  reason: string;
  /** Keywords that matched (for debugging) */
  matchedKeywords?: string[];
}

// ============================================================================
// INPUT NORMALIZATION
// ============================================================================

/**
 * Normalize user input for consistent matching
 *
 * - Trims whitespace
 * - Collapses multiple spaces
 * - Converts to lowercase (for matching)
 * - Preserves original for display
 *
 * @param text - Raw user input
 * @returns Normalized text
 */
export function normalizeUserInput(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// ============================================================================
// GREENFIELD DETECTION — delegates to greenfieldDetector.ts
// ============================================================================

/**
 * Detect greenfield intent from user text.
 * Delegates to the canonical greenfieldDetector.ts.
 */
export function detectGreenfieldIntent(text: string): IntentSignal {
  return _detectGreenfield(text);
}

// ============================================================================
// COMMAND DETECTION — delegates to userCommandDetector.ts
// ============================================================================

/**
 * Detect command execution intent from user text.
 * Delegates to the canonical userCommandDetector.ts and maps the result.
 */
export function detectCommandIntent(text: string): IntentSignal {
  const result = _detectCommand(text);
  return {
    isMatch: result.isCommandIntent,
    confidence: result.confidence,
    reason: result.reasoning,
    matchedKeywords: result.detectedKeywords,
  };
}

// ============================================================================
// EDIT SCALE DETECTION (Step 40 - feeds Step 33)
// ============================================================================

/**
 * Edit scale for scope detection
 */
export type EditScale = 'trivial' | 'small' | 'medium' | 'large';

/**
 * Edit scale detection result
 */
export interface EditScaleResult {
  scale: EditScale;
  confidence: number;
  reason: string;
  metrics?: {
    estimated_files: number;
    complexity_score: number;
  };
}

/**
 * Trivial edit patterns (single line, typo fixes)
 */
const TRIVIAL_PATTERNS = [
  /\bfix\s+typo/i,
  /\bcorrect\s+spelling/i,
  /\brename\s+\w+\s+to\s+\w+/i,
  /\bupdate\s+comment/i,
  /\bremove\s+unused/i,
  /\bfix\s+whitespace/i,
];

/**
 * Large edit patterns (refactoring, migrations)
 */
const LARGE_PATTERNS = [
  /\brefactor/i,
  /\bmigrate/i,
  /\brewrite/i,
  /\brestructure/i,
  /\boverhaul/i,
  /\barchitect/i,
  /\bintegrate/i,
  /\bupgrade\s+\w+\s+to/i,
];

/**
 * Multi-step indicators
 */
const MULTI_STEP_PATTERNS = [
  /\b(then|after\s+that|next|finally|first|second|third)\b/i,
  /\b(multiple|several|all|each|every)\s+\w*(file|component|module)/i,
];

/**
 * Detect edit scale from user text
 * 
 * @param text - User's input prompt
 * @returns EditScaleResult with scale and confidence
 */
export function detectEditScale(text: string): EditScaleResult {
  const normalized = normalizeUserInput(text);

  // Check for greenfield first (always large)
  const greenfieldResult = detectGreenfieldIntent(text);
  if (greenfieldResult.isMatch && greenfieldResult.confidence >= 0.65) {
    return {
      scale: 'large',
      confidence: 0.95,
      reason: `Greenfield project: ${greenfieldResult.reason}`,
      metrics: { estimated_files: 20, complexity_score: 80 },
    };
  }

  // Check trivial patterns
  for (const pattern of TRIVIAL_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        scale: 'trivial',
        confidence: 0.9,
        reason: 'Trivial edit pattern matched',
        metrics: { estimated_files: 1, complexity_score: 5 },
      };
    }
  }

  // Check large patterns
  let largeMatchCount = 0;
  for (const pattern of LARGE_PATTERNS) {
    if (pattern.test(normalized)) {
      largeMatchCount++;
    }
  }

  // Check multi-step indicators
  let hasMultiStep = false;
  for (const pattern of MULTI_STEP_PATTERNS) {
    if (pattern.test(normalized)) {
      hasMultiStep = true;
      break;
    }
  }

  // Calculate complexity
  let complexityScore = 0;
  if (largeMatchCount > 0) complexityScore += largeMatchCount * 25;
  if (hasMultiStep) complexityScore += 20;

  // Count file references
  const filePattern = /\b[\w\-/.]+\.(ts|tsx|js|jsx|py|go|java|cpp|c|h|rs|rb|php|swift|kt)\b/g;
  const fileMatches = text.match(filePattern) || [];
  const estimatedFiles = Math.max(1, fileMatches.length);
  complexityScore += estimatedFiles * 5;

  // Determine scale
  if (complexityScore >= 50 || largeMatchCount >= 2) {
    return {
      scale: 'large',
      confidence: 0.7,
      reason: `High complexity (score: ${complexityScore})`,
      metrics: { estimated_files: estimatedFiles, complexity_score: complexityScore },
    };
  }

  if (complexityScore >= 25 || hasMultiStep) {
    return {
      scale: 'medium',
      confidence: 0.7,
      reason: `Medium complexity (score: ${complexityScore})`,
      metrics: { estimated_files: estimatedFiles, complexity_score: complexityScore },
    };
  }

  if (estimatedFiles <= 1) {
    return {
      scale: 'trivial',
      confidence: 0.8,
      reason: 'Single file scope',
      metrics: { estimated_files: estimatedFiles, complexity_score: complexityScore },
    };
  }

  return {
    scale: 'small',
    confidence: 0.75,
    reason: `Low complexity (score: ${complexityScore})`,
    metrics: { estimated_files: estimatedFiles, complexity_score: complexityScore },
  };
}

// ============================================================================
// SLASH OVERRIDE DETECTION
// ============================================================================

/**
 * Slash override commands
 */
export type SlashOverride = 'scaffold' | 'plan' | 'run' | 'answer' | null;

/**
 * Detect slash override from user text
 * 
 * @param text - User's input prompt
 * @returns SlashOverride or null if none
 */
export function detectSlashOverride(text: string): SlashOverride {
  const trimmed = text.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();

  if (firstWord === '/scaffold' || firstWord === 'scaffold') {
    return 'scaffold';
  }
  if (firstWord === '/plan' || firstWord === 'plan') {
    return 'plan';
  }
  if (firstWord === '/run' || firstWord === '/do') {
    return 'run';
  }
  if (firstWord === '/answer' || firstWord === '/chat' || firstWord === '/ask') {
    return 'answer';
  }

  return null;
}
