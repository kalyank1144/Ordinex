/**
 * V2: ProjectMemoryManager - Pure Logic (No FS)
 *
 * Manages project memory: facts, solutions, and retrieval scoring.
 * Takes MemoryService (injected) + EventPublisher for event emission.
 *
 * CONSTRAINT: NO require('fs'). All IO via injected MemoryService.
 */

import type { Event, Mode, Stage } from '../types';
import type { MemoryService, Solution, SolutionMatch, EventPublisher } from './memoryService';

// ============================================================================
// HELPERS
// ============================================================================

function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `evt_${ts}_${rand}`;
}

/**
 * Tokenize text into a set of lowercase words (>= 2 chars).
 * Strips punctuation and splits on whitespace.
 */
export function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_\-./]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
  return new Set(words);
}

// ============================================================================
// PROJECT MEMORY MANAGER
// ============================================================================

export class ProjectMemoryManager {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly eventBus: EventPublisher,
  ) {}

  /**
   * Append new fact lines to project facts.
   * Emits `memory_facts_updated` event.
   */
  async updateFacts(
    runId: string,
    deltaLines: string,
    taskId: string,
    mode: Mode,
  ): Promise<void> {
    const totalLines = await this.memoryService.appendFacts(deltaLines);
    const linesAdded = deltaLines.split('\n').filter(l => l.trim().length > 0).length;

    // Build delta summary: first line, ≤80 chars
    const firstLine = deltaLines.split('\n').find(l => l.trim().length > 0) || '';
    const deltaSummary = firstLine.length > 80
      ? firstLine.substring(0, 77) + '...'
      : firstLine;

    const event: Event = {
      event_id: generateEventId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'memory_facts_updated',
      mode,
      stage: 'none' as Stage,
      payload: {
        run_id: runId,
        delta_summary: deltaSummary,
        lines_added: linesAdded,
        total_lines: totalLines,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    await this.eventBus.publish(event);
  }

  /**
   * Get facts summary (last N lines).
   * Returns empty string if no facts exist.
   */
  async getFactsSummary(maxLines: number = 30): Promise<string> {
    const facts = await this.memoryService.readFacts();
    if (!facts || facts.trim().length === 0) {
      return '';
    }
    const lines = facts.split('\n');
    if (lines.length <= maxLines) {
      return facts;
    }
    return lines.slice(-maxLines).join('\n');
  }

  /**
   * Save a proven solution and emit `solution_captured` event.
   */
  async captureSolution(
    solution: Solution,
    taskId: string,
    mode: Mode,
  ): Promise<void> {
    await this.memoryService.saveSolution(solution);

    const event: Event = {
      event_id: generateEventId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'solution_captured',
      mode,
      stage: 'none' as Stage,
      payload: {
        run_id: solution.run_id,
        solution_id: solution.solution_id,
        problem: solution.problem,
        fix: solution.fix,
        files_changed: solution.files_changed,
        tags: solution.tags,
        verification: {
          type: solution.verification.type,
          command: solution.verification.command,
          passed_at: solution.verification.passed_at,
          summary: solution.verification.summary,
        },
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    await this.eventBus.publish(event);
  }

  /**
   * Query relevant solutions using deterministic keyword matching.
   * No embeddings — purely tokenized overlap + recency bonus.
   */
  async queryRelevantSolutions(
    input: string,
    topK: number = 3,
  ): Promise<SolutionMatch[]> {
    const solutions = await this.memoryService.loadSolutions();
    if (solutions.length === 0) return [];

    const inputTokens = tokenize(input);
    if (inputTokens.size === 0) return [];

    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    const scored: SolutionMatch[] = [];

    for (const solution of solutions) {
      // Tokenize solution fields
      const solutionText = [
        solution.problem,
        solution.fix,
        ...solution.tags,
        ...solution.files_changed,
      ].join(' ');
      const solutionTokens = tokenize(solutionText);

      // Count shared tokens
      let sharedCount = 0;
      for (const token of inputTokens) {
        if (solutionTokens.has(token)) {
          sharedCount++;
        }
      }

      if (sharedCount === 0) continue;

      // Recency bonus: linear decay over 30 days (max 1.0)
      const capturedMs = new Date(solution.captured_at).getTime();
      const ageMs = now - capturedMs;
      const recencyBonus = Math.max(0, 1 - ageMs / thirtyDaysMs);

      const score = (sharedCount * 2) + recencyBonus;

      scored.push({ solution, score });
    }

    // Sort descending by score, take topK
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
