/**
 * Design Pack Selector (Step 35.5)
 * 
 * Deterministic selection of design packs based on stable inputs.
 * Ensures the same user/workspace/app combination gets the same pack.
 * 
 * Selection is based on:
 * 1. Override (if user selected a specific pack)
 * 2. Deterministic seed from stable inputs
 * 3. Vibe guardrails (enterprise apps → enterprise packs, mobile → vibrant, etc.)
 * 
 * IMPORTANT: This NEVER calls an LLM. Selection is pure computation.
 */

import { createHash } from 'crypto';
import {
  DesignPack,
  DesignPackId,
  DESIGN_PACKS,
  getDesignPackById,
  getEnterpriseSubset,
  getMobileSubset,
} from './designPacks';
import { RecipeId } from './recipeTypes';
import type { ReferenceTokens, StyleSourceMode } from '../types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Reason why a pack was selected
 */
export type SelectionReason = 'override' | 'seeded' | 'fallback';

/**
 * Input for design pack selection
 */
export interface DesignPackSelectionInput {
  /** Workspace root path */
  workspaceRoot: string;
  /** Target directory for scaffold */
  targetDir: string;
  /** App name (extracted from prompt or default) */
  appName: string;
  /** Recipe ID being used */
  recipeId: RecipeId;
  /** User stable ID (from auth, optional) */
  userStableId?: string;
  /** User-selected pack override */
  overridePackId?: DesignPackId;
  /** App domain hint (enterprise/mobile) from prompt analysis */
  domainHint?: 'enterprise' | 'mobile' | 'consumer';
}

/**
 * Result of design pack selection
 */
export interface DesignPackSelectionResult {
  /** Selected design pack */
  pack: DesignPack;
  /** Deterministic seed used (8 hex chars) */
  seed: string;
  /** Reason for selection */
  reason: SelectionReason;
}

// ============================================================================
// DOMAIN DETECTION (From Prompt Analysis)
// ============================================================================

/**
 * Domain keywords that suggest enterprise apps
 */
const ENTERPRISE_KEYWORDS = [
  'business', 'b2b', 'enterprise', 'admin', 'dashboard',
  'saas', 'crm', 'erp', 'internal', 'corporate',
  'management', 'analytics', 'reporting', 'portal',
];

/**
 * Domain keywords that suggest mobile apps
 */
const MOBILE_KEYWORDS = [
  'mobile', 'app', 'ios', 'android', 'expo', 'react native',
  'phone', 'tablet', 'native',
];

/**
 * Detect domain hint from user prompt (if not already provided)
 * @param userPrompt - Original user prompt
 * @returns Domain hint or undefined
 */
export function detectDomainHint(userPrompt: string): 'enterprise' | 'mobile' | 'consumer' | undefined {
  const prompt = userPrompt.toLowerCase();
  
  // Check for enterprise keywords
  if (ENTERPRISE_KEYWORDS.some(kw => prompt.includes(kw))) {
    return 'enterprise';
  }
  
  // Check for mobile keywords
  if (MOBILE_KEYWORDS.some(kw => prompt.includes(kw))) {
    return 'mobile';
  }
  
  // No clear hint
  return undefined;
}

// ============================================================================
// SEED COMPUTATION
// ============================================================================

/**
 * Compute a deterministic seed from stable inputs
 * 
 * The seed is a sha256 hash truncated to 8 hex characters.
 * It's stable across reruns for the same inputs.
 * 
 * @param input - Selection input
 * @returns 8-character hex seed
 */
export function computeSelectionSeed(input: DesignPackSelectionInput): string {
  const seedInput = [
    input.userStableId ?? 'anon',
    input.workspaceRoot,
    input.targetDir,
    input.appName,
    input.recipeId,
    'v1', // Version marker for future seed algorithm changes
  ].join('|');
  
  const hash = createHash('sha256');
  hash.update(seedInput);
  return hash.digest('hex').slice(0, 8);
}

/**
 * Convert seed to integer for modular selection
 * @param seed - 8-character hex seed
 * @returns Integer value
 */
export function seedToInt(seed: string): number {
  return parseInt(seed, 16);
}

// ============================================================================
// VIBE GUARDRAIL FILTERING
// ============================================================================

/**
 * Get the appropriate subset of packs based on domain/recipe hints
 * 
 * This applies "vibe guardrails" to ensure appropriate packs are selected:
 * - Enterprise apps → enterprise/minimal packs
 * - Mobile apps → vibrant/warm/gradient packs
 * - Default → all packs
 * 
 * @param input - Selection input
 * @returns Filtered array of packs
 */
export function getFilteredPacks(input: DesignPackSelectionInput): DesignPack[] {
  const { recipeId, domainHint } = input;
  
  // Recipe-based filtering
  if (recipeId === 'expo') {
    // Mobile apps get vibrant/warm subset
    return getMobileSubset();
  }
  
  // Domain-based filtering
  if (domainHint === 'enterprise') {
    return getEnterpriseSubset();
  }
  
  if (domainHint === 'mobile') {
    return getMobileSubset();
  }
  
  // Default: all packs
  return DESIGN_PACKS;
}

// ============================================================================
// MAIN SELECTION FUNCTION
// ============================================================================

/**
 * Select a design pack deterministically
 * 
 * Rules:
 * 1. If overridePackId provided → return that pack (reason='override')
 * 2. Compute seed from stable inputs
 * 3. Apply vibe guardrails to filter pack list
 * 4. Select pack at index: seedInt % filteredPacks.length
 * 
 * @param input - Selection input
 * @returns Selection result with pack, seed, and reason
 */
export function selectDesignPack(input: DesignPackSelectionInput): DesignPackSelectionResult {
  // 1. Handle override
  if (input.overridePackId) {
    const overridePack = getDesignPackById(input.overridePackId);
    if (overridePack) {
      // Still compute seed for evidence
      const seed = computeSelectionSeed(input);
      return {
        pack: overridePack,
        seed,
        reason: 'override',
      };
    }
    // Invalid override, fall through to seeded selection
    console.warn(`Invalid override pack ID: ${input.overridePackId}, using seeded selection`);
  }
  
  // 2. Compute seed
  const seed = computeSelectionSeed(input);
  const seedInt = seedToInt(seed);
  
  // 3. Apply vibe guardrails
  const filteredPacks = getFilteredPacks(input);
  
  // 4. Select pack deterministically
  if (filteredPacks.length === 0) {
    // Fallback to first pack if filtering produced empty set
    return {
      pack: DESIGN_PACKS[0],
      seed,
      reason: 'fallback',
    };
  }
  
  const packIndex = seedInt % filteredPacks.length;
  const selectedPack = filteredPacks[packIndex];
  
  return {
    pack: selectedPack,
    seed,
    reason: 'seeded',
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Select pack for a different seed (useful for "try another" functionality)
 * 
 * @param baseSeed - Original seed
 * @param variation - Variation number (0-based)
 * @param packs - Pack list to select from
 * @returns Selected pack
 */
export function selectPackWithVariation(
  baseSeed: string,
  variation: number,
  packs: DesignPack[] = DESIGN_PACKS
): DesignPack {
  // Create varied seed by appending variation number
  const hash = createHash('sha256');
  hash.update(`${baseSeed}:${variation}`);
  const variedSeed = hash.digest('hex').slice(0, 8);
  
  const seedInt = seedToInt(variedSeed);
  const packIndex = seedInt % packs.length;
  
  return packs[packIndex];
}

/**
 * Validate that selection is deterministic for given inputs
 * (Useful for testing)
 * 
 * @param input - Selection input
 * @param iterations - Number of iterations to test
 * @returns true if all iterations produce same result
 */
export function validateDeterminism(
  input: DesignPackSelectionInput,
  iterations: number = 10
): boolean {
  const first = selectDesignPack(input);
  
  for (let i = 1; i < iterations; i++) {
    const result = selectDesignPack(input);
    if (result.pack.id !== first.pack.id || result.seed !== first.seed) {
      return false;
    }
  }
  
  return true;
}

/**
 * Get selection preview for UI (shows what pack would be selected without committing)
 * 
 * @param input - Selection input
 * @returns Preview of selection result
 */
export function previewSelection(input: DesignPackSelectionInput): {
  packId: DesignPackId;
  packName: string;
  seed: string;
  reason: SelectionReason;
  filteredCount: number;
} {
  const result = selectDesignPack(input);
  const filteredPacks = getFilteredPacks(input);
  
  return {
    packId: result.pack.id,
    packName: result.pack.name,
    seed: result.seed,
    reason: result.reason,
    filteredCount: filteredPacks.length,
  };
}

// ============================================================================
// STEP 38: REFERENCE TOKENS INTEGRATION
// ============================================================================

/**
 * Style overrides extracted from reference tokens
 */
export interface TokenStyleOverrides {
  palette?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  shadows?: 'none' | 'subtle' | 'medium' | 'dramatic';
}

/**
 * Extended input for token-based selection
 */
export interface DesignPackSelectionWithTokensInput extends DesignPackSelectionInput {
  /** Extracted reference tokens */
  referenceTokens?: ReferenceTokens;
  /** How user wants to use references */
  referenceMode?: StyleSourceMode;
  /** Confidence thresholds */
  confidenceThresholds?: {
    useReference: number;  // default 0.6
    combine: number;       // default 0.7
  };
}

/**
 * Extended result with style overrides
 */
export interface DesignPackSelectionWithOverridesResult extends DesignPackSelectionResult {
  /** Style overrides to apply */
  overrides?: TokenStyleOverrides;
  /** Whether overrides were applied */
  overridesApplied: boolean;
  /** Reference tokens summary for UI */
  tokensSummary?: {
    moods?: string[];
    paletteSummary?: string;
    confidence: number;
  };
}

/**
 * Default confidence thresholds
 */
const DEFAULT_CONFIDENCE_THRESHOLDS = {
  useReference: 0.6,
  combine: 0.7,
};

/**
 * Mood keywords mapped to design pack vibes
 */
const MOOD_TO_VIBE_MAP: Record<string, string[]> = {
  minimal: ['neutral', 'clean'],
  modern: ['modern', 'vibrant'],
  enterprise: ['neutral'],
  vibrant: ['vibrant', 'warm'],
  playful: ['playful', 'vibrant'],
  clean: ['clean', 'neutral', 'modern'],
  bold: ['vibrant', 'warm'],
  professional: ['neutral', 'modern'],
  warm: ['warm', 'playful'],
  dark: ['modern', 'neutral'],
};

/**
 * Select design pack with reference token integration
 * 
 * Step 38 Rules:
 * - If referenceMode='use_reference' and confidence >= useReference threshold:
 *   - Select closest pack by mood match
 *   - Apply full palette/radius/shadows overrides
 * - If referenceMode='combine_with_design_pack' and confidence >= combine threshold:
 *   - Keep seeded pack selection
 *   - Apply accent color only
 * - If referenceMode='ignore_reference' or low confidence:
 *   - Use standard selection, no overrides
 * 
 * @param input - Extended selection input with tokens
 * @returns Selection result with overrides
 */
export function selectDesignPackWithTokens(
  input: DesignPackSelectionWithTokensInput
): DesignPackSelectionWithOverridesResult {
  const thresholds = input.confidenceThresholds || DEFAULT_CONFIDENCE_THRESHOLDS;
  const tokens = input.referenceTokens;
  const mode = input.referenceMode || 'ignore_reference';

  // No tokens or ignore mode - standard selection
  if (!tokens || mode === 'ignore_reference') {
    const result = selectDesignPack(input);
    return {
      ...result,
      overridesApplied: false,
    };
  }

  const confidence = tokens.confidence;

  // use_reference mode with sufficient confidence
  if (mode === 'use_reference' && confidence >= thresholds.useReference) {
    // Select pack by mood match
    const moodMatchedPack = selectPackByMood(tokens, input);
    
    // Build full overrides
    const overrides = buildFullOverrides(tokens);
    
    return {
      ...moodMatchedPack,
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      overridesApplied: Object.keys(overrides).length > 0,
      tokensSummary: buildTokensSummary(tokens),
    };
  }

  // combine mode with sufficient confidence
  if (mode === 'combine_with_design_pack' && confidence >= thresholds.combine) {
    // Keep standard pack selection
    const result = selectDesignPack(input);
    
    // Apply accent only
    const overrides = buildAccentOnlyOverrides(tokens);
    
    return {
      ...result,
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      overridesApplied: Object.keys(overrides).length > 0,
      tokensSummary: buildTokensSummary(tokens),
    };
  }

  // Low confidence - standard selection, no overrides
  const result = selectDesignPack(input);
  return {
    ...result,
    overridesApplied: false,
    tokensSummary: buildTokensSummary(tokens),
  };
}

/**
 * Select pack based on mood match from tokens
 */
function selectPackByMood(
  tokens: ReferenceTokens,
  input: DesignPackSelectionInput
): DesignPackSelectionResult {
  const moods = tokens.style?.mood || [];
  
  if (moods.length === 0) {
    // No mood hints, use standard selection
    return selectDesignPack(input);
  }

  // Get candidate packs (respecting vibe guardrails)
  const candidates = getFilteredPacks(input);
  
  if (candidates.length === 0) {
    return selectDesignPack(input);
  }

  // Score each pack by mood match
  const scores = candidates.map(pack => {
    let score = 0;
    const packVibe = pack.vibe.toLowerCase();
    
    for (const mood of moods) {
      const moodLower = mood.toLowerCase();
      const vibes = MOOD_TO_VIBE_MAP[moodLower] || [];
      
      if (vibes.some(v => packVibe.includes(v))) {
        score += 2;
      } else if (packVibe.includes(moodLower)) {
        score += 1;
      }
    }
    
    return { pack, score };
  });

  // Sort by score descending, then by pack id for determinism
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.pack.id.localeCompare(b.pack.id);
  });

  const bestMatch = scores[0].pack;
  const seed = computeSelectionSeed(input);

  return {
    pack: bestMatch,
    seed,
    reason: scores[0].score > 0 ? 'seeded' : 'fallback',
  };
}

/**
 * Build full style overrides from tokens (use_reference mode)
 */
function buildFullOverrides(tokens: ReferenceTokens): TokenStyleOverrides {
  const overrides: TokenStyleOverrides = {};

  // Palette
  if (tokens.style?.palette) {
    const p = tokens.style.palette;
    if (p.primary || p.secondary || p.accent) {
      overrides.palette = {};
      if (p.primary) overrides.palette.primary = p.primary;
      if (p.secondary) overrides.palette.secondary = p.secondary;
      if (p.accent) overrides.palette.accent = p.accent;
    }
  }

  // Radius
  if (tokens.style?.radius) {
    overrides.radius = tokens.style.radius;
  }

  // Shadows
  if (tokens.style?.shadows) {
    overrides.shadows = tokens.style.shadows;
  }

  return overrides;
}

/**
 * Build accent-only overrides (combine mode)
 */
function buildAccentOnlyOverrides(tokens: ReferenceTokens): TokenStyleOverrides {
  const overrides: TokenStyleOverrides = {};

  if (tokens.style?.palette?.accent) {
    overrides.palette = { accent: tokens.style.palette.accent };
  } else if (tokens.style?.palette?.primary) {
    // Use primary as accent fallback
    overrides.palette = { accent: tokens.style.palette.primary };
  }

  return overrides;
}

/**
 * Build compact tokens summary for UI/events
 */
function buildTokensSummary(tokens: ReferenceTokens): {
  moods?: string[];
  paletteSummary?: string;
  confidence: number;
} {
  const palette = tokens.style?.palette;
  let paletteSummary: string | undefined;
  
  if (palette) {
    const colors: string[] = [];
    if (palette.primary) colors.push(palette.primary);
    if (palette.accent) colors.push(palette.accent);
    if (colors.length > 0) {
      paletteSummary = colors.join(', ');
    }
  }

  return {
    moods: tokens.style?.mood,
    paletteSummary,
    confidence: tokens.confidence,
  };
}

// ============================================================================
// EXPORT SUMMARY FOR EVENTS
// ============================================================================

/**
 * Generate a summary object suitable for event payload
 * 
 * @param result - Selection result
 * @returns Summary object
 */
export function generateSelectionEvidence(result: DesignPackSelectionResult): {
  design_pack_id: string;
  design_pack_name: string;
  design_seed: string;
  selection_reason: SelectionReason;
  preview_asset_id: string;
  tokens_summary: string;
} {
  return {
    design_pack_id: result.pack.id,
    design_pack_name: result.pack.name,
    design_seed: result.seed,
    selection_reason: result.reason,
    preview_asset_id: result.pack.preview.imageAssetId,
    tokens_summary: `${result.pack.tokens.colors.primary} | ${result.pack.tokens.fonts.heading}`,
  };
}

/**
 * Generate extended evidence with override info
 */
export function generateSelectionEvidenceWithOverrides(
  result: DesignPackSelectionWithOverridesResult
): {
  design_pack_id: string;
  design_pack_name: string;
  design_seed: string;
  selection_reason: SelectionReason;
  overrides_applied: boolean;
  overrides?: TokenStyleOverrides;
  tokens_summary?: {
    moods?: string[];
    paletteSummary?: string;
    confidence: number;
  };
} {
  return {
    design_pack_id: result.pack.id,
    design_pack_name: result.pack.name,
    design_seed: result.seed,
    selection_reason: result.reason,
    overrides_applied: result.overridesApplied,
    overrides: result.overrides,
    tokens_summary: result.tokensSummary,
  };
}
