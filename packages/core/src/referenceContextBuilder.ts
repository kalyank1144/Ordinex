/**
 * Step 37: Reference Context Builder
 * 
 * Builds normalized ReferenceContext from user-provided attachments (images, URLs).
 * This is the plumbing layer - it does NOT interpret references yet.
 * 
 * CRITICAL CONSTRAINTS:
 * - Max 10 images allowed
 * - URLs are stored as design references, not scraped
 * - References stored in run metadata (NOT memory)
 * - No Vision API analysis yet - just pass through
 */

import type {
  ReferenceAttachment,
  ReferenceContext,
  ReferenceIntent,
  StyleSourceMode,
  ReferenceAttachedPayload,
  ReferenceContextBuiltPayload,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum number of image references allowed */
export const MAX_IMAGE_REFERENCES = 10;

/** Supported image MIME types for reference detection */
export const REFERENCE_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

/** Reference intent detection patterns */
export const REFERENCE_INTENT_PATTERNS: Record<ReferenceIntent, RegExp[]> = {
  visual_style: [
    /like this/i,
    /similar to this/i,
    /use this (design|style)/i,
    /based on this (screenshot|image)/i,
    /make it look like/i,
    /same (style|look|feel)/i,
    /match (this|the) (design|style)/i,
    /follow (this|the) (design|style)/i,
  ],
  layout: [
    /this layout/i,
    /same layout/i,
    /layout like/i,
    /structure like/i,
    /arrange like/i,
    /position like/i,
  ],
  branding: [
    /brand(ing)?/i,
    /logo/i,
    /color scheme/i,
    /color palette/i,
    /brand colors/i,
    /company (style|colors)/i,
  ],
  unknown: [],
};

// ============================================================================
// REFERENCE CLASSIFICATION
// ============================================================================

/**
 * Classify an attachment as image or URL reference
 */
export function classifyAttachment(attachment: {
  id: string;
  mimeType: string;
  name: string;
  path?: string;
  url?: string;
}): ReferenceAttachment | null {
  // Check if it's an image
  if (REFERENCE_IMAGE_MIME_TYPES.includes(attachment.mimeType)) {
    return {
      type: 'image',
      id: attachment.id,
      path: attachment.path || attachment.name,
      mime: attachment.mimeType,
    };
  }

  // Check if it's a URL (special handling)
  if (attachment.url || attachment.name.startsWith('http')) {
    return {
      type: 'url',
      id: attachment.id,
      url: attachment.url || attachment.name,
    };
  }

  // Not a reference type we handle
  return null;
}

/**
 * Extract URLs from text content (user prompt)
 */
export function extractUrlsFromText(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)]; // Deduplicate
}

// ============================================================================
// INTENT DETECTION
// ============================================================================

/**
 * Detect reference intent from user prompt text
 * 
 * Returns the most likely intent based on pattern matching.
 * If no patterns match, returns 'unknown'.
 */
export function detectReferenceIntent(promptText: string): ReferenceIntent {
  // Check each intent type in priority order
  const intentPriority: ReferenceIntent[] = ['branding', 'layout', 'visual_style'];

  for (const intent of intentPriority) {
    const patterns = REFERENCE_INTENT_PATTERNS[intent];
    for (const pattern of patterns) {
      if (pattern.test(promptText)) {
        return intent;
      }
    }
  }

  return 'unknown';
}

/**
 * Check if prompt text implies reference influence
 * 
 * Returns true if the user's wording suggests they want to use
 * the provided references to influence the output.
 */
export function hasReferenceInfluenceIntent(promptText: string): boolean {
  const allPatterns = [
    ...REFERENCE_INTENT_PATTERNS.visual_style,
    ...REFERENCE_INTENT_PATTERNS.layout,
    ...REFERENCE_INTENT_PATTERNS.branding,
  ];

  return allPatterns.some((pattern) => pattern.test(promptText));
}

// ============================================================================
// REFERENCE CONTEXT BUILDING
// ============================================================================

export interface AttachmentInput {
  id: string;
  mimeType: string;
  name: string;
  path?: string;
  url?: string;
}

/**
 * Build a ReferenceContext from user attachments and prompt
 * 
 * This is the main entry point for creating a normalized reference bundle.
 * The ReferenceContext can then be attached to scaffold proposals, plans, etc.
 */
export function buildReferenceContext(
  attachments: AttachmentInput[],
  promptText: string
): ReferenceContext | null {
  const images: ReferenceAttachment[] = [];
  const urls: ReferenceAttachment[] = [];

  // Process attachments
  for (const attachment of attachments) {
    const classified = classifyAttachment(attachment);
    if (classified) {
      if (classified.type === 'image') {
        // Enforce max image limit
        if (images.length < MAX_IMAGE_REFERENCES) {
          images.push(classified);
        }
      } else if (classified.type === 'url') {
        urls.push(classified);
      }
    }
  }

  // Extract URLs from prompt text
  const textUrls = extractUrlsFromText(promptText);
  for (const url of textUrls) {
    // Avoid duplicates
    if (!urls.some((u) => u.type === 'url' && u.url === url)) {
      urls.push({
        type: 'url',
        id: `url_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
        url,
      });
    }
  }

  // If no references found, return null
  if (images.length === 0 && urls.length === 0) {
    return null;
  }

  // Detect intent from prompt
  const intent = detectReferenceIntent(promptText);

  return {
    images,
    urls,
    source: 'user_upload',
    intent,
  };
}

// ============================================================================
// EVENT PAYLOAD BUILDERS
// ============================================================================

/**
 * Build reference_attached event payload
 */
export function buildReferenceAttachedPayload(
  context: ReferenceContext
): ReferenceAttachedPayload {
  const refIds: string[] = [];
  const types: ('image' | 'url')[] = [];

  for (const img of context.images) {
    refIds.push(img.id);
    if (!types.includes('image')) {
      types.push('image');
    }
  }

  for (const url of context.urls) {
    refIds.push(url.id);
    if (!types.includes('url')) {
      types.push('url');
    }
  }

  return {
    ref_ids: refIds,
    types,
  };
}

/**
 * Build reference_context_built event payload
 */
export function buildReferenceContextBuiltPayload(
  context: ReferenceContext
): ReferenceContextBuiltPayload {
  return {
    intent: context.intent,
    ref_count: context.images.length + context.urls.length,
  };
}

// ============================================================================
// STYLE SOURCE RESOLUTION
// ============================================================================

/**
 * Default style source mode
 */
export const DEFAULT_STYLE_SOURCE_MODE: StyleSourceMode = 'combine_with_design_pack';

/**
 * Resolve final style source mode based on user preference and context
 * 
 * @param userPreference - User's selected preference (or undefined for default)
 * @param hasReferences - Whether references are present
 * @param hasDesignPack - Whether a design pack is selected
 */
export function resolveStyleSourceMode(
  userPreference: StyleSourceMode | undefined,
  hasReferences: boolean,
  hasDesignPack: boolean
): StyleSourceMode {
  // If user explicitly chose, respect that
  if (userPreference) {
    return userPreference;
  }

  // Default behavior
  if (hasReferences && hasDesignPack) {
    return 'combine_with_design_pack';
  } else if (hasReferences) {
    return 'use_reference';
  } else {
    return 'ignore_reference';
  }
}

// ============================================================================
// SAFETY VALIDATION
// ============================================================================

/**
 * Validate reference context for safety constraints
 * 
 * Returns validation errors if any constraints are violated.
 */
export function validateReferenceContext(
  context: ReferenceContext
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check image count
  if (context.images.length > MAX_IMAGE_REFERENCES) {
    errors.push(
      `Too many image references: ${context.images.length}/${MAX_IMAGE_REFERENCES}`
    );
  }

  // Validate image paths (basic check)
  for (const img of context.images) {
    if (img.type === 'image') {
      if (!img.path || img.path.trim() === '') {
        errors.push(`Image reference ${img.id} has no path`);
      }
    }
  }

  // Validate URLs (basic format check)
  for (const urlRef of context.urls) {
    if (urlRef.type === 'url') {
      try {
        new URL(urlRef.url);
      } catch {
        errors.push(`Invalid URL reference: ${urlRef.url}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// CLARIFICATION HANDLING
// ============================================================================

/**
 * Check if references contradict user text and need clarification
 * 
 * Per spec: If references contradict user text → ask ONE clarification
 * After 1 clarification → proceed conservatively
 */
export function needsClarification(
  context: ReferenceContext,
  promptText: string
): { needsClarification: boolean; reason?: string } {
  // Check for conflicting intents
  const hasIgnoreKeywords =
    /ignore (the )?(reference|screenshot|image)/i.test(promptText) ||
    /don't use (the )?(reference|screenshot|image)/i.test(promptText) ||
    /without (the )?(reference|screenshot|image)/i.test(promptText);

  if (hasIgnoreKeywords && (context.images.length > 0 || context.urls.length > 0)) {
    return {
      needsClarification: true,
      reason:
        'You mentioned ignoring references but also provided images/URLs. Should I use them for design inspiration?',
    };
  }

  // Check for ambiguous multi-reference scenarios
  if (context.images.length > 3 && context.intent === 'unknown') {
    return {
      needsClarification: true,
      reason:
        'You provided multiple images without specifying how to use them. Should I extract colors, layout, or overall style?',
    };
  }

  return { needsClarification: false };
}
