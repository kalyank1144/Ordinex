/**
 * Activity Context — Extract recent session activity from events.
 *
 * Builds a concise summary of what happened recently (files created/modified,
 * commands run, errors encountered, plans approved) for inclusion in the
 * LLM system prompt. Uses XML tags per Anthropic best practice.
 */

import type { Event } from './types';

/**
 * Build a recent activity context string from events.
 * Capped at maxTokens to prevent context explosion.
 */
export function buildRecentActivityContext(
  events: Event[],
  maxTokens: number = 1500,
): string {
  const recent = events.slice(-50);

  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  const commandsRun: Array<{ cmd: string; success: boolean }> = [];
  const errorsHit: string[] = [];
  const plansApproved: string[] = [];

  for (const event of recent) {
    const p = event.payload;

    if (event.type === 'step_completed' && Array.isArray(p?.files_written)) {
      filesCreated.push(...(p.files_written as string[]));
    }

    if (event.type === 'diff_applied' && typeof p?.file === 'string') {
      filesModified.push(p.file as string);
    }

    if (event.type === 'tool_end' && p?.tool === 'run_command') {
      commandsRun.push({
        cmd: String(p.command || ''),
        success: p.success !== false,
      });
    }

    if (event.type === 'tool_end' && p?.tool === 'write_file' && typeof p?.path === 'string') {
      filesCreated.push(p.path as string);
    }

    if (event.type === 'tool_end' && p?.tool === 'edit_file' && typeof p?.path === 'string') {
      filesModified.push(p.path as string);
    }

    if (event.type === 'failure_detected' && typeof p?.error === 'string') {
      errorsHit.push((p.error as string).slice(0, 100));
    }

    if (event.type === 'approval_resolved' && typeof p?.goal === 'string') {
      plansApproved.push(p.goal as string);
    }
  }

  const dedup = (arr: string[]) => [...new Set(arr)];

  let result = '<recent_activity>\n';

  if (filesCreated.length) {
    result += `Files created: ${dedup(filesCreated).join(', ')}\n`;
  }
  if (filesModified.length) {
    result += `Files modified: ${dedup(filesModified).join(', ')}\n`;
  }
  if (commandsRun.length) {
    const cmdSummary = commandsRun
      .slice(-10)
      .map(c => `${c.cmd} (${c.success ? 'ok' : 'failed'})`)
      .join(', ');
    result += `Commands: ${cmdSummary}\n`;
  }
  if (errorsHit.length) {
    result += `Errors: ${errorsHit.slice(-5).join('; ')}\n`;
  }
  if (plansApproved.length) {
    result += `Plans approved: ${plansApproved.join(', ')}\n`;
  }

  result += '</recent_activity>';

  return truncateToTokens(result, maxTokens);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 20) + '\n</recent_activity>';
}
