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
