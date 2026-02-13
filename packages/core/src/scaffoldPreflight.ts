/**
 * Scaffold Preflight - Safety checks before project scaffolding (Step 35.2)
 * 
 * Provides deterministic safety preflight for greenfield scaffolding:
 * - Target directory resolution (absolute path)
 * - Non-empty directory detection and blocking
 * - Monorepo detection and candidate selection
 * - Replay-safe event emission
 * 
 * CRITICAL RULES:
 * - Never delete/overwrite existing files
 * - No terminal command execution
 * - Preflight results are recorded as events (replay-safe)
 * - At most 1 user decision point for directory selection
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  Event,
  Mode,
  Stage,
  ScaffoldPreflightStartedPayload,
  ScaffoldPreflightCompletedPayload,
  ScaffoldTargetChosenPayload,
  ScaffoldBlockedPayload,
  MonorepoType,
  PreflightConflict,
  PreflightConflictType,
  RecommendedLocation,
  TargetChoiceReason,
} from './types';
import { EventBus } from './eventBus';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Files that are considered "harmless" in a directory
 * A directory containing ONLY these files is considered "empty" for scaffold purposes
 */
export const HARMLESS_FILES = [
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
];

/**
 * Monorepo marker files and their types
 */
export const MONOREPO_MARKERS: Record<string, MonorepoType> = {
  'pnpm-workspace.yaml': 'pnpm',
  'pnpm-workspace.yml': 'pnpm',
  'turbo.json': 'turbo',
  'nx.json': 'nx',
  'lerna.json': 'lerna',
};

/**
 * Files/directories that indicate a non-empty project
 */
export const NON_EMPTY_INDICATORS = [
  'package.json',
  'src',
  'app',
  'lib',
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
];

// ============================================================================
// TYPES
// ============================================================================

/**
 * File system adapter interface (for testing/DI)
 */
export interface FileSystemAdapter {
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  isDirectory(path: string): Promise<boolean>;
}

/**
 * Preflight result (internal, not emitted directly)
 */
export interface PreflightResult {
  targetDirectory: string;
  isEmptyDir: boolean;
  hasPackageJson: boolean;
  detectedMonorepo: boolean;
  monorepoType?: MonorepoType;
  recommendedLocations: RecommendedLocation[];
  conflicts: PreflightConflict[];
  needsDecision: boolean;
  decisionType?: 'monorepo_choice' | 'non_empty_dir';
}

/**
 * Directory state check result
 */
export interface DirectoryState {
  exists: boolean;
  isEmpty: boolean;
  hasPackageJson: boolean;
  files: string[];
  nonHarmlessFiles: string[];
}

// ============================================================================
// APP NAME EXTRACTION
// ============================================================================

/**
 * Patterns for extracting app name from user prompt
 * Ordered by specificity (most specific first)
 */
const APP_NAME_PATTERNS = [
  /called\s+["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?/i,
  /named\s+["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?/i,
  /name(?:d)?\s+(?:it\s+)?["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?/i,
  /app\s+["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?/i,
  /project\s+["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?/i,
  /"([a-zA-Z][a-zA-Z0-9_-]*)"\s+app/i,
  /create\s+([a-zA-Z][a-zA-Z0-9_-]*)\s+/i,
];

/**
 * Keywords that should never be extracted as app names.
 * These are connector words that can appear after "app" or "project" in prompts.
 */
const APP_NAME_BLOCKLIST = new Set([
  'called', 'named', 'name', 'for', 'from', 'with', 'using',
  'in', 'to', 'the', 'a', 'an', 'that', 'which', 'and',
  'app', 'project', 'application', 'new', 'create', 'build',
]);

/**
 * Default app name when extraction fails
 */
export const DEFAULT_APP_NAME = 'my-app';

/**
 * Extract app name from user prompt using simple regex patterns
 * 
 * @param userPrompt - User's original prompt
 * @returns Extracted app name or default
 */
export function extractAppName(userPrompt: string): string {
  const cleanedPrompt = userPrompt.trim();

  // Step 1: Quoted multi-word names after explicit naming keywords
  // e.g., called "My Todo App" → my-todo-app
  const quotedNamedMatch = cleanedPrompt.match(/(?:called|named)\s+["']([^"']{2,50})["']/i);
  if (quotedNamedMatch) {
    const name = toAppSlug(quotedNamedMatch[1]);
    if (isValidAppSlug(name)) return name;
  }

  // Step 2: Single-word patterns (called X, named X, app X, etc.)
  for (const pattern of APP_NAME_PATTERNS) {
    const match = cleanedPrompt.match(pattern);
    if (match && match[1]) {
      const name = match[1].toLowerCase().replace(/[^a-z0-9-]/g, '-');
      // Validate: must start with letter, reasonable length, not a connector keyword
      if (/^[a-z]/.test(name) && name.length >= 2 && name.length <= 50 && !APP_NAME_BLOCKLIST.has(name)) {
        return name;
      }
    }
  }

  // Step 3: Standalone quoted multi-word names (e.g., "My Todo App")
  const quotedMatch = cleanedPrompt.match(/["']([^"']{2,50})["']/);
  if (quotedMatch) {
    const name = toAppSlug(quotedMatch[1]);
    if (isValidAppSlug(name)) return name;
  }

  // Step 4: "create/build [a] [new] X app/project" — skips articles
  // e.g., "create a new todo app" → todo
  const verbMatch = cleanedPrompt.match(
    /(?:create|build|make)\s+(?:an?\s+)?(?:new\s+)?(.+?)\s+(?:app|project|application|site|website)\b/i
  );
  if (verbMatch && verbMatch[1]) {
    const name = toAppSlug(verbMatch[1]);
    if (isValidAppSlug(name)) return name;
  }

  return DEFAULT_APP_NAME;
}

/** Convert free-form text to a slug: lowercase, spaces→dashes, strip invalid chars */
function toAppSlug(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** Validate a slug: starts with letter, 2-50 chars, not a blocklisted word */
function isValidAppSlug(name: string): boolean {
  return /^[a-z]/.test(name) && name.length >= 2 && name.length <= 50 && !APP_NAME_BLOCKLIST.has(name);
}

// ============================================================================
// MONOREPO DETECTION
// ============================================================================

/**
 * Detect monorepo type from workspace root
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param fs - File system adapter
 * @returns Detected monorepo type or undefined
 */
export async function detectMonorepoType(
  workspaceRoot: string,
  fs: FileSystemAdapter
): Promise<MonorepoType | undefined> {
  // Check marker files
  for (const [file, type] of Object.entries(MONOREPO_MARKERS)) {
    const filePath = path.join(workspaceRoot, file);
    if (await fs.exists(filePath)) {
      return type;
    }
  }
  
  // Check package.json for workspaces field
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (await fs.exists(packageJsonPath)) {
    try {
      const content = await fs.readFile(packageJsonPath);
      const pkg = JSON.parse(content);
      if (pkg.workspaces) {
        // Could be yarn workspaces or npm workspaces
        return 'yarn_workspaces';
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  // Check for apps/ or packages/ directories as heuristic
  const appsDir = path.join(workspaceRoot, 'apps');
  const packagesDir = path.join(workspaceRoot, 'packages');
  
  const hasApps = await fs.exists(appsDir) && await fs.isDirectory(appsDir);
  const hasPackages = await fs.exists(packagesDir) && await fs.isDirectory(packagesDir);
  
  if (hasApps || hasPackages) {
    return 'unknown';
  }
  
  return undefined;
}

/**
 * Check if workspace root has apps/ or packages/ directories
 */
export async function detectMonorepoCandidateFolders(
  workspaceRoot: string,
  fs: FileSystemAdapter
): Promise<{ hasApps: boolean; hasPackages: boolean }> {
  const appsDir = path.join(workspaceRoot, 'apps');
  const packagesDir = path.join(workspaceRoot, 'packages');
  
  const hasApps = await fs.exists(appsDir) && await fs.isDirectory(appsDir);
  const hasPackages = await fs.exists(packagesDir) && await fs.isDirectory(packagesDir);
  
  return { hasApps, hasPackages };
}

// ============================================================================
// DIRECTORY STATE CHECKING
// ============================================================================

/**
 * Check the state of a directory
 * 
 * @param targetDir - Absolute path to check
 * @param fs - File system adapter
 * @returns Directory state
 */
export async function checkDirectoryState(
  targetDir: string,
  fs: FileSystemAdapter
): Promise<DirectoryState> {
  const exists = await fs.exists(targetDir);
  
  if (!exists) {
    return {
      exists: false,
      isEmpty: true,
      hasPackageJson: false,
      files: [],
      nonHarmlessFiles: [],
    };
  }
  
  const isDir = await fs.isDirectory(targetDir);
  if (!isDir) {
    // Path exists but is a file, not a directory
    return {
      exists: true,
      isEmpty: false,
      hasPackageJson: false,
      files: [],
      nonHarmlessFiles: [],
    };
  }
  
  const files = await fs.readDir(targetDir);
  const nonHarmlessFiles = files.filter(f => !HARMLESS_FILES.includes(f));
  
  const hasPackageJson = files.includes('package.json');
  const isEmpty = nonHarmlessFiles.length === 0;
  
  return {
    exists: true,
    isEmpty,
    hasPackageJson,
    files,
    nonHarmlessFiles,
  };
}

/**
 * Check if a directory is safe for scaffolding
 * "Safe" means empty or contains only harmless files
 */
export function isSafeForScaffold(state: DirectoryState): boolean {
  return !state.exists || state.isEmpty;
}

// ============================================================================
// TARGET DIRECTORY RESOLUTION
// ============================================================================

/**
 * Build recommended locations for monorepo
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param appName - App name to use
 * @param hasApps - Whether apps/ directory exists
 * @param hasPackages - Whether packages/ directory exists
 * @returns Array of recommended locations
 */
export function buildMonorepoLocations(
  workspaceRoot: string,
  appName: string,
  hasApps: boolean,
  hasPackages: boolean
): RecommendedLocation[] {
  const locations: RecommendedLocation[] = [];
  
  // apps/<name> - recommended if apps/ exists
  if (hasApps) {
    locations.push({
      label: `apps/${appName}`,
      path: path.join(workspaceRoot, 'apps', appName),
      recommended: true,
    });
  } else {
    // Even if apps/ doesn't exist, it's the conventional location
    locations.push({
      label: `apps/${appName} (will create apps/)`,
      path: path.join(workspaceRoot, 'apps', appName),
      recommended: !hasPackages, // recommended if no packages/ either
    });
  }
  
  // packages/<name>
  if (hasPackages) {
    locations.push({
      label: `packages/${appName}`,
      path: path.join(workspaceRoot, 'packages', appName),
      recommended: !hasApps, // recommended only if no apps/
    });
  } else {
    locations.push({
      label: `packages/${appName} (will create packages/)`,
      path: path.join(workspaceRoot, 'packages', appName),
      recommended: false,
    });
  }
  
  // Root-level (not recommended in monorepo)
  locations.push({
    label: `${appName} (root level, not recommended)`,
    path: path.join(workspaceRoot, appName),
    recommended: false,
  });
  
  return locations;
}

/**
 * Resolve target directory for scaffold
 * 
 * Rules:
 * 1. In monorepo: prefer apps/<name> if apps/ exists, else packages/<name>
 * 2. Non-monorepo: <workspace_root>/<app_name>
 * 3. If target already exists and non-empty, return conflict
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param appName - App name to use
 * @param fs - File system adapter
 * @returns Preflight result
 */
export async function resolveScaffoldTargetDirectory(
  workspaceRoot: string,
  appName: string,
  fs: FileSystemAdapter
): Promise<PreflightResult> {
  // Step 1: Check if workspace root is a monorepo
  const monorepoType = await detectMonorepoType(workspaceRoot, fs);
  const isMonorepo = monorepoType !== undefined;
  
  const { hasApps, hasPackages } = await detectMonorepoCandidateFolders(workspaceRoot, fs);
  
  // Step 2: Determine candidates
  let candidates: RecommendedLocation[] = [];
  let defaultTarget: string;
  let targetReason: TargetChoiceReason = 'default';
  
  if (isMonorepo || hasApps || hasPackages) {
    // Monorepo mode
    candidates = buildMonorepoLocations(workspaceRoot, appName, hasApps, hasPackages);
    
    // Auto-select if clear winner
    const recommended = candidates.find(c => c.recommended);
    if (recommended) {
      defaultTarget = recommended.path;
      targetReason = 'monorepo_choice';
    } else if (hasApps) {
      defaultTarget = path.join(workspaceRoot, 'apps', appName);
      targetReason = 'monorepo_choice';
    } else if (hasPackages) {
      defaultTarget = path.join(workspaceRoot, 'packages', appName);
      targetReason = 'monorepo_choice';
    } else {
      // Ambiguous - apps and packages don't exist but markers detected
      defaultTarget = path.join(workspaceRoot, 'apps', appName);
      targetReason = 'monorepo_choice';
    }
  } else {
    // Non-monorepo: simple workspace/<app_name>
    defaultTarget = path.join(workspaceRoot, appName);
    targetReason = 'default';
    
    // Add single candidate
    candidates = [
      {
        label: appName,
        path: defaultTarget,
        recommended: true,
      },
    ];
  }
  
  // Step 3: Check target directory state
  const dirState = await checkDirectoryState(defaultTarget, fs);
  
  // Step 4: Build conflicts array
  const conflicts: PreflightConflict[] = [];
  
  if (!isSafeForScaffold(dirState)) {
    if (dirState.hasPackageJson) {
      conflicts.push({
        type: 'EXISTING_PACKAGE_JSON' as PreflightConflictType,
        message: `Directory already contains package.json: ${defaultTarget}`,
      });
    } else {
      conflicts.push({
        type: 'NON_EMPTY_DIR' as PreflightConflictType,
        message: `Directory is not empty: ${defaultTarget} (contains ${dirState.nonHarmlessFiles.length} files)`,
      });
    }
  }
  
  // Check if monorepo is ambiguous (both apps/ and packages/ exist with unclear preference)
  const isAmbiguousMonorepo = isMonorepo && hasApps && hasPackages;
  if (isAmbiguousMonorepo) {
    conflicts.push({
      type: 'MONOREPO_AMBIGUOUS' as PreflightConflictType,
      message: 'Monorepo detected with both apps/ and packages/ directories. Please choose a location.',
    });
  }
  
  // Step 5: Determine if decision is needed
  const needsDecision = conflicts.length > 0;
  let decisionType: 'monorepo_choice' | 'non_empty_dir' | undefined;
  
  if (needsDecision) {
    if (conflicts.some(c => c.type === 'MONOREPO_AMBIGUOUS')) {
      decisionType = 'monorepo_choice';
    } else if (conflicts.some(c => c.type === 'NON_EMPTY_DIR' || c.type === 'EXISTING_PACKAGE_JSON')) {
      decisionType = 'non_empty_dir';
    }
  }
  
  return {
    targetDirectory: defaultTarget,
    isEmptyDir: dirState.isEmpty,
    hasPackageJson: dirState.hasPackageJson,
    detectedMonorepo: isMonorepo || hasApps || hasPackages,
    monorepoType,
    recommendedLocations: candidates,
    conflicts,
    needsDecision,
    decisionType,
  };
}

// ============================================================================
// SCAFFOLD PREFLIGHT COORDINATOR
// ============================================================================

/**
 * Scaffold Preflight Coordinator
 * 
 * Orchestrates the preflight phase:
 * 1. Extract app name from prompt
 * 2. Resolve target directory
 * 3. Check directory state
 * 4. Detect monorepo
 * 5. Emit replay-safe events
 * 6. Request decision if conflicts exist
 */
export class ScaffoldPreflightCoordinator {
  private eventBus: EventBus;
  private fs: FileSystemAdapter;
  
  constructor(eventBus: EventBus, fs: FileSystemAdapter) {
    this.eventBus = eventBus;
    this.fs = fs;
  }
  
  /**
   * Run preflight checks
   * 
   * @param scaffoldId - Stable scaffold ID
   * @param runId - Associated run ID
   * @param workspaceRoot - Absolute path to workspace root
   * @param userPrompt - User's original prompt
   * @returns Preflight result with events emitted
   */
  async runPreflight(
    scaffoldId: string,
    runId: string,
    workspaceRoot: string,
    userPrompt: string
  ): Promise<PreflightResult> {
    // Emit preflight_started
    await this.emitPreflightStarted(scaffoldId, workspaceRoot);
    
    // Extract app name
    const appName = extractAppName(userPrompt);
    
    // Resolve target directory
    const result = await resolveScaffoldTargetDirectory(workspaceRoot, appName, this.fs);
    
    // Emit target_chosen (even if decision needed, we record the default choice)
    await this.emitTargetChosen(
      scaffoldId,
      result.targetDirectory,
      result.detectedMonorepo ? 'monorepo_choice' : 'default',
      appName
    );
    
    // Emit preflight_completed
    await this.emitPreflightCompleted(scaffoldId, result);
    
    return result;
  }
  
  /**
   * Handle user selection of target directory (after decision point)
   * 
   * @param scaffoldId - Stable scaffold ID
   * @param selectedPath - User-selected absolute path
   * @param appName - App name
   */
  async handleTargetSelection(
    scaffoldId: string,
    selectedPath: string,
    appName: string
  ): Promise<void> {
    await this.emitTargetChosen(scaffoldId, selectedPath, 'user_selected', appName);
  }
  
  /**
   * Handle user cancellation due to conflicts
   */
  async handleBlockedByConflict(
    scaffoldId: string,
    targetDirectory: string,
    reason: 'non_empty_dir' | 'monorepo_ambiguous' | 'user_cancelled',
    message: string
  ): Promise<void> {
    await this.emitScaffoldBlocked(scaffoldId, targetDirectory, reason, message);
  }
  
  // =========================================================================
  // PRIVATE: Event Emission
  // =========================================================================
  
  private async emitPreflightStarted(scaffoldId: string, workspaceRoot: string): Promise<void> {
    const payload: ScaffoldPreflightStartedPayload = {
      scaffold_id: scaffoldId,
      workspace_root: workspaceRoot,
      created_at_iso: new Date().toISOString(),
    };
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: scaffoldId,
      timestamp: payload.created_at_iso,
      type: 'scaffold_preflight_started',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  private async emitTargetChosen(
    scaffoldId: string,
    targetDirectory: string,
    reason: TargetChoiceReason,
    appName?: string
  ): Promise<void> {
    const payload: ScaffoldTargetChosenPayload = {
      scaffold_id: scaffoldId,
      target_directory: targetDirectory,
      reason,
      app_name: appName,
    };
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: scaffoldId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_target_chosen',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  private async emitPreflightCompleted(
    scaffoldId: string,
    result: PreflightResult
  ): Promise<void> {
    const payload: ScaffoldPreflightCompletedPayload = {
      scaffold_id: scaffoldId,
      target_directory: result.targetDirectory,
      is_empty_dir: result.isEmptyDir,
      has_package_json: result.hasPackageJson,
      detected_monorepo: result.detectedMonorepo,
      monorepo_type: result.monorepoType,
      recommended_locations: result.recommendedLocations,
      conflicts: result.conflicts,
    };
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: scaffoldId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_preflight_completed',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  private async emitScaffoldBlocked(
    scaffoldId: string,
    targetDirectory: string,
    reason: 'non_empty_dir' | 'monorepo_ambiguous' | 'user_cancelled',
    message: string
  ): Promise<void> {
    const payload: ScaffoldBlockedPayload = {
      scaffold_id: scaffoldId,
      target_directory: targetDirectory,
      reason,
      message,
    };
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: scaffoldId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_blocked',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
}

// ============================================================================
// DECISION POINT BUILDERS
// ============================================================================

/**
 * Build decision point options for non-empty directory conflict
 */
export function buildNonEmptyDirDecisionOptions(
  targetDirectory: string,
  appName: string
): Array<{
  label: string;
  action: string;
  description: string;
  primary?: boolean;
  value?: string;
}> {
  const parentDir = path.dirname(targetDirectory);
  const newSubfolder = `${appName}-new`;
  const alternativePath = path.join(parentDir, newSubfolder);
  
  return [
    {
      label: 'Choose Different Folder',
      action: 'choose_folder',
      description: 'Select a different directory for the project',
      primary: true,
    },
    {
      label: `Create in ${newSubfolder}`,
      action: 'create_subfolder',
      description: `Create project in ${alternativePath}`,
      value: alternativePath,
    },
    {
      label: 'Cancel',
      action: 'cancel',
      description: 'Cancel scaffold and return to chat',
    },
  ];
}

/**
 * Build decision point options for monorepo location choice
 */
export function buildMonorepoChoiceOptions(
  locations: RecommendedLocation[]
): Array<{
  label: string;
  action: string;
  description: string;
  primary?: boolean;
  value?: string;
}> {
  const locationOptions = locations.map((loc, index) => ({
    label: loc.label,
    action: 'select_location',
    description: loc.recommended ? 'Recommended' : '',
    primary: loc.recommended || index === 0,
    value: loc.path,
  }));
  
  const cancelOption = {
    label: 'Cancel',
    action: 'cancel',
    description: 'Cancel scaffold and return to chat',
    primary: false,
    value: '',
  };
  
  return [...locationOptions, cancelOption];
}

// ============================================================================
// STATE DERIVATION (REPLAY-SAFE)
// ============================================================================

/**
 * Derive preflight state from events (replay-safe)
 */
export interface PreflightState {
  preflightStarted: boolean;
  preflightCompleted: boolean;
  targetChosen: boolean;
  blocked: boolean;
  targetDirectory?: string;
  appName?: string;
  monorepoType?: MonorepoType;
  isEmptyDir?: boolean;
  conflicts?: PreflightConflict[];
  blockReason?: string;
}

/**
 * Derive preflight state from events
 */
export function derivePreflightState(events: Event[]): PreflightState {
  let state: PreflightState = {
    preflightStarted: false,
    preflightCompleted: false,
    targetChosen: false,
    blocked: false,
  };
  
  for (const event of events) {
    switch (event.type) {
      case 'scaffold_preflight_started':
        state.preflightStarted = true;
        break;
        
      case 'scaffold_target_chosen': {
        const payload = event.payload as unknown as ScaffoldTargetChosenPayload;
        state.targetChosen = true;
        state.targetDirectory = payload.target_directory;
        state.appName = payload.app_name;
        break;
      }
        
      case 'scaffold_preflight_completed': {
        const payload = event.payload as unknown as ScaffoldPreflightCompletedPayload;
        state.preflightCompleted = true;
        state.targetDirectory = payload.target_directory;
        state.isEmptyDir = payload.is_empty_dir;
        state.monorepoType = payload.monorepo_type;
        state.conflicts = payload.conflicts;
        break;
      }
        
      case 'scaffold_blocked': {
        const payload = event.payload as unknown as ScaffoldBlockedPayload;
        state.blocked = true;
        state.blockReason = payload.reason;
        break;
      }
    }
  }
  
  return state;
}

