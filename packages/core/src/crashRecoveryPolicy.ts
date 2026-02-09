/**
 * Crash Recovery Policy — Pure functions for recovery decision-making.
 *
 * All functions are deterministic and P1-compliant (no FS, no side effects).
 * They operate on ActiveTaskMetadata and produce RecoveryAnalysis.
 */

import type { ActiveTaskMetadata, RecoveryOption, RecoveryAnalysis } from './taskPersistence';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max age (24 hours) before recommending discard. */
export const MAX_RECOVERY_AGE_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/**
 * A task is likely a crash if it was still running and was NOT cleanly exited.
 */
export function isLikelyCrash(task: ActiveTaskMetadata): boolean {
  return !task.cleanly_exited && task.status === 'running';
}

/**
 * A task is stale if `last_updated_at` is older than `maxAgeMs`.
 */
export function isStaleTask(
  task: ActiveTaskMetadata,
  maxAgeMs: number = MAX_RECOVERY_AGE_MS,
  nowMs: number = Date.now(),
): boolean {
  const updatedAt = new Date(task.last_updated_at).getTime();
  return (nowMs - updatedAt) >= maxAgeMs;
}

// ---------------------------------------------------------------------------
// Option builders
// ---------------------------------------------------------------------------

/**
 * Build the available recovery options for a given task.
 */
export function buildRecoveryOptions(
  task: ActiveTaskMetadata,
  hasCheckpoint: boolean,
): RecoveryOption[] {
  const crash = isLikelyCrash(task);

  return [
    {
      id: 'resume' as const,
      label: 'Resume',
      description: crash
        ? 'Replay events from where you left off'
        : 'Continue the paused task',
      enabled: true,
    },
    {
      id: 'restore_checkpoint' as const,
      label: 'Restore Checkpoint',
      description: 'Roll back to the last checkpoint, then resume',
      enabled: hasCheckpoint,
    },
    {
      id: 'discard' as const,
      label: 'Discard',
      description: 'Clear interrupted state and start fresh',
      enabled: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

/**
 * Recommend the best recovery action.
 *
 * Priority:
 *   1. Stale (>24h) → discard
 *   2. Crash + checkpoint → restore_checkpoint
 *   3. Otherwise → resume
 */
export function recommendAction(
  task: ActiveTaskMetadata,
  hasCheckpoint: boolean,
  timeSinceMs: number,
  maxAgeMs: number = MAX_RECOVERY_AGE_MS,
): 'resume' | 'restore_checkpoint' | 'discard' {
  if (timeSinceMs >= maxAgeMs) return 'discard';
  if (isLikelyCrash(task) && hasCheckpoint) return 'restore_checkpoint';
  return 'resume';
}

// ---------------------------------------------------------------------------
// Full analysis (combines everything)
// ---------------------------------------------------------------------------

/**
 * Produce a complete RecoveryAnalysis for a given interrupted task.
 */
export function analyzeRecoveryOptions(
  task: ActiveTaskMetadata,
  eventCount: number,
  hasCheckpoint: boolean,
  nowMs: number = Date.now(),
): RecoveryAnalysis {
  const updatedAt = new Date(task.last_updated_at).getTime();
  const timeSinceMs = nowMs - updatedAt;

  const recommended = recommendAction(task, hasCheckpoint, timeSinceMs);
  const options = buildRecoveryOptions(task, hasCheckpoint);

  let reason: string;
  if (recommended === 'discard') {
    reason = 'Task is older than 24 hours — recommend discarding';
  } else if (recommended === 'restore_checkpoint') {
    reason = 'Unclean exit detected — recommend restoring last checkpoint';
  } else {
    reason = isLikelyCrash(task)
      ? 'Unclean exit detected — resume via event replay'
      : 'Paused task found — resume where you left off';
  }

  return {
    task,
    options,
    recommended_action: recommended,
    reason,
    event_count: eventCount,
    time_since_interruption_ms: timeSinceMs,
  };
}
