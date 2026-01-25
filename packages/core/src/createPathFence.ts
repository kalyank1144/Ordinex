/**
 * Create Path Fence - Validates file creation paths
 * Enforces safe roots and blocks dangerous paths for file creation
 * 
 * Part of SAFE file creation feature - keeps trust + scope fences intact
 */

import { minimatch } from 'minimatch';

/**
 * Configuration for create path fences
 */
export interface CreatePathFenceConfig {
  /** Allowed roots for file creation (glob patterns) */
  allowedRoots: string[];
  
  /** Explicitly denied paths (glob patterns) - takes precedence over allowed */
  deniedPaths: string[];
  
  /** Maximum lines for a newly created file (prevents massive dumps) */
  maxNewFileSizeLines: number;
  
  /** Extended allowed paths (approved during mission via scope expansion) */
  extendedAllowedPaths?: string[];
}

/**
 * Result of validating a create operation
 */
export interface CreateValidationResult {
  allowed: boolean;
  blockedPaths: Array<{
    path: string;
    reason: 'not_in_allowed_roots' | 'in_denied_paths' | 'exceeds_size_limit';
    message: string;
  }>;
  newFiles: string[];
  requiresScopeExpansion: boolean;
}

/**
 * Default configuration - safe defaults for typical projects
 */
export const DEFAULT_CREATE_PATH_FENCE: CreatePathFenceConfig = {
  allowedRoots: [
    'src/**',
    'packages/**/src/**',
    'app/**',
    'components/**',
    'lib/**',
    'utils/**',
    'hooks/**',
    'contexts/**',
    'services/**',
    'types/**',
    'styles/**',
    'pages/**',
    '__tests__/**',
    'tests/**',
    'spec/**',
  ],
  deniedPaths: [
    'node_modules/**',
    'dist/**',
    'build/**',
    'out/**',
    '.git/**',
    '.env',
    '.env.*',
    '**/.env',
    '**/.env.*',
    '**/secrets/**',
    '**/keys/**',
    '**/credentials/**',
    '*.pem',
    '*.key',
    '*.cert',
    '*.p12',
    '*.pfx',
    '**/*.min.js',
    '**/*.min.css',
    '**/*.bundle.js',
    '**/*.chunk.js',
    '**/vendor/**',
    'coverage/**',
    '.nyc_output/**',
    '.cache/**',
    '.turbo/**',
    '.next/**',
    '.nuxt/**',
    '.vite/**',
  ],
  maxNewFileSizeLines: 500,
  extendedAllowedPaths: [],
};

/**
 * Check if a single path matches any of the glob patterns
 */
function matchesAnyPattern(path: string, patterns: string[]): boolean {
  const normalizedPath = path.replace(/^\/+/, ''); // Remove leading slashes
  for (const pattern of patterns) {
    if (minimatch(normalizedPath, pattern, { dot: true, matchBase: true })) {
      return true;
    }
    // Also try without leading src/ if pattern starts with src/
    if (pattern.startsWith('src/') && minimatch('src/' + normalizedPath, pattern, { dot: true })) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a path is in allowed roots (including extended paths)
 */
export function isPathInAllowedRoots(path: string, config: CreatePathFenceConfig): boolean {
  const allAllowed = [
    ...config.allowedRoots,
    ...(config.extendedAllowedPaths || []),
  ];
  return matchesAnyPattern(path, allAllowed);
}

/**
 * Check if a path is in denied paths
 */
export function isPathInDeniedPaths(path: string, config: CreatePathFenceConfig): boolean {
  return matchesAnyPattern(path, config.deniedPaths);
}

/**
 * Validate a single create path
 */
export function validateCreatePath(
  path: string,
  config: CreatePathFenceConfig = DEFAULT_CREATE_PATH_FENCE
): { allowed: boolean; reason?: string } {
  // Denied paths take precedence
  if (isPathInDeniedPaths(path, config)) {
    return {
      allowed: false,
      reason: `Path "${path}" matches a denied pattern (security/infrastructure path)`,
    };
  }
  
  // Check if in allowed roots
  if (!isPathInAllowedRoots(path, config)) {
    return {
      allowed: false,
      reason: `Path "${path}" is not in allowed roots for file creation`,
    };
  }
  
  return { allowed: true };
}

/**
 * Validate all create operations in a touched_files array
 */
export function validateCreatesInDiff(
  touchedFiles: Array<{
    path: string;
    action: 'create' | 'update' | 'delete';
    new_content?: string;
  }>,
  config: CreatePathFenceConfig = DEFAULT_CREATE_PATH_FENCE
): CreateValidationResult {
  const result: CreateValidationResult = {
    allowed: true,
    blockedPaths: [],
    newFiles: [],
    requiresScopeExpansion: false,
  };
  
  for (const file of touchedFiles) {
    // Only validate 'create' actions
    if (file.action !== 'create') {
      continue;
    }
    
    result.newFiles.push(file.path);
    
    // Check denied paths first (security)
    if (isPathInDeniedPaths(file.path, config)) {
      result.allowed = false;
      result.blockedPaths.push({
        path: file.path,
        reason: 'in_denied_paths',
        message: `Cannot create file in denied path: ${file.path}`,
      });
      continue;
    }
    
    // Check allowed roots
    if (!isPathInAllowedRoots(file.path, config)) {
      result.allowed = false;
      result.requiresScopeExpansion = true;
      result.blockedPaths.push({
        path: file.path,
        reason: 'not_in_allowed_roots',
        message: `File "${file.path}" is outside allowed roots. Requires scope expansion.`,
      });
      continue;
    }
    
    // Check file size
    if (file.new_content) {
      const lineCount = file.new_content.split('\n').length;
      if (lineCount > config.maxNewFileSizeLines) {
        result.allowed = false;
        result.blockedPaths.push({
          path: file.path,
          reason: 'exceeds_size_limit',
          message: `New file "${file.path}" exceeds max size limit (${lineCount} lines > ${config.maxNewFileSizeLines})`,
        });
      }
    }
  }
  
  return result;
}

/**
 * Get human-readable summary of blocked paths
 */
export function getBlockedPathsSummary(result: CreateValidationResult): string {
  if (result.allowed) {
    return 'All create operations are within allowed paths.';
  }
  
  const lines = ['Blocked file creations:'];
  for (const blocked of result.blockedPaths) {
    lines.push(`  - ${blocked.path}: ${blocked.message}`);
  }
  
  if (result.requiresScopeExpansion) {
    lines.push('\nSome paths require scope expansion approval to proceed.');
  }
  
  return lines.join('\n');
}

/**
 * Extend allowed paths for a mission (after scope expansion approval)
 */
export function extendAllowedPaths(
  config: CreatePathFenceConfig,
  newPaths: string[]
): CreatePathFenceConfig {
  return {
    ...config,
    extendedAllowedPaths: [
      ...(config.extendedAllowedPaths || []),
      ...newPaths,
    ],
  };
}

/**
 * Create a config with custom allowed roots
 */
export function createCustomFenceConfig(
  customAllowedRoots?: string[],
  customDeniedPaths?: string[],
  maxNewFileSizeLines?: number
): CreatePathFenceConfig {
  return {
    allowedRoots: customAllowedRoots || DEFAULT_CREATE_PATH_FENCE.allowedRoots,
    deniedPaths: customDeniedPaths || DEFAULT_CREATE_PATH_FENCE.deniedPaths,
    maxNewFileSizeLines: maxNewFileSizeLines || DEFAULT_CREATE_PATH_FENCE.maxNewFileSizeLines,
    extendedAllowedPaths: [],
  };
}
