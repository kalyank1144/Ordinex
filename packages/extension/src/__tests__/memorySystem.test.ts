/**
 * Memory System Integration Tests (Extension Services)
 *
 * Tests FsRulesService, FsSessionService, FsEnhancedMemoryService,
 * and AutoMemorySubscriber. These services don't require VS Code API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { FsRulesService } from '../fsRulesService';
import { FsSessionService } from '../fsSessionService';
import { FsEnhancedMemoryService } from '../fsEnhancedMemoryService';
import { AutoMemorySubscriber } from '../autoMemorySubscriber';
import type { AutoMemoryLLMClient } from '../autoMemorySubscriber';
import type { Event } from 'core';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-mem-test-'));
}

function makeEvent(overrides: Partial<Event> & { type: string }): Event {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    task_id: 'task_test',
    timestamp: new Date().toISOString(),
    mode: 'AGENT' as any,
    stage: 'none' as any,
    payload: {},
    evidence_ids: [],
    parent_event_id: null,
    ...overrides,
  };
}

// ============================================================================
// FsRulesService Tests
// ============================================================================

describe('FsRulesService', () => {
  let tempDir: string;
  let service: FsRulesService;

  beforeEach(() => {
    tempDir = createTempDir();
    service = new FsRulesService();
  });

  it('reads existing files', async () => {
    const filePath = path.join(tempDir, 'test.md');
    fs.writeFileSync(filePath, 'Hello World');
    const content = await service.readFile(filePath);
    expect(content).toBe('Hello World');
  });

  it('returns null for missing files', async () => {
    const content = await service.readFile(path.join(tempDir, 'missing.md'));
    expect(content).toBeNull();
  });

  it('reads directory contents', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.md'), 'A');
    fs.writeFileSync(path.join(tempDir, 'b.md'), 'B');
    const files = await service.readDir(tempDir);
    expect(files).toContain('a.md');
    expect(files).toContain('b.md');
  });

  it('returns empty array for missing directory', async () => {
    const files = await service.readDir(path.join(tempDir, 'nonexistent'));
    expect(files).toEqual([]);
  });

  it('checks directory existence', async () => {
    expect(await service.exists(tempDir)).toBe(true);
    expect(await service.exists(path.join(tempDir, 'nope'))).toBe(false);
  });
});

// ============================================================================
// FsEnhancedMemoryService Tests
// ============================================================================

describe('FsEnhancedMemoryService', () => {
  let tempDir: string;
  let service: FsEnhancedMemoryService;

  beforeEach(() => {
    tempDir = createTempDir();
    service = new FsEnhancedMemoryService(tempDir);
  });

  it('creates empty document when no existing memory', async () => {
    const doc = await service.loadDocument();
    expect(doc.facts).toEqual([]);
  });

  it('adds facts and persists to MEMORY.md', async () => {
    const id = await service.addFact('stack', 'TypeScript project');
    expect(id).toMatch(/^[a-f0-9]+$/);

    const doc = await service.loadDocument();
    expect(doc.facts).toHaveLength(1);
    expect(doc.facts[0].content).toBe('TypeScript project');
    expect(doc.facts[0].section).toBe('stack');

    // Check file on disk
    const memoryMd = fs.readFileSync(path.join(tempDir, 'MEMORY.md'), 'utf-8');
    expect(memoryMd).toContain('TypeScript project');
  });

  it('updates facts', async () => {
    const id = await service.addFact('general', 'Old content');
    const result = await service.updateFact(id, 'New content');
    expect(result).toBe(true);

    const doc = await service.loadDocument();
    expect(doc.facts[0].content).toBe('New content');
  });

  it('removes facts', async () => {
    const id = await service.addFact('general', 'To be removed');
    await service.addFact('general', 'Stays');

    const result = await service.removeFact(id);
    expect(result).toBe(true);

    const facts = await service.listFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe('Stays');
  });

  it('lists facts by section', async () => {
    await service.addFact('stack', 'Node.js');
    await service.addFact('architecture', 'Monorepo');
    await service.addFact('stack', 'TypeScript');

    const stackFacts = await service.listFacts('stack');
    expect(stackFacts).toHaveLength(2);

    const archFacts = await service.listFacts('architecture');
    expect(archFacts).toHaveLength(1);
  });

  it('migrates from legacy facts.md', async () => {
    const factsPath = path.join(tempDir, 'facts.md');
    fs.writeFileSync(factsPath, 'Fact one\nFact two\nFact three');

    const doc = await service.loadDocument();
    expect(doc.facts).toHaveLength(3);
    expect(doc.facts.every(f => f.section === 'general')).toBe(true);

    // MEMORY.md should be created
    expect(fs.existsSync(path.join(tempDir, 'MEMORY.md'))).toBe(true);
  });

  it('persists metadata sidecar', async () => {
    await service.addFact('general', 'Test fact');

    const metadataPath = path.join(tempDir, 'memory-metadata.json');
    expect(fs.existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(Object.keys(metadata.facts).length).toBe(1);
  });

  it('backward compat: appendFacts adds as general section', async () => {
    await service.appendFacts('Line one\nLine two');
    const facts = await service.listFacts();
    expect(facts).toHaveLength(2);
    expect(facts[0].section).toBe('general');
  });

  it('backward compat: readFacts returns serialized content', async () => {
    await service.addFact('stack', 'Node.js');
    const raw = await service.readFacts();
    expect(raw).toContain('Node.js');
    expect(raw).toContain('## Stack');
  });

  it('invalidates cache on invalidateCache()', async () => {
    await service.addFact('general', 'Cached fact');
    service.invalidateCache();

    // Re-reads from disk
    const doc = await service.loadDocument();
    expect(doc.facts).toHaveLength(1);
  });

  it('handles embedding sidecar CRUD', async () => {
    const { createEmptySidecar, upsertEmbedding } = await import('core');

    const sidecar = createEmptySidecar('test-model', 3);
    upsertEmbedding(sidecar, 'abc1', new Float32Array([0.1, 0.2, 0.3]));

    await service.saveEmbeddingSidecar(sidecar);
    const loaded = await service.loadEmbeddingSidecar();
    expect(loaded).not.toBeNull();
    expect(loaded!.model).toBe('test-model');
    expect(loaded!.entries['abc1']).toBeDefined();
  });

  it('returns null for missing embedding sidecar', async () => {
    const loaded = await service.loadEmbeddingSidecar();
    expect(loaded).toBeNull();
  });
});

// ============================================================================
// FsSessionService Tests
// ============================================================================

describe('FsSessionService', () => {
  let tempDir: string;
  let service: FsSessionService;

  beforeEach(() => {
    tempDir = createTempDir();
    service = new FsSessionService(tempDir);
  });

  it('saves and loads session summaries', async () => {
    const { compressSession } = await import('core');
    const events = [
      makeEvent({ type: 'intent_received', task_id: 'task_1', timestamp: '2026-02-23T10:00:00Z' }),
      makeEvent({ type: 'mission_completed', task_id: 'task_1', timestamp: '2026-02-23T10:05:00Z', payload: { success: true } }),
    ];
    const summary = compressSession(events)!;
    await service.saveSession(summary);

    const sessions = await service.loadRecentSessions(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toContain('Session: task_1');
  });

  it('returns most recent sessions first', async () => {
    const { compressSession } = await import('core');

    const events1 = [
      makeEvent({ type: 'intent_received', task_id: 'task_old', timestamp: '2026-02-22T10:00:00Z' }),
      makeEvent({ type: 'mission_completed', task_id: 'task_old', timestamp: '2026-02-22T10:05:00Z', payload: { success: true } }),
    ];
    const events2 = [
      makeEvent({ type: 'intent_received', task_id: 'task_new', timestamp: '2026-02-23T10:00:00Z' }),
      makeEvent({ type: 'mission_completed', task_id: 'task_new', timestamp: '2026-02-23T10:05:00Z', payload: { success: true } }),
    ];

    await service.saveSession(compressSession(events1)!);
    // Small delay so filesystem timestamps differ
    await new Promise(r => setTimeout(r, 50));
    await service.saveSession(compressSession(events2)!);

    const sessions = await service.loadRecentSessions(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toContain('task_new');
  });

  it('lists session IDs', async () => {
    const { compressSession } = await import('core');
    const events = [makeEvent({ type: 'intent_received', task_id: 'task_abc' })];
    await service.saveSession(compressSession(events)!);

    const ids = await service.listSessionIds();
    expect(ids).toContain('task_abc');
  });

  it('returns empty array when no sessions', async () => {
    const sessions = await service.loadRecentSessions();
    expect(sessions).toEqual([]);
  });

  it('prunes old sessions', async () => {
    const { compressSession } = await import('core');

    for (let i = 0; i < 5; i++) {
      const events = [makeEvent({ type: 'intent_received', task_id: `task_${i}` })];
      await service.saveSession(compressSession(events)!);
      await new Promise(r => setTimeout(r, 20));
    }

    const deleted = await service.pruneOldSessions(2);
    expect(deleted).toBe(3);

    const remaining = await service.listSessionIds();
    expect(remaining).toHaveLength(2);
  });
});

// ============================================================================
// AutoMemorySubscriber Tests
// ============================================================================

describe('AutoMemorySubscriber', () => {
  let tempDir: string;
  let memoryService: FsEnhancedMemoryService;
  let mockLLMClient: AutoMemoryLLMClient & { complete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tempDir = createTempDir();
    memoryService = new FsEnhancedMemoryService(tempDir);
    mockLLMClient = {
      complete: vi.fn<(prompt: string) => Promise<string>>()
        .mockResolvedValue('{"facts":[{"section":"stack","content":"Uses Node.js 20"}]}'),
    };
  });

  it('extracts facts on scaffold_completed event', async () => {
    const subscriber = new AutoMemorySubscriber(
      memoryService,
      () => mockLLMClient,
    );

    const event = makeEvent({ type: 'scaffold_completed' });
    await subscriber.onEvent(event, []);

    expect(mockLLMClient.complete).toHaveBeenCalledOnce();

    const facts = await memoryService.listFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe('Uses Node.js 20');
  });

  it('does not extract for unrelated events', async () => {
    const subscriber = new AutoMemorySubscriber(
      memoryService,
      () => mockLLMClient,
    );

    const event = makeEvent({ type: 'tool_start' });
    await subscriber.onEvent(event, []);

    expect(mockLLMClient.complete).not.toHaveBeenCalled();
  });

  it('resets extraction state for new tasks', async () => {
    const subscriber = new AutoMemorySubscriber(
      memoryService,
      () => mockLLMClient,
    );

    // First extraction
    await subscriber.onEvent(makeEvent({ type: 'scaffold_completed' }), []);
    expect(mockLLMClient.complete).toHaveBeenCalledOnce();

    // Same trigger should not fire again
    mockLLMClient.complete.mockClear();
    await subscriber.onEvent(makeEvent({ type: 'scaffold_completed' }), []);
    expect(mockLLMClient.complete).not.toHaveBeenCalled();

    // After reset, should fire again
    subscriber.resetForNewTask();
    mockLLMClient.complete.mockClear();
    mockLLMClient.complete.mockResolvedValue('{"facts":[{"section":"stack","content":"Uses React 19"}]}');
    await subscriber.onEvent(makeEvent({ type: 'scaffold_completed' }), []);
    expect(mockLLMClient.complete).toHaveBeenCalledOnce();
  });

  it('gracefully handles LLM errors', async () => {
    const failingClient = {
      complete: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    const subscriber = new AutoMemorySubscriber(
      memoryService,
      () => failingClient,
    );

    await subscriber.onEvent(makeEvent({ type: 'scaffold_completed' }), []);

    const facts = await memoryService.listFacts();
    expect(facts).toHaveLength(0);
  });

  it('returns no-op when LLM client factory returns null', async () => {
    const subscriber = new AutoMemorySubscriber(
      memoryService,
      () => null,
    );

    await subscriber.onEvent(makeEvent({ type: 'scaffold_completed' }), []);

    const facts = await memoryService.listFacts();
    expect(facts).toHaveLength(0);
  });

  it('deduplicates against existing facts', async () => {
    await memoryService.addFact('stack', 'Uses Node.js 20');

    mockLLMClient.complete.mockResolvedValue('{"facts":[{"section":"stack","content":"Uses Node.js 20"}]}');

    const subscriber = new AutoMemorySubscriber(
      memoryService,
      () => mockLLMClient,
    );

    await subscriber.onEvent(makeEvent({ type: 'scaffold_completed' }), []);

    const facts = await memoryService.listFacts();
    expect(facts).toHaveLength(1);
  });
});

// ============================================================================
// WasmEmbeddingService Tests
// ============================================================================

describe('WasmEmbeddingService', () => {
  it('initializes successfully when @huggingface/transformers is installed', async () => {
    const { WasmEmbeddingService } = await import('../wasmEmbeddingService');
    const service = new WasmEmbeddingService();

    const result = await service.initialize();

    // Package is installed, so this should succeed
    expect(result).toBe(true);
    expect(service.isAvailable()).toBe(true);

    const status = service.getStatus();
    expect(status.available).toBe(true);
    expect(status.reason).toBeUndefined();
    expect(status.error).toBeUndefined();
    expect(status.modelName).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('produces 384-dimensional embeddings', async () => {
    const { WasmEmbeddingService } = await import('../wasmEmbeddingService');
    const service = new WasmEmbeddingService();
    await service.initialize();

    if (!service.isAvailable()) return;

    const vector = await service.embed('TypeScript monorepo');
    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector.length).toBe(384);

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 1);
  });

  it('produces different vectors for different texts', async () => {
    const { WasmEmbeddingService } = await import('../wasmEmbeddingService');
    const { cosineSimilarity } = await import('core');
    const service = new WasmEmbeddingService();
    await service.initialize();

    if (!service.isAvailable()) return;

    const v1 = await service.embed('React frontend with TypeScript');
    const v2 = await service.embed('PostgreSQL database migration');

    const similarity = cosineSimilarity(v1, v2);
    expect(similarity).toBeLessThan(0.9);
    expect(similarity).toBeGreaterThan(-1);
  });

  it('produces similar vectors for similar texts', async () => {
    const { WasmEmbeddingService } = await import('../wasmEmbeddingService');
    const { cosineSimilarity } = await import('core');
    const service = new WasmEmbeddingService();
    await service.initialize();

    if (!service.isAvailable()) return;

    const v1 = await service.embed('Uses TypeScript for type safety');
    const v2 = await service.embed('TypeScript provides static typing');

    const similarity = cosineSimilarity(v1, v2);
    expect(similarity).toBeGreaterThan(0.5);
  });

  it('embedBatch returns array of vectors', async () => {
    const { WasmEmbeddingService } = await import('../wasmEmbeddingService');
    const service = new WasmEmbeddingService();
    await service.initialize();

    if (!service.isAvailable()) return;

    const vectors = await service.embedBatch(['hello', 'world']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(vectors[1]).toBeInstanceOf(Float32Array);
  });

  it('reinitialize re-creates the pipeline', async () => {
    const { WasmEmbeddingService } = await import('../wasmEmbeddingService');
    const service = new WasmEmbeddingService();

    await service.initialize();
    const firstAvailable = service.isAvailable();

    const result = await service.reinitialize();
    expect(result).toBe(firstAvailable);
  });

  it('exposes EmbeddingUnavailableError class for error handling', async () => {
    const { EmbeddingUnavailableError } = await import('../wasmEmbeddingService');
    const err = new EmbeddingUnavailableError('test', 'inference_failed');
    expect(err.name).toBe('EmbeddingUnavailableError');
    expect(err.reason).toBe('inference_failed');
    expect(err.message).toBe('test');
  });

  it('error callback receives status on failure', async () => {
    const { WasmEmbeddingService } = await import('../wasmEmbeddingService');
    const errors: any[] = [];
    const service = new WasmEmbeddingService((status) => errors.push(status));

    // Force a broken state by overriding the pipeline with a bad function
    await service.initialize();
    if (!service.isAvailable()) return;

    // Override pipeline to simulate inference failure
    (service as any).pipeline = async () => { throw new Error('WASM crash'); };

    try {
      await service.embed('test');
    } catch {
      // Expected
    }

    expect(errors.length).toBeGreaterThanOrEqual(1);
    const lastError = errors[errors.length - 1];
    expect(lastError.available).toBe(false);
    expect(lastError.reason).toBe('inference_failed');
    expect(lastError.error).toContain('WASM crash');
  });
});
