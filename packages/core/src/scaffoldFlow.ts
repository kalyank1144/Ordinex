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
// Step 35.3: Recipe selection
import { selectRecipe } from './scaffold/recipeSelector';
import { extractAppName } from './scaffoldPreflight';
import { getRecipeDisplayName as configDisplayName, getEstimates } from './scaffold/recipeConfig';
// Design pack selection — lightweight inline, replaces old 656-line designPackSelector.ts
import { createHash } from 'crypto';
import {
  DESIGN_PACKS,
  formatTokensSummary,
  getDefaultPacksForPicker,
  getDesignPackById,
  DesignPack,
  DesignPackId,
} from './scaffold/designPacks';
// Step 38: Vision imports for token-based design pack selection
import { buildCompactSummary, buildReferenceContextSummary } from './vision/referenceContextSummary';
import { DEFAULT_VISION_CONFIG_COMPLETE, type VisionConfigComplete } from './vision/visionConfig';
// Scaffold Improvement Plan: Blueprint + Style Intent
import type { AppBlueprint, BlueprintExtractionResult, StyleInput } from './scaffold/blueprintSchema';
import type { StyleResolutionResult } from './scaffold/styleIntentResolver';

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
  
  // Step 35.5: Design Pack Selection State
  /** Current design pack ID */
  currentDesignPackId?: DesignPackId;
  /** Recipe ID */
  currentRecipeId?: string;
  /** Whether style picker is active */
  stylePickerActive?: boolean;

  // Scaffold Improvement Plan: Blueprint + Style
  /** Extracted app blueprint (set by extension after LLM call) */
  blueprint?: AppBlueprint;
  /** Blueprint extraction confidence (0-1) */
  blueprintConfidence?: number;
  /** Resolved style tokens (set after style intent resolution) */
  styleResolution?: StyleResolutionResult;
  /** User's style intent input (set from Style Intent UI) */
  styleInput?: StyleInput;
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
  private lastProposalPayload: Record<string, unknown> | null = null;

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
    
    // Emit scaffold_proposal_created as a progress indicator.
    // The decision card is NOT emitted here — it's emitted after blueprint
    // extraction completes (or is skipped) via emitDecisionCard().
    await this.emitScaffoldProposalCreated();
    
    this.state.lastEventAt = new Date().toISOString();
    
    return this.state;
  }
  
  /**
   * Handle user action (Proceed or Cancel)
   * 
   * @param action - The action taken by user
   * @returns Updated ScaffoldFlowState
   */
  async handleUserAction(action: 'proceed' | 'cancel'): Promise<ScaffoldFlowState> {
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
  
  /**
   * Handle style change request - show design pack picker
   * 
   * Does NOT complete the scaffold flow - keeps it in awaiting_decision state.
   * Emits scaffold_style_selection_requested event with available packs.
   * 
   * @returns Updated ScaffoldFlowState (still awaiting_decision)
   */
  async handleStyleChange(): Promise<ScaffoldFlowState> {
    if (!this.state) {
      throw new Error('No active scaffold flow');
    }
    
    if (this.state.status !== 'awaiting_decision') {
      throw new Error(`Cannot change style in status: ${this.state.status}`);
    }
    
    // Mark style picker as active
    this.state.stylePickerActive = true;
    
    // Emit scaffold_style_selection_requested event
    await this.emitStyleSelectionRequested();
    
    this.state.lastEventAt = new Date().toISOString();
    
    return this.state;
  }
  
  /**
   * Handle user selecting a design pack from the picker
   * 
   * Updates the proposal with the selected pack and returns to normal decision state.
   * 
   * @param packId - The selected design pack ID
   * @returns Updated ScaffoldFlowState
   */
  async handleStyleSelect(packId: DesignPackId): Promise<ScaffoldFlowState> {
    if (!this.state) {
      throw new Error('No active scaffold flow');
    }
    
    // Validate the pack ID
    const selectedPack = getDesignPackById(packId);
    if (!selectedPack) {
      throw new Error(`Invalid design pack ID: ${packId}`);
    }
    
    // Update state with selected pack
    this.state.currentDesignPackId = packId;
    this.state.stylePickerActive = false;
    
    // Emit scaffold_style_selected event
    await this.emitStyleSelected(selectedPack);
    
    // Re-emit proposal with updated design pack
    await this.emitScaffoldProposalCreatedWithPack(selectedPack);
    
    // Re-emit decision requested (back to normal decision state)
    await this.emitScaffoldDecisionRequested();
    
    this.state.status = 'awaiting_decision';
    this.state.lastEventAt = new Date().toISOString();
    
    return this.state;
  }
  
  /**
   * Check if style picker is currently active
   */
  isStylePickerActive(): boolean {
    return this.state?.stylePickerActive === true;
  }

  /**
   * Set the extracted blueprint on the flow state.
   * Called by the extension after LLM extraction completes.
   * Re-emits proposal with blueprint data so the webview can render
   * the Blueprint Card instead of the static preview.
   */
  async setBlueprint(result: BlueprintExtractionResult): Promise<ScaffoldFlowState> {
    if (!this.state) throw new Error('No active scaffold flow');

    this.state.blueprint = result.blueprint;
    this.state.blueprintConfidence = result.confidence;

    this.state.lastEventAt = new Date().toISOString();
    return this.state;
  }

  /**
   * Emit the decision card (scaffold_decision_requested) with current state.
   * Called by the extension ONCE after blueprint extraction completes or is skipped.
   * This is the single point where the user sees the actionable card.
   */
  async emitDecisionCard(): Promise<void> {
    if (!this.state) throw new Error('No active scaffold flow');

    // Re-compute proposal payload with any blueprint data that was set
    await this.emitScaffoldProposalCreated();
    await this.emitScaffoldDecisionRequested();

    this.state.status = 'awaiting_decision';
    this.state.lastEventAt = new Date().toISOString();
  }

  /**
   * Set the resolved style on the flow state.
   */
  setStyleResolution(resolution: StyleResolutionResult): void {
    if (!this.state) return;
    this.state.styleResolution = resolution;
  }

  /**
   * Set the user's style intent input (from Style Intent UI).
   */
  setStyleInput(input: StyleInput): void {
    if (!this.state) return;
    this.state.styleInput = input;
    console.log(`[ScaffoldFlow] Style intent set: mode=${input.mode}, value="${input.value}"`);
  }

  /**
   * Get the current style input.
   */
  getStyleInput(): StyleInput | undefined {
    return this.state?.styleInput;
  }

  /**
   * Get the current blueprint (for downstream pipeline use).
   */
  getBlueprint(): AppBlueprint | undefined {
    return this.state?.blueprint;
  }

  /**
   * Get blueprint confidence tier.
   */
  getBlueprintConfidence(): number {
    return this.state?.blueprintConfidence ?? 0;
  }

  /**
   * Extract app name from user prompt (delegates to standalone function)
   */
  private extractAppNameFromPrompt(prompt: string): string {
    return extractAppNameFromPrompt(prompt);
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
    
    // Step 35.3: Select recipe based on user prompt
    const recipeSelection = selectRecipe(this.state.userPrompt);
    
    const recipeName = configDisplayName(recipeSelection.recipe_id);
    const counts = getEstimates(recipeSelection.recipe_id);
    
    // Select a design pack for the proposal display.
    // Actual design tokens are generated by styleIntentResolver in the post-scaffold pipeline.
    const appName = this.extractAppNameFromPrompt(this.state.userPrompt);
    const seed = createHash('sha256').update(`${appName}|${recipeSelection.recipe_id}`).digest('hex');
    const seedInt = parseInt(seed.slice(0, 8), 16);
    const pack = DESIGN_PACKS[seedInt % DESIGN_PACKS.length];
    
    let summary = `Create a new ${recipeName} project with ${pack.name} design.`;
    
    // Step 37: Augment summary if references are present
    if (this.state.referenceContext) {
      const refCount = this.state.referenceContext.images.length + 
                       this.state.referenceContext.urls.length;
      summary += ` Design will be influenced by ${refCount} provided reference(s).`;
    }
    
    // Build payload - cast to any to add extra fields for UI
    const payload: Record<string, unknown> = {
      scaffold_id: this.state.scaffoldId,
      recipe: recipeName,
      recipe_id: recipeSelection.recipe_id,
      design_pack: pack.name,
      design_pack_id: pack.id,
      design_pack_name: pack.name,
      design_tokens_summary: formatTokensSummary(pack),
      files_count: counts.files,
      directories_count: counts.dirs,
      commands_to_run: ['npm install', 'npm run dev'],
      summary,
      // Step 37: Include reference context in payload for UI rendering
      reference_context: this.state.referenceContext,
      reference_mode: this.state.styleSourceMode,
      // Scaffold Improvement Plan: Include blueprint if available
      blueprint: this.state.blueprint || null,
      blueprint_confidence: this.state.blueprintConfidence ?? null,
      scope_pages: this.state.blueprint?.pages?.length ?? 0,
      scope_components: this.state.blueprint
        ? new Set(this.state.blueprint.pages.flatMap(p => p.key_components)).size
        : 0,
      scope_files: this.state.blueprint
        ? (this.state.blueprint.pages.length * 2 + 
           new Set(this.state.blueprint.pages.flatMap(p => p.key_components)).size + 
           this.state.blueprint.data_models.length + 5)
        : counts.files,
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

    // Cache proposal data for use by emitScaffoldDecisionRequested
    this.lastProposalPayload = payload;

    // Update state
    this.state.status = 'proposal_created';
    this.state.lastEventAt = event.timestamp;
  }
  
  private async emitScaffoldDecisionRequested(): Promise<void> {
    if (!this.state) return;

    const decisionOptions = buildScaffoldDecisionOptions();

    // Include proposal data so the decision card can render full proposal details + action buttons
    const proposalData = this.lastProposalPayload || {};

    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_decision_requested',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: {
        ...proposalData,
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
  
  // =========================================================================
  // STEP 35.5: Style Selection Event Emission Helpers
  // =========================================================================
  
  /**
   * Emit scaffold_style_selection_requested event
   * Shows the design pack picker to user
   */
  private async emitStyleSelectionRequested(): Promise<void> {
    if (!this.state) return;
    
    // Get available packs for the picker (6 diverse options)
    const availablePacks = getDefaultPacksForPicker();
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_style_selection_requested',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: this.state.scaffoldId,
        current_pack_id: this.state.currentDesignPackId,
        available_packs: availablePacks.map(pack => ({
          id: pack.id,
          name: pack.name,
          vibe: pack.vibe,
          primary_color: pack.tokens.colors.primary,
          background_color: pack.tokens.colors.background,
          description: pack.preview.description,
        })),
        total_available: availablePacks.length,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  /**
   * Emit scaffold_style_selected event
   * Records user's design pack choice
   */
  private async emitStyleSelected(pack: DesignPack): Promise<void> {
    if (!this.state) return;
    
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.state.runId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_style_selected',
      mode: 'PLAN' as Mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: this.state.scaffoldId,
        pack_id: pack.id,
        pack_name: pack.name,
        vibe: pack.vibe,
        primary_color: pack.tokens.colors.primary,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    
    await this.eventBus.publish(event);
  }
  
  /**
   * Emit scaffold_proposal_created with a specific design pack
   * Used when user selects a different pack from the picker
   */
  private async emitScaffoldProposalCreatedWithPack(pack: DesignPack): Promise<void> {
    if (!this.state) return;
    
    // Step 35.3: Select recipe based on user prompt (reuse existing logic)
    const recipeSelection = selectRecipe(this.state.userPrompt);
    
    const recipeName = configDisplayName(recipeSelection.recipe_id);
    const counts = getEstimates(recipeSelection.recipe_id);
    
    // Build summary with the NEW pack name
    let summary = `Create a new ${recipeName} project with ${pack.name} design.`;
    
    // Step 37: Augment summary if references are present
    if (this.state.referenceContext) {
      const refCount = this.state.referenceContext.images.length + 
                       this.state.referenceContext.urls.length;
      summary += ` Design will be influenced by ${refCount} provided reference(s).`;
    }
    
    // Build payload with the user-selected pack
    const payload: Record<string, unknown> = {
      scaffold_id: this.state.scaffoldId,
      recipe: recipeName,
      recipe_id: recipeSelection.recipe_id,
      design_pack: pack.name,
      design_pack_id: pack.id,
      design_pack_name: pack.name,
      design_tokens_summary: formatTokensSummary(pack),
      files_count: counts.files,
      directories_count: counts.dirs,
      commands_to_run: ['npm install', 'npm run dev'],
      summary,
      // Mark this as a user override
      design_pack_overridden: true,
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

    // Cache proposal data for use by emitScaffoldDecisionRequested
    this.lastProposalPayload = payload;

    // Update state
    this.state.currentRecipeId = recipeSelection.recipe_id;
    this.state.lastEventAt = event.timestamp;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract app name from user prompt (simple heuristic)
 * Exported for reuse in extension handlers (preflight, create command, post-scaffold).
 */
export function extractAppNameFromPrompt(prompt: string): string {
  // Delegate to the canonical implementation in scaffoldPreflight.ts
  // which has ordered patterns, blocklist validation, and length checks.
  return extractAppName(prompt);
}

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
      label: 'Change',
      action: 'change_style',
      description: 'Choose a different design style',
      disabled: false,
    },
  };
}

/**
 * Check if an event is a scaffold decision point
 */
export function isScaffoldDecisionPoint(event: Event): boolean {
  return (
    event.type === 'scaffold_decision_requested' ||
    (event.type === 'decision_point_needed' &&
     event.payload.decision_type === 'scaffold_approval')
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
  
  // Check for decision point (scaffold_decision_requested or legacy decision_point_needed)
  // Use reverse search to pick the latest matching event when both legacy and new types exist
  const decisionMatcher = (e: Event) =>
    (e.type === 'scaffold_decision_requested' &&
     e.payload.scaffold_id === payload.scaffold_id) ||
    (e.type === 'decision_point_needed' &&
     e.payload.decision_type === 'scaffold_approval' &&
     (e.payload.scaffold_id === payload.scaffold_id ||
      (e.payload.context as any)?.scaffold_id === payload.scaffold_id));
  const decisionEvent = [...events].reverse().find(decisionMatcher);
  
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
