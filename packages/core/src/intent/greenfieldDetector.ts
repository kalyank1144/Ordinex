/**
 * Step 35.8: Greenfield Intent Detector (Single Source of Truth)
 * 
 * Detects when user wants to create a NEW project from scratch.
 * This is the ONLY greenfield detection source - all other code should use this.
 * 
 * Patterns detected:
 * - "Creating a new fitness app"
 * - "Build a dashboard from scratch"
 * - "Scaffold a React project"
 * - "Start fresh with Next.js"
 * - "I want to make a workout tracker"
 */

/**
 * Intent signal result from detection
 */
export interface IntentSignal {
  /** Whether greenfield intent was detected */
  isMatch: boolean;
  /** Confidence level (0.0 - 1.0) */
  confidence: number;
  /** Human-readable reason for the detection */
  reason: string;
  /** Keywords that matched (for debugging) */
  matchedKeywords?: string[];
}

// ============================================================================
// STRONG PATTERNS (confidence ~0.9)
// ============================================================================

/**
 * Strong regex patterns that clearly indicate greenfield projects.
 * These are explicit, unambiguous signals.
 * 
 * CRITICAL: Patterns must handle verb conjugations (creating, building, etc.)
 */
const STRONG_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Explicit creation verbs (all conjugations: create/created/creating/creates)
  // followed by project/app nouns
  {
    pattern: /\b(creat(?:e|ed|es|ing)|build(?:s|ing)?|built|mak(?:e|es|ing)|made|start(?:s|ed|ing)?|scaffold(?:s|ed|ing)?|setup|sett?ing\s+up|spinn?ing\s+up|initializ(?:e|ed|es|ing)|init)\b.*\b(app|application|project|site|website|dashboard|webapp|web\s+app)\b/i,
    description: 'creation verb + project noun',
  },
  // "I want/need to [verb] a [noun]" — very common phrasing
  {
    pattern: /\b(want|need|like|going)\s+to\s+(create|build|make|start|scaffold|setup|initialize)\b.*\b(app|application|project|site|website|dashboard|webapp|web\s+app)\b/i,
    description: 'want/need to + creation verb + noun',
  },
  // Reversed: project noun followed by creation verb
  {
    pattern: /\b(new|fresh|blank)\b.*\b(app|application|project|site|website|dashboard|webapp|web\s+app)\b/i,
    description: 'new/fresh/blank + project noun',
  },
  // Explicit greenfield/scratch phrases
  {
    pattern: /\b(from\s+scratch|greenfield|starter\s+template|boilerplate)\b/i,
    description: 'explicit greenfield phrase',
  },
  // Framework scaffolding
  {
    pattern: /\b(scaffold|bootstrap|init|initialize)\b.*\b(react|vue|angular|next|nextjs|next\.js|vite|expo|express|node|typescript|ts)\b/i,
    description: 'scaffold/init + framework',
  },
  // Framework + new/fresh
  {
    pattern: /\b(new|fresh|start)\b.*\b(react|vue|angular|next|nextjs|next\.js|vite|expo|express)\b.*\b(app|project|application)?\b/i,
    description: 'new + framework',
  },
  // Specific app type patterns (all verb conjugations)
  {
    pattern: /\b(new|creat(?:e|ed|es|ing)|build(?:s|ing)?|built|mak(?:e|es|ing)|made)\b.*\b(fitness|todo|to-do|workout|tracker|ecommerce|e-commerce|blog|chat|social|mobile|web)\b.*\b(app|application|project|page|site)?\b/i,
    description: 'creation verb + app type',
  },
];

// ============================================================================
// WEAK SIGNAL KEYWORDS (confidence ~0.65-0.75 when combined)
// ============================================================================

/**
 * Individual keywords that, when combined, suggest greenfield intent.
 * Require at least 2 matches for positive signal.
 */
const WEAK_SIGNAL_KEYWORDS = {
  /** Creation verbs (weak signal alone) */
  verbs: ['create', 'build', 'make', 'start', 'scaffold', 'setup', 'init', 'initialize', 'spin', 'bootstrap'],
  /** Target nouns (weak signal alone) */
  nouns: ['app', 'application', 'project', 'website', 'site', 'dashboard', 'webapp'],
  /** Newness indicators */
  newness: ['new', 'fresh', 'blank', 'scratch', 'greenfield', 'starter', 'template'],
  /** Framework names */
  frameworks: ['react', 'vue', 'angular', 'next', 'nextjs', 'vite', 'expo', 'express', 'node', 'typescript'],
};

// ============================================================================
// EXCLUSION PATTERNS (prevent false positives)
// ============================================================================

/**
 * Patterns that indicate the user is NOT asking for a greenfield project.
 * These override greenfield detection.
 */
const EXCLUSION_PATTERNS: RegExp[] = [
  // Running commands
  /\b(run|execute|start|launch)\s+(the\s+)?(dev|server|tests?|build|app|application)\b/i,
  // Fixing/modifying existing code
  /\b(fix|debug|repair|update|modify|change|edit|refactor)\b.*\b(the|this|my|our|it|them|that|those|errors?|bugs?|issues?)\b/i,
  // Adding to existing
  /\b(add|implement)\b.*\b(to|in|into)\s+(the|this|my|our)\b/i,
  // Questions about existing
  /\b(why|what|how|where|when)\b.*\b(is|does|did|was|were)\b/i,
  // Explicit "run the app" or "start the server"
  /\b(run|start)\s+the\s+(app|application|server|project)\b/i,
  // "the existing" or "my existing"
  /\b(the|my|our|this)\s+(existing|current)\b/i,
  // References to existing scaffolded projects (never greenfield)
  /\bscaffolded?\s+(project|app|application)\b/i,
];

// ============================================================================
// MAIN DETECTION FUNCTION
// ============================================================================

/**
 * Detect if user prompt indicates greenfield project intent.
 * 
 * This is the SINGLE SOURCE OF TRUTH for greenfield detection.
 * All other greenfield checks in the codebase should use this function.
 * 
 * @param text - User's input prompt
 * @returns IntentSignal with isMatch, confidence, and reason
 */
export function detectGreenfieldIntent(text: string): IntentSignal {
  const normalized = text.toLowerCase().trim();
  const matchedKeywords: string[] = [];

  // =========================================================================
  // STEP 1: Check exclusion patterns first (quick rejection)
  // =========================================================================
  for (const exclusion of EXCLUSION_PATTERNS) {
    if (exclusion.test(normalized)) {
      return {
        isMatch: false,
        confidence: 0.1,
        reason: 'Exclusion pattern matched - not a greenfield request',
        matchedKeywords: [],
      };
    }
  }

  // =========================================================================
  // STEP 2: Check strong patterns (high confidence ~0.9)
  // =========================================================================
  for (const { pattern, description } of STRONG_PATTERNS) {
    if (pattern.test(normalized)) {
      // Extract matched portion for debugging
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

  // =========================================================================
  // STEP 3: Count weak signal keywords
  // =========================================================================
  let weakSignalCount = 0;
  const weakMatches: string[] = [];

  // Check verbs — handle conjugation properly for e-final verbs
  // "create" → created/creating/creates (stem "creat" + ed/ing, or "create" + s)
  for (const verb of WEAK_SIGNAL_KEYWORDS.verbs) {
    let verbPattern: RegExp;
    if (verb.endsWith('e')) {
      const stem = verb.slice(0, -1);
      verbPattern = new RegExp(`\\b${stem}(?:e|ed|es|ing)\\b`, 'i');
    } else {
      verbPattern = new RegExp(`\\b${verb}(?:ing|e|ed|s)?\\b`, 'i');
    }
    if (verbPattern.test(normalized)) {
      weakSignalCount++;
      weakMatches.push(verb);
    }
  }

  // Check nouns
  for (const noun of WEAK_SIGNAL_KEYWORDS.nouns) {
    const nounPattern = new RegExp(`\\b${noun}(s)?\\b`, 'i');
    if (nounPattern.test(normalized)) {
      weakSignalCount++;
      weakMatches.push(noun);
    }
  }

  // Check newness indicators
  for (const newWord of WEAK_SIGNAL_KEYWORDS.newness) {
    const newPattern = new RegExp(`\\b${newWord}\\b`, 'i');
    if (newPattern.test(normalized)) {
      weakSignalCount++;
      weakMatches.push(newWord);
    }
  }

  // Check frameworks
  for (const framework of WEAK_SIGNAL_KEYWORDS.frameworks) {
    const fwPattern = new RegExp(`\\b${framework}(\\.js)?\\b`, 'i');
    if (fwPattern.test(normalized)) {
      weakSignalCount++;
      weakMatches.push(framework);
    }
  }

  // =========================================================================
  // STEP 4: Evaluate weak signals
  // =========================================================================
  
  // Strong combination: 3+ keywords including at least one from newness/verbs
  const hasNewness = WEAK_SIGNAL_KEYWORDS.newness.some(w => 
    new RegExp(`\\b${w}\\b`, 'i').test(normalized)
  );
  // Only creation-specific verbs can satisfy the verb gate (not "run", "start", etc.)
  const CREATION_VERBS = ['create', 'build', 'make', 'scaffold', 'setup', 'init', 'initialize', 'spin', 'bootstrap'];
  const hasCreationVerb = CREATION_VERBS.some(v => {
    if (v.endsWith('e')) {
      const stem = v.slice(0, -1);
      return new RegExp(`\\b${stem}(?:e|ed|es|ing)\\b`, 'i').test(normalized);
    }
    return new RegExp(`\\b${v}(?:ing|e|ed|s)?\\b`, 'i').test(normalized);
  });

  if (weakSignalCount >= 3 && (hasNewness || hasCreationVerb)) {
    return {
      isMatch: true,
      confidence: 0.75,
      reason: `Multiple greenfield keywords detected (${weakSignalCount} matches)`,
      matchedKeywords: weakMatches,
    };
  }

  // Medium combination: 2 keywords including newness indicator
  if (weakSignalCount >= 2 && hasNewness) {
    return {
      isMatch: true,
      confidence: 0.65,
      reason: `Greenfield keywords with newness indicator (${weakSignalCount} matches)`,
      matchedKeywords: weakMatches,
    };
  }

  // Weak combination: 2 keywords
  if (weakSignalCount >= 2) {
    return {
      isMatch: true,
      confidence: 0.5,
      reason: `Some greenfield keywords detected (${weakSignalCount} matches) - ambiguous`,
      matchedKeywords: weakMatches,
    };
  }

  // =========================================================================
  // STEP 5: No greenfield intent detected
  // =========================================================================
  return {
    isMatch: false,
    confidence: 0.1,
    reason: weakSignalCount > 0 
      ? `Insufficient greenfield signals (only ${weakSignalCount} keyword)`
      : 'No greenfield keywords detected',
    matchedKeywords: weakMatches,
  };
}

/**
 * Check if a prompt definitely requires scaffold flow (high confidence shortcut).
 * 
 * Use this for quick checks before running full intent analysis.
 * 
 * @param text - User's input prompt
 * @returns true if confidence >= 0.85
 */
export function isDefinitelyGreenfield(text: string): boolean {
  const result = detectGreenfieldIntent(text);
  return result.isMatch && result.confidence >= 0.85;
}

/**
 * Check if greenfield detection is ambiguous and needs LLM classification.
 * 
 * @param text - User's input prompt
 * @returns true if 0.3 < confidence < 0.85
 */
export function isAmbiguousGreenfield(text: string): boolean {
  const result = detectGreenfieldIntent(text);
  return result.isMatch && result.confidence > 0.3 && result.confidence < 0.85;
}
