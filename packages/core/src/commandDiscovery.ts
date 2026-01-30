/**
 * Step 34: Command Discovery Service
 * 
 * Deterministically discovers safe verification commands from project files.
 * 
 * CRITICAL RULES:
 * - NO LLM - pure deterministic rules only
 * - Stable ordering (lint → test → build)
 * - Safety checks against policy allowlist/blocklist
 * - If no safe commands found, emit decision_point_needed
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DiscoveredCommand,
  VerifyPolicyConfig,
  isCommandSafe,
} from './verifyPolicy';

/**
 * Preferred script names in order of execution priority
 * lint before test before build for fast feedback
 */
const PREFERRED_SCRIPT_ORDER = [
  // Linting (fastest, catch syntax/style errors early)
  'lint',
  'eslint',
  'tslint',
  'check',
  'typecheck',
  
  // Type checking
  'tsc',
  'type-check',
  
  // Testing
  'test',
  'test:unit',
  'test:integration',
  'jest',
  'vitest',
  
  // Building (slowest, but comprehensive)
  'build',
  'compile',
];

/**
 * Discover verification commands from workspace
 * 
 * Uses deterministic rules to find commands in package.json, Makefile, etc.
 * Returns commands in stable order for reproducibility.
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param policy - Verify policy for safety checks
 * @returns Array of discovered commands in execution order
 */
export function discoverVerifyCommands(
  workspaceRoot: string,
  policy: VerifyPolicyConfig
): DiscoveredCommand[] {
  const commands: DiscoveredCommand[] = [];

  // Try package.json first (most common in JS/TS projects)
  const packageJsonCommands = discoverFromPackageJson(workspaceRoot, policy);
  commands.push(...packageJsonCommands);

  // Future: Could add Makefile, Cargo.toml, etc.
  // For now, package.json is sufficient for JS/TS ecosystem

  return commands;
}

/**
 * Discover commands from package.json scripts
 * 
 * @param workspaceRoot - Workspace root directory
 * @param policy - Verify policy for safety checks
 * @returns Discovered commands in preferred order
 */
function discoverFromPackageJson(
  workspaceRoot: string,
  policy: VerifyPolicyConfig
): DiscoveredCommand[] {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');

  // Check if package.json exists
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  let packageJson: any;
  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content);
  } catch (error) {
    // Invalid package.json, skip
    return [];
  }

  // Get scripts section
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== 'object') {
    return [];
  }

  // Determine package manager command prefix
  const pkgManager = detectPackageManager(workspaceRoot);

  // Map discovered commands with metadata
  const discoveredMap = new Map<string, DiscoveredCommand>();

  // Process each script
  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    if (typeof scriptCommand !== 'string') continue;

    // Skip watch modes (never safe for verification)
    if (isWatchMode(scriptCommand)) {
      continue;
    }

    // Build full command with package manager
    const fullCommand = `${pkgManager} run ${scriptName}`;

    // Check safety
    const safetyCheck = isCommandSafe(fullCommand, policy);

    const discovered: DiscoveredCommand = {
      name: scriptName,
      command: fullCommand,
      source: 'package.json',
      safe: safetyCheck.safe,
      reasonIfUnsafe: safetyCheck.reason,
      scriptName,
    };

    discoveredMap.set(scriptName, discovered);
  }

  // Sort by preferred order (stable ordering)
  const commands: DiscoveredCommand[] = [];

  // First, add commands in preferred order
  for (const preferredName of PREFERRED_SCRIPT_ORDER) {
    if (discoveredMap.has(preferredName)) {
      commands.push(discoveredMap.get(preferredName)!);
      discoveredMap.delete(preferredName);
    }
  }

  // Then add any remaining scripts (alphabetically for stability)
  const remaining = Array.from(discoveredMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  commands.push(...remaining);

  return commands;
}

/**
 * Detect package manager based on lock files
 * 
 * @param workspaceRoot - Workspace root directory
 * @returns Package manager command prefix
 */
function detectPackageManager(workspaceRoot: string): string {
  // Check for pnpm-lock.yaml
  if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  // Check for yarn.lock
  if (fs.existsSync(path.join(workspaceRoot, 'yarn.lock'))) {
    return 'yarn';
  }

  // Check for package-lock.json or default to npm
  return 'npm';
}

/**
 * Check if a command runs in watch mode
 * Watch mode commands should never be used for verification
 * 
 * @param command - Command string to check
 * @returns true if watch mode detected
 */
function isWatchMode(command: string): boolean {
  const watchPatterns = [
    /--watch\b/,
    /--watchAll\b/,
    /-w\b/,
    /\bwatch\b/,
    /--dev\b/,
    /\bdev\b/,
    /--serve\b/,
    /\bserve\b/,
    /\bstart\b/,
  ];

  return watchPatterns.some((pattern) => pattern.test(command));
}

/**
 * Filter commands to only safe ones
 * 
 * @param commands - All discovered commands
 * @returns Only safe commands
 */
export function filterSafeCommands(
  commands: DiscoveredCommand[]
): DiscoveredCommand[] {
  return commands.filter((cmd) => cmd.safe);
}

/**
 * Get summary of discovery results for decision point
 * 
 * @param commands - Discovered commands
 * @returns Human-readable summary
 */
export function getDiscoverySummary(commands: DiscoveredCommand[]): {
  total: number;
  safe: number;
  unsafe: number;
  hasAny: boolean;
  hasSafe: boolean;
  summary: string;
} {
  const safe = commands.filter((c) => c.safe);
  const unsafe = commands.filter((c) => !c.safe);

  let summary = '';
  if (commands.length === 0) {
    summary = 'No verification commands discovered';
  } else if (safe.length === 0) {
    summary = `Found ${commands.length} command(s), but none are safe to auto-run`;
  } else {
    summary = `Discovered ${safe.length} safe verification command(s): ${safe
      .map((c) => c.name)
      .join(', ')}`;
  }

  return {
    total: commands.length,
    safe: safe.length,
    unsafe: unsafe.length,
    hasAny: commands.length > 0,
    hasSafe: safe.length > 0,
    summary,
  };
}

/**
 * Create decision point options when no commands discovered
 * 
 * @returns Decision point options for UI
 */
export function createNoCommandsDecisionOptions(): Array<{
  label: string;
  action: string;
  description: string;
}> {
  return [
    {
      label: 'Enter command manually',
      action: 'provide_command',
      description: 'Specify a custom verification command',
    },
    {
      label: 'Open package.json',
      action: 'open_package_json',
      description: 'Add scripts to package.json',
    },
    {
      label: 'Skip verification',
      action: 'skip_once',
      description: 'Skip verification for this run',
    },
    {
      label: 'Disable verification',
      action: 'disable_verify',
      description: 'Turn off verification for this workspace',
    },
  ];
}

/**
 * Create decision point options when no safe commands found
 * 
 * @param unsafeCommands - Commands that were found but deemed unsafe
 * @returns Decision point options for UI
 */
export function createNoSafeCommandsDecisionOptions(
  unsafeCommands: DiscoveredCommand[]
): Array<{
  label: string;
  action: string;
  description: string;
  command?: string;
}> {
  const options = [];

  // Offer to review unsafe commands
  if (unsafeCommands.length > 0) {
    for (const cmd of unsafeCommands.slice(0, 3)) {
      // Max 3
      options.push({
        label: `Review and run: ${cmd.name}`,
        action: 'review_unsafe_command',
        description: `Not safe: ${cmd.reasonIfUnsafe}`,
        command: cmd.command,
      });
    }
  }

  // Common fallback options
  options.push(
    {
      label: 'Enter command manually',
      action: 'provide_command',
      description: 'Specify a custom verification command',
    },
    {
      label: 'Skip verification',
      action: 'skip_once',
      description: 'Skip verification for this run',
    },
    {
      label: 'Disable verification',
      action: 'disable_verify',
      description: 'Turn off verification for this workspace',
    }
  );

  return options;
}
