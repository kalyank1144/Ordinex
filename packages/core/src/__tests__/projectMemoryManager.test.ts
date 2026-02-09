/**
 * ProjectMemoryManager Tests
 *
 * Uses mock MemoryService + mock EventPublisher.
 * Verifies facts management, solution capture, and retrieval scoring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectMemoryManager, tokenize } from '../intelligence/projectMemoryManager';
import type { MemoryService, Solution, EventPublisher } from '../intelligence/memoryService';
import type { Event } from '../types';

// ============================================================================
// MOCKS
// ============================================================================

function createMockMemoryService(overrides: Partial<MemoryService> = {}): MemoryService {
  return {
    readFacts: vi.fn().mockResolvedValue(''),
    appendFacts: vi.fn().mockResolvedValue(1),
    saveSolution: vi.fn().mockResolvedValue(undefined),
    loadSolutions: vi.fn().mockResolvedValue([]),
    loadSolution: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function createMockPublisher(): EventPublisher & { events: Event[] } {
  const events: Event[] = [];
  return {
    events,
    publish: vi.fn(async (event: Event) => { events.push(event); }),
  };
}

function createSolution(overrides: Partial<Solution> = {}): Solution {
  return {
    solution_id: 'sol_123',
    problem: 'TypeScript compilation error in auth module',
    fix: 'Added missing return type annotation to login handler',
    files_changed: ['src/auth/login.ts', 'src/auth/types.ts'],
    tags: ['typescript', 'auth', 'compilation'],
    verification: {
      type: 'tests',
      command: 'pnpm -r test',
      passed_at: new Date().toISOString(),
      summary: '12 tests passed',
    },
    captured_at: new Date().toISOString(),
    run_id: 'run_abc',
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('ProjectMemoryManager', () => {
  let memoryService: MemoryService;
  let publisher: ReturnType<typeof createMockPublisher>;
  let manager: ProjectMemoryManager;

  beforeEach(() => {
    memoryService = createMockMemoryService();
    publisher = createMockPublisher();
    manager = new ProjectMemoryManager(memoryService, publisher);
  });

  // ========================================================================
  // updateFacts
  // ========================================================================

  describe('updateFacts', () => {
    it('appends lines and emits memory_facts_updated', async () => {
      (memoryService.appendFacts as any).mockResolvedValue(5);

      await manager.updateFacts('run_1', 'New fact line\nAnother fact', 'task_1', 'MISSION');

      expect(memoryService.appendFacts).toHaveBeenCalledWith('New fact line\nAnother fact');
      expect(publisher.events).toHaveLength(1);
      expect(publisher.events[0].type).toBe('memory_facts_updated');
    });

    it('includes correct delta_summary (first line, ≤80 chars)', async () => {
      (memoryService.appendFacts as any).mockResolvedValue(1);

      await manager.updateFacts('run_1', 'Short summary line', 'task_1', 'PLAN');

      const payload = publisher.events[0].payload;
      expect(payload.delta_summary).toBe('Short summary line');
    });

    it('truncates delta_summary longer than 80 chars', async () => {
      (memoryService.appendFacts as any).mockResolvedValue(1);
      const longLine = 'A'.repeat(100);

      await manager.updateFacts('run_1', longLine, 'task_1', 'PLAN');

      const payload = publisher.events[0].payload;
      expect((payload.delta_summary as string).length).toBeLessThanOrEqual(80);
      expect((payload.delta_summary as string).endsWith('...')).toBe(true);
    });

    it('total_lines matches actual count from service', async () => {
      (memoryService.appendFacts as any).mockResolvedValue(42);

      await manager.updateFacts('run_1', 'fact', 'task_1', 'ANSWER');

      expect(publisher.events[0].payload.total_lines).toBe(42);
    });
  });

  // ========================================================================
  // getFactsSummary
  // ========================================================================

  describe('getFactsSummary', () => {
    it('returns empty string for no facts', async () => {
      (memoryService.readFacts as any).mockResolvedValue('');

      const result = await manager.getFactsSummary();
      expect(result).toBe('');
    });

    it('returns all lines if under maxLines', async () => {
      const facts = 'Line 1\nLine 2\nLine 3';
      (memoryService.readFacts as any).mockResolvedValue(facts);

      const result = await manager.getFactsSummary(10);
      expect(result).toBe(facts);
    });

    it('truncates to last N lines', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
      (memoryService.readFacts as any).mockResolvedValue(lines.join('\n'));

      const result = await manager.getFactsSummary(5);
      const resultLines = result.split('\n');
      expect(resultLines).toHaveLength(5);
      expect(resultLines[0]).toBe('Line 46');
      expect(resultLines[4]).toBe('Line 50');
    });
  });

  // ========================================================================
  // captureSolution
  // ========================================================================

  describe('captureSolution', () => {
    it('saves and emits solution_captured', async () => {
      const solution = createSolution();

      await manager.captureSolution(solution, 'task_1', 'MISSION');

      expect(memoryService.saveSolution).toHaveBeenCalledWith(solution);
      expect(publisher.events).toHaveLength(1);
      expect(publisher.events[0].type).toBe('solution_captured');
    });

    it('event payload matches SolutionCapturedPayload shape', async () => {
      const solution = createSolution({
        solution_id: 'sol_abc',
        problem: 'Missing import',
        fix: 'Added import statement',
        files_changed: ['src/app.ts'],
        tags: ['import', 'typescript'],
        run_id: 'run_xyz',
      });

      await manager.captureSolution(solution, 'task_1', 'MISSION');

      const payload = publisher.events[0].payload;
      expect(payload.run_id).toBe('run_xyz');
      expect(payload.solution_id).toBe('sol_abc');
      expect(payload.problem).toBe('Missing import');
      expect(payload.fix).toBe('Added import statement');
      expect(payload.files_changed).toEqual(['src/app.ts']);
      expect(payload.tags).toEqual(['import', 'typescript']);
      expect(payload.verification).toBeDefined();
      expect((payload.verification as any).type).toBe('tests');
    });
  });

  // ========================================================================
  // queryRelevantSolutions
  // ========================================================================

  describe('queryRelevantSolutions', () => {
    it('returns empty for no solutions', async () => {
      const result = await manager.queryRelevantSolutions('fix auth bug');
      expect(result).toEqual([]);
    });

    it('returns matches sorted by score descending', async () => {
      const sol1 = createSolution({
        solution_id: 'sol_1',
        problem: 'auth login error',
        fix: 'fixed token refresh',
        tags: ['auth'],
        files_changed: ['auth.ts'],
      });
      const sol2 = createSolution({
        solution_id: 'sol_2',
        problem: 'auth login session expired token refresh middleware',
        fix: 'updated auth middleware token validation login flow',
        tags: ['auth', 'login', 'token'],
        files_changed: ['auth.ts', 'middleware.ts'],
      });
      (memoryService.loadSolutions as any).mockResolvedValue([sol1, sol2]);

      const result = await manager.queryRelevantSolutions('auth login token');

      expect(result.length).toBeGreaterThanOrEqual(1);
      // sol2 should score higher (more shared tokens)
      if (result.length >= 2) {
        expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
      }
    });

    it('respects topK limit', async () => {
      const solutions = Array.from({ length: 10 }, (_, i) =>
        createSolution({
          solution_id: `sol_${i}`,
          problem: `auth problem ${i}`,
          fix: `auth fix ${i}`,
          tags: ['auth'],
        })
      );
      (memoryService.loadSolutions as any).mockResolvedValue(solutions);

      const result = await manager.queryRelevantSolutions('auth problem', 2);
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('scores keyword matches > non-matches', async () => {
      const match = createSolution({
        solution_id: 'match',
        problem: 'typescript compilation error',
        fix: 'fixed types',
        tags: ['typescript'],
      });
      const noMatch = createSolution({
        solution_id: 'no_match',
        problem: 'python dependency issue',
        fix: 'updated requirements',
        tags: ['python'],
      });
      (memoryService.loadSolutions as any).mockResolvedValue([match, noMatch]);

      const result = await manager.queryRelevantSolutions('typescript error');

      expect(result.length).toBe(1);
      expect(result[0].solution.solution_id).toBe('match');
    });

    it('applies recency bonus (recent > old)', async () => {
      const recent = createSolution({
        solution_id: 'recent',
        problem: 'auth error',
        fix: 'fix auth',
        tags: ['auth'],
        captured_at: new Date().toISOString(),
      });
      const old = createSolution({
        solution_id: 'old',
        problem: 'auth error',
        fix: 'fix auth',
        tags: ['auth'],
        captured_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
      });
      (memoryService.loadSolutions as any).mockResolvedValue([old, recent]);

      const result = await manager.queryRelevantSolutions('auth error');

      expect(result.length).toBe(2);
      expect(result[0].solution.solution_id).toBe('recent');
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    it('filters zero-score results', async () => {
      const solution = createSolution({
        problem: 'python issue',
        fix: 'pip install',
        tags: ['python'],
        files_changed: ['requirements.txt'],
      });
      (memoryService.loadSolutions as any).mockResolvedValue([solution]);

      const result = await manager.queryRelevantSolutions('typescript react component');
      expect(result).toEqual([]);
    });
  });

  // ========================================================================
  // tokenize helper
  // ========================================================================

  describe('tokenize', () => {
    it('handles special characters and short tokens', () => {
      const tokens = tokenize('Fix bug! in src/auth.ts (v2)');
      expect(tokens.has('fix')).toBe(true);
      expect(tokens.has('bug')).toBe(true);
      expect(tokens.has('src/auth.ts')).toBe(true);
      expect(tokens.has('v2')).toBe(true);
      // Single char tokens filtered out
      expect(tokens.has('!')).toBe(false);
    });

    it('returns empty set for empty string', () => {
      expect(tokenize('').size).toBe(0);
    });

    it('deduplicates repeated words', () => {
      const tokens = tokenize('fix fix fix bug bug');
      expect(tokens.size).toBe(2);
    });
  });
});
