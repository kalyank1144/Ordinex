/**
 * Activity Context Tests — Event extraction for system prompt.
 */

import { describe, it, expect } from 'vitest';
import { buildRecentActivityContext } from '../activityContext';
import type { Event } from '../types';

function makeEvent(type: string, payload: Record<string, unknown>): Event {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    task_id: 'task_test',
    timestamp: new Date().toISOString(),
    type: type as any,
    mode: 'MISSION',
    stage: 'edit',
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };
}

describe('buildRecentActivityContext', () => {
  it('returns empty tags for no events', () => {
    const result = buildRecentActivityContext([]);
    expect(result).toContain('<recent_activity>');
    expect(result).toContain('</recent_activity>');
  });

  it('extracts files created from step_completed events', () => {
    const events = [
      makeEvent('step_completed', { files_written: ['src/App.tsx', 'src/index.ts'] }),
    ];
    const result = buildRecentActivityContext(events);
    expect(result).toContain('src/App.tsx');
    expect(result).toContain('src/index.ts');
  });

  it('extracts files modified from diff_applied events', () => {
    const events = [
      makeEvent('diff_applied', { file: 'src/Header.tsx' }),
    ];
    const result = buildRecentActivityContext(events);
    expect(result).toContain('src/Header.tsx');
  });

  it('extracts commands from tool_end events', () => {
    const events = [
      makeEvent('tool_end', { tool: 'run_command', command: 'npm run dev', success: true }),
      makeEvent('tool_end', { tool: 'run_command', command: 'npm test', success: false }),
    ];
    const result = buildRecentActivityContext(events);
    expect(result).toContain('npm run dev (ok)');
    expect(result).toContain('npm test (failed)');
  });

  it('extracts errors from failure_detected events', () => {
    const events = [
      makeEvent('failure_detected', { error: 'TypeError: Cannot read property x of undefined' }),
    ];
    const result = buildRecentActivityContext(events);
    expect(result).toContain('TypeError');
  });

  it('deduplicates file entries', () => {
    const events = [
      makeEvent('step_completed', { files_written: ['src/App.tsx'] }),
      makeEvent('step_completed', { files_written: ['src/App.tsx'] }),
    ];
    const result = buildRecentActivityContext(events);
    const matches = result.match(/src\/App\.tsx/g);
    expect(matches).toHaveLength(1);
  });

  it('truncates to maxTokens', () => {
    const events = Array.from({ length: 100 }, (_, i) =>
      makeEvent('step_completed', { files_written: [`src/file_${i}.tsx`] }),
    );
    const result = buildRecentActivityContext(events, 100);
    expect(result.length).toBeLessThanOrEqual(100 * 4 + 50);
  });

  it('limits to last 50 events', () => {
    const events = Array.from({ length: 200 }, (_, i) =>
      makeEvent('step_completed', { files_written: [`src/file_${i}.tsx`] }),
    );
    const result = buildRecentActivityContext(events);
    expect(result).not.toContain('file_0.tsx');
    expect(result).toContain('file_199.tsx');
  });
});
