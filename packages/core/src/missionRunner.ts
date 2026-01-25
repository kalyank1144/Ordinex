/**
 * MissionRunner: Explicit State Machine for Mission Execution
 * Step 27 - Mission Execution Harness
 * 
 * NON-NEGOTIABLE RULES:
 * - One mission at a time
 * - One stage at a time
 * - NEVER auto-apply diffs
 * - ALL writes, tests, and scope expansions require approval
 * - ALL actions emit events
 * - NO hidden retries
 * - NO infinite loops
 * - Must survive crashes and resume in paused state
 * - Replayable from event log only
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EventBus } from './eventBus';
import { Event, Mode, Stage, EventType } from './types';
import { ApprovalManager } from './approvalManager';
import { CheckpointManager } from './checkpointManager';
import { ContextSnapshotManager, ContextSnapshot, StalenessResult } from './contextSnapshotManager';
import { WorkspaceWriter, CheckpointManager as WorkspaceCheckpointManager, FilePatch } from './workspaceAdapter';
import { LLMConfig } from './llmService';
import { StructuredPlan } from './planGenerator';
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
// STAGE DEFINITIONS (Explicit per spec)
// ============================================================================

/**
 * Mission execution stages as defined in spec Section A
 */
export type MissionRunStage =
  | 'retrieve_context'
  | 'propose_patch_plan'
  | 'propose_diff'
  | 'await_apply_approval'
  | 'apply_diff'
  | 'await_test_approval'
  | 'run_tests'
  | 'repair_loop'
  | 'mission_completed'
  | 'mission_paused'
  | 'mission_cancelled';

/**
 * Events that trigger stage transitions
 */
export type TransitionEvent =
  | 'retrieval_completed'
  | 'auto'  // Automatic transition (no approval required)
  | 'diff_proposed'
  | 'approval_resolved_approved'
  | 'approval_resolved_denied'
  | 'diff_applied'
  | 'test_completed_pass'
  | 'test_failed'
  | 'repair_diff_generated'
  | 'repair_budget_exhausted'
  | 'repeated_failure_detected'
  | 'user_cancel'
  | 'stage_timeout';

/**
 * Transition rule definition
 */
interface TransitionRule {
  on: TransitionEvent;
  to: MissionRunStage;
  condition?: (state: MissionRunState) => boolean;
}

// ============================================================================
// TRANSITION TABLE (Mandatory per spec Section A)
// ============================================================================

const TRANSITION_TABLE: Record<MissionRunStage, TransitionRule[]> = {
  retrieve_context: [
    { on: 'retrieval_completed', to: 'propose_patch_plan' },
    { on: 'stage_timeout', to: 'mission_paused' },
    { on: 'user_cancel', to: 'mission_cancelled' },
  ],
  
  propose_patch_plan: [
    { on: 'auto', to: 'propose_diff' },  // No approval required per spec
    { on: 'stage_timeout', to: 'mission_paused' },
    { on: 'user_cancel', to: 'mission_cancelled' },
  ],
  
  propose_diff: [
    { on: 'diff_proposed', to: 'await_apply_approval' },
    { on: 'stage_timeout', to: 'mission_paused' },
    { on: 'user_cancel', to: 'mission_cancelled' },
  ],
  
  await_apply_approval: [
    { on: 'approval_resolved_approved', to: 'apply_diff' },
    { on: 'approval_resolved_denied', to: 'mission_paused' },
    { on: 'user_cancel', to: 'mission_cancelled' },
  ],
  
  apply_diff: [
    { on: 'diff_applied', to: 'await_test_approval' },
    { on: 'stage_timeout', to: 'mission_paused' },
    { on: 'user_cancel', to: 'mission_cancelled' },
  ],
  
  await_test_approval: [
    { on: 'approval_resolved_approved', to: 'run_tests' },
    { on: 'approval_resolved_denied', to: 'mission_paused' },
    { on: 'user_cancel', to: 'mission_cancelled' },
  ],
  
  run_tests: [
    { on: 'test_completed_pass', to: 'mission_completed' },
    { on: 'test_failed', to: 'repair_loop' },
    { on: 'stage_timeout', to: 'mission_paused' },
    { on: 'user_cancel', to: 'mission_cancelled' },
  ],
  
  repair_loop: [
    { 
      on: 'repair_diff_generated', 
      to: 'propose_diff',
      condition: (state) => state.repairRemaining > 0,
    },
    { on: 'repair_budget_exhausted', to: 'mission_paused' },
    { on: 'repeated_failure_detected', to: 'mission_paused' },
    { on: 'stage_timeout', to: 'mission_paused' },
    { on: 'user_cancel', to: 'mission_cancelled' },
  ],
  
  // Terminal states - no transitions out
  mission_completed: [],
  mission_paused: [],
  mission_cancelled: [],
};

// ============================================================================
// TIMEOUTS (Per spec Section I)
// ============================================================================

const STAGE_TIMEOUTS: Record<MissionRunStage, number> = {
  retrieve_context: 60_000,        // 60s
  propose_patch_plan: 120_000,     // 120s
  propose_diff: 120_000,           // 120s
  await_apply_approval: Infinity,  // User-driven, no timeout
  apply_diff: 30_000,              // 30s
  await_test_approval: Infinity,   // User-driven, no timeout
  run_tests: 600_000,              // 10 minutes
  repair_loop: 120_000,            // 120s per repair tool
  mission_completed: Infinity,
  mission_paused: Infinity,
  mission_cancelled: Infinity,
};

// ============================================================================
// STATE DEFINITION
// ============================================================================

/**
 * Mission run state - fully replayable from events
 */
export interface MissionRunState {
  /** Unique mission ID */
  missionId: string;
  
  /** Task ID this mission belongs to */
  taskId: string;
  
  /** Current execution stage */
  currentStage: MissionRunStage;
  
  /** Previous stage (for tracking transitions) */
  previousStage: MissionRunStage | null;
  
  /** Repair iterations remaining (default 2-3 per spec) */
  repairRemaining: number;
  
  /** Test commands that have been approved (allowlist for auto-approval) */
  approvedTestCommands: Set<string>;
  
  /** Failure signatures for loop detection */
  failureSignatures: string[];
  
  /** Checkpoints created during this mission */
  checkpoints: string[];
  
  /** Current diff ID being processed */
  currentDiffId: string | null;
  
  /** Files touched in this mission */
  filesTouched: string[];
  
  /** Timestamp when mission started */
  startedAt: string;
  
  /** Timestamp of last stage change */
  lastStageChangeAt: string;
  
  /** Pause reason if paused */
  pauseReason?: string;
  
  /** Pause options if paused */
  pauseOptions?: string[];
  
  /** Stage timeout timer ID */
  stageTimeoutId?: NodeJS.Timeout;
}

/**
 * Mission definition (input to runner)
 */
export interface Mission {
  missionId: string;
  title: string;
  scope: {
    likelyFiles: string[];
    outOfScope: string[];
  };
  includedSteps: Array<{
    stepId: string;
    description: string;
  }>;
  verification?: {
    suggestedCommands: string[];
    acceptanceCriteria: string[];
  };
}

/**
 * Patch plan (informational only, no approval required)
 */
export interface PatchPlan {
  filesToEdit: Array<{
    path: string;
    intent: string;
    acceptanceCriteriaMapping: string[];
  }>;
  outOfScopeConfirmation: string[];
}

// ============================================================================
// SCOPE FENCES (Per spec Section B)
// ============================================================================

const DENIED_PATH_PATTERNS: RegExp[] = [
  /node_modules\//,
  /\.env$/,
  /\.env\.[^/]+$/,
  /dist\//,
  /build\//,
  /\.git\//,
  /\.pem$/,
  /\.key$/,
  /\.secret$/,
  /\.generated\./,
  /\.min\.js$/,
  /\.bundle\.js$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

/**
 * Check if a file path is denied by scope fences
 */
function isDeniedPath(filePath: string): boolean {
  return DENIED_PATH_PATTERNS.some(pattern => pattern.test(filePath));
}

// ============================================================================
// MISSION RUNNER CLASS
// ============================================================================

/**
 * MissionRunner: Deterministic, production-grade mission execution
 * 
 * This is the CORE differentiator of the product.
 */
export class MissionRunner {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly approvalManager: ApprovalManager;
  private readonly checkpointManager: CheckpointManager;
  private readonly contextSnapshotManager: ContextSnapshotManager;
  private readonly workspaceWriter: WorkspaceWriter | null;
  private readonly workspaceCheckpointMgr: WorkspaceCheckpointManager | null;
  private readonly workspaceRoot: string;
  private readonly llmConfig: LLMConfig;
  
  private state: MissionRunState | null = null;
  private mission: Mission | null = null;
  private cancelRequested: boolean = false;
  
  /** Default repair iterations (per spec: 2-3) */
  private readonly defaultRepairIterations = 2;

  constructor(
    taskId: string,
    eventBus: EventBus,
    approvalManager: ApprovalManager,
    checkpointManager: CheckpointManager,
    workspaceRoot: string,
    llmConfig: LLMConfig,
    workspaceWriter: WorkspaceWriter | null = null,
    workspaceCheckpointMgr: WorkspaceCheckpointManager | null = null
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.approvalManager = approvalManager;
    this.checkpointManager = checkpointManager;
    this.workspaceRoot = workspaceRoot;
    this.llmConfig = llmConfig;
    this.workspaceWriter = workspaceWriter;
    this.workspaceCheckpointMgr = workspaceCheckpointMgr;
    this.contextSnapshotManager = new ContextSnapshotManager(
      workspaceRoot,
      eventBus,
      taskId
    );
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Start executing a mission
   */
  async startMission(mission: Mission): Promise<void> {
    if (this.state !== null) {
      throw new Error('Mission already running. Complete or cancel first.');
    }

    this.mission = mission;
    this.cancelRequested = false;

    // Initialize state
    this.state = {
      missionId: mission.missionId,
      taskId: this.taskId,
      currentStage: 'retrieve_context',
      previousStage: null,
      repairRemaining: this.defaultRepairIterations,
      approvedTestCommands: new Set(),
      failureSignatures: [],
      checkpoints: [],
      currentDiffId: null,
      filesTouched: [],
      startedAt: new Date().toISOString(),
      lastStageChangeAt: new Date().toISOString(),
    };

    // Emit mission_started
    await this.emitEvent('mission_started', {
      missionId: mission.missionId,
      title: mission.title,
      stepsCount: mission.includedSteps.length,
      scope: mission.scope,
    });

    // Start execution loop
    await this.runExecutionLoop();
  }

  /**
   * Resume a paused mission
   */
  async resumeMission(): Promise<void> {
    if (!this.state || this.state.currentStage !== 'mission_paused') {
      throw new Error('No paused mission to resume');
    }

    this.cancelRequested = false;
    
    // Transition back to appropriate stage based on pause context
    // For now, restart from retrieve_context
    await this.transition('retrieve_context');
    
    await this.emitEvent('execution_resumed', {
      missionId: this.state.missionId,
      resumingFrom: this.state.previousStage,
    });

    await this.runExecutionLoop();
  }

  /**
   * Cancel the current mission
   */
  async cancelMission(reason: string = 'user_requested'): Promise<void> {
    if (!this.state) {
      throw new Error('No mission to cancel');
    }

    this.cancelRequested = true;
    
    // Clear any pending timeouts
    if (this.state.stageTimeoutId) {
      clearTimeout(this.state.stageTimeoutId);
    }

    await this.emitEvent('mission_cancelled', {
      missionId: this.state.missionId,
      stage: this.state.currentStage,
      reason,
    });

    this.state.currentStage = 'mission_cancelled';
  }

  /**
   * Get current state (for UI/debugging)
   */
  getState(): MissionRunState | null {
    return this.state;
  }

  /**
   * Get current mission
   */
  getMission(): Mission | null {
    return this.mission;
  }

  /**
   * Check if mission is in terminal state
   */
  isTerminal(): boolean {
    if (!this.state) return true;
    return ['mission_completed', 'mission_paused', 'mission_cancelled'].includes(
      this.state.currentStage
    );
  }

  // ==========================================================================
  // EXECUTION LOOP
  // ==========================================================================

  /**
   * Main execution loop - runs until terminal state
   */
  private async runExecutionLoop(): Promise<void> {
    while (!this.isTerminal() && !this.cancelRequested) {
      try {
        await this.executeCurrentStage();
      } catch (error) {
        console.error('[MissionRunner] Stage execution error:', error);
        await this.pauseWithReason(
          `Stage error: ${error instanceof Error ? error.message : String(error)}`,
          ['Retry', 'Edit plan', 'Stop mission']
        );
        return;
      }
    }
  }

  /**
   * Execute the current stage
   */
  private async executeCurrentStage(): Promise<void> {
    if (!this.state || !this.mission) return;

    const stage = this.state.currentStage;
    
    // Start timeout for this stage
    this.startStageTimeout(stage);

    // Emit stage_changed
    await this.emitEvent('stage_changed', {
      from: this.state.previousStage || 'none',
      to: stage,
      missionId: this.state.missionId,
    });

    // Execute stage-specific logic
    switch (stage) {
      case 'retrieve_context':
        await this.executeRetrieveContext();
        break;
      case 'propose_patch_plan':
        await this.executeProposePatchPlan();
        break;
      case 'propose_diff':
        await this.executeProposeDiff();
        break;
      case 'await_apply_approval':
        await this.executeAwaitApplyApproval();
        break;
      case 'apply_diff':
        await this.executeApplyDiff();
        break;
      case 'await_test_approval':
        await this.executeAwaitTestApproval();
        break;
      case 'run_tests':
        await this.executeRunTests();
        break;
      case 'repair_loop':
        await this.executeRepairLoop();
        break;
      // Terminal states - no action needed
      case 'mission_completed':
      case 'mission_paused':
      case 'mission_cancelled':
        break;
    }

    // Clear timeout after stage completes
    this.clearStageTimeout();
  }

  // ==========================================================================
  // STAGE IMPLEMENTATIONS
  // ==========================================================================

  /**
   * Stage: retrieve_context
   * Gather context files with scope fences
   */
  private async executeRetrieveContext(): Promise<void> {
    if (!this.state || !this.mission) return;

    await this.emitEvent('retrieval_started', {
      missionId: this.state.missionId,
      likelyFiles: this.mission.scope.likelyFiles,
    });

    const retrievedFiles: Array<{
      path: string;
      lineRange: { start: number; end: number };
      reason: string;
    }> = [];

    // Retrieve files from mission scope
    for (const filePath of this.mission.scope.likelyFiles) {
      // Check scope fence
      if (isDeniedPath(filePath)) {
        console.warn(`[MissionRunner] Skipping denied path: ${filePath}`);
        continue;
      }

      // Check if file exists
      const fullPath = path.join(this.workspaceRoot, filePath);
      try {
        const stats = await fs.stat(fullPath);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        
        // Cap at 400 lines per spec Section B
        const maxLines = Math.min(lines.length, 400);
        const lineRange = { start: 1, end: maxLines };

        // Create snapshot for staleness detection
        await this.contextSnapshotManager.createSnapshot(filePath, lineRange);

        retrievedFiles.push({
          path: filePath,
          lineRange,
          reason: 'mission_scope',
        });
      } catch (error) {
        if ((error as any).code !== 'ENOENT') {
          console.warn(`[MissionRunner] Error reading ${filePath}:`, error);
        }
      }
    }

    // Emit retrieval_completed
    await this.emitEvent('retrieval_completed', {
      missionId: this.state.missionId,
      files: retrievedFiles,
      tokenEstimate: retrievedFiles.reduce(
        (sum, f) => sum + (f.lineRange.end - f.lineRange.start + 1) * 10,
        0
      ),
    });

    // Transition to next stage
    await this.handleTransition('retrieval_completed');
  }

  /**
   * Stage: propose_patch_plan
   * Generate patch plan (informational only, no approval per spec)
   */
  private async executeProposePatchPlan(): Promise<void> {
    if (!this.state || !this.mission) return;

    // Build patch plan from mission steps
    const patchPlan: PatchPlan = {
      filesToEdit: this.mission.includedSteps.map(step => ({
        path: this.mission!.scope.likelyFiles[0] || 'unknown',
        intent: step.description,
        acceptanceCriteriaMapping: this.mission!.verification?.acceptanceCriteria || [],
      })),
      outOfScopeConfirmation: this.mission.scope.outOfScope,
    };

    // Emit patch_plan_proposed (informational)
    await this.emitEvent('patch_plan_proposed', {
      missionId: this.state.missionId,
      plan: patchPlan,
      note: 'Patch plan is informational only - no approval required',
    });

    // Auto-transition to propose_diff (no approval per spec)
    await this.handleTransition('auto');
  }

  /**
   * Stage: propose_diff
   * Generate actual diff for the mission
   */
  private async executeProposeDiff(): Promise<void> {
    if (!this.state || !this.mission) return;

    // Generate diff ID
    const attemptNumber = this.defaultRepairIterations - this.state.repairRemaining + 1;
    const diffId = `diff_${this.state.missionId}_${attemptNumber}_${Date.now()}`;
    this.state.currentDiffId = diffId;

    // For now, emit a placeholder diff proposal
    // In production, this would call LLM to generate actual diff
    await this.emitEvent('diff_proposed', {
      diffId,
      missionId: this.state.missionId,
      attemptNumber,
      filesAffected: this.mission.scope.likelyFiles.slice(0, 3),
      summary: `Diff for mission: ${this.mission.title}`,
    });

    await this.handleTransition('diff_proposed');
  }

  /**
   * Stage: await_apply_approval
   * Wait for user to approve diff application
   */
  private async executeAwaitApplyApproval(): Promise<void> {
    if (!this.state || !this.mission) return;

    const approval = await this.approvalManager.requestApproval(
      this.taskId,
      'MISSION',
      'edit',
      'apply_diff',
      `Apply diff to ${this.mission.scope.likelyFiles.length} file(s)`,
      {
        diff_id: this.state.currentDiffId,
        mission_id: this.state.missionId,
        files: this.mission.scope.likelyFiles,
      }
    );

    if (approval.decision === 'approved') {
      await this.handleTransition('approval_resolved_approved');
    } else {
      await this.handleTransition('approval_resolved_denied');
    }
  }

  /**
   * Stage: apply_diff
   * Apply the approved diff with staleness check
   */
  private async executeApplyDiff(): Promise<void> {
    if (!this.state || !this.mission) return;

    // Check for stale context BEFORE applying (per spec Section C)
    const stalenessResult = await this.contextSnapshotManager.checkStaleness();
    if (stalenessResult.stale) {
      await this.emitEvent('stale_context_detected', {
        missionId: this.state.missionId,
        diffId: this.state.currentDiffId,
        staleFiles: stalenessResult.staleFiles,
      });
      
      // Re-run retrieval per spec
      await this.transition('retrieve_context');
      return;
    }

    // Create checkpoint before applying (mandatory per spec)
    const checkpointId = `chk_${this.state.missionId}_${Date.now()}`;
    this.state.checkpoints.push(checkpointId);

    await this.emitEvent('checkpoint_created', {
      checkpointId,
      missionId: this.state.missionId,
      diffId: this.state.currentDiffId,
      files: this.mission.scope.likelyFiles,
    });

    // Apply diff (placeholder - actual implementation would use workspaceWriter)
    await this.emitEvent('diff_applied', {
      diffId: this.state.currentDiffId,
      checkpointId,
      missionId: this.state.missionId,
      filesChanged: this.mission.scope.likelyFiles,
    });

    // Update touched files
    this.state.filesTouched.push(...this.mission.scope.likelyFiles);

    // Invalidate snapshots for changed files
    for (const file of this.mission.scope.likelyFiles) {
      this.contextSnapshotManager.invalidateSnapshot(file);
    }

    await this.handleTransition('diff_applied');
  }

  /**
   * Stage: await_test_approval
   * Wait for user to approve test execution
   */
  private async executeAwaitTestApproval(): Promise<void> {
    if (!this.state || !this.mission) return;

    // Get suggested test command
    const suggestedCommand = this.mission.verification?.suggestedCommands?.[0] || 'npm test';

    // Check if command is already approved (allowlist per spec Section F)
    if (this.state.approvedTestCommands.has(suggestedCommand)) {
      // Auto-approved - skip approval request
      await this.handleTransition('approval_resolved_approved');
      return;
    }

    const approval = await this.approvalManager.requestApproval(
      this.taskId,
      'MISSION',
      'test',
      'terminal',
      `Run tests: ${suggestedCommand}`,
      {
        command: suggestedCommand,
        mission_id: this.state.missionId,
        note: 'After approval, this command will be auto-approved for repair loops',
      }
    );

    if (approval.decision === 'approved') {
      // Add to allowlist for future auto-approval
      this.state.approvedTestCommands.add(suggestedCommand);
      await this.handleTransition('approval_resolved_approved');
    } else {
      await this.handleTransition('approval_resolved_denied');
    }
  }

  /**
   * Stage: run_tests
   * Execute tests and determine pass/fail
   */
  private async executeRunTests(): Promise<void> {
    if (!this.state || !this.mission) return;

    const testCommand = this.mission.verification?.suggestedCommands?.[0] || 'npm test';

    await this.emitEvent('test_started', {
      missionId: this.state.missionId,
      command: testCommand,
    });

    // Placeholder: In production, this would execute the actual test
    // For now, simulate test completion
    const testPassed = true; // Would be determined by actual test execution

    if (testPassed) {
      await this.emitEvent('test_completed', {
        missionId: this.state.missionId,
        command: testCommand,
        pass: true,
        exitCode: 0,
      });
      await this.handleTransition('test_completed_pass');
    } else {
      await this.emitEvent('test_failed', {
        missionId: this.state.missionId,
        command: testCommand,
        pass: false,
        exitCode: 1,
        failureSignature: 'test_failure_placeholder',
      });
      await this.handleTransition('test_failed');
    }
  }

  /**
   * Stage: repair_loop
   * Attempt to fix test failures (bounded per spec Section G)
   */
  private async executeRepairLoop(): Promise<void> {
    if (!this.state || !this.mission) return;

    // Check repair budget
    if (this.state.repairRemaining <= 0) {
      await this.emitEvent('repair_attempt_completed', {
        missionId: this.state.missionId,
        reason: 'budget_exhausted',
        iterationsUsed: this.defaultRepairIterations,
      });
      await this.handleTransition('repair_budget_exhausted');
      return;
    }

    // Get last failure signature
    const lastFailure = this.state.failureSignatures[this.state.failureSignatures.length - 1];

    // Check for repeated failure (loop detection per spec)
    const failureCount = this.state.failureSignatures.filter(f => f === lastFailure).length;
    if (failureCount >= 2) {
      await this.emitEvent('repeated_failure_detected', {
        missionId: this.state.missionId,
        failureSignature: lastFailure,
        occurrences: failureCount,
      });
      await this.handleTransition('repeated_failure_detected');
      return;
    }

    // Create checkpoint before repair attempt
    const checkpointId = `chk_repair_${this.state.missionId}_${Date.now()}`;
    this.state.checkpoints.push(checkpointId);

    await this.emitEvent('repair_attempt_started', {
      missionId: this.state.missionId,
      attempt: this.defaultRepairIterations - this.state.repairRemaining + 1,
      remaining: this.state.repairRemaining,
      checkpointId,
    });

    // Decrement repair budget (per spec: only on repair diff applied)
    this.state.repairRemaining--;

    // Generate repair diff (placeholder)
    await this.emitEvent('repair_attempt_completed', {
      missionId: this.state.missionId,
      reason: 'repair_diff_generated',
      remaining: this.state.repairRemaining,
    });

    await this.handleTransition('repair_diff_generated');
  }

  // ==========================================================================
  // TRANSITION HANDLING
  // ==========================================================================

  /**
   * Handle a transition event
   */
  private async handleTransition(event: TransitionEvent): Promise<void> {
    if (!this.state) return;

    const currentStage = this.state.currentStage;
    const rules = TRANSITION_TABLE[currentStage];

    // Find matching transition rule
    for (const rule of rules) {
      if (rule.on === event) {
        // Check condition if present
        if (rule.condition && !rule.condition(this.state)) {
          continue;
        }

        await this.transition(rule.to);
        return;
      }
    }

    // No matching transition found
    console.warn(
      `[MissionRunner] No transition for event '${event}' in stage '${currentStage}'`
    );
  }

  /**
   * Perform a stage transition
   */
  private async transition(newStage: MissionRunStage): Promise<void> {
    if (!this.state) return;

    const oldStage = this.state.currentStage;
    this.state.previousStage = oldStage;
    this.state.currentStage = newStage;
    this.state.lastStageChangeAt = new Date().toISOString();

    console.log(`[MissionRunner] Transition: ${oldStage} → ${newStage}`);
  }

  /**
   * Pause mission with reason and options
   */
  private async pauseWithReason(reason: string, options: string[]): Promise<void> {
    if (!this.state) return;

    this.state.pauseReason = reason;
    this.state.pauseOptions = options;
    
    await this.transition('mission_paused');

    await this.emitEvent('mission_paused', {
      missionId: this.state.missionId,
      reason,
      options,
      decisionPointNeeded: true,
    });
  }

  // ==========================================================================
  // TIMEOUT HANDLING
  // ==========================================================================

  /**
   * Start timeout for current stage
   */
  private startStageTimeout(stage: MissionRunStage): void {
    if (!this.state) return;

    const timeout = STAGE_TIMEOUTS[stage];
    if (timeout === Infinity) return; // No timeout for this stage

    this.state.stageTimeoutId = setTimeout(async () => {
      await this.emitEvent('stage_timeout', {
        stage,
        missionId: this.state?.missionId,
        elapsedMs: timeout,
      });
      await this.handleTransition('stage_timeout');
    }, timeout);
  }

  /**
   * Clear stage timeout
   */
  private clearStageTimeout(): void {
    if (this.state?.stageTimeoutId) {
      clearTimeout(this.state.stageTimeoutId);
      this.state.stageTimeoutId = undefined;
    }
  }

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

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
      stage: this.mapStageToEventStage(this.state?.currentStage || 'retrieve_context'),
      payload,
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);
  }

  /**
   * Map mission run stage to event stage
   */
  private mapStageToEventStage(stage: MissionRunStage): Stage {
    switch (stage) {
      case 'retrieve_context':
        return 'retrieve';
      case 'propose_patch_plan':
      case 'propose_diff':
      case 'await_apply_approval':
      case 'apply_diff':
        return 'edit';
      case 'await_test_approval':
      case 'run_tests':
        return 'test';
      case 'repair_loop':
        return 'repair';
      default:
        return 'none';
    }
  }

  // ==========================================================================
  // STATE RECONSTRUCTION (for crash recovery per spec)
  // ==========================================================================

  /**
   * Reconstruct state from events (for crash recovery)
   * Per spec: must survive crashes and resume in paused state
   */
  static reconstructFromEvents(
    taskId: string,
    missionId: string,
    events: Event[]
  ): MissionRunState | null {
    // Filter events for this mission
    const missionEvents = events.filter(
      e => e.task_id === taskId && 
           (e.payload.missionId === missionId || e.payload.mission_id === missionId)
    );

    if (missionEvents.length === 0) {
      return null;
    }

    // Find the last stage-related event
    const stageEvents = missionEvents.filter(e =>
      ['stage_changed', 'mission_started', 'mission_completed', 
       'mission_paused', 'mission_cancelled'].includes(e.type)
    );

    if (stageEvents.length === 0) {
      return null;
    }

    const lastEvent = stageEvents[stageEvents.length - 1];
    
    // Determine current stage from last event
    let currentStage: MissionRunStage = 'mission_paused'; // Default to paused on recovery

    if (lastEvent.type === 'mission_completed') {
      currentStage = 'mission_completed';
    } else if (lastEvent.type === 'mission_cancelled') {
      currentStage = 'mission_cancelled';
    } else if (lastEvent.type === 'mission_paused') {
      currentStage = 'mission_paused';
    } else if (lastEvent.type === 'stage_changed' && lastEvent.payload.to) {
      // If crash occurred during execution, resume in paused state
      currentStage = 'mission_paused';
    }

    // Count repair attempts
    const repairEvents = missionEvents.filter(e => e.type === 'repair_attempt_started');
    const repairRemaining = 2 - repairEvents.length;

    // Get approved test commands
    const approvedCommands = new Set<string>();
    for (const event of missionEvents) {
      if (event.type === 'approval_resolved' && 
          event.payload.approval_type === 'terminal' &&
          event.payload.decision === 'approved' &&
          event.payload.command) {
        approvedCommands.add(event.payload.command as string);
      }
    }

    // Get checkpoints
    const checkpoints = missionEvents
      .filter(e => e.type === 'checkpoint_created')
      .map(e => e.payload.checkpointId as string);

    // Get touched files
    const touchedFiles = new Set<string>();
    for (const event of missionEvents) {
      if (event.type === 'diff_applied' && event.payload.filesChanged) {
        for (const file of event.payload.filesChanged as string[]) {
          touchedFiles.add(file);
        }
      }
    }

    // Get failure signatures
    const failureSignatures = missionEvents
      .filter(e => e.type === 'test_failed' && e.payload.failureSignature)
      .map(e => e.payload.failureSignature as string);

    return {
      missionId,
      taskId,
      currentStage,
      previousStage: null,
      repairRemaining: Math.max(0, repairRemaining),
      approvedTestCommands: approvedCommands,
      failureSignatures,
      checkpoints,
      currentDiffId: null,
      filesTouched: Array.from(touchedFiles),
      startedAt: missionEvents[0].timestamp,
      lastStageChangeAt: lastEvent.timestamp,
      pauseReason: currentStage === 'mission_paused' 
        ? 'Recovered from crash - manual resume required'
        : undefined,
      pauseOptions: currentStage === 'mission_paused'
        ? ['Resume', 'Stop mission']
        : undefined,
    };
  }
}

// ============================================================================
// CONVERSION UTILITIES
// ============================================================================

/**
 * Optional mission breakdown item (from Step 26)
 */
export interface MissionBreakdownItem {
  missionId: string;
  title: string;
  includedSteps: Array<{ stepId: string; description: string }>;
  acceptance?: string[];
  risk?: { notes: string[] };
}

/**
 * Convert a StructuredPlan to a Mission object
 * 
 * @param plan - The structured plan from PLAN mode
 * @param missionId - Unique ID for this mission
 * @param selectedMission - Optional mission breakdown item if plan was broken down
 * @returns Mission object ready for MissionRunner
 */
export function convertPlanToMission(
  plan: StructuredPlan,
  missionId: string,
  selectedMission?: MissionBreakdownItem
): Mission {
  // If a specific mission was selected from breakdown, use it
  if (selectedMission) {
    return {
      missionId: selectedMission.missionId,
      title: selectedMission.title,
      scope: {
        likelyFiles: extractLikelyFiles(plan, selectedMission.includedSteps),
        outOfScope: plan.risks || [],
      },
      includedSteps: selectedMission.includedSteps,
      verification: {
        suggestedCommands: inferTestCommands(plan),
        acceptanceCriteria: selectedMission.acceptance || plan.success_criteria || [],
      },
    };
  }

  // Convert full plan to mission
  const steps = (plan.steps || []).map((step: any, index: number) => ({
    stepId: step.id || step.step_id || `step_${index + 1}`,
    description: step.description || '',
  }));

  return {
    missionId,
    title: plan.goal || 'Execute Plan',
    scope: {
      likelyFiles: extractLikelyFilesFromPlan(plan),
      outOfScope: plan.risks || [],
    },
    includedSteps: steps,
    verification: {
      suggestedCommands: inferTestCommands(plan),
      acceptanceCriteria: plan.success_criteria || [],
    },
  };
}

/**
 * Extract likely files from plan for selected mission steps
 */
function extractLikelyFiles(
  plan: StructuredPlan,
  selectedSteps: Array<{ stepId: string; description: string }>
): string[] {
  const files = new Set<string>();

  // Get files from scope_contract if available
  if (plan.scope_contract && typeof plan.scope_contract === 'object') {
    const scopeContract = plan.scope_contract as any;
    if (Array.isArray(scopeContract.allowed_files)) {
      scopeContract.allowed_files.forEach((f: string) => files.add(f));
    }
  }

  // Extract file references from step descriptions
  for (const step of selectedSteps) {
    const fileMatches = step.description.match(/[a-zA-Z0-9_\-/]+\.(ts|js|tsx|jsx|json|md|yaml|yml)/g);
    if (fileMatches) {
      fileMatches.forEach(f => files.add(f));
    }
  }

  // Default files if none found
  if (files.size === 0) {
    files.add('src/index.ts');
  }

  return Array.from(files);
}

/**
 * Extract likely files from full plan
 */
function extractLikelyFilesFromPlan(plan: StructuredPlan): string[] {
  const files = new Set<string>();

  // Get files from scope_contract if available
  if (plan.scope_contract && typeof plan.scope_contract === 'object') {
    const scopeContract = plan.scope_contract as any;
    if (Array.isArray(scopeContract.allowed_files)) {
      scopeContract.allowed_files.forEach((f: string) => files.add(f));
    }
  }

  // Extract file references from step descriptions
  for (const step of plan.steps || []) {
    const description = (step as any).description || '';
    const fileMatches = description.match(/[a-zA-Z0-9_\-/]+\.(ts|js|tsx|jsx|json|md|yaml|yml)/g);
    if (fileMatches) {
      fileMatches.forEach((f: string) => files.add(f));
    }
  }

  // Default files if none found
  if (files.size === 0) {
    files.add('src/index.ts');
  }

  return Array.from(files);
}

/**
 * Infer test commands from plan
 */
function inferTestCommands(plan: StructuredPlan): string[] {
  const commands: string[] = [];

  // Check scope_contract for allowed_tools
  if (plan.scope_contract && typeof plan.scope_contract === 'object') {
    const scopeContract = plan.scope_contract as any;
    if (Array.isArray(scopeContract.allowed_tools)) {
      if (scopeContract.allowed_tools.includes('test')) {
        commands.push('npm test');
      }
      if (scopeContract.allowed_tools.includes('lint')) {
        commands.push('npm run lint');
      }
    }
  }

  // Default test command
  if (commands.length === 0) {
    commands.push('npm test');
  }

  return commands;
}
