/**
 * Mission Feed Component - Event-driven timeline rendering
 * Renders canonical events as timeline cards with stage grouping
 */

import { Event, EventType, Stage } from '../types';
import { escapeHtml, formatTimestamp, escapeJsString } from '../utils/cardHelpers';
import { renderDiffProposedCard } from './DiffProposedCard';
import { renderDiffAppliedCard } from './DiffAppliedCard';
import { renderCheckpointCreatedCard } from './CheckpointCreatedCard';
import { renderTestResultCard, renderNoTestRunnerCard, renderRunTestsButton } from './TestResultCard';
import { renderContextCollectedCard, renderAnswerStreamCard } from './AnswerCard';
import { renderPlanCard } from './PlanCard';
import { renderApprovalCard } from './ApprovalCard';
import { getPendingApprovalById, getPendingApprovals } from '../selectors/approvalSelectors';
import { renderClarificationCard } from './ClarificationCard';
import { isScaffoldEvent } from './ScaffoldCard';
import { renderPreflightDecisionCard } from './PreflightDecisionCard';
import { renderSolutionCapturedCard } from './SolutionCapturedCard';
import { renderProcessCard, updateProcessCard, getProcessCardHtml, isProcessEvent } from './ProcessCard';
import { renderGeneratedToolProposedCard, renderGeneratedToolRunCard, isGeneratedToolEvent } from './GeneratedToolCard';
import { renderCrashRecoveryCard, renderTaskRecoveryStartedCard, renderTaskDiscardedCard } from './CrashRecoveryCard';
import { renderFailureCard } from './FailureCard';
import { renderLoopPausedCard } from './LoopPausedCard';
import { isScaffoldProgressEvent, renderScaffoldProgressCard, updateScaffoldProgress, getScaffoldProgressCardHtml } from './ScaffoldProgressCard';
import { isScaffoldCompleteEvent, renderScaffoldCompleteCard, updateScaffoldComplete, getScaffoldCompleteCardHtml } from './ScaffoldCompleteCard';

export interface EventCardConfig {
  icon: string;
  title: string;
  color: string;
  getSummary: (event: Event) => string;
}

/**
 * Event type to card configuration mapping
 */
export const EVENT_CARD_MAP: Record<EventType, EventCardConfig> = {
  // Core Lifecycle
  intent_received: {
    icon: '💬',
    title: 'Intent Received',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => (e.payload.prompt as string) || 'User intent captured'
  },
  mode_set: {
    icon: '⚙️',
    title: 'Mode Set',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => `Mode: ${e.payload.mode || e.mode}`
  },
  plan_created: {
    icon: '📋',
    title: 'Plan Created',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      // Try to get plan from payload.plan or directly from payload
      const plan = (e.payload.plan || e.payload) as any;
      const steps = plan?.steps || [];
      const criteria = plan?.success_criteria;
      const criteriaStr = Array.isArray(criteria) ? criteria.join(', ') : (criteria || '');
      return `${steps.length} steps${criteriaStr ? ' | ' + criteriaStr : ' | A clear, actionable plan is created and approved'}`;
    }
  },
  plan_revised: {
    icon: '📝',
    title: 'Plan Revised',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const plan = (e.payload.plan || e.payload) as any;
      const steps = plan?.steps || [];
      return `${steps.length} steps (revised)`;
    }
  },
  mission_breakdown_created: {
    icon: '🎯',
    title: 'Mission Breakdown Created',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const missions = (e.payload.missions as any[]) || [];
      return `${missions.length} missions identified`;
    }
  },
  mission_selected: {
    icon: '✓',
    title: 'Mission Selected',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => `Mission ID: ${(e.payload.mission_id as string) || 'unknown'}`
  },
  mission_started: {
    icon: '🚀',
    title: 'Mission Started',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const stepsCount = e.payload.steps_count as number || 0;
      const goal = e.payload.goal as string || '';
      return `${stepsCount} steps | ${goal}`;
    }
  },
  step_started: {
    icon: '▶️',
    title: 'Step Started',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const stepIndex = e.payload.step_index as number;
      const description = e.payload.description as string || '';
      return `Step ${stepIndex + 1}: ${description}`;
    }
  },
  step_completed: {
    icon: '✅',
    title: 'Step Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const success = e.payload.success as boolean;
      const stepIndex = e.payload.step_index as number;
      return `Step ${stepIndex + 1} ${success ? 'completed successfully' : 'failed'}`;
    }
  },
  step_failed: {
    icon: '❌',
    title: 'Step Failed',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const stepIndex = e.payload.step_index as number;
      const reason = e.payload.reason as string || 'unknown';
      const error = e.payload.error as string || '';
      return `Step ${stepIndex + 1} failed: ${reason}${error ? ' - ' + error.substring(0, 50) : ''}`;
    }
  },
  stage_changed: {
    icon: '🔄',
    title: 'Stage Changed',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => `${e.payload.from || 'none'} → ${e.payload.to || e.stage}`
  },
  final: {
    icon: '✅',
    title: 'Mission Complete',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => (e.payload.success ? '✓ Success' : '✗ Failed')
  },

  // Retrieval
  retrieval_started: {
    icon: '🔍',
    title: 'Retrieving Context',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const query = e.payload.query as string;
      return query ? `Query: ${query.substring(0, 60)}...` : 'Context retrieval started';
    }
  },
  retrieval_completed: {
    icon: '📄',
    title: 'Context Retrieved',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const count = e.payload.results_count as number;
      return count ? `${count} results found` : 'Retrieval complete';
    }
  },
  retrieval_failed: {
    icon: '⚠️',
    title: 'Retrieval Failed',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => (e.payload.error as string) || 'Retrieval error'
  },

  // Tool Execution
  tool_start: {
    icon: '🔧',
    title: 'Tool Started',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const tool = e.payload.tool_name as string || 'unknown';
      const target = e.payload.target as string;
      return `${tool}${target ? ': ' + target : ''}`;
    }
  },
  tool_end: {
    icon: '✓',
    title: 'Tool Finished',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const tool = e.payload.tool_name as string || 'unknown';
      const duration = e.payload.duration_ms as number;
      // Step 49: Check for error conditions
      const hasError = e.payload.success === false || !!e.payload.error;
      const errorMsg = e.payload.error as string || '';
      if (hasError) {
        return `${tool} failed${errorMsg ? ': ' + errorMsg.substring(0, 50) : ''}`;
      }
      return `${tool}${duration ? ' (' + duration + 'ms)' : ''}`;
    }
  },

  // Approval
  approval_requested: {
    icon: '⏸️',
    title: 'Approval Required',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => {
      const type = e.payload.approval_type as string || 'action';
      return `Type: ${type}`;
    }
  },
  approval_resolved: {
    icon: '▶️',
    title: 'Approval Resolved',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => (e.payload.approved ? '✓ Approved' : '✗ Denied')
  },

  // Diff / Edit
  diff_proposed: {
    icon: '📝',
    title: 'Diff Proposed',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => {
      const filesChanged = (e.payload.files_changed as string[]) || [];
      const summary = e.payload.summary as string || '';
      return `${filesChanged.length} file(s) | ${summary}`;
    }
  },
  diff_applied: {
    icon: '✅',
    title: 'Diff Applied',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const files = (e.payload.files_changed as any[]) || [];
      return `${files.length} file(s) modified`;
    }
  },

  // Checkpoint
  checkpoint_created: {
    icon: '💾',
    title: 'Checkpoint Created',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const id = (e.payload.checkpoint_id as string) || 'unknown';
      return `ID: ${id.substring(0, 8)}`;
    }
  },
  checkpoint_restored: {
    icon: '♻️',
    title: 'Checkpoint Restored',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const id = (e.payload.checkpoint_id as string) || 'unknown';
      return `Restored to: ${id.substring(0, 8)}`;
    }
  },

  // Error / Control
  failure_detected: {
    icon: '❌',
    title: 'Failure Detected',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      // Extract error message from various possible payload locations
      const error = e.payload.error as string | undefined;
      const reason = e.payload.reason as string | undefined;
      const details = e.payload.details as Record<string, unknown> | undefined;
      const detailsMessage = details?.message as string | undefined;
      const kind = e.payload.kind as string | undefined;
      
      // Build a meaningful error message
      const parts: string[] = [];
      
      // Add reason as prefix if different from error
      if (reason && reason !== 'step_execution_exception' && reason !== 'step_execution_failed') {
        parts.push(reason.replace(/_/g, ' '));
      }
      
      // Add the actual error message
      if (error) {
        // Truncate long error messages
        const truncatedError = error.length > 100 ? error.substring(0, 100) + '...' : error;
        parts.push(truncatedError);
      } else if (detailsMessage) {
        const truncatedDetails = detailsMessage.length > 100 ? detailsMessage.substring(0, 100) + '...' : detailsMessage;
        parts.push(truncatedDetails);
      } else if (kind) {
        parts.push(kind.replace(/_/g, ' '));
      }
      
      // Fallback
      if (parts.length === 0) {
        return 'Error occurred';
      }
      
      return parts.join(': ');
    }
  },
  execution_paused: {
    icon: '⏸️',
    title: 'Execution Paused',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => (e.payload.reason as string) || 'Paused'
  },
  execution_resumed: {
    icon: '▶️',
    title: 'Execution Resumed',
    color: 'var(--vscode-charts-green)',
    getSummary: () => 'Continuing execution'
  },
  execution_stopped: {
    icon: '⏹️',
    title: 'Execution Stopped',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => (e.payload.reason as string) || 'Stopped by user'
  },
  mode_violation: {
    icon: '⚠️',
    title: 'Mode Violation',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => (e.payload.violation as string) || 'Mode constraint violated'
  },

  // Scope Control
  scope_expansion_requested: {
    icon: '🔓',
    title: 'Scope Expansion Requested',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => (e.payload.reason as string) || 'Scope expansion needed'
  },
  scope_expansion_resolved: {
    icon: '🔒',
    title: 'Scope Expansion Resolved',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => (e.payload.approved ? '✓ Approved' : '✗ Denied')
  },

  // Plan Integrity
  plan_deviation_detected: {
    icon: '⚠️',
    title: 'Plan Deviation Detected',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => (e.payload.deviation as string) || 'Off-plan action detected'
  },
  model_fallback_used: {
    icon: '🔄',
    title: 'Model Fallback Used',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const from = e.payload.from_model as string;
      const to = e.payload.to_model as string;
      return `${from || 'primary'} → ${to || 'fallback'}`;
    }
  },

  // Autonomy (A1)
  autonomy_started: {
    icon: '🤖',
    title: 'Autonomy Started',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const level = e.payload.autonomy_level as string || 'A1';
      return `Level: ${level}`;
    }
  },
  iteration_started: {
    icon: '🔄',
    title: 'Iteration Started',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const num = e.payload.iteration as number;
      const max = e.payload.max_iterations as number;
      return `Iterating... (attempt ${num || '?'}${max ? '/' + max : ''})`;
    }
  },
  repair_attempted: {
    icon: '🔧',
    title: 'Repair Attempted',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => `Attempting fix${e.payload.repair_type ? ': ' + e.payload.repair_type : ''}`
  },
  iteration_failed: {
    icon: '❌',
    title: 'Iteration Failed',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const iter = e.payload.iteration as number;
      const reason = e.payload.reason as string || '';
      return `Attempt ${iter || '?'} failed${reason ? ': ' + reason.substring(0, 50) : ''}`;
    }
  },
  iteration_succeeded: {
    icon: '✅',
    title: 'Iteration Succeeded',
    color: 'var(--vscode-charts-green)',
    getSummary: () => 'Iteration passed validation'
  },
  budget_exhausted: {
    icon: '⏱️',
    title: 'Budget Exhausted',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const resource = e.payload.resource as string || 'budget';
      return `${resource} exhausted`;
    }
  },
  autonomy_halted: {
    icon: '⏹️',
    title: 'Autonomy Halted',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => (e.payload.reason as string) || 'Halted'
  },
  autonomy_completed: {
    icon: '🎉',
    title: 'Autonomy Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const success = e.payload.success as boolean;
      const iterations = e.payload.iterations_used as number;
      return `${success ? '✓ Success' : '✗ Failed'}${iterations ? ' (' + iterations + ' iterations)' : ''}`;
    }
  },

  // ANSWER Mode
  context_collected: {
    icon: '📚',
    title: 'Context Collected',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const filesCount = (e.payload.files_included as string[])?.length || 0;
      const totalLines = e.payload.total_lines as number || 0;
      return `${filesCount} files, ${totalLines} lines`;
    }
  },
  stream_delta: {
    icon: '⚡',
    title: 'Streaming',
    color: 'var(--vscode-charts-green)',
    getSummary: () => 'Content streaming...'
  },
  stream_complete: {
    icon: '✅',
    title: 'Stream Complete',
    color: 'var(--vscode-charts-green)',
    getSummary: () => 'Streaming finished'
  },

  // Prompt Quality Gate (PLAN mode)
  prompt_assessed: {
    icon: '🔍',
    title: 'Prompt Assessed',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const clarity = e.payload.clarity as string || 'unknown';
      const intent = e.payload.intent as string || 'plan_like';
      const score = e.payload.clarity_score as number;
      return `Clarity: ${clarity}${score !== undefined ? ` (${score})` : ''} | Intent: ${intent}`;
    }
  },
  prompt_rewritten: {
    icon: '📝',
    title: 'Prompt Refined',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => 'Prompt rewritten for better plan generation'
  },
  clarification_requested: {
    icon: '❓',
    title: 'Clarification Needed',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const question = e.payload.question as string || '';
      return question.length > 60 ? question.substring(0, 60) + '...' : question;
    }
  },
  clarification_presented: {
    icon: '🎯',
    title: 'Choose Focus Area',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const options = (e.payload.options as any[]) || [];
      return `${options.length} options available`;
    }
  },
  clarification_received: {
    icon: '💬',
    title: 'Focus Selected',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const title = e.payload.title as string || 'Selection made';
      return title;
    }
  },

  // ========== Step 27: Mission Execution Harness ==========
  stale_context_detected: {
    icon: '⚠️',
    title: 'Stale Context',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const files = (e.payload.stale_files as string[]) || [];
      return files.length > 0 ? `${files.length} file(s) changed` : 'Context may be outdated';
    }
  },
  stage_timeout: {
    icon: '⏱️',
    title: 'Stage Timeout',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const stage = e.payload.stage as string || 'unknown';
      const duration = e.payload.duration_ms as number;
      return `${stage}${duration ? ' (' + Math.round(duration/1000) + 's)' : ''}`;
    }
  },
  repair_attempt_started: {
    icon: '🔧',
    title: 'Repair Started',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const attempt = e.payload.attempt as number || 1;
      const max = e.payload.max_attempts as number;
      return `Attempting fix... (attempt ${attempt}${max ? '/' + max : ''})`;
    }
  },
  repair_attempt_completed: {
    icon: '✓',
    title: 'Repair Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const success = e.payload.success as boolean;
      return success ? 'Repair successful' : 'Repair failed';
    }
  },
  repeated_failure_detected: {
    icon: '🔴',
    title: 'Repeated Failure',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const count = e.payload.failure_count as number || 0;
      return `${count} consecutive failures`;
    }
  },
  test_started: {
    icon: '🧪',
    title: 'Test Started',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const command = e.payload.command as string || '';
      return command.length > 40 ? command.substring(0, 40) + '...' : command || 'Running tests';
    }
  },
  test_completed: {
    icon: '✅',
    title: 'Test Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const passed = e.payload.passed as number || 0;
      const failed = e.payload.failed as number || 0;
      return `${passed} passed, ${failed} failed`;
    }
  },
  test_failed: {
    icon: '❌',
    title: 'Test Failed',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const error = e.payload.error as string || '';
      return error.length > 50 ? error.substring(0, 50) + '...' : error || 'Tests failed';
    }
  },
  mission_completed: {
    icon: '🎉',
    title: 'Mission Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const success = e.payload.success as boolean;
      return success ? '✓ Mission successful' : '✗ Mission failed';
    }
  },
  mission_paused: {
    icon: '⏸️',
    title: 'Mission Paused',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => (e.payload.reason as string) || 'Mission paused'
  },
  mission_cancelled: {
    icon: '⛔',
    title: 'Mission Cancelled',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => (e.payload.reason as string) || 'Mission cancelled'
  },
  patch_plan_proposed: {
    icon: '📋',
    title: 'Patch Plan',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const steps = (e.payload.steps as any[]) || [];
      return `${steps.length} repair step(s)`;
    }
  },
  context_snapshot_created: {
    icon: '📸',
    title: 'Context Snapshot',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const files = (e.payload.files as string[]) || [];
      return `${files.length} file(s) captured`;
    }
  },

  // ========== Step 28: Self-Correction Loop ==========
  failure_classified: {
    icon: '🔍',
    title: 'Failure Classified',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const classification = e.payload.classification as string || e.payload.failureType as string || 'unknown';
      const isFixable = e.payload.isCodeFixable as boolean | undefined;
      const summary = e.payload.summary as string || '';
      const parts: string[] = [classification];
      if (isFixable === true) parts.push('(fixable)');
      if (isFixable === false) parts.push('(env issue)');
      if (summary) parts.push(`- ${summary.substring(0, 60)}`);
      return parts.join(' ');
    }
  },
  decision_point_needed: {
    icon: '🤔',
    title: 'Decision Needed',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => {
      const options = (e.payload.options as any[]) || [];
      return `${options.length} option(s) available`;
    }
  },

  // ========== Step 29: Systems Tab ==========
  run_scope_initialized: {
    icon: '📋',
    title: 'Scope Initialized',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const maxFiles = e.payload.max_files as number || 0;
      return `Max ${maxFiles} files`;
    }
  },
  repair_policy_snapshot: {
    icon: '⚙️',
    title: 'Repair Policy',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const maxAttempts = e.payload.max_repair_attempts as number || 0;
      return `Max ${maxAttempts} attempts`;
    }
  },

  // ========== Step 30: Truncation-Safe Edit Execution ==========
  preflight_complete: {
    icon: '✈️',
    title: 'Preflight Complete',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      // Support both field names: shouldSplit (from TruncationSafeExecutor) and split_needed
      const splitNeeded = (e.payload.shouldSplit ?? e.payload.split_needed) as boolean;
      const targetCount = e.payload.targetFileCount as number || 0;
      const complexity = e.payload.estimatedComplexity as string || '';
      return splitNeeded 
        ? `Split mode: ${targetCount} file(s)${complexity ? `, ${complexity} complexity` : ''}`
        : 'Single-call mode';
    }
  },
  truncation_detected: {
    icon: '⚠️',
    title: 'Truncation Detected',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const reason = e.payload.reason as string || '';
      const stopReason = e.payload.stopReason as string || '';
      const partialLen = e.payload.partialLength as number;
      // Build a useful summary
      if (stopReason) {
        return `Output truncated (${stopReason})${partialLen ? ` at ${partialLen} chars` : ''}`;
      }
      return reason ? `Truncated: ${reason}` : 'Output truncated (will retry with split)';
    }
  },
  edit_split_triggered: {
    icon: '✂️',
    title: 'Split Mode',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      // Support both field names: file_count (from TruncationSafeExecutor) and files array
      const fileCount = e.payload.file_count as number;
      const files = (e.payload.files as string[]) || [];
      const count = fileCount ?? files.length;
      const reason = e.payload.reason as string || '';
      return `Processing ${count} file(s) separately${reason ? ` (${reason})` : ''}`;
    }
  },
  edit_chunk_started: {
    icon: '📝',
    title: 'Editing File',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const file = e.payload.file as string || 'unknown';
      const index = e.payload.chunk_index as number;
      const total = e.payload.total_chunks as number;
      // Handle both 0-indexed and 1-indexed
      const displayIndex = index !== undefined ? index + 1 : 1;
      const displayTotal = total || '?';
      return `${file} (${displayIndex}/${displayTotal})`;
    }
  },
  edit_chunk_completed: {
    icon: '✅',
    title: 'File Edited',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const file = e.payload.file as string || 'unknown';
      return `✓ ${file}`;
    }
  },
  edit_chunk_failed: {
    icon: '❌',
    title: 'File Edit Failed',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const file = e.payload.file as string || 'unknown';
      const reason = e.payload.reason as string || '';
      const error = e.payload.error as string || reason || 'unknown error';
      // Truncate long error messages
      const truncatedError = error.length > 50 ? error.substring(0, 50) + '...' : error;
      return `${file}: ${truncatedError}`;
    }
  },
  edit_step_paused: {
    icon: '⏸️',
    title: 'Edit Paused',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => {
      const reason = e.payload.reason as string || 'awaiting decision';
      return reason;
    }
  },

  // ========== Large Plan Detection ==========
  plan_large_detected: {
    icon: '📊',
    title: 'Large Plan Detected',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const reasons = (e.payload.reasons as string[]) || [];
      return reasons.length > 0 ? reasons[0] : 'Plan exceeds thresholds';
    }
  },

  // ========== Step 34: Auto-Verify + Repair ==========
  verify_started: {
    icon: '🔍',
    title: 'Verify Started',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const commands = (e.payload.commands as string[]) || [];
      return commands.length > 0 ? `Running ${commands.length} verification command(s)` : 'Starting verification';
    }
  },
  verify_completed: {
    icon: '✅',
    title: 'Verify Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const success = e.payload.success as boolean;
      return success ? 'Verification passed' : 'Verification failed';
    }
  },
  verify_proposed: {
    icon: '🔍',
    title: 'Verify Proposed',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => {
      const commands = (e.payload.commands as string[]) || [];
      return `Proposed ${commands.length} verification command(s)`;
    }
  },
  verify_skipped: {
    icon: '⏭️',
    title: 'Verify Skipped',
    color: 'var(--vscode-descriptionForeground)',
    getSummary: (e) => {
      const reason = e.payload.reason as string || 'No verification needed';
      return reason;
    }
  },
  command_started: {
    icon: '▶️',
    title: 'Command Started',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const command = e.payload.command as string || '';
      const index = e.payload.index as number;
      const total = e.payload.total as number;
      if (index && total) {
        return `[${index}/${total}] ${command.substring(0, 50)}${command.length > 50 ? '...' : ''}`;
      }
      return command.substring(0, 60) || 'Executing command';
    }
  },
  command_completed: {
    icon: '✅',
    title: 'Command Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const command = e.payload.command as string || '';
      const exitCode = e.payload.exit_code as number;
      const duration = e.payload.duration_ms as number;
      const success = exitCode === 0;
      const cmdShort = command.substring(0, 30);
      return `${success ? '✓' : '✗'} ${cmdShort}${duration ? ` (${Math.round(duration/1000)}s)` : ''} → exit ${exitCode}`;
    }
  },

  // ========== Step 34.5: Command Execution Phase ==========
  command_proposed: {
    icon: '📋',
    title: 'Command Proposed',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => {
      const commands = (e.payload.commands as any[]) || [];
      const context = e.payload.context as string || '';
      return `${commands.length} command(s) proposed${context ? ` (${context})` : ''}`;
    }
  },
  command_skipped: {
    icon: '⏭️',
    title: 'Command Skipped',
    color: 'var(--vscode-descriptionForeground)',
    getSummary: (e) => {
      const reason = e.payload.reason as string || 'Command execution skipped';
      return reason;
    }
  },
  command_progress: {
    icon: '⏳',
    title: 'Command Progress',
    color: 'var(--vscode-descriptionForeground)',
    getSummary: (e) => {
      const command = e.payload.command as string || '';
      const outputLength = e.payload.output_length as number || 0;
      return `${command.substring(0, 30)}... (${outputLength} bytes)`;
    }
  },

  // ========== Step 37: Reference/Attachment Events ==========
  reference_attached: {
    icon: '📎',
    title: 'Reference Attached',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const type = e.payload.type as string || 'unknown';
      return type === 'image' ? 'Image attached' : `URL: ${e.payload.url || 'attached'}`;
    }
  },
  reference_context_built: {
    icon: '🖼️',
    title: 'Reference Context',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const images = e.payload.images_count as number || 0;
      const urls = e.payload.urls_count as number || 0;
      return `${images} image(s), ${urls} URL(s)`;
    }
  },
  reference_used: {
    icon: '✓',
    title: 'Reference Used',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const mode = e.payload.reference_mode as string || 'used';
      return `Mode: ${mode}`;
    }
  },

  // ========== Step 38: Vision Analysis Events ==========
  vision_analysis_started: {
    icon: '🔍',
    title: 'Analyzing References',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const images = e.payload.images_count as number || 0;
      const urls = e.payload.urls_count as number || 0;
      return `${images + urls} reference(s)`;
    }
  },
  vision_analysis_completed: {
    icon: '✓',
    title: 'Analysis Complete',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const status = e.payload.status as string || 'complete';
      const reason = e.payload.reason as string || '';
      if (status === 'skipped') return `Skipped: ${reason || 'disabled'}`;
      if (status === 'error') return `Error: ${reason || 'failed'}`;
      const duration = e.payload.duration_ms as number;
      return duration ? `Completed in ${(duration/1000).toFixed(1)}s` : 'Analysis complete';
    }
  },
  reference_tokens_extracted: {
    icon: '🎨',
    title: 'Style Tokens Extracted',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const confidence = e.payload.confidence as number || 0;
      const moods = (e.payload.moods as string[]) || [];
      const moodStr = moods.slice(0, 2).join(', ');
      return `${moodStr || 'tokens extracted'} (${Math.round(confidence * 100)}% confidence)`;
    }
  },
  reference_tokens_used: {
    icon: '🔧',
    title: 'Tokens Applied',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const usedIn = e.payload.used_in as string || 'scaffold';
      const overrides = e.payload.overrides_applied as boolean;
      return `${usedIn}${overrides ? ' (with style overrides)' : ''}`;
    }
  },

  // ========== Step 35: Scaffold Flow Events ==========
  scaffold_started: {
    icon: '🏗️',
    title: 'Scaffold Started',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const recipe = e.payload.recipe_id as string || 'auto';
      const prompt = e.payload.prompt as string || '';
      const truncatedPrompt = prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt;
      return `Recipe: ${recipe}${truncatedPrompt ? ` | "${truncatedPrompt}"` : ''}`;
    }
  },
  scaffold_proposal_created: {
    icon: '📋',
    title: 'Scaffold Proposal Ready',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const recipe = e.payload.recipe_id as string || 'auto';
      const designPack = e.payload.design_pack_id as string || 'default';
      return `${recipe} + ${designPack}`;
    }
  },
  scaffold_decision_resolved: {
    icon: '✓',
    title: 'Scaffold Decision',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const decision = e.payload.decision as string || 'proceed';
      return decision === 'proceed' ? 'User approved scaffold' : 
             decision === 'cancel' ? 'User cancelled scaffold' : 
             'Style customization requested';
    }
  },
  scaffold_applied: {
    icon: '✅',
    title: 'Scaffold Applied',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const filesCreated = e.payload.files_created as number || 0;
      return `${filesCreated} file(s) created`;
    }
  },
  scaffold_cancelled: {
    icon: '⛔',
    title: 'Scaffold Cancelled',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const reason = e.payload.reason as string || 'User cancelled';
      return reason;
    }
  },
  scaffold_completed: {
    icon: '🎉',
    title: 'Scaffold Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const recipe = e.payload.recipe_id as string || 'unknown';
      const status = e.payload.status as string || 'completed';
      if (status === 'ready_for_step_35_2') {
        return `${recipe} scaffold approved — setting up project`;
      }
      return `${recipe} scaffold completed successfully`;
    }
  },

  // ========== Additional Scaffold Events (fallback for ScaffoldCard) ==========
  scaffold_apply_started: {
    icon: '⚙️',
    title: 'Creating Project',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const recipe = e.payload.recipe_id as string || e.payload.recipe as string || 'unknown';
      const command = e.payload.command as string || '';
      if (command) {
        return `Running: ${command.substring(0, 50)}${command.length > 50 ? '...' : ''}`;
      }
      return `Setting up ${recipe} project...`;
    }
  },

  // ========== Post-Scaffold Orchestration Events ==========
  scaffold_progress: {
    icon: '⏳',
    title: 'Scaffold Progress',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const phase = e.payload.phase as string || '';
      const message = e.payload.message as string || '';
      return message || phase || 'Creating project...';
    }
  },
  design_pack_applied: {
    icon: '🎨',
    title: 'Design Pack Applied',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const designPack = e.payload.design_pack as string || e.payload.design_pack_id as string || 'custom';
      const filesModified = e.payload.files_modified as number || (e.payload.modified_files as string[])?.length || 0;
      return `${designPack} applied (${filesModified} file(s) styled)`;
    }
  },
  scaffold_final_complete: {
    icon: '✅',
    title: 'Project Ready',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const success = e.payload.success as boolean;
      const projectPath = e.payload.project_path as string || '';
      if (success) {
        const shortPath = projectPath ? projectPath.split('/').pop() : 'project';
        return `${shortPath} ready for development`;
      }
      return 'Project setup completed';
    }
  },
  next_steps_shown: {
    icon: '🚀',
    title: 'Next Steps',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const steps = (e.payload.steps as any[]) || [];
      return `${steps.length} recommended action(s) available`;
    }
  },
  next_step_selected: {
    icon: '▶️',
    title: 'Action Selected',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const stepId = e.payload.step_id as string || '';
      const title = e.payload.title as string || stepId;
      return title || 'Next step initiated';
    }
  },
  next_step_dismissed: {
    icon: '⏭️',
    title: 'Action Skipped',
    color: 'var(--vscode-descriptionForeground)',
    getSummary: (e) => {
      const stepId = e.payload.step_id as string || '';
      return stepId ? `Skipped: ${stepId}` : 'Action dismissed';
    }
  },

  // ========== Feature Intelligence Events ==========
  feature_extraction_started: {
    icon: '🧠',
    title: 'Extracting Features',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      return `Analyzing prompt for feature requirements...`;
    }
  },
  feature_extraction_completed: {
    icon: '✅',
    title: 'Features Extracted',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const appType = e.payload.app_type as string || 'app';
      const count = e.payload.features_count as number || 0;
      return `Detected ${appType}: ${count} feature(s)`;
    }
  },
  feature_code_generating: {
    icon: '🔨',
    title: 'Generating Code',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const message = e.payload.message as string || '';
      return message || 'Generating feature components...';
    }
  },
  feature_code_applied: {
    icon: '✨',
    title: 'Feature Code Applied',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const total = e.payload.total_files as number || 0;
      const summary = e.payload.summary as string || '';
      return summary || `${total} file(s) generated`;
    }
  },
  feature_code_error: {
    icon: '⚠️',
    title: 'Feature Generation Skipped',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      return (e.payload.error as string) || 'Falling back to generic scaffold';
    }
  },
  // Process Management
  process_started: {
    icon: '🚀',
    title: 'Process Starting',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => `Running: ${e.payload.command || ''}`
  },
  process_ready: {
    icon: '✅',
    title: 'Process Ready',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => `Ready${e.payload.port ? ' on port ' + e.payload.port : ''}`
  },
  process_stopped: {
    icon: '⏹️',
    title: 'Process Stopped',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => (e.payload.reason as string) || 'Process stopped'
  },
  process_failed: {
    icon: '❌',
    title: 'Process Failed',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => (e.payload.error as string) || 'Unknown error'
  },
  process_output: {
    icon: '📝',
    title: 'Process Output',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => (e.payload.output as string) || ''
  },
  // Auto-fix
  scaffold_autofix_started: {
    icon: '🔧',
    title: 'Auto-Fixing',
    color: 'var(--vscode-charts-blue)',
    getSummary: () => 'Analyzing errors and generating fixes...'
  },
  scaffold_autofix_applied: {
    icon: '✅',
    title: 'Auto-Fix Applied',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => `Fixed ${e.payload.files_fixed || 0} file(s)`
  },
  scaffold_autofix_failed: {
    icon: '⚠️',
    title: 'Auto-Fix Failed',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => (e.payload.error as string) || 'Could not fix automatically'
  },
  // Streaming Verification
  scaffold_verify_started: {
    icon: '🔍',
    title: 'Verification Started',
    color: 'var(--vscode-charts-blue)',
    getSummary: () => 'Running post-scaffold verification...'
  },
  scaffold_verify_step_completed: {
    icon: '✔️',
    title: 'Verify Step',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => (e.payload.message as string) || `${e.payload.step_name}: ${e.payload.step_status}`
  },
  scaffold_verify_completed: {
    icon: '📋',
    title: 'Verification Complete',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => (e.payload.message as string) || `Outcome: ${e.payload.outcome}`
  },

  // VNext: Project Memory (V2-V5)
  // Placeholder cards — full UI will be built in V5 (SolutionCapturedCard).
  memory_facts_updated: {
    icon: '🧠',
    title: 'Memory Updated',
    color: 'var(--vscode-charts-purple)',
    getSummary: (e) => {
      const delta = (e.payload.delta_summary as string) || '';
      const lines = (e.payload.lines_added as number) || 0;
      return delta || `${lines} line(s) added to project facts`;
    }
  },
  solution_captured: {
    icon: '💡',
    title: 'Solution Captured',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const problem = (e.payload.problem as string) || '';
      const fix = (e.payload.fix as string) || '';
      if (problem && fix) return `${problem} → ${fix}`;
      return problem || fix || 'Proven solution saved';
    }
  },

  // VNext: Generated Tools (V6-V8)
  // Placeholder cards — full UI will be built in V8 (GeneratedToolProposalCard, GeneratedToolRunCard).
  generated_tool_proposed: {
    icon: '🔨',
    title: 'Tool Proposed',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const name = (e.payload.name as string) || 'unknown';
      const desc = (e.payload.description as string) || '';
      return desc ? `${name}: ${desc}` : name;
    }
  },
  generated_tool_saved: {
    icon: '✅',
    title: 'Tool Saved',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => `Tool "${(e.payload.name as string) || 'unknown'}" approved and saved`
  },
  generated_tool_run_started: {
    icon: '⚡',
    title: 'Tool Running',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e) => {
      const name = (e.payload.tool_name as string) || 'unknown';
      const args = (e.payload.args_summary as string) || '';
      return args ? `${name}(${args})` : `Running ${name}...`;
    }
  },
  generated_tool_run_completed: {
    icon: '✅',
    title: 'Tool Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const name = (e.payload.tool_name as string) || 'unknown';
      const ms = (e.payload.duration_ms as number) || 0;
      const code = (e.payload.exit_code as number) ?? -1;
      return `${name} finished (exit ${code}, ${ms}ms)`;
    }
  },
  generated_tool_run_failed: {
    icon: '❌',
    title: 'Tool Failed',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const name = (e.payload.tool_name as string) || 'unknown';
      const reason = (e.payload.reason as string) || 'Unknown error';
      const ftype = (e.payload.failure_type as string) || '';
      return ftype === 'blocked'
        ? `${name}: blocked before execution — ${reason}`
        : `${name}: ${reason}`;
    }
  },

  // VNext: Agent Mode Policy (V9)
  mode_changed: {
    icon: '🔄',
    title: 'Mode Changed',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => {
      const from = (e.payload.from_mode as string) || '?';
      const to = (e.payload.to_mode as string) || '?';
      const reason = (e.payload.reason as string) || '';
      const userInit = e.payload.user_initiated ? ' (user)' : ' (auto)';
      return `${from} → ${to}${userInit}${reason ? ': ' + reason : ''}`;
    }
  },

  // W3: Autonomy Loop Detection
  autonomy_loop_detected: {
    icon: '🔄',
    title: 'Loop Detected',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => {
      const loopType = (e.payload.loopType as string) || 'unknown';
      const recommendation = (e.payload.recommendation as string) || '';
      return `${loopType}: ${recommendation}`;
    }
  },
  autonomy_downgraded: {
    icon: '⬇️',
    title: 'Autonomy Downgraded',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const from = (e.payload.fromLevel as string) || '?';
      const to = (e.payload.toLevel as string) || '?';
      return `${from} → ${to}`;
    }
  },

  // Step 47: Resume After Crash
  task_interrupted: {
    icon: '⚠️',
    title: 'Task Interrupted',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const reason = (e.payload.reason as string) || '';
      return reason || 'Interrupted task detected';
    }
  },
  task_recovery_started: {
    icon: '▶️',
    title: 'Task Resumed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e) => {
      const action = (e.payload.action as string) || 'resume';
      return `Recovered via: ${action}`;
    }
  },
  task_discarded: {
    icon: '🗑️',
    title: 'Task Discarded',
    color: 'var(--vscode-descriptionForeground)',
    getSummary: () => 'Interrupted task cleared'
  },

  // Step 48: Undo System
  undo_performed: {
    icon: '↶',
    title: 'Undo Performed',
    color: 'var(--vscode-charts-yellow)',
    getSummary: (e) => {
      const restored = (e.payload.files_restored as string[]) || [];
      const deleted = (e.payload.files_deleted as string[]) || [];
      const recreated = (e.payload.files_recreated as string[]) || [];
      const parts: string[] = [];
      if (restored.length > 0) parts.push(`${restored.length} restored`);
      if (deleted.length > 0) parts.push(`${deleted.length} deleted`);
      if (recreated.length > 0) parts.push(`${recreated.length} recreated`);
      return parts.length > 0 ? parts.join(', ') : 'Edit reverted';
    }
  },

  // Step 49: Error Recovery UX
  recovery_action_taken: {
    icon: '🔄',
    title: 'Recovery Action',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => {
      const action = (e.payload.action as string) || 'unknown';
      return `User chose: ${action}`;
    }
  },

  // AgenticLoop Integration
  loop_paused: {
    icon: '⏸',
    title: 'Loop Paused',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e: Event) => {
      const reason = (e.payload.reason as string) || 'unknown';
      const iterations = (e.payload.iteration_count as number) || 0;
      return `${reason} after ${iterations} iteration(s)`;
    }
  },
  loop_continued: {
    icon: '▶️',
    title: 'Loop Continued',
    color: 'var(--vscode-charts-blue)',
    getSummary: (e: Event) => {
      const count = (e.payload.continue_count as number) || 0;
      const max = (e.payload.max_continues as number) || 3;
      return `Continue ${count}/${max}`;
    }
  },
  loop_completed: {
    icon: '✅',
    title: 'Loop Completed',
    color: 'var(--vscode-charts-green)',
    getSummary: (e: Event) => {
      const filesApplied = (e.payload.files_applied as number) || 0;
      const iterations = (e.payload.iterations as number) || 0;
      return `${filesApplied} file(s) changed in ${iterations} iteration(s)`;
    }
  }
} as Record<EventType, EventCardConfig>;

/**
 * I3: Approval types that have inline buttons in their triggering card.
 * These do NOT need a standalone ApprovalCard — suppress both event card + ApprovalCard.
 */
const INLINE_APPROVAL_TYPES = new Set([
  'plan_approval', 'apply_diff', 'diff',
  'generated_tool', 'generated_tool_run'
]);

/**
 * R1: Event tier classification — determines visibility in Mission tab
 * 'user' = full card (always visible), 'progress' = collapsible group, 'system' = Logs only
 */
const USER_TIER_EVENTS = new Set<EventType>([
  'intent_received',
  'plan_created', 'plan_revised',
  'approval_requested', 'approval_resolved',
  'diff_proposed', 'diff_applied',
  'test_completed',
  'failure_detected',
  'decision_point_needed',
  'clarification_presented', 'clarification_received',
  'mission_started', 'mission_completed', 'mission_cancelled', 'mission_paused',
  'scaffold_decision_requested', 'scaffold_completed', 'scaffold_cancelled',
  'scaffold_blocked', 'scaffold_style_selection_requested',
  'process_started', 'process_ready', 'process_output', 'process_stopped', 'process_failed',
  'execution_paused', 'execution_resumed', 'execution_stopped',
  'generated_tool_proposed', 'generated_tool_run_started', 'generated_tool_run_completed', 'generated_tool_run_failed',
  'task_interrupted', 'task_recovery_started', 'task_discarded',
  'undo_performed', 'recovery_action_taken',
  'clarification_requested',
  'scope_expansion_requested', 'scope_expansion_resolved',
  'next_steps_shown',
  'autonomy_loop_detected',
  'mission_breakdown_created',
  'scaffold_final_complete',
  'plan_large_detected',
  'repeated_failure_detected',
  'loop_paused', 'loop_completed',
] as EventType[]);

const PROGRESS_TIER_EVENTS = new Set<EventType>([
  'step_started', 'step_completed', 'step_failed',
  'iteration_started', 'iteration_succeeded', 'iteration_failed',
  'scaffold_apply_started', 'scaffold_applied',
  'scaffold_started', 'scaffold_proposal_created',
  'feature_extraction_started', 'feature_extraction_completed',
  'feature_code_generating', 'feature_code_applied', 'feature_code_error',
  'scaffold_verify_started', 'scaffold_verify_step_completed', 'scaffold_verify_completed',
  'scaffold_autofix_started', 'scaffold_autofix_applied', 'scaffold_autofix_failed',
  'scaffold_progress', 'scaffold_doctor_card', 'design_pack_applied',
  'command_started', 'command_completed',
  'tool_start', 'tool_end',
  'repair_attempt_started', 'repair_attempt_completed', 'repair_attempted',
  'test_started',
  'verify_started', 'verify_completed', 'verify_proposed',
  'context_collected',
  'retrieval_started', 'retrieval_completed',
  'scaffold_decision_resolved',
  'scaffold_preflight_started', 'scaffold_preflight_completed',
  'scaffold_preflight_checks_started', 'scaffold_preflight_checks_completed',
  'scaffold_quality_gates_passed', 'scaffold_quality_gates_failed',
  'scaffold_apply_completed',
  'scaffold_target_chosen',
  'scaffold_style_selected',
  'scaffold_checkpoint_created', 'scaffold_checkpoint_restored',
  'scaffold_preflight_resolution_selected',
  'loop_continued',
] as EventType[]);

export function getEventTier(eventType: EventType): 'user' | 'progress' | 'system' {
  if (USER_TIER_EVENTS.has(eventType)) return 'user';
  if (PROGRESS_TIER_EVENTS.has(eventType)) return 'progress';
  return 'system';
}

/**
 * Stage header configuration
 */
export const STAGE_CONFIG: Record<Stage, { title: string; icon: string; color: string }> = {
  plan: { title: 'Planning', icon: '📋', color: 'var(--vscode-charts-purple)' },
  retrieve: { title: 'Retrieval', icon: '🔍', color: 'var(--vscode-charts-blue)' },
  edit: { title: 'Editing', icon: '✏️', color: 'var(--vscode-charts-yellow)' },
  test: { title: 'Testing', icon: '🧪', color: 'var(--vscode-charts-green)' },
  repair: { title: 'Repair', icon: '🔧', color: 'var(--vscode-charts-orange)' },
  command: { title: 'Command', icon: '▶️', color: 'var(--vscode-charts-blue)' },
  none: { title: 'Initializing', icon: '⚡', color: 'var(--vscode-descriptionForeground)' }
};

/**
 * Render a single event card
 * Uses specialized renderers for certain event types
 */
export function renderEventCard(event: Event, taskId?: string): string {
  // DEBUG: Log event type and whether we have a config for it
  console.log('[MissionFeed] renderEventCard called for type:', event.type);
  console.log('[MissionFeed] EVENT_CARD_MAP has config:', event.type in EVENT_CARD_MAP);
  console.log('[MissionFeed] Config value:', EVENT_CARD_MAP[event.type]);
  
  // W2: Process events — render ProcessCard for process_started,
  // update existing card state for follow-up events
  if (event.type === 'process_started') {
    return renderProcessCard(event);
  }
  if (isProcessEvent(event.type)) {
    const result = updateProcessCard(event);
    if (result.handled && result.processId) {
      // Re-render the existing card in the DOM
      const cardHtml = getProcessCardHtml(result.processId);
      if (cardHtml) {
        // Find and update the existing card element
        const existingCard = document.querySelector(
          `.process-card[data-process-id="${result.processId}"]`
        );
        if (existingCard) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = cardHtml;
          const newCard = wrapper.firstElementChild;
          if (newCard) {
            existingCard.replaceWith(newCard);
          }
        }
      }
    }
    // Don't render a new card for follow-up events — they update the existing one
    return '';
  }

  // V8: Generated tool events - specialized cards
  if (event.type === 'generated_tool_proposed') {
    return renderGeneratedToolProposedCard(event);
  }
  if (event.type === 'generated_tool_run_completed') {
    return renderGeneratedToolRunCard(event);
  }

  // Step 47: Crash recovery — specialized cards
  if (event.type === 'task_interrupted') {
    return renderCrashRecoveryCard(event);
  }
  if (event.type === 'task_recovery_started') {
    return renderTaskRecoveryStartedCard(event);
  }
  if (event.type === 'task_discarded') {
    return renderTaskDiscardedCard(event);
  }

  // V5: Solution captured - specialized card
  if (event.type === 'solution_captured') {
    return renderSolutionCapturedCard(event);
  }

  // Step 49: Failure events — render FailureCard with recovery actions
  if (event.type === 'failure_detected') {
    // Extract error_match and error_descriptor if enriched by extension
    const errorMatch = event.payload.error_match as any | undefined;
    const errorDescriptor = event.payload.error_descriptor as any | undefined;
    const recoveryActions = (event.payload.recovery_actions as any[]) || [];
    return renderFailureCard(event, errorMatch || null, errorDescriptor || null, recoveryActions);
  }

  // AgenticLoop: loop_paused — render specialized LoopPausedCard
  if (event.type === 'loop_paused') {
    return renderLoopPausedCard(event);
  }

  // S1: Scaffold build-phase events — aggregate into ScaffoldProgressCard
  if (isScaffoldProgressEvent(event.type)) {
    if (event.type === 'scaffold_apply_started') {
      // First build event — create the progress card
      return renderScaffoldProgressCard(event);
    }
    // Follow-up events — update existing card in-place
    const result = updateScaffoldProgress(event);
    if (result.handled && result.scaffoldId) {
      const cardHtml = getScaffoldProgressCardHtml(result.scaffoldId);
      if (cardHtml) {
        const existing = document.querySelector(
          `.scaffold-progress-card[data-scaffold-id="${result.scaffoldId}"]`
        );
        if (existing) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = cardHtml;
          const newCard = wrapper.firstElementChild;
          if (newCard) existing.replaceWith(newCard);
        }
      }
    }
    return ''; // Don't render a new card
  }

  // S2: Scaffold completion — render ScaffoldCompleteCard
  if (isScaffoldCompleteEvent(event.type)) {
    if (event.type === 'scaffold_final_complete') {
      return renderScaffoldCompleteCard(event);
    }
    if (event.type === 'next_steps_shown') {
      const result = updateScaffoldComplete(event);
      if (result.handled && result.scaffoldId) {
        const cardHtml = getScaffoldCompleteCardHtml(result.scaffoldId);
        if (cardHtml) {
          const existing = document.querySelector(
            `.scaffold-complete-card[data-scaffold-complete-id="${result.scaffoldId}"]`
          );
          if (existing) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = cardHtml;
            const newCard = wrapper.firstElementChild;
            if (newCard) existing.replaceWith(newCard);
          }
        }
      }
      return ''; // Don't render a new card
    }
  }

  // SCAFFOLD EVENTS: Render remaining events (proposal, decision, blocked, etc.)
  // using ScaffoldCard custom element
  if (isScaffoldEvent(event.type)) {
    console.log('[MissionFeed] Rendering scaffold event with ScaffoldCard:', event.type);
    return renderScaffoldEventCard(event);
  }

  // ANSWER mode specialized renderers
  if (event.type === 'context_collected') {
    return renderContextCollectedCard(event);
  }
  
  if (event.type === 'tool_start' && event.payload.tool === 'llm_answer' && taskId) {
    // I2: Wrap in assistant bubble
    return `
      <div class="assistant-bubble">
        <div class="assistant-bubble-avatar">\u2726</div>
        <div class="assistant-bubble-content">${renderAnswerStreamCard(event, taskId)}</div>
      </div>
    `;
  }
  
  // Skip rendering stream_delta events (they're handled by real-time streaming)
  if (event.type === 'stream_delta') {
    return '';
  }
  
  // Skip rendering stream_complete events (streaming completion handled by UI)
  if (event.type === 'stream_complete') {
    return '';
  }
  
  // PLAN mode clarification card (v2 deterministic pipeline)
  if (event.type === 'clarification_presented' && taskId) {
    return renderClarificationCard(event, taskId);
  }
  
  // Skip clarification_received (it's informational, not a card)
  if (event.type === 'clarification_received') {
    const title = event.payload.title as string || 'Focus selected';
    return `
      <div class="event-card">
        <div class="event-card-header">
          <span class="event-icon" style="color: var(--vscode-charts-green)">✓</span>
          <span class="event-type">Focus Selected</span>
          <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
        </div>
        <div class="event-summary">${escapeHtml(title)}</div>
      </div>
    `;
  }
  
  // MODE CONFIRMATION: Check if mode_set requires confirmation
  if (event.type === 'mode_set' && event.payload.requiresConfirmation && taskId) {
    const userMode = event.payload.mode as string;
    const suggestedMode = event.payload.suggestedMode as string;
    const reason = event.payload.suggestionReason as string;
    
    return `
      <div class="event-card mode-confirmation-card" style="border: 2px solid var(--vscode-charts-yellow); background: var(--vscode-editor-background);">
        <div class="event-card-header">
          <span class="event-icon" style="color: var(--vscode-charts-yellow)">⚠️</span>
          <span class="event-type">Mode Confirmation Needed</span>
        </div>
        <div class="event-summary" style="margin: 12px 0;">
          <strong>You selected:</strong> ${escapeHtml(userMode)} mode<br/>
          <strong>System suggests:</strong> ${escapeHtml(suggestedMode)} mode<br/>
          <strong>Reason:</strong> ${escapeHtml(reason)}
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button 
            onclick="handleConfirmMode('${taskId}', '${userMode}')" 
            class="approval-btn approve"
            style="flex: 1; padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; border-radius: 3px;">
            ✓ Keep ${escapeHtml(userMode)}
          </button>
          <button 
            onclick="handleConfirmMode('${taskId}', '${suggestedMode}')" 
            class="approval-btn"
            style="flex: 1; padding: 8px 16px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; cursor: pointer; border-radius: 3px;">
            → Switch to ${escapeHtml(suggestedMode)}
          </button>
        </div>
      </div>
    `;
  }

  // Decision point card (generic decision actions)
  if (event.type === 'decision_point_needed' && taskId) {
    return renderDecisionPointCard(event, taskId);
  }
  
  // PLAN mode specialized renderer
  // Check if we have a structured plan (either at payload.plan or directly in payload)
  if (event.type === 'plan_created') {
    console.log('🔍 [MissionFeed] plan_created event detected');
    console.log('🔍 [MissionFeed] event.payload:', JSON.stringify(event.payload, null, 2));
    
    const plan = (event.payload.plan || event.payload) as any;
    console.log('🔍 [MissionFeed] extracted plan:', JSON.stringify(plan, null, 2));
    console.log('🔍 [MissionFeed] plan checks:', {
      exists: !!plan,
      isObject: typeof plan === 'object',
      hasGoal: !!plan?.goal,
      hasSteps: !!plan?.steps,
      stepsIsArray: Array.isArray(plan?.steps),
      stepsLength: plan?.steps?.length
    });
    
    // Check if this looks like a structured plan with goal and steps
    if (plan && typeof plan === 'object' && plan.goal && plan.steps && Array.isArray(plan.steps)) {
      console.log('✅ [MissionFeed] Rendering PlanCard');
      // I2: Wrap in assistant bubble
      return `
        <div class="assistant-bubble">
          <div class="assistant-bubble-avatar">\u2726</div>
          <div class="assistant-bubble-content">${renderPlanCard(event)}</div>
        </div>
        <div class="assistant-bubble-meta">${formatTimestamp(event.timestamp)}</div>
      `;
    } else {
      console.log('❌ [MissionFeed] NOT rendering PlanCard - condition failed');
    }
  }

  // I2: plan_revised — wrap in assistant bubble (same pattern as plan_created)
  if (event.type === 'plan_revised') {
    const plan = (event.payload.plan || event.payload) as any;
    if (plan && typeof plan === 'object' && plan.goal && plan.steps && Array.isArray(plan.steps)) {
      return `
        <div class="assistant-bubble">
          <div class="assistant-bubble-avatar">\u2726</div>
          <div class="assistant-bubble-content">${renderPlanCard(event)}</div>
        </div>
        <div class="assistant-bubble-meta">${formatTimestamp(event.timestamp)}</div>
      `;
    }
  }

  // Use specialized card renderers for specific event types
  if (event.type === 'diff_proposed' && taskId) {
    return renderDiffProposedCard(event, taskId);
  }
  
  if (event.type === 'diff_applied') {
    // Step 48: Pass undoGroupId to render [Undo] button when applicable.
    // window.__ordinexUndoState is set by the extension via updateUndoState message.
    const undoState = (typeof window !== 'undefined' && (window as any).__ordinexUndoState) || {};
    const topGroupId = undoState.top_undoable_group_id as string | undefined;
    const undoableIds = (undoState.undoable_group_ids as string[]) || [];

    // Determine the correlation ID for this diff_applied event
    const corrId = (event.payload.proposal_id as string) || (event.payload.diff_id as string) || '';

    // Only show [Undo] on the top-of-stack undoable group
    const showUndo = corrId && corrId === topGroupId && undoableIds.includes(corrId);
    return renderDiffAppliedCard(event, showUndo ? corrId : undefined);
  }
  
  if (event.type === 'checkpoint_created') {
    return renderCheckpointCreatedCard(event);
  }

  // Test-related tool_end events (terminal commands in test stage)
  if (event.type === 'tool_end') {
    const tool = event.payload.tool as string;

    // Check if this is a test detection failure
    if (tool === 'test_detection' && !event.payload.success) {
      return renderNoTestRunnerCard(event);
    }

    // Check if this is a terminal command (test execution)
    if (tool === 'terminal' && event.payload.command) {
      return renderTestResultCard(event);
    }

    // Step 49: Fix tool_end color — check both success and error fields
    const hasError = event.payload.success === false || !!event.payload.error;
    if (hasError) {
      const config = EVENT_CARD_MAP[event.type];
      const summary = config ? config.getSummary(event) : 'Tool failed';
      return `
        <div class="event-card failure">
          <div class="event-card-header">
            <span class="event-icon" style="color: var(--vscode-charts-red)">❌</span>
            <span class="event-type">Tool Failed</span>
            <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
          </div>
          <div class="event-summary">${escapeHtml(summary)}</div>
        </div>
      `;
    }
  }

  // Standard card rendering for other events
  const config = EVENT_CARD_MAP[event.type];
  if (!config) {
    // Professional fallback for unmapped events - extract summary from common payload fields
    const fallbackSummary = extractFallbackSummary(event);
    const humanizedType = humanizeEventType(event.type);
    
    return `
      <div class="event-card" style="opacity: 0.8;">
        <div class="event-card-header">
          <span class="event-icon" style="color: var(--vscode-descriptionForeground)">📌</span>
          <span class="event-type">${escapeHtml(humanizedType)}</span>
          <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
        </div>
        <div class="event-summary" style="color: var(--vscode-descriptionForeground);">${escapeHtml(fallbackSummary)}</div>
      </div>
    `;
  }

  const summary = config.getSummary(event);
  const hasEvidence = event.evidence_ids.length > 0;
  const isApproval = event.type === 'approval_requested';
  const isFailure = event.type.includes('fail');

  return `
    <div class="event-card ${isApproval ? 'approval-required' : ''} ${isFailure ? 'failure' : ''}">
      <div class="event-card-header">
        <span class="event-icon" style="color: ${config.color}">${config.icon}</span>
        <span class="event-type">${config.title}</span>
        <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
      </div>
      <div class="event-summary">${escapeHtml(summary)}</div>
      ${hasEvidence ? `<div class="event-evidence">📎 ${event.evidence_ids.length} evidence item(s)</div>` : ''}
    </div>
  `;
}

function renderDecisionPointCard(event: Event, taskId: string): string {
  const title = (event.payload.title as string) || 'Decision Needed';
  const description = (event.payload.description as string) || (event.payload.reason as string) || 'Choose an action to continue.';
  const rawOptions = event.payload.options as any[] | undefined;
  const decisionId = event.event_id;

  const options = (rawOptions || []).map((option) => {
    if (typeof option === 'string') {
      return { label: option, action: option, description: '' };
    }
    return {
      label: (option.label as string) || (option.action as string) || 'Choose',
      action: (option.action as string) || (option.label as string) || '',
      description: (option.description as string) || ''
    };
  });

  const actionsHtml = options.length > 0
    ? options.map((option) => {
        return `
          <button class="approval-btn approve" onclick="handleDecisionPoint('${escapeJsString(taskId)}', '${escapeJsString(decisionId)}', '${escapeJsString(option.action || '')}')">
            ${escapeHtml(option.label)}
          </button>
        `;
      }).join('')
    : `
      <button class="approval-btn approve" onclick="handleDecisionPoint('${escapeJsString(taskId)}', '${escapeJsString(decisionId)}', 'continue')">
        Continue
      </button>
    `;

  const descriptionsHtml = options.some((o) => o.description)
    ? `
      <div class="approval-details">
        ${options.map((o) => o.description ? `<div class="detail-row"><span class="detail-label">${escapeHtml(o.label)}:</span><span class="detail-value">${escapeHtml(o.description)}</span></div>` : '').join('')}
      </div>
    `
    : '';

  return `
    <div class="approval-card" data-decision-id="${escapeHtml(decisionId)}">
      <div class="approval-card-header">
        <div class="approval-card-header-left">
          <span class="approval-icon">🤔</span>
          <div class="approval-card-title">
            <div class="approval-type-label">${escapeHtml(title)}</div>
            <div class="approval-id">ID: ${escapeHtml(decisionId.substring(0, 8))}</div>
          </div>
        </div>
      </div>
      <div class="approval-card-body">
        <div class="approval-summary">${escapeHtml(description)}</div>
        ${descriptionsHtml}
      </div>
      <div class="approval-card-actions">
        ${actionsHtml}
      </div>
    </div>
  `;
}

/**
 * Render stage header
 */
export function renderStageHeader(stage: Stage): string {
  const config = STAGE_CONFIG[stage];
  return `
    <div class="stage-header">
      <span class="stage-icon" style="color: ${config.color}">${config.icon}</span>
      <span class="stage-title">${config.title}</span>
    </div>
  `;
}

/**
 * Render mission timeline from events
 * Groups by stage when stage_changed events occur
 */
export function renderMissionTimeline(events: Event[]): string {
  if (events.length === 0) {
    return '<div class="mission-empty">No mission yet. Start a conversation to begin.</div>';
  }

  const items: string[] = [];
  let currentStage: Stage = 'none';
  let diffAppliedSeen = false;
  let testStageEntered = false;
  let testAlreadyRun = false;

  // Extract taskId from first event
  const taskId = events.length > 0 ? events[0].task_id : undefined;

  // I3: Pre-compute pending approvals for inline approval rendering
  const pendingApprovals = getPendingApprovals(events);

  // Scaffold deduplication: when blueprint extraction re-emits proposal/decision
  // events, only render the LAST event of each type per scaffold_id.
  const scaffoldDedup = new Set<string>();
  const scaffoldDedupTypes = ['scaffold_decision_requested', 'scaffold_proposal_created'];
  for (let j = events.length - 1; j >= 0; j--) {
    const ev = events[j];
    if (scaffoldDedupTypes.includes(ev.type)) {
      const sid = (ev.payload?.scaffold_id as string) || '';
      const key = `${ev.type}::${sid}`;
      if (scaffoldDedup.has(key)) {
        // Mark earlier duplicates by storing their event_id
        scaffoldDedup.add(`skip::${ev.event_id}`);
      } else {
        scaffoldDedup.add(key);
      }
    }
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    
    // Skip rendering stream_delta and stream_complete events entirely
    if (event.type === 'stream_delta' || event.type === 'stream_complete') {
      continue;
    }

    // Skip earlier scaffold events that were superseded by blueprint update
    if (scaffoldDedup.has(`skip::${event.event_id}`)) {
      continue;
    }

    // I3: Skip rendering approval_requested event card for types handled inline
    if (event.type === 'approval_requested' && INLINE_APPROVAL_TYPES.has(event.payload.approval_type as string || '')) {
      continue;
    }

    // I3: Skip awaiting_plan_approval pause (redundant, PlanCard handles approval inline)
    if (event.type === 'execution_paused' && event.payload.reason === 'awaiting_plan_approval') {
      continue;
    }

    // Insert stage header when stage changes
    if (event.type === 'stage_changed' && event.payload.to) {
      const newStage = event.payload.to as Stage;
      if (newStage !== currentStage) {
        items.push(renderStageHeader(newStage));
        currentStage = newStage;
        
        if (newStage === 'test') {
          testStageEntered = true;
        }
      }
    }

    // Track diff_applied
    if (event.type === 'diff_applied') {
      diffAppliedSeen = true;
    }

    // Track if tests have been run
    if (event.type === 'tool_start' && event.payload.tool === 'terminal') {
      testAlreadyRun = true;
    }

    // I3: Intercept plan_created/plan_revised to pass pending approval to PlanCard
    if (event.type === 'plan_created' || event.type === 'plan_revised') {
      const plan = (event.payload.plan || event.payload) as any;
      if (plan && typeof plan === 'object' && plan.goal && plan.steps && Array.isArray(plan.steps)) {
        const planApproval = pendingApprovals.find((p: { approvalType: string; requestEvent: Event }) =>
          p.approvalType === 'plan_approval' &&
          p.requestEvent.payload.details && (p.requestEvent.payload.details as any).plan_id === event.event_id
        );
        items.push(`
          <div class="assistant-bubble">
            <div class="assistant-bubble-avatar">\u2726</div>
            <div class="assistant-bubble-content">${renderPlanCard(event, planApproval?.approvalId)}</div>
          </div>
          <div class="assistant-bubble-meta">${formatTimestamp(event.timestamp)}</div>
        `);
        continue;
      }
    }

    // I3: Intercept diff_proposed to pass pending approval for inline Accept/Reject
    if (event.type === 'diff_proposed' && taskId) {
      const diffId = (event.payload.diff_id || event.payload.proposal_id) as string || '';
      const diffApproval = pendingApprovals.find((p: { approvalType: string; requestEvent: Event }) =>
        (p.approvalType === 'apply_diff' || p.approvalType === 'diff') &&
        (!(p.requestEvent.payload.details as any)?.diff_id || (p.requestEvent.payload.details as any).diff_id === diffId)
      );
      items.push(renderDiffProposedCard(event, taskId, diffApproval?.approvalId));
      continue;
    }

    // I5: Intercept test_completed — compact green banner if all pass, expanded card if failures
    if (event.type === 'test_completed') {
      const passed = (event.payload.pass_count || event.payload.passed || 0) as number;
      const failed = (event.payload.fail_count || event.payload.failed || 0) as number;
      const total = passed + failed;

      if (failed === 0 && total > 0) {
        items.push(`
          <div class="event-card" style="border-left: 3px solid var(--vscode-charts-green, #4caf50); padding: 10px 14px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: var(--vscode-charts-green, #4caf50); font-size: 16px;">\u2705</span>
              <span style="font-size: 13px; font-weight: 600; color: var(--vscode-charts-green, #4caf50);">All ${total} test${total !== 1 ? 's' : ''} passed</span>
              <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
            </div>
          </div>
        `);
        continue;
      }

      if (failed > 0) {
        const failingTests = (event.payload.failing_tests || []) as string[];
        let failListHtml = '';
        if (failingTests.length > 0) {
          const listItems = failingTests.slice(0, 10).map((t: string) =>
            `<li style="margin: 2px 0; font-size: 12px; color: var(--vscode-errorForeground, #f44336);">${escapeHtml(String(t))}</li>`
          ).join('');
          failListHtml = `<ul style="margin: 6px 0 0; padding-left: 20px;">${listItems}</ul>`;
          if (failingTests.length > 10) {
            failListHtml += `<div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px;">...and ${failingTests.length - 10} more</div>`;
          }
        }
        items.push(`
          <div class="event-card" style="border-left: 3px solid var(--vscode-charts-red, #f44336); padding: 12px 14px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span style="font-size: 16px;">\u274C</span>
              <span style="font-size: 13px; font-weight: 600; color: var(--vscode-charts-red, #f44336);">${failed} of ${total} test${total !== 1 ? 's' : ''} failed</span>
              <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
            </div>
            <div style="font-size: 12px; color: var(--vscode-charts-green, #4caf50); margin-bottom: 4px;">\u2713 ${passed} passed</div>
            ${failListHtml}
            <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px; font-style: italic;">Check terminal output for full details</div>
          </div>
        `);
        continue;
      }
      // total === 0 or no data: fall through to generic card
    }

    // Render event card with taskId for specialized renderers
    const renderedCard = renderEventCard(event, taskId);
    if (renderedCard) {
      items.push(renderedCard);
    }

    // INLINE APPROVAL RENDERING: After approval_requested, render inline approval card
    // I3: Only for types NOT handled inline by their triggering card (e.g. terminal)
    if (event.type === 'approval_requested' && taskId) {
      const approvalId = event.payload.approval_id as string;
      const approvalType = (event.payload.approval_type as string) || '';

      // Check if this approval is still pending (not yet resolved)
      const isPending = getPendingApprovalById(events, approvalId);

      if (isPending && !INLINE_APPROVAL_TYPES.has(approvalType)) {
        // Render inline approval card
        items.push(renderApprovalCard({
          approvalEvent: event,
          onApprove: (id) => {}, // Handler is in global scope
          onReject: (id) => {}   // Handler is in global scope
        }));
      }
    }

    // INLINE EXECUTE BUTTON: After execution_paused with awaiting_execute_plan, show Execute Plan button
    if (event.type === 'execution_paused' && taskId) {
      const reason = event.payload.reason as string;
      
      // ONLY show Execute Plan button when reason is EXACTLY "awaiting_execute_plan" (after approval)
      if (reason === 'awaiting_execute_plan') {
        items.push(renderExecutePlanButton(taskId));
      }
    }

    // After diff_applied, show "Run Tests" button (if not already run)
    if (event.type === 'diff_applied' && !testAlreadyRun && taskId) {
      items.push(renderRunTestsButton(taskId));
    }

    // At stage transition to test, show "Run Tests" button (if not already run)
    if (event.type === 'stage_changed' && 
        event.payload.to === 'test' && 
        !testAlreadyRun && 
        taskId) {
      items.push(renderRunTestsButton(taskId));
    }
  }

  return items.join('');
}

/**
 * Render Execute Plan button (inline CTA)
 */
function renderExecutePlanButton(taskId: string): string {
  return `
    <div class="inline-action-button">
      <button class="execute-plan-btn" onclick="handleExecutePlan('${taskId}')">
        ▶️ Execute Plan
      </button>
      <div class="action-hint">
        Click to begin executing the approved plan
      </div>
    </div>
  `;
}

/**
 * Render scaffold event using ScaffoldCard custom element
 */
function renderScaffoldEventCard(event: Event): string {
  const eventId = event.event_id || `evt_${Date.now()}`;
  const eventJson = JSON.stringify(event).replace(/"/g, '&quot;');
  
  return `
    <scaffold-card id="scaffold-${escapeHtml(eventId)}"></scaffold-card>
    <script>
      (function() {
        try {
          const card = document.getElementById('scaffold-${escapeJsString(eventId)}');
          if (card) {
            const eventData = JSON.parse('${eventJson}'.replace(/&quot;/g, '"'));
            card.event = eventData;
          }
        } catch (e) {
          console.error('[ScaffoldCard] Failed to set event data:', e);
        }
      })();
    </script>
  `;
}

/**
 * Utility functions
 */


/**
 * Humanize an event type string for display
 * e.g., "preflight_complete" -> "Preflight Complete"
 */
function humanizeEventType(eventType: string): string {
  return eventType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Extract a fallback summary from common payload fields
 * Used for unmapped event types to show something meaningful
 */
function extractFallbackSummary(event: Event): string {
  const payload = event.payload || {};
  
  // Try common field names in order of preference
  const candidates = [
    payload.summary,
    payload.message,
    payload.description,
    payload.reason,
    payload.error,
    payload.status,
    payload.result,
    payload.file,
    payload.path,
  ];
  
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const trimmed = candidate.trim();
      return trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
    }
  }
  
  // Check for arrays that might have useful info
  if (Array.isArray(payload.files) && payload.files.length > 0) {
    return `${payload.files.length} file(s)`;
  }
  
  // Check for numeric fields
  if (typeof payload.count === 'number') {
    return `Count: ${payload.count}`;
  }
  if (typeof payload.duration_ms === 'number') {
    return `Duration: ${Math.round(payload.duration_ms)}ms`;
  }
  
  // Final fallback - show stage if available
  if (event.stage && event.stage !== 'none') {
    return `Stage: ${event.stage}`;
  }
  
  return 'Event processed';
}
