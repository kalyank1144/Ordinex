/**
 * Step 47: Task Persistence + StateReducer crash event tests
 *
 * Tests that StateReducer handles task_interrupted, task_recovery_started,
 * and task_discarded events correctly.
 */

import { describe, it, expect } from 'vitest';
import { StateReducer } from '../stateReducer';
import { ScopeManager, DEFAULT_SCOPE_CONTRACT } from '../scopeManager';
import type { Event, Mode, Stage } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEvent(overrides: Partial<Event>): Event {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    task_id: 'task_1',
    timestamp: new Date().toISOString(),
    type: 'intent_received',
    mode: 'MISSION' as Mode,
    stage: 'none' as Stage,
    payload: {},
    evidence_ids: [],
    parent_event_id: null,
    ...overrides,
  };
}

function createReducer(): StateReducer {
  const scopeManager = new ScopeManager();
  return new StateReducer(scopeManager);
}

// ============================================================================
// StateReducer: task_interrupted
// ============================================================================

describe('StateReducer - task_interrupted', () => {
  it('should set status to paused', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received' }),
      createEvent({
        type: 'task_interrupted',
        payload: {
          task_id: 'task_1',
          was_clean_exit: false,
          is_likely_crash: true,
          recommended_action: 'resume',
        },
      }),
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.status).toBe('paused');
  });

  it('should transition from running to paused', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received' }), // status → running
      createEvent({ type: 'task_interrupted' }),  // status → paused
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.status).toBe('paused');
  });
});

// ============================================================================
// StateReducer: task_recovery_started
// ============================================================================

describe('StateReducer - task_recovery_started', () => {
  it('should set status to running', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received' }),
      createEvent({ type: 'task_interrupted' }),
      createEvent({
        type: 'task_recovery_started',
        payload: { task_id: 'task_1', action: 'resume' },
      }),
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.status).toBe('running');
  });

  it('should resume after interruption', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received' }),    // running
      createEvent({ type: 'task_interrupted' }),     // paused
      createEvent({ type: 'task_recovery_started' }),// running
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.status).toBe('running');
  });
});

// ============================================================================
// StateReducer: task_discarded
// ============================================================================

describe('StateReducer - task_discarded', () => {
  it('should set status to idle', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received' }),
      createEvent({ type: 'task_interrupted' }),
      createEvent({
        type: 'task_discarded',
        payload: { task_id: 'task_1' },
      }),
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.status).toBe('idle');
  });
});

// ============================================================================
// Full lifecycle: intent → crash → recovery
// ============================================================================

describe('StateReducer - full crash recovery lifecycle', () => {
  it('should handle intent → interrupted → recovery_started chain', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received', mode: 'MISSION' }),
      createEvent({
        type: 'stage_changed',
        payload: { from: 'none', to: 'edit', stage: 'edit' },
      }),
      createEvent({ type: 'task_interrupted' }),
      createEvent({ type: 'task_recovery_started' }),
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.status).toBe('running');
    expect(state.stage).toBe('edit');
  });

  it('should handle intent → interrupted → discarded chain', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received', mode: 'MISSION' }),
      createEvent({ type: 'task_interrupted' }),
      createEvent({ type: 'task_discarded' }),
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.status).toBe('idle');
  });

  it('should preserve mode through crash recovery', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received', mode: 'MISSION' }),
      createEvent({
        type: 'mode_changed',
        mode: 'MISSION',
        payload: { from_mode: 'ANSWER', to_mode: 'MISSION' },
      }),
      createEvent({ type: 'task_interrupted', mode: 'MISSION' }),
      createEvent({ type: 'task_recovery_started', mode: 'MISSION' }),
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.mode).toBe('MISSION');
    expect(state.status).toBe('running');
  });

  it('should handle multiple interruptions gracefully', () => {
    const reducer = createReducer();
    const events: Event[] = [
      createEvent({ type: 'intent_received' }),
      createEvent({ type: 'task_interrupted' }),
      createEvent({ type: 'task_recovery_started' }),
      createEvent({ type: 'task_interrupted' }),
      createEvent({ type: 'task_recovery_started' }),
    ];

    const state = reducer.reduceForTask('task_1', events);
    expect(state.status).toBe('running');
  });
});
