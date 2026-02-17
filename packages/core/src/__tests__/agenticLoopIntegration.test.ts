/**
 * Tests for AgenticLoop Integration into MISSION Edit Step
 *
 * Covers:
 * - StagedEditBuffer (write, edit, read, delete, overlay, snapshot/restore)
 * - LoopSessionState (create, canContinue, update, buildPayload)
 * - StagedToolProvider (write interception, edit overlay, read overlay, passthrough)
 * - StateReducer handling of loop_paused, loop_continued, loop_completed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StagedEditBuffer } from '../stagedEditBuffer';
import {
  createLoopSession,
  canContinue,
  maxTotalIterations,
  isIterationBudgetExhausted,
  isTokenBudgetExhausted,
  remainingContinues,
  updateSessionAfterRun,
  incrementContinue,
  buildLoopPausedPayload,
  LoopSession,
} from '../loopSessionState';
import { StagedToolProvider } from '../stagedToolProvider';
import type { ToolExecutionProvider, ToolExecutionResult } from '../agenticLoop';
import { extractDiffFilePaths as extractDiffFilePathsFn, getDiffCorrelationId as getDiffCorrelationIdFn } from '../undoContentCapture';

// ==========================================================================
// StagedEditBuffer
// ==========================================================================

describe('StagedEditBuffer', () => {
  let buffer: StagedEditBuffer;

  beforeEach(() => {
    buffer = new StagedEditBuffer();
  });

  describe('write', () => {
    it('should stage a new file', () => {
      buffer.write('src/index.ts', 'console.log("hello");', true);

      expect(buffer.has('src/index.ts')).toBe(true);
      expect(buffer.read('src/index.ts')).toBe('console.log("hello");');
      expect(buffer.size).toBe(1);
    });

    it('should overwrite existing staged file', () => {
      buffer.write('src/index.ts', 'v1', true);
      buffer.write('src/index.ts', 'v2');

      expect(buffer.read('src/index.ts')).toBe('v2');
      const file = buffer.get('src/index.ts')!;
      expect(file.editCount).toBe(2);
      expect(file.isNew).toBe(true); // preserves original isNew
    });

    it('should handle multiple files', () => {
      buffer.write('a.ts', 'a');
      buffer.write('b.ts', 'b');
      buffer.write('c.ts', 'c');

      expect(buffer.size).toBe(3);
      expect(buffer.getStagedPaths()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });
  });

  describe('edit', () => {
    it('should apply find-and-replace on staged content', () => {
      buffer.write('src/main.ts', 'const a = 1;\nconst b = 2;\n');
      const result = buffer.edit('src/main.ts', 'const a = 1;', 'const a = 42;');

      expect(result.success).toBe(true);
      expect(buffer.read('src/main.ts')).toBe('const a = 42;\nconst b = 2;\n');
    });

    it('should apply edit using provided currentContent for unstaged files', () => {
      const result = buffer.edit('new.ts', 'old', 'new', 'the old text here');

      expect(result.success).toBe(true);
      expect(buffer.read('new.ts')).toBe('the new text here');
    });

    it('should fail if old_text not found', () => {
      buffer.write('a.ts', 'hello world');
      const result = buffer.edit('a.ts', 'goodbye', 'hi');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail if old_text appears multiple times', () => {
      buffer.write('a.ts', 'aa bb aa cc');
      const result = buffer.edit('a.ts', 'aa', 'xx');

      expect(result.success).toBe(false);
      expect(result.error).toContain('multiple times');
    });

    it('should fail if file not staged and no currentContent provided', () => {
      const result = buffer.edit('missing.ts', 'old', 'new');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found in staged buffer');
    });

    it('should increment edit count on each edit', () => {
      buffer.write('a.ts', 'aaa bbb ccc');
      buffer.edit('a.ts', 'aaa', 'xxx');
      buffer.edit('a.ts', 'bbb', 'yyy');

      expect(buffer.get('a.ts')!.editCount).toBe(3); // 1 write + 2 edits
    });
  });

  describe('read', () => {
    it('should return null for unstaged files', () => {
      expect(buffer.read('missing.ts')).toBeNull();
    });

    it('should return null for deleted files', () => {
      buffer.write('a.ts', 'content');
      buffer.delete('a.ts');
      expect(buffer.read('a.ts')).toBeNull();
    });

    it('should return staged content', () => {
      buffer.write('a.ts', 'hello');
      expect(buffer.read('a.ts')).toBe('hello');
    });
  });

  describe('delete', () => {
    it('should mark file as deleted', () => {
      buffer.write('a.ts', 'content');
      buffer.delete('a.ts');

      expect(buffer.has('a.ts')).toBe(true);
      expect(buffer.isDeleted('a.ts')).toBe(true);
      expect(buffer.read('a.ts')).toBeNull();
    });

    it('should mark non-staged file as deleted', () => {
      buffer.delete('b.ts');
      expect(buffer.isDeleted('b.ts')).toBe(true);
    });
  });

  describe('getModifiedFiles', () => {
    it('should exclude deleted files', () => {
      buffer.write('a.ts', 'a');
      buffer.write('b.ts', 'b');
      buffer.delete('b.ts');

      const modified = buffer.getModifiedFiles();
      expect(modified).toHaveLength(1);
      expect(modified[0].path).toBe('a.ts');
    });
  });

  describe('toSummary', () => {
    it('should produce correct summary', () => {
      buffer.write('new.ts', 'content', true);
      buffer.write('old.ts', 'content', false);
      buffer.delete('gone.ts');

      const summary = buffer.toSummary();
      expect(summary).toHaveLength(3);
      expect(summary.find(s => s.path === 'new.ts')!.action).toBe('create');
      expect(summary.find(s => s.path === 'old.ts')!.action).toBe('update');
      expect(summary.find(s => s.path === 'gone.ts')!.action).toBe('delete');
    });
  });

  describe('clear', () => {
    it('should remove all staged files', () => {
      buffer.write('a.ts', 'a');
      buffer.write('b.ts', 'b');
      buffer.clear();

      expect(buffer.size).toBe(0);
      expect(buffer.getStagedPaths()).toEqual([]);
    });
  });

  describe('snapshot/restore', () => {
    it('should serialize and restore buffer state', () => {
      buffer.write('a.ts', 'aaa', true);
      buffer.write('b.ts', 'bbb', false);
      buffer.edit('b.ts', 'bbb', 'ccc');

      const snapshot = buffer.toSnapshot();
      const restored = StagedEditBuffer.fromSnapshot(snapshot);

      expect(restored.size).toBe(2);
      expect(restored.read('a.ts')).toBe('aaa');
      expect(restored.read('b.ts')).toBe('ccc');
      expect(restored.get('a.ts')!.isNew).toBe(true);
      expect(restored.get('b.ts')!.editCount).toBe(2);
    });

    it('should handle empty buffer snapshot', () => {
      const snapshot = buffer.toSnapshot();
      const restored = StagedEditBuffer.fromSnapshot(snapshot);
      expect(restored.size).toBe(0);
    });
  });
});

// ==========================================================================
// LoopSessionState
// ==========================================================================

describe('LoopSessionState', () => {
  let session: LoopSession;

  beforeEach(() => {
    session = createLoopSession({
      session_id: 'sess-1',
      task_id: 'task-1',
      step_id: 'step-1',
      max_iterations_per_run: 10,
      max_total_iterations: 40,
    });
  });

  describe('createLoopSession', () => {
    it('should create with specified values', () => {
      expect(session.session_id).toBe('sess-1');
      expect(session.task_id).toBe('task-1');
      expect(session.step_id).toBe('step-1');
      expect(session.iteration_count).toBe(0);
      expect(session.continue_count).toBe(0);
      expect(session.max_iterations_per_run).toBe(10);
      expect(session.max_total_iterations).toBe(40);
      expect(session.stop_reason).toBeNull();
      expect(session.staged_snapshot).toBeNull();
      expect(session.conversation_snapshot).toBeNull();
    });

    it('should use defaults if not specified', () => {
      const s = createLoopSession({
        session_id: 's',
        task_id: 't',
        step_id: 'st',
      });
      expect(s.max_continues).toBe(10);
      expect(s.max_iterations_per_run).toBe(50);
      expect(s.max_total_iterations).toBe(200);
      expect(s.max_total_tokens).toBe(4_000_000);
    });
  });

  describe('canContinue', () => {
    it('should return true when under hard iteration ceiling', () => {
      expect(canContinue(session)).toBe(true);
    });

    it('should return false at hard iteration ceiling', () => {
      session.iteration_count = 40;
      expect(canContinue(session)).toBe(false);
    });

    it('should return false when over hard iteration ceiling', () => {
      session.iteration_count = 50;
      expect(canContinue(session)).toBe(false);
    });

    it('should return false when token budget exhausted', () => {
      session.total_tokens = { input: 3_000_000, output: 1_500_000 };
      expect(canContinue(session)).toBe(false);
    });
  });

  describe('maxTotalIterations', () => {
    it('should return max_total_iterations (hard ceiling)', () => {
      expect(maxTotalIterations(session)).toBe(40);
    });
  });

  describe('isIterationBudgetExhausted', () => {
    it('should return false when under budget', () => {
      session.iteration_count = 10;
      expect(isIterationBudgetExhausted(session)).toBe(false);
    });

    it('should return true at budget', () => {
      session.iteration_count = 40;
      expect(isIterationBudgetExhausted(session)).toBe(true);
    });
  });

  describe('isTokenBudgetExhausted', () => {
    it('should return false when under budget', () => {
      session.total_tokens = { input: 100_000, output: 50_000 };
      expect(isTokenBudgetExhausted(session)).toBe(false);
    });

    it('should return true when at budget', () => {
      session.total_tokens = { input: 3_000_000, output: 1_000_000 };
      expect(isTokenBudgetExhausted(session)).toBe(true);
    });

    it('should return true when over budget', () => {
      session.total_tokens = { input: 5_000_000, output: 1_000_000 };
      expect(isTokenBudgetExhausted(session)).toBe(true);
    });
  });

  describe('remainingContinues', () => {
    it('should return correct remaining based on iterations left', () => {
      // 40 total iterations, 10 per run, 0 used = ceil(40/10) = 4
      expect(remainingContinues(session)).toBe(4);
      session.iteration_count = 30;
      // 10 remaining / 10 per run = 1
      expect(remainingContinues(session)).toBe(1);
    });

    it('should not go below zero', () => {
      session.iteration_count = 50;
      expect(remainingContinues(session)).toBe(0);
    });
  });

  describe('updateSessionAfterRun', () => {
    it('should accumulate iterations and tokens', () => {
      const updated = updateSessionAfterRun(session, {
        iterations: 5,
        totalTokens: { input: 1000, output: 500 },
        stopReason: 'max_iterations',
        finalText: 'done',
        toolCallsCount: 3,
        stagedSnapshot: null,
        conversationSnapshot: null,
      });

      expect(updated.iteration_count).toBe(5);
      expect(updated.total_tokens.input).toBe(1000);
      expect(updated.total_tokens.output).toBe(500);
      expect(updated.stop_reason).toBe('max_iterations');
      expect(updated.final_text).toBe('done');
      expect(updated.tool_calls_count).toBe(3);
    });

    it('should accumulate across multiple runs', () => {
      let s = updateSessionAfterRun(session, {
        iterations: 5,
        totalTokens: { input: 1000, output: 500 },
        stopReason: 'max_iterations',
        finalText: 'first',
        toolCallsCount: 3,
        stagedSnapshot: null,
        conversationSnapshot: null,
      });

      s = updateSessionAfterRun(s, {
        iterations: 3,
        totalTokens: { input: 800, output: 200 },
        stopReason: 'end_turn',
        finalText: 'second',
        toolCallsCount: 2,
        stagedSnapshot: null,
        conversationSnapshot: null,
      });

      expect(s.iteration_count).toBe(8);
      expect(s.total_tokens.input).toBe(1800);
      expect(s.total_tokens.output).toBe(700);
      expect(s.tool_calls_count).toBe(5);
    });
  });

  describe('incrementContinue', () => {
    it('should increment continue count and clear stop_reason', () => {
      session.stop_reason = 'max_iterations';
      const updated = incrementContinue(session);

      expect(updated.continue_count).toBe(1);
      expect(updated.stop_reason).toBeNull();
    });
  });

  describe('buildLoopPausedPayload', () => {
    it('should build correct payload', () => {
      session.stop_reason = 'max_iterations';
      session.iteration_count = 10;
      session.total_tokens = { input: 5000, output: 2000 };
      session.tool_calls_count = 8;
      session.final_text = 'some text';

      const summary = [
        { path: 'a.ts', action: 'create', edit_count: 1 },
        { path: 'b.ts', action: 'update', edit_count: 3 },
      ];

      const payload = buildLoopPausedPayload(session, summary);

      expect(payload.session_id).toBe('sess-1');
      expect(payload.step_id).toBe('step-1');
      expect(payload.reason).toBe('max_iterations');
      expect(payload.iteration_count).toBe(10);
      expect(payload.can_continue).toBe(true);
      expect(payload.max_total_iterations).toBe(40);
      // remaining: ceil((40-10)/10) = 3
      expect(payload.remaining_continues).toBe(3);
      expect(payload.staged_files).toEqual(summary);
      expect(payload.staged_files_count).toBe(2);
      expect(payload.final_text).toBe('some text');
    });
  });
});

// ==========================================================================
// StagedToolProvider
// ==========================================================================

describe('StagedToolProvider', () => {
  let mockDelegate: ToolExecutionProvider;
  let buffer: StagedEditBuffer;
  let provider: StagedToolProvider;

  beforeEach(() => {
    mockDelegate = {
      executeTool: vi.fn(async (name: string, input: Record<string, unknown>): Promise<ToolExecutionResult> => {
        if (name === 'read_file') {
          const path = input.path as string;
          if (path === 'existing.ts') {
            return { success: true, output: 'existing file content' };
          }
          return { success: false, output: '', error: 'File not found' };
        }
        if (name === 'run_command') {
          return { success: true, output: 'command output' };
        }
        if (name === 'search_files') {
          return { success: true, output: 'search results' };
        }
        if (name === 'list_directory') {
          return { success: true, output: 'dir listing' };
        }
        return { success: false, output: '', error: `Unknown tool: ${name}` };
      }),
    };
    buffer = new StagedEditBuffer();
    provider = new StagedToolProvider(mockDelegate, buffer);
  });

  describe('write_file interception', () => {
    it('should stage writes instead of delegating', async () => {
      const result = await provider.executeTool('write_file', {
        path: 'new.ts',
        content: 'new content',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('staged');
      expect(buffer.has('new.ts')).toBe(true);
      expect(buffer.read('new.ts')).toBe('new content');
    });

    it('should detect new files', async () => {
      const result = await provider.executeTool('write_file', {
        path: 'brand_new.ts',
        content: 'hello',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('created');
      expect(buffer.get('brand_new.ts')!.isNew).toBe(true);
    });

    it('should detect overwriting existing files', async () => {
      const result = await provider.executeTool('write_file', {
        path: 'existing.ts',
        content: 'overwritten',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('written');
      expect(buffer.get('existing.ts')!.isNew).toBe(false);
    });

    it('should fail without path', async () => {
      const result = await provider.executeTool('write_file', { content: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('path');
    });

    it('should fail without content', async () => {
      const result = await provider.executeTool('write_file', { path: 'a.ts' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('content');
    });
  });

  describe('edit_file interception', () => {
    it('should edit staged content', async () => {
      buffer.write('a.ts', 'hello world', false);

      const result = await provider.executeTool('edit_file', {
        path: 'a.ts',
        old_text: 'hello',
        new_text: 'goodbye',
      });

      expect(result.success).toBe(true);
      expect(buffer.read('a.ts')).toBe('goodbye world');
    });

    it('should read from disk and stage for unstaged files', async () => {
      const result = await provider.executeTool('edit_file', {
        path: 'existing.ts',
        old_text: 'existing file content',
        new_text: 'modified content',
      });

      expect(result.success).toBe(true);
      expect(buffer.read('existing.ts')).toBe('modified content');
    });

    it('should fail for non-existent files', async () => {
      const result = await provider.executeTool('edit_file', {
        path: 'missing.ts',
        old_text: 'old',
        new_text: 'new',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot read file');
    });
  });

  describe('read_file overlay', () => {
    it('should return staged content when available', async () => {
      buffer.write('a.ts', 'staged version');

      const result = await provider.executeTool('read_file', { path: 'a.ts' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('staged version');
      // Should NOT delegate to real provider
      expect(mockDelegate.executeTool).not.toHaveBeenCalledWith('read_file', expect.anything());
    });

    it('should delegate to real provider for unstaged files', async () => {
      const result = await provider.executeTool('read_file', { path: 'existing.ts' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('existing file content');
      expect(mockDelegate.executeTool).toHaveBeenCalledWith('read_file', { path: 'existing.ts' });
    });

    it('should return error for deleted staged files', async () => {
      buffer.write('a.ts', 'content');
      buffer.delete('a.ts');

      const result = await provider.executeTool('read_file', { path: 'a.ts' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('deleted');
    });

    it('should handle offset/max_lines on staged content', async () => {
      buffer.write('a.ts', 'line1\nline2\nline3\nline4\nline5');

      const result = await provider.executeTool('read_file', {
        path: 'a.ts',
        offset: 1,
        max_lines: 2,
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('line2\nline3');
    });
  });

  describe('passthrough tools', () => {
    it('should delegate run_command', async () => {
      const result = await provider.executeTool('run_command', { command: 'ls' });
      expect(result.success).toBe(true);
      expect(mockDelegate.executeTool).toHaveBeenCalledWith('run_command', { command: 'ls' });
    });

    it('should delegate search_files', async () => {
      const result = await provider.executeTool('search_files', { query: 'test' });
      expect(result.success).toBe(true);
      expect(mockDelegate.executeTool).toHaveBeenCalledWith('search_files', { query: 'test' });
    });

    it('should delegate list_directory', async () => {
      const result = await provider.executeTool('list_directory', { path: '.' });
      expect(result.success).toBe(true);
      expect(mockDelegate.executeTool).toHaveBeenCalledWith('list_directory', { path: '.' });
    });
  });

  describe('getBuffer', () => {
    it('should expose the underlying buffer', () => {
      expect(provider.getBuffer()).toBe(buffer);
    });
  });
});

// ==========================================================================
// StateReducer — loop events
// ==========================================================================

describe('StateReducer loop events', () => {
  // Import StateReducer and dependencies
  let StateReducer: any;
  let ScopeManager: any;

  beforeEach(async () => {
    const reducerModule = await import('../stateReducer');
    const scopeModule = await import('../scopeManager');
    StateReducer = reducerModule.StateReducer;
    ScopeManager = scopeModule.ScopeManager;
  });

  function makeEvent(type: string, payload: Record<string, unknown> = {}) {
    return {
      event_id: 'evt-1',
      task_id: 'task-1',
      timestamp: new Date().toISOString(),
      type,
      mode: 'MISSION' as const,
      stage: 'edit' as const,
      payload,
      evidence_ids: [],
      parent_event_id: null,
    };
  }

  it('should set status to paused on loop_paused', () => {
    const reducer = new StateReducer(new ScopeManager());
    const events = [
      makeEvent('intent_received', { prompt: 'test' }),
      makeEvent('loop_paused', { reason: 'max_iterations' }),
    ];

    const state = reducer.reduceForTask('task-1', events);
    expect(state.status).toBe('paused');
  });

  it('should set status to running on loop_continued', () => {
    const reducer = new StateReducer(new ScopeManager());
    const events = [
      makeEvent('intent_received', { prompt: 'test' }),
      makeEvent('loop_paused', { reason: 'max_iterations' }),
      makeEvent('loop_continued', { continue_count: 1 }),
    ];

    const state = reducer.reduceForTask('task-1', events);
    expect(state.status).toBe('running');
  });

  it('should not change status on loop_completed', () => {
    const reducer = new StateReducer(new ScopeManager());
    const events = [
      makeEvent('intent_received', { prompt: 'test' }),
      makeEvent('loop_completed', { result: 'applied' }),
    ];

    const state = reducer.reduceForTask('task-1', events);
    // loop_completed doesn't change status (stays running from intent_received)
    expect(state.status).toBe('running');
  });
});

// ==========================================================================
// Auto-Apply Flow: diff_proposed/diff_applied payload compatibility
// ==========================================================================

describe('Auto-Apply Flow — event payload compatibility', () => {
  it('diff_proposed payload uses files_changed for extractDiffFilePaths compatibility', () => {
    // The undo system uses extractDiffFilePaths which expects:
    //   payload.files_changed (array of {path} objects)
    // Verify the payload structure matches
    const filePatches = [
      { path: 'src/a.ts', action: 'update' as const, newContent: 'line1\nline2\n' },
      { path: 'src/b.ts', action: 'create' as const, newContent: 'new file\n' },
    ];

    // This simulates what applyStagedEdits builds
    const diffProposedPayload = {
      diff_id: 'diff-test-1',
      step_id: 'step_1',
      source: 'agentic_loop',
      session_id: 'sess-1',
      files_changed: filePatches.map(fp => ({
        path: fp.path,
        action: fp.action,
        lines: fp.newContent ? fp.newContent.split('\n').length : 0,
      })),
      total_additions: 5,
      total_deletions: 0,
    };

    // Verify files_changed has the path field (required by extractDiffFilePaths)
    expect(diffProposedPayload.files_changed).toHaveLength(2);
    expect(diffProposedPayload.files_changed[0]).toHaveProperty('path', 'src/a.ts');
    expect(diffProposedPayload.files_changed[1]).toHaveProperty('path', 'src/b.ts');
    expect(diffProposedPayload.files_changed[0]).toHaveProperty('action', 'update');
    expect(diffProposedPayload.files_changed[1]).toHaveProperty('action', 'create');
  });

  it('diff_applied payload includes enriched fields for file changes card', () => {
    const filePatches = [
      { path: 'src/a.ts', action: 'update' as const, newContent: 'updated content\nline2\n' },
      { path: 'src/new.ts', action: 'create' as const, newContent: 'new file content\n' },
    ];

    // This simulates what applyStagedEdits builds for diff_applied
    const diffAppliedPayload = {
      diff_id: 'diff-test-1',
      step_id: 'step_1',
      checkpoint_id: 'cp-test-1',
      source: 'agentic_loop',
      files_changed: filePatches.map(fp => ({
        path: fp.path,
        action: fp.action,
        additions: fp.newContent ? fp.newContent.split('\n').length : 0,
        deletions: fp.action === 'delete' ? 50 : 0,
      })),
      total_additions: 4,
      total_deletions: 0,
      iterations: 3,
      tool_calls: 5,
      summary: 'Applied 2 file(s) from AgenticLoop',
    };

    // Verify all enriched fields are present
    expect(diffAppliedPayload.step_id).toBe('step_1');
    expect(diffAppliedPayload.checkpoint_id).toBe('cp-test-1');
    expect(diffAppliedPayload.total_additions).toBe(4);
    expect(diffAppliedPayload.total_deletions).toBe(0);
    expect(diffAppliedPayload.iterations).toBe(3);
    expect(diffAppliedPayload.tool_calls).toBe(5);

    // Verify files_changed has per-file stats
    expect(diffAppliedPayload.files_changed).toHaveLength(2);
    expect(diffAppliedPayload.files_changed[0]).toEqual({
      path: 'src/a.ts',
      action: 'update',
      additions: 3,
      deletions: 0,
    });
    expect(diffAppliedPayload.files_changed[1]).toEqual({
      path: 'src/new.ts',
      action: 'create',
      additions: 2,
      deletions: 0,
    });
  });

  it('extractDiffFilePaths correctly reads files_changed with path objects', () => {
    const payload = {
      files_changed: [
        { path: 'src/a.ts', action: 'update', lines: 10 },
        { path: 'src/b.ts', action: 'create', lines: 5 },
      ],
    };

    const paths = extractDiffFilePathsFn(payload);
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('getDiffCorrelationId reads diff_id from payload', () => {
    expect(getDiffCorrelationIdFn({ diff_id: 'diff-123' })).toBe('diff-123');
    expect(getDiffCorrelationIdFn({ proposal_id: 'prop-1', diff_id: 'diff-1' })).toBe('prop-1');
    expect(getDiffCorrelationIdFn({})).toBeNull();
  });
});
