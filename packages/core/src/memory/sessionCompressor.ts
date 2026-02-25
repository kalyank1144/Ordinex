/**
 * Layer 4: Session Compressor — Extractive Session Summaries
 *
 * Extracts structured data from EventStore at task end.
 * No LLM call — purely extractive from event payloads.
 *
 * Produces a SessionSummary that can be serialized to markdown
 * and loaded at the start of the next session for continuity.
 */

import type { Event } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface FileChange {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface CommandRun {
  command: string;
  exitCode?: number;
}

export interface DecisionMade {
  description: string;
  decision: string;
}

export interface ErrorFixed {
  problem: string;
  fix: string;
}

export interface SessionSummary {
  taskId: string;
  date: string;
  durationMs: number;
  mode: string;
  filesModified: FileChange[];
  commandsRun: CommandRun[];
  decisionsMade: DecisionMade[];
  errorsFixed: ErrorFixed[];
  status: 'completed' | 'failed' | 'interrupted';
  statusDetail?: string;
}

// ============================================================================
// EXTRACTION
// ============================================================================

/**
 * Compress a task's events into a SessionSummary.
 * Pure function — no side effects.
 */
export function compressSession(events: Event[]): SessionSummary | null {
  if (events.length === 0) return null;

  const taskId = events[0].task_id;
  const firstTimestamp = events[0].timestamp;
  const lastTimestamp = events[events.length - 1].timestamp;
  const durationMs = new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime();
  const mode = events[events.length - 1].mode || events[0].mode || 'AGENT';

  return {
    taskId,
    date: firstTimestamp,
    durationMs: Math.max(0, durationMs),
    mode: String(mode),
    filesModified: extractFilesModified(events),
    commandsRun: extractCommandsRun(events),
    decisionsMade: extractDecisions(events),
    errorsFixed: extractErrorsFixed(events),
    ...extractStatus(events),
  };
}

// ============================================================================
// EXTRACTORS
// ============================================================================

function extractFilesModified(events: Event[]): FileChange[] {
  const fileMap = new Map<string, FileChange>();

  for (const event of events) {
    if (event.type !== 'diff_applied') continue;

    const files = (event.payload.files_changed as string[])
      || (event.payload.files as string[])
      || [];

    if (files.length === 0 && event.payload.path) {
      files.push(event.payload.path as string);
    }

    for (const filePath of files) {
      const existing = fileMap.get(filePath);
      const additions = (event.payload.additions as number) || 0;
      const deletions = (event.payload.deletions as number) || 0;

      if (existing) {
        existing.additions = (existing.additions || 0) + additions;
        existing.deletions = (existing.deletions || 0) + deletions;
      } else {
        fileMap.set(filePath, { path: filePath, additions, deletions });
      }
    }
  }

  return Array.from(fileMap.values());
}

function extractCommandsRun(events: Event[]): CommandRun[] {
  const commands: CommandRun[] = [];

  for (const event of events) {
    if (event.type !== 'tool_start' && event.type !== 'tool_end') continue;

    const tool = event.payload.tool as string;
    if (tool !== 'run_command') continue;

    const command = (event.payload.command as string)
      || (event.payload.input as any)?.command;
    if (!command) continue;

    const exitCode = event.payload.exit_code as number | undefined;

    const existing = commands.find(c => c.command === command);
    if (existing) {
      if (exitCode !== undefined) {
        existing.exitCode = exitCode;
      }
    } else {
      commands.push({ command, exitCode });
    }
  }

  return commands;
}

function extractDecisions(events: Event[]): DecisionMade[] {
  const decisions: DecisionMade[] = [];

  for (const event of events) {
    if (event.type !== 'approval_resolved') continue;

    const approvalType = (event.payload.approval_type as string) || 'generic';
    const decision = (event.payload.decision as string) || 'unknown';
    const description = approvalType === 'plan_approval'
      ? 'Plan approval'
      : `${approvalType} approval`;

    decisions.push({ description, decision });
  }

  return decisions;
}

function extractErrorsFixed(events: Event[]): ErrorFixed[] {
  const errors: ErrorFixed[] = [];
  const failureEvents: Event[] = [];

  for (const event of events) {
    if (event.type === 'failure_classified') {
      failureEvents.push(event);
    }

    if (event.type === 'diff_applied' && failureEvents.length > 0) {
      const failure = failureEvents[failureEvents.length - 1];
      const problem = (failure.payload.failureSignature as string)
        || (failure.payload.summary as string)
        || (failure.payload.message as string)
        || 'Unknown error';

      const fix = (event.payload.summary as string)
        || (event.payload.description as string)
        || 'Applied code changes';

      errors.push({ problem, fix });
      failureEvents.pop();
    }
  }

  return errors;
}

function extractStatus(events: Event[]): { status: SessionSummary['status']; statusDetail?: string } {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];

    if (event.type === 'mission_completed' || event.type === 'loop_completed') {
      const success = event.payload.success as boolean;
      return {
        status: success ? 'completed' : 'failed',
        statusDetail: (event.payload.summary as string) || undefined,
      };
    }

    if (event.type === 'failure_detected') {
      return {
        status: 'failed',
        statusDetail: (event.payload.error as string) || 'Task failed',
      };
    }
  }

  return { status: 'interrupted', statusDetail: 'Session ended without completion event' };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize a SessionSummary to markdown.
 */
export function serializeSession(summary: SessionSummary): string {
  const lines: string[] = [];

  const durationMin = Math.round(summary.durationMs / 60000);
  lines.push(`# Session: ${summary.taskId}`);
  lines.push(`> Date: ${summary.date}`);
  lines.push(`> Duration: ${durationMin} minutes`);
  lines.push(`> Mode: ${summary.mode}`);
  lines.push(`> Status: ${summary.status}`);
  if (summary.statusDetail) {
    lines.push(`> Detail: ${summary.statusDetail}`);
  }
  lines.push('');

  if (summary.filesModified.length > 0) {
    lines.push('## Files Modified');
    for (const f of summary.filesModified) {
      const stats: string[] = [];
      if (f.additions) stats.push(`+${f.additions}`);
      if (f.deletions) stats.push(`-${f.deletions}`);
      const suffix = stats.length > 0 ? ` (${stats.join(', ')})` : '';
      lines.push(`- ${f.path}${suffix}`);
    }
    lines.push('');
  }

  if (summary.commandsRun.length > 0) {
    lines.push('## Commands Run');
    for (const c of summary.commandsRun) {
      const exitStr = c.exitCode !== undefined ? ` (exit: ${c.exitCode})` : '';
      lines.push(`- \`${c.command}\`${exitStr}`);
    }
    lines.push('');
  }

  if (summary.decisionsMade.length > 0) {
    lines.push('## Decisions Made');
    for (const d of summary.decisionsMade) {
      lines.push(`- ${d.description}: ${d.decision}`);
    }
    lines.push('');
  }

  if (summary.errorsFixed.length > 0) {
    lines.push('## Errors Fixed');
    for (const e of summary.errorsFixed) {
      lines.push(`- **Problem:** ${e.problem}`);
      lines.push(`  **Fix:** ${e.fix}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Parse a session markdown file back into a SessionSummary (for loading).
 * Lightweight — only extracts the header metadata.
 */
export function parseSessionHeader(markdown: string): { taskId: string; date: string; mode: string } | null {
  const taskMatch = markdown.match(/^# Session:\s*(.+)$/m);
  const dateMatch = markdown.match(/^> Date:\s*(.+)$/m);
  const modeMatch = markdown.match(/^> Mode:\s*(.+)$/m);

  if (!taskMatch) return null;

  return {
    taskId: taskMatch[1].trim(),
    date: dateMatch ? dateMatch[1].trim() : '',
    mode: modeMatch ? modeMatch[1].trim() : 'AGENT',
  };
}

// ============================================================================
// SESSION CONTEXT BUILDING
// ============================================================================

/**
 * Build context string from recent session summaries for injection.
 */
export function buildSessionContext(sessionMarkdowns: string[], maxSessions: number = 2): string {
  if (sessionMarkdowns.length === 0) return '';

  const recent = sessionMarkdowns.slice(0, maxSessions);

  const parts = [
    '> Note: These are summaries from previous sessions. They may be outdated.',
    '',
    ...recent,
  ];

  return parts.join('\n');
}
