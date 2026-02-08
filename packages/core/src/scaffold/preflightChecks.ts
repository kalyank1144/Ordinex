/**
 * Step 43: Scaffold Preflight Checks Engine
 *
 * Unified preflight validation before scaffold apply.
 * Returns pass/warn/block with resolution options for each check.
 *
 * CHECKS:
 * 1. checkDirectoryEmpty    - BLOCK if non-empty (4 resolution options)
 * 2. checkMonorepo          - WARN if monorepo detected (apps/packages/root options)
 * 3. checkWritePermissions  - BLOCK if cannot write
 * 4. checkDiskSpace         - WARN if low, BLOCK if critically low
 * 5. checkGitDirty          - WARN if uncommitted changes
 * 6. checkConflictingFiles  - BLOCK unless mergeMode already chosen
 *
 * CRITICAL RULES:
 * - Checks are deterministic and fast (no LLM)
 * - All results are serializable (replay-safe)
 * - Resolution options carry modifications (targetDir/mergeMode)
 * - Blockers must be resolved before scaffold proceeds
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import type {
  Event,
  Mode,
  PreflightCheck,
  PreflightCheckStatus,
  PreflightResult,
  ResolutionOption,
  ResolutionAction,
  ScaffoldMergeMode,
  MonorepoPlacement,
  ScaffoldPreflightChecksStartedPayload,
  ScaffoldPreflightChecksCompletedPayload,
  ScaffoldPreflightResolutionSelectedPayload,
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for running preflight checks
 */
export interface PreflightChecksInput {
  /** Absolute path to scaffold target directory */
  targetDir: string;
  /** Workspace root (may differ from targetDir) */
  workspaceRoot: string;
  /** List of planned file paths (relative to targetDir) */
  plannedFiles: string[];
  /** Estimated total size in MB for disk space check */
  estimatedMB?: number;
  /** Already-chosen merge mode (if set, skip conflicting files blocker) */
  mergeMode?: ScaffoldMergeMode;
  /** App name (for subfolder suggestions) */
  appName?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Files considered harmless for "empty directory" check */
const HARMLESS_FILES = new Set([
  '.gitignore', '.gitattributes', '.gitkeep', '.git',
  'README.md', 'readme.md', 'README',
  'LICENSE', 'LICENSE.md', 'license',
  '.DS_Store', 'Thumbs.db', '.editorconfig',
  '.idea', '.vscode',
]);

/** Monorepo marker files */
const MONOREPO_MARKERS: Record<string, string> = {
  'pnpm-workspace.yaml': 'pnpm',
  'pnpm-workspace.yml': 'pnpm',
  'turbo.json': 'turbo',
  'nx.json': 'nx',
  'lerna.json': 'lerna',
};

/** Minimum disk space in MB to warn */
const DISK_SPACE_WARN_MB = 200;

/** Minimum disk space in MB to block */
const DISK_SPACE_BLOCK_MB = 50;

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Run all preflight checks before scaffold apply.
 *
 * @param input - Preflight check input
 * @returns PreflightResult with checks, blockers, warnings, and canProceed flag
 */
export async function runPreflightChecks(
  input: PreflightChecksInput
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  // Run all checks in parallel where safe
  const [dirEmpty, monorepo, writePerms, diskSpace, gitDirty, conflicts] =
    await Promise.all([
      checkDirectoryEmpty(input.targetDir, input.appName),
      checkMonorepo(input.targetDir, input.workspaceRoot),
      checkWritePermissions(input.targetDir),
      checkDiskSpace(input.targetDir, input.estimatedMB ?? 150),
      checkGitDirty(input.workspaceRoot),
      checkConflictingFiles(input.targetDir, input.plannedFiles, input.mergeMode),
    ]);

  checks.push(dirEmpty, monorepo, writePerms, diskSpace, gitDirty, conflicts);

  const blockers = checks.filter(c => c.status === 'block');
  const warnings = checks.filter(c => c.status === 'warn');

  return {
    canProceed: blockers.length === 0,
    checks,
    blockers,
    warnings,
  };
}

// ============================================================================
// INDIVIDUAL CHECKS
// ============================================================================

/**
 * Check 1: Is the target directory empty?
 *
 * If not empty => BLOCK with 4 resolution options:
 * - Create in subfolder (modify targetDir)
 * - Merge / skip conflicts (modify mergeMode)
 * - Replace all (modify mergeMode='replace_all') + requires confirm
 * - Cancel
 */
export async function checkDirectoryEmpty(
  targetDir: string,
  appName?: string
): Promise<PreflightCheck> {
  const absTarget = path.resolve(targetDir);

  // If directory doesn't exist, it's safe
  if (!await pathExists(absTarget)) {
    return {
      id: 'directory_empty',
      name: 'Directory Empty',
      status: 'pass',
      message: 'Target directory does not exist yet and will be created.',
    };
  }

  // If path is a file (not directory), block
  if (!await isDirectory(absTarget)) {
    return {
      id: 'directory_empty',
      name: 'Directory Empty',
      status: 'block',
      message: `Target path exists but is a file, not a directory: ${absTarget}`,
      resolution: {
        options: [
          {
            id: 'cancel',
            label: 'Cancel',
            description: 'Cancel scaffold operation',
            action: 'cancel',
          },
        ],
      },
    };
  }

  // Read top-level entries
  const entries = await readDirSafe(absTarget);
  const nonHarmless = entries.filter(e => !HARMLESS_FILES.has(e));

  if (nonHarmless.length === 0) {
    return {
      id: 'directory_empty',
      name: 'Directory Empty',
      status: 'pass',
      message: entries.length === 0
        ? 'Directory is empty.'
        : `Directory contains only harmless files (${entries.join(', ')}).`,
    };
  }

  // Non-empty => BLOCK with resolution options
  const name = appName || 'my-app';
  const subfolderPath = path.join(absTarget, name);

  const options: ResolutionOption[] = [
    {
      id: 'create_subfolder',
      label: `Create in ${name}/ subfolder`,
      description: `Scaffold into ${subfolderPath} instead`,
      action: 'modify',
      modifications: {
        targetDir: subfolderPath,
      },
    },
    {
      id: 'merge_skip_conflicts',
      label: 'Merge (skip conflicts)',
      description: 'Write new files but skip any that already exist',
      action: 'modify',
      modifications: {
        mergeMode: 'skip_conflicts',
      },
    },
    {
      id: 'replace_all',
      label: 'Replace all existing',
      description: 'Delete conflicting files and write scaffold files. This is destructive.',
      action: 'modify',
      modifications: {
        mergeMode: 'replace_all',
      },
    },
    {
      id: 'cancel',
      label: 'Cancel',
      description: 'Cancel scaffold operation',
      action: 'cancel',
    },
  ];

  return {
    id: 'directory_empty',
    name: 'Directory Empty',
    status: 'block',
    message: `Directory is not empty (${nonHarmless.length} files/folders found: ${nonHarmless.slice(0, 5).join(', ')}${nonHarmless.length > 5 ? '...' : ''}).`,
    resolution: { options },
  };
}

/**
 * Check 2: Is the target inside a monorepo?
 *
 * Detects pnpm-workspace.yaml, turbo.json, nx.json, lerna.json.
 * WARN with options: apps/, packages/, root.
 */
export async function checkMonorepo(
  targetDir: string,
  workspaceRoot: string
): Promise<PreflightCheck> {
  const absRoot = path.resolve(workspaceRoot);

  // Check workspace root for monorepo markers
  let entries: string[];
  try {
    entries = await fs.promises.readdir(absRoot);
  } catch {
    return {
      id: 'monorepo_detected',
      name: 'Monorepo Detection',
      status: 'pass',
      message: 'Could not read workspace root. Skipping monorepo detection.',
    };
  }

  let monorepoType: string | undefined;

  // Check explicit marker files
  for (const [marker, type] of Object.entries(MONOREPO_MARKERS)) {
    if (entries.includes(marker)) {
      monorepoType = type;
      break;
    }
  }

  // Check package.json workspaces field
  if (!monorepoType && entries.includes('package.json')) {
    try {
      const pkgPath = path.join(absRoot, 'package.json');
      const content = await fs.promises.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(content);
      if (pkg.workspaces) {
        monorepoType = 'workspaces';
      }
    } catch {
      // Ignore parse errors
    }
  }

  if (!monorepoType) {
    return {
      id: 'monorepo_detected',
      name: 'Monorepo Detection',
      status: 'pass',
      message: 'No monorepo detected in workspace root.',
    };
  }

  // Check if target is already under apps/ or packages/
  const relTarget = path.relative(absRoot, path.resolve(targetDir));
  if (relTarget.startsWith('apps' + path.sep) || relTarget.startsWith('packages' + path.sep)) {
    return {
      id: 'monorepo_detected',
      name: 'Monorepo Detection',
      status: 'pass',
      message: `Monorepo detected (${monorepoType}). Target is already in ${relTarget.split(path.sep)[0]}/.`,
    };
  }

  const appName = path.basename(targetDir);
  const options: ResolutionOption[] = [
    {
      id: 'monorepo_apps',
      label: `Create in apps/${appName}`,
      description: 'Recommended location for monorepo applications',
      action: 'modify',
      modifications: {
        targetDir: path.join(absRoot, 'apps', appName),
        monorepoPlacement: 'apps',
      },
    },
    {
      id: 'monorepo_packages',
      label: `Create in packages/${appName}`,
      description: 'Location for shared packages or libraries',
      action: 'modify',
      modifications: {
        targetDir: path.join(absRoot, 'packages', appName),
        monorepoPlacement: 'packages',
      },
    },
    {
      id: 'monorepo_root',
      label: 'Use current target (root)',
      description: 'Keep the current target directory (not recommended in monorepo)',
      action: 'proceed',
      modifications: {
        monorepoPlacement: 'root',
      },
    },
  ];

  return {
    id: 'monorepo_detected',
    name: 'Monorepo Detection',
    status: 'warn',
    message: `Monorepo detected (${monorepoType}). Consider placing the project in apps/ or packages/.`,
    resolution: { options },
  };
}

/**
 * Check 3: Can we write to the target directory?
 *
 * If cannot write => BLOCK with cancel only.
 */
export async function checkWritePermissions(
  targetDir: string
): Promise<PreflightCheck> {
  const absTarget = path.resolve(targetDir);

  // Check if target exists
  if (await pathExists(absTarget)) {
    try {
      await fs.promises.access(absTarget, fs.constants.W_OK);
    } catch {
      return {
        id: 'write_permissions',
        name: 'Write Permissions',
        status: 'block',
        message: `No write permission for directory: ${absTarget}`,
        resolution: {
          options: [{
            id: 'cancel',
            label: 'Cancel',
            description: 'Cannot proceed without write permissions',
            action: 'cancel',
          }],
        },
      };
    }

    // Verify by writing a test file
    const testFile = path.join(absTarget, `.ordinex_preflight_test_${Date.now()}`);
    try {
      await fs.promises.writeFile(testFile, 'test');
      await fs.promises.unlink(testFile);
    } catch {
      return {
        id: 'write_permissions',
        name: 'Write Permissions',
        status: 'block',
        message: `Write test failed for directory: ${absTarget}`,
        resolution: {
          options: [{
            id: 'cancel',
            label: 'Cancel',
            description: 'Cannot proceed without write permissions',
            action: 'cancel',
          }],
        },
      };
    }
  } else {
    // Check parent directory is writable
    const parentDir = path.dirname(absTarget);
    if (!await pathExists(parentDir)) {
      return {
        id: 'write_permissions',
        name: 'Write Permissions',
        status: 'block',
        message: `Parent directory does not exist: ${parentDir}`,
        resolution: {
          options: [{
            id: 'cancel',
            label: 'Cancel',
            description: 'Cannot proceed — parent directory missing',
            action: 'cancel',
          }],
        },
      };
    }

    try {
      await fs.promises.access(parentDir, fs.constants.W_OK);
    } catch {
      return {
        id: 'write_permissions',
        name: 'Write Permissions',
        status: 'block',
        message: `No write permission for parent directory: ${parentDir}`,
        resolution: {
          options: [{
            id: 'cancel',
            label: 'Cancel',
            description: 'Cannot proceed without write permissions',
            action: 'cancel',
          }],
        },
      };
    }
  }

  return {
    id: 'write_permissions',
    name: 'Write Permissions',
    status: 'pass',
    message: 'Write permissions verified.',
  };
}

/**
 * Check 4: Is there enough disk space?
 *
 * WARN if low (< 200MB free), BLOCK if critically low (< 50MB free).
 */
export async function checkDiskSpace(
  targetDir: string,
  estimatedMB: number
): Promise<PreflightCheck> {
  try {
    const absTarget = path.resolve(targetDir);
    const checkPath = await pathExists(absTarget) ? absTarget : path.dirname(absTarget);

    // Attempt to get available disk space
    let availableMB: number;

    try {
      const stats = await fs.promises.statfs(checkPath);
      availableMB = (stats.bavail * stats.bsize) / (1024 * 1024);
    } catch {
      // statfs not available — fallback: assume sufficient
      return {
        id: 'disk_space',
        name: 'Disk Space',
        status: 'pass',
        message: 'Could not determine disk space. Assuming sufficient.',
      };
    }

    if (availableMB < DISK_SPACE_BLOCK_MB) {
      return {
        id: 'disk_space',
        name: 'Disk Space',
        status: 'block',
        message: `Critically low disk space: ${Math.round(availableMB)}MB available, need at least ~${estimatedMB}MB.`,
        resolution: {
          options: [{
            id: 'cancel',
            label: 'Cancel',
            description: 'Free up disk space before continuing',
            action: 'cancel',
          }],
        },
      };
    }

    if (availableMB < DISK_SPACE_WARN_MB || availableMB < estimatedMB * 1.5) {
      return {
        id: 'disk_space',
        name: 'Disk Space',
        status: 'warn',
        message: `Low disk space: ${Math.round(availableMB)}MB available (estimated need: ~${estimatedMB}MB).`,
      };
    }

    return {
      id: 'disk_space',
      name: 'Disk Space',
      status: 'pass',
      message: `Sufficient disk space: ${Math.round(availableMB)}MB available.`,
    };
  } catch {
    return {
      id: 'disk_space',
      name: 'Disk Space',
      status: 'pass',
      message: 'Could not check disk space. Assuming sufficient.',
    };
  }
}

/**
 * Check 5: Are there uncommitted git changes?
 *
 * WARN if uncommitted changes (never blocks).
 */
export async function checkGitDirty(
  workspaceRoot: string
): Promise<PreflightCheck> {
  try {
    const absRoot = path.resolve(workspaceRoot);

    // Check if .git exists
    if (!await pathExists(path.join(absRoot, '.git'))) {
      return {
        id: 'git_dirty',
        name: 'Git Status',
        status: 'pass',
        message: 'Not a git repository. Skipping git status check.',
      };
    }

    // Run git status
    let output: string;
    try {
      output = execSync('git status --porcelain', {
        cwd: absRoot,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return {
        id: 'git_dirty',
        name: 'Git Status',
        status: 'pass',
        message: 'Could not run git status. Skipping check.',
      };
    }

    const lines = output.trim().split('\n').filter(l => l.length > 0);

    if (lines.length === 0) {
      return {
        id: 'git_dirty',
        name: 'Git Status',
        status: 'pass',
        message: 'Git working tree is clean.',
      };
    }

    return {
      id: 'git_dirty',
      name: 'Git Status',
      status: 'warn',
      message: `${lines.length} uncommitted change(s) detected. Consider committing before scaffold.`,
    };
  } catch {
    return {
      id: 'git_dirty',
      name: 'Git Status',
      status: 'pass',
      message: 'Could not check git status. Skipping.',
    };
  }
}

/**
 * Check 6: Do planned scaffold files conflict with existing files?
 *
 * If mergeMode not chosen yet and conflicts exist => BLOCK.
 * If mergeMode='skip_conflicts' => PASS (conflicts will be skipped).
 */
export async function checkConflictingFiles(
  targetDir: string,
  plannedFiles: string[],
  mergeMode?: ScaffoldMergeMode
): Promise<PreflightCheck> {
  const absTarget = path.resolve(targetDir);

  // If target doesn't exist, no conflicts
  if (!await pathExists(absTarget)) {
    return {
      id: 'conflicting_files',
      name: 'Conflicting Files',
      status: 'pass',
      message: 'Target directory does not exist. No conflicts.',
    };
  }

  // Check each planned file for conflicts
  const conflicting: string[] = [];
  for (const file of plannedFiles) {
    const fullPath = path.join(absTarget, file);
    if (await pathExists(fullPath)) {
      conflicting.push(file);
    }
  }

  if (conflicting.length === 0) {
    return {
      id: 'conflicting_files',
      name: 'Conflicting Files',
      status: 'pass',
      message: 'No conflicting files detected.',
    };
  }

  // If mergeMode is already set, adjust behavior
  if (mergeMode === 'skip_conflicts') {
    return {
      id: 'conflicting_files',
      name: 'Conflicting Files',
      status: 'warn',
      message: `${conflicting.length} conflicting file(s) will be skipped: ${conflicting.slice(0, 5).join(', ')}${conflicting.length > 5 ? '...' : ''}`,
    };
  }

  if (mergeMode === 'replace_all') {
    return {
      id: 'conflicting_files',
      name: 'Conflicting Files',
      status: 'warn',
      message: `${conflicting.length} conflicting file(s) will be replaced: ${conflicting.slice(0, 5).join(', ')}${conflicting.length > 5 ? '...' : ''}`,
    };
  }

  // No mergeMode chosen => BLOCK
  const options: ResolutionOption[] = [
    {
      id: 'merge_skip',
      label: 'Skip conflicting files',
      description: `Keep ${conflicting.length} existing file(s) and only write new ones`,
      action: 'modify',
      modifications: {
        mergeMode: 'skip_conflicts',
      },
    },
    {
      id: 'merge_replace',
      label: 'Replace conflicting files',
      description: `Overwrite ${conflicting.length} existing file(s) with scaffold versions`,
      action: 'modify',
      modifications: {
        mergeMode: 'replace_all',
      },
    },
    {
      id: 'cancel',
      label: 'Cancel',
      description: 'Cancel scaffold operation',
      action: 'cancel',
    },
  ];

  return {
    id: 'conflicting_files',
    name: 'Conflicting Files',
    status: 'block',
    message: `${conflicting.length} file(s) would be overwritten: ${conflicting.slice(0, 5).join(', ')}${conflicting.length > 5 ? '...' : ''}`,
    resolution: { options },
  };
}

// ============================================================================
// RESOLUTION APPLICATION
// ============================================================================

/**
 * Apply selected resolutions to the preflight input and re-run checks.
 *
 * Takes the original input and a map of check_id -> selected_option_id,
 * applies the modifications from those options, and returns updated input
 * for a re-run.
 *
 * @param input - Original preflight input
 * @param result - Previous preflight result (to look up resolution options)
 * @param selections - Map of check_id -> selected option_id
 * @returns Updated input with modifications applied, or null if cancelled
 */
export function applyResolutions(
  input: PreflightChecksInput,
  result: PreflightResult,
  selections: Record<string, string>
): PreflightChecksInput | null {
  const updated = { ...input };

  for (const [checkId, optionId] of Object.entries(selections)) {
    const check = result.checks.find(c => c.id === checkId);
    if (!check?.resolution) continue;

    const option = check.resolution.options.find(o => o.id === optionId);
    if (!option) continue;

    // Cancel action stops everything
    if (option.action === 'cancel') {
      return null;
    }

    // Apply modifications
    if (option.modifications) {
      if (option.modifications.targetDir) {
        updated.targetDir = option.modifications.targetDir;
      }
      if (option.modifications.mergeMode) {
        updated.mergeMode = option.modifications.mergeMode;
      }
    }
  }

  return updated;
}

// ============================================================================
// EVENT-EMITTING ORCHESTRATOR
// ============================================================================

/**
 * Context for the event-emitting preflight orchestrator
 */
export interface PreflightOrchestratorCtx {
  /** Scaffold operation ID */
  scaffoldId: string;
  /** Run/task ID */
  runId: string;
  /** Event emitter for publishing events */
  eventBus: EventEmitter;
  /** Current mode */
  mode: Mode;
}

/**
 * Run preflight checks with event emission (replay-safe).
 *
 * Emits:
 * - scaffold_preflight_checks_started
 * - scaffold_preflight_checks_completed
 *
 * @param input - Preflight check input
 * @param ctx - Orchestrator context for event emission
 * @returns PreflightResult
 */
export async function runPreflightChecksWithEvents(
  input: PreflightChecksInput,
  ctx: PreflightOrchestratorCtx
): Promise<PreflightResult> {
  const startTime = Date.now();

  // Emit started event
  emitPreflightEvent(ctx, 'scaffold_preflight_checks_started', {
    scaffold_id: ctx.scaffoldId,
    run_id: ctx.runId,
    target_directory: input.targetDir,
    planned_files_count: input.plannedFiles.length,
    created_at_iso: new Date().toISOString(),
  });

  // Run the checks
  const result = await runPreflightChecks(input);

  const durationMs = Date.now() - startTime;

  // Emit completed event
  emitPreflightEvent(ctx, 'scaffold_preflight_checks_completed', {
    scaffold_id: ctx.scaffoldId,
    run_id: ctx.runId,
    can_proceed: result.canProceed,
    total_checks: result.checks.length,
    blockers_count: result.blockers.length,
    warnings_count: result.warnings.length,
    check_summaries: result.checks.map(c => ({
      id: c.id,
      status: c.status,
      message: c.message,
    })),
    duration_ms: durationMs,
  });

  return result;
}

/**
 * Emit a resolution selected event (replay-safe).
 *
 * Call this when the user picks a resolution option in the PreflightCard UI.
 *
 * @param ctx - Orchestrator context
 * @param checkId - Check ID the resolution applies to
 * @param optionId - Selected option ID
 * @param resolvedTargetDir - Resulting target directory (if modified)
 * @param resolvedMergeMode - Resulting merge mode (if modified)
 * @param resolvedMonorepoPlacement - Resulting monorepo placement (if modified)
 */
export function emitPreflightResolutionSelected(
  ctx: PreflightOrchestratorCtx,
  checkId: string,
  optionId: string,
  resolvedTargetDir?: string,
  resolvedMergeMode?: ScaffoldMergeMode,
  resolvedMonorepoPlacement?: MonorepoPlacement
): void {
  emitPreflightEvent(ctx, 'scaffold_preflight_resolution_selected', {
    scaffold_id: ctx.scaffoldId,
    run_id: ctx.runId,
    check_id: checkId,
    option_id: optionId,
    resolved_target_dir: resolvedTargetDir,
    resolved_merge_mode: resolvedMergeMode,
    resolved_monorepo_placement: resolvedMonorepoPlacement,
  });
}

/**
 * Internal event emission helper
 */
function emitPreflightEvent(
  ctx: PreflightOrchestratorCtx,
  type: string,
  payload: Record<string, unknown>
): void {
  const event: Event = {
    event_id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    task_id: ctx.runId,
    timestamp: new Date().toISOString(),
    type: type as Event['type'],
    mode: ctx.mode,
    stage: 'plan',
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };

  ctx.eventBus.emit('event', event);
}

// ============================================================================
// FILESYSTEM HELPERS
// ============================================================================

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function readDirSafe(p: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(p);
  } catch {
    return [];
  }
}
