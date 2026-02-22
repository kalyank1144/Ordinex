/**
 * Quality Gate Pipeline — Mandatory checks after each scaffold stage.
 *
 * Gate order:
 *   1. Deterministic autofix (cheap)
 *   2. tsc --noEmit
 *   3. eslint
 *   4. npm run build (or recipe-equivalent)
 *   5. Retry deterministic autofix if needed
 *   6. Bounded LLM repair (max 2 attempts, external)
 *   7. Fail safely → Doctor Card
 *
 * This module orchestrates the pipeline. It does NOT include the existing
 * pre-apply quality gates from qualityGates.ts (disk/perm/memory checks).
 * Those remain for preflight. This module handles *code* quality after generation.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import * as fs from 'fs';
import * as path from 'path';
import type { ScaffoldStage, RecipeGateCommands, DoctorStatus } from './blueprintSchema';
import { DEFAULT_GATE_COMMANDS } from './blueprintSchema';
import { runDeterministicAutofix } from './deterministicAutofix';
import type { AutofixResult } from './deterministicAutofix';

// ============================================================================
// TYPES
// ============================================================================

export type GateCheckName = 'autofix' | 'tsc' | 'eslint' | 'build' | 'dev_smoke';

export type GateCheckStatus = 'pass' | 'fail' | 'skip' | 'warning';

export interface GateCheckResult {
  name: GateCheckName;
  status: GateCheckStatus;
  output?: string;
  durationMs: number;
  command?: string;
}

export interface PipelineResult {
  stage: ScaffoldStage;
  passed: boolean;
  checks: GateCheckResult[];
  autofixResult?: AutofixResult;
  doctorStatus: Partial<DoctorStatus>;
}

export interface PipelineOptions {
  stage: ScaffoldStage;
  projectDir: string;
  commands?: Partial<RecipeGateCommands>;
  skipBuild?: boolean;
  skipLint?: boolean;
  timeout?: number;
}

// ============================================================================
// COMMAND RESOLUTION
// ============================================================================

/**
 * Resolve gate commands from recipe config, package.json scripts, or defaults.
 */
function resolveCommands(projectDir: string, overrides?: Partial<RecipeGateCommands>): RecipeGateCommands {
  const resolved = { ...DEFAULT_GATE_COMMANDS, ...overrides };

  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};

      if (scripts.typecheck) resolved.tsc = 'npm run typecheck';
      else if (scripts['type-check']) resolved.tsc = 'npm run type-check';

      if (scripts.lint) resolved.eslint = 'npm run lint';

      if (scripts.build) resolved.build = 'npm run build';

      if (scripts.dev) resolved.dev = 'npm run dev';
    } catch { /* use defaults */ }
  }

  return resolved;
}

// ============================================================================
// INDIVIDUAL GATES
// ============================================================================

async function runGateCommand(
  name: GateCheckName,
  command: string,
  projectDir: string,
  timeoutMs: number,
): Promise<GateCheckResult> {
  const start = Date.now();
  try {
    const { stdout } = await execAsync(command, {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: timeoutMs,
      env: { ...process.env, NODE_ENV: 'production', FORCE_COLOR: '0' },
    });
    return {
      name,
      status: 'pass',
      output: (stdout || '').slice(0, 4000),
      durationMs: Date.now() - start,
      command,
    };
  } catch (err: any) {
    const output = (err.stdout || '') + '\n' + (err.stderr || '');
    return {
      name,
      status: 'fail',
      output: output.slice(0, 4000),
      durationMs: Date.now() - start,
      command,
    };
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Run the full quality gate pipeline for a scaffold stage.
 * Returns results suitable for Doctor Card rendering and context.json updates.
 */
export async function runQualityGatePipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { stage, projectDir, commands: cmdOverrides, skipBuild, skipLint } = opts;
  const timeout = opts.timeout || 120_000;
  const commands = resolveCommands(projectDir, cmdOverrides);
  const checks: GateCheckResult[] = [];
  let autofixResult: AutofixResult | undefined;

  // Step 1: Deterministic autofix
  try {
    autofixResult = await runDeterministicAutofix(projectDir);
    checks.push({
      name: 'autofix',
      status: autofixResult.applied ? 'pass' : 'skip',
      output: autofixResult.fixes.map(f => f.description).join('; ') || 'No fixes needed',
      durationMs: 0,
    });
  } catch (err: any) {
    checks.push({
      name: 'autofix',
      status: 'warning',
      output: err.message,
      durationMs: 0,
    });
  }

  // Step 2: TypeScript check
  const tscResult = await runGateCommand('tsc', commands.tsc, projectDir, timeout);
  checks.push(tscResult);

  // Step 3: ESLint
  if (!skipLint) {
    const eslintResult = await runGateCommand('eslint', commands.eslint, projectDir, timeout);
    checks.push(eslintResult);
  } else {
    checks.push({ name: 'eslint', status: 'skip', durationMs: 0 });
  }

  // Step 4: Build
  if (!skipBuild) {
    const buildResult = await runGateCommand('build', commands.build, projectDir, timeout);
    checks.push(buildResult);
  } else {
    checks.push({ name: 'build', status: 'skip', durationMs: 0 });
  }

  // Step 5: If tsc or build failed, retry autofix + re-check
  const tscFailed = tscResult.status === 'fail';
  const buildFailed = checks.find(c => c.name === 'build')?.status === 'fail';

  if (tscFailed || buildFailed) {
    try {
      const retryAutofix = await runDeterministicAutofix(projectDir);
      if (retryAutofix.applied) {
        if (tscFailed) {
          const retry = await runGateCommand('tsc', commands.tsc, projectDir, timeout);
          const idx = checks.findIndex(c => c.name === 'tsc');
          if (idx >= 0) checks[idx] = retry;
        }
        if (buildFailed && !skipBuild) {
          const retry = await runGateCommand('build', commands.build, projectDir, timeout);
          const idx = checks.findIndex(c => c.name === 'build');
          if (idx >= 0) checks[idx] = retry;
        }
      }
    } catch { /* autofix retry failed — leave original results */ }
  }

  // Compute overall pass/fail
  const criticalChecks = checks.filter(c => c.name !== 'autofix');
  const passed = criticalChecks.every(c => c.status === 'pass' || c.status === 'skip');

  // Build doctor status
  const doctorStatus: Partial<DoctorStatus> = {
    tsc: checks.find(c => c.name === 'tsc')?.status === 'pass' ? 'pass' : checks.find(c => c.name === 'tsc')?.status === 'skip' ? 'unknown' : 'fail',
    eslint: checks.find(c => c.name === 'eslint')?.status === 'pass' ? 'pass' : checks.find(c => c.name === 'eslint')?.status === 'skip' ? 'unknown' : 'fail',
    build: checks.find(c => c.name === 'build')?.status === 'pass' ? 'pass' : checks.find(c => c.name === 'build')?.status === 'skip' ? 'unknown' : 'fail',
  };

  return { stage, passed, checks, autofixResult, doctorStatus };
}

/**
 * Run only the dev server smoke test gate.
 * Starts the dev server, waits for ready signal, then stops.
 */
export function runDevSmokeGate(
  projectDir: string,
  devCommand: string = 'npm run dev',
): GateCheckResult {
  // Dev smoke is handled by processManager externally;
  // this is a placeholder contract for the pipeline integration.
  return {
    name: 'dev_smoke',
    status: 'skip',
    output: 'Dev smoke test delegated to processManager',
    durationMs: 0,
    command: devCommand,
  };
}
