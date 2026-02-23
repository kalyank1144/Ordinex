/**
 * A8: Extension Handler Tests — Pure Logic Functions
 *
 * Tests pure logic functions that can be extracted and tested without
 * the VS Code runtime. For functions in modules that import vscode,
 * we re-implement the pure logic here to verify behavior.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// inferStack — Pure function from planHandler.ts
//
// The planHandler module imports vscode, making it impossible to import
// in a plain vitest environment. We extract the pure logic and test it here.
// ---------------------------------------------------------------------------

function inferStack(
  files: string[],
  openFiles: string[],
): string[] {
  const stack: Set<string> = new Set();
  const allFiles = [...files, ...openFiles];

  if (allFiles.some(f => f.includes('package.json'))) stack.add('Node.js');
  if (allFiles.some(f => f.endsWith('.ts') || f.endsWith('.tsx'))) stack.add('TypeScript');
  if (allFiles.some(f => f.endsWith('.jsx') || f.includes('react'))) stack.add('React');
  if (allFiles.some(f => f.includes('vue'))) stack.add('Vue');
  if (allFiles.some(f => f.includes('angular'))) stack.add('Angular');
  if (allFiles.some(f => f.endsWith('.py'))) stack.add('Python');
  if (allFiles.some(f => f.endsWith('.java'))) stack.add('Java');
  if (allFiles.some(f => f.endsWith('.go'))) stack.add('Go');
  if (allFiles.some(f => f.endsWith('.rs'))) stack.add('Rust');
  if (allFiles.some(f => f.includes('Cargo.toml'))) stack.add('Rust');
  if (allFiles.some(f => f.includes('go.mod'))) stack.add('Go');
  if (allFiles.some(f => f.includes('requirements.txt') || f.includes('setup.py'))) stack.add('Python');

  return Array.from(stack);
}

// ---------------------------------------------------------------------------
// buildAgentSystemPrompt — Pure function from agentHandler.ts
// ---------------------------------------------------------------------------

function buildAgentSystemPrompt(scaffoldContext: string | null): string {
  let prompt = `You are Ordinex, an AI coding assistant running in Agent mode inside VS Code.

You have tools: read_file, write_file, edit_file, run_command, search_files, list_directory. Fulfill requests directly.

Guidelines:
- If the user asks a question, answer it. Read files if needed for accuracy.
- If they need code changes, make them directly.
- If they ask to run a command, use the run_command tool.
- If their request would benefit from a structured plan first, suggest they switch to Plan mode — but otherwise just act.
- Be concise and precise. Prefer reading relevant code before making changes.
- When editing files, preserve existing style and conventions.`;

  if (scaffoldContext) {
    prompt += `\n\n${scaffoldContext}`;
  }

  return prompt;
}

// ============================================================================
// inferStack Tests
// ============================================================================

describe('inferStack', () => {
  it('detects TypeScript from .ts files', () => {
    expect(inferStack(['src/index.ts', 'src/util.ts'], [])).toContain('TypeScript');
  });

  it('detects TypeScript from .tsx files', () => {
    expect(inferStack(['src/App.tsx'], [])).toContain('TypeScript');
  });

  it('detects React from .jsx files', () => {
    expect(inferStack(['src/App.jsx'], [])).toContain('React');
  });

  it('detects React from paths containing "react"', () => {
    expect(inferStack(['node_modules/react/index.js'], [])).toContain('React');
  });

  it('detects Node.js from package.json', () => {
    expect(inferStack(['package.json'], [])).toContain('Node.js');
  });

  it('detects Python from .py files', () => {
    expect(inferStack(['main.py', 'utils.py'], [])).toContain('Python');
  });

  it('detects Python from requirements.txt', () => {
    expect(inferStack(['requirements.txt'], [])).toContain('Python');
  });

  it('detects Python from setup.py', () => {
    expect(inferStack(['setup.py'], [])).toContain('Python');
  });

  it('detects Go from .go files', () => {
    expect(inferStack(['main.go'], [])).toContain('Go');
  });

  it('detects Go from go.mod', () => {
    expect(inferStack(['go.mod'], [])).toContain('Go');
  });

  it('detects Rust from .rs files', () => {
    expect(inferStack(['src/main.rs'], [])).toContain('Rust');
  });

  it('detects Rust from Cargo.toml', () => {
    expect(inferStack(['Cargo.toml'], [])).toContain('Rust');
  });

  it('detects Java from .java files', () => {
    expect(inferStack(['src/Main.java'], [])).toContain('Java');
  });

  it('detects Vue from vue-related files', () => {
    expect(inferStack(['src/App.vue'], [])).toContain('Vue');
  });

  it('detects Angular from angular-related files', () => {
    expect(inferStack(['angular.json'], [])).toContain('Angular');
  });

  it('merges files and openFiles', () => {
    const result = inferStack(['package.json'], ['src/index.ts']);
    expect(result).toContain('Node.js');
    expect(result).toContain('TypeScript');
  });

  it('returns empty array for unknown file types', () => {
    expect(inferStack(['README.md', '.gitignore'], [])).toEqual([]);
  });

  it('deduplicates stack entries', () => {
    const result = inferStack(['a.ts', 'b.ts', 'c.tsx'], []);
    const tsCount = result.filter(s => s === 'TypeScript').length;
    expect(tsCount).toBe(1);
  });

  it('detects multiple stacks simultaneously', () => {
    const result = inferStack(
      ['package.json', 'src/index.ts', 'src/App.tsx', 'requirements.txt'],
      [],
    );
    expect(result).toContain('Node.js');
    expect(result).toContain('TypeScript');
    expect(result).toContain('Python');
  });

  it('uses openFiles for detection even when files is empty', () => {
    expect(inferStack([], ['main.go'])).toContain('Go');
  });

  it('handles both Cargo.toml and .rs in same project', () => {
    const result = inferStack(['Cargo.toml', 'src/main.rs'], []);
    expect(result).toContain('Rust');
    expect(result.filter(s => s === 'Rust').length).toBe(1);
  });
});

// ============================================================================
// buildAgentSystemPrompt Tests
// ============================================================================

describe('buildAgentSystemPrompt', () => {
  it('returns base prompt without scaffold context', () => {
    const prompt = buildAgentSystemPrompt(null);
    expect(prompt).toContain('You are Ordinex');
    expect(prompt).toContain('Agent mode');
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('write_file');
    expect(prompt).toContain('edit_file');
    expect(prompt).toContain('run_command');
    expect(prompt).toContain('search_files');
    expect(prompt).toContain('list_directory');
  });

  it('includes guidelines for code changes', () => {
    const prompt = buildAgentSystemPrompt(null);
    expect(prompt).toContain('If the user asks a question, answer it');
    expect(prompt).toContain('code changes, make them directly');
    expect(prompt).toContain('Be concise and precise');
    expect(prompt).toContain('preserve existing style');
  });

  it('suggests Plan mode for complex tasks', () => {
    const prompt = buildAgentSystemPrompt(null);
    expect(prompt).toContain('Plan mode');
  });

  it('appends scaffold context when provided', () => {
    const ctx = 'Project scaffolded with React + Tailwind at /tmp/my-app';
    const prompt = buildAgentSystemPrompt(ctx);
    expect(prompt).toContain(ctx);
    expect(prompt).toContain('You are Ordinex');
  });

  it('does not append anything when scaffoldContext is null', () => {
    const withNull = buildAgentSystemPrompt(null);
    expect(withNull.endsWith('conventions.')).toBe(true);
  });

  it('appends extra newlines when scaffoldContext is non-empty', () => {
    const prompt = buildAgentSystemPrompt('Project: My App');
    expect(prompt).toContain('conventions.\n\nProject: My App');
  });
});
