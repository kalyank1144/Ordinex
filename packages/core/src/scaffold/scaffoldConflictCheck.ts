/**
 * Scaffold Conflict Check (Step 35.4)
 * 
 * Detects conflicts before scaffold apply to prevent silent overwrites.
 * All conflicts require explicit user decision via decision_point_needed.
 * 
 * CRITICAL RULES:
 * 1. Target must be inside workspace root (use workspaceResolver)
 * 2. Non-empty directory requires explicit confirmation
 * 3. Existing files cannot be silently overwritten
 * 4. Default action is "Choose different folder" (safest)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FilePlanItem } from './recipeTypes';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a path is inside a workspace root
 * 
 * @param workspaceRoot - Workspace root (absolute path)
 * @param targetPath - Target path to check (absolute path)
 * @returns true if targetPath is inside workspaceRoot
 */
export function isInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const normalizedRoot = path.normalize(workspaceRoot);
  const normalizedTarget = path.normalize(targetPath);
  
  // Ensure both are absolute
  if (!path.isAbsolute(normalizedRoot) || !path.isAbsolute(normalizedTarget)) {
    return false;
  }
  
  // Check if target starts with root (+ path separator to avoid partial matches)
  // e.g., /home/user/project should contain /home/user/project/src
  // but NOT /home/user/project2
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSep);
}

// ============================================================================
// CONFLICT TYPES
// ============================================================================

/**
 * Reason for conflict
 */
export type ConflictReason = 'exists' | 'dir_not_empty' | 'outside_workspace';

/**
 * Single conflict record
 */
export interface ScaffoldConflict {
  /** Path that has the conflict */
  path: string;
  /** Why this is a conflict */
  reason: ConflictReason;
  /** Human-readable description */
  description: string;
}

/**
 * Suggested action for resolving conflicts
 */
export type ConflictAction = 
  | 'choose_new_dir'    // Pick a different target directory
  | 'merge_safe_only'   // Only create files that don't exist
  | 'replace_all'       // Delete existing and replace (DESTRUCTIVE)
  | 'cancel';           // Cancel scaffold operation

/**
 * Result of conflict check
 */
export interface ConflictCheckResult {
  /** Whether any conflicts were detected */
  hasConflicts: boolean;
  /** List of conflicts */
  conflicts: ScaffoldConflict[];
  /** Suggested actions in order of recommendation */
  suggestedActions: ConflictAction[];
  /** Default recommended action */
  defaultAction: ConflictAction;
  /** Summary for UI display */
  summary: string;
}

// ============================================================================
// CONFLICT CHECK FUNCTION
// ============================================================================

/**
 * Check for conflicts before scaffold apply
 * 
 * @param workspaceRoot - Workspace root directory (absolute)
 * @param targetDir - Target directory for scaffold (absolute)
 * @param planFiles - Files planned to be created
 * @returns Conflict check result
 */
export function checkScaffoldConflicts(
  workspaceRoot: string,
  targetDir: string,
  planFiles: FilePlanItem[]
): ConflictCheckResult {
  const conflicts: ScaffoldConflict[] = [];
  
  // 1. Check if target is inside workspace
  if (!isInsideWorkspace(workspaceRoot, targetDir)) {
    conflicts.push({
      path: targetDir,
      reason: 'outside_workspace',
      description: `Target directory is outside workspace: ${targetDir}`,
    });
    
    return {
      hasConflicts: true,
      conflicts,
      suggestedActions: ['choose_new_dir', 'cancel'],
      defaultAction: 'choose_new_dir',
      summary: 'Target directory is outside the workspace. Please choose a different location.',
    };
  }
  
  // 2. Check if target directory exists and is non-empty
  if (fs.existsSync(targetDir)) {
    try {
      const entries = fs.readdirSync(targetDir);
      // Filter out hidden files like .gitkeep, .DS_Store
      const visibleEntries = entries.filter(e => !e.startsWith('.'));
      
      if (visibleEntries.length > 0) {
        conflicts.push({
          path: targetDir,
          reason: 'dir_not_empty',
          description: `Directory is not empty (${visibleEntries.length} item(s)): ${targetDir}`,
        });
      }
    } catch (err) {
      // If we can't read the directory, treat it as a conflict
      conflicts.push({
        path: targetDir,
        reason: 'dir_not_empty',
        description: `Cannot read directory: ${targetDir}`,
      });
    }
  }
  
  // 3. Check for existing files that would be overwritten
  for (const file of planFiles) {
    if (file.kind !== 'file') continue;
    
    const absolutePath = path.join(targetDir, file.path);
    
    if (fs.existsSync(absolutePath)) {
      conflicts.push({
        path: file.path,
        reason: 'exists',
        description: `File already exists: ${file.path}`,
      });
    }
  }
  
  // Build result
  if (conflicts.length === 0) {
    return {
      hasConflicts: false,
      conflicts: [],
      suggestedActions: [],
      defaultAction: 'choose_new_dir', // Not used when no conflicts
      summary: 'No conflicts detected. Ready to apply.',
    };
  }
  
  // Determine suggested actions based on conflict types
  const hasOutsideWorkspace = conflicts.some(c => c.reason === 'outside_workspace');
  const hasDirNotEmpty = conflicts.some(c => c.reason === 'dir_not_empty');
  const hasExistingFiles = conflicts.some(c => c.reason === 'exists');
  
  const suggestedActions: ConflictAction[] = ['choose_new_dir'];
  
  if (!hasOutsideWorkspace) {
    // Only offer merge/replace if inside workspace
    if (hasExistingFiles || hasDirNotEmpty) {
      suggestedActions.push('merge_safe_only');
      suggestedActions.push('replace_all');
    }
  }
  
  suggestedActions.push('cancel');
  
  // Build summary
  const summaryParts: string[] = [];
  if (hasOutsideWorkspace) {
    summaryParts.push('Target is outside workspace');
  }
  if (hasDirNotEmpty) {
    summaryParts.push('Target directory is not empty');
  }
  if (hasExistingFiles) {
    const existingCount = conflicts.filter(c => c.reason === 'exists').length;
    summaryParts.push(`${existingCount} file(s) would be overwritten`);
  }
  
  return {
    hasConflicts: true,
    conflicts,
    suggestedActions,
    defaultAction: 'choose_new_dir',
    summary: summaryParts.join('. ') + '.',
  };
}

// ============================================================================
// DECISION POINT BUILDERS
// ============================================================================

/**
 * Build decision point options for conflict resolution
 */
export interface ConflictDecisionOption {
  label: string;
  action: ConflictAction;
  description: string;
  primary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Build decision options for scaffold conflicts
 * 
 * @param result - Conflict check result
 * @returns Array of decision options
 */
export function buildConflictDecisionOptions(
  result: ConflictCheckResult
): ConflictDecisionOption[] {
  const options: ConflictDecisionOption[] = [];
  
  // Choose different folder (always available, recommended)
  if (result.suggestedActions.includes('choose_new_dir')) {
    options.push({
      label: 'Choose Different Folder',
      action: 'choose_new_dir',
      description: 'Select a different location for the project (recommended)',
      primary: true,
    });
  }
  
  // Merge safe only (skip existing files)
  if (result.suggestedActions.includes('merge_safe_only')) {
    const existingCount = result.conflicts.filter(c => c.reason === 'exists').length;
    options.push({
      label: 'Merge (Skip Existing)',
      action: 'merge_safe_only',
      description: existingCount > 0
        ? `Create new files only, skip ${existingCount} existing file(s)`
        : 'Create files alongside existing content',
    });
  }
  
  // Replace all (destructive)
  if (result.suggestedActions.includes('replace_all')) {
    options.push({
      label: 'Replace All',
      action: 'replace_all',
      description: 'Delete existing content and create fresh (requires confirmation)',
      destructive: true,
    });
  }
  
  // Cancel (always available)
  options.push({
    label: 'Cancel',
    action: 'cancel',
    description: 'Cancel the scaffold operation',
  });
  
  return options;
}

/**
 * Build second confirmation options for destructive replace_all
 * 
 * This requires explicit user confirmation before proceeding.
 */
export function buildReplaceConfirmationOptions(): ConflictDecisionOption[] {
  return [
    {
      label: 'Confirm Replace',
      action: 'replace_all',
      description: 'I understand this will delete existing files',
      destructive: true,
    },
    {
      label: 'Go Back',
      action: 'choose_new_dir',
      description: 'Return to previous options',
      primary: true,
    },
  ];
}

// ============================================================================
// MERGE HELPERS
// ============================================================================

/**
 * Filter plan files for merge_safe_only mode
 * 
 * Returns only files that don't already exist.
 * 
 * @param targetDir - Target directory
 * @param planFiles - All planned files
 * @returns Object with files to create and files to skip
 */
export function filterForMergeSafeOnly(
  targetDir: string,
  planFiles: FilePlanItem[]
): {
  filesToCreate: FilePlanItem[];
  filesToSkip: FilePlanItem[];
} {
  const filesToCreate: FilePlanItem[] = [];
  const filesToSkip: FilePlanItem[] = [];
  
  for (const file of planFiles) {
    if (file.kind === 'dir') {
      // Always create directories (mkdir -p is safe)
      filesToCreate.push(file);
      continue;
    }
    
    const absolutePath = path.join(targetDir, file.path);
    
    if (fs.existsSync(absolutePath)) {
      filesToSkip.push(file);
    } else {
      filesToCreate.push(file);
    }
  }
  
  return { filesToCreate, filesToSkip };
}

// ============================================================================
// CLEANUP HELPERS (FOR REPLACE_ALL)
// ============================================================================

/**
 * List files to be deleted for replace_all mode
 * 
 * WARNING: This is for preview only. Actual deletion should be gated.
 * 
 * @param targetDir - Target directory
 * @returns List of files that would be deleted
 */
export function listFilesForDeletion(targetDir: string): string[] {
  const files: string[] = [];
  
  if (!fs.existsSync(targetDir)) {
    return files;
  }
  
  function walkDir(dir: string, relativePath: string = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryRelPath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      const entryAbsPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        walkDir(entryAbsPath, entryRelPath);
      } else {
        files.push(entryRelPath);
      }
    }
  }
  
  try {
    walkDir(targetDir);
  } catch (err) {
    console.error(`Failed to list files in ${targetDir}:`, err);
  }
  
  return files;
}

/**
 * Delete all contents of a directory (for replace_all)
 * 
 * WARNING: This is destructive! Only call after explicit confirmation.
 * 
 * @param targetDir - Target directory to clear
 */
export async function clearDirectoryContents(targetDir: string): Promise<void> {
  if (!fs.existsSync(targetDir)) {
    return;
  }
  
  const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
  
  for (const entry of entries) {
    const entryPath = path.join(targetDir, entry.name);
    
    if (entry.isDirectory()) {
      await fs.promises.rm(entryPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(entryPath);
    }
  }
}
