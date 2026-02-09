/**
 * Step 34.5: User Command Intent Detection
 * Step 35.8: Updated to prevent false positives on greenfield requests
 * 
 * Detects when user wants to execute terminal commands like:
 * - "run the tests"
 * - "start dev server"
 * - "build the project"
 * - "npm install"
 * 
 * CRITICAL: Must NOT trigger on greenfield/scaffold requests!
 * 
 * This is used by QUICK_ACTION behavior to route to command execution.
 */

import { detectGreenfieldIntent } from './intent/greenfieldDetector';

/**
 * Command intent detection result
 */
export interface CommandIntentResult {
  /**
   * Whether the prompt indicates command execution intent
   */
  isCommandIntent: boolean;

  /**
   * Confidence level (0-1)
   */
  confidence: number;

  /**
   * Detected command keywords
   */
  detectedKeywords: string[];

  /**
   * Inferred commands (if can be determined from prompt)
   */
  inferredCommands?: string[];

  /**
   * Reasoning for detection
   */
  reasoning: string;
}

/**
 * Command phrase patterns — specific verb+target combos that are unambiguously commands.
 * Checked BEFORE the greenfield check to prevent "new start dev server" misrouting.
 */
const COMMAND_PHRASE_PATTERNS: Array<{ pattern: RegExp; commands: string[]; desc: string }> = [
  { pattern: /\bstart\s+(the\s+)?(dev\b|server\b|development\b)/i, commands: ['npm run dev'], desc: 'start dev/server' },
  { pattern: /\bstop\s+(the\s+)?(dev\b|server\b|process\b)/i, commands: [], desc: 'stop server' },
  { pattern: /\brestart\s+(the\s+)?(dev\b|server\b)/i, commands: ['npm run dev'], desc: 'restart server' },
  { pattern: /\brun\s+(the\s+)?(dev\b|server\b|build\b|tests?\b)/i, commands: ['npm run dev'], desc: 'run dev/build/test' },
  { pattern: /\bopen\s+(the\s+)?(dev\b|server\b|browser\b)/i, commands: [], desc: 'open dev/browser' },
  { pattern: /\binstall\s+(the\s+)?(deps?\b|dependencies\b|packages?\b)/i, commands: ['npm install'], desc: 'install deps' },
];

/**
 * Command-related action verbs (explicit command execution)
 * Step 35.8: Removed ambiguous verbs, kept explicit command verbs
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
 * Command-related nouns/targets
 * Note: 'app' and 'application' were previously removed to prevent false positives on
 * greenfield requests, but now that explanation/diagnostic/command-phrase patterns run
 * BEFORE greenfield check, and greenfield check still runs before verb+target matching,
 * it's safe to include them again.
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
 * Direct command patterns (explicit npm/yarn/etc commands)
 */
const DIRECT_COMMAND_PATTERNS = [
  /\b(npm|pnpm|yarn)\s+(run\s+)?[\w-]+/gi,
  /\b(node|deno|bun)\s+[\w./]+/gi,
  /\b(cargo|go|python|mvn|gradle)\s+\w+/gi,
  /\b(tsc|eslint|prettier|jest|vitest)\b/gi,
];

/**
 * Patterns that suggest explanation/discussion rather than execution
 */
const EXPLANATION_PATTERNS = [
  /\b(what|why|how|explain|tell me|show me|understand|meaning|purpose)\b/i,
  /\b(difference|compare|versus|vs\.?)\b/i,
  /\?$/,  // Questions
];

/**
 * Diagnostic/error context patterns — user is describing problems, not requesting commands
 */
const DIAGNOSTIC_CONTEXT_PATTERNS = [
  /\b(getting|having|seeing|encountering|facing)\s+(build\s+)?(errors?|issues?|problems?|failures?|warnings?)\b/i,
  /\b(fix|resolve|debug|investigate|check|diagnose)\s+(the\s+)?(build\s+)?(errors?|issues?|problems?|failures?)\b/i,
  /\b(broken|failing|not\s+working|not\s+compiling|won'?t\s+build)\b/i,
  /\bbuild\s+(errors?|failures?|issues?|problems?|broken|failing)\b/i,
  /\b(typecheck|type\s+check|typescript|compilation)\s+(errors?|failures?|issues?)\b/i,
];

/**
 * Detect if user prompt indicates command execution intent
 * 
 * Step 35.8: Greenfield check happens FIRST - if greenfield confidence >= 0.65,
 * this is NOT a command intent.
 * 
 * @param prompt - User's input prompt
 * @param workspaceRoot - Workspace directory (for context)
 * @returns Command intent detection result
 */
export function detectCommandIntent(
  prompt: string,
  workspaceRoot?: string
): CommandIntentResult {
  const lowerPrompt = prompt.toLowerCase().trim();
  const detectedKeywords: string[] = [];

  // =========================================================================
  // STEP 0a: Check for explanation/discussion patterns FIRST (questions override everything)
  // =========================================================================
  for (const pattern of EXPLANATION_PATTERNS) {
    if (pattern.test(lowerPrompt)) {
      return {
        isCommandIntent: false,
        confidence: 0.9,
        detectedKeywords: [],
        reasoning: 'Prompt appears to be a question or request for explanation',
      };
    }
  }

  // =========================================================================
  // STEP 0b: Check for diagnostic/error context patterns
  // =========================================================================
  for (const pattern of DIAGNOSTIC_CONTEXT_PATTERNS) {
    if (pattern.test(lowerPrompt)) {
      return {
        isCommandIntent: false,
        confidence: 0.9,
        detectedKeywords: [],
        reasoning: 'Diagnostic/error context detected — user is describing problems, not requesting command execution',
      };
    }
  }

  // =========================================================================
  // STEP 0c: Check command phrase patterns — these are unambiguous commands
  // that bypass greenfield check entirely (fixes "new start dev server")
  // =========================================================================
  for (const { pattern, commands, desc } of COMMAND_PHRASE_PATTERNS) {
    if (pattern.test(lowerPrompt)) {
      return {
        isCommandIntent: true,
        confidence: 0.90,
        detectedKeywords: [desc],
        inferredCommands: commands.length > 0 ? commands : undefined,
        reasoning: `Command phrase pattern matched: ${desc}`,
      };
    }
  }

  // =========================================================================
  // STEP 35.8: Check greenfield FIRST - greenfield requests are NOT commands
  // =========================================================================
  const greenfieldResult = detectGreenfieldIntent(prompt);
  if (greenfieldResult.isMatch && greenfieldResult.confidence >= 0.65) {
    console.log('[userCommandDetector] Greenfield detected with confidence', greenfieldResult.confidence, '- NOT a command');
    return {
      isCommandIntent: false,
      confidence: 0.1,
      detectedKeywords: [],
      reasoning: `Greenfield project request detected (${greenfieldResult.reason}) - not a command`,
    };
  }

  // (Explanation and diagnostic checks already done in STEP 0a/0b above)

  // Check for direct command patterns (highest confidence)
  const directCommands: string[] = [];
  for (const pattern of DIRECT_COMMAND_PATTERNS) {
    const matches = prompt.match(pattern);
    if (matches) {
      directCommands.push(...matches);
      detectedKeywords.push(...matches);
    }
  }

  if (directCommands.length > 0) {
    return {
      isCommandIntent: true,
      confidence: 0.95,
      detectedKeywords,
      inferredCommands: directCommands,
      reasoning: `Detected explicit command(s): ${directCommands.join(', ')}`,
    };
  }

  // Check for verb + target patterns (medium-high confidence)
  const detectedVerbs: string[] = [];
  const detectedTargets: string[] = [];

  for (const verb of COMMAND_VERBS) {
    const verbPattern = new RegExp(`\\b${verb}\\b`, 'i');
    if (verbPattern.test(lowerPrompt)) {
      detectedVerbs.push(verb);
      detectedKeywords.push(verb);
    }
  }

  for (const target of COMMAND_TARGETS) {
    const targetPattern = new RegExp(`\\b${target}s?\\b`, 'i');
    if (targetPattern.test(lowerPrompt)) {
      detectedTargets.push(target);
      detectedKeywords.push(target);
    }
  }

  // Strong signal: verb + target (e.g., "run tests", "start server")
  if (detectedVerbs.length > 0 && detectedTargets.length > 0) {
    const inferredCommands: string[] = [];

    // Try to infer specific commands
    if (detectedTargets.includes('test')) {
      inferredCommands.push('npm test', 'npm run test');
    }
    if (detectedTargets.includes('dev') || detectedTargets.includes('server')) {
      inferredCommands.push('npm run dev', 'npm start');
    }
    if (detectedTargets.includes('build')) {
      inferredCommands.push('npm run build');
    }

    return {
      isCommandIntent: true,
      confidence: 0.85,
      detectedKeywords,
      inferredCommands: inferredCommands.length > 0 ? inferredCommands : undefined,
      reasoning: `Detected action verb(s) [${detectedVerbs.join(', ')}] + target(s) [${detectedTargets.join(', ')}]`,
    };
  }

  // Target only without verb → ambiguous, NOT a command
  // "build errors" has a target but no command verb — this is diagnostic, not an action
  if (detectedTargets.length > 0 && detectedVerbs.length === 0) {
    return {
      isCommandIntent: false,
      confidence: 0.3,
      detectedKeywords,
      reasoning: `Target(s) [${detectedTargets.join(', ')}] without action verb — ambiguous, not a command`,
    };
  }

  // Verb only without target → weak command signal
  if (detectedVerbs.length > 0 && detectedTargets.length === 0) {
    return {
      isCommandIntent: true,
      confidence: 0.5,
      detectedKeywords,
      reasoning: `Action verb(s) [${detectedVerbs.join(', ')}] without specific target — weak command signal`,
    };
  }

  // No command intent detected
  return {
    isCommandIntent: false,
    confidence: 0.1,
    detectedKeywords: [],
    reasoning: 'No command-related keywords detected',
  };
}

/**
 * Check if a specific command pattern matches the prompt
 * 
 * @param prompt - User's input prompt
 * @param pattern - Pattern to check (e.g., "run tests", "start dev")
 * @returns true if pattern matches
 */
export function matchesCommandPattern(prompt: string, pattern: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  const lowerPattern = pattern.toLowerCase();
  
  // Simple word-boundary matching
  const words = lowerPattern.split(/\s+/);
  return words.every(word => {
    const wordPattern = new RegExp(`\\b${word}\\b`, 'i');
    return wordPattern.test(lowerPrompt);
  });
}
