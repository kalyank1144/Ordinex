/**
 * Tests for errorPatterns.ts — Step 49: Error Recovery UX
 */

import { describe, it, expect } from 'vitest';
import {
  matchErrorPattern,
  errorDescriptorToRecoveryActions,
  mergeRecoveryActions,
  isSafeRecoveryCommand,
  SAFE_RECOVERY_COMMANDS,
} from '../errorPatterns';
import type { ErrorDescriptor } from '../failureClassifier';

// ============================================================================
// matchErrorPattern()
// ============================================================================

describe('matchErrorPattern', () => {
  // ---- Module resolution ----
  it('matches "Cannot find module" with module name', () => {
    const result = matchErrorPattern("Cannot find module 'lodash'");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('module_not_found');
    expect(result!.category).toBe('module_resolution');
    expect(result!.title).toBe('Missing Module');
    expect(result!.message).toContain('lodash');
    expect(result!.actions.some(a => a.command === 'npm install')).toBe(true);
  });

  it('matches TS2307 module error', () => {
    const result = matchErrorPattern("TS2307: Cannot find module 'react'");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('ts2307_module');
    expect(result!.message).toContain('react');
  });

  it('matches "Could not resolve" import', () => {
    const result = matchErrorPattern("Could not resolve '@/components/Button'");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('could_not_resolve');
    expect(result!.message).toContain('@/components/Button');
  });

  it('matches "has no exported member"', () => {
    const result = matchErrorPattern("has no exported member 'useRouter'");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('no_matching_export');
  });

  // ---- TypeScript ----
  it('matches TS2322 type mismatch', () => {
    const result = matchErrorPattern("TS2322: Type 'string' is not assignable to type 'number'");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('ts2322_type_mismatch');
    expect(result!.title).toBe('Type Mismatch');
    expect(result!.message).toContain('string');
    expect(result!.message).toContain('number');
  });

  it('matches TS2339 property missing', () => {
    const result = matchErrorPattern("TS2339: Property 'foo' does not exist on type 'Bar'");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('ts2339_property_missing');
    expect(result!.message).toContain('foo');
  });

  it('matches TS7006 implicit any', () => {
    const result = matchErrorPattern("TS7006: Parameter 'x' implicitly has an 'any' type");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('ts7006_implicit_any');
  });

  // ---- Runtime ----
  it('matches TypeError not a function', () => {
    const result = matchErrorPattern("TypeError: myFunc is not a function");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('type_error_not_function');
    expect(result!.message).toContain('myFunc');
  });

  it('matches ReferenceError not defined', () => {
    const result = matchErrorPattern("ReferenceError: myVar is not defined");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('reference_error');
    expect(result!.message).toContain('myVar');
  });

  it('matches RangeError stack overflow', () => {
    const result = matchErrorPattern("RangeError: Maximum call stack size exceeded");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('range_error_stack');
    expect(result!.title).toBe('Stack Overflow');
  });

  // ---- Permissions / FS ----
  it('matches EACCES permission denied', () => {
    const result = matchErrorPattern("EACCES: permission denied, open '/etc/passwd'");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('eacces');
    expect(result!.category).toBe('permissions');
  });

  it('matches ENOENT file not found', () => {
    const result = matchErrorPattern("ENOENT: no such file or directory, open 'src/missing.ts'");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('enoent');
    expect(result!.message).toContain('src/missing.ts');
  });

  it('matches ENOSPC disk full', () => {
    const result = matchErrorPattern("ENOSPC: no space left on device");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('enospc');
    expect(result!.title).toBe('Disk Full');
  });

  // ---- Network ----
  it('matches EADDRINUSE with port number', () => {
    const result = matchErrorPattern("EADDRINUSE :::3000");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('eaddrinuse');
    expect(result!.message).toContain('3000');
  });

  it('matches 429 rate limit', () => {
    const result = matchErrorPattern("429 Too Many Requests");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('rate_limit_429');
    expect(result!.title).toBe('Rate Limited');
  });

  it('matches ECONNREFUSED', () => {
    const result = matchErrorPattern("ECONNREFUSED 127.0.0.1:5432");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('econnrefused');
  });

  it('matches ETIMEDOUT', () => {
    const result = matchErrorPattern("connect ETIMEDOUT 1.2.3.4:443");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('etimedout');
  });

  // ---- Build ----
  it('matches compilation failed', () => {
    const result = matchErrorPattern("Compilation failed with 3 errors");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('compilation_failed');
  });

  it('matches out of memory', () => {
    const result = matchErrorPattern("FATAL ERROR: JavaScript heap out of memory");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('out_of_memory');
    expect(result!.title).toBe('Out of Memory');
  });

  // ---- Test ----
  it('matches assertion failure with expected/to pattern', () => {
    const result = matchErrorPattern("Expected 42 to equal 43");
    expect(result).not.toBeNull();
    expect(result!.category).toBe('test');
  });

  it('matches test suite failed', () => {
    const result = matchErrorPattern("Test suite failed to run");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('test_suite_failed');
  });

  // ---- Edge cases ----
  it('returns null for unknown error', () => {
    const result = matchErrorPattern("Something completely unrecognized happened");
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(matchErrorPattern('')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(matchErrorPattern(null as any)).toBeNull();
    expect(matchErrorPattern(undefined as any)).toBeNull();
  });

  it('returns highest priority match when multiple patterns match', () => {
    // "ENOSPC" (priority 95) matches before any lower-priority pattern
    const result = matchErrorPattern("ENOSPC: no space left on device, write failed");
    expect(result).not.toBeNull();
    expect(result!.pattern_id).toBe('enospc');
  });

  it('truncates long capture groups to 100 chars', () => {
    const longModule = 'a'.repeat(200);
    const result = matchErrorPattern(`Cannot find module '${longModule}'`);
    expect(result).not.toBeNull();
    expect(result!.message.length).toBeLessThan(300);
    expect(result!.message).toContain('...');
  });
});

// ============================================================================
// errorDescriptorToRecoveryActions()
// ============================================================================

describe('errorDescriptorToRecoveryActions', () => {
  function makeDescriptor(overrides: Partial<ErrorDescriptor>): ErrorDescriptor {
    return {
      category: 'INTERNAL_BUG',
      retryable: false,
      suggested_action: 'PAUSE',
      user_message: 'Test error',
      code: 'UNKNOWN_ERROR',
      developer_details: {},
      ...overrides,
    };
  }

  it('RETRY_SAME with retryable=true → enabled Try Again', () => {
    const actions = errorDescriptorToRecoveryActions(
      makeDescriptor({ suggested_action: 'RETRY_SAME', retryable: true })
    );
    const retry = actions.find(a => a.id === 'retry');
    expect(retry).toBeDefined();
    expect(retry!.label).toBe('Try Again');
    expect(retry!.disabled).toBeFalsy();
  });

  it('RETRY_SAME with retryable=false → disabled Try Again (Concern #3)', () => {
    const actions = errorDescriptorToRecoveryActions(
      makeDescriptor({ suggested_action: 'RETRY_SAME', retryable: false })
    );
    const retry = actions.find(a => a.id === 'retry');
    expect(retry).toBeDefined();
    expect(retry!.disabled).toBe(true);
    expect(retry!.tooltip).toContain('Not safe');
  });

  it('RETRY_SPLIT → Try Again (Split) button', () => {
    const actions = errorDescriptorToRecoveryActions(
      makeDescriptor({ suggested_action: 'RETRY_SPLIT', retryable: true })
    );
    const split = actions.find(a => a.id === 'retry_split');
    expect(split).toBeDefined();
    expect(split!.label).toBe('Try Again (Split)');
    expect(split!.disabled).toBeFalsy();
  });

  it('REGENERATE_PATCH → Try Different Approach', () => {
    const actions = errorDescriptorToRecoveryActions(
      makeDescriptor({ suggested_action: 'REGENERATE_PATCH' })
    );
    expect(actions.some(a => a.id === 'alternative')).toBe(true);
    expect(actions.find(a => a.id === 'alternative')!.label).toBe('Try Different Approach');
  });

  it('ASK_USER → Fix Manually', () => {
    const actions = errorDescriptorToRecoveryActions(
      makeDescriptor({ suggested_action: 'ASK_USER' })
    );
    expect(actions.some(a => a.id === 'fix_manually')).toBe(true);
  });

  it('PAUSE → Restore Checkpoint + Fix Manually', () => {
    const actions = errorDescriptorToRecoveryActions(
      makeDescriptor({ suggested_action: 'PAUSE' })
    );
    expect(actions.some(a => a.id === 'restore_checkpoint')).toBe(true);
    expect(actions.some(a => a.id === 'fix_manually')).toBe(true);
  });

  it('ABORT → Restore Checkpoint only', () => {
    const actions = errorDescriptorToRecoveryActions(
      makeDescriptor({ suggested_action: 'ABORT' })
    );
    expect(actions.some(a => a.id === 'restore_checkpoint')).toBe(true);
    expect(actions.some(a => a.id === 'fix_manually')).toBe(false);
  });
});

// ============================================================================
// mergeRecoveryActions()
// ============================================================================

describe('mergeRecoveryActions', () => {
  it('classifier actions come first', () => {
    const classifier = [
      { id: 'retry', label: 'Try Again', type: 'retry' as const },
    ];
    const pattern = [
      { id: 'run_npm_install', label: 'Run npm install', type: 'command' as const, command: 'npm install' },
    ];
    const merged = mergeRecoveryActions(classifier, pattern);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('retry');
    expect(merged[1].id).toBe('run_npm_install');
  });

  it('deduplicates by id — classifier wins', () => {
    const classifier = [
      { id: 'retry', label: 'Try Again (classifier)', type: 'retry' as const, disabled: true },
    ];
    const pattern = [
      { id: 'retry', label: 'Try Again (pattern)', type: 'retry' as const },
    ];
    const merged = mergeRecoveryActions(classifier, pattern);
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe('Try Again (classifier)');
    expect(merged[0].disabled).toBe(true);
  });

  it('empty inputs produce empty output', () => {
    expect(mergeRecoveryActions([], [])).toEqual([]);
  });

  it('handles only classifier actions', () => {
    const classifier = [{ id: 'retry', label: 'Try Again', type: 'retry' as const }];
    expect(mergeRecoveryActions(classifier, [])).toEqual(classifier);
  });

  it('handles only pattern actions', () => {
    const pattern = [{ id: 'run_test', label: 'Run Tests', type: 'command' as const, command: 'npm test' }];
    expect(mergeRecoveryActions([], pattern)).toEqual(pattern);
  });
});

// ============================================================================
// isSafeRecoveryCommand() + SAFE_RECOVERY_COMMANDS (Concern #4)
// ============================================================================

describe('isSafeRecoveryCommand', () => {
  it('allows npm install', () => {
    expect(isSafeRecoveryCommand('npm install')).toBe(true);
  });

  it('allows pnpm install', () => {
    expect(isSafeRecoveryCommand('pnpm install')).toBe(true);
  });

  it('allows npm run build', () => {
    expect(isSafeRecoveryCommand('npm run build')).toBe(true);
  });

  it('allows npm test', () => {
    expect(isSafeRecoveryCommand('npm test')).toBe(true);
  });

  it('allows npx tsc --noEmit', () => {
    expect(isSafeRecoveryCommand('npx tsc --noEmit')).toBe(true);
  });

  it('rejects arbitrary commands', () => {
    expect(isSafeRecoveryCommand('rm -rf /')).toBe(false);
  });

  it('rejects commands with extra flags', () => {
    expect(isSafeRecoveryCommand('npm install --save-dev malicious')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSafeRecoveryCommand('')).toBe(false);
  });

  it('trims whitespace', () => {
    expect(isSafeRecoveryCommand('  npm install  ')).toBe(true);
  });

  it('SAFE_RECOVERY_COMMANDS has expected size', () => {
    expect(SAFE_RECOVERY_COMMANDS.size).toBeGreaterThanOrEqual(15);
  });
});
