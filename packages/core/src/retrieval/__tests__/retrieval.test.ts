/**
 * Tests for retrieval system: deterministic results and scope limits
 * Based on 04_INDEXING_RETRIEVAL_SPEC.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Indexer } from '../indexer';
import { Retriever } from '../retriever';
import { RetrievalRequest } from '../types';
import { EventStore } from '../../eventStore';
import { EventBus } from '../../eventBus';

describe('Retrieval System', () => {
  let tempDir: string;
  let indexer: Indexer;
  let retriever: Retriever;
  let eventStore: EventStore;
  let eventBus: EventBus;

  beforeEach(async () => {
    // Create temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));

    // Create test files
    createTestFiles(tempDir);

    // Initialize components with custom ignore pattern for .jsonl files
    indexer = new Indexer(tempDir, ['*.jsonl']);
    const storePath = path.join(tempDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    retriever = new Retriever(indexer, eventBus, 'test-task');
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Deterministic Results', () => {
    it('should return identical results for same query', async () => {
      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 5, max_lines: 200 },
      };

      const result1 = await retriever.retrieve(request);
      const result2 = await retriever.retrieve(request);

      // Results should be identical
      expect(result1.results).toEqual(result2.results);
      expect(result1.summary).toEqual(result2.summary);
    });

    it('should return results in consistent order', async () => {
      const request: RetrievalRequest = {
        query: 'test',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 10, max_lines: 400 },
      };

      const result1 = await retriever.retrieve(request);
      const result2 = await retriever.retrieve(request);

      // File order should be consistent (sorted by relevance)
      const files1 = result1.results.map(r => r.file);
      const files2 = result2.results.map(r => r.file);
      expect(files1).toEqual(files2);
    });

    it('should handle empty results deterministically', async () => {
      const request: RetrievalRequest = {
        query: 'nonexistent_keyword_xyz',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 5, max_lines: 200 },
      };

      const result1 = await retriever.retrieve(request);
      const result2 = await retriever.retrieve(request);

      expect(result1.results).toEqual([]);
      expect(result2.results).toEqual([]);
      expect(result1.summary).toContain('No results found');
    });
  });

  describe('Scope Limits', () => {
    it('should respect max_files constraint', async () => {
      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 2, max_lines: 1000 },
      };

      const result = await retriever.retrieve(request);

      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('should respect max_lines constraint', async () => {
      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 10, max_lines: 50 },
      };

      const result = await retriever.retrieve(request);

      const totalLines = result.results.reduce(
        (sum, r) => sum + (r.end_line - r.start_line + 1),
        0
      );

      expect(totalLines).toBeLessThanOrEqual(50);
    });

    it('should apply default constraints when not specified', async () => {
      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 0, max_lines: 0 }, // Will use defaults
      };

      const result = await retriever.retrieve(request);

      // Should use default limits (10 files, 400 lines)
      expect(result.results.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Retrieval Reasons', () => {
    it('should include lexical_match reason for search results', async () => {
      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 5, max_lines: 200 },
      };

      const result = await retriever.retrieve(request);

      // All results from search should have lexical_match reason
      result.results.forEach(r => {
        expect(r.reason).toBe('lexical_match');
      });
    });

    it('should include reason in summary', async () => {
      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 5, max_lines: 200 },
      };

      const result = await retriever.retrieve(request);

      if (result.results.length > 0) {
        expect(result.summary).toContain('lexical_match');
      }
    });

    it('should include excerpt in results', async () => {
      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 2, max_lines: 100 },
      };

      const result = await retriever.retrieve(request);

      if (result.results.length > 0) {
        result.results.forEach(r => {
          expect(r.excerpt).toBeDefined();
          expect(r.excerpt).not.toBe('');
        });
      }
    });
  });

  describe('Event Emission', () => {
    it('should emit retrieval_started event', async () => {
      const events: any[] = [];
      const unsubscribe = eventBus.subscribe(e => { events.push(e); });

      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 5, max_lines: 200 },
      };

      await retriever.retrieve(request);

      const startedEvent = events.find(e => e.type === 'retrieval_started');
      expect(startedEvent).toBeDefined();
      expect(startedEvent.payload.query).toBe('function');
      
      unsubscribe();
    });

    it('should emit retrieval_completed event on success', async () => {
      const events: any[] = [];
      const unsubscribe = eventBus.subscribe(e => { events.push(e); });

      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 5, max_lines: 200 },
      };

      await retriever.retrieve(request);

      const completedEvent = events.find(e => e.type === 'retrieval_completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent.payload.result_count).toBeGreaterThanOrEqual(0);
      
      unsubscribe();
    });

    it('should emit retrieval_failed event on error', async () => {
      const events: any[] = [];
      const unsubscribe = eventBus.subscribe(e => { events.push(e); });

      // Use invalid mode to trigger retrieval failure (ANSWER was removed; only PLAN | MISSION valid)
      const request = {
        query: 'test',
        mode: 'ANSWER' as const,
        stage: 'retrieve' as const,
        constraints: { max_files: 10, max_lines: 200 },
      };

      try {
        await retriever.retrieve(request as RetrievalRequest);
      } catch (err) {
        // Expected to throw: Unknown mode: ANSWER
      }

      const failedEvent = events.find(e => e.type === 'retrieval_failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent.payload.error).toBeDefined();
      
      unsubscribe();
    });
  });

  describe('Evidence Generation', () => {
    it('should create evidence object from retrieval result', async () => {
      const request: RetrievalRequest = {
        query: 'function',
        mode: 'PLAN',
        stage: 'retrieve',
        constraints: { max_files: 1, max_lines: 100 },
      };

      const result = await retriever.retrieve(request);

      if (result.results.length > 0) {
        const evidence = retriever.createEvidence(result.results[0], 'test-event-id');

        expect(evidence.evidence_id).toBeDefined();
        expect(evidence.type).toBe('file');
        expect(evidence.source_event_id).toBe('test-event-id');
        expect(evidence.content_ref).toContain(result.results[0].file);
        expect(evidence.summary).toContain(result.results[0].reason);
      }
    });
  });

  describe('Scope Expansion', () => {
    it('should emit scope_expansion_requested event', async () => {
      const events: any[] = [];
      eventBus.subscribe(e => { events.push(e); });

      const approvalId = await retriever.requestScopeExpansion(
        { max_files: 5, max_lines: 200 },
        { max_files: 15, max_lines: 600 },
        'Need more context for comprehensive analysis'
      );

      expect(approvalId).toBeDefined();

      const scopeEvent = events.find(e => e.type === 'scope_expansion_requested');
      expect(scopeEvent).toBeDefined();
      expect(scopeEvent.payload.approval_id).toBe(approvalId);
      expect(scopeEvent.payload.reason).toContain('comprehensive analysis');
    });
  });
});

/**
 * Helper function to create test files
 */
function createTestFiles(dir: string): void {
  // Create test.ts
  fs.writeFileSync(
    path.join(dir, 'test.ts'),
    `export function testFunction() {
  return "test";
}

export class TestClass {
  method() {
    return "test";
  }
}
`
  );

  // Create another.ts
  fs.writeFileSync(
    path.join(dir, 'another.ts'),
    `function anotherFunction() {
  const result = "another";
  return result;
}

export default anotherFunction;
`
  );

  // Create utils.ts
  fs.writeFileSync(
    path.join(dir, 'utils.ts'),
    `export const utils = {
  helper: function() {
    return "helper";
  }
};
`
  );

  // Create node_modules directory (should be ignored)
  const nodeModulesDir = path.join(dir, 'node_modules');
  fs.mkdirSync(nodeModulesDir);
  fs.writeFileSync(
    path.join(nodeModulesDir, 'ignored.ts'),
    'this should not be indexed'
  );
}
