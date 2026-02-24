/**
 * Layer 5: Embedding Service Tests
 */

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  createEmptySidecar,
  upsertEmbedding,
  removeEmbedding,
  queryBySimilarity,
  sidecarNeedsRebuild,
} from '../memory/embeddingService';

// ============================================================================
// cosineSimilarity Tests
// ============================================================================

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('handles number arrays (not just Float32Array)', () => {
    const a = [1, 2, 3];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity(new Float32Array([]), new Float32Array([]))).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    const z = new Float32Array([0, 0, 0]);
    expect(cosineSimilarity(z, z)).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('handles high-dimensional vectors', () => {
    const dim = 384;
    const a = new Float32Array(dim).fill(0.1);
    const b = new Float32Array(dim).fill(0.1);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });

  it('returns correct similarity for known vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 5);
  });
});

// ============================================================================
// Sidecar CRUD Tests
// ============================================================================

describe('EmbeddingSidecar', () => {
  it('creates empty sidecar with model info', () => {
    const sidecar = createEmptySidecar('all-MiniLM-L6-v2', 384);
    expect(sidecar.model).toBe('all-MiniLM-L6-v2');
    expect(sidecar.dimension).toBe(384);
    expect(Object.keys(sidecar.entries)).toHaveLength(0);
  });

  it('upserts embedding entries', () => {
    const sidecar = createEmptySidecar('test', 3);
    upsertEmbedding(sidecar, 'a1b2', new Float32Array([0.1, 0.2, 0.3]));

    expect(sidecar.entries['a1b2']).toBeDefined();
    expect(sidecar.entries['a1b2'].vector).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.3),
    ]);
    expect(sidecar.entries['a1b2'].updatedAt).toBeDefined();
  });

  it('overwrites existing entry on upsert', () => {
    const sidecar = createEmptySidecar('test', 3);
    upsertEmbedding(sidecar, 'a1b2', new Float32Array([0.1, 0.2, 0.3]));
    upsertEmbedding(sidecar, 'a1b2', new Float32Array([0.4, 0.5, 0.6]));

    expect(sidecar.entries['a1b2'].vector[0]).toBeCloseTo(0.4);
  });

  it('removes embedding entries', () => {
    const sidecar = createEmptySidecar('test', 3);
    upsertEmbedding(sidecar, 'a1b2', new Float32Array([0.1, 0.2, 0.3]));

    expect(removeEmbedding(sidecar, 'a1b2')).toBe(true);
    expect(sidecar.entries['a1b2']).toBeUndefined();
  });

  it('returns false when removing non-existent entry', () => {
    const sidecar = createEmptySidecar('test', 3);
    expect(removeEmbedding(sidecar, 'nonexistent')).toBe(false);
  });
});

// ============================================================================
// queryBySimilarity Tests
// ============================================================================

describe('queryBySimilarity', () => {
  it('returns items sorted by similarity', () => {
    const sidecar = createEmptySidecar('test', 3);
    upsertEmbedding(sidecar, 'a', new Float32Array([1, 0, 0]));
    upsertEmbedding(sidecar, 'b', new Float32Array([0.9, 0.1, 0]));
    upsertEmbedding(sidecar, 'c', new Float32Array([0, 1, 0]));

    const items = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ];

    const query = new Float32Array([1, 0, 0]);
    const results = queryBySimilarity(query, items, sidecar, 3);

    expect(results[0].item.id).toBe('a');
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[1].score).toBeGreaterThan(results[2].score);
  });

  it('respects topK limit', () => {
    const sidecar = createEmptySidecar('test', 3);
    upsertEmbedding(sidecar, 'a', new Float32Array([1, 0, 0]));
    upsertEmbedding(sidecar, 'b', new Float32Array([0, 1, 0]));
    upsertEmbedding(sidecar, 'c', new Float32Array([0, 0, 1]));

    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const results = queryBySimilarity(new Float32Array([1, 0, 0]), items, sidecar, 1);
    expect(results).toHaveLength(1);
  });

  it('skips items without embeddings', () => {
    const sidecar = createEmptySidecar('test', 3);
    upsertEmbedding(sidecar, 'a', new Float32Array([1, 0, 0]));

    const items = [{ id: 'a' }, { id: 'b' }];
    const results = queryBySimilarity(new Float32Array([1, 0, 0]), items, sidecar, 10);
    expect(results).toHaveLength(1);
  });

  it('incorporates recency bonus', () => {
    const sidecar = createEmptySidecar('test', 3);
    upsertEmbedding(sidecar, 'old', new Float32Array([1, 0, 0]));
    upsertEmbedding(sidecar, 'new', new Float32Array([0.95, 0.05, 0]));

    const items = [{ id: 'old' }, { id: 'new' }];
    const recencyFn = (id: string) => id === 'new' ? 1.0 : 0.0;

    const results = queryBySimilarity(new Float32Array([1, 0, 0]), items, sidecar, 2, recencyFn);
    expect(results[0].item.id).toBe('new');
  });

  it('returns empty array for no items', () => {
    const sidecar = createEmptySidecar('test', 3);
    expect(queryBySimilarity(new Float32Array([1, 0, 0]), [], sidecar)).toEqual([]);
  });
});

// ============================================================================
// sidecarNeedsRebuild Tests
// ============================================================================

describe('sidecarNeedsRebuild', () => {
  it('returns all IDs when model changes', () => {
    const sidecar = createEmptySidecar('old-model', 3);
    upsertEmbedding(sidecar, 'a', new Float32Array([1, 0, 0]));
    const missing = sidecarNeedsRebuild(sidecar, 'new-model', ['a', 'b']);
    expect(missing).toEqual(['a', 'b']);
  });

  it('returns only missing IDs when model matches', () => {
    const sidecar = createEmptySidecar('model', 3);
    upsertEmbedding(sidecar, 'a', new Float32Array([1, 0, 0]));
    const missing = sidecarNeedsRebuild(sidecar, 'model', ['a', 'b', 'c']);
    expect(missing).toEqual(['b', 'c']);
  });

  it('returns empty when all IDs present', () => {
    const sidecar = createEmptySidecar('model', 3);
    upsertEmbedding(sidecar, 'a', new Float32Array([1, 0, 0]));
    upsertEmbedding(sidecar, 'b', new Float32Array([0, 1, 0]));
    expect(sidecarNeedsRebuild(sidecar, 'model', ['a', 'b'])).toEqual([]);
  });
});
