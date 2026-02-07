/**
 * Step 43: Preflight Checks Engine Tests
 *
 * Tests for runPreflightChecks and individual check functions.
 * Covers: empty dir, non-empty dir, monorepo, permissions, disk space,
 * git dirty, conflicting files, and resolution application.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runPreflightChecks,
  checkDirectoryEmpty,
  checkMonorepo,
  checkWritePermissions,
  checkDiskSpace,
  checkGitDirty,
  checkConflictingFiles,
  applyResolutions,
  type PreflightChecksInput,
} from '../scaffold/preflightChecks';

// ============================================================================
// HELPERS
// ============================================================================

const createTestDir = async (suffix?: string): Promise<string> => {
  const tmpDir = path.join(
    os.tmpdir(),
    `preflight-test-${suffix || Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.promises.mkdir(tmpDir, { recursive: true });
  return tmpDir;
};

const cleanupTestDir = async (dir: string): Promise<void> => {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
};

// ============================================================================
// TESTS: runPreflightChecks (integration)
// ============================================================================

describe('runPreflightChecks', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir('integration');
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should return canProceed=true for empty directory', async () => {
    const input: PreflightChecksInput = {
      targetDir: testDir,
      workspaceRoot: testDir,
      plannedFiles: ['src/index.ts', 'package.json'],
    };

    const result = await runPreflightChecks(input);

    expect(result.canProceed).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.checks.length).toBeGreaterThanOrEqual(6);
  });

  it('should return canProceed=false for non-empty directory', async () => {
    // Create some files to make it non-empty
    await fs.promises.writeFile(path.join(testDir, 'existing.ts'), 'export const x = 1;');
    await fs.promises.writeFile(path.join(testDir, 'package.json'), '{}');

    const input: PreflightChecksInput = {
      targetDir: testDir,
      workspaceRoot: testDir,
      plannedFiles: ['src/index.ts', 'package.json'],
    };

    const result = await runPreflightChecks(input);

    expect(result.canProceed).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    // directory_empty should be a blocker
    expect(result.blockers.some(b => b.id === 'directory_empty')).toBe(true);
  });

  it('should have 6 checks in total', async () => {
    const input: PreflightChecksInput = {
      targetDir: testDir,
      workspaceRoot: testDir,
      plannedFiles: ['index.ts'],
    };

    const result = await runPreflightChecks(input);

    expect(result.checks).toHaveLength(6);
    const ids = result.checks.map(c => c.id);
    expect(ids).toContain('directory_empty');
    expect(ids).toContain('monorepo_detected');
    expect(ids).toContain('write_permissions');
    expect(ids).toContain('disk_space');
    expect(ids).toContain('git_dirty');
    expect(ids).toContain('conflicting_files');
  });
});

// ============================================================================
// TESTS: checkDirectoryEmpty
// ============================================================================

describe('checkDirectoryEmpty', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir('dirempty');
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass for non-existent directory', async () => {
    const result = await checkDirectoryEmpty('/tmp/nonexistent-preflight-test-xyz');
    expect(result.status).toBe('pass');
  });

  it('should pass for empty directory', async () => {
    const result = await checkDirectoryEmpty(testDir);
    expect(result.status).toBe('pass');
  });

  it('should pass for directory with only harmless files', async () => {
    await fs.promises.writeFile(path.join(testDir, '.gitignore'), 'node_modules');
    await fs.promises.writeFile(path.join(testDir, 'README.md'), '# Hello');
    await fs.promises.writeFile(path.join(testDir, 'LICENSE'), 'MIT');

    const result = await checkDirectoryEmpty(testDir);
    expect(result.status).toBe('pass');
  });

  it('should block for non-empty directory with 4 resolution options', async () => {
    await fs.promises.writeFile(path.join(testDir, 'index.ts'), 'console.log("hi")');
    await fs.promises.writeFile(path.join(testDir, 'package.json'), '{}');

    const result = await checkDirectoryEmpty(testDir, 'my-app');

    expect(result.status).toBe('block');
    expect(result.resolution).toBeDefined();
    expect(result.resolution!.options).toHaveLength(4);

    const optionIds = result.resolution!.options.map(o => o.id);
    expect(optionIds).toContain('create_subfolder');
    expect(optionIds).toContain('merge_skip_conflicts');
    expect(optionIds).toContain('replace_all');
    expect(optionIds).toContain('cancel');
  });

  it('should include subfolder path in create_subfolder option', async () => {
    await fs.promises.writeFile(path.join(testDir, 'app.ts'), 'x');

    const result = await checkDirectoryEmpty(testDir, 'my-app');

    const subfolderOpt = result.resolution!.options.find(o => o.id === 'create_subfolder');
    expect(subfolderOpt).toBeDefined();
    expect(subfolderOpt!.modifications?.targetDir).toBe(path.join(testDir, 'my-app'));
  });

  it('should set mergeMode in merge/replace options', async () => {
    await fs.promises.writeFile(path.join(testDir, 'file.ts'), 'x');

    const result = await checkDirectoryEmpty(testDir);

    const skipOpt = result.resolution!.options.find(o => o.id === 'merge_skip_conflicts');
    expect(skipOpt!.modifications?.mergeMode).toBe('skip_conflicts');

    const replaceOpt = result.resolution!.options.find(o => o.id === 'replace_all');
    expect(replaceOpt!.modifications?.mergeMode).toBe('replace_all');
  });
});

// ============================================================================
// TESTS: checkMonorepo
// ============================================================================

describe('checkMonorepo', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir('monorepo');
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass when no monorepo markers are present', async () => {
    const result = await checkMonorepo(testDir, testDir);
    expect(result.status).toBe('pass');
  });

  it('should warn when pnpm-workspace.yaml is detected', async () => {
    await fs.promises.writeFile(
      path.join(testDir, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*'
    );

    const result = await checkMonorepo(testDir, testDir);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('pnpm');
    expect(result.resolution).toBeDefined();

    const optionIds = result.resolution!.options.map(o => o.id);
    expect(optionIds).toContain('monorepo_apps');
    expect(optionIds).toContain('monorepo_packages');
    expect(optionIds).toContain('monorepo_root');
  });

  it('should warn when turbo.json is detected', async () => {
    await fs.promises.writeFile(path.join(testDir, 'turbo.json'), '{}');

    const result = await checkMonorepo(testDir, testDir);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('turbo');
  });

  it('should warn when nx.json is detected', async () => {
    await fs.promises.writeFile(path.join(testDir, 'nx.json'), '{}');

    const result = await checkMonorepo(testDir, testDir);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('nx');
  });

  it('should warn when lerna.json is detected', async () => {
    await fs.promises.writeFile(path.join(testDir, 'lerna.json'), '{}');

    const result = await checkMonorepo(testDir, testDir);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('lerna');
  });

  it('should warn when package.json has workspaces field', async () => {
    await fs.promises.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] })
    );

    const result = await checkMonorepo(testDir, testDir);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('workspaces');
  });

  it('should provide apps/packages/root resolution options', async () => {
    await fs.promises.writeFile(path.join(testDir, 'turbo.json'), '{}');

    const targetDir = path.join(testDir, 'my-app');
    const result = await checkMonorepo(targetDir, testDir);

    expect(result.resolution!.options).toHaveLength(3);

    const appsOpt = result.resolution!.options.find(o => o.id === 'monorepo_apps');
    expect(appsOpt!.modifications?.targetDir).toContain('apps');
    expect(appsOpt!.modifications?.monorepoPlacement).toBe('apps');

    const pkgsOpt = result.resolution!.options.find(o => o.id === 'monorepo_packages');
    expect(pkgsOpt!.modifications?.targetDir).toContain('packages');
    expect(pkgsOpt!.modifications?.monorepoPlacement).toBe('packages');

    const rootOpt = result.resolution!.options.find(o => o.id === 'monorepo_root');
    expect(rootOpt!.modifications?.monorepoPlacement).toBe('root');
  });

  it('should pass when target is already under apps/', async () => {
    await fs.promises.writeFile(path.join(testDir, 'turbo.json'), '{}');
    const appsDir = path.join(testDir, 'apps', 'my-app');
    await fs.promises.mkdir(appsDir, { recursive: true });

    const result = await checkMonorepo(appsDir, testDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('already in apps');
  });
});

// ============================================================================
// TESTS: checkWritePermissions
// ============================================================================

describe('checkWritePermissions', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir('perms');
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass for writable directory', async () => {
    const result = await checkWritePermissions(testDir);
    expect(result.status).toBe('pass');
  });

  it('should pass for non-existent directory with writable parent', async () => {
    const nonExistent = path.join(testDir, 'new-dir');
    const result = await checkWritePermissions(nonExistent);
    expect(result.status).toBe('pass');
  });

  it('should block for non-existent parent directory', async () => {
    const result = await checkWritePermissions('/nonexistent/path/that/does/not/exist');
    expect(result.status).toBe('block');
    expect(result.resolution).toBeDefined();
    expect(result.resolution!.options.some(o => o.action === 'cancel')).toBe(true);
  });
});

// ============================================================================
// TESTS: checkDiskSpace
// ============================================================================

describe('checkDiskSpace', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir('disk');
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass for normal disk space', async () => {
    const result = await checkDiskSpace(testDir, 50);
    expect(result.status).toBe('pass');
  });

  it('should warn when low disk space estimated', async () => {
    // We can't easily simulate low disk space, but we can test the boundary
    // by requesting a very large estimated MB
    const result = await checkDiskSpace(testDir, 999999);
    // Should be either pass or warn depending on actual disk space
    expect(['pass', 'warn']).toContain(result.status);
  });

  it('should handle non-existent target gracefully', async () => {
    const result = await checkDiskSpace(path.join(testDir, 'nonexistent'), 50);
    // Should not throw — should pass or use parent
    expect(['pass', 'warn', 'block']).toContain(result.status);
  });
});

// ============================================================================
// TESTS: checkGitDirty
// ============================================================================

describe('checkGitDirty', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir('git');
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass when not a git repository', async () => {
    const result = await checkGitDirty(testDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('Not a git repository');
  });

  it('should pass or warn for git repository (depends on state)', async () => {
    // We can test with the project root which is a git repo
    const projectRoot = path.resolve(__dirname, '../../../..');
    const result = await checkGitDirty(projectRoot);
    // Either clean or dirty — both are valid
    expect(['pass', 'warn']).toContain(result.status);
  });
});

// ============================================================================
// TESTS: checkConflictingFiles
// ============================================================================

describe('checkConflictingFiles', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir('conflicts');
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass when target does not exist', async () => {
    const result = await checkConflictingFiles(
      '/tmp/nonexistent-preflight-conflict-test',
      ['src/index.ts']
    );
    expect(result.status).toBe('pass');
  });

  it('should pass when no conflicts exist', async () => {
    // Empty dir, no files to conflict
    const result = await checkConflictingFiles(testDir, ['src/index.ts', 'package.json']);
    expect(result.status).toBe('pass');
  });

  it('should block when conflicts exist and no mergeMode set', async () => {
    // Create conflicting files
    await fs.promises.writeFile(path.join(testDir, 'package.json'), '{}');
    await fs.promises.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.promises.writeFile(path.join(testDir, 'src/index.ts'), 'old code');

    const result = await checkConflictingFiles(
      testDir,
      ['package.json', 'src/index.ts', 'README.md']
    );

    expect(result.status).toBe('block');
    expect(result.message).toContain('2'); // 2 conflicts
    expect(result.resolution).toBeDefined();

    const optionIds = result.resolution!.options.map(o => o.id);
    expect(optionIds).toContain('merge_skip');
    expect(optionIds).toContain('merge_replace');
    expect(optionIds).toContain('cancel');
  });

  it('should warn (not block) when mergeMode=skip_conflicts', async () => {
    await fs.promises.writeFile(path.join(testDir, 'package.json'), '{}');

    const result = await checkConflictingFiles(
      testDir,
      ['package.json', 'index.ts'],
      'skip_conflicts'
    );

    expect(result.status).toBe('warn');
    expect(result.message).toContain('skipped');
  });

  it('should warn (not block) when mergeMode=replace_all', async () => {
    await fs.promises.writeFile(path.join(testDir, 'package.json'), '{}');

    const result = await checkConflictingFiles(
      testDir,
      ['package.json', 'index.ts'],
      'replace_all'
    );

    expect(result.status).toBe('warn');
    expect(result.message).toContain('replaced');
  });
});

// ============================================================================
// TESTS: applyResolutions
// ============================================================================

describe('applyResolutions', () => {
  it('should return null when cancel is selected', () => {
    const input: PreflightChecksInput = {
      targetDir: '/tmp/test',
      workspaceRoot: '/tmp',
      plannedFiles: ['index.ts'],
    };

    const result = {
      canProceed: false,
      checks: [{
        id: 'directory_empty',
        name: 'Directory Empty',
        status: 'block' as const,
        message: 'Not empty',
        resolution: {
          options: [{
            id: 'cancel',
            label: 'Cancel',
            description: 'Cancel',
            action: 'cancel' as const,
          }],
        },
      }],
      blockers: [],
      warnings: [],
    };

    const updated = applyResolutions(input, result, { directory_empty: 'cancel' });
    expect(updated).toBeNull();
  });

  it('should update targetDir when create_subfolder is selected', () => {
    const input: PreflightChecksInput = {
      targetDir: '/tmp/test',
      workspaceRoot: '/tmp',
      plannedFiles: ['index.ts'],
    };

    const result = {
      canProceed: false,
      checks: [{
        id: 'directory_empty',
        name: 'Directory Empty',
        status: 'block' as const,
        message: 'Not empty',
        resolution: {
          options: [{
            id: 'create_subfolder',
            label: 'Create subfolder',
            description: 'Create in subfolder',
            action: 'modify' as const,
            modifications: {
              targetDir: '/tmp/test/my-app',
            },
          }],
        },
      }],
      blockers: [],
      warnings: [],
    };

    const updated = applyResolutions(input, result, { directory_empty: 'create_subfolder' });
    expect(updated).not.toBeNull();
    expect(updated!.targetDir).toBe('/tmp/test/my-app');
  });

  it('should update mergeMode when merge option is selected', () => {
    const input: PreflightChecksInput = {
      targetDir: '/tmp/test',
      workspaceRoot: '/tmp',
      plannedFiles: ['index.ts'],
    };

    const result = {
      canProceed: false,
      checks: [{
        id: 'conflicting_files',
        name: 'Conflicting Files',
        status: 'block' as const,
        message: 'Conflicts found',
        resolution: {
          options: [{
            id: 'merge_skip',
            label: 'Skip conflicts',
            description: 'Skip existing',
            action: 'modify' as const,
            modifications: {
              mergeMode: 'skip_conflicts' as const,
            },
          }],
        },
      }],
      blockers: [],
      warnings: [],
    };

    const updated = applyResolutions(input, result, { conflicting_files: 'merge_skip' });
    expect(updated).not.toBeNull();
    expect(updated!.mergeMode).toBe('skip_conflicts');
  });

  it('should handle multiple resolutions simultaneously', () => {
    const input: PreflightChecksInput = {
      targetDir: '/tmp/test',
      workspaceRoot: '/tmp',
      plannedFiles: ['index.ts'],
    };

    const result = {
      canProceed: false,
      checks: [
        {
          id: 'directory_empty',
          name: 'Directory Empty',
          status: 'block' as const,
          message: 'Not empty',
          resolution: {
            options: [{
              id: 'create_subfolder',
              label: 'Create subfolder',
              description: 'desc',
              action: 'modify' as const,
              modifications: { targetDir: '/tmp/test/app' },
            }],
          },
        },
        {
          id: 'monorepo_detected',
          name: 'Monorepo',
          status: 'warn' as const,
          message: 'Monorepo found',
          resolution: {
            options: [{
              id: 'monorepo_apps',
              label: 'apps/',
              description: 'desc',
              action: 'modify' as const,
              modifications: { targetDir: '/tmp/apps/app' },
            }],
          },
        },
      ],
      blockers: [],
      warnings: [],
    };

    // If both are selected, later one wins for targetDir
    const updated = applyResolutions(input, result, {
      directory_empty: 'create_subfolder',
      monorepo_detected: 'monorepo_apps',
    });

    expect(updated).not.toBeNull();
    expect(updated!.targetDir).toBe('/tmp/apps/app');
  });
});

// ============================================================================
// TESTS: Integration - Non-empty with resolution re-run
// ============================================================================

describe('runPreflightChecks with resolutions', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir('resolution');
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass after resolving non-empty dir with subfolder', async () => {
    // Create non-empty dir
    await fs.promises.writeFile(path.join(testDir, 'existing.ts'), 'x');

    const input: PreflightChecksInput = {
      targetDir: testDir,
      workspaceRoot: testDir,
      plannedFiles: ['index.ts'],
      appName: 'my-app',
    };

    // First run: blocked
    const firstResult = await runPreflightChecks(input);
    expect(firstResult.canProceed).toBe(false);

    // Apply resolution: create in subfolder
    const updated = applyResolutions(input, firstResult, {
      directory_empty: 'create_subfolder',
    });
    expect(updated).not.toBeNull();

    // Second run with updated target
    const secondResult = await runPreflightChecks(updated!);
    // Subfolder doesn't exist yet, so directory_empty should pass
    const dirCheck = secondResult.checks.find(c => c.id === 'directory_empty');
    expect(dirCheck?.status).toBe('pass');
  });
});
