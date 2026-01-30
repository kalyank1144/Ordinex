/**
 * Scaffold Flow Coordinator (Step 35.1)
 * 
 * Handles greenfield project scaffolding through a decision-point-based flow.
 * 
 * Event Flow:
 * 1. scaffold_started
 * 2. scaffold_proposal_created (with placeholder recipe/design)
 * 3. decision_point_needed (Proceed / Cancel)
 * 4. [user_action_taken]
 * 5. scaffold_completed (status: cancelled | ready_for_step_35_2)
 * 
 * Step 35.1 Scope:
 * - NO actual file creation
 * - NO recipe selection logic
 * - NO design packs
 * - NO terminal commands
 * - NO verify integration
 * 
 * This is purely the routing + event lifecycle + decision point UI plumbing.
 */

import { randomUUID } from 'crypto';
import {
  Event,
  Mode,
  Stage,
  ScaffoldStartedPayload,
  ScaffoldProposalCreatedPayload,
  ScaffoldCompletedPayload,
  ScaffoldCompletionStatus,
  ReferenceContext,
  StyleSourceMode,
  ReferenceAttachedPayload,
  ReferenceContextBuiltPayload,
  ReferenceUsedPayload,
} from './types';
import { EventBus } from './eventBus';
import {
  buildReferenceContext,
  buildReferenceAttachedPayload,
  buildReferenceContextBuiltPayload,
  DEFAULT_STYLE_SOURCE_MODE,
  type AttachmentInput,
} from './referenceContextBuilder';

// ============================================================================
// SCAFFOLD FLOW STATE
// ============================================================================

/**
 * Internal state for a scaffold flow
 */
export interface ScaffoldFlowState {
  /** Unique scaffold attempt ID */
  scaffoldId: string;
  /** Associated run/task ID */
  runId: string;
  /** User's original prompt */
  userPrompt: string;
  /** Target directory (optional in 35.1) */
  targetDirectory?: string;
  /** Current status */
  status: 'started' | 'proposal_created' | 'awaiting_decision' | 'completed';
  /** Completion status (set when completed) */
  completionStatus?: ScaffoldCompletionStatus;
  /** ISO timestamp when started */
  startedAt: string;
  /** ISO timestamp of last event */
  lastEventAt: string;
  
  // Step 37: Reference Enhancement State
  /** Reference context (if user provided images/URLs) */
  referenceContext?: ReferenceContext;
  /** Selected style source mode */
  styleSourceMode?: StyleSourceMode;
}

/**
 * Decision point options for scaffold flow
 */
export interface ScaffoldDecisionOptions {
  proceed: {
    label: string;
    action: 'proceed';
    description: string;
    primary: boolean;
  };
  cancel: {
    label: string;
    action: 'cancel';
    description: string;
  };
  changeStyle?: {
    label: string;
    action: 'change_style';
    description: string;
    disabled: boolean;
    disabledReason?: string;
  };
}

// ============================================================================
// SCAFFOLD FLOW COORDINATOR
// ============================================================================

/**
 * Scaffold Flow Coordinator
 * 
 * Manages the lifecycle of a greenfield scaffold request.
 * Uses event sourcing and decision points for user interaction.
 */
export class ScaffoldFlowCoordinator {
  private eventBus: EventBus;
  private state: ScaffoldFlowState | null = null;
  
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }
  
  /**
   * Start a new scaffold flow
   * 
   * @param runId - The associated run/task ID
   * @param userPrompt - User's original prompt
   * @param targetDirectory - Optional target directory
   * @param attachments - Optional user attachments (Step 37)
   * @param styleSourceMode - Optional selected style source mode (Step 37)
   * @returns ScaffoldFlowState
   */
  async startScaffoldFlow(
    runId: string,
    userPrompt: string,
    targetDirectory?: string,
    attachments?: AttachmentInput[],
    styleSourceMode?: StyleSourceMode
  ): Promise<ScaffoldFlowState> {
    const scaffoldId = `scaffold_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    
    // Step 37: Build reference context from attachments and prompt
    const referenceContext = attachments && attachments.length > 0
      ? buildReferenceContext(attachments, userPrompt)
      : null;
    
    // Initialize state
    this.state = {
      scaffoldId,
      runId,
      userPrompt,
      targetDirectory,
      status: 'started',
      startedAt: now,
      lastEventAt: now,
      // Step 37: Reference state
      referenceContext: referenceContext || undefined,
      styleSourceMode: styleSourceMode || (referenceContext ? DEFAULT_STYLE_SOURCE_MODE : undefined),
    };
    
    // Emit scaffold_started event
    await this.emitScaffoldStarted();
    
    // Step 37: Emit reference events if references exist
    if (this.state.referenceContext) {
      await this.emitReferenceAttached();
      await this.emitReferenceContextBuilt();
    }
    
    // Emit scaffold_proposal_created with placeholders
    await this.emitScaffoldProposalCreated();
    
    // Emit decision_point_needed
    await this.emitDecisionPointNeeded();
    
    // Update state to awaiting_decision
    this.state.status = 'awaiting_decision';
    this.state.lastEventAt = new Date().toISOString();
    
    return this.state;
  }
  
  /**
   * Handle user action (Proceed or Cancel)
   * 
   * @param action - The action taken by user
   * @returns Updated ScaffoldFlowState
   */
  async handleUserAction(action: 'proceed' | 'cancel' | 'change_style'): Promise<ScaffoldFlowState> {
    if (!this.state) {
      throw new Error('No active scaffold flow');
    }
    
    if (this.state.status !== 'awaiting_decision') {
      throw new Error(`Cannot handle action in status: ${this.state.status}`);
    }
    
    // Determine completion status based on action
    let completionStatus: ScaffoldCompletionStatus;
    let reason: string;
    
    switch (action) {
      case 'proceed':
        completionStatus = 'ready_for_step_35_2';
        reason = 'User approved scaffold proposal';
        break;
      case 'cancel':
        completionStatus = 'cancelled';
        reason = 'User cancelled scaffold';
        break;
      case 'change_style':
        // In 35.1, change_style is disabled - treat as cancel with message
        completionStatus = 'cancelled';
        reason = 'Style customization available in Step 35.4';
        break;
      default:
        completionStatus = 'cancelled';
        reason = `Unknown action: ${action}`;
    }
    
    // Emit scaffold_completed
    await this.emitScaffoldCompleted(completionStatus, reason);
    
    // Update state
    this.state.status = 'completed';
    this.state.completionStatus = completionStatus;
    this.state.lastEventAt = new Date().toISOString();
    
    return this.state;
  }
  
  /**
   * Get current state
   */
  getState(): ScaffoldFlowState | null {
    return this.state;
  }
  
  /**
   * Check if scaffold flow is awaiting user decision
   */
  isAwaitingDecision(): boolean {
    return this.state?.status === 'awaiting_decision';
  }
  
  // =========================================================================
  // PRIVATE: Event Emission Helpers
  // =========================================================================
  
  private async emitScaffoldStarted(): Promise<void> {
    if (!this.state) return;
    
    const payload: ScaffoldStartedPayload = {
      scaffold_id: this.state.scaffoldId,
      run_id: this.state.runId,
      target_directory: this.state.targetDirectory,
      reference_type: 'description', // In 35.1, all requests are description-based
      user_prompt: this.state.userPrompt,
      created_at_iso: this.state.startedAt,
    };
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: this.state.startedAt,
      type: 'scaffold_started',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  private async emitScaffoldProposalCreated(): Promise<void> {
    if (!this.state) return;
    
    // Generate placeholder summary from user prompt
    let summary = generatePlaceholderSummary(this.state.userPrompt);
    
    // Step 37: Augment summary if references are present
    if (this.state.referenceContext) {
      const refCount = this.state.referenceContext.images.length + 
                       this.state.referenceContext.urls.length;
      summary += ` Design will be influenced by ${refCount} provided reference(s).`;
    }
    
    const payload: ScaffoldProposalCreatedPayload = {
      scaffold_id: this.state.scaffoldId,
      recipe: 'TBD', // Placeholder in 35.1
      design_pack: 'TBD', // Placeholder in 35.1
      files_count: 0, // Placeholder in 35.1
      directories_count: 0, // Placeholder in 35.1
      commands_to_run: [], // Placeholder in 35.1
      summary,
      // Step 37: Include reference context in payload for UI rendering
      reference_context: this.state.referenceContext,
      reference_mode: this.state.styleSourceMode,
    };
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_proposal_created',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
    
    // Update state
    this.state.status = 'proposal_created';
    this.state.lastEventAt = event.timestamp;
  }
  
  private async emitDecisionPointNeeded(): Promise<void> {
    if (!this.state) return;
    
    const decisionOptions = buildScaffoldDecisionOptions();
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'decision_point_needed',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: {
        decision_type: 'scaffold_approval',
        scaffold_id: this.state.scaffoldId,
        title: 'Create new project',
        description: `Ready to scaffold a new project based on: "${this.state.userPrompt.substring(0, 100)}"`,
        options: [
          decisionOptions.proceed,
          decisionOptions.cancel,
          decisionOptions.changeStyle,
        ].filter(Boolean),
        context: {
          flow: 'scaffold',
          scaffold_id: this.state.scaffoldId,
          user_prompt: this.state.userPrompt,
        },
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  private async emitScaffoldCompleted(
    status: ScaffoldCompletionStatus,
    reason: string
  ): Promise<void> {
    if (!this.state) return;
    
    // Step 37: Emit reference_used event if references exist and user proceeds
    if (status === 'ready_for_step_35_2' && this.state.referenceContext) {
      await this.emitReferenceUsed();
    }
    
    const payload: ScaffoldCompletedPayload = {
      scaffold_id: this.state.scaffoldId,
      status,
      reason,
    };
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_completed',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  // =========================================================================
  // STEP 37: Reference Event Emission Helpers
  // =========================================================================
  
  /**
   * Emit reference_attached event (Step 37)
   * Called when scaffold starts and references exist
   */
  private async emitReferenceAttached(): Promise<void> {
    if (!this.state || !this.state.referenceContext) return;
    
    const payload: ReferenceAttachedPayload = buildReferenceAttachedPayload(
      this.state.referenceContext
    );
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'reference_attached',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  /**
   * Emit reference_context_built event (Step 37)
   * Called after building ReferenceContext
   */
  private async emitReferenceContextBuilt(): Promise<void> {
    if (!this.state || !this.state.referenceContext) return;
    
    const payload: ReferenceContextBuiltPayload = buildReferenceContextBuiltPayload(
      this.state.referenceContext
    );
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'reference_context_built',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  /**
   * Emit reference_used event (Step 37)
   * Called when user proceeds with scaffold and references exist
   */
  private async emitReferenceUsed(): Promise<void> {
    if (!this.state || !this.state.referenceContext) return;
    
    const mode = this.state.styleSourceMode;
    const payload: ReferenceUsedPayload = {
      scope: 'scaffold',
      mode: mode === 'use_reference' ? 'exclusive' : 'combined',
    };
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'reference_used',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: payload as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a placeholder summary from user prompt
 */
function generatePlaceholderSummary(userPrompt: string): string {
  const prompt = userPrompt.toLowerCase();
  
  // Detect framework hints
  let framework = 'project';
  if (prompt.includes('nextjs') || prompt.includes('next.js') || prompt.includes('next app')) {
    framework = 'Next.js application';
  } else if (prompt.includes('vite')) {
    framework = 'Vite application';
  } else if (prompt.includes('expo')) {
    framework = 'Expo (React Native) application';
  } else if (prompt.includes('react')) {
    framework = 'React application';
  } else if (prompt.includes('vue')) {
    framework = 'Vue.js application';
  } else if (prompt.includes('angular')) {
    framework = 'Angular application';
  } else if (prompt.includes('express')) {
    framework = 'Express.js backend';
  } else if (prompt.includes('node')) {
    framework = 'Node.js project';
  } else if (prompt.includes('typescript')) {
    framework = 'TypeScript project';
  }
  
  return `Create a new ${framework}. Recipe and design pack selection coming in Step 35.4.`;
}

/**
 * Build decision options for scaffold flow
 */
function buildScaffoldDecisionOptions(): ScaffoldDecisionOptions {
  return {
    proceed: {
      label: 'Proceed',
      action: 'proceed',
      description: 'Continue with scaffold setup',
      primary: true,
    },
    cancel: {
      label: 'Cancel',
      action: 'cancel',
      description: 'Cancel scaffold and return to chat',
    },
    changeStyle: {
      label: 'Change Style',
      action: 'change_style',
      description: 'Customize design pack and recipe',
      disabled: true,
      disabledReason: 'Available in Step 35.4',
    },
  };
}

/**
 * Check if an event is a scaffold decision point
 */
export function isScaffoldDecisionPoint(event: Event): boolean {
  return (
    event.type === 'decision_point_needed' &&
    event.payload.decision_type === 'scaffold_approval'
  );
}

/**
 * Extract scaffold_id from a scaffold-related event
 */
export function extractScaffoldId(event: Event): string | undefined {
  if (event.payload.scaffold_id) {
    return event.payload.scaffold_id as string;
  }
  if (event.payload.context && typeof event.payload.context === 'object') {
    const context = event.payload.context as Record<string, unknown>;
    return context.scaffold_id as string | undefined;
  }
  return undefined;
}

/**
 * Derive scaffold flow state from events (replay-safe)
 */
export function deriveScaffoldFlowState(events: Event[]): ScaffoldFlowState | null {
  // Find scaffold_started event
  const startedEvent = events.find(e => e.type === 'scaffold_started');
  if (!startedEvent) {
    return null;
  }
  
  const payload = startedEvent.payload as unknown as ScaffoldStartedPayload;
  
  // Check for completion
  const completedEvent = events.find(
    e => e.type === 'scaffold_completed' &&
         (e.payload as unknown as ScaffoldCompletedPayload).scaffold_id === payload.scaffold_id
  );
  
  if (completedEvent) {
    const completedPayload = completedEvent.payload as unknown as ScaffoldCompletedPayload;
    return {
      scaffoldId: payload.scaffold_id,
      runId: payload.run_id,
      userPrompt: payload.user_prompt,
      targetDirectory: payload.target_directory,
      status: 'completed',
      completionStatus: completedPayload.status,
      startedAt: payload.created_at_iso,
      lastEventAt: completedEvent.timestamp,
    };
  }
  
  // Check for decision point
  const decisionEvent = events.find(
    e => e.type === 'decision_point_needed' &&
         e.payload.decision_type === 'scaffold_approval' &&
         (e.payload.scaffold_id === payload.scaffold_id ||
          (e.payload.context as any)?.scaffold_id === payload.scaffold_id)
  );
  
  if (decisionEvent) {
    return {
      scaffoldId: payload.scaffold_id,
      runId: payload.run_id,
      userPrompt: payload.user_prompt,
      targetDirectory: payload.target_directory,
      status: 'awaiting_decision',
      startedAt: payload.created_at_iso,
      lastEventAt: decisionEvent.timestamp,
    };
  }
  
  // Check for proposal
  const proposalEvent = events.find(
    e => e.type === 'scaffold_proposal_created' &&
         (e.payload as unknown as ScaffoldProposalCreatedPayload).scaffold_id === payload.scaffold_id
  );
  
  if (proposalEvent) {
    return {
      scaffoldId: payload.scaffold_id,
      runId: payload.run_id,
      userPrompt: payload.user_prompt,
      targetDirectory: payload.target_directory,
      status: 'proposal_created',
      startedAt: payload.created_at_iso,
      lastEventAt: proposalEvent.timestamp,
    };
  }
  
  // Just started
  return {
    scaffoldId: payload.scaffold_id,
    runId: payload.run_id,
    userPrompt: payload.user_prompt,
    targetDirectory: payload.target_directory,
    status: 'started',
    startedAt: payload.created_at_iso,
    lastEventAt: startedEvent.timestamp,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  generatePlaceholderSummary,
  buildScaffoldDecisionOptions,
};
