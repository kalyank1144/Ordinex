/**
 * Step 47: FsTaskPersistenceService — File System Implementation of TaskPersistenceService
 *
 * Storage layout:
 *   .ordinex/tasks/
 *     active.json              ← pointer: { active_task_id, updated_at }
 *     metadata/{task_id}.json  ← ActiveTaskMetadata per task
 *
 * P2-3: Hot-path FS operations converted to async (fs.promises).
 * markCleanExitSync intentionally remains sync for deactivate() time budget.
 */

import * as fs from 'fs';
import * as path from 'path';
import { promises as fsp } from 'fs';
import type { TaskPersistenceService, ActiveTaskMetadata, ActiveTaskPointer } from 'core';

export class FsTaskPersistenceService implements TaskPersistenceService {
  private readonly tasksDir: string;
  private readonly metadataDir: string;
  private readonly activePath: string;
  private initialized = false;

  constructor(workspaceRoot: string) {
    this.tasksDir = path.join(workspaceRoot, '.ordinex', 'tasks');
    this.metadataDir = path.join(this.tasksDir, 'metadata');
    this.activePath = path.join(this.tasksDir, 'active.json');
  }

  private async ensureDirs(): Promise<void> {
    if (this.initialized) return;
    await fsp.mkdir(this.metadataDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Write metadata file + update active.json pointer.
   */
  async setActiveTask(metadata: ActiveTaskMetadata): Promise<void> {
    await this.ensureDirs();

    // Write metadata file
    const metaPath = path.join(this.metadataDir, `${metadata.task_id}.json`);
    await fsp.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // Update active pointer
    const pointer: ActiveTaskPointer = {
      active_task_id: metadata.task_id,
      updated_at: new Date().toISOString(),
    };
    await fsp.writeFile(this.activePath, JSON.stringify(pointer, null, 2), 'utf-8');
  }

  /**
   * Read active.json → load metadata/{task_id}.json
   */
  async getActiveTask(): Promise<ActiveTaskMetadata | null> {
    try {
      const raw = await fsp.readFile(this.activePath, 'utf-8');
      const pointer: ActiveTaskPointer = JSON.parse(raw);
      if (!pointer.active_task_id) return null;

      const metaPath = path.join(this.metadataDir, `${pointer.active_task_id}.json`);
      const metaRaw = await fsp.readFile(metaPath, 'utf-8');
      return JSON.parse(metaRaw) as ActiveTaskMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Update metadata file: cleanly_exited=true, status='paused'.
   */
  async markCleanExit(taskId: string): Promise<void> {
    try {
      const metaPath = path.join(this.metadataDir, `${taskId}.json`);
      const raw = await fsp.readFile(metaPath, 'utf-8');
      const metadata: ActiveTaskMetadata = JSON.parse(raw);
      metadata.cleanly_exited = true;
      metadata.status = 'paused';
      metadata.last_updated_at = new Date().toISOString();
      await fsp.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
    } catch {
      // File doesn't exist — nothing to mark
    }
  }

  /**
   * Synchronous version for deactivate(). ONE write, no scanning.
   * INTENTIONALLY sync — VS Code deactivate() has a tight time budget.
   */
  markCleanExitSync(taskId: string): void {
    try {
      const metaPath = path.join(this.metadataDir, `${taskId}.json`);
      const raw = fs.readFileSync(metaPath, 'utf-8');
      const metadata: ActiveTaskMetadata = JSON.parse(raw);
      metadata.cleanly_exited = true;
      metadata.status = 'paused';
      metadata.last_updated_at = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
    } catch {
      // File doesn't exist — nothing to mark
    }
  }

  /**
   * Delete active.json + metadata file.
   */
  async clearActiveTask(): Promise<void> {
    try {
      // Read pointer to get task ID
      const raw = await fsp.readFile(this.activePath, 'utf-8');
      const pointer: ActiveTaskPointer = JSON.parse(raw);

      // Delete metadata file
      if (pointer.active_task_id) {
        const metaPath = path.join(this.metadataDir, `${pointer.active_task_id}.json`);
        try { await fsp.unlink(metaPath); } catch { /* already gone */ }
      }

      // Delete pointer
      await fsp.unlink(this.activePath);
    } catch {
      // Already cleared or doesn't exist
    }
  }
}
