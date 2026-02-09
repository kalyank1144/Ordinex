/**
 * Step 48: Undo Content Capture — Pure helper functions for building UndoGroups.
 *
 * Extracts file paths and correlation IDs from diff events,
 * infers action types, and builds UndoGroups from before/after content maps.
 *
 * P1 compliant: no FS imports. Uses only types.
 */

import { Event } from './types';
import { UndoGroup, UndoableAction, UndoActionType } from './undoStack';
import { randomUUID } from 'crypto';

/** Result of reading a file for undo capture. */
export interface FileReadResult {
  content: string | null;  // null if file doesn't exist
  skipped: boolean;         // true if file > size limit
}

/**
 * Extract file paths from a diff event payload.
 * Handles multiple formats:
 * - DiffManager: payload.files (string[])
 * - MissionExecutor: payload.files_changed ({path}[] or string[])
 * - diff_applied: payload.applied_files (string[])
 */
export function extractDiffFilePaths(payload: Record<string, unknown>): string[] {
  // Try payload.files first (DiffManager format)
  if (Array.isArray(payload.files)) {
    return payload.files.filter((f): f is string => typeof f === 'string');
  }

  // Try payload.files_changed (MissionExecutor format — can be string[] or {path}[])
  if (Array.isArray(payload.files_changed)) {
    return payload.files_changed.map((f: unknown) => {
      if (typeof f === 'string') return f;
      if (f && typeof f === 'object' && 'path' in f) return (f as { path: string }).path;
      return String(f);
    });
  }

  // Try payload.applied_files (diff_applied format)
  if (Array.isArray(payload.applied_files)) {
    return payload.applied_files.filter((f): f is string => typeof f === 'string');
  }

  return [];
}

/**
 * Get the correlation ID from a diff event.
 * DiffManager uses proposal_id, MissionExecutor uses diff_id.
 * Checks proposal_id first, then diff_id.
 */
export function getDiffCorrelationId(payload: Record<string, unknown>): string | null {
  if (typeof payload.proposal_id === 'string') return payload.proposal_id;
  if (typeof payload.diff_id === 'string') return payload.diff_id;
  return null;
}

/**
 * Determine UndoActionType from before/after content.
 */
export function inferActionType(
  beforeContent: string | null,
  afterContent: string | null,
): UndoActionType {
  if (beforeContent === null && afterContent !== null) return 'file_create';
  if (beforeContent !== null && afterContent === null) return 'file_delete';
  return 'file_edit';
}

/**
 * Build an UndoGroup from a diff_applied event + captured content maps.
 *
 * If ANY file is missing from beforeContentMap (no entry at all),
 * the entire group is marked undoable: false.
 * If ANY file was skipped (large), the group is marked undoable: false.
 */
export function buildUndoGroup(
  event: Event,
  beforeContentMap: Map<string, FileReadResult>,
  afterContentMap: Map<string, FileReadResult>,
): UndoGroup {
  const corrId = getDiffCorrelationId(event.payload) || event.event_id;
  const filePaths = extractDiffFilePaths(event.payload);
  // Also include any files from the before/after maps that aren't in filePaths
  const allPaths = new Set([
    ...filePaths,
    ...beforeContentMap.keys(),
    ...afterContentMap.keys(),
  ]);

  let undoable = true;
  const actions: UndoableAction[] = [];

  for (const fp of allPaths) {
    const beforeEntry = beforeContentMap.get(fp);
    const afterEntry = afterContentMap.get(fp);

    // If before entry is missing entirely, mark non-undoable (concern #6)
    if (!beforeEntry) {
      undoable = false;
      continue;
    }

    // If before or after was skipped (large file), mark non-undoable (concern #3)
    if (beforeEntry.skipped || (afterEntry && afterEntry.skipped)) {
      undoable = false;
      continue;
    }

    const beforeContent = beforeEntry.content;
    const afterContent = afterEntry ? afterEntry.content : null;
    const actionType = inferActionType(beforeContent, afterContent);

    actions.push({
      action_id: randomUUID(),
      type: actionType,
      file_path: fp,
      before_content: beforeContent,
      after_content: afterContent,
      timestamp: event.timestamp,
      description: `${actionType}: ${fp}`,
    });
  }

  const summary = event.payload.summary as string || '';
  const filesCount = actions.length;

  return {
    group_id: corrId,
    actions,
    description: summary || `${filesCount} file(s) modified`,
    timestamp: event.timestamp,
    source_event_id: event.event_id,
    undoable,
  };
}
