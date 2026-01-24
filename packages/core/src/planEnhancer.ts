/**
 * Plan Enhancer: Enterprise-ready PLAN mode pipeline
 * 
 * Implements "Ground → Ask → Plan" (universal, deterministic, resumable):
 * 1. Adaptive light context collection (< 3s budget)
 * 2. Heuristic-based prompt assessment with tunable weights (no LLM)
 * 3. Repo-derived universal clusters (no app-specific patterns)
 * 4. Enriched prompt for LLM plan generation
 * 
 * Features:
 * - Universal role patterns (not app-specific)
 * - Monorepo-aware (apps/*, packages/*, services/*, libs/*)
 * - Adaptive scanning (depth=2 first, extend to depth=3 if time)
 * - Prompt-token boosting (match prompt tokens to repo tokens)
 * - Deterministic option ordering + IDs (no flicker)
 * - Survives VS Code restart mid-clarification
 * - Never emits tool_start/tool_end for tool="llm_answer" in PLAN mode
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

// ============================================================================
// CONSTANTS (Section B)
// ============================================================================

export const CONTEXT_TIMEOUT_MS = 3000;
export const TODO_SCAN_TIMEOUT_MS = 2000;
const ADAPTIVE_EXTEND_THRESHOLD_MS = 1800; // Time threshold to extend depth

// Excluded directories for file tree scanning
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__',
  '.next', '.nuxt', 'out', '.cache', 'vendor', 'venv', '.venv',
  '.turbo', '.pnpm', 'target', 'bin', 'obj'
]);

// Monorepo root indicators
const MONOREPO_ROOTS = ['apps', 'packages', 'services', 'libs', 'modules', 'projects'];

// Universal role patterns for anchor matching (NOT app-domain specific)
const UNIVERSAL_ROLE_PATTERNS: RolePattern[] = [
  {
    role: 'routing',
    keywords: ['route', 'router', 'navigation', 'nav', 'page', 'pages'],
    title: 'Routing & Navigation',
    description: 'Page routing, navigation flows, URL handling'
  },
  {
    role: 'state',
    keywords: ['store', 'state', 'context', 'provider', 'redux', 'zustand', 'recoil', 'mobx', 'atom'],
    title: 'State & Data Flow',
    description: 'Application state, data stores, global context'
  },
  {
    role: 'api',
    keywords: ['api', 'client', 'service', 'sdk', 'fetch', 'graphql', 'trpc', 'rest', 'http'],
    title: 'API & Data Layer',
    description: 'API clients, data fetching, backend communication'
  },
  {
    role: 'model',
    keywords: ['model', 'schema', 'entity', 'dto', 'types', 'interface', 'domain'],
    title: 'Data Models & Schemas',
    description: 'Data structures, type definitions, domain entities'
  },
  {
    role: 'backend',
    keywords: ['controller', 'handler', 'middleware', 'resolver', 'endpoint'],
    title: 'Backend Handlers',
    description: 'Controllers, request handlers, middleware'
  },
  {
    role: 'config',
    keywords: ['config', 'eslint', 'tsconfig', 'vite', 'webpack', 'jest', 'vitest', 'babel', 'rollup'],
    title: 'Config & Tooling',
    description: 'Build configuration, linting, testing setup'
  },
  {
    role: 'test',
    keywords: ['test', 'spec', '__tests__', 'e2e', 'cypress', 'playwright'],
    title: 'Testing',
    description: 'Unit tests, integration tests, E2E tests'
  },
  {
    role: 'docs',
    keywords: ['readme', 'docs', 'documentation', 'changelog', 'contributing'],
    title: 'Documentation',
    description: 'README, docs, guides'
  }
];

// File stopwords (only for standalone filenames, NOT folder tokens)
const FILE_STOPWORDS = new Set(['index', 'utils', 'common', 'shared', 'types', 'helpers', 'constants']);

// Token minimum length
const MIN_TOKEN_LENGTH = 3;

// Tunable weights for prompt assessment (Section C)
export interface PromptAssessmentWeights {
  filenameMention: number;
  symbolLikeToken: number;
  explicitScopeWords: number;
  lengthOver50: number;
  actionVerb: number;
  repoTokenMatch: number;  // per match, max 3
  vagueQuestionStems: number;
  veryShortPrompt: number;
  vagueWords: number;
  exploratoryOnly: number;
}

export const DEFAULT_ASSESSMENT_WEIGHTS: PromptAssessmentWeights = {
  filenameMention: 20,
  symbolLikeToken: 15,
  explicitScopeWords: 10,
  lengthOver50: 10,
  actionVerb: 5,
  repoTokenMatch: 5,  // max 15 (3 matches)
  vagueQuestionStems: -20,
  veryShortPrompt: -15,
  vagueWords: -10,
  exploratoryOnly: -10
};

interface RolePattern {
  role: string;
  keywords: string[];
  title: string;
  description: string;
}

// Generic filler options (Section E)
const GENERIC_FILLERS: ClarificationOption[] = [
  {
    id: 'generic-ui-ux',
    title: 'UI/UX Improvements',
    description: 'Interface improvements, design polish, accessibility',
    evidence: ['UI/UX enhancements based on best practices']
  },
  {
    id: 'generic-performance',
    title: 'Performance Optimization',
    description: 'Speed optimizations, caching, bundle size',
    evidence: ['Performance improvements based on analysis']
  },
  {
    id: 'generic-testing',
    title: 'Testing & Quality',
    description: 'Test coverage, quality assurance, reliability',
    evidence: ['Testing improvements based on project needs']
  }
];

// ============================================================================
// TYPES
// ============================================================================

export interface LightContextBundle {
  level: 'light';
  stack: string | 'unknown';
  top_dirs: string[];
  anchor_files: string[];
  todo_count: number | null;
  files_scanned: number;
  scan_duration_ms: number;
}

export interface PromptAssessment {
  clarity: 'high' | 'medium' | 'low';
  clarity_score: number;
  intent: 'plan_like' | 'mission_like' | 'answer_like';
  reasoning: string;
}

export interface ClarificationOption {
  id: string;
  title: string;
  description: string;
  evidence: string[];
}

export interface ClarificationPresented {
  task_id: string;
  options: ClarificationOption[];
  fallback_option_id: string;
}

interface DomainMapping {
  id: string;
  title: string;
  description: string;
  keywords: string[];
}

interface DomainMatch {
  domain: DomainMapping;
  matchingFiles: string[];
  matchCount: number;
}

// ============================================================================
// LIGHT CONTEXT COLLECTION (Section B)
// ============================================================================

/**
 * Collect lightweight project context for PLAN mode
 * Budget: < 3 seconds total
 */
export async function collectLightContext(
  workspaceRoot: string
): Promise<LightContextBundle> {
  const startTime = Date.now();
  
  let stack: string | 'unknown' = 'unknown';
  let top_dirs: string[] = [];
  let anchor_files: string[] = [];
  let todo_count: number | null = null;
  let files_scanned = 0;

  const LOG_PREFIX = '[Ordinex:PlanEnhancement]';

  try {
    // 1) package.json (if present)
    if (Date.now() - startTime < CONTEXT_TIMEOUT_MS) {
      try {
        const packageJsonPath = path.join(workspaceRoot, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          stack = inferStackFromPackageJson(packageJson);
        }
      } catch (e) {
        console.log(`${LOG_PREFIX} Stack detection failed, proceeding with limited context (no package.json)`);
        stack = 'unknown';
      }
    }

    // 2) File tree depth=3 (paths only)
    if (Date.now() - startTime < CONTEXT_TIMEOUT_MS) {
      try {
        const treeResult = scanFileTree(workspaceRoot, 3, startTime);
        top_dirs = treeResult.topDirs.sort();
        files_scanned = treeResult.filesScanned;
      } catch (e) {
        console.log(`${LOG_PREFIX} File tree scan failed`);
        top_dirs = [];
        files_scanned = 0;
      }
    }

    // 3) Anchor file scan (deterministic)
    if (Date.now() - startTime < CONTEXT_TIMEOUT_MS) {
      try {
        const anchors = findAnchorFiles(workspaceRoot, startTime);
        anchor_files = anchors.slice(0, 10).sort(); // Limit 10, sorted
      } catch (e) {
        anchor_files = [];
      }
    }

    // 4) TODO/FIXME count (optional)
    if (Date.now() - startTime < CONTEXT_TIMEOUT_MS) {
      try {
        todo_count = await countTodos(workspaceRoot, startTime);
      } catch (e) {
        console.log(`${LOG_PREFIX} TODO scan timed out, skipping`);
        todo_count = null;
      }
    }

  } catch (e) {
    console.error(`${LOG_PREFIX} Context collection error:`, e);
  }

  const scan_duration_ms = Date.now() - startTime;

  // Warnings
  if (stack === 'unknown') {
    console.log(`${LOG_PREFIX} Stack detection failed, proceeding with limited context (no package.json)`);
  }

  if (anchor_files.length === 0 && top_dirs.length === 0) {
    console.log(`${LOG_PREFIX} WARNING: Minimal project context available`);
  }

  console.log(`${LOG_PREFIX} context_collected(light) results:`, {
    stack,
    top_dirs: top_dirs.length,
    anchor_files: anchor_files.length,
    todo_count,
    files_scanned,
    scan_duration_ms
  });

  return {
    level: 'light',
    stack,
    top_dirs,
    anchor_files,
    todo_count,
    files_scanned,
    scan_duration_ms
  };
}

/**
 * Infer technology stack from package.json
 */
function inferStackFromPackageJson(packageJson: any): string {
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };

  const stackParts: string[] = [];

  // Framework detection
  if (deps['next']) stackParts.push('Next.js');
  else if (deps['nuxt']) stackParts.push('Nuxt');
  else if (deps['react']) stackParts.push('React');
  else if (deps['vue']) stackParts.push('Vue');
  else if (deps['angular'] || deps['@angular/core']) stackParts.push('Angular');
  else if (deps['express']) stackParts.push('Express');
  else if (deps['fastify']) stackParts.push('Fastify');

  // TypeScript
  if (deps['typescript']) stackParts.push('TypeScript');

  // Testing
  if (deps['jest'] || deps['vitest']) stackParts.push('Jest/Vitest');
  if (deps['cypress'] || deps['playwright']) stackParts.push('E2E');

  return stackParts.length > 0 ? stackParts.join(', ') : 'Node.js';
}

/**
 * Scan file tree up to specified depth
 */
function scanFileTree(
  rootDir: string,
  maxDepth: number,
  startTime: number
): { topDirs: string[]; filesScanned: number } {
  const topDirs: Set<string> = new Set();
  let filesScanned = 0;

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    if (Date.now() - startTime > CONTEXT_TIMEOUT_MS) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (Date.now() - startTime > CONTEXT_TIMEOUT_MS) break;

        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootDir, fullPath);

        if (entry.isDirectory()) {
          if (depth === 0) {
            topDirs.add(relativePath);
          }
          walk(fullPath, depth + 1);
        } else {
          filesScanned++;
        }
      }
    } catch (e) {
      // Silently skip inaccessible directories
    }
  }

  walk(rootDir, 0);
  return { topDirs: Array.from(topDirs), filesScanned };
}

/**
 * Find anchor files matching universal role patterns
 */
function findAnchorFiles(workspaceRoot: string, startTime: number): string[] {
  const anchors: string[] = [];
  
  // Collect all keywords from universal role patterns
  const allKeywords: string[] = [];
  for (const pattern of UNIVERSAL_ROLE_PATTERNS) {
    allKeywords.push(...pattern.keywords);
  }
  const keywordsLower = allKeywords.map((k: string) => k.toLowerCase());

  function walk(dir: string, depth: number): void {
    if (depth > 4) return; // Max depth for anchor search
    if (Date.now() - startTime > CONTEXT_TIMEOUT_MS) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (Date.now() - startTime > CONTEXT_TIMEOUT_MS) break;
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(workspaceRoot, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else {
          // Check if filename contains any anchor keyword
          const fileNameLower = entry.name.toLowerCase();
          for (const keyword of keywordsLower) {
            if (fileNameLower.includes(keyword)) {
              anchors.push(relativePath);
              break;
            }
          }
        }

        if (anchors.length >= 50) return; // Early exit if we have enough
      }
    } catch (e) {
      // Silently skip
    }
  }

  walk(workspaceRoot, 0);
  return anchors;
}

/**
 * Count TODO/FIXME markers with timeout
 */
async function countTodos(workspaceRoot: string, startTime: number): Promise<number | null> {
  return new Promise((resolve) => {
    const remainingTime = TODO_SCAN_TIMEOUT_MS - (Date.now() - startTime);
    if (remainingTime <= 0) {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      console.log('[Ordinex:PlanEnhancement] TODO scan timed out, skipping');
      resolve(null);
    }, remainingTime);

    // Try ripgrep first, fall back to grep
    const rgProcess = spawn('rg', ['-c', 'TODO|FIXME', '--type-add', 'src:*.{ts,tsx,js,jsx,py,go,java}', '--type', 'src'], {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let errorOccurred = false;

    rgProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    rgProcess.stderr.on('data', () => {
      errorOccurred = true;
    });

    rgProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      if (errorOccurred || code !== 0) {
        // Ripgrep not available or failed, try grep
        tryGrep(workspaceRoot, remainingTime).then(resolve);
        return;
      }

      // Parse ripgrep output (format: file:count)
      const lines = output.trim().split('\n').filter(l => l);
      let total = 0;
      for (const line of lines) {
        const parts = line.split(':');
        const count = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(count)) total += count;
      }
      resolve(total);
    });

    rgProcess.on('error', () => {
      clearTimeout(timeout);
      tryGrep(workspaceRoot, remainingTime).then(resolve);
    });
  });
}

/**
 * Fallback grep for TODO counting
 */
async function tryGrep(workspaceRoot: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, timeoutMs);

    const grepProcess = spawn('grep', ['-r', '-c', '-E', 'TODO|FIXME', '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx', '.'], {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';

    grepProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    grepProcess.on('close', () => {
      clearTimeout(timeout);
      const lines = output.trim().split('\n').filter(l => l);
      let total = 0;
      for (const line of lines) {
        const parts = line.split(':');
        const count = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(count)) total += count;
      }
      resolve(total || null);
    });

    grepProcess.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

// ============================================================================
// PROMPT ASSESSMENT (Section C - Heuristic Only, No LLM)
// ============================================================================

/**
 * Assess prompt clarity using deterministic heuristics (no LLM)
 */
export function assessPromptClarity(
  prompt: string,
  anchorFiles: string[]
): PromptAssessment {
  const LOG_PREFIX = '[Ordinex:PlanEnhancement]';
  
  let rawScore = 50;
  const breakdown: string[] = [];

  // === ADDITIONS ===

  // +20 if prompt mentions filename pattern
  const filePatternRegex = /\*?\.(ts|tsx|js|jsx|py|go|java|package\.json)/i;
  if (filePatternRegex.test(prompt)) {
    rawScore += 20;
    breakdown.push('+20 file mention');
  }

  // +15 if contains likely symbol name (PascalCase or camelCase with length >= 6)
  const symbolRegex = /\b([A-Z][a-z]+[A-Z][a-zA-Z]*|[a-z]+[A-Z][a-zA-Z]*)\b/;
  const symbolMatch = prompt.match(symbolRegex);
  if (symbolMatch && symbolMatch[0].length >= 6) {
    rawScore += 15;
    breakdown.push('+15 symbol name');
  }

  // +10 if contains explicit scope words
  const scopeWords = ['only', 'just', 'specifically', 'focus', 'limit to'];
  if (scopeWords.some(w => prompt.toLowerCase().includes(w))) {
    rawScore += 10;
    breakdown.push('+10 scope words');
  }

  // +10 if prompt length > 50 chars
  if (prompt.length > 50) {
    rawScore += 10;
    breakdown.push('+10 length>50');
  }

  // +5 if contains action verbs
  const actionVerbs = ['add', 'fix', 'build', 'refactor', 'implement', 'create', 'update', 'optimize', 'test'];
  if (actionVerbs.some(v => prompt.toLowerCase().includes(v))) {
    rawScore += 5;
    breakdown.push('+5 action verb');
  }

  // +5 per keyword hit from universal role patterns (max +15)
  const allRoleKeywords: string[] = [];
  for (const pattern of UNIVERSAL_ROLE_PATTERNS) {
    allRoleKeywords.push(...pattern.keywords);
  }
  const roleKeywordsLower = allRoleKeywords.map((k: string) => k.toLowerCase());
  let keywordHits = 0;
  for (const keyword of roleKeywordsLower) {
    if (prompt.toLowerCase().includes(keyword)) {
      keywordHits++;
      if (keywordHits >= 3) break; // Max 3 hits
    }
  }
  if (keywordHits > 0) {
    const bonus = Math.min(keywordHits * 5, 15);
    rawScore += bonus;
    breakdown.push(`+${bonus} role keywords (${keywordHits} hits)`);
  }

  // === SUBTRACTIONS ===

  // -20 if starts with/contains vague question stems
  const vagueStems = ['what should', 'what can', 'how about', 'any ideas'];
  if (vagueStems.some(s => prompt.toLowerCase().includes(s))) {
    rawScore -= 20;
    breakdown.push('-20 vague question');
  }

  // -15 if prompt length < 15 chars
  if (prompt.length < 15) {
    rawScore -= 15;
    breakdown.push('-15 length<15');
  }

  // -10 if contains vague words
  const vagueWords = ['improve', 'better', 'enhance', 'something', 'stuff', 'things'];
  if (vagueWords.some(w => prompt.toLowerCase().includes(w))) {
    rawScore -= 10;
    breakdown.push('-10 vague words');
  }

  // -10 if contains exploratory-only words without target
  const exploratoryWords = ['ideas', 'suggestions', 'options', 'possibilities'];
  const hasExploratory = exploratoryWords.some(w => prompt.toLowerCase().includes(w));
  const hasTarget = filePatternRegex.test(prompt) || (symbolMatch && symbolMatch[0].length >= 6);
  if (hasExploratory && !hasTarget) {
    rawScore -= 10;
    breakdown.push('-10 exploratory without target');
  }

  // Clamp to 0-100
  const clarity_score = Math.max(0, Math.min(100, rawScore));

  // Classification
  let clarity: 'high' | 'medium' | 'low';
  if (clarity_score >= 70) {
    clarity = 'high';
  } else if (clarity_score >= 40) {
    clarity = 'medium';
  } else {
    clarity = 'low';
  }

  // Intent detection (observability only, does NOT alter flow)
  let intent: 'plan_like' | 'mission_like' | 'answer_like' = 'plan_like';
  const promptLower = prompt.toLowerCase();
  
  if (promptLower.includes('explain') || promptLower.includes('what is') || promptLower.includes('how does')) {
    intent = 'answer_like';
  } else if ((promptLower.includes('implement') || promptLower.includes('build') || promptLower.includes('add')) && hasTarget) {
    intent = 'mission_like';
  }

  const reasoning = `raw=${rawScore}, clamped=${clarity_score}, breakdown: ${breakdown.join(', ')}`;

  console.log(`${LOG_PREFIX} prompt_assessed clarity_score=${clarity_score}, reasoning: ${reasoning}`);

  return {
    clarity,
    clarity_score,
    intent,
    reasoning
  };
}

// ============================================================================
// CLARIFICATION DECISION (Section D)
// ============================================================================

/**
 * Determine if clarification should be shown
 */
export function shouldShowClarification(
  assessment: PromptAssessment,
  prompt: string
): boolean {
  const { clarity, clarity_score } = assessment;
  const promptLower = prompt.toLowerCase();

  // High clarity: skip clarification
  if (clarity === 'high') {
    return false;
  }

  // Check for action verb + specific target patterns (skip clarification)
  const actionVerbs = ['create', 'add', 'build', 'implement', 'make', 'write', 'develop', 'fix', 'refactor'];
  const hasActionVerb = actionVerbs.some(v => promptLower.includes(v));
  
  // Specific target patterns - component/feature names, technology mentions
  const specificTargets = [
    'component', 'page', 'feature', 'button', 'form', 'modal', 'dialog', 'table', 'list',
    'header', 'footer', 'sidebar', 'navbar', 'menu', 'card', 'chart', 'dashboard',
    'authentication', 'login', 'signup', 'register', 'profile', 'settings', 'search',
    'api', 'hook', 'context', 'provider', 'store', 'reducer', 'action', 'selector',
    'todo', 'task', 'item', 'user', 'product', 'order', 'cart', 'checkout'
  ];
  const hasSpecificTarget = specificTargets.some(t => promptLower.includes(t));
  
  // Framework/technology mentions suggest specificity
  const techMentions = ['react', 'vue', 'angular', 'next', 'node', 'express', 'typescript'];
  const hasTechMention = techMentions.some(t => promptLower.includes(t));

  // Skip clarification if: action verb + (specific target OR tech mention)
  if (hasActionVerb && (hasSpecificTarget || hasTechMention)) {
    console.log(`[Ordinex:PlanEnhancement] Skipping clarification: action verb + specific target detected`);
    return false;
  }

  // For medium clarity (40-69), also check other specificity signals
  if (clarity === 'medium') {
    const hasExplicitScope = /only|just|specifically|focus|limit to/i.test(prompt);
    const hasFileComponentMention = /\.(ts|tsx|js|jsx|py|go|java)|[A-Z][a-z]+[A-Z][a-zA-Z]*\.tsx?/i.test(prompt);
    
    // Skip if user mentions specific file/component OR explicit scope
    if (hasExplicitScope || hasFileComponentMention) {
      return false;
    }
    
    // If clarity score is 50+, still skip for prompts with decent specificity
    if (clarity_score >= 50 && (hasActionVerb || hasSpecificTarget)) {
      console.log(`[Ordinex:PlanEnhancement] Skipping clarification: score ${clarity_score} with action/target`);
      return false;
    }
    
    return true;
  }

  // Always show for low clarity
  return true;
}

// ============================================================================
// OPTION GENERATION (Section E)
// ============================================================================

/**
 * Generate deterministic, grounded clarification options
 * Uses universal role patterns (not app-specific domains)
 */
export function generateClarificationOptions(
  context: LightContextBundle,
  prompt: string
): ClarificationOption[] {
  const LOG_PREFIX = '[Ordinex:PlanEnhancement]';
  const options: ClarificationOption[] = [];

  // Determine if small repo (SMALL_REPO rule for evidence threshold)
  const isSmallRepo = context.files_scanned <= 200 || 
    (context.files_scanned <= 800 && context.top_dirs.length <= 5);
  const minMatches = isSmallRepo ? 1 : 2;

  // Match anchor files to universal role patterns
  interface RoleMatch {
    pattern: RolePattern;
    matchingFiles: string[];
    matchCount: number;
  }

  const roleMatches: RoleMatch[] = [];
  
  for (const pattern of UNIVERSAL_ROLE_PATTERNS) {
    const matchingFiles: string[] = [];
    
    for (const file of context.anchor_files) {
      const filePathLower = file.toLowerCase();
      const fileNameLower = path.basename(file).toLowerCase();
      
      for (const keyword of pattern.keywords) {
        // Match against both filename and path
        if (fileNameLower.includes(keyword.toLowerCase()) || 
            filePathLower.includes(keyword.toLowerCase())) {
          matchingFiles.push(file);
          break;
        }
      }
    }

    if (matchingFiles.length >= minMatches) {
      roleMatches.push({
        pattern,
        matchingFiles: matchingFiles.sort(),
        matchCount: matchingFiles.length
      });
    }
  }

  // Sort by match count desc, then by title for determinism
  const qualifiedRoles = roleMatches
    .sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return a.pattern.title.localeCompare(b.pattern.title);
    })
    .slice(0, 4); // Max 4 role options

  // Add role options (sorted alphabetically by title for final display)
  const roleOptions = qualifiedRoles
    .sort((a, b) => a.pattern.title.localeCompare(b.pattern.title))
    .map(m => ({
      id: `role-${m.pattern.role}`,
      title: m.pattern.title,
      description: m.pattern.description,
      evidence: m.matchingFiles.slice(0, 5) // Limit evidence to 5 files
    }));

  options.push(...roleOptions);

  // Add TODO option if applicable
  if (context.todo_count !== null && context.todo_count > 5) {
    options.push({
      id: 'todo-debt',
      title: 'Technical Debt & TODOs',
      description: 'Address existing code TODOs and technical improvements',
      evidence: [`Found ${context.todo_count} TODO/FIXME markers`]
    });
  }

  // ALWAYS add fallback option
  const fallbackOption: ClarificationOption = {
    id: 'fallback-suggest',
    title: 'Suggest ideas based on analysis',
    description: 'Let me analyze and suggest 5–8 feature ideas grouped by effort',
    evidence: ['Will suggest 5–8 ideas grouped by effort']
  };
  options.push(fallbackOption);

  // Add generic fillers if needed to reach minimum 3 options
  let fillerIndex = 0;
  while (options.length < 3 && fillerIndex < GENERIC_FILLERS.length) {
    options.push(GENERIC_FILLERS[fillerIndex]);
    fillerIndex++;
  }

  // Final validation: ensure we have at least fallback
  if (options.length === 0) {
    options.push(fallbackOption);
    options.push(...GENERIC_FILLERS);
  }

  console.log(`${LOG_PREFIX} generated options:`, options.map(o => ({ id: o.id, title: o.title, evidence: o.evidence.length })));

  return options;
}

// ============================================================================
// ENRICHED PROMPT BUILDING (Section I)
// ============================================================================

/**
 * Build enriched prompt for LLM plan generation after clarification
 */
export function buildEnrichedPrompt(
  userPrompt: string,
  selectedOption: ClarificationOption,
  context: LightContextBundle
): string {
  const stackStr = context.stack === 'unknown' 
    ? 'Could not detect (no package.json)' 
    : context.stack;

  return `---
PLANNING REQUEST
Original intent: "${userPrompt}"

Selected focus: ${selectedOption.title}
Relevant files/evidence: ${selectedOption.evidence.join(', ')}

Project context:
- Stack: ${stackStr}
- Directories: ${context.top_dirs.slice(0, 5).join(', ')}
- Anchor files: ${context.anchor_files.join(', ')}
- TODO count: ${context.todo_count ?? 'unknown'}

Generate a plan that:
1) Is SPECIFIC to "${selectedOption.title}"
2) References actual files from evidence/anchor list when possible
3) Has 3–7 concrete implementation steps
4) Includes scope_contract { max_files, max_lines }
5) Lists risks + assumptions
6) Defines success_criteria
7) Estimates effort per step (S/M/L)

Do NOT plan outside selected focus.
Do NOT invent files that don't exist.
---`;
}

/**
 * Build fallback prompt for "skip" or "suggest ideas" option
 * This prompt must generate ACTUAL feature ideas, not a meta-plan about how to analyze
 */
export function buildFallbackPrompt(
  userPrompt: string,
  context: LightContextBundle
): string {
  const stackStr = context.stack === 'unknown' 
    ? 'a web application' 
    : context.stack;

  return `---
FEATURE IDEATION REQUEST

You are helping plan features for an existing ${stackStr} project.

User's request: "${userPrompt}"

Project signals:
- Stack: ${context.stack}
- Key directories: ${context.top_dirs.slice(0, 6).join(', ') || 'src'}
- Existing files: ${context.anchor_files.slice(0, 8).join(', ') || 'various source files'}
- TODO markers: ${context.todo_count ?? 'unknown'}

IMPORTANT: Generate a plan with 5-8 CONCRETE FEATURE IDEAS that could be implemented in this app.

Each feature MUST be a real, implementable feature like:
- "Add dark mode toggle" 
- "Implement workout history export to CSV"
- "Add push notification reminders"
- "Create a dashboard with weekly stats"
- "Implement social sharing for achievements"
- "Add offline mode with local storage sync"

DO NOT suggest meta-tasks like "analyze codebase" or "review architecture".
DO NOT suggest process improvements like "improve documentation".
ONLY suggest actual user-facing or developer-facing features that require code changes.

Output format - create a plan with these steps:
1) Feature: [Title] - [One sentence description] - Files: [likely files to modify] - Effort: S/M/L
2) Feature: [Title] - [One sentence description] - Files: [likely files to modify] - Effort: S/M/L
... (5-8 features total)

Group the features by effort level in the plan steps.
Each "step" represents one feature idea.
---`;
}

// ============================================================================
// RESUME/PERSISTENCE HELPERS (Section J)
// ============================================================================

/**
 * Check if clarification is pending from stored events
 * Used for persistence/resume after VS Code reload
 */
export function isClarificationPending(events: any[]): boolean {
  const hasClarificationPresented = events.some(e => e.type === 'clarification_presented');
  const hasClarificationReceived = events.some(e => e.type === 'clarification_received');
  
  return hasClarificationPresented && !hasClarificationReceived;
}

/**
 * Get pending clarification options from events
 * Returns null if no pending clarification
 */
export function getPendingClarificationOptions(events: any[]): ClarificationOption[] | null {
  if (!isClarificationPending(events)) {
    return null;
  }

  const clarificationEvent = events.find(e => e.type === 'clarification_presented');
  if (!clarificationEvent) {
    return null;
  }

  return clarificationEvent.payload.options as ClarificationOption[];
}
