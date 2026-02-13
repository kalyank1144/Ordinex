/**
 * StagedToolProvider — Wraps a real ToolExecutionProvider to intercept
 * write operations into a StagedEditBuffer instead of writing to disk.
 *
 * Read-after-write overlay: read_file checks the staged buffer first,
 * falling back to the real provider if the file isn't staged.
 *
 * Pass-through: run_command, search_files, list_directory go straight
 * to the real provider. (V1 limitation: these see disk state, not staged.)
 *
 * Pure core class (P1 compliant — no FS, delegates to injected provider).
 */

import type { ToolExecutionProvider, ToolExecutionResult } from './agenticLoop';
import { StagedEditBuffer } from './stagedEditBuffer';

// ---------------------------------------------------------------------------
// StagedToolProvider
// ---------------------------------------------------------------------------

export class StagedToolProvider implements ToolExecutionProvider {
  private readonly delegate: ToolExecutionProvider;
  private readonly buffer: StagedEditBuffer;

  constructor(delegate: ToolExecutionProvider, buffer: StagedEditBuffer) {
    this.delegate = delegate;
    this.buffer = buffer;
  }

  /** Get the underlying staged buffer (for inspection/serialization) */
  getBuffer(): StagedEditBuffer {
    return this.buffer;
  }

  /**
   * Execute a tool, intercepting write operations to the staged buffer.
   */
  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    switch (name) {
      case 'write_file':
        return this.handleWriteFile(input);

      case 'edit_file':
        return this.handleEditFile(input);

      case 'read_file':
        return this.handleReadFile(input);

      case 'run_command':
      case 'search_files':
      case 'list_directory':
        // Pass through to real provider
        return this.delegate.executeTool(name, input);

      default:
        return this.delegate.executeTool(name, input);
    }
  }

  // -----------------------------------------------------------------------
  // Tool handlers
  // -----------------------------------------------------------------------

  /**
   * write_file → stage to buffer instead of disk.
   */
  private async handleWriteFile(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const filePath = input.path as string;
    const content = input.content as string;

    if (!filePath) {
      return { success: false, output: '', error: 'Missing required parameter: path' };
    }
    if (content === undefined || content === null) {
      return { success: false, output: '', error: 'Missing required parameter: content' };
    }

    // Check if the file exists on disk (for isNew determination)
    // We can't read FS directly (P1), so we check if the delegate can read it
    const isNew = !this.buffer.has(filePath) && !(await this.fileExistsOnDisk(filePath));

    this.buffer.write(filePath, content, isNew);

    const lines = content.split('\n').length;
    return {
      success: true,
      output: `File ${isNew ? 'created' : 'written'}: ${filePath} (${lines} lines) [staged]`,
    };
  }

  /**
   * edit_file → apply find-and-replace on staged content (or real content as base).
   */
  private async handleEditFile(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const filePath = input.path as string;
    const oldText = input.old_text as string;
    const newText = input.new_text as string;

    if (!filePath) {
      return { success: false, output: '', error: 'Missing required parameter: path' };
    }
    if (oldText === undefined || oldText === null) {
      return { success: false, output: '', error: 'Missing required parameter: old_text' };
    }
    if (newText === undefined || newText === null) {
      return { success: false, output: '', error: 'Missing required parameter: new_text' };
    }

    // If the file isn't staged yet, we need its current content from disk
    let currentContent: string | undefined;
    if (!this.buffer.has(filePath)) {
      try {
        const readResult = await this.delegate.executeTool('read_file', { path: filePath });
        if (readResult.success) {
          currentContent = readResult.output;
        } else {
          return {
            success: false,
            output: '',
            error: `Cannot read file for edit: ${readResult.error || 'File not found'}`,
          };
        }
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `Cannot read file for edit: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const result = this.buffer.edit(filePath, oldText, newText, currentContent);

    if (!result.success) {
      return { success: false, output: '', error: result.error };
    }

    return {
      success: true,
      output: `Edit applied to ${filePath} [staged]`,
    };
  }

  /**
   * read_file → check staged buffer first, then delegate to real provider.
   * This is the read-after-write overlay that ensures the LLM sees its own staged edits.
   */
  private async handleReadFile(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const filePath = input.path as string;

    if (!filePath) {
      return { success: false, output: '', error: 'Missing required parameter: path' };
    }

    // Check staged buffer first
    if (this.buffer.has(filePath)) {
      if (this.buffer.isDeleted(filePath)) {
        return {
          success: false,
          output: '',
          error: `File ${filePath} has been deleted`,
        };
      }

      const content = this.buffer.read(filePath);
      if (content !== null) {
        // Apply offset/max_lines if provided
        return {
          success: true,
          output: this.applyReadOptions(content, input),
        };
      }
    }

    // Not staged — delegate to real provider
    return this.delegate.executeTool('read_file', input);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Check if a file exists on disk by attempting to read it via the delegate */
  private async fileExistsOnDisk(filePath: string): Promise<boolean> {
    try {
      const result = await this.delegate.executeTool('read_file', { path: filePath, max_lines: 1 });
      return result.success;
    } catch {
      return false;
    }
  }

  /** Apply offset/max_lines options to content (matching read_file semantics) */
  private applyReadOptions(content: string, input: Record<string, unknown>): string {
    const lines = content.split('\n');
    const offset = typeof input.offset === 'number' ? input.offset : 0;
    const maxLines = typeof input.max_lines === 'number' ? input.max_lines : undefined;

    const sliced = maxLines !== undefined
      ? lines.slice(offset, offset + maxLines)
      : lines.slice(offset);

    return sliced.join('\n');
  }
}
