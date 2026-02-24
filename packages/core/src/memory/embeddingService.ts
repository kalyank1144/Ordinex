/**
 * Layer 5: Embedding Service — Local Semantic Retrieval
 *
 * Interfaces and pure utility functions for embedding-based retrieval.
 * The WASM implementation lives in the extension package.
 *
 * Provides:
 * - EmbeddingService interface (implemented by extension)
 * - Cosine similarity (pure math, no dependencies)
 * - Embedding sidecar types and utilities
 * - Semantic retrieval functions
 */

// ============================================================================
// TYPES
// ============================================================================

export interface EmbeddingService {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  readonly dimension: number;
  readonly modelName: string;
}

export interface EmbeddingEntry {
  vector: number[];
  updatedAt: string;
}

export interface EmbeddingSidecar {
  model: string;
  dimension: number;
  entries: Record<string, EmbeddingEntry>;
}

export interface ScoredItem<T> {
  item: T;
  score: number;
}

// ============================================================================
// COSINE SIMILARITY (pure math)
// ============================================================================

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ============================================================================
// SIDECAR UTILITIES
// ============================================================================

/**
 * Create an empty embedding sidecar.
 */
export function createEmptySidecar(model: string, dimension: number): EmbeddingSidecar {
  return { model, dimension, entries: {} };
}

/**
 * Add or update an embedding in the sidecar.
 */
export function upsertEmbedding(
  sidecar: EmbeddingSidecar,
  id: string,
  vector: Float32Array | number[],
): void {
  sidecar.entries[id] = {
    vector: Array.from(vector),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Remove an embedding from the sidecar.
 */
export function removeEmbedding(sidecar: EmbeddingSidecar, id: string): boolean {
  if (id in sidecar.entries) {
    delete sidecar.entries[id];
    return true;
  }
  return false;
}

// ============================================================================
// SEMANTIC RETRIEVAL
// ============================================================================

/**
 * Query items by semantic similarity.
 * Combines cosine similarity (70%) with recency bonus (30%).
 *
 * @param queryVector - Embedding of the query text
 * @param items - Items with their IDs
 * @param sidecar - Embedding sidecar containing vectors
 * @param topK - Number of results to return
 * @param recencyFn - Optional function that returns a 0-1 recency score for an item ID
 */
export function queryBySimilarity<T extends { id: string }>(
  queryVector: Float32Array | number[],
  items: T[],
  sidecar: EmbeddingSidecar,
  topK: number = 3,
  recencyFn?: (id: string) => number,
): ScoredItem<T>[] {
  const scored: ScoredItem<T>[] = [];

  for (const item of items) {
    const entry = sidecar.entries[item.id];
    if (!entry) continue;

    const similarity = cosineSimilarity(queryVector, entry.vector);
    const recency = recencyFn ? recencyFn(item.id) : 0;
    const score = similarity * 0.7 + recency * 0.3;

    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Check if a sidecar needs rebuilding (model changed or missing entries).
 */
export function sidecarNeedsRebuild(
  sidecar: EmbeddingSidecar,
  expectedModel: string,
  itemIds: string[],
): string[] {
  if (sidecar.model !== expectedModel) {
    return itemIds;
  }

  return itemIds.filter(id => !(id in sidecar.entries));
}
