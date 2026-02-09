/**
 * V3: Solution Capture Subscriber - Pure Detection Logic
 *
 * Pure function — no side effects, no subscriptions.
 * Returns null or a Solution candidate when a proven-solution pattern is detected.
 *
 * Trigger conditions (requires BOTH a preceding failure_classified AND diff_applied):
 * 1. test_completed with success === true
 * 2. iteration_succeeded
 * 3. mission_completed with success === true
 */

import type { Event } from '../types';
import type { Solution, SolutionEvidence } from './memoryService';

// ============================================================================
// TYPES
// ============================================================================

export interface SolutionCaptureContext {
  /** Sliding window of recent events (last ~50) */
  recentEvents: Event[];
  /** Current run ID */
  runId: string;
}

export interface SolutionCandidate {
  solution: Solution;
  triggerEvent: Event;
}

// ============================================================================
// TRIGGER DETECTION
// ============================================================================

const TRIGGER_TYPES = new Set([
  'test_completed',
  'iteration_succeeded',
  'mission_completed',
]);

/**
 * Detect whether the current event represents a proven solution.
 *
 * Requirements:
 * - Event type is a trigger type (test_completed/iteration_succeeded/mission_completed)
 * - For test_completed: payload.success must be true
 * - For mission_completed: payload.success must be true
 * - Must have a preceding failure_classified event in the window
 * - Must have a preceding diff_applied event in the window
 */
export function detectSolutionCandidate(
  event: Event,
  ctx: SolutionCaptureContext,
): SolutionCandidate | null {
  // Only process trigger events
  if (!TRIGGER_TYPES.has(event.type)) return null;

  // Check success conditions for specific event types
  if (event.type === 'test_completed' && event.payload.success !== true) return null;
  if (event.type === 'mission_completed' && event.payload.success !== true) return null;

  // Find preceding failure_classified (most recent)
  const failureEvent = findLastByType(ctx.recentEvents, 'failure_classified');
  if (!failureEvent) return null;

  // Find preceding diff_applied (most recent)
  const diffEvent = findLastByType(ctx.recentEvents, 'diff_applied');
  if (!diffEvent) return null;

  // Build solution from context events
  const solution = buildSolution(event, failureEvent, diffEvent, ctx.runId);
  return { solution, triggerEvent: event };
}

// ============================================================================
// HELPERS
// ============================================================================

function findLastByType(events: Event[], type: string): Event | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) return events[i];
  }
  return null;
}

function buildSolution(
  triggerEvent: Event,
  failureEvent: Event,
  diffEvent: Event,
  runId: string,
): Solution {
  // Problem: from failure_classified payload
  const problem = (failureEvent.payload.failureSignature as string)
    || (failureEvent.payload.summary as string)
    || (failureEvent.payload.message as string)
    || 'Unknown failure';

  // Fix: summary of changes from diff_applied
  const fix = (diffEvent.payload.summary as string)
    || (diffEvent.payload.description as string)
    || 'Applied code changes';

  // Files changed
  const filesChanged = extractFilesChanged(diffEvent);

  // Verification
  const verification = buildVerification(triggerEvent);

  // Tags: from file extensions + failure type
  const tags = generateTags(filesChanged, failureEvent);

  // Solution ID
  const solutionId = `sol_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  return {
    solution_id: solutionId,
    problem,
    fix,
    files_changed: filesChanged,
    tags,
    verification,
    captured_at: new Date().toISOString(),
    run_id: runId,
  };
}

function extractFilesChanged(diffEvent: Event): string[] {
  // Try payload.files_changed first
  const files = diffEvent.payload.files_changed;
  if (Array.isArray(files)) return files as string[];

  // Try payload.files
  const files2 = diffEvent.payload.files;
  if (Array.isArray(files2)) return files2 as string[];

  // Try payload.path (single file)
  const singlePath = diffEvent.payload.path as string;
  if (singlePath) return [singlePath];

  return [];
}

function buildVerification(triggerEvent: Event): SolutionEvidence {
  // Infer type from trigger event
  let type: SolutionEvidence['type'] = 'manual';
  if (triggerEvent.type === 'test_completed') type = 'tests';
  else if (triggerEvent.type === 'iteration_succeeded') type = 'build';
  else if (triggerEvent.type === 'mission_completed') type = 'tests';

  // Extract command from trigger event payload
  const command = (triggerEvent.payload.command as string) || 'unknown';

  // Summary
  const summary = (triggerEvent.payload.summary as string)
    || `${triggerEvent.type} event verified success`;

  return {
    type,
    command,
    passed_at: triggerEvent.timestamp,
    summary,
  };
}

function generateTags(filesChanged: string[], failureEvent: Event): string[] {
  const tags = new Set<string>();

  // Extract file extensions
  for (const file of filesChanged) {
    const ext = file.split('.').pop();
    if (ext && ext.length <= 6) {
      tags.add(ext);
    }
  }

  // Add failure type if available
  const failureType = failureEvent.payload.type as string;
  if (failureType) tags.add(failureType);

  const category = failureEvent.payload.category as string;
  if (category) tags.add(category);

  return Array.from(tags);
}
