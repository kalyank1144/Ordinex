/**
 * LoopSessionState — Persistable state for AgenticLoop Continue functionality.
 *
 * Tracks iteration count, continue count, token usage, and holds references
 * to the staged buffer and conversation history snapshots so the loop can
 * be resumed after a pause.
 *
 * Pure core module (P1 compliant — no FS, no side effects).
 */

import type { StagedBufferSnapshot } from './stagedEditBuffer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Reason why the loop paused */
export type LoopPauseReason =
  | 'max_iterations'  // Hit per-run iteration limit
  | 'max_tokens'      // Hit per-run token budget
  | 'end_turn'        // LLM stopped calling tools (thinks it's done)
  | 'error'           // Unrecoverable error during loop
  | 'user_stop';      // User clicked Stop

/** Serializable loop session state */
export interface LoopSession {
  /** Unique session ID */
  session_id: string;
  /** Task ID this loop belongs to */
  task_id: string;
  /** Step ID being executed */
  step_id: string;
  /** Total iterations across all continues */
  iteration_count: number;
  /** Number of times user hit Continue */
  continue_count: number;
  /** Max continues allowed per step (default 3) */
  max_continues: number;
  /** Max iterations per run (default 10) */
  max_iterations_per_run: number;
  /** Cumulative token usage */
  total_tokens: { input: number; output: number };
  /** Why the loop last paused */
  stop_reason: LoopPauseReason | null;
  /** Final text from the LLM (last response) */
  final_text: string;
  /** All tool calls made during the loop */
  tool_calls_count: number;
  /** Serialized StagedEditBuffer snapshot for resume */
  staged_snapshot: StagedBufferSnapshot | null;
  /** Serialized ConversationHistory for resume */
  conversation_snapshot: {
    messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  } | null;
  /** When session was created */
  created_at: string;
  /** When session was last updated */
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a new LoopSession with sensible defaults */
export function createLoopSession(params: {
  session_id: string;
  task_id: string;
  step_id: string;
  max_continues?: number;
  max_iterations_per_run?: number;
}): LoopSession {
  const now = new Date().toISOString();
  return {
    session_id: params.session_id,
    task_id: params.task_id,
    step_id: params.step_id,
    iteration_count: 0,
    continue_count: 0,
    max_continues: params.max_continues ?? 3,
    max_iterations_per_run: params.max_iterations_per_run ?? 10,
    total_tokens: { input: 0, output: 0 },
    stop_reason: null,
    final_text: '',
    tool_calls_count: 0,
    staged_snapshot: null,
    conversation_snapshot: null,
    created_at: now,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Check if the session can continue (not at max continues) */
export function canContinue(session: LoopSession): boolean {
  return session.continue_count < session.max_continues;
}

/** Get the maximum total iterations (all continues combined) */
export function maxTotalIterations(session: LoopSession): number {
  return (session.max_continues + 1) * session.max_iterations_per_run;
}

/** Check if the session has exhausted its total iteration budget */
export function isIterationBudgetExhausted(session: LoopSession): boolean {
  return session.iteration_count >= maxTotalIterations(session);
}

/** Get remaining continues */
export function remainingContinues(session: LoopSession): number {
  return Math.max(0, session.max_continues - session.continue_count);
}

/** Update session after a loop run completes */
export function updateSessionAfterRun(
  session: LoopSession,
  result: {
    iterations: number;
    totalTokens: { input: number; output: number };
    stopReason: LoopPauseReason;
    finalText: string;
    toolCallsCount: number;
    stagedSnapshot: StagedBufferSnapshot | null;
    conversationSnapshot: { messages: Array<{ role: 'user' | 'assistant'; content: unknown }> } | null;
  },
): LoopSession {
  return {
    ...session,
    iteration_count: session.iteration_count + result.iterations,
    total_tokens: {
      input: session.total_tokens.input + result.totalTokens.input,
      output: session.total_tokens.output + result.totalTokens.output,
    },
    stop_reason: result.stopReason,
    final_text: result.finalText,
    tool_calls_count: session.tool_calls_count + result.toolCallsCount,
    staged_snapshot: result.stagedSnapshot,
    conversation_snapshot: result.conversationSnapshot,
    updated_at: new Date().toISOString(),
  };
}

/** Update session after user clicks Continue */
export function incrementContinue(session: LoopSession): LoopSession {
  return {
    ...session,
    continue_count: session.continue_count + 1,
    stop_reason: null, // Clear stop reason on continue
    updated_at: new Date().toISOString(),
  };
}

/** Build the loop_paused event payload from a session */
export function buildLoopPausedPayload(session: LoopSession, stagedSummary: Array<{ path: string; action: string; edit_count: number }>): Record<string, unknown> {
  return {
    session_id: session.session_id,
    step_id: session.step_id,
    reason: session.stop_reason,
    iteration_count: session.iteration_count,
    continue_count: session.continue_count,
    max_continues: session.max_continues,
    can_continue: canContinue(session),
    remaining_continues: remainingContinues(session),
    staged_files: stagedSummary,
    staged_files_count: stagedSummary.length,
    total_tokens: session.total_tokens,
    final_text: session.final_text,
    tool_calls_count: session.tool_calls_count,
  };
}
