/**
 * Failure Classifier - Step 28 Self-Correction Loop + Step 32 Universal Error Taxonomy
 * 
 * Classifies test/build/lint failures into normalized categories
 * and generates stable signatures for loop detection.
 * 
 * STEP 32 EXTENSION: Universal error taxonomy for ALL executors
 * - ErrorCategory: Unified categories across PLAN/MISSION/EDIT/TOOL/APPLY/VERIFY
 * - ErrorDescriptor: Rich error structure with actionable info
 * - classifyError: Universal classifier for any error type
 * 
 * NON-NEGOTIABLE RULES:
 * - Normalization MUST strip volatile data (timestamps, PIDs, memory addresses)
 * - Signatures MUST be stable for identical logical failures
 * - Classification MUST be deterministic (no LLM calls)
 */

import * as crypto from 'crypto';
import * as path from 'path';

// ============================================================================
// UNIVERSAL ERROR TAXONOMY (Step 32)
// ============================================================================

/**
 * Universal error category - used across ALL executors
 * Maps any error to a broad category for recovery policy decisions
 */
export type ErrorCategory =
  | 'USER_INPUT'           // Missing info, bad prompt, invalid request
  | 'WORKSPACE_STATE'      // File not found, dir missing, permission denied
  | 'LLM_TRUNCATION'       // Output cut off by max_tokens
  | 'LLM_OUTPUT_INVALID'   // Bad JSON, missing fields, schema violation
  | 'TOOL_FAILURE'         // Command failed, tool crashed
  | 'APPLY_CONFLICT'       // Patch can't apply (stale context, hunk mismatch)
  | 'VERIFY_FAILURE'       // Tests failed after apply
  | 'NETWORK_TRANSIENT'    // 529 overloaded, timeout, connection reset
  | 'RATE_LIMIT'           // 429 too many requests
  | 'PERMISSION'           // EACCES, EPERM, forbidden
  | 'INTERNAL_BUG';        // Unexpected exception, should never happen

/**
 * Suggested action for error recovery
 * Recovery ladder: RETRY_SAME → RETRY_SPLIT → REGENERATE_PATCH → ASK_USER → PAUSE → ABORT
 */
export type SuggestedAction =
  | 'RETRY_SAME'           // Safe to retry as-is (transient, no side effect)
  | 'RETRY_SPLIT'          // Split by file and retry (truncation)
  | 'REGENERATE_PATCH'     // Get new patch with fresh context (stale)
  | 'ASK_USER'             // Need user input (missing info)
  | 'PAUSE'                // Pause with decision point
  | 'ABORT';               // Fatal, stop execution

/**
 * Stable error codes - programmatic identifiers
 * Use these for deterministic UI rendering and event payload
 */
export type ErrorCode =
  // Workspace/File errors
  | 'FILE_NOT_FOUND'
  | 'DIR_MISSING'
  | 'WORKSPACE_MISMATCH'
  | 'PERMISSION_DENIED'
  | 'PATH_TRAVERSAL'
  // Apply/Patch errors
  | 'PATCH_APPLY_FAILED'
  | 'STALE_CONTEXT'
  | 'HUNK_MISMATCH'
  | 'INVALID_DIFF'
  | 'EMPTY_DIFF'
  // LLM errors
  | 'OUTPUT_TRUNCATED'
  | 'JSON_PARSE_FAILED'
  | 'SCHEMA_INVALID'
  | 'MISSING_SENTINEL'
  // Network/API errors
  | 'RATE_LIMITED'
  | 'API_OVERLOADED'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_RESET'
  // Tool errors
  | 'TOOL_TIMEOUT'
  | 'TOOL_CRASHED'
  | 'TOOL_NOT_FOUND'
  | 'COMMAND_FAILED'
  // Verification errors
  | 'TEST_FAILED'
  | 'LINT_FAILED'
  | 'TYPECHECK_FAILED'
  | 'BUILD_FAILED'
  // Generic
  | 'UNKNOWN_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Universal error descriptor - rich error structure for all executors
 * 
 * CRITICAL: This is the single source of truth for error information.
 * All executors MUST use this when emitting failure events.
 */
export interface ErrorDescriptor {
  /** Broad category for recovery policy */
  category: ErrorCategory;
  
  /** Whether error is likely to succeed on retry without user changes */
  retryable: boolean;
  
  /** Suggested recovery action */
  suggested_action: SuggestedAction;
  
  /** Short, actionable message for UI (no technical jargon) */
  user_message: string;
  
  /** Stable code for programmatic handling */
  code: ErrorCode;
  
  /** Developer details (for Logs tab, not Mission feed) */
  developer_details: {
    raw_error?: string;
    stack_preview?: string;
    context?: Record<string, unknown>;
  };
}

/**
 * Context for error classification
 */
export interface ErrorClassificationContext {
  /** Execution stage where error occurred */
  stage: 'preflight' | 'tool' | 'diff_gen' | 'apply' | 'verify' | 'unknown';
  
  /** Whether a tool has already executed with side effects */
  toolHadSideEffect?: boolean;
  
  /** Affected file path if known */
  file?: string;
  
  /** Additional context */
  extra?: Record<string, unknown>;
}

/**
 * Universal error classifier - classifies ANY error into ErrorDescriptor
 * 
 * RULES:
 * - NEVER retry after tool side effect (unless tool is idempotent)
 * - NETWORK_TRANSIENT and RATE_LIMIT are retryable (with backoff)
 * - LLM_TRUNCATION suggests RETRY_SPLIT
 * - APPLY_CONFLICT suggests REGENERATE_PATCH (bounded)
 * - WORKSPACE_STATE needs user decision
 */
export function classifyError(
  error: unknown,
  context: ErrorClassificationContext
): ErrorDescriptor {
  const rawError = error instanceof Error 
    ? error.message 
    : String(error);
  
  const stackPreview = error instanceof Error && error.stack
    ? error.stack.substring(0, 500)
    : undefined;

  // Default values
  let category: ErrorCategory = 'INTERNAL_BUG';
  let code: ErrorCode = 'UNKNOWN_ERROR';
  let retryable = false;
  let suggested_action: SuggestedAction = 'PAUSE';
  let user_message = 'An unexpected error occurred';

  // ============================================================================
  // CLASSIFICATION RULES (ordered by specificity)
  // ============================================================================

  // 1. Check for network/API errors
  if (isNetworkError(rawError)) {
    if (isRateLimitError(rawError)) {
      category = 'RATE_LIMIT';
      code = 'RATE_LIMITED';
      retryable = !context.toolHadSideEffect;
      suggested_action = retryable ? 'RETRY_SAME' : 'PAUSE';
      user_message = 'API rate limit reached. Waiting to retry...';
    } else if (isOverloadedError(rawError)) {
      category = 'NETWORK_TRANSIENT';
      code = 'API_OVERLOADED';
      retryable = !context.toolHadSideEffect;
      suggested_action = retryable ? 'RETRY_SAME' : 'PAUSE';
      user_message = 'API temporarily overloaded. Waiting to retry...';
    } else if (isTimeoutError(rawError)) {
      category = 'NETWORK_TRANSIENT';
      code = 'CONNECTION_TIMEOUT';
      retryable = !context.toolHadSideEffect;
      suggested_action = retryable ? 'RETRY_SAME' : 'PAUSE';
      user_message = 'Connection timed out. Will retry...';
    } else {
      category = 'NETWORK_TRANSIENT';
      code = 'CONNECTION_RESET';
      retryable = !context.toolHadSideEffect;
      suggested_action = retryable ? 'RETRY_SAME' : 'PAUSE';
      user_message = 'Network error. Will retry...';
    }
  }
  // 2. Check for LLM output errors
  else if (isTruncationError(rawError)) {
    category = 'LLM_TRUNCATION';
    code = 'OUTPUT_TRUNCATED';
    retryable = true;
    suggested_action = 'RETRY_SPLIT';
    user_message = 'Output was truncated. Splitting into smaller parts...';
  }
  else if (isJsonParseError(rawError)) {
    category = 'LLM_OUTPUT_INVALID';
    code = 'JSON_PARSE_FAILED';
    retryable = true;
    suggested_action = 'RETRY_SAME';
    user_message = 'Invalid response format. Retrying...';
  }
  else if (isSchemaMissingError(rawError)) {
    category = 'LLM_OUTPUT_INVALID';
    code = 'SCHEMA_INVALID';
    retryable = true;
    suggested_action = 'RETRY_SAME';
    user_message = 'Response missing required fields. Retrying...';
  }
  // 3. Check for workspace/file errors
  else if (isFileNotFoundError(rawError)) {
    category = 'WORKSPACE_STATE';
    code = 'FILE_NOT_FOUND';
    retryable = false;
    suggested_action = 'ASK_USER';
    user_message = context.file 
      ? `File not found: ${context.file}`
      : 'Required file not found';
  }
  else if (isDirMissingError(rawError)) {
    category = 'WORKSPACE_STATE';
    code = 'DIR_MISSING';
    retryable = false;
    suggested_action = 'ASK_USER';
    user_message = 'Required directory does not exist';
  }
  else if (isPermissionError(rawError)) {
    category = 'PERMISSION';
    code = 'PERMISSION_DENIED';
    retryable = false;
    suggested_action = 'PAUSE';
    user_message = context.file 
      ? `Permission denied: ${context.file}`
      : 'Permission denied';
  }
  else if (isPathTraversalError(rawError)) {
    category = 'WORKSPACE_STATE';
    code = 'PATH_TRAVERSAL';
    retryable = false;
    suggested_action = 'ABORT';
    user_message = 'Security violation: path traversal detected';
  }
  // 4. Check for apply/patch errors
  else if (isStaleContextError(rawError)) {
    category = 'APPLY_CONFLICT';
    code = 'STALE_CONTEXT';
    retryable = true;
    suggested_action = 'REGENERATE_PATCH';
    user_message = context.file 
      ? `File changed since edit was proposed: ${context.file}`
      : 'File changed since edit was proposed';
  }
  else if (isHunkMismatchError(rawError)) {
    category = 'APPLY_CONFLICT';
    code = 'HUNK_MISMATCH';
    retryable = true;
    suggested_action = 'REGENERATE_PATCH';
    user_message = 'Patch could not be applied. Regenerating...';
  }
  else if (isPatchApplyError(rawError)) {
    category = 'APPLY_CONFLICT';
    code = 'PATCH_APPLY_FAILED';
    retryable = true;
    suggested_action = 'REGENERATE_PATCH';
    user_message = 'Failed to apply changes';
  }
  // 5. Check for tool errors
  else if (isToolTimeoutError(rawError)) {
    category = 'TOOL_FAILURE';
    code = 'TOOL_TIMEOUT';
    retryable = false;
    suggested_action = 'PAUSE';
    user_message = 'Command timed out';
  }
  else if (isToolCrashedError(rawError)) {
    category = 'TOOL_FAILURE';
    code = 'TOOL_CRASHED';
    retryable = false;
    suggested_action = 'PAUSE';
    user_message = 'Command crashed unexpectedly';
  }
  else if (isToolNotFoundError(rawError)) {
    category = 'TOOL_FAILURE';
    code = 'TOOL_NOT_FOUND';
    retryable = false;
    suggested_action = 'PAUSE';
    user_message = 'Required tool not found';
  }
  // 6. Check for test/verify errors
  else if (isTestFailedError(rawError)) {
    category = 'VERIFY_FAILURE';
    code = 'TEST_FAILED';
    retryable = false;
    suggested_action = 'PAUSE';
    user_message = 'Tests failed after changes';
  }
  // 7. Default: Internal bug
  else {
    category = 'INTERNAL_BUG';
    code = 'INTERNAL_ERROR';
    retryable = false;
    suggested_action = 'PAUSE';
    user_message = 'An unexpected error occurred';
  }

  // Override retryable if tool had side effect
  if (context.toolHadSideEffect && retryable) {
    retryable = false;
    suggested_action = 'PAUSE';
  }

  return {
    category,
    retryable,
    suggested_action,
    user_message,
    code,
    developer_details: {
      raw_error: rawError,
      stack_preview: stackPreview,
      context: context.extra,
    },
  };
}

// ============================================================================
// ERROR DETECTION HELPERS
// ============================================================================

function isNetworkError(msg: string): boolean {
  const patterns = [
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /network\s+error/i,
    /connection\s+refused/i,
    /connection\s+reset/i,
    /fetch\s+failed/i,
    /status\s+5\d\d/i,
    /status\s+429/i,
    /overloaded/i,
  ];
  return patterns.some(p => p.test(msg));
}

function isRateLimitError(msg: string): boolean {
  return /429|rate\s*limit|too\s+many\s+requests/i.test(msg);
}

function isOverloadedError(msg: string): boolean {
  return /529|overloaded|capacity/i.test(msg);
}

function isTimeoutError(msg: string): boolean {
  return /timeout|ETIMEDOUT|timed?\s*out/i.test(msg);
}

function isTruncationError(msg: string): boolean {
  return /truncat|max_tokens|stop_reason.*length|incomplete\s+output/i.test(msg);
}

function isJsonParseError(msg: string): boolean {
  return /JSON\.parse|SyntaxError.*JSON|invalid\s+json|unexpected\s+token/i.test(msg);
}

function isSchemaMissingError(msg: string): boolean {
  return /missing\s+(required|field)|schema|complete.*false|sentinel/i.test(msg);
}

function isFileNotFoundError(msg: string): boolean {
  return /ENOENT|file\s+not\s+found|no\s+such\s+file/i.test(msg);
}

function isDirMissingError(msg: string): boolean {
  return /ENOENT.*directory|directory\s+not\s+found|no\s+such\s+directory/i.test(msg);
}

function isPermissionError(msg: string): boolean {
  return /EACCES|EPERM|permission\s+denied|access\s+denied/i.test(msg);
}

function isPathTraversalError(msg: string): boolean {
  return /path\s+traversal|outside\s+workspace|security.*path/i.test(msg);
}

function isStaleContextError(msg: string): boolean {
  return /stale|changed\s+since|file\s+modified|base_sha\s+mismatch/i.test(msg);
}

function isHunkMismatchError(msg: string): boolean {
  return /hunk|context\s+mismatch|cannot\s+apply\s+hunk/i.test(msg);
}

function isPatchApplyError(msg: string): boolean {
  return /apply.*failed|patch.*failed|failed\s+to\s+apply/i.test(msg);
}

function isToolTimeoutError(msg: string): boolean {
  return /command.*timeout|tool.*timeout|execution.*timeout/i.test(msg);
}

function isToolCrashedError(msg: string): boolean {
  return /command.*crash|tool.*crash|SIGKILL|SIGTERM|exit\s+code\s+[1-9]/i.test(msg);
}

function isToolNotFoundError(msg: string): boolean {
  return /command\s+not\s+found|tool\s+not\s+found|not\s+installed/i.test(msg);
}

function isTestFailedError(msg: string): boolean {
  return /test.*fail|spec.*fail|assertion.*fail|expect.*fail/i.test(msg);
}

// ============================================================================
// FAILURE TYPES (Step 28 - Preserved)
// ============================================================================

/**
 * Failure type classification (for test/build output)
 */
export type FailureType =
  | 'TEST_ASSERTION'   // Test assertions failed (expect, assert, etc.)
  | 'TYPECHECK'        // TypeScript/type errors
  | 'LINT'             // ESLint, TSLint, etc.
  | 'BUILD_COMPILE'    // Build/compilation errors
  | 'TOOLING_ENV'      // Missing deps, wrong node version, env issues
  | 'TIMEOUT'          // Command timed out
  | 'UNKNOWN';         // Cannot classify

/**
 * Classification result (for test/build output)
 */
export interface FailureClassification {
  /** Category of failure */
  failureType: FailureType;
  
  /** Normalized error key (stable across runs) */
  normalizedKey: string;
  
  /** Hash signature for deduplication */
  failureSignature: string;
  
  /** Human-readable summary */
  summary: string;
  
  /** Whether this failure is likely recoverable via code fix */
  isCodeFixable: boolean;
  
  /** Extracted file references if present */
  fileReferences: string[];
  
  /** Extracted test names if present */
  failingTests: string[];
}

// ============================================================================
// NORMALIZATION PATTERNS
// ============================================================================

/**
 * Patterns for stripping volatile data from output
 */
const VOLATILE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Timestamps in various formats
  { pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, replacement: '[TIMESTAMP]' },
  { pattern: /\d{2}:\d{2}:\d{2}(\.\d+)?/g, replacement: '[TIME]' },
  
  // PIDs and process IDs
  { pattern: /\bPID[:\s]+\d+\b/gi, replacement: 'PID:[PID]' },
  { pattern: /\bpid[:\s]+\d+\b/gi, replacement: 'pid:[PID]' },
  { pattern: /\b(process|worker)[:\s#]+\d+\b/gi, replacement: '$1:[PID]' },
  
  // Memory addresses and hex blobs
  { pattern: /0x[0-9a-fA-F]{6,}/g, replacement: '[ADDR]' },
  { pattern: /\b[0-9a-fA-F]{16,}\b/g, replacement: '[HEX]' },
  
  // Absolute paths - convert to relative or normalized
  { pattern: /\/Users\/[^/\s]+\//g, replacement: '[HOME]/' },
  { pattern: /\/home\/[^/\s]+\//g, replacement: '[HOME]/' },
  { pattern: /C:\\Users\\[^\\]+\\/gi, replacement: '[HOME]\\' },
  
  // Random IDs often found in test output
  { pattern: /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g, replacement: '[UUID]' },
  
  // Duration/timing info
  { pattern: /\b\d+(\.\d+)?\s*(ms|s|sec|seconds|milliseconds)\b/gi, replacement: '[DURATION]' },
  
  // Stack trace noise (line numbers that might vary)
  { pattern: /\bat\s+.*:\d+:\d+\)?$/gm, replacement: 'at [STACK_FRAME]' },
];

/**
 * Patterns for extracting stable error signals
 */
const ERROR_TYPE_PATTERNS: Array<{
  type: FailureType;
  patterns: RegExp[];
  priority: number;
}> = [
  {
    type: 'TIMEOUT',
    patterns: [
      /timeout\s+(of\s+)?\d+\s*m?s\s+exceeded/i,
      /timed?\s*out/i,
      /operation\s+timed?\s*out/i,
      /ETIMEDOUT/,
      /test\s+timeout/i,
    ],
    priority: 10,
  },
  {
    type: 'TOOLING_ENV',
    patterns: [
      /cannot\s+find\s+module/i,
      /module\s+not\s+found/i,
      /ENOENT/,
      /command\s+not\s+found/i,
      /node\s+version/i,
      /npm\s+ERR!/,
      /pnpm\s+ERR!/,
      /yarn\s+error/i,
      /EACCES/,
      /EPERM/,
      /missing\s+dependency/i,
      /peer\s+dep/i,
      /node_modules.*not\s+found/i,
      /jest.*not\s+found/i,
      /vitest.*not\s+found/i,
      /could\s+not\s+resolve/i,
      /failed\s+to\s+load\s+config/i,
    ],
    priority: 9,
  },
  {
    type: 'BUILD_COMPILE',
    patterns: [
      /compilation\s+failed/i,
      /failed\s+to\s+compile/i,
      /build\s+failed/i,
      /tsc.*error/i,
      /error\s+TS\d+/i,
      /SyntaxError/,
      /ReferenceError.*not\s+defined/i,
    ],
    priority: 8,
  },
  {
    type: 'TYPECHECK',
    patterns: [
      /TS\d{4}:/,
      /type\s+error/i,
      /type\s+'.*'\s+is\s+not\s+assignable/i,
      /property\s+'.*'\s+does\s+not\s+exist/i,
      /cannot\s+find\s+name/i,
      /argument\s+of\s+type/i,
      /expected\s+\d+\s+arguments/i,
      /has\s+no\s+exported\s+member/i,
    ],
    priority: 7,
  },
  {
    type: 'LINT',
    patterns: [
      /eslint/i,
      /tslint/i,
      /prettier/i,
      /\d+:\d+\s+error\s+/,
      /\d+:\d+\s+warning\s+/,
      /lint.*error/i,
      /✖\s+\d+\s+(problem|error)/i,
    ],
    priority: 6,
  },
  {
    type: 'TEST_ASSERTION',
    patterns: [
      /AssertionError/i,
      /expect\(.*\)\.(to|not)/i,
      /expected.*to\s+(be|equal|match|have)/i,
      /assertion\s+failed/i,
      /FAIL\s+/,
      /\d+\s+(failing|failed)/i,
      /test\s+failed/i,
      /✗|✕/,
    ],
    priority: 5,
  },
];

/**
 * Patterns for extracting file references
 */
const FILE_REFERENCE_PATTERNS: RegExp[] = [
  // TypeScript/JavaScript paths
  /([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs))(?::\d+(?::\d+)?)?/g,
  // Relative paths starting with ./
  /\.\/[a-zA-Z0-9_\-./]+/g,
  // src/ paths
  /src\/[a-zA-Z0-9_\-./]+/g,
  // packages/ paths
  /packages\/[a-zA-Z0-9_\-./]+/g,
];

/**
 * Patterns for extracting test names
 */
const TEST_NAME_PATTERNS: RegExp[] = [
  // Jest/Vitest style
  /(?:FAIL|[\u2717\u2715])\s+(.+?)(?:\s+\(\d+)/g,
  /[\u00d7]?\s*(.+?)\s+[\u203a]\s+(.+)/g,
  // describe/it blocks
  /(?:describe|it|test)\s*\(\s*['"`](.+?)['"`]/g,
  // Failing test name in output
  /(?:failing|failed):\s*['"`]?(.+?)['"`]?$/gim,
];

// ============================================================================
// CLASSIFICATION FUNCTIONS
// ============================================================================

/**
 * Normalize raw output by stripping volatile data
 */
export function normalizeOutput(output: string): string {
  let normalized = output;
  
  for (const { pattern, replacement } of VOLATILE_PATTERNS) {
    normalized = normalized.replace(pattern, replacement);
  }
  
  // Normalize whitespace
  normalized = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');
  
  return normalized;
}

/**
 * Extract stable error signals from normalized output
 */
function extractErrorSignals(normalized: string): {
  type: FailureType;
  signals: string[];
} {
  // Try to classify by patterns, ordered by priority
  const sortedPatterns = [...ERROR_TYPE_PATTERNS].sort((a, b) => b.priority - a.priority);
  
  for (const { type, patterns } of sortedPatterns) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        // Extract matching lines as signals
        const lines = normalized.split('\n');
        const signals: string[] = [];
        
        for (const line of lines) {
          if (pattern.test(line) && signals.length < 5) {
            signals.push(line.substring(0, 200)); // Cap line length
          }
        }
        
        return { type, signals };
      }
    }
  }
  
  return { type: 'UNKNOWN', signals: [] };
}

/**
 * Extract file references from output
 */
function extractFileReferences(output: string): string[] {
  const files = new Set<string>();
  
  for (const pattern of FILE_REFERENCE_PATTERNS) {
    const matches = output.matchAll(pattern);
    for (const match of matches) {
      const file = match[1] || match[0];
      // Clean up the file path
      const cleaned = file
        .replace(/:\d+:\d+$/, '') // Remove line:col
        .replace(/:\d+$/, '');    // Remove line number
      
      if (cleaned && !cleaned.includes('node_modules')) {
        files.add(cleaned);
      }
    }
  }
  
  return Array.from(files).slice(0, 10); // Limit to 10 files
}

/**
 * Extract failing test names from output
 */
function extractFailingTests(output: string): string[] {
  const tests = new Set<string>();
  
  for (const pattern of TEST_NAME_PATTERNS) {
    const matches = output.matchAll(pattern);
    for (const match of matches) {
      const testName = match[1] || match[2];
      if (testName && testName.length < 200) {
        tests.add(testName.trim());
      }
    }
  }
  
  return Array.from(tests).slice(0, 5); // Limit to 5 tests
}

/**
 * Generate a short human-readable summary
 */
function generateSummary(
  type: FailureType,
  signals: string[],
  files: string[],
  tests: string[]
): string {
  const parts: string[] = [];
  
  // Type prefix
  const typeLabels: Record<FailureType, string> = {
    TEST_ASSERTION: '🔴 Test failed',
    TYPECHECK: '🔵 Type error',
    LINT: '🟡 Lint error',
    BUILD_COMPILE: '🟠 Build failed',
    TOOLING_ENV: '⚙️ Environment issue',
    TIMEOUT: '⏱️ Timeout',
    UNKNOWN: '❓ Unknown error',
  };
  parts.push(typeLabels[type]);
  
  // Add context
  if (tests.length > 0) {
    parts.push(`in "${tests[0]}"${tests.length > 1 ? ` +${tests.length - 1} more` : ''}`);
  } else if (files.length > 0) {
    const shortFile = path.basename(files[0]);
    parts.push(`in ${shortFile}${files.length > 1 ? ` +${files.length - 1} more` : ''}`);
  }
  
  // Add first signal if helpful
  if (signals.length > 0 && signals[0].length < 80) {
    parts.push(`- ${signals[0].substring(0, 60)}${signals[0].length > 60 ? '...' : ''}`);
  }
  
  return parts.join(' ').substring(0, 200);
}

/**
 * Generate a stable signature hash
 */
function generateSignature(type: FailureType, normalizedKey: string): string {
  const input = `${type}:${normalizedKey}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Check if failure type is likely fixable via code changes
 */
function isCodeFixable(type: FailureType): boolean {
  switch (type) {
    case 'TEST_ASSERTION':
    case 'TYPECHECK':
    case 'LINT':
    case 'BUILD_COMPILE':
      return true;
    case 'TOOLING_ENV':
    case 'TIMEOUT':
    case 'UNKNOWN':
      return false;
  }
}

/**
 * Main classification function for test/build output
 * 
 * Classifies raw test/build output into a structured result
 * with stable signature for deduplication.
 */
export function classifyFailure(output: string): FailureClassification {
  // Step 1: Normalize output
  const normalized = normalizeOutput(output);
  
  // Step 2: Extract error type and signals
  const { type, signals } = extractErrorSignals(normalized);
  
  // Step 3: Extract file references
  const fileReferences = extractFileReferences(output);
  
  // Step 4: Extract failing test names
  const failingTests = extractFailingTests(output);
  
  // Step 5: Build normalized key from stable signals
  const normalizedKey = signals.length > 0
    ? signals.slice(0, 3).join('|')
    : normalized.substring(0, 500);
  
  // Step 6: Generate signature
  const failureSignature = generateSignature(type, normalizedKey);
  
  // Step 7: Generate summary
  const summary = generateSummary(type, signals, fileReferences, failingTests);
  
  return {
    failureType: type,
    normalizedKey,
    failureSignature,
    summary,
    isCodeFixable: isCodeFixable(type),
    fileReferences,
    failingTests,
  };
}

// ============================================================================
// BRIDGE: Convert FailureClassification to ErrorDescriptor
// ============================================================================

/**
 * Convert a test/build FailureClassification to universal ErrorDescriptor
 */
export function failureToErrorDescriptor(
  classification: FailureClassification,
  context?: ErrorClassificationContext
): ErrorDescriptor {
  // Map FailureType to ErrorCategory
  const categoryMap: Record<FailureType, ErrorCategory> = {
    'TEST_ASSERTION': 'VERIFY_FAILURE',
    'TYPECHECK': 'VERIFY_FAILURE',
    'LINT': 'VERIFY_FAILURE',
    'BUILD_COMPILE': 'VERIFY_FAILURE',
    'TOOLING_ENV': 'TOOL_FAILURE',
    'TIMEOUT': 'TOOL_FAILURE',
    'UNKNOWN': 'INTERNAL_BUG',
  };

  // Map FailureType to ErrorCode
  const codeMap: Record<FailureType, ErrorCode> = {
    'TEST_ASSERTION': 'TEST_FAILED',
    'TYPECHECK': 'TYPECHECK_FAILED',
    'LINT': 'LINT_FAILED',
    'BUILD_COMPILE': 'BUILD_FAILED',
    'TOOLING_ENV': 'COMMAND_FAILED',
    'TIMEOUT': 'TOOL_TIMEOUT',
    'UNKNOWN': 'UNKNOWN_ERROR',
  };

  return {
    category: categoryMap[classification.failureType],
    retryable: false, // Test failures are not retryable without code fix
    suggested_action: 'PAUSE',
    user_message: classification.summary,
    code: codeMap[classification.failureType],
    developer_details: {
      raw_error: classification.normalizedKey,
      context: {
        files: classification.fileReferences,
        tests: classification.failingTests,
        signature: classification.failureSignature,
      },
    },
  };
}

// ============================================================================
// REPEAT DETECTION
// ============================================================================

/**
 * Consecutive failure tracker for loop detection
 */
export class ConsecutiveFailureTracker {
  private previousSignature: string | null = null;
  private consecutiveCount: number = 0;
  
  /**
   * Record a failure and check for repeats
   * Returns the consecutive count after recording
   */
  recordFailure(signature: string): number {
    if (signature === this.previousSignature) {
      this.consecutiveCount++;
    } else {
      this.previousSignature = signature;
      this.consecutiveCount = 1;
    }
    
    return this.consecutiveCount;
  }
  
  /**
   * Check if we've hit the repeat threshold
   */
  hasRepeatedFailure(maxConsecutive: number): boolean {
    return this.consecutiveCount >= maxConsecutive;
  }
  
  /**
   * Get current consecutive count
   */
  getCount(): number {
    return this.consecutiveCount;
  }
  
  /**
   * Get previous signature
   */
  getPreviousSignature(): string | null {
    return this.previousSignature;
  }
  
  /**
   * Reset tracker
   */
  reset(): void {
    this.previousSignature = null;
    this.consecutiveCount = 0;
  }
}
