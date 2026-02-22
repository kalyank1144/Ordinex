import { describe, it, expect } from 'vitest';
import {
  resolveStyleIntent,
  tokensFromHex,
  listVibePresets,
} from '../scaffold/styleIntentResolver';
import { contrastRatio } from '../scaffold/tokenValidator';

describe('resolveStyleIntent', () => {
  it('resolves vibe:minimal with valid tokens', () => {
    const result = resolveStyleIntent({ mode: 'vibe', value: 'minimal' });
    expect(result.tokens.background).toBe('#ffffff');
    expect(result.shadcnVars['--background']).toBeTruthy();
  });

  it('resolves vibe:dark_modern with dark tokens', () => {
    const result = resolveStyleIntent({ mode: 'vibe', value: 'dark_modern' });
    expect(result.tokens.background).toBe('#09090b');
  });

  it('resolves hex input with WCAG-valid tokens', () => {
    const result = resolveStyleIntent({ mode: 'hex', value: '#7c3aed' });
    expect(result.tokens.primary).toBe('#7c3aed');
    // foreground/background should pass WCAG AA
    expect(contrastRatio(result.tokens.foreground, result.tokens.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('resolves NL input by guessing vibe', () => {
    const result = resolveStyleIntent({ mode: 'nl', value: 'dark modern like Linear' });
    expect(result.tokens.background).toBe('#09090b');
  });

  it('falls back to minimal for unrecognized NL', () => {
    const result = resolveStyleIntent({ mode: 'nl', value: 'just a normal app' });
    expect(result.tokens.background).toBe('#ffffff');
  });

  it('produces corrections for failing tokens', () => {
    // Force a bad token pair by making foreground same as background
    const result = resolveStyleIntent({ mode: 'hex', value: '#ffffff' });
    // The resolver should auto-correct any failing pairs
    expect(contrastRatio(result.tokens.foreground, result.tokens.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('tokensFromHex', () => {
  it('generates dark theme tokens from dark hex', () => {
    const tokens = tokensFromHex('#1a1a2e');
    expect(tokens.background).not.toBe('#ffffff');
    expect(tokens.foreground).toBe('#fafafa');
  });

  it('generates light theme tokens from light hex', () => {
    const tokens = tokensFromHex('#3b82f6');
    expect(tokens.primary).toBe('#3b82f6');
  });

  it('always has destructive token', () => {
    const tokens = tokensFromHex('#00ff00');
    expect(tokens.destructive).toBe('#ef4444');
  });
});

describe('listVibePresets', () => {
  it('returns 7 presets', () => {
    const presets = listVibePresets();
    expect(presets).toHaveLength(7);
    expect(presets.map(p => p.id)).toContain('minimal');
    expect(presets.map(p => p.id)).toContain('dark_modern');
  });

  it('each preset has tokens', () => {
    const presets = listVibePresets();
    for (const p of presets) {
      expect(p.tokens.background).toBeTruthy();
      expect(p.tokens.primary).toBeTruthy();
    }
  });
});
