/**
 * VS Code CheckpointManager Implementation
 * 
 * Stores file backups in .ordinex/checkpoints/ directory
 * Supports rollback to restore original state
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

// Inline types from core/workspaceAdapter
interface FilePatch {
  path: string;
  action: 'create' | 'update' | 'delete';
  newContent?: string;
  baseSha?: string | null;
}

interface CheckpointFile {
  path: string;
  beforeSha: string;
  backupPath: string;
  existedBefore: boolean;
  originalContent?: string;
}

interface CheckpointResult {
  checkpointId: string;
  files: CheckpointFile[];
  createdAt: string;
}

interface RollbackResult {
  checkpointId: string;
  filesRestored: Array<{
    path: string;
    action: 'restored' | 'deleted';
  }>;
  rolledBackAt: string;
}

interface CheckpointManager {
  createCheckpoint(patches: FilePatch[]): Promise<CheckpointResult>;
  rollback(checkpointId: string): Promise<RollbackResult>;
  getCheckpoint(checkpointId: string): Promise<CheckpointResult | undefined>;
  listCheckpoints(): Promise<CheckpointResult[]>;
}

export class VSCodeCheckpointManager implements CheckpointManager {
  private readonly checkpointsDir: string;

  constructor(private readonly workspaceRoot: string) {
    this.checkpointsDir = path.join(workspaceRoot, '.ordinex', 'checkpoints');
  }

  /**
   * Create checkpoint for given patches
   * Backs up current state of all affected files
   */
  async createCheckpoint(patches: FilePatch[]): Promise<CheckpointResult> {
    const checkpointId = `checkpoint_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const checkpointDir = path.join(this.checkpointsDir, checkpointId);
    
    // Ensure checkpoint directory exists
    await fs.mkdir(checkpointDir, { recursive: true });

    const files: CheckpointFile[] = [];

    for (const patch of patches) {
      const filePath = path.join(this.workspaceRoot, patch.path);
      let existedBefore = false;
      let originalContent: string | undefined;
      let beforeSha = '';

      // Check if file exists
      try {
        originalContent = await fs.readFile(filePath, 'utf-8');
        existedBefore = true;
        beforeSha = this.computeSha(originalContent);

        // Save backup
        const backupPath = path.join(checkpointDir, patch.path);
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        await fs.writeFile(backupPath, originalContent, 'utf-8');
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          existedBefore = false;
          beforeSha = 'null';
        } else {
          throw error;
        }
      }

      files.push({
        path: patch.path,
        beforeSha,
        backupPath: existedBefore ? path.join(checkpointId, patch.path) : '',
        existedBefore,
        originalContent,
      });
    }

    const result: CheckpointResult = {
      checkpointId,
      files,
      createdAt: new Date().toISOString(),
    };

    // Save manifest
    const manifestPath = path.join(checkpointDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(result, null, 2), 'utf-8');

    return result;
  }

  /**
   * Rollback checkpoint - restore original state
   */
  async rollback(checkpointId: string): Promise<RollbackResult> {
    const checkpoint = await this.getCheckpoint(checkpointId);
    
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const filesRestored: Array<{ path: string; action: 'restored' | 'deleted' }> = [];

    for (const file of checkpoint.files) {
      const filePath = path.join(this.workspaceRoot, file.path);

      if (file.existedBefore && file.originalContent) {
        // Restore original content
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.originalContent, 'utf-8');
        filesRestored.push({ path: file.path, action: 'restored' });
      } else {
        // File didn't exist before - delete it
        try {
          await fs.unlink(filePath);
          filesRestored.push({ path: file.path, action: 'deleted' });
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
          // Already deleted - ok
        }
      }
    }

    return {
      checkpointId,
      filesRestored,
      rolledBackAt: new Date().toISOString(),
    };
  }

  /**
   * Get checkpoint information
   */
  async getCheckpoint(checkpointId: string): Promise<CheckpointResult | undefined> {
    const manifestPath = path.join(this.checkpointsDir, checkpointId, 'manifest.json');
    
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * List all checkpoints
   */
  async listCheckpoints(): Promise<CheckpointResult[]> {
    try {
      const entries = await fs.readdir(this.checkpointsDir, { withFileTypes: true });
      const checkpoints: CheckpointResult[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const checkpoint = await this.getCheckpoint(entry.name);
          if (checkpoint) {
            checkpoints.push(checkpoint);
          }
        }
      }

      return checkpoints;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Compute SHA-256 hash (first 12 chars)
   */
  private computeSha(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 12);
  }
}
