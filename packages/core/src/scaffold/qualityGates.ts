/**
 * Step 43: Scaffold Quality Gates
 *
 * Enterprise-grade quality validation for scaffold operations.
 * Ensures safe, reliable scaffold apply with multiple validation layers.
 *
 * QUALITY GATES:
 * 1. Disk Space Gate - Ensure sufficient storage
 * 2. Permission Gate - Validate write permissions
 * 3. Memory Gate - Check available system memory
 * 4. Network Gate - Verify connectivity for package installs
 * 5. Atomic Apply Gate - Checkpoint integration for rollback
 * 6. Post-Apply Gate - Validate scaffold output integrity
 *
 * CRITICAL RULES:
 * - All gates must pass before scaffold apply
 * - Gates are idempotent and replay-safe
 * - Gate failures emit structured events for UX handling
 * - Atomic apply with checkpoint ensures rollback capability
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import * as https from 'https';
import { EventEmitter } from 'events';
import type { Event, Mode, Stage } from '../types';
import type { RecipePlan, FilePlanItem } from './recipeTypes';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Quality gate check result
 */
export type GateStatus = 'passed' | 'failed' | 'warning' | 'skipped';

/**
 * Individual gate result
 */
export interface GateResult {
  /** Gate identifier */
  gate: QualityGate;
  /** Gate status */
  status: GateStatus;
  /** Human-readable message */
  message: string;
  /** Detailed diagnostics */
  details?: Record<string, unknown>;
  /** Timestamp of check */
  timestamp: string;
  /** Duration of check in ms */
  durationMs: number;
}

/**
 * Complete quality check result
 */
export interface QualityCheckResult {
  /** Overall pass/fail */
  passed: boolean;
  /** Individual gate results */
  gates: GateResult[];
  /** Critical failures that must be resolved */
  criticalFailures: GateResult[];
  /** Non-critical warnings */
  warnings: GateResult[];
  /** Total check duration in ms */
  totalDurationMs: number;
  /** Timestamp of check */
  timestamp: string;
}

/**
 * Quality gate identifiers
 */
export type QualityGate =
  | 'disk_space'
  | 'write_permission'
  | 'memory'
  | 'network'
  | 'path_validation'
  | 'checkpoint_ready'
  | 'post_apply_integrity';

/**
 * Gate configuration options
 */
export interface GateConfig {
  /** Minimum required disk space in bytes (default: 500MB) */
  minDiskSpaceBytes?: number;
  /** Minimum required memory in bytes (default: 256MB) */
  minMemoryBytes?: number;
  /** Network check timeout in ms (default: 5000) */
  networkTimeoutMs?: number;
  /** Whether network gate is critical (default: false) */
  networkRequired?: boolean;
  /** Skip specific gates */
  skipGates?: QualityGate[];
}

/**
 * Atomic apply context
 */
export interface AtomicApplyContext {
  /** Scaffold operation ID */
  scaffoldId: string;
  /** Target directory */
  targetDir: string;
  /** Recipe plan to apply */
  recipePlan: RecipePlan;
  /** Checkpoint directory */
  checkpointDir: string;
  /** Event emitter */
  eventBus: EventEmitter;
  /** Run ID */
  runId: string;
  /** Mode for events */
  mode: Mode;
  /** Merge mode for conflict handling (Step 43) */
  mergeMode?: 'abort' | 'skip_conflicts' | 'replace_all';
}

/**
 * Atomic apply result (named ScaffoldAtomicApplyResult to avoid conflict with atomicDiffApply)
 */
export interface ScaffoldAtomicApplyResult {
  /** Whether apply succeeded */
  success: boolean;
  /** Checkpoint ID for rollback */
  checkpointId?: string;
  /** Files created */
  filesCreated: string[];
  /** Directories created */
  dirsCreated: string[];
  /** Error if failed */
  error?: string;
  /** Whether rollback was triggered */
  rolledBack?: boolean;
}

/**
 * Post-apply validation result
 */
export interface PostApplyValidation {
  /** Whether validation passed */
  passed: boolean;
  /** Files that were verified */
  verifiedFiles: string[];
  /** Files that failed verification */
  failedFiles: Array<{
    path: string;
    reason: string;
  }>;
  /** Directories verified */
  verifiedDirs: string[];
  /** Overall integrity score (0-100) */
  integrityScore: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default minimum disk space: 500MB */
const DEFAULT_MIN_DISK_SPACE = 500 * 1024 * 1024;

/** Default minimum memory: 256MB */
const DEFAULT_MIN_MEMORY = 256 * 1024 * 1024;

/** Default network timeout: 5 seconds */
const DEFAULT_NETWORK_TIMEOUT = 5000;

/** NPM registry URL for connectivity check */
const NPM_REGISTRY_HOST = 'registry.npmjs.org';

/** Path validation regex - no path traversal */
const SAFE_PATH_REGEX = /^[a-zA-Z0-9_\-./]+$/;

// ============================================================================
// MAIN QUALITY CHECK
// ============================================================================

/**
 * Run all quality gates before scaffold apply
 *
 * This is the main entry point for pre-apply validation.
 * All critical gates must pass for scaffold to proceed.
 *
 * @param targetDir - Target directory for scaffold
 * @param recipePlan - Recipe plan to be applied
 * @param config - Gate configuration
 * @returns Quality check result
 */
export async function runPreApplyQualityGates(
  targetDir: string,
  recipePlan: RecipePlan,
  config: GateConfig = {}
): Promise<QualityCheckResult> {
  const startTime = Date.now();
  const gates: GateResult[] = [];
  const skipGates = new Set(config.skipGates || []);

  // Gate 1: Path Validation
  if (!skipGates.has('path_validation')) {
    gates.push(await checkPathValidation(targetDir, recipePlan));
  }

  // Gate 2: Disk Space
  if (!skipGates.has('disk_space')) {
    gates.push(await checkDiskSpace(targetDir, recipePlan, config.minDiskSpaceBytes));
  }

  // Gate 3: Write Permission
  if (!skipGates.has('write_permission')) {
    gates.push(await checkWritePermission(targetDir));
  }

  // Gate 4: Memory
  if (!skipGates.has('memory')) {
    gates.push(await checkMemory(config.minMemoryBytes));
  }

  // Gate 5: Network (optional)
  if (!skipGates.has('network')) {
    gates.push(await checkNetwork(config.networkTimeoutMs, config.networkRequired));
  }

  // Categorize results
  const criticalFailures = gates.filter(g =>
    g.status === 'failed' && !isNonCriticalGate(g.gate, config)
  );
  const warnings = gates.filter(g =>
    g.status === 'warning' || (g.status === 'failed' && isNonCriticalGate(g.gate, config))
  );

  const totalDurationMs = Date.now() - startTime;

  return {
    passed: criticalFailures.length === 0,
    gates,
    criticalFailures,
    warnings,
    totalDurationMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Run post-apply quality validation
 *
 * Verifies scaffold output integrity after apply.
 *
 * @param targetDir - Target directory that was scaffolded
 * @param recipePlan - Recipe plan that was applied
 * @returns Post-apply validation result
 */
export async function runPostApplyValidation(
  targetDir: string,
  recipePlan: RecipePlan
): Promise<PostApplyValidation> {
  const verifiedFiles: string[] = [];
  const failedFiles: Array<{ path: string; reason: string }> = [];
  const verifiedDirs: string[] = [];

  // Verify each file in the recipe
  for (const file of recipePlan.files) {
    const fullPath = path.join(targetDir, file.path);

    try {
      const stat = await fs.promises.stat(fullPath);

      if (!stat.isFile()) {
        failedFiles.push({ path: file.path, reason: 'Not a file' });
        continue;
      }

      // Verify content exists and is non-empty (unless intentionally empty)
      const content = await fs.promises.readFile(fullPath, 'utf8');

      if (file.content && file.content.length > 0 && content.length === 0) {
        failedFiles.push({ path: file.path, reason: 'File is unexpectedly empty' });
        continue;
      }

      // Verify content matches (if provided)
      if (file.content && content !== file.content) {
        // Allow minor whitespace differences
        const normalizedExpected = normalizeWhitespace(file.content);
        const normalizedActual = normalizeWhitespace(content);

        if (normalizedExpected !== normalizedActual) {
          failedFiles.push({ path: file.path, reason: 'Content mismatch' });
          continue;
        }
      }

      verifiedFiles.push(file.path);
    } catch (err) {
      failedFiles.push({
        path: file.path,
        reason: `File not found or unreadable: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  // Verify directories
  const uniqueDirs = new Set<string>();
  for (const file of recipePlan.files) {
    const dir = path.dirname(file.path);
    if (dir !== '.') {
      uniqueDirs.add(dir);
    }
  }

  for (const dir of uniqueDirs) {
    const fullPath = path.join(targetDir, dir);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (stat.isDirectory()) {
        verifiedDirs.push(dir);
      }
    } catch {
      // Directory doesn't exist - not a critical error if files exist
    }
  }

  // Calculate integrity score
  const totalFiles = recipePlan.files.length;
  const successRate = totalFiles > 0 ? (verifiedFiles.length / totalFiles) * 100 : 100;
  const integrityScore = Math.round(successRate);

  return {
    passed: failedFiles.length === 0,
    verifiedFiles,
    failedFiles,
    verifiedDirs,
    integrityScore,
  };
}

// ============================================================================
// INDIVIDUAL GATE CHECKS
// ============================================================================

/**
 * Check path validation - no path traversal, valid characters
 */
async function checkPathValidation(
  targetDir: string,
  recipePlan: RecipePlan
): Promise<GateResult> {
  const startTime = Date.now();
  const issues: string[] = [];

  // Check target directory
  const resolvedTarget = path.resolve(targetDir);

  // Check each file in recipe for path traversal
  for (const file of recipePlan.files) {
    // Check for path traversal attempts
    if (file.path.includes('..')) {
      issues.push(`Path traversal detected in: ${file.path}`);
      continue;
    }

    // Check for absolute paths
    if (path.isAbsolute(file.path)) {
      issues.push(`Absolute path not allowed: ${file.path}`);
      continue;
    }

    // Validate resolved path stays within target
    const resolvedFile = path.resolve(targetDir, file.path);
    if (!resolvedFile.startsWith(resolvedTarget)) {
      issues.push(`Path escapes target directory: ${file.path}`);
    }

    // Check for dangerous characters
    if (!SAFE_PATH_REGEX.test(file.path.replace(/\\/g, '/'))) {
      // Allow some special chars, just warn
      issues.push(`Unusual characters in path: ${file.path}`);
    }
  }

  const durationMs = Date.now() - startTime;

  if (issues.length > 0) {
    return {
      gate: 'path_validation',
      status: 'failed',
      message: `Path validation failed: ${issues[0]}`,
      details: { issues, fileCount: recipePlan.files.length },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  }

  return {
    gate: 'path_validation',
    status: 'passed',
    message: `All ${recipePlan.files.length} paths validated`,
    details: { fileCount: recipePlan.files.length },
    timestamp: new Date().toISOString(),
    durationMs,
  };
}

/**
 * Check disk space availability
 */
async function checkDiskSpace(
  targetDir: string,
  recipePlan: RecipePlan,
  minBytes: number = DEFAULT_MIN_DISK_SPACE
): Promise<GateResult> {
  const startTime = Date.now();

  try {
    // Calculate required space from recipe
    let requiredBytes = 0;
    for (const file of recipePlan.files) {
      requiredBytes += file.content?.length || 0;
    }

    // Add buffer for package installs (estimate 100MB for node_modules)
    const estimatedTotal = requiredBytes + (100 * 1024 * 1024);
    const minRequired = Math.max(minBytes, estimatedTotal);

    // Get available disk space
    const targetPath = path.resolve(targetDir);
    const parentDir = fs.existsSync(targetPath) ? targetPath : path.dirname(targetPath);

    // Use statvfs on Unix or similar
    let availableBytes: number;

    try {
      const stats = await fs.promises.statfs(parentDir);
      availableBytes = stats.bavail * stats.bsize;
    } catch {
      // Fallback: assume sufficient space if statfs not available
      availableBytes = Number.MAX_SAFE_INTEGER;
    }

    const durationMs = Date.now() - startTime;

    if (availableBytes < minRequired) {
      return {
        gate: 'disk_space',
        status: 'failed',
        message: `Insufficient disk space: ${formatBytes(availableBytes)} available, ${formatBytes(minRequired)} required`,
        details: {
          availableBytes,
          requiredBytes: minRequired,
          recipeBytes: requiredBytes,
        },
        timestamp: new Date().toISOString(),
        durationMs,
      };
    }

    // Warning if less than 20% headroom
    const headroom = availableBytes / minRequired;
    if (headroom < 1.2) {
      return {
        gate: 'disk_space',
        status: 'warning',
        message: `Low disk space: ${formatBytes(availableBytes)} available (${Math.round(headroom * 100 - 100)}% headroom)`,
        details: { availableBytes, requiredBytes: minRequired, headroomPercent: headroom * 100 - 100 },
        timestamp: new Date().toISOString(),
        durationMs,
      };
    }

    return {
      gate: 'disk_space',
      status: 'passed',
      message: `Sufficient disk space: ${formatBytes(availableBytes)} available`,
      details: { availableBytes, requiredBytes: minRequired },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      gate: 'disk_space',
      status: 'warning',
      message: `Could not check disk space: ${err instanceof Error ? err.message : String(err)}`,
      details: { error: String(err) },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  }
}

/**
 * Check write permission on target directory
 */
async function checkWritePermission(targetDir: string): Promise<GateResult> {
  const startTime = Date.now();

  try {
    const targetPath = path.resolve(targetDir);

    // If directory exists, check write permission
    if (fs.existsSync(targetPath)) {
      try {
        await fs.promises.access(targetPath, fs.constants.W_OK);
      } catch {
        const durationMs = Date.now() - startTime;
        return {
          gate: 'write_permission',
          status: 'failed',
          message: `No write permission for directory: ${targetDir}`,
          details: { targetDir },
          timestamp: new Date().toISOString(),
          durationMs,
        };
      }
    } else {
      // Check parent directory is writable
      const parentDir = path.dirname(targetPath);

      if (!fs.existsSync(parentDir)) {
        const durationMs = Date.now() - startTime;
        return {
          gate: 'write_permission',
          status: 'failed',
          message: `Parent directory does not exist: ${parentDir}`,
          details: { targetDir, parentDir },
          timestamp: new Date().toISOString(),
          durationMs,
        };
      }

      try {
        await fs.promises.access(parentDir, fs.constants.W_OK);
      } catch {
        const durationMs = Date.now() - startTime;
        return {
          gate: 'write_permission',
          status: 'failed',
          message: `No write permission for parent directory: ${parentDir}`,
          details: { targetDir, parentDir },
          timestamp: new Date().toISOString(),
          durationMs,
        };
      }
    }

    // Verify by attempting to create a test file
    const testFile = path.join(
      fs.existsSync(targetPath) ? targetPath : path.dirname(targetPath),
      `.ordinex_write_test_${Date.now()}`
    );

    try {
      await fs.promises.writeFile(testFile, 'test');
      await fs.promises.unlink(testFile);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      return {
        gate: 'write_permission',
        status: 'failed',
        message: `Write test failed: ${err instanceof Error ? err.message : String(err)}`,
        details: { targetDir, testFile },
        timestamp: new Date().toISOString(),
        durationMs,
      };
    }

    const durationMs = Date.now() - startTime;
    return {
      gate: 'write_permission',
      status: 'passed',
      message: `Write permission verified for ${targetDir}`,
      details: { targetDir },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      gate: 'write_permission',
      status: 'failed',
      message: `Permission check failed: ${err instanceof Error ? err.message : String(err)}`,
      details: { error: String(err) },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  }
}

/**
 * Check available system memory
 */
async function checkMemory(minBytes: number = DEFAULT_MIN_MEMORY): Promise<GateResult> {
  const startTime = Date.now();

  try {
    const freeMemory = os.freemem();
    const totalMemory = os.totalmem();
    const usedPercent = ((totalMemory - freeMemory) / totalMemory) * 100;

    const durationMs = Date.now() - startTime;

    if (freeMemory < minBytes) {
      return {
        gate: 'memory',
        status: 'warning',
        message: `Low memory: ${formatBytes(freeMemory)} free (${usedPercent.toFixed(1)}% used)`,
        details: {
          freeBytes: freeMemory,
          totalBytes: totalMemory,
          usedPercent,
          minRequired: minBytes,
        },
        timestamp: new Date().toISOString(),
        durationMs,
      };
    }

    return {
      gate: 'memory',
      status: 'passed',
      message: `Sufficient memory: ${formatBytes(freeMemory)} free`,
      details: {
        freeBytes: freeMemory,
        totalBytes: totalMemory,
        usedPercent,
      },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      gate: 'memory',
      status: 'warning',
      message: `Could not check memory: ${err instanceof Error ? err.message : String(err)}`,
      details: { error: String(err) },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  }
}

/**
 * Check network connectivity for package installs
 */
async function checkNetwork(
  timeoutMs: number = DEFAULT_NETWORK_TIMEOUT,
  required: boolean = false
): Promise<GateResult> {
  const startTime = Date.now();

  return new Promise<GateResult>((resolve) => {
    const timeout = setTimeout(() => {
      const durationMs = Date.now() - startTime;
      resolve({
        gate: 'network',
        status: required ? 'failed' : 'warning',
        message: `Network check timed out after ${timeoutMs}ms`,
        details: { host: NPM_REGISTRY_HOST, timeoutMs },
        timestamp: new Date().toISOString(),
        durationMs,
      });
    }, timeoutMs);

    // HTTPS check to npm registry
    const req = https.request(
      {
        hostname: NPM_REGISTRY_HOST,
        port: 443,
        path: '/',
        method: 'HEAD',
        timeout: timeoutMs,
      },
      (res) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - startTime;

        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve({
            gate: 'network',
            status: 'passed',
            message: `NPM registry reachable (${durationMs}ms latency)`,
            details: {
              host: NPM_REGISTRY_HOST,
              statusCode: res.statusCode,
              latencyMs: durationMs,
            },
            timestamp: new Date().toISOString(),
            durationMs,
          });
        } else {
          resolve({
            gate: 'network',
            status: required ? 'failed' : 'warning',
            message: `NPM registry returned status ${res.statusCode}`,
            details: { host: NPM_REGISTRY_HOST, statusCode: res.statusCode },
            timestamp: new Date().toISOString(),
            durationMs,
          });
        }
      }
    );

    req.on('error', (err) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;
      resolve({
        gate: 'network',
        status: required ? 'failed' : 'warning',
        message: `Network check failed: ${err.message}`,
        details: { host: NPM_REGISTRY_HOST, error: err.message },
        timestamp: new Date().toISOString(),
        durationMs,
      });
    });

    req.end();
  });
}

/**
 * Check if checkpoint system is ready for atomic apply
 */
export async function checkCheckpointReady(
  checkpointDir: string
): Promise<GateResult> {
  const startTime = Date.now();

  try {
    // Ensure checkpoint directory exists or can be created
    if (!fs.existsSync(checkpointDir)) {
      const parentDir = path.dirname(checkpointDir);

      if (!fs.existsSync(parentDir)) {
        const durationMs = Date.now() - startTime;
        return {
          gate: 'checkpoint_ready',
          status: 'failed',
          message: `Checkpoint parent directory does not exist: ${parentDir}`,
          details: { checkpointDir, parentDir },
          timestamp: new Date().toISOString(),
          durationMs,
        };
      }

      // Try creating checkpoint directory
      try {
        await fs.promises.mkdir(checkpointDir, { recursive: true });
      } catch (err) {
        const durationMs = Date.now() - startTime;
        return {
          gate: 'checkpoint_ready',
          status: 'failed',
          message: `Cannot create checkpoint directory: ${err instanceof Error ? err.message : String(err)}`,
          details: { checkpointDir },
          timestamp: new Date().toISOString(),
          durationMs,
        };
      }
    }

    // Verify write permission
    const testFile = path.join(checkpointDir, `.checkpoint_test_${Date.now()}`);
    try {
      await fs.promises.writeFile(testFile, 'test');
      await fs.promises.unlink(testFile);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      return {
        gate: 'checkpoint_ready',
        status: 'failed',
        message: `Cannot write to checkpoint directory: ${err instanceof Error ? err.message : String(err)}`,
        details: { checkpointDir },
        timestamp: new Date().toISOString(),
        durationMs,
      };
    }

    const durationMs = Date.now() - startTime;
    return {
      gate: 'checkpoint_ready',
      status: 'passed',
      message: `Checkpoint system ready at ${checkpointDir}`,
      details: { checkpointDir },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      gate: 'checkpoint_ready',
      status: 'failed',
      message: `Checkpoint check failed: ${err instanceof Error ? err.message : String(err)}`,
      details: { error: String(err) },
      timestamp: new Date().toISOString(),
      durationMs,
    };
  }
}

// ============================================================================
// ATOMIC APPLY IMPLEMENTATION
// ============================================================================

/**
 * Apply scaffold atomically with rollback capability
 *
 * Creates checkpoint before apply, rolls back on failure.
 * This is the preferred method for safe scaffold apply.
 *
 * @param ctx - Atomic apply context
 * @returns Atomic apply result
 */
export async function atomicApplyScaffold(
  ctx: AtomicApplyContext
): Promise<ScaffoldAtomicApplyResult> {
  const filesCreated: string[] = [];
  const dirsCreated: string[] = [];
  let checkpointId: string | undefined;

  try {
    // Step 1: Create pre-apply checkpoint
    checkpointId = await createPreApplyCheckpoint(ctx);

    // Step 2: Create directories first
    const uniqueDirs = new Set<string>();
    for (const file of ctx.recipePlan.files) {
      const dir = path.dirname(file.path);
      if (dir !== '.') {
        uniqueDirs.add(dir);
      }
    }

    for (const dir of uniqueDirs) {
      const fullPath = path.join(ctx.targetDir, dir);
      if (!fs.existsSync(fullPath)) {
        await fs.promises.mkdir(fullPath, { recursive: true });
        dirsCreated.push(dir);
      }
    }

    // Step 3: Write files (respecting mergeMode)
    const mergeMode = ctx.mergeMode || 'abort';
    const skippedFiles: string[] = [];

    for (const file of ctx.recipePlan.files) {
      const fullPath = path.join(ctx.targetDir, file.path);

      // Ensure parent directory exists
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
      }

      // Check for conflict and apply mergeMode
      const fileExists = fs.existsSync(fullPath);
      if (fileExists) {
        if (mergeMode === 'abort') {
          throw new Error(`File conflict: ${file.path} already exists. mergeMode=abort.`);
        }
        if (mergeMode === 'skip_conflicts') {
          skippedFiles.push(file.path);
          continue; // Skip this file, keep existing
        }
        // mergeMode === 'replace_all': fall through to write (overwrite)
      }

      await fs.promises.writeFile(fullPath, file.content || '', 'utf8');
      filesCreated.push(file.path);
    }

    // Step 4: Emit success event
    emitScaffoldApplyEvent(ctx.eventBus, ctx.runId, ctx.mode, 'scaffold_apply_completed', {
      scaffold_id: ctx.scaffoldId,
      target_directory: ctx.targetDir,
      files_created: filesCreated,
      files_skipped: skippedFiles,
      dirs_created: dirsCreated,
      checkpoint_id: checkpointId,
      merge_mode: mergeMode,
    });

    return {
      success: true,
      checkpointId,
      filesCreated,
      dirsCreated,
    };
  } catch (err) {
    // Rollback on failure
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Attempt rollback
    let rolledBack = false;
    if (checkpointId) {
      try {
        await rollbackFromCheckpoint(ctx.checkpointDir, checkpointId, ctx.targetDir, filesCreated, dirsCreated);
        rolledBack = true;
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
    }

    // Emit failure event
    emitScaffoldApplyEvent(ctx.eventBus, ctx.runId, ctx.mode, 'scaffold_apply_failed', {
      scaffold_id: ctx.scaffoldId,
      target_directory: ctx.targetDir,
      error: errorMsg,
      rolled_back: rolledBack,
      checkpoint_id: checkpointId,
    });

    return {
      success: false,
      checkpointId,
      filesCreated,
      dirsCreated,
      error: errorMsg,
      rolledBack,
    };
  }
}

/**
 * Create pre-apply checkpoint
 */
async function createPreApplyCheckpoint(ctx: AtomicApplyContext): Promise<string> {
  const checkpointId = `scaffold_${ctx.scaffoldId}_${Date.now()}`;
  const checkpointPath = path.join(ctx.checkpointDir, checkpointId);

  await fs.promises.mkdir(checkpointPath, { recursive: true });

  // Store checkpoint metadata
  const metadata = {
    checkpoint_id: checkpointId,
    scaffold_id: ctx.scaffoldId,
    target_dir: ctx.targetDir,
    created_at: new Date().toISOString(),
    files_to_create: ctx.recipePlan.files.map(f => f.path),
  };

  await fs.promises.writeFile(
    path.join(checkpointPath, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );

  // Snapshot existing files that will be overwritten
  for (const file of ctx.recipePlan.files) {
    const fullPath = path.join(ctx.targetDir, file.path);
    if (fs.existsSync(fullPath)) {
      const content = await fs.promises.readFile(fullPath, 'utf8');
      const backupPath = path.join(checkpointPath, 'backup', file.path);
      await fs.promises.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.promises.writeFile(backupPath, content, 'utf8');
    }
  }

  return checkpointId;
}

/**
 * Rollback from checkpoint
 */
async function rollbackFromCheckpoint(
  checkpointDir: string,
  checkpointId: string,
  targetDir: string,
  filesCreated: string[],
  dirsCreated: string[]
): Promise<void> {
  const checkpointPath = path.join(checkpointDir, checkpointId);
  const backupPath = path.join(checkpointPath, 'backup');

  // Remove created files
  for (const file of filesCreated) {
    const fullPath = path.join(targetDir, file);
    try {
      await fs.promises.unlink(fullPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  // Restore backed up files
  if (fs.existsSync(backupPath)) {
    const restoreFiles = await getAllFiles(backupPath);
    for (const relPath of restoreFiles) {
      const sourcePath = path.join(backupPath, relPath);
      const destPath = path.join(targetDir, relPath);
      const content = await fs.promises.readFile(sourcePath, 'utf8');
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await fs.promises.writeFile(destPath, content, 'utf8');
    }
  }

  // Remove created directories (in reverse order)
  const sortedDirs = dirsCreated.sort((a, b) => b.length - a.length);
  for (const dir of sortedDirs) {
    const fullPath = path.join(targetDir, dir);
    try {
      const entries = await fs.promises.readdir(fullPath);
      if (entries.length === 0) {
        await fs.promises.rmdir(fullPath);
      }
    } catch {
      // Ignore errors
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Check if a gate is non-critical
 */
function isNonCriticalGate(gate: QualityGate, config: GateConfig): boolean {
  // Network is non-critical by default
  if (gate === 'network' && !config.networkRequired) {
    return true;
  }
  // Memory is a warning, not critical
  if (gate === 'memory') {
    return true;
  }
  return false;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Normalize whitespace for comparison
 */
function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Get all files recursively
 */
async function getAllFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getAllFiles(fullPath, baseDir));
    } else {
      files.push(path.relative(baseDir, fullPath));
    }
  }

  return files;
}

/**
 * Emit scaffold apply event
 */
function emitScaffoldApplyEvent(
  eventBus: EventEmitter,
  runId: string,
  mode: Mode,
  type: string,
  payload: Record<string, unknown>
): void {
  const event: Event = {
    event_id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    task_id: runId,
    timestamp: new Date().toISOString(),
    type: type as Event['type'],
    mode,
    stage: 'edit',
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };

  eventBus.emit('event', event);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  DEFAULT_MIN_DISK_SPACE,
  DEFAULT_MIN_MEMORY,
  DEFAULT_NETWORK_TIMEOUT,
};
