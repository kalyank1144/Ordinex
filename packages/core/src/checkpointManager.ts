/**
 * CheckpointManager: Workspace snapshot and rollback system
 * Based on 02_AGENT_TOOL_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - Capture workspace snapshots before irreversible actions
 * - Restore prior states deterministically
 * - Link checkpoints to events
 * - Emit checkpoint_created / checkpoint_restored events
 * - Support git-based and snapshot-based restore methods
 * - CRITICAL: Checkpoint before write/apply operations
 */

import { EventBus } from './eventBus';
import { Event, Mode, Stage } from './types';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type RestoreMethod = 'git' | 'snapshot';

export interface CheckpointMetadata {
  checkpoint_id: string;
  creation_timestamp: string;
  associated_event_id: string;
  restore_method: RestoreMethod;
  scope: string[]; // files affected
  description: string;
}

export interface CheckpointSnapshot {
  checkpoint_id: string;
  files: Map<string, string>; // filepath -> content
  created_at: string;
}

/**
 * CheckpointManager provides deterministic rollback capability
 * CRITICAL: Must checkpoint before any write/apply operations
 */
export class CheckpointManager {
  private readonly eventBus: EventBus;
  private readonly checkpointDir: string;
  private checkpoints = new Map<string, CheckpointMetadata>();
  private snapshots = new Map<string, CheckpointSnapshot>();
  private activeCheckpointId: string | null = null;

  constructor(eventBus: EventBus, checkpointDir: string) {
    this.eventBus = eventBus;
    this.checkpointDir = checkpointDir;
    this.ensureCheckpointDirExists();
  }

  /**
   * Create a checkpoint before risky operations
   * Returns checkpoint_id
   */
  async createCheckpoint(
    taskId: string,
    mode: Mode,
    stage: Stage,
    description: string,
    scope: string[],
    restoreMethod: RestoreMethod = 'snapshot'
  ): Promise<string> {
    const checkpointId = `cp_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const timestamp = new Date().toISOString();
    const eventId = randomUUID();

    const metadata: CheckpointMetadata = {
      checkpoint_id: checkpointId,
      creation_timestamp: timestamp,
      associated_event_id: eventId,
      restore_method: restoreMethod,
      scope: [...scope],
      description,
    };

    // Store checkpoint metadata
    this.checkpoints.set(checkpointId, metadata);
    this.activeCheckpointId = checkpointId;

    // Create snapshot if using snapshot method
    if (restoreMethod === 'snapshot') {
      await this.createSnapshot(checkpointId, scope);
    }

    // Persist checkpoint metadata
    await this.persistCheckpointMetadata();

    // Emit checkpoint_created event
    const event: Event = {
      event_id: eventId,
      task_id: taskId,
      timestamp,
      type: 'checkpoint_created',
      mode,
      stage,
      payload: {
        checkpoint_id: checkpointId,
        restore_method: restoreMethod,
        scope,
        description,
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);

    return checkpointId;
  }

  /**
   * Restore a checkpoint
   * CRITICAL: Must be deterministic - same checkpoint always restores to same state
   */
  async restoreCheckpoint(
    taskId: string,
    mode: Mode,
    stage: Stage,
    checkpointId: string
  ): Promise<void> {
    const metadata = this.checkpoints.get(checkpointId);
    if (!metadata) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const timestamp = new Date().toISOString();

    // Restore based on method
    if (metadata.restore_method === 'snapshot') {
      await this.restoreSnapshot(checkpointId);
    } else if (metadata.restore_method === 'git') {
      await this.restoreGit(checkpointId);
    }

    this.activeCheckpointId = checkpointId;

    // Emit checkpoint_restored event
    const event: Event = {
      event_id: randomUUID(),
      task_id: taskId,
      timestamp,
      type: 'checkpoint_restored',
      mode,
      stage,
      payload: {
        checkpoint_id: checkpointId,
        restore_method: metadata.restore_method,
        scope: metadata.scope,
        description: metadata.description,
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);
  }

  /**
   * Get active checkpoint ID
   */
  getActiveCheckpointId(): string | null {
    return this.activeCheckpointId;
  }

  /**
   * Get checkpoint metadata
   */
  getCheckpoint(checkpointId: string): CheckpointMetadata | undefined {
    return this.checkpoints.get(checkpointId);
  }

  /**
   * Get all checkpoints
   */
  getAllCheckpoints(): CheckpointMetadata[] {
    return Array.from(this.checkpoints.values());
  }

  /**
   * Check if a checkpoint exists
   */
  hasCheckpoint(checkpointId: string): boolean {
    return this.checkpoints.has(checkpointId);
  }

  /**
   * Create a file snapshot for the checkpoint
   */
  private async createSnapshot(checkpointId: string, scope: string[]): Promise<void> {
    const files = new Map<string, string>();

    for (const filepath of scope) {
      try {
        if (fs.existsSync(filepath)) {
          const content = await fs.promises.readFile(filepath, 'utf8');
          files.set(filepath, content);
        }
      } catch (err) {
        console.warn(`Failed to snapshot file ${filepath}:`, err);
      }
    }

    const snapshot: CheckpointSnapshot = {
      checkpoint_id: checkpointId,
      files,
      created_at: new Date().toISOString(),
    };

    this.snapshots.set(checkpointId, snapshot);

    // Persist snapshot to disk
    await this.persistSnapshot(checkpointId, snapshot);
  }

  /**
   * Restore files from a snapshot
   * DETERMINISTIC: Always restores exact content
   */
  private async restoreSnapshot(checkpointId: string): Promise<void> {
    const snapshot = this.snapshots.get(checkpointId);
    if (!snapshot) {
      // Try loading from disk
      const loaded = await this.loadSnapshot(checkpointId);
      if (!loaded) {
        throw new Error(`Snapshot not found for checkpoint: ${checkpointId}`);
      }
    }

    const snapshotToRestore = this.snapshots.get(checkpointId);
    if (!snapshotToRestore) {
      throw new Error(`Failed to load snapshot: ${checkpointId}`);
    }

    // Restore each file
    for (const [filepath, content] of snapshotToRestore.files.entries()) {
      try {
        // Ensure directory exists
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
          await fs.promises.mkdir(dir, { recursive: true });
        }

        // Write content back
        await fs.promises.writeFile(filepath, content, 'utf8');
      } catch (err) {
        throw new Error(`Failed to restore file ${filepath}: ${err}`);
      }
    }
  }

  /**
   * Restore using git (placeholder for V1, requires git integration)
   */
  private async restoreGit(checkpointId: string): Promise<void> {
    // V1: Git-based restore is a stub
    // V2+: Integrate with git to restore to a specific commit/stash
    throw new Error('Git-based restore not implemented in V1');
  }

  /**
   * Persist checkpoint metadata to disk
   */
  private async persistCheckpointMetadata(): Promise<void> {
    const metadataPath = path.join(this.checkpointDir, 'checkpoints.json');
    const data = {
      checkpoints: Array.from(this.checkpoints.entries()).map(([id, meta]) => ({
        id,
        ...meta,
      })),
      active_checkpoint_id: this.activeCheckpointId,
    };

    await fs.promises.writeFile(metadataPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Persist snapshot to disk
   */
  private async persistSnapshot(checkpointId: string, snapshot: CheckpointSnapshot): Promise<void> {
    const snapshotPath = path.join(this.checkpointDir, `${checkpointId}.json`);
    const data = {
      checkpoint_id: snapshot.checkpoint_id,
      created_at: snapshot.created_at,
      files: Array.from(snapshot.files.entries()).map(([filepath, content]) => ({
        filepath,
        content,
      })),
    };

    await fs.promises.writeFile(snapshotPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Load snapshot from disk
   */
  private async loadSnapshot(checkpointId: string): Promise<boolean> {
    const snapshotPath = path.join(this.checkpointDir, `${checkpointId}.json`);
    
    try {
      if (!fs.existsSync(snapshotPath)) {
        return false;
      }

      const data = await fs.promises.readFile(snapshotPath, 'utf8');
      const parsed = JSON.parse(data);

      const files = new Map<string, string>();
      for (const { filepath, content } of parsed.files) {
        files.set(filepath, content);
      }

      const snapshot: CheckpointSnapshot = {
        checkpoint_id: parsed.checkpoint_id,
        files,
        created_at: parsed.created_at,
      };

      this.snapshots.set(checkpointId, snapshot);
      return true;
    } catch (err) {
      console.error(`Failed to load snapshot ${checkpointId}:`, err);
      return false;
    }
  }

  /**
   * Load checkpoint metadata from disk
   */
  async loadCheckpointMetadata(): Promise<void> {
    const metadataPath = path.join(this.checkpointDir, 'checkpoints.json');

    try {
      if (!fs.existsSync(metadataPath)) {
        return;
      }

      const data = await fs.promises.readFile(metadataPath, 'utf8');
      const parsed = JSON.parse(data);

      this.checkpoints.clear();
      for (const item of parsed.checkpoints) {
        const { id, ...meta } = item;
        this.checkpoints.set(id, meta as CheckpointMetadata);
      }

      this.activeCheckpointId = parsed.active_checkpoint_id;
    } catch (err) {
      console.error('Failed to load checkpoint metadata:', err);
    }
  }

  /**
   * Ensure checkpoint directory exists
   */
  private ensureCheckpointDirExists(): void {
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  /**
   * For testing: clear all checkpoints
   */
  _clearForTesting(): void {
    this.checkpoints.clear();
    this.snapshots.clear();
    this.activeCheckpointId = null;
  }
}
