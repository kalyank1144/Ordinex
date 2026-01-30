/**
 * Project Snapshot (Step 36.2)
 * 
 * Fast, deterministic project analysis for enhancing existing projects.
 * NO LLM calls - pure heuristics and file system inspection.
 * 
 * CRITICAL RULES:
 * - Read-only operations only
 * - Cap traversal to avoid performance issues
 * - Deterministic and replay-safe
 * - Store snapshot as evidence
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Event, Mode, Stage } from './types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Package manager type
 */
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'unknown';

/**
 * Framework detection result
 */
export type DetectedFramework = 
  | 'nextjs_app_router'
  | 'nextjs_pages_router'
  | 'vite_react'
  | 'vite_vue'
  | 'create_react_app'
  | 'expo'
  | 'express'
  | 'nestjs'
  | 'astro'
  | 'remix'
  | 'nuxt'
  | 'angular'
  | 'svelte'
  | 'unknown';

/**
 * Language detection result
 */
export type DetectedLanguage = 'typescript' | 'javascript' | 'mixed' | 'unknown';

/**
 * Discovered script from package.json
 */
export interface DiscoveredScript {
  name: string;
  command: string;
  category: 'lint' | 'test' | 'build' | 'dev' | 'start' | 'other';
}

/**
 * Key file entry point
 */
export interface KeyFile {
  path: string;
  type: 'entry' | 'config' | 'route' | 'layout' | 'component' | 'api';
  framework_role?: string;
}

/**
 * Project Snapshot - Complete project analysis result
 * 
 * This is the primary output of buildProjectSnapshot().
 * Fast to compute, deterministic, and replay-safe.
 */
export interface ProjectSnapshot {
  /** ISO timestamp when snapshot was taken */
  timestamp: string;
  
  /** Absolute workspace root path */
  workspaceRoot: string;
  
  // ====== Package Manager ======
  
  /** Detected package manager (pnpm/yarn/npm) */
  packageManager: PackageManager;
  
  /** Lock file that was used for detection */
  lockFile?: string;
  
  // ====== Framework & Language ======
  
  /** Primary detected framework */
  framework: DetectedFramework;
  
  /** Secondary frameworks (e.g., tRPC, Prisma) */
  additionalFrameworks: string[];
  
  /** TypeScript or JavaScript */
  language: DetectedLanguage;
  
  /** TypeScript config file if present */
  tsConfigPath?: string;
  
  // ====== Project Structure ======
  
  /** Package name from package.json */
  packageName?: string;
  
  /** Package version from package.json */
  packageVersion?: string;
  
  /** Project description from package.json */
  description?: string;
  
  /** Top-level directories */
  topLevelDirs: string[];
  
  /** Key entry files by framework heuristics */
  keyFiles: KeyFile[];
  
  // ====== Scripts ======
  
  /** Discovered npm scripts categorized */
  scripts: DiscoveredScript[];
  
  /** Has lint script */
  hasLintScript: boolean;
  
  /** Has test script */
  hasTestScript: boolean;
  
  /** Has build script */
  hasBuildScript: boolean;
  
  // ====== Dependencies ======
  
  /** Count of production dependencies */
  dependencyCount: number;
  
  /** Count of dev dependencies */
  devDependencyCount: number;
  
  /** Notable dependencies (UI libs, ORMs, etc.) */
  notableDependencies: string[];
  
  // ====== Patterns ======
  
  /** Detected patterns (App Router, tRPC, Prisma, etc.) */
  patterns: string[];
  
  /** ESLint config present */
  hasEslint: boolean;
  
  /** Prettier config present */
  hasPrettier: boolean;
  
  /** Is monorepo */
  isMonorepo: boolean;
  
  /** Monorepo type if detected */
  monorepoType?: 'pnpm' | 'yarn' | 'nx' | 'turbo' | 'lerna';
}

/**
 * Snapshot build options
 */
export interface SnapshotBuildOptions {
  /** Workspace root directory */
  workspaceRoot: string;
  
  /** Optional event bus for emitting events */
  eventBus?: EventEmitter;
  
  /** Run ID for event correlation */
  runId?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const FRAMEWORK_INDICATORS: Record<DetectedFramework, {
  packageDeps?: string[];
  configFiles?: string[];
  directories?: string[];
}> = {
  nextjs_app_router: {
    packageDeps: ['next'],
    directories: ['app'],
    configFiles: ['next.config.js', 'next.config.ts', 'next.config.mjs'],
  },
  nextjs_pages_router: {
    packageDeps: ['next'],
    directories: ['pages'],
    configFiles: ['next.config.js', 'next.config.ts', 'next.config.mjs'],
  },
  vite_react: {
    packageDeps: ['vite', 'react'],
    configFiles: ['vite.config.ts', 'vite.config.js'],
  },
  vite_vue: {
    packageDeps: ['vite', 'vue'],
    configFiles: ['vite.config.ts', 'vite.config.js'],
  },
  create_react_app: {
    packageDeps: ['react-scripts'],
  },
  expo: {
    packageDeps: ['expo'],
    configFiles: ['app.json', 'app.config.js', 'app.config.ts'],
  },
  express: {
    packageDeps: ['express'],
  },
  nestjs: {
    packageDeps: ['@nestjs/core'],
    configFiles: ['nest-cli.json'],
  },
  astro: {
    packageDeps: ['astro'],
    configFiles: ['astro.config.mjs', 'astro.config.ts'],
  },
  remix: {
    packageDeps: ['@remix-run/react'],
    configFiles: ['remix.config.js'],
  },
  nuxt: {
    packageDeps: ['nuxt'],
    configFiles: ['nuxt.config.ts', 'nuxt.config.js'],
  },
  angular: {
    packageDeps: ['@angular/core'],
    configFiles: ['angular.json'],
  },
  svelte: {
    packageDeps: ['svelte'],
    configFiles: ['svelte.config.js'],
  },
  unknown: {},
};

const NOTABLE_DEPENDENCIES = [
  // UI Libraries
  'tailwindcss', 'styled-components', '@emotion/react', 'chakra-ui', '@mui/material',
  'antd', 'shadcn-ui', '@radix-ui/react-*',
  // State Management
  'redux', 'zustand', 'jotai', 'recoil', 'mobx',
  // Data Fetching
  '@tanstack/react-query', 'swr', 'apollo-client', '@trpc/client',
  // ORM/Database
  'prisma', '@prisma/client', 'drizzle-orm', 'typeorm', 'mongoose', 'pg',
  // Auth
  'next-auth', '@auth/core', 'passport', 'clerk',
  // Testing
  'jest', 'vitest', '@testing-library/react', 'cypress', 'playwright',
];

const SCRIPT_CATEGORIES: Array<{
  names: string[];
  category: DiscoveredScript['category'];
}> = [
  { names: ['lint', 'eslint', 'tslint', 'check'], category: 'lint' },
  { names: ['test', 'jest', 'vitest', 'mocha'], category: 'test' },
  { names: ['build', 'compile', 'tsc'], category: 'build' },
  { names: ['dev', 'develop'], category: 'dev' },
  { names: ['start', 'serve'], category: 'start' },
];

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Build a project snapshot from workspace root
 * 
 * This is the main entry point for project analysis.
 * Fast, deterministic, and replay-safe.
 * 
 * @param options - Snapshot build options
 * @returns Complete project snapshot
 */
export async function buildProjectSnapshot(
  options: SnapshotBuildOptions
): Promise<ProjectSnapshot> {
  const { workspaceRoot, eventBus, runId } = options;
  const startTime = Date.now();
  
  // Emit start event
  if (eventBus && runId) {
    emitEvent(eventBus, runId, 'project_snapshot_started', {
      workspace_root: workspaceRoot,
    });
  }
  
  // Initialize snapshot with defaults
  const snapshot: ProjectSnapshot = {
    timestamp: new Date().toISOString(),
    workspaceRoot,
    packageManager: 'unknown',
    framework: 'unknown',
    additionalFrameworks: [],
    language: 'unknown',
    topLevelDirs: [],
    keyFiles: [],
    scripts: [],
    hasLintScript: false,
    hasTestScript: false,
    hasBuildScript: false,
    dependencyCount: 0,
    devDependencyCount: 0,
    notableDependencies: [],
    patterns: [],
    hasEslint: false,
    hasPrettier: false,
    isMonorepo: false,
  };
  
  try {
    // 1. Detect package manager
    const pkgMgr = detectPackageManager(workspaceRoot);
    snapshot.packageManager = pkgMgr.manager;
    snapshot.lockFile = pkgMgr.lockFile;
    
    // 2. Read package.json
    const packageJson = readPackageJson(workspaceRoot);
    if (packageJson) {
      snapshot.packageName = packageJson.name;
      snapshot.packageVersion = packageJson.version;
      snapshot.description = packageJson.description;
      snapshot.dependencyCount = Object.keys(packageJson.dependencies || {}).length;
      snapshot.devDependencyCount = Object.keys(packageJson.devDependencies || {}).length;
      
      // Parse scripts
      const parsedScripts = parseScripts(packageJson.scripts || {});
      snapshot.scripts = parsedScripts;
      snapshot.hasLintScript = parsedScripts.some(s => s.category === 'lint');
      snapshot.hasTestScript = parsedScripts.some(s => s.category === 'test');
      snapshot.hasBuildScript = parsedScripts.some(s => s.category === 'build');
      
      // Detect notable dependencies
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      snapshot.notableDependencies = detectNotableDependencies(allDeps);
      
      // Detect monorepo from workspaces
      if (packageJson.workspaces) {
        snapshot.isMonorepo = true;
        snapshot.monorepoType = 'yarn';
      }
    }
    
    // 3. Read top-level directories
    snapshot.topLevelDirs = readTopLevelDirs(workspaceRoot);
    
    // 4. Detect monorepo markers
    const monoRepoInfo = detectMonorepo(workspaceRoot, snapshot.topLevelDirs);
    if (monoRepoInfo.isMonorepo) {
      snapshot.isMonorepo = true;
      snapshot.monorepoType = monoRepoInfo.type;
    }
    
    // 5. Detect framework
    const frameworkInfo = detectFramework(workspaceRoot, packageJson, snapshot.topLevelDirs);
    snapshot.framework = frameworkInfo.primary;
    snapshot.additionalFrameworks = frameworkInfo.additional;
    snapshot.patterns = frameworkInfo.patterns;
    
    // 6. Detect language
    const langInfo = detectLanguage(workspaceRoot);
    snapshot.language = langInfo.language;
    snapshot.tsConfigPath = langInfo.tsConfigPath;
    
    // 7. Find key files
    snapshot.keyFiles = findKeyFiles(workspaceRoot, snapshot.framework, snapshot.topLevelDirs);
    
    // 8. Detect tooling
    snapshot.hasEslint = detectEslint(workspaceRoot);
    snapshot.hasPrettier = detectPrettier(workspaceRoot);
    
  } catch (error) {
    console.error('Error building project snapshot:', error);
  }
  
  // Emit completion event
  if (eventBus && runId) {
    const durationMs = Date.now() - startTime;
    emitEvent(eventBus, runId, 'project_snapshot_completed', {
      workspace_root: workspaceRoot,
      duration_ms: durationMs,
      framework: snapshot.framework,
      language: snapshot.language,
      package_manager: snapshot.packageManager,
      has_lint: snapshot.hasLintScript,
      has_test: snapshot.hasTestScript,
      has_build: snapshot.hasBuildScript,
      key_files_count: snapshot.keyFiles.length,
      is_monorepo: snapshot.isMonorepo,
    });
  }
  
  return snapshot;
}

// ============================================================================
// DETECTION FUNCTIONS
// ============================================================================

/**
 * Detect package manager from lock files
 */
function detectPackageManager(workspaceRoot: string): {
  manager: PackageManager;
  lockFile?: string;
} {
  const lockFiles: Array<{ file: string; manager: PackageManager }> = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'package-lock.json', manager: 'npm' },
  ];
  
  for (const { file, manager } of lockFiles) {
    const lockPath = path.join(workspaceRoot, file);
    if (fs.existsSync(lockPath)) {
      return { manager, lockFile: file };
    }
  }
  
  return { manager: 'unknown' };
}

/**
 * Read and parse package.json
 */
function readPackageJson(workspaceRoot: string): Record<string, any> | null {
  const pkgPath = path.join(workspaceRoot, 'package.json');
  
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(pkgPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to parse package.json:', error);
    return null;
  }
}

/**
 * Parse scripts from package.json
 */
function parseScripts(scripts: Record<string, string>): DiscoveredScript[] {
  const result: DiscoveredScript[] = [];
  
  for (const [name, command] of Object.entries(scripts)) {
    let category: DiscoveredScript['category'] = 'other';
    
    for (const { names, category: cat } of SCRIPT_CATEGORIES) {
      if (names.some(n => name.toLowerCase().includes(n))) {
        category = cat;
        break;
      }
    }
    
    result.push({ name, command, category });
  }
  
  return result;
}

/**
 * Read top-level directories
 */
function readTopLevelDirs(workspaceRoot: string): string[] {
  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => e.name)
      .sort();
  } catch (error) {
    console.error('Failed to read top-level dirs:', error);
    return [];
  }
}

/**
 * Detect monorepo markers
 */
function detectMonorepo(
  workspaceRoot: string,
  topLevelDirs: string[]
): { isMonorepo: boolean; type?: ProjectSnapshot['monorepoType'] } {
  // Check for explicit monorepo config files
  const markers: Array<{ file: string; type: ProjectSnapshot['monorepoType'] }> = [
    { file: 'pnpm-workspace.yaml', type: 'pnpm' },
    { file: 'pnpm-workspace.yml', type: 'pnpm' },
    { file: 'turbo.json', type: 'turbo' },
    { file: 'nx.json', type: 'nx' },
    { file: 'lerna.json', type: 'lerna' },
  ];
  
  for (const { file, type } of markers) {
    if (fs.existsSync(path.join(workspaceRoot, file))) {
      return { isMonorepo: true, type };
    }
  }
  
  // Check for apps/packages directories
  const hasApps = topLevelDirs.includes('apps');
  const hasPackages = topLevelDirs.includes('packages');
  
  if (hasApps || hasPackages) {
    return { isMonorepo: true, type: undefined };
  }
  
  return { isMonorepo: false };
}

/**
 * Detect framework from dependencies and structure
 */
function detectFramework(
  workspaceRoot: string,
  packageJson: Record<string, any> | null,
  topLevelDirs: string[]
): {
  primary: DetectedFramework;
  additional: string[];
  patterns: string[];
} {
  const allDeps = packageJson ? {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  } : {};
  
  const additional: string[] = [];
  const patterns: string[] = [];
  
  // Check for additional frameworks/tools
  if (allDeps['@trpc/client'] || allDeps['@trpc/server']) {
    additional.push('tRPC');
    patterns.push('tRPC');
  }
  if (allDeps['prisma'] || allDeps['@prisma/client']) {
    additional.push('Prisma');
    patterns.push('Prisma ORM');
  }
  if (allDeps['drizzle-orm']) {
    additional.push('Drizzle');
    patterns.push('Drizzle ORM');
  }
  if (allDeps['tailwindcss']) {
    additional.push('Tailwind CSS');
    patterns.push('Tailwind CSS');
  }
  if (allDeps['@tanstack/react-query']) {
    additional.push('React Query');
  }
  
  // Check for primary framework
  // Order matters - more specific first
  
  // Next.js (check App Router vs Pages Router)
  if (allDeps['next']) {
    const hasAppDir = topLevelDirs.includes('app') || 
                      fs.existsSync(path.join(workspaceRoot, 'src', 'app'));
    const hasPagesDir = topLevelDirs.includes('pages') ||
                        fs.existsSync(path.join(workspaceRoot, 'src', 'pages'));
    
    if (hasAppDir) {
      patterns.push('App Router');
      return { primary: 'nextjs_app_router', additional, patterns };
    }
    if (hasPagesDir) {
      patterns.push('Pages Router');
      return { primary: 'nextjs_pages_router', additional, patterns };
    }
    // Default to App Router for new Next.js projects
    return { primary: 'nextjs_app_router', additional, patterns };
  }
  
  // Expo
  if (allDeps['expo']) {
    patterns.push('Expo');
    return { primary: 'expo', additional, patterns };
  }
  
  // Vite with React or Vue
  if (allDeps['vite']) {
    if (allDeps['react']) {
      return { primary: 'vite_react', additional, patterns };
    }
    if (allDeps['vue']) {
      return { primary: 'vite_vue', additional, patterns };
    }
  }
  
  // Other frameworks
  if (allDeps['react-scripts']) {
    return { primary: 'create_react_app', additional, patterns };
  }
  if (allDeps['@nestjs/core']) {
    return { primary: 'nestjs', additional, patterns };
  }
  if (allDeps['astro']) {
    return { primary: 'astro', additional, patterns };
  }
  if (allDeps['@remix-run/react']) {
    return { primary: 'remix', additional, patterns };
  }
  if (allDeps['nuxt']) {
    return { primary: 'nuxt', additional, patterns };
  }
  if (allDeps['@angular/core']) {
    return { primary: 'angular', additional, patterns };
  }
  if (allDeps['svelte']) {
    return { primary: 'svelte', additional, patterns };
  }
  if (allDeps['express']) {
    return { primary: 'express', additional, patterns };
  }
  
  return { primary: 'unknown', additional, patterns };
}

/**
 * Detect language (TypeScript or JavaScript)
 */
function detectLanguage(workspaceRoot: string): {
  language: DetectedLanguage;
  tsConfigPath?: string;
} {
  // Check for tsconfig.json
  const tsConfigFiles = [
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.app.json',
  ];
  
  for (const file of tsConfigFiles) {
    const tsConfigPath = path.join(workspaceRoot, file);
    if (fs.existsSync(tsConfigPath)) {
      return { language: 'typescript', tsConfigPath: file };
    }
  }
  
  // Check for .ts files in common locations
  const tsLocations = ['src', 'app', 'pages', 'lib', 'components'];
  for (const loc of tsLocations) {
    const dirPath = path.join(workspaceRoot, loc);
    if (fs.existsSync(dirPath)) {
      try {
        const files = fs.readdirSync(dirPath);
        const hasTsFiles = files.some(f => f.endsWith('.ts') || f.endsWith('.tsx'));
        const hasJsFiles = files.some(f => f.endsWith('.js') || f.endsWith('.jsx'));
        
        if (hasTsFiles && hasJsFiles) {
          return { language: 'mixed' };
        }
        if (hasTsFiles) {
          return { language: 'typescript' };
        }
        if (hasJsFiles) {
          return { language: 'javascript' };
        }
      } catch {
        // Ignore read errors
      }
    }
  }
  
  return { language: 'unknown' };
}

/**
 * Find key files based on framework
 */
function findKeyFiles(
  workspaceRoot: string,
  framework: DetectedFramework,
  topLevelDirs: string[]
): KeyFile[] {
  const keyFiles: KeyFile[] = [];
  
  // Common config files
  const configFiles = [
    { file: 'package.json', type: 'config' as const },
    { file: 'tsconfig.json', type: 'config' as const },
    { file: 'next.config.js', type: 'config' as const },
    { file: 'next.config.ts', type: 'config' as const },
    { file: 'next.config.mjs', type: 'config' as const },
    { file: 'vite.config.ts', type: 'config' as const },
    { file: 'vite.config.js', type: 'config' as const },
    { file: 'tailwind.config.js', type: 'config' as const },
    { file: 'tailwind.config.ts', type: 'config' as const },
  ];
  
  for (const { file, type } of configFiles) {
    if (fs.existsSync(path.join(workspaceRoot, file))) {
      keyFiles.push({ path: file, type });
    }
  }
  
  // Framework-specific entry points
  if (framework === 'nextjs_app_router') {
    const appEntries = [
      { path: 'app/layout.tsx', type: 'layout' as const, framework_role: 'Root Layout' },
      { path: 'app/layout.ts', type: 'layout' as const, framework_role: 'Root Layout' },
      { path: 'app/page.tsx', type: 'entry' as const, framework_role: 'Home Page' },
      { path: 'app/page.ts', type: 'entry' as const, framework_role: 'Home Page' },
      { path: 'src/app/layout.tsx', type: 'layout' as const, framework_role: 'Root Layout' },
      { path: 'src/app/page.tsx', type: 'entry' as const, framework_role: 'Home Page' },
    ];
    
    for (const entry of appEntries) {
      if (fs.existsSync(path.join(workspaceRoot, entry.path))) {
        keyFiles.push(entry);
      }
    }
  }
  
  if (framework === 'nextjs_pages_router') {
    const pagesEntries = [
      { path: 'pages/_app.tsx', type: 'entry' as const, framework_role: 'App Component' },
      { path: 'pages/_app.js', type: 'entry' as const, framework_role: 'App Component' },
      { path: 'pages/index.tsx', type: 'entry' as const, framework_role: 'Home Page' },
      { path: 'pages/index.js', type: 'entry' as const, framework_role: 'Home Page' },
      { path: 'src/pages/_app.tsx', type: 'entry' as const, framework_role: 'App Component' },
      { path: 'src/pages/index.tsx', type: 'entry' as const, framework_role: 'Home Page' },
    ];
    
    for (const entry of pagesEntries) {
      if (fs.existsSync(path.join(workspaceRoot, entry.path))) {
        keyFiles.push(entry);
      }
    }
  }
  
  if (framework === 'vite_react' || framework === 'create_react_app') {
    const reactEntries = [
      { path: 'src/main.tsx', type: 'entry' as const, framework_role: 'Entry Point' },
      { path: 'src/main.jsx', type: 'entry' as const, framework_role: 'Entry Point' },
      { path: 'src/index.tsx', type: 'entry' as const, framework_role: 'Entry Point' },
      { path: 'src/index.jsx', type: 'entry' as const, framework_role: 'Entry Point' },
      { path: 'src/App.tsx', type: 'component' as const, framework_role: 'Root Component' },
      { path: 'src/App.jsx', type: 'component' as const, framework_role: 'Root Component' },
    ];
    
    for (const entry of reactEntries) {
      if (fs.existsSync(path.join(workspaceRoot, entry.path))) {
        keyFiles.push(entry);
      }
    }
  }
  
  if (framework === 'expo') {
    const expoEntries = [
      { path: 'App.tsx', type: 'entry' as const, framework_role: 'Root Component' },
      { path: 'App.js', type: 'entry' as const, framework_role: 'Root Component' },
      { path: 'app/_layout.tsx', type: 'layout' as const, framework_role: 'Root Layout' },
      { path: 'app/index.tsx', type: 'entry' as const, framework_role: 'Home Screen' },
      { path: 'app.json', type: 'config' as const, framework_role: 'Expo Config' },
    ];
    
    for (const entry of expoEntries) {
      if (fs.existsSync(path.join(workspaceRoot, entry.path))) {
        keyFiles.push(entry);
      }
    }
  }
  
  return keyFiles;
}

/**
 * Detect notable dependencies
 */
function detectNotableDependencies(deps: Record<string, string>): string[] {
  const notable: string[] = [];
  
  for (const dep of Object.keys(deps)) {
    // Check exact matches
    if (NOTABLE_DEPENDENCIES.includes(dep)) {
      notable.push(dep);
      continue;
    }
    
    // Check pattern matches (e.g., @radix-ui/*)
    for (const pattern of NOTABLE_DEPENDENCIES) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (dep.startsWith(prefix)) {
          notable.push(dep);
          break;
        }
      }
    }
  }
  
  return notable.slice(0, 20); // Cap at 20
}

/**
 * Detect ESLint config
 */
function detectEslint(workspaceRoot: string): boolean {
  const eslintConfigs = [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
  ];
  
  return eslintConfigs.some(f => fs.existsSync(path.join(workspaceRoot, f)));
}

/**
 * Detect Prettier config
 */
function detectPrettier(workspaceRoot: string): boolean {
  const prettierConfigs = [
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.json',
    '.prettierrc.yaml',
    '.prettierrc.yml',
    'prettier.config.js',
    'prettier.config.cjs',
  ];
  
  return prettierConfigs.some(f => fs.existsSync(path.join(workspaceRoot, f)));
}

// ============================================================================
// EVENT HELPERS
// ============================================================================

/**
 * Emit event helper
 */
function emitEvent(
  eventBus: EventEmitter,
  runId: string,
  type: string,
  payload: Record<string, unknown>
): void {
  const event: Event = {
    event_id: randomUUID(),
    task_id: runId,
    timestamp: new Date().toISOString(),
    type: type as any, // Type assertion for new event types
    mode: 'MISSION' as Mode,
    stage: 'none' as Stage,
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };
  
  eventBus.emit('event', event);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get a compact summary string from snapshot
 */
export function getSnapshotSummary(snapshot: ProjectSnapshot): string {
  const parts: string[] = [];
  
  // Framework
  if (snapshot.framework !== 'unknown') {
    parts.push(formatFrameworkName(snapshot.framework));
  }
  
  // Language
  if (snapshot.language === 'typescript') {
    parts.push('TypeScript');
  }
  
  // Patterns
  if (snapshot.patterns.length > 0) {
    parts.push(snapshot.patterns.join(' + '));
  }
  
  // Package manager
  if (snapshot.packageManager !== 'unknown') {
    parts.push(snapshot.packageManager);
  }
  
  return parts.join(' | ') || 'Unknown project type';
}

/**
 * Format framework name for display
 */
function formatFrameworkName(framework: DetectedFramework): string {
  const names: Record<DetectedFramework, string> = {
    nextjs_app_router: 'Next.js (App Router)',
    nextjs_pages_router: 'Next.js (Pages Router)',
    vite_react: 'Vite + React',
    vite_vue: 'Vite + Vue',
    create_react_app: 'Create React App',
    expo: 'Expo',
    express: 'Express',
    nestjs: 'NestJS',
    astro: 'Astro',
    remix: 'Remix',
    nuxt: 'Nuxt',
    angular: 'Angular',
    svelte: 'Svelte',
    unknown: 'Unknown',
  };
  
  return names[framework] || framework;
}

/**
 * Get recommended verify commands from snapshot
 */
export function getRecommendedVerifyCommands(snapshot: ProjectSnapshot): string[] {
  const commands: string[] = [];
  const prefix = snapshot.packageManager === 'unknown' ? 'npm' : snapshot.packageManager;
  
  // Add in preferred order: lint → test → build
  if (snapshot.hasLintScript) {
    commands.push(`${prefix} run lint`);
  }
  if (snapshot.hasTestScript) {
    commands.push(`${prefix} run test`);
  }
  if (snapshot.hasBuildScript) {
    commands.push(`${prefix} run build`);
  }
  
  return commands;
}

/**
 * Check if snapshot indicates an existing project
 */
export function isExistingProject(snapshot: ProjectSnapshot): boolean {
  return (
    snapshot.framework !== 'unknown' ||
    snapshot.dependencyCount > 0 ||
    snapshot.keyFiles.length > 0 ||
    snapshot.topLevelDirs.includes('src') ||
    snapshot.topLevelDirs.includes('app') ||
    snapshot.topLevelDirs.includes('lib')
  );
}
