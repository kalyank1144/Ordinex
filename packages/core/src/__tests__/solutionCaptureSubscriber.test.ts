/**
 * SolutionCaptureSubscriber Tests
 *
 * Tests for the pure detectSolutionCandidate function.
 * Verifies trigger detection, event matching, and solution building.
 */

import { describe, it, expect } from 'vitest';
import { detectSolutionCandidate } from '../intelligence/solutionCaptureSubscriber';
import type { SolutionCaptureContext } from '../intelligence/solutionCaptureSubscriber';
import type { Event } from '../types';

// ============================================================================
// HELPERS
// ============================================================================

function makeEvent(overrides: Partial<Event>): Event {
  return {
    event_id: `evt_${Math.random().toString(36).substring(2)}`,
    task_id: 'task_1',
    timestamp: new Date().toISOString(),
    type: 'step_started',
    mode: 'MISSION',
    stage: 'none',
    payload: {},
    evidence_ids: [],
    parent_event_id: null,
    ...overrides,
  } as Event;
}

function makeFailureClassified(overrides: Record<string, unknown> = {}): Event {
  return makeEvent({
    type: 'failure_classified',
    payload: {
      failureSignature: 'TypeError: Cannot read property "x" of undefined',
      summary: 'Type error in auth module',
      type: 'type_error',
      category: 'runtime',
      ...overrides,
    },
  });
}

function makeDiffApplied(overrides: Record<string, unknown> = {}): Event {
  return makeEvent({
    type: 'diff_applied',
    payload: {
      files_changed: ['src/auth/login.ts', 'src/auth/types.ts'],
      summary: 'Added null check before property access',
      ...overrides,
    },
  });
}

function makeCtx(events: Event[], runId = 'run_abc'): SolutionCaptureContext {
  return { recentEvents: events, runId };
}

// ============================================================================
// TESTS
// ============================================================================

describe('detectSolutionCandidate', () => {
  it('returns null when no failure_classified exists', () => {
    const events = [makeDiffApplied()];
    const trigger = makeEvent({
      type: 'test_completed',
      payload: { success: true, command: 'pnpm test' },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));
    expect(result).toBeNull();
  });

  it('returns null when test passes but no preceding diff_applied', () => {
    const events = [makeFailureClassified()];
    const trigger = makeEvent({
      type: 'test_completed',
      payload: { success: true, command: 'pnpm test' },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));
    expect(result).toBeNull();
  });

  it('detects solution on test_completed + failure_classified + diff_applied', () => {
    const events = [makeFailureClassified(), makeDiffApplied()];
    const trigger = makeEvent({
      type: 'test_completed',
      payload: { success: true, command: 'pnpm -r test', summary: '15 tests passed' },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));

    expect(result).not.toBeNull();
    expect(result!.solution.problem).toContain('TypeError');
    expect(result!.solution.fix).toBe('Added null check before property access');
    expect(result!.solution.verification.type).toBe('tests');
  });

  it('detects solution on iteration_succeeded + failure_classified + diff_applied', () => {
    const events = [makeFailureClassified(), makeDiffApplied()];
    const trigger = makeEvent({
      type: 'iteration_succeeded',
      payload: { command: 'npm run build', summary: 'Build succeeded' },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));

    expect(result).not.toBeNull();
    expect(result!.solution.verification.type).toBe('build');
  });

  it('detects solution on mission_completed + failure_classified + diff_applied', () => {
    const events = [makeFailureClassified(), makeDiffApplied()];
    const trigger = makeEvent({
      type: 'mission_completed',
      payload: { success: true, command: 'pnpm test', summary: 'Mission complete' },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));

    expect(result).not.toBeNull();
    expect(result!.solution.verification.type).toBe('tests');
  });

  it('extracts correct problem from failure_classified payload', () => {
    const events = [
      makeFailureClassified({ failureSignature: 'Module not found: ./utils' }),
      makeDiffApplied(),
    ];
    const trigger = makeEvent({
      type: 'test_completed',
      payload: { success: true },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));

    expect(result!.solution.problem).toBe('Module not found: ./utils');
  });

  it('extracts correct files from diff_applied payload', () => {
    const events = [
      makeFailureClassified(),
      makeDiffApplied({ files_changed: ['src/utils.ts', 'src/index.ts'] }),
    ];
    const trigger = makeEvent({
      type: 'test_completed',
      payload: { success: true },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));

    expect(result!.solution.files_changed).toEqual(['src/utils.ts', 'src/index.ts']);
  });

  it('generates tags from file extensions', () => {
    const events = [
      makeFailureClassified({ type: 'compile_error' }),
      makeDiffApplied({ files_changed: ['src/app.tsx', 'src/styles.css'] }),
    ];
    const trigger = makeEvent({
      type: 'test_completed',
      payload: { success: true },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));

    expect(result!.solution.tags).toContain('tsx');
    expect(result!.solution.tags).toContain('css');
    expect(result!.solution.tags).toContain('compile_error');
  });

  it('solution has valid SolutionEvidence verification', () => {
    const events = [makeFailureClassified(), makeDiffApplied()];
    const trigger = makeEvent({
      type: 'test_completed',
      payload: { success: true, command: 'vitest run', summary: '42 tests passed' },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));

    expect(result!.solution.verification).toEqual({
      type: 'tests',
      command: 'vitest run',
      passed_at: trigger.timestamp,
      summary: '42 tests passed',
    });
  });

  it('returns null for events outside the trigger list', () => {
    const events = [makeFailureClassified(), makeDiffApplied()];
    const nonTrigger = makeEvent({
      type: 'step_completed',
      payload: { success: true },
    });

    const result = detectSolutionCandidate(nonTrigger, makeCtx(events));
    expect(result).toBeNull();
  });

  it('returns null for test_completed with success=false', () => {
    const events = [makeFailureClassified(), makeDiffApplied()];
    const trigger = makeEvent({
      type: 'test_completed',
      payload: { success: false },
    });

    const result = detectSolutionCandidate(trigger, makeCtx(events));
    expect(result).toBeNull();
  });
});
