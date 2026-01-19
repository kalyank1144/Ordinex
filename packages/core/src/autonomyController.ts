/**
 * AutonomyController: Bounded A1 autonomy with repair iteration
 * Based on 06_AUTONOMY_A1_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - Reactive, local, supervised autonomy only
 * - Iteration budgets strictly enforced
 * - Mandatory checkpoint before each iteration
 * - All autonomy events emitted
 * - Stops on budget exhaustion
 * - NEVER auto-applies diffs
 */

import { EventBus } from './eventBus';
import { CheckpointManager } from './checkpointManager';
import { ModeManager } from './modeManager';
import { Event, Mode, Stage } from './types';
import { randomUUID } from 'crypto';

/**
 * A1 autonomy budgets (V1 defaults)
 */
export interface AutonomyBudgets {
  max_iterations: number;
  max_wall_time_ms: number;
  max_tool_calls: number;
}

/**
 * Default A1 budgets per spec
 */
export const DEFAULT_A1_BUDGETS: AutonomyBudgets = {
  max_iterations: 3,
  max_wall_time_ms: 10 * 60 * 1000, // 10 minutes
  max_tool_calls: 10,
};

/**
 * Autonomy execution state
 */
export type AutonomyState = 
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'halted'
  | 'budget_exhausted';

/**
 * Iteration result
 */
export interface IterationResult {
  success: boolean;
  failure_reason?: string;
  evidence_ids?: string[];
}

/**
 * Precondition check result
 */
export interface PreconditionCheck {
  satisfied: boolean;
  missing?: string[];
}

/**
 * AutonomyController manages bounded A1 autonomy
 * 
 * CRITICAL: This is NOT general autonomy.
 * It is permissioned, bounded, supervised repair iteration.
 */
export class AutonomyController {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly checkpointManager: CheckpointManager;
  private readonly modeManager: ModeManager;
  
  private state: AutonomyState = 'idle';
  private budgets: AutonomyBudgets;
  private currentIteration: number = 0;
  private toolCallsUsed: number = 0;
  private startTime: number = 0;
  private isPlanApproved: boolean = false;
  private areToolsApproved: boolean = false;

  constructor(
    taskId: string,
    eventBus: EventBus,
    checkpointManager: CheckpointManager,
    modeManager: ModeManager,
    budgets: AutonomyBudgets = DEFAULT_A1_BUDGETS
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.checkpointManager = checkpointManager;
    this.modeManager = modeManager;
    this.budgets = { ...budgets };
  }

  /**
   * Check preconditions for autonomy (MANDATORY)
   * Autonomy MAY ONLY start if ALL conditions are true
   */
  checkPreconditions(): PreconditionCheck {
    const missing: string[] = [];

    // 1. Current mode must be MISSION
    if (!this.modeManager.isMissionMode()) {
      missing.push('Current mode must be MISSION');
    }

    // 2. Plan exists and is approved
    if (!this.isPlanApproved) {
      missing.push('Plan must be approved');
    }

    // 3. Required tools are approved
    if (!this.areToolsApproved) {
      missing.push('Tools must be approved');
    }

    // 4. Budgets are initialized
    if (!this.budgets || this.budgets.max_iterations <= 0) {
      missing.push('Budgets must be initialized');
    }

    // 5. Checkpoint capability is available
    // (CheckpointManager is injected, so it's available)

    return {
      satisfied: missing.length === 0,
      missing: missing.length > 0 ? missing : undefined,
    };
  }

  /**
   * Set plan approval status
   */
  setPlanApproved(approved: boolean): void {
    this.isPlanApproved = approved;
  }

  /**
   * Set tools approval status
   */
  setToolsApproved(approved: boolean): void {
    this.areToolsApproved = approved;
  }

  /**
   * Start autonomy (with precondition check)
   */
  async startAutonomy(mode: Mode, stage: Stage): Promise<void> {
    // Check preconditions
    const check = this.checkPreconditions();
    if (!check.satisfied) {
      throw new Error(
        `Autonomy preconditions not satisfied: ${check.missing?.join(', ')}`
      );
    }

    // Initialize state
    this.state = 'running';
    this.currentIteration = 0;
    this.toolCallsUsed = 0;
    this.startTime = Date.now();

    // Emit autonomy_started event
    await this.emitEvent('autonomy_started', mode, stage, {
      budgets: this.budgets,
    });
  }

  /**
   * Execute a single iteration
   * Returns true if should continue, false if should stop
   */
  async executeIteration(
    mode: Mode,
    stage: Stage,
    iterationCallback: () => Promise<IterationResult>
  ): Promise<boolean> {
    // Check if autonomy is running
    if (this.state !== 'running') {
      return false;
    }

    // Check budgets BEFORE starting iteration
    const budgetCheck = this.checkBudgets();
    if (!budgetCheck.withinLimits) {
      await this.handleBudgetExhaustion(mode, stage, budgetCheck.exhaustedBudget!);
      return false;
    }

    // Increment iteration counter
    this.currentIteration++;

    // Create checkpoint BEFORE iteration (MANDATORY)
    await this.checkpointManager.createCheckpoint(
      this.taskId,
      mode,
      stage,
      `Autonomy iteration ${this.currentIteration}`,
      []
    );

    // Emit iteration_started
    await this.emitEvent('iteration_started', mode, stage, {
      iteration: this.currentIteration,
      budgets_remaining: this.getBudgetsRemaining(),
    });

    // Execute iteration
    let result: IterationResult;
    try {
      result = await iterationCallback();
    } catch (error) {
      result = {
        success: false,
        failure_reason: error instanceof Error ? error.message : String(error),
      };
    }

    // Emit iteration result
    if (result.success) {
      await this.emitEvent('iteration_succeeded', mode, stage, {
        iteration: this.currentIteration,
        evidence_ids: result.evidence_ids || [],
      });
      return false; // Success - stop iterating
    } else {
      await this.emitEvent('iteration_failed', mode, stage, {
        iteration: this.currentIteration,
        failure_reason: result.failure_reason,
        evidence_ids: result.evidence_ids || [],
      });

      // Check if we should attempt repair
      const budgetCheck = this.checkBudgets();
      if (!budgetCheck.withinLimits) {
        await this.handleBudgetExhaustion(mode, stage, budgetCheck.exhaustedBudget!);
        return false;
      }

      return true; // Failed - continue iterating if budgets allow
    }
  }

  /**
   * Attempt repair after failure
   */
  async attemptRepair(
    mode: Mode,
    stage: Stage,
    failureReason: string,
    repairCallback: () => Promise<void>
  ): Promise<void> {
    // Emit repair_attempted
    await this.emitEvent('repair_attempted', mode, stage, {
      iteration: this.currentIteration,
      failure_reason: failureReason,
    });

    // Execute repair
    await repairCallback();
  }

  /**
   * Increment tool call counter
   */
  incrementToolCalls(count: number = 1): void {
    this.toolCallsUsed += count;
  }

  /**
   * Check budgets
   */
  private checkBudgets(): { withinLimits: boolean; exhaustedBudget?: string } {
    // Check iteration budget
    if (this.currentIteration >= this.budgets.max_iterations) {
      return { withinLimits: false, exhaustedBudget: 'max_iterations' };
    }

    // Check time budget
    const elapsedTime = Date.now() - this.startTime;
    if (elapsedTime >= this.budgets.max_wall_time_ms) {
      return { withinLimits: false, exhaustedBudget: 'max_wall_time' };
    }

    // Check tool call budget
    if (this.toolCallsUsed >= this.budgets.max_tool_calls) {
      return { withinLimits: false, exhaustedBudget: 'max_tool_calls' };
    }

    return { withinLimits: true };
  }

  /**
   * Get remaining budgets
   */
  getBudgetsRemaining(): {
    iterations: number;
    time_ms: number;
    tool_calls: number;
  } {
    const elapsedTime = Date.now() - this.startTime;
    return {
      iterations: Math.max(0, this.budgets.max_iterations - this.currentIteration),
      time_ms: Math.max(0, this.budgets.max_wall_time_ms - elapsedTime),
      tool_calls: Math.max(0, this.budgets.max_tool_calls - this.toolCallsUsed),
    };
  }

  /**
   * Handle budget exhaustion
   */
  private async handleBudgetExhaustion(
    mode: Mode,
    stage: Stage,
    exhaustedBudget: string
  ): Promise<void> {
    this.state = 'budget_exhausted';

    await this.emitEvent('budget_exhausted', mode, stage, {
      exhausted_budget: exhaustedBudget,
      iterations_used: this.currentIteration,
      tool_calls_used: this.toolCallsUsed,
      time_elapsed_ms: Date.now() - this.startTime,
    });
  }

  /**
   * Pause autonomy
   */
  async pause(mode: Mode, stage: Stage): Promise<void> {
    if (this.state !== 'running') {
      return;
    }

    this.state = 'paused';
    await this.emitEvent('execution_paused', mode, stage, {
      reason: 'User requested pause',
      iteration: this.currentIteration,
    });
  }

  /**
   * Resume autonomy
   */
  async resume(mode: Mode, stage: Stage): Promise<void> {
    if (this.state !== 'paused') {
      return;
    }

    this.state = 'running';
    await this.emitEvent('execution_resumed', mode, stage, {
      iteration: this.currentIteration,
    });
  }

  /**
   * Halt autonomy (mode change or user stop)
   */
  async halt(mode: Mode, stage: Stage, reason: string): Promise<void> {
    if (this.state === 'idle' || this.state === 'halted') {
      return;
    }

    this.state = 'halted';
    await this.emitEvent('autonomy_halted', mode, stage, {
      reason,
      iteration: this.currentIteration,
    });
  }

  /**
   * Complete autonomy successfully
   */
  async complete(mode: Mode, stage: Stage): Promise<void> {
    if (this.state === 'idle') {
      return;
    }

    this.state = 'completed';
    await this.emitEvent('autonomy_completed', mode, stage, {
      iterations_used: this.currentIteration,
      tool_calls_used: this.toolCallsUsed,
      time_elapsed_ms: Date.now() - this.startTime,
    });
  }

  /**
   * Get current state
   */
  getState(): AutonomyState {
    return this.state;
  }

  /**
   * Get current iteration
   */
  getCurrentIteration(): number {
    return this.currentIteration;
  }

  /**
   * Emit autonomy event
   */
  private async emitEvent(
    type: Event['type'],
    mode: Mode,
    stage: Stage,
    payload: Record<string, unknown>
  ): Promise<void> {
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type,
      mode,
      stage,
      payload,
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);
  }

  /**
   * Check if mode change requires halt
   */
  async checkModeChange(newMode: Mode, currentStage: Stage): Promise<void> {
    // If mode changes from MISSION to anything else, halt
    if (this.state === 'running' && newMode !== 'MISSION') {
      await this.halt(newMode, currentStage, `Mode changed from MISSION to ${newMode}`);
    }
  }

  /**
   * For testing: reset state
   */
  _resetForTesting(): void {
    this.state = 'idle';
    this.currentIteration = 0;
    this.toolCallsUsed = 0;
    this.startTime = 0;
    this.isPlanApproved = false;
    this.areToolsApproved = false;
  }
}
