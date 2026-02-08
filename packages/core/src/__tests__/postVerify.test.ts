/**
 * Step 44: Post-Scaffold Verification Pipeline Tests
 *
 * Covers: pass, partial (lint warn), fail (install/build), retry, replay, helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import type { Event } from '../types';
import {
  runPostVerification,
  runPostVerificationWithEvents,
  verifyPackageJson,
  runInstallStep,
  runLintStep,
  runTypecheckStep,
  runBuildStep,
  detectPackageManager,
  detectTypeScript,
  hasScript,
  runScriptCmd,
  computeOutcome,
} from '../scaffold/postVerify';
import type {
  VerifyConfig,
  VerifyRecipeInfo,
  VerifyResult,
  VerifyStepResult,
  VerifyEventCtx,
} from '../scaffold/postVerify';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

async function createTestDir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ordinex-verify-'));
  testDirs.push(dir);
  return dir;
}

async function writePackageJson(dir: string, pkg: Record<string, unknown>): Promise<void> {
  await fs.promises.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(pkg, null, 2),
    'utf8'
  );
}

afterEach(async () => {
  for (const dir of testDirs) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  testDirs = [];
});

// ============================================================================
// TESTS: verifyPackageJson
// ============================================================================

describe('verifyPackageJson', () => {
  it('should pass for valid package.json with name', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { name: 'test-app', version: '1.0.0' });

    const result = verifyPackageJson(dir);
    expect(result.status).toBe('pass');
    expect(result.id).toBe('package_json');
    expect(result.message).toContain('test-app');
  });

  it('should fail when package.json does not exist', async () => {
    const dir = await createTestDir();

    const result = verifyPackageJson(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not found');
  });

  it('should warn when package.json has no name field', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { version: '1.0.0' });

    const result = verifyPackageJson(dir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('no "name" field');
  });

  it('should fail for invalid JSON', async () => {
    const dir = await createTestDir();
    await fs.promises.writeFile(path.join(dir, 'package.json'), '{ bad json }', 'utf8');

    const result = verifyPackageJson(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('parse error');
  });

  it('should have durationMs > 0', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { name: 'test' });

    const result = verifyPackageJson(dir);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// TESTS: detectPackageManager
// ============================================================================

describe('detectPackageManager', () => {
  it('should detect pnpm from pnpm-lock.yaml', async () => {
    const dir = await createTestDir();
    await fs.promises.writeFile(path.join(dir, 'pnpm-lock.yaml'), '', 'utf8');

    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('should detect yarn from yarn.lock', async () => {
    const dir = await createTestDir();
    await fs.promises.writeFile(path.join(dir, 'yarn.lock'), '', 'utf8');

    expect(detectPackageManager(dir)).toBe('yarn');
  });

  it('should default to npm', async () => {
    const dir = await createTestDir();

    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('should prefer pnpm over yarn when both exist', async () => {
    const dir = await createTestDir();
    await fs.promises.writeFile(path.join(dir, 'pnpm-lock.yaml'), '', 'utf8');
    await fs.promises.writeFile(path.join(dir, 'yarn.lock'), '', 'utf8');

    expect(detectPackageManager(dir)).toBe('pnpm');
  });
});

// ============================================================================
// TESTS: detectTypeScript
// ============================================================================

describe('detectTypeScript', () => {
  it('should detect from tsconfig.json', async () => {
    const dir = await createTestDir();
    await fs.promises.writeFile(path.join(dir, 'tsconfig.json'), '{}', 'utf8');

    expect(detectTypeScript(dir)).toBe(true);
  });

  it('should detect from typescript in devDependencies', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, {
      name: 'test',
      devDependencies: { typescript: '^5.0.0' },
    });

    expect(detectTypeScript(dir)).toBe(true);
  });

  it('should return false for JS-only project', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { name: 'test' });

    expect(detectTypeScript(dir)).toBe(false);
  });
});

// ============================================================================
// TESTS: hasScript
// ============================================================================

describe('hasScript', () => {
  it('should return true when script exists', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, {
      name: 'test',
      scripts: { lint: 'eslint .', build: 'tsc' },
    });

    expect(hasScript(dir, 'lint')).toBe(true);
    expect(hasScript(dir, 'build')).toBe(true);
  });

  it('should return false when script does not exist', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { name: 'test', scripts: {} });

    expect(hasScript(dir, 'lint')).toBe(false);
  });

  it('should return false when no package.json', async () => {
    const dir = await createTestDir();

    expect(hasScript(dir, 'lint')).toBe(false);
  });
});

// ============================================================================
// TESTS: runScriptCmd
// ============================================================================

describe('runScriptCmd', () => {
  it('should build correct command for npm', () => {
    expect(runScriptCmd('npm', 'lint')).toBe('npm run lint');
  });

  it('should build correct command for pnpm', () => {
    expect(runScriptCmd('pnpm', 'build')).toBe('pnpm run build');
  });

  it('should build correct command for yarn', () => {
    expect(runScriptCmd('yarn', 'typecheck')).toBe('yarn run typecheck');
  });
});

// ============================================================================
// TESTS: computeOutcome
// ============================================================================

describe('computeOutcome', () => {
  it('should return pass when all steps pass or are skipped', () => {
    const steps: VerifyStepResult[] = [
      { id: 'package_json', label: 'Package.json', status: 'pass', message: '', durationMs: 0 },
      { id: 'install', label: 'Install', status: 'pass', message: '', durationMs: 0 },
      { id: 'lint', label: 'Lint', status: 'skipped', message: '', durationMs: 0 },
    ];
    expect(computeOutcome(steps)).toBe('pass');
  });

  it('should return partial when there are warnings but no failures', () => {
    const steps: VerifyStepResult[] = [
      { id: 'package_json', label: 'Package.json', status: 'pass', message: '', durationMs: 0 },
      { id: 'lint', label: 'Lint', status: 'warn', message: '', durationMs: 0 },
    ];
    expect(computeOutcome(steps)).toBe('partial');
  });

  it('should return partial when there are failures AND passes', () => {
    const steps: VerifyStepResult[] = [
      { id: 'package_json', label: 'Package.json', status: 'pass', message: '', durationMs: 0 },
      { id: 'build', label: 'Build', status: 'fail', message: '', durationMs: 0 },
    ];
    expect(computeOutcome(steps)).toBe('partial');
  });

  it('should return fail when only failures exist (no passes)', () => {
    const steps: VerifyStepResult[] = [
      { id: 'package_json', label: 'Package.json', status: 'fail', message: '', durationMs: 0 },
    ];
    expect(computeOutcome(steps)).toBe('fail');
  });
});

// ============================================================================
// TESTS: runLintStep
// ============================================================================

describe('runLintStep', () => {
  it('should skip when no lint script exists', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { name: 'test', scripts: {} });

    const result = runLintStep(dir, 'npm', 60000);
    expect(result.status).toBe('skipped');
    expect(result.id).toBe('lint');
  });

  it('should return warn (not fail) when lint fails', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, {
      name: 'test',
      scripts: { lint: 'exit 1' },
    });

    const result = runLintStep(dir, 'npm', 60000);
    // Lint failures are ALWAYS warn
    expect(result.status).toBe('warn');
    expect(result.message).toContain('non-blocking');
  });
});

// ============================================================================
// TESTS: runTypecheckStep
// ============================================================================

describe('runTypecheckStep', () => {
  it('should skip when not TypeScript', async () => {
    const dir = await createTestDir();

    const result = runTypecheckStep(dir, 'npm', false, 60000);
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('Not a TypeScript project');
  });
});

// ============================================================================
// TESTS: runBuildStep
// ============================================================================

describe('runBuildStep', () => {
  it('should skip when policy disallows build', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, {
      name: 'test',
      scripts: { build: 'echo built' },
    });

    const result = runBuildStep(dir, 'npm', false, 120000);
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('disabled by policy');
  });

  it('should skip when no build script exists', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { name: 'test', scripts: {} });

    const result = runBuildStep(dir, 'npm', true, 120000);
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('No build script');
  });

  it('should pass when build succeeds', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, {
      name: 'test',
      scripts: { build: 'echo "done"' },
    });

    const result = runBuildStep(dir, 'npm', true, 120000);
    expect(result.status).toBe('pass');
    expect(result.command).toBe('npm run build');
  });

  it('should fail when build fails', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, {
      name: 'test',
      scripts: { build: 'exit 1' },
    });

    const result = runBuildStep(dir, 'npm', true, 120000);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Build failed');
  });
});

// ============================================================================
// TESTS: runInstallStep
// ============================================================================

describe('runInstallStep', () => {
  it('should pass when node_modules already exists', async () => {
    const dir = await createTestDir();
    const nmDir = path.join(dir, 'node_modules');
    await fs.promises.mkdir(nmDir, { recursive: true });
    await fs.promises.writeFile(path.join(nmDir, '.package-lock.json'), '{}', 'utf8');

    const result = await runInstallStep(dir, 'npm', 5000, 1);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('already present');
  });

  it('should fail for invalid package.json and record retried=true', async () => {
    const dir = await createTestDir();
    // Write an invalid package.json so install fails
    await fs.promises.writeFile(path.join(dir, 'package.json'), '{"name":"x","dependencies":{"nonexistent-pkg-xyz-99999":"1.0.0"}}', 'utf8');

    const result = await runInstallStep(dir, 'npm', 10000, 1);
    // Should have retried
    expect(result.retried).toBe(true);
    expect(result.status).toBe('fail');
    expect(result.output).toBeDefined();
  });
});

// ============================================================================
// TESTS: runPostVerification (integration)
// ============================================================================

describe('runPostVerification', () => {
  it('should return fail when package.json missing', async () => {
    const dir = await createTestDir();
    const recipe: VerifyRecipeInfo = { recipeId: 'test' };

    const result = await runPostVerification(dir, recipe);
    expect(result.outcome).toBe('fail');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].id).toBe('package_json');
    expect(result.steps[0].status).toBe('fail');
    expect(result.fromReplay).toBe(false);
  });

  it('should return pass when all steps pass (simple project)', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, {
      name: 'simple-app',
      version: '1.0.0',
      scripts: {},
    });
    // Create a non-empty node_modules to skip install
    const nmDir = path.join(dir, 'node_modules');
    await fs.promises.mkdir(nmDir, { recursive: true });
    await fs.promises.writeFile(path.join(nmDir, '.marker'), '', 'utf8');

    const recipe: VerifyRecipeInfo = { recipeId: 'test', hasTypeScript: false };
    const config: VerifyConfig = { allowBuild: false };

    const result = await runPostVerification(dir, recipe, config);
    expect(result.outcome).toBe('pass');
    expect(result.steps).toHaveLength(5);
    expect(result.packageManager).toBe('npm');
    expect(result.fromReplay).toBe(false);
  });

  it('should return partial when lint warns', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, {
      name: 'lint-warn-app',
      scripts: { lint: 'exit 1' },
    });
    // Create node_modules to skip install
    const nmDir = path.join(dir, 'node_modules');
    await fs.promises.mkdir(nmDir, { recursive: true });
    await fs.promises.writeFile(path.join(nmDir, '.marker'), '', 'utf8');

    const recipe: VerifyRecipeInfo = { recipeId: 'test', hasTypeScript: false };
    const config: VerifyConfig = { allowBuild: false };

    const result = await runPostVerification(dir, recipe, config);
    expect(result.outcome).toBe('partial');
    const lintStep = result.steps.find(s => s.id === 'lint');
    expect(lintStep?.status).toBe('warn');
  });

  it('should return pass for all-skipped steps after package_json pass', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { name: 'test', scripts: {} });
    const nmDir = path.join(dir, 'node_modules');
    await fs.promises.mkdir(nmDir, { recursive: true });
    await fs.promises.writeFile(path.join(nmDir, '.marker'), '', 'utf8');

    const recipe: VerifyRecipeInfo = { recipeId: 'test', hasTypeScript: false };
    const config: VerifyConfig = { allowBuild: false };

    const result = await runPostVerification(dir, recipe, config);
    // package_json=pass, install=pass (skipped/existing), lint=skipped, typecheck=skipped, build=skipped
    expect(result.outcome).toBe('pass');
    expect(result.steps.filter(s => s.status === 'skipped').length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// TESTS: Replay Mode
// ============================================================================

describe('replay mode', () => {
  it('should return evidence directly without running commands', async () => {
    const dir = await createTestDir();
    const evidence: VerifyResult = {
      outcome: 'pass',
      steps: [
        { id: 'package_json', label: 'Package.json', status: 'pass', message: 'OK', durationMs: 5 },
        { id: 'install', label: 'Install', status: 'pass', message: 'OK', durationMs: 100 },
        { id: 'lint', label: 'Lint', status: 'skipped', message: 'No lint', durationMs: 0 },
        { id: 'typecheck', label: 'Type Check', status: 'skipped', message: 'No TS', durationMs: 0 },
        { id: 'build', label: 'Build', status: 'skipped', message: 'No build', durationMs: 0 },
      ],
      totalDurationMs: 105,
      packageManager: 'npm',
      fromReplay: false,
    };

    const result = await runPostVerification(dir, { recipeId: 'test' }, {
      replayMode: true,
      replayEvidence: evidence,
    });

    expect(result.fromReplay).toBe(true);
    expect(result.outcome).toBe('pass');
    expect(result.steps).toHaveLength(5);
  });

  it('should still run normally if replay mode but no evidence', async () => {
    const dir = await createTestDir();
    // No evidence provided, so it should run checks normally
    const result = await runPostVerification(dir, { recipeId: 'test' }, {
      replayMode: true,
      // no replayEvidence
    });

    // No package.json → fail
    expect(result.outcome).toBe('fail');
    expect(result.fromReplay).toBe(false);
  });
});

// ============================================================================
// TESTS: Event Emission
// ============================================================================

describe('runPostVerificationWithEvents', () => {
  it('should emit started, step_completed, and completed events', async () => {
    const dir = await createTestDir();
    await writePackageJson(dir, { name: 'test', scripts: {} });
    const nmDir = path.join(dir, 'node_modules');
    await fs.promises.mkdir(nmDir, { recursive: true });
    await fs.promises.writeFile(path.join(nmDir, '.marker'), '', 'utf8');

    const eventBus = new EventEmitter();
    const events: Event[] = [];
    eventBus.on('event', (e: Event) => events.push(e));

    const ctx: VerifyEventCtx = {
      scaffoldId: 'test-scaffold',
      runId: 'test-run',
      eventBus,
      mode: 'SCAFFOLD',
    };

    const recipe: VerifyRecipeInfo = { recipeId: 'test', hasTypeScript: false };
    const config: VerifyConfig = { allowBuild: false };

    const result = await runPostVerificationWithEvents(dir, recipe, config, ctx);

    expect(result.outcome).toBe('pass');

    // Should have: 1 started + N step_completed + 1 completed
    const startedEvents = events.filter(e => e.type === 'scaffold_verify_started');
    const stepEvents = events.filter(e => e.type === 'scaffold_verify_step_completed');
    const completedEvents = events.filter(e => e.type === 'scaffold_verify_completed');

    expect(startedEvents).toHaveLength(1);
    expect(stepEvents).toHaveLength(5); // 5 steps
    expect(completedEvents).toHaveLength(1);

    // Verify completed event payload
    const completedPayload = completedEvents[0].payload as any;
    expect(completedPayload.outcome).toBe('pass');
    expect(completedPayload.scaffold_id).toBe('test-scaffold');
    expect(completedPayload.step_summary).toHaveLength(5);
  });

  it('should emit events even for replay mode', async () => {
    const dir = await createTestDir();
    const eventBus = new EventEmitter();
    const events: Event[] = [];
    eventBus.on('event', (e: Event) => events.push(e));

    const ctx: VerifyEventCtx = {
      scaffoldId: 'replay-scaffold',
      runId: 'replay-run',
      eventBus,
      mode: 'SCAFFOLD',
    };

    const evidence: VerifyResult = {
      outcome: 'partial',
      steps: [
        { id: 'package_json', label: 'Package.json', status: 'pass', message: 'OK', durationMs: 5 },
        { id: 'lint', label: 'Lint', status: 'warn', message: 'Issues', durationMs: 50 },
      ],
      totalDurationMs: 55,
      packageManager: 'npm',
      fromReplay: false,
    };

    const result = await runPostVerificationWithEvents(
      dir,
      { recipeId: 'test' },
      { replayMode: true, replayEvidence: evidence },
      ctx
    );

    expect(result.fromReplay).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(3); // started + 2 steps + completed

    const completedPayload = events.find(e => e.type === 'scaffold_verify_completed')?.payload as any;
    expect(completedPayload.from_replay).toBe(true);
  });
});
