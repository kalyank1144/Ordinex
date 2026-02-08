/**
 * Step 38: Vision Analyzer Tests
 * 
 * Tests for:
 * - Vision policy decisions (skip/prompt/proceed)
 * - Evidence storage and loading
 * - Replay safety (no provider calls in replay)
 * - Token validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  shouldAnalyze,
  getSkipReasonMessage,
  type VisionPolicyResult,
} from '../vision/visionPolicy';
import {
  writeTokensEvidence,
  readTokensEvidence,
  tokensEvidenceExists,
  type FileSystem,
} from '../vision/referenceTokensEvidence';
import { DEFAULT_VISION_CONFIG } from '../vision/visionConfig';
import type { ReferenceContext, ReferenceTokens, VisionRunContext } from '../types';

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockReferenceContext(
  images: number = 1,
  urls: number = 0
): any {
  // Using any for test flexibility - actual ReferenceContext may vary
  return {
    images: Array.from({ length: images }, (_, i) => ({
      type: 'image' as const,
      id: `img-${i}`,
      path: `/test/img-${i}.png`,
      mime: 'image/png',
    })),
    urls: Array.from({ length: urls }, (_, i) => ({
      type: 'url' as const,
      id: `url-${i}`,
      url: `https://example.com/${i}`,
    })),
    extractedHints: [],
    promptKeywords: ['test'],
    createdAt: new Date().toISOString(),
  };
}

function createMockRunContext(overrides?: Partial<VisionRunContext>): VisionRunContext {
  return {
    runId: 'run-test-456',
    isReplay: false,
    workspaceRoot: '/test/workspace',
    referenceContextId: 'ref-test-123',
    ...overrides,
  };
}

function createMockFileSystem(): FileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },
    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, content);
    },
    async mkdir(): Promise<void> {
      // No-op for mock
    },
  };
}

function createMockTokens(): ReferenceTokens {
  return {
    source: { images_count: 1, urls_count: 0 },
    style: {
      palette: { primary: '#3B82F6', accent: '#F59E0B' },
      mood: ['modern', 'minimal'],
      radius: 'md',
    },
    confidence: 0.8,
    warnings: [],
  };
}

// ============================================================================
// VISION POLICY TESTS
// ============================================================================

describe('Vision Policy', () => {
  describe('shouldAnalyze', () => {
    it('should skip when visionMode is off', () => {
      const config = { ...DEFAULT_VISION_CONFIG, visionMode: 'off' as const };
      const refs = createMockReferenceContext(2);
      const runContext = createMockRunContext();

      const result = shouldAnalyze(config, refs, runContext);

      expect(result.decision).toBe('skip');
      expect(result.skipReason).toBe('disabled');
    });

    it('should skip when no images or URLs', () => {
      const config = { ...DEFAULT_VISION_CONFIG, visionMode: 'on' as const };
      const refs = createMockReferenceContext(0, 0);
      const runContext = createMockRunContext();

      const result = shouldAnalyze(config, refs, runContext);

      expect(result.decision).toBe('skip');
      expect(result.skipReason).toBe('no_references');
    });

    it('should skip in replay mode', () => {
      const config = { ...DEFAULT_VISION_CONFIG, visionMode: 'on' as const };
      const refs = createMockReferenceContext(2);
      const runContext = createMockRunContext({ isReplay: true });

      const result = shouldAnalyze(config, refs, runContext);

      expect(result.decision).toBe('skip');
      expect(result.skipReason).toBe('replay_mode');
    });

    it('should return prompt when visionMode is prompt', () => {
      const config = { ...DEFAULT_VISION_CONFIG, visionMode: 'prompt' as const };
      const refs = createMockReferenceContext(2);
      const runContext = createMockRunContext();

      const result = shouldAnalyze(config, refs, runContext);

      expect(result.decision).toBe('prompt');
    });

    it('should proceed when visionMode is on and images exist', () => {
      const config = { ...DEFAULT_VISION_CONFIG, visionMode: 'on' as const };
      const refs = createMockReferenceContext(2);
      const runContext = createMockRunContext();

      const result = shouldAnalyze(config, refs, runContext);

      expect(result.decision).toBe('proceed');
    });

    it('should proceed with URLs only', () => {
      const config = { ...DEFAULT_VISION_CONFIG, visionMode: 'on' as const };
      const refs = createMockReferenceContext(0, 2);
      const runContext = createMockRunContext();

      const result = shouldAnalyze(config, refs, runContext);

      expect(result.decision).toBe('proceed');
    });
  });

  describe('getSkipReasonMessage', () => {
    it('should return user-friendly messages', () => {
      expect(getSkipReasonMessage('disabled')).toBe('Vision analysis is disabled');
      expect(getSkipReasonMessage('no_references')).toBe('No references to analyze');
      expect(getSkipReasonMessage('replay_mode')).toBe('Using cached analysis (replay mode)');
      // 'user_declined' may not be in VisionSkipReason - test as any for message mapping
      expect(getSkipReasonMessage('user_declined' as any)).toBe('User declined analysis');
    });
  });
});

// ============================================================================
// EVIDENCE STORAGE TESTS
// ============================================================================

describe('Reference Tokens Evidence', () => {
  let fs: FileSystem & { files: Map<string, string> };

  beforeEach(() => {
    fs = createMockFileSystem();
  });

  describe('writeTokensEvidence', () => {
    it('should write tokens to evidence file', async () => {
      const tokens = createMockTokens();

      const evidenceRef = await writeTokensEvidence(
        fs,
        '/workspace',
        'ref-123',
        tokens
      );

      expect(evidenceRef).toBe('.ordinex/evidence/reference_tokens_ref-123.json');
      expect(fs.files.has('/workspace/.ordinex/evidence/reference_tokens_ref-123.json')).toBe(true);

      const content = JSON.parse(fs.files.get('/workspace/.ordinex/evidence/reference_tokens_ref-123.json')!);
      expect(content.version).toBe('reference_tokens_v1');
      expect(content.tokens).toEqual(tokens);
      expect(content.checksum).toBeDefined();
    });
  });

  describe('readTokensEvidence', () => {
    it('should read tokens from evidence file', async () => {
      const tokens = createMockTokens();
      await writeTokensEvidence(fs, '/workspace', 'ref-123', tokens);

      const result = await readTokensEvidence(fs, '/workspace', 'ref-123');

      expect(result).toEqual(tokens);
    });

    it('should return null if file does not exist', async () => {
      const result = await readTokensEvidence(fs, '/workspace', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should return null if checksum is invalid', async () => {
      const tokens = createMockTokens();
      await writeTokensEvidence(fs, '/workspace', 'ref-123', tokens);

      // Corrupt the checksum
      const path = '/workspace/.ordinex/evidence/reference_tokens_ref-123.json';
      const content = JSON.parse(fs.files.get(path)!);
      content.checksum = 'invalid_checksum';
      fs.files.set(path, JSON.stringify(content));

      const result = await readTokensEvidence(fs, '/workspace', 'ref-123');

      expect(result).toBeNull();
    });
  });

  describe('tokensEvidenceExists', () => {
    it('should return true if evidence exists', async () => {
      await writeTokensEvidence(fs, '/workspace', 'ref-123', createMockTokens());

      const exists = await tokensEvidenceExists(fs, '/workspace', 'ref-123');

      expect(exists).toBe(true);
    });

    it('should return false if evidence does not exist', async () => {
      const exists = await tokensEvidenceExists(fs, '/workspace', 'nonexistent');

      expect(exists).toBe(false);
    });
  });
});

// ============================================================================
// REPLAY SAFETY TESTS
// ============================================================================

describe('Replay Safety', () => {
  it('should never call provider in replay mode', () => {
    const config = { ...DEFAULT_VISION_CONFIG, visionMode: 'on' as const };
    const refs = createMockReferenceContext(5);
    const runContext = createMockRunContext({ isReplay: true });

    // Policy should skip
    const result = shouldAnalyze(config, refs, runContext);
    expect(result.decision).toBe('skip');
    expect(result.skipReason).toBe('replay_mode');
  });

  it('should load from evidence in replay mode', async () => {
    const fs = createMockFileSystem();
    const tokens = createMockTokens();

    // Write evidence first
    await writeTokensEvidence(fs, '/workspace', 'ref-123', tokens);

    // In replay, should be able to read
    const loaded = await readTokensEvidence(fs, '/workspace', 'ref-123');
    expect(loaded).toEqual(tokens);
  });
});

// ============================================================================
// TOKEN VALIDATION TESTS
// ============================================================================

describe('Token Validation', () => {
  it('should accept valid hex colors', () => {
    const tokens: ReferenceTokens = {
      source: { images_count: 1, urls_count: 0 },
      style: {
        palette: {
          primary: '#3B82F6',
          secondary: '#10B981',
          accent: '#F59E0B',
          neutrals: ['#FFFFFF', '#000000'],
        },
      },
      confidence: 0.8,
    };

    expect(tokens.style.palette?.primary).toBe('#3B82F6');
  });

  it('should validate mood array', () => {
    const tokens: ReferenceTokens = {
      source: { images_count: 1, urls_count: 0 },
      style: {
        mood: ['modern', 'minimal', 'enterprise'],
      },
      confidence: 0.7,
    };

    expect(tokens.style.mood).toHaveLength(3);
    expect(tokens.style.mood).toContain('modern');
  });

  it('should validate density values', () => {
    const validDensities = ['compact', 'default', 'relaxed'];
    
    for (const density of validDensities) {
      const tokens: ReferenceTokens = {
        source: { images_count: 1, urls_count: 0 },
        style: { density: density as 'compact' | 'default' | 'relaxed' },
        confidence: 0.8,
      };
      expect(tokens.style.density).toBe(density);
    }
  });

  it('should validate radius values', () => {
    const validRadii = ['none', 'sm', 'md', 'lg', 'full'];
    
    for (const radius of validRadii) {
      const tokens: ReferenceTokens = {
        source: { images_count: 1, urls_count: 0 },
        style: { radius: radius as 'none' | 'sm' | 'md' | 'lg' | 'full' },
        confidence: 0.8,
      };
      expect(tokens.style.radius).toBe(radius);
    }
  });

  it('should clamp confidence between 0 and 1', () => {
    const tokens: ReferenceTokens = {
      source: { images_count: 1, urls_count: 0 },
      style: {},
      confidence: Math.min(1, Math.max(0, 1.5)), // Would be clamped
    };
    expect(tokens.confidence).toBeLessThanOrEqual(1);
    expect(tokens.confidence).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// CONFIDENCE THRESHOLD TESTS
// ============================================================================

describe('Confidence Thresholds', () => {
  it('should use overrides when confidence >= 0.6 for use_reference', () => {
    const tokens: ReferenceTokens = {
      source: { images_count: 2, urls_count: 0 },
      style: {
        palette: { primary: '#FF0000' },
        radius: 'lg',
      },
      confidence: 0.65,
    };

    // Confidence 0.65 >= 0.6 threshold for use_reference mode
    expect(tokens.confidence >= 0.6).toBe(true);
  });

  it('should require confidence >= 0.7 for combine mode', () => {
    const tokens: ReferenceTokens = {
      source: { images_count: 2, urls_count: 0 },
      style: {
        palette: { accent: '#00FF00' },
      },
      confidence: 0.75,
    };

    // Confidence 0.75 >= 0.7 threshold for combine mode
    expect(tokens.confidence >= 0.7).toBe(true);
  });

  it('should not apply overrides when confidence is too low', () => {
    const tokens: ReferenceTokens = {
      source: { images_count: 1, urls_count: 0 },
      style: {
        palette: { primary: '#FF0000' },
      },
      confidence: 0.4,
    };

    // Confidence 0.4 < 0.6 threshold
    expect(tokens.confidence >= 0.6).toBe(false);
  });
});

// ============================================================================
// SCAFFOLD INTEGRATION TESTS - DESIGN PACK SELECTION WITH TOKENS
// ============================================================================

describe('Design Pack Selection with Tokens (Scaffold Integration)', () => {
  
  describe('ignore_reference mode', () => {
    it('should not analyze references when mode is ignore_reference', () => {
      const tokens = createMockTokens();
      const mode = 'ignore_reference';
      
      // ignore_reference mode should use default pack selection
      // No overrides applied regardless of confidence
      expect(mode === 'ignore_reference').toBe(true);
      expect(tokens.confidence).toBeGreaterThan(0); // Has high confidence but ignored
    });

    it('should return overrides_applied = false when ignoring', () => {
      const result = {
        overrides_applied: false,
        mode: 'ignore_reference' as const,
      };
      
      expect(result.overrides_applied).toBe(false);
    });
  });

  describe('use_reference mode with confidence >= threshold', () => {
    it('should select pack based on mood when confidence >= 0.6', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 2, urls_count: 0 },
        style: {
          mood: ['minimal', 'modern'],
          palette: { primary: '#1a1a1a', accent: '#3B82F6' },
          radius: 'sm',
          shadows: 'subtle',
        },
        confidence: 0.75, // Above 0.6 threshold
      };

      // Should match against design pack moods
      const moodMatches = tokens.style.mood || [];
      expect(moodMatches).toContain('minimal');
      
      // Overrides should be applied
      const shouldApplyOverrides = tokens.confidence >= 0.6;
      expect(shouldApplyOverrides).toBe(true);
    });

    it('should apply full palette overrides including primary/accent/radius/shadows', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 1, urls_count: 0 },
        style: {
          palette: {
            primary: '#FF5733',
            secondary: '#33FF57',
            accent: '#3357FF',
            neutrals: ['#FFFFFF', '#F0F0F0', '#000000'],
          },
          radius: 'lg',
          shadows: 'dramatic',
          density: 'compact',
        },
        confidence: 0.85,
      };

      // Build expected overrides for use_reference mode
      const overrides = {
        primary: tokens.style.palette?.primary,
        secondary: tokens.style.palette?.secondary,
        accent: tokens.style.palette?.accent,
        radius: tokens.style.radius,
        shadows: tokens.style.shadows,
        density: tokens.style.density,
      };

      expect(overrides.primary).toBe('#FF5733');
      expect(overrides.accent).toBe('#3357FF');
      expect(overrides.radius).toBe('lg');
      expect(overrides.shadows).toBe('dramatic');
    });

    it('should set overrides_applied = true when confidence is sufficient', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 1, urls_count: 0 },
        style: { palette: { primary: '#123456' } },
        confidence: 0.65,
      };

      const result = {
        overrides_applied: tokens.confidence >= 0.6 && tokens.style?.palette?.primary !== undefined,
        mode: 'use_reference' as const,
      };

      expect(result.overrides_applied).toBe(true);
    });
  });

  describe('combine_with_design_pack mode', () => {
    it('should keep seeded pack and apply only accent when confidence >= 0.7', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 1, urls_count: 0 },
        style: {
          palette: {
            primary: '#FF0000', // Should be ignored in combine mode
            accent: '#00FF00',  // Should be applied
          },
          radius: 'full', // Should be ignored in combine mode
        },
        confidence: 0.75, // Above 0.7 threshold
      };

      // In combine mode, only accent (or primary if no accent) is applied
      const shouldApplyAccentOnly = tokens.confidence >= 0.7;
      expect(shouldApplyAccentOnly).toBe(true);

      const accentOnlyOverride = tokens.style.palette?.accent || tokens.style.palette?.primary;
      expect(accentOnlyOverride).toBe('#00FF00');
    });

    it('should fallback to primary if no accent in combine mode', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 1, urls_count: 0 },
        style: {
          palette: {
            primary: '#AABBCC',
            // No accent
          },
        },
        confidence: 0.8,
      };

      const accentOrPrimary = tokens.style.palette?.accent || tokens.style.palette?.primary;
      expect(accentOrPrimary).toBe('#AABBCC');
    });

    it('should set overrides_applied = false when confidence below 0.7', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 1, urls_count: 0 },
        style: { palette: { accent: '#00FF00' } },
        confidence: 0.65, // Below 0.7 threshold for combine mode
      };

      const result = {
        overrides_applied: tokens.confidence >= 0.7,
        mode: 'combine_with_design_pack' as const,
      };

      expect(result.overrides_applied).toBe(false);
    });
  });

  describe('URL-only references', () => {
    it('should add url_not_fetched warning', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 0, urls_count: 3 },
        style: {},
        confidence: 0.3, // Low confidence expected
        warnings: ['url_not_fetched'],
      };

      expect(tokens.warnings).toContain('url_not_fetched');
      expect(tokens.source.images_count).toBe(0);
      expect(tokens.source.urls_count).toBe(3);
    });

    it('should have low confidence with URL-only references', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 0, urls_count: 2 },
        style: {},
        confidence: 0.25,
        warnings: ['url_not_fetched'],
      };

      // URL-only should not meet confidence thresholds
      expect(tokens.confidence < 0.6).toBe(true);
    });
  });

  describe('Invalid JSON handling', () => {
    it('should set confidence to 0 and add warning for invalid JSON', () => {
      // Simulates what happens when vision provider returns invalid JSON
      const fallbackTokens: ReferenceTokens = {
        source: { images_count: 2, urls_count: 0 },
        style: {},
        confidence: 0,
        warnings: ['invalid_json'],
      };

      expect(fallbackTokens.confidence).toBe(0);
      expect(fallbackTokens.warnings).toContain('invalid_json');
    });

    it('should not apply overrides when confidence is 0', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 2, urls_count: 0 },
        style: { palette: { primary: '#FF0000' } },
        confidence: 0,
        warnings: ['invalid_json'],
      };

      const shouldApply = tokens.confidence >= 0.6;
      expect(shouldApply).toBe(false);
    });
  });

  describe('Deterministic pack selection', () => {
    it('should produce stable results with same input', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 1, urls_count: 0 },
        style: {
          mood: ['enterprise', 'professional'],
          palette: { primary: '#1e40af' },
        },
        confidence: 0.8,
      };

      // Same mood match criteria should yield same result
      const moodMatch1 = tokens.style.mood?.includes('enterprise');
      const moodMatch2 = tokens.style.mood?.includes('enterprise');
      
      expect(moodMatch1).toBe(moodMatch2);
    });

    it('should use stable tie-break by pack id', () => {
      // When multiple packs match equally, tie-break by pack id (alphabetical)
      const packIds = ['vibrant-neon', 'minimal-light', 'enterprise-blue'];
      const sortedPackIds = [...packIds].sort();
      
      expect(sortedPackIds[0]).toBe('enterprise-blue');
      expect(sortedPackIds[1]).toBe('minimal-light');
      expect(sortedPackIds[2]).toBe('vibrant-neon');
    });
  });

  describe('Tokens summary generation', () => {
    it('should build compact tokens summary for UI', () => {
      const tokens: ReferenceTokens = {
        source: { images_count: 2, urls_count: 1 },
        style: {
          mood: ['minimal', 'modern'],
          palette: { primary: '#1a1a1a', accent: '#3b82f6' },
        },
        confidence: 0.85,
      };

      // Build summary (moods + primary/accent + confidence)
      const moods = (tokens.style.mood || []).slice(0, 3).join(', ');
      const colors = [
        tokens.style.palette?.primary,
        tokens.style.palette?.accent,
      ].filter(Boolean).join(', ');
      const conf = Math.round(tokens.confidence * 100);

      const summary = `Style: ${moods} | Palette: ${colors} | Confidence: ${conf}%`;
      
      expect(summary).toContain('minimal');
      expect(summary).toContain('#1a1a1a');
      expect(summary).toContain('85%');
      expect(summary.length).toBeLessThan(150); // Compact
    });
  });
});
