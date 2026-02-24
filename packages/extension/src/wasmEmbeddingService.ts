/**
 * WasmEmbeddingService — Local WASM-based Embedding Service
 *
 * Uses @huggingface/transformers (WASM) with all-MiniLM-L6-v2
 * for local, zero-API-cost embeddings. ~25MB model, <10ms per fact.
 *
 * Layer 5 of the memory system.
 *
 * Error philosophy: NEVER silently degrade. Every failure is surfaced
 * via the onError callback so the extension can show it to the user.
 * Embed calls throw EmbeddingUnavailableError when the pipeline is down.
 */

import type { EmbeddingService } from 'core';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSION = 384;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

// ============================================================================
// ERROR TYPES
// ============================================================================

export class EmbeddingUnavailableError extends Error {
  constructor(
    message: string,
    public readonly reason: EmbeddingFailureReason,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

export type EmbeddingFailureReason =
  | 'package_not_installed'
  | 'model_download_failed'
  | 'pipeline_init_failed'
  | 'inference_failed'
  | 'not_initialized';

export interface EmbeddingStatus {
  available: boolean;
  reason?: EmbeddingFailureReason;
  error?: string;
  retryCount: number;
  modelName: string;
}

export type EmbeddingErrorCallback = (status: EmbeddingStatus) => void;

// ============================================================================
// SERVICE
// ============================================================================

export class WasmEmbeddingService implements EmbeddingService {
  private pipeline: any = null;
  private loading: Promise<boolean> | null = null;
  private _status: EmbeddingStatus;
  private onError: EmbeddingErrorCallback | null = null;

  readonly dimension = DIMENSION;
  readonly modelName = MODEL_NAME;

  constructor(onError?: EmbeddingErrorCallback) {
    this.onError = onError || null;
    this._status = {
      available: false,
      retryCount: 0,
      modelName: MODEL_NAME,
    };
  }

  /**
   * Register an error callback. Called whenever the service state changes.
   */
  setErrorCallback(cb: EmbeddingErrorCallback): void {
    this.onError = cb;
  }

  /**
   * Get current service status.
   */
  getStatus(): EmbeddingStatus {
    return { ...this._status };
  }

  /**
   * Check if the service is ready to embed.
   */
  isAvailable(): boolean {
    return this._status.available;
  }

  /**
   * Initialize the embedding pipeline with retry logic.
   * Call this explicitly at extension startup to surface errors early.
   */
  async initialize(): Promise<boolean> {
    if (this.pipeline) return true;

    if (this.loading) {
      return this.loading;
    }

    this.loading = this.initWithRetry();
    const result = await this.loading;
    this.loading = null;
    return result;
  }

  private async initWithRetry(): Promise<boolean> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this._status.retryCount = attempt;

      try {
        return await this.tryInit();
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES;

        if (isLastAttempt) {
          this.reportError(
            this._status.reason || 'pipeline_init_failed',
            `Embedding pipeline failed after ${MAX_RETRIES + 1} attempts: ${errorMessage(err)}`,
            err,
          );
          return false;
        }

        console.warn(
          `[Embeddings] Init attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${errorMessage(err)}. Retrying in ${RETRY_DELAY_MS}ms...`,
        );
        await sleep(RETRY_DELAY_MS);
      }
    }

    return false;
  }

  private async tryInit(): Promise<boolean> {
    // Step 1: Check if the package is installed
    let pipelineFn: any;
    try {
      const module = await import('@huggingface/transformers');
      pipelineFn = module.pipeline;
    } catch (err) {
      this._status.reason = 'package_not_installed';
      throw new EmbeddingUnavailableError(
        '@huggingface/transformers is not installed. Run: pnpm add @huggingface/transformers',
        'package_not_installed',
        err,
      );
    }

    if (typeof pipelineFn !== 'function') {
      this._status.reason = 'package_not_installed';
      throw new EmbeddingUnavailableError(
        '@huggingface/transformers does not export a pipeline function. Check the package version.',
        'package_not_installed',
      );
    }

    // Step 2: Initialize the model pipeline (downloads model on first use)
    try {
      this.pipeline = await pipelineFn('feature-extraction', MODEL_NAME, {
        quantized: true,
      });
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('download')) {
        this._status.reason = 'model_download_failed';
        throw new EmbeddingUnavailableError(
          `Failed to download model ${MODEL_NAME}: ${msg}`,
          'model_download_failed',
          err,
        );
      }
      this._status.reason = 'pipeline_init_failed';
      throw new EmbeddingUnavailableError(
        `Failed to initialize embedding pipeline: ${msg}`,
        'pipeline_init_failed',
        err,
      );
    }

    // Step 3: Smoke test — embed a short string to verify it works
    try {
      const testOutput = await this.pipeline('test', { pooling: 'mean', normalize: true });
      if (!testOutput?.data || testOutput.data.length !== DIMENSION) {
        this._status.reason = 'pipeline_init_failed';
        throw new EmbeddingUnavailableError(
          `Pipeline smoke test failed: expected ${DIMENSION}-dim output, got ${testOutput?.data?.length ?? 'null'}`,
          'pipeline_init_failed',
        );
      }
    } catch (err) {
      if (err instanceof EmbeddingUnavailableError) throw err;
      this._status.reason = 'pipeline_init_failed';
      throw new EmbeddingUnavailableError(
        `Pipeline smoke test failed: ${errorMessage(err)}`,
        'pipeline_init_failed',
        err,
      );
    }

    // Success
    this._status = {
      available: true,
      retryCount: this._status.retryCount,
      modelName: MODEL_NAME,
    };

    console.log(`[Embeddings] WASM pipeline loaded: ${MODEL_NAME} (${DIMENSION}-dim, attempt ${this._status.retryCount + 1})`);
    return true;
  }

  // ========================================================================
  // EMBED
  // ========================================================================

  async embed(text: string): Promise<Float32Array> {
    if (!this.pipeline) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new EmbeddingUnavailableError(
          `Embedding service unavailable: ${this._status.error || this._status.reason || 'unknown'}`,
          this._status.reason || 'not_initialized',
        );
      }
    }

    try {
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
      return new Float32Array(output.data);
    } catch (err) {
      this.reportError('inference_failed', `embed() failed: ${errorMessage(err)}`, err);
      throw new EmbeddingUnavailableError(
        `Embedding inference failed: ${errorMessage(err)}`,
        'inference_failed',
        err,
      );
    }
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.pipeline) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new EmbeddingUnavailableError(
          `Embedding service unavailable: ${this._status.error || this._status.reason || 'unknown'}`,
          this._status.reason || 'not_initialized',
        );
      }
    }

    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  // ========================================================================
  // ERROR REPORTING
  // ========================================================================

  private reportError(reason: EmbeddingFailureReason, message: string, cause?: unknown): void {
    this._status = {
      available: false,
      reason,
      error: message,
      retryCount: this._status.retryCount,
      modelName: MODEL_NAME,
    };

    console.error(`[Embeddings] ${message}`);

    if (this.onError) {
      this.onError(this._status);
    }
  }

  /**
   * Force re-initialization (e.g., after user installs the package).
   */
  async reinitialize(): Promise<boolean> {
    this.pipeline = null;
    this.loading = null;
    this._status = {
      available: false,
      retryCount: 0,
      modelName: MODEL_NAME,
    };
    return this.initialize();
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
