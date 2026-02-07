/**
 * Step 43: Scaffold Quality Gates Tests
 *
 * Tests for enterprise-grade scaffold quality validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import {
  runPreApplyQualityGates,
  runPostApplyValidation,
  checkCheckpointReady,
  atomicApplyScaffold,
  GateConfig,
  QualityCheckResult,
  AtomicApplyContext,
} from '../scaffold/qualityGates';
import type { RecipePlan } from '../scaffold/recipeTypes';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const createMockRecipePlan = (files: Array<{ path: string; content: string }>): RecipePlan => ({
  recipe_id: 'test-recipe',
  app_name: 'test-app',
  target_directory: '/tmp/test-app',
  files: files.map(f => ({
    path: f.path,
    content: f.content,
    category: 'source' as const,
    description: 'Test file',
  })),
  commands: [],
  context: {
    recipe_id: 'test-recipe',
    app_name: 'test-app',
    target_dir: '/tmp/test-app',
    packageManager: 'npm',
    useTypeScript: true,
  },
});

const createTestDir = async (): Promise<string> => {
  const tmpDir = path.join(os.tmpdir(), `quality-gates-test-${Date.now()}`);
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
// TESTS: Pre-Apply Quality Gates
// ============================================================================

describe('runPreApplyQualityGates', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass all gates for empty directory with valid recipe', async () => {
    const recipePlan = createMockRecipePlan([
      { path: 'src/index.ts', content: 'console.log("hello");' },
      { path: 'package.json', content: '{}' },
    ]);

    const result = await runPreApplyQualityGates(testDir, recipePlan);

    expect(result.passed).toBe(true);
    expect(result.criticalFailures).toHaveLength(0);
    expect(result.gates.length).toBeGreaterThan(0);
  });

  it('should fail path validation for path traversal attempts', async () => {
    const recipePlan = createMockRecipePlan([
      { path: '../../../etc/passwd', content: 'malicious' },
    ]);

    const result = await runPreApplyQualityGates(testDir, recipePlan);

    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some(g => g.gate === 'path_validation')).toBe(true);
  });

  it('should fail path validation for absolute paths', async () => {
    const recipePlan = createMockRecipePlan([
      { path: '/etc/passwd', content: 'malicious' },
    ]);

    const result = await runPreApplyQualityGates(testDir, recipePlan);

    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some(g => g.gate === 'path_validation')).toBe(true);
  });

  it('should fail write permission for non-existent parent', async () => {
    const nonExistentDir = '/nonexistent/path/that/does/not/exist';
    const recipePlan = createMockRecipePlan([
      { path: 'src/index.ts', content: 'test' },
    ]);

    const result = await runPreApplyQualityGates(nonExistentDir, recipePlan);

    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some(g => g.gate === 'write_permission')).toBe(true);
  });

  it('should respect skipGates configuration', async () => {
    const recipePlan = createMockRecipePlan([
      { path: 'src/index.ts', content: 'test' },
    ]);

    const config: GateConfig = {
      skipGates: ['network', 'memory'],
    };

    const result = await runPreApplyQualityGates(testDir, recipePlan, config);

    expect(result.gates.some(g => g.gate === 'network')).toBe(false);
    expect(result.gates.some(g => g.gate === 'memory')).toBe(false);
    expect(result.gates.some(g => g.gate === 'disk_space')).toBe(true);
  });

  it('should include timing information', async () => {
    const recipePlan = createMockRecipePlan([
      { path: 'src/index.ts', content: 'test' },
    ]);

    const result = await runPreApplyQualityGates(testDir, recipePlan);

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
    result.gates.forEach(gate => {
      expect(gate.durationMs).toBeGreaterThanOrEqual(0);
      expect(gate.timestamp).toBeDefined();
    });
  });
});

// ============================================================================
// TESTS: Post-Apply Validation
// ============================================================================

describe('runPostApplyValidation', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass when all files exist with correct content', async () => {
    // Create files
    const srcDir = path.join(testDir, 'src');
    await fs.promises.mkdir(srcDir, { recursive: true });
    await fs.promises.writeFile(path.join(testDir, 'src/index.ts'), 'console.log("hello");');
    await fs.promises.writeFile(path.join(testDir, 'package.json'), '{}');

    const recipePlan = createMockRecipePlan([
      { path: 'src/index.ts', content: 'console.log("hello");' },
      { path: 'package.json', content: '{}' },
    ]);

    const result = await runPostApplyValidation(testDir, recipePlan);

    expect(result.passed).toBe(true);
    expect(result.verifiedFiles).toContain('src/index.ts');
    expect(result.verifiedFiles).toContain('package.json');
    expect(result.integrityScore).toBe(100);
  });

  it('should fail when files are missing', async () => {
    const recipePlan = createMockRecipePlan([
      { path: 'src/index.ts', content: 'test' },
      { path: 'missing.ts', content: 'test' },
    ]);

    // Only create one file
    const srcDir = path.join(testDir, 'src');
    await fs.promises.mkdir(srcDir, { recursive: true });
    await fs.promises.writeFile(path.join(testDir, 'src/index.ts'), 'test');

    const result = await runPostApplyValidation(testDir, recipePlan);

    expect(result.passed).toBe(false);
    expect(result.failedFiles.some(f => f.path === 'missing.ts')).toBe(true);
    expect(result.integrityScore).toBeLessThan(100);
  });

  it('should report content mismatch', async () => {
    const recipePlan = createMockRecipePlan([
      { path: 'test.ts', content: 'expected content' },
    ]);

    await fs.promises.writeFile(path.join(testDir, 'test.ts'), 'different content');

    const result = await runPostApplyValidation(testDir, recipePlan);

    expect(result.passed).toBe(false);
    expect(result.failedFiles.some(f => f.reason.includes('mismatch'))).toBe(true);
  });

  it('should calculate integrity score correctly', async () => {
    const recipePlan = createMockRecipePlan([
      { path: 'file1.ts', content: 'content1' },
      { path: 'file2.ts', content: 'content2' },
      { path: 'file3.ts', content: 'content3' },
      { path: 'file4.ts', content: 'content4' },
    ]);

    // Create only 2 of 4 files
    await fs.promises.writeFile(path.join(testDir, 'file1.ts'), 'content1');
    await fs.promises.writeFile(path.join(testDir, 'file2.ts'), 'content2');

    const result = await runPostApplyValidation(testDir, recipePlan);

    expect(result.integrityScore).toBe(50); // 2/4 = 50%
    expect(result.verifiedFiles).toHaveLength(2);
    expect(result.failedFiles).toHaveLength(2);
  });
});

// ============================================================================
// TESTS: Checkpoint Ready Check
// ============================================================================

describe('checkCheckpointReady', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should pass for existing writable directory', async () => {
    const checkpointDir = path.join(testDir, 'checkpoints');
    await fs.promises.mkdir(checkpointDir, { recursive: true });

    const result = await checkCheckpointReady(checkpointDir);

    expect(result.status).toBe('passed');
    expect(result.gate).toBe('checkpoint_ready');
  });

  it('should pass and create directory if it does not exist', async () => {
    const checkpointDir = path.join(testDir, 'new-checkpoints');

    const result = await checkCheckpointReady(checkpointDir);

    expect(result.status).toBe('passed');
    expect(fs.existsSync(checkpointDir)).toBe(true);
  });

  it('should fail for non-existent parent directory', async () => {
    const checkpointDir = '/nonexistent/parent/checkpoints';

    const result = await checkCheckpointReady(checkpointDir);

    expect(result.status).toBe('failed');
  });
});

// ============================================================================
// TESTS: Atomic Apply
// ============================================================================

describe('atomicApplyScaffold', () => {
  let testDir: string;
  let checkpointDir: string;
  let eventBus: EventEmitter;

  beforeEach(async () => {
    testDir = await createTestDir();
    checkpointDir = path.join(testDir, '.ordinex', 'checkpoints');
    await fs.promises.mkdir(checkpointDir, { recursive: true });
    eventBus = new EventEmitter();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should create files atomically', async () => {
    const targetDir = path.join(testDir, 'app');
    const recipePlan = createMockRecipePlan([
      { path: 'src/index.ts', content: 'console.log("hello");' },
      { path: 'package.json', content: '{"name": "test"}' },
    ]);

    const ctx: AtomicApplyContext = {
      scaffoldId: 'test-scaffold',
      targetDir,
      recipePlan,
      checkpointDir,
      eventBus,
      runId: 'test-run',
      mode: 'MISSION',
    };

    const result = await atomicApplyScaffold(ctx);

    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('src/index.ts');
    expect(result.filesCreated).toContain('package.json');
    expect(result.checkpointId).toBeDefined();

    // Verify files exist
    expect(fs.existsSync(path.join(targetDir, 'src/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
  });

  it('should create checkpoint before apply', async () => {
    const targetDir = path.join(testDir, 'app');
    const recipePlan = createMockRecipePlan([
      { path: 'test.ts', content: 'test' },
    ]);

    const ctx: AtomicApplyContext = {
      scaffoldId: 'test-scaffold',
      targetDir,
      recipePlan,
      checkpointDir,
      eventBus,
      runId: 'test-run',
      mode: 'MISSION',
    };

    const result = await atomicApplyScaffold(ctx);

    expect(result.checkpointId).toBeDefined();

    // Verify checkpoint directory exists
    const checkpointPath = path.join(checkpointDir, result.checkpointId!);
    expect(fs.existsSync(checkpointPath)).toBe(true);

    // Verify metadata file exists
    expect(fs.existsSync(path.join(checkpointPath, 'metadata.json'))).toBe(true);
  });

  it('should emit success event on completion', async () => {
    const targetDir = path.join(testDir, 'app');
    const recipePlan = createMockRecipePlan([
      { path: 'test.ts', content: 'test' },
    ]);

    const events: any[] = [];
    eventBus.on('event', (e) => events.push(e));

    const ctx: AtomicApplyContext = {
      scaffoldId: 'test-scaffold',
      targetDir,
      recipePlan,
      checkpointDir,
      eventBus,
      runId: 'test-run',
      mode: 'MISSION',
    };

    await atomicApplyScaffold(ctx);

    expect(events.some(e => e.type === 'scaffold_apply_completed')).toBe(true);
  });

  it('should backup existing files before overwrite', async () => {
    const targetDir = path.join(testDir, 'app');
    await fs.promises.mkdir(targetDir, { recursive: true });

    // Create existing file
    const existingContent = 'existing content';
    await fs.promises.writeFile(path.join(targetDir, 'test.ts'), existingContent);

    const recipePlan = createMockRecipePlan([
      { path: 'test.ts', content: 'new content' },
    ]);

    const ctx: AtomicApplyContext = {
      scaffoldId: 'test-scaffold',
      targetDir,
      recipePlan,
      checkpointDir,
      eventBus,
      runId: 'test-run',
      mode: 'MISSION',
      mergeMode: 'replace_all',
    };

    const result = await atomicApplyScaffold(ctx);

    expect(result.success).toBe(true);

    // Verify backup exists
    const backupPath = path.join(checkpointDir, result.checkpointId!, 'backup', 'test.ts');
    expect(fs.existsSync(backupPath)).toBe(true);

    const backupContent = await fs.promises.readFile(backupPath, 'utf8');
    expect(backupContent).toBe(existingContent);
  });
});

// ============================================================================
// TESTS: Gate Configuration
// ============================================================================

describe('GateConfig', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should respect custom disk space threshold', async () => {
    const recipePlan = createMockRecipePlan([
      { path: 'test.ts', content: 'x'.repeat(1000) },
    ]);

    // Set impossibly high disk space requirement
    const config: GateConfig = {
      minDiskSpaceBytes: Number.MAX_SAFE_INTEGER,
    };

    const result = await runPreApplyQualityGates(testDir, recipePlan, config);

    // Should either fail or warn about disk space
    const diskGate = result.gates.find(g => g.gate === 'disk_space');
    expect(diskGate).toBeDefined();
    expect(['failed', 'warning']).toContain(diskGate!.status);
  });

  it('should treat network as critical when configured', async () => {
    const recipePlan = createMockRecipePlan([
      { path: 'test.ts', content: 'test' },
    ]);

    const config: GateConfig = {
      networkRequired: true,
      networkTimeoutMs: 1, // Very short timeout to force failure
    };

    const result = await runPreApplyQualityGates(testDir, recipePlan, config);

    const networkGate = result.gates.find(g => g.gate === 'network');
    if (networkGate && networkGate.status === 'failed') {
      expect(result.criticalFailures.some(g => g.gate === 'network')).toBe(true);
    }
  });
});
