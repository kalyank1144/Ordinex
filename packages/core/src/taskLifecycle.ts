/**
 * TaskLifecycleController: Manages task progression through lifecycle phases
 * Based on 05_TECHNICAL_IMPLEMENTATION_SPEC.md Section 4
 * 
 * Task Lifecycle Phases:
 * 1. Intent Intake
 * 2. Planning Phase
 * 3. Mission Breakdown (conditional)
 * 4. Execution Phase (MISSION only)
 * 5. Completion Phase
 */

import { Mode, Stage, TaskStatus } from './types';
import { EventBus } from './eventBus';
import { ModeManager } from './modeManager';

export interface TaskLifecycleState {
  taskId: string;
  mode: Mode;
  stage: Stage;
  status: TaskStatus;
  canResume: boolean;
}

/**
 * TaskLifecycleController manages task progression and state transitions
 */
export class TaskLifecycleController {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly modeManager: ModeManager;
  private status: TaskStatus = 'idle';
  private isPaused: boolean = false;

  constructor(taskId: string, eventBus: EventBus) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.modeManager = new ModeManager(taskId, eventBus);
  }

  /**
   * Phase 1: Intent Intake
   * Emit intent_received and mode_set events
   */
  async receiveIntent(intent: string, mode: Mode): Promise<void> {
    if (this.status !== 'idle') {
      throw new Error(`Cannot receive intent in status: ${this.status}`);
    }

    // Emit intent_received
    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'intent_received',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: { intent },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Set mode
    this.modeManager.setMode(mode);
    this.status = 'running';

    // Emit mode_set
    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'mode_set',
      mode: mode,
      stage: this.modeManager.getStage(),
      payload: { mode },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  /**
   * Phase 2: Planning Phase
   * Emit plan_created event
   */
  async completePlanning(plan: unknown): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Cannot complete planning in status: ${this.status}`);
    }

    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'plan_created',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: { plan },
      evidence_ids: [],
      parent_event_id: null,
    });

    // If mode is PLAN, execution stops here
    if (this.modeManager.isPlanMode()) {
      this.status = 'complete';
    }
  }

  /**
   * Phase 3: Mission Breakdown (Conditional)
   * Emit mission_breakdown_created and await mission_selected
   */
  async createMissionBreakdown(missions: unknown[]): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Cannot create breakdown in status: ${this.status}`);
    }

    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'mission_breakdown_created',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: { missions },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Pause execution - await user selection
    this.status = 'paused';
  }

  /**
   * User selects a mission from breakdown
   */
  async selectMission(missionIndex: number): Promise<void> {
    if (this.status !== 'paused') {
      throw new Error(`Cannot select mission in status: ${this.status}`);
    }

    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'mission_selected',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: { missionIndex },
      evidence_ids: [],
      parent_event_id: null,
    });

    this.status = 'running';
  }

  /**
   * Phase 4: Execution Phase - Change stage
   * Emit stage_changed event
   */
  async changeStage(newStage: Stage): Promise<void> {
    if (!this.modeManager.isMissionMode()) {
      throw new Error(`Stages are only valid in MISSION mode. Current mode: ${this.modeManager.getMode()}`);
    }

    if (this.status !== 'running') {
      throw new Error(`Cannot change stage in status: ${this.status}`);
    }

    this.modeManager.setStage(newStage);

    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'stage_changed',
      mode: this.modeManager.getMode(),
      stage: newStage,
      payload: { stage: newStage },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  /**
   * Phase 5: Completion Phase
   * Emit final event
   */
  async complete(): Promise<void> {
    if (this.status === 'complete') {
      throw new Error('Task is already complete');
    }

    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'final',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: {},
      evidence_ids: [],
      parent_event_id: null,
    });

    this.status = 'complete';
  }

  /**
   * Pause execution
   * Emit execution_paused event
   */
  async pause(): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Cannot pause from status: ${this.status}`);
    }

    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_paused',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: {},
      evidence_ids: [],
      parent_event_id: null,
    });

    this.status = 'paused';
    this.isPaused = true;
  }

  /**
   * Resume execution
   * Emit execution_resumed event
   */
  async resume(): Promise<void> {
    if (this.status !== 'paused') {
      throw new Error(`Cannot resume from status: ${this.status}`);
    }

    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_resumed',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: {},
      evidence_ids: [],
      parent_event_id: null,
    });

    this.status = 'running';
    this.isPaused = false;
  }

  /**
   * Stop execution
   * Emit execution_stopped event
   */
  async stop(): Promise<void> {
    if (this.status === 'complete' || this.status === 'idle') {
      throw new Error(`Cannot stop from status: ${this.status}`);
    }

    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_stopped',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: {},
      evidence_ids: [],
      parent_event_id: null,
    });

    this.status = 'idle';
    this.isPaused = false;
  }

  /**
   * Report a failure
   * Emit failure_detected event
   */
  async reportFailure(error: Error, evidence?: string[]): Promise<void> {
    await this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'failure_detected',
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      payload: {
        error: error.message,
        stack: error.stack,
      },
      evidence_ids: evidence || [],
      parent_event_id: null,
    });

    this.status = 'error';
  }

  /**
   * Get current lifecycle state
   */
  getState(): TaskLifecycleState {
    return {
      taskId: this.taskId,
      mode: this.modeManager.getMode(),
      stage: this.modeManager.getStage(),
      status: this.status,
      canResume: this.status === 'paused',
    };
  }

  /**
   * Get the mode manager for this task
   */
  getModeManager(): ModeManager {
    return this.modeManager;
  }

  /**
   * Check if task is running
   */
  isRunning(): boolean {
    return this.status === 'running';
  }

  /**
   * Check if task is paused
   */
  isPausedState(): boolean {
    return this.status === 'paused';
  }

  /**
   * Check if task is complete
   */
  isComplete(): boolean {
    return this.status === 'complete';
  }

  /**
   * Check if task has error
   */
  hasError(): boolean {
    return this.status === 'error';
  }
}
