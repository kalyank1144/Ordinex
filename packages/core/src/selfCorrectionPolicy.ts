/**
 * Self-Correction Policy - Step 28 + Step 32 Universal Recovery
 * 
 * Configurable policy for bounded self-correction loops.
 * Controls iteration limits, timeout behaviors, and stop conditions.
 * 
 * STEP 32 EXTENSION: Universal recovery policy for ALL executors
 * - RecoveryPolicy: Unified bounded retry/recovery configuration
 * - DecisionPoint: Standardized decision structure for UI
 * - getRecoveryPhase: Recovery ladder (retry → split → regenerate → pause)
 * - createDecisionPoint: Generate decision points from errors
 * 
 * V1 SAFE VERSION:
 * - REMOVED: allowAutoRetryOnKnownTransient (do not implement)
 * - NO infinite loops
 * - Prefer pause over guessing
 */

import { 
  ErrorDescriptor, 
  ErrorCategory, 
  ErrorCode, 
  SuggestedAction 
} from './failureClassifier';

// ============================================================================
// UNIVERSAL RECOVERY POLICY (Step 32)
// ============================================================================

/**
 * Universal recovery policy - used by ALL executors
 * Wraps SelfCorrectionPolicy and adds general recovery configuration
 */
export interface RecoveryPolicy {
  /** Maximum retries per attempt before escalating (default: 2) */
  maxRetriesPerAttempt: number;
  
  /** Maximum recovery phases per step: retry → split → regenerate → pause (default: 3) */
  maxRecoveryPhasesPerStep: number;
  
  /** Maximum patch regeneration attempts on APPLY_CONFLICT (default: 1) */
  maxPatchRegenerateAttempts: number;
  
  /** Backoff configuration for transient errors */
  backoffForTransient: {
    enabled: boolean;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  
  /** Idempotency rules - NEVER violate these */
  idempotencyRules: {
    /** Never retry after a tool has executed with side effects */
    neverRetryAfterToolSideEffect: boolean;
    /** Never apply partial/truncated output */
    neverApplyPartialOutput: boolean;
  };
}

/**
 * Default universal recovery policy
 */
export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  maxRetriesPerAttempt: 2,
  maxRecoveryPhasesPerStep: 3,
  maxPatchRegenerateAttempts: 1, // 1 automatic attempt, then pause
  backoffForTransient: {
    enabled: true,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
  },
  idempotencyRules: {
    neverRetryAfterToolSideEffect: true,
    neverApplyPartialOutput: true,
  },
};

/**
 * Recovery phase in the recovery ladder (in order)
 */
export type RecoveryPhase =
  | 'RETRY_SAME'           // A) Retry as-is (transient network, before side effect)
  | 'RETRY_SPLIT'          // B) Split by file (truncation)
  | 'REGENERATE_PATCH'     // C) Regenerate with fresh context (stale/conflict)
  | 'DECISION_POINT';      // D) Pause and ask user

/**
 * Recovery state for tracking progress through recovery phases
 */
export interface RecoveryState {
  /** Number of retries attempted in current phase */
  retryCount: number;
  
  /** Whether split-by-file has been attempted */
  splitAttempted: boolean;
  
  /** Whether patch regeneration has been attempted */
  regenerateAttempted: boolean;
  
  /** Whether a tool has executed with side effects */
  toolHadSideEffect: boolean;
}

/**
 * Create initial recovery state
 */
export function createRecoveryState(): RecoveryState {
  return {
    retryCount: 0,
    splitAttempted: false,
    regenerateAttempted: false,
    toolHadSideEffect: false,
  };
}

/**
 * Get the appropriate recovery phase based on error and state
 * 
 * Recovery ladder (in order):
 * 1. RETRY_SAME - For transient network/rate limits, before any side effect
 * 2. RETRY_SPLIT - For truncation, split by file and retry
 * 3. REGENERATE_PATCH - For apply conflicts, regenerate with fresh context
 * 4. DECISION_POINT - When recovery fails, pause for user decision
 */
export function getRecoveryPhase(
  error: ErrorDescriptor,
  state: RecoveryState,
  policy: RecoveryPolicy
): RecoveryPhase {
  // Rule 1: NEVER retry after tool side effect
  if (state.toolHadSideEffect && policy.idempotencyRules.neverRetryAfterToolSideEffect) {
    return 'DECISION_POINT';
  }

  // Rule 2: NEVER apply partial output
  if (error.category === 'LLM_TRUNCATION' && policy.idempotencyRules.neverApplyPartialOutput) {
    // Can try splitting
    if (!state.splitAttempted) {
      return 'RETRY_SPLIT';
    }
    return 'DECISION_POINT';
  }

  // Recovery ladder based on error category
  switch (error.category) {
    // Transient errors: retry with backoff (bounded)
    case 'NETWORK_TRANSIENT':
    case 'RATE_LIMIT':
      if (state.retryCount < policy.maxRetriesPerAttempt) {
        return 'RETRY_SAME';
      }
      return 'DECISION_POINT';

    // LLM output errors: retry or split
    case 'LLM_TRUNCATION':
      if (!state.splitAttempted) {
        return 'RETRY_SPLIT';
      }
      return 'DECISION_POINT';

    case 'LLM_OUTPUT_INVALID':
      if (state.retryCount < policy.maxRetriesPerAttempt) {
        return 'RETRY_SAME';
      }
      return 'DECISION_POINT';

    // Apply conflicts: regenerate with fresh context (bounded)
    case 'APPLY_CONFLICT':
      if (!state.regenerateAttempted && policy.maxPatchRegenerateAttempts > 0) {
        return 'REGENERATE_PATCH';
      }
      return 'DECISION_POINT';

    // Verification failures: need user decision (code fix required)
    case 'VERIFY_FAILURE':
      return 'DECISION_POINT';

    // Workspace/permission/tool errors: need user decision
    case 'WORKSPACE_STATE':
    case 'PERMISSION':
    case 'TOOL_FAILURE':
    case 'USER_INPUT':
    case 'INTERNAL_BUG':
    default:
      return 'DECISION_POINT';
  }
}

/**
 * Calculate backoff delay for transient errors
 */
export function calculateBackoffDelay(
  retryCount: number,
  policy: RecoveryPolicy
): number {
  if (!policy.backoffForTransient.enabled) {
    return 0;
  }
  
  // Exponential backoff with jitter
  const baseDelay = policy.backoffForTransient.baseDelayMs;
  const maxDelay = policy.backoffForTransient.maxDelayMs;
  
  const exponentialDelay = baseDelay * Math.pow(2, retryCount);
  const jitter = Math.random() * 1000;
  
  return Math.min(exponentialDelay + jitter, maxDelay);
}

// ============================================================================
// STANDARDIZED DECISION POINTS (Step 32)
// ============================================================================

/**
 * Action type for decision options - maps to deterministic behavior
 */
export type DecisionActionType =
  | { type: 'RETRY_SAME' }
  | { type: 'RETRY_SPLIT' }
  | { type: 'REGENERATE_PATCH' }
  | { type: 'SKIP_FILE'; file: string }
  | { type: 'ABORT_STEP' }
  | { type: 'PROVIDE_INFO'; prompt: string };

/**
 * Standardized decision option for user
 */
export interface StandardDecisionOption {
  /** Unique identifier */
  id: string;
  
  /** Button label */
  label: string;
  
  /** Optional description */
  description?: string;
  
  /** The deterministic action this option triggers */
  action: DecisionActionType;
  
  /** Whether this action is safe (no side effects) */
  safe: boolean;
  
  /** Whether this is the default/recommended option */
  isDefault?: boolean;
}

/**
 * Standardized decision point - emitted when recovery can't proceed
 */
export interface DecisionPoint {
  /** Unique identifier for this decision point */
  id: string;
  
  /** Human-readable title (e.g., "Apply Failed") */
  title: string;
  
  /** One-paragraph summary of the situation */
  summary: string;
  
  /** Available options (buttons) */
  options: StandardDecisionOption[];
  
  /** Context for UI rendering and state */
  context: {
    /** Immutable run identifier */
    run_id: string;
    
    /** Step where error occurred */
    step_id: string;
    
    /** Attempt number within step */
    attempt_id: string;
    
    /** Error code for programmatic handling */
    error_code: ErrorCode;
    
    /** Error category for styling/grouping */
    error_category: ErrorCategory;
    
    /** Affected files if known */
    affected_files?: string[];
  };
}

/**
 * Generate title for decision point based on error
 */
function getDecisionPointTitle(error: ErrorDescriptor): string {
  const titles: Record<ErrorCategory, string> = {
    'USER_INPUT': 'Additional Information Needed',
    'WORKSPACE_STATE': 'File or Directory Issue',
    'LLM_TRUNCATION': 'Output Truncated',
    'LLM_OUTPUT_INVALID': 'Invalid Response',
    'TOOL_FAILURE': 'Tool Execution Failed',
    'APPLY_CONFLICT': 'Changes Could Not Be Applied',
    'VERIFY_FAILURE': 'Verification Failed',
    'NETWORK_TRANSIENT': 'Network Issue',
    'RATE_LIMIT': 'Rate Limited',
    'PERMISSION': 'Permission Denied',
    'INTERNAL_BUG': 'Unexpected Error',
  };
  
  return titles[error.category] || 'Action Required';
}

/**
 * Generate options for decision point based on error
 */
function getDecisionPointOptions(
  error: ErrorDescriptor,
  context: { file?: string }
): StandardDecisionOption[] {
  const options: StandardDecisionOption[] = [];
  
  // Add context-specific options based on error category
  switch (error.category) {
    case 'NETWORK_TRANSIENT':
    case 'RATE_LIMIT':
      options.push({
        id: 'retry',
        label: 'Retry Now',
        description: 'Try the operation again',
        action: { type: 'RETRY_SAME' },
        safe: true,
        isDefault: true,
      });
      break;
      
    case 'LLM_TRUNCATION':
      options.push({
        id: 'split',
        label: 'Split and Retry',
        description: 'Split into smaller operations and retry',
        action: { type: 'RETRY_SPLIT' },
        safe: true,
        isDefault: true,
      });
      break;
      
    case 'APPLY_CONFLICT':
      options.push({
        id: 'regenerate',
        label: 'Regenerate Changes',
        description: 'Get fresh changes with current file content',
        action: { type: 'REGENERATE_PATCH' },
        safe: true,
        isDefault: true,
      });
      if (context.file) {
        options.push({
          id: 'skip_file',
          label: `Skip ${context.file}`,
          description: 'Continue without changing this file',
          action: { type: 'SKIP_FILE', file: context.file },
          safe: true,
        });
      }
      break;
      
    case 'WORKSPACE_STATE':
      if (error.code === 'FILE_NOT_FOUND') {
        options.push({
          id: 'provide_path',
          label: 'Specify Correct Path',
          description: 'Provide the correct file path',
          action: { type: 'PROVIDE_INFO', prompt: 'Enter the correct file path:' },
          safe: true,
          isDefault: true,
        });
      }
      break;
      
    case 'LLM_OUTPUT_INVALID':
      options.push({
        id: 'retry',
        label: 'Retry',
        description: 'Try again',
        action: { type: 'RETRY_SAME' },
        safe: true,
        isDefault: true,
      });
      break;
  }
  
  // Always add abort option
  options.push({
    id: 'abort',
    label: 'Stop Step',
    description: 'Abort this step and pause the mission',
    action: { type: 'ABORT_STEP' },
    safe: true,
    isDefault: options.length === 0,
  });
  
  return options;
}

/**
 * Create a standardized decision point from an error
 */
export function createDecisionPoint(
  error: ErrorDescriptor,
  context: {
    run_id: string;
    step_id: string;
    attempt_id: string;
    file?: string;
    affected_files?: string[];
  }
): DecisionPoint {
  const id = `decision_${context.step_id}_${context.attempt_id}_${Date.now()}`;
  
  return {
    id,
    title: getDecisionPointTitle(error),
    summary: error.user_message,
    options: getDecisionPointOptions(error, { file: context.file }),
    context: {
      run_id: context.run_id,
      step_id: context.step_id,
      attempt_id: context.attempt_id,
      error_code: error.code,
      error_category: error.category,
      affected_files: context.affected_files || (context.file ? [context.file] : undefined),
    },
  };
}

// ============================================================================
// SELF-CORRECTION POLICY (Step 28 - Preserved)
// ============================================================================

/**
 * Self-correction policy configuration
 */
export interface SelfCorrectionPolicy {
  /** Maximum repair iterations before pausing (default: 2) */
  maxRepairIterations: number;
  
  /** Maximum consecutive same-failure occurrences before pausing (default: 2) */
  maxConsecutiveSameFailure: number;
  
  /** Whether to auto-run allowlisted test commands (default: true) */
  allowAutoRerunAllowlistedTests: boolean;
  
  /** Whether to stop when scope expansion is denied (default: true) */
  stopOnScopeExpansionDenied: boolean;
  
  /** Whether to stop on repeated stale context detection (default: true) */
  stopOnRepeatedStaleContext: boolean;
  
  /** Timeout for repair diagnosis phase in ms (default: 60000) */
  repairDiagnosisTimeoutMs: number;
  
  /** Timeout for repair diff generation in ms (default: 120000) */
  repairDiffGenTimeoutMs: number;
  
  /** Whether to retry once on infra timeout before pausing (default: true) */
  timeoutRetryOnce: boolean;
}

/**
 * Default self-correction policy (V1 safe defaults)
 */
export const DEFAULT_SELF_CORRECTION_POLICY: SelfCorrectionPolicy = {
  maxRepairIterations: 2,
  maxConsecutiveSameFailure: 2,
  allowAutoRerunAllowlistedTests: true,
  stopOnScopeExpansionDenied: true,
  stopOnRepeatedStaleContext: true,
  repairDiagnosisTimeoutMs: 60_000,
  repairDiffGenTimeoutMs: 120_000,
  timeoutRetryOnce: true,
};

// ============================================================================
// REPAIR LOOP STATE
// ============================================================================

/**
 * Repair loop execution state
 */
export interface RepairLoopState {
  /** Current iteration number (1-indexed) */
  currentIteration: number;
  
  /** Remaining repair iterations */
  repairRemaining: number;
  
  /** Consecutive same-failure count */
  consecutiveSameFailure: number;
  
  /** Previous failure signature */
  previousFailureSignature: string | null;
  
  /** Whether a timeout retry has been used this iteration */
  diagnosisTimeoutRetried: boolean;
  
  /** Whether a diffgen timeout retry has been used this iteration */
  diffGenTimeoutRetried: boolean;
  
  /** Timestamp when current iteration started */
  iterationStartedAt: string | null;
  
  /** Files approved for scope expansion in this repair loop */
  expandedScopeFiles: string[];
  
  /** Whether repair loop is active */
  isActive: boolean;
}

/**
 * Create initial repair loop state
 */
export function createRepairLoopState(policy: SelfCorrectionPolicy): RepairLoopState {
  return {
    currentIteration: 0,
    repairRemaining: policy.maxRepairIterations,
    consecutiveSameFailure: 0,
    previousFailureSignature: null,
    diagnosisTimeoutRetried: false,
    diffGenTimeoutRetried: false,
    iterationStartedAt: null,
    expandedScopeFiles: [],
    isActive: false,
  };
}

// ============================================================================
// STOP CONDITIONS
// ============================================================================

/**
 * Reason for stopping the repair loop
 */
export type StopReason =
  | 'budget_exhausted'           // maxRepairIterations reached
  | 'repeated_failure'           // Same failure occurred too many times
  | 'scope_expansion_denied'     // User denied scope expansion
  | 'repeated_stale_context'     // Context became stale again after refresh
  | 'tooling_env_failure'        // Environment/tooling issue (not code fixable)
  | 'diagnosis_timeout'          // Diagnosis timed out after retry
  | 'diffgen_timeout'            // Diff generation timed out after retry
  | 'user_cancel'                // User requested cancel
  | 'no_fix_found'               // LLM couldn't generate a fix after attempts
  | 'empty_diff_exhausted';      // Multiple empty diffs returned

/**
 * Stop condition check result
 */
export interface StopConditionResult {
  shouldStop: boolean;
  reason?: StopReason;
  message?: string;
}

/**
 * Check if repair loop should stop
 */
export function checkStopConditions(
  state: RepairLoopState,
  policy: SelfCorrectionPolicy,
  context: {
    currentFailureSignature?: string;
    isToolingEnvFailure?: boolean;
    scopeExpansionDenied?: boolean;
    staleContextCount?: number;
    diagnosisTimedOut?: boolean;
    diffGenTimedOut?: boolean;
    emptyDiffCount?: number;
  }
): StopConditionResult {
  // 1. Budget exhausted
  if (state.repairRemaining <= 0) {
    return {
      shouldStop: true,
      reason: 'budget_exhausted',
      message: `Repair budget exhausted after ${policy.maxRepairIterations} iterations`,
    };
  }

  // 2. Tooling/environment failure - pause immediately
  if (context.isToolingEnvFailure) {
    return {
      shouldStop: true,
      reason: 'tooling_env_failure',
      message: 'Environment or tooling issue detected - cannot fix via code changes',
    };
  }

  // 3. Repeated same failure
  if (context.currentFailureSignature && state.previousFailureSignature) {
    if (context.currentFailureSignature === state.previousFailureSignature) {
      const newCount = state.consecutiveSameFailure + 1;
      if (newCount >= policy.maxConsecutiveSameFailure) {
        return {
          shouldStop: true,
          reason: 'repeated_failure',
          message: `Same failure occurred ${newCount} consecutive times`,
        };
      }
    }
  }

  // 4. Scope expansion denied
  if (context.scopeExpansionDenied && policy.stopOnScopeExpansionDenied) {
    return {
      shouldStop: true,
      reason: 'scope_expansion_denied',
      message: 'Scope expansion was denied - cannot access required files',
    };
  }

  // 5. Repeated stale context
  if ((context.staleContextCount ?? 0) >= 2 && policy.stopOnRepeatedStaleContext) {
    return {
      shouldStop: true,
      reason: 'repeated_stale_context',
      message: 'Context became stale multiple times',
    };
  }

  // 6. Diagnosis timeout (after retry)
  if (context.diagnosisTimedOut && state.diagnosisTimeoutRetried) {
    return {
      shouldStop: true,
      reason: 'diagnosis_timeout',
      message: 'Diagnosis timed out after retry',
    };
  }

  // 7. Diff generation timeout (after retry)
  if (context.diffGenTimedOut && state.diffGenTimeoutRetried) {
    return {
      shouldStop: true,
      reason: 'diffgen_timeout',
      message: 'Diff generation timed out after retry',
    };
  }

  // 8. Multiple empty diffs
  if ((context.emptyDiffCount ?? 0) >= 2) {
    return {
      shouldStop: true,
      reason: 'empty_diff_exhausted',
      message: 'No fix could be generated after multiple attempts',
    };
  }

  return { shouldStop: false };
}

// ============================================================================
// LEGACY DECISION OPTIONS (Step 28 - Preserved for backward compatibility)
// ============================================================================

/**
 * Decision point option for user (legacy format)
 * @deprecated Use StandardDecisionOption instead
 */
export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  action: 'retry_tests' | 'retry_repair' | 'approve_scope' | 'change_command' | 'stop' | 'export';
}

/**
 * Generate decision options based on stop reason (legacy format)
 * @deprecated Use createDecisionPoint instead
 */
export function generateDecisionOptions(
  stopReason: StopReason,
  context: {
    repairRemaining: number;
    pendingScopeFiles?: string[];
    detectedScripts?: string[];
  }
): DecisionOption[] {
  const options: DecisionOption[] = [];

  switch (stopReason) {
    case 'budget_exhausted':
      options.push({
        id: 'retry_repair_one_more',
        label: 'Try one more repair',
        description: 'Allow one additional repair attempt',
        action: 'retry_repair',
      });
      options.push({
        id: 'retry_tests',
        label: 'Retry tests',
        description: 'Run the same tests again',
        action: 'retry_tests',
      });
      break;

    case 'repeated_failure':
      options.push({
        id: 'retry_repair_new_approach',
        label: 'Try different approach',
        description: 'Allow repair with fresh context',
        action: 'retry_repair',
      });
      options.push({
        id: 'change_command',
        label: 'Change test command',
        description: 'Select a different test command',
        action: 'change_command',
      });
      break;

    case 'scope_expansion_denied':
      if (context.pendingScopeFiles && context.pendingScopeFiles.length > 0) {
        options.push({
          id: 'approve_scope',
          label: `Approve scope expansion (${context.pendingScopeFiles.length} files)`,
          description: `Allow access to: ${context.pendingScopeFiles.slice(0, 3).join(', ')}${context.pendingScopeFiles.length > 3 ? '...' : ''}`,
          action: 'approve_scope',
        });
      }
      options.push({
        id: 'retry_repair',
        label: 'Try repair within current scope',
        action: 'retry_repair',
      });
      break;

    case 'tooling_env_failure':
      options.push({
        id: 'change_command',
        label: 'Change test command',
        description: 'Select a working command',
        action: 'change_command',
        isDefault: true,
      });
      options.push({
        id: 'retry_tests',
        label: 'Retry tests',
        description: 'Try the same command again (after fixing environment)',
        action: 'retry_tests',
      });
      break;

    case 'diagnosis_timeout':
    case 'diffgen_timeout':
      options.push({
        id: 'retry_repair',
        label: 'Retry repair',
        description: 'Try again (infrastructure may have recovered)',
        action: 'retry_repair',
      });
      break;

    case 'no_fix_found':
    case 'empty_diff_exhausted':
      options.push({
        id: 'retry_repair_more_context',
        label: 'Retry with more context',
        description: 'Try repair with expanded context',
        action: 'retry_repair',
      });
      break;

    default:
      // Generic options
      if (context.repairRemaining > 0) {
        options.push({
          id: 'retry_repair',
          label: `Retry repair (${context.repairRemaining} remaining)`,
          action: 'retry_repair',
        });
      }
      options.push({
        id: 'retry_tests',
        label: 'Retry tests',
        action: 'retry_tests',
      });
  }

  // Always include stop and export options
  options.push({
    id: 'stop',
    label: 'Stop mission',
    description: 'End this mission without further attempts',
    action: 'stop',
    isDefault: stopReason === 'tooling_env_failure' ? false : true,
  });

  options.push({
    id: 'export',
    label: 'Export run',
    description: 'Export the execution log for analysis',
    action: 'export',
  });

  return options;
}

// ============================================================================
// REPAIR ATTEMPT TRACKING
// ============================================================================

/**
 * Result of a repair attempt
 */
export type RepairAttemptResult =
  | 'applied_and_passed'      // Fix worked!
  | 'applied_and_failed'      // Fix applied but tests still fail
  | 'no_fix_found'            // LLM couldn't generate a fix
  | 'timeout_diagnosis'       // Diagnosis timed out
  | 'timeout_diffgen'         // Diff generation timed out
  | 'paused'                  // Paused for user decision
  | 'scope_denied';           // Required scope expansion was denied

/**
 * Repair attempt record
 */
export interface RepairAttemptRecord {
  attempt: number;
  result: RepairAttemptResult;
  failureSignature?: string;
  diffId?: string;
  filesChanged?: string[];
  durationMs: number;
  timestamp: string;
}

/**
 * Update repair loop state after recording a failure
 */
export function updateStateAfterFailure(
  state: RepairLoopState,
  failureSignature: string
): RepairLoopState {
  const isRepeat = failureSignature === state.previousFailureSignature;
  
  return {
    ...state,
    consecutiveSameFailure: isRepeat ? state.consecutiveSameFailure + 1 : 1,
    previousFailureSignature: failureSignature,
  };
}

/**
 * Update repair loop state after applying a diff
 */
export function updateStateAfterDiffApplied(state: RepairLoopState): RepairLoopState {
  return {
    ...state,
    repairRemaining: state.repairRemaining - 1,
    currentIteration: state.currentIteration + 1,
    // Reset timeout retry flags for new iteration
    diagnosisTimeoutRetried: false,
    diffGenTimeoutRetried: false,
  };
}

/**
 * Update repair loop state after diagnosis timeout
 */
export function updateStateAfterDiagnosisTimeout(
  state: RepairLoopState,
  policy: SelfCorrectionPolicy
): { state: RepairLoopState; shouldRetry: boolean } {
  if (!state.diagnosisTimeoutRetried && policy.timeoutRetryOnce) {
    return {
      state: { ...state, diagnosisTimeoutRetried: true },
      shouldRetry: true,
    };
  }
  return {
    state,
    shouldRetry: false,
  };
}

/**
 * Update repair loop state after diffgen timeout
 */
export function updateStateAfterDiffGenTimeout(
  state: RepairLoopState,
  policy: SelfCorrectionPolicy
): { state: RepairLoopState; shouldRetry: boolean } {
  if (!state.diffGenTimeoutRetried && policy.timeoutRetryOnce) {
    return {
      state: { ...state, diffGenTimeoutRetried: true },
      shouldRetry: true,
    };
  }
  return {
    state,
    shouldRetry: false,
  };
}
