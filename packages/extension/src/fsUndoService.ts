/**
 * Step 48: FsUndoService — File System operations for undo.
 *
 * Handles reading file content (with size limit), writing reverted content,
 * deleting created files, and ensuring directories exist.
 *
 * All paths resolved against workspaceRoot with traversal check.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileReadResult } from 'core';

const MAX_UNDO_FILE_SIZE = 1_048_576; // 1MB

export class FsUndoService {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Read file content for undo capture.
   * Returns { content: null, skipped: false } on ENOENT (file doesn't exist).
   * Returns { content: null, skipped: true } when file > 1MB.
   */
  async readFileContent(filePath: string): Promise<FileReadResult> {
    const fullPath = this.resolve(filePath);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.size > MAX_UNDO_FILE_SIZE) {
        return { content: null, skipped: true };
      }
      const content = await fs.readFile(fullPath, 'utf-8');
      return { content, skipped: false };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { content: null, skipped: false };
      }
      throw err;
    }
  }

  /** Write content to a file (overwrite). */
  async writeFileContent(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolve(filePath);
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  /** Delete a file. */
  async deleteFile(filePath: string): Promise<void> {
    const fullPath = this.resolve(filePath);
    try {
      await fs.unlink(fullPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  /** Ensure the parent directory of a file exists. */
  async ensureDirectory(filePath: string): Promise<void> {
    const fullPath = this.resolve(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
  }

  /** Resolve a file path against workspaceRoot with traversal check. */
  private resolve(filePath: string): string {
    const fullPath = path.resolve(this.workspaceRoot, filePath);
    if (!fullPath.startsWith(this.workspaceRoot)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
    return fullPath;
  }
}
