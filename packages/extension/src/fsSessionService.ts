/**
 * FsSessionService — File system service for session persistence.
 *
 * Stores and loads session summaries from .ordinex/memory/sessions/.
 * Used by Layer 4 of the memory system.
 *
 * Storage layout:
 *   .ordinex/memory/sessions/
 *     <task-id>.md  — session summary markdown
 */

import * as path from 'path';
import { promises as fsp } from 'fs';
import type { SessionSummary } from 'core';
import { serializeSession, parseSessionHeader } from 'core';

export class FsSessionService {
  private readonly sessionsDir: string;
  private initialized = false;

  constructor(memoryRoot: string) {
    this.sessionsDir = path.join(memoryRoot, 'sessions');
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await fsp.mkdir(this.sessionsDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Save a session summary to disk.
   */
  async saveSession(summary: SessionSummary): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.sessionsDir, `${summary.taskId}.md`);
    const markdown = serializeSession(summary);
    await fsp.writeFile(filePath, markdown, 'utf-8');
  }

  /**
   * Load the N most recent session summaries (by file modification time).
   */
  async loadRecentSessions(count: number = 2): Promise<string[]> {
    await this.ensureDir();

    let files: string[];
    try {
      files = await fsp.readdir(this.sessionsDir);
    } catch {
      return [];
    }

    const mdFiles = files.filter(f => f.endsWith('.md'));
    if (mdFiles.length === 0) return [];

    const withStats = await Promise.all(
      mdFiles.map(async (f) => {
        const filePath = path.join(this.sessionsDir, f);
        try {
          const stat = await fsp.stat(filePath);
          return { file: f, mtime: stat.mtime.getTime() };
        } catch {
          return null;
        }
      }),
    );

    const sorted = withStats
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, count);

    const sessions: string[] = [];
    for (const entry of sorted) {
      try {
        const content = await fsp.readFile(
          path.join(this.sessionsDir, entry.file),
          'utf-8',
        );
        sessions.push(content);
      } catch {
        // Skip unreadable files
      }
    }

    return sessions;
  }

  /**
   * List all session task IDs (for cleanup or diagnostics).
   */
  async listSessionIds(): Promise<string[]> {
    await this.ensureDir();
    try {
      const files = await fsp.readdir(this.sessionsDir);
      return files
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace('.md', ''));
    } catch {
      return [];
    }
  }

  /**
   * Delete old sessions beyond retention limit.
   */
  async pruneOldSessions(keepCount: number = 10): Promise<number> {
    await this.ensureDir();

    let files: string[];
    try {
      files = await fsp.readdir(this.sessionsDir);
    } catch {
      return 0;
    }

    const mdFiles = files.filter(f => f.endsWith('.md'));
    if (mdFiles.length <= keepCount) return 0;

    const withStats = await Promise.all(
      mdFiles.map(async (f) => {
        const filePath = path.join(this.sessionsDir, f);
        try {
          const stat = await fsp.stat(filePath);
          return { file: f, mtime: stat.mtime.getTime() };
        } catch {
          return null;
        }
      }),
    );

    const sorted = withStats
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.mtime - a.mtime);

    const toDelete = sorted.slice(keepCount);
    let deleted = 0;

    for (const entry of toDelete) {
      try {
        await fsp.unlink(path.join(this.sessionsDir, entry.file));
        deleted++;
      } catch {
        // Skip
      }
    }

    return deleted;
  }
}
