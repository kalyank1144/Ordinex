/**
 * StateReducer: Pure function from event stream to task state
 * Based on 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * Updated for Step 27 - Mission Execution Harness
 * 
 * Requirements:
 * - Derive current task state from events
 * - Provide state snapshots to UI
 * - Support resume/replay
 * - No side effects
 * - Pure function over event stream
 * - Support crash recovery (resume in paused state)
 */

import { Event, TaskState, Mode, Stage, TaskStatus } from './types';
import { ScopeManager, DEFAULT_SCOPE_CONTRACT } from './scopeManager';
import { derivePlanState, CurrentPlanState } from './planVersionManager';
import { MissionRunStage } from './missionRunner';

/**
 * Initial task state
 */
function createInitialState(taskId: string): TaskState {
  return {
    task_id: taskId,
    mode: 'MISSION',
    status: 'idle',
    stage: 'none',
    iteration: {
      current: 0,
      max: 3,
    },
    budgets: {
      time_remaining_ms: 0,
      tool_calls_remaining: 0,
    },
    pending_approvals: [],
    active_checkpoint_id: null,
    scope_summary: {
      contract: { ...DEFAULT_SCOPE_CONTRACT },
      in_scope_files: [],
      touched_files: [],
      lines_retrieved: 0,
      tools_used: [],
    },
  };
}

/**
 * StateReducer: Pure function that reduces event stream to current task state
 * 
 * This is the core of deterministic replay.
 * Given the same event stream, it MUST produce the same state.
 */
export class StateReducer {
  private scopeManager: ScopeManager;

  constructor(scopeManager: ScopeManager) {
    this.scopeManager = scopeManager;
  }

  /**
   * Reduce a stream of events to the current task state
   * Pure function - no side effects
   */
  reduce(events: Event[]): Map<string, TaskState> {
    const states = new Map<string, TaskState>();

    for (const event of events) {
      const currentState = states.get(event.task_id) || createInitialState(event.task_id);
      const nextState = this.applyEvent(currentState, event);
      states.set(event.task_id, nextState);
    }

    // Derive scope summaries from events for all tasks
    for (const [taskId, state] of states.entries()) {
      const taskEvents = events.filter(e => e.task_id === taskId);
      state.scope_summary = this.scopeManager.deriveScopeSummary(taskId, taskEvents);
    }

    return states;
  }

  /**
   * Get state for a specific task from event stream
   */
  reduceForTask(taskId: string, events: Event[]): TaskState {
    const taskEvents = events.filter(e => e.task_id === taskId);
    let state = createInitialState(taskId);

    for (const event of taskEvents) {
      state = this.applyEvent(state, event);
    }

    // Derive scope summary from events
    state.scope_summary = this.scopeManager.deriveScopeSummary(taskId, taskEvents);

    return state;
  }

  /**
   * Apply a single event to a state (pure function)
   * Returns new state, does not mutate input
   */
  private applyEvent(state: TaskState, event: Event): TaskState {
    // Create new state object (immutable update)
    const newState: TaskState = {
      ...state,
      iteration: { ...state.iteration },
      budgets: { ...state.budgets },
      pending_approvals: [...state.pending_approvals],
    };

    // Apply event-specific state changes
    switch (event.type) {
      case 'intent_received':
        newState.status = 'running';
        break;

      case 'mode_set':
        newState.mode = event.mode;
        break;

      case 'stage_changed':
        newState.stage = event.payload.stage as Stage;
        break;

      case 'plan_created':
      case 'plan_revised':
        // Plan created or refined - paused awaiting approval
        // User must approve the plan before executing
        if (newState.mode === 'PLAN') {
          newState.status = 'paused';  // Paused, waiting for approval to switch to MISSION
        }
        // Plan version info is tracked via derivePlanState()
        break;

      case 'plan_large_detected':
        // Large plan detected - paused, waiting for breakdown/selection
        newState.status = 'paused';
        break;

      case 'mission_breakdown_created':
        newState.status = 'paused';
        break;

      case 'mission_selected':
        newState.status = 'running';
        break;

      case 'mission_started':
        newState.status = 'running';
        break;

      case 'step_started':
        // Step execution is starting
        // State tracking happens via stage_changed
        break;

      case 'step_completed':
        // Step execution completed
        // Advance to next step (tracked in mission executor)
        break;

      case 'approval_requested':
        newState.status = 'paused';
        newState.pending_approvals.push({
          approval_id: event.payload.approval_id as string,
          type: event.payload.approval_type as 'terminal' | 'apply_diff' | 'scope_expansion',
          requested_at: event.timestamp,
        });
        break;

      case 'approval_resolved':
        newState.status = 'running';
        newState.pending_approvals = newState.pending_approvals.filter(
          a => a.approval_id !== event.payload.approval_id
        );
        break;

      case 'checkpoint_created':
        newState.active_checkpoint_id = event.payload.checkpoint_id as string;
        break;

      case 'checkpoint_restored':
        newState.active_checkpoint_id = event.payload.checkpoint_id as string;
        break;

      case 'execution_paused':
        newState.status = 'paused';
        break;

      case 'execution_resumed':
        newState.status = 'running';
        break;

      case 'execution_stopped':
        newState.status = 'idle';
        break;

      case 'failure_detected':
        newState.status = 'error';
        break;

      case 'autonomy_started':
        newState.iteration.current = 0;
        if (event.payload.max_iterations) {
          newState.iteration.max = event.payload.max_iterations as number;
        }
        break;

      case 'iteration_started':
        newState.iteration.current += 1;
        break;

      case 'iteration_failed':
        // State remains, waiting for next iteration or halt
        break;

      case 'iteration_succeeded':
        // Success - ready for completion
        break;

      case 'budget_exhausted':
        newState.status = 'paused';
        break;

      case 'autonomy_halted':
        newState.status = 'paused';
        break;

      case 'autonomy_completed':
        newState.status = 'complete';
        break;

      case 'final':
        newState.status = 'complete';
        break;

      // Step 27: Mission Execution Harness events
      case 'mission_completed':
        newState.status = 'complete';
        break;

      case 'mission_paused':
        newState.status = 'paused';
        break;

      case 'mission_cancelled':
        newState.status = 'idle';
        break;

      case 'stale_context_detected':
        // Stale context - will trigger re-retrieval
        // Status doesn't change, just logged
        break;

      case 'stage_timeout':
        // Stage timed out - typically transitions to paused
        newState.status = 'paused';
        break;

      case 'repair_attempt_started':
        newState.stage = 'repair';
        newState.iteration.current += 1;
        break;

      case 'repair_attempt_completed':
        // Repair attempt finished (success or failure)
        // Status determined by follow-up events
        break;

      case 'repeated_failure_detected':
        // Loop detected - pause execution
        newState.status = 'paused';
        break;

      case 'test_started':
        newState.stage = 'test';
        break;

      case 'test_completed':
        // Tests passed
        break;

      case 'test_failed':
        // Tests failed - repair loop will handle
        break;

      case 'patch_plan_proposed':
        // Informational - no state change
        break;

      case 'context_snapshot_created':
        // Snapshot created for staleness detection - no state change
        break;

      // Tool, retrieval, diff events don't directly change task state
      // but they're part of the event stream for replay
      case 'retrieval_started':
      case 'retrieval_completed':
      case 'retrieval_failed':
      case 'tool_start':
      case 'tool_end':
      case 'diff_proposed':
      case 'diff_applied':
      case 'scope_expansion_requested':
      case 'scope_expansion_resolved':
      case 'plan_deviation_detected':
      case 'model_fallback_used':
      case 'mode_violation':
      case 'repair_attempted':
      case 'context_collected':
      case 'stream_delta':
      case 'stream_complete':
        // These events are logged but don't change core task state
        // They contribute to narration and evidence
        break;

      // VNext: Project Memory events (V2-V5)
      // Migration note: Runs before VNext won't have these; safe to ignore.
      case 'memory_facts_updated':
      case 'solution_captured':
        // Informational — memory system records these for retrieval.
        // No task state change.
        break;

      // VNext: Generated Tool events (V6-V8)
      case 'generated_tool_proposed':
      case 'generated_tool_saved':
      case 'generated_tool_run_started':
      case 'generated_tool_run_completed':
      case 'generated_tool_run_failed':
        // Informational — tool lifecycle events for the feed.
        // No task state change (approval is handled by existing approval_requested/resolved).
        break;

      // VNext: Agent Mode Policy (V9)
      case 'mode_changed':
        // Mode transition event — update the task's current mode.
        if (event.payload.to_mode) {
          newState.mode = event.payload.to_mode as Mode;
        }
        break;

      // W3: Autonomy Loop Detection
      case 'autonomy_loop_detected':
        newState.status = 'paused';
        break;
      case 'autonomy_downgraded':
        // Status already paused by loop_detected
        break;

      // Step 47: Resume After Crash
      case 'task_interrupted':
        newState.status = 'paused';
        break;
      case 'task_recovery_started':
        newState.status = 'running';
        break;
      case 'task_discarded':
        newState.status = 'idle';
        break;

      // Step 48: Undo System
      case 'undo_performed':
        // Informational — audit trail only. No task state change.
        break;

      // Step 49: Error Recovery UX
      case 'recovery_action_taken':
        // Informational — audit trail only. No task state change.
        break;

      // AgenticLoop Integration: Loop Pause + Continue
      case 'loop_paused':
        newState.status = 'paused';
        break;
      case 'loop_continued':
        newState.status = 'running';
        break;
      case 'loop_completed':
        // Loop finished — status determined by follow-up events (diff_proposed, step_completed, etc.)
        break;

      default:
        // Unknown event type should have been rejected at write time
        // But defensive handling here
        console.warn(`Unknown event type in reducer: ${event.type}`);
    }

    return newState;
  }
}

/**
 * Singleton instance for convenience
 * Note: Requires EventBus instance, which will be injected in actual usage
 */
export function createStateReducer(scopeManager: ScopeManager): StateReducer {
  return new StateReducer(scopeManager);
}
