/**
 * Step 34.5: Shared Verify Phase Service (Refactored)
 * 
 * Single implementation of verification phase execution.
 * Called by both missionExecutor and missionRunner (no divergence).
 * 
 * REFACTORED IN STEP 34.5:
 * - Now uses shared runCommandPhase() for command execution
 * - Eliminated duplicate command spawning logic
 * - Maintains verify-specific discovery and events
 * - Maps CommandPhaseResult → VerifyPhaseResult
 * 
 * CRITICAL RULES:
 * - VERIFY is a MISSION PHASE (system-initiated post-apply)
 * - Never run commands in replay/audit mode
 * - Store full transcripts as evidence (never spam UI)
 * - Throttle streaming output
 * - Emit clean, structured events
 * - Return results for repair loop integration
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import type { Event, Mode, Stage } from './types';
import type {
  VerifyPolicyConfig,
  VerifyPhaseResult,
  DiscoveredCommand,
  CommandExecutionResult,
  VerifyStatus,
} from './verifyPolicy';
import {
  discoverVerifyCommands,
  filterSafeCommands,
  getDiscoverySummary,
  createNoCommandsDecisionOptions,
  createNoSafeCommandsDecisionOptions,
} from './commandDiscovery';
import { runCommandPhase, CommandPhaseContext } from './commandPhase';
import { resolveCommandPolicy } from './commandPolicy';

/**
 * Context for running verify phase
 * Provided by caller (missionExecutor or missionRunner)
 */
export interface VerifyPhaseContext {
  /** Current run/task ID */
  run_id: string;

  /** Mission ID if in mission context */
  mission_id?: string;

  /** Step ID if in step context */
  step_id?: string;

  /** Workspace root directory */
  workspaceRoot: string;

  /** Event bus for emitting events */
  eventBus: EventEmitter;

  /** Current mode */
  mode: Mode;

  /** Current stage (before verify) */
  previousStage: Stage;

  /** Verify policy snapshot for this run */
  verifyPolicy: VerifyPolicyConfig;

  /** Optional command override (user-provided) */
  commandOverride?: DiscoveredCommand;

  /** Is this a replay/audit (never execute commands) */
  isReplay?: boolean;

  /** Evidence store helper for writing evidence */
  writeEvidence: (
    type: string,
    content: string,
    summary: string
  ) => Promise<string>;
}

/**
 * Run verify phase
 * 
 * This is the single source of truth for verification execution.
 * Both missionExecutor and missionRunner call this.
 * 
 * @param ctx - Verify phase context
 * @returns Verify phase result
 */
export async function runVerifyPhase(
  ctx: VerifyPhaseContext
): Promise<VerifyPhaseResult> {
  const startTime = Date.now();

  // REPLAY SAFETY: Never execute in replay mode
  if (ctx.isReplay) {
    return {
      status: 'skipped',
      skipReason: 'Replay mode (evidence only)',
      executedCommands: [],
      durationMs: Date.now() - startTime,
    };
  }

  // Emit stage transition to 'verify'
  emitEvent(ctx, 'stage_changed', {
    from: ctx.previousStage,
    to: 'verify',
  });

  // Check policy mode
  if (ctx.verifyPolicy.mode === 'off') {
    emitEvent(ctx, 'verify_skipped', {
      reason: 'Policy mode is off',
    });

    return {
      status: 'skipped',
      skipReason: 'Verification disabled by policy',
      executedCommands: [],
      durationMs: Date.now() - startTime,
    };
  }

  // Discover commands (or use override)
  let commands: DiscoveredCommand[];
  if (ctx.commandOverride) {
    commands = [ctx.commandOverride];
  } else {
    commands = discoverVerifyCommands(ctx.workspaceRoot, ctx.verifyPolicy);
  }

  // Handle discovery failures
  const summary = getDiscoverySummary(commands);

  if (!summary.hasAny) {
    // No commands discovered at all
    emitDecisionPoint(
      ctx,
      'No verification commands found',
      'No package.json scripts detected. Would you like to specify a command manually?',
      createNoCommandsDecisionOptions()
    );

    return {
      status: 'skipped',
      skipReason: 'No commands discovered',
      executedCommands: [],
      durationMs: Date.now() - startTime,
    };
  }

  if (!summary.hasSafe) {
    // Commands found but none are safe
    emitDecisionPoint(
      ctx,
      'No safe verification commands',
      `Found ${summary.total} command(s) but none are safe to auto-run. Review options:`,
      createNoSafeCommandsDecisionOptions(commands)
    );

    return {
      status: 'skipped',
      skipReason: 'No safe commands found',
      executedCommands: [],
      durationMs: Date.now() - startTime,
    };
  }

  // Filter to safe commands only
  const safeCommands = filterSafeCommands(commands);

  // Handle prompt mode
  if (ctx.verifyPolicy.mode === 'prompt') {
    // Emit proposed commands and wait for user decision
    emitEvent(ctx, 'verify_proposed', {
      commands: safeCommands.map((c) => ({
        name: c.name,
        command: c.command,
        source: c.source,
      })),
      summary: summary.summary,
    });

    emitDecisionPoint(
      ctx,
      'Run verification commands?',
      summary.summary,
      [
        {
          label: 'Run verification',
          action: 'run_verify',
          description: `Execute: ${safeCommands.map((c) => c.name).join(', ')}`,
        },
        {
          label: 'Skip once',
          action: 'skip_once',
          description: 'Skip verification for this run',
        },
        {
          label: 'Disable verification',
          action: 'disable_verify',
          description: 'Turn off verification for this workspace',
        },
      ]
    );

    // In prompt mode, we stop here and wait for user action
    // The executor will re-invoke this function after user responds
    return {
      status: 'skipped',
      skipReason: 'Waiting for user approval',
      executedCommands: [],
      durationMs: Date.now() - startTime,
    };
  }

  // AUTO MODE: Use shared command execution phase
  emitEvent(ctx, 'verify_started', {
    commands: safeCommands.map((c) => ({
      name: c.name,
      command: c.command,
    })),
    policy_mode: 'auto',
    count: safeCommands.length,
  });

  // Convert verify policy to command policy
  const commandPolicy = resolveCommandPolicy({
    mode: ctx.verifyPolicy.mode,
    allowlistPatterns: ctx.verifyPolicy.allowlistPatterns,
    blocklistPatterns: ctx.verifyPolicy.blocklistPatterns,
    longRunningPatterns: [],  // Verify commands are always finite
    maxOutputBytesPerCommand: ctx.verifyPolicy.maxOutputBytesPerCommand,
    chunkThrottleMs: ctx.verifyPolicy.chunkThrottleMs,
    defaultTimeoutMs: ctx.verifyPolicy.commandTimeoutMs,
  });

  // Prepare command phase context
  const commandCtx: CommandPhaseContext = {
    run_id: ctx.run_id,
    mission_id: ctx.mission_id,
    step_id: ctx.step_id,
    workspaceRoot: ctx.workspaceRoot,
    eventBus: ctx.eventBus,
    mode: ctx.mode,
    previousStage: 'verify',  // Already transitioned to verify stage
    commandPolicy,
    commands: safeCommands.map((c) => c.command),
    executionContext: 'verify',
    isReplayOrAudit: ctx.isReplay || false,
    writeEvidence: ctx.writeEvidence,
  };

  // Execute commands via shared phase
  const commandResult = await runCommandPhase(commandCtx);

  // Map CommandPhaseResult → VerifyPhaseResult
  const status: VerifyStatus = commandResult.status === 'failure' ? 'fail' : 
                                commandResult.status === 'success' ? 'pass' : 'skipped';

  // Find failed command details
  let failedCommand: DiscoveredCommand | undefined;
  let transcriptEvidenceId: string | undefined;
  let errorSnippet: string | undefined;

  if (commandResult.failedCommand) {
    // Find the discovered command that matches
    failedCommand = safeCommands.find(
      (c) => c.command === commandResult.failedCommand
    );
    
    // Get evidence ID for failed command
    if (commandResult.evidenceRefs.length > 0) {
      transcriptEvidenceId = commandResult.evidenceRefs[commandResult.evidenceRefs.length - 1];
      
      // Try to extract error snippet from evidence
      // For now, we'll skip this as it requires reading evidence
      // TODO: Enhance to read evidence and extract error snippet
    }
  }

  // Emit verify completion event
  emitEvent(ctx, 'verify_completed', {
    status,
    commands_executed: commandResult.executedCommands.length,
    failed_command: failedCommand?.name,
    exit_code: commandResult.exitCode,
    transcript_evidence_id: transcriptEvidenceId,
  });

  return {
    status,
    failedCommand,
    exitCode: commandResult.exitCode,
    transcriptEvidenceId,
    summarizedErrorSnippet: errorSnippet,
    executedCommands: safeCommands.filter((c) =>
      commandResult.executedCommands.includes(c.command)
    ),
    durationMs: commandResult.durationMs,
  };
}

/**
 * Emit event helper
 */
function emitEvent(
  ctx: VerifyPhaseContext,
  type: string,
  payload: Record<string, unknown>
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: type as any, // Type assertion for new verify events
    mode: ctx.mode,
    stage: 'verify' as Stage, // Verify is not in Stage type yet, using 'none' fallback
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };

  ctx.eventBus.emit('event', event);
}

/**
 * Emit decision point
 */
function emitDecisionPoint(
  ctx: VerifyPhaseContext,
  title: string,
  description: string,
  options: Array<{ label: string; action: string; description?: string }>
): void {
  emitEvent(ctx, 'decision_point_needed', {
    title,
    description,
    options,
    context: 'verify',
  });
}

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Check if verify should run based on apply batch deduplication
 * 
 * Maintains in-memory set of completed verify batches
 * to prevent duplicate verification in same run.
 * 
 * @param ctx - Verify context
 * @returns true if should run, false if already ran
 */
const verifiedBatches = new Set<string>();

export function shouldRunVerify(ctx: VerifyPhaseContext): boolean {
  const batchId = `${ctx.run_id}_${ctx.mission_id || ''}_${ctx.step_id || ''}`;
  
  if (verifiedBatches.has(batchId)) {
    return false; // Already verified this batch
  }
  
  verifiedBatches.add(batchId);
  return true;
}

/**
 * Clear verify batch tracking (for testing or run cleanup)
 */
export function clearVerifyBatchTracking(): void {
  verifiedBatches.clear();
}
