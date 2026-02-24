/**
 * Layer 4: Session Compressor Tests
 */

import { describe, it, expect } from 'vitest';
import {
  compressSession,
  serializeSession,
  parseSessionHeader,
  buildSessionContext,
} from '../memory/sessionCompressor';
import type { Event } from '../types';

// ============================================================================
// Helpers
// ============================================================================

function makeEvent(overrides: Partial<Event> & { type: string }): Event {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    task_id: 'task_test',
    timestamp: new Date().toISOString(),
    mode: 'AGENT' as any,
    stage: 'none' as any,
    payload: {},
    evidence_ids: [],
    parent_event_id: null,
    ...overrides,
  };
}

// ============================================================================
// compressSession Tests
// ============================================================================

describe('compressSession', () => {
  it('returns null for empty events', () => {
    expect(compressSession([])).toBeNull();
  });

  it('extracts taskId from first event', () => {
    const events = [makeEvent({ type: 'intent_received', task_id: 'task_abc' })];
    const summary = compressSession(events)!;
    expect(summary.taskId).toBe('task_abc');
  });

  it('calculates duration from first to last event', () => {
    const events = [
      makeEvent({ type: 'intent_received', timestamp: '2026-02-23T10:00:00Z' }),
      makeEvent({ type: 'loop_completed', timestamp: '2026-02-23T10:05:00Z', payload: { success: true } }),
    ];
    const summary = compressSession(events)!;
    expect(summary.durationMs).toBe(5 * 60 * 1000);
  });

  it('extracts files modified from diff_applied events', () => {
    const events = [
      makeEvent({ type: 'intent_received' }),
      makeEvent({
        type: 'diff_applied',
        payload: { files_changed: ['src/index.ts', 'src/utils.ts'], additions: 10, deletions: 3 },
      }),
    ];
    const summary = compressSession(events)!;
    expect(summary.filesModified).toHaveLength(2);
    expect(summary.filesModified[0].path).toBe('src/index.ts');
  });

  it('aggregates multiple diffs for same file', () => {
    const events = [
      makeEvent({ type: 'diff_applied', payload: { files_changed: ['src/a.ts'], additions: 5 } }),
      makeEvent({ type: 'diff_applied', payload: { files_changed: ['src/a.ts'], additions: 3 } }),
    ];
    const summary = compressSession(events)!;
    expect(summary.filesModified).toHaveLength(1);
    expect(summary.filesModified[0].additions).toBe(8);
  });

  it('extracts commands from tool_start events', () => {
    const events = [
      makeEvent({
        type: 'tool_start',
        payload: { tool: 'run_command', command: 'pnpm test', exit_code: 0 },
      }),
    ];
    const summary = compressSession(events)!;
    expect(summary.commandsRun).toHaveLength(1);
    expect(summary.commandsRun[0].command).toBe('pnpm test');
  });

  it('ignores non-run_command tools', () => {
    const events = [
      makeEvent({ type: 'tool_start', payload: { tool: 'read_file', path: 'a.ts' } }),
    ];
    const summary = compressSession(events)!;
    expect(summary.commandsRun).toHaveLength(0);
  });

  it('extracts decisions from approval_resolved events', () => {
    const events = [
      makeEvent({
        type: 'approval_resolved',
        payload: { approval_type: 'plan_approval', decision: 'approved' },
      }),
    ];
    const summary = compressSession(events)!;
    expect(summary.decisionsMade).toHaveLength(1);
    expect(summary.decisionsMade[0].decision).toBe('approved');
  });

  it('extracts errors fixed from failure→diff sequence', () => {
    const events = [
      makeEvent({
        type: 'failure_classified',
        payload: { failureSignature: 'TypeError: x is undefined' },
      }),
      makeEvent({
        type: 'diff_applied',
        payload: { summary: 'Added null check', files_changed: ['src/a.ts'] },
      }),
    ];
    const summary = compressSession(events)!;
    expect(summary.errorsFixed).toHaveLength(1);
    expect(summary.errorsFixed[0].problem).toBe('TypeError: x is undefined');
    expect(summary.errorsFixed[0].fix).toBe('Added null check');
  });

  it('detects completed status from mission_completed', () => {
    const events = [
      makeEvent({ type: 'intent_received' }),
      makeEvent({ type: 'mission_completed', payload: { success: true, summary: 'All done' } }),
    ];
    const summary = compressSession(events)!;
    expect(summary.status).toBe('completed');
    expect(summary.statusDetail).toBe('All done');
  });

  it('detects failed status from mission_completed with success=false', () => {
    const events = [
      makeEvent({ type: 'mission_completed', payload: { success: false } }),
    ];
    const summary = compressSession(events)!;
    expect(summary.status).toBe('failed');
  });

  it('detects interrupted status when no completion event', () => {
    const events = [
      makeEvent({ type: 'intent_received' }),
      makeEvent({ type: 'tool_start', payload: { tool: 'read_file' } }),
    ];
    const summary = compressSession(events)!;
    expect(summary.status).toBe('interrupted');
  });

  it('uses single path from diff_applied when no files_changed array', () => {
    const events = [
      makeEvent({ type: 'diff_applied', payload: { path: 'src/single.ts' } }),
    ];
    const summary = compressSession(events)!;
    expect(summary.filesModified).toHaveLength(1);
    expect(summary.filesModified[0].path).toBe('src/single.ts');
  });
});

// ============================================================================
// serializeSession Tests
// ============================================================================

describe('serializeSession', () => {
  it('produces valid markdown with headers', () => {
    const summary = compressSession([
      makeEvent({ type: 'intent_received', task_id: 'task_xyz', timestamp: '2026-02-23T10:00:00Z' }),
      makeEvent({ type: 'mission_completed', timestamp: '2026-02-23T10:10:00Z', payload: { success: true } }),
    ])!;

    const md = serializeSession(summary);
    expect(md).toContain('# Session: task_xyz');
    expect(md).toContain('> Mode: AGENT');
    expect(md).toContain('> Status: completed');
  });

  it('includes files modified section', () => {
    const summary = compressSession([
      makeEvent({ type: 'diff_applied', payload: { files_changed: ['a.ts'], additions: 5, deletions: 2 } }),
    ])!;

    const md = serializeSession(summary);
    expect(md).toContain('## Files Modified');
    expect(md).toContain('a.ts');
    expect(md).toContain('+5');
    expect(md).toContain('-2');
  });

  it('omits empty sections', () => {
    const summary = compressSession([makeEvent({ type: 'intent_received' })])!;
    const md = serializeSession(summary);
    expect(md).not.toContain('## Commands Run');
    expect(md).not.toContain('## Errors Fixed');
  });
});

// ============================================================================
// parseSessionHeader Tests
// ============================================================================

describe('parseSessionHeader', () => {
  it('parses task ID, date, and mode', () => {
    const md = `# Session: task_abc\n> Date: 2026-02-23T10:00:00Z\n> Mode: PLAN`;
    const header = parseSessionHeader(md);
    expect(header).toEqual({
      taskId: 'task_abc',
      date: '2026-02-23T10:00:00Z',
      mode: 'PLAN',
    });
  });

  it('returns null for invalid markdown', () => {
    expect(parseSessionHeader('random text')).toBeNull();
  });
});

// ============================================================================
// buildSessionContext Tests
// ============================================================================

describe('buildSessionContext', () => {
  it('returns empty string for no sessions', () => {
    expect(buildSessionContext([])).toBe('');
  });

  it('includes staleness warning', () => {
    const ctx = buildSessionContext(['# Session: a\nSome content']);
    expect(ctx).toContain('may be outdated');
  });

  it('limits to maxSessions', () => {
    const sessions = ['# Session: a', '# Session: b', '# Session: c'];
    const ctx = buildSessionContext(sessions, 2);
    expect(ctx).toContain('Session: a');
    expect(ctx).toContain('Session: b');
    expect(ctx).not.toContain('Session: c');
  });
});
