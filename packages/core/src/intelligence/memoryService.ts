/**
 * V2: Project Memory - MemoryService Interface + Types
 *
 * Core defines the interface and pure data types.
 * Extension implements FsMemoryService for all FS operations.
 *
 * CONSTRAINT: Core must NOT write to disk. This file contains
 * only types and the MemoryService interface contract.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Evidence that a solution has been verified (proven to work)
 */
export interface SolutionEvidence {
  /** Which check confirmed success */
  type: 'tests' | 'build' | 'lint' | 'manual';
  /** The exact command that passed (e.g. `pnpm -r test`) */
  command: string;
  /** ISO timestamp of the verification event */
  passed_at: string;
  /** One-line result (e.g. "12 tests passed") */
  summary: string;
}

/**
 * A proven solution - the full storage schema.
 *
 * Note: SolutionCapturedPayload (in types.ts) is the lightweight event payload.
 * They share fields but serve different purposes.
 */
export interface Solution {
  /** Unique solution identifier */
  solution_id: string;
  /** Problem description */
  problem: string;
  /** Fix description */
  fix: string;
  /** Files that were changed */
  files_changed: string[];
  /** Tags for retrieval (e.g. file extensions, failure type) */
  tags: string[];
  /** Verification evidence */
  verification: SolutionEvidence;
  /** ISO timestamp of capture */
  captured_at: string;
  /** Run ID where solution was captured */
  run_id: string;
}

/**
 * A solution with a relevance score (from retrieval)
 */
export interface SolutionMatch {
  solution: Solution;
  score: number;
}

// ============================================================================
// EVENT PUBLISHER INTERFACE
// ============================================================================

/**
 * Simple interface for event publishing (compatible with Ordinex EventBus).
 * Core never imports EventBus directly; only depends on this interface.
 */
export interface EventPublisher {
  publish(event: import('../types').Event): void | Promise<void>;
}

// ============================================================================
// MEMORY SERVICE INTERFACE
// ============================================================================

/**
 * MemoryService - abstract storage layer for project memory.
 *
 * Core defines this interface. Extension implements it (FsMemoryService)
 * with actual file system operations.
 */
export interface MemoryService {
  /** Read all facts as a single string */
  readFacts(): Promise<string>;
  /** Append lines to facts, returns new total line count */
  appendFacts(lines: string): Promise<number>;
  /** Save a solution to persistent storage */
  saveSolution(solution: Solution): Promise<void>;
  /** Load all solutions */
  loadSolutions(): Promise<Solution[]>;
  /** Load a single solution by ID, returns null if not found */
  loadSolution(id: string): Promise<Solution | null>;
}
