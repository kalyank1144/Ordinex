/**
 * OKLCH Color Engine — Algorithmic theme generation using culori.
 *
 * Wraps the culori library (ESM, loaded via dynamic import) and builds
 * Radix-style 12-step color scales in perceptually-uniform OKLCH space.
 *
 * Each scale step has a defined purpose:
 *   1-2:  App/subtle backgrounds
 *   3-4:  Element backgrounds (default/hover)
 *   5-6:  Borders (subtle/default)
 *   7-8:  Borders (strong) / focus ring
 *   9:    Solid backgrounds (buttons, badges) — the anchor color
 *   10:   Solid backgrounds hover
 *   11:   Low-contrast text
 *   12:   High-contrast text
 */

// ============================================================================
// TYPES
// ============================================================================

export interface OklchColor {
  l: number;  // Lightness 0–1
  c: number;  // Chroma 0–~0.4
  h: number;  // Hue 0–360
}

export interface ColorScale {
  steps: string[];      // 12 hex strings
  oklch: OklchColor[];  // 12 OKLCH values
}

export interface ThemeScales {
  primary: ColorScale;
  secondary: ColorScale;
  accent: ColorScale;
}

// ============================================================================
// CULORI DYNAMIC LOADER
// ============================================================================

interface CuloriApi {
  parse: (input: string) => any | undefined;
  oklch: (color: any) => { mode: 'oklch'; l: number; c: number; h: number; alpha?: number };
  rgb: (color: any) => { mode: 'rgb'; r: number; g: number; b: number; alpha?: number };
  formatHex: (color: any) => string;
  clampChroma: (color: any, mode: string) => any;
}

let _culori: CuloriApi | null = null;

async function getCulori(): Promise<CuloriApi> {
  if (!_culori) {
    // culori v4 ships a CJS bundle so require() works at runtime.
    // In Vitest, Vite handles the import natively.
    const mod = await import('culori');
    _culori = mod as unknown as CuloriApi;
  }
  return _culori;
}

// ============================================================================
// SCALE CURVES (Radix-inspired)
// ============================================================================

// Light-mode lightness targets. null = derived from the base color's L.
const LIGHT_L: (number | null)[] = [
  0.988,  // 1: app background
  0.972,  // 2: subtle background
  0.944,  // 3: element background
  0.917,  // 4: element background hover
  0.883,  // 5: subtle border
  0.838,  // 6: border
  0.773,  // 7: strong border
  0.682,  // 8: focus ring
  null,   // 9: anchor (base L)
  null,   // 10: anchor − offset
  0.430,  // 11: low-contrast text
  0.282,  // 12: high-contrast text
];

// Chroma as fraction of base C (peak at step 9)
const LIGHT_C_FACTOR: number[] = [
  0.005, 0.034, 0.094, 0.153, 0.227, 0.315,
  0.458, 0.655, 1.000, 0.970, 0.837, 0.596,
];

// Dark-mode lightness targets
const DARK_L: (number | null)[] = [
  0.130,  // 1: dark app background
  0.160,  // 2: subtle dark bg
  0.196,  // 3: element bg
  0.227,  // 4: element bg hover
  0.261,  // 5: subtle border
  0.305,  // 6: border
  0.363,  // 7: strong border
  0.425,  // 8: focus ring
  null,   // 9: anchor (boosted for dark bg)
  null,   // 10: anchor + offset
  0.800,  // 11: low-contrast text on dark
  0.935,  // 12: high-contrast text on dark
];

const DARK_C_FACTOR: number[] = [
  0.005, 0.020, 0.050, 0.085, 0.130, 0.190,
  0.310, 0.480, 0.950, 0.900, 0.450, 0.200,
];

// ============================================================================
// HELPERS
// ============================================================================

function safeHue(h: number | undefined): number {
  if (h === undefined || isNaN(h)) return 0;
  return h;
}

// ============================================================================
// CORE SCALE GENERATION
// ============================================================================

/**
 * Generate a 12-step Radix-style color scale (light mode) from a single hex.
 * The input color anchors at step 9 (solid backgrounds / buttons).
 */
export async function generateScale(baseHex: string): Promise<ColorScale> {
  const culori = await getCulori();
  const parsed = culori.parse(baseHex);
  if (!parsed) throw new Error(`Invalid color: ${baseHex}`);

  const base = culori.oklch(parsed);
  const baseL = base.l ?? 0.5;
  const baseC = base.c ?? 0;
  const baseH = safeHue(base.h);

  const steps: string[] = [];
  const oklchValues: OklchColor[] = [];

  for (let i = 0; i < 12; i++) {
    let l: number;
    const c = baseC * LIGHT_C_FACTOR[i];

    if (i === 8) {
      l = baseL;
    } else if (i === 9) {
      l = Math.max(0.05, baseL - 0.04);
    } else {
      l = LIGHT_L[i]!;
    }

    // Adaptive compression: if the base color is very light (e.g. yellow L>0.75),
    // redistribute steps 1-8 so they don't all collapse into indistinguishable whites.
    if (i < 8 && baseL > 0.75) {
      const ceiling = 0.988;
      const range = ceiling - baseL;
      const fraction = (8 - i) / 8;
      l = baseL + range * fraction;
    }

    const color = { mode: 'oklch' as const, l, c, h: baseH };
    const clamped = culori.clampChroma(color, 'oklch');
    steps.push(culori.formatHex(clamped));
    oklchValues.push({ l, c, h: baseH });
  }

  return { steps, oklch: oklchValues };
}

/**
 * Generate a 12-step dark-mode scale from a single hex.
 * Step 9 is boosted in lightness for visibility on dark backgrounds.
 */
export async function generateDarkScale(baseHex: string): Promise<ColorScale> {
  const culori = await getCulori();
  const parsed = culori.parse(baseHex);
  if (!parsed) throw new Error(`Invalid color: ${baseHex}`);

  const base = culori.oklch(parsed);
  const baseL = base.l ?? 0.5;
  const baseC = base.c ?? 0;
  const baseH = safeHue(base.h);

  const steps: string[] = [];
  const oklchValues: OklchColor[] = [];

  for (let i = 0; i < 12; i++) {
    let l: number;
    const c = baseC * DARK_C_FACTOR[i];

    if (i === 8) {
      l = Math.min(0.85, baseL + 0.08);
    } else if (i === 9) {
      l = Math.min(0.90, baseL + 0.13);
    } else {
      l = DARK_L[i]!;
    }

    const color = { mode: 'oklch' as const, l, c, h: baseH };
    const clamped = culori.clampChroma(color, 'oklch');
    steps.push(culori.formatHex(clamped));
    oklchValues.push({ l, c, h: baseH });
  }

  return { steps, oklch: oklchValues };
}

/**
 * Generate three 12-step light-mode scales from seed hex colors.
 */
export async function generateThemeScales(
  primaryHex: string,
  secondaryHex: string,
  accentHex: string,
): Promise<ThemeScales> {
  const [primary, secondary, accent] = await Promise.all([
    generateScale(primaryHex),
    generateScale(secondaryHex),
    generateScale(accentHex),
  ]);
  return { primary, secondary, accent };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert a hex color to its OKLCH representation.
 */
export async function hexToOklch(hex: string): Promise<OklchColor> {
  const culori = await getCulori();
  const parsed = culori.parse(hex);
  if (!parsed) throw new Error(`Invalid color: ${hex}`);
  const c = culori.oklch(parsed);
  return { l: c.l ?? 0, c: c.c ?? 0, h: safeHue(c.h) };
}

/**
 * Convert an OKLCH color to hex with sRGB gamut clamping.
 */
export async function oklchToHex(color: OklchColor): Promise<string> {
  const culori = await getCulori();
  const c = { mode: 'oklch' as const, l: color.l, c: color.c, h: color.h };
  const clamped = culori.clampChroma(c, 'oklch');
  return culori.formatHex(clamped);
}

/**
 * Format an OKLCH value as a CSS oklch() function string.
 * Example: oklch(0.5413 0.2466 293.01)
 */
export function formatOklchCss(color: OklchColor): string {
  return `oklch(${color.l.toFixed(4)} ${color.c.toFixed(4)} ${color.h.toFixed(2)})`;
}

/**
 * Format raw OKLCH channels without the oklch() wrapper.
 * Used for CSS custom properties where the wrapper is applied in @theme.
 * Example: '0.5413 0.2466 293.01'
 */
export function formatOklchRaw(color: OklchColor): string {
  return `${color.l.toFixed(4)} ${color.c.toFixed(4)} ${color.h.toFixed(2)}`;
}

/**
 * Convert a hex color to an OKLCH CSS string.
 * Example: '#7c3aed' → 'oklch(0.5413 0.2466 293.01)'
 */
export async function hexToOklchCss(hex: string): Promise<string> {
  const oklch = await hexToOklch(hex);
  return formatOklchCss(oklch);
}

/**
 * Convert a hex color to raw OKLCH channel values (no wrapper).
 * Example: '#7c3aed' → '0.5413 0.2466 293.01'
 */
export async function hexToOklchRaw(hex: string): Promise<string> {
  const oklch = await hexToOklch(hex);
  return formatOklchRaw(oklch);
}

/**
 * Convert a record of hex tokens to raw OKLCH channel values for CSS variables.
 * Keys are CSS variable names (e.g., '--primary'), values are raw channels
 * like '0.5413 0.2466 293.01' (no oklch() wrapper — the wrapper is applied
 * in @theme or inline CSS rules).
 */
export async function tokensToOklchVars(
  tokens: Record<string, string | undefined>,
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  const entries = Object.entries(tokens).filter(
    ([, v]) => typeof v === 'string' && v.startsWith('#'),
  );

  console.log(`[tokensToOklchVars] Input: ${Object.keys(tokens).length} total keys, ${entries.length} hex entries`);

  const KEY_TO_CSS: Record<string, string> = {
    sidebar: '--sidebar-background',
  };

  const results = await Promise.all(
    entries.map(async ([key, hex]) => {
      const cssKey = KEY_TO_CSS[key] || `--${key.replace(/_/g, '-')}`;
      const rawChannels = await hexToOklchRaw(hex!);
      return [cssKey, rawChannels] as const;
    }),
  );

  for (const [key, value] of results) {
    vars[key] = value;
  }
  console.log(`[tokensToOklchVars] Output: ${Object.keys(vars).length} CSS vars generated. Keys: ${Object.keys(vars).join(', ')}`);
  return vars;
}

/**
 * WCAG 2.x contrast ratio between two hex colors.
 * AA normal text requires ratio >= 4.5.
 */
export async function checkContrast(
  fgHex: string,
  bgHex: string,
): Promise<{ ratio: number; passes: boolean }> {
  const culori = await getCulori();
  const fg = culori.parse(fgHex);
  const bg = culori.parse(bgHex);
  if (!fg || !bg) throw new Error('Invalid color');

  const fgRgb = culori.rgb(fg);
  const bgRgb = culori.rgb(bg);

  function luminance(rgb: { r: number; g: number; b: number }): number {
    const lin = (v: number) =>
      v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  }

  const l1 = luminance(fgRgb);
  const l2 = luminance(bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return { ratio, passes: ratio >= 4.5 };
}

// ============================================================================
// SEMANTIC TOKEN MAPPER (Phase 2a — ~20 tokens)
// ============================================================================

export interface SemanticTokens {
  background: string;
  foreground: string;
  primary: string;
  primary_foreground: string;
  secondary: string;
  secondary_foreground: string;
  muted: string;
  muted_foreground: string;
  destructive: string;
  destructive_foreground: string;
  accent: string;
  accent_foreground: string;
  card: string;
  card_foreground: string;
  popover: string;
  popover_foreground: string;
  border: string;
  input: string;
  ring: string;
  chart_1: string;
  chart_2: string;
  chart_3: string;
  chart_4: string;
  chart_5: string;
  sidebar: string;
  sidebar_foreground: string;
  sidebar_primary: string;
  sidebar_primary_foreground: string;
  sidebar_accent: string;
  sidebar_accent_foreground: string;
  sidebar_border: string;
  sidebar_ring: string;
  radius: string;
}

/**
 * Map three 12-step scales to ~20 semantic tokens.
 *
 * Mapping logic (light mode):
 *   background      = primary[1]   (lightest, app bg)
 *   foreground       = primary[12]  (darkest, high-contrast text)
 *   primary          = primary[9]   (the anchor)
 *   primary_fg       = primary[1]   (light text on primary solid)
 *   secondary        = secondary[3] (subtle element bg)
 *   secondary_fg     = secondary[12]
 *   muted            = primary[2]   (subtle bg variant)
 *   muted_fg         = primary[11]  (low-contrast text)
 *   destructive      = red step 9 (hardcoded hue ~25°, C~0.2)
 *   destructive_fg   = white
 *   accent           = accent[3]    (subtle accent bg)
 *   accent_fg        = accent[12]
 *   card             = primary[2]   (slightly off-white surface)
 *   card_fg          = primary[12]
 *   border           = primary[6]
 *   input            = primary[6]
 *   ring             = primary[8]
 *   sidebar          = primary[2]
 *   sidebar_fg       = primary[12]
 */
export function mapScalesToTokens(
  primary: ColorScale,
  secondary: ColorScale,
  accent: ColorScale,
  options?: { radius?: string },
): SemanticTokens {
  return {
    background:             primary.steps[0],    // step 1
    foreground:             primary.steps[11],   // step 12
    primary:                primary.steps[8],    // step 9 (anchor)
    primary_foreground:     primary.steps[0],    // step 1 (light on dark solid)
    secondary:              secondary.steps[2],  // step 3
    secondary_foreground:   secondary.steps[11], // step 12
    muted:                  primary.steps[1],    // step 2
    muted_foreground:       primary.steps[10],   // step 11
    destructive:            '#ef4444',
    destructive_foreground: '#ffffff',
    accent:                 accent.steps[2],     // step 3
    accent_foreground:      accent.steps[11],    // step 12
    card:                   primary.steps[1],    // step 2
    card_foreground:        primary.steps[11],   // step 12
    popover:                primary.steps[1],    // step 2 (same as card)
    popover_foreground:     primary.steps[11],   // step 12
    border:                 primary.steps[5],    // step 6
    input:                  primary.steps[5],    // step 6
    ring:                   primary.steps[7],    // step 8
    chart_1:                primary.steps[8],    // step 9 — primary anchor
    chart_2:                secondary.steps[8],  // step 9 — secondary anchor
    chart_3:                accent.steps[8],     // step 9 — accent anchor
    chart_4:                accent.steps[6],     // step 7 — lighter accent
    chart_5:                secondary.steps[6],  // step 7 — lighter secondary
    sidebar:                primary.steps[1],    // step 2
    sidebar_foreground:     primary.steps[11],   // step 12
    sidebar_primary:        primary.steps[8],    // step 9 (active item)
    sidebar_primary_foreground: primary.steps[0], // step 1
    sidebar_accent:         primary.steps[2],    // step 3 (hover state)
    sidebar_accent_foreground: primary.steps[11], // step 12
    sidebar_border:         primary.steps[4],    // step 5 (subtle)
    sidebar_ring:           primary.steps[7],    // step 8
    radius:                 options?.radius || '0.5rem',
  };
}

/**
 * Map three 12-step dark scales to ~20 semantic tokens for dark mode.
 */
export function mapDarkScalesToTokens(
  primary: ColorScale,
  secondary: ColorScale,
  accent: ColorScale,
  options?: { radius?: string },
): SemanticTokens {
  return {
    background:             primary.steps[0],
    foreground:             primary.steps[11],
    primary:                primary.steps[8],
    primary_foreground:     primary.steps[0],
    secondary:              secondary.steps[2],
    secondary_foreground:   secondary.steps[11],
    muted:                  primary.steps[1],
    muted_foreground:       primary.steps[10],
    destructive:            '#7f1d1d',
    destructive_foreground: '#fafafa',
    accent:                 accent.steps[2],
    accent_foreground:      accent.steps[11],
    card:                   primary.steps[1],
    card_foreground:        primary.steps[11],
    popover:                primary.steps[1],
    popover_foreground:     primary.steps[11],
    border:                 primary.steps[5],
    input:                  primary.steps[5],
    ring:                   primary.steps[7],
    chart_1:                primary.steps[8],
    chart_2:                secondary.steps[8],
    chart_3:                accent.steps[8],
    chart_4:                accent.steps[6],
    chart_5:                secondary.steps[6],
    sidebar:                primary.steps[1],
    sidebar_foreground:     primary.steps[11],
    sidebar_primary:        primary.steps[8],
    sidebar_primary_foreground: primary.steps[0],
    sidebar_accent:         primary.steps[2],
    sidebar_accent_foreground: primary.steps[11],
    sidebar_border:         primary.steps[4],
    sidebar_ring:           primary.steps[7],
    radius:                 options?.radius || '0.5rem',
  };
}

/**
 * Convenience: from 3 seed hex colors, generate full light + dark token sets.
 */
export async function generateFullTheme(
  primaryHex: string,
  secondaryHex: string,
  accentHex: string,
  options?: { radius?: string },
): Promise<{ light: SemanticTokens; dark: SemanticTokens }> {
  const [pLight, sLight, aLight, pDark, sDark, aDark] = await Promise.all([
    generateScale(primaryHex),
    generateScale(secondaryHex),
    generateScale(accentHex),
    generateDarkScale(primaryHex),
    generateDarkScale(secondaryHex),
    generateDarkScale(accentHex),
  ]);

  return {
    light: mapScalesToTokens(pLight, sLight, aLight, options),
    dark: mapDarkScalesToTokens(pDark, sDark, aDark, options),
  };
}
