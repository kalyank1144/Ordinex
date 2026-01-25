/**
 * ContextSnapshotManager: Stale context detection for Step 27
 * 
 * Requirements (from spec):
 * - For every retrieved excerpt, store: filePath, lineRange, contentHash, mtime
 * - Before applying ANY diff: recheck hashes/mtime
 * - If mismatch: emit stale_context_detected, re-run retrieval
 * - NEVER apply diff on stale context
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventBus } from './eventBus';
import { Event, Mode, Stage } from './types';
import { randomUUID } from 'crypto';

/**
 * Context snapshot for a retrieved file excerpt
 */
export interface ContextSnapshot {
  /** Relative file path from workspace root */
  filePath: string;
  
  /** Line range that was retrieved */
  lineRange: {
    start: number;
    end: number;
  };
  
  /** SHA-256 hash of the content at retrieval time */
  contentHash: string;
  
  /** File modification time (ms since epoch) at retrieval time */
  mtime: number;
  
  /** Timestamp when snapshot was created */
  snapshotTime: string;
}

/**
 * Result of staleness check
 */
export interface StalenessResult {
  /** Whether any file is stale */
  stale: boolean;
  
  /** If stale, which file(s) changed */
  staleFiles: Array<{
    filePath: string;
    reason: 'content_changed' | 'mtime_changed' | 'file_deleted';
    expected: { hash: string; mtime: number };
    actual: { hash?: string; mtime?: number };
  }>;
}

/**
 * ContextSnapshotManager tracks file state for staleness detection
 */
export class ContextSnapshotManager {
  private readonly workspaceRoot: string;
  private readonly eventBus: EventBus;
  private readonly taskId: string;
  
  /** In-memory snapshot storage (keyed by filePath) */
  private snapshots: Map<string, ContextSnapshot> = new Map();

  constructor(workspaceRoot: string, eventBus: EventBus, taskId: string) {
    this.workspaceRoot = workspaceRoot;
    this.eventBus = eventBus;
    this.taskId = taskId;
  }

  /**
   * Create a snapshot for a file excerpt
   * REQUIRED: Call this for every retrieved excerpt
   */
  async createSnapshot(
    filePath: string,
    lineRange: { start: number; end: number }
  ): Promise<ContextSnapshot> {
    const fullPath = path.join(this.workspaceRoot, filePath);
    
    try {
      // Get file stats
      const stats = await fs.stat(fullPath);
      
      // Read file content for the specific line range
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const excerptLines = lines.slice(lineRange.start - 1, lineRange.end);
      const excerptContent = excerptLines.join('\n');
      
      // Compute hash of excerpt content
      const contentHash = this.computeHash(excerptContent);
      
      const snapshot: ContextSnapshot = {
        filePath,
        lineRange,
        contentHash,
        mtime: stats.mtimeMs,
        snapshotTime: new Date().toISOString(),
      };
      
      // Store snapshot
      this.snapshots.set(filePath, snapshot);
      
      // Emit context_snapshot_created event
      await this.emitEvent('context_snapshot_created', {
        filePath,
        lineRange,
        contentHash: contentHash.substring(0, 16) + '...', // Truncate for logging
        mtime: snapshot.mtime,
      });
      
      return snapshot;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        throw new Error(`Cannot create snapshot: file not found: ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * Create snapshots for multiple file excerpts
   */
  async createSnapshots(
    excerpts: Array<{ filePath: string; lineRange: { start: number; end: number } }>
  ): Promise<ContextSnapshot[]> {
    const snapshots: ContextSnapshot[] = [];
    
    for (const excerpt of excerpts) {
      const snapshot = await this.createSnapshot(excerpt.filePath, excerpt.lineRange);
      snapshots.push(snapshot);
    }
    
    return snapshots;
  }

  /**
   * Check if any tracked files are stale
   * REQUIRED: Call this BEFORE applying any diff
   * 
   * Returns { stale: false } if all files match their snapshots
   * Returns { stale: true, staleFiles: [...] } if any file changed
   */
  async checkStaleness(filePaths?: string[]): Promise<StalenessResult> {
    const pathsToCheck = filePaths || Array.from(this.snapshots.keys());
    const staleFiles: StalenessResult['staleFiles'] = [];
    
    for (const filePath of pathsToCheck) {
      const snapshot = this.snapshots.get(filePath);
      if (!snapshot) {
        // No snapshot for this file - skip (not tracked)
        continue;
      }
      
      const fullPath = path.join(this.workspaceRoot, filePath);
      
      try {
        // Get current file stats
        const stats = await fs.stat(fullPath);
        
        // Quick check: mtime
        if (stats.mtimeMs !== snapshot.mtime) {
          // mtime changed - check content hash to confirm
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          const excerptLines = lines.slice(
            snapshot.lineRange.start - 1,
            snapshot.lineRange.end
          );
          const excerptContent = excerptLines.join('\n');
          const currentHash = this.computeHash(excerptContent);
          
          if (currentHash !== snapshot.contentHash) {
            staleFiles.push({
              filePath,
              reason: 'content_changed',
              expected: { hash: snapshot.contentHash, mtime: snapshot.mtime },
              actual: { hash: currentHash, mtime: stats.mtimeMs },
            });
          } else {
            // mtime changed but content same - update snapshot silently
            snapshot.mtime = stats.mtimeMs;
          }
        }
      } catch (error) {
        if ((error as any).code === 'ENOENT') {
          staleFiles.push({
            filePath,
            reason: 'file_deleted',
            expected: { hash: snapshot.contentHash, mtime: snapshot.mtime },
            actual: {},
          });
        } else {
          throw error;
        }
      }
    }
    
    if (staleFiles.length > 0) {
      // Emit stale_context_detected event
      await this.emitEvent('stale_context_detected', {
        staleFiles: staleFiles.map(f => ({
          filePath: f.filePath,
          reason: f.reason,
        })),
        totalTracked: this.snapshots.size,
      });
      
      return { stale: true, staleFiles };
    }
    
    return { stale: false, staleFiles: [] };
  }

  /**
   * Check staleness for specific files (convenience method)
   */
  async checkFileStaleness(filePaths: string[]): Promise<StalenessResult> {
    return this.checkStaleness(filePaths);
  }

  /**
   * Invalidate a snapshot (e.g., after successful diff application)
   */
  invalidateSnapshot(filePath: string): void {
    this.snapshots.delete(filePath);
  }

  /**
   * Invalidate all snapshots
   */
  invalidateAllSnapshots(): void {
    this.snapshots.clear();
  }

  /**
   * Get current snapshot for a file
   */
  getSnapshot(filePath: string): ContextSnapshot | undefined {
    return this.snapshots.get(filePath);
  }

  /**
   * Get all snapshots
   */
  getAllSnapshots(): ContextSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /**
   * Compute SHA-256 hash of content
   */
  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  /**
   * Emit event via EventBus
   */
  private async emitEvent(
    type: 'context_snapshot_created' | 'stale_context_detected',
    payload: Record<string, unknown>
  ): Promise<void> {
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type,
      mode: 'MISSION',
      stage: 'retrieve',
      payload,
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);
  }

  /**
   * Refresh a snapshot (re-read file and update stored state)
   * Use after re-running retrieval due to staleness
   */
  async refreshSnapshot(filePath: string): Promise<ContextSnapshot | null> {
    const existing = this.snapshots.get(filePath);
    if (!existing) {
      return null;
    }
    
    return this.createSnapshot(filePath, existing.lineRange);
  }

  /**
   * Refresh all snapshots
   */
  async refreshAllSnapshots(): Promise<ContextSnapshot[]> {
    const refreshed: ContextSnapshot[] = [];
    
    for (const [filePath, snapshot] of this.snapshots.entries()) {
      try {
        const newSnapshot = await this.createSnapshot(filePath, snapshot.lineRange);
        refreshed.push(newSnapshot);
      } catch (error) {
        // File may have been deleted - skip
        console.warn(`Could not refresh snapshot for ${filePath}:`, error);
      }
    }
    
    return refreshed;
  }
}
