/**
 * Style Intent Resolver — Converts user style input into design tokens.
 *
 * Supports five input modes:
 *   1. Natural language ("dark modern like Linear") — LLM-generated unique tokens
 *   2. Vibe quick buttons (minimal, vibrant, neo, etc.) — LLM-customized per app type
 *   3. Hex color (deterministic palette generation) — algorithmic, no LLM
 *   4. Reference image (vision analysis tokens)
 *   5. Reference URL (token extraction from site)
 *
 * Output: DesignTokens validated for WCAG AA and mapped to shadcn CSS vars.
 */

import type { DesignTokens } from './tokenValidator';
import { validateAndCorrectTokens, tokensToShadcnVars } from './tokenValidator';
import type { StyleInput } from './blueprintSchema';
import type { FeatureLLMClient } from './featureExtractor';
import { generateFullTheme } from './oklchEngine';
import type { SemanticTokens } from './oklchEngine';

// ============================================================================
// TYPES
// ============================================================================

export interface StyleResolutionResult {
  input: StyleInput;
  tokens: DesignTokens;
  shadcnVars: Record<string, string>;
  corrections: string[];
}

// ============================================================================
// VIBE PRESETS
// ============================================================================

export type VibeId = 'minimal' | 'enterprise' | 'vibrant' | 'warm' | 'neo' | 'glass' | 'dark_modern';

export interface VibePreset {
  id: VibeId;
  label: string;
  description: string;
  tokens: DesignTokens;
}

const VIBE_PRESETS: Record<VibeId, DesignTokens> = {
  minimal: {
    background: '#ffffff',
    foreground: '#0a0a0a',
    primary: '#171717',
    primary_foreground: '#fafafa',
    secondary: '#f5f5f5',
    secondary_foreground: '#171717',
    muted: '#f5f5f5',
    muted_foreground: '#737373',
    destructive: '#ef4444',
    destructive_foreground: '#fafafa',
    accent: '#f5f5f5',
    accent_foreground: '#171717',
    card: '#ffffff',
    card_foreground: '#0a0a0a',
    border: '#e5e5e5',
    input: '#e5e5e5',
    ring: '#171717',
  },
  enterprise: {
    background: '#ffffff',
    foreground: '#1e293b',
    primary: '#1e40af',
    primary_foreground: '#ffffff',
    secondary: '#f1f5f9',
    secondary_foreground: '#1e293b',
    muted: '#f8fafc',
    muted_foreground: '#64748b',
    destructive: '#dc2626',
    destructive_foreground: '#ffffff',
    accent: '#eff6ff',
    accent_foreground: '#1e40af',
    card: '#ffffff',
    card_foreground: '#1e293b',
    border: '#e2e8f0',
    input: '#e2e8f0',
    ring: '#1e40af',
  },
  vibrant: {
    background: '#ffffff',
    foreground: '#18181b',
    primary: '#7c3aed',
    primary_foreground: '#ffffff',
    secondary: '#faf5ff',
    secondary_foreground: '#18181b',
    muted: '#f4f4f5',
    muted_foreground: '#71717a',
    destructive: '#f43f5e',
    destructive_foreground: '#ffffff',
    accent: '#faf5ff',
    accent_foreground: '#7c3aed',
    card: '#ffffff',
    card_foreground: '#18181b',
    border: '#e4e4e7',
    input: '#e4e4e7',
    ring: '#7c3aed',
  },
  warm: {
    background: '#fffbeb',
    foreground: '#292524',
    primary: '#d97706',
    primary_foreground: '#ffffff',
    secondary: '#fef3c7',
    secondary_foreground: '#292524',
    muted: '#fef9ee',
    muted_foreground: '#78716c',
    destructive: '#dc2626',
    destructive_foreground: '#ffffff',
    accent: '#fef3c7',
    accent_foreground: '#92400e',
    card: '#fffbeb',
    card_foreground: '#292524',
    border: '#fde68a',
    input: '#fde68a',
    ring: '#d97706',
  },
  neo: {
    background: '#0a0a0a',
    foreground: '#fafafa',
    primary: '#22d3ee',
    primary_foreground: '#0a0a0a',
    secondary: '#1c1c1c',
    secondary_foreground: '#fafafa',
    muted: '#262626',
    muted_foreground: '#a3a3a3',
    destructive: '#f43f5e',
    destructive_foreground: '#fafafa',
    accent: '#1c1c1c',
    accent_foreground: '#22d3ee',
    card: '#141414',
    card_foreground: '#fafafa',
    border: '#2d2d2d',
    input: '#2d2d2d',
    ring: '#22d3ee',
  },
  glass: {
    background: '#f8fafc',
    foreground: '#0f172a',
    primary: '#3b82f6',
    primary_foreground: '#ffffff',
    secondary: '#e0f2fe',
    secondary_foreground: '#0f172a',
    muted: '#f1f5f9',
    muted_foreground: '#64748b',
    destructive: '#ef4444',
    destructive_foreground: '#ffffff',
    accent: '#e0f2fe',
    accent_foreground: '#1d4ed8',
    card: '#ffffff',
    card_foreground: '#0f172a',
    border: '#cbd5e1',
    input: '#cbd5e1',
    ring: '#3b82f6',
  },
  dark_modern: {
    background: '#09090b',
    foreground: '#fafafa',
    primary: '#f4f4f5',
    primary_foreground: '#18181b',
    secondary: '#27272a',
    secondary_foreground: '#fafafa',
    muted: '#27272a',
    muted_foreground: '#a1a1aa',
    destructive: '#7f1d1d',
    destructive_foreground: '#fafafa',
    accent: '#27272a',
    accent_foreground: '#fafafa',
    card: '#09090b',
    card_foreground: '#fafafa',
    border: '#27272a',
    input: '#27272a',
    ring: '#d4d4d8',
  },
};

// ============================================================================
// HEX PALETTE GENERATION
// ============================================================================

function hexToHslValues(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const n = parseInt(full, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  h = h / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a full token set from a single hex color deterministically.
 */
export function tokensFromHex(hex: string): DesignTokens {
  const [h, s, l] = hexToHslValues(hex);
  const isDark = l < 0.5;

  return {
    background: isDark ? hslToHex(h, s * 0.1, 0.04) : '#ffffff',
    foreground: isDark ? '#fafafa' : hslToHex(h, s * 0.1, 0.1),
    primary: hex,
    primary_foreground: isDark ? '#0a0a0a' : '#ffffff',
    secondary: hslToHex(h, s * 0.3, isDark ? 0.15 : 0.95),
    secondary_foreground: isDark ? '#fafafa' : hslToHex(h, s * 0.1, 0.1),
    muted: hslToHex(h, s * 0.2, isDark ? 0.12 : 0.96),
    muted_foreground: hslToHex(h, s * 0.15, isDark ? 0.65 : 0.45),
    destructive: '#ef4444',
    destructive_foreground: '#ffffff',
    accent: hslToHex(h, s * 0.3, isDark ? 0.15 : 0.95),
    accent_foreground: hex,
    card: isDark ? hslToHex(h, s * 0.1, 0.06) : '#ffffff',
    card_foreground: isDark ? '#fafafa' : hslToHex(h, s * 0.1, 0.1),
    border: hslToHex(h, s * 0.2, isDark ? 0.18 : 0.88),
    input: hslToHex(h, s * 0.2, isDark ? 0.18 : 0.88),
    ring: hex,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Resolve a style input into validated, WCAG-corrected design tokens
 * and shadcn CSS variables.
 */
export function resolveStyleIntent(input: StyleInput): StyleResolutionResult {
  let rawTokens: DesignTokens;

  switch (input.mode) {
    case 'vibe':
      rawTokens = VIBE_PRESETS[input.value as VibeId] || VIBE_PRESETS.minimal;
      break;

    case 'hex':
      rawTokens = tokensFromHex(input.value);
      break;

    case 'nl':
    case 'image':
    case 'url':
      // For NL/image/url modes, we use a default and the LLM will refine later
      rawTokens = guessVibeFromNL(input.value);
      break;

    default:
      rawTokens = VIBE_PRESETS.minimal;
  }

  const { corrected, corrections } = validateAndCorrectTokens(rawTokens);
  const shadcnVars = tokensToShadcnVars(corrected);

  return { input, tokens: corrected, shadcnVars, corrections };
}

/**
 * List available vibe presets for the picker UI.
 */
export function listVibePresets(): VibePreset[] {
  return [
    { id: 'minimal', label: 'Minimal', description: 'Clean, monochrome, content-first', tokens: VIBE_PRESETS.minimal },
    { id: 'enterprise', label: 'Enterprise', description: 'Professional blue with structured layout', tokens: VIBE_PRESETS.enterprise },
    { id: 'vibrant', label: 'Vibrant', description: 'Purple-accented, playful energy', tokens: VIBE_PRESETS.vibrant },
    { id: 'warm', label: 'Warm', description: 'Amber tones, approachable feel', tokens: VIBE_PRESETS.warm },
    { id: 'neo', label: 'Neo', description: 'Dark background with cyan highlights', tokens: VIBE_PRESETS.neo },
    { id: 'glass', label: 'Glass', description: 'Light blue tints with depth', tokens: VIBE_PRESETS.glass },
    { id: 'dark_modern', label: 'Dark Modern', description: 'Zinc-based dark theme like Linear', tokens: VIBE_PRESETS.dark_modern },
  ];
}

/**
 * Best-effort mapping from NL description to a vibe preset (sync fallback).
 */
function guessVibeFromNL(description: string): DesignTokens {
  const lower = description.toLowerCase();

  if (lower.includes('dark') || lower.includes('linear') || lower.includes('night')) {
    return VIBE_PRESETS.dark_modern;
  }
  if (lower.includes('neon') || lower.includes('cyber') || lower.includes('futuristic')) {
    return VIBE_PRESETS.neo;
  }
  if (lower.includes('corporate') || lower.includes('enterprise') || lower.includes('professional')) {
    return VIBE_PRESETS.enterprise;
  }
  if (lower.includes('vibrant') || lower.includes('colorful') || lower.includes('playful') || lower.includes('purple')) {
    return VIBE_PRESETS.vibrant;
  }
  if (lower.includes('warm') || lower.includes('cozy') || lower.includes('orange') || lower.includes('amber')) {
    return VIBE_PRESETS.warm;
  }
  if (lower.includes('glass') || lower.includes('transparent') || lower.includes('blur')) {
    return VIBE_PRESETS.glass;
  }

  return VIBE_PRESETS.minimal;
}

// ============================================================================
// LLM-POWERED STYLE RESOLUTION
// ============================================================================

const STYLE_LOG = '[StyleIntent]';

// ============================================================================
// SEED-COLOR LLM APPROACH (NEW — uses OKLCH engine)
// ============================================================================

interface SeedColors {
  primary: string;
  secondary: string;
  accent: string;
  radius?: string;
}

function buildSeedSystemPrompt(appType?: string): string {
  const appContext = appType
    ? `\nApp type: "${appType.replace(/_/g, ' ')}" — adapt the color choices to suit this type of application.`
    : '';

  return `You are a color theory expert. Pick 3 seed colors for a web app's design system.${appContext}

Return ONLY valid JSON (no markdown, no explanation):

{
  "primary": "#hex",
  "secondary": "#hex",
  "accent": "#hex",
  "radius": "0.5rem"
}

RULES:
- primary: The main brand color. Should be vibrant and distinctive.
- secondary: A complementary or analogous color. Used for secondary UI elements.
- accent: A contrasting highlight color. Used for CTAs, links, and interactive elements.
- radius: Border radius. "0.25rem" for sharp/brutalist, "0.5rem" for default, "0.75rem" for soft, "1rem" for rounded/playful.
- All 3 colors MUST be 6-digit hex starting with #
- Colors should feel cohesive and intentional as a palette
- Be CREATIVE — each response should produce a unique, distinctive palette
- Avoid generic defaults like #3b82f6 (Tailwind blue) or #000000
- For dark/moody themes: pick rich, deep primary colors (not just gray)
- For light themes: pick colors that look good on white backgrounds`;
}

function buildSeedUserMessage(input: StyleInput, appType?: string, userPrompt?: string): string {
  const appLabel = appType ? ` for a ${appType.replace(/_/g, ' ')} application` : '';
  const promptContext = userPrompt
    ? `\n\nUser's full request: "${userPrompt.slice(0, 300)}"\nUse this context to inform your color choices. If the user mentions specific colors or vibes, prioritize those.`
    : '';

  switch (input.mode) {
    case 'nl':
      return `Pick 3 seed colors${appLabel} with this style: "${input.value}"${promptContext}`;
    case 'vibe': {
      const vibeDescriptions: Record<string, string> = {
        minimal: 'clean, monochrome, content-first with neutral tones',
        enterprise: 'professional, structured with blue corporate tones',
        vibrant: 'colorful, energetic with purple/pink accents',
        warm: 'cozy, approachable with amber/orange warmth',
        neo: 'dark futuristic with neon cyan/green highlights',
        glass: 'frosted glass aesthetic with semi-transparent blue tints',
        dark_modern: 'sleek dark theme like Linear/Vercel with zinc tones',
      };
      const desc = vibeDescriptions[input.value] || input.value;
      return `Pick 3 seed colors${appLabel} with a ${desc} style. Be creative and unique.${promptContext}`;
    }
    default:
      return `Pick 3 seed colors${appLabel} with a modern, clean style.${promptContext}`;
  }
}

function parseSeedColors(text: string): SeedColors | null {
  try {
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\s*```\s*$/, '');
    }
    if (!jsonStr.startsWith('{')) {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) jsonStr = match[0];
    }

    const parsed = JSON.parse(jsonStr);

    for (const key of ['primary', 'secondary', 'accent']) {
      if (typeof parsed[key] !== 'string') return null;
      let hex = parsed[key];
      if (hex.match(/^[0-9a-fA-F]{6}$/)) hex = '#' + hex;
      if (hex.match(/^#[0-9a-fA-F]{3}$/)) {
        hex = '#' + hex.slice(1).split('').map((c: string) => c + c).join('');
      }
      if (!hex.match(/^#[0-9a-fA-F]{6}$/)) return null;
      parsed[key] = hex;
    }

    return {
      primary: parsed.primary,
      secondary: parsed.secondary,
      accent: parsed.accent,
      radius: typeof parsed.radius === 'string' ? parsed.radius : undefined,
    };
  } catch {
    return null;
  }
}

function semanticTokensToDesignTokens(st: SemanticTokens): DesignTokens {
  return {
    background: st.background,
    foreground: st.foreground,
    primary: st.primary,
    primary_foreground: st.primary_foreground,
    secondary: st.secondary,
    secondary_foreground: st.secondary_foreground,
    muted: st.muted,
    muted_foreground: st.muted_foreground,
    destructive: st.destructive,
    destructive_foreground: st.destructive_foreground,
    accent: st.accent,
    accent_foreground: st.accent_foreground,
    card: st.card,
    card_foreground: st.card_foreground,
    border: st.border,
    input: st.input,
    ring: st.ring,
    sidebar: st.sidebar,
    sidebar_foreground: st.sidebar_foreground,
    radius: st.radius,
  };
}

/**
 * LLM-powered style intent resolution using the OKLCH engine.
 *
 * Strategy: Ask the LLM for just 3 creative seed colors + radius.
 * Feed those into the OKLCH engine which generates full 12-step scales,
 * maps them to ~20 semantic tokens, and computes light + dark modes.
 *
 * Falls back to sync `resolveStyleIntent()` if LLM or engine fails.
 */
export async function resolveStyleIntentWithLLM(
  input: StyleInput,
  llmClient: FeatureLLMClient,
  modelId: string,
  appType?: string,
  userPrompt?: string,
): Promise<StyleResolutionResult> {
  if (input.mode === 'hex') {
    return resolveStyleIntent(input);
  }

  try {
    console.log(`${STYLE_LOG} LLM seed-color resolution: mode=${input.mode}, value="${input.value}", appType=${appType || 'none'}, hasUserPrompt=${!!userPrompt}`);

    const response = await llmClient.createMessage({
      model: modelId,
      max_tokens: 256,
      system: buildSeedSystemPrompt(appType),
      messages: [{ role: 'user', content: buildSeedUserMessage(input, appType, userPrompt) }],
    });

    const textContent = response.content.find((c: any) => c.type === 'text' && 'text' in c);
    const textStr = textContent && 'text' in textContent ? (textContent as { type: 'text'; text: string }).text : undefined;
    if (!textStr) {
      console.warn(`${STYLE_LOG} LLM returned no text content, falling back to sync`);
      return resolveStyleIntent(input);
    }

    const seeds = parseSeedColors(textStr);
    if (!seeds) {
      console.warn(`${STYLE_LOG} Failed to parse seed colors, falling back to sync`);
      return resolveStyleIntent(input);
    }

    console.log(`${STYLE_LOG} Seeds from LLM: primary=${seeds.primary}, secondary=${seeds.secondary}, accent=${seeds.accent}`);

    const theme = await generateFullTheme(
      seeds.primary,
      seeds.secondary,
      seeds.accent,
      { radius: seeds.radius },
    );

    const tokens = semanticTokensToDesignTokens(theme.light);
    const { corrected, corrections } = validateAndCorrectTokens(tokens);
    const shadcnVars = tokensToShadcnVars(corrected);

    console.log(`${STYLE_LOG} OKLCH engine generated: primary=${corrected.primary}, ${Object.keys(shadcnVars).length} vars, ${corrections.length} corrections`);
    return { input, tokens: corrected, shadcnVars, corrections };
  } catch (err) {
    console.warn(`${STYLE_LOG} LLM/OKLCH style resolution failed, falling back to sync:`, err);
    return resolveStyleIntent(input);
  }
}

// ============================================================================
// PROMPT-TO-STYLE EXTRACTION
// ============================================================================

interface ExtractedColor {
  hex: string;
  role: string;
  label: string;
}

const ROLE_PATTERNS: [RegExp, string][] = [
  [/\bbackground\b/i, 'background'],
  [/\bsurface\s*cards?\b/i, 'card'],
  [/\bcard\b/i, 'card'],
  [/\bprimary\s*(?:accent|color)?\b/i, 'primary'],
  [/\bsecondary\s*(?:accent|color)?\b/i, 'secondary'],
  [/\baccent\b/i, 'accent'],
  [/\btext\b(?!\s*#)/i, 'foreground'],
  [/\bforeground\b/i, 'foreground'],
  [/\bmuted\s*text\b/i, 'muted_foreground'],
  [/\bmuted\b/i, 'muted'],
  [/\bborders?\b/i, 'border'],
  [/\bdestructive\b/i, 'destructive'],
  [/\berror\b/i, 'destructive'],
  [/\bdanger\b/i, 'destructive'],
  [/\bsuccess\b/i, 'success'],
  [/\bring\b/i, 'ring'],
  [/\binput\b/i, 'input'],
  [/\bpopover\b/i, 'popover'],
];

function extractColorEntries(prompt: string): ExtractedColor[] {
  const results: ExtractedColor[] = [];
  const hexRegex = /#([0-9a-fA-F]{3,8})\b/g;
  let match: RegExpExecArray | null;

  while ((match = hexRegex.exec(prompt)) !== null) {
    let hex = match[0];
    const raw = match[1];
    if (raw.length === 3) hex = '#' + raw.split('').map(c => c + c).join('');
    else if (raw.length === 6) hex = '#' + raw;
    else continue;

    const contextStart = Math.max(0, match.index - 40);
    const label = prompt.substring(contextStart, match.index).trim();

    let role = 'unknown';
    for (const [pattern, tokenRole] of ROLE_PATTERNS) {
      if (pattern.test(label)) {
        role = tokenRole;
        break;
      }
    }

    results.push({ hex: hex.toLowerCase(), role, label });
  }

  return results;
}

/**
 * Extract color specifications from the user's prompt text and build DesignTokens.
 *
 * Handles prompts like:
 *   "Use this color system: Background #0D1117, primary accent #58A6FF, ..."
 *
 * Returns null if no meaningful color specifications are found.
 */
export function extractStyleFromPrompt(prompt: string): StyleResolutionResult | null {
  const entries = extractColorEntries(prompt);
  if (entries.length === 0) return null;

  const mapped = entries.filter(e => e.role !== 'unknown');
  const hexes = entries.map(e => e.hex);

  console.log(`${STYLE_LOG} [PROMPT_EXTRACT] Found ${entries.length} hex colors, ${mapped.length} with semantic roles`);
  for (const e of entries) {
    console.log(`${STYLE_LOG} [PROMPT_EXTRACT]   ${e.role}: ${e.hex} (context: "${e.label}")`);
  }

  if (mapped.length >= 2) {
    const tokenMap: Record<string, string> = {};
    for (const e of mapped) {
      tokenMap[e.role] = e.hex;
    }

    const bgHex = tokenMap['background'] || hexes[0];
    const fgHex = tokenMap['foreground'] || tokenMap['text'];
    const primaryHex = tokenMap['primary'] || hexes.find(h => h !== bgHex) || hexes[0];

    const isDark = (() => {
      const clean = bgHex.replace('#', '');
      const r = parseInt(clean.substring(0, 2), 16);
      const g = parseInt(clean.substring(2, 4), 16);
      const b = parseInt(clean.substring(4, 6), 16);
      return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
    })();

    const defaultFg = isDark ? '#f0f6fc' : '#0a0a0a';
    const defaultMutedFg = isDark ? '#8b949e' : '#656d76';
    const defaultMuted = isDark ? '#21262d' : '#f6f8fa';
    const defaultBorder = isDark ? '#30363d' : '#d0d7de';
    const defaultCard = isDark ? '#161b22' : '#ffffff';

    const tokens: DesignTokens = {
      background: tokenMap['background'] || bgHex,
      foreground: fgHex || defaultFg,
      primary: primaryHex,
      primary_foreground: isDark ? '#ffffff' : '#ffffff',
      secondary: tokenMap['secondary'] || tokenMap['accent'] || primaryHex,
      secondary_foreground: isDark ? '#ffffff' : '#ffffff',
      muted: tokenMap['muted'] || defaultMuted,
      muted_foreground: tokenMap['muted_foreground'] || defaultMutedFg,
      destructive: tokenMap['destructive'] || '#f85149',
      destructive_foreground: '#ffffff',
      accent: tokenMap['accent'] || tokenMap['secondary'] || primaryHex,
      accent_foreground: fgHex || defaultFg,
      card: tokenMap['card'] || defaultCard,
      card_foreground: fgHex || defaultFg,
      popover: tokenMap['popover'] || tokenMap['card'] || defaultCard,
      popover_foreground: fgHex || defaultFg,
      border: tokenMap['border'] || defaultBorder,
      input: tokenMap['input'] || tokenMap['border'] || defaultBorder,
      ring: tokenMap['ring'] || primaryHex,
    };

    const { corrected, corrections } = validateAndCorrectTokens(tokens);
    const shadcnVars = tokensToShadcnVars(corrected);

    console.log(`${STYLE_LOG} [PROMPT_EXTRACT] Built tokens from ${mapped.length} mapped colors: primary=${corrected.primary}, bg=${corrected.background}, accent=${corrected.accent}`);

    return {
      input: { mode: 'hex', value: primaryHex },
      tokens: corrected,
      shadcnVars,
      corrections,
    };
  }

  if (hexes.length >= 1) {
    console.log(`${STYLE_LOG} [PROMPT_EXTRACT] Found ${hexes.length} hex color(s) without clear roles, using tokensFromHex with first color: ${hexes[0]}`);
    const rawTokens = tokensFromHex(hexes[0]);
    const { corrected, corrections } = validateAndCorrectTokens(rawTokens);
    const shadcnVars = tokensToShadcnVars(corrected);
    return {
      input: { mode: 'hex', value: hexes[0] },
      tokens: corrected,
      shadcnVars,
      corrections,
    };
  }

  return null;
}

// ============================================================================
// APP-TYPE-CONTEXTUAL DEFAULTS
// ============================================================================

/**
 * Get a smart style default based on app type when user provides no explicit style.
 * Returns an NL-mode StyleInput that will be resolved by the LLM for unique tokens.
 */
export function getAppTypeDefaultStyle(appType?: string): StyleInput {
  if (!appType) return { mode: 'vibe', value: 'minimal' };

  const defaults: Record<string, StyleInput> = {
    dashboard_saas: { mode: 'nl', value: 'Clean professional with subtle blue accents and structured sidebar layout' },
    admin_panel: { mode: 'nl', value: 'Dense professional interface with neutral tones and data-focused layout' },
    ecommerce: { mode: 'nl', value: 'Modern vibrant with bold product-focused accents and clean whitespace' },
    marketplace: { mode: 'nl', value: 'Fresh marketplace aesthetic with trustworthy blue-green tones' },
    blog_portfolio: { mode: 'nl', value: 'Warm readable design with generous whitespace and elegant typography' },
    social_community: { mode: 'nl', value: 'Friendly colorful design with rounded elements and playful accents' },
    landing_page: { mode: 'nl', value: 'Bold high-contrast with dramatic hero sections and strong CTAs' },
    documentation: { mode: 'nl', value: 'Clean minimal with excellent readability and subtle navigation' },
    mobile_app: { mode: 'nl', value: 'Modern mobile-first design with vibrant interactive elements' },
    custom: { mode: 'nl', value: 'Modern clean with balanced colors and professional polish' },
  };

  return defaults[appType] || { mode: 'nl', value: 'Modern clean with balanced colors and professional polish' };
}
