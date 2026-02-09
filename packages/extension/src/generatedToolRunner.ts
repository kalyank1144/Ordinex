/**
 * V7: GeneratedToolRunner - Best-Effort Isolated Execution
 *
 * Runs approved generated tools with:
 * - Static scan blocklist (child_process, process.env, dynamic import/require)
 * - Environment variable scrubbing (strip API keys, secrets)
 * - Timeout enforcement with process-tree kill
 * - Policy gate (disabled / prompt / auto)
 *
 * SECURITY NOTE: This is NOT a secure sandbox. It's best-effort isolation.
 * Default policy is "prompt" — user must approve each execution.
 *
 * Reuses the same kill-tree approach as ProcessManager:
 *   Unix:    spawn detached, process.kill(-pid, signal)
 *   Windows: taskkill /pid X /T /F
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import type {
  ToolRunResult,
  ToolRunFailureType,
  ToolExecutionPolicy,
  ToolAllowPolicy,
} from 'core';

const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 200 * 1024; // 200KB

// ============================================================================
// STATIC SCAN — Blocklist
// ============================================================================

/**
 * Patterns that are always blocked in generated tool code.
 * If any match, the tool is rejected before execution.
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, reason: 'child_process import via require' },
  { pattern: /from\s+['"]child_process['"]/, reason: 'child_process import via ESM' },
  { pattern: /require\s*\(\s*['"]node:child_process['"]\s*\)/, reason: 'node:child_process import via require' },
  { pattern: /from\s+['"]node:child_process['"]/, reason: 'node:child_process import via ESM' },
  { pattern: /process\.env\b/, reason: 'direct process.env access' },
  // Dynamic imports: import(variable), import(expr)
  // Match import() where argument is NOT a string literal
  { pattern: /\bimport\s*\(\s*[^'"`\s]/, reason: 'dynamic import() with non-literal argument' },
  // Dynamic require: require(variable)
  // Match require() where argument is NOT a string literal
  { pattern: /require\s*\(\s*[^'"`\s]/, reason: 'dynamic require() with non-literal argument' },
  // Eval-based code execution
  { pattern: /\beval\s*\(/, reason: 'eval() usage' },
  { pattern: /new\s+Function\s*\(/, reason: 'new Function() constructor' },
];

/**
 * Scan tool code for blocked patterns.
 * Returns null if clean, or the reason string if blocked.
 */
export function scanForBlockedPatterns(code: string): string | null {
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return reason;
    }
  }
  return null;
}

// ============================================================================
// ENV SCRUBBING
// ============================================================================

/**
 * Keys that look like secrets — stripped from the child environment.
 */
const SECRET_KEY_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /auth/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /^AWS_/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^GITHUB_TOKEN$/i,
  /^NPM_TOKEN$/i,
  /^DATABASE_URL$/i,
];

function buildScrubbedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const isSecret = SECRET_KEY_PATTERNS.some(p => p.test(key));
    if (!isSecret) {
      env[key] = value;
    }
  }
  return env;
}

// ============================================================================
// PROCESS TREE KILL (reused from ProcessManager pattern)
// ============================================================================

function killProcessTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  const pid = child.pid;
  if (!pid) return;

  try {
    if (IS_WINDOWS) {
      const forceFlag = signal === 'SIGKILL' ? ' /F' : '';
      execSync(`taskkill /pid ${pid} /T${forceFlag}`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already dead
    }
  }
}

// ============================================================================
// RUNNER
// ============================================================================

export interface RunToolOptions {
  /** Tool name */
  tool_name: string;
  /** Path to the .js file to execute */
  code_path: string;
  /** Working directory for the tool */
  cwd: string;
  /** JSON-stringified input arguments */
  input_json: string;
  /** Timeout in milliseconds (default: 30s) */
  timeout_ms?: number;
  /** Tool's allow policy */
  allow?: ToolAllowPolicy;
}

export interface RunToolResult {
  success: true;
  result: ToolRunResult;
}

export interface RunToolFailure {
  success: false;
  failure_type: ToolRunFailureType;
  reason: string;
}

/**
 * Run a generated tool with best-effort isolation.
 *
 * Steps:
 * 1. Static scan the code for blocked patterns
 * 2. Build scrubbed environment
 * 3. Spawn node with the tool's .js file
 * 4. Pipe input via stdin, capture stdout/stderr
 * 5. Enforce timeout with kill-tree
 */
export async function runGeneratedTool(
  opts: RunToolOptions,
): Promise<RunToolResult | RunToolFailure> {
  const timeoutMs = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();

  // Step 1: Static scan
  // (We scan the code at the code_path)
  let code: string;
  try {
    const fs = require('fs');
    code = fs.readFileSync(opts.code_path, 'utf-8');
  } catch (err) {
    return {
      success: false,
      failure_type: 'error',
      reason: `Failed to read tool code: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const blockReason = scanForBlockedPatterns(code);
  if (blockReason) {
    return {
      success: false,
      failure_type: 'blocked',
      reason: `Static scan blocked: ${blockReason}`,
    };
  }

  // Step 2: Build scrubbed env
  const env = buildScrubbedEnv();

  // Step 3: Spawn node with the tool
  // The tool reads JSON from stdin, writes JSON to stdout
  return new Promise<RunToolResult | RunToolFailure>((resolve) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const settle = (result: RunToolResult | RunToolFailure) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(result);
    };

    const child = spawn('node', [opts.code_path], {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !IS_WINDOWS,
    });

    if (!child.pid) {
      settle({
        success: false,
        failure_type: 'error',
        reason: 'Failed to spawn node process',
      });
      return;
    }

    // Step 4: Capture output with size limits
    child.stdout?.on('data', (data: Buffer) => {
      if (stdoutBuf.length < MAX_OUTPUT_BYTES) {
        stdoutBuf += data.toString();
        if (stdoutBuf.length > MAX_OUTPUT_BYTES) {
          stdoutBuf = stdoutBuf.substring(0, MAX_OUTPUT_BYTES);
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (stderrBuf.length < MAX_OUTPUT_BYTES) {
        stderrBuf += data.toString();
        if (stderrBuf.length > MAX_OUTPUT_BYTES) {
          stderrBuf = stderrBuf.substring(0, MAX_OUTPUT_BYTES);
        }
      }
    });

    child.on('exit', (code) => {
      const durationMs = Date.now() - startTime;
      settle({
        success: true,
        result: {
          stdout: stdoutBuf,
          stderr: stderrBuf,
          exit_code: code ?? 1,
          duration_ms: durationMs,
        },
      });
    });

    child.on('error', (err) => {
      settle({
        success: false,
        failure_type: 'error',
        reason: err.message,
      });
    });

    // Step 5: Timeout enforcement with tree kill
    timeoutHandle = setTimeout(() => {
      killProcessTree(child, 'SIGTERM');
      // Force kill after 3s
      setTimeout(() => {
        if (!child.killed) {
          killProcessTree(child, 'SIGKILL');
        }
      }, 3000);

      settle({
        success: false,
        failure_type: 'timeout',
        reason: `Tool execution timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    // Pipe input and close stdin
    if (child.stdin) {
      child.stdin.write(opts.input_json);
      child.stdin.end();
    }
  });
}
