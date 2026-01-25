/**
 * Failure Classifier - Step 28 Self-Correction Loop
 * 
 * Classifies test/build/lint failures into normalized categories
 * and generates stable signatures for loop detection.
 * 
 * NON-NEGOTIABLE RULES:
 * - Normalization MUST strip volatile data (timestamps, PIDs, memory addresses)
 * - Signatures MUST be stable for identical logical failures
 * - Classification MUST be deterministic (no LLM calls)
 */

import * as crypto from 'crypto';
import * as path from 'path';

// ============================================================================
// FAILURE TYPES
// ============================================================================

/**
 * Failure type classification
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
 * Classification result
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
 * Main classification function
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
