/**
 * Step 46: Enhanced Checkpoint System - #1 Differentiator
 *
 * This is what makes Ordinex trustworthy. Cursor and Windsurf don't have
 * one-click restore. This module provides:
 *
 * - Automatic checkpoints before risky operations
 * - Preview before restore (show what will change)
 * - Git state capture
 * - Pruning of old checkpoints
 * - Enhanced metadata with reason, auto_created, expires_at
 *
 * STORAGE: .ordinex/checkpoints/
 * ├── index.json              (checkpoint registry)
 * └── {checkpoint_id}/
 *     ├── metadata.json       (full metadata)
 *     ├── files/              (file snapshots)
 *     └── git_state.json      (git info if available)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { EventBus } from './eventBus';
import { Event, Mode, Stage } from './types';
import { randomUUID } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Reason for checkpoint creation
 */
export type CheckpointReason =
  | 'pre_scaffold'
  | 'pre_mission'
  | 'pre_edit'
  | 'pre_command'
  | 'user_manual'
  | 'periodic';

/**
 * Enhanced checkpoint metadata
 */
export interface CheckpointV2 {
  /** Unique checkpoint ID */
  id: string;
  /** Creation timestamp */
  created_at: string;
  /** Associated run ID */
  run_id?: string;
  /** Associated task ID */
  task_id?: string;
  /** Reason for checkpoint */
  reason: CheckpointReason;
  /** Workspace root path */
  workspace_root: string;
  /** Human-readable description */
  description: string;
  /** Whether auto-created (vs user-initiated) */
  auto_created: boolean;
  /** Expiration timestamp (for auto-pruning) */
  expires_at?: string;
  /** Snapshot info */
  snapshot: {
    /** Files included in snapshot */
    files: CheckpointFileInfo[];
    /** Git state info (if available) */
    git_state?: GitStateInfo;
    /** Open editors at checkpoint time */
    open_editors?: string[];
  };
  /** Size in bytes */
  size_bytes: number;
}

/**
 * File info in checkpoint
 */
export interface CheckpointFileInfo {
  /** Relative path from workspace root */
  path: string;
  /** Original content hash (SHA-256) */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Whether file existed (false = created after checkpoint) */
  existed: boolean;
}

/**
 * Git state information
 */
export interface GitStateInfo {
  /** Current branch */
  branch?: string;
  /** Current commit hash */
  commit?: string;
  /** Whether there were uncommitted changes */
  dirty: boolean;
  /** Stash ID if we stashed changes */
  stash_id?: string;
}

/**
 * Restore preview - shows what will change before confirming
 */
export interface RestorePreview {
  /** Checkpoint being restored */
  checkpoint_id: string;
  /** Files that will be restored to original content */
  files_to_restore: Array<{
    path: string;
    current_exists: boolean;
    checkpoint_exists: boolean;
    will_change: boolean;
    diff_summary?: string;
  }>;
  /** Files that will be deleted (created after checkpoint) */
  files_to_delete: string[];
  /** Total files affected */
  total_affected: number;
  /** Estimated restore time in ms */
  estimated_time_ms: number;
}

/**
 * Options for creating checkpoint
 */
export interface CreateCheckpointOptions {
  /** Task ID for correlation */
  task_id?: string;
  /** Run ID for correlation */
  run_id?: string;
  /** Reason for checkpoint */
  reason: CheckpointReason;
  /** Human-readable description */
  description: string;
  /** Files to snapshot (paths relative to workspace) */
  files: string[];
  /** Whether auto-created */
  auto_created?: boolean;
  /** TTL in hours (for auto-expiry) */
  ttl_hours?: number;
  /** Open editor paths (from VS Code) */
  open_editors?: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum checkpoints to keep */
const MAX_CHECKPOINTS = 50;

/** Default TTL for auto-created checkpoints (24 hours) */
const DEFAULT_TTL_HOURS = 24;

/** Index file name */
const INDEX_FILE = 'index.json';

/** Metadata file name */
const METADATA_FILE = 'metadata.json';

/** Git state file name */
const GIT_STATE_FILE = 'git_state.json';

// ============================================================================
// ENHANCED CHECKPOINT MANAGER
// ============================================================================

/**
 * CheckpointManagerV2 - Enhanced checkpoint system
 *
 * Key improvements over V1:
 * - Preview before restore
 * - Auto-checkpoint triggers
 * - Git state capture
 * - Pruning of old checkpoints
 * - Better storage organization
 */
export class CheckpointManagerV2 {
  private eventBus: EventBus;
  private checkpointDir: string;
  private workspaceRoot: string;
  private checkpoints: Map<string, CheckpointV2> = new Map();

  constructor(eventBus: EventBus, workspaceRoot: string) {
    this.eventBus = eventBus;
    this.workspaceRoot = workspaceRoot;
    this.checkpointDir = path.join(workspaceRoot, '.ordinex', 'checkpoints');
    this.ensureCheckpointDir();
    this.loadIndex();
  }

  /**
   * Create a new checkpoint
   */
  async createCheckpoint(
    mode: Mode,
    stage: Stage,
    options: CreateCheckpointOptions
  ): Promise<CheckpointV2> {
    const id = `cp_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    // Calculate expiry
    const ttlHours = options.ttl_hours ?? (options.auto_created ? DEFAULT_TTL_HOURS : undefined);
    const expiresAt = ttlHours
      ? new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
      : undefined;

    // Capture files
    const checkpointPath = path.join(this.checkpointDir, id);
    const filesPath = path.join(checkpointPath, 'files');
    fs.mkdirSync(filesPath, { recursive: true });

    const fileInfos: CheckpointFileInfo[] = [];
    let totalSize = 0;

    for (const relativePath of options.files) {
      const fullPath = path.join(this.workspaceRoot, relativePath);
      const exists = fs.existsSync(fullPath);

      if (exists) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const hash = this.hashContent(content);
          const size = Buffer.byteLength(content, 'utf-8');

          // Save file content
          const destPath = path.join(filesPath, relativePath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, content, 'utf-8');

          fileInfos.push({ path: relativePath, hash, size, existed: true });
          totalSize += size;
        } catch (err) {
          console.warn(`Failed to snapshot ${relativePath}:`, err);
        }
      } else {
        fileInfos.push({ path: relativePath, hash: '', size: 0, existed: false });
      }
    }

    // Capture git state
    const gitState = this.captureGitState();
    if (gitState) {
      fs.writeFileSync(
        path.join(checkpointPath, GIT_STATE_FILE),
        JSON.stringify(gitState, null, 2)
      );
    }

    // Create checkpoint record
    const checkpoint: CheckpointV2 = {
      id,
      created_at: createdAt,
      run_id: options.run_id,
      task_id: options.task_id,
      reason: options.reason,
      workspace_root: this.workspaceRoot,
      description: options.description,
      auto_created: options.auto_created ?? false,
      expires_at: expiresAt,
      snapshot: {
        files: fileInfos,
        git_state: gitState,
        open_editors: options.open_editors,
      },
      size_bytes: totalSize,
    };

    // Save metadata
    fs.writeFileSync(
      path.join(checkpointPath, METADATA_FILE),
      JSON.stringify(checkpoint, null, 2)
    );

    // Update index
    this.checkpoints.set(id, checkpoint);
    this.saveIndex();

    // Emit event
    await this.emitCheckpointCreated(checkpoint, mode, stage);

    // Prune old checkpoints
    await this.pruneOldCheckpoints();

    return checkpoint;
  }

  /**
   * Preview what will change before restoring
   */
  async previewRestore(checkpointId: string): Promise<RestorePreview> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const filesToRestore: RestorePreview['files_to_restore'] = [];
    const filesToDelete: string[] = [];

    for (const fileInfo of checkpoint.snapshot.files) {
      const fullPath = path.join(this.workspaceRoot, fileInfo.path);
      const currentExists = fs.existsSync(fullPath);

      let willChange = false;
      let diffSummary: string | undefined;

      if (currentExists && fileInfo.existed) {
        // Compare current content with checkpoint
        const currentContent = fs.readFileSync(fullPath, 'utf-8');
        const currentHash = this.hashContent(currentContent);
        willChange = currentHash !== fileInfo.hash;
        if (willChange) {
          diffSummary = 'Content differs';
        }
      } else if (currentExists && !fileInfo.existed) {
        // File was created after checkpoint - will be deleted
        filesToDelete.push(fileInfo.path);
        continue;
      } else if (!currentExists && fileInfo.existed) {
        // File was deleted - will be restored
        willChange = true;
        diffSummary = 'Will be restored (currently missing)';
      }

      filesToRestore.push({
        path: fileInfo.path,
        current_exists: currentExists,
        checkpoint_exists: fileInfo.existed,
        will_change: willChange,
        diff_summary: diffSummary,
      });
    }

    return {
      checkpoint_id: checkpointId,
      files_to_restore: filesToRestore,
      files_to_delete: filesToDelete,
      total_affected: filesToRestore.filter(f => f.will_change).length + filesToDelete.length,
      estimated_time_ms: Math.max(100, (filesToRestore.length + filesToDelete.length) * 10),
    };
  }

  /**
   * Restore a checkpoint
   */
  async restoreCheckpoint(
    checkpointId: string,
    mode: Mode,
    stage: Stage,
    taskId?: string
  ): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const checkpointPath = path.join(this.checkpointDir, checkpointId);
    const filesPath = path.join(checkpointPath, 'files');

    // Emit restore started event
    await this.emitRestoreStarted(checkpoint, mode, stage, taskId);

    // Restore each file
    for (const fileInfo of checkpoint.snapshot.files) {
      const fullPath = path.join(this.workspaceRoot, fileInfo.path);
      const snapshotPath = path.join(filesPath, fileInfo.path);

      if (fileInfo.existed && fs.existsSync(snapshotPath)) {
        // Restore file from snapshot
        const content = fs.readFileSync(snapshotPath, 'utf-8');
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
      } else if (!fileInfo.existed && fs.existsSync(fullPath)) {
        // File was created after checkpoint - delete it
        fs.unlinkSync(fullPath);
      }
    }

    // Emit restore completed event
    await this.emitRestoreCompleted(checkpoint, mode, stage, taskId);
  }

  /**
   * Get a checkpoint by ID
   */
  getCheckpoint(checkpointId: string): CheckpointV2 | undefined {
    return this.checkpoints.get(checkpointId);
  }

  /**
   * Get the latest checkpoint
   */
  getLatestCheckpoint(): CheckpointV2 | undefined {
    const checkpoints = this.listCheckpoints();
    return checkpoints[0];
  }

  /**
   * List all checkpoints (newest first)
   */
  listCheckpoints(): CheckpointV2[] {
    return Array.from(this.checkpoints.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  /**
   * List checkpoints by reason
   */
  listCheckpointsByReason(reason: CheckpointReason): CheckpointV2[] {
    return this.listCheckpoints().filter(cp => cp.reason === reason);
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Delete checkpoint directory
    const checkpointPath = path.join(this.checkpointDir, checkpointId);
    if (fs.existsSync(checkpointPath)) {
      fs.rmSync(checkpointPath, { recursive: true, force: true });
    }

    // Remove from index
    this.checkpoints.delete(checkpointId);
    this.saveIndex();
  }

  /**
   * Prune old/expired checkpoints
   */
  async pruneOldCheckpoints(): Promise<number> {
    const now = Date.now();
    let pruned = 0;

    // Get all checkpoints sorted by creation time (oldest first)
    const checkpoints = this.listCheckpoints().reverse();

    // Delete expired checkpoints
    for (const cp of checkpoints) {
      if (cp.expires_at && new Date(cp.expires_at).getTime() < now) {
        await this.deleteCheckpoint(cp.id);
        pruned++;
      }
    }

    // Delete oldest if over max
    while (this.checkpoints.size > MAX_CHECKPOINTS) {
      const oldest = this.listCheckpoints().pop();
      if (oldest && oldest.auto_created) {
        await this.deleteCheckpoint(oldest.id);
        pruned++;
      } else {
        break; // Don't delete user-created checkpoints
      }
    }

    return pruned;
  }

  // -------------------------------------------------------------------------
  // PRIVATE METHODS
  // -------------------------------------------------------------------------

  private ensureCheckpointDir(): void {
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  private loadIndex(): void {
    const indexPath = path.join(this.checkpointDir, INDEX_FILE);
    if (fs.existsSync(indexPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        this.checkpoints.clear();
        for (const cp of data.checkpoints || []) {
          this.checkpoints.set(cp.id, cp);
        }
      } catch (err) {
        console.warn('Failed to load checkpoint index:', err);
      }
    }
  }

  private saveIndex(): void {
    const indexPath = path.join(this.checkpointDir, INDEX_FILE);
    const data = {
      version: '2.0',
      checkpoints: Array.from(this.checkpoints.values()),
    };
    fs.writeFileSync(indexPath, JSON.stringify(data, null, 2));
  }

  private captureGitState(): GitStateInfo | undefined {
    try {
      // Check if in a git repo
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: this.workspaceRoot,
        stdio: 'pipe',
      });

      // Get current branch
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      }).trim();

      // Get current commit
      const commit = execSync('git rev-parse HEAD', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      }).trim();

      // Check if dirty
      const status = execSync('git status --porcelain', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      }).trim();
      const dirty = status.length > 0;

      return { branch, commit, dirty };
    } catch {
      return undefined;
    }
  }

  private hashContent(content: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private async emitCheckpointCreated(
    checkpoint: CheckpointV2,
    mode: Mode,
    stage: Stage
  ): Promise<void> {
    const event: Event = {
      event_id: randomUUID(),
      task_id: checkpoint.task_id || 'unknown',
      timestamp: checkpoint.created_at,
      type: 'checkpoint_created',
      mode,
      stage,
      payload: {
        checkpoint_id: checkpoint.id,
        reason: checkpoint.reason,
        description: checkpoint.description,
        files_count: checkpoint.snapshot.files.length,
        auto_created: checkpoint.auto_created,
        expires_at: checkpoint.expires_at,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    await this.eventBus.publish(event);
  }

  private async emitRestoreStarted(
    checkpoint: CheckpointV2,
    mode: Mode,
    stage: Stage,
    taskId?: string
  ): Promise<void> {
    const event: Event = {
      event_id: randomUUID(),
      task_id: taskId || checkpoint.task_id || 'unknown',
      timestamp: new Date().toISOString(),
      type: 'checkpoint_restore_started' as any, // Extended event type
      mode,
      stage,
      payload: {
        checkpoint_id: checkpoint.id,
        files_to_restore: checkpoint.snapshot.files.length,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    await this.eventBus.publish(event);
  }

  private async emitRestoreCompleted(
    checkpoint: CheckpointV2,
    mode: Mode,
    stage: Stage,
    taskId?: string
  ): Promise<void> {
    const event: Event = {
      event_id: randomUUID(),
      task_id: taskId || checkpoint.task_id || 'unknown',
      timestamp: new Date().toISOString(),
      type: 'checkpoint_restored',
      mode,
      stage,
      payload: {
        checkpoint_id: checkpoint.id,
        description: checkpoint.description,
        files_restored: checkpoint.snapshot.files.filter(f => f.existed).length,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    await this.eventBus.publish(event);
  }
}

// ============================================================================
// SINGLETON & HELPERS
// ============================================================================

let globalCheckpointManager: CheckpointManagerV2 | null = null;

/**
 * Initialize the global checkpoint manager
 */
export function initCheckpointManagerV2(
  eventBus: EventBus,
  workspaceRoot: string
): CheckpointManagerV2 {
  globalCheckpointManager = new CheckpointManagerV2(eventBus, workspaceRoot);
  return globalCheckpointManager;
}

/**
 * Get the global checkpoint manager
 */
export function getCheckpointManagerV2(): CheckpointManagerV2 | null {
  return globalCheckpointManager;
}

/**
 * P2-1: Reset the global checkpoint manager (workspace change invalidation)
 */
export function resetCheckpointManagerV2(): void {
  globalCheckpointManager = null;
}

/**
 * Create a pre-scaffold checkpoint (convenience function)
 */
export async function createPreScaffoldCheckpoint(
  eventBus: EventBus,
  workspaceRoot: string,
  mode: Mode,
  stage: Stage,
  runId?: string,
  taskId?: string
): Promise<CheckpointV2> {
  const manager = globalCheckpointManager || new CheckpointManagerV2(eventBus, workspaceRoot);
  return manager.createCheckpoint(mode, stage, {
    run_id: runId,
    task_id: taskId,
    reason: 'pre_scaffold',
    description: 'Automatic checkpoint before scaffold',
    files: [], // Will capture current state
    auto_created: true,
    ttl_hours: 24,
  });
}

/**
 * Create a pre-mission checkpoint (convenience function)
 */
export async function createPreMissionCheckpoint(
  eventBus: EventBus,
  workspaceRoot: string,
  mode: Mode,
  stage: Stage,
  files: string[],
  runId?: string,
  taskId?: string
): Promise<CheckpointV2> {
  const manager = globalCheckpointManager || new CheckpointManagerV2(eventBus, workspaceRoot);
  return manager.createCheckpoint(mode, stage, {
    run_id: runId,
    task_id: taskId,
    reason: 'pre_mission',
    description: 'Automatic checkpoint before mission execution',
    files,
    auto_created: true,
    ttl_hours: 48,
  });
}

/**
 * Create a pre-edit checkpoint (convenience function)
 */
export async function createPreEditCheckpoint(
  eventBus: EventBus,
  workspaceRoot: string,
  mode: Mode,
  stage: Stage,
  files: string[],
  description: string,
  runId?: string,
  taskId?: string
): Promise<CheckpointV2> {
  const manager = globalCheckpointManager || new CheckpointManagerV2(eventBus, workspaceRoot);
  return manager.createCheckpoint(mode, stage, {
    run_id: runId,
    task_id: taskId,
    reason: 'pre_edit',
    description,
    files,
    auto_created: true,
    ttl_hours: 24,
  });
}
