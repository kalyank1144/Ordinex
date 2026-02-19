/**
 * Unit tests for event-sourcing core
 * Tests write operations, replay, and ordering as required by specs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventStore } from '../eventStore';
import { EventBus } from '../eventBus';
import { StateReducer } from '../stateReducer';
import { ScopeManager } from '../scopeManager';
import { Event } from '../types';

// Test helpers
function createTestEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: `evt_${Date.now()}_${Math.random()}`,
    task_id: 'task_test',
    timestamp: new Date().toISOString(),
    type: 'intent_received',
    mode: 'MISSION',
    stage: 'none',
    payload: {},
    evidence_ids: [],
    parent_event_id: null,
    ...overrides,
  };
}

describe('EventStore', () => {
  let testDir: string;
  let storePath: string;
  let eventStore: EventStore;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
    storePath = path.join(testDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Write Operations', () => {
    it('should append events to store', async () => {
      const event = createTestEvent();
      await eventStore.append(event);

      const events = eventStore.getAllEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it('should persist events to disk with fsync', async () => {
      const event = createTestEvent();
      await eventStore.append(event);

      // Create new store instance to verify persistence
      const newStore = new EventStore(storePath);
      const events = newStore.getAllEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it('should reject unknown event types', async () => {
      const invalidEvent = createTestEvent({
        type: 'invalid_event_type' as any,
      });

      await expect(eventStore.append(invalidEvent)).rejects.toThrow(
        /Unknown event type/
      );
    });

    it('should validate required fields', async () => {
      const invalidEvent = {
        ...createTestEvent(),
        event_id: '',
      };

      await expect(eventStore.append(invalidEvent)).rejects.toThrow(
        /Missing event_id/
      );
    });

    it('should maintain immutability after write', async () => {
      const event = createTestEvent();
      await eventStore.append(event);

      // Try to modify returned events
      const events = eventStore.getAllEvents();
      events[0].payload.modified = true;

      // Original should be unchanged
      const freshEvents = eventStore.getAllEvents();
      expect(freshEvents[0].payload.modified).toBeUndefined();
    });
  });

  describe('Event Ordering', () => {
    it('should maintain insertion order', async () => {
      const events = [
        createTestEvent({ event_id: 'evt_1', type: 'intent_received' }),
        createTestEvent({ event_id: 'evt_2', type: 'mode_set' }),
        createTestEvent({ event_id: 'evt_3', type: 'stage_changed' }),
        createTestEvent({ event_id: 'evt_4', type: 'final' }),
      ];

      for (const event of events) {
        await eventStore.append(event);
      }

      const retrieved = eventStore.getAllEvents();
      expect(retrieved.map(e => e.event_id)).toEqual([
        'evt_1',
        'evt_2',
        'evt_3',
        'evt_4',
      ]);
    });

    it('should preserve order across restarts', async () => {
      const events = [
        createTestEvent({ event_id: 'evt_1', type: 'intent_received' }),
        createTestEvent({ event_id: 'evt_2', type: 'mode_set' }),
        createTestEvent({ event_id: 'evt_3', type: 'stage_changed' }),
      ];

      for (const event of events) {
        await eventStore.append(event);
      }

      // Simulate restart - create new store instance
      const newStore = new EventStore(storePath);
      const retrieved = newStore.getAllEvents();

      expect(retrieved.map(e => e.event_id)).toEqual(['evt_1', 'evt_2', 'evt_3']);
    });
  });

  describe('Query Operations', () => {
    it('should filter events by task ID', async () => {
      await eventStore.append(createTestEvent({ task_id: 'task_1' }));
      await eventStore.append(createTestEvent({ task_id: 'task_2' }));
      await eventStore.append(createTestEvent({ task_id: 'task_1' }));

      const task1Events = eventStore.getEventsByTaskId('task_1');
      expect(task1Events).toHaveLength(2);
      expect(task1Events.every(e => e.task_id === 'task_1')).toBe(true);
    });

    it('should filter events by type', async () => {
      await eventStore.append(createTestEvent({ type: 'intent_received' }));
      await eventStore.append(createTestEvent({ type: 'mode_set' }));
      await eventStore.append(createTestEvent({ type: 'intent_received' }));

      const intentEvents = eventStore.getEventsByType('intent_received');
      expect(intentEvents).toHaveLength(2);
    });

    it('should find event by ID', async () => {
      const event = createTestEvent({ event_id: 'evt_unique' });
      await eventStore.append(event);

      const found = eventStore.getEventById('evt_unique');
      expect(found).toEqual(event);
    });
  });

  describe('getDistinctTaskSummaries', () => {
    it('should return empty array when no events exist', () => {
      const summaries = eventStore.getDistinctTaskSummaries();
      expect(summaries).toEqual([]);
    });

    it('should return one summary per task', async () => {
      await eventStore.append(createTestEvent({ task_id: 'task_a', event_id: 'e1' }));
      await eventStore.append(createTestEvent({ task_id: 'task_b', event_id: 'e2' }));
      await eventStore.append(createTestEvent({ task_id: 'task_a', event_id: 'e3' }));

      const summaries = eventStore.getDistinctTaskSummaries();
      expect(summaries).toHaveLength(2);
      const ids = summaries.map(s => s.task_id);
      expect(ids).toContain('task_a');
      expect(ids).toContain('task_b');
    });

    it('should order by most recent activity first', async () => {
      await eventStore.append(createTestEvent({
        task_id: 'old_task', event_id: 'e1',
        timestamp: '2025-01-01T00:00:00.000Z',
      }));
      await eventStore.append(createTestEvent({
        task_id: 'new_task', event_id: 'e2',
        timestamp: '2025-06-01T00:00:00.000Z',
      }));

      const summaries = eventStore.getDistinctTaskSummaries();
      expect(summaries[0].task_id).toBe('new_task');
      expect(summaries[1].task_id).toBe('old_task');
    });

    it('should extract title from intent_received prompt', async () => {
      await eventStore.append(createTestEvent({
        task_id: 'task_titled', event_id: 'e1',
        type: 'intent_received',
        payload: { prompt: 'Change the button color' },
      }));

      const summaries = eventStore.getDistinctTaskSummaries();
      expect(summaries[0].title).toBe('Change the button color');
    });

    it('should use default title when no intent_received exists', async () => {
      await eventStore.append(createTestEvent({
        task_id: 'task_notitled', event_id: 'e1',
        type: 'mode_set', payload: { mode: 'PLAN' },
      }));

      const summaries = eventStore.getDistinctTaskSummaries();
      expect(summaries[0].title).toMatch(/^Task task_no/);
    });

    it('should extract mode from mode_set event', async () => {
      await eventStore.append(createTestEvent({
        task_id: 'task_m', event_id: 'e1', mode: 'ANSWER',
        type: 'intent_received', payload: { prompt: 'hello' },
      }));
      await eventStore.append(createTestEvent({
        task_id: 'task_m', event_id: 'e2', mode: 'MISSION',
        type: 'mode_set', payload: { mode: 'MISSION' },
      }));

      const summaries = eventStore.getDistinctTaskSummaries();
      expect(summaries[0].mode).toBe('MISSION');
    });

    it('should track correct event count and timestamps', async () => {
      await eventStore.append(createTestEvent({
        task_id: 'task_c', event_id: 'e1',
        timestamp: '2025-03-01T10:00:00.000Z',
      }));
      await eventStore.append(createTestEvent({
        task_id: 'task_c', event_id: 'e2',
        timestamp: '2025-03-01T11:00:00.000Z',
      }));
      await eventStore.append(createTestEvent({
        task_id: 'task_c', event_id: 'e3',
        timestamp: '2025-03-01T12:00:00.000Z',
      }));

      const summaries = eventStore.getDistinctTaskSummaries();
      expect(summaries[0].event_count).toBe(3);
      expect(summaries[0].first_event_at).toBe('2025-03-01T10:00:00.000Z');
      expect(summaries[0].last_event_at).toBe('2025-03-01T12:00:00.000Z');
    });
  });
});

describe('EventBus', () => {
  let testDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
    storePath = path.join(testDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should persist events before notifying subscribers', async () => {
    let subscriberCalled = false;
    const event = createTestEvent();

    eventBus.subscribe(() => {
      subscriberCalled = true;
      // Verify event is already persisted when subscriber is called
      const events = eventStore.getAllEvents();
      expect(events).toHaveLength(1);
    });

    await eventBus.publish(event);
    expect(subscriberCalled).toBe(true);
  });

  it('should notify all subscribers', async () => {
    const calls: number[] = [];

    eventBus.subscribe(() => { calls.push(1); });
    eventBus.subscribe(() => { calls.push(2); });
    eventBus.subscribe(() => { calls.push(3); });

    await eventBus.publish(createTestEvent());

    expect(calls).toHaveLength(3);
    expect(calls).toContain(1);
    expect(calls).toContain(2);
    expect(calls).toContain(3);
  });

  it('should support unsubscribe', async () => {
    let callCount = 0;
    const unsubscribe = eventBus.subscribe(() => { callCount++; });

    await eventBus.publish(createTestEvent());
    expect(callCount).toBe(1);

    unsubscribe();

    await eventBus.publish(createTestEvent());
    expect(callCount).toBe(1); // Should not increase
  });

  it('should handle subscriber errors gracefully', async () => {
    let normalSubscriberCalled = false;

    eventBus.subscribe(() => {
      throw new Error('Subscriber error');
    });

    eventBus.subscribe(() => {
      normalSubscriberCalled = true;
    });

    await eventBus.publish(createTestEvent());

    // Event should still be persisted despite subscriber error
    expect(eventStore.count()).toBe(1);
    expect(normalSubscriberCalled).toBe(true);
  });
});

describe('StateReducer', () => {
  let testDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let scopeManager: ScopeManager;
  let reducer: StateReducer;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
    storePath = path.join(testDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    scopeManager = new ScopeManager(eventBus);
    reducer = new StateReducer(scopeManager);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Deterministic Replay', () => {
    it('should produce same state from same event stream', () => {
      const events: Event[] = [
        createTestEvent({ event_id: 'evt_1', type: 'intent_received' }),
        createTestEvent({ event_id: 'evt_2', type: 'mode_set', mode: 'MISSION' }),
        createTestEvent({
          event_id: 'evt_3',
          type: 'stage_changed',
          payload: { stage: 'plan' },
        }),
      ];

      // Reduce multiple times
      const state1 = reducer.reduceForTask('task_test', events);
      const state2 = reducer.reduceForTask('task_test', events);
      const state3 = reducer.reduceForTask('task_test', events);

      // All states should be identical
      expect(state1).toEqual(state2);
      expect(state2).toEqual(state3);
    });

    it('should reconstruct correct task state from event stream', () => {
      const events: Event[] = [
        createTestEvent({
          event_id: 'evt_1',
          type: 'intent_received',
          task_id: 'task_123',
        }),
        createTestEvent({
          event_id: 'evt_2',
          type: 'mode_set',
          task_id: 'task_123',
          mode: 'MISSION',
        }),
        createTestEvent({
          event_id: 'evt_3',
          type: 'stage_changed',
          task_id: 'task_123',
          payload: { stage: 'edit' },
        }),
      ];

      const state = reducer.reduceForTask('task_123', events);

      expect(state.task_id).toBe('task_123');
      expect(state.mode).toBe('MISSION');
      expect(state.stage).toBe('edit');
      expect(state.status).toBe('running');
    });

    it('should handle multiple tasks independently', () => {
      const events: Event[] = [
        createTestEvent({ task_id: 'task_1', type: 'intent_received' }),
        createTestEvent({ task_id: 'task_2', type: 'intent_received' }),
        createTestEvent({ task_id: 'task_1', type: 'mode_set', mode: 'PLAN' }),
        createTestEvent({ task_id: 'task_2', type: 'mode_set', mode: 'MISSION' }),
      ];

      const states = reducer.reduce(events);

      expect(states.get('task_1')?.mode).toBe('PLAN');
      expect(states.get('task_2')?.mode).toBe('MISSION');
    });
  });

  describe('State Transitions', () => {
    it('should handle approval flow', () => {
      const events: Event[] = [
        createTestEvent({ type: 'intent_received' }),
        createTestEvent({
          type: 'approval_requested',
          payload: { approval_id: 'apr_1', approval_type: 'apply_diff' },
        }),
      ];

      const state = reducer.reduceForTask('task_test', events);

      expect(state.status).toBe('paused');
      expect(state.pending_approvals).toHaveLength(1);
      expect(state.pending_approvals[0].approval_id).toBe('apr_1');
    });

    it('should clear approval on resolution', () => {
      const events: Event[] = [
        createTestEvent({ type: 'intent_received' }),
        createTestEvent({
          type: 'approval_requested',
          payload: { approval_id: 'apr_1', approval_type: 'apply_diff' },
        }),
        createTestEvent({
          type: 'approval_resolved',
          payload: { approval_id: 'apr_1' },
        }),
      ];

      const state = reducer.reduceForTask('task_test', events);

      expect(state.status).toBe('running');
      expect(state.pending_approvals).toHaveLength(0);
    });

    it('should track iteration count', () => {
      const events: Event[] = [
        createTestEvent({
          type: 'autonomy_started',
          payload: { max_iterations: 5 },
        }),
        createTestEvent({ type: 'iteration_started' }),
        createTestEvent({ type: 'iteration_started' }),
        createTestEvent({ type: 'iteration_started' }),
      ];

      const state = reducer.reduceForTask('task_test', events);

      expect(state.iteration.current).toBe(3);
      expect(state.iteration.max).toBe(5);
    });

    it('should handle checkpoint tracking', () => {
      const events: Event[] = [
        createTestEvent({
          type: 'checkpoint_created',
          payload: { checkpoint_id: 'cp_001' },
        }),
        createTestEvent({
          type: 'checkpoint_restored',
          payload: { checkpoint_id: 'cp_002' },
        }),
      ];

      const state = reducer.reduceForTask('task_test', events);

      expect(state.active_checkpoint_id).toBe('cp_002');
    });

    it('should complete on final event', () => {
      const events: Event[] = [
        createTestEvent({ type: 'intent_received' }),
        createTestEvent({ type: 'final' }),
      ];

      const state = reducer.reduceForTask('task_test', events);

      expect(state.status).toBe('complete');
    });
  });

  describe('Event Stream Integrity', () => {
    it('should not mutate input events', () => {
      const events: Event[] = [
        createTestEvent({ type: 'intent_received' }),
        createTestEvent({ type: 'mode_set', mode: 'PLAN' }),
      ];

      const originalEvents = JSON.parse(JSON.stringify(events));

      reducer.reduceForTask('task_test', events);

      expect(events).toEqual(originalEvents);
    });

    it('should handle empty event stream', () => {
      const state = reducer.reduceForTask('task_test', []);

      expect(state.task_id).toBe('task_test');
      expect(state.status).toBe('idle');
      expect(state.stage).toBe('none');
    });
  });
});

describe('Integration: Full Event Sourcing Flow', () => {
  let testDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let scopeManager: ScopeManager;
  let reducer: StateReducer;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
    storePath = path.join(testDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    scopeManager = new ScopeManager(eventBus);
    reducer = new StateReducer(scopeManager);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should support complete write-replay cycle', async () => {
    // Simulate a complete task lifecycle
    const taskId = 'task_integration';

    await eventBus.publish(
      createTestEvent({ task_id: taskId, type: 'intent_received' })
    );
    await eventBus.publish(
      createTestEvent({ task_id: taskId, type: 'mode_set', mode: 'MISSION' })
    );
    await eventBus.publish(
      createTestEvent({
        task_id: taskId,
        type: 'stage_changed',
        payload: { stage: 'plan' },
      })
    );
    await eventBus.publish(
      createTestEvent({
        task_id: taskId,
        type: 'stage_changed',
        payload: { stage: 'edit' },
      })
    );
    await eventBus.publish(
      createTestEvent({ task_id: taskId, type: 'final' })
    );

    // Replay from stored events
    const events = eventStore.getEventsByTaskId(taskId);
    const state = reducer.reduceForTask(taskId, events);

    // Verify final state
    expect(state.task_id).toBe(taskId);
    expect(state.mode).toBe('MISSION');
    expect(state.stage).toBe('edit');
    expect(state.status).toBe('complete');
    expect(events).toHaveLength(5);
  });

  it('should survive restart and replay correctly', async () => {
    const taskId = 'task_restart';

    // Write events
    await eventBus.publish(
      createTestEvent({ task_id: taskId, type: 'intent_received' })
    );
    await eventBus.publish(
      createTestEvent({ task_id: taskId, type: 'mode_set', mode: 'PLAN' })
    );
    await eventBus.publish(
      createTestEvent({ task_id: taskId, type: 'plan_created' })
    );

    // Simulate restart - create new instances
    const newStore = new EventStore(storePath);
    const newBus = new EventBus(newStore);
    const newScopeManager = new ScopeManager(newBus);
    const newReducer = new StateReducer(newScopeManager);

    // Replay
    const events = newStore.getEventsByTaskId(taskId);
    const state = newReducer.reduceForTask(taskId, events);

    // Verify state reconstructed correctly
    expect(state.task_id).toBe(taskId);
    expect(state.mode).toBe('PLAN');
    // plan_created in PLAN mode sets status to 'paused' (awaiting approval)
    expect(state.status).toBe('paused');
  });

  it('should maintain order and consistency across operations', async () => {
    const taskId = 'task_order';
    const capturedStates: any[] = [];

    // Subscribe to track state evolution
    eventBus.subscribe((event) => {
      if (event.task_id === taskId) {
        const events = eventStore.getEventsByTaskId(taskId);
        const state = reducer.reduceForTask(taskId, events);
        capturedStates.push({
          eventType: event.type,
          status: state.status,
          stage: state.stage,
        });
      }
    });

    // Publish sequence
    await eventBus.publish(
      createTestEvent({ task_id: taskId, type: 'intent_received' })
    );
    await eventBus.publish(
      createTestEvent({
        task_id: taskId,
        type: 'stage_changed',
        payload: { stage: 'plan' },
      })
    );
    await eventBus.publish(
      createTestEvent({
        task_id: taskId,
        type: 'stage_changed',
        payload: { stage: 'retrieve' },
      })
    );

    // Verify state progression
    expect(capturedStates).toHaveLength(3);
    expect(capturedStates[0].status).toBe('running');
    expect(capturedStates[1].stage).toBe('plan');
    expect(capturedStates[2].stage).toBe('retrieve');
  });
});
