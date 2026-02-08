/**
 * Step 38: Reference Context Summary
 * 
 * Builds human-readable summaries of ReferenceTokens for injection
 * into Quick Action and Plan context. These summaries guide the LLM
 * without including raw images or base64 data.
 * 
 * CRITICAL: Never include raw base64, full OCR text, or large JSON dumps.
 * Only derived/summarized tokens are included in context.
 */

import type { ReferenceTokens, StyleSourceMode } from '../types';

// ============================================================================
// CONTEXT SUMMARY BUILDER
// ============================================================================

/**
 * Build a reference summary block for context injection
 * 
 * This is inserted into Quick Action / Plan context (NOT MissionFeed).
 * Format is optimized for LLM consumption.
 * 
 * @param tokens - Extracted reference tokens
 * @param mode - How the user wants to use references
 * @returns Formatted summary string
 */
export function buildReferenceContextSummary(
  tokens: ReferenceTokens,
  mode: StyleSourceMode
): string {
  const lines: string[] = [];

  lines.push('## Reference Summary');
  lines.push('');

  // Mode explanation
  const modeLabel = getModeLabel(mode);
  lines.push(`**Style Source:** ${modeLabel}`);
  lines.push('');

  // Source info
  lines.push(`**Based on:** ${tokens.source.images_count} image(s), ${tokens.source.urls_count} URL(s)`);
  lines.push(`**Confidence:** ${(tokens.confidence * 100).toFixed(0)}%`);
  lines.push('');

  // Style tokens
  if (tokens.style) {
    lines.push('### Style Tokens');
    
    // Palette
    if (tokens.style.palette) {
      const paletteStr = buildPaletteString(tokens.style.palette);
      if (paletteStr) {
        lines.push(`- **Palette:** ${paletteStr}`);
      }
    }

    // Mood
    if (tokens.style.mood && tokens.style.mood.length > 0) {
      lines.push(`- **Mood:** ${tokens.style.mood.join(', ')}`);
    }

    // Typography
    if (tokens.style.typography) {
      const typo = tokens.style.typography;
      if (typo.heading || typo.body) {
        lines.push(`- **Typography:** heading=${typo.heading || 'auto'}, body=${typo.body || 'auto'}`);
      }
    }

    // Spacing/density
    if (tokens.style.density) {
      lines.push(`- **Density:** ${tokens.style.density}`);
    }

    // Radius
    if (tokens.style.radius) {
      lines.push(`- **Border Radius:** ${tokens.style.radius}`);
    }

    // Shadows
    if (tokens.style.shadows) {
      lines.push(`- **Shadows:** ${tokens.style.shadows}`);
    }

    lines.push('');
  }

  // Layout hints
  if (tokens.layout) {
    lines.push('### Layout Hints');
    
    if (tokens.layout.structure && tokens.layout.structure.length > 0) {
      lines.push(`- **Structure:** ${tokens.layout.structure.join(', ')}`);
    }
    
    if (tokens.layout.components && tokens.layout.components.length > 0) {
      lines.push(`- **Components:** ${tokens.layout.components.join(', ')}`);
    }
    
    lines.push('');
  }

  // UI hints
  if (tokens.uiHints?.component_system_preference) {
    lines.push('### UI System');
    lines.push(`- **Preferred:** ${tokens.uiHints.component_system_preference}`);
    lines.push('');
  }

  // Warnings
  if (tokens.warnings && tokens.warnings.length > 0) {
    lines.push('### Notes');
    for (const warning of tokens.warnings) {
      lines.push(`- ${formatWarning(warning)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build a compact one-line summary for scaffoldCard / UI display
 */
export function buildCompactSummary(tokens: ReferenceTokens): string {
  const parts: string[] = [];

  // Mood
  if (tokens.style?.mood && tokens.style.mood.length > 0) {
    parts.push(tokens.style.mood.slice(0, 2).join('/'));
  }

  // Primary color
  if (tokens.style?.palette?.primary) {
    parts.push(tokens.style.palette.primary);
  }

  // Confidence
  parts.push(`${(tokens.confidence * 100).toFixed(0)}% confidence`);

  return parts.join(' • ');
}

/**
 * Build a minimal inline hint for LLM prompts
 * Used when we want to hint style without full context block
 */
export function buildInlineHint(tokens: ReferenceTokens): string {
  const hints: string[] = [];

  if (tokens.style?.mood && tokens.style.mood.length > 0) {
    hints.push(`style: ${tokens.style.mood.slice(0, 2).join('/')}`);
  }

  if (tokens.style?.palette?.primary) {
    hints.push(`primary color: ${tokens.style.palette.primary}`);
  }

  if (tokens.style?.radius) {
    hints.push(`corners: ${tokens.style.radius}`);
  }

  if (hints.length === 0) {
    return '';
  }

  return `[User references suggest: ${hints.join(', ')}]`;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get human-readable mode label
 */
function getModeLabel(mode: StyleSourceMode): string {
  switch (mode) {
    case 'use_reference':
      return 'Use reference style exclusively';
    case 'combine_with_design_pack':
      return 'Combine reference with design pack';
    case 'ignore_reference':
      return 'Ignore references (use design pack only)';
    default:
      return 'Unknown';
  }
}

/**
 * Build palette string from palette object
 */
function buildPaletteString(palette: NonNullable<ReferenceTokens['style']>['palette']): string {
  if (!palette) return '';

  const colors: string[] = [];
  
  if (palette.primary) colors.push(`primary: ${palette.primary}`);
  if (palette.secondary) colors.push(`secondary: ${palette.secondary}`);
  if (palette.accent) colors.push(`accent: ${palette.accent}`);
  
  if (colors.length === 0 && palette.neutrals && palette.neutrals.length > 0) {
    colors.push(`neutrals: ${palette.neutrals.slice(0, 2).join(', ')}`);
  }

  return colors.join(', ');
}

/**
 * Format warning code to human-readable
 */
function formatWarning(warning: string): string {
  switch (warning) {
    case 'url_not_fetched':
      return 'URLs were not fetched (domain/path used as hints only)';
    case 'mock_provider_used':
      return 'Mock provider used (no API key configured)';
    case 'low_confidence':
      return 'Low confidence extraction (results may be inaccurate)';
    default:
      return warning;
  }
}

// ============================================================================
// DESIGN PACK OVERRIDE BUILDER
// ============================================================================

/**
 * Build style overrides for design pack based on reference tokens
 * 
 * Used in scaffold flow to modify selected design pack colors/radius.
 * Only applies overrides when confidence threshold is met.
 * 
 * @param tokens - Extracted reference tokens
 * @param mode - Style source mode
 * @param confidenceThreshold - Minimum confidence to apply overrides (default 0.6)
 */
export function buildDesignPackOverrides(
  tokens: ReferenceTokens,
  mode: StyleSourceMode,
  confidenceThreshold: number = 0.6
): {
  palette?: { primary?: string; secondary?: string; accent?: string };
  radius?: string;
  shadows?: string;
  applied: boolean;
} {
  // Don't apply overrides if ignoring references or low confidence
  if (mode === 'ignore_reference' || tokens.confidence < confidenceThreshold) {
    return { applied: false };
  }

  const overrides: {
    palette?: { primary?: string; secondary?: string; accent?: string };
    radius?: string;
    shadows?: string;
    applied: boolean;
  } = { applied: false };

  // Extract palette overrides
  if (tokens.style?.palette) {
    const p = tokens.style.palette;
    if (p.primary || p.secondary || p.accent) {
      overrides.palette = {};
      if (p.primary) overrides.palette.primary = p.primary;
      if (p.secondary) overrides.palette.secondary = p.secondary;
      if (p.accent) overrides.palette.accent = p.accent;
      overrides.applied = true;
    }
  }

  // For 'combine' mode, only apply accent color and keep design pack base
  if (mode === 'combine_with_design_pack' && tokens.confidence < 0.7) {
    // Higher threshold for combine mode
    if (overrides.palette) {
      overrides.palette = { accent: overrides.palette.accent };
      if (!overrides.palette.accent) {
        delete overrides.palette;
        overrides.applied = false;
      }
    }
    return overrides;
  }

  // Extract radius override for use_reference mode
  if (mode === 'use_reference' && tokens.style?.radius) {
    overrides.radius = tokens.style.radius;
    overrides.applied = true;
  }

  // Extract shadows override for use_reference mode
  if (mode === 'use_reference' && tokens.style?.shadows) {
    overrides.shadows = tokens.style.shadows;
    overrides.applied = true;
  }

  return overrides;
}

// ============================================================================
// MOOD-BASED DESIGN PACK MATCHING
// ============================================================================

/**
 * Map of mood keywords to design pack IDs
 * Used for selecting closest design pack based on reference mood
 */
const MOOD_TO_DESIGN_PACK: Record<string, string[]> = {
  minimal: ['modern', 'clean', 'neutral'],
  modern: ['modern', 'vibrant'],
  enterprise: ['neutral', 'modern'],
  vibrant: ['vibrant', 'playful'],
  playful: ['playful', 'vibrant'],
  clean: ['clean', 'modern', 'neutral'],
  bold: ['vibrant', 'playful'],
  professional: ['neutral', 'modern'],
};

/**
 * Get suggested design packs based on reference mood
 * 
 * @param tokens - Extracted reference tokens
 * @returns Array of suggested design pack IDs, ordered by match quality
 */
export function getSuggestedDesignPacks(tokens: ReferenceTokens): string[] {
  if (!tokens.style?.mood || tokens.style.mood.length === 0) {
    return ['modern']; // Default fallback
  }

  const scores: Record<string, number> = {};

  // Score each design pack based on mood matches
  for (const mood of tokens.style.mood) {
    const moodLower = mood.toLowerCase();
    const packs = MOOD_TO_DESIGN_PACK[moodLower] || [];
    
    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i];
      // Earlier matches get higher score
      const score = packs.length - i;
      scores[pack] = (scores[pack] || 0) + score;
    }
  }

  // Sort by score descending
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([pack]) => pack);

  // Ensure we always have at least one suggestion
  return sorted.length > 0 ? sorted : ['modern'];
}
