import { describe, it, expect } from 'vitest';
import {
  generateScale,
  generateDarkScale,
  generateThemeScales,
  generateFullTheme,
  mapScalesToTokens,
  mapDarkScalesToTokens,
  hexToOklch,
  oklchToHex,
  formatOklchCss,
  checkContrast,
} from '../scaffold/oklchEngine';

describe('oklchEngine', () => {
  describe('generateScale', () => {
    it('produces exactly 12 steps', async () => {
      const scale = await generateScale('#7c3aed');
      expect(scale.steps).toHaveLength(12);
      expect(scale.oklch).toHaveLength(12);
    });

    it('step 9 is close to the input color', async () => {
      const input = '#7c3aed';
      const scale = await generateScale(input);
      const step9 = scale.steps[8];
      expect(step9).toBe(input);
    });

    it('all steps are valid hex colors', async () => {
      const scale = await generateScale('#1e40af');
      for (const hex of scale.steps) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('lightness decreases from step 1 to step 12 for a mid-range color', async () => {
      const scale = await generateScale('#3b82f6');
      expect(scale.oklch[0].l).toBeGreaterThan(scale.oklch[8].l);
      expect(scale.oklch[8].l).toBeGreaterThan(scale.oklch[11].l);
    });

    it('chroma peaks at step 9', async () => {
      const scale = await generateScale('#7c3aed');
      const step9Chroma = scale.oklch[8].c;
      for (let i = 0; i < 12; i++) {
        if (i === 8) continue;
        expect(step9Chroma).toBeGreaterThanOrEqual(scale.oklch[i].c);
      }
    });

    it('handles achromatic colors (gray)', async () => {
      const scale = await generateScale('#808080');
      expect(scale.steps).toHaveLength(12);
      for (const hex of scale.steps) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('handles very light colors adaptively', async () => {
      const scale = await generateScale('#facc15'); // Yellow, L~0.88
      expect(scale.steps).toHaveLength(12);
      // Steps 1-8 should be distinguishable (not all identical near-white)
      const uniqueSteps = new Set(scale.steps.slice(0, 8));
      expect(uniqueSteps.size).toBeGreaterThan(3);
    });
  });

  describe('generateDarkScale', () => {
    it('produces exactly 12 steps', async () => {
      const scale = await generateDarkScale('#7c3aed');
      expect(scale.steps).toHaveLength(12);
    });

    it('step 1 is dark (low lightness)', async () => {
      const scale = await generateDarkScale('#3b82f6');
      expect(scale.oklch[0].l).toBeLessThan(0.2);
    });

    it('step 12 is light (high lightness)', async () => {
      const scale = await generateDarkScale('#3b82f6');
      expect(scale.oklch[11].l).toBeGreaterThan(0.8);
    });

    it('lightness increases from step 1 to step 12', async () => {
      const scale = await generateDarkScale('#3b82f6');
      expect(scale.oklch[0].l).toBeLessThan(scale.oklch[8].l);
      expect(scale.oklch[8].l).toBeLessThan(scale.oklch[11].l);
    });
  });

  describe('generateThemeScales', () => {
    it('returns primary, secondary, and accent scales', async () => {
      const scales = await generateThemeScales('#7c3aed', '#ec4899', '#f59e0b');
      expect(scales.primary.steps).toHaveLength(12);
      expect(scales.secondary.steps).toHaveLength(12);
      expect(scales.accent.steps).toHaveLength(12);
    });
  });

  describe('hexToOklch / oklchToHex', () => {
    it('round-trips a color with reasonable accuracy', async () => {
      const input = '#7c3aed';
      const oklch = await hexToOklch(input);
      const output = await oklchToHex(oklch);
      expect(output).toBe(input);
    });

    it('converts to expected OKLCH ranges', async () => {
      const oklch = await hexToOklch('#7c3aed');
      expect(oklch.l).toBeGreaterThan(0.4);
      expect(oklch.l).toBeLessThan(0.7);
      expect(oklch.c).toBeGreaterThan(0.15);
      expect(oklch.h).toBeGreaterThan(250);
      expect(oklch.h).toBeLessThan(320);
    });
  });

  describe('formatOklchCss', () => {
    it('formats as css oklch() string', () => {
      const css = formatOklchCss({ l: 0.5413, c: 0.2466, h: 293.01 });
      expect(css).toBe('oklch(0.5413 0.2466 293.01)');
    });
  });

  describe('checkContrast', () => {
    it('black on white passes WCAG AA', async () => {
      const result = await checkContrast('#000000', '#ffffff');
      expect(result.ratio).toBeGreaterThanOrEqual(21);
      expect(result.passes).toBe(true);
    });

    it('white on white fails WCAG AA', async () => {
      const result = await checkContrast('#ffffff', '#ffffff');
      expect(result.ratio).toBeCloseTo(1, 0);
      expect(result.passes).toBe(false);
    });

    it('reports accurate ratio for mid-contrast pair', async () => {
      const result = await checkContrast('#767676', '#ffffff');
      expect(result.ratio).toBeGreaterThan(4.5);
      expect(result.passes).toBe(true);
    });

    it('reports failing ratio for low-contrast pair', async () => {
      const result = await checkContrast('#aaaaaa', '#ffffff');
      expect(result.ratio).toBeLessThan(4.5);
      expect(result.passes).toBe(false);
    });
  });

  describe('mapScalesToTokens', () => {
    it('returns all ~20 token fields', async () => {
      const primary = await generateScale('#7c3aed');
      const secondary = await generateScale('#ec4899');
      const accent = await generateScale('#f59e0b');
      const tokens = mapScalesToTokens(primary, secondary, accent);

      expect(tokens.background).toBeDefined();
      expect(tokens.foreground).toBeDefined();
      expect(tokens.primary).toBeDefined();
      expect(tokens.primary_foreground).toBeDefined();
      expect(tokens.sidebar).toBeDefined();
      expect(tokens.sidebar_foreground).toBeDefined();
      expect(tokens.radius).toBe('0.5rem');
      expect(tokens.destructive).toBe('#ef4444');
    });

    it('maps primary scale correctly (step 9 = primary token)', async () => {
      const primary = await generateScale('#7c3aed');
      const secondary = await generateScale('#ec4899');
      const accent = await generateScale('#f59e0b');
      const tokens = mapScalesToTokens(primary, secondary, accent);

      expect(tokens.primary).toBe(primary.steps[8]);
      expect(tokens.background).toBe(primary.steps[0]);
      expect(tokens.foreground).toBe(primary.steps[11]);
    });

    it('accepts custom radius', async () => {
      const primary = await generateScale('#7c3aed');
      const secondary = await generateScale('#ec4899');
      const accent = await generateScale('#f59e0b');
      const tokens = mapScalesToTokens(primary, secondary, accent, { radius: '1rem' });
      expect(tokens.radius).toBe('1rem');
    });
  });

  describe('generateFullTheme', () => {
    it('returns light and dark token sets', async () => {
      const theme = await generateFullTheme('#7c3aed', '#ec4899', '#f59e0b');

      expect(theme.light.background).toBeDefined();
      expect(theme.dark.background).toBeDefined();

      // Light bg should be lighter than dark bg
      const lightBgOklch = await hexToOklch(theme.light.background);
      const darkBgOklch = await hexToOklch(theme.dark.background);
      expect(lightBgOklch.l).toBeGreaterThan(darkBgOklch.l);
    });

    it('dark foreground is lighter than light foreground', async () => {
      const theme = await generateFullTheme('#3b82f6', '#10b981', '#f59e0b');
      const lightFg = await hexToOklch(theme.light.foreground);
      const darkFg = await hexToOklch(theme.dark.foreground);
      expect(darkFg.l).toBeGreaterThan(lightFg.l);
    });
  });
});
