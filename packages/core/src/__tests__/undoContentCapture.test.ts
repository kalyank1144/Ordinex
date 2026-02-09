import { describe, it, expect } from 'vitest';
import {
  extractDiffFilePaths,
  getDiffCorrelationId,
  inferActionType,
  buildUndoGroup,
  FileReadResult,
} from '../undoContentCapture';
import { Event } from '../types';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: overrides.event_id || 'evt-1',
    task_id: overrides.task_id || 'task-1',
    timestamp: overrides.timestamp || '2026-02-08T10:00:00Z',
    type: overrides.type || 'diff_applied',
    mode: overrides.mode || 'MISSION',
    stage: overrides.stage || 'edit',
    payload: overrides.payload || {},
    evidence_ids: overrides.evidence_ids || [],
    parent_event_id: overrides.parent_event_id || null,
  };
}

describe('extractDiffFilePaths', () => {
  it('extracts from string[] format (DiffManager: payload.files)', () => {
    const paths = extractDiffFilePaths({ files: ['src/a.ts', 'src/b.ts'] });
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('extracts from {path}[] format (MissionExecutor: payload.files_changed)', () => {
    const paths = extractDiffFilePaths({
      files_changed: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
    });
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('extracts from string[] in files_changed', () => {
    const paths = extractDiffFilePaths({
      files_changed: ['src/a.ts', 'src/b.ts'],
    });
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('extracts from payload.applied_files fallback', () => {
    const paths = extractDiffFilePaths({ applied_files: ['src/x.ts'] });
    expect(paths).toEqual(['src/x.ts']);
  });

  it('returns empty array for missing data', () => {
    expect(extractDiffFilePaths({})).toEqual([]);
    expect(extractDiffFilePaths({ unrelated: 'data' })).toEqual([]);
  });
});

describe('getDiffCorrelationId', () => {
  it('extracts proposal_id', () => {
    expect(getDiffCorrelationId({ proposal_id: 'prop-1' })).toBe('prop-1');
  });

  it('extracts diff_id', () => {
    expect(getDiffCorrelationId({ diff_id: 'diff-1' })).toBe('diff-1');
  });

  it('prefers proposal_id over diff_id', () => {
    expect(getDiffCorrelationId({ proposal_id: 'prop-1', diff_id: 'diff-1' })).toBe('prop-1');
  });

  it('returns null when neither present', () => {
    expect(getDiffCorrelationId({})).toBeNull();
    expect(getDiffCorrelationId({ other: 123 })).toBeNull();
  });
});

describe('inferActionType', () => {
  it('returns file_edit when both contents present', () => {
    expect(inferActionType('old', 'new')).toBe('file_edit');
  });

  it('returns file_create when before is null', () => {
    expect(inferActionType(null, 'new content')).toBe('file_create');
  });

  it('returns file_delete when after is null', () => {
    expect(inferActionType('old content', null)).toBe('file_delete');
  });

  it('returns file_edit when both are null (edge case)', () => {
    // Both null is degenerate — falls through to file_edit as default
    expect(inferActionType(null, null)).toBe('file_edit');
  });
});

describe('buildUndoGroup', () => {
  it('creates correct undoable group for file_edit', () => {
    const event = makeEvent({
      payload: {
        proposal_id: 'prop-1',
        files: ['src/a.ts'],
        summary: 'Fix typo',
      },
    });
    const beforeMap = new Map<string, FileReadResult>([
      ['src/a.ts', { content: 'old content', skipped: false }],
    ]);
    const afterMap = new Map<string, FileReadResult>([
      ['src/a.ts', { content: 'new content', skipped: false }],
    ]);

    const group = buildUndoGroup(event, beforeMap, afterMap);
    expect(group.group_id).toBe('prop-1');
    expect(group.undoable).toBe(true);
    expect(group.actions).toHaveLength(1);
    expect(group.actions[0].type).toBe('file_edit');
    expect(group.actions[0].file_path).toBe('src/a.ts');
    expect(group.actions[0].before_content).toBe('old content');
    expect(group.actions[0].after_content).toBe('new content');
    expect(group.description).toBe('Fix typo');
    expect(group.source_event_id).toBe('evt-1');
  });

  it('marks undoable: false when before entries are missing (concern #6)', () => {
    const event = makeEvent({
      payload: {
        proposal_id: 'prop-2',
        files: ['src/a.ts', 'src/b.ts'],
      },
    });
    // Only src/a.ts has before content — src/b.ts is missing
    const beforeMap = new Map<string, FileReadResult>([
      ['src/a.ts', { content: 'old', skipped: false }],
    ]);
    const afterMap = new Map<string, FileReadResult>([
      ['src/a.ts', { content: 'new', skipped: false }],
      ['src/b.ts', { content: 'new b', skipped: false }],
    ]);

    const group = buildUndoGroup(event, beforeMap, afterMap);
    expect(group.undoable).toBe(false);
  });

  it('marks undoable: false when any file was skipped (concern #3)', () => {
    const event = makeEvent({
      payload: {
        proposal_id: 'prop-3',
        files: ['src/a.ts', 'src/big.bin'],
      },
    });
    const beforeMap = new Map<string, FileReadResult>([
      ['src/a.ts', { content: 'old', skipped: false }],
      ['src/big.bin', { content: null, skipped: true }],
    ]);
    const afterMap = new Map<string, FileReadResult>([
      ['src/a.ts', { content: 'new', skipped: false }],
      ['src/big.bin', { content: null, skipped: true }],
    ]);

    const group = buildUndoGroup(event, beforeMap, afterMap);
    expect(group.undoable).toBe(false);
  });

  it('handles file_create (before null, after present)', () => {
    const event = makeEvent({
      payload: {
        diff_id: 'diff-1',
        files: ['src/new.ts'],
      },
    });
    const beforeMap = new Map<string, FileReadResult>([
      ['src/new.ts', { content: null, skipped: false }],
    ]);
    const afterMap = new Map<string, FileReadResult>([
      ['src/new.ts', { content: 'new file content', skipped: false }],
    ]);

    const group = buildUndoGroup(event, beforeMap, afterMap);
    expect(group.undoable).toBe(true);
    expect(group.actions[0].type).toBe('file_create');
    expect(group.actions[0].before_content).toBeNull();
    expect(group.actions[0].after_content).toBe('new file content');
  });

  it('uses event_id as fallback when no correlation ID present', () => {
    const event = makeEvent({
      event_id: 'fallback-evt',
      payload: { files: ['a.ts'] },
    });
    const beforeMap = new Map<string, FileReadResult>([
      ['a.ts', { content: 'old', skipped: false }],
    ]);
    const afterMap = new Map<string, FileReadResult>([
      ['a.ts', { content: 'new', skipped: false }],
    ]);

    const group = buildUndoGroup(event, beforeMap, afterMap);
    expect(group.group_id).toBe('fallback-evt');
  });
});
