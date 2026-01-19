/**
 * Unit tests for Scope Control UX and enforcement
 * Based on 01_UI_UX_SPEC.md Section 8 and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventStore } from '../eventStore';
import { EventBus } from '../eventBus';
import { ScopeManager, DEFAULT_SCOPE_CONTRACT } from '../scopeManager';
import { StateReducer } from '../stateReducer';
import { Event, ScopeContract, ScopeExpansionRequest } from '../types';

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

describe('ScopeManager', () => {
  let testDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let scopeManager: ScopeManager;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
    storePath = path.join(testDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    scopeManager = new ScopeManager(eventBus);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Scope Summary Derivation', () => {
    it('should derive initial scope summary from plan event', async () => {
      const taskId = 'task_scope_1';
      const customContract: ScopeContract = {
        max_files: 5,
        max_lines: 500,
        allowed_tools: ['read', 'exec'],
        budgets: {
          max_iterations: 2,
          max_tool_calls: 20,
          max_time_ms: 60000,
        },
      };

      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'plan_created',
          payload: {
            scope_contract: customContract,
            files: ['src/index.ts', 'src/app.ts'],
          },
        })
      );

      const events = eventStore.getEventsByTaskId(taskId);
      const summary = scopeManager.deriveScopeSummary(taskId, events);

      expect(summary.contract).toEqual(customContract);
      expect(summary.in_scope_files).toEqual(['src/index.ts', 'src/app.ts']);
      expect(summary.touched_files).toHaveLength(0);
      expect(summary.lines_retrieved).toBe(0);
      expect(summary.tools_used).toHaveLength(0);
    });

    it('should use default scope contract if not specified', () => {
      const taskId = 'task_scope_2';
      const events: Event[] = [];
      const summary = scopeManager.deriveScopeSummary(taskId, events);

      expect(summary.contract).toEqual(DEFAULT_SCOPE_CONTRACT);
      expect(summary.in_scope_files).toHaveLength(0);
      expect(summary.touched_files).toHaveLength(0);
    });

    it('should track touched files from retrieval events', async () => {
      const taskId = 'task_scope_3';

      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'retrieval_completed',
          payload: {
            files: [
              { path: 'src/index.ts', line_range: { start: 1, end: 50 } },
              { path: 'src/app.ts', line_range: { start: 10, end: 30 } },
            ],
          },
        })
      );

      const events = eventStore.getEventsByTaskId(taskId);
      const summary = scopeManager.deriveScopeSummary(taskId, events);

      expect(summary.touched_files).toHaveLength(2);
      expect(summary.touched_files[0].path).toBe('src/index.ts');
      expect(summary.touched_files[0].operations).toHaveLength(1);
      expect(summary.touched_files[0].operations[0].type).toBe('read');
      expect(summary.lines_retrieved).toBe(71); // 50 + 21 lines
    });

    it('should track write operations from diff_applied events', async () => {
      const taskId = 'task_scope_4';

      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'diff_applied',
          payload: {
            files: ['src/index.ts', 'src/utils.ts'],
          },
        })
      );

      const events = eventStore.getEventsByTaskId(taskId);
      const summary = scopeManager.deriveScopeSummary(taskId, events);

      expect(summary.touched_files).toHaveLength(2);
      expect(summary.touched_files.every(f => f.operations[0].type === 'write')).toBe(true);
      expect(summary.tools_used).toContain('write');
    });

    it('should track multiple operations on same file', async () => {
      const taskId = 'task_scope_5';

      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'retrieval_completed',
          payload: {
            files: [{ path: 'src/index.ts', line_range: { start: 1, end: 10 } }],
          },
        })
      );

      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'diff_applied',
          payload: {
            files: ['src/index.ts'],
          },
        })
      );

      const events = eventStore.getEventsByTaskId(taskId);
      const summary = scopeManager.deriveScopeSummary(taskId, events);

      expect(summary.touched_files).toHaveLength(1);
      expect(summary.touched_files[0].operations).toHaveLength(2);
      expect(summary.touched_files[0].operations[0].type).toBe('read');
      expect(summary.touched_files[0].operations[1].type).toBe('write');
    });
  });

  describe('Scope Validation', () => {
    it('should allow actions within scope', () => {
      const summary = scopeManager.deriveScopeSummary('task_test', []);

      const result = scopeManager.validateAction(summary, {
        type: 'read',
        files: ['src/index.ts'],
        lines: 100,
      });

      expect(result.allowed).toBe(true);
    });

    it('should block when file limit exceeded', () => {
      const summary = scopeManager.deriveScopeSummary('task_test', []);
      // Set in_scope_files to max limit
      summary.in_scope_files = new Array(summary.contract.max_files).fill('file.ts');

      const result = scopeManager.validateAction(summary, {
        type: 'read',
        files: ['new-file.ts'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('max files');
      expect(result.requires_expansion).toBeDefined();
      expect(result.requires_expansion?.requested.files).toEqual(['new-file.ts']);
    });

    it('should block when line limit exceeded', () => {
      const summary = scopeManager.deriveScopeSummary('task_test', []);
      summary.lines_retrieved = summary.contract.max_lines - 10;

      const result = scopeManager.validateAction(summary, {
        type: 'read',
        lines: 50, // Would exceed limit
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('max lines');
      expect(result.requires_expansion).toBeDefined();
    });

    it('should block when tool category not allowed', () => {
      const summary = scopeManager.deriveScopeSummary('task_test', []);
      summary.contract.allowed_tools = ['read']; // Only read allowed

      const result = scopeManager.validateAction(summary, {
        type: 'write',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
      expect(result.requires_expansion?.requested.tools).toContain('write');
    });

    it('should allow files already in scope', () => {
      const summary = scopeManager.deriveScopeSummary('task_test', []);
      summary.in_scope_files = ['src/index.ts', 'src/app.ts'];

      const result = scopeManager.validateAction(summary, {
        type: 'read',
        files: ['src/index.ts'], // Already in scope
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Scope Expansion Flow', () => {
    it('should emit scope_expansion_requested event', async () => {
      const taskId = 'task_expansion_1';
      const request: ScopeExpansionRequest = {
        requested: {
          files: ['src/new-file.ts'],
        },
        reason: 'Need to access additional file for implementation',
        impact_level: 'low',
      };

      await scopeManager.requestScopeExpansion(taskId, 'MISSION', 'edit', request);

      const events = eventStore.getEventsByTaskId(taskId);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('scope_expansion_requested');
      expect(events[0].payload.request).toEqual(request);
      expect(events[0].payload.approval_id).toBeDefined();
    });

    it('should emit scope_expansion_resolved event on approval', async () => {
      const taskId = 'task_expansion_2';
      const request: ScopeExpansionRequest = {
        requested: { files: ['src/test.ts'] },
        reason: 'Testing',
        impact_level: 'low',
      };
      const approvalId = 'approval_123';

      scopeManager.resolveScopeExpansion(taskId, 'MISSION', 'edit', approvalId, true, request);

      const events = eventStore.getEventsByTaskId(taskId);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('scope_expansion_resolved');
      expect(events[0].payload.approved).toBe(true);
      expect(events[0].payload.approval_id).toBe(approvalId);
    });

    it('should expand scope after approval', async () => {
      const taskId = 'task_expansion_3';

      // Initial plan with scope
      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'plan_created',
          payload: {
            scope_contract: { ...DEFAULT_SCOPE_CONTRACT, max_files: 3 },
            files: ['src/a.ts', 'src/b.ts'],
          },
        })
      );

      // Request expansion
      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'scope_expansion_requested',
          payload: {
            approval_id: 'apr_1',
            request: {
              requested: { files: ['src/c.ts', 'src/d.ts'] },
              reason: 'Need more files',
              impact_level: 'medium',
            },
          },
        })
      );

      // Approve expansion
      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'scope_expansion_resolved',
          payload: {
            approval_id: 'apr_1',
            approved: true,
            request: {
              requested: { files: ['src/c.ts', 'src/d.ts'] },
              reason: 'Need more files',
              impact_level: 'medium',
            },
          },
        })
      );

      const events = eventStore.getEventsByTaskId(taskId);
      const summary = scopeManager.deriveScopeSummary(taskId, events);

      expect(summary.contract.max_files).toBe(5); // 3 + 2 expanded
      expect(summary.in_scope_files).toContain('src/c.ts');
      expect(summary.in_scope_files).toContain('src/d.ts');
    });

    it('should not expand scope if denied', async () => {
      const taskId = 'task_expansion_4';

      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'plan_created',
          payload: {
            scope_contract: { ...DEFAULT_SCOPE_CONTRACT, max_files: 3 },
          },
        })
      );

      await eventBus.publish(
        createTestEvent({
          task_id: taskId,
          type: 'scope_expansion_resolved',
          payload: {
            approval_id: 'apr_1',
            approved: false, // Denied
            request: {
              requested: { files: ['src/extra.ts'] },
              reason: 'Extra file',
              impact_level: 'low',
            },
          },
        })
      );

      const events = eventStore.getEventsByTaskId(taskId);
      const summary = scopeManager.deriveScopeSummary(taskId, events);

      expect(summary.contract.max_files).toBe(3); // Unchanged
      expect(summary.in_scope_files).not.toContain('src/extra.ts');
    });
  });

  describe('Impact Level Calculation', () => {
    it('should calculate low impact for small requests', () => {
      const summary = scopeManager.deriveScopeSummary('task_test', []);
      summary.contract.max_files = 1; // Set limit low so expansion is needed
      summary.in_scope_files = ['existing.ts']; // Fill the limit

      const result = scopeManager.validateAction(summary, {
        type: 'read',
        files: ['file1.ts'], // New file will trigger expansion
        lines: 50,
      });

      expect(result.allowed).toBe(false);
      expect(result.requires_expansion).toBeDefined();
      expect(result.requires_expansion?.impact_level).toBe('low');
    });

    it('should calculate high impact for write tools', () => {
      const summary = scopeManager.deriveScopeSummary('task_test', []);
      summary.contract.allowed_tools = ['read'];

      const result = scopeManager.validateAction(summary, {
        type: 'write',
      });

      expect(result.requires_expansion?.impact_level).toBe('medium');
    });
  });
});

describe('StateReducer with Scope', () => {
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

  it('should include scope_summary in task state', () => {
    const taskId = 'task_state_1';
    const events: Event[] = [
      createTestEvent({ task_id: taskId, type: 'intent_received' }),
    ];

    const state = reducer.reduceForTask(taskId, events);

    expect(state.scope_summary).toBeDefined();
    expect(state.scope_summary.contract).toBeDefined();
    expect(state.scope_summary.in_scope_files).toEqual([]);
    expect(state.scope_summary.touched_files).toEqual([]);
  });

  it('should update scope_summary as events occur', () => {
    const taskId = 'task_state_2';
    const events: Event[] = [
      createTestEvent({
        task_id: taskId,
        type: 'plan_created',
        payload: {
          files: ['src/index.ts'],
        },
      }),
      createTestEvent({
        task_id: taskId,
        type: 'retrieval_completed',
        payload: {
          files: [{ path: 'src/index.ts', line_range: { start: 1, end: 100 } }],
        },
      }),
    ];

    const state = reducer.reduceForTask(taskId, events);

    expect(state.scope_summary.in_scope_files).toContain('src/index.ts');
    expect(state.scope_summary.touched_files).toHaveLength(1);
    expect(state.scope_summary.lines_retrieved).toBe(100);
  });
});
