/**
 * Step 38: Vision Policy
 * 
 * Determines whether vision analysis should run, based on:
 * - Configuration settings (visionMode)
 * - Reference context (has images/URLs)
 * - Replay context (never run vision in replay)
 * 
 * Consent handling uses existing decision_point_needed event pattern.
 */

import type {
  VisionConfig,
  ReferenceContext,
  VisionRunContext,
  VisionConsentDecision,
} from '../types';
import { isVisionEnabled, requiresConsent } from './visionConfig';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Policy decision for vision analysis
 */
export type VisionPolicyDecision = 'skip' | 'prompt' | 'proceed';

/**
 * Skip reason codes
 */
export type VisionSkipReason =
  | 'disabled'           // visionMode === 'off'
  | 'no_references'      // No images or URLs in reference context
  | 'replay_mode'        // Running in replay/audit mode
  | 'user_skipped'       // User chose to skip when prompted
  | 'no_images'          // Only URLs, no images (vision requires images)
  | 'api_key_missing';   // No API key configured

/**
 * Policy result with decision and reason
 */
export interface VisionPolicyResult {
  decision: VisionPolicyDecision;
  skipReason?: VisionSkipReason;
  skipMessage?: string;
}

// ============================================================================
// POLICY FUNCTIONS
// ============================================================================

/**
 * Determine whether vision analysis should run
 * 
 * Rules:
 * 1. If no references → skip
 * 2. If visionMode === 'off' → skip
 * 3. If replay mode → skip (NEVER run vision in replay)
 * 4. If visionMode === 'prompt' → prompt for consent
 * 5. If visionMode === 'on' → proceed
 * 
 * @param config - Vision configuration
 * @param refs - Reference context
 * @param runContext - Run context for replay detection
 * @returns Policy result with decision
 */
export function shouldAnalyze(
  config: VisionConfig,
  refs: ReferenceContext | null | undefined,
  runContext?: Partial<VisionRunContext>
): VisionPolicyResult {
  // Rule 1: Check if references exist
  if (!refs) {
    return {
      decision: 'skip',
      skipReason: 'no_references',
      skipMessage: 'No reference context provided',
    };
  }

  const hasImages = refs.images.length > 0;
  const hasUrls = refs.urls.length > 0;

  if (!hasImages && !hasUrls) {
    return {
      decision: 'skip',
      skipReason: 'no_references',
      skipMessage: 'No images or URLs in reference context',
    };
  }

  // Rule 2: Check if vision is enabled
  if (!isVisionEnabled(config)) {
    return {
      decision: 'skip',
      skipReason: 'disabled',
      skipMessage: 'Vision analysis is disabled in settings',
    };
  }

  // Rule 3: NEVER run vision in replay mode
  if (runContext?.isReplay) {
    return {
      decision: 'skip',
      skipReason: 'replay_mode',
      skipMessage: 'Vision analysis skipped in replay mode',
    };
  }

  // Rule 4: Check if consent is required
  if (requiresConsent(config)) {
    return {
      decision: 'prompt',
    };
  }

  // Rule 5: Vision is enabled and no consent required
  return {
    decision: 'proceed',
  };
}

/**
 * Check if running in replay mode
 */
export function isReplay(runContext?: Partial<VisionRunContext>): boolean {
  return runContext?.isReplay ?? false;
}

/**
 * Get skip reason message for display
 */
export function getSkipReasonMessage(reason: VisionSkipReason): string {
  switch (reason) {
    case 'disabled':
      return 'Vision analysis is disabled. Enable it in settings: ordinex.references.visionMode';
    case 'no_references':
      return 'No images or URLs were provided';
    case 'replay_mode':
      return 'Vision analysis is not re-run during replay. Using cached tokens from evidence.';
    case 'user_skipped':
      return 'You chose to skip vision analysis';
    case 'no_images':
      return 'Vision analysis requires at least one image. URLs alone provide limited hints.';
    case 'api_key_missing':
      return 'No API key configured for vision provider';
    default:
      return 'Vision analysis was skipped';
  }
}

// ============================================================================
// CONSENT HANDLING
// ============================================================================

/**
 * Build decision_point_needed payload for vision consent
 * 
 * Uses existing DecisionPointCard UI pattern.
 */
export function buildVisionConsentDecisionPoint(
  referenceContextId: string,
  imagesCount: number,
  urlsCount: number
): {
  decision_type: 'vision_consent';
  reference_context_id: string;
  title: string;
  description: string;
  options: Array<{
    label: string;
    action: string;
    description: string;
    primary?: boolean;
  }>;
} {
  return {
    decision_type: 'vision_consent',
    reference_context_id: referenceContextId,
    title: 'Enable image analysis?',
    description: `Analyze ${imagesCount} image(s)${urlsCount > 0 ? ` and ${urlsCount} URL(s)` : ''} to extract design style tokens. This helps match your provided design references.`,
    options: [
      {
        label: 'Analyze this time',
        action: 'analyze_once',
        description: 'Run analysis for this request only',
        primary: true,
      },
      {
        label: 'Always enable for this workspace',
        action: 'enable_always',
        description: 'Enable vision analysis for all future requests',
      },
      {
        label: 'Skip',
        action: 'skip',
        description: 'Continue without analyzing images',
      },
    ],
  };
}

/**
 * Process user's consent decision
 * 
 * @param decision - User's decision from decision point UI
 * @returns Updated policy result
 */
export function processConsentDecision(
  decision: VisionConsentDecision
): VisionPolicyResult {
  switch (decision) {
    case 'analyze_once':
    case 'enable_always':
      return {
        decision: 'proceed',
      };
    case 'skip':
      return {
        decision: 'skip',
        skipReason: 'user_skipped',
        skipMessage: 'You chose to skip vision analysis',
      };
    default:
      return {
        decision: 'skip',
        skipReason: 'user_skipped',
        skipMessage: 'Unknown consent decision',
      };
  }
}

/**
 * Check if consent decision means "always enable"
 * 
 * Used by extension to update workspace settings.
 */
export function shouldPersistConsentSetting(decision: VisionConsentDecision): boolean {
  return decision === 'enable_always';
}

// ============================================================================
// REFERENCE ANALYSIS HELPERS
// ============================================================================

/**
 * Check if reference context has analyzable images
 */
export function hasAnalyzableImages(refs: ReferenceContext | null | undefined): boolean {
  if (!refs) return false;
  return refs.images.length > 0;
}

/**
 * Check if reference context has URLs
 */
export function hasUrls(refs: ReferenceContext | null | undefined): boolean {
  if (!refs) return false;
  return refs.urls.length > 0;
}

/**
 * Get total reference count
 */
export function getReferenceCount(refs: ReferenceContext | null | undefined): number {
  if (!refs) return 0;
  return refs.images.length + refs.urls.length;
}

/**
 * Get images count, capped at maxImages
 */
export function getImageCount(
  refs: ReferenceContext | null | undefined,
  maxImages: number = 10
): number {
  if (!refs) return 0;
  return Math.min(refs.images.length, maxImages);
}

// ============================================================================
// STYLE CONTRADICTION DETECTION
// ============================================================================

/**
 * Mood keywords that indicate minimal/clean style
 */
const MINIMAL_KEYWORDS = ['minimal', 'clean', 'simple', 'monochrome', 'plain', 'subtle', 'understated'];

/**
 * Mood keywords that indicate vibrant/colorful style
 */
const VIBRANT_KEYWORDS = ['vibrant', 'colorful', 'bold', 'bright', 'gradient', 'dynamic', 'energetic'];

/**
 * Detect potential contradiction between user text and reference tokens
 * 
 * Returns true if user text strongly suggests one style but tokens suggest opposite.
 * This triggers a single clarification (not a loop).
 * 
 * @param userText - User's prompt text
 * @param tokensMood - Mood array from extracted tokens
 * @param tokensConfidence - Confidence score from tokens
 */
export function detectStyleContradiction(
  userText: string,
  tokensMood: string[] | undefined,
  tokensConfidence: number
): { hasContradiction: boolean; textStyle?: string; tokensStyle?: string } {
  // Only detect contradiction if tokens have reasonable confidence
  if (tokensConfidence < 0.6 || !tokensMood || tokensMood.length === 0) {
    return { hasContradiction: false };
  }

  const textLower = userText.toLowerCase();

  // Check if text mentions minimal/clean
  const textSuggestsMinimal = MINIMAL_KEYWORDS.some(kw => textLower.includes(kw));
  // Check if text mentions vibrant/colorful
  const textSuggestsVibrant = VIBRANT_KEYWORDS.some(kw => textLower.includes(kw));

  // Check if tokens mood is minimal
  const tokensAreMoodMinimal = tokensMood.some(m => 
    MINIMAL_KEYWORDS.some(kw => m.toLowerCase().includes(kw))
  );
  // Check if tokens mood is vibrant
  const tokensAreMoodVibrant = tokensMood.some(m => 
    VIBRANT_KEYWORDS.some(kw => m.toLowerCase().includes(kw))
  );

  // Detect contradiction
  if (textSuggestsMinimal && tokensAreMoodVibrant) {
    return {
      hasContradiction: true,
      textStyle: 'minimal/clean',
      tokensStyle: 'vibrant/colorful',
    };
  }

  if (textSuggestsVibrant && tokensAreMoodMinimal) {
    return {
      hasContradiction: true,
      textStyle: 'vibrant/colorful',
      tokensStyle: 'minimal/clean',
    };
  }

  return { hasContradiction: false };
}

/**
 * Build decision_point_needed payload for style contradiction
 */
export function buildStyleContradictionDecisionPoint(
  referenceContextId: string,
  textStyle: string,
  tokensStyle: string
): {
  decision_type: 'style_contradiction';
  reference_context_id: string;
  title: string;
  description: string;
  options: Array<{
    label: string;
    action: string;
    description: string;
    primary?: boolean;
  }>;
} {
  return {
    decision_type: 'style_contradiction',
    reference_context_id: referenceContextId,
    title: 'Style Mismatch Detected',
    description: `Your text suggests "${textStyle}" style, but the reference images appear "${tokensStyle}". Which should I follow?`,
    options: [
      {
        label: 'Follow my text',
        action: 'follow_text',
        description: `Use ${textStyle} style as described`,
        primary: true,
      },
      {
        label: 'Follow references',
        action: 'follow_reference',
        description: `Match the ${tokensStyle} style from images`,
      },
      {
        label: 'Combine both',
        action: 'combine',
        description: 'Try to blend both styles',
      },
    ],
  };
}
