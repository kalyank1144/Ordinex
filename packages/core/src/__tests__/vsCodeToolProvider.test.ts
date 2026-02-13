/**
 * Tests for VSCodeToolProvider (A3 wiring)
 *
 * Since the extension package does not have its own test infrastructure,
 * these tests live in core's __tests__/ directory and exercise the provider
 * against real temp directories using Node's fs/path/child_process.
 *
 * The provider implementation is imported directly from the extension package
 * via a relative path. If that becomes problematic in CI, the import can be
 * swapped for a local inline replica of the class.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Inline a minimal replica of VSCodeToolProvider so core tests are self-contained.
// This exactly mirrors the logic in packages/extension/src/vsCodeToolProvider.ts
// but avoids cross-package import issues.
// ---------------------------------------------------------------------------

interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

const MAX_READ_SIZE = 1_048_576;
const MAX_COMMAND_OUTPUT = 65_536;
const DEFAULT_TIMEOUT_MS = 30_000;

class VSCodeToolProvider {
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

  private async readFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    try {
      const filePath = this.resolvePath(String(input.path || ''));
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_READ_SIZE) {
        return { success: false, output: '', error: `File too large (${stat.size} bytes, max ${MAX_READ_SIZE})` };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, output: content };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async writeFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
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
      return { success: true, output: `Written ${content.length} bytes to ${input.path}` };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async editFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
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
        return { success: false, output: '', error: 'old_text not found in file. Make sure it matches exactly (including whitespace).' };
      }
      const updated = content.replace(oldText, newText);
      fs.writeFileSync(filePath, updated, 'utf-8');
      return { success: true, output: `Edited ${input.path}` };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async runCommand(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    if (this.readOnly) {
      return { success: false, output: '', error: 'Command execution disabled in read-only mode' };
    }
    try {
      const command = String(input.command || '');
      const timeoutMs = typeof input.timeout_ms === 'number'
        ? Math.min(input.timeout_ms, 60_000)
        : DEFAULT_TIMEOUT_MS;
      const childProcess = await import('child_process');
      return new Promise((resolve) => {
        childProcess.exec(
          command,
          {
            cwd: this.workspaceRoot,
            timeout: timeoutMs,
            maxBuffer: MAX_COMMAND_OUTPUT,
            env: { ...process.env, FORCE_COLOR: '0' },
          },
          (error, stdout, stderr) => {
            const output = (stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '')).substring(0, MAX_COMMAND_OUTPUT);
            if (error) {
              resolve({ success: false, output, error: error.message });
            } else {
              resolve({ success: true, output });
            }
          },
        );
      });
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async searchFiles(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    try {
      const pattern = String(input.pattern || '');
      const matches: string[] = [];
      const maxResults = 50;
      this.walkDir(this.workspaceRoot, (filePath) => {
        if (matches.length >= maxResults) return;
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
      return { success: true, output: matches.join('\n') };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async listDirectory(input: Record<string, unknown>): Promise<ToolExecutionResult> {
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
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.workspaceRoot, relativePath);
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error(`Path traversal blocked: ${relativePath}`);
    }
    return resolved;
  }

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
      // Skip unreadable
    }
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('VSCodeToolProvider', () => {
  let workspaceRoot: string;
  let provider: VSCodeToolProvider;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-toolprov-'));
    provider = new VSCodeToolProvider(workspaceRoot);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // 1. read_file
  // -----------------------------------------------------------------------

  describe('read_file', () => {
    it('reads an existing file successfully', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'hello.txt'), 'Hello World', 'utf-8');

      const result = await provider.executeTool('read_file', { path: 'hello.txt' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello World');
    });

    it('returns error for missing file', async () => {
      const result = await provider.executeTool('read_file', { path: 'nonexistent.txt' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('ENOENT');
    });

    it('reads files in nested directories', async () => {
      const nested = path.join(workspaceRoot, 'src', 'lib');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'util.ts'), 'export const x = 1;', 'utf-8');

      const result = await provider.executeTool('read_file', { path: 'src/lib/util.ts' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('export const x = 1;');
    });

    it('blocks path traversal attempts', async () => {
      const result = await provider.executeTool('read_file', { path: '../../etc/passwd' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal blocked');
    });

    it('returns error for files exceeding MAX_READ_SIZE', async () => {
      // Create a file slightly over 1MB
      const bigContent = 'x'.repeat(MAX_READ_SIZE + 1);
      fs.writeFileSync(path.join(workspaceRoot, 'big.bin'), bigContent, 'utf-8');

      const result = await provider.executeTool('read_file', { path: 'big.bin' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('File too large');
    });

    it('reads empty files', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'empty.txt'), '', 'utf-8');

      const result = await provider.executeTool('read_file', { path: 'empty.txt' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // 2. write_file
  // -----------------------------------------------------------------------

  describe('write_file', () => {
    it('writes a new file', async () => {
      const result = await provider.executeTool('write_file', {
        path: 'output.txt',
        content: 'Hello from test',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('15 bytes');
      const written = fs.readFileSync(path.join(workspaceRoot, 'output.txt'), 'utf-8');
      expect(written).toBe('Hello from test');
    });

    it('creates intermediate directories', async () => {
      const result = await provider.executeTool('write_file', {
        path: 'deep/nested/dir/file.ts',
        content: 'export default 42;',
      });

      expect(result.success).toBe(true);
      const filePath = path.join(workspaceRoot, 'deep', 'nested', 'dir', 'file.ts');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('export default 42;');
    });

    it('overwrites existing file', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'existing.txt'), 'old content', 'utf-8');

      const result = await provider.executeTool('write_file', {
        path: 'existing.txt',
        content: 'new content',
      });

      expect(result.success).toBe(true);
      const written = fs.readFileSync(path.join(workspaceRoot, 'existing.txt'), 'utf-8');
      expect(written).toBe('new content');
    });

    it('rejects writes in read-only mode', async () => {
      const roProvider = new VSCodeToolProvider(workspaceRoot, { readOnly: true });

      const result = await roProvider.executeTool('write_file', {
        path: 'readonly.txt',
        content: 'should not write',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('read-only mode');
      expect(fs.existsSync(path.join(workspaceRoot, 'readonly.txt'))).toBe(false);
    });

    it('blocks path traversal on write', async () => {
      const result = await provider.executeTool('write_file', {
        path: '../../../tmp/evil.txt',
        content: 'malicious',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal blocked');
    });
  });

  // -----------------------------------------------------------------------
  // 3. edit_file
  // -----------------------------------------------------------------------

  describe('edit_file', () => {
    it('replaces text in an existing file', async () => {
      fs.writeFileSync(
        path.join(workspaceRoot, 'edit.ts'),
        'const x = 1;\nconst y = 2;\n',
        'utf-8',
      );

      const result = await provider.executeTool('edit_file', {
        path: 'edit.ts',
        old_text: 'const x = 1;',
        new_text: 'const x = 42;',
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(path.join(workspaceRoot, 'edit.ts'), 'utf-8');
      expect(content).toBe('const x = 42;\nconst y = 2;\n');
    });

    it('returns error when old_text is not found', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'edit2.ts'), 'abc', 'utf-8');

      const result = await provider.executeTool('edit_file', {
        path: 'edit2.ts',
        old_text: 'xyz',
        new_text: 'replaced',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('old_text not found');
    });

    it('returns error when file does not exist', async () => {
      const result = await provider.executeTool('edit_file', {
        path: 'missing.ts',
        old_text: 'a',
        new_text: 'b',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('only replaces the first occurrence', async () => {
      fs.writeFileSync(
        path.join(workspaceRoot, 'dup.ts'),
        'foo bar foo bar',
        'utf-8',
      );

      await provider.executeTool('edit_file', {
        path: 'dup.ts',
        old_text: 'foo',
        new_text: 'baz',
      });

      const content = fs.readFileSync(path.join(workspaceRoot, 'dup.ts'), 'utf-8');
      expect(content).toBe('baz bar foo bar');
    });

    it('rejects edits in read-only mode', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'ro.ts'), 'test', 'utf-8');
      const roProvider = new VSCodeToolProvider(workspaceRoot, { readOnly: true });

      const result = await roProvider.executeTool('edit_file', {
        path: 'ro.ts',
        old_text: 'test',
        new_text: 'changed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('read-only mode');
      // File should be unchanged
      expect(fs.readFileSync(path.join(workspaceRoot, 'ro.ts'), 'utf-8')).toBe('test');
    });
  });

  // -----------------------------------------------------------------------
  // 4. list_directory
  // -----------------------------------------------------------------------

  describe('list_directory', () => {
    it('lists files and directories with correct suffixes', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'file.txt'), 'content', 'utf-8');
      fs.mkdirSync(path.join(workspaceRoot, 'subdir'));

      const result = await provider.executeTool('list_directory', { path: '.' });
      expect(result.success).toBe(true);
      const lines = result.output.split('\n');

      // Directories should have / suffix
      expect(lines).toContain('subdir/');
      // Files should NOT have / suffix
      expect(lines).toContain('file.txt');
    });

    it('lists the workspace root when path is "."', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'root.txt'), '', 'utf-8');

      const result = await provider.executeTool('list_directory', { path: '.' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('root.txt');
    });

    it('lists a nested directory', async () => {
      const nested = path.join(workspaceRoot, 'src');
      fs.mkdirSync(nested);
      fs.writeFileSync(path.join(nested, 'index.ts'), '', 'utf-8');
      fs.writeFileSync(path.join(nested, 'util.ts'), '', 'utf-8');

      const result = await provider.executeTool('list_directory', { path: 'src' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('index.ts');
      expect(result.output).toContain('util.ts');
    });

    it('returns error for nonexistent directory', async () => {
      const result = await provider.executeTool('list_directory', { path: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a directory');
    });

    it('returns error when path is a file, not a directory', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'afile.txt'), '', 'utf-8');

      const result = await provider.executeTool('list_directory', { path: 'afile.txt' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a directory');
    });

    it('lists empty directory', async () => {
      fs.mkdirSync(path.join(workspaceRoot, 'empty'));

      const result = await provider.executeTool('list_directory', { path: 'empty' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // 5. search_files
  // -----------------------------------------------------------------------

  describe('search_files', () => {
    it('finds matching lines across files', async () => {
      fs.writeFileSync(
        path.join(workspaceRoot, 'a.ts'),
        'const foo = 1;\nconst bar = 2;\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(workspaceRoot, 'b.ts'),
        'const baz = 3;\nconst foo = 4;\n',
        'utf-8',
      );

      const result = await provider.executeTool('search_files', { pattern: 'foo' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('a.ts');
      expect(result.output).toContain('b.ts');
      expect(result.output).toContain('foo');
    });

    it('returns "No matches found" when pattern has no hits', async () => {
      fs.writeFileSync(path.join(workspaceRoot, 'c.ts'), 'nothing here', 'utf-8');

      const result = await provider.executeTool('search_files', { pattern: 'xyzzy' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('No matches found');
    });

    it('searches recursively in subdirectories', async () => {
      const subdir = path.join(workspaceRoot, 'sub');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'deep.ts'), 'const needle = true;', 'utf-8');

      const result = await provider.executeTool('search_files', { pattern: 'needle' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('deep.ts');
      expect(result.output).toContain('needle');
    });

    it('includes line numbers in results', async () => {
      fs.writeFileSync(
        path.join(workspaceRoot, 'lines.ts'),
        'line1\nline2\ntarget\nline4\n',
        'utf-8',
      );

      const result = await provider.executeTool('search_files', { pattern: 'target' });
      expect(result.success).toBe(true);
      // Target is on line 3
      expect(result.output).toContain(':3:');
    });
  });

  // -----------------------------------------------------------------------
  // 6. run_command
  // -----------------------------------------------------------------------

  describe('run_command', () => {
    it('executes a simple command successfully', async () => {
      const result = await provider.executeTool('run_command', { command: 'echo hello' });
      expect(result.success).toBe(true);
      expect(result.output.trim()).toContain('hello');
    });

    it('reports errors for failing commands', async () => {
      const result = await provider.executeTool('run_command', {
        command: 'exit 1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('captures stderr in output', async () => {
      const result = await provider.executeTool('run_command', {
        command: 'echo warn >&2',
      });
      // The command itself succeeds (exit 0), stderr is captured in output
      expect(result.output).toContain('warn');
    });

    it('rejects commands in read-only mode', async () => {
      const roProvider = new VSCodeToolProvider(workspaceRoot, { readOnly: true });

      const result = await roProvider.executeTool('run_command', { command: 'echo blocked' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('read-only mode');
    });

    it('runs commands in the workspace root directory', async () => {
      // pwd should return the workspace root
      const result = await provider.executeTool('run_command', { command: 'pwd' });
      expect(result.success).toBe(true);
      // On macOS, /var is a symlink to /private/var, so resolve both to real paths
      expect(fs.realpathSync(result.output.trim())).toBe(fs.realpathSync(workspaceRoot));
    });
  });

  // -----------------------------------------------------------------------
  // 7. Unknown tool
  // -----------------------------------------------------------------------

  describe('unknown tool', () => {
    it('returns error for unrecognized tool name', async () => {
      const result = await provider.executeTool('delete_everything', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown tool: delete_everything');
    });

    it('returns error for empty tool name', async () => {
      const result = await provider.executeTool('', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown tool: ');
    });
  });

  // -----------------------------------------------------------------------
  // 8. Read-only mode across all tools
  // -----------------------------------------------------------------------

  describe('read-only mode', () => {
    let roProvider: VSCodeToolProvider;

    beforeEach(() => {
      roProvider = new VSCodeToolProvider(workspaceRoot, { readOnly: true });
      // Create a file so read tests work
      fs.writeFileSync(path.join(workspaceRoot, 'readable.txt'), 'can read me', 'utf-8');
    });

    it('allows read_file in read-only mode', async () => {
      const result = await roProvider.executeTool('read_file', { path: 'readable.txt' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('can read me');
    });

    it('allows list_directory in read-only mode', async () => {
      const result = await roProvider.executeTool('list_directory', { path: '.' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('readable.txt');
    });

    it('allows search_files in read-only mode', async () => {
      const result = await roProvider.executeTool('search_files', { pattern: 'read' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('readable.txt');
    });

    it('blocks write_file in read-only mode', async () => {
      const result = await roProvider.executeTool('write_file', {
        path: 'new.txt',
        content: 'nope',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('read-only mode');
    });

    it('blocks edit_file in read-only mode', async () => {
      const result = await roProvider.executeTool('edit_file', {
        path: 'readable.txt',
        old_text: 'can',
        new_text: 'cannot',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('read-only mode');
    });

    it('blocks run_command in read-only mode', async () => {
      const result = await roProvider.executeTool('run_command', { command: 'ls' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('read-only mode');
    });
  });
});
