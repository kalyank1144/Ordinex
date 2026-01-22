/**
 * StateReducer: Pure function from event stream to task state
 * Based on 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - Derive current task state from events
 * - Provide state snapshots to UI
 * - Support resume/replay
 * - No side effects
 * - Pure function over event stream
 */

import { Event, TaskState, Mode, Stage, TaskStatus } from './types';
import { ScopeManager, DEFAULT_SCOPE_CONTRACT } from './scopeManager';

/**
 * Initial task state
 */
function createInitialState(taskId: string): TaskState {
  return {
    task_id: taskId,
    mode: 'ANSWER',
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
        // In PLAN mode, plan creation completes the task
        // User must then explicitly switch to MISSION mode to execute
        if (newState.mode === 'PLAN') {
          newState.status = 'paused';  // Paused, waiting for approval to switch to MISSION
        }
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
