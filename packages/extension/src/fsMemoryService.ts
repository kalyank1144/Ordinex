/**
 * V2: FsMemoryService - File System Implementation of MemoryService
 *
 * All FS operations for project memory live here (not in core).
 *
 * Storage layout:
 *   .ordinex/memory/
 *     facts.md              ← append-only plain text
 *     solutions/
 *       index.json          ← rebuildable cache of solution IDs
 *       <id>.json           ← individual solution files (source of truth)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MemoryService, Solution } from 'core';

export class FsMemoryService implements MemoryService {
  private readonly factsPath: string;
  private readonly solutionsDir: string;
  private readonly indexPath: string;
  private initialized = false;

  constructor(memoryRoot: string) {
    this.factsPath = path.join(memoryRoot, 'facts.md');
    this.solutionsDir = path.join(memoryRoot, 'solutions');
    this.indexPath = path.join(this.solutionsDir, 'index.json');
  }

  private ensureDirs(): void {
    if (this.initialized) return;
    fs.mkdirSync(this.solutionsDir, { recursive: true });
    this.initialized = true;
  }

  async readFacts(): Promise<string> {
    try {
      return fs.readFileSync(this.factsPath, 'utf-8');
    } catch {
      return '';
    }
  }

  async appendFacts(lines: string): Promise<number> {
    this.ensureDirs();
    const existing = await this.readFacts();
    const newContent = existing ? existing + '\n' + lines : lines;
    fs.writeFileSync(this.factsPath, newContent, 'utf-8');
    return newContent.split('\n').filter(l => l.trim().length > 0).length;
  }

  async saveSolution(solution: Solution): Promise<void> {
    this.ensureDirs();
    const filePath = path.join(this.solutionsDir, `${solution.solution_id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(solution, null, 2), 'utf-8');

    // Update index cache
    const index = await this.loadIndex();
    if (!index.includes(solution.solution_id)) {
      index.push(solution.solution_id);
      fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
    }
  }

  async loadSolutions(): Promise<Solution[]> {
    this.ensureDirs();
    let ids = await this.loadIndex();

    // If index is empty, rebuild from filesystem (index is a rebuildable cache)
    if (ids.length === 0) {
      ids = this.rebuildIndex();
    }

    const solutions: Solution[] = [];
    for (const id of ids) {
      const sol = await this.loadSolution(id);
      if (sol) solutions.push(sol);
    }
    return solutions;
  }

  async loadSolution(id: string): Promise<Solution | null> {
    try {
      const filePath = path.join(this.solutionsDir, `${id}.json`);
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as Solution;
    } catch {
      return null;
    }
  }

  private async loadIndex(): Promise<string[]> {
    try {
      const content = fs.readFileSync(this.indexPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      // Missing or corrupt index — will rebuild on loadSolutions
      return [];
    }
  }

  /**
   * Rebuild index from solutions/*.json scan.
   * Writes the rebuilt index back to disk.
   */
  private rebuildIndex(): string[] {
    try {
      const files = fs.readdirSync(this.solutionsDir);
      const ids = files
        .filter(f => f.endsWith('.json') && f !== 'index.json')
        .map(f => f.replace('.json', ''));

      if (ids.length > 0) {
        fs.writeFileSync(this.indexPath, JSON.stringify(ids, null, 2), 'utf-8');
      }
      return ids;
    } catch {
      return [];
    }
  }
}
