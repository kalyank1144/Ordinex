/**
 * Step 47: Crash Recovery Policy Tests
 *
 * Tests pure functions: isLikelyCrash, isStaleTask, buildRecoveryOptions,
 * recommendAction, analyzeRecoveryOptions.
 */

import { describe, it, expect } from 'vitest';
import {
  isLikelyCrash,
  isStaleTask,
  buildRecoveryOptions,
  recommendAction,
  analyzeRecoveryOptions,
  MAX_RECOVERY_AGE_MS,
} from '../crashRecoveryPolicy';
import type { ActiveTaskMetadata } from '../taskPersistence';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<ActiveTaskMetadata> = {}): ActiveTaskMetadata {
  return {
    task_id: 'task_1',
    mode: 'MISSION',
    stage: 'edit',
    status: 'running',
    last_updated_at: new Date().toISOString(),
    cleanly_exited: false,
    ...overrides,
  };
}

// ============================================================================
// isLikelyCrash
// ============================================================================

describe('isLikelyCrash', () => {
  it('should return true when status=running and cleanly_exited=false', () => {
    const task = makeTask({ status: 'running', cleanly_exited: false });
    expect(isLikelyCrash(task)).toBe(true);
  });

  it('should return false when cleanly_exited=true', () => {
    const task = makeTask({ status: 'running', cleanly_exited: true });
    expect(isLikelyCrash(task)).toBe(false);
  });

  it('should return false when status=paused even with cleanly_exited=false', () => {
    const task = makeTask({ status: 'paused', cleanly_exited: false });
    expect(isLikelyCrash(task)).toBe(false);
  });

  it('should return false when paused and cleanly_exited=true', () => {
    const task = makeTask({ status: 'paused', cleanly_exited: true });
    expect(isLikelyCrash(task)).toBe(false);
  });
});

// ============================================================================
// isStaleTask
// ============================================================================

describe('isStaleTask', () => {
  it('should return false for a task updated just now', () => {
    const now = Date.now();
    const task = makeTask({ last_updated_at: new Date(now).toISOString() });
    expect(isStaleTask(task, MAX_RECOVERY_AGE_MS, now)).toBe(false);
  });

  it('should return false for a task updated 1 hour ago', () => {
    const now = Date.now();
    const task = makeTask({ last_updated_at: new Date(now - 3600_000).toISOString() });
    expect(isStaleTask(task, MAX_RECOVERY_AGE_MS, now)).toBe(false);
  });

  it('should return true for a task older than 24 hours', () => {
    const now = Date.now();
    const task = makeTask({
      last_updated_at: new Date(now - MAX_RECOVERY_AGE_MS - 1).toISOString(),
    });
    expect(isStaleTask(task, MAX_RECOVERY_AGE_MS, now)).toBe(true);
  });

  it('should return true at exactly 24 hours (boundary)', () => {
    const now = Date.now();
    const task = makeTask({
      last_updated_at: new Date(now - MAX_RECOVERY_AGE_MS).toISOString(),
    });
    expect(isStaleTask(task, MAX_RECOVERY_AGE_MS, now)).toBe(true);
  });

  it('should support custom maxAgeMs', () => {
    const now = Date.now();
    const oneHourAgo = now - 3600_000;
    const task = makeTask({ last_updated_at: new Date(oneHourAgo).toISOString() });
    // With 30-minute max age, one hour old should be stale
    expect(isStaleTask(task, 1800_000, now)).toBe(true);
  });
});

// ============================================================================
// buildRecoveryOptions
// ============================================================================

describe('buildRecoveryOptions', () => {
  it('should always include resume and discard as enabled', () => {
    const task = makeTask();
    const options = buildRecoveryOptions(task, false);
    const resume = options.find(o => o.id === 'resume');
    const discard = options.find(o => o.id === 'discard');
    expect(resume?.enabled).toBe(true);
    expect(discard?.enabled).toBe(true);
  });

  it('should enable restore_checkpoint when hasCheckpoint=true', () => {
    const task = makeTask();
    const options = buildRecoveryOptions(task, true);
    const restore = options.find(o => o.id === 'restore_checkpoint');
    expect(restore?.enabled).toBe(true);
  });

  it('should disable restore_checkpoint when hasCheckpoint=false', () => {
    const task = makeTask();
    const options = buildRecoveryOptions(task, false);
    const restore = options.find(o => o.id === 'restore_checkpoint');
    expect(restore?.enabled).toBe(false);
  });

  it('should return exactly 3 options', () => {
    const options = buildRecoveryOptions(makeTask(), true);
    expect(options).toHaveLength(3);
  });

  it('should describe crash context in resume description for crashes', () => {
    const task = makeTask({ cleanly_exited: false, status: 'running' });
    const options = buildRecoveryOptions(task, false);
    const resume = options.find(o => o.id === 'resume');
    expect(resume?.description).toContain('Replay');
  });

  it('should describe pause context in resume description for paused tasks', () => {
    const task = makeTask({ cleanly_exited: true, status: 'paused' });
    const options = buildRecoveryOptions(task, false);
    const resume = options.find(o => o.id === 'resume');
    expect(resume?.description).toContain('paused');
  });
});

// ============================================================================
// recommendAction
// ============================================================================

describe('recommendAction', () => {
  it('should recommend discard when task is stale', () => {
    const task = makeTask();
    const result = recommendAction(task, true, MAX_RECOVERY_AGE_MS + 1);
    expect(result).toBe('discard');
  });

  it('should recommend restore_checkpoint for crash with checkpoint', () => {
    const task = makeTask({ cleanly_exited: false, status: 'running' });
    const result = recommendAction(task, true, 5000);
    expect(result).toBe('restore_checkpoint');
  });

  it('should recommend resume for crash without checkpoint', () => {
    const task = makeTask({ cleanly_exited: false, status: 'running' });
    const result = recommendAction(task, false, 5000);
    expect(result).toBe('resume');
  });

  it('should recommend resume for clean pause', () => {
    const task = makeTask({ cleanly_exited: true, status: 'paused' });
    const result = recommendAction(task, true, 5000);
    expect(result).toBe('resume');
  });

  it('should recommend resume for pause without checkpoint', () => {
    const task = makeTask({ cleanly_exited: true, status: 'paused' });
    const result = recommendAction(task, false, 5000);
    expect(result).toBe('resume');
  });

  it('should respect stale threshold even with checkpoint', () => {
    const task = makeTask({ cleanly_exited: false, status: 'running' });
    const result = recommendAction(task, true, MAX_RECOVERY_AGE_MS);
    expect(result).toBe('discard');
  });
});

// ============================================================================
// analyzeRecoveryOptions (full pipeline)
// ============================================================================

describe('analyzeRecoveryOptions', () => {
  it('should produce a complete RecoveryAnalysis for a crash', () => {
    const now = Date.now();
    const fiveMinAgo = now - 300_000;
    const task = makeTask({
      cleanly_exited: false,
      status: 'running',
      last_updated_at: new Date(fiveMinAgo).toISOString(),
    });

    const analysis = analyzeRecoveryOptions(task, 42, false, now);

    expect(analysis.task).toBe(task);
    expect(analysis.event_count).toBe(42);
    expect(analysis.time_since_interruption_ms).toBeCloseTo(300_000, -2);
    expect(analysis.recommended_action).toBe('resume');
    expect(analysis.options).toHaveLength(3);
    expect(analysis.reason).toContain('Unclean exit');
  });

  it('should recommend restore_checkpoint for crash with checkpoint', () => {
    const now = Date.now();
    const task = makeTask({
      cleanly_exited: false,
      status: 'running',
      last_updated_at: new Date(now - 60_000).toISOString(),
      last_checkpoint_id: 'cp_abc',
    });

    const analysis = analyzeRecoveryOptions(task, 10, true, now);
    expect(analysis.recommended_action).toBe('restore_checkpoint');
    expect(analysis.reason).toContain('checkpoint');
  });

  it('should recommend discard for stale task', () => {
    const now = Date.now();
    const task = makeTask({
      last_updated_at: new Date(now - MAX_RECOVERY_AGE_MS - 1000).toISOString(),
    });

    const analysis = analyzeRecoveryOptions(task, 5, true, now);
    expect(analysis.recommended_action).toBe('discard');
    expect(analysis.reason).toContain('24 hours');
  });

  it('should recommend resume for paused task', () => {
    const now = Date.now();
    const task = makeTask({
      cleanly_exited: true,
      status: 'paused',
      last_updated_at: new Date(now - 60_000).toISOString(),
    });

    const analysis = analyzeRecoveryOptions(task, 20, false, now);
    expect(analysis.recommended_action).toBe('resume');
    expect(analysis.reason).toContain('Paused task');
  });

  it('should include correct event_count', () => {
    const now = Date.now();
    const task = makeTask({
      last_updated_at: new Date(now - 1000).toISOString(),
    });
    const analysis = analyzeRecoveryOptions(task, 99, false, now);
    expect(analysis.event_count).toBe(99);
  });

  it('should calculate time_since_interruption_ms correctly', () => {
    const now = Date.now();
    const tenMinAgo = now - 600_000;
    const task = makeTask({
      last_updated_at: new Date(tenMinAgo).toISOString(),
    });
    const analysis = analyzeRecoveryOptions(task, 1, false, now);
    expect(analysis.time_since_interruption_ms).toBeCloseTo(600_000, -2);
  });
});
