/**
 * Mission Executor: Step-by-step plan execution for MISSION mode
 * Based on STEP 24 requirements
 * 
 * Requirements:
 * - Execute approved plans step-by-step (NOT all at once)
 * - Map plan steps to execution stages (retrieve/edit/test/repair)
 * - Emit events for all stages
 * - Create checkpoints before risky actions
 * - Support pause/resume
 * - No execution without approval
 * - Deterministic, predictable, safe
 */

import { EventBus } from './eventBus';
import { CheckpointManager } from './checkpointManager';
import { ApprovalManager } from './approvalManager';
import { Mode, Stage, Event } from './types';
import { StructuredPlan } from './planGenerator';
import { Retriever } from './retrieval/retriever';
import { DiffManager } from './diffManager';
import { TestRunner } from './testRunner';
import { RepairOrchestrator } from './repairOrchestrator';
import { LLMService, LLMConfig } from './llmService';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
// New imports for spec-compliant EDIT flow
import { selectEditContext, buildBaseShaMap, FileContextEntry } from './excerptSelector';
import { LLMEditTool, DEFAULT_EDIT_CONSTRAINTS, DEFAULT_PRECONDITIONS, LLMEditStepInput } from './llmEditTool';
import { TruncationSafeExecutor, createTruncationSafeExecutor, TruncationSafeConfig } from './truncationSafeExecutor';
import { createDiffId, createCheckpointId } from './atomicDiffApply';
import { EditEvidenceManager, buildDiffProposedPayload, buildDiffAppliedPayload } from './editEvidenceManager';
import { ParsedDiff } from './unifiedDiffParser';
import { WorkspaceWriter, CheckpointManager as WorkspaceCheckpointManager, FilePatch } from './workspaceAdapter';
import { computeFullSha } from './shaUtils';
import { validateFileOperations, classifyFileOperations } from './fileOperationClassifier';

/**
 * Execution state for MISSION mode
 */
interface MissionExecutionState {
  taskId: string;
  plan: StructuredPlan;
  missionId?: string;
  currentStepIndex: number;
  isPaused: boolean;
  isStopped: boolean;
  completedSteps: string[];
}

/**
 * Step execution result
 */
interface StepExecutionResult {
  success: boolean;
  stage: Stage;
  error?: string;
  shouldPause?: boolean;
  pauseReason?: string;
}

/**
 * MissionExecutor orchestrates step-by-step execution of approved plans
 * 
 * PHASE 4: Now accepts WorkspaceWriter and WorkspaceCheckpointManager for real file operations
 */
export class MissionExecutor {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly checkpointManager: CheckpointManager;
  private readonly approvalManager: ApprovalManager;
  private readonly retriever: Retriever | null;
  private readonly diffManager: DiffManager | null;
  private readonly testRunner: TestRunner | null;
  private readonly repairOrchestrator: RepairOrchestrator | null;
  private readonly workspaceRoot: string;
  private readonly llmConfig: LLMConfig;
  private readonly workspaceWriter: WorkspaceWriter | null;
  private readonly workspaceCheckpointMgr: WorkspaceCheckpointManager | null;
  private executionState: MissionExecutionState | null = null;
  private readonly mode: Mode = 'MISSION';
  private retrievalResults: Array<{ path: string; score: number }> = [];
  private appliedDiffIds = new Set<string>(); // Idempotency guard

  constructor(
    taskId: string,
    eventBus: EventBus,
    checkpointManager: CheckpointManager,
    approvalManager: ApprovalManager,
    workspaceRoot: string,
    llmConfig: LLMConfig,
    workspaceWriter: WorkspaceWriter | null = null,
    workspaceCheckpointMgr: WorkspaceCheckpointManager | null = null,
    retriever: Retriever | null = null,
    diffManager: DiffManager | null = null,
    testRunner: TestRunner | null = null,
    repairOrchestrator: RepairOrchestrator | null = null
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.checkpointManager = checkpointManager;
    this.approvalManager = approvalManager;
    this.workspaceRoot = workspaceRoot;
    this.llmConfig = llmConfig;
    this.workspaceWriter = workspaceWriter;
    this.workspaceCheckpointMgr = workspaceCheckpointMgr;
    this.retriever = retriever;
    this.diffManager = diffManager;
    this.testRunner = testRunner;
    this.repairOrchestrator = repairOrchestrator;
  }

  /**
   * Start MISSION execution from an approved plan
   * CRITICAL: Plan must be approved before calling this
   */
  async executePlan(
    plan: StructuredPlan,
    options?: { missionId?: string; emitMissionStarted?: boolean }
  ): Promise<void> {
    // Verify plan is provided
    if (!plan || !plan.steps || plan.steps.length === 0) {
      throw new Error('Invalid plan: no steps to execute');
    }

    // Initialize execution state
    this.executionState = {
      taskId: this.taskId,
      plan,
      missionId: options?.missionId,
      currentStepIndex: 0,
      isPaused: false,
      isStopped: false,
      completedSteps: [],
    };

    const shouldEmitMissionStarted = options?.emitMissionStarted !== false;
    if (shouldEmitMissionStarted) {
      // Emit mission_started
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'mission_started',
        mode: this.mode,
        stage: 'none',
        payload: {
          mission_id: options?.missionId,
          goal: plan.goal,
          steps_count: plan.steps.length,
          scope_contract: plan.scope_contract,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
    }

    // Execute steps sequentially
    try {
      await this.executeStepsSequentially();
      
      // If completed all steps successfully
      if (!this.executionState.isStopped && this.executionState.currentStepIndex >= plan.steps.length) {
        await this.completeMission();
      }
    } catch (error) {
      await this.handleExecutionFailure(error);
    }
  }

  /**
   * Execute steps one at a time sequentially
   */
  private async executeStepsSequentially(): Promise<void> {
    if (!this.executionState) {
      throw new Error('Execution state not initialized');
    }

    const { plan } = this.executionState;

    while (this.executionState.currentStepIndex < plan.steps.length) {
      // Check if paused or stopped
      if (this.executionState.isPaused) {
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'none',
          payload: {
            reason: 'manual_pause',
            current_step: this.executionState.currentStepIndex,
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        return;
      }

      if (this.executionState.isStopped) {
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_stopped',
          mode: this.mode,
          stage: 'none',
          payload: {
            reason: 'manual_stop',
            completed_steps: this.executionState.completedSteps.length,
            total_steps: plan.steps.length,
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        return;
      }

      // Execute current step
      const step = plan.steps[this.executionState.currentStepIndex];
      const result = await this.executeStep(step, this.executionState.currentStepIndex);

      if (!result.success) {
        // Step failed - executeStep() already emitted failure_detected and step_failed
        // Just stop execution here, don't emit duplicate failure events
        console.log('[MissionExecutor] Step failed, stopping execution:', result.error);
        this.executionState.isPaused = true;
        return;
      }

      if (result.shouldPause) {
        // Step requested pause (e.g., waiting for approval)
        // executeStep() already emitted execution_paused in this case
        console.log('[MissionExecutor] Step requested pause:', result.pauseReason);
        this.executionState.isPaused = true;
        return;
      }

      // Mark step as completed
      this.executionState.completedSteps.push(step.step_id);
      this.executionState.currentStepIndex++;
    }
  }

  /**
   * Execute a single plan step
   */
  private async executeStep(
    step: StructuredPlan['steps'][0],
    stepIndex: number
  ): Promise<StepExecutionResult> {
    const stepId = step.step_id;
    const description = step.description;

    // Determine stage from step description
    const stage = this.mapStepToStage(step);

    // Emit step_started
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'step_started',
      mode: this.mode,
      stage,
      payload: {
        step_id: stepId,
        step_index: stepIndex,
        description,
        stage,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Emit stage_changed if needed
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'stage_changed',
      mode: this.mode,
      stage,
      payload: {
        from: 'none',
        to: stage,
        step_id: stepId,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    try {
      // Execute based on stage
      let stageResult: StepExecutionResult;

      switch (stage) {
        case 'retrieve':
          stageResult = await this.executeRetrievalStep(step);
          break;
        case 'edit':
          stageResult = await this.executeEditStep(step);
          break;
        case 'test':
          stageResult = await this.executeTestStep(step);
          break;
        case 'repair':
          stageResult = await this.executeRepairStep(step);
          break;
        case 'plan':
        case 'none':
        default:
          // Analysis/planning steps don't require execution
          stageResult = { success: true, stage: 'plan' };
          break;
      }

      // PHASE 4: Emit step_completed ONLY on success, step_failed on failure
      if (stageResult.success) {
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'step_completed',
          mode: this.mode,
          stage,
          payload: {
            step_id: stepId,
            step_index: stepIndex,
            success: true,
          },
          evidence_ids: [],
          parent_event_id: null,
        });
      } else {
        // PHASE 3: Emit failure_detected for stage failures (not already emitted)
        // Check if stage already emitted failure (indicated by pauseReason)
        const alreadyEmittedFailure = stageResult.pauseReason && [
          'no_files_selected',
          'llm_cannot_edit',
          'invalid_diff_format',
          'empty_diff',
          'stale_context',
          'diff_rejected',
          'edit_step_error',
        ].includes(stageResult.pauseReason);

        if (!alreadyEmittedFailure) {
          // Generic failure - emit failure_detected here with detailed error
          console.error('[MissionExecutor] Step failed:', {
            stepId,
            stage,
            error: stageResult.error,
            pauseReason: stageResult.pauseReason,
            shouldPause: stageResult.shouldPause
          });

          await this.emitEvent({
            event_id: randomUUID(),
            task_id: this.taskId,
            timestamp: new Date().toISOString(),
            type: 'failure_detected',
            mode: this.mode,
            stage,
            payload: {
              reason: 'step_execution_failed',
              step_id: stepId,
              error: stageResult.error || 'Step execution failed',
              error_details: stageResult.pauseReason || stageResult.error,
              error_type: stageResult.pauseReason,
              stage,
            },
            evidence_ids: [],
            parent_event_id: null,
          });
        }

        // Emit step_failed to clearly terminate step
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'step_failed',
          mode: this.mode,
          stage,
          payload: {
            step_id: stepId,
            step_index: stepIndex,
            success: false,
            reason: stageResult.pauseReason || 'execution_failed',
            error: stageResult.error,
          },
          evidence_ids: [],
          parent_event_id: null,
        });
      }

      return stageResult;
    } catch (error) {
      // PHASE 3: Unexpected exception in executeStep
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackPreview = error instanceof Error && error.stack 
        ? error.stack.substring(0, 500) 
        : undefined;
      
      console.error('[MissionExecutor] Step execution threw exception:', errorMessage);
      if (stackPreview) {
        console.error('[MissionExecutor] Stack preview:', stackPreview);
      }

      // Emit failure_detected with stack preview
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: this.mode,
        stage,
        payload: {
          reason: 'step_execution_exception',
          step_id: stepId,
          error: errorMessage,
          stack_preview: stackPreview,
          stage,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      // Emit step_failed
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'step_failed',
        mode: this.mode,
        stage,
        payload: {
          step_id: stepId,
          step_index: stepIndex,
          success: false,
          reason: 'exception',
          error: errorMessage,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      return {
        success: false,
        stage,
        error: errorMessage,
      };
    }
  }

  /**
   * Map plan step to execution stage based on description
   * 
   * CRITICAL: Check EDIT patterns FIRST to avoid misclassification!
   * Words like "verification" can appear in edit steps (e.g., "create email verification")
   * but should not cause them to be classified as 'test'.
   */
  private mapStepToStage(step: StructuredPlan['steps'][0]): Stage {
    const description = step.description.toLowerCase();

    // PRIORITY 1: EDIT - Check first with strong action verbs
    // Match: implement, create, write, update, modify, edit, change, add, delete, complete, enhance, connect, build
    if (/\b(implement|creat|writ|updat|modif|edit|chang|add|delet|complet|enhanc|connect|build)\b/.test(description)) {
      return 'edit';
    }

    // PRIORITY 2: RETRIEVE - Only pure research/analysis (no action verbs)
    if (/\b(analyz|gather|research|review|read|examin|explor|investigat)\b/.test(description)) {
      return 'retrieve';
    }

    // PRIORITY 3: TEST - Only if explicitly about running tests
    // Be more strict: require "run test" or "test suite" or similar
    if (/\b(run.{0,10}test|test.{0,10}suite|execute.{0,10}test)\b/.test(description)) {
      return 'test';
    }

    // PRIORITY 4: REPAIR - Fix/debug/resolve
    if (/\b(fix|repair|debug|resolv)\b/.test(description)) {
      return 'repair';
    }

    // PRIORITY 5: PLAN - Design/planning only
    if (/\b(design|plan|clarif)\b/.test(description)) {
      return 'plan';
    }

    // DEFAULT: If contains any file paths or code references, assume edit
    // Otherwise default to retrieve
    if (/\.(ts|js|tsx|jsx|css|html|json|md|py|java|go|rs)/.test(description) || 
        /src\/|packages\/|components\/|services\//.test(description)) {
      return 'edit';
    }

    return 'retrieve';
  }

  /**
   * Execute retrieval stage step
   */
  private async executeRetrievalStep(step: StructuredPlan['steps'][0]): Promise<StepExecutionResult> {
    console.log(`[MissionExecutor] Executing retrieval step: ${step.description}`);
    
    // V1: Emit retrieval events (actual retrieval will be wired up later)
    const retrievalId = randomUUID();
    
    await this.emitEvent({
      event_id: retrievalId,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'retrieval_started',
      mode: this.mode,
      stage: 'retrieve',
      payload: {
        retrieval_id: retrievalId,
        query: step.description,
        step_id: step.step_id,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // TODO: Wire up actual retriever when available
    // For now, emit successful completion
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'retrieval_completed',
      mode: this.mode,
      stage: 'retrieve',
      payload: {
        retrieval_id: retrievalId,
        result_count: 0,
        summary: 'Retrieval step completed (V1 placeholder)',
      },
      evidence_ids: [],
      parent_event_id: retrievalId,
    });

    return { success: true, stage: 'retrieve' };
  }

  /**
   * Execute edit stage step - SPEC-COMPLIANT with unified diff flow
   * 
   * Event flow:
   * step_started → stage_changed { stage: "edit" } → tool_start { tool: "llm_edit_step" }
   * → tool_end → diff_proposed → approval_requested → approval_resolved
   * → checkpoint_created → diff_applied → step_completed
   */
  private async executeEditStep(step: StructuredPlan['steps'][0]): Promise<StepExecutionResult> {
    console.log(`[MissionExecutor] Executing edit step (spec-compliant): ${step.description}`);
    
    // Check dependencies
    if (!this.workspaceWriter || !this.workspaceCheckpointMgr) {
      throw new Error('WorkspaceWriter and WorkspaceCheckpointManager required for edit operations');
    }

    // Initialize managers
    const evidenceManager = new EditEvidenceManager(this.workspaceRoot);
    const llmEditTool = new LLMEditTool(this.taskId, this.eventBus, this.mode);

    let diffId: string | undefined = undefined; // Declare at function scope for error handling

    try {
      // ====================================================================
      // STEP 3: DETERMINISTIC EXCERPT SELECTION STRATEGY
      // ====================================================================
      console.log('[MissionExecutor] Selecting edit context...');
      
      const readFile = async (filePath: string): Promise<string> => {
        const fullPath = path.join(this.workspaceRoot, filePath);
        return fs.readFile(fullPath, 'utf-8');
      };

      // Build fallback files list
      const hintedFiles = extractFileHints(step.description);
      const fallbackFiles = [
        ...hintedFiles,
        'package.json',
        'src/index.ts', 'src/index.js',
        'src/main.ts', 'src/main.js',
        'src/App.ts', 'src/App.tsx', 'src/App.jsx',
      ];
      if (hintedFiles.length > 0) {
        console.log('[MissionExecutor] File hints from step:', hintedFiles);
      }

      const contextResult = await selectEditContext(
        {
          retrievalResults: this.retrievalResults.length > 0 ? this.retrievalResults : undefined,
          fallbackFiles,
        },
        step.description,
        readFile,
        { maxFiles: 6, maxTotalLines: 400 }
      );

      if (contextResult.file_context.length === 0) {
        // No files to edit - emit failure and pause
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'no_files_selected',
            details: { message: 'No files selected for editing. Please specify target files.' },
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'needs_user_decision',
            step_id: step.step_id,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          shouldPause: true,
          pauseReason: 'no_files_selected',
        };
      }

      console.log(`[MissionExecutor] Selected ${contextResult.file_context.length} files, ${contextResult.total_lines} lines`);

      // Persist context selection evidence
      await evidenceManager.persistContextSelectionEvidence({
        step_id: step.step_id,
        files: contextResult.evidence.files,
        total_lines: contextResult.total_lines,
        selection_method: contextResult.selection_method,
      });

      // ====================================================================
      // STEP 4: CALL TRUNCATION-SAFE EXECUTOR (auto-splits on truncation)
      // ====================================================================
      console.log('[MissionExecutor] Using TruncationSafeExecutor for edit step...');

      // Create truncation-safe executor with bounded budget config
      const truncationSafeExecutor = createTruncationSafeExecutor(
        this.taskId,
        this.eventBus,
        this.mode,
        {
          maxFilesBeforeSplit: 2,  // Split if > 2 files
          maxAttemptsPerFile: 2,    // Max retries per file
          maxTotalChunks: 10,       // Max total API calls
          requireCompleteSentinel: true,  // Require complete:true in output
        }
      );

      const llmInput: LLMEditStepInput = {
        task_id: this.taskId,
        step_id: step.step_id,
        step_text: step.description,
        repo_signals: {
          stack: 'typescript/nodejs',
          top_dirs: ['src', 'packages'],
        },
        file_context: contextResult.file_context,
        constraints: DEFAULT_EDIT_CONSTRAINTS,
        preconditions: DEFAULT_PRECONDITIONS,
      };

      // Execute with automatic truncation detection and split-by-file recovery
      const truncationResult = await truncationSafeExecutor.execute(
        llmInput,
        this.llmConfig,
        contextResult.file_context
      );

      console.log(`[MissionExecutor] TruncationSafeExecutor result: success=${truncationResult.success}, wasSplit=${truncationResult.wasSplit}, truncationDetected=${truncationResult.truncationDetected}`);

      // ====================================================================
      // STEP 5: HANDLE TRUNCATION-SAFE RESULT
      // ====================================================================
      if (!truncationResult.success || !truncationResult.output) {
        const errorType = truncationResult.error?.type || 'unknown';
        // IMPORTANT: Use pauseReason which now contains the full error message
        const errorMessage = truncationResult.pauseReason || truncationResult.error?.message || 'Truncation-safe execution failed';

        console.error(`[MissionExecutor] Truncation-safe execution failed: ${errorMessage}`);
        console.error(`[MissionExecutor] Error type: ${errorType}, pausedForDecision: ${truncationResult.pausedForDecision}`);

        // Check if paused for decision point (graceful degradation)
        if (truncationResult.pausedForDecision) {
          await this.emitEvent({
            event_id: randomUUID(),
            task_id: this.taskId,
            timestamp: new Date().toISOString(),
            type: 'failure_detected',
            mode: this.mode,
            stage: 'edit',
            payload: {
              reason: truncationResult.truncationDetected ? 'output_truncated' : 'split_failed',
              details: {
                message: truncationResult.pauseReason || errorMessage,
                wasSplit: truncationResult.wasSplit,
                truncationDetected: truncationResult.truncationDetected,
              },
            },
            evidence_ids: [],
            parent_event_id: null,
          });

          await this.emitEvent({
            event_id: randomUUID(),
            task_id: this.taskId,
            timestamp: new Date().toISOString(),
            type: 'execution_paused',
            mode: this.mode,
            stage: 'edit',
            payload: {
              reason: 'needs_user_decision',
              step_id: step.step_id,
              error_type: errorType,
              truncation_info: {
                detected: truncationResult.truncationDetected,
                split_attempted: truncationResult.wasSplit,
                pause_reason: truncationResult.pauseReason,
              },
            },
            evidence_ids: [],
            parent_event_id: null,
          });

          return {
            success: false,
            stage: 'edit',
            shouldPause: true,
            pauseReason: truncationResult.truncationDetected ? 'output_truncated' : 'split_failed',
            error: errorMessage,
          };
        }

        // Standard failure
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: errorType === 'validation_error' ? 'llm_cannot_edit' : 
                    errorType === 'truncation' ? 'output_truncated' :
                    errorType === 'split_failed' ? 'split_recovery_failed' : 'llm_error',
            details: truncationResult.error?.details || { message: errorMessage },
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'needs_user_decision',
            step_id: step.step_id,
            error_type: errorType,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          shouldPause: true,
          pauseReason: errorType,
          error: errorMessage,
        };
      }

      const llmOutput = truncationResult.output;
      
      // Build ParsedDiff from the output (for compatibility with rest of flow)
      const totalAdditions = llmOutput.touched_files.reduce((sum, tf) => 
        sum + (tf.new_content ? tf.new_content.split('\n').length : 0), 0);
      const totalDeletions = llmOutput.touched_files.reduce((sum, tf) => 
        sum + (tf.action === 'delete' ? 100 : 0), 0);
      
      const parsedDiff: ParsedDiff = {
        files: llmOutput.touched_files.map(tf => ({
          oldPath: tf.action === 'create' ? '/dev/null' : tf.path,
          newPath: tf.action === 'delete' ? '/dev/null' : tf.path,
          additions: tf.new_content ? tf.new_content.split('\n').length : 0,
          deletions: tf.action === 'delete' ? 100 : 0,
          hunks: [],
          isCreate: tf.action === 'create',
          isDelete: tf.action === 'delete',
          isRename: false,
          hasModeChange: false,
        })),
        totalAdditions,
        totalDeletions,
        totalChangedLines: totalAdditions + totalDeletions,
      };

      // Check for empty diff
      // IMPORTANT: If all files explicitly returned "no_changes", that's a VALID success case
      // This happens for analysis/examine steps where LLM determines no edits are actually needed
      if (parsedDiff.files.length === 0) {
        // Check if this was a "no changes needed" case (success=true from truncation executor)
        // vs an actual failure to produce changes
        if (truncationResult.success && truncationResult.wasSplit) {
          // All files returned no_changes - this is valid for examine/analyze steps
          console.log(`[MissionExecutor] All files returned no_changes - treating as successful examination step`);
          console.log(`[MissionExecutor] Notes: ${llmOutput.notes || 'No changes needed for this step'}`);
          
          // Emit a step_note event to inform user (not a failure)
          await this.emitEvent({
            event_id: randomUUID(),
            task_id: this.taskId,
            timestamp: new Date().toISOString(),
            type: 'tool_end',
            mode: this.mode,
            stage: 'edit',
            payload: {
              tool: 'examine_files',
              success: true,
              result: 'No changes required',
              notes: llmOutput.notes || 'Files examined - no modifications needed for this step',
            },
            evidence_ids: [],
            parent_event_id: null,
          });

          // Return success - the step accomplished its goal (examination/analysis)
          return {
            success: true,
            stage: 'edit',
          };
        }
        
        // Actual empty diff failure - LLM was supposed to produce changes but didn't
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'empty_diff',
            details: { confidence: llmOutput.confidence, notes: llmOutput.notes },
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'needs_user_decision',
            step_id: step.step_id,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          shouldPause: true,
          pauseReason: 'empty_diff',
        };
      }

      // ====================================================================
      // STEP 6: PERSIST PROPOSED DIFF AS EVIDENCE
      // ====================================================================
      diffId = createDiffId(this.taskId, step.step_id);
      console.log(`[MissionExecutor] Persisting diff evidence: ${diffId}`);

      const { manifestPath } = await evidenceManager.persistProposedDiff({
        diff_id: diffId,
        task_id: this.taskId,
        step_id: step.step_id,
        unified_diff: llmOutput.unified_diff,
        parsed_diff: parsedDiff,
        source_context: contextResult.evidence.files,
        total_lines_sent: contextResult.total_lines,
        llm_output: llmOutput,
      });

      // Emit diff_proposed
      const diffProposedPayload = buildDiffProposedPayload({
        diff_id: diffId,
        step_id: step.step_id,
        parsed_diff: parsedDiff,
        llm_output: llmOutput,
        manifest_path: manifestPath,
      });

      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'diff_proposed',
        mode: this.mode,
        stage: 'edit',
        payload: diffProposedPayload,
        evidence_ids: [path.basename(manifestPath)],
        parent_event_id: null,
      });

      // ====================================================================
      // STEP 7: WIRE APPROVAL (REUSE EXISTING INFRASTRUCTURE)
      // ====================================================================
      console.log('[MissionExecutor] Requesting approval for diff...');

      // Idempotency check - prevent duplicate approvals for same diff
      if (this.appliedDiffIds.has(diffId)) {
        console.warn(`[MissionExecutor] Diff ${diffId} already processed (idempotency guard)`);
        return { success: true, stage: 'edit' };
      }

      console.log('[MissionExecutor] Requesting approval for diff...');

      const approval = await this.approvalManager.requestApproval(
        this.taskId,
        this.mode,
        'edit',
        'apply_diff',
        `Apply changes to ${parsedDiff.files.length} file(s) (+${parsedDiff.totalAdditions}/-${parsedDiff.totalDeletions} lines)`,
        {
          diff_id: diffId,
          files_changed: parsedDiff.files.map(f => ({
            path: f.newPath !== '/dev/null' ? f.newPath : f.oldPath,
            added_lines: f.additions,  // FIX: Match field name expected by ApprovalCard
            removed_lines: f.deletions, // FIX: Match field name expected by ApprovalCard
          })),
          evidence_id: path.basename(manifestPath),
        }
      );

      console.log(`[MissionExecutor] Approval decision: ${approval.decision}`);

      if (approval.decision === 'denied') {
        // User rejected - emit execution_paused with diff_rejected reason
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'diff_rejected',
            diff_id: diffId,
            step_id: step.step_id,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          shouldPause: true,
          pauseReason: 'diff_rejected',
        };
      }

      // ====================================================================
      // STEP 8: CHECKPOINT + ATOMIC APPLY + ROLLBACK (V1 Full Content Strategy)
      // ====================================================================
      
      // Mark diff as being processed (idempotency - moved here after approval)
      this.appliedDiffIds.add(diffId);
      console.log(`[MissionExecutor] Diff ${diffId} marked for application`);

      // 8a) Build FilePatch[] from llmOutput.touched_files (full content strategy)
      const filePatches: FilePatch[] = llmOutput.touched_files.map(tf => ({
        path: tf.path,
        action: tf.action,
        newContent: tf.new_content,
        baseSha: tf.base_sha,
      }));

      // 8b) Create checkpoint BEFORE any file writes
      const checkpointId = createCheckpointId(this.taskId, step.step_id);
      console.log(`[MissionExecutor] Creating checkpoint: ${checkpointId}`);
      
      const checkpointResult = await this.workspaceCheckpointMgr.createCheckpoint(filePatches);

      // Emit checkpoint_created
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'checkpoint_created',
        mode: this.mode,
        stage: 'edit',
        payload: {
          checkpoint_id: checkpointResult.checkpointId,
          diff_id: diffId,
          files: checkpointResult.files.map(f => f.path),
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      // 8c) Staleness check - validate base_sha for each file
      const expectedShas = buildBaseShaMap(contextResult.file_context);
      let stalenessDetected = false;
      let staleFile = '';

      for (const file of checkpointResult.files) {
        if (file.existedBefore) {
          const expected = expectedShas.get(file.path);
          if (expected && file.beforeSha !== expected) {
            stalenessDetected = true;
            staleFile = file.path;
            console.error(`[MissionExecutor] Staleness detected: ${file.path} (expected ${expected}, got ${file.beforeSha})`);
            break;
          }
        }
      }

      if (stalenessDetected) {
        // Rollback not needed - no files written yet
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'stale_context',
            details: {
              file: staleFile,
              message: `File ${staleFile} changed since diff was proposed`,
            },
            checkpoint_id: checkpointResult.checkpointId,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'needs_user_decision',
            step_id: step.step_id,
            error_type: 'stale_context',
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          shouldPause: true,
          pauseReason: 'stale_context',
          error: `File ${staleFile} changed since diff was proposed`,
        };
      }

      // 8d) VALIDATE AND CLASSIFY file operations before applying
      console.log('[MissionExecutor] Validating file operations...');
      const relativePaths = filePatches.map(fp => fp.path);
      
      // Validate paths (security, existence, permissions)
      const validationIssues = validateFileOperations(this.workspaceRoot, relativePaths);
      const errors = validationIssues.filter(issue => issue.severity === 'error');
      
      if (errors.length > 0) {
        // Path validation failed - emit failure and pause
        console.error('[MissionExecutor] File validation failed:', errors);
        
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'invalid_file_paths',
            details: {
              errors: errors.map(e => ({
                path: e.path,
                code: e.code,
                message: e.message,
                suggestion: e.suggestion
              }))
            },
            checkpoint_id: checkpointResult.checkpointId,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'needs_user_decision',
            step_id: step.step_id,
            error_type: 'invalid_file_paths',
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          shouldPause: true,
          pauseReason: 'invalid_file_paths',
          error: errors.map(e => e.message).join('; '),
        };
      }
      
      // Classify operations (create vs modify based on existence)
      const classifications = classifyFileOperations(this.workspaceRoot, relativePaths);
      console.log('[MissionExecutor] File classifications:', classifications);
      
      // Update filePatches with correct operations based on actual file existence
      for (let i = 0; i < filePatches.length; i++) {
        const patch = filePatches[i];
        const classification = classifications[i];
        
        // CRITICAL: Sync action with actual file existence
        // Map classification.operation ('create' | 'modify' | 'delete') to FilePatch.action ('create' | 'update' | 'delete')
        const mappedOperation: 'create' | 'update' | 'delete' = 
          classification.operation === 'modify' ? 'update' : classification.operation;
        
        // If LLM said 'update' but file doesn't exist, change to 'create'
        // If LLM said 'create' but file exists, change to 'update'
        if (mappedOperation !== patch.action) {
          console.log(`[MissionExecutor] Correcting operation for ${patch.path}: ${patch.action} → ${mappedOperation} (based on actual existence)`);
          patch.action = mappedOperation;
        }
      }
      
      // 8e) Apply patches atomically
      console.log('[MissionExecutor] Applying file patches...');
      try {
        await this.workspaceWriter.applyPatches(filePatches);
      } catch (applyError) {
        // Apply failed - rollback
        console.error('[MissionExecutor] Apply failed, rolling back...', applyError);
        
        try {
          await this.workspaceCheckpointMgr.rollback(checkpointResult.checkpointId);
          console.log('[MissionExecutor] Rollback successful');
        } catch (rollbackError) {
          console.error('[MissionExecutor] Rollback failed!', rollbackError);
        }

        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'apply_failed',
            details: {
              message: applyError instanceof Error ? applyError.message : String(applyError),
            },
            checkpoint_id: checkpointResult.checkpointId,
            rollback: 'attempted',
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'needs_user_decision',
            step_id: step.step_id,
            error_type: 'apply_failed',
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          shouldPause: true,
          pauseReason: 'apply_failed',
          error: applyError instanceof Error ? applyError.message : String(applyError),
        };
      }

      // 8e) Open first changed file beside
      if (filePatches.length > 0) {
        try {
          await this.workspaceWriter.openFilesBeside([filePatches[0].path]);
        } catch (openError) {
          // Non-fatal - just log
          console.warn('[MissionExecutor] Could not open file:', openError);
        }
      }

      // 8f) Emit diff_applied (diff already marked as applied above)
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'diff_applied',
        mode: this.mode,
        stage: 'edit',
        payload: {
          diff_id: diffId,
          checkpoint_id: checkpointResult.checkpointId,
          files_changed: filePatches.map(fp => ({
            path: fp.path,
            action: fp.action,
            additions: parsedDiff.files.find(f => f.newPath === fp.path || f.oldPath === fp.path)?.additions || 0,
            deletions: parsedDiff.files.find(f => f.newPath === fp.path || f.oldPath === fp.path)?.deletions || 0,
          })),
          summary: `Applied changes to ${filePatches.length} file(s)`,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      console.log(`[MissionExecutor] ✓ Edit step completed successfully: ${filePatches.length} file(s) modified`);

      return {
        success: true,
        stage: 'edit',
      };

    } catch (error) {
      // CRITICAL: Remove diff from applied set on error to allow retry
      if (diffId) {
        this.appliedDiffIds.delete(diffId);
        console.log(`[MissionExecutor] Removed diff ${diffId} from applied set due to error`);
      }
      // PHASE 3: Preserve error details for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackPreview = error instanceof Error && error.stack 
        ? error.stack.substring(0, 500) 
        : undefined;
      
      console.error('[MissionExecutor] Edit step failed with unexpected error:', errorMessage);
      if (stackPreview) {
        console.error('[MissionExecutor] Stack preview:', stackPreview);
      }
      
      // DO NOT emit failure_detected here - let executeStep handle it
      // This ensures only ONE failure_detected event per failure
      
      return {
        success: false,
        stage: 'edit',
        shouldPause: true,
        pauseReason: 'edit_step_error',
        error: errorMessage,
      };
    }
  }

  /**
   * Select target files for editing
   * Priority: retrieval results > open files > fallback files
   */
  private async selectTargetFiles(): Promise<Array<{ path: string; content: string }>> {
    const MAX_FILES = 3;
    const selectedPaths: string[] = [];

    // 1. Use retrieval results if available
    if (this.retrievalResults.length > 0) {
      // Sort by score (highest first) then by path (stable)
      const sorted = [...this.retrievalResults].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.path.localeCompare(b.path);
      });

      selectedPaths.push(...sorted.slice(0, MAX_FILES).map(r => r.path));
    }

    // 2. Fallback: Try common entry files
    if (selectedPaths.length === 0) {
      const fallbackFiles = [
        'package.json',
        'src/main.ts',
        'src/main.js',
        'src/App.ts',
        'src/App.tsx',
        'src/App.jsx',
        'src/index.ts',
        'src/index.js',
      ];

      for (const filePath of fallbackFiles) {
        if (selectedPaths.length >= MAX_FILES) break;
        
        const fullPath = path.join(this.workspaceRoot, filePath);
        try {
          await fs.access(fullPath);
          selectedPaths.push(filePath);
        } catch {
          // File doesn't exist, continue
        }
      }
    }

    // 3. Read file contents
    const files: Array<{ path: string; content: string }> = [];
    
    for (const filePath of selectedPaths) {
      const fullPath = path.join(this.workspaceRoot, filePath);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        files.push({ path: filePath, content });
      } catch (error) {
        console.warn(`[MissionExecutor] Could not read file ${filePath}:`, error);
      }
    }

    return files;
  }

  /**
   * Build files_changed array for diff_proposed/diff_applied events
   */
  private async buildFilesChanged(
    patches: Array<{ path: string; action: 'update' | 'create' | 'delete'; content?: any }>
  ): Promise<Array<{ path: string; action: string; added_lines: number; removed_lines: number }>> {
    const filesChanged: Array<{
      path: string;
      action: string;
      added_lines: number;
      removed_lines: number;
    }> = [];

    for (const patch of patches) {
      let addedLines = 0;
      let removedLines = 0;

      // Safely convert content to string if it's not already
      const contentStr = this.safeContentToString(patch.content);

      if (patch.action === 'create') {
        addedLines = contentStr ? contentStr.split('\n').length : 0;
        removedLines = 0;
      } else if (patch.action === 'delete') {
        const fullPath = path.join(this.workspaceRoot, patch.path);
        try {
          const oldContent = await fs.readFile(fullPath, 'utf-8');
          removedLines = oldContent.split('\n').length;
          addedLines = 0;
        } catch {
          removedLines = 0;
        }
      } else if (patch.action === 'update') {
        const fullPath = path.join(this.workspaceRoot, patch.path);
        try {
          const oldContent = await fs.readFile(fullPath, 'utf-8');
          const oldLines = oldContent.split('\n').length;
          const newLines = contentStr ? contentStr.split('\n').length : 0;
          addedLines = Math.max(0, newLines - oldLines);
          removedLines = Math.max(0, oldLines - newLines);
        } catch {
          // File doesn't exist, treat as create
          addedLines = contentStr ? contentStr.split('\n').length : 0;
          removedLines = 0;
        }
      }

      filesChanged.push({
        path: patch.path,
        action: patch.action,
        added_lines: addedLines,
        removed_lines: removedLines,
      });
    }

    return filesChanged;
  }

  /**
   * Safely convert patch content to string
   * Handles cases where content might be an object, array, or other type
   */
  private safeContentToString(content: any): string | null {
    if (content === null || content === undefined) {
      return null;
    }
    
    if (typeof content === 'string') {
      return content;
    }
    
    // If it's an object or array, try to extract string content
    if (typeof content === 'object') {
      // If it has a 'text' or 'content' property, use that
      if (content.text && typeof content.text === 'string') {
        return content.text;
      }
      if (content.content && typeof content.content === 'string') {
        return content.content;
      }
      // Otherwise, serialize it as JSON (best effort)
      try {
        return JSON.stringify(content, null, 2);
      } catch {
        return String(content);
      }
    }
    
    return String(content);
  }

  /**
   * Apply a single patch to disk
   */
  private async applyPatch(patch: {
    path: string;
    action: 'update' | 'create' | 'delete';
    content?: any;
  }): Promise<void> {
    const fullPath = path.join(this.workspaceRoot, patch.path);

    // Security: prevent path traversal
    if (!fullPath.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected');
    }

    switch (patch.action) {
      case 'create':
      case 'update':
        const contentStr = this.safeContentToString(patch.content);
        if (!contentStr) {
          throw new Error(`Content required for ${patch.action} action`);
        }
        // Ensure directory exists
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, contentStr, 'utf-8');
        break;

      case 'delete':
        try {
          await fs.unlink(fullPath);
        } catch (error) {
          // Ignore if file doesn't exist
          if ((error as any).code !== 'ENOENT') {
            throw error;
          }
        }
        break;

      default:
        throw new Error(`Unknown patch action: ${(patch as any).action}`);
    }
  }

  /**
   * Execute test stage step
   */
  private async executeTestStep(step: StructuredPlan['steps'][0]): Promise<StepExecutionResult> {
    console.log(`[MissionExecutor] Executing test step: ${step.description}`);
    
    // TODO: Wire up actual test runner
    // For now, emit placeholder events
    return { success: true, stage: 'test' };
  }

  /**
   * Execute repair stage step
   */
  private async executeRepairStep(step: StructuredPlan['steps'][0]): Promise<StepExecutionResult> {
    console.log(`[MissionExecutor] Executing repair step: ${step.description}`);
    
    // TODO: Wire up repair orchestrator
    // For now, emit placeholder events
    return { success: true, stage: 'repair' };
  }

  /**
   * Create checkpoint before risky edit action
   * MANDATORY per STEP 24 requirements
   */
  private async createCheckpointBeforeEdit(step: StructuredPlan['steps'][0]): Promise<void> {
    try {
      await this.checkpointManager.createCheckpoint(
        this.taskId,
        this.mode,
        'edit',
        `Before executing step: ${step.description} (step_id: ${step.step_id})`,
        [] // V1: Empty scope - will be populated with actual files in future versions
      );

      console.log(`[MissionExecutor] Checkpoint created before step: ${step.step_id}`);
    } catch (error) {
      console.error('[MissionExecutor] Failed to create checkpoint:', error);
      // Don't fail execution if checkpoint fails, but log warning
    }
  }

  /**
   * Pause execution on failure
   */
  private async pauseOnFailure(error: string): Promise<void> {
    if (!this.executionState) return;

    this.executionState.isPaused = true;

    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'failure_detected',
      mode: this.mode,
      stage: 'none',
      payload: {
        kind: 'execution_failed',
        error,
        current_step: this.executionState.currentStepIndex,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_paused',
      mode: this.mode,
      stage: 'none',
      payload: {
        reason: 'failure',
        error,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  /**
   * Handle execution failure
   */
  private async handleExecutionFailure(error: unknown): Promise<void> {
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'failure_detected',
      mode: this.mode,
      stage: 'none',
      payload: {
        kind: 'mission_execution_failed',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_stopped',
      mode: this.mode,
      stage: 'none',
      payload: {
        reason: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  /**
   * Complete mission after all steps
   */
  private async completeMission(): Promise<void> {
    // Emit mission_completed to trigger sequencing to next mission
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'mission_completed',
      mode: this.mode,
      stage: 'none',
      payload: {
        mission_id: this.executionState?.missionId || this.executionState?.plan.goal || this.taskId,
        success: true,
        completed_steps: this.executionState?.completedSteps.length || 0,
        total_steps: this.executionState?.plan.steps.length || 0,
        goal: this.executionState?.plan.goal || '',
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    console.log('[MissionExecutor] Mission completed successfully', {
      mission_id: this.executionState?.missionId,
      goal: this.executionState?.plan.goal,
      total_steps: this.executionState?.plan.steps.length
    });
  }

  /**
   * Pause execution (can be resumed later)
   */
  async pause(): Promise<void> {
    if (!this.executionState) {
      throw new Error('No active execution to pause');
    }

    this.executionState.isPaused = true;

    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_paused',
      mode: this.mode,
      stage: 'none',
      payload: {
        reason: 'manual_pause',
        current_step: this.executionState.currentStepIndex,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  /**
   * Resume paused execution
   */
  async resume(): Promise<void> {
    if (!this.executionState) {
      throw new Error('No execution state to resume');
    }

    if (!this.executionState.isPaused) {
      throw new Error('Execution is not paused');
    }

    this.executionState.isPaused = false;

    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_resumed',
      mode: this.mode,
      stage: 'none',
      payload: {
        resuming_from_step: this.executionState.currentStepIndex,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Continue execution
    await this.executeStepsSequentially();
  }

  /**
   * Stop execution (cannot be resumed)
   */
  async stop(): Promise<void> {
    if (!this.executionState) {
      throw new Error('No active execution to stop');
    }

    this.executionState.isStopped = true;

    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_stopped',
      mode: this.mode,
      stage: 'none',
      payload: {
        reason: 'manual_stop',
        completed_steps: this.executionState.completedSteps.length,
        total_steps: this.executionState.plan.steps.length,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  /**
   * Get current execution state
   */
  getExecutionState(): MissionExecutionState | null {
    return this.executionState;
  }

  /**
   * Emit event to event bus
   */
  private async emitEvent(event: Event): Promise<void> {
    await this.eventBus.publish(event);
  }
}

function extractFileHints(stepText: string): string[] {
  const matches = stepText.match(/\b[\w./-]+\.(?:ts|tsx|js|jsx|json|md)\b/g) || [];
  const normalized = matches.map(m => m.replace(/^[('"\[]+|[)'"\\\]]+$/g, ''));
  // De-dup while preserving order
  const seen = new Set<string>();
  const results: string[] = [];
  for (const hint of normalized) {
    if (!seen.has(hint)) {
      seen.add(hint);
      results.push(hint);
    }
    // If no path separator, try common src locations
    if (!hint.includes('/')) {
      const expanded = [
        `src/${hint}`,
        `src/services/${hint}`,
        `src/routes/${hint}`,
        `src/components/${hint}`
      ];
      for (const candidate of expanded) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          results.push(candidate);
        }
      }
    }
  }
  return results;
}
