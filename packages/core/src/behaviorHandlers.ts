/**
 * Behavior Handlers: Pipeline Implementation for Step 33
 * 
 * Each behavior has a distinct execution pipeline:
 * 
 * ANSWER: No execution, no tools, no state mutation
 * CLARIFY: Ask question, show buttons, wait for input, re-run analysis
 * QUICK_ACTION: Minimal context, generate diff/tool, always gated
 * PLAN: Existing PLAN → approve → MISSION pipeline
 * CONTINUE_RUN: Show status, offer Resume/Pause/Abort/Fix
 */

import { randomUUID } from 'crypto';
import {
  Behavior,
  Mode,
  IntentAnalysis,
  ClarificationRequest,
  ActiveRunStatus,
  ContinueRunOptions,
  Event,
  EventType,
} from './types';
import { EventBus } from './eventBus';
import { analyzeIntent, IntentAnalysisContext } from './intentAnalyzer';
import { detectCommandIntent } from './userCommandDetector';

// ============================================================================
// BEHAVIOR HANDLER INTERFACES
// ============================================================================

/**
 * Result from behavior handler execution
 */
export interface BehaviorHandlerResult {
  /** Whether the handler completed successfully */
  success: boolean;
  
  /** Selected behavior */
  behavior: Behavior;
  
  /** Derived mode for downstream processing */
  derived_mode: Mode;
  
  /** Whether this requires user response (CLARIFY only) */
  awaiting_response?: boolean;
  
  /** Next action to take */
  next_action: 
    | 'stream_response'      // ANSWER: Stream LLM response
    | 'show_clarification'   // CLARIFY: Show question UI
    | 'propose_diff'         // QUICK_ACTION: Generate and propose diff
    | 'run_command'          // QUICK_ACTION: Execute terminal command(s)
    | 'generate_plan'        // PLAN: Generate structured plan
    | 'show_run_status'      // CONTINUE_RUN: Show status UI
    | 'complete';            // Handler finished
  
  /** Payload for next action */
  payload?: Record<string, unknown>;
  
  /** Error message if failed */
  error?: string;
}

/**
 * Handler context
 */
export interface HandlerContext {
  taskId: string;
  prompt: string;
  intentAnalysis: IntentAnalysis;
  eventBus: EventBus;
  analysisContext: IntentAnalysisContext;
}

// ============================================================================
// BEHAVIOR HANDLER REGISTRY
// ============================================================================

type BehaviorHandler = (context: HandlerContext) => Promise<BehaviorHandlerResult>;

const BEHAVIOR_HANDLERS: Record<Behavior, BehaviorHandler> = {
  'ANSWER': handleAnswerBehavior,
  'CLARIFY': handleClarifyBehavior,
  'QUICK_ACTION': handleQuickActionBehavior,
  'PLAN': handlePlanBehavior,
  'CONTINUE_RUN': handleContinueRunBehavior,
};

// ============================================================================
// MAIN DISPATCH FUNCTION
// ============================================================================

/**
 * Execute the appropriate behavior handler based on intent analysis
 */
export async function executeBehavior(context: HandlerContext): Promise<BehaviorHandlerResult> {
  const { intentAnalysis, eventBus, taskId } = context;
  
  // Emit intent_received event with behavior info
  await eventBus.publish({
    event_id: randomUUID(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'intent_received',
    mode: intentAnalysis.derived_mode,
    stage: 'none',
    payload: {
      behavior: intentAnalysis.behavior,
      context_source: intentAnalysis.context_source,
      confidence: intentAnalysis.confidence,
      reasoning: intentAnalysis.reasoning,
      detected_scope: intentAnalysis.detected_scope,
      referenced_files: intentAnalysis.referenced_files,
      user_override: intentAnalysis.user_override,
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  
  // Get and execute the appropriate handler
  const handler = BEHAVIOR_HANDLERS[intentAnalysis.behavior];
  if (!handler) {
    return {
      success: false,
      behavior: intentAnalysis.behavior,
      derived_mode: intentAnalysis.derived_mode,
      next_action: 'complete',
      error: `Unknown behavior: ${intentAnalysis.behavior}`,
    };
  }
  
  return handler(context);
}

// ============================================================================
// ANSWER BEHAVIOR HANDLER
// ============================================================================

/**
 * ANSWER: Discussion, explanation, opinions
 * 
 * Pipeline:
 * - No execution
 * - No tools
 * - No state mutation
 * - Stream response directly
 */
async function handleAnswerBehavior(context: HandlerContext): Promise<BehaviorHandlerResult> {
  const { taskId, prompt, intentAnalysis, eventBus } = context;
  
  // Emit mode_set event
  await eventBus.publish({
    event_id: randomUUID(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'mode_set',
    mode: 'ANSWER',
    stage: 'none',
    payload: {
      from_behavior: 'ANSWER',
      reason: intentAnalysis.reasoning,
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  
  return {
    success: true,
    behavior: 'ANSWER',
    derived_mode: 'ANSWER',
    next_action: 'stream_response',
    payload: {
      prompt,
      context_files: intentAnalysis.referenced_files || [],
      system_hint: 'Provide a clear, helpful explanation. No code changes.',
    },
  };
}

// ============================================================================
// CLARIFY BEHAVIOR HANDLER
// ============================================================================

/**
 * CLARIFY: Missing info → ask + offer tools
 * 
 * Pipeline:
 * - Ask question
 * - Show action buttons
 * - Wait for user input
 * - Re-run intent analysis after response
 */
async function handleClarifyBehavior(context: HandlerContext): Promise<BehaviorHandlerResult> {
  const { taskId, prompt, intentAnalysis, eventBus, analysisContext } = context;
  
  if (!intentAnalysis.clarification) {
    // No clarification needed, fall through to default behavior
    return {
      success: false,
      behavior: 'CLARIFY',
      derived_mode: 'ANSWER',
      next_action: 'complete',
      error: 'CLARIFY behavior selected but no clarification request provided',
    };
  }
  
  // Emit clarification_requested event
  await eventBus.publish({
    event_id: randomUUID(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'clarification_requested',
    mode: 'ANSWER',
    stage: 'none',
    payload: {
      question: intentAnalysis.clarification.question,
      options: intentAnalysis.clarification.options,
      reason: intentAnalysis.reasoning,
      attempt: analysisContext.clarificationAttempts + 1,
      max_attempts: 2,
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  
  return {
    success: true,
    behavior: 'CLARIFY',
    derived_mode: 'ANSWER',
    awaiting_response: true,
    next_action: 'show_clarification',
    payload: {
      question: intentAnalysis.clarification.question,
      options: intentAnalysis.clarification.options,
      original_prompt: prompt,
      clarification_attempt: analysisContext.clarificationAttempts + 1,
    },
  };
}

/**
 * Process clarification response and re-run intent analysis
 */
export async function processClarificationResponse(
  originalPrompt: string,
  response: { action: string; value?: string },
  context: IntentAnalysisContext,
  eventBus: EventBus,
  taskId: string
): Promise<IntentAnalysis> {
  // Emit clarification_received event
  await eventBus.publish({
    event_id: randomUUID(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'clarification_received',
    mode: 'ANSWER',
    stage: 'none',
    payload: {
      action: response.action,
      value: response.value,
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  
  // Update context with clarification response
  const updatedContext: IntentAnalysisContext = {
    ...context,
    clarificationAttempts: context.clarificationAttempts + 1,
  };
  
  // Handle different response actions
  switch (response.action) {
    case 'provide_file':
      if (response.value) {
        updatedContext.lastOpenEditor = response.value;
      }
      break;
    case 'provide_scope':
      // No context update needed, just proceed
      break;
    case 'confirm_intent':
      // Force behavior based on user selection
      if (response.value === 'ANSWER') {
        return {
          behavior: 'ANSWER',
          context_source: { type: 'fresh' },
          confidence: 1.0,
          reasoning: 'User confirmed: just explain/discuss',
          derived_mode: 'ANSWER',
        };
      } else if (response.value === 'QUICK_ACTION') {
        return {
          behavior: 'QUICK_ACTION',
          context_source: { type: 'fresh' },
          confidence: 1.0,
          reasoning: 'User confirmed: make a small change',
          derived_mode: 'MISSION',
        };
      } else if (response.value === 'PLAN') {
        return {
          behavior: 'PLAN',
          context_source: { type: 'fresh' },
          confidence: 1.0,
          reasoning: 'User confirmed: create a full plan',
          derived_mode: 'PLAN',
        };
      }
      break;
    case 'cancel':
      return {
        behavior: 'ANSWER',
        context_source: { type: 'fresh' },
        confidence: 1.0,
        reasoning: 'User cancelled operation',
        derived_mode: 'ANSWER',
      };
  }
  
  // Re-run intent analysis with updated context
  return analyzeIntent(originalPrompt, updatedContext);
}

// ============================================================================
// QUICK_ACTION BEHAVIOR HANDLER
// ============================================================================

/**
 * QUICK_ACTION: Small, obvious change → gated diff/tool OR command execution
 * 
 * Step 34.5 Enhancement: Detects command execution intent
 * 
 * Pipeline:
 * - Check if user wants to run commands
 * - If command: route to run_command
 * - If code change: Retrieve minimal context → generate diff/tool
 * - Always gated (approval required)
 * - Approve → Apply → Done
 */
async function handleQuickActionBehavior(context: HandlerContext): Promise<BehaviorHandlerResult> {
  const { taskId, prompt, intentAnalysis, eventBus, analysisContext } = context;
  
  // Step 34.5: Check if this is a command execution request
  const commandIntent = detectCommandIntent(prompt);
  
  if (commandIntent.isCommandIntent && commandIntent.confidence >= 0.7) {
    // This is a command execution request, not a code change
    // Emit mode_set with command context
    await eventBus.publish({
      event_id: randomUUID(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'mode_set',
      mode: 'MISSION',
      stage: 'command',
      payload: {
        from_behavior: 'QUICK_ACTION',
        reason: `Command execution: ${commandIntent.reasoning}`,
        detected_keywords: commandIntent.detectedKeywords,
        inferred_commands: commandIntent.inferredCommands,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    
    return {
      success: true,
      behavior: 'QUICK_ACTION',
      derived_mode: 'MISSION',
      next_action: 'run_command',
      payload: {
        prompt,
        command_intent: commandIntent,
        gated: true, // Always require approval
        execution_context: 'user_run',
      },
    };
  }
  
  // Regular code change flow
  // Emit mode_set event (MISSION mode for QUICK_ACTION)
  await eventBus.publish({
    event_id: randomUUID(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'mode_set',
    mode: 'MISSION',
    stage: 'edit',
    payload: {
      from_behavior: 'QUICK_ACTION',
      reason: intentAnalysis.reasoning,
      scope: intentAnalysis.detected_scope,
      files: intentAnalysis.referenced_files,
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  
  return {
    success: true,
    behavior: 'QUICK_ACTION',
    derived_mode: 'MISSION',
    next_action: 'propose_diff',
    payload: {
      prompt,
      target_files: intentAnalysis.referenced_files || [],
      scope: intentAnalysis.detected_scope,
      context_source: intentAnalysis.context_source,
      gated: true, // Always require approval
      quick_action_mode: true,
    },
  };
}

// ============================================================================
// PLAN BEHAVIOR HANDLER
// ============================================================================

/**
 * PLAN: Large or greenfield work
 * 
 * Pipeline:
 * - Existing PLAN → approve → MISSION pipeline
 * - Used for greenfield apps, major features, multi-module work
 */
async function handlePlanBehavior(context: HandlerContext): Promise<BehaviorHandlerResult> {
  const { taskId, prompt, intentAnalysis, eventBus } = context;
  
  // Emit mode_set event
  await eventBus.publish({
    event_id: randomUUID(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'mode_set',
    mode: 'PLAN',
    stage: 'plan',
    payload: {
      from_behavior: 'PLAN',
      reason: intentAnalysis.reasoning,
      scope: intentAnalysis.detected_scope,
      files: intentAnalysis.referenced_files,
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  
  return {
    success: true,
    behavior: 'PLAN',
    derived_mode: 'PLAN',
    next_action: 'generate_plan',
    payload: {
      prompt,
      target_files: intentAnalysis.referenced_files || [],
      scope: intentAnalysis.detected_scope,
      context_source: intentAnalysis.context_source,
      // Plan will require approval before transitioning to MISSION
    },
  };
}

// ============================================================================
// CONTINUE_RUN BEHAVIOR HANDLER
// ============================================================================

/**
 * CONTINUE_RUN: Mid-execution interruption handling
 * 
 * Pipeline:
 * - Show current status
 * - Offer: Resume, Pause, Abort, Propose fix (QUICK_ACTION)
 * - Never restart plan automatically
 */
async function handleContinueRunBehavior(context: HandlerContext): Promise<BehaviorHandlerResult> {
  const { taskId, prompt, intentAnalysis, eventBus, analysisContext } = context;
  
  const activeRun = analysisContext.activeRun;
  
  if (!activeRun) {
    // No active run, fall back to normal processing
    return {
      success: false,
      behavior: 'CONTINUE_RUN',
      derived_mode: 'ANSWER',
      next_action: 'complete',
      error: 'CONTINUE_RUN selected but no active run found',
    };
  }
  
  // Determine available options based on run status
  const options: ContinueRunOptions = {
    resume: activeRun.status === 'paused',
    pause: activeRun.status === 'running',
    abort: true,
    propose_fix: activeRun.status === 'paused' || activeRun.status === 'awaiting_approval',
  };
  
  // Emit decision_point_needed event
  await eventBus.publish({
    event_id: randomUUID(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'decision_point_needed',
    mode: 'MISSION',
    stage: activeRun.stage as any,
    payload: {
      behavior: 'CONTINUE_RUN',
      mission_id: activeRun.mission_id,
      status: activeRun.status,
      options,
      user_prompt: prompt,
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  
  return {
    success: true,
    behavior: 'CONTINUE_RUN',
    derived_mode: 'MISSION',
    awaiting_response: true,
    next_action: 'show_run_status',
    payload: {
      active_run: activeRun,
      options,
      user_prompt: prompt,
      message: generateContinueRunMessage(activeRun, options),
    },
  };
}

/**
 * Generate user-friendly message for continue run status
 */
function generateContinueRunMessage(
  activeRun: ActiveRunStatus,
  options: ContinueRunOptions
): string {
  let status: string;
  switch (activeRun.status) {
    case 'running':
      status = 'is currently running';
      break;
    case 'paused':
      status = 'is paused';
      break;
    case 'awaiting_approval':
      status = 'is waiting for your approval';
      break;
    default:
      status = 'has an unknown status';
  }
  
  const availableActions: string[] = [];
  if (options.resume) availableActions.push('Resume');
  if (options.pause) availableActions.push('Pause');
  if (options.abort) availableActions.push('Abort');
  if (options.propose_fix) availableActions.push('Propose a fix');
  
  return `The mission ${status} (stage: ${activeRun.stage}). ` +
         `You can: ${availableActions.join(', ')}.`;
}

/**
 * Process continue run response
 */
export async function processContinueRunResponse(
  action: 'resume' | 'pause' | 'abort' | 'propose_fix',
  activeRun: ActiveRunStatus,
  eventBus: EventBus,
  taskId: string
): Promise<BehaviorHandlerResult> {
  const timestamp = new Date().toISOString();
  
  switch (action) {
    case 'resume':
      await eventBus.publish({
        event_id: randomUUID(),
        task_id: taskId,
        timestamp,
        type: 'execution_resumed',
        mode: 'MISSION',
        stage: activeRun.stage as any,
        payload: {
          mission_id: activeRun.mission_id,
          from_status: activeRun.status,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      return {
        success: true,
        behavior: 'CONTINUE_RUN',
        derived_mode: 'MISSION',
        next_action: 'complete',
        payload: { action: 'resume', mission_id: activeRun.mission_id },
      };
      
    case 'pause':
      await eventBus.publish({
        event_id: randomUUID(),
        task_id: taskId,
        timestamp,
        type: 'execution_paused',
        mode: 'MISSION',
        stage: activeRun.stage as any,
        payload: {
          mission_id: activeRun.mission_id,
          reason: 'User requested pause',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      return {
        success: true,
        behavior: 'CONTINUE_RUN',
        derived_mode: 'MISSION',
        next_action: 'complete',
        payload: { action: 'pause', mission_id: activeRun.mission_id },
      };
      
    case 'abort':
      await eventBus.publish({
        event_id: randomUUID(),
        task_id: taskId,
        timestamp,
        type: 'mission_cancelled',
        mode: 'MISSION',
        stage: activeRun.stage as any,
        payload: {
          mission_id: activeRun.mission_id,
          reason: 'User requested abort',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      return {
        success: true,
        behavior: 'CONTINUE_RUN',
        derived_mode: 'MISSION',
        next_action: 'complete',
        payload: { action: 'abort', mission_id: activeRun.mission_id },
      };
      
    case 'propose_fix':
      // Transition to QUICK_ACTION behavior for proposing a fix
      return {
        success: true,
        behavior: 'QUICK_ACTION',
        derived_mode: 'MISSION',
        next_action: 'propose_diff',
        payload: {
          fix_mode: true,
          mission_id: activeRun.mission_id,
          stage: activeRun.stage,
          gated: true,
        },
      };
      
    default:
      return {
        success: false,
        behavior: 'CONTINUE_RUN',
        derived_mode: 'MISSION',
        next_action: 'complete',
        error: `Unknown continue run action: ${action}`,
      };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Map behavior to downstream mode
 */
export function behaviorToMode(behavior: Behavior): Mode {
  switch (behavior) {
    case 'ANSWER':
    case 'CLARIFY':
      return 'ANSWER';
    case 'QUICK_ACTION':
    case 'CONTINUE_RUN':
      return 'MISSION';
    case 'PLAN':
      return 'PLAN';
    default:
      return 'ANSWER';
  }
}

/**
 * Check if behavior requires user response before proceeding
 */
export function behaviorRequiresResponse(behavior: Behavior): boolean {
  return behavior === 'CLARIFY' || behavior === 'CONTINUE_RUN';
}

/**
 * Check if behavior modifies state
 */
export function behaviorModifiesState(behavior: Behavior): boolean {
  return behavior === 'QUICK_ACTION' || behavior === 'PLAN' || behavior === 'CONTINUE_RUN';
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  BEHAVIOR_HANDLERS,
  handleAnswerBehavior,
  handleClarifyBehavior,
  handleQuickActionBehavior,
  handlePlanBehavior,
  handleContinueRunBehavior,
};
