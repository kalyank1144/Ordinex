/**
 * VSCodeToolProvider — ToolExecutionProvider for VS Code workspace (A3 wiring)
 *
 * Implements the 6 Anthropic tool schemas (read_file, write_file, edit_file,
 * run_command, search_files, list_directory) against the real workspace.
 *
 * Used by AgenticLoop to execute tools requested by the LLM.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import type { ToolExecutionProvider, ToolExecutionResult } from 'core';
import { fileExists } from './utils/fsAsync';

/** Max file size we'll read (1 MB) */
const MAX_READ_SIZE = 1_048_576;
/** Max output from a command (64 KB) */
const MAX_COMMAND_OUTPUT = 65_536;
/** Default command timeout (30 s) */
const DEFAULT_TIMEOUT_MS = 30_000;

export class VSCodeToolProvider implements ToolExecutionProvider {
  private readonly workspaceRoot: string;
  private readonly readOnly: boolean;
  private _webview: vscode.Webview | null = null;

  constructor(workspaceRoot: string, options?: { readOnly?: boolean }) {
    this.workspaceRoot = workspaceRoot;
    this.readOnly = options?.readOnly ?? false;
  }

  /** Set the webview reference so we can post messages for events */
  setWebview(webview: vscode.Webview): void {
    this._webview = webview;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    switch (name) {
      case 'read_file':
        return this.readFile(input);
      case 'write_file':
        return this.writeFile(input);
      case 'edit_file':
        return this.editFile(input);
      case 'run_command':
        return this.runCommand(input);
      case 'search_files':
        return this.searchFiles(input);
      case 'list_directory':
        return this.listDirectory(input);
      default:
        return { success: false, output: '', error: `Unknown tool: ${name}` };
    }
  }

  // ---------------------------------------------------------------------------
  // read_file
  // ---------------------------------------------------------------------------

  private async readFile(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    try {
      const filePath = this.resolvePath(String(input.path || ''));
      const stat = await fs.promises.stat(filePath);
      if (stat.size > MAX_READ_SIZE) {
        return {
          success: false,
          output: '',
          error: `File too large (${stat.size} bytes, max ${MAX_READ_SIZE})`,
        };
      }
      let content = await fs.promises.readFile(filePath, 'utf-8');
      const offset = typeof input.offset === 'number' ? Math.max(0, Math.floor(input.offset)) : 0;
      const maxLines = typeof input.max_lines === 'number' ? Math.max(0, Math.floor(input.max_lines)) : 0;
      if (offset > 0 || maxLines > 0) {
        const lines = content.split('\n');
        const start = Math.min(offset, lines.length);
        const sliced = maxLines > 0 ? lines.slice(start, start + maxLines) : lines.slice(start);
        content = sliced.join('\n');
      }
      return { success: true, output: content };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // write_file
  // ---------------------------------------------------------------------------

  private async writeFile(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    if (this.readOnly) {
      return { success: false, output: '', error: 'Write operations disabled in read-only mode' };
    }
    try {
      const filePath = this.resolvePath(String(input.path || ''));
      const content = String(input.content || '');
      const dir = path.dirname(filePath);
      const isNew = !(await fileExists(filePath));
      const originalContent = isNew ? '' : await fs.promises.readFile(filePath, 'utf-8');

      if (!(await fileExists(dir))) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      await fs.promises.writeFile(filePath, content, 'utf-8');

      // Open the file in the editor and show diff
      await this.showFileChangeInEditor(filePath, originalContent, content, isNew ? 'created' : 'written');

      return { success: true, output: `Written ${content.length} bytes to ${input.path}` };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // edit_file
  // ---------------------------------------------------------------------------

  private async editFile(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    if (this.readOnly) {
      return { success: false, output: '', error: 'Edit operations disabled in read-only mode' };
    }
    try {
      const filePath = this.resolvePath(String(input.path || ''));
      const oldText = String(input.old_text || '');
      const newText = String(input.new_text || '');

      if (!(await fileExists(filePath))) {
        return { success: false, output: '', error: `File not found: ${input.path}` };
      }

      const originalContent = await fs.promises.readFile(filePath, 'utf-8');
      if (!originalContent.includes(oldText)) {
        return {
          success: false,
          output: '',
          error: `old_text not found in file. Make sure it matches exactly (including whitespace).`,
        };
      }

      const updated = originalContent.replace(oldText, newText);
      await fs.promises.writeFile(filePath, updated, 'utf-8');

      // Open the file in the editor and show diff
      await this.showFileChangeInEditor(filePath, originalContent, updated, 'edited');

      return { success: true, output: `Edited ${input.path}` };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: show file change in the VS Code editor with diff view
  // ---------------------------------------------------------------------------

  private async showFileChangeInEditor(
    filePath: string,
    _originalContent: string,
    _newContent: string,
    action: string,
  ): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      // Open the modified file in the editor
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: true,
        preview: false,
      });
      console.log(`[ToolProvider] File ${action}: ${filePath}`);
    } catch (err) {
      console.warn('[ToolProvider] Could not open file in editor:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // run_command
  // ---------------------------------------------------------------------------

  private async runCommand(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    if (this.readOnly) {
      return { success: false, output: '', error: 'Command execution disabled in read-only mode' };
    }
    try {
      const command = String(input.command || '');
      const timeoutMs = typeof input.timeout_ms === 'number'
        ? Math.min(input.timeout_ms, 60_000)
        : DEFAULT_TIMEOUT_MS;
      const cwd = input.cwd ? this.resolvePath(String(input.cwd)) : this.workspaceRoot;

      return new Promise((resolve) => {
        childProcess.exec(
          command,
          {
            cwd,
            timeout: timeoutMs,
            maxBuffer: MAX_COMMAND_OUTPUT,
            env: { ...process.env, FORCE_COLOR: '0' },
          },
          (error, stdout, stderr) => {
            const output = (stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '')).substring(
              0,
              MAX_COMMAND_OUTPUT,
            );
            if (error) {
              resolve({
                success: false,
                output,
                error: error.message,
              });
            } else {
              resolve({ success: true, output });
            }
          },
        );
      });
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // search_files
  // ---------------------------------------------------------------------------

  private async searchFiles(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    try {
      const pattern = String(input.query || '');
      const glob = input.glob ? String(input.glob) : undefined;

      const matches: string[] = [];
      const maxResults = 50;
      const allFiles = await this.walkDir(this.workspaceRoot);

      for (const filePath of allFiles) {
        if (matches.length >= maxResults) break;
        if (glob && !this.matchGlob(filePath, glob)) continue;

        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break;
            if (lines[i].includes(pattern)) {
              const relPath = path.relative(this.workspaceRoot, filePath);
              matches.push(`${relPath}:${i + 1}: ${lines[i].substring(0, 200)}`);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (matches.length === 0) {
        return { success: true, output: `No matches found for "${pattern}"` };
      }
      return {
        success: true,
        output: matches.join('\n'),
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // list_directory
  // ---------------------------------------------------------------------------

  private async listDirectory(
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    try {
      const dirPath = this.resolvePath(String(input.path || '.'));
      let dirStat: fs.Stats;
      try {
        dirStat = await fs.promises.stat(dirPath);
      } catch {
        return { success: false, output: '', error: `Not a directory: ${input.path}` };
      }
      if (!dirStat.isDirectory()) {
        return { success: false, output: '', error: `Not a directory: ${input.path}` };
      }

      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const lines = entries.map((e) => {
        const suffix = e.isDirectory() ? '/' : '';
        return `${e.name}${suffix}`;
      });
      return { success: true, output: lines.join('\n') };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Resolve a workspace-relative path, with path traversal protection */
  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.workspaceRoot, relativePath);
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error(`Path traversal blocked: ${relativePath}`);
    }
    return resolved;
  }

  private static readonly SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
    'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  ]);

  /** Walk a directory tree concurrently, skipping node_modules/.git/etc. */
  private async walkDir(dir: string, results: string[] = []): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      await Promise.all(entries.map(async (entry) => {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') return;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!VSCodeToolProvider.SKIP_DIRS.has(entry.name)) {
            await this.walkDir(fullPath, results);
          }
        } else if (entry.isFile()) {
          results.push(fullPath);
        }
      }));
    } catch {
      // Skip directories we can't read
    }
    return results;
  }

  /** Simple glob matching (supports * and **) */
  private matchGlob(filePath: string, glob: string): boolean {
    const relPath = path.relative(this.workspaceRoot, filePath);
    const ext = path.extname(relPath);
    // Simple extension-based matching for common patterns like *.ts, *.js
    if (glob.startsWith('*.')) {
      return ext === glob.substring(1);
    }
    return relPath.includes(glob.replace(/\*/g, ''));
  }
}
