/**
 * ModeManager: Enforces mode boundaries (PLAN/MISSION)
 * Based on 05_TECHNICAL_IMPLEMENTATION_SPEC.md Section 6
 * 
 * Requirements:
 * - Check current mode at every execution step
 * - Illegal actions abort immediately with mode_violation
 * - Mode changes pause execution and require explicit resume
 */

import { Mode, Stage } from './types';
import { EventBus } from './eventBus';

/**
 * Action types that can be performed
 */
export type Action = 
  | 'read_file'
  | 'write_file'
  | 'execute_command'
  | 'retrieve'
  | 'plan'
  | 'diff'
  | 'checkpoint';

/**
 * Mode permissions matrix
 */
const MODE_PERMISSIONS: Record<Mode, Set<Action>> = {
  PLAN: new Set(['read_file', 'retrieve', 'plan']),
  MISSION: new Set(['read_file', 'write_file', 'execute_command', 'retrieve', 'plan', 'diff', 'checkpoint']),
};

/**
 * Stage permissions (only valid in MISSION mode)
 */
const STAGE_PERMISSIONS: Record<Stage, Set<Action>> = {
  none: new Set([]),
  plan: new Set(['read_file', 'retrieve', 'plan']),
  retrieve: new Set(['read_file', 'retrieve']),
  edit: new Set(['read_file', 'write_file', 'diff', 'checkpoint']),
  test: new Set(['read_file', 'execute_command']),
  repair: new Set(['read_file', 'write_file', 'diff', 'checkpoint', 'execute_command']),
  command: new Set(['read_file', 'execute_command']), // Step 34.5: Command execution stage
};

export interface ModeValidationResult {
  allowed: boolean;
  violation?: {
    reason: string;
    currentMode: Mode;
    currentStage: Stage;
    attemptedAction: Action;
  };
}

/**
 * Result of a mode transition attempt (pure data, no side effects).
 */
export interface ModeTransitionResult {
  changed: boolean;
  from_mode: Mode;
  to_mode: Mode;
}

/**
 * Mode ordering for escalation/downgrade detection.
 */
const MODE_LEVEL: Record<Mode, number> = {
  PLAN: 0,
  MISSION: 1,
};

/**
 * Check if a mode transition is an escalation (UP: PLAN→MISSION).
 */
export function isEscalation(from: Mode, to: Mode): boolean {
  return MODE_LEVEL[to] > MODE_LEVEL[from];
}

/**
 * Check if a mode transition is a downgrade (DOWN: MISSION→PLAN).
 */
export function isDowngrade(from: Mode, to: Mode): boolean {
  return MODE_LEVEL[to] < MODE_LEVEL[from];
}

/**
 * ModeManager enforces mode boundaries and detects violations
 */
export class ModeManager {
  private currentMode: Mode = 'MISSION';
  private currentStage: Stage = 'none';
  private readonly taskId: string;
  private readonly eventBus?: EventBus;

  constructor(taskId: string, eventBus?: EventBus) {
    this.taskId = taskId;
    this.eventBus = eventBus;
  }

  /**
   * Set the current mode.
   * Returns transition info (pure — no events emitted here).
   * The caller (extension.ts) is responsible for emitting mode_changed events.
   */
  setMode(mode: Mode): ModeTransitionResult {
    const from = this.currentMode;
    const changed = from !== mode;
    this.currentMode = mode;
    // When mode changes, reset stage to none
    if (mode !== 'MISSION') {
      this.currentStage = 'none';
    }
    return { changed, from_mode: from, to_mode: mode };
  }

  /**
   * Set the current stage (only valid in MISSION mode)
   */
  setStage(stage: Stage): void {
    if (this.currentMode !== 'MISSION' && stage !== 'none') {
      throw new Error(`Stages are only valid in MISSION mode. Current mode: ${this.currentMode}`);
    }
    this.currentStage = stage;
  }

  /**
   * Get current mode
   */
  getMode(): Mode {
    return this.currentMode;
  }

  /**
   * Get current stage
   */
  getStage(): Stage {
    return this.currentStage;
  }

  /**
   * Validate if an action is allowed in current mode/stage
   */
  validateAction(action: Action): ModeValidationResult {
    // First check mode permissions
    const modeAllowed = MODE_PERMISSIONS[this.currentMode]?.has(action);
    
    if (!modeAllowed) {
      return {
        allowed: false,
        violation: {
          reason: `Action '${action}' is not permitted in ${this.currentMode} mode`,
          currentMode: this.currentMode,
          currentStage: this.currentStage,
          attemptedAction: action,
        },
      };
    }

    // If in MISSION mode, also check stage permissions
    if (this.currentMode === 'MISSION' && this.currentStage !== 'none') {
      const stageAllowed = STAGE_PERMISSIONS[this.currentStage]?.has(action);
      
      if (!stageAllowed) {
        return {
          allowed: false,
          violation: {
            reason: `Action '${action}' is not permitted in stage '${this.currentStage}'`,
            currentMode: this.currentMode,
            currentStage: this.currentStage,
            attemptedAction: action,
          },
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Enforce action - validate and emit mode_violation if needed
   * Returns true if action is allowed, false if violation occurred
   */
  async enforceAction(action: Action): Promise<boolean> {
    const validation = this.validateAction(action);

    if (!validation.allowed && validation.violation) {
      // Emit mode_violation event
      if (this.eventBus) {
        await this.eventBus.publish({
          event_id: `evt_violation_${Date.now()}_${Math.random()}`,
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'mode_violation',
          mode: this.currentMode,
          stage: this.currentStage,
          payload: {
            violation: validation.violation,
          },
          evidence_ids: [],
          parent_event_id: null,
        });
      }

      return false;
    }

    return true;
  }

  /**
   * Check if currently in MISSION mode
   */
  isMissionMode(): boolean {
    return this.currentMode === 'MISSION';
  }

  /**
   * Check if currently in PLAN mode
   */
  isPlanMode(): boolean {
    return this.currentMode === 'PLAN';
  }
}
