/**
 * Token Validator — WCAG AA contrast enforcement for design tokens.
 *
 * Checks foreground/background contrast pairs and auto-corrects
 * foreground colors until they pass the 4.5:1 minimum ratio.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface DesignTokens {
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
  popover?: string;
  popover_foreground?: string;
  border: string;
  input: string;
  ring: string;
  chart_1?: string;
  chart_2?: string;
  chart_3?: string;
  chart_4?: string;
  chart_5?: string;
  sidebar?: string;
  sidebar_foreground?: string;
  sidebar_primary?: string;
  sidebar_primary_foreground?: string;
  sidebar_accent?: string;
  sidebar_accent_foreground?: string;
  sidebar_border?: string;
  sidebar_ring?: string;
  radius?: string;
}

export interface ContrastCheckResult {
  pair: string;
  fg: string;
  bg: string;
  ratio: number;
  passes: boolean;
}

export interface TokenValidationResult {
  valid: boolean;
  checks: ContrastCheckResult[];
  corrected: DesignTokens;
  corrections: string[];
}

// ============================================================================
// COLOR MATH
// ============================================================================

function hexToRgb(hex: string): [number, number, number] {
  const rgbaMatch = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbaMatch) {
    return [parseInt(rgbaMatch[1]), parseInt(rgbaMatch[2]), parseInt(rgbaMatch[3])];
  }
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Calculate WCAG contrast ratio between two colors.
 * Returns a ratio >= 1 (higher is better).
 * WCAG AA requires >= 4.5 for normal text.
 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Lighten a color by a given amount (0-1).
 */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    Math.min(255, r + (255 - r) * amount),
    Math.min(255, g + (255 - g) * amount),
    Math.min(255, b + (255 - b) * amount),
  );
}

/**
 * Darken a color by a given amount (0-1).
 */
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

// ============================================================================
// CORRECTION
// ============================================================================

const WCAG_AA_RATIO = 4.5;

/**
 * Adjust a foreground color until it achieves WCAG AA contrast against the background.
 * If the background is dark, we lighten the foreground; if light, we darken it.
 */
function correctForeground(fg: string, bg: string): string {
  if (contrastRatio(fg, bg) >= WCAG_AA_RATIO) return fg;

  const bgLum = relativeLuminance(bg);
  const shouldLighten = bgLum < 0.5;

  let corrected = fg;
  for (let step = 0.05; step <= 1.0; step += 0.05) {
    corrected = shouldLighten ? lighten(fg, step) : darken(fg, step);
    if (contrastRatio(corrected, bg) >= WCAG_AA_RATIO) return corrected;
  }

  // Extreme fallback: pure white or black
  return shouldLighten ? '#ffffff' : '#000000';
}

// ============================================================================
// PUBLIC API
// ============================================================================

const REQUIRED_PAIRS: Array<{ pair: string; fgKey: keyof DesignTokens; bgKey: keyof DesignTokens }> = [
  { pair: 'foreground/background', fgKey: 'foreground', bgKey: 'background' },
  { pair: 'primary_foreground/primary', fgKey: 'primary_foreground', bgKey: 'primary' },
  { pair: 'secondary_foreground/secondary', fgKey: 'secondary_foreground', bgKey: 'secondary' },
  { pair: 'muted_foreground/muted', fgKey: 'muted_foreground', bgKey: 'muted' },
  { pair: 'destructive_foreground/destructive', fgKey: 'destructive_foreground', bgKey: 'destructive' },
  { pair: 'accent_foreground/accent', fgKey: 'accent_foreground', bgKey: 'accent' },
  { pair: 'card_foreground/card', fgKey: 'card_foreground', bgKey: 'card' },
  { pair: 'popover_foreground/popover', fgKey: 'popover_foreground', bgKey: 'popover' },
  { pair: 'sidebar_foreground/sidebar', fgKey: 'sidebar_foreground', bgKey: 'sidebar' },
  { pair: 'sidebar_primary_foreground/sidebar_primary', fgKey: 'sidebar_primary_foreground', bgKey: 'sidebar_primary' },
  { pair: 'sidebar_accent_foreground/sidebar_accent', fgKey: 'sidebar_accent_foreground', bgKey: 'sidebar_accent' },
];

/**
 * Validate design tokens against WCAG AA and auto-correct failing pairs.
 */
export function validateAndCorrectTokens(tokens: DesignTokens): TokenValidationResult {
  const corrected = { ...tokens };
  const checks: ContrastCheckResult[] = [];
  const corrections: string[] = [];

  for (const { pair, fgKey, bgKey } of REQUIRED_PAIRS) {
    const fg = corrected[fgKey];
    const bg = corrected[bgKey];

    if (!fg || !bg) continue;

    const ratio = contrastRatio(fg, bg);
    const passes = ratio >= WCAG_AA_RATIO;

    checks.push({ pair, fg, bg, ratio, passes });

    if (!passes) {
      const newFg = correctForeground(fg, bg);
      corrected[fgKey] = newFg;
      corrections.push(`${pair}: ${fg} → ${newFg} (ratio ${ratio.toFixed(2)} → ${contrastRatio(newFg, bg).toFixed(2)})`);
    }
  }

  return {
    valid: corrections.length === 0,
    checks,
    corrected,
    corrections,
  };
}

/**
 * Convert hex tokens to HSL strings for shadcn CSS variables.
 */
export function hexToHsl(hex: string): string {
  if (!hex || typeof hex !== 'string') return '0 0% 0%';
  const [r, g, b] = hexToRgb(hex).map(c => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return `0 0% ${Math.round(l * 100)}%`;

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Convert design tokens to shadcn CSS variable format (HSL values).
 */
export function tokensToShadcnVars(tokens: DesignTokens): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value === 'string' && value.startsWith('#')) {
      const cssKey = key.replace(/_/g, '-');
      vars[`--${cssKey}`] = hexToHsl(value);
    }
  }

  return vars;
}
