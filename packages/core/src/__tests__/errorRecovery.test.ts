/**
 * Error Recovery Tests - Step 32
 * 
 * Comprehensive test suite for error + recovery hardening:
 * A) Transient network failure → retry succeeds
 * B) LLM truncation → split-by-file → success
 * C) Apply conflict → regenerate patch → success OR decision point
 * D) Modify non-existent file → WORKSPACE_STATE → decision_point_needed
 * E) Failure after retries → needs_input with options
 * F) Replay regression → produces same state
 */

import { describe, it, expect } from 'vitest';

import {
  classifyError,
  ErrorDescriptor,
  ErrorCategory,
  ErrorCode,
  ErrorClassificationContext,
  failureToErrorDescriptor,
  classifyFailure,
} from '../failureClassifier';

import {
  RecoveryPolicy,
  DEFAULT_RECOVERY_POLICY,
  RecoveryState,
  RecoveryPhase,
  getRecoveryPhase,
  createRecoveryState,
  calculateBackoffDelay,
  createDecisionPoint,
  DecisionPoint,
} from '../selfCorrectionPolicy';

import {
  generateRunId,
  generateStepId,
  generateAttemptId,
  generateFileId,
  EventCorrelation,
} from '../eventBus';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestContext(overrides: Partial<ErrorClassificationContext> = {}): ErrorClassificationContext {
  return {
    stage: 'unknown',
    toolHadSideEffect: false,
    ...overrides,
  };
}

function createTestRecoveryState(overrides: Partial<RecoveryState> = {}): RecoveryState {
  return {
    ...createRecoveryState(),
    ...overrides,
  };
}

// ============================================================================
// A) TRANSIENT NETWORK FAILURE TESTS
// ============================================================================

describe('A) Transient network failure recovery', () => {
  describe('classifyError for network errors', () => {
    it('classifies 429 as RATE_LIMIT with RETRY_SAME', () => {
      const error = new Error('API returned status 429: Too many requests');
      const context = createTestContext({ stage: 'tool' });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('RATE_LIMIT');
      expect(result.code).toBe('RATE_LIMITED');
      expect(result.retryable).toBe(true);
      expect(result.suggested_action).toBe('RETRY_SAME');
      expect(result.user_message).toContain('rate limit');
    });

    it('classifies 529 overloaded as NETWORK_TRANSIENT with RETRY_SAME', () => {
      const error = new Error('API overloaded status 529');
      const context = createTestContext({ stage: 'diff_gen' });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('NETWORK_TRANSIENT');
      expect(result.code).toBe('API_OVERLOADED');
      expect(result.retryable).toBe(true);
      expect(result.suggested_action).toBe('RETRY_SAME');
    });

    it('classifies ETIMEDOUT as NETWORK_TRANSIENT', () => {
      const error = new Error('ETIMEDOUT: Connection timed out');
      const context = createTestContext();
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('NETWORK_TRANSIENT');
      expect(result.code).toBe('CONNECTION_TIMEOUT');
      expect(result.retryable).toBe(true);
    });

    it('marks as NOT retryable after tool side effect', () => {
      const error = new Error('API returned status 429');
      const context = createTestContext({
        stage: 'tool',
        toolHadSideEffect: true,
      });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('RATE_LIMIT');
      expect(result.retryable).toBe(false);
      expect(result.suggested_action).toBe('PAUSE');
    });
  });

  describe('getRecoveryPhase for network errors', () => {
    it('returns RETRY_SAME before max retries', () => {
      const error: ErrorDescriptor = {
        category: 'RATE_LIMIT',
        retryable: true,
        suggested_action: 'RETRY_SAME',
        user_message: 'Rate limited',
        code: 'RATE_LIMITED',
        developer_details: {},
      };
      const state = createTestRecoveryState({ retryCount: 0 });
      
      const phase = getRecoveryPhase(error, state, DEFAULT_RECOVERY_POLICY);
      
      expect(phase).toBe('RETRY_SAME');
    });

    it('returns DECISION_POINT after max retries', () => {
      const error: ErrorDescriptor = {
        category: 'RATE_LIMIT',
        retryable: true,
        suggested_action: 'RETRY_SAME',
        user_message: 'Rate limited',
        code: 'RATE_LIMITED',
        developer_details: {},
      };
      const state = createTestRecoveryState({ retryCount: 3 }); // Exceeds default 2
      
      const phase = getRecoveryPhase(error, state, DEFAULT_RECOVERY_POLICY);
      
      expect(phase).toBe('DECISION_POINT');
    });

    it('returns DECISION_POINT after tool side effect regardless of retry count', () => {
      const error: ErrorDescriptor = {
        category: 'NETWORK_TRANSIENT',
        retryable: false,
        suggested_action: 'PAUSE',
        user_message: 'Network error',
        code: 'CONNECTION_RESET',
        developer_details: {},
      };
      const state = createTestRecoveryState({
        retryCount: 0,
        toolHadSideEffect: true,
      });
      
      const phase = getRecoveryPhase(error, state, DEFAULT_RECOVERY_POLICY);
      
      expect(phase).toBe('DECISION_POINT');
    });
  });

  describe('backoff calculation', () => {
    it('calculates exponential backoff', () => {
      const delay0 = calculateBackoffDelay(0, DEFAULT_RECOVERY_POLICY);
      const delay1 = calculateBackoffDelay(1, DEFAULT_RECOVERY_POLICY);
      const delay2 = calculateBackoffDelay(2, DEFAULT_RECOVERY_POLICY);
      
      // Base is 2000ms
      expect(delay0).toBeGreaterThanOrEqual(2000);
      expect(delay0).toBeLessThanOrEqual(3000); // With jitter
      
      expect(delay1).toBeGreaterThanOrEqual(4000);
      expect(delay1).toBeLessThanOrEqual(5000);
      
      expect(delay2).toBeGreaterThanOrEqual(8000);
      expect(delay2).toBeLessThanOrEqual(9000);
    });

    it('caps at maxDelayMs', () => {
      const delay = calculateBackoffDelay(10, DEFAULT_RECOVERY_POLICY);
      
      expect(delay).toBeLessThanOrEqual(DEFAULT_RECOVERY_POLICY.backoffForTransient.maxDelayMs);
    });
  });
});

// ============================================================================
// B) LLM TRUNCATION TESTS
// ============================================================================

describe('B) LLM truncation recovery', () => {
  describe('classifyError for truncation', () => {
    it('classifies truncation error correctly', () => {
      const error = new Error('Output truncated: max_tokens exceeded');
      const context = createTestContext({ stage: 'diff_gen' });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('LLM_TRUNCATION');
      expect(result.code).toBe('OUTPUT_TRUNCATED');
      expect(result.retryable).toBe(true);
      expect(result.suggested_action).toBe('RETRY_SPLIT');
    });

    it('detects stop_reason length as truncation', () => {
      const error = new Error('stop_reason: length');
      const context = createTestContext();
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('LLM_TRUNCATION');
    });
  });

  describe('getRecoveryPhase for truncation', () => {
    it('returns RETRY_SPLIT before split attempted', () => {
      const error: ErrorDescriptor = {
        category: 'LLM_TRUNCATION',
        retryable: true,
        suggested_action: 'RETRY_SPLIT',
        user_message: 'Output truncated',
        code: 'OUTPUT_TRUNCATED',
        developer_details: {},
      };
      const state = createTestRecoveryState({ splitAttempted: false });
      
      const phase = getRecoveryPhase(error, state, DEFAULT_RECOVERY_POLICY);
      
      expect(phase).toBe('RETRY_SPLIT');
    });

    it('returns DECISION_POINT after split attempted', () => {
      const error: ErrorDescriptor = {
        category: 'LLM_TRUNCATION',
        retryable: true,
        suggested_action: 'RETRY_SPLIT',
        user_message: 'Output truncated',
        code: 'OUTPUT_TRUNCATED',
        developer_details: {},
      };
      const state = createTestRecoveryState({ splitAttempted: true });
      
      const phase = getRecoveryPhase(error, state, DEFAULT_RECOVERY_POLICY);
      
      expect(phase).toBe('DECISION_POINT');
    });
  });
});

// ============================================================================
// C) APPLY CONFLICT TESTS
// ============================================================================

describe('C) Apply conflict recovery', () => {
  describe('classifyError for apply conflicts', () => {
    it('classifies stale context error', () => {
      const error = new Error('File changed since edit: base_sha mismatch');
      const context = createTestContext({ stage: 'apply', file: 'src/foo.ts' });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('APPLY_CONFLICT');
      expect(result.code).toBe('STALE_CONTEXT');
      expect(result.suggested_action).toBe('REGENERATE_PATCH');
      expect(result.user_message).toContain('src/foo.ts');
    });

    it('classifies hunk mismatch error', () => {
      const error = new Error('Cannot apply hunk: context mismatch at line 42');
      const context = createTestContext({ stage: 'apply' });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('APPLY_CONFLICT');
      expect(result.code).toBe('HUNK_MISMATCH');
      expect(result.suggested_action).toBe('REGENERATE_PATCH');
    });

    it('classifies generic apply failure', () => {
      const error = new Error('Failed to apply patch');
      const context = createTestContext({ stage: 'apply' });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('APPLY_CONFLICT');
      expect(result.code).toBe('PATCH_APPLY_FAILED');
    });
  });

  describe('getRecoveryPhase for apply conflicts', () => {
    it('returns REGENERATE_PATCH before regenerate attempted', () => {
      const error: ErrorDescriptor = {
        category: 'APPLY_CONFLICT',
        retryable: true,
        suggested_action: 'REGENERATE_PATCH',
        user_message: 'Stale context',
        code: 'STALE_CONTEXT',
        developer_details: {},
      };
      const state = createTestRecoveryState({ regenerateAttempted: false });
      
      const phase = getRecoveryPhase(error, state, DEFAULT_RECOVERY_POLICY);
      
      expect(phase).toBe('REGENERATE_PATCH');
    });

    it('returns DECISION_POINT after regenerate attempted', () => {
      const error: ErrorDescriptor = {
        category: 'APPLY_CONFLICT',
        retryable: true,
        suggested_action: 'REGENERATE_PATCH',
        user_message: 'Stale context',
        code: 'STALE_CONTEXT',
        developer_details: {},
      };
      const state = createTestRecoveryState({ regenerateAttempted: true });
      
      const phase = getRecoveryPhase(error, state, DEFAULT_RECOVERY_POLICY);
      
      expect(phase).toBe('DECISION_POINT');
    });

    it('respects maxPatchRegenerateAttempts=0', () => {
      const error: ErrorDescriptor = {
        category: 'APPLY_CONFLICT',
        retryable: true,
        suggested_action: 'REGENERATE_PATCH',
        user_message: 'Stale context',
        code: 'STALE_CONTEXT',
        developer_details: {},
      };
      const state = createTestRecoveryState({ regenerateAttempted: false });
      const policy: RecoveryPolicy = {
        ...DEFAULT_RECOVERY_POLICY,
        maxPatchRegenerateAttempts: 0,
      };
      
      const phase = getRecoveryPhase(error, state, policy);
      
      expect(phase).toBe('DECISION_POINT');
    });
  });
});

// ============================================================================
// D) WORKSPACE STATE TESTS
// ============================================================================

describe('D) Modify non-existent file', () => {
  describe('classifyError for workspace issues', () => {
    it('classifies ENOENT as FILE_NOT_FOUND', () => {
      const error = new Error('ENOENT: no such file or directory');
      const context = createTestContext({ stage: 'apply', file: 'missing.ts' });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('WORKSPACE_STATE');
      expect(result.code).toBe('FILE_NOT_FOUND');
      expect(result.retryable).toBe(false);
      expect(result.suggested_action).toBe('ASK_USER');
      expect(result.user_message).toContain('missing.ts');
    });

    it('classifies directory not found error as DIR_MISSING', () => {
      const error = new Error('ENOENT: directory not found');
      const context = createTestContext({ stage: 'preflight' });

      const result = classifyError(error, context);

      // isDirMissingError (more specific) is checked before isFileNotFoundError (broad ENOENT)
      expect(result.category).toBe('WORKSPACE_STATE');
      expect(result.code).toBe('DIR_MISSING');
    });

    it('classifies ENOENT scandir as DIR_MISSING not FILE_NOT_FOUND', () => {
      const error = new Error("ENOENT: no such file or directory, scandir '/app/src/components'");
      const context = createTestContext({ stage: 'preflight' });

      const result = classifyError(error, context);

      expect(result.category).toBe('WORKSPACE_STATE');
      expect(result.code).toBe('DIR_MISSING');
    });

    it('classifies permission errors', () => {
      const error = new Error('EACCES: permission denied');
      const context = createTestContext({ stage: 'apply', file: '/root/secret' });
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('PERMISSION');
      expect(result.code).toBe('PERMISSION_DENIED');
      expect(result.retryable).toBe(false);
    });

    it('classifies path traversal as security issue', () => {
      const error = new Error('Path traversal detected: outside workspace');
      const context = createTestContext();
      
      const result = classifyError(error, context);
      
      expect(result.category).toBe('WORKSPACE_STATE');
      expect(result.code).toBe('PATH_TRAVERSAL');
      expect(result.suggested_action).toBe('ABORT');
    });
  });

  describe('getRecoveryPhase for workspace issues', () => {
    it('returns DECISION_POINT for workspace errors', () => {
      const error: ErrorDescriptor = {
        category: 'WORKSPACE_STATE',
        retryable: false,
        suggested_action: 'ASK_USER',
        user_message: 'File not found',
        code: 'FILE_NOT_FOUND',
        developer_details: {},
      };
      const state = createTestRecoveryState();
      
      const phase = getRecoveryPhase(error, state, DEFAULT_RECOVERY_POLICY);
      
      expect(phase).toBe('DECISION_POINT');
    });
  });
});

// ============================================================================
// E) DECISION POINT GENERATION
// ============================================================================

describe('E) Decision point generation', () => {
  it('creates decision point with correct structure', () => {
    const error: ErrorDescriptor = {
      category: 'APPLY_CONFLICT',
      retryable: true,
      suggested_action: 'REGENERATE_PATCH',
      user_message: 'File changed since edit was proposed',
      code: 'STALE_CONTEXT',
      developer_details: {},
    };
    
    const decisionPoint = createDecisionPoint(error, {
      run_id: 'run_123',
      step_id: 'step_1',
      attempt_id: 'attempt_0',
      file: 'src/foo.ts',
    });
    
    expect(decisionPoint.id).toContain('decision_');
    expect(decisionPoint.title).toBe('Changes Could Not Be Applied');
    expect(decisionPoint.summary).toContain('changed');
    expect(decisionPoint.options.length).toBeGreaterThan(0);
    expect(decisionPoint.context.run_id).toBe('run_123');
    expect(decisionPoint.context.step_id).toBe('step_1');
    expect(decisionPoint.context.error_code).toBe('STALE_CONTEXT');
    expect(decisionPoint.context.affected_files).toContain('src/foo.ts');
  });

  it('includes appropriate options for APPLY_CONFLICT', () => {
    const error: ErrorDescriptor = {
      category: 'APPLY_CONFLICT',
      retryable: true,
      suggested_action: 'REGENERATE_PATCH',
      user_message: 'Stale context',
      code: 'STALE_CONTEXT',
      developer_details: {},
    };
    
    const decisionPoint = createDecisionPoint(error, {
      run_id: 'run_123',
      step_id: 'step_1',
      attempt_id: 'attempt_0',
      file: 'foo.ts',
    });
    
    const optionIds = decisionPoint.options.map(o => o.id);
    expect(optionIds).toContain('regenerate');
    expect(optionIds).toContain('skip_file');
    expect(optionIds).toContain('abort');
  });

  it('includes retry option for network errors', () => {
    const error: ErrorDescriptor = {
      category: 'RATE_LIMIT',
      retryable: true,
      suggested_action: 'RETRY_SAME',
      user_message: 'Rate limited',
      code: 'RATE_LIMITED',
      developer_details: {},
    };
    
    const decisionPoint = createDecisionPoint(error, {
      run_id: 'run_123',
      step_id: 'step_1',
      attempt_id: 'attempt_0',
    });
    
    const retryOption = decisionPoint.options.find(o => o.id === 'retry');
    expect(retryOption).toBeDefined();
    expect(retryOption!.action).toEqual({ type: 'RETRY_SAME' });
    expect(retryOption!.isDefault).toBe(true);
  });

  it('always includes abort option', () => {
    const error: ErrorDescriptor = {
      category: 'INTERNAL_BUG',
      retryable: false,
      suggested_action: 'PAUSE',
      user_message: 'Unexpected error',
      code: 'INTERNAL_ERROR',
      developer_details: {},
    };
    
    const decisionPoint = createDecisionPoint(error, {
      run_id: 'run_123',
      step_id: 'step_1',
      attempt_id: 'attempt_0',
    });
    
    const abortOption = decisionPoint.options.find(o => o.id === 'abort');
    expect(abortOption).toBeDefined();
    expect(abortOption!.action).toEqual({ type: 'ABORT_STEP' });
    expect(abortOption!.safe).toBe(true);
  });
});

// ============================================================================
// F) CORRELATION ID TESTS
// ============================================================================

describe('F) Correlation ID generation', () => {
  describe('generateRunId', () => {
    it('generates unique run IDs', () => {
      const id1 = generateRunId();
      const id2 = generateRunId();
      
      expect(id1).toMatch(/^run_[a-z0-9]+_[a-z0-9]+$/);
      expect(id2).toMatch(/^run_[a-z0-9]+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateStepId', () => {
    it('generates step ID based on run ID', () => {
      const runId = 'run_abc123_def456';
      const stepId = generateStepId(runId, 0);
      
      expect(stepId).toMatch(/^step_def456_0$/);
    });
  });

  describe('generateAttemptId', () => {
    it('generates attempt ID based on step ID', () => {
      const stepId = 'step_def456_0';
      const attemptId = generateAttemptId(stepId, 2);
      
      expect(attemptId).toMatch(/^attempt_0_2$/);
    });
  });

  describe('generateFileId', () => {
    it('generates consistent file ID for same path', () => {
      const id1 = generateFileId('src/foo/bar.ts');
      const id2 = generateFileId('src/foo/bar.ts');
      
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^file_[a-z0-9]+$/);
    });

    it('generates different IDs for different paths', () => {
      const id1 = generateFileId('src/foo.ts');
      const id2 = generateFileId('src/bar.ts');
      
      expect(id1).not.toBe(id2);
    });
  });
});

// ============================================================================
// G) FAILURE CLASSIFICATION BRIDGE
// ============================================================================

describe('G) Failure classification bridge', () => {
  it('converts test failure to ErrorDescriptor', () => {
    const classification = classifyFailure('FAIL src/app.test.ts\nExpect(1).toBe(2)\nAssertionError');
    const errorDescriptor = failureToErrorDescriptor(classification);
    
    expect(errorDescriptor.category).toBe('VERIFY_FAILURE');
    expect(errorDescriptor.code).toBe('TEST_FAILED');
    expect(errorDescriptor.retryable).toBe(false);
    expect(errorDescriptor.suggested_action).toBe('PAUSE');
  });

  it('converts typecheck failure to ErrorDescriptor', () => {
    const classification = classifyFailure('error TS2339: Property foo does not exist on type Bar');
    const errorDescriptor = failureToErrorDescriptor(classification);

    expect(errorDescriptor.category).toBe('VERIFY_FAILURE');
    expect(errorDescriptor.code).toBe('TYPECHECK_FAILED');
  });

  it('converts timeout failure to ErrorDescriptor', () => {
    const classification = classifyFailure('Test timed out after 5000ms');
    const errorDescriptor = failureToErrorDescriptor(classification);
    
    expect(errorDescriptor.category).toBe('TOOL_FAILURE');
    expect(errorDescriptor.code).toBe('TOOL_TIMEOUT');
  });
});

// ============================================================================
// H) JSON OUTPUT ERRORS
// ============================================================================

describe('H) JSON output errors', () => {
  it('classifies JSON parse errors', () => {
    const error = new Error('SyntaxError: Unexpected token in JSON at position 42');
    const context = createTestContext({ stage: 'diff_gen' });
    
    const result = classifyError(error, context);
    
    expect(result.category).toBe('LLM_OUTPUT_INVALID');
    expect(result.code).toBe('JSON_PARSE_FAILED');
    expect(result.retryable).toBe(true);
    expect(result.suggested_action).toBe('RETRY_SAME');
  });

  it('classifies schema validation errors', () => {
    const error = new Error('Missing required field: complete is false');
    const context = createTestContext({ stage: 'diff_gen' });
    
    const result = classifyError(error, context);
    
    expect(result.category).toBe('LLM_OUTPUT_INVALID');
    expect(result.code).toBe('SCHEMA_INVALID');
    expect(result.retryable).toBe(true);
  });
});

// ============================================================================
// I) TOOL ERRORS
// ============================================================================

describe('I) Tool errors', () => {
  it('classifies tool timeout', () => {
    const error = new Error('Command timeout: execution timeout after 30s');
    const context = createTestContext({ stage: 'tool' });
    
    const result = classifyError(error, context);
    
    expect(result.category).toBe('TOOL_FAILURE');
    expect(result.code).toBe('TOOL_TIMEOUT');
    expect(result.retryable).toBe(false);
  });

  it('classifies tool crash', () => {
    const error = new Error('Process terminated with SIGKILL');
    const context = createTestContext({ stage: 'tool' });
    
    const result = classifyError(error, context);
    
    expect(result.category).toBe('TOOL_FAILURE');
    expect(result.code).toBe('TOOL_CRASHED');
  });

  it('classifies command not found', () => {
    const error = new Error('command not found: foobar');
    const context = createTestContext({ stage: 'tool' });
    
    const result = classifyError(error, context);
    
    expect(result.category).toBe('TOOL_FAILURE');
    expect(result.code).toBe('TOOL_NOT_FOUND');
  });
});
