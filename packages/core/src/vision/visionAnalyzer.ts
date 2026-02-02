/**
 * Step 38: Real Vision Analyzer
 * 
 * Replaces the Step 37 stub with full vision analysis capabilities.
 * 
 * Features:
 * - Policy-gated execution (respects visionMode setting)
 * - Replay-safe (loads from evidence, never re-runs in replay)
 * - Evidence storage (writes tokens to .ordinex/evidence/)
 * - Emits events (vision_analysis_started, completed, reference_tokens_extracted)
 * - URL handling (domain/path context only, no scraping)
 */

import type {
  ReferenceContext,
  VisionTokens,
  VisionAnalyzer,
  VisionConfig,
  VisionRunContext,
  VisionAnalyzeResult,
  ReferenceTokens,
  VisionImageData,
  VisionProvider,
} from '../types';
import { shouldAnalyze, getSkipReasonMessage, type VisionPolicyResult } from './visionPolicy';
import { DEFAULT_VISION_CONFIG } from './visionConfig';
import {
  writeTokensEvidence,
  readTokensEvidence,
  buildTokensSummary,
  type FileSystem,
} from './referenceTokensEvidence';

// ============================================================================
// VISION PROVIDER INTERFACE
// ============================================================================

/**
 * Vision provider interface - abstracts the actual API call
 * 
 * Implementations: AnthropicVisionProvider, OpenAIVisionProvider, MockVisionProvider
 */
export interface VisionProviderClient {
  /**
   * Call the vision API to extract tokens
   * 
   * @param images - Array of image data (mime + base64)
   * @param urlContext - URL context hints (domain + path)
   * @param schema - Output schema for structured extraction
   */
  analyze(
    images: VisionImageData[],
    urlContext: string,
    schema: ReferenceTokensSchema
  ): Promise<ReferenceTokens>;
}

/**
 * Schema for structured token extraction
 */
export interface ReferenceTokensSchema {
  version: 'v1';
  description: string;
}

/**
 * Default extraction schema
 */
export const TOKENS_EXTRACTION_SCHEMA: ReferenceTokensSchema = {
  version: 'v1',
  description: `Extract UI design tokens from the provided images. Return JSON matching:
{
  "source": { "images_count": number, "urls_count": number },
  "style": {
    "palette": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "neutrals": ["#hex"] },
    "mood": ["minimal"|"modern"|"vibrant"|"enterprise"|"playful"],
    "typography": { "heading": "font name", "body": "font name" },
    "density": "compact"|"default"|"relaxed",
    "radius": "none"|"sm"|"md"|"lg"|"full",
    "shadows": "none"|"subtle"|"medium"|"dramatic"
  },
  "layout": { "structure": ["sidebar"|"header"|"grid"|"cards"], "components": ["nav"|"hero"|"form"] },
  "uiHints": { "component_system_preference": "shadcn"|"mui"|"chakra"|"tailwind-plain" },
  "confidence": 0.0-1.0,
  "warnings": ["optional warnings"]
}`,
};

// ============================================================================
// STUB VISION ANALYZER (Legacy, kept for backward compatibility)
// ============================================================================

/**
 * Stub Vision Analyzer implementation
 * @deprecated Use RealVisionAnalyzer instead
 */
export class StubVisionAnalyzer implements VisionAnalyzer {
  async analyze(refs: ReferenceContext): Promise<VisionTokens> {
    const imageCount = refs.images.length;
    const urlCount = refs.urls.length;
    console.log(`[VisionAnalyzer] Stub called with ${imageCount} images, ${urlCount} URLs.`);
    return { status: 'pending', reason: 'vision_not_enabled' };
  }
}

// ============================================================================
// REAL VISION ANALYZER
// ============================================================================

/**
 * Event emitter interface (injected for testability)
 */
export interface VisionEventEmitter {
  emit(type: string, payload: Record<string, unknown>): void;
}

/**
 * Attachment loader interface (injected, implemented by extension)
 */
export interface AttachmentLoader {
  loadImageData(attachmentId: string): Promise<{ mime: string; base64: string } | null>;
}

/**
 * Real Vision Analyzer - Step 38 implementation
 * 
 * Orchestrates:
 * 1. Policy check (skip/prompt/proceed)
 * 2. Replay detection (load from evidence)
 * 3. Image loading + resizing
 * 4. Provider call (when not replay)
 * 5. Evidence storage
 * 6. Event emission
 */
export class RealVisionAnalyzer {
  constructor(
    private readonly config: VisionConfig,
    private readonly fs: FileSystem,
    private readonly provider: VisionProviderClient | null,
    private readonly attachmentLoader: AttachmentLoader,
    private readonly eventEmitter?: VisionEventEmitter
  ) {}

  /**
   * Analyze references and extract tokens
   * 
   * @param refs - Reference context with images/URLs
   * @param runContext - Run context for replay detection
   * @returns Vision analyze result
   */
  async analyze(
    refs: ReferenceContext,
    runContext: VisionRunContext
  ): Promise<VisionAnalyzeResult> {
    const startTime = Date.now();

    // 1. Check policy
    const policyResult = shouldAnalyze(this.config, refs, runContext);

    // 2. Handle skip
    if (policyResult.decision === 'skip') {
      return this.handleSkip(policyResult, runContext);
    }

    // 3. Check for cached evidence (replay-safe)
    const cachedTokens = await readTokensEvidence(
      this.fs,
      runContext.workspaceRoot,
      runContext.referenceContextId
    );

    if (cachedTokens) {
      console.log(`[RealVisionAnalyzer] Using cached tokens for ${runContext.referenceContextId}`);
      return {
        status: 'complete',
        tokens: cachedTokens,
        tokensEvidenceRef: `.ordinex/evidence/reference_tokens_${runContext.referenceContextId}.json`,
        durationMs: Date.now() - startTime,
      };
    }

    // 4. If replay mode but no cached tokens, return warning
    if (runContext.isReplay) {
      console.warn(`[RealVisionAnalyzer] Replay mode but no cached tokens found`);
      return {
        status: 'skipped',
        reason: 'replay_no_cache',
        durationMs: Date.now() - startTime,
      };
    }

    // 5. If prompt mode, we need to await user decision
    // This is handled upstream by scaffoldFlow - we just proceed if called
    if (policyResult.decision === 'prompt') {
      console.log(`[RealVisionAnalyzer] Prompt mode - assuming consent granted upstream`);
    }

    // 6. Emit analysis started
    this.emitStarted(refs, runContext);

    try {
      // 7. Load and prepare images
      const images = await this.loadImages(refs, this.config.maxImages);

      // 8. Build URL context (no scraping, just domain/path)
      const urlContext = this.buildUrlContext(refs);

      // 9. Call provider (if available)
      if (!this.provider) {
        console.warn(`[RealVisionAnalyzer] No vision provider configured`);
        return this.handleError('No vision provider configured', false, runContext, startTime);
      }

      if (images.length === 0) {
        console.warn(`[RealVisionAnalyzer] No images to analyze`);
        return this.handleSkip(
          { decision: 'skip', skipReason: 'no_images', skipMessage: 'No images loaded' },
          runContext
        );
      }

      // 10. Call vision API
      const tokens = await this.provider.analyze(images, urlContext, TOKENS_EXTRACTION_SCHEMA);

      // 11. Validate tokens
      const validatedTokens = this.validateTokens(tokens, refs);

      // 12. Store evidence
      const evidenceRef = await writeTokensEvidence(
        this.fs,
        runContext.workspaceRoot,
        runContext.referenceContextId,
        validatedTokens
      );

      // 13. Emit events
      this.emitCompleted(runContext, 'complete', Date.now() - startTime);
      this.emitTokensExtracted(validatedTokens, evidenceRef, runContext);

      return {
        status: 'complete',
        tokens: validatedTokens,
        tokensEvidenceRef: evidenceRef,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[RealVisionAnalyzer] Error:`, error);
      return this.handleError(errorMessage, true, runContext, startTime);
    }
  }

  /**
   * Load images from attachment store
   */
  private async loadImages(
    refs: ReferenceContext,
    maxImages: number
  ): Promise<VisionImageData[]> {
    const images: VisionImageData[] = [];
    const imagesToLoad = refs.images.slice(0, maxImages);

    for (const img of imagesToLoad) {
      if (img.type !== 'image') continue;

      const data = await this.attachmentLoader.loadImageData(img.id);
      if (data) {
        images.push({
          mime: data.mime,
          base64: data.base64,
          attachmentId: img.id,
        });
      }
    }

    return images;
  }

  /**
   * Build URL context string (no scraping, just domain/path hints)
   */
  private buildUrlContext(refs: ReferenceContext): string {
    if (refs.urls.length === 0) return '';

    const urlHints = refs.urls
      .filter((u): u is { type: 'url'; id: string; url: string } => u.type === 'url')
      .map((u) => {
        try {
          const parsed = new URL(u.url);
          return `${parsed.hostname}${parsed.pathname}`;
        } catch {
          return u.url;
        }
      });

    return `URL references (not fetched): ${urlHints.join(', ')}`;
  }

  /**
   * Validate and normalize tokens
   */
  private validateTokens(tokens: ReferenceTokens, refs: ReferenceContext): ReferenceTokens {
    // Ensure source counts are correct
    const validated: ReferenceTokens = {
      ...tokens,
      source: {
        images_count: refs.images.length,
        urls_count: refs.urls.length,
      },
      confidence: Math.max(0, Math.min(1, tokens.confidence || 0)),
      warnings: tokens.warnings || [],
    };

    // Add URL warning if URLs present but not fetched
    if (refs.urls.length > 0) {
      validated.warnings = validated.warnings || [];
      if (!validated.warnings.includes('url_not_fetched')) {
        validated.warnings.push('url_not_fetched');
      }
    }

    return validated;
  }

  /**
   * Handle skip result
   */
  private handleSkip(
    policyResult: VisionPolicyResult,
    runContext: VisionRunContext
  ): VisionAnalyzeResult {
    const reason = policyResult.skipReason
      ? getSkipReasonMessage(policyResult.skipReason)
      : 'Skipped';

    this.emitCompleted(runContext, 'skipped', 0, reason);

    return {
      status: 'skipped',
      reason: policyResult.skipMessage || reason,
    };
  }

  /**
   * Handle error
   */
  private handleError(
    message: string,
    retryable: boolean,
    runContext: VisionRunContext,
    startTime: number
  ): VisionAnalyzeResult {
    this.emitCompleted(runContext, 'error', Date.now() - startTime, message);

    return {
      status: 'error',
      reason: message,
      retryable,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Emit vision_analysis_started event
   */
  private emitStarted(refs: ReferenceContext, runContext: VisionRunContext): void {
    this.eventEmitter?.emit('vision_analysis_started', {
      run_id: runContext.runId,
      reference_context_id: runContext.referenceContextId,
      images_count: refs.images.length,
      urls_count: refs.urls.length,
    });
  }

  /**
   * Emit vision_analysis_completed event
   */
  private emitCompleted(
    runContext: VisionRunContext,
    status: 'complete' | 'skipped' | 'error',
    durationMs: number,
    reason?: string
  ): void {
    this.eventEmitter?.emit('vision_analysis_completed', {
      run_id: runContext.runId,
      reference_context_id: runContext.referenceContextId,
      status,
      reason,
      duration_ms: durationMs,
    });
  }

  /**
   * Emit reference_tokens_extracted event
   */
  private emitTokensExtracted(
    tokens: ReferenceTokens,
    evidenceRef: string,
    runContext: VisionRunContext
  ): void {
    const summary = buildTokensSummary(tokens);

    this.eventEmitter?.emit('reference_tokens_extracted', {
      run_id: runContext.runId,
      reference_context_id: runContext.referenceContextId,
      evidence_ref: evidenceRef,
      palette_summary: summary.palette_summary,
      moods: summary.moods,
      confidence: summary.confidence,
    });
  }
}

// ============================================================================
// MOCK VISION PROVIDER (For testing when no API key)
// ============================================================================

/**
 * Mock vision provider that returns synthetic tokens
 * Used when visionMode === 'on' but no API key configured
 */
export class MockVisionProvider implements VisionProviderClient {
  async analyze(
    images: VisionImageData[],
    _urlContext: string,
    _schema: ReferenceTokensSchema
  ): Promise<ReferenceTokens> {
    // Return reasonable mock tokens based on image count
    return {
      source: {
        images_count: images.length,
        urls_count: 0,
      },
      style: {
        palette: {
          primary: '#3B82F6',
          secondary: '#10B981',
          accent: '#F59E0B',
          neutrals: ['#F9FAFB', '#E5E7EB', '#6B7280', '#1F2937'],
        },
        mood: ['modern', 'clean'],
        typography: {
          heading: 'Inter',
          body: 'Inter',
        },
        density: 'default',
        radius: 'md',
        shadows: 'subtle',
      },
      layout: {
        structure: ['header', 'sidebar', 'cards'],
        components: ['nav', 'hero', 'form'],
      },
      uiHints: {
        component_system_preference: 'shadcn',
      },
      confidence: 0.6,
      warnings: ['mock_provider_used'],
    };
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Default vision analyzer instance (stub for backward compatibility)
 * @deprecated Use createRealVisionAnalyzer instead
 */
export const visionAnalyzer: VisionAnalyzer = new StubVisionAnalyzer();

/**
 * Factory function to create a vision analyzer
 * @deprecated Use createRealVisionAnalyzer for Step 38+
 */
export function createVisionAnalyzer(): VisionAnalyzer {
  return new StubVisionAnalyzer();
}

/**
 * Create a RealVisionAnalyzer with full capabilities
 * 
 * @param config - Vision configuration
 * @param fs - File system interface
 * @param provider - Vision provider client (or null for mock)
 * @param attachmentLoader - Attachment loader interface
 * @param eventEmitter - Event emitter interface
 */
export function createRealVisionAnalyzer(
  config?: VisionConfig,
  fs?: FileSystem,
  provider?: VisionProviderClient | null,
  attachmentLoader?: AttachmentLoader,
  eventEmitter?: VisionEventEmitter
): RealVisionAnalyzer {
  // Use mock file system if not provided
  const fileSystem = fs || createMockFileSystem();

  // Use mock provider if not provided
  const visionProvider = provider === undefined ? new MockVisionProvider() : provider;

  // Use mock attachment loader if not provided
  const loader = attachmentLoader || createMockAttachmentLoader();

  return new RealVisionAnalyzer(
    config || DEFAULT_VISION_CONFIG,
    fileSystem,
    visionProvider,
    loader,
    eventEmitter
  );
}

// ============================================================================
// MOCK IMPLEMENTATIONS (For testing/development)
// ============================================================================

/**
 * Create a mock file system
 */
function createMockFileSystem(): FileSystem {
  const store = new Map<string, string>();

  return {
    async exists(path: string): Promise<boolean> {
      return store.has(path);
    },
    async readFile(path: string): Promise<string> {
      const content = store.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },
    async writeFile(path: string, content: string): Promise<void> {
      store.set(path, content);
    },
    async mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
      // No-op for mock
    },
  };
}

/**
 * Create a mock attachment loader
 */
function createMockAttachmentLoader(): AttachmentLoader {
  return {
    async loadImageData(_attachmentId: string): Promise<{ mime: string; base64: string } | null> {
      // Return minimal valid PNG
      return {
        mime: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      };
    },
  };
}
