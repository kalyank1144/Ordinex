/**
 * Error Patterns - Step 49: Error Recovery UX
 *
 * Human-readable error pattern library providing friendly titles, messages,
 * and suggested recovery commands. This is a UX POLISH LAYER only.
 *
 * The PRIMARY source of truth for error classification is failureClassifier.ts
 * (ErrorDescriptor, SuggestedAction, retryable, category). This module
 * provides supplementary human-friendly hints and command suggestions.
 *
 * Merge function: mergeRecoveryActions() combines classifier-derived actions
 * (primary) with pattern-derived actions (supplementary), deduping by id.
 *
 * P1 compliant: pure functions, no FS imports.
 */

import type { ErrorDescriptor, SuggestedAction, ErrorCategory } from './failureClassifier';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Recovery action rendered as a button in the FailureCard.
 */
export interface RecoveryAction {
  /** Unique action id (used for dedup in merge) */
  id: string;
  /** Button label text */
  label: string;
  /** Action type determines extension handler routing */
  type: 'retry' | 'alternative' | 'checkpoint' | 'manual' | 'command';
  /** If type='command': the command to run. Must be in SAFE_RECOVERY_COMMANDS allowlist. */
  command?: string;
  /** Whether the button should be disabled (e.g. unsafe retry) */
  disabled?: boolean;
  /** Tooltip text (shown on hover, especially when disabled) */
  tooltip?: string;
}

/**
 * Result of matching an error string against known patterns.
 * Provides human-friendly UX polish on top of the classifier.
 */
export interface ErrorPatternMatch {
  /** Pattern id for traceability */
  pattern_id: string;
  /** Error category (mirrors classifier categories for consistency) */
  category: string;
  /** Human-friendly title (e.g. "Missing Module") */
  title: string;
  /** Human-friendly message with interpolated details */
  message: string;
  /** Actionable suggestion text */
  suggestion: string;
  /** Pattern-derived recovery actions (supplementary to classifier actions) */
  actions: RecoveryAction[];
}

/**
 * Internal pattern definition.
 */
interface ErrorPattern {
  id: string;
  regex: RegExp;
  category: string;
  priority: number;
  title: string;
  /** Message template. Supports {1}, {2} etc. for regex capture groups. */
  message_template: string;
  suggestion: string;
  actions: RecoveryAction[];
}

// ============================================================================
// SAFE RECOVERY COMMANDS ALLOWLIST (Concern #4)
// ============================================================================

/**
 * Commands that are allowed for automatic recovery without full approval.
 * Any command not in this set requires V9 mode check + user approval.
 */
export const SAFE_RECOVERY_COMMANDS: ReadonlySet<string> = new Set([
  'npm install',
  'npm ci',
  'npm run build',
  'npm test',
  'npm run lint',
  'npm run typecheck',
  'pnpm install',
  'pnpm run build',
  'pnpm test',
  'pnpm run lint',
  'pnpm run typecheck',
  'yarn install',
  'yarn build',
  'yarn test',
  'yarn lint',
  'npx tsc --noEmit',
  'npx eslint .',
]);

/**
 * Check if a command is in the safe recovery allowlist.
 */
export function isSafeRecoveryCommand(command: string): boolean {
  return SAFE_RECOVERY_COMMANDS.has(command.trim());
}

// ============================================================================
// PATTERN REGISTRY (30+ patterns)
// ============================================================================

const ERROR_PATTERNS: ErrorPattern[] = [
  // ---- Module Resolution (6) ----
  {
    id: 'module_not_found',
    regex: /Cannot find module ['"]([^'"]+)['"]/i,
    category: 'module_resolution',
    priority: 90,
    title: 'Missing Module',
    message_template: "The module '{1}' could not be found.",
    suggestion: 'Run npm install or check the import path.',
    actions: [
      { id: 'run_npm_install', label: 'Run npm install', type: 'command', command: 'npm install' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'module_not_found_generic',
    regex: /Module not found:?\s*(.*)/i,
    category: 'module_resolution',
    priority: 85,
    title: 'Module Not Found',
    message_template: 'A required module could not be resolved: {1}',
    suggestion: 'Check the import path or install the missing dependency.',
    actions: [
      { id: 'run_npm_install', label: 'Run npm install', type: 'command', command: 'npm install' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'ts2307_module',
    regex: /TS2307:?\s*Cannot find module ['"]([^'"]+)['"]/i,
    category: 'module_resolution',
    priority: 92,
    title: 'TypeScript Module Not Found',
    message_template: "TypeScript cannot resolve module '{1}'.",
    suggestion: 'Check tsconfig paths, install the package, or add type declarations.',
    actions: [
      { id: 'run_npm_install', label: 'Run npm install', type: 'command', command: 'npm install' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'err_module_not_found',
    regex: /ERR_MODULE_NOT_FOUND.*['"]([^'"]*)['"]/i,
    category: 'module_resolution',
    priority: 87,
    title: 'ES Module Not Found',
    message_template: "ES module '{1}' could not be resolved.",
    suggestion: 'Check the file extension and module specifier.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'could_not_resolve',
    regex: /Could not resolve ['"]([^'"]+)['"]/i,
    category: 'module_resolution',
    priority: 84,
    title: 'Unresolved Import',
    message_template: "Could not resolve '{1}'.",
    suggestion: 'Install the missing dependency or fix the import path.',
    actions: [
      { id: 'run_npm_install', label: 'Run npm install', type: 'command', command: 'npm install' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'no_matching_export',
    regex: /has no exported member ['"]([^'"]+)['"]/i,
    category: 'module_resolution',
    priority: 83,
    title: 'Missing Export',
    message_template: "The exported member '{1}' does not exist in the module.",
    suggestion: 'Check the export name or update the import.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },

  // ---- TypeScript (5) ----
  {
    id: 'ts2322_type_mismatch',
    regex: /TS2322:?\s*Type ['"](.+?)['"] is not assignable to type ['"](.+?)['"]/i,
    category: 'typescript',
    priority: 80,
    title: 'Type Mismatch',
    message_template: "Type '{1}' is not assignable to type '{2}'.",
    suggestion: 'Check the variable type or add a type assertion.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'ts2339_property_missing',
    regex: /TS2339:?\s*Property ['"](\w+)['"] does not exist on type/i,
    category: 'typescript',
    priority: 79,
    title: 'Property Not Found',
    message_template: "Property '{1}' does not exist on the target type.",
    suggestion: 'Add the property to the type definition or use a type guard.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'ts2345_argument_type',
    regex: /TS2345:?\s*Argument of type ['"](.+?)['"] is not assignable/i,
    category: 'typescript',
    priority: 78,
    title: 'Argument Type Error',
    message_template: "Argument of type '{1}' is not assignable to the expected parameter type.",
    suggestion: 'Check the function signature and argument types.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'ts7006_implicit_any',
    regex: /TS7006:?\s*Parameter ['"](\w+)['"] implicitly has an ['"]any['"] type/i,
    category: 'typescript',
    priority: 75,
    title: 'Implicit Any',
    message_template: "Parameter '{1}' needs an explicit type annotation.",
    suggestion: 'Add a type annotation to the parameter.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'ts_syntax_error',
    regex: /TS1005:?\s*['"](.+?)['"] expected/i,
    category: 'typescript',
    priority: 77,
    title: 'Syntax Error',
    message_template: "Expected '{1}'.",
    suggestion: 'Check for missing brackets, semicolons, or other syntax.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },

  // ---- Runtime Errors (4) ----
  {
    id: 'type_error_not_function',
    regex: /TypeError:\s*(.+?)\s+is not a function/i,
    category: 'runtime',
    priority: 70,
    title: 'Not a Function',
    message_template: "'{1}' is not a function.",
    suggestion: 'Check the function name and that the correct module is imported.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'reference_error',
    regex: /ReferenceError:\s*(\w+) is not defined/i,
    category: 'runtime',
    priority: 69,
    title: 'Undefined Variable',
    message_template: "'{1}' is not defined.",
    suggestion: 'Check that the variable is imported or declared.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'syntax_error_runtime',
    regex: /SyntaxError:\s*(.*)/i,
    category: 'runtime',
    priority: 68,
    title: 'Syntax Error',
    message_template: 'Syntax error: {1}',
    suggestion: 'Check the code for typos or invalid syntax.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'range_error_stack',
    regex: /RangeError:\s*Maximum call stack size exceeded/i,
    category: 'runtime',
    priority: 67,
    title: 'Stack Overflow',
    message_template: 'Maximum call stack size exceeded (infinite recursion).',
    suggestion: 'Check for infinite recursion or circular references.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },

  // ---- Permissions / FS (4) ----
  {
    id: 'eacces',
    regex: /EACCES:?\s*permission denied,?\s*(.*)/i,
    category: 'permissions',
    priority: 60,
    title: 'Permission Denied',
    message_template: 'Permission denied: {1}',
    suggestion: 'Check file permissions or run with appropriate privileges.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'eperm',
    regex: /EPERM:?\s*operation not permitted/i,
    category: 'permissions',
    priority: 59,
    title: 'Operation Not Permitted',
    message_template: 'The operation is not permitted by the system.',
    suggestion: 'Check file ownership and permissions.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'enoent',
    regex: /ENOENT:?\s*no such file or directory,?\s*(?:open\s+)?['"]?([^'">\n]+)/i,
    category: 'filesystem',
    priority: 58,
    title: 'File Not Found',
    message_template: "File or directory not found: '{1}'.",
    suggestion: 'Check the file path or create the missing file.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'enospc',
    regex: /ENOSPC:?\s*no space left on device/i,
    category: 'filesystem',
    priority: 95,
    title: 'Disk Full',
    message_template: 'No space left on device.',
    suggestion: 'Free up disk space and try again.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },

  // ---- Network (4) ----
  {
    id: 'econnrefused',
    regex: /ECONNREFUSED\s*([\d.:]*)?/i,
    category: 'network',
    priority: 50,
    title: 'Connection Refused',
    message_template: 'Connection refused{1}.',
    suggestion: 'Check that the server is running and the address is correct.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
    ],
  },
  {
    id: 'econnreset',
    regex: /ECONNRESET/i,
    category: 'network',
    priority: 49,
    title: 'Connection Reset',
    message_template: 'The connection was reset by the remote server.',
    suggestion: 'This is usually transient. Try again.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
    ],
  },
  {
    id: 'etimedout',
    regex: /ETIMEDOUT/i,
    category: 'network',
    priority: 48,
    title: 'Connection Timed Out',
    message_template: 'The connection timed out.',
    suggestion: 'Check your network connection and try again.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
    ],
  },
  {
    id: 'rate_limit_429',
    regex: /429\s*(Too Many Requests)?|rate.?limit/i,
    category: 'network',
    priority: 55,
    title: 'Rate Limited',
    message_template: 'API rate limit reached.',
    suggestion: 'Wait a moment and try again. The system will auto-retry.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
    ],
  },

  // ---- Port / Process (3) ----
  {
    id: 'eaddrinuse',
    regex: /EADDRINUSE.*?(?:::)?(\d+)/i,
    category: 'process',
    priority: 56,
    title: 'Port In Use',
    message_template: 'Port {1} is already in use.',
    suggestion: 'Kill the existing process or use a different port.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'sigkill',
    regex: /SIGKILL|killed|signal\s+9/i,
    category: 'process',
    priority: 45,
    title: 'Process Killed',
    message_template: 'The process was killed (possibly out of memory).',
    suggestion: 'Check system resources. The process may have exceeded memory limits.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'command_not_found',
    regex: /command not found:?\s*(\S+)|(\S+):\s*not found/i,
    category: 'process',
    priority: 57,
    title: 'Command Not Found',
    message_template: "Command '{1}' not found.",
    suggestion: 'Install the missing tool or check the command name.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },

  // ---- Build (3) ----
  {
    id: 'compilation_failed',
    regex: /[Cc]ompilation\s+failed|[Ff]ailed\s+to\s+compile/i,
    category: 'build',
    priority: 72,
    title: 'Compilation Failed',
    message_template: 'The project failed to compile.',
    suggestion: 'Fix the reported errors and try building again.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'run_build', label: 'Run Build', type: 'command', command: 'npm run build' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'build_error',
    regex: /[Bb]uild\s+(?:error|failed)|error\s+during\s+build/i,
    category: 'build',
    priority: 71,
    title: 'Build Error',
    message_template: 'Build failed with errors.',
    suggestion: 'Check the build output for details.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'out_of_memory',
    regex: /out of memory|JavaScript heap|allocation failed|ENOMEM/i,
    category: 'build',
    priority: 93,
    title: 'Out of Memory',
    message_template: 'The process ran out of memory.',
    suggestion: 'Increase the Node.js heap size or reduce the workload.',
    actions: [
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },

  // ---- Test (3) ----
  {
    id: 'expect_assertion',
    regex: /[Ee]xpected\s+(.+?)\s+to\s+(be|equal|match|have|include)/i,
    category: 'test',
    priority: 65,
    title: 'Test Assertion Failed',
    message_template: 'Expected {1} to {2} the expected value.',
    suggestion: 'Review the test expectations or fix the implementation.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'assertion_failed',
    regex: /AssertionError:?\s*(.*)/i,
    category: 'test',
    priority: 64,
    title: 'Assertion Failed',
    message_template: 'Assertion failed: {1}',
    suggestion: 'Check the assertion and the actual value.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'run_test', label: 'Run Tests', type: 'command', command: 'npm test' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
  {
    id: 'test_suite_failed',
    regex: /Test suite failed to run|Tests?\s+failed/i,
    category: 'test',
    priority: 63,
    title: 'Test Suite Failed',
    message_template: 'The test suite failed to run.',
    suggestion: 'Check for configuration or import errors in the test files.',
    actions: [
      { id: 'retry', label: 'Try Again', type: 'retry' },
      { id: 'run_test', label: 'Run Tests', type: 'command', command: 'npm test' },
      { id: 'fix_manually', label: 'Fix Manually', type: 'manual' },
    ],
  },
];

// Sort patterns by priority descending (cached at module load)
const SORTED_PATTERNS = [...ERROR_PATTERNS].sort((a, b) => b.priority - a.priority);

// ============================================================================
// MATCH FUNCTION
// ============================================================================

/**
 * Match an error string against known patterns.
 * Returns the highest-priority match, or null if no pattern matches.
 *
 * This is a UX POLISH layer — the real classification comes from
 * failureClassifier.ts (classifyError / classifyFailure).
 */
export function matchErrorPattern(errorText: string): ErrorPatternMatch | null {
  if (!errorText || typeof errorText !== 'string') {
    return null;
  }

  for (const pattern of SORTED_PATTERNS) {
    const match = pattern.regex.exec(errorText);
    if (match) {
      // Interpolate capture groups into message template
      let message = pattern.message_template;
      for (let i = 1; i < match.length; i++) {
        const group = match[i] || '';
        // Truncate long capture groups
        const truncated = group.length > 100 ? group.substring(0, 100) + '...' : group;
        message = message.replace(`{${i}}`, truncated);
      }
      // Clean up any remaining {N} placeholders
      message = message.replace(/\{[0-9]+\}/g, '');

      return {
        pattern_id: pattern.id,
        category: pattern.category,
        title: pattern.title,
        message,
        suggestion: pattern.suggestion,
        actions: pattern.actions,
      };
    }
  }

  return null;
}

// ============================================================================
// BRIDGE: ErrorDescriptor → RecoveryAction[] (Concern #1: classifier is truth)
// ============================================================================

/**
 * Map classifier output (ErrorDescriptor) to RecoveryAction[].
 * This is the PRIMARY action source — the classifier decides what's safe.
 *
 * Concern #3: Only enable "Try Again" when descriptor.retryable === true.
 * If not retryable, the retry button is disabled with a tooltip.
 */
export function errorDescriptorToRecoveryActions(
  descriptor: ErrorDescriptor
): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  // Map suggested_action to concrete buttons
  switch (descriptor.suggested_action) {
    case 'RETRY_SAME':
      actions.push({
        id: 'retry',
        label: 'Try Again',
        type: 'retry',
        disabled: !descriptor.retryable,
        tooltip: descriptor.retryable ? undefined : 'Not safe to retry after side effects',
      });
      break;

    case 'RETRY_SPLIT':
      actions.push({
        id: 'retry_split',
        label: 'Try Again (Split)',
        type: 'retry',
        disabled: !descriptor.retryable,
        tooltip: descriptor.retryable ? 'Retry with file-by-file splitting' : 'Not safe to retry after side effects',
      });
      break;

    case 'REGENERATE_PATCH':
      actions.push({
        id: 'alternative',
        label: 'Try Different Approach',
        type: 'alternative',
      });
      break;

    case 'ASK_USER':
      actions.push({
        id: 'fix_manually',
        label: 'Fix Manually',
        type: 'manual',
      });
      break;

    case 'PAUSE':
      actions.push({
        id: 'restore_checkpoint',
        label: 'Restore Checkpoint',
        type: 'checkpoint',
      });
      actions.push({
        id: 'fix_manually',
        label: 'Fix Manually',
        type: 'manual',
      });
      break;

    case 'ABORT':
      actions.push({
        id: 'restore_checkpoint',
        label: 'Restore Checkpoint',
        type: 'checkpoint',
      });
      break;
  }

  return actions;
}

// ============================================================================
// MERGE: Combine classifier + pattern actions (Concern #1: dedup by id)
// ============================================================================

/**
 * Merge recovery actions from classifier (primary) and pattern match (supplementary).
 * Classifier actions come first. Duplicates (by id) are removed — classifier wins.
 */
export function mergeRecoveryActions(
  classifierActions: RecoveryAction[],
  patternActions: RecoveryAction[]
): RecoveryAction[] {
  const seen = new Set<string>();
  const merged: RecoveryAction[] = [];

  // Classifier actions first (primary)
  for (const action of classifierActions) {
    if (!seen.has(action.id)) {
      seen.add(action.id);
      merged.push(action);
    }
  }

  // Pattern actions second (supplementary, e.g. "Run npm install")
  for (const action of patternActions) {
    if (!seen.has(action.id)) {
      seen.add(action.id);
      merged.push(action);
    }
  }

  return merged;
}
