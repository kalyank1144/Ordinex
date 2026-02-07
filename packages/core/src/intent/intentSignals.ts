/**
 * Step 40: Intent Signals - Single Source of Truth
 * 
 * This module consolidates ALL intent detection logic into one place.
 * Everyone should use these helpers - no duplicate detection elsewhere.
 * 
 * Exports:
 * - detectGreenfieldIntent(text)
 * - detectCommandIntent(text)
 * - detectEditScale(text)
 * - normalizeUserInput(text)
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Generic signal result for all intent detectors
 */
export interface IntentSignal {
  /** Whether the intent was detected */
  isMatch: boolean;
  /** Confidence level (0.0 - 1.0) */
  confidence: number;
  /** Human-readable reason for the detection */
  reason: string;
  /** Keywords that matched (for debugging) */
  matchedKeywords?: string[];
}

// ============================================================================
// INPUT NORMALIZATION
// ============================================================================

/**
 * Normalize user input for consistent matching
 * 
 * - Trims whitespace
 * - Collapses multiple spaces
 * - Converts to lowercase (for matching)
 * - Preserves original for display
 * 
 * @param text - Raw user input
 * @returns Normalized text
 */
export function normalizeUserInput(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// ============================================================================
// GREENFIELD DETECTION (Step 40)
// ============================================================================

/**
 * Strong greenfield patterns (confidence ≥ 0.9)
 * These regex patterns clearly indicate "create new project from scratch"
 */
const GREENFIELD_STRONG_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Explicit creation verbs + project nouns
  {
    pattern: /\b(creat(e|ing)|build(ing)?|mak(e|ing)|start(ing)?|scaffold(ing)?|sett?ing\s+up|spinn?ing\s+up|initializ(e|ing)|init|bootstrap(ping)?)\b.*\b(app|application|project|site|website|dashboard|webapp|web\s+app)\b/i,
    description: 'creation verb + project noun',
  },
  // "new X app/project" pattern
  {
    pattern: /\b(new|fresh|blank)\b.*\b(app|application|project|site|website|dashboard|webapp|web\s+app)\b/i,
    description: 'new/fresh/blank + project noun',
  },
  // Explicit greenfield phrases
  {
    pattern: /\b(from\s+scratch|greenfield|starter\s+template|boilerplate|empty\s+(folder|directory))\b/i,
    description: 'explicit greenfield phrase',
  },
  // Framework scaffolding (scaffold/init + framework)
  {
    pattern: /\b(scaffold|bootstrap|init|initialize)\b.*\b(react|vue|angular|next|nextjs|next\.js|vite|expo|express|node|typescript|ts)\b/i,
    description: 'scaffold/init + framework',
  },
  // Framework + new/start
  {
    pattern: /\b(new|start)\b.*\b(react|vue|angular|next|nextjs|next\.js|vite|expo|express)\b.*\b(app|project)?\b/i,
    description: 'new + framework',
  },
  // Specific app type creation
  {
    pattern: /\b(creat(e|ing)|build(ing)?|mak(e|ing))\b.*\b(fitness|todo|workout|tracker|ecommerce|e-commerce|blog|chat|social|mobile|web|saas|dashboard)\b.*\b(app|application)?\b/i,
    description: 'creation + app type',
  },
  // "I want to build/make/create a X"
  {
    pattern: /\bi\s+want\s+to\s+(creat(e)?|build|make|start)\b.*\b(app|application|project|dashboard|website|site)\b/i,
    description: '"I want to create" + project noun',
  },
];

/**
 * Weak greenfield signal keywords (combined confidence ~0.5-0.7)
 */
const GREENFIELD_WEAK_KEYWORDS = {
  verbs: ['create', 'build', 'make', 'start', 'scaffold', 'setup', 'init', 'initialize', 'spin', 'bootstrap'],
  nouns: ['app', 'application', 'project', 'website', 'site', 'dashboard', 'webapp'],
  newness: ['new', 'fresh', 'blank', 'scratch', 'greenfield', 'starter', 'template'],
  frameworks: ['react', 'vue', 'angular', 'next', 'nextjs', 'vite', 'expo', 'express', 'node', 'typescript'],
};

/**
 * Exclusion patterns that indicate NOT greenfield
 * These patterns override greenfield detection
 */
const GREENFIELD_EXCLUSIONS: RegExp[] = [
  // Running commands (run the app, start dev)
  /\b(run|execute|launch)\s+(the\s+)?(dev|server|tests?|build|app|application)\b/i,
  // Fixing/modifying existing code
  /\b(fix|debug|repair|update|modify|change|edit|refactor)\b.*\b(the|this|my|our)\b/i,
  // Adding to existing
  /\b(add|implement)\b.*\b(to|in|into)\s+(the|this|my|our)\b/i,
  // Questions about existing
  /\b(why|what|how|where|when)\b.*\b(is|does|did|was|were)\b.*\?/i,
  // "run the app" or "start the server"
  /\b(run|start)\s+the\s+(app|application|server|project)\b/i,
  // "the existing" or "my existing"
  /\b(the|my|our|this)\s+(existing|current)\b/i,
];

/**
 * Detect greenfield intent from user text
 * 
 * @param text - User's input prompt
 * @returns IntentSignal with confidence and reason
 */
export function detectGreenfieldIntent(text: string): IntentSignal {
  const normalized = normalizeUserInput(text);
  const matchedKeywords: string[] = [];

  // Step 1: Check exclusion patterns first
  for (const exclusion of GREENFIELD_EXCLUSIONS) {
    if (exclusion.test(normalized)) {
      return {
        isMatch: false,
        confidence: 0.1,
        reason: 'Exclusion pattern matched - not greenfield',
        matchedKeywords: [],
      };
    }
  }

  // Step 2: Check strong patterns (high confidence ~0.9)
  for (const { pattern, description } of GREENFIELD_STRONG_PATTERNS) {
    if (pattern.test(normalized)) {
      const match = normalized.match(pattern);
      if (match) {
        matchedKeywords.push(match[0]);
      }
      return {
        isMatch: true,
        confidence: 0.9,
        reason: `Strong greenfield signal: ${description}`,
        matchedKeywords,
      };
    }
  }

  // Step 3: Count weak signal keywords
  let weakSignalCount = 0;
  const weakMatches: string[] = [];

  // Check verbs (including -ing forms)
  for (const verb of GREENFIELD_WEAK_KEYWORDS.verbs) {
    const verbPattern = new RegExp(`\\b${verb}(ing|e|ed|s)?\\b`, 'i');
    if (verbPattern.test(normalized)) {
      weakSignalCount++;
      weakMatches.push(verb);
    }
  }

  // Check nouns
  for (const noun of GREENFIELD_WEAK_KEYWORDS.nouns) {
    const nounPattern = new RegExp(`\\b${noun}(s)?\\b`, 'i');
    if (nounPattern.test(normalized)) {
      weakSignalCount++;
      weakMatches.push(noun);
    }
  }

  // Check newness indicators
  for (const newWord of GREENFIELD_WEAK_KEYWORDS.newness) {
    const newPattern = new RegExp(`\\b${newWord}\\b`, 'i');
    if (newPattern.test(normalized)) {
      weakSignalCount++;
      weakMatches.push(newWord);
    }
  }

  // Check frameworks
  for (const framework of GREENFIELD_WEAK_KEYWORDS.frameworks) {
    const fwPattern = new RegExp(`\\b${framework}(\\.js)?\\b`, 'i');
    if (fwPattern.test(normalized)) {
      weakSignalCount++;
      weakMatches.push(framework);
    }
  }

  // Step 4: Evaluate weak signals
  const hasNewness = GREENFIELD_WEAK_KEYWORDS.newness.some(w => 
    new RegExp(`\\b${w}\\b`, 'i').test(normalized)
  );
  const hasVerb = GREENFIELD_WEAK_KEYWORDS.verbs.some(v => 
    new RegExp(`\\b${v}(ing|e|ed|s)?\\b`, 'i').test(normalized)
  );

  // Strong combination: 3+ keywords with newness/verb
  if (weakSignalCount >= 3 && (hasNewness || hasVerb)) {
    return {
      isMatch: true,
      confidence: 0.75,
      reason: `Multiple greenfield keywords (${weakSignalCount} matches)`,
      matchedKeywords: weakMatches,
    };
  }

  // Medium combination: 2 keywords with newness
  if (weakSignalCount >= 2 && hasNewness) {
    return {
      isMatch: true,
      confidence: 0.65,
      reason: `Greenfield keywords with newness indicator (${weakSignalCount} matches)`,
      matchedKeywords: weakMatches,
    };
  }

  // Weak combination: 2 keywords (ambiguous)
  if (weakSignalCount >= 2) {
    return {
      isMatch: true,
      confidence: 0.5,
      reason: `Some greenfield keywords (${weakSignalCount} matches) - ambiguous`,
      matchedKeywords: weakMatches,
    };
  }

  // No greenfield intent
  return {
    isMatch: false,
    confidence: 0.1,
    reason: weakSignalCount > 0 
      ? `Insufficient greenfield signals (only ${weakSignalCount} keyword)`
      : 'No greenfield keywords detected',
    matchedKeywords: weakMatches,
  };
}

// ============================================================================
// COMMAND DETECTION (Step 40)
// ============================================================================

/**
 * Command action verbs (explicit command execution)
 */
const COMMAND_VERBS = [
  'run',
  'execute',
  'launch',
  'start',
  'stop',
  'restart',
  'serve',
  'test',
  'deploy',
  'install',
  'compile',
  'bundle',
  'watch',
  'lint',
  'typecheck',
];

/**
 * Command targets (what to run)
 */
const COMMAND_TARGETS = [
  'tests',
  'test',
  'server',
  'dev',
  'development',
  'build',
  'script',
  'command',
  'task',
  'app',
  'application',
];

/**
 * Direct command patterns (npm/yarn/etc)
 */
const DIRECT_COMMAND_PATTERNS = [
  /\b(npm|pnpm|yarn)\s+(run\s+)?[\w-]+/gi,
  /\b(node|deno|bun)\s+[\w./]+/gi,
  /\b(cargo|go|python|mvn|gradle)\s+\w+/gi,
  /\b(tsc|eslint|prettier|jest|vitest)\b/gi,
];

/**
 * Detect command execution intent from user text
 * 
 * CRITICAL: Must NOT trigger on greenfield requests
 * 
 * @param text - User's input prompt
 * @returns IntentSignal with confidence and reason
 */
export function detectCommandIntent(text: string): IntentSignal {
  const normalized = normalizeUserInput(text);
  const matchedKeywords: string[] = [];

  // Step 1: Check greenfield first - greenfield is NOT a command
  const greenfieldResult = detectGreenfieldIntent(text);
  if (greenfieldResult.isMatch && greenfieldResult.confidence >= 0.7) {
    return {
      isMatch: false,
      confidence: 0.1,
      reason: `Greenfield detected (${greenfieldResult.reason}) - not a command`,
      matchedKeywords: [],
    };
  }

  // Step 2: Check for question patterns (not commands)
  const questionPatterns = [
    /\b(what|why|how|explain|tell me|show me|understand)\b/i,
    /\b(difference|compare|versus|vs\.?)\b/i,
    /\?$/,
  ];
  for (const pattern of questionPatterns) {
    if (pattern.test(normalized)) {
      return {
        isMatch: false,
        confidence: 0.9,
        reason: 'Question pattern detected - not a command',
        matchedKeywords: [],
      };
    }
  }

  // Step 3: Check direct command patterns (highest confidence)
  const directCommands: string[] = [];
  for (const pattern of DIRECT_COMMAND_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      directCommands.push(...matches);
      matchedKeywords.push(...matches);
    }
  }

  if (directCommands.length > 0) {
    return {
      isMatch: true,
      confidence: 0.95,
      reason: `Explicit command(s): ${directCommands.join(', ')}`,
      matchedKeywords,
    };
  }

  // Step 4: Check verb + target patterns
  const detectedVerbs: string[] = [];
  const detectedTargets: string[] = [];

  for (const verb of COMMAND_VERBS) {
    const verbPattern = new RegExp(`\\b${verb}\\b`, 'i');
    if (verbPattern.test(normalized)) {
      detectedVerbs.push(verb);
      matchedKeywords.push(verb);
    }
  }

  for (const target of COMMAND_TARGETS) {
    const targetPattern = new RegExp(`\\b${target}s?\\b`, 'i');
    if (targetPattern.test(normalized)) {
      detectedTargets.push(target);
      matchedKeywords.push(target);
    }
  }

  // Strong: verb + target
  if (detectedVerbs.length > 0 && detectedTargets.length > 0) {
    return {
      isMatch: true,
      confidence: 0.85,
      reason: `Verb [${detectedVerbs.join(', ')}] + target [${detectedTargets.join(', ')}]`,
      matchedKeywords,
    };
  }

  // Weak: only verb or only target
  if (detectedVerbs.length > 0 || detectedTargets.length > 0) {
    return {
      isMatch: true,
      confidence: 0.6,
      reason: detectedVerbs.length > 0
        ? `Action verb(s): ${detectedVerbs.join(', ')}`
        : `Target(s): ${detectedTargets.join(', ')}`,
      matchedKeywords,
    };
  }

  // No command intent
  return {
    isMatch: false,
    confidence: 0.1,
    reason: 'No command-related keywords detected',
    matchedKeywords: [],
  };
}

// ============================================================================
// EDIT SCALE DETECTION (Step 40 - feeds Step 33)
// ============================================================================

/**
 * Edit scale for scope detection
 */
export type EditScale = 'trivial' | 'small' | 'medium' | 'large';

/**
 * Edit scale detection result
 */
export interface EditScaleResult {
  scale: EditScale;
  confidence: number;
  reason: string;
  metrics?: {
    estimated_files: number;
    complexity_score: number;
  };
}

/**
 * Trivial edit patterns (single line, typo fixes)
 */
const TRIVIAL_PATTERNS = [
  /\bfix\s+typo/i,
  /\bcorrect\s+spelling/i,
  /\brename\s+\w+\s+to\s+\w+/i,
  /\bupdate\s+comment/i,
  /\bremove\s+unused/i,
  /\bfix\s+whitespace/i,
];

/**
 * Large edit patterns (refactoring, migrations)
 */
const LARGE_PATTERNS = [
  /\brefactor/i,
  /\bmigrate/i,
  /\brewrite/i,
  /\brestructure/i,
  /\boverhaul/i,
  /\barchitect/i,
  /\bintegrate/i,
  /\bupgrade\s+\w+\s+to/i,
];

/**
 * Multi-step indicators
 */
const MULTI_STEP_PATTERNS = [
  /\b(then|after\s+that|next|finally|first|second|third)\b/i,
  /\b(multiple|several|all|each|every)\s+\w*(file|component|module)/i,
];

/**
 * Detect edit scale from user text
 * 
 * @param text - User's input prompt
 * @returns EditScaleResult with scale and confidence
 */
export function detectEditScale(text: string): EditScaleResult {
  const normalized = normalizeUserInput(text);

  // Check for greenfield first (always large)
  const greenfieldResult = detectGreenfieldIntent(text);
  if (greenfieldResult.isMatch && greenfieldResult.confidence >= 0.65) {
    return {
      scale: 'large',
      confidence: 0.95,
      reason: `Greenfield project: ${greenfieldResult.reason}`,
      metrics: { estimated_files: 20, complexity_score: 80 },
    };
  }

  // Check trivial patterns
  for (const pattern of TRIVIAL_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        scale: 'trivial',
        confidence: 0.9,
        reason: 'Trivial edit pattern matched',
        metrics: { estimated_files: 1, complexity_score: 5 },
      };
    }
  }

  // Check large patterns
  let largeMatchCount = 0;
  for (const pattern of LARGE_PATTERNS) {
    if (pattern.test(normalized)) {
      largeMatchCount++;
    }
  }

  // Check multi-step indicators
  let hasMultiStep = false;
  for (const pattern of MULTI_STEP_PATTERNS) {
    if (pattern.test(normalized)) {
      hasMultiStep = true;
      break;
    }
  }

  // Calculate complexity
  let complexityScore = 0;
  if (largeMatchCount > 0) complexityScore += largeMatchCount * 25;
  if (hasMultiStep) complexityScore += 20;

  // Count file references
  const filePattern = /\b[\w\-/.]+\.(ts|tsx|js|jsx|py|go|java|cpp|c|h|rs|rb|php|swift|kt)\b/g;
  const fileMatches = text.match(filePattern) || [];
  const estimatedFiles = Math.max(1, fileMatches.length);
  complexityScore += estimatedFiles * 5;

  // Determine scale
  if (complexityScore >= 50 || largeMatchCount >= 2) {
    return {
      scale: 'large',
      confidence: 0.7,
      reason: `High complexity (score: ${complexityScore})`,
      metrics: { estimated_files: estimatedFiles, complexity_score: complexityScore },
    };
  }

  if (complexityScore >= 25 || hasMultiStep) {
    return {
      scale: 'medium',
      confidence: 0.7,
      reason: `Medium complexity (score: ${complexityScore})`,
      metrics: { estimated_files: estimatedFiles, complexity_score: complexityScore },
    };
  }

  if (estimatedFiles <= 1) {
    return {
      scale: 'trivial',
      confidence: 0.8,
      reason: 'Single file scope',
      metrics: { estimated_files: estimatedFiles, complexity_score: complexityScore },
    };
  }

  return {
    scale: 'small',
    confidence: 0.75,
    reason: `Low complexity (score: ${complexityScore})`,
    metrics: { estimated_files: estimatedFiles, complexity_score: complexityScore },
  };
}

// ============================================================================
// SLASH OVERRIDE DETECTION
// ============================================================================

/**
 * Slash override commands
 */
export type SlashOverride = 'scaffold' | 'plan' | 'run' | 'answer' | null;

/**
 * Detect slash override from user text
 * 
 * @param text - User's input prompt
 * @returns SlashOverride or null if none
 */
export function detectSlashOverride(text: string): SlashOverride {
  const trimmed = text.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();

  if (firstWord === '/scaffold' || firstWord === 'scaffold') {
    return 'scaffold';
  }
  if (firstWord === '/plan' || firstWord === 'plan') {
    return 'plan';
  }
  if (firstWord === '/run' || firstWord === '/do') {
    return 'run';
  }
  if (firstWord === '/answer' || firstWord === '/chat' || firstWord === '/ask') {
    return 'answer';
  }

  return null;
}
