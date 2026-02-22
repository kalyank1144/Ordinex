import { describe, it, expect } from 'vitest';
import {
  contrastRatio,
  validateAndCorrectTokens,
  hexToHsl,
  tokensToShadcnVars,
} from '../scaffold/tokenValidator';
import type { DesignTokens } from '../scaffold/tokenValidator';

describe('contrastRatio', () => {
  it('returns 21:1 for black on white', () => {
    const ratio = contrastRatio('#000000', '#ffffff');
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('returns 1:1 for same color', () => {
    const ratio = contrastRatio('#ff0000', '#ff0000');
    expect(ratio).toBeCloseTo(1, 0);
  });

  it('calculates a mid-range ratio correctly', () => {
    const ratio = contrastRatio('#333333', '#ffffff');
    expect(ratio).toBeGreaterThan(4.5);
  });

  it('handles 3-char hex codes', () => {
    const ratio = contrastRatio('#000', '#fff');
    expect(ratio).toBeCloseTo(21, 0);
  });
});

describe('validateAndCorrectTokens', () => {
  const goodTokens: DesignTokens = {
    background: '#ffffff',
    foreground: '#000000',
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
    card_foreground: '#000000',
    border: '#e2e8f0',
    input: '#e2e8f0',
    ring: '#1e40af',
  };

  it('validates tokens that pass WCAG AA', () => {
    const result = validateAndCorrectTokens(goodTokens);
    expect(result.valid).toBe(true);
    expect(result.corrections).toHaveLength(0);
  });

  it('corrects failing contrast pairs', () => {
    const badTokens: DesignTokens = {
      ...goodTokens,
      foreground: '#cccccc', // Light gray on white — fails
    };
    const result = validateAndCorrectTokens(badTokens);
    expect(result.corrections.length).toBeGreaterThan(0);
    expect(result.corrected.foreground).not.toBe('#cccccc');
    // Corrected should pass
    expect(contrastRatio(result.corrected.foreground, result.corrected.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('handles dark backgrounds by lightening foreground', () => {
    const darkTokens: DesignTokens = {
      ...goodTokens,
      background: '#0a0a0a',
      foreground: '#333333', // Too dark on dark bg
    };
    const result = validateAndCorrectTokens(darkTokens);
    // Should lighten the foreground
    const correctedFg = result.corrected.foreground;
    expect(contrastRatio(correctedFg, '#0a0a0a')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('hexToHsl', () => {
  it('converts pure white', () => {
    const hsl = hexToHsl('#ffffff');
    expect(hsl).toContain('100%');
  });

  it('converts pure black', () => {
    const hsl = hexToHsl('#000000');
    expect(hsl).toContain('0%');
  });

  it('converts a mid-range color', () => {
    const hsl = hexToHsl('#3b82f6');
    expect(hsl).toBeTruthy();
    expect(hsl.split(' ')).toHaveLength(3);
  });
});

describe('tokensToShadcnVars', () => {
  it('converts token keys to CSS variable format', () => {
    const tokens: DesignTokens = {
      background: '#ffffff',
      foreground: '#000000',
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
      card_foreground: '#000000',
      border: '#e2e8f0',
      input: '#e2e8f0',
      ring: '#1e40af',
    };

    const vars = tokensToShadcnVars(tokens);
    expect(vars['--background']).toBeTruthy();
    expect(vars['--primary-foreground']).toBeTruthy();
    expect(vars['--muted-foreground']).toBeTruthy();
  });
});
