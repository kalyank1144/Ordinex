/**
 * Step 34.5: Command Execution Phase Service
 * 
 * Single, shared implementation of terminal command execution.
 * Used by VERIFY (system-initiated) and QUICK_ACTION (user-initiated).
 * 
 * CRITICAL SAFETY RULES:
 * - Replay/audit mode: NEVER spawn processes, NEVER emit new events
 * - Default mode: 'prompt' (always ask before execution)
 * - Long-running commands (dev servers): ALWAYS prompt, even in auto mode
 * - Blocklist: dangerous operations rejected immediately
 * - Output: throttled streaming to Logs, stored as evidence
 * - Mission Feed: compact status only, NO raw output spam
 */

import { spawn, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import type {
  Event,
  Mode,
  CommandPhaseResult,
  SingleCommandResult,
  CommandKind,
  CommandExecutionContext,
} from './types';
import type { CommandPolicyConfig } from './commandPolicy';
import { classifyCommandKind, isCommandSafe } from './commandPolicy';

/**
 * Context for running command phase
 * Provided by caller (verifyPhase, QUICK_ACTION handler, etc.)
 */
export interface CommandPhaseContext {
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

  /** Current stage (before command execution) */
  previousStage: string;

  /** Command policy snapshot for this run */
  commandPolicy: CommandPolicyConfig;

  /** Commands to execute (already resolved, deterministic order) */
  commands: string[];

  /** Execution context (verify vs user-initiated) */
  executionContext: CommandExecutionContext;

  /** Is this a replay/audit (never execute commands) */
  isReplayOrAudit: boolean;

  /** Whether a user already approved execution for this decision */
  approvalGranted?: boolean;

  /** Evidence store helper for writing evidence */
  writeEvidence: (
    type: string,
    content: string,
    summary: string
  ) => Promise<string>;

  /** Evidence store helper for reading evidence (for replay) */
  readEvidence?: (evidenceId: string) => Promise<string | null>;
}

/**
 * Run command execution phase
 * 
 * This is the single source of truth for all command execution.
 * Both verifyPhase and QUICK_ACTION handlers call this.
 * 
 * REPLAY SAFETY: Never spawns processes or emits events in replay mode.
 * 
 * @param ctx - Command phase context
 * @returns Command phase result
 */
export async function runCommandPhase(
  ctx: CommandPhaseContext
): Promise<CommandPhaseResult> {
  const startTime = Date.now();

  // =========================================================================
  // STEP 1: REPLAY SAFETY - Never execute in replay/audit mode
  // =========================================================================
  if (ctx.isReplayOrAudit) {
    // Load results from evidence if available
    // DO NOT spawn processes, DO NOT emit new events
    return await loadReplayResult(ctx, startTime);
  }

  // =========================================================================
  // STEP 2: Emit stage transition to 'command'
  // =========================================================================
  emitEvent(ctx, 'stage_changed', {
    from: ctx.previousStage,
    to: 'command',
  });

  // =========================================================================
  // STEP 3: Policy mode handling
  // =========================================================================
  if (ctx.commandPolicy.mode === 'off') {
    emitEvent(ctx, 'command_skipped', {
      reason: 'Command execution disabled by policy',
      commands: ctx.commands,
      context: ctx.executionContext,
    });

    return {
      status: 'skipped',
      skipReason: 'Command execution disabled by policy',
      evidenceRefs: [],
      executedCommands: [],
      durationMs: Date.now() - startTime,
    };
  }

  // =========================================================================
  // STEP 4: Classify commands and check safety
  // =========================================================================
  const commandsWithKind: Array<{ command: string; kind: CommandKind }> = [];
  const unsafeCommands: Array<{ command: string; reason: string }> = [];

  for (const cmd of ctx.commands) {
    const kind = classifyCommandKind(cmd, ctx.commandPolicy);
    const safetyCheck = isCommandSafe(cmd, ctx.commandPolicy);

    if (!safetyCheck.safe) {
      unsafeCommands.push({ command: cmd, reason: safetyCheck.reason! });
    } else {
      commandsWithKind.push({ command: cmd, kind });
    }
  }

  // If any commands are unsafe, reject immediately
  if (unsafeCommands.length > 0) {
    emitEvent(ctx, 'command_skipped', {
      reason: 'Unsafe commands detected',
      unsafe_commands: unsafeCommands,
      context: ctx.executionContext,
    });

    return {
      status: 'skipped',
      skipReason: `Blocked ${unsafeCommands.length} unsafe command(s)`,
      evidenceRefs: [],
      executedCommands: [],
      durationMs: Date.now() - startTime,
    };
  }

  // =========================================================================
  // STEP 5: Determine if approval is needed
  // =========================================================================
  const hasLongRunning = commandsWithKind.some((c) => c.kind === 'long_running');
  const needsApproval =
    !ctx.approvalGranted &&
    (ctx.commandPolicy.mode === 'prompt' ||
      hasLongRunning); // Long-running ALWAYS need prompt unless already approved

  if (needsApproval) {
    // Emit proposed commands
    emitEvent(ctx, 'command_proposed', {
      commands: commandsWithKind.map((c) => ({
        command: c.command,
        kind: c.kind,
      })),
      context: ctx.executionContext,
      policy_mode: ctx.commandPolicy.mode,
    });

    // Emit decision point
    emitEvent(ctx, 'decision_point_needed', {
      title: 'Run command(s)?',
      description: `Execute ${commandsWithKind.length} command(s) ${
        hasLongRunning ? '(includes long-running)' : ''
      }`,
      options: [
        {
          label: 'Run command(s)',
          action: 'run_commands',
          description: commandsWithKind.map((c) => c.command).join(', '),
        },
        {
          label: 'Skip once',
          action: 'skip_once',
          description: 'Skip command execution for this run',
        },
        {
          label: 'Disable commands',
          action: 'disable_commands',
          description: 'Turn off command execution for this workspace',
        },
      ],
      context: 'command_execution',
    });

    // Return awaiting approval status
    // Caller will re-invoke after user responds
    return {
      status: 'awaiting_approval',
      evidenceRefs: [],
      executedCommands: [],
      durationMs: Date.now() - startTime,
    };
  }

  // =========================================================================
  // STEP 6: AUTO MODE - Execute commands
  // =========================================================================
  emitEvent(ctx, 'command_started', {
    commands: commandsWithKind.map((c) => c.command),
    context: ctx.executionContext,
    policy_mode: 'auto',
    count: commandsWithKind.length,
  });

  // Execute each command sequentially
  const results: SingleCommandResult[] = [];
  let failedCommand: string | undefined;
  let failedExitCode: number | undefined;

  for (let i = 0; i < commandsWithKind.length; i++) {
    const { command, kind } = commandsWithKind[i];

    // Execute command
    const result = await executeCommand(
      ctx,
      command,
      kind,
      i + 1,
      commandsWithKind.length
    );
    results.push(result);

    // Check for failure
    if (result.exitCode !== 0) {
      failedCommand = command;
      failedExitCode = result.exitCode;

      // For verify context, stop on first failure
      if (ctx.executionContext === 'verify') {
        break;
      }
    }
  }

  // Determine overall status
  const status: CommandPhaseResult['status'] = failedCommand
    ? 'failure'
    : 'success';

  // Emit completion
  emitEvent(ctx, 'command_completed', {
    status,
    commands_executed: results.length,
    failed_command: failedCommand,
    exit_code: failedExitCode,
    evidence_refs: results.map((r) => r.evidenceId),
    context: ctx.executionContext,
  });

  return {
    status,
    failedCommand,
    exitCode: failedExitCode,
    evidenceRefs: results.map((r) => r.evidenceId),
    executedCommands: results.map((r) => r.command),
    durationMs: Date.now() - startTime,
  };
}

/**
 * Execute a single command with streaming output
 * 
 * @param ctx - Command context
 * @param command - Command to execute
 * @param kind - Command kind (finite/long-running)
 * @param index - Command index (for display)
 * @param total - Total commands (for display)
 * @returns Command execution result
 */
async function executeCommand(
  ctx: CommandPhaseContext,
  command: string,
  kind: CommandKind,
  index: number,
  total: number
): Promise<SingleCommandResult> {
  const startTime = Date.now();

  // Emit command started
  emitEvent(ctx, 'command_started', {
    command,
    kind,
    index,
    total,
    cwd: ctx.workspaceRoot,
    context: ctx.executionContext,
  });

  // Buffers for stdout/stderr
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let truncated = false;

  // Throttled progress emitter
  let lastEmitTime = 0;
  const emitProgress = () => {
    const now = Date.now();
    if (now - lastEmitTime >= ctx.commandPolicy.chunkThrottleMs) {
      emitEvent(ctx, 'command_progress', {
        command,
        index,
        total,
        output_length: stdoutBuffer.length + stderrBuffer.length,
        kind,
      });
      lastEmitTime = now;
    }
  };

  return new Promise<SingleCommandResult>((resolve) => {
    // Determine timeout
    const timeout =
      kind === 'long_running' ? undefined : ctx.commandPolicy.defaultTimeoutMs;

    // Spawn process
    const proc: ChildProcess = spawn(command, {
      cwd: ctx.workspaceRoot,
      shell: true,
      timeout,
    });

    // Capture stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();

      // Check size limit
      if (
        stdoutBuffer.length + text.length >
        ctx.commandPolicy.maxOutputBytesPerCommand
      ) {
        truncated = true;
        // Keep last portion only
        const keep = Math.floor(ctx.commandPolicy.maxOutputBytesPerCommand / 2);
        stdoutBuffer = stdoutBuffer.slice(-keep) + text.slice(-keep);
      } else {
        stdoutBuffer += text;
      }

      emitProgress();
    });

    // Capture stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();

      // Check size limit
      if (
        stderrBuffer.length + text.length >
        ctx.commandPolicy.maxOutputBytesPerCommand
      ) {
        truncated = true;
        // Keep last portion only
        const keep = Math.floor(ctx.commandPolicy.maxOutputBytesPerCommand / 2);
        stderrBuffer = stderrBuffer.slice(-keep) + text.slice(-keep);
      } else {
        stderrBuffer += text;
      }

      emitProgress();
    });

    // Handle completion
    proc.on('close', async (code: number | null) => {
      const exitCode = code ?? -1;
      const durationMs = Date.now() - startTime;

      // Store transcript as evidence
      const transcript = {
        command,
        kind,
        exitCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        truncated,
        durationMs,
        context: ctx.executionContext,
      };

      const evidenceId = await ctx.writeEvidence(
        'command_output',
        JSON.stringify(transcript, null, 2),
        `Command: ${command} (exit ${exitCode})`
      );

      // Emit command completed
      emitEvent(ctx, 'command_completed', {
        command,
        kind,
        exit_code: exitCode,
        duration_ms: durationMs,
        evidence_id: evidenceId,
        truncated,
        stdout_lines: stdoutBuffer.split('\n').length,
        stderr_lines: stderrBuffer.split('\n').length,
        index,
        total,
      });

      resolve({
        command,
        kind,
        exitCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        truncated,
        durationMs,
        evidenceId,
      });
    });

    // Handle error
    proc.on('error', async (err: Error) => {
      const durationMs = Date.now() - startTime;
      const errorMsg = `Failed to execute: ${err.message}`;
      stderrBuffer += `\n${errorMsg}`;

      const evidenceId = await ctx.writeEvidence(
        'command_error',
        JSON.stringify({ command, kind, error: err.message }, null, 2),
        `Command error: ${command}`
      );

      emitEvent(ctx, 'command_completed', {
        command,
        kind,
        exit_code: -1,
        duration_ms: durationMs,
        error: err.message,
        evidence_id: evidenceId,
        index,
        total,
      });

      resolve({
        command,
        kind,
        exitCode: -1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        truncated,
        durationMs,
        evidenceId,
      });
    });
  });
}

/**
 * Load replay result from evidence
 * 
 * In replay/audit mode, we load the stored result instead of re-executing.
 * This ensures deterministic replay without side effects.
 * 
 * @param ctx - Command context
 * @param startTime - Start time for duration calculation
 * @returns Command phase result from evidence
 */
async function loadReplayResult(
  ctx: CommandPhaseContext,
  startTime: number
): Promise<CommandPhaseResult> {
  // In replay mode, we don't emit new events or spawn processes
  // The UI will render from stored events + evidence

  // For now, return a skipped result
  // In a full implementation, we would load the actual result from evidence
  return {
    status: 'skipped',
    skipReason: 'Replay mode (evidence only)',
    evidenceRefs: [],
    executedCommands: [],
    durationMs: Date.now() - startTime,
  };
}

/**
 * Emit event helper
 */
function emitEvent(
  ctx: CommandPhaseContext,
  type: string,
  payload: Record<string, unknown>
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: type as any,
    mode: ctx.mode,
    stage: 'command',
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };

  const bus: any = ctx.eventBus as any;
  if (typeof bus.emit === 'function') {
    bus.emit('event', event);
  } else if (typeof bus.publish === 'function') {
    void bus.publish(event);
  } else {
    console.error('[commandPhase] eventBus missing emit/publish');
  }
}

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}
