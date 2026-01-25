/**
 * SelfCorrectionRunner - Step 28 Self-Correction Loop Implementation
 * 
 * Implements the bounded, deterministic self-correction cycle:
 * Diagnose → retrieve minimal context → propose fix diff → request approval → apply → rerun tests
 * 
 * NON-NEGOTIABLE RULES:
 * - ONE mission at a time, ONE stage at a time
 * - NEVER auto-apply diffs
 * - NEVER run unknown commands without approval
 * - NEVER expand scope without approval
 * - NO infinite loops
 * - Replayable from events
 * - User can cancel anytime
 * - Prefer pause over guessing
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EventBus } from './eventBus';
import { Event, Mode, Stage, EventType } from './types';
import { ApprovalManager } from './approvalManager';
import { 
  classifyFailure, 
  FailureClassification, 
  FailureType,
  ConsecutiveFailureTracker 
} from './failureClassifier';
import {
  SelfCorrectionPolicy,
  DEFAULT_SELF_CORRECTION_POLICY,
  RepairLoopState,
  createRepairLoopState,
  checkStopConditions,
  generateDecisionOptions,
  StopReason,
  DecisionOption,
  RepairAttemptResult,
  updateStateAfterFailure,
  updateStateAfterDiffApplied,
  updateStateAfterDiagnosisTimeout,
  updateStateAfterDiffGenTimeout,
} from './selfCorrectionPolicy';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Test failure input to repair loop
 */
export interface TestFailureInput {
  /** Raw test output (stdout + stderr) */
  rawOutput: string;
  
  /** Test command that was run */
  command: string;
  
  /** Exit code */
  exitCode: number;
  
  /** Timestamp of failure */
  timestamp: string;
}

/**
 * Repair context - files that can be used for diagnosis/repair
 */
export interface RepairContext {
  /** Files already in scope */
  scopeFiles: string[];
  
  /** Test file that failed (if identifiable) */
  failingTestFile?: string;
  
  /** Source files referenced in error */
  referencedSourceFiles: string[];
  
  /** Config files that might be relevant */
  configFiles: string[];
}

/**
 * Repair diff proposal
 */
export interface RepairDiffProposal {
  diffId: string;
  unifiedDiff: string;
  filesAffected: string[];
  summary: string;
  fixPlan?: string; // Informational only
}

/**
 * Result of a repair iteration
 */
export interface RepairIterationOutcome {
  result: RepairAttemptResult;
  failureClassification?: FailureClassification;
  diffProposal?: RepairDiffProposal;
  error?: string;
}

/**
 * Decision point for user
 */
export interface DecisionPoint {
  reason: StopReason;
  message: string;
  options: DecisionOption[];
  context: {
    iteration: number;
    remaining: number;
    failureSignature?: string;
    pendingScopeFiles?: string[];
  };
}

// ============================================================================
// SELF-CORRECTION RUNNER
// ============================================================================

/**
 * SelfCorrectionRunner: Orchestrates bounded repair cycles
 * 
 * This class handles the core repair loop logic:
 * 1. Classify failure
 * 2. Check stop conditions
 * 3. Diagnose and generate fix
 * 4. Request approval
 * 5. Apply and retest
 */
export class SelfCorrectionRunner {
  private readonly taskId: string;
  private readonly missionId: string;
  private readonly eventBus: EventBus;
  private readonly approvalManager: ApprovalManager;
  private readonly workspaceRoot: string;
  private readonly policy: SelfCorrectionPolicy;
  
  private repairState: RepairLoopState;
  private consecutiveTracker: ConsecutiveFailureTracker;
  private emptyDiffCount: number = 0;
  private staleContextCount: number = 0;
  private cancelRequested: boolean = false;
  
  /** Callback for generating repair diff (to be provided by integration layer) */
  private generateRepairDiff?: (
    classification: FailureClassification,
    context: RepairContext
  ) => Promise<RepairDiffProposal | null>;
  
  /** Callback for applying diff (to be provided by integration layer) */
  private applyDiff?: (diffProposal: RepairDiffProposal) => Promise<boolean>;
  
  /** Callback for running tests (to be provided by integration layer) */
  private runTests?: (command: string) => Promise<TestFailureInput | null>;
  
  constructor(
    taskId: string,
    missionId: string,
    eventBus: EventBus,
    approvalManager: ApprovalManager,
    workspaceRoot: string,
    policy: SelfCorrectionPolicy = DEFAULT_SELF_CORRECTION_POLICY
  ) {
    this.taskId = taskId;
    this.missionId = missionId;
    this.eventBus = eventBus;
    this.approvalManager = approvalManager;
    this.workspaceRoot = workspaceRoot;
    this.policy = policy;
    
    this.repairState = createRepairLoopState(policy);
    this.consecutiveTracker = new ConsecutiveFailureTracker();
  }
  
  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================
  
  /**
   * Set the repair diff generator callback
   */
  setRepairDiffGenerator(
    generator: (
      classification: FailureClassification,
      context: RepairContext
    ) => Promise<RepairDiffProposal | null>
  ): void {
    this.generateRepairDiff = generator;
  }
  
  /**
   * Set the diff applicator callback
   */
  setDiffApplicator(
    applicator: (diffProposal: RepairDiffProposal) => Promise<boolean>
  ): void {
    this.applyDiff = applicator;
  }
  
  /**
   * Set the test runner callback
   */
  setTestRunner(
    runner: (command: string) => Promise<TestFailureInput | null>
  ): void {
    this.runTests = runner;
  }
  
  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  
  /**
   * Start the self-correction loop for a test failure
   * 
   * @param testFailure - The test failure to attempt to fix
   * @param allowedScope - Files that are currently in scope
   * @param approvedTestCommand - The test command (already approved)
   * @returns Decision point if paused, or null if tests pass
   */
  async startRepairLoop(
    testFailure: TestFailureInput,
    allowedScope: string[],
    approvedTestCommand: string
  ): Promise<DecisionPoint | null> {
    this.repairState.isActive = true;
    this.cancelRequested = false;
    
    // Classify the initial failure
    const classification = classifyFailure(testFailure.rawOutput);
    
    // Emit failure_classified event
    await this.emitEvent('failure_classified', {
      missionId: this.missionId,
      failureType: classification.failureType,
      failureSignature: classification.failureSignature,
      summary: classification.summary,
      isCodeFixable: classification.isCodeFixable,
      fileReferences: classification.fileReferences,
      failingTests: classification.failingTests,
    });
    
    // Track consecutive failures
    this.consecutiveTracker.recordFailure(classification.failureSignature);
    this.repairState = updateStateAfterFailure(this.repairState, classification.failureSignature);
    
    // Main repair loop
    let currentFailure = testFailure;
    let currentClassification = classification;
    
    while (this.repairState.repairRemaining > 0 && !this.cancelRequested) {
      // Check stop conditions
      const stopCheck = checkStopConditions(this.repairState, this.policy, {
        currentFailureSignature: currentClassification.failureSignature,
        isToolingEnvFailure: currentClassification.failureType === 'TOOLING_ENV',
        emptyDiffCount: this.emptyDiffCount,
        staleContextCount: this.staleContextCount,
      });
      
      if (stopCheck.shouldStop) {
        return this.createDecisionPoint(stopCheck.reason!, stopCheck.message!);
      }
      
      // Check for repeated failure (separate from stop conditions for explicit event)
      if (this.consecutiveTracker.hasRepeatedFailure(this.policy.maxConsecutiveSameFailure)) {
        await this.emitEvent('repeated_failure_detected', {
          missionId: this.missionId,
          failureSignature: currentClassification.failureSignature,
          occurrences: this.consecutiveTracker.getCount(),
        });
        
        return this.createDecisionPoint(
          'repeated_failure',
          `Same failure occurred ${this.consecutiveTracker.getCount()} consecutive times`
        );
      }
      
      // Attempt one repair iteration
      const outcome = await this.attemptRepairIteration(
        currentClassification,
        allowedScope,
        approvedTestCommand
      );
      
      // Handle iteration outcome
      switch (outcome.result) {
        case 'applied_and_passed':
          // Success! Exit repair loop
          this.repairState.isActive = false;
          return null;
          
        case 'applied_and_failed':
          // Re-classify the new failure
          if (this.runTests) {
            const newFailure = await this.runTests(approvedTestCommand);
            if (!newFailure) {
              // Tests passed on rerun
              this.repairState.isActive = false;
              return null;
            }
            currentFailure = newFailure;
            currentClassification = classifyFailure(newFailure.rawOutput);
            
            // Track the new failure
            this.consecutiveTracker.recordFailure(currentClassification.failureSignature);
            this.repairState = updateStateAfterFailure(
              this.repairState, 
              currentClassification.failureSignature
            );
            
            // Emit classification
            await this.emitEvent('failure_classified', {
              missionId: this.missionId,
              failureType: currentClassification.failureType,
              failureSignature: currentClassification.failureSignature,
              summary: currentClassification.summary,
            });
          }
          // Continue loop
          break;
          
        case 'no_fix_found':
          this.emptyDiffCount++;
          // Continue if we have budget
          break;
          
        case 'timeout_diagnosis':
        case 'timeout_diffgen':
          // Check if we should retry
          if (outcome.result === 'timeout_diagnosis') {
            const timeoutResult = updateStateAfterDiagnosisTimeout(
              this.repairState,
              this.policy
            );
            this.repairState = timeoutResult.state;
            if (!timeoutResult.shouldRetry) {
              return this.createDecisionPoint(
                'diagnosis_timeout',
                'Diagnosis timed out after retry'
              );
            }
          } else {
            const timeoutResult = updateStateAfterDiffGenTimeout(
              this.repairState,
              this.policy
            );
            this.repairState = timeoutResult.state;
            if (!timeoutResult.shouldRetry) {
              return this.createDecisionPoint(
                'diffgen_timeout',
                'Diff generation timed out after retry'
              );
            }
          }
          // Retry the iteration
          break;
          
        case 'scope_denied':
          return this.createDecisionPoint(
            'scope_expansion_denied',
            'Required scope expansion was denied'
          );
          
        case 'paused':
          return this.createDecisionPoint(
            'budget_exhausted',
            outcome.error || 'Repair was paused'
          );
      }
    }
    
    // Budget exhausted
    return this.createDecisionPoint(
      'budget_exhausted',
      `Repair budget exhausted after ${this.policy.maxRepairIterations} iterations`
    );
  }
  
  /**
   * Request cancellation
   */
  cancel(): void {
    this.cancelRequested = true;
  }
  
  /**
   * Get current repair state
   */
  getState(): RepairLoopState {
    return this.repairState;
  }
  
  /**
   * Grant additional repair iterations (user decision)
   */
  grantAdditionalIterations(count: number = 1): void {
    this.repairState.repairRemaining += count;
  }
  
  /**
   * Reset consecutive failure tracking (user decision to try different approach)
   */
  resetFailureTracking(): void {
    this.consecutiveTracker.reset();
    this.repairState.consecutiveSameFailure = 0;
  }
  
  // ==========================================================================
  // REPAIR ITERATION
  // ==========================================================================
  
  /**
   * Execute one repair iteration
   */
  private async attemptRepairIteration(
    classification: FailureClassification,
    allowedScope: string[],
    testCommand: string
  ): Promise<RepairIterationOutcome> {
    const iterationNumber = this.repairState.currentIteration + 1;
    
    // Emit repair_attempt_started
    await this.emitEvent('repair_attempt_started', {
      missionId: this.missionId,
      attempt: iterationNumber,
      remaining: this.repairState.repairRemaining,
      failureSignature: classification.failureSignature,
    });
    
    this.repairState.iterationStartedAt = new Date().toISOString();
    
    // Build repair context
    const repairContext = this.buildRepairContext(classification, allowedScope);
    
    // Check if we need scope expansion
    const neededFiles = [
      ...classification.fileReferences,
      ...(classification.failingTests.length > 0 ? ['test file'] : []),
    ].filter(f => !allowedScope.includes(f));
    
    if (neededFiles.length > 0) {
      // Request scope expansion
      await this.emitEvent('scope_expansion_requested', {
        missionId: this.missionId,
        files: neededFiles,
        reason: 'repair',
      });
      
      // Request approval
      const approval = await this.approvalManager.requestApproval(
        this.taskId,
        'MISSION',
        'repair',
        'scope_expansion',
        `Repair needs access to: ${neededFiles.slice(0, 3).join(', ')}${neededFiles.length > 3 ? '...' : ''}`,
        {
          files: neededFiles,
          reason: 'repair',
          mission_id: this.missionId,
        }
      );
      
      if (approval.decision !== 'approved') {
        await this.emitEvent('repair_attempt_completed', {
          missionId: this.missionId,
          attempt: iterationNumber,
          result: 'scope_denied',
          failureSignature: classification.failureSignature,
        });
        
        return { result: 'scope_denied', failureClassification: classification };
      }
      
      // Add to allowed scope
      this.repairState.expandedScopeFiles.push(...neededFiles);
      repairContext.scopeFiles.push(...neededFiles);
    }
    
    // Generate repair diff (with timeout)
    let diffProposal: RepairDiffProposal | null = null;
    
    if (this.generateRepairDiff) {
      try {
        const timeoutPromise = new Promise<null>((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), this.policy.repairDiffGenTimeoutMs);
        });
        
        diffProposal = await Promise.race([
          this.generateRepairDiff(classification, repairContext),
          timeoutPromise,
        ]) as RepairDiffProposal | null;
      } catch (error) {
        if ((error as Error).message === 'timeout') {
          await this.emitEvent('repair_attempt_completed', {
            missionId: this.missionId,
            attempt: iterationNumber,
            result: 'timeout_diffgen',
            failureSignature: classification.failureSignature,
          });
          
          return { result: 'timeout_diffgen', failureClassification: classification };
        }
        throw error;
      }
    }
    
    // Handle empty diff
    if (!diffProposal || !diffProposal.unifiedDiff || diffProposal.unifiedDiff.trim() === '') {
      await this.emitEvent('repair_attempt_completed', {
        missionId: this.missionId,
        attempt: iterationNumber,
        result: 'no_fix_found',
        failureSignature: classification.failureSignature,
      });
      
      // Decrement remaining for meaningful attempt
      this.repairState = updateStateAfterDiffApplied(this.repairState);
      
      return { 
        result: 'no_fix_found', 
        failureClassification: classification 
      };
    }
    
    // Check if diff touches out-of-scope files
    const outOfScopeFiles = diffProposal.filesAffected.filter(
      f => !allowedScope.includes(f) && !this.repairState.expandedScopeFiles.includes(f)
    );
    
    if (outOfScopeFiles.length > 0) {
      // Request scope expansion for diff
      await this.emitEvent('scope_expansion_requested', {
        missionId: this.missionId,
        files: outOfScopeFiles,
        reason: 'repair_diff_out_of_scope',
      });
      
      const approval = await this.approvalManager.requestApproval(
        this.taskId,
        'MISSION',
        'repair',
        'scope_expansion',
        `Repair diff touches out-of-scope files: ${outOfScopeFiles.slice(0, 3).join(', ')}`,
        {
          files: outOfScopeFiles,
          reason: 'repair_diff_out_of_scope',
          mission_id: this.missionId,
        }
      );
      
      if (approval.decision !== 'approved') {
        await this.emitEvent('repair_attempt_completed', {
          missionId: this.missionId,
          attempt: iterationNumber,
          result: 'scope_denied',
          failureSignature: classification.failureSignature,
        });
        
        return { result: 'scope_denied', diffProposal };
      }
      
      this.repairState.expandedScopeFiles.push(...outOfScopeFiles);
    }
    
    // Emit diff_proposed and request approval
    await this.emitEvent('diff_proposed', {
      diffId: diffProposal.diffId,
      missionId: this.missionId,
      kind: 'repair',
      attempt: iterationNumber,
      filesAffected: diffProposal.filesAffected,
      summary: diffProposal.summary,
    });
    
    const diffApproval = await this.approvalManager.requestApproval(
      this.taskId,
      'MISSION',
      'repair',
      'apply_diff',
      `Apply repair diff: ${diffProposal.summary}`,
      {
        diff_id: diffProposal.diffId,
        mission_id: this.missionId,
        files: diffProposal.filesAffected,
        attempt: iterationNumber,
      }
    );
    
    if (diffApproval.decision !== 'approved') {
      await this.emitEvent('repair_attempt_completed', {
        missionId: this.missionId,
        attempt: iterationNumber,
        result: 'paused',
        failureSignature: classification.failureSignature,
      });
      
      return { 
        result: 'paused', 
        diffProposal,
        error: 'Diff approval denied',
      };
    }
    
    // Apply the diff
    let applySuccess = false;
    if (this.applyDiff) {
      applySuccess = await this.applyDiff(diffProposal);
    }
    
    if (!applySuccess) {
      await this.emitEvent('repair_attempt_completed', {
        missionId: this.missionId,
        attempt: iterationNumber,
        result: 'paused',
        failureSignature: classification.failureSignature,
        error: 'Failed to apply diff',
      });
      
      return { 
        result: 'paused', 
        diffProposal,
        error: 'Failed to apply diff',
      };
    }
    
    // Emit diff_applied
    await this.emitEvent('diff_applied', {
      diffId: diffProposal.diffId,
      missionId: this.missionId,
      filesChanged: diffProposal.filesAffected,
    });
    
    // Decrement repair budget ONLY after diff is applied
    this.repairState = updateStateAfterDiffApplied(this.repairState);
    
    // Rerun tests (auto-approved if in allowlist per policy)
    if (this.runTests && this.policy.allowAutoRerunAllowlistedTests) {
      const testResult = await this.runTests(testCommand);
      
      if (!testResult) {
        // Tests passed!
        await this.emitEvent('repair_attempt_completed', {
          missionId: this.missionId,
          attempt: iterationNumber,
          result: 'applied_and_passed',
          failureSignature: classification.failureSignature,
          diffId: diffProposal.diffId,
        });
        
        return { result: 'applied_and_passed', diffProposal };
      }
      
      // Tests still failing
      await this.emitEvent('repair_attempt_completed', {
        missionId: this.missionId,
        attempt: iterationNumber,
        result: 'applied_and_failed',
        failureSignature: classification.failureSignature,
        diffId: diffProposal.diffId,
      });
      
      return { result: 'applied_and_failed', diffProposal };
    }
    
    // No test runner configured - assume applied successfully
    await this.emitEvent('repair_attempt_completed', {
      missionId: this.missionId,
      attempt: iterationNumber,
      result: 'applied_and_failed',
      failureSignature: classification.failureSignature,
      diffId: diffProposal.diffId,
    });
    
    return { result: 'applied_and_failed', diffProposal };
  }
  
  // ==========================================================================
  // HELPERS
  // ==========================================================================
  
  /**
   * Build repair context from failure classification
   */
  private buildRepairContext(
    classification: FailureClassification,
    allowedScope: string[]
  ): RepairContext {
    const context: RepairContext = {
      scopeFiles: [...allowedScope],
      referencedSourceFiles: classification.fileReferences.filter(
        f => !f.includes('.test.') && !f.includes('.spec.')
      ),
      configFiles: [],
    };
    
    // Identify failing test file
    const testFile = classification.fileReferences.find(
      f => f.includes('.test.') || f.includes('.spec.')
    );
    if (testFile) {
      context.failingTestFile = testFile;
    }
    
    // Add relevant config files based on failure type
    switch (classification.failureType) {
      case 'TYPECHECK':
        context.configFiles.push('tsconfig.json');
        break;
      case 'LINT':
        context.configFiles.push('.eslintrc.js', '.eslintrc.json', 'eslint.config.js');
        break;
      case 'TEST_ASSERTION':
        context.configFiles.push('jest.config.js', 'vitest.config.ts', 'vitest.config.js');
        break;
    }
    
    return context;
  }
  
  /**
   * Create a decision point for user
   */
  private createDecisionPoint(reason: StopReason, message: string): DecisionPoint {
    const options = generateDecisionOptions(reason, {
      repairRemaining: this.repairState.repairRemaining,
      pendingScopeFiles: this.repairState.expandedScopeFiles,
    });
    
    return {
      reason,
      message,
      options,
      context: {
        iteration: this.repairState.currentIteration,
        remaining: this.repairState.repairRemaining,
        failureSignature: this.repairState.previousFailureSignature || undefined,
        pendingScopeFiles: this.repairState.expandedScopeFiles.length > 0 
          ? this.repairState.expandedScopeFiles 
          : undefined,
      },
    };
  }
  
  /**
   * Emit an event
   */
  private async emitEvent(
    type: EventType,
    payload: Record<string, unknown>
  ): Promise<void> {
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type,
      mode: 'MISSION',
      stage: 'repair',
      payload,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  SelfCorrectionPolicy,
  DEFAULT_SELF_CORRECTION_POLICY,
  RepairLoopState,
  createRepairLoopState,
  StopReason,
  DecisionOption,
  RepairAttemptResult,
} from './selfCorrectionPolicy';

export {
  classifyFailure,
  FailureClassification,
  FailureType,
  ConsecutiveFailureTracker,
  normalizeOutput,
} from './failureClassifier';
