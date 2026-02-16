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
  | 'max_iterations'  // Hit per-run iteration limit (auto-continued internally)
  | 'max_tokens'      // Hit per-run token budget (auto-continued internally)
  | 'end_turn'        // LLM stopped calling tools (thinks it's done)
  | 'error'           // Unrecoverable error during loop
  | 'user_stop'       // User clicked Stop
  | 'hard_limit';     // Hit absolute safety ceiling (iterations or tokens)

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
  /** Number of times the loop auto-continued (internal, not user-triggered) */
  continue_count: number;
  /** Max continues allowed per step (legacy, kept for compat but not used for gating) */
  max_continues: number;
  /** Max iterations per single AgenticLoop run (default 50) */
  max_iterations_per_run: number;
  /** Absolute safety ceiling — total iterations across ALL auto-continues (default 200) */
  max_total_iterations: number;
  /** Absolute safety ceiling — total tokens (input + output) across ALL auto-continues (default 4M) */
  max_total_tokens: number;
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
  /** Error message if stop_reason is 'error' */
  error_message?: string;
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
  max_total_iterations?: number;
  max_total_tokens?: number;
}): LoopSession {
  const now = new Date().toISOString();
  return {
    session_id: params.session_id,
    task_id: params.task_id,
    step_id: params.step_id,
    iteration_count: 0,
    continue_count: 0,
    max_continues: params.max_continues ?? 10,
    max_iterations_per_run: params.max_iterations_per_run ?? 50,
    max_total_iterations: params.max_total_iterations ?? 200,
    max_total_tokens: params.max_total_tokens ?? 4_000_000,
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

/** Check if the session can auto-continue (not at any hard safety ceiling) */
export function canContinue(session: LoopSession): boolean {
  return !isIterationBudgetExhausted(session) && !isTokenBudgetExhausted(session);
}

/** Get the maximum total iterations (hard safety ceiling) */
export function maxTotalIterations(session: LoopSession): number {
  return session.max_total_iterations;
}

/** Check if the session has exhausted its total iteration budget (hard ceiling) */
export function isIterationBudgetExhausted(session: LoopSession): boolean {
  return session.iteration_count >= session.max_total_iterations;
}

/** Check if the session has exhausted its total token budget (hard ceiling) */
export function isTokenBudgetExhausted(session: LoopSession): boolean {
  const totalUsed = session.total_tokens.input + session.total_tokens.output;
  return totalUsed >= session.max_total_tokens;
}

/** Get remaining auto-continues before hitting the hard ceiling */
export function remainingContinues(session: LoopSession): number {
  const remainingIterations = Math.max(0, session.max_total_iterations - session.iteration_count);
  return Math.ceil(remainingIterations / session.max_iterations_per_run);
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
    errorMessage?: string;
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
    error_message: result.errorMessage,
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
  const payload: Record<string, unknown> = {
    session_id: session.session_id,
    step_id: session.step_id,
    reason: session.stop_reason,
    iteration_count: session.iteration_count,
    continue_count: session.continue_count,
    max_continues: session.max_continues,
    max_total_iterations: session.max_total_iterations,
    can_continue: canContinue(session),
    remaining_continues: remainingContinues(session),
    staged_files: stagedSummary,
    staged_files_count: stagedSummary.length,
    total_tokens: session.total_tokens,
    final_text: session.final_text,
    tool_calls_count: session.tool_calls_count,
  };
  if (session.error_message) {
    payload.error_message = session.error_message;
  }
  return payload;
}
