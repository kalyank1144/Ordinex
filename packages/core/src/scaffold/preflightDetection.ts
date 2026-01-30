/**
 * Preflight Detection (Step 35.7)
 * 
 * Enterprise-safe directory inspection for greenfield scaffolding.
 * Detects non-empty directories, existing projects, and monorepos
 * WITHOUT reading huge directories or making any changes.
 * 
 * CRITICAL RULES:
 * - Read-only operations only
 * - Cap traversal at top-level only
 * - No guessing or LLM inference
 * - All decisions are deterministic and replay-safe
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Monorepo type detection (enhanced from existing types.ts)
 */
export type MonorepoTypeDetected = 
  | 'pnpm' 
  | 'yarn' 
  | 'lerna' 
  | 'nx' 
  | 'turbo' 
  | 'unknown';

/**
 * Workspace file indicator
 */
export type WorkspaceFile = 
  | 'pnpm-workspace.yaml' 
  | 'package.json(workspaces)' 
  | 'lerna.json' 
  | 'nx.json' 
  | 'turbo.json';

/**
 * Complete directory inspection result
 * 
 * Captures all signals needed for safe scaffold targeting decisions.
 * This is the primary output of inspectTargetDirectory().
 */
export interface TargetDirInspection {
  /** Absolute path that was inspected */
  absPath: string;
  
  /** Whether the path exists on disk */
  exists: boolean;
  
  /** Count of top-level entries (files + dirs) */
  entriesCount: number;
  
  /** True if entriesCount === 0 or only contains harmless files */
  isEmpty: boolean;
  
  // ====== Project Signals ======
  
  /** Has package.json at root */
  hasPackageJson: boolean;
  
  /** Has node_modules directory */
  hasNodeModules: boolean;
  
  /** Has .git directory */
  hasGit: boolean;
  
  /** Has src/ directory */
  hasSrcDir: boolean;
  
  /** Has app/ directory (Next.js app router) */
  hasAppDir: boolean;
  
  /** Has next.config.* file */
  hasNextConfig: boolean;
  
  /** Has vite.config.* file */
  hasViteConfig: boolean;
  
  /** Has app.json (Expo) */
  hasExpoAppJson: boolean;
  
  // ====== Monorepo Signals ======
  
  /** Is this a monorepo root? */
  isMonorepo: boolean;
  
  /** Detected monorepo type (if isMonorepo) */
  monorepoType?: MonorepoTypeDetected;
  
  /** Has apps/ directory */
  hasAppsDir: boolean;
  
  /** Has packages/ directory */
  hasPackagesDir: boolean;
  
  /** Primary workspace config file detected */
  workspaceFile?: WorkspaceFile;
  
  // ====== Derived ======
  
  /** Is this directory "project-like" (has clear project indicators) */
  isProjectLike: boolean;
  
  /** Detected package manager based on lock files */
  detectedPackageManager?: 'npm' | 'yarn' | 'pnpm';
  
  /** List of harmless files found (if isEmpty but entriesCount > 0) */
  harmlessFilesFound?: string[];
}

/**
 * Preflight recommendation action
 */
export type PreflightRecommendation = 
  | 'safe_to_apply'           // Empty dir, proceed immediately
  | 'create_subfolder'         // Non-empty, suggest subfolder
  | 'use_monorepo_location'    // Monorepo detected, suggest apps/<name>
  | 'needs_user_decision';     // Ambiguous, require explicit choice

/**
 * Problem type for decision points
 */
export type PreflightProblem = 
  | 'NON_EMPTY_DIR' 
  | 'EXISTING_PROJECT' 
  | 'MONOREPO_AMBIGUOUS';

/**
 * Decision option for scaffold preflight
 */
export interface PreflightDecisionOption {
  /** Unique option identifier */
  id: 'create_subfolder' | 'choose_monorepo_path' | 'replace' | 'choose_other' | 'abort' | 'enhance_existing';
  
  /** Human-readable label */
  label: string;
  
  /** Optional description */
  description?: string;
  
  /** Whether this action is dangerous (e.g., replace) */
  dangerous?: boolean;
  
  /** Requires typed confirmation (e.g., "DELETE_AND_REPLACE") */
  requires_typed_confirm?: boolean;
  
  /** Is this the recommended default? */
  default?: boolean;
  
  /** Additional data (e.g., suggestedPath) */
  data?: Record<string, unknown>;
}

/**
 * Preflight decision point payload
 */
export interface PreflightDecisionPayload {
  /** Target directory being inspected */
  target_directory: string;
  
  /** Problem that requires decision */
  problem: PreflightProblem;
  
  /** Human-readable summary */
  summary: string;
  
  /** Available options */
  options: PreflightDecisionOption[];
}

/**
 * Preflight completed payload
 */
export interface PreflightCompletedPayload {
  /** Target directory inspected */
  target_directory: string;
  
  /** Full inspection result */
  inspection: TargetDirInspection;
  
  /** Recommended action */
  recommended_action: PreflightRecommendation;
}

/**
 * Preflight decision taken payload (user action)
 */
export interface PreflightDecisionTakenPayload {
  /** Which option the user selected */
  option_id: string;
  
  /** If subfolder/monorepo path was selected */
  selected_path?: string;
  
  /** If replace was selected with typed confirmation */
  typed_confirm_text?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Files considered "harmless" for scaffold purposes.
 * A directory containing ONLY these is treated as "empty".
 */
export const HARMLESS_FILES = new Set([
  '.gitignore',
  '.gitattributes',
  '.gitkeep',
  '.git',
  'README.md',
  'readme.md',
  'README',
  'LICENSE',
  'LICENSE.md',
  'license',
  '.DS_Store',
  'Thumbs.db',
  '.editorconfig',
  '.idea',
  '.vscode',
]);

/**
 * Project indicators - files/dirs that suggest an existing project
 */
export const PROJECT_INDICATORS = [
  'package.json',
  'src',
  'app',
  'lib',
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'tsconfig.json',
  'jsconfig.json',
];

/**
 * The typed confirmation string required for destructive replace
 */
export const DESTRUCTIVE_CONFIRM_TEXT = 'DELETE_AND_REPLACE';

// ============================================================================
// INSPECTION FUNCTIONS
// ============================================================================

/**
 * Inspect target directory for scaffold safety
 * 
 * This is the main entry point for directory inspection.
 * All checks are read-only and cap traversal at top-level.
 * 
 * @param targetAbsPath - Absolute path to inspect
 * @returns Complete inspection result
 */
export async function inspectTargetDirectory(
  targetAbsPath: string
): Promise<TargetDirInspection> {
  // Normalize path
  const absPath = path.resolve(targetAbsPath);
  
  // Check if path exists
  const exists = await pathExists(absPath);
  
  if (!exists) {
    // Non-existent directory is safe to scaffold
    return {
      absPath,
      exists: false,
      entriesCount: 0,
      isEmpty: true,
      hasPackageJson: false,
      hasNodeModules: false,
      hasGit: false,
      hasSrcDir: false,
      hasAppDir: false,
      hasNextConfig: false,
      hasViteConfig: false,
      hasExpoAppJson: false,
      isMonorepo: false,
      hasAppsDir: false,
      hasPackagesDir: false,
      isProjectLike: false,
    };
  }
  
  // Check if it's a directory (not a file)
  const isDirectory = await isDir(absPath);
  if (!isDirectory) {
    // Path exists but is a file - treat as non-empty
    return {
      absPath,
      exists: true,
      entriesCount: 1,
      isEmpty: false,
      hasPackageJson: false,
      hasNodeModules: false,
      hasGit: false,
      hasSrcDir: false,
      hasAppDir: false,
      hasNextConfig: false,
      hasViteConfig: false,
      hasExpoAppJson: false,
      isMonorepo: false,
      hasAppsDir: false,
      hasPackagesDir: false,
      isProjectLike: false,
    };
  }
  
  // Read top-level entries (cap at top level only)
  const entries = await readDirSafe(absPath);
  const entriesCount = entries.length;
  
  // Categorize entries
  const harmlessFilesFound: string[] = [];
  const nonHarmlessEntries: string[] = [];
  
  for (const entry of entries) {
    if (HARMLESS_FILES.has(entry)) {
      harmlessFilesFound.push(entry);
    } else {
      nonHarmlessEntries.push(entry);
    }
  }
  
  const isEmpty = nonHarmlessEntries.length === 0;
  
  // Detect project signals
  const hasPackageJson = entries.includes('package.json');
  const hasNodeModules = entries.includes('node_modules');
  const hasGit = entries.includes('.git');
  const hasSrcDir = entries.includes('src');
  const hasAppDir = entries.includes('app');
  const hasAppsDir = entries.includes('apps');
  const hasPackagesDir = entries.includes('packages');
  
  // Detect framework configs
  const hasNextConfig = entries.some(e => 
    e === 'next.config.js' || 
    e === 'next.config.ts' || 
    e === 'next.config.mjs'
  );
  const hasViteConfig = entries.some(e => 
    e === 'vite.config.js' || 
    e === 'vite.config.ts'
  );
  const hasExpoAppJson = entries.includes('app.json');
  
  // Detect monorepo
  const { isMonorepo, monorepoType, workspaceFile } = await detectMonorepo(absPath, entries);
  
  // Detect package manager from lock files
  const detectedPackageManager = detectPackageManager(entries);
  
  // Determine if project-like
  const isProjectLike = hasPackageJson || hasSrcDir || hasAppDir;
  
  return {
    absPath,
    exists: true,
    entriesCount,
    isEmpty,
    hasPackageJson,
    hasNodeModules,
    hasGit,
    hasSrcDir,
    hasAppDir,
    hasNextConfig,
    hasViteConfig,
    hasExpoAppJson,
    isMonorepo,
    monorepoType,
    hasAppsDir,
    hasPackagesDir,
    workspaceFile,
    isProjectLike,
    detectedPackageManager,
    harmlessFilesFound: harmlessFilesFound.length > 0 ? harmlessFilesFound : undefined,
  };
}

/**
 * Detect monorepo markers
 */
async function detectMonorepo(
  absPath: string,
  entries: string[]
): Promise<{
  isMonorepo: boolean;
  monorepoType?: MonorepoTypeDetected;
  workspaceFile?: WorkspaceFile;
}> {
  // Check for explicit monorepo config files
  if (entries.includes('pnpm-workspace.yaml') || entries.includes('pnpm-workspace.yml')) {
    return {
      isMonorepo: true,
      monorepoType: 'pnpm',
      workspaceFile: 'pnpm-workspace.yaml',
    };
  }
  
  if (entries.includes('turbo.json')) {
    return {
      isMonorepo: true,
      monorepoType: 'turbo',
      workspaceFile: 'turbo.json',
    };
  }
  
  if (entries.includes('nx.json')) {
    return {
      isMonorepo: true,
      monorepoType: 'nx',
      workspaceFile: 'nx.json',
    };
  }
  
  if (entries.includes('lerna.json')) {
    return {
      isMonorepo: true,
      monorepoType: 'lerna',
      workspaceFile: 'lerna.json',
    };
  }
  
  // Check package.json for workspaces field
  if (entries.includes('package.json')) {
    try {
      const packageJsonPath = path.join(absPath, 'package.json');
      const content = await fs.promises.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(content);
      
      if (pkg.workspaces) {
        return {
          isMonorepo: true,
          monorepoType: 'yarn', // Could be npm workspaces too, but yarn pioneered it
          workspaceFile: 'package.json(workspaces)',
        };
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  // Heuristic: Has apps/ or packages/ without explicit config
  const hasApps = entries.includes('apps');
  const hasPackages = entries.includes('packages');
  
  if (hasApps || hasPackages) {
    return {
      isMonorepo: true,
      monorepoType: 'unknown',
      workspaceFile: undefined,
    };
  }
  
  return {
    isMonorepo: false,
    monorepoType: undefined,
    workspaceFile: undefined,
  };
}

/**
 * Detect package manager from lock files
 */
function detectPackageManager(
  entries: string[]
): 'npm' | 'yarn' | 'pnpm' | undefined {
  if (entries.includes('pnpm-lock.yaml')) {
    return 'pnpm';
  }
  if (entries.includes('yarn.lock')) {
    return 'yarn';
  }
  if (entries.includes('package-lock.json')) {
    return 'npm';
  }
  return undefined;
}

// ============================================================================
// RECOMMENDATION LOGIC
// ============================================================================

/**
 * Determine recommended action based on inspection
 * 
 * @param inspection - The inspection result
 * @param appName - The app name being scaffolded
 * @returns Recommended action
 */
export function getPreflightRecommendation(
  inspection: TargetDirInspection,
  appName: string
): PreflightRecommendation {
  // Non-existent or empty directory is safe
  if (!inspection.exists || inspection.isEmpty) {
    return 'safe_to_apply';
  }
  
  // Monorepo with clear structure - recommend monorepo location
  if (inspection.isMonorepo && (inspection.hasAppsDir || inspection.hasPackagesDir)) {
    return 'use_monorepo_location';
  }
  
  // Monorepo without clear structure - needs decision
  if (inspection.isMonorepo) {
    return 'needs_user_decision';
  }
  
  // Existing project - recommend subfolder
  if (inspection.isProjectLike) {
    return 'create_subfolder';
  }
  
  // Non-empty but not a project - recommend subfolder
  return 'create_subfolder';
}

/**
 * Build decision options for non-empty directory
 * 
 * @param inspection - The inspection result
 * @param appName - The app name being scaffolded
 * @returns Decision options
 */
export function buildPreflightDecisionOptions(
  inspection: TargetDirInspection,
  appName: string
): PreflightDecisionOption[] {
  const options: PreflightDecisionOption[] = [];
  
  // Monorepo-specific options
  if (inspection.isMonorepo) {
    if (inspection.hasAppsDir) {
      options.push({
        id: 'choose_monorepo_path',
        label: `Create in apps/${appName}`,
        description: 'Recommended location for monorepo apps',
        default: true,
        data: {
          suggestedPath: path.join(inspection.absPath, 'apps', appName),
        },
      });
    }
    
    if (inspection.hasPackagesDir) {
      options.push({
        id: 'choose_monorepo_path',
        label: `Create in packages/${appName}`,
        description: 'Alternative location for packages',
        default: !inspection.hasAppsDir,
        data: {
          suggestedPath: path.join(inspection.absPath, 'packages', appName),
        },
      });
    }
    
    // Fallback if no apps/packages exist yet
    if (!inspection.hasAppsDir && !inspection.hasPackagesDir) {
      options.push({
        id: 'choose_monorepo_path',
        label: `Create apps/${appName} (will create apps/)`,
        description: 'Creates apps/ directory and places project there',
        default: true,
        data: {
          suggestedPath: path.join(inspection.absPath, 'apps', appName),
        },
      });
    }
  } else {
    // Non-monorepo: Recommend subfolder
    const subfolderPath = path.join(inspection.absPath, appName);
    options.push({
      id: 'create_subfolder',
      label: `Create in ${appName}/`,
      description: `Creates project in ${subfolderPath}`,
      default: true,
      data: {
        suggestedPath: subfolderPath,
      },
    });
  }
  
  // Choose different directory
  options.push({
    id: 'choose_other',
    label: 'Choose different folder',
    description: 'Select a different directory for the project',
  });
  
  // Enhance existing (disabled/future)
  if (inspection.isProjectLike) {
    options.push({
      id: 'enhance_existing',
      label: 'Enhance existing project',
      description: 'Coming soon - integrate into existing project structure',
      data: {
        disabled: true,
        disabledReason: 'Available in Step 36',
      },
    });
  }
  
  // Replace (dangerous)
  options.push({
    id: 'replace',
    label: 'Replace existing',
    description: `⚠️ DESTRUCTIVE: Deletes all existing files. Type "${DESTRUCTIVE_CONFIRM_TEXT}" to confirm.`,
    dangerous: true,
    requires_typed_confirm: true,
  });
  
  // Abort
  options.push({
    id: 'abort',
    label: 'Cancel',
    description: 'Cancel scaffold and return to chat',
  });
  
  return options;
}

/**
 * Build decision payload for non-empty directory
 */
export function buildPreflightDecisionPayload(
  inspection: TargetDirInspection,
  appName: string
): PreflightDecisionPayload {
  // Determine problem type
  let problem: PreflightProblem;
  let summary: string;
  
  if (inspection.isMonorepo) {
    problem = 'MONOREPO_AMBIGUOUS';
    summary = `Monorepo detected at ${inspection.absPath}. Please choose where to place the new project.`;
  } else if (inspection.isProjectLike) {
    problem = 'EXISTING_PROJECT';
    summary = `An existing project was detected at ${inspection.absPath}. ${inspection.hasPackageJson ? 'package.json found.' : ''} ${inspection.hasNodeModules ? 'node_modules present.' : ''}`;
  } else {
    problem = 'NON_EMPTY_DIR';
    summary = `Directory is not empty (${inspection.entriesCount} items). Scaffold cannot proceed without choosing a location.`;
  }
  
  return {
    target_directory: inspection.absPath,
    problem,
    summary,
    options: buildPreflightDecisionOptions(inspection, appName),
  };
}

/**
 * Suggest monorepo placement paths
 */
export function suggestMonorepoPaths(
  inspection: TargetDirInspection,
  appName: string
): Array<{ path: string; label: string; recommended: boolean }> {
  const suggestions: Array<{ path: string; label: string; recommended: boolean }> = [];
  
  if (inspection.hasAppsDir) {
    suggestions.push({
      path: path.join(inspection.absPath, 'apps', appName),
      label: `apps/${appName}`,
      recommended: true,
    });
  } else {
    suggestions.push({
      path: path.join(inspection.absPath, 'apps', appName),
      label: `apps/${appName} (will create apps/)`,
      recommended: !inspection.hasPackagesDir,
    });
  }
  
  if (inspection.hasPackagesDir) {
    suggestions.push({
      path: path.join(inspection.absPath, 'packages', appName),
      label: `packages/${appName}`,
      recommended: !inspection.hasAppsDir,
    });
  } else {
    suggestions.push({
      path: path.join(inspection.absPath, 'packages', appName),
      label: `packages/${appName} (will create packages/)`,
      recommended: false,
    });
  }
  
  // Root level (not recommended)
  suggestions.push({
    path: path.join(inspection.absPath, appName),
    label: `${appName} (root level, not recommended)`,
    recommended: false,
  });
  
  return suggestions;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate that a typed confirmation matches the required text
 */
export function validateDestructiveConfirmation(text: string): boolean {
  return text === DESTRUCTIVE_CONFIRM_TEXT;
}

/**
 * Validate that a target path is safe for writing
 * 
 * Prevents path traversal attacks by ensuring the write path
 * is within the approved target directory.
 * 
 * @param targetDir - The approved target directory
 * @param writePath - The path being written to
 * @returns True if safe, false if path traversal detected
 */
export function isPathWithinTarget(targetDir: string, writePath: string): boolean {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedWrite = path.resolve(writePath);
  
  // Ensure writePath starts with targetDir
  return resolvedWrite.startsWith(resolvedTarget + path.sep) || 
         resolvedWrite === resolvedTarget;
}

/**
 * Check if a file would overwrite an existing file
 */
export async function wouldOverwriteFile(filePath: string): Promise<boolean> {
  return pathExists(filePath);
}

// ============================================================================
// FILESYSTEM HELPERS (Internal)
// ============================================================================

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
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
