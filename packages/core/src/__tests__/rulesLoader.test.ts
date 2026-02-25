/**
 * Layer 1: Rules Loader Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  loadRules,
  buildRulesContext,
  globMatch,
} from '../memory/rulesLoader';
import type { RulesService } from '../memory/rulesLoader';

// ============================================================================
// Mock RulesService
// ============================================================================

function createMockService(files: Record<string, string | null>): RulesService {
  const dirs: Record<string, string[]> = {};
  for (const filePath of Object.keys(files)) {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (!dirs[dir]) dirs[dir] = [];
    const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
    dirs[dir].push(fileName);
  }

  return {
    async readDir(dirPath: string) {
      const normalizedDir = dirPath.replace(/\\/g, '/');
      for (const [key, val] of Object.entries(dirs)) {
        if (normalizedDir.endsWith(key) || normalizedDir === key) return val;
      }
      return [];
    },
    async readFile(filePath: string) {
      const normalized = filePath.replace(/\\/g, '/');
      for (const [key, val] of Object.entries(files)) {
        if (normalized.endsWith(key)) return val;
      }
      return null;
    },
    async exists(filePath: string) {
      const normalized = filePath.replace(/\\/g, '/');
      for (const key of Object.keys(files)) {
        if (normalized.endsWith(key.substring(0, key.lastIndexOf('/')))) return true;
      }
      for (const key of Object.keys(dirs)) {
        if (normalized.endsWith(key)) return true;
      }
      return false;
    },
  };
}

// ============================================================================
// globMatch Tests
// ============================================================================

describe('globMatch', () => {
  it('matches simple wildcard', () => {
    expect(globMatch('*.ts', 'index.ts')).toBe(true);
    expect(globMatch('*.ts', 'index.js')).toBe(false);
  });

  it('matches double-star directory wildcard', () => {
    expect(globMatch('**/*.ts', 'src/index.ts')).toBe(true);
    expect(globMatch('**/*.ts', 'src/deep/nested/file.ts')).toBe(true);
    expect(globMatch('**/*.ts', 'file.ts')).toBe(true);
  });

  it('matches specific path patterns', () => {
    expect(globMatch('src/**/*.tsx', 'src/components/Button.tsx')).toBe(true);
    expect(globMatch('src/**/*.tsx', 'lib/components/Button.tsx')).toBe(false);
  });

  it('matches question mark wildcard', () => {
    expect(globMatch('file?.ts', 'file1.ts')).toBe(true);
    expect(globMatch('file?.ts', 'file12.ts')).toBe(false);
  });

  it('handles dots in filenames', () => {
    expect(globMatch('*.test.ts', 'foo.test.ts')).toBe(true);
    expect(globMatch('*.test.ts', 'foo.spec.ts')).toBe(false);
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(globMatch('**/*.ts', 'src\\index.ts')).toBe(true);
  });

  it('returns false for invalid regex', () => {
    expect(globMatch('[invalid', 'test')).toBe(false);
  });
});

// ============================================================================
// loadRules Tests
// ============================================================================

describe('loadRules', () => {
  it('loads project rules from .ordinex/rules/*.md', async () => {
    const service = createMockService({
      '.ordinex/rules/prefer-async.md': 'Always use async/await.',
      '.ordinex/rules/naming.md': 'Use camelCase for variables.',
    });

    const rules = await loadRules('/workspace', service, '/home/user');
    const projectRules = rules.filter(r => r.source === 'project');
    expect(projectRules).toHaveLength(2);
    expect(projectRules[0].id).toBe('naming');
    expect(projectRules[1].id).toBe('prefer-async');
  });

  it('loads global rules from ~/.ordinex/rules.md', async () => {
    const service = createMockService({
      '.ordinex/rules.md': 'I prefer concise code.',
    });

    const rules = await loadRules('/workspace', service, '/home/user');
    const globalRules = rules.filter(r => r.source === 'global');
    expect(globalRules).toHaveLength(1);
    expect(globalRules[0].id).toBe('_global');
    expect(globalRules[0].content).toBe('I prefer concise code.');
  });

  it('parses scope comments from rule files', async () => {
    const service = createMockService({
      '.ordinex/rules/ts-only.md': '<!-- scope: **/*.ts -->\nUse strict mode.',
    });

    const rules = await loadRules('/workspace', service, '/home/user');
    expect(rules[0].scope).toBe('**/*.ts');
    expect(rules[0].content).toBe('Use strict mode.');
  });

  it('returns empty array when rules directory does not exist', async () => {
    const service: RulesService = {
      async readDir() { return []; },
      async readFile() { return null; },
      async exists() { return false; },
    };

    const rules = await loadRules('/workspace', service, '/home/user');
    expect(rules).toEqual([]);
  });

  it('skips empty rule files', async () => {
    const service = createMockService({
      '.ordinex/rules/empty.md': '',
      '.ordinex/rules/whitespace.md': '   \n  ',
    });

    const rules = await loadRules('/workspace', service, '/home/user');
    const projectRules = rules.filter(r => r.source === 'project');
    expect(projectRules).toHaveLength(0);
  });

  it('skips non-md files', async () => {
    const service = createMockService({
      '.ordinex/rules/notes.txt': 'Not a rule.',
      '.ordinex/rules/valid.md': 'A valid rule.',
    });

    const rules = await loadRules('/workspace', service, '/home/user');
    const projectRules = rules.filter(r => r.source === 'project');
    expect(projectRules).toHaveLength(1);
    expect(projectRules[0].id).toBe('valid');
  });

  it('strips scope comment from content', async () => {
    const service = createMockService({
      '.ordinex/rules/scoped.md': '<!-- scope: *.tsx -->\nUse functional components.',
    });

    const rules = await loadRules('/workspace', service, '/home/user');
    expect(rules[0].content).not.toContain('<!-- scope');
    expect(rules[0].content).toBe('Use functional components.');
  });

  it('global rules come before project rules', async () => {
    const service = createMockService({
      '.ordinex/rules.md': 'Global preference.',
      '.ordinex/rules/project.md': 'Project rule.',
    });

    const rules = await loadRules('/workspace', service, '/home/user');
    expect(rules[0].source).toBe('global');
    expect(rules[1].source).toBe('project');
  });
});

// ============================================================================
// buildRulesContext Tests
// ============================================================================

describe('buildRulesContext', () => {
  it('returns empty string for no rules', () => {
    expect(buildRulesContext([])).toBe('');
  });

  it('includes all rules without scope', () => {
    const rules = [
      { id: 'a', content: 'Rule A', source: 'project' as const },
      { id: 'b', content: 'Rule B', source: 'project' as const },
    ];
    const ctx = buildRulesContext(rules);
    expect(ctx).toContain('Rule A');
    expect(ctx).toContain('Rule B');
  });

  it('filters scoped rules by active file', () => {
    const rules = [
      { id: 'ts', scope: '**/*.ts', content: 'TypeScript rule', source: 'project' as const },
      { id: 'py', scope: '**/*.py', content: 'Python rule', source: 'project' as const },
    ];
    const ctx = buildRulesContext(rules, 'src/index.ts');
    expect(ctx).toContain('TypeScript rule');
    expect(ctx).not.toContain('Python rule');
  });

  it('excludes scoped rules when no active file', () => {
    const rules = [
      { id: 'ts', scope: '**/*.ts', content: 'TypeScript rule', source: 'project' as const },
      { id: 'all', content: 'Always active', source: 'project' as const },
    ];
    const ctx = buildRulesContext(rules);
    expect(ctx).not.toContain('TypeScript rule');
    expect(ctx).toContain('Always active');
  });

  it('orders global rules before project rules', () => {
    const rules = [
      { id: 'g', content: 'Global', source: 'global' as const },
      { id: 'p', content: 'Project', source: 'project' as const },
    ];
    const ctx = buildRulesContext(rules);
    expect(ctx.indexOf('Global')).toBeLessThan(ctx.indexOf('Project'));
  });

  it('returns empty string when all scoped rules are filtered out', () => {
    const rules = [
      { id: 'py', scope: '**/*.py', content: 'Python only', source: 'project' as const },
    ];
    const ctx = buildRulesContext(rules, 'src/index.ts');
    expect(ctx).toBe('');
  });
});
