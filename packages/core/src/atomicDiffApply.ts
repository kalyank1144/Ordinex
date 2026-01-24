/**
 * Atomic Diff Apply for MISSION EDIT
 * Based on spec Section 8: CHECKPOINT + ATOMIC APPLY + ROLLBACK
 * 
 * Handles:
 * - Stale check immediately before apply
 * - Write to temp files first, then atomic rename
 * - Rollback on any failure
 * - VS Code WorkspaceEdit integration (when available)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ParsedFileDiff, applyDiffToContent } from './unifiedDiffParser';
import { computeBaseSha, checkBatchStaleness } from './shaUtils';

/**
 * Result of atomic diff application
 */
export interface AtomicApplyResult {
  success: boolean;
  applied_files: Array<{
    path: string;
    before_sha: string;
    after_sha: string;
    additions: number;
    deletions: number;
  }>;
  failed_files: Array<{
    path: string;
    error: string;
  }>;
  rollback_performed: boolean;
  error?: {
    type: 'stale_context' | 'hunk_mismatch' | 'apply_failed' | 'io_error';
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Checkpoint info for rollback
 */
export interface CheckpointInfo {
  checkpoint_id: string;
  files: Array<{
    path: string;
    backup_path: string;
    before_sha: string;
  }>;
}

/**
 * Prepared file change (in memory, not yet written)
 */
interface PreparedChange {
  filePath: string;
  absolutePath: string;
  tempPath: string;
  originalContent: string;
  newContent: string;
  before_sha: string;
  after_sha: string;
  additions: number;
  deletions: number;
}

/**
 * Atomic diff applier with checkpoint and rollback support
 */
export class AtomicDiffApplier {
  private readonly workspaceRoot: string;
  private readonly checkpointDir: string;

  constructor(workspaceRoot: string, checkpointDir: string = '.ordinex/checkpoints') {
    this.workspaceRoot = workspaceRoot;
    this.checkpointDir = path.join(workspaceRoot, checkpointDir);
  }

  /**
   * Check if files are stale (content changed since diff was proposed)
   * Returns stale files or empty array if all fresh
   */
  async checkStaleness(
    expectedShas: Map<string, string>
  ): Promise<Array<{ path: string; expected_sha: string; actual_sha: string }>> {
    const currentContents = new Map<string, string>();

    for (const [filePath] of expectedShas) {
      const absolutePath = path.join(this.workspaceRoot, filePath);
      try {
        const content = await fs.readFile(absolutePath, 'utf-8');
        currentContents.set(filePath, content);
      } catch (error) {
        // File doesn't exist - this is a stale case
        currentContents.set(filePath, '');
      }
    }

    return checkBatchStaleness(currentContents, expectedShas);
  }

  /**
   * Create checkpoint before applying diff
   * Returns checkpoint info for potential rollback
   */
  async createCheckpoint(
    checkpointId: string,
    filePaths: string[]
  ): Promise<CheckpointInfo> {
    const checkpointPath = path.join(this.checkpointDir, checkpointId);
    await fs.mkdir(checkpointPath, { recursive: true });

    const files: CheckpointInfo['files'] = [];

    for (const filePath of filePaths) {
      const absolutePath = path.join(this.workspaceRoot, filePath);
      const backupPath = path.join(checkpointPath, filePath);

      try {
        // Ensure backup directory exists
        await fs.mkdir(path.dirname(backupPath), { recursive: true });

        // Read and backup file
        const content = await fs.readFile(absolutePath, 'utf-8');
        await fs.writeFile(backupPath, content, 'utf-8');

        files.push({
          path: filePath,
          backup_path: backupPath,
          before_sha: computeBaseSha(content),
        });
      } catch (error) {
        console.warn(`[AtomicDiffApplier] Could not backup ${filePath}:`, error);
      }
    }

    // Write checkpoint manifest
    const manifestPath = path.join(checkpointPath, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({
      checkpoint_id: checkpointId,
      created_at: new Date().toISOString(),
      files,
    }, null, 2), 'utf-8');

    return { checkpoint_id: checkpointId, files };
  }

  /**
   * Apply diff atomically
   * Strategy: Write to temp files first, then atomic rename
   */
  async applyDiffAtomically(
    parsedDiff: { files: ParsedFileDiff[] },
    expectedShas: Map<string, string>,
    checkpoint: CheckpointInfo
  ): Promise<AtomicApplyResult> {
    // 8b) STALE CHECK (immediately before apply)
    const staleFiles = await this.checkStaleness(expectedShas);
    
    if (staleFiles.length > 0) {
      const firstStale = staleFiles[0];
      return {
        success: false,
        applied_files: [],
        failed_files: [],
        rollback_performed: false,
        error: {
          type: 'stale_context',
          message: `File ${firstStale.path} has changed since diff was proposed`,
          details: {
            file: firstStale.path,
            expected_sha: firstStale.expected_sha,
            actual_sha: firstStale.actual_sha,
          },
        },
      };
    }

    // 8c) ATOMIC APPLY ALGORITHM
    const preparedChanges: PreparedChange[] = [];
    const tempFiles: string[] = [];

    try {
      // Step 1 - Prepare all changes (in memory)
      for (const fileDiff of parsedDiff.files) {
        const filePath = fileDiff.newPath !== '/dev/null' ? fileDiff.newPath : fileDiff.oldPath;
        const absolutePath = path.join(this.workspaceRoot, filePath);
        const tempPath = `${absolutePath}.ordinex_temp`;

        // Read current content
        let originalContent: string;
        try {
          originalContent = await fs.readFile(absolutePath, 'utf-8');
        } catch (error) {
          return {
            success: false,
            applied_files: [],
            failed_files: [{ path: filePath, error: 'File not found' }],
            rollback_performed: false,
            error: {
              type: 'io_error',
              message: `Could not read file ${filePath}`,
              details: { file: filePath },
            },
          };
        }

        // Apply hunks to produce new content
        let newContent: string;
        try {
          newContent = applyDiffToContent(originalContent, fileDiff);
        } catch (error) {
          return {
            success: false,
            applied_files: [],
            failed_files: [{ path: filePath, error: error instanceof Error ? error.message : String(error) }],
            rollback_performed: false,
            error: {
              type: 'hunk_mismatch',
              message: `Failed to apply hunks to ${filePath}`,
              details: {
                file: filePath,
                error: error instanceof Error ? error.message : String(error),
              },
            },
          };
        }

        preparedChanges.push({
          filePath,
          absolutePath,
          tempPath,
          originalContent,
          newContent,
          before_sha: computeBaseSha(originalContent),
          after_sha: computeBaseSha(newContent),
          additions: fileDiff.additions,
          deletions: fileDiff.deletions,
        });
      }

      // Step 1b - Write to temp files
      for (const change of preparedChanges) {
        try {
          await fs.writeFile(change.tempPath, change.newContent, 'utf-8');
          tempFiles.push(change.tempPath);
        } catch (error) {
          // Cleanup temp files and fail
          await this.cleanupTempFiles(tempFiles);
          return {
            success: false,
            applied_files: [],
            failed_files: [{ path: change.filePath, error: 'Failed to write temp file' }],
            rollback_performed: false,
            error: {
              type: 'io_error',
              message: `Failed to write temp file for ${change.filePath}`,
              details: { file: change.filePath },
            },
          };
        }
      }

      // Step 2 - Atomic commit (rename temp -> original)
      const appliedFiles: AtomicApplyResult['applied_files'] = [];
      const failedFiles: AtomicApplyResult['failed_files'] = [];

      for (const change of preparedChanges) {
        try {
          await fs.rename(change.tempPath, change.absolutePath);
          appliedFiles.push({
            path: change.filePath,
            before_sha: change.before_sha,
            after_sha: change.after_sha,
            additions: change.additions,
            deletions: change.deletions,
          });
        } catch (error) {
          failedFiles.push({
            path: change.filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // If any rename failed, rollback ALL files
      if (failedFiles.length > 0) {
        await this.rollbackFromCheckpoint(checkpoint);
        await this.cleanupTempFiles(tempFiles);

        return {
          success: false,
          applied_files: [],
          failed_files: failedFiles,
          rollback_performed: true,
          error: {
            type: 'apply_failed',
            message: `Failed to apply ${failedFiles.length} file(s), rolled back all changes`,
            details: { failed_files: failedFiles },
          },
        };
      }

      // Step 3 - Cleanup temp files (on success)
      await this.cleanupTempFiles(tempFiles);

      return {
        success: true,
        applied_files: appliedFiles,
        failed_files: [],
        rollback_performed: false,
      };

    } catch (error) {
      // Unexpected error - rollback and cleanup
      await this.cleanupTempFiles(tempFiles);
      await this.rollbackFromCheckpoint(checkpoint);

      return {
        success: false,
        applied_files: [],
        failed_files: [],
        rollback_performed: true,
        error: {
          type: 'apply_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Rollback files from checkpoint
   */
  async rollbackFromCheckpoint(checkpoint: CheckpointInfo): Promise<boolean> {
    let allRestored = true;

    for (const file of checkpoint.files) {
      const targetPath = path.join(this.workspaceRoot, file.path);

      try {
        const backupContent = await fs.readFile(file.backup_path, 'utf-8');
        await fs.writeFile(targetPath, backupContent, 'utf-8');
      } catch (error) {
        console.error(`[AtomicDiffApplier] Failed to restore ${file.path}:`, error);
        allRestored = false;
      }
    }

    return allRestored;
  }

  /**
   * Cleanup temp files
   */
  private async cleanupTempFiles(tempFiles: string[]): Promise<void> {
    for (const tempFile of tempFiles) {
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Simple apply without atomic transaction (for simpler cases)
   * Used when VS Code WorkspaceEdit is preferred
   */
  async applySimple(
    changes: Array<{
      path: string;
      newContent: string;
    }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      for (const change of changes) {
        const absolutePath = path.join(this.workspaceRoot, change.path);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, change.newContent, 'utf-8');
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Create diff_id in canonical format
 */
export function createDiffId(taskId: string, stepId: string): string {
  const timestamp = Date.now();
  return `diff_${taskId.slice(0, 8)}_${stepId.slice(0, 8)}_${timestamp}`;
}

/**
 * Create checkpoint_id in canonical format
 */
export function createCheckpointId(taskId: string, stepId: string): string {
  const timestamp = Date.now();
  return `checkpoint_${taskId.slice(0, 8)}_${stepId.slice(0, 8)}_${timestamp}`;
}
