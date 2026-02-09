/**
 * Event Normalizer - READ-TIME ONLY normalization layer
 * 
 * Maps raw EventType values to stable PrimitiveEventType for UI rendering.
 * CRITICAL: This is a VIEW LAYER only - never modifies stored events.
 * 
 * Design Principles:
 * - Lossless: raw event is always preserved exactly
 * - Conservative: prioritize Step 27-30 events first
 * - Safe: unknown types become unknown_event, not warning_raised
 * - Backwards compatible: legacy raw types keep working
 * 
 * @see types.ts for PrimitiveEventType and NormalizedEvent interfaces
 */

import {
  Event,
  EventType,
  NormalizedEvent,
  NormalizedScope,
  PrimitiveEventType,
  NORMALIZER_VERSION,
} from './types';

// ============================================================================
// MAPPING TABLE: Raw EventType → PrimitiveEventType + kind/code
// ============================================================================

interface NormalizationMapping {
  type: PrimitiveEventType;
  kind: string;
  code?: string;
  scope: NormalizedScope;
  ui_hint?: string;
}

/**
 * Conservative mapping table
 * 
 * PRIORITY: Map Step 27-30 events and any events NOT in MissionFeed's EVENT_CARD_MAP
 * Legacy events with existing UI cards are mapped but will render via raw.type first
 */
const NORMALIZATION_MAP: Partial<Record<EventType, NormalizationMapping>> = {
  // ========== LIFECYCLE BOUNDARIES ==========
  // These are explicit start/complete events - NOT mapped to progress_updated
  
  intent_received: {
    type: 'run_started',
    kind: 'intent',
    scope: 'run',
    ui_hint: 'intent_card'
  },
  mission_started: {
    type: 'run_started',
    kind: 'mission',
    scope: 'mission',
    ui_hint: 'mission_start_card'
  },
  autonomy_started: {
    type: 'run_started',
    kind: 'autonomy',
    scope: 'run',
    ui_hint: 'autonomy_card'
  },
  
  final: {
    type: 'run_completed',
    kind: 'final',
    scope: 'run',
    ui_hint: 'final_card'
  },
  mission_completed: {
    type: 'run_completed',
    kind: 'mission',
    scope: 'mission',
    ui_hint: 'mission_complete_card'
  },
  autonomy_completed: {
    type: 'run_completed',
    kind: 'autonomy',
    scope: 'run',
    ui_hint: 'autonomy_complete_card'
  },
  
  step_started: {
    type: 'step_started',
    kind: 'step',
    scope: 'step',
    ui_hint: 'step_card'
  },
  iteration_started: {
    type: 'step_started',
    kind: 'iteration',
    scope: 'step',
    ui_hint: 'iteration_card'
  },
  
  step_completed: {
    type: 'step_completed',
    kind: 'step',
    scope: 'step',
    ui_hint: 'step_card'
  },
  iteration_succeeded: {
    type: 'step_completed',
    kind: 'iteration',
    scope: 'step',
    ui_hint: 'iteration_card'
  },

  // ========== TOOL EXECUTION ==========
  
  tool_start: {
    type: 'tool_started',
    kind: 'generic',
    scope: 'tool',
    ui_hint: 'tool_card'
  },
  retrieval_started: {
    type: 'tool_started',
    kind: 'retrieval',
    scope: 'tool',
    ui_hint: 'retrieval_card'
  },
  test_started: {
    type: 'tool_started',
    kind: 'test',
    scope: 'tool',
    ui_hint: 'test_card'
  },
  repair_attempt_started: {
    type: 'tool_started',
    kind: 'repair',
    scope: 'tool',
    ui_hint: 'repair_card'
  },
  
  tool_end: {
    type: 'tool_completed',
    kind: 'generic',
    scope: 'tool',
    ui_hint: 'tool_card'
  },
  retrieval_completed: {
    type: 'tool_completed',
    kind: 'retrieval',
    scope: 'tool',
    ui_hint: 'retrieval_card'
  },
  test_completed: {
    type: 'tool_completed',
    kind: 'test',
    scope: 'tool',
    ui_hint: 'test_card'
  },
  repair_attempt_completed: {
    type: 'tool_completed',
    kind: 'repair',
    scope: 'tool',
    ui_hint: 'repair_card'
  },

  // ========== ARTIFACTS (plans, diffs, checkpoints) ==========
  
  plan_created: {
    type: 'artifact_proposed',
    kind: 'plan',
    scope: 'run',
    ui_hint: 'plan_card'
  },
  plan_revised: {
    type: 'artifact_proposed',
    kind: 'plan_revision',
    scope: 'run',
    ui_hint: 'plan_card'
  },
  mission_breakdown_created: {
    type: 'artifact_proposed',
    kind: 'mission_breakdown',
    scope: 'run',
    ui_hint: 'mission_breakdown_card'
  },
  diff_proposed: {
    type: 'artifact_proposed',
    kind: 'diff',
    scope: 'step',
    ui_hint: 'diff_card'
  },
  patch_plan_proposed: {
    type: 'artifact_proposed',
    kind: 'patch_plan',
    scope: 'step',
    ui_hint: 'patch_card'
  },
  
  diff_applied: {
    type: 'artifact_applied',
    kind: 'diff',
    scope: 'step',
    ui_hint: 'diff_applied_card'
  },
  checkpoint_created: {
    type: 'artifact_applied',
    kind: 'checkpoint',
    scope: 'step',
    ui_hint: 'checkpoint_card'
  },
  checkpoint_restored: {
    type: 'artifact_applied',
    kind: 'checkpoint_restore',
    scope: 'step',
    ui_hint: 'checkpoint_card'
  },
  context_snapshot_created: {
    type: 'artifact_applied',
    kind: 'context_snapshot',
    scope: 'step',
    ui_hint: 'snapshot_card'
  },

  // ========== DECISION POINTS (approvals, clarifications) ==========
  
  approval_requested: {
    type: 'decision_point_needed',
    kind: 'approval',
    scope: 'step',
    ui_hint: 'approval_card'
  },
  clarification_requested: {
    type: 'decision_point_needed',
    kind: 'clarification',
    scope: 'run',
    ui_hint: 'clarification_card'
  },
  clarification_presented: {
    type: 'decision_point_needed',
    kind: 'clarification_options',
    scope: 'run',
    ui_hint: 'clarification_card'
  },
  scope_expansion_requested: {
    type: 'decision_point_needed',
    kind: 'scope_expansion',
    scope: 'step',
    ui_hint: 'scope_card'
  },
  decision_point_needed: {
    type: 'decision_point_needed',
    kind: 'generic',
    scope: 'step',
    ui_hint: 'decision_card'
  },
  
  approval_resolved: {
    type: 'user_action_taken',
    kind: 'approval',
    scope: 'step',
    ui_hint: 'approval_card'
  },
  clarification_received: {
    type: 'user_action_taken',
    kind: 'clarification',
    scope: 'run',
    ui_hint: 'clarification_card'
  },
  scope_expansion_resolved: {
    type: 'user_action_taken',
    kind: 'scope_expansion',
    scope: 'step',
    ui_hint: 'scope_card'
  },
  mission_selected: {
    type: 'user_action_taken',
    kind: 'mission_selection',
    scope: 'run',
    ui_hint: 'mission_card'
  },

  // ========== PROGRESS UPDATES (incremental only, NOT lifecycle) ==========
  
  context_collected: {
    type: 'progress_updated',
    kind: 'context',
    scope: 'step',
    ui_hint: 'context_card'
  },
  stream_delta: {
    type: 'progress_updated',
    kind: 'stream',
    scope: 'step',
    ui_hint: 'stream_card'
  },
  stream_complete: {
    type: 'progress_updated',
    kind: 'stream_complete',
    scope: 'step',
    ui_hint: 'stream_card'
  },
  prompt_assessed: {
    type: 'progress_updated',
    kind: 'prompt_assessment',
    scope: 'run',
    ui_hint: 'prompt_card'
  },
  prompt_rewritten: {
    type: 'progress_updated',
    kind: 'prompt_rewrite',
    scope: 'run',
    ui_hint: 'prompt_card'
  },
  
  // Step 30: Truncation-Safe events (progress tracking)
  preflight_complete: {
    type: 'progress_updated',
    kind: 'preflight',
    scope: 'step',
    ui_hint: 'preflight_card'
  },
  edit_chunk_started: {
    type: 'progress_updated',
    kind: 'edit_chunk_start',
    scope: 'step',
    ui_hint: 'chunk_card'
  },
  edit_chunk_completed: {
    type: 'progress_updated',
    kind: 'edit_chunk_complete',
    scope: 'step',
    ui_hint: 'chunk_card'
  },
  edit_split_triggered: {
    type: 'progress_updated',
    kind: 'edit_split',
    scope: 'step',
    ui_hint: 'split_card'
  },
  run_scope_initialized: {
    type: 'progress_updated',
    kind: 'scope_init',
    scope: 'run',
    ui_hint: 'scope_card'
  },
  repair_policy_snapshot: {
    type: 'progress_updated',
    kind: 'repair_policy',
    scope: 'run',
    ui_hint: 'policy_card'
  },

  // ========== STATE CHANGES (mode, stage, pause/resume) ==========
  // These MUST include from/to in the normalized output
  
  mode_set: {
    type: 'state_changed',
    kind: 'mode',
    scope: 'run',
    ui_hint: 'mode_card'
  },
  stage_changed: {
    type: 'state_changed',
    kind: 'stage',
    scope: 'step',
    ui_hint: 'stage_card'
  },
  execution_paused: {
    type: 'state_changed',
    kind: 'pause',
    scope: 'run',
    ui_hint: 'pause_card'
  },
  execution_resumed: {
    type: 'state_changed',
    kind: 'resume',
    scope: 'run',
    ui_hint: 'resume_card'
  },
  execution_stopped: {
    type: 'state_changed',
    kind: 'stop',
    scope: 'run',
    ui_hint: 'stop_card'
  },
  mission_paused: {
    type: 'state_changed',
    kind: 'mission_pause',
    scope: 'mission',
    ui_hint: 'pause_card'
  },
  mission_cancelled: {
    type: 'state_changed',
    kind: 'mission_cancel',
    scope: 'mission',
    ui_hint: 'cancel_card'
  },
  repair_attempted: {
    type: 'state_changed',
    kind: 'repair_loop',
    scope: 'step',
    ui_hint: 'repair_card'
  },
  edit_step_paused: {
    type: 'state_changed',
    kind: 'edit_pause',
    scope: 'step',
    ui_hint: 'pause_card'
  },

  // ========== WARNINGS ==========
  
  mode_violation: {
    type: 'warning_raised',
    kind: 'mode_violation',
    code: 'MODE_VIOLATION',
    scope: 'step',
    ui_hint: 'warning_card'
  },
  plan_deviation_detected: {
    type: 'warning_raised',
    kind: 'plan_deviation',
    code: 'PLAN_DEVIATION',
    scope: 'step',
    ui_hint: 'warning_card'
  },
  stale_context_detected: {
    type: 'warning_raised',
    kind: 'stale_context',
    code: 'STALE_CONTEXT',
    scope: 'step',
    ui_hint: 'warning_card'
  },
  plan_large_detected: {
    type: 'warning_raised',
    kind: 'plan_size',
    code: 'PLAN_LARGE_DETECTED',
    scope: 'run',
    ui_hint: 'warning_card'
  },
  truncation_detected: {
    type: 'warning_raised',
    kind: 'truncation',
    code: 'TRUNCATED_OUTPUT_RECOVERED',
    scope: 'step',
    ui_hint: 'truncation_card'
  },
  model_fallback_used: {
    type: 'warning_raised',
    kind: 'model_fallback',
    code: 'MODEL_FALLBACK',
    scope: 'tool',
    ui_hint: 'warning_card'
  },
  stage_timeout: {
    type: 'warning_raised',
    kind: 'timeout',
    code: 'STAGE_TIMEOUT',
    scope: 'step',
    ui_hint: 'warning_card'
  },
  budget_exhausted: {
    type: 'warning_raised',
    kind: 'budget',
    code: 'BUDGET_EXHAUSTED',
    scope: 'run',
    ui_hint: 'warning_card'
  },
  autonomy_halted: {
    type: 'warning_raised',
    kind: 'autonomy_halt',
    code: 'AUTONOMY_HALTED',
    scope: 'run',
    ui_hint: 'warning_card'
  },

  // ========== ERRORS ==========
  
  failure_detected: {
    type: 'error_raised',
    kind: 'generic',
    code: 'FAILURE',
    scope: 'step',
    ui_hint: 'error_card'
  },
  step_failed: {
    type: 'error_raised',
    kind: 'step',
    code: 'STEP_FAILED',
    scope: 'step',
    ui_hint: 'error_card'
  },
  retrieval_failed: {
    type: 'error_raised',
    kind: 'retrieval',
    code: 'RETRIEVAL_FAILED',
    scope: 'tool',
    ui_hint: 'error_card'
  },
  test_failed: {
    type: 'error_raised',
    kind: 'test',
    code: 'TEST_FAILED',
    scope: 'tool',
    ui_hint: 'error_card'
  },
  iteration_failed: {
    type: 'error_raised',
    kind: 'iteration',
    code: 'ITERATION_FAILED',
    scope: 'step',
    ui_hint: 'error_card'
  },
  repeated_failure_detected: {
    type: 'error_raised',
    kind: 'repeated_failure',
    code: 'REPEATED_FAILURE',
    scope: 'step',
    ui_hint: 'error_card'
  },
  failure_classified: {
    type: 'error_raised',
    kind: 'classified',
    code: 'FAILURE_CLASSIFIED',
    scope: 'step',
    ui_hint: 'error_card'
  },
  edit_chunk_failed: {
    type: 'error_raised',
    kind: 'edit_chunk',
    code: 'EDIT_CHUNK_FAILED',
    scope: 'step',
    ui_hint: 'error_card'
  },

  // ========== STEP 34: VERIFY + REPAIR ==========
  
  verify_started: {
    type: 'state_changed',
    kind: 'verify',
    scope: 'step',
    ui_hint: 'verify_card'
  },
  verify_completed: {
    type: 'state_changed',
    kind: 'verify',
    scope: 'step',
    ui_hint: 'verify_card'
  },
  verify_proposed: {
    type: 'decision_point_needed',
    kind: 'verify',
    scope: 'step',
    ui_hint: 'verify_card'
  },
  verify_skipped: {
    type: 'progress_updated',
    kind: 'verify_skipped',
    scope: 'step',
    ui_hint: 'verify_card'
  },
  command_started: {
    type: 'tool_started',
    kind: 'command',
    scope: 'tool',
    ui_hint: 'command_card'
  },
  command_completed: {
    type: 'tool_completed',
    kind: 'command',
    scope: 'tool',
    ui_hint: 'command_card'
  },

  // ========== STEP 34.5: Command Execution Phase ==========
  
  command_proposed: {
    type: 'decision_point_needed',
    kind: 'command_approval',
    scope: 'tool',
    ui_hint: 'command_proposed_card'
  },
  command_skipped: {
    type: 'progress_updated',
    kind: 'command_skipped',
    scope: 'tool',
    ui_hint: 'command_skipped_card'
  },
  command_progress: {
    type: 'progress_updated',
    kind: 'command_progress',
    scope: 'tool',
    ui_hint: 'command_progress_card'
  },

  // ========== STEP 35: Greenfield Scaffold Flow ==========
  
  scaffold_started: {
    type: 'run_started',
    kind: 'scaffold',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  scaffold_proposal_created: {
    type: 'artifact_proposed',
    kind: 'scaffold_proposal',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  scaffold_applied: {
    type: 'artifact_applied',
    kind: 'scaffold',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  scaffold_completed: {
    type: 'run_completed',
    kind: 'scaffold',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },

  // ========== STEP 35.2: Scaffold Preflight Safety ==========
  
  scaffold_preflight_started: {
    type: 'step_started',
    kind: 'scaffold_preflight',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  scaffold_preflight_completed: {
    type: 'step_completed',
    kind: 'scaffold_preflight',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  scaffold_target_chosen: {
    type: 'progress_updated',
    kind: 'scaffold_target',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  scaffold_blocked: {
    type: 'warning_raised',
    kind: 'scaffold_blocked',
    code: 'SCAFFOLD_BLOCKED',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },

  // ========== STEP 35.4: Scaffold Apply ==========
  
  scaffold_apply_started: {
    type: 'step_started',
    kind: 'scaffold_apply',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  scaffold_conflict_detected: {
    type: 'decision_point_needed',
    kind: 'scaffold_conflict',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  scaffold_apply_failed: {
    type: 'error_raised',
    kind: 'scaffold_apply',
    code: 'SCAFFOLD_APPLY_FAILED',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },

  // ========== STEP 35.5: Design Pack System ==========
  
  design_pack_selected: {
    type: 'progress_updated',
    kind: 'design_pack_selection',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },
  design_pack_picker_opened: {
    type: 'decision_point_needed',
    kind: 'design_pack_picker',
    scope: 'ui',
    ui_hint: 'design_pack_picker_card'
  },
  design_pack_overridden: {
    type: 'user_action_taken',
    kind: 'design_pack_override',
    scope: 'run',
    ui_hint: 'scaffold_card'
  },

  // ========== STEP 35.6: Post-Scaffold Next Steps ==========

  next_steps_shown: {
    type: 'progress_updated',
    kind: 'next_steps',
    scope: 'run',
    ui_hint: 'next_steps_card'
  },
  next_step_selected: {
    type: 'user_action_taken',
    kind: 'next_step_selection',
    scope: 'run',
    ui_hint: 'next_steps_card'
  },
  next_step_dismissed: {
    type: 'user_action_taken',
    kind: 'next_step_dismiss',
    scope: 'run',
    ui_hint: 'next_steps_card'
  },

  // ========== STEP 35.7: Non-Empty Directory + Monorepo Targeting ==========

  scaffold_preflight_decision_needed: {
    type: 'decision_point_needed',
    kind: 'scaffold_preflight',
    scope: 'run',
    ui_hint: 'preflight_decision_card'
  },
  scaffold_preflight_decision_taken: {
    type: 'user_action_taken',
    kind: 'scaffold_preflight_decision',
    scope: 'run',
    ui_hint: 'preflight_decision_card'
  },
  scaffold_write_blocked: {
    type: 'error_raised',
    kind: 'scaffold_write_safety',
    code: 'SCAFFOLD_WRITE_BLOCKED',
    scope: 'run',
    ui_hint: 'scaffold_error_card'
  },

  // VNext: Project Memory (V2-V5)
  // Migration note: Runs before VNext won't have these events.
  memory_facts_updated: {
    type: 'state_changed',
    kind: 'memory_facts',
    scope: 'run',
    ui_hint: 'memory_facts_card'
  },
  solution_captured: {
    type: 'artifact_proposed',
    kind: 'proven_solution',
    scope: 'run',
    ui_hint: 'solution_captured_card'
  },

  // VNext: Generated Tools (V6-V8)
  generated_tool_proposed: {
    type: 'artifact_proposed',
    kind: 'generated_tool',
    scope: 'run',
    ui_hint: 'tool_proposal_card'
  },
  generated_tool_saved: {
    type: 'artifact_applied',
    kind: 'generated_tool',
    scope: 'run',
    ui_hint: 'tool_saved_card'
  },
  generated_tool_run_started: {
    type: 'tool_started',
    kind: 'generated_tool_run',
    scope: 'step',
    ui_hint: 'tool_run_card'
  },
  generated_tool_run_completed: {
    type: 'tool_completed',
    kind: 'generated_tool_run',
    scope: 'step',
    ui_hint: 'tool_run_card'
  },
  generated_tool_run_failed: {
    type: 'error_raised',
    kind: 'generated_tool_run',
    code: 'TOOL_RUN_FAILED',
    scope: 'step',
    ui_hint: 'tool_run_card'
  },

  // VNext: Agent Mode Policy (V9)
  mode_changed: {
    type: 'state_changed',
    kind: 'mode_transition',
    scope: 'run',
    ui_hint: 'mode_changed_card'
  },
};

// ============================================================================
// NORMALIZER FUNCTION
// ============================================================================

/**
 * Normalize a raw event for UI rendering
 * 
 * CRITICAL: This is READ-TIME ONLY. The raw event is NEVER modified.
 * 
 * @param raw - The original stored event
 * @returns NormalizedEvent with both raw (untouched) and normalized (derived) data
 */
export function normalizeEvent(raw: Event): NormalizedEvent {
  const mapping = NORMALIZATION_MAP[raw.type];
  
  // If no mapping exists, use unknown_event (NOT warning_raised)
  if (!mapping) {
    return {
      raw,
      normalized: {
        type: 'unknown_event',
        kind: raw.type, // Preserve the unknown type as kind for debugging
        scope: 'step',
        details: { ...raw.payload },
        ui_hint: 'generic_card'
      },
      normalizer_version: NORMALIZER_VERSION
    };
  }
  
  // Build normalized representation
  const normalized: NormalizedEvent['normalized'] = {
    type: mapping.type,
    kind: mapping.kind,
    scope: mapping.scope,
    details: { ...raw.payload },
  };
  
  // Add code if present in mapping
  if (mapping.code) {
    normalized.code = mapping.code;
  }
  
  // Add ui_hint if present
  if (mapping.ui_hint) {
    normalized.ui_hint = mapping.ui_hint;
  }
  
  // Special handling for state_changed: extract from/to
  if (mapping.type === 'state_changed') {
    normalized.from = extractStateFrom(raw);
    normalized.to = extractStateTo(raw);
  }
  
  // Special handling for truncation: check if recovered or fatal
  if (raw.type === 'truncation_detected') {
    const recovered = raw.payload.recovered as boolean;
    if (!recovered) {
      normalized.code = 'TRUNCATED_OUTPUT_FATAL';
      // Upgrade to error_raised if fatal
      normalized.type = 'error_raised';
    }
  }
  
  return {
    raw,
    normalized,
    normalizer_version: NORMALIZER_VERSION
  };
}

/**
 * Extract the "from" state for state_changed events
 */
function extractStateFrom(event: Event): string {
  // Try common payload patterns
  if (event.payload.from !== undefined) {
    return String(event.payload.from);
  }
  if (event.payload.previous_mode !== undefined) {
    return String(event.payload.previous_mode);
  }
  if (event.payload.previous_stage !== undefined) {
    return String(event.payload.previous_stage);
  }
  if (event.payload.previous_state !== undefined) {
    return String(event.payload.previous_state);
  }
  // Default for pause/resume/stop
  if (event.type === 'execution_paused') return 'running';
  if (event.type === 'execution_resumed') return 'paused';
  if (event.type === 'execution_stopped') return 'running';
  if (event.type === 'mission_paused') return 'running';
  if (event.type === 'mission_cancelled') return 'running';
  if (event.type === 'edit_step_paused') return 'executing';
  
  return 'unknown';
}

/**
 * Extract the "to" state for state_changed events
 */
function extractStateTo(event: Event): string {
  // Try common payload patterns
  if (event.payload.to !== undefined) {
    return String(event.payload.to);
  }
  if (event.payload.mode !== undefined) {
    return String(event.payload.mode);
  }
  if (event.payload.stage !== undefined) {
    return String(event.payload.stage);
  }
  if (event.payload.new_state !== undefined) {
    return String(event.payload.new_state);
  }
  // Default for pause/resume/stop
  if (event.type === 'execution_paused') return 'paused';
  if (event.type === 'execution_resumed') return 'running';
  if (event.type === 'execution_stopped') return 'stopped';
  if (event.type === 'mission_paused') return 'paused';
  if (event.type === 'mission_cancelled') return 'cancelled';
  if (event.type === 'edit_step_paused') return 'paused';
  
  return 'unknown';
}

/**
 * Normalize an array of events
 * 
 * @param events - Array of raw events
 * @returns Array of NormalizedEvent objects
 */
export function normalizeEvents(events: Event[]): NormalizedEvent[] {
  return events.map(normalizeEvent);
}

/**
 * Check if a raw event type has a known mapping
 * Useful for deciding whether to use legacy or normalized rendering
 */
export function hasNormalizationMapping(eventType: EventType): boolean {
  return eventType in NORMALIZATION_MAP;
}

/**
 * Get the primitive type for a raw event type (without full normalization)
 * Returns undefined if no mapping exists
 */
export function getPrimitiveType(eventType: EventType): PrimitiveEventType | undefined {
  return NORMALIZATION_MAP[eventType]?.type;
}
