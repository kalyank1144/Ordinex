/**
 * Step 34.5: User Command Intent Detection
 * 
 * Detects when user wants to execute terminal commands like:
 * - "run the tests"
 * - "start dev server"
 * - "build the project"
 * - "npm install"
 * 
 * This is used by QUICK_ACTION behavior to route to command execution.
 */

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
 * Command-related action verbs
 */
const COMMAND_VERBS = [
  'run',
  'execute',
  'start',
  'launch',
  'build',
  'test',
  'deploy',
  'install',
  'compile',
  'bundle',
  'serve',
  'watch',
];

/**
 * Command-related nouns/targets
 */
const COMMAND_TARGETS = [
  'tests',
  'test',
  'server',
  'dev',
  'development',
  'build',
  'project',
  'app',
  'application',
  'script',
  'command',
  'task',
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
 * Detect if user prompt indicates command execution intent
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

  // Check for explanation/discussion patterns first (these override command intent)
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

  // Weak signal: only verb or only target
  if (detectedVerbs.length > 0 || detectedTargets.length > 0) {
    return {
      isCommandIntent: true,
      confidence: 0.6,
      detectedKeywords,
      reasoning: detectedVerbs.length > 0
        ? `Detected action verb(s): ${detectedVerbs.join(', ')}`
        : `Detected target(s): ${detectedTargets.join(', ')}`,
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
