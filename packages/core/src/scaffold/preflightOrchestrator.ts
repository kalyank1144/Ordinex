/**
 * Preflight Orchestrator (Step 35.7)
 * 
 * Coordinates the scaffold preflight flow:
 * 1. Run inspectTargetDirectory
 * 2. Determine recommendation
 * 3. Emit appropriate events
 * 4. Handle user decisions
 * 5. Guard file writes
 * 
 * CRITICAL RULES:
 * - All decisions must be emitted as events (replay-safe)
 * - Destructive replace requires typed confirmation
 * - No auto-run terminal commands
 * - No scaffold apply until user explicitly approves
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import type { Event, Mode, Stage } from '../types';
import {
  TargetDirInspection,
  PreflightRecommendation,
  PreflightDecisionOption,
  PreflightDecisionPayload,
  PreflightCompletedPayload,
  PreflightDecisionTakenPayload,
  PreflightProblem,
  inspectTargetDirectory,
  getPreflightRecommendation,
  buildPreflightDecisionOptions,
  buildPreflightDecisionPayload,
  suggestMonorepoPaths,
  validateDestructiveConfirmation,
  isPathWithinTarget,
  wouldOverwriteFile,
  DESTRUCTIVE_CONFIRM_TEXT,
} from './preflightDetection';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Preflight orchestrator context
 */
export interface PreflightOrchestratorContext {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run/task ID */
  run_id: string;
  /** App name from user prompt */
  app_name: string;
  /** Workspace root absolute path */
  workspace_root: string;
  /** Initial target directory (may be modified by user) */
  initial_target: string;
  /** Event emitter for publishing events */
  eventBus: EventEmitter;
  /** Current mode */
  mode: Mode;
}

/**
 * Preflight result after orchestration
 */
export interface PreflightOrchestratorResult {
  /** Whether preflight passed and apply can proceed */
  canProceed: boolean;
  /** Final resolved target directory */
  resolvedTarget: string;
  /** The inspection result */
  inspection: TargetDirInspection;
  /** Recommendation made */
  recommendation: PreflightRecommendation;
  /** Whether user input is needed */
  needsUserInput: boolean;
  /** Decision payload if user input needed */
  decisionPayload?: PreflightDecisionPayload;
  /** Whether destructive replace was confirmed */
  destructiveConfirmed?: boolean;
  /** Detected package manager for commands */
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  /** Blocking reason if canProceed is false */
  blockReason?: string;
}

/**
 * User decision from UI
 */
export interface PreflightUserDecision {
  /** Selected option ID */
  option_id: 'create_subfolder' | 'choose_monorepo_path' | 'replace' | 'choose_other' | 'abort' | 'enhance_existing';
  /** Selected path (for subfolder/monorepo options) */
  selected_path?: string;
  /** Typed confirmation text (for replace) */
  typed_confirm_text?: string;
}

/**
 * State for tracking preflight decisions (replay-safe)
 */
export interface PreflightState {
  /** Whether preflight has started */
  started: boolean;
  /** Whether preflight inspection completed */
  inspectionComplete: boolean;
  /** Whether a decision was needed */
  decisionNeeded: boolean;
  /** Whether user has made a decision */
  decisionTaken: boolean;
  /** The decision that was taken */
  decision?: PreflightUserDecision;
  /** Final resolved target */
  resolvedTarget?: string;
  /** Whether blocked */
  blocked: boolean;
  /** Block reason */
  blockReason?: string;
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

/**
 * Preflight Orchestrator
 * 
 * Manages the preflight phase of scaffold flow.
 * Emits replay-safe events for all decisions.
 */
export class PreflightOrchestrator {
  private ctx: PreflightOrchestratorContext;
  private state: PreflightState = {
    started: false,
    inspectionComplete: false,
    decisionNeeded: false,
    decisionTaken: false,
    blocked: false,
  };
  private inspection?: TargetDirInspection;
  private recommendation?: PreflightRecommendation;

  constructor(ctx: PreflightOrchestratorContext) {
    this.ctx = ctx;
  }

  /**
   * Run the preflight inspection phase
   * 
   * @returns Preflight result
   */
  async runPreflight(): Promise<PreflightOrchestratorResult> {
    this.state.started = true;

    // Step 1: Inspect the target directory
    this.inspection = await inspectTargetDirectory(this.ctx.initial_target);
    this.state.inspectionComplete = true;

    // Step 2: Get recommendation
    this.recommendation = getPreflightRecommendation(this.inspection, this.ctx.app_name);

    // Step 3: Emit preflight_completed event
    this.emitPreflightCompleted();

    // Step 4: Handle based on recommendation
    if (this.recommendation === 'safe_to_apply') {
      // Safe to proceed directly
      return {
        canProceed: true,
        resolvedTarget: this.ctx.initial_target,
        inspection: this.inspection,
        recommendation: this.recommendation,
        needsUserInput: false,
        packageManager: this.inspection.detectedPackageManager,
      };
    }

    // Step 5: Build decision payload
    const decisionPayload = buildPreflightDecisionPayload(this.inspection, this.ctx.app_name);
    this.state.decisionNeeded = true;

    // Step 6: Emit decision_needed event
    this.emitDecisionNeeded(decisionPayload);

    return {
      canProceed: false,
      resolvedTarget: this.ctx.initial_target,
      inspection: this.inspection,
      recommendation: this.recommendation,
      needsUserInput: true,
      decisionPayload,
      packageManager: this.inspection.detectedPackageManager,
    };
  }

  /**
   * Handle user's decision
   * 
   * @param decision - User's decision
   * @returns Updated preflight result
   */
  async handleUserDecision(decision: PreflightUserDecision): Promise<PreflightOrchestratorResult> {
    if (!this.inspection || !this.recommendation) {
      throw new Error('Preflight must be run before handling decision');
    }

    this.state.decisionTaken = true;
    this.state.decision = decision;

    // Emit decision taken event
    this.emitDecisionTaken(decision);

    switch (decision.option_id) {
      case 'abort': {
        this.state.blocked = true;
        this.state.blockReason = 'User cancelled scaffold';
        this.emitWriteBlocked('User cancelled scaffold operation');
        return {
          canProceed: false,
          resolvedTarget: this.ctx.initial_target,
          inspection: this.inspection,
          recommendation: this.recommendation,
          needsUserInput: false,
          blockReason: 'User cancelled scaffold',
        };
      }

      case 'enhance_existing': {
        // Not implemented in 35.7 - emit pause event
        this.state.blocked = true;
        this.state.blockReason = 'Enhance existing requires Step 36';
        this.emitWriteBlocked('Enhance existing project is not yet implemented. Coming in Step 36.');
        return {
          canProceed: false,
          resolvedTarget: this.ctx.initial_target,
          inspection: this.inspection,
          recommendation: this.recommendation,
          needsUserInput: false,
          blockReason: 'Enhance existing requires Step 36',
        };
      }

      case 'choose_other': {
        // User wants to pick a different directory - needs UI interaction
        return {
          canProceed: false,
          resolvedTarget: this.ctx.initial_target,
          inspection: this.inspection,
          recommendation: this.recommendation,
          needsUserInput: true,
          blockReason: 'User requested directory selection',
        };
      }

      case 'create_subfolder': {
        const newTarget = decision.selected_path ||
          path.join(this.inspection.absPath, this.ctx.app_name);
        this.state.resolvedTarget = newTarget;

        // Re-inspect the new target
        const newInspection = await inspectTargetDirectory(newTarget);
        this.inspection = newInspection;

        // If new target is also non-empty, need another decision
        const newRecommendation = getPreflightRecommendation(newInspection, this.ctx.app_name);
        if (newRecommendation !== 'safe_to_apply') {
          this.emitWriteBlocked(`Subfolder ${newTarget} is also not empty`);
          return {
            canProceed: false,
            resolvedTarget: newTarget,
            inspection: newInspection,
            recommendation: newRecommendation,
            needsUserInput: true,
            decisionPayload: buildPreflightDecisionPayload(newInspection, this.ctx.app_name),
          };
        }

        return {
          canProceed: true,
          resolvedTarget: newTarget,
          inspection: newInspection,
          recommendation: newRecommendation,
          needsUserInput: false,
          packageManager: this.inspection.detectedPackageManager,
        };
      }

      case 'choose_monorepo_path': {
        const newTarget = decision.selected_path;
        if (!newTarget) {
          throw new Error('Monorepo path selection requires selected_path');
        }
        this.state.resolvedTarget = newTarget;

        // Re-inspect the new target
        const newInspection = await inspectTargetDirectory(newTarget);
        this.inspection = newInspection;

        const newRecommendation = getPreflightRecommendation(newInspection, this.ctx.app_name);
        if (newRecommendation !== 'safe_to_apply') {
          return {
            canProceed: false,
            resolvedTarget: newTarget,
            inspection: newInspection,
            recommendation: newRecommendation,
            needsUserInput: true,
            decisionPayload: buildPreflightDecisionPayload(newInspection, this.ctx.app_name),
          };
        }

        return {
          canProceed: true,
          resolvedTarget: newTarget,
          inspection: newInspection,
          recommendation: newRecommendation,
          needsUserInput: false,
          packageManager: this.inspection.detectedPackageManager,
        };
      }

      case 'replace': {
        // CRITICAL: Validate typed confirmation
        if (!decision.typed_confirm_text) {
          this.emitWriteBlocked('Replace requires typed confirmation');
          return {
            canProceed: false,
            resolvedTarget: this.ctx.initial_target,
            inspection: this.inspection,
            recommendation: this.recommendation,
            needsUserInput: true,
            blockReason: 'Replace requires typed confirmation',
          };
        }

        if (!validateDestructiveConfirmation(decision.typed_confirm_text)) {
          this.emitWriteBlocked(`Invalid confirmation text. Expected: "${DESTRUCTIVE_CONFIRM_TEXT}"`);
          return {
            canProceed: false,
            resolvedTarget: this.ctx.initial_target,
            inspection: this.inspection,
            recommendation: this.recommendation,
            needsUserInput: true,
            blockReason: 'Invalid confirmation text',
          };
        }

        // Emit warning for destructive action
        this.emitDestructiveActionConfirmed();

        return {
          canProceed: true,
          resolvedTarget: this.ctx.initial_target,
          inspection: this.inspection,
          recommendation: this.recommendation,
          needsUserInput: false,
          destructiveConfirmed: true,
          packageManager: this.inspection.detectedPackageManager,
        };
      }

      default:
        throw new Error(`Unknown decision option: ${decision.option_id}`);
    }
  }

  /**
   * Get suggested paths for monorepo placement
   */
  getSuggestedMonorepoPaths(): Array<{ path: string; label: string; recommended: boolean }> {
    if (!this.inspection) {
      return [];
    }
    return suggestMonorepoPaths(this.inspection, this.ctx.app_name);
  }

  /**
   * Get current state (for replay)
   */
  getState(): PreflightState {
    return { ...this.state };
  }

  // =========================================================================
  // PRIVATE: Event Emission
  // =========================================================================

  private generateEventId(): string {
    return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private emitPreflightCompleted(): void {
    if (!this.inspection || !this.recommendation) return;

    const payload: PreflightCompletedPayload = {
      target_directory: this.inspection.absPath,
      inspection: this.inspection,
      recommended_action: this.recommendation,
    };

    const event: Event = {
      event_id: this.generateEventId(),
      task_id: this.ctx.run_id,
      timestamp: new Date().toISOString(),
      type: 'scaffold_preflight_completed',
      mode: this.ctx.mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: this.ctx.scaffold_id,
        ...payload,
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    this.ctx.eventBus.emit('event', event);
  }

  private emitDecisionNeeded(payload: PreflightDecisionPayload): void {
    const event: Event = {
      event_id: this.generateEventId(),
      task_id: this.ctx.run_id,
      timestamp: new Date().toISOString(),
      type: 'scaffold_preflight_decision_needed',
      mode: this.ctx.mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: this.ctx.scaffold_id,
        ...payload,
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    this.ctx.eventBus.emit('event', event);
  }

  private emitDecisionTaken(decision: PreflightUserDecision): void {
    const payload: PreflightDecisionTakenPayload = {
      option_id: decision.option_id,
      selected_path: decision.selected_path,
      typed_confirm_text: decision.typed_confirm_text,
    };

    const event: Event = {
      event_id: this.generateEventId(),
      task_id: this.ctx.run_id,
      timestamp: new Date().toISOString(),
      type: 'scaffold_preflight_decision_taken',
      mode: this.ctx.mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: this.ctx.scaffold_id,
        ...payload,
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    this.ctx.eventBus.emit('event', event);
  }

  private emitWriteBlocked(reason: string): void {
    const event: Event = {
      event_id: this.generateEventId(),
      task_id: this.ctx.run_id,
      timestamp: new Date().toISOString(),
      type: 'scaffold_write_blocked',
      mode: this.ctx.mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: this.ctx.scaffold_id,
        target_directory: this.inspection?.absPath || this.ctx.initial_target,
        reason,
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    this.ctx.eventBus.emit('event', event);
  }

  private emitDestructiveActionConfirmed(): void {
    // Emit a warning event to record the destructive action
    const event: Event = {
      event_id: this.generateEventId(),
      task_id: this.ctx.run_id,
      timestamp: new Date().toISOString(),
      type: 'scaffold_blocked' as any, // Reuse scaffold_blocked with different reason
      mode: this.ctx.mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: this.ctx.scaffold_id,
        target_directory: this.inspection?.absPath || this.ctx.initial_target,
        reason: 'DESTRUCTIVE_ACTION_CONFIRMED',
        message: 'User confirmed destructive replace operation',
        warning_code: 'DESTRUCTIVE_ACTION_CONFIRMED',
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    this.ctx.eventBus.emit('event', event);
  }
}

// ============================================================================
// FILE WRITE SAFETY GUARD
// ============================================================================

/**
 * File write safety context
 */
export interface WriteGuardContext {
  /** Approved target directory */
  approvedTarget: string;
  /** Was destructive replace confirmed? */
  destructiveConfirmed: boolean;
  /** Scaffold ID for audit */
  scaffold_id: string;
}

/**
 * Validate a file write operation
 * 
 * CRITICAL: Call this before EVERY file write in scaffold apply.
 * 
 * @param ctx - Write guard context
 * @param writePath - Absolute path being written to
 * @returns Validation result
 */
export async function validateFileWrite(
  ctx: WriteGuardContext,
  writePath: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Check 1: Path must be within approved target
  if (!isPathWithinTarget(ctx.approvedTarget, writePath)) {
    return {
      allowed: false,
      reason: `Path traversal detected: ${writePath} is outside approved target ${ctx.approvedTarget}`,
    };
  }

  // Check 2: If not destructive mode, check for overwrites
  if (!ctx.destructiveConfirmed) {
    const wouldOverwrite = await wouldOverwriteFile(writePath);
    if (wouldOverwrite) {
      return {
        allowed: false,
        reason: `Would overwrite existing file: ${writePath}. Destructive replace not confirmed.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Batch validate all file writes
 * 
 * @param ctx - Write guard context
 * @param writePaths - All paths to be written
 * @returns Validation result with any conflicts
 */
export async function validateAllFileWrites(
  ctx: WriteGuardContext,
  writePaths: string[]
): Promise<{
  allAllowed: boolean;
  conflicts: Array<{ path: string; reason: string }>;
}> {
  const conflicts: Array<{ path: string; reason: string }> = [];

  for (const writePath of writePaths) {
    const result = await validateFileWrite(ctx, writePath);
    if (!result.allowed) {
      conflicts.push({ path: writePath, reason: result.reason! });
    }
  }

  return {
    allAllowed: conflicts.length === 0,
    conflicts,
  };
}

// ============================================================================
// STATE DERIVATION (Replay-Safe)
// ============================================================================

/**
 * Derive preflight state from events (for replay)
 */
export function derivePreflightStateFromEvents(events: Event[]): PreflightState {
  const state: PreflightState = {
    started: false,
    inspectionComplete: false,
    decisionNeeded: false,
    decisionTaken: false,
    blocked: false,
  };

  for (const event of events) {
    switch (event.type) {
      case 'scaffold_preflight_started':
        state.started = true;
        break;

      case 'scaffold_preflight_completed':
        state.inspectionComplete = true;
        break;

      case 'scaffold_preflight_decision_needed':
        state.decisionNeeded = true;
        break;

      case 'scaffold_preflight_decision_taken': {
        state.decisionTaken = true;
        const payload = event.payload as unknown as PreflightDecisionTakenPayload;
        state.decision = {
          option_id: payload.option_id as any,
          selected_path: payload.selected_path,
          typed_confirm_text: payload.typed_confirm_text,
        };
        state.resolvedTarget = payload.selected_path;
        break;
      }

      case 'scaffold_write_blocked': {
        state.blocked = true;
        state.blockReason = event.payload.reason as string;
        break;
      }
    }
  }

  return state;
}
