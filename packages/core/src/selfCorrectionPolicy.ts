/**
 * Self-Correction Policy - Step 28
 * 
 * Configurable policy for bounded self-correction loops.
 * Controls iteration limits, timeout behaviors, and stop conditions.
 * 
 * V1 SAFE VERSION:
 * - REMOVED: allowAutoRetryOnKnownTransient (do not implement)
 * - NO infinite loops
 * - Prefer pause over guessing
 */

// ============================================================================
// POLICY TYPES
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
// DECISION POINT OPTIONS
// ============================================================================

/**
 * Decision point option for user
 */
export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  action: 'retry_tests' | 'retry_repair' | 'approve_scope' | 'change_command' | 'stop' | 'export';
}

/**
 * Generate decision options based on stop reason
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
