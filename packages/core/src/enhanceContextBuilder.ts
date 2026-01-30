/**
 * Enhance Context Builder (Step 36.3)
 * 
 * Targeted context collection for enhancing existing projects.
 * Selects only relevant files based on user request + project snapshot.
 * 
 * CRITICAL RULES:
 * - Maximum 5-15 files (never dump entire codebase)
 * - Deterministic file selection (no random)
 * - Resolve "this/it" references via priority stack
 * - Store file list as evidence for replay
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Event, Mode, Stage } from './types';
import type { ProjectSnapshot, KeyFile } from './projectSnapshot';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Recent run metadata for context resolution
 */
export interface RecentRunMetadata {
  /** Files from the last applied diff */
  lastAppliedDiffFiles?: string[];
  
  /** Timestamp of last applied diff */
  lastAppliedDiffTimestamp?: string;
  
  /** Last proposed artifact (diff, plan, etc.) */
  lastArtifactProposed?: {
    type: 'diff' | 'plan' | 'checkpoint';
    files?: string[];
    timestamp: string;
  };
  
  /** Currently active editor file */
  activeEditorFile?: string;
  
  /** Recently viewed files in order */
  recentlyViewedFiles?: string[];
}

/**
 * Context build result
 */
export interface EnhanceContextResult {
  /** Files selected for reading (relative paths) */
  filesToRead: string[];
  
  /** Optional glob patterns for additional context */
  optionalGlobs?: string[];
  
  /** Recommended verify commands */
  recommendedVerifyCommands: string[];
  
  /** Reasoning for file selection */
  selectionReasons: Map<string, string>;
  
  /** Whether "this/it" reference was resolved */
  referenceResolved: boolean;
  
  /** Source of reference resolution */
  referenceSource?: 'last_applied_diff' | 'last_artifact' | 'active_editor' | 'user_specified' | 'none';
  
  /** If reference couldn't be resolved, ask clarification */
  needsClarification?: {
    question: string;
    options: Array<{
      label: string;
      value: string;
    }>;
  };
}

/**
 * Context builder options
 */
export interface EnhanceContextOptions {
  /** User's request/prompt */
  userRequest: string;
  
  /** Project snapshot */
  snapshot: ProjectSnapshot;
  
  /** Recent run metadata */
  recentRunMetadata?: RecentRunMetadata;
  
  /** Maximum files to select */
  maxFiles?: number;
  
  /** Workspace root for reading files */
  workspaceRoot: string;
  
  /** Optional event bus */
  eventBus?: EventEmitter;
  
  /** Run ID for event correlation */
  runId?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default max files to read
 */
const DEFAULT_MAX_FILES = 12;

/**
 * Patterns for "this/it" reference detection
 */
const REFERENCE_PATTERNS = [
  /\b(this|it|that)\b(?!\s+(is|are|was|were|will|would|should|could|can|might|may))/gi,
  /\bthe\s+(file|function|class|method|component|module|page|route)\b/gi,
  /\b(same|above|below|previous|last)\b/gi,
  /\bhere\b/gi,
];

/**
 * Common file patterns by intent
 */
const INTENT_FILE_PATTERNS: Record<string, string[]> = {
  // UI/Component changes
  'button': ['**/Button*.tsx', '**/button*.tsx', '**/components/**/*.tsx'],
  'form': ['**/Form*.tsx', '**/form*.tsx', '**/components/**/*Form*.tsx'],
  'modal': ['**/Modal*.tsx', '**/modal*.tsx', '**/Dialog*.tsx'],
  'navbar': ['**/Nav*.tsx', '**/Header*.tsx', '**/navigation/**/*.tsx'],
  'footer': ['**/Footer*.tsx', '**/footer*.tsx'],
  'card': ['**/Card*.tsx', '**/card*.tsx'],
  'table': ['**/Table*.tsx', '**/DataTable*.tsx'],
  
  // API/Backend changes
  'api': ['**/api/**/*.ts', '**/routes/**/*.ts', 'pages/api/**/*.ts', 'app/api/**/*.ts'],
  'endpoint': ['**/api/**/*.ts', '**/routes/**/*.ts'],
  'route': ['**/routes/**/*', 'app/**/route.ts', 'pages/**/*.tsx'],
  'middleware': ['**/middleware*.ts', 'middleware.ts'],
  
  // Data/State
  'state': ['**/store/**/*.ts', '**/context/**/*.tsx', '**/hooks/**/*.ts'],
  'hook': ['**/hooks/**/*.ts', '**/use*.ts'],
  'context': ['**/context/**/*.tsx', '**/providers/**/*.tsx'],
  
  // Auth
  'auth': ['**/auth/**/*', '**/login/**/*', '**/signup/**/*'],
  'login': ['**/login/**/*', '**/signin/**/*', '**/auth/**/*'],
  
  // Database
  'database': ['**/prisma/**/*', '**/db/**/*', '**/models/**/*', '**/schema/**/*'],
  'schema': ['**/schema*.ts', '**/prisma/schema.prisma', '**/db/**/*'],
  'model': ['**/models/**/*', '**/entities/**/*'],
  
  // Config
  'config': ['*.config.*', '**/config/**/*', '.env*'],
  'env': ['.env*', '**/config/**/*'],
  
  // Testing
  'test': ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '__tests__/**/*'],
  
  // Styles
  'style': ['**/*.css', '**/*.scss', '**/styles/**/*', 'tailwind.config.*'],
  'css': ['**/*.css', '**/*.scss', 'tailwind.config.*'],
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Build targeted context for enhancing existing project
 * 
 * @param options - Context build options
 * @returns Context result with files to read and verify commands
 */
export async function buildEnhanceContext(
  options: EnhanceContextOptions
): Promise<EnhanceContextResult> {
  const {
    userRequest,
    snapshot,
    recentRunMetadata,
    maxFiles = DEFAULT_MAX_FILES,
    workspaceRoot,
    eventBus,
    runId,
  } = options;
  
  // Emit start event
  if (eventBus && runId) {
    emitEvent(eventBus, runId, 'context_build_started', {
      workspace_root: workspaceRoot,
      user_request_length: userRequest.length,
    });
  }
  
  const filesToRead: string[] = [];
  const selectionReasons = new Map<string, string>();
  let referenceResolved = false;
  let referenceSource: EnhanceContextResult['referenceSource'] = 'none';
  
  // 1. Check for ambiguous references ("this", "it")
  const hasAmbiguousRef = REFERENCE_PATTERNS.some(p => p.test(userRequest));
  
  if (hasAmbiguousRef) {
    // Try to resolve via priority stack
    const resolved = resolveAmbiguousReference(recentRunMetadata);
    
    if (resolved.files.length > 0) {
      referenceResolved = true;
      referenceSource = resolved.source;
      
      // Add resolved files
      for (const file of resolved.files.slice(0, 3)) {
        if (!filesToRead.includes(file)) {
          filesToRead.push(file);
          selectionReasons.set(file, `Resolved from ${resolved.source}`);
        }
      }
    }
  }
  
  // 2. Extract explicit file references from user request
  const explicitFiles = extractFileReferences(userRequest, workspaceRoot);
  for (const file of explicitFiles) {
    if (!filesToRead.includes(file) && filesToRead.length < maxFiles) {
      filesToRead.push(file);
      selectionReasons.set(file, 'Explicitly mentioned in request');
    }
  }
  
  // 3. Add key files based on detected framework
  const frameworkFiles = getFrameworkRelevantFiles(snapshot, userRequest);
  for (const file of frameworkFiles) {
    if (!filesToRead.includes(file) && filesToRead.length < maxFiles) {
      const exists = fs.existsSync(path.join(workspaceRoot, file));
      if (exists) {
        filesToRead.push(file);
        selectionReasons.set(file, `Framework key file (${snapshot.framework})`);
      }
    }
  }
  
  // 4. Add files matching intent patterns
  const intentFiles = await findIntentMatchingFiles(userRequest, workspaceRoot, maxFiles - filesToRead.length);
  for (const file of intentFiles) {
    if (!filesToRead.includes(file) && filesToRead.length < maxFiles) {
      filesToRead.push(file);
      selectionReasons.set(file, 'Matches user intent keywords');
    }
  }
  
  // 5. Always include key config files if space permits
  const essentialConfigs = ['package.json', 'tsconfig.json'];
  for (const config of essentialConfigs) {
    if (!filesToRead.includes(config) && filesToRead.length < maxFiles) {
      const exists = fs.existsSync(path.join(workspaceRoot, config));
      if (exists) {
        filesToRead.push(config);
        selectionReasons.set(config, 'Essential config file');
      }
    }
  }
  
  // 6. Build verify commands from snapshot
  const recommendedVerifyCommands = buildVerifyCommands(snapshot);
  
  // 7. Check if clarification needed
  let needsClarification: EnhanceContextResult['needsClarification'] | undefined;
  
  if (hasAmbiguousRef && !referenceResolved && filesToRead.length === 0) {
    needsClarification = buildClarificationRequest(recentRunMetadata);
  }
  
  // Emit completion event
  if (eventBus && runId) {
    emitEvent(eventBus, runId, 'context_build_completed', {
      files_selected: filesToRead.length,
      reference_resolved: referenceResolved,
      reference_source: referenceSource,
      needs_clarification: !!needsClarification,
      verify_commands_count: recommendedVerifyCommands.length,
    });
  }
  
  return {
    filesToRead,
    recommendedVerifyCommands,
    selectionReasons,
    referenceResolved,
    referenceSource,
    needsClarification,
  };
}

// ============================================================================
// REFERENCE RESOLUTION
// ============================================================================

/**
 * Resolve ambiguous reference ("this", "it") via priority stack
 * 
 * Priority order:
 * 1. last_applied_diff files
 * 2. last_artifact_proposed files
 * 3. active_editor file
 * 4. recently_viewed_files
 */
function resolveAmbiguousReference(
  metadata?: RecentRunMetadata
): { files: string[]; source: EnhanceContextResult['referenceSource'] } {
  if (!metadata) {
    return { files: [], source: 'none' };
  }
  
  // Priority 1: Last applied diff files
  if (metadata.lastAppliedDiffFiles?.length) {
    return {
      files: metadata.lastAppliedDiffFiles,
      source: 'last_applied_diff',
    };
  }
  
  // Priority 2: Last artifact proposed files
  if (metadata.lastArtifactProposed?.files?.length) {
    return {
      files: metadata.lastArtifactProposed.files,
      source: 'last_artifact',
    };
  }
  
  // Priority 3: Active editor file
  if (metadata.activeEditorFile) {
    return {
      files: [metadata.activeEditorFile],
      source: 'active_editor',
    };
  }
  
  // Priority 4: Recently viewed files
  if (metadata.recentlyViewedFiles?.length) {
    return {
      files: metadata.recentlyViewedFiles.slice(0, 3),
      source: 'active_editor', // Group with editor context
    };
  }
  
  return { files: [], source: 'none' };
}

// ============================================================================
// FILE EXTRACTION
// ============================================================================

/**
 * Extract explicit file references from user request
 */
function extractFileReferences(userRequest: string, workspaceRoot: string): string[] {
  const files: string[] = [];
  
  // Pattern for file paths
  const filePatterns = [
    // Explicit paths with extensions
    /[a-zA-Z0-9_\-/.]+\.(ts|tsx|js|jsx|json|css|scss|md|yaml|yml)(?:\s|$|,|:|;|\))/g,
    // src/ or app/ paths
    /(?:src|app|pages|components|lib|utils|hooks|api|routes)\/[a-zA-Z0-9_\-/.]+/g,
  ];
  
  for (const pattern of filePatterns) {
    const matches = userRequest.match(pattern);
    if (matches) {
      for (const match of matches) {
        const cleanedPath = match.trim().replace(/[,:;)]+$/, '');
        
        // Verify file exists
        const fullPath = path.join(workspaceRoot, cleanedPath);
        if (fs.existsSync(fullPath)) {
          if (!files.includes(cleanedPath)) {
            files.push(cleanedPath);
          }
        }
      }
    }
  }
  
  return files;
}

/**
 * Get framework-relevant files based on snapshot and request
 */
function getFrameworkRelevantFiles(
  snapshot: ProjectSnapshot,
  userRequest: string
): string[] {
  const files: string[] = [];
  
  // Add key files from snapshot
  for (const keyFile of snapshot.keyFiles) {
    files.push(keyFile.path);
  }
  
  // Framework-specific additions based on request keywords
  const requestLower = userRequest.toLowerCase();
  
  if (snapshot.framework === 'nextjs_app_router') {
    if (requestLower.includes('page') || requestLower.includes('route')) {
      files.push('app/page.tsx');
      files.push('app/layout.tsx');
    }
    if (requestLower.includes('api')) {
      files.push('app/api/route.ts');
    }
    if (requestLower.includes('middleware')) {
      files.push('middleware.ts');
    }
  }
  
  if (snapshot.framework === 'nextjs_pages_router') {
    if (requestLower.includes('page')) {
      files.push('pages/index.tsx');
      files.push('pages/_app.tsx');
    }
    if (requestLower.includes('api')) {
      files.push('pages/api/index.ts');
    }
  }
  
  if (snapshot.framework === 'vite_react' || snapshot.framework === 'create_react_app') {
    if (requestLower.includes('app') || requestLower.includes('main')) {
      files.push('src/App.tsx');
      files.push('src/main.tsx');
    }
  }
  
  if (snapshot.framework === 'expo') {
    if (requestLower.includes('app') || requestLower.includes('screen')) {
      files.push('App.tsx');
      files.push('app/_layout.tsx');
    }
  }
  
  // Add pattern-specific files
  if (snapshot.patterns.includes('tRPC')) {
    if (requestLower.includes('api') || requestLower.includes('trpc')) {
      files.push('src/server/trpc.ts');
      files.push('src/server/routers/index.ts');
    }
  }
  
  if (snapshot.patterns.includes('Prisma ORM')) {
    if (requestLower.includes('database') || requestLower.includes('model') || requestLower.includes('schema')) {
      files.push('prisma/schema.prisma');
    }
  }
  
  return files;
}

/**
 * Find files matching user intent keywords
 */
async function findIntentMatchingFiles(
  userRequest: string,
  workspaceRoot: string,
  maxFiles: number
): Promise<string[]> {
  if (maxFiles <= 0) return [];
  
  const files: string[] = [];
  const requestLower = userRequest.toLowerCase();
  
  // Find matching intent patterns
  const matchingPatterns: string[] = [];
  for (const [keyword, patterns] of Object.entries(INTENT_FILE_PATTERNS)) {
    if (requestLower.includes(keyword)) {
      matchingPatterns.push(...patterns);
    }
  }
  
  // Deduplicate patterns
  const uniquePatterns = [...new Set(matchingPatterns)];
  
  // Search for matching files (simple implementation)
  for (const pattern of uniquePatterns) {
    if (files.length >= maxFiles) break;
    
    // Convert glob to simple search
    const matchingFiles = await findFilesMatching(workspaceRoot, pattern, maxFiles - files.length);
    for (const file of matchingFiles) {
      if (!files.includes(file)) {
        files.push(file);
      }
    }
  }
  
  return files;
}

/**
 * Find files matching a simple glob pattern
 */
async function findFilesMatching(
  workspaceRoot: string,
  pattern: string,
  maxResults: number
): Promise<string[]> {
  const results: string[] = [];
  
  // Convert glob to regex (simplified)
  const patternParts = pattern.split('/');
  const isRecursive = patternParts.some(p => p === '**');
  const fileName = patternParts[patternParts.length - 1];
  
  // Create filename regex
  const fileRegex = new RegExp(
    '^' + fileName.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$'
  );
  
  // Determine search directories
  const searchDirs = ['src', 'app', 'pages', 'components', 'lib', 'hooks', 'api'];
  
  for (const dir of searchDirs) {
    if (results.length >= maxResults) break;
    
    const dirPath = path.join(workspaceRoot, dir);
    if (!fs.existsSync(dirPath)) continue;
    
    try {
      const found = searchDirectory(dirPath, fileRegex, workspaceRoot, isRecursive, maxResults - results.length);
      results.push(...found);
    } catch {
      // Ignore read errors
    }
  }
  
  return results;
}

/**
 * Search directory for matching files
 */
function searchDirectory(
  dirPath: string,
  fileRegex: RegExp,
  workspaceRoot: string,
  recursive: boolean,
  maxResults: number
): string[] {
  const results: string[] = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(workspaceRoot, fullPath);
      
      if (entry.isFile()) {
        if (fileRegex.test(entry.name)) {
          results.push(relativePath);
        }
      } else if (entry.isDirectory() && recursive) {
        // Skip node_modules, .git, etc.
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        
        const subResults = searchDirectory(fullPath, fileRegex, workspaceRoot, true, maxResults - results.length);
        results.push(...subResults);
      }
    }
  } catch {
    // Ignore read errors
  }
  
  return results;
}

// ============================================================================
// VERIFY COMMANDS
// ============================================================================

/**
 * Build verify commands from project snapshot
 */
function buildVerifyCommands(snapshot: ProjectSnapshot): string[] {
  const commands: string[] = [];
  const prefix = snapshot.packageManager === 'unknown' ? 'npm' : snapshot.packageManager;
  
  // Lint first (fastest)
  if (snapshot.hasLintScript) {
    commands.push(`${prefix} run lint`);
  }
  
  // Then test
  if (snapshot.hasTestScript) {
    commands.push(`${prefix} run test`);
  }
  
  // Finally build (slowest but comprehensive)
  if (snapshot.hasBuildScript) {
    commands.push(`${prefix} run build`);
  }
  
  return commands;
}

// ============================================================================
// CLARIFICATION
// ============================================================================

/**
 * Build clarification request when reference cannot be resolved
 */
function buildClarificationRequest(
  metadata?: RecentRunMetadata
): EnhanceContextResult['needsClarification'] {
  const options: Array<{ label: string; value: string }> = [];
  
  // Add recent files as options if available
  if (metadata?.activeEditorFile) {
    options.push({
      label: `Currently open: ${metadata.activeEditorFile}`,
      value: metadata.activeEditorFile,
    });
  }
  
  if (metadata?.recentlyViewedFiles?.length) {
    for (const file of metadata.recentlyViewedFiles.slice(0, 3)) {
      if (!options.some(o => o.value === file)) {
        options.push({
          label: `Recently viewed: ${file}`,
          value: file,
        });
      }
    }
  }
  
  // Add generic option
  options.push({
    label: 'Specify file path',
    value: '__specify__',
  });
  
  return {
    question: 'Which file or component are you referring to?',
    options,
  };
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
    type: type as any,
    mode: 'MISSION' as Mode,
    stage: 'retrieve' as Stage,
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
 * Read file contents for selected files
 */
export async function readSelectedFiles(
  filesToRead: string[],
  workspaceRoot: string,
  maxLinesPerFile: number = 200
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  
  for (const file of filesToRead) {
    try {
      const fullPath = path.join(workspaceRoot, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      
      // Truncate if too long
      const lines = content.split('\n');
      if (lines.length > maxLinesPerFile) {
        contents.set(file, lines.slice(0, maxLinesPerFile).join('\n') + '\n// ... (truncated)');
      } else {
        contents.set(file, content);
      }
    } catch (error) {
      console.error(`Failed to read ${file}:`, error);
      contents.set(file, '// Error reading file');
    }
  }
  
  return contents;
}

/**
 * Build context string for LLM prompt
 */
export function buildContextString(
  fileContents: Map<string, string>,
  snapshot: ProjectSnapshot
): string {
  const parts: string[] = [];
  
  // Project summary header
  parts.push('# PROJECT CONTEXT\n');
  parts.push(`Framework: ${snapshot.framework}`);
  parts.push(`Language: ${snapshot.language}`);
  if (snapshot.patterns.length > 0) {
    parts.push(`Patterns: ${snapshot.patterns.join(', ')}`);
  }
  parts.push('');
  
  // File contents
  parts.push('## FILES\n');
  for (const [filePath, content] of fileContents) {
    parts.push(`### ${filePath}`);
    parts.push('```');
    parts.push(content);
    parts.push('```');
    parts.push('');
  }
  
  return parts.join('\n');
}

/**
 * Get a summary of the context for UI display
 */
export function getContextSummary(result: EnhanceContextResult): string {
  const fileCount = result.filesToRead.length;
  const verifyCount = result.recommendedVerifyCommands.length;
  
  let summary = `${fileCount} file${fileCount !== 1 ? 's' : ''} selected`;
  
  if (result.referenceResolved) {
    summary += ` (reference resolved from ${result.referenceSource})`;
  }
  
  if (verifyCount > 0) {
    summary += `, ${verifyCount} verify command${verifyCount !== 1 ? 's' : ''}`;
  }
  
  return summary;
}
