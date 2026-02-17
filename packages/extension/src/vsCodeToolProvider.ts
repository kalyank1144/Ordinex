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

/** Max file size we'll read (1 MB) */
const MAX_READ_SIZE = 1_048_576;
/** Max output from a command (64 KB) */
const MAX_COMMAND_OUTPUT = 65_536;
/** Default command timeout (30 s) */
const DEFAULT_TIMEOUT_MS = 30_000;

export class VSCodeToolProvider implements ToolExecutionProvider {
  private readonly workspaceRoot: string;
  private readonly readOnly: boolean;

  constructor(workspaceRoot: string, options?: { readOnly?: boolean }) {
    this.workspaceRoot = workspaceRoot;
    this.readOnly = options?.readOnly ?? false;
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
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_READ_SIZE) {
        return {
          success: false,
          output: '',
          error: `File too large (${stat.size} bytes, max ${MAX_READ_SIZE})`,
        };
      }
      let content = fs.readFileSync(filePath, 'utf-8');
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
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      // Open the file in the editor so the user can see the changes
      this.openFileInEditor(filePath);
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

      if (!fs.existsSync(filePath)) {
        return { success: false, output: '', error: `File not found: ${input.path}` };
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes(oldText)) {
        return {
          success: false,
          output: '',
          error: `old_text not found in file. Make sure it matches exactly (including whitespace).`,
        };
      }

      // Replace first occurrence only
      const updated = content.replace(oldText, newText);
      fs.writeFileSync(filePath, updated, 'utf-8');
      // Open the file in the editor so the user can see the changes
      this.openFileInEditor(filePath);
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
  // Helper: open a file in the VS Code editor tab after write/edit
  // ---------------------------------------------------------------------------

  private openFileInEditor(filePath: string): void {
    try {
      const uri = vscode.Uri.file(filePath);
      vscode.workspace.openTextDocument(uri).then(doc => {
        vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: true,
          preview: false,
        });
      }, err => {
        console.warn('[ToolProvider] Could not open file in editor:', err);
      });
    } catch (err) {
      console.warn('[ToolProvider] openFileInEditor error:', err);
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

      // Use grep-like search (cross-platform via Node)
      const matches: string[] = [];
      const maxResults = 50;

      this.walkDir(this.workspaceRoot, (filePath) => {
        if (matches.length >= maxResults) return;
        if (glob && !this.matchGlob(filePath, glob)) return;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
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
      });

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
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return { success: false, output: '', error: `Not a directory: ${input.path}` };
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
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

  /** Walk a directory tree, skipping node_modules/.git/etc. */
  private walkDir(dir: string, callback: (filePath: string) => void): void {
    const SKIP_DIRS = new Set([
      'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
      'coverage', '.cache', '__pycache__', '.venv', 'vendor',
    ]);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) {
            this.walkDir(fullPath, callback);
          }
        } else if (entry.isFile()) {
          callback(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
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
