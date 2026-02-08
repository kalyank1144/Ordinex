/**
 * Step 40.5: Codebase Context - Intelligence Layer
 *
 * Gathers project information WITHOUT any LLM calls.
 * Pure file system checks - fast and deterministic.
 *
 * This is Deliverable A of the Intelligence Layer.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Project type detected from file structure
 */
export type ProjectType =
  | 'nextjs' | 'react' | 'express' | 'vite' | 'astro' | 'nuxt'
  | 'remix' | 'sveltekit' | 'gatsby' | 'react-native' | 'expo'
  | 'electron' | 'fastify' | 'nestjs'
  | 'unknown';

/**
 * Testing framework detected from config files and dependencies
 */
export type TestingFramework = 'vitest' | 'jest' | 'mocha' | 'playwright' | 'cypress' | 'none';

/**
 * CI/CD provider detected from config files
 */
export type CICDProvider = 'github-actions' | 'gitlab-ci' | 'circleci' | 'jenkins' | 'none';

/**
 * Container tool detected from config files
 */
export type ContainerTool = 'docker-compose' | 'docker' | 'none';

/**
 * Cloud provider detected from config files
 */
export type CloudProvider = 'vercel' | 'netlify' | 'aws' | 'gcp' | 'azure' | 'none';

/**
 * Intelligence layer settings (deterministic defaults)
 */
export interface IntelligenceSettings {
  sessionPersistence: 'off' | 'on';
  maxSelectedTextChars: number;
  maxDiagnostics: number;
}

export const DEFAULT_INTELLIGENCE_SETTINGS: IntelligenceSettings = {
  sessionPersistence: 'off',
  maxSelectedTextChars: 400,
  maxDiagnostics: 10,
};

/**
 * Package manager detected from lock files
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Source structure pattern
 */
export type SrcStructure = 'flat' | 'feature-based' | 'layer-based' | 'unknown';

/**
 * Detected component library
 */
export type ComponentLibrary = 'shadcn' | 'mui' | 'chakra' | 'radix' | 'antd' | 'none';

/**
 * Codebase context - gathered from file system analysis
 *
 * This is the canonical interface for project context.
 * All fields are gathered WITHOUT LLM calls.
 */
export interface CodebaseContext {
  /** Detected project type */
  projectType: ProjectType;

  /** Whether TypeScript is configured */
  hasTypeScript: boolean;

  /** Detected package manager */
  packageManager: PackageManager;

  /** Currently open files in editor (passed from VS Code) */
  openFiles: string[];

  /** Recently modified files (last 5) */
  recentlyModified: string[];

  /** Whether auth setup is detected */
  hasAuth: boolean;

  /** Whether database setup is detected */
  hasDatabase: boolean;

  /** Detected component library */
  componentLibrary: ComponentLibrary;

  /** Source directory structure pattern */
  srcStructure: SrcStructure;

  /** Root dependencies from package.json */
  dependencies: string[];

  /** Dev dependencies from package.json */
  devDependencies: string[];

  /** Whether this is a monorepo */
  isMonorepo: boolean;

  /** Monorepo type if detected */
  monorepoType?: 'pnpm-workspaces' | 'turborepo' | 'nx' | 'lerna';

  /** Detected testing framework */
  testingFramework: TestingFramework;

  /** Detected CI/CD provider */
  cicdProvider: CICDProvider;

  /** Detected container tool */
  containerTool: ContainerTool;

  /** Detected cloud provider */
  cloudProvider: CloudProvider;

  /** Workspace root path */
  workspaceRoot: string;

  /** When context was gathered */
  gatheredAt: string;
}

// ============================================================================
// DETECTION FUNCTIONS
// ============================================================================

/**
 * Detect project type from configuration files
 */
export function detectProjectType(workspaceRoot: string): ProjectType {
  // Next.js
  if (
    fileExists(workspaceRoot, 'next.config.js') ||
    fileExists(workspaceRoot, 'next.config.mjs') ||
    fileExists(workspaceRoot, 'next.config.ts')
  ) {
    return 'nextjs';
  }

  // Vite
  if (
    fileExists(workspaceRoot, 'vite.config.js') ||
    fileExists(workspaceRoot, 'vite.config.ts') ||
    fileExists(workspaceRoot, 'vite.config.mjs')
  ) {
    return 'vite';
  }

  // Astro
  if (
    fileExists(workspaceRoot, 'astro.config.js') ||
    fileExists(workspaceRoot, 'astro.config.mjs') ||
    fileExists(workspaceRoot, 'astro.config.ts')
  ) {
    return 'astro';
  }

  // Nuxt
  if (
    fileExists(workspaceRoot, 'nuxt.config.js') ||
    fileExists(workspaceRoot, 'nuxt.config.ts')
  ) {
    return 'nuxt';
  }

  // Remix
  if (
    fileExists(workspaceRoot, 'remix.config.js') ||
    fileExists(workspaceRoot, 'remix.config.ts')
  ) {
    return 'remix';
  }

  // SvelteKit
  if (fileExists(workspaceRoot, 'svelte.config.js') || fileExists(workspaceRoot, 'svelte.config.ts')) {
    return 'sveltekit';
  }

  // Gatsby
  if (fileExists(workspaceRoot, 'gatsby-config.js') || fileExists(workspaceRoot, 'gatsby-config.ts')) {
    return 'gatsby';
  }

  // Dependency-based detection
  const pkg = readPackageJson(workspaceRoot);
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps['@nestjs/core']) return 'nestjs';
    if (allDeps['fastify']) return 'fastify';
    if (allDeps['electron']) return 'electron';
    if (allDeps['expo']) return 'expo';
    if (allDeps['react-native'] && !allDeps['expo']) return 'react-native';
    if (allDeps['express']) return 'express';

    // React (CRA or other React setups without Next/Vite)
    if (allDeps['react'] && !allDeps['next'] && !allDeps['vite']) {
      return 'react';
    }
  }

  return 'unknown';
}

/**
 * Detect if TypeScript is configured
 */
export function detectTypeScript(workspaceRoot: string): boolean {
  return fileExists(workspaceRoot, 'tsconfig.json');
}

/**
 * Detect package manager from lock files
 */
export function detectPackageManager(workspaceRoot: string): PackageManager {
  if (fileExists(workspaceRoot, 'pnpm-lock.yaml')) {
    return 'pnpm';
  }
  if (fileExists(workspaceRoot, 'yarn.lock')) {
    return 'yarn';
  }
  if (fileExists(workspaceRoot, 'bun.lockb')) {
    return 'bun';
  }
  // Default to npm
  return 'npm';
}

/**
 * Detect if auth setup exists
 */
export function detectAuth(workspaceRoot: string): boolean {
  const pkg = readPackageJson(workspaceRoot);
  if (!pkg) return false;

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Check for common auth packages
  const authPackages = [
    'next-auth',
    '@auth/core',
    '@supabase/auth-helpers-nextjs',
    '@supabase/auth-ui-react',
    'passport',
    'express-session',
    '@clerk/nextjs',
    '@clerk/clerk-react',
    'lucia',
    '@lucia-auth/adapter-prisma',
    'firebase',
    '@firebase/auth',
  ];

  return authPackages.some(pkg => allDeps[pkg]);
}

/**
 * Detect if database setup exists
 */
export function detectDatabase(workspaceRoot: string): boolean {
  const pkg = readPackageJson(workspaceRoot);
  if (!pkg) return false;

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Check for common database packages
  const dbPackages = [
    '@supabase/supabase-js',
    'prisma',
    '@prisma/client',
    'drizzle-orm',
    'mongoose',
    'typeorm',
    'pg',
    'mysql2',
    'better-sqlite3',
    '@planetscale/database',
    'mongodb',
    '@vercel/postgres',
    '@neon/serverless',
  ];

  return dbPackages.some(pkg => allDeps[pkg]);
}

/**
 * Detect component library
 */
export function detectComponentLibrary(workspaceRoot: string): ComponentLibrary {
  const pkg = readPackageJson(workspaceRoot);
  if (!pkg) return 'none';

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Check for shadcn (components.json marker)
  if (fileExists(workspaceRoot, 'components.json')) {
    return 'shadcn';
  }

  // MUI
  if (allDeps['@mui/material'] || allDeps['@material-ui/core']) {
    return 'mui';
  }

  // Chakra
  if (allDeps['@chakra-ui/react']) {
    return 'chakra';
  }

  // Radix (raw, not shadcn)
  if (allDeps['@radix-ui/react-alert-dialog'] || allDeps['@radix-ui/themes']) {
    return 'radix';
  }

  // Ant Design
  if (allDeps['antd']) {
    return 'antd';
  }

  return 'none';
}

/**
 * Detect source structure pattern
 */
export function detectSrcStructure(workspaceRoot: string): SrcStructure {
  const srcPath = path.join(workspaceRoot, 'src');
  const appPath = path.join(workspaceRoot, 'app');

  // Check for Next.js app directory
  if (dirExists(appPath)) {
    // Check for feature-based (e.g., app/dashboard, app/settings)
    const appContents = safeReadDir(appPath);
    const hasFeatureDirs = appContents.some(name =>
      !name.startsWith('(') &&
      !name.startsWith('[') &&
      !['api', 'layout.tsx', 'page.tsx', 'globals.css'].includes(name) &&
      dirExists(path.join(appPath, name))
    );

    if (hasFeatureDirs) {
      return 'feature-based';
    }
  }

  if (dirExists(srcPath)) {
    const srcContents = safeReadDir(srcPath);

    // Feature-based: src/features, src/modules
    if (srcContents.includes('features') || srcContents.includes('modules')) {
      return 'feature-based';
    }

    // Layer-based: src/components, src/hooks, src/utils, src/services
    const layerDirs = ['components', 'hooks', 'utils', 'services', 'lib', 'api'];
    const hasLayers = layerDirs.filter(d => srcContents.includes(d)).length >= 2;
    if (hasLayers) {
      return 'layer-based';
    }

    return 'flat';
  }

  return 'unknown';
}

/**
 * Detect monorepo configuration
 */
export function detectMonorepo(workspaceRoot: string): { isMonorepo: boolean; type?: CodebaseContext['monorepoType'] } {
  // Turborepo
  if (fileExists(workspaceRoot, 'turbo.json')) {
    return { isMonorepo: true, type: 'turborepo' };
  }

  // Nx
  if (fileExists(workspaceRoot, 'nx.json')) {
    return { isMonorepo: true, type: 'nx' };
  }

  // Lerna
  if (fileExists(workspaceRoot, 'lerna.json')) {
    return { isMonorepo: true, type: 'lerna' };
  }

  // pnpm workspaces
  if (fileExists(workspaceRoot, 'pnpm-workspace.yaml')) {
    return { isMonorepo: true, type: 'pnpm-workspaces' };
  }

  // Check package.json for workspaces field
  const pkg = readPackageJson(workspaceRoot);
  if (pkg?.workspaces) {
    return { isMonorepo: true, type: 'pnpm-workspaces' };
  }

  return { isMonorepo: false };
}

/**
 * Get recently modified files in workspace
 */
export function getRecentlyModifiedFiles(workspaceRoot: string, limit: number = 5): string[] {
  const files: Array<{ path: string; mtime: number }> = [];

  // Scan common source directories
  const dirsToScan = ['src', 'app', 'pages', 'components', 'lib', 'utils'];

  for (const dir of dirsToScan) {
    const dirPath = path.join(workspaceRoot, dir);
    if (dirExists(dirPath)) {
      scanForRecentFiles(dirPath, files, workspaceRoot);
    }
  }

  // Sort by modification time (newest first)
  files.sort((a, b) => b.mtime - a.mtime);

  // Return relative paths
  return files.slice(0, limit).map(f => f.path);
}

/**
 * Get dependencies from package.json
 */
export function getDependencies(workspaceRoot: string): { dependencies: string[]; devDependencies: string[] } {
  const pkg = readPackageJson(workspaceRoot);

  if (!pkg) {
    return { dependencies: [], devDependencies: [] };
  }

  return {
    dependencies: Object.keys(pkg.dependencies || {}),
    devDependencies: Object.keys(pkg.devDependencies || {}),
  };
}

// ============================================================================
// NEW DETECTION FUNCTIONS (Step 40.5 Enhancement)
// ============================================================================

/**
 * Detect testing framework from config files and dependencies
 */
export function detectTestingFramework(workspaceRoot: string): TestingFramework {
  // Config-file checks first (most specific)
  if (fileExists(workspaceRoot, 'vitest.config.ts') || fileExists(workspaceRoot, 'vitest.config.js')) {
    return 'vitest';
  }
  if (fileExists(workspaceRoot, 'jest.config.js') || fileExists(workspaceRoot, 'jest.config.ts') || fileExists(workspaceRoot, 'jest.config.mjs')) {
    return 'jest';
  }
  if (fileExists(workspaceRoot, 'playwright.config.ts') || fileExists(workspaceRoot, 'playwright.config.js')) {
    return 'playwright';
  }
  if (fileExists(workspaceRoot, 'cypress.config.ts') || fileExists(workspaceRoot, 'cypress.config.js') || fileExists(workspaceRoot, 'cypress.json')) {
    return 'cypress';
  }
  if (fileExists(workspaceRoot, '.mocharc.yml') || fileExists(workspaceRoot, '.mocharc.json') || fileExists(workspaceRoot, '.mocharc.js')) {
    return 'mocha';
  }

  // Fallback to package.json deps
  const pkg = readPackageJson(workspaceRoot);
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps['vitest']) return 'vitest';
    if (allDeps['jest']) return 'jest';
    if (allDeps['@playwright/test']) return 'playwright';
    if (allDeps['cypress']) return 'cypress';
    if (allDeps['mocha']) return 'mocha';
  }

  return 'none';
}

/**
 * Detect CI/CD provider from config files
 */
export function detectCICD(workspaceRoot: string): CICDProvider {
  if (dirExists(path.join(workspaceRoot, '.github', 'workflows'))) return 'github-actions';
  if (fileExists(workspaceRoot, '.gitlab-ci.yml')) return 'gitlab-ci';
  if (dirExists(path.join(workspaceRoot, '.circleci'))) return 'circleci';
  if (fileExists(workspaceRoot, 'Jenkinsfile')) return 'jenkins';
  return 'none';
}

/**
 * Detect container tool from config files
 */
export function detectContainerTool(workspaceRoot: string): ContainerTool {
  if (fileExists(workspaceRoot, 'docker-compose.yml') || fileExists(workspaceRoot, 'docker-compose.yaml') || fileExists(workspaceRoot, 'compose.yml') || fileExists(workspaceRoot, 'compose.yaml')) {
    return 'docker-compose';
  }
  if (fileExists(workspaceRoot, 'Dockerfile')) return 'docker';
  return 'none';
}

/**
 * Detect cloud provider from config files
 */
export function detectCloudProvider(workspaceRoot: string): CloudProvider {
  if (fileExists(workspaceRoot, 'vercel.json')) return 'vercel';
  if (fileExists(workspaceRoot, 'netlify.toml')) return 'netlify';
  if (fileExists(workspaceRoot, 'serverless.yml') || fileExists(workspaceRoot, 'serverless.yaml') || fileExists(workspaceRoot, 'samconfig.toml')) return 'aws';
  if (fileExists(workspaceRoot, 'app.yaml') || fileExists(workspaceRoot, 'firebase.json')) return 'gcp';
  if (fileExists(workspaceRoot, 'azure-pipelines.yml')) return 'azure';
  return 'none';
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Gather complete codebase context
 *
 * This is the main entry point for codebase analysis.
 * All detection is done via file system - NO LLM calls.
 *
 * @param workspaceRoot - Root path of the workspace
 * @param openFiles - Currently open files in editor (from VS Code)
 * @returns CodebaseContext with all detected information
 */
export function gatherCodebaseContext(
  workspaceRoot: string,
  openFiles: string[] = []
): CodebaseContext {
  const monorepo = detectMonorepo(workspaceRoot);
  const deps = getDependencies(workspaceRoot);

  return {
    projectType: detectProjectType(workspaceRoot),
    hasTypeScript: detectTypeScript(workspaceRoot),
    packageManager: detectPackageManager(workspaceRoot),
    openFiles,
    recentlyModified: getRecentlyModifiedFiles(workspaceRoot),
    hasAuth: detectAuth(workspaceRoot),
    hasDatabase: detectDatabase(workspaceRoot),
    componentLibrary: detectComponentLibrary(workspaceRoot),
    srcStructure: detectSrcStructure(workspaceRoot),
    dependencies: deps.dependencies,
    devDependencies: deps.devDependencies,
    isMonorepo: monorepo.isMonorepo,
    monorepoType: monorepo.type,
    testingFramework: detectTestingFramework(workspaceRoot),
    cicdProvider: detectCICD(workspaceRoot),
    containerTool: detectContainerTool(workspaceRoot),
    cloudProvider: detectCloudProvider(workspaceRoot),
    workspaceRoot,
    gatheredAt: new Date().toISOString(),
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function fileExists(root: string, filename: string): boolean {
  try {
    return fs.existsSync(path.join(root, filename));
  } catch {
    return false;
  }
}

function dirExists(dirPath: string): boolean {
  try {
    const stat = fs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function safeReadDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

function readPackageJson(workspaceRoot: string): PackageJson | null {
  try {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const content = fs.readFileSync(pkgPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function scanForRecentFiles(
  dirPath: string,
  files: Array<{ path: string; mtime: number }>,
  workspaceRoot: string,
  depth: number = 0
): void {
  if (depth > 3) return; // Limit depth

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip node_modules, .git, dist, build
      if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
        continue;
      }

      if (entry.isFile() && isSourceFile(entry.name)) {
        try {
          const stat = fs.statSync(fullPath);
          const relativePath = path.relative(workspaceRoot, fullPath);
          files.push({ path: relativePath, mtime: stat.mtimeMs });
        } catch {
          // Skip files we can't stat
        }
      } else if (entry.isDirectory()) {
        scanForRecentFiles(fullPath, files, workspaceRoot, depth + 1);
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

function isSourceFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.astro'].includes(ext);
}
