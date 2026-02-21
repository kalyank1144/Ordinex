/**
 * Step 44: Post-Scaffold Verification Pipeline
 *
 * Runs after scaffold files are created and before showing final success.
 * Executes a sequence of verification steps to validate the scaffolded project:
 *
 * STEPS:
 * 1. package.json validation  - Check existence and parse
 * 2. dependency install        - npm/pnpm/yarn install (timeout-protected, 1 retry)
 * 3. lint                      - Run lint script if exists (warn on failure, not fail)
 * 4. typecheck                 - Run tsc if TypeScript project
 * 5. build                     - Run build script if exists and policy allows
 *
 * EVENTS:
 * - scaffold_verify_started          - Pipeline begins
 * - scaffold_verify_step_completed   - Each step result
 * - scaffold_verify_completed        - Final result (pass/partial/fail)
 *
 * CRITICAL RULES:
 * - Replay mode: NEVER run commands; load from evidence only
 * - Lint failures are WARN, not hard fail
 * - Install failures get 1 bounded retry
 * - All results are serializable (replay-safe)
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { EventEmitter } from 'events';
import type { Event, Mode } from '../types';

// ============================================================================
// TYPES
// ============================================================================

/** Status of an individual verification step */
export type VerifyStepStatus = 'pass' | 'warn' | 'fail' | 'skipped' | 'running';

/** Overall verification outcome */
export type VerifyOutcome = 'pass' | 'partial' | 'fail';

/** Individual verification step result */
export interface VerifyStepResult {
  /** Step identifier */
  id: 'package_json' | 'install' | 'lint' | 'typecheck' | 'build';
  /** Human-readable label */
  label: string;
  /** Step outcome */
  status: VerifyStepStatus;
  /** Result message */
  message: string;
  /** Command that was run (if any) */
  command?: string;
  /** Truncated command output on failure */
  output?: string;
  /** Duration in ms */
  durationMs: number;
  /** Whether this step was retried */
  retried?: boolean;
}

/** Full verification pipeline result */
export interface VerifyResult {
  /** Overall outcome */
  outcome: VerifyOutcome;
  /** Individual step results */
  steps: VerifyStepResult[];
  /** Total duration in ms */
  totalDurationMs: number;
  /** Detected package manager */
  packageManager: 'npm' | 'pnpm' | 'yarn';
  /** Whether this result came from replay (evidence) */
  fromReplay: boolean;
}

/** Configuration for the verification pipeline */
export interface VerifyConfig {
  /** Maximum time for install step in ms (default: 120000 = 2 min) */
  installTimeoutMs?: number;
  /** Maximum time for lint step in ms (default: 60000 = 1 min) */
  lintTimeoutMs?: number;
  /** Maximum time for typecheck step in ms (default: 60000 = 1 min) */
  typecheckTimeoutMs?: number;
  /** Maximum time for build step in ms (default: 120000 = 2 min) */
  buildTimeoutMs?: number;
  /** Whether build step is allowed (default: true) */
  allowBuild?: boolean;
  /** Max retries for install failures (default: 1) */
  installMaxRetries?: number;
  /** Replay mode: skip commands, load from evidence */
  replayMode?: boolean;
  /** Evidence from a previous run (used in replay mode) */
  replayEvidence?: VerifyResult;
}

/** Recipe info needed for verification */
export interface VerifyRecipeInfo {
  recipeId: string;
  recipeName?: string;
  hasTypeScript?: boolean;
}

/** Context for event emission */
export interface VerifyEventCtx {
  scaffoldId: string;
  runId: string;
  eventBus: EventEmitter;
  mode: Mode;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_INSTALL_TIMEOUT = 120_000;  // 2 minutes
const DEFAULT_LINT_TIMEOUT = 60_000;      // 1 minute
const DEFAULT_TYPECHECK_TIMEOUT = 60_000; // 1 minute
const DEFAULT_BUILD_TIMEOUT = 120_000;    // 2 minutes
const DEFAULT_INSTALL_MAX_RETRIES = 1;
const MAX_OUTPUT_CHARS = 8000;

// ============================================================================
// MAIN PIPELINE
// ============================================================================

/**
 * Run the full post-scaffold verification pipeline.
 *
 * @param targetDir - Directory where scaffold files were created
 * @param recipe    - Recipe info for context (TypeScript detection, etc.)
 * @param config    - Pipeline configuration
 * @returns VerifyResult with outcome and per-step results
 */
export async function runPostVerification(
  targetDir: string,
  recipe: VerifyRecipeInfo,
  config: VerifyConfig = {}
): Promise<VerifyResult> {
  const startTime = Date.now();

  // Replay mode: return evidence directly
  if (config.replayMode && config.replayEvidence) {
    return { ...config.replayEvidence, fromReplay: true };
  }

  const packageManager = detectPackageManager(targetDir);
  const steps: VerifyStepResult[] = [];

  // Step 1: package.json validation
  steps.push(verifyPackageJson(targetDir));

  // If package.json doesn't exist, skip remaining steps
  if (steps[0].status === 'fail') {
    return {
      outcome: 'fail',
      steps,
      totalDurationMs: Date.now() - startTime,
      packageManager,
      fromReplay: false,
    };
  }

  // Step 2: dependency install (with retry)
  const installResult = await runInstallStep(
    targetDir,
    packageManager,
    config.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT,
    config.installMaxRetries ?? DEFAULT_INSTALL_MAX_RETRIES
  );
  steps.push(installResult);

  // Step 3: lint (if script exists) — warn on failure
  const lintResult = await runLintStep(
    targetDir,
    packageManager,
    config.lintTimeoutMs ?? DEFAULT_LINT_TIMEOUT
  );
  steps.push(lintResult);

  // Step 4: typecheck (if TypeScript)
  const isTS = recipe.hasTypeScript ?? detectTypeScript(targetDir);
  const typecheckResult = await runTypecheckStep(
    targetDir,
    packageManager,
    isTS,
    config.typecheckTimeoutMs ?? DEFAULT_TYPECHECK_TIMEOUT
  );
  steps.push(typecheckResult);

  // Step 5: build (if script exists and policy allows)
  const allowBuild = config.allowBuild !== false;
  const buildResult = await runBuildStep(
    targetDir,
    packageManager,
    allowBuild,
    config.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT
  );
  steps.push(buildResult);

  // Compute outcome
  const outcome = computeOutcome(steps);
  const totalDurationMs = Date.now() - startTime;

  return {
    outcome,
    steps,
    totalDurationMs,
    packageManager,
    fromReplay: false,
  };
}

/**
 * Run verification with event emission for integration into scaffold flow.
 */
export async function runPostVerificationWithEvents(
  targetDir: string,
  recipe: VerifyRecipeInfo,
  config: VerifyConfig,
  ctx: VerifyEventCtx
): Promise<VerifyResult> {
  // Emit started event
  emitVerifyEvent(ctx, 'scaffold_verify_started', {
    scaffold_id: ctx.scaffoldId,
    run_id: ctx.runId,
    target_directory: targetDir,
    recipe_id: recipe.recipeId,
    replay_mode: config.replayMode ?? false,
    created_at_iso: new Date().toISOString(),
  });

  const result = await runPostVerification(targetDir, recipe, config);

  // Emit per-step events
  for (const step of result.steps) {
    emitVerifyEvent(ctx, 'scaffold_verify_step_completed', {
      scaffold_id: ctx.scaffoldId,
      run_id: ctx.runId,
      step_id: step.id,
      step_label: step.label,
      status: step.status,
      message: step.message,
      command: step.command,
      duration_ms: step.durationMs,
      retried: step.retried ?? false,
    });
  }

  // Emit completed event
  emitVerifyEvent(ctx, 'scaffold_verify_completed', {
    scaffold_id: ctx.scaffoldId,
    run_id: ctx.runId,
    outcome: result.outcome,
    total_duration_ms: result.totalDurationMs,
    package_manager: result.packageManager,
    from_replay: result.fromReplay,
    step_summary: result.steps.map(s => ({
      id: s.id,
      status: s.status,
      duration_ms: s.durationMs,
    })),
  });

  return result;
}

// ============================================================================
// INDIVIDUAL STEPS
// ============================================================================

/**
 * Step 1: Validate package.json exists and is parseable
 */
export function verifyPackageJson(targetDir: string): VerifyStepResult {
  const start = Date.now();
  const pkgPath = path.join(targetDir, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return {
      id: 'package_json',
      label: 'Package.json',
      status: 'fail',
      message: 'package.json not found in target directory',
      durationMs: Date.now() - start,
    };
  }

  try {
    const content = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(content);

    if (!pkg.name) {
      return {
        id: 'package_json',
        label: 'Package.json',
        status: 'warn',
        message: 'package.json exists but has no "name" field',
        durationMs: Date.now() - start,
      };
    }

    return {
      id: 'package_json',
      label: 'Package.json',
      status: 'pass',
      message: `Valid package.json found (${pkg.name})`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'package_json',
      label: 'Package.json',
      status: 'fail',
      message: `package.json parse error: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Step 2: Install dependencies with timeout and bounded retry
 */
export async function runInstallStep(
  targetDir: string,
  packageManager: 'npm' | 'pnpm' | 'yarn',
  timeoutMs: number,
  maxRetries: number
): Promise<VerifyStepResult> {
  const start = Date.now();

  // Check if node_modules already exists (maybe install already ran)
  const nodeModulesPath = path.join(targetDir, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    const entries = fs.readdirSync(nodeModulesPath);
    if (entries.length > 0) {
      return {
        id: 'install',
        label: 'Install Dependencies',
        status: 'pass',
        message: 'node_modules already present, skipping install',
        durationMs: Date.now() - start,
      };
    }
  }

  const installCmd = `${packageManager} install`;
  let lastError: string | undefined;
  let retried = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      retried = true;
    }

    try {
      await execAsync(installCmd, {
        cwd: targetDir,
        timeout: timeoutMs,
        env: { ...process.env, CI: 'true' },
      });

      return {
        id: 'install',
        label: 'Install Dependencies',
        status: 'pass',
        message: retried
          ? `Dependencies installed successfully (after retry)`
          : `Dependencies installed successfully`,
        command: installCmd,
        durationMs: Date.now() - start,
        retried,
      };
    } catch (err: any) {
      lastError = truncateOutput(
        err.stderr?.toString() || err.stdout?.toString() || err.message || String(err)
      );
    }
  }

  return {
    id: 'install',
    label: 'Install Dependencies',
    status: 'fail',
    message: `Install failed after ${maxRetries + 1} attempt(s)`,
    command: installCmd,
    output: lastError,
    durationMs: Date.now() - start,
    retried,
  };
}

/**
 * Step 3: Run lint if script exists. Lint failures are WARN, not fail.
 */
export async function runLintStep(
  targetDir: string,
  packageManager: 'npm' | 'pnpm' | 'yarn',
  timeoutMs: number
): Promise<VerifyStepResult> {
  const start = Date.now();

  if (!hasScript(targetDir, 'lint')) {
    return {
      id: 'lint',
      label: 'Lint',
      status: 'skipped',
      message: 'No lint script found in package.json',
      durationMs: Date.now() - start,
    };
  }

  const cmd = runScriptCmd(packageManager, 'lint');

  try {
    await execAsync(cmd, {
      cwd: targetDir,
      timeout: timeoutMs,
    });

    return {
      id: 'lint',
      label: 'Lint',
      status: 'pass',
      message: 'Lint passed',
      command: cmd,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const output = truncateOutput(
      err.stderr?.toString() || err.stdout?.toString() || err.message || String(err)
    );

    return {
      id: 'lint',
      label: 'Lint',
      status: 'warn',
      message: 'Lint reported issues (non-blocking)',
      command: cmd,
      output,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Step 4: Run typecheck if TypeScript project
 */
export async function runTypecheckStep(
  targetDir: string,
  packageManager: 'npm' | 'pnpm' | 'yarn',
  isTypeScript: boolean,
  timeoutMs: number
): Promise<VerifyStepResult> {
  const start = Date.now();

  if (!isTypeScript) {
    return {
      id: 'typecheck',
      label: 'Type Check',
      status: 'skipped',
      message: 'Not a TypeScript project',
      durationMs: Date.now() - start,
    };
  }

  const hasTypecheckScript = hasScript(targetDir, 'typecheck');
  const hasTscScript = hasScript(targetDir, 'tsc');

  let cmd: string;
  if (hasTypecheckScript) {
    cmd = runScriptCmd(packageManager, 'typecheck');
  } else if (hasTscScript) {
    cmd = runScriptCmd(packageManager, 'tsc');
  } else {
    cmd = 'npx tsc --noEmit';
  }

  try {
    await execAsync(cmd, {
      cwd: targetDir,
      timeout: timeoutMs,
    });

    return {
      id: 'typecheck',
      label: 'Type Check',
      status: 'pass',
      message: 'Type check passed',
      command: cmd,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const output = truncateOutput(
      err.stderr?.toString() || err.stdout?.toString() || err.message || String(err)
    );

    return {
      id: 'typecheck',
      label: 'Type Check',
      status: 'fail',
      message: 'Type check failed',
      command: cmd,
      output,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Step 5: Run build if script exists and policy allows
 */
export async function runBuildStep(
  targetDir: string,
  packageManager: 'npm' | 'pnpm' | 'yarn',
  allowBuild: boolean,
  timeoutMs: number
): Promise<VerifyStepResult> {
  const start = Date.now();

  if (!allowBuild) {
    return {
      id: 'build',
      label: 'Build',
      status: 'skipped',
      message: 'Build step disabled by policy',
      durationMs: Date.now() - start,
    };
  }

  if (!hasScript(targetDir, 'build')) {
    return {
      id: 'build',
      label: 'Build',
      status: 'skipped',
      message: 'No build script found in package.json',
      durationMs: Date.now() - start,
    };
  }

  const cmd = runScriptCmd(packageManager, 'build');

  try {
    await execAsync(cmd, {
      cwd: targetDir,
      timeout: timeoutMs,
    });

    return {
      id: 'build',
      label: 'Build',
      status: 'pass',
      message: 'Build completed successfully',
      command: cmd,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const output = truncateOutput(
      err.stderr?.toString() || err.stdout?.toString() || err.message || String(err)
    );

    return {
      id: 'build',
      label: 'Build',
      status: 'fail',
      message: 'Build failed',
      command: cmd,
      output,
      durationMs: Date.now() - start,
    };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Detect package manager from lockfiles
 */
export function detectPackageManager(targetDir: string): 'npm' | 'pnpm' | 'yarn' {
  if (fs.existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(targetDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Detect if project uses TypeScript
 */
export function detectTypeScript(targetDir: string): boolean {
  // Check tsconfig.json
  if (fs.existsSync(path.join(targetDir, 'tsconfig.json'))) return true;

  // Check package.json dependencies
  try {
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps && deps['typescript']) return true;
    }
  } catch {
    // Ignore parse errors
  }

  return false;
}

/**
 * Check if a script exists in package.json
 */
export function hasScript(targetDir: string, scriptName: string): boolean {
  try {
    const pkgPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return !!(pkg.scripts && pkg.scripts[scriptName]);
  } catch {
    return false;
  }
}

/**
 * Build the run-script command for the detected package manager
 */
export function runScriptCmd(packageManager: 'npm' | 'pnpm' | 'yarn', script: string): string {
  return `${packageManager} run ${script}`;
}

/**
 * Truncate output to MAX_OUTPUT_CHARS
 */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return output.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated)';
}

/**
 * Compute overall outcome from steps
 */
export function computeOutcome(steps: VerifyStepResult[]): VerifyOutcome {
  const hasAnyFail = steps.some(s => s.status === 'fail');
  const hasAnyWarn = steps.some(s => s.status === 'warn');
  const hasAnyPass = steps.some(s => s.status === 'pass');

  if (hasAnyFail) {
    // If we have at least one pass alongside failures, it's partial
    if (hasAnyPass) return 'partial';
    return 'fail';
  }

  if (hasAnyWarn) return 'partial';

  return 'pass';
}

// ============================================================================
// EVENT EMISSION
// ============================================================================

/**
 * Emit a verification event onto the event bus
 */
function emitVerifyEvent(
  ctx: VerifyEventCtx,
  type: string,
  payload: Record<string, unknown>
): void {
  const event: Event = {
    event_id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    task_id: ctx.runId,
    timestamp: new Date().toISOString(),
    type: type as Event['type'],
    mode: ctx.mode,
    stage: 'edit',
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };

  ctx.eventBus.emit('event', event);
}
