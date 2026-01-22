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

/**
 * Execution state for MISSION mode
 */
interface MissionExecutionState {
  taskId: string;
  plan: StructuredPlan;
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
  private executionState: MissionExecutionState | null = null;
  private readonly mode: Mode = 'MISSION';
  private retrievalResults: Array<{ path: string; score: number }> = [];

  constructor(
    taskId: string,
    eventBus: EventBus,
    checkpointManager: CheckpointManager,
    approvalManager: ApprovalManager,
    workspaceRoot: string,
    llmConfig: LLMConfig,
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
    this.retriever = retriever;
    this.diffManager = diffManager;
    this.testRunner = testRunner;
    this.repairOrchestrator = repairOrchestrator;
  }

  /**
   * Start MISSION execution from an approved plan
   * CRITICAL: Plan must be approved before calling this
   */
  async executePlan(plan: StructuredPlan): Promise<void> {
    // Verify plan is provided
    if (!plan || !plan.steps || plan.steps.length === 0) {
      throw new Error('Invalid plan: no steps to execute');
    }

    // Initialize execution state
    this.executionState = {
      taskId: this.taskId,
      plan,
      currentStepIndex: 0,
      isPaused: false,
      isStopped: false,
      completedSteps: [],
    };

    // Emit mission_started
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'mission_started',
      mode: this.mode,
      stage: 'none',
      payload: {
        goal: plan.goal,
        steps_count: plan.steps.length,
        scope_contract: plan.scope_contract,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

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
        // Step failed - pause execution
        await this.pauseOnFailure(result.error || 'Step execution failed');
        return;
      }

      if (result.shouldPause) {
        // Step requested pause (e.g., waiting for approval)
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: result.stage,
          payload: {
            reason: result.pauseReason || 'approval_required',
            current_step: this.executionState.currentStepIndex,
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        return;
      }

      // Mark step as completed
      this.executionState.completedSteps.push(step.id);
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
    const stepId = step.id;
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

      // Emit step_completed
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
          success: stageResult.success,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      return stageResult;
    } catch (error) {
      // Step execution failed
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: this.mode,
        stage,
        payload: {
          kind: 'step_execution_failed',
          step_id: stepId,
          error: error instanceof Error ? error.message : String(error),
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      return {
        success: false,
        stage,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Map plan step to execution stage based on description
   */
  private mapStepToStage(step: StructuredPlan['steps'][0]): Stage {
    const description = step.description.toLowerCase();

    // Check for stage indicators in description
    if (/analyz|gather|research|review|read|examin/.test(description)) {
      return 'retrieve';
    }
    if (/implement|creat|writ|modif|edit|chang|add|delet/.test(description)) {
      return 'edit';
    }
    if (/test|verif|validat|check/.test(description)) {
      return 'test';
    }
    if (/fix|repair|debug|resolv/.test(description)) {
      return 'repair';
    }
    if (/design|plan|clarif/.test(description)) {
      return 'plan';
    }

    // Default to retrieve for analysis/research
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
        step_id: step.id,
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
   * Execute edit stage step - UPGRADED with real LLM code generation
   */
  private async executeEditStep(step: StructuredPlan['steps'][0]): Promise<StepExecutionResult> {
    console.log(`[MissionExecutor] Executing edit step: ${step.description}`);
    
    try {
      // 1. Select target files deterministically
      const targetFiles = await this.selectTargetFiles();
      
      if (targetFiles.length === 0) {
        // No files to edit - pause and ask user
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'need_target_file',
            message: 'No files selected for editing. Please specify target files.',
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          shouldPause: true,
          pauseReason: 'need_target_file',
        };
      }

      // 2. Call LLM to generate edit patches
      const llmService = new LLMService(this.taskId, this.eventBus, this.mode, 'edit');
      
      const repoContextSummary = `Working directory: ${this.workspaceRoot}\nStep: ${step.description}`;
      
      const patchResult = await llmService.generateEditPatches({
        stepText: step.description,
        repoContextSummary,
        files: targetFiles,
        config: this.llmConfig,
      });

      // Check if LLM returned empty patches
      if (!patchResult.patches || patchResult.patches.length === 0) {
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.mode,
          stage: 'edit',
          payload: {
            kind: 'llm_no_changes',
            error: 'LLM returned no patches',
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        return {
          success: false,
          stage: 'edit',
          error: 'LLM returned no patches',
        };
      }

      // 3. Build diff proposal with files_changed
      const filesChanged = await this.buildFilesChanged(patchResult.patches);
      const diffId = randomUUID();

      // 4. Emit diff_proposed
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'diff_proposed',
        mode: this.mode,
        stage: 'edit',
        payload: {
          diff_id: diffId,
          step_id: step.id,
          summary: `Changes for: ${step.description}`,
          change_intent: step.description,
          risk_level: filesChanged.length > 1 ? 'high' : 'medium',
          files_changed: filesChanged,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      // 5. Request approval (BLOCKING)
      console.log('[MissionExecutor] Requesting approval for diff...');
      console.log('[MissionExecutor] Diff ID:', diffId);
      console.log('[MissionExecutor] Files changed:', JSON.stringify(filesChanged, null, 2));
      
      const approval = await this.approvalManager.requestApproval(
        this.taskId,
        this.mode,
        'edit',
        'apply_diff',
        `Apply changes for: ${step.description}`,
        {
          diff_id: diffId,
          files_changed: filesChanged,
        }
      );

      console.log('[MissionExecutor] Approval received:', approval.decision);
      console.log('[MissionExecutor] Approval details:', JSON.stringify(approval, null, 2));

      if (approval.decision === 'denied') {
        // User rejected - pause execution
        await this.emitEvent({
          event_id: randomUUID(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.mode,
          stage: 'edit',
          payload: {
            reason: 'diff_rejected',
            message: 'User rejected proposed changes',
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

      // 6. Create checkpoint before applying (if needed)
      if (filesChanged.length > 1 || filesChanged.some(f => f.action === 'delete')) {
        await this.checkpointManager.createCheckpoint(
          this.taskId,
          this.mode,
          'edit',
          `Before applying: ${step.description}`,
          filesChanged.map(f => f.path)
        );
      }

      // 7. Apply changes (write files)
      console.log('[MissionExecutor] Applying patches to disk...');
      console.log('[MissionExecutor] Number of patches:', patchResult.patches.length);
      
      const appliedFiles: string[] = [];
      const failedFiles: Array<{ file: string; error: string }> = [];

      for (const patch of patchResult.patches) {
        console.log(`[MissionExecutor] Applying patch: ${patch.path} (action: ${patch.action})`);
        try {
          await this.applyPatch(patch);
          appliedFiles.push(patch.path);
          console.log(`[MissionExecutor] ✓ Successfully applied: ${patch.path}`);
        } catch (error) {
          console.error(`[MissionExecutor] ✗ Failed to apply: ${patch.path}`, error);
          failedFiles.push({
            file: patch.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      console.log('[MissionExecutor] Patch application complete');
      console.log('[MissionExecutor] Applied files:', appliedFiles);
      console.log('[MissionExecutor] Failed files:', failedFiles);

      // 8. Emit diff_applied
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'diff_applied',
        mode: this.mode,
        stage: 'edit',
        payload: {
          diff_id: diffId,
          step_id: step.id,
          files_changed: filesChanged,
          applied_files: appliedFiles,
          failed_files: failedFiles,
          success: failedFiles.length === 0,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      if (failedFiles.length > 0) {
        console.error('[MissionExecutor] Edit step failed: some files could not be applied');
        return {
          success: false,
          stage: 'edit',
          error: `Failed to apply ${failedFiles.length} file(s)`,
        };
      }

      console.log('[MissionExecutor] ✓ Edit step completed successfully');
      return {
        success: true,
        stage: 'edit',
      };
    } catch (error) {
      console.error('[MissionExecutor] Edit step failed:', error);
      
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: this.mode,
        stage: 'edit',
        payload: {
          kind: 'edit_step_failed',
          error: error instanceof Error ? error.message : String(error),
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      return {
        success: false,
        stage: 'edit',
        error: error instanceof Error ? error.message : String(error),
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
        `Before executing step: ${step.description} (step_id: ${step.id})`,
        [] // V1: Empty scope - will be populated with actual files in future versions
      );

      console.log(`[MissionExecutor] Checkpoint created before step: ${step.id}`);
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
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'final',
      mode: this.mode,
      stage: 'none',
      payload: {
        status: 'complete',
        completed_steps: this.executionState?.completedSteps.length || 0,
        total_steps: this.executionState?.plan.steps.length || 0,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    console.log('[MissionExecutor] Mission completed successfully');
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
