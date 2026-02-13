/**
 * StagedEditBuffer — In-memory staged file edits (no disk writes).
 *
 * Holds pending file changes produced by the AgenticLoop's tool calls.
 * All writes and edits go to this buffer instead of disk. Reads overlay
 * staged content on top of real FS content (caller provides the fallback).
 *
 * Pure core class (P1 compliant — no FS, no side effects).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single staged file operation */
export interface StagedFile {
  /** Relative path from workspace root */
  path: string;
  /** Full file content after staging */
  content: string;
  /** Whether the file is new (created by the loop, didn't exist before) */
  isNew: boolean;
  /** Whether the file should be deleted */
  isDeleted: boolean;
  /** Number of edits applied to this file during staging */
  editCount: number;
  /** Timestamp of last modification */
  lastModified: string;
}

/** Serializable snapshot of the staged buffer (for Continue persistence) */
export interface StagedBufferSnapshot {
  files: Array<{
    path: string;
    content: string;
    isNew: boolean;
    isDeleted: boolean;
    editCount: number;
  }>;
}

/** Result of an edit operation */
export interface EditResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// StagedEditBuffer
// ---------------------------------------------------------------------------

export class StagedEditBuffer {
  private staged: Map<string, StagedFile> = new Map();

  // -----------------------------------------------------------------------
  // Write operations
  // -----------------------------------------------------------------------

  /**
   * Stage a full file write (create or overwrite).
   * If the file already exists in staging, overwrites it.
   */
  write(filePath: string, content: string, isNew: boolean = false): void {
    const existing = this.staged.get(filePath);
    this.staged.set(filePath, {
      path: filePath,
      content,
      isNew: existing ? existing.isNew : isNew,
      isDeleted: false,
      editCount: existing ? existing.editCount + 1 : 1,
      lastModified: new Date().toISOString(),
    });
  }

  /**
   * Stage a targeted edit (find & replace) on a file.
   * If the file is already staged, edits the staged content.
   * If not, the caller must provide the current disk content via `currentContent`.
   *
   * @returns EditResult indicating success or failure with reason
   */
  edit(
    filePath: string,
    oldText: string,
    newText: string,
    currentContent?: string,
  ): EditResult {
    let content: string;
    let isNew = false;

    if (this.staged.has(filePath)) {
      content = this.staged.get(filePath)!.content;
      isNew = this.staged.get(filePath)!.isNew;
    } else if (currentContent !== undefined) {
      content = currentContent;
    } else {
      return {
        success: false,
        error: `File ${filePath} not found in staged buffer and no current content provided`,
      };
    }

    // Find and replace
    const index = content.indexOf(oldText);
    if (index === -1) {
      return {
        success: false,
        error: `old_text not found in ${filePath}. The text to find must be an exact match.`,
      };
    }

    // Check for multiple occurrences (ambiguous edit)
    const secondIndex = content.indexOf(oldText, index + 1);
    if (secondIndex !== -1) {
      return {
        success: false,
        error: `old_text appears multiple times in ${filePath}. Provide more context to make the match unique.`,
      };
    }

    const newContent = content.substring(0, index) + newText + content.substring(index + oldText.length);

    const existing = this.staged.get(filePath);
    this.staged.set(filePath, {
      path: filePath,
      content: newContent,
      isNew,
      isDeleted: false,
      editCount: (existing?.editCount ?? 0) + 1,
      lastModified: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Stage a file deletion.
   */
  delete(filePath: string): void {
    this.staged.set(filePath, {
      path: filePath,
      content: '',
      isNew: false,
      isDeleted: true,
      editCount: 0,
      lastModified: new Date().toISOString(),
    });
  }

  // -----------------------------------------------------------------------
  // Read operations
  // -----------------------------------------------------------------------

  /**
   * Get staged content for a file.
   * Returns the staged content string, or null if the file is not staged or was deleted.
   */
  read(filePath: string): string | null {
    const staged = this.staged.get(filePath);
    if (!staged) return null;
    if (staged.isDeleted) return null; // Deleted files return null
    return staged.content;
  }

  /** Check if a file has been staged (written, edited, or deleted) */
  has(filePath: string): boolean {
    return this.staged.has(filePath);
  }

  /** Check if a staged file is marked as deleted */
  isDeleted(filePath: string): boolean {
    return this.staged.get(filePath)?.isDeleted ?? false;
  }

  /** Get the StagedFile metadata for a file, or undefined */
  get(filePath: string): StagedFile | undefined {
    return this.staged.get(filePath);
  }

  // -----------------------------------------------------------------------
  // Collection operations
  // -----------------------------------------------------------------------

  /** Get all staged file paths */
  getStagedPaths(): string[] {
    return Array.from(this.staged.keys());
  }

  /** Get all staged files (including deleted markers) */
  getAll(): StagedFile[] {
    return Array.from(this.staged.values());
  }

  /** Get only modified/created files (not deleted) */
  getModifiedFiles(): StagedFile[] {
    return this.getAll().filter(f => !f.isDeleted);
  }

  /** Number of staged files */
  get size(): number {
    return this.staged.size;
  }

  /** Clear all staged content */
  clear(): void {
    this.staged.clear();
  }

  // -----------------------------------------------------------------------
  // Summary (for event payloads)
  // -----------------------------------------------------------------------

  /** Build a summary for event payloads */
  toSummary(): Array<{ path: string; action: 'create' | 'update' | 'delete'; edit_count: number }> {
    return this.getAll().map(f => ({
      path: f.path,
      action: f.isDeleted ? 'delete' : (f.isNew ? 'create' : 'update'),
      edit_count: f.editCount,
    }));
  }

  // -----------------------------------------------------------------------
  // Serialization (for Continue persistence)
  // -----------------------------------------------------------------------

  /** Serialize to a JSON-safe snapshot */
  toSnapshot(): StagedBufferSnapshot {
    return {
      files: this.getAll().map(f => ({
        path: f.path,
        content: f.content,
        isNew: f.isNew,
        isDeleted: f.isDeleted,
        editCount: f.editCount,
      })),
    };
  }

  /** Restore from a previously serialized snapshot */
  static fromSnapshot(snapshot: StagedBufferSnapshot): StagedEditBuffer {
    const buffer = new StagedEditBuffer();
    for (const f of snapshot.files) {
      buffer.staged.set(f.path, {
        path: f.path,
        content: f.content,
        isNew: f.isNew,
        isDeleted: f.isDeleted,
        editCount: f.editCount,
        lastModified: new Date().toISOString(),
      });
    }
    return buffer;
  }
}
