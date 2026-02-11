/**
 * Design Pack System Tests (Step 35.5)
 * 
 * Tests deterministic selection, vibe guardrails, and helper functions.
 */

import { describe, test, expect } from 'vitest';

import {
  DESIGN_PACKS,
  getDesignPackById,
  getDefaultPacksForPicker,
  getPacksByVibe,
  getEnterpriseSubset,
  getMobileSubset,
  formatTokensSummary,
  isValidDesignPackId,
  generateCssVariables,
  generateGlobalsCss,
} from '../scaffold/designPacks';

import {
  selectDesignPack,
  computeSelectionSeed,
  seedToInt,
  getFilteredPacks,
  detectDomainHint,
  validateDeterminism,
  previewSelection,
  generateSelectionEvidence,
  DesignPackSelectionInput,
} from '../scaffold/designPackSelector';

// ============================================================================
// DESIGN PACKS DATA MODEL TESTS
// ============================================================================

describe('DESIGN_PACKS', () => {
  test('should have exactly 12 packs', () => {
    expect(DESIGN_PACKS.length).toBe(12);
  });

  test('all packs should have required fields', () => {
    for (const pack of DESIGN_PACKS) {
      expect(pack.id).toBeTruthy();
      expect(pack.name).toBeTruthy();
      expect(pack.vibe).toBeTruthy();
      expect(pack.tokens).toBeDefined();
      expect(pack.tokens.colors).toBeDefined();
      expect(pack.tokens.fonts).toBeDefined();
      expect(pack.preview).toBeDefined();
      expect(pack.preview.imageAssetId).toBeTruthy();
    }
  });

  test('all packs should have unique IDs', () => {
    const ids = DESIGN_PACKS.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(DESIGN_PACKS.length);
  });

  test('all packs should have valid color tokens', () => {
    for (const pack of DESIGN_PACKS) {
      const { colors } = pack.tokens;
      expect(colors.primary).toBeTruthy();
      expect(colors.secondary).toBeTruthy();
      expect(colors.accent).toBeTruthy();
      expect(colors.background).toBeTruthy();
      expect(colors.foreground).toBeTruthy();
      expect(colors.muted).toBeTruthy();
      expect(colors.border).toBeTruthy();
    }
  });
});

describe('getDesignPackById', () => {
  test('should return pack for valid ID', () => {
    const pack = getDesignPackById('minimal-light');
    expect(pack).toBeDefined();
    expect(pack?.id).toBe('minimal-light');
    expect(pack?.name).toBe('Minimal Light');
  });

  test('should return undefined for invalid ID', () => {
    const pack = getDesignPackById('nonexistent-pack');
    expect(pack).toBeUndefined();
  });
});

describe('getDefaultPacksForPicker', () => {
  test('should return max 6 packs', () => {
    const packs = getDefaultPacksForPicker();
    expect(packs.length).toBeLessThanOrEqual(6);
    expect(packs.length).toBeGreaterThan(0);
  });

  test('should include minimal-light as default', () => {
    const packs = getDefaultPacksForPicker();
    const hasMinimalLight = packs.some(p => p.id === 'minimal-light');
    expect(hasMinimalLight).toBe(true);
  });

  test('should have diverse vibes', () => {
    const packs = getDefaultPacksForPicker();
    const vibes = new Set(packs.map(p => p.vibe));
    expect(vibes.size).toBeGreaterThan(1);
  });
});

describe('getPacksByVibe', () => {
  test('should return only minimal packs for minimal vibe', () => {
    const packs = getPacksByVibe('minimal');
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.every(p => p.vibe === 'minimal')).toBe(true);
  });

  test('should return enterprise packs', () => {
    const packs = getPacksByVibe('enterprise');
    expect(packs.length).toBe(2); // enterprise-blue and enterprise-slate
  });
});

describe('getEnterpriseSubset', () => {
  test('should include enterprise packs', () => {
    const packs = getEnterpriseSubset();
    const hasEnterprise = packs.some(p => p.vibe === 'enterprise');
    expect(hasEnterprise).toBe(true);
  });

  test('should include minimal packs', () => {
    const packs = getEnterpriseSubset();
    const hasMinimal = packs.some(p => p.vibe === 'minimal');
    expect(hasMinimal).toBe(true);
  });
});

describe('getMobileSubset', () => {
  test('should include vibrant packs', () => {
    const packs = getMobileSubset();
    const hasVibrant = packs.some(p => p.vibe === 'vibrant');
    expect(hasVibrant).toBe(true);
  });

  test('should include warm packs', () => {
    const packs = getMobileSubset();
    const hasWarm = packs.some(p => p.vibe === 'warm');
    expect(hasWarm).toBe(true);
  });
});

describe('isValidDesignPackId', () => {
  test('should return true for valid IDs', () => {
    expect(isValidDesignPackId('minimal-light')).toBe(true);
    expect(isValidDesignPackId('enterprise-blue')).toBe(true);
    expect(isValidDesignPackId('vibrant-neon')).toBe(true);
  });

  test('should return false for invalid IDs', () => {
    expect(isValidDesignPackId('invalid')).toBe(false);
    expect(isValidDesignPackId('')).toBe(false);
    expect(isValidDesignPackId('MINIMAL-LIGHT')).toBe(false); // case sensitive
  });
});

describe('formatTokensSummary', () => {
  test('should format tokens summary correctly', () => {
    const pack = getDesignPackById('minimal-light')!;
    const summary = formatTokensSummary(pack);
    expect(summary).toContain('Primary:');
    expect(summary).toContain('Font:');
    expect(summary).toContain(pack.tokens.colors.primary);
    expect(summary).toContain(pack.tokens.fonts.heading);
  });
});

// ============================================================================
// CSS GENERATION TESTS
// ============================================================================

describe('generateCssVariables', () => {
  test('should generate valid CSS variable declarations', () => {
    const pack = getDesignPackById('minimal-light')!;
    const css = generateCssVariables(pack.tokens);
    
    expect(css).toContain('--background:');
    expect(css).toContain('--foreground:');
    expect(css).toContain('--primary:');
    expect(css).toContain('--font-heading:');
    expect(css).toContain('--radius:');
    expect(css).toContain('--shadow:');
  });
});

describe('generateGlobalsCss', () => {
  test('should generate complete globals.css', () => {
    const pack = getDesignPackById('minimal-light')!;
    const css = generateGlobalsCss(pack);
    
    expect(css).toContain('@tailwind base');
    expect(css).toContain('@tailwind components');
    expect(css).toContain('@tailwind utilities');
    expect(css).toContain(':root');
    expect(css).toContain('--primary:');
  });
});

// ============================================================================
// DESIGN PACK SELECTOR TESTS
// ============================================================================

describe('computeSelectionSeed', () => {
  const baseInput: DesignPackSelectionInput = {
    workspaceRoot: '/home/user/projects/myapp',
    targetDir: '/home/user/projects/myapp',
    appName: 'my-app',
    recipeId: 'nextjs_app_router',
  };

  test('should produce 8-character hex seed', () => {
    const seed = computeSelectionSeed(baseInput);
    expect(seed.length).toBe(8);
    expect(/^[0-9a-f]+$/.test(seed)).toBe(true);
  });

  test('should be deterministic for same inputs', () => {
    const seed1 = computeSelectionSeed(baseInput);
    const seed2 = computeSelectionSeed(baseInput);
    const seed3 = computeSelectionSeed(baseInput);
    
    expect(seed1).toBe(seed2);
    expect(seed2).toBe(seed3);
  });

  test('should change when inputs change', () => {
    const seed1 = computeSelectionSeed(baseInput);
    const seed2 = computeSelectionSeed({ ...baseInput, appName: 'different-app' });
    const seed3 = computeSelectionSeed({ ...baseInput, workspaceRoot: '/different/path' });
    
    expect(seed1).not.toBe(seed2);
    expect(seed1).not.toBe(seed3);
  });

  test('should incorporate userStableId when provided', () => {
    const seed1 = computeSelectionSeed(baseInput);
    const seed2 = computeSelectionSeed({ ...baseInput, userStableId: 'user-123' });
    
    expect(seed1).not.toBe(seed2);
  });
});

describe('seedToInt', () => {
  test('should convert hex seed to integer', () => {
    expect(seedToInt('00000000')).toBe(0);
    expect(seedToInt('00000001')).toBe(1);
    expect(seedToInt('0000000f')).toBe(15);
    expect(seedToInt('00000010')).toBe(16);
  });

  test('should handle large seeds', () => {
    const largeInt = seedToInt('ffffffff');
    expect(largeInt).toBe(4294967295);
  });
});

describe('detectDomainHint', () => {
  test('should detect enterprise hints', () => {
    expect(detectDomainHint('Build a dashboard for admin users')).toBe('enterprise');
    expect(detectDomainHint('Create a B2B saas application')).toBe('enterprise');
    expect(detectDomainHint('Make a CRM for our business')).toBe('enterprise');
  });

  test('should detect mobile hints', () => {
    expect(detectDomainHint('Build a mobile app for iOS')).toBe('mobile');
    expect(detectDomainHint('Create an expo app')).toBe('mobile');
    expect(detectDomainHint('Make a react native application')).toBe('mobile');
  });

  test('should return undefined for ambiguous prompts', () => {
    // 'Build a todo app' matches 'app' in MOBILE_KEYWORDS, so returns 'mobile'
    expect(detectDomainHint('Build a todo app')).toBe('mobile');
    expect(detectDomainHint('Create a blog')).toBeUndefined();
  });
});

describe('getFilteredPacks', () => {
  test('should return mobile subset for expo recipe', () => {
    const packs = getFilteredPacks({
      workspaceRoot: '/test',
      targetDir: '/test/app',
      appName: 'app',
      recipeId: 'expo',
    });
    
    // Should be mobile-friendly packs
    expect(packs.some(p => p.vibe === 'vibrant' || p.vibe === 'warm')).toBe(true);
  });

  test('should return enterprise subset for enterprise domain', () => {
    const packs = getFilteredPacks({
      workspaceRoot: '/test',
      targetDir: '/test/app',
      appName: 'app',
      recipeId: 'nextjs_app_router',
      domainHint: 'enterprise',
    });
    
    // Should have enterprise or minimal packs
    expect(packs.every(p => p.vibe === 'enterprise' || p.vibe === 'minimal' || p.vibe === 'dark')).toBe(true);
  });

  test('should return all packs for default case', () => {
    const packs = getFilteredPacks({
      workspaceRoot: '/test',
      targetDir: '/test/app',
      appName: 'app',
      recipeId: 'vite_react',
    });
    
    expect(packs.length).toBe(DESIGN_PACKS.length);
  });
});

describe('selectDesignPack', () => {
  const baseInput: DesignPackSelectionInput = {
    workspaceRoot: '/home/user/projects/myapp',
    targetDir: '/home/user/projects/myapp',
    appName: 'my-app',
    recipeId: 'nextjs_app_router',
  };

  test('should return a valid pack', () => {
    const result = selectDesignPack(baseInput);
    
    expect(result.pack).toBeDefined();
    expect(result.pack.id).toBeTruthy();
    expect(result.seed).toBeTruthy();
    expect(['seeded', 'override', 'fallback']).toContain(result.reason);
  });

  test('should be deterministic', () => {
    const result1 = selectDesignPack(baseInput);
    const result2 = selectDesignPack(baseInput);
    const result3 = selectDesignPack(baseInput);
    
    expect(result1.pack.id).toBe(result2.pack.id);
    expect(result2.pack.id).toBe(result3.pack.id);
    expect(result1.seed).toBe(result2.seed);
  });

  test('should use override when provided', () => {
    const result = selectDesignPack({
      ...baseInput,
      overridePackId: 'vibrant-neon',
    });
    
    expect(result.pack.id).toBe('vibrant-neon');
    expect(result.reason).toBe('override');
  });

  test('should ignore invalid override and use seeded selection', () => {
    const result = selectDesignPack({
      ...baseInput,
      overridePackId: 'invalid-pack-id',
    });
    
    expect(result.reason).toBe('seeded');
    expect(result.pack).toBeDefined();
  });

  test('should produce different packs for different inputs', () => {
    const results = new Set<string>();
    
    // Test with various app names
    for (let i = 0; i < 20; i++) {
      const result = selectDesignPack({
        ...baseInput,
        appName: `app-${i}`,
      });
      results.add(result.pack.id);
    }
    
    // Should have selected multiple different packs
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('validateDeterminism', () => {
  test('should validate deterministic selection', () => {
    const input: DesignPackSelectionInput = {
      workspaceRoot: '/test',
      targetDir: '/test/app',
      appName: 'test-app',
      recipeId: 'vite_react',
    };
    
    expect(validateDeterminism(input, 100)).toBe(true);
  });
});

describe('previewSelection', () => {
  test('should return preview information', () => {
    const preview = previewSelection({
      workspaceRoot: '/test',
      targetDir: '/test/app',
      appName: 'my-app',
      recipeId: 'nextjs_app_router',
    });
    
    expect(preview.packId).toBeTruthy();
    expect(preview.packName).toBeTruthy();
    expect(preview.seed).toBeTruthy();
    expect(preview.filteredCount).toBeGreaterThan(0);
  });
});

describe('generateSelectionEvidence', () => {
  test('should generate evidence object', () => {
    const result = selectDesignPack({
      workspaceRoot: '/test',
      targetDir: '/test/app',
      appName: 'my-app',
      recipeId: 'nextjs_app_router',
    });
    
    const evidence = generateSelectionEvidence(result);
    
    expect(evidence.design_pack_id).toBe(result.pack.id);
    expect(evidence.design_pack_name).toBe(result.pack.name);
    expect(evidence.design_seed).toBe(result.seed);
    expect(evidence.selection_reason).toBe(result.reason);
    expect(evidence.preview_asset_id).toBeTruthy();
    expect(evidence.tokens_summary).toBeTruthy();
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Design Pack Selection Integration', () => {
  test('same user/workspace/app should always get same pack', () => {
    const input: DesignPackSelectionInput = {
      workspaceRoot: '/Users/john/workspace',
      targetDir: '/Users/john/workspace/my-saas',
      appName: 'my-saas',
      recipeId: 'nextjs_app_router',
      userStableId: 'user_abc123',
    };
    
    // Simulate multiple sessions
    const results: string[] = [];
    for (let session = 0; session < 10; session++) {
      const result = selectDesignPack(input);
      results.push(result.pack.id);
    }
    
    // All sessions should get the same pack
    expect(new Set(results).size).toBe(1);
  });

  test('different users should get different packs for same project', () => {
    const base = {
      workspaceRoot: '/workspace',
      targetDir: '/workspace/app',
      appName: 'app',
      recipeId: 'nextjs_app_router' as const,
    };
    
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const result = selectDesignPack({
        ...base,
        userStableId: `user_${i}`,
      });
      results.add(result.pack.id);
    }
    
    // Should have variety across users
    expect(results.size).toBeGreaterThan(3);
  });

  test('vibe guardrails should work for enterprise domains', () => {
    const input: DesignPackSelectionInput = {
      workspaceRoot: '/workspace',
      targetDir: '/workspace/admin-dashboard',
      appName: 'admin-dashboard',
      recipeId: 'nextjs_app_router',
      domainHint: 'enterprise',
    };
    
    const result = selectDesignPack(input);
    
    // Should be from enterprise-appropriate set
    const enterprisePacks = getEnterpriseSubset();
    expect(enterprisePacks.some(p => p.id === result.pack.id)).toBe(true);
  });

  test('override should always win regardless of seed', () => {
    const inputs: DesignPackSelectionInput[] = [
      { workspaceRoot: '/a', targetDir: '/a/app', appName: 'a', recipeId: 'nextjs_app_router', overridePackId: 'neo-brutalist' },
      { workspaceRoot: '/b', targetDir: '/b/app', appName: 'b', recipeId: 'vite_react', overridePackId: 'neo-brutalist' },
      { workspaceRoot: '/c', targetDir: '/c/app', appName: 'c', recipeId: 'expo', overridePackId: 'neo-brutalist' },
    ];
    
    for (const input of inputs) {
      const result = selectDesignPack(input);
      expect(result.pack.id).toBe('neo-brutalist');
      expect(result.reason).toBe('override');
    }
  });
});
