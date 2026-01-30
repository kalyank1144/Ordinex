/**
 * Scaffold Apply Executor (Step 35.4)
 * 
 * Atomic, rollback-safe scaffold apply implementation.
 * Uses checkpoint strategy for rollback capability.
 * 
 * CRITICAL RULES:
 * 1. Only apply after approval_resolved(approved=true)
 * 2. Create checkpoint before writes for rollback capability
 * 3. Never silently overwrite - conflicts require decision_point_needed
 * 4. Replay-safe: never re-run if manifest evidence exists
 * 5. Do NOT auto-start dev server
 * 6. Trigger post-apply verify via Step 34
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import type { Event, Mode, Stage } from '../types';
import type { RecipePlan, FilePlanItem, CommandPlanItem } from './recipeTypes';
import type { ConflictAction, ConflictCheckResult } from './scaffoldConflictCheck';
import {
  ScaffoldApplyManifest,
  ManifestFile,
  createManifestFile,
  writeManifestEvidence,
  wasScaffoldApplied,
} from './scaffoldApplyManifest';
import {
  checkScaffoldConflicts,
  buildConflictDecisionOptions,
  filterForMergeSafeOnly,
  clearDirectoryContents,
} from './scaffoldConflictCheck';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Conflict resolution mode chosen by user
 */
export type ConflictMode = 
  | 'none'              // No conflicts or empty dir
  | 'choose_new_dir'    // User wants to pick different dir
  | 'merge_safe_only'   // Only create files that don't exist
  | 'replace_all'       // Delete existing and create fresh
  | 'cancel';           // Cancel operation

/**
 * Apply stage for error reporting
 */
export type ApplyStage = 'precheck' | 'mkdir' | 'write' | 'finalize';

/**
 * Context for scaffold apply execution
 */
export interface ScaffoldApplyContext {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Recipe plan to apply */
  recipePlan: RecipePlan;
  /** Workspace root (absolute path) */
  workspaceRoot: string;
  /** Target directory for scaffold (absolute path) */
  target_directory: string;
  /** Event emitter for publishing events */
  eventBus: EventEmitter;
  /** Current run/task ID */
  run_id: string;
  /** Evidence directory for storing manifest */
  evidenceDir: string;
  /** Checkpoint directory for rollback support */
  checkpointDir?: string;
  /** Is this a replay (never execute filesystem ops) */
  isReplay?: boolean;
  /** User's conflict resolution choice (if already made) */
  conflictMode?: ConflictMode;
  /** Whether replace_all was explicitly confirmed */
  replaceConfirmed?: boolean;
  /** Current mode for events */
  mode: Mode;
}

/**
 * Result of scaffold apply operation
 */
export interface ScaffoldApplyResult {
  /** Whether operation succeeded */
  ok: boolean;
  /** Manifest evidence reference */
  manifestRef?: string;
  /** Files created (relative paths) */
  createdFiles?: string[];
  /** Directories created (relative paths) */
  createdDirs?: string[];
  /** Files skipped (merge mode) */
  skippedFiles?: string[];
  /** Error message if failed */
  error?: string;
  /** Stage where failure occurred */
  failedStage?: ApplyStage;
  /** Path that caused failure */
  failedPath?: string;
  /** Whether user input is needed */
  needsInput?: boolean;
  /** Pending conflict info */
  pendingConflict?: ConflictCheckResult;
  /** Checkpoint ID if one was created */
  checkpointId?: string;
}

// ============================================================================
// APPLY EXECUTOR
// ============================================================================

/**
 * Apply scaffold plan to disk
 * 
 * This is the main entry point for scaffold apply operations.
 * Handles conflict detection, atomic writes, and rollback.
 * 
 * @param ctx - Apply context
 * @returns Apply result
 */
export async function applyScaffoldPlan(
  ctx: ScaffoldApplyContext
): Promise<ScaffoldApplyResult> {
  const startTime = Date.now();
  
  // REPLAY SAFETY: Never execute filesystem operations during replay
  if (ctx.isReplay) {
    return {
      ok: false,
      error: 'Replay mode - filesystem operations not allowed',
      needsInput: false,
    };
  }
  
  // CHECK IF ALREADY APPLIED (replay safety)
  const alreadyApplied = await wasScaffoldApplied(ctx.scaffold_id, ctx.evidenceDir);
  if (alreadyApplied) {
    return {
      ok: true,
      error: undefined,
      manifestRef: `evidence:scaffold_apply:${ctx.scaffold_id}`,
    };
  }
  
  // EMIT: scaffold_apply_started
  emitScaffoldApplyStarted(ctx);
  
  try {
    // STEP 1: CONFLICT CHECK
    const conflictResult = checkScaffoldConflicts(
      ctx.workspaceRoot,
      ctx.target_directory,
      ctx.recipePlan.files
    );
    
    if (conflictResult.hasConflicts && !ctx.conflictMode) {
      // No user choice yet - need decision point
      emitScaffoldConflictDetected(ctx, conflictResult);
      emitDecisionPointNeeded(ctx, conflictResult);
      
      return {
        ok: false,
        needsInput: true,
        pendingConflict: conflictResult,
      };
    }
    
    // Handle user's conflict choice
    if (ctx.conflictMode === 'cancel') {
      emitScaffoldApplyFailed(ctx, 'precheck', 'User cancelled operation');
      return {
        ok: false,
        error: 'User cancelled',
        failedStage: 'precheck',
      };
    }
    
    if (ctx.conflictMode === 'choose_new_dir') {
      // Signal that user wants to pick a new directory
      return {
        ok: false,
        needsInput: true,
        error: 'User requested new directory selection',
      };
    }
    
    if (ctx.conflictMode === 'replace_all' && !ctx.replaceConfirmed) {
      // Need explicit second confirmation for destructive operation
      emitReplaceConfirmationNeeded(ctx);
      return {
        ok: false,
        needsInput: true,
      };
    }
    
    // STEP 2: PREPARE FILES TO CREATE
    let filesToCreate = ctx.recipePlan.files;
    let skippedFiles: string[] = [];
    
    if (ctx.conflictMode === 'merge_safe_only') {
      const filtered = filterForMergeSafeOnly(ctx.target_directory, ctx.recipePlan.files);
      filesToCreate = filtered.filesToCreate;
      skippedFiles = filtered.filesToSkip.map(f => f.path);
    }
    
    // STEP 3: CREATE CHECKPOINT (for rollback)
    let checkpointId: string | undefined;
    if (ctx.checkpointDir) {
      checkpointId = await createSimpleCheckpoint(
        ctx.scaffold_id,
        ctx.target_directory,
        ctx.checkpointDir
      );
      
      emitCheckpointCreated(ctx, checkpointId);
    }
    
    try {
      // STEP 4: REPLACE_ALL - Clear directory if requested
      if (ctx.conflictMode === 'replace_all' && ctx.replaceConfirmed) {
        await clearDirectoryContents(ctx.target_directory);
      }
      
      // STEP 5: CREATE DIRECTORIES
      const dirsToCreate = filesToCreate
        .filter(f => f.kind === 'dir')
        .map(f => f.path);
      
      const createdDirs = await createDirectories(
        ctx.target_directory,
        dirsToCreate
      );
      
      // Also create parent directories for files
      const fileParentDirs = new Set<string>();
      for (const file of filesToCreate.filter(f => f.kind === 'file')) {
        const parentDir = path.dirname(file.path);
        if (parentDir && parentDir !== '.') {
          fileParentDirs.add(parentDir);
        }
      }
      
      await createDirectories(ctx.target_directory, Array.from(fileParentDirs));
      
      // STEP 6: WRITE FILES
      const { createdFiles, manifestFiles } = await writeFiles(
        ctx.target_directory,
        filesToCreate.filter(f => f.kind === 'file')
      );
      
      // STEP 7: CREATE AND STORE MANIFEST
      const manifest: ScaffoldApplyManifest = {
        scaffold_id: ctx.scaffold_id,
        recipe_id: ctx.recipePlan.recipe_id,
        target_directory: ctx.target_directory,
        created_at: new Date().toISOString(),
        files: manifestFiles,
        dirs: [...dirsToCreate, ...Array.from(fileParentDirs)],
        commands_planned: ctx.recipePlan.commands.map(c => ({
          label: c.label,
          cmd: c.cmd,
          when: c.when,
        })),
        skipped_files: skippedFiles.length > 0 ? skippedFiles : undefined,
        checkpoint_id: checkpointId,
        strategy: ctx.checkpointDir ? 'checkpoint' : 'temp_staging',
        duration_ms: Date.now() - startTime,
      };
      
      const manifestRef = await writeManifestEvidence(manifest, ctx.evidenceDir);
      
      // STEP 8: EMIT SUCCESS EVENTS
      emitScaffoldApplied(ctx, manifest, manifestRef);
      emitScaffoldCompleted(ctx, 'success');
      
      return {
        ok: true,
        manifestRef,
        createdFiles,
        createdDirs: [...createdDirs, ...Array.from(fileParentDirs)],
        skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
        checkpointId,
      };
      
    } catch (error) {
      // ROLLBACK: Restore checkpoint if available
      if (checkpointId && ctx.checkpointDir) {
        await restoreSimpleCheckpoint(
          checkpointId,
          ctx.target_directory,
          ctx.checkpointDir
        );
        
        emitCheckpointRestored(ctx, checkpointId);
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      emitScaffoldApplyFailed(ctx, 'write', errorMessage);
      emitScaffoldCompleted(ctx, 'failure');
      
      return {
        ok: false,
        error: errorMessage,
        failedStage: 'write',
        checkpointId,
      };
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    emitScaffoldApplyFailed(ctx, 'precheck', errorMessage);
    emitScaffoldCompleted(ctx, 'failure');
    
    return {
      ok: false,
      error: errorMessage,
      failedStage: 'precheck',
    };
  }
}

// ============================================================================
// FILESYSTEM OPERATIONS
// ============================================================================

/**
 * Create directories recursively
 */
async function createDirectories(
  targetDir: string,
  dirs: string[]
): Promise<string[]> {
  const created: string[] = [];
  
  for (const dir of dirs) {
    const absolutePath = path.join(targetDir, dir);
    
    if (!fs.existsSync(absolutePath)) {
      await fs.promises.mkdir(absolutePath, { recursive: true });
      created.push(dir);
    }
  }
  
  return created;
}

/**
 * Write files to disk
 */
async function writeFiles(
  targetDir: string,
  files: FilePlanItem[]
): Promise<{
  createdFiles: string[];
  manifestFiles: ManifestFile[];
}> {
  const createdFiles: string[] = [];
  const manifestFiles: ManifestFile[] = [];
  
  for (const file of files) {
    if (!file.content) continue;
    
    const absolutePath = path.join(targetDir, file.path);
    
    // Ensure parent directory exists
    const parentDir = path.dirname(absolutePath);
    if (!fs.existsSync(parentDir)) {
      await fs.promises.mkdir(parentDir, { recursive: true });
    }
    
    // Write file
    await fs.promises.writeFile(absolutePath, file.content, 'utf8');
    
    // Set executable if needed
    if (file.executable) {
      await fs.promises.chmod(absolutePath, 0o755);
    }
    
    createdFiles.push(file.path);
    manifestFiles.push(createManifestFile(
      file.path,
      file.content,
      file.executable ? 0o755 : undefined
    ));
  }
  
  return { createdFiles, manifestFiles };
}

// ============================================================================
// SIMPLE CHECKPOINT (for rollback)
// ============================================================================

/**
 * Simple checkpoint structure
 */
interface SimpleCheckpoint {
  id: string;
  created_at: string;
  target_directory: string;
  entries: Array<{
    type: 'file' | 'dir';
    path: string;
    content?: string;
  }>;
}

/**
 * Create a simple checkpoint of directory state
 */
async function createSimpleCheckpoint(
  scaffoldId: string,
  targetDir: string,
  checkpointDir: string
): Promise<string> {
  const checkpointId = `cp_${scaffoldId}_${Date.now()}`;
  
  // Ensure checkpoint directory exists
  if (!fs.existsSync(checkpointDir)) {
    await fs.promises.mkdir(checkpointDir, { recursive: true });
  }
  
  const checkpoint: SimpleCheckpoint = {
    id: checkpointId,
    created_at: new Date().toISOString(),
    target_directory: targetDir,
    entries: [],
  };
  
  // If target doesn't exist yet, nothing to checkpoint
  if (!fs.existsSync(targetDir)) {
    // Save empty checkpoint
    await fs.promises.writeFile(
      path.join(checkpointDir, `${checkpointId}.json`),
      JSON.stringify(checkpoint, null, 2),
      'utf8'
    );
    return checkpointId;
  }
  
  // Capture current state
  await captureDirectoryState(targetDir, '', checkpoint.entries);
  
  // Save checkpoint
  await fs.promises.writeFile(
    path.join(checkpointDir, `${checkpointId}.json`),
    JSON.stringify(checkpoint, null, 2),
    'utf8'
  );
  
  return checkpointId;
}

/**
 * Capture directory state recursively
 */
async function captureDirectoryState(
  baseDir: string,
  relativePath: string,
  entries: SimpleCheckpoint['entries']
): Promise<void> {
  const currentDir = relativePath
    ? path.join(baseDir, relativePath)
    : baseDir;
  
  const items = await fs.promises.readdir(currentDir, { withFileTypes: true });
  
  for (const item of items) {
    const itemRelPath = relativePath
      ? `${relativePath}/${item.name}`
      : item.name;
    const itemAbsPath = path.join(currentDir, item.name);
    
    if (item.isDirectory()) {
      entries.push({ type: 'dir', path: itemRelPath });
      await captureDirectoryState(baseDir, itemRelPath, entries);
    } else {
      const content = await fs.promises.readFile(itemAbsPath, 'utf8');
      entries.push({ type: 'file', path: itemRelPath, content });
    }
  }
}

/**
 * Restore from checkpoint
 */
async function restoreSimpleCheckpoint(
  checkpointId: string,
  targetDir: string,
  checkpointDir: string
): Promise<void> {
  const checkpointPath = path.join(checkpointDir, `${checkpointId}.json`);
  
  if (!fs.existsSync(checkpointPath)) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }
  
  const content = await fs.promises.readFile(checkpointPath, 'utf8');
  const checkpoint = JSON.parse(content) as SimpleCheckpoint;
  
  // Clear current target directory
  if (fs.existsSync(targetDir)) {
    const entries = await fs.promises.readdir(targetDir);
    for (const entry of entries) {
      const entryPath = path.join(targetDir, entry);
      await fs.promises.rm(entryPath, { recursive: true, force: true });
    }
  }
  
  // If checkpoint was empty (target didn't exist), we're done
  if (checkpoint.entries.length === 0) {
    return;
  }
  
  // Restore directories first
  for (const entry of checkpoint.entries.filter(e => e.type === 'dir')) {
    const dirPath = path.join(targetDir, entry.path);
    if (!fs.existsSync(dirPath)) {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }
  
  // Restore files
  for (const entry of checkpoint.entries.filter(e => e.type === 'file')) {
    if (entry.content !== undefined) {
      const filePath = path.join(targetDir, entry.path);
      const parentDir = path.dirname(filePath);
      
      if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
      }
      
      await fs.promises.writeFile(filePath, entry.content, 'utf8');
    }
  }
}

// ============================================================================
// EVENT EMISSION
// ============================================================================

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Emit scaffold_apply_started event
 */
function emitScaffoldApplyStarted(ctx: ScaffoldApplyContext): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'scaffold_apply_started' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffold_id,
      recipe_id: ctx.recipePlan.recipe_id,
      target_directory: ctx.target_directory,
      files_count: ctx.recipePlan.files.filter(f => f.kind === 'file').length,
      directories_count: ctx.recipePlan.files.filter(f => f.kind === 'dir').length,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}

/**
 * Emit scaffold_conflict_detected event
 */
function emitScaffoldConflictDetected(
  ctx: ScaffoldApplyContext,
  result: ConflictCheckResult
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'scaffold_conflict_detected' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffold_id,
      target_directory: ctx.target_directory,
      conflicts: result.conflicts,
      suggested_actions: result.suggestedActions,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}

/**
 * Emit decision_point_needed for conflict resolution
 */
function emitDecisionPointNeeded(
  ctx: ScaffoldApplyContext,
  result: ConflictCheckResult
): void {
  const options = buildConflictDecisionOptions(result);
  
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'decision_point_needed',
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      decision_type: 'scaffold_conflict',
      scaffold_id: ctx.scaffold_id,
      title: 'Resolve Scaffold Conflict',
      description: result.summary,
      options: options.map(o => ({
        label: o.label,
        action: o.action,
        description: o.description,
        primary: o.primary,
        destructive: o.destructive,
      })),
      context: {
        flow: 'scaffold',
        scaffold_id: ctx.scaffold_id,
        target_directory: ctx.target_directory,
        conflicts: result.conflicts.length,
      },
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}

/**
 * Emit decision_point_needed for replace confirmation
 */
function emitReplaceConfirmationNeeded(ctx: ScaffoldApplyContext): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'decision_point_needed',
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      decision_type: 'scaffold_replace_confirm',
      scaffold_id: ctx.scaffold_id,
      title: 'Confirm Replace All',
      description: 'This will DELETE all existing files in the target directory. This cannot be undone.',
      options: [
        {
          label: 'Go Back',
          action: 'go_back',
          description: 'Return to previous options',
          primary: true,
        },
        {
          label: 'Confirm Replace',
          action: 'confirm_replace',
          description: 'I understand this will delete existing files',
          destructive: true,
        },
      ],
      context: {
        flow: 'scaffold',
        scaffold_id: ctx.scaffold_id,
        target_directory: ctx.target_directory,
      },
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}

/**
 * Emit scaffold_applied event
 */
function emitScaffoldApplied(
  ctx: ScaffoldApplyContext,
  manifest: ScaffoldApplyManifest,
  manifestRef: string
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'scaffold_applied',
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffold_id,
      recipe_id: manifest.recipe_id,
      target_directory: manifest.target_directory,
      files_created: manifest.files.map(f => f.path),
      dirs_created: manifest.dirs,
      manifest_evidence_ref: manifestRef,
      checkpoint_id: manifest.checkpoint_id,
      skipped_files: manifest.skipped_files,
    },
    evidence_ids: [manifestRef],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}

/**
 * Emit scaffold_apply_failed event
 */
function emitScaffoldApplyFailed(
  ctx: ScaffoldApplyContext,
  stage: ApplyStage,
  errorMessage: string,
  failedPath?: string
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'scaffold_apply_failed' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffold_id,
      target_directory: ctx.target_directory,
      stage,
      error_message: errorMessage,
      failed_path: failedPath,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}

/**
 * Emit scaffold_completed event
 */
function emitScaffoldCompleted(
  ctx: ScaffoldApplyContext,
  status: 'success' | 'failure',
  verifyStatus?: 'pass' | 'fail' | 'skipped'
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'scaffold_completed',
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffold_id,
      status,
      verify_status: verifyStatus,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}

/**
 * Emit checkpoint_created event
 */
function emitCheckpointCreated(ctx: ScaffoldApplyContext, checkpointId: string): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'checkpoint_created',
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      checkpoint_id: checkpointId,
      scope: [ctx.target_directory],
      description: `Scaffold checkpoint before applying ${ctx.recipePlan.recipe_id}`,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}

/**
 * Emit checkpoint_restored event
 */
function emitCheckpointRestored(ctx: ScaffoldApplyContext, checkpointId: string): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'checkpoint_restored',
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      checkpoint_id: checkpointId,
      scope: [ctx.target_directory],
      description: 'Restored after scaffold apply failure',
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.emit('event', event);
}
