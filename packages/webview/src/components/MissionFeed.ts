/**
 * Mission Feed Component - Event-driven timeline rendering
 * Renders canonical events as timeline cards with stage grouping
 */

import { Event, EventType, Stage } from '../types';
import { renderDiffProposedCard } from './DiffProposedCard';
import { renderDiffAppliedCard } from './DiffAppliedCard';
import { renderCheckpointCreatedCard } from './CheckpointCreatedCard';
import { renderTestResultCard, renderNoTestRunnerCard, renderRunTestsButton } from './TestResultCard';
import { renderContextCollectedCard, renderAnswerStreamCard } from './AnswerCard';
import { renderPlanCard } from './PlanCard';
import { renderApprovalCard } from './ApprovalCard';
import { getPendingApprovalById } from '../selectors/approvalSelectors';
import { renderClarificationCard } from './ClarificationCard';

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
    getSummary: (e) => (e.payload.error as string) || 'Error occurred'
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
      return `Iteration #${num || '?'}`;
    }
  },
  repair_attempted: {
    icon: '🔧',
    title: 'Repair Attempted',
    color: 'var(--vscode-charts-orange)',
    getSummary: (e) => (e.payload.repair_type as string) || 'Attempting repair'
  },
  iteration_failed: {
    icon: '❌',
    title: 'Iteration Failed',
    color: 'var(--vscode-charts-red)',
    getSummary: (e) => (e.payload.reason as string) || 'Iteration failed'
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
  }
};

/**
 * Stage header configuration
 */
export const STAGE_CONFIG: Record<Stage, { title: string; icon: string; color: string }> = {
  plan: { title: 'Planning', icon: '📋', color: 'var(--vscode-charts-purple)' },
  retrieve: { title: 'Retrieval', icon: '🔍', color: 'var(--vscode-charts-blue)' },
  edit: { title: 'Editing', icon: '✏️', color: 'var(--vscode-charts-yellow)' },
  test: { title: 'Testing', icon: '🧪', color: 'var(--vscode-charts-green)' },
  repair: { title: 'Repair', icon: '🔧', color: 'var(--vscode-charts-orange)' },
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
  
  // ANSWER mode specialized renderers
  if (event.type === 'context_collected') {
    return renderContextCollectedCard(event);
  }
  
  if (event.type === 'tool_start' && event.payload.tool === 'llm_answer' && taskId) {
    return renderAnswerStreamCard(event, taskId);
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
      return renderPlanCard(event);
    } else {
      console.log('❌ [MissionFeed] NOT rendering PlanCard - condition failed');
    }
  }
  
  // Use specialized card renderers for specific event types
  if (event.type === 'diff_proposed' && taskId) {
    return renderDiffProposedCard(event, taskId);
  }
  
  if (event.type === 'diff_applied') {
    return renderDiffAppliedCard(event);
  }
  
  if (event.type === 'checkpoint_created') {
    return renderCheckpointCreatedCard(event);
  }

  // Test-related tool_end events (terminal commands in test stage)
  if (event.type === 'tool_end') {
    const tool = event.payload.tool as string;
    const message = event.payload.message as string;
    
    // Check if this is a test detection failure
    if (tool === 'test_detection' && !event.payload.success) {
      return renderNoTestRunnerCard(event);
    }
    
    // Check if this is a terminal command (test execution)
    if (tool === 'terminal' && event.payload.command) {
      return renderTestResultCard(event);
    }
  }

  // Standard card rendering for other events
  const config = EVENT_CARD_MAP[event.type];
  if (!config) {
    // Fallback for unmapped events
    return `
      <div class="event-card">
        <div class="event-card-header">
          <span class="event-icon">❓</span>
          <span class="event-type">${event.type}</span>
          <span class="event-timestamp">${formatTimestamp(event.timestamp)}</span>
        </div>
        <div class="event-summary">Unknown event type</div>
      </div>
    `;
  }

  const summary = config.getSummary(event);
  const hasEvidence = event.evidence_ids.length > 0;
  const isApproval = event.type === 'approval_requested';
  const isFailure = event.type.includes('fail') || event.type === 'failure_detected';

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

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    
    // Skip rendering stream_delta and stream_complete events entirely
    // These are for real-time updates only, not timeline display
    if (event.type === 'stream_delta' || event.type === 'stream_complete') {
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

    // Render event card with taskId for specialized renderers
    const renderedCard = renderEventCard(event, taskId);
    if (renderedCard) {
      items.push(renderedCard);
    }

    // INLINE APPROVAL RENDERING: After approval_requested, render inline approval card
    if (event.type === 'approval_requested' && taskId) {
      const approvalId = event.payload.approval_id as string;
      
      // Check if this approval is still pending (not yet resolved)
      const isPending = getPendingApprovalById(events, approvalId);
      
      if (isPending) {
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
 * Utility functions
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
