/**
 * Canonical event types and data structures for Ordinex event-sourcing core.
 * Based on 03_API_DATA_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 */

// Canonical Event Types (Authoritative - must reject unknown types)
export type EventType =
  // Core Lifecycle
  | 'intent_received'
  | 'mode_set'
  | 'plan_created'
  | 'plan_revised'
  | 'plan_large_detected'
  | 'mission_breakdown_created'
  | 'mission_selected'
  | 'mission_started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'stage_changed'
  | 'final'
  // Retrieval
  | 'retrieval_started'
  | 'retrieval_completed'
  | 'retrieval_failed'
  // Tool Execution
  | 'tool_start'
  | 'tool_end'
  // Approval
  | 'approval_requested'
  | 'approval_resolved'
  // Diff / Edit
  | 'diff_proposed'
  | 'diff_applied'
  // Checkpoint
  | 'checkpoint_created'
  | 'checkpoint_restored'
  // Error / Control
  | 'failure_detected'
  | 'execution_paused'
  | 'execution_resumed'
  | 'execution_stopped'
  | 'mode_violation'
  // Scope Control
  | 'scope_expansion_requested'
  | 'scope_expansion_resolved'
  // Plan Integrity / Routing
  | 'plan_deviation_detected'
  | 'model_fallback_used'
  // Autonomy (A1)
  | 'autonomy_started'
  | 'iteration_started'
  | 'repair_attempted'
  | 'iteration_failed'
  | 'iteration_succeeded'
  | 'budget_exhausted'
  | 'autonomy_halted'
  | 'autonomy_completed'
  // ANSWER Mode
  | 'context_collected'
  | 'stream_delta'
  | 'stream_complete'
  // Prompt Quality Gate (PLAN mode)
  | 'prompt_assessed'
  | 'prompt_rewritten'
  | 'clarification_requested'
  | 'clarification_presented'
  | 'clarification_received'
  // Step 27: Mission Execution Harness
  | 'stale_context_detected'
  | 'stage_timeout'
  | 'repair_attempt_started'
  | 'repair_attempt_completed'
  | 'repeated_failure_detected'
  | 'test_started'
  | 'test_completed'
  | 'test_failed'
  | 'mission_completed'
  | 'mission_paused'
  | 'mission_cancelled'
  | 'patch_plan_proposed'
  | 'context_snapshot_created'
  // Step 28: Self-Correction Loop
  | 'failure_classified'
  | 'decision_point_needed'
  // Step 29: Systems Tab (Replay-safe operational truth)
  | 'run_scope_initialized'
  | 'repair_policy_snapshot'
  // Step 30+: Truncation-Safe Edit Execution
  | 'preflight_complete'
  | 'truncation_detected'
  | 'edit_split_triggered'
  | 'edit_chunk_started'
  | 'edit_chunk_completed'
  | 'edit_chunk_failed'
  | 'edit_step_paused'
  // Step 34: Auto-Verify + Repair
  | 'verify_started'
  | 'verify_completed'
  | 'verify_proposed'
  | 'verify_skipped'
  | 'command_started'
  | 'command_completed'
  // Step 34.5: Command Execution Phase
  | 'command_proposed'
  | 'command_skipped'
  | 'command_progress'
  // Step 35: Greenfield Scaffold Flow
  | 'scaffold_started'
  | 'scaffold_clarification_needed'
  | 'scaffold_clarification_answered'
  | 'scaffold_proposal_created'
  | 'scaffold_decision_requested'
  | 'scaffold_decision_resolved'
  | 'scaffold_applied'
  | 'scaffold_completed'
  | 'scaffold_style_selection_requested'
  | 'scaffold_style_selected'
  | 'scaffold_next_steps_ready'
  // Step 35.2: Scaffold Preflight Safety
  | 'scaffold_preflight_started'
  | 'scaffold_preflight_completed'
  | 'scaffold_target_chosen'
  | 'scaffold_blocked'
  // Step 35.4: Scaffold Apply
  | 'scaffold_apply_started'
  | 'scaffold_conflict_detected'
  | 'scaffold_apply_failed'
  // Step 35.5: Design Pack System
  | 'design_pack_selected'
  | 'design_pack_picker_opened'
  | 'design_pack_overridden'
  // Step 35.6: Post-Scaffold Next Steps
  | 'next_steps_shown'
  | 'next_step_selected'
  | 'next_step_dismissed'
  // Post-Scaffold Orchestration (after terminal command completes)
  | 'scaffold_progress'
  | 'design_pack_applied'
  | 'scaffold_final_complete'
  // Step 35.7: Non-Empty Directory + Monorepo Targeting
  | 'scaffold_preflight_decision_needed'
  | 'scaffold_preflight_decision_taken'
  | 'scaffold_write_blocked'
  // Step 37: Reference-Based Enhancements
  | 'reference_attached'
  | 'reference_context_built'
  | 'reference_used'
  // Step 38: Vision + URL Reference Token Extraction
  | 'vision_analysis_started'
  | 'vision_analysis_completed'
  | 'reference_tokens_extracted'
  | 'reference_tokens_used'
  // Step 40: Production-Grade Intent Routing
  | 'intent_routed'
  // Step 40.5: Intelligence Layer
  | 'context_enriched'
  | 'clarification_asked'
  | 'out_of_scope_detected'
  | 'reference_resolved'
  // Step 41: Dev Server Lifecycle
  | 'process_started'
  | 'process_ready'
  | 'process_output'
  | 'process_stopped'
  | 'process_failed'
  // Step 43: Scaffold Quality Gates (Preflight Checks + Resolutions + Safe Apply)
  | 'scaffold_preflight_checks_started'
  | 'scaffold_preflight_checks_completed'
  | 'scaffold_preflight_resolution_selected'
  | 'scaffold_quality_gates_passed'
  | 'scaffold_quality_gates_failed'
  | 'scaffold_checkpoint_created'
  | 'scaffold_checkpoint_restored'
  | 'scaffold_apply_completed'
  // Step 44: Post-Scaffold Verification Pipeline
  | 'scaffold_verify_started'
  | 'scaffold_verify_step_completed'
  | 'scaffold_verify_completed'
  // Step 45: Settings Panel
  | 'settings_changed'
  // Scaffold Feature Intelligence (LLM-Powered Feature Generation)
  | 'feature_extraction_started'
  | 'feature_extraction_completed'
  | 'feature_code_generating'
  | 'feature_code_applied'
  | 'feature_code_error'
  // VNext: Project Memory (V2-V5)
  | 'memory_facts_updated'
  | 'solution_captured'
  // VNext: Generated Tools (V6-V8)
  | 'generated_tool_proposed'
  | 'generated_tool_saved'
  | 'generated_tool_run_started'
  | 'generated_tool_run_completed'
  | 'generated_tool_run_failed'
  // VNext: Agent Mode Policy (V9)
  | 'mode_changed'
  // W3: Autonomy Loop Detection
  | 'autonomy_loop_detected'
  | 'autonomy_downgraded';

export const CANONICAL_EVENT_TYPES: readonly EventType[] = [
  'intent_received',
  'mode_set',
  'plan_created',
  'plan_revised',
  'plan_large_detected',
  'mission_breakdown_created',
  'mission_selected',
  'mission_started',
  'step_started',
  'step_completed',
  'step_failed',
  'stage_changed',
  'final',
  'retrieval_started',
  'retrieval_completed',
  'retrieval_failed',
  'tool_start',
  'tool_end',
  'approval_requested',
  'approval_resolved',
  'diff_proposed',
  'diff_applied',
  'checkpoint_created',
  'checkpoint_restored',
  'failure_detected',
  'execution_paused',
  'execution_resumed',
  'execution_stopped',
  'mode_violation',
  'scope_expansion_requested',
  'scope_expansion_resolved',
  'plan_deviation_detected',
  'model_fallback_used',
  'autonomy_started',
  'iteration_started',
  'repair_attempted',
  'iteration_failed',
  'iteration_succeeded',
  'budget_exhausted',
  'autonomy_halted',
  'autonomy_completed',
  'context_collected',
  'stream_delta',
  'stream_complete',
  'prompt_assessed',
  'prompt_rewritten',
  'clarification_requested',
  'clarification_presented',
  'clarification_received',
  // Step 27: Mission Execution Harness
  'stale_context_detected',
  'stage_timeout',
  'repair_attempt_started',
  'repair_attempt_completed',
  'repeated_failure_detected',
  'test_started',
  'test_completed',
  'test_failed',
  'mission_completed',
  'mission_paused',
  'mission_cancelled',
  'patch_plan_proposed',
  'context_snapshot_created',
  // Step 28: Self-Correction Loop
  'failure_classified',
  'decision_point_needed',
  // Step 29: Systems Tab (Replay-safe operational truth)
  'run_scope_initialized',
  'repair_policy_snapshot',
  // Step 30+: Truncation-Safe Edit Execution
  'preflight_complete',
  'truncation_detected',
  'edit_split_triggered',
  'edit_chunk_started',
  'edit_chunk_completed',
  'edit_chunk_failed',
  'edit_step_paused',
  // Step 34: Auto-Verify + Repair
  'verify_started',
  'verify_completed',
  'verify_proposed',
  'verify_skipped',
  'command_started',
  'command_completed',
  // Step 34.5: Command Execution Phase
  'command_proposed',
  'command_skipped',
  'command_progress',
  // Step 35: Greenfield Scaffold Flow
  'scaffold_started',
  'scaffold_clarification_needed',
  'scaffold_clarification_answered',
  'scaffold_proposal_created',
  'scaffold_decision_requested',
  'scaffold_decision_resolved',
  'scaffold_applied',
  'scaffold_completed',
  'scaffold_style_selection_requested',
  'scaffold_style_selected',
  'scaffold_next_steps_ready',
  // Step 35.2: Scaffold Preflight Safety
  'scaffold_preflight_started',
  'scaffold_preflight_completed',
  'scaffold_target_chosen',
  'scaffold_blocked',
  // Step 35.4: Scaffold Apply
  'scaffold_apply_started',
  'scaffold_conflict_detected',
  'scaffold_apply_failed',
  // Step 35.5: Design Pack System
  'design_pack_selected',
  'design_pack_picker_opened',
  'design_pack_overridden',
  // Step 35.6: Post-Scaffold Next Steps
  'next_steps_shown',
  'next_step_selected',
  'next_step_dismissed',
  // Post-Scaffold Orchestration (after terminal command completes)
  'scaffold_progress',
  'design_pack_applied',
  'scaffold_final_complete',
  // Step 35.7: Non-Empty Directory + Monorepo Targeting
  'scaffold_preflight_decision_needed',
  'scaffold_preflight_decision_taken',
  'scaffold_write_blocked',
  // Step 37: Reference-Based Enhancements
  'reference_attached',
  'reference_context_built',
  'reference_used',
  // Step 38: Vision + URL Reference Token Extraction
  'vision_analysis_started',
  'vision_analysis_completed',
  'reference_tokens_extracted',
  'reference_tokens_used',
  // Step 40: Production-Grade Intent Routing
  'intent_routed',
  // Step 40.5: Intelligence Layer
  'context_enriched',
  'clarification_asked',
  'out_of_scope_detected',
  'reference_resolved',
  // Step 41: Dev Server Lifecycle
  'process_started',
  'process_ready',
  'process_output',
  'process_stopped',
  'process_failed',
  // Step 43: Scaffold Quality Gates
  'scaffold_preflight_checks_started',
  'scaffold_preflight_checks_completed',
  'scaffold_preflight_resolution_selected',
  'scaffold_quality_gates_passed',
  'scaffold_quality_gates_failed',
  'scaffold_checkpoint_created',
  'scaffold_checkpoint_restored',
  'scaffold_apply_completed',
  // Step 44: Post-Scaffold Verification Pipeline
  'scaffold_verify_started',
  'scaffold_verify_step_completed',
  'scaffold_verify_completed',
  // Step 45: Settings Panel
  'settings_changed',
  // Scaffold Feature Intelligence (LLM-Powered Feature Generation)
  'feature_extraction_started',
  'feature_extraction_completed',
  'feature_code_generating',
  'feature_code_applied',
  'feature_code_error',
  // VNext: Project Memory (V2-V5)
  // Migration note: Runs created before VNext won't have these events.
  // UI and normalizer must tolerate their absence.
  'memory_facts_updated',
  'solution_captured',
  // VNext: Generated Tools (V6-V8)
  'generated_tool_proposed',
  'generated_tool_saved',
  'generated_tool_run_started',
  'generated_tool_run_completed',
  'generated_tool_run_failed',
  // VNext: Agent Mode Policy (V9)
  'mode_changed',
  // W3: Autonomy Loop Detection
  'autonomy_loop_detected',
  'autonomy_downgraded',
] as const;

export type Mode = 'ANSWER' | 'PLAN' | 'MISSION';

/**
 * Step 33: Behavior Types (Pre-execution intelligence layer)
 * 
 * Behavior is selected FIRST, Mode is a downstream consequence.
 * This prevents forcing all interactions into PLAN/MISSION while preserving safety.
 */
export type Behavior = 'ANSWER' | 'CLARIFY' | 'QUICK_ACTION' | 'PLAN' | 'CONTINUE_RUN';

/**
 * Context source type for intent analysis
 */
export type ContextSourceType = 'fresh' | 'follow_up' | 'explicit_reference';

/**
 * Context source tracking
 */
export interface ContextSource {
  type: ContextSourceType;
  files?: string[];
  previous_task_id?: string;
}

/**
 * Clarification option for UI action buttons
 */
export interface ClarificationOption {
  label: string;
  action: 'provide_file' | 'provide_scope' | 'confirm_intent' | 'cancel';
  value?: string;
}

/**
 * Clarification request (when CLARIFY behavior is selected)
 */
export interface ClarificationRequest {
  question: string;
  options: ClarificationOption[];
}

/**
 * Intent Analysis Result (Core of Step 33)
 * 
 * This is the output contract of the Intent Analyzer.
 * Behavior is primary; mode is derived downstream.
 */
export interface IntentAnalysis {
  /** Selected behavior (primary decision) */
  behavior: Behavior;
  
  /** Context source information */
  context_source: ContextSource;
  
  /** Clarification request (only if behavior === 'CLARIFY') */
  clarification?: ClarificationRequest;
  
  /** Confidence score 0-1 */
  confidence: number;
  
  /** Human-readable reasoning */
  reasoning: string;
  
  /** Derived mode (downstream of behavior) */
  derived_mode: Mode;
  
  /** Detected scope (for QUICK_ACTION vs PLAN decision) */
  detected_scope?: 'trivial' | 'small' | 'medium' | 'large';
  
  /** Files referenced or detected */
  referenced_files?: string[];
  
  /** Whether user override was used */
  user_override?: string;
  
  // =========================================================================
  // Step 37: Reference Modifier Fields (NOT a new behavior)
  // These are modifiers that SCAFFOLD/QUICK_ACTION/PLAN read downstream
  // =========================================================================
  
  /** Whether user provided image/URL references (Step 37) */
  has_references?: boolean;
  
  /** Detected intent for reference usage (Step 37) */
  reference_intent?: ReferenceIntent;
  
  /** User's selected mode for how references influence output (Step 37) */
  reference_mode?: StyleSourceMode;
}

/**
 * Active run status (for CONTINUE_RUN behavior)
 */
export interface ActiveRunStatus {
  task_id: string;
  mission_id?: string;
  stage: string;
  status: 'running' | 'paused' | 'awaiting_approval';
  started_at: string;
  last_event_at: string;
}

/**
 * Continue run options
 */
export interface ContinueRunOptions {
  resume: boolean;
  pause: boolean;
  abort: boolean;
  propose_fix: boolean;
}

/**
 * Scope detection result
 */
export interface ScopeDetectionResult {
  scope: 'trivial' | 'small' | 'medium' | 'large';
  confidence: number;
  reasons: string[];
  metrics: {
    estimated_files: number;
    complexity_score: number;
    has_dependencies: boolean;
  };
}

/**
 * Reference resolution result
 */
export interface ReferenceResolution {
  resolved: boolean;
  source?: 'last_applied_diff' | 'last_open_editor' | 'last_artifact_proposed';
  files?: string[];
  context?: string;
}

export type Stage = 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'command' | 'none';

/**
 * Mode Classification V2 - Reason tags for transparency
 */
export type ReasonTag = 
  | 'question_form'
  | 'action_verbs'
  | 'planning_terms'
  | 'file_reference'
  | 'error_reference'
  | 'conversational_action';

/**
 * Mode Classification V2 - Rich classification result
 */
export interface ClassificationResultV2 {
  suggestedMode: Mode;
  confidence: 'high' | 'medium' | 'low';
  reasonTags: ReasonTag[];
  scores: { answer: number; plan: number; mission: number };
  reasonSignature: string; // Stable signature for caching: "tag1,tag2→MODE"
}

export type TaskStatus = 'idle' | 'running' | 'paused' | 'error' | 'complete';

/**
 * Canonical event shape as defined in 03_API_DATA_SPEC.md
 */
export interface Event {
  event_id: string;
  task_id: string;
  timestamp: string; // ISO-8601
  type: EventType;
  mode: Mode;
  stage: Stage;
  payload: Record<string, unknown>;
  evidence_ids: string[];
  parent_event_id: string | null;
}

/**
 * Scope dimensions as defined in 01_UI_UX_SPEC.md Section 8.2
 */
export interface ScopeContract {
  max_files: number;
  max_lines: number;
  allowed_tools: ToolCategory[];
  budgets: {
    max_iterations: number;
    max_tool_calls: number;
    max_time_ms: number;
  };
}

export type ToolCategory = 'read' | 'exec' | 'write';

/**
 * Scope summary model derived from events
 * Tracks what is allowed vs what has been touched
 */
export interface ScopeSummary {
  contract: ScopeContract;
  in_scope_files: string[];
  touched_files: TouchedFile[];
  lines_retrieved: number;
  tools_used: ToolCategory[];
}

/**
 * Touched file record (append-only history)
 */
export interface TouchedFile {
  path: string;
  operations: Array<{
    type: 'read' | 'write' | 'execute';
    timestamp: string;
    event_id: string;
    line_range?: { start: number; end: number };
  }>;
}

/**
 * Scope expansion request payload
 */
export interface ScopeExpansionRequest {
  requested: {
    files?: string[];
    lines?: number;
    tools?: ToolCategory[];
    budgets?: Partial<ScopeContract['budgets']>;
  };
  reason: string;
  impact_level: 'low' | 'medium' | 'high';
}

/**
 * Task state schema as defined in 03_API_DATA_SPEC.md
 */
export interface TaskState {
  task_id: string;
  mode: Mode;
  status: TaskStatus;
  stage: Stage;
  iteration: {
    current: number;
    max: number;
  };
  budgets: {
    time_remaining_ms: number;
    tool_calls_remaining: number;
  };
  pending_approvals: Array<{
    approval_id: string;
    type: 'terminal' | 'apply_diff' | 'scope_expansion';
    requested_at: string;
  }>;
  active_checkpoint_id: string | null;
  scope_summary: ScopeSummary;
}

/**
 * Evidence object schema
 */
export interface Evidence {
  evidence_id: string;
  type: 'log' | 'diff' | 'file' | 'test' | 'error';
  source_event_id: string;
  content_ref: string;
  summary: string;
  created_at: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Plan Metadata - Advisory info from LLM during PLAN generation
 * This enables Step 26 to detect "sneaky" complex plans that appear small
 * but have high file touch, risk, or low confidence.
 * 
 * Key principle: PLAN = intelligence (LLM), Step 26 = validation (deterministic)
 * planMeta is OPTIONAL for backward compatibility.
 */
export interface PlanMeta {
  /** Estimated number of files this plan will touch */
  estimatedFileTouch: number | 'unknown';
  
  /** Estimated development hours for a senior developer */
  estimatedDevHours: number | 'unknown';
  
  /** High-risk areas detected in this plan */
  riskAreas: string[];  // e.g., ["auth", "migration", "payments"]
  
  /** Domains/surfaces this plan spans */
  domains: string[];    // e.g., ["web", "mobile", "backend", "database"]
  
  /** LLM's confidence in plan scope accuracy */
  confidence: 'low' | 'medium' | 'high';
}

// ============================================================================
// STEP 34.5: COMMAND EXECUTION PHASE TYPES
// ============================================================================

/**
 * Command kind classification (finite vs long-running)
 */
export type CommandKind = 'finite' | 'long_running';

/**
 * Execution context for command phase
 */
export type CommandExecutionContext = 'verify' | 'user_run';

/**
 * Command phase result
 */
export interface CommandPhaseResult {
  status: 'success' | 'failure' | 'skipped' | 'awaiting_approval';
  failedCommand?: string;
  exitCode?: number;
  evidenceRefs: string[];
  executedCommands: string[];
  durationMs: number;
  skipReason?: string;
}

/**
 * Single command execution result
 */
export interface SingleCommandResult {
  command: string;
  kind: CommandKind;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  evidenceId: string;
}

// ============================================================================
// EVENT CONTRACT STABILIZATION - Primitive Event Types (Enterprise-Grade)
// ============================================================================

/**
 * Stable Primitive Event Types - The ONLY types new features should use
 * 
 * These primitives are designed for extensibility via kind/code/details fields.
 * Existing raw EventType values remain valid (deprecated but allowlisted).
 * 
 * @see eventNormalizer.ts for mapping from raw EventType to PrimitiveEventType
 */
export type PrimitiveEventType =
  // Lifecycle boundaries
  | 'run_started'
  | 'run_completed'
  | 'step_started'
  | 'step_completed'
  // Tool execution
  | 'tool_started'
  | 'tool_completed'
  // Artifacts (plans, diffs, checkpoints)
  | 'artifact_proposed'
  | 'artifact_applied'
  // Decision points (approvals, clarifications, scope)
  | 'decision_point_needed'
  | 'user_action_taken'
  // Progress tracking (incremental only, not lifecycle)
  | 'progress_updated'
  // State transitions (mode, stage, pause/resume, repair loops)
  | 'state_changed'
  // Warnings and errors
  | 'warning_raised'
  | 'error_raised'
  // Safe fallback for unknown raw types
  | 'unknown_event';

/**
 * Scope values for normalized events
 * Indicates at what level the event operates
 */
export type NormalizedScope = 'run' | 'mission' | 'step' | 'tool' | 'ui';

/**
 * Normalized event structure - READ-TIME ONLY (never stored)
 * 
 * This interface wraps raw events with normalized metadata for UI rendering
 * and state derivation. The raw event is ALWAYS preserved exactly as stored.
 * 
 * CRITICAL CONSTRAINTS:
 * - raw: Original event, never modified
 * - normalized: Derived at read-time for rendering
 * - Never write NormalizedEvent to storage
 * - Logs/Audit must show raw events verbatim
 */
export interface NormalizedEvent {
  /**
   * Original raw event exactly as stored (untouched)
   * This is the source of truth for replay and audit
   */
  raw: Event;

  /**
   * Derived normalized representation for UI/state
   * Generated at read-time by eventNormalizer
   */
  normalized: {
    /**
     * Stable primitive type (from PrimitiveEventType union)
     */
    type: PrimitiveEventType;

    /**
     * Open-ended kind string for sub-categorization
     * Examples: "plan", "diff", "truncation", "preflight", "approval"
     * NOT validated against a strict allowlist
     */
    kind: string;

    /**
     * Optional code for warnings/errors
     * Examples: "TRUNCATED_OUTPUT_RECOVERED", "PLAN_LARGE_DETECTED"
     */
    code?: string;

    /**
     * Scope at which this event operates
     */
    scope: NormalizedScope;

    /**
     * For state_changed events: previous state
     * REQUIRED when type === 'state_changed'
     */
    from?: string;

    /**
     * For state_changed events: new state
     * REQUIRED when type === 'state_changed'
     */
    to?: string;

    /**
     * Extracted/derived details from raw payload
     * Structured for easier UI consumption
     */
    details: Record<string, unknown>;

    /**
     * Optional UI hint for card type selection
     * Allows raw events to suggest specific card rendering
     */
    ui_hint?: string;
  };

  /**
   * Version of the normalizer that produced this
   * For backwards compatibility tracking
   */
  normalizer_version: string;
}

/**
 * Current normalizer version
 * Increment when normalization logic changes significantly
 */
export const NORMALIZER_VERSION = '1.0.0';

/**
 * Type guard: Check if a string is a valid PrimitiveEventType
 */
export function isPrimitiveEventType(type: string): type is PrimitiveEventType {
  const primitives: PrimitiveEventType[] = [
    'run_started', 'run_completed',
    'step_started', 'step_completed',
    'tool_started', 'tool_completed',
    'artifact_proposed', 'artifact_applied',
    'decision_point_needed', 'user_action_taken',
    'progress_updated', 'state_changed',
    'warning_raised', 'error_raised',
    'unknown_event'
  ];
  return primitives.includes(type as PrimitiveEventType);
}

// ============================================================================
// STEP 35: GREENFIELD SCAFFOLD FLOW TYPES
// ============================================================================

/**
 * Flow kind for routing (Step 35.1)
 * 
 * Determines whether to use standard PLAN/MISSION flow or SCAFFOLD flow.
 * This is orthogonal to behavior - a PLAN behavior can route to either flow.
 */
export type FlowKind = 'standard' | 'scaffold';

/**
 * Scaffold reference type (how user specified what they want)
 */
export type ScaffoldReferenceType = 'description' | 'screenshot' | 'url';

/**
 * Scaffold proposal status
 */
export type ScaffoldProposalStatus = 'pending' | 'approved' | 'cancelled';

/**
 * Scaffold completion status
 */
export type ScaffoldCompletionStatus = 'cancelled' | 'ready_for_step_35_2';

/**
 * Scaffold started event payload (V1 minimal)
 */
export interface ScaffoldStartedPayload {
  /** Stable ID for this scaffold attempt */
  scaffold_id: string;
  /** Associated run ID */
  run_id: string;
  /** Target directory for scaffold (optional in 35.1) */
  target_directory?: string;
  /** How user specified what they want */
  reference_type?: ScaffoldReferenceType;
  /** Original user prompt */
  user_prompt: string;
  /** ISO timestamp */
  created_at_iso: string;
}

/**
 * Scaffold proposal created event payload (V1 minimal)
 */
export interface ScaffoldProposalCreatedPayload {
  /** Stable ID for this scaffold attempt */
  scaffold_id: string;
  /** Recipe identifier (placeholder in 35.1) */
  recipe?: string;
  /** Design pack identifier (placeholder in 35.1) */
  design_pack?: string;
  /** Number of files to create (placeholder in 35.1) */
  files_count: number;
  /** Number of directories to create (placeholder in 35.1) */
  directories_count: number;
  /** Commands to run after scaffolding (placeholder in 35.1) */
  commands_to_run: string[];
  /** Human-readable summary */
  summary: string;
  
  // Step 37: Reference Enhancement Fields
  /** Reference context (if user provided images/URLs) */
  reference_context?: ReferenceContext;
  /** Selected style source mode */
  reference_mode?: StyleSourceMode;
}

/**
 * Scaffold applied event payload (V1 minimal)
 */
export interface ScaffoldAppliedPayload {
  /** Stable ID for this scaffold attempt */
  scaffold_id: string;
  /** Status - always 'noop' in 35.1 */
  status: 'noop';
  /** Files created (empty in 35.1) */
  files_created: string[];
  /** Evidence reference (undefined in 35.1) */
  evidence_ref?: string;
}

/**
 * Scaffold completed event payload (V1 minimal)
 */
export interface ScaffoldCompletedPayload {
  /** Stable ID for this scaffold attempt */
  scaffold_id: string;
  /** Completion status */
  status: ScaffoldCompletionStatus;
  /** Optional reason for status */
  reason?: string;
}

/**
 * Extended IntentAnalysis with flow_kind for Step 35
 * 
 * When flow_kind === 'scaffold', the router should use ScaffoldFlow
 * instead of standard PLAN/MISSION pipelines.
 */
export interface IntentAnalysisWithFlow extends IntentAnalysis {
  /** Flow kind for routing (Step 35) */
  flow_kind: FlowKind;
}

// ============================================================================
// STEP 35.2: SCAFFOLD PREFLIGHT SAFETY TYPES
// ============================================================================

/**
 * Monorepo type detection
 */
export type MonorepoType = 'pnpm' | 'turbo' | 'nx' | 'lerna' | 'yarn_workspaces' | 'unknown';

/**
 * Reason for target directory selection
 */
export type TargetChoiceReason = 'default' | 'monorepo_choice' | 'user_selected' | 'workspace_root';

/**
 * Preflight conflict type
 */
export type PreflightConflictType = 'NON_EMPTY_DIR' | 'EXISTING_PACKAGE_JSON' | 'MONOREPO_AMBIGUOUS';

/**
 * Preflight conflict record
 */
export interface PreflightConflict {
  type: PreflightConflictType;
  message: string;
}

/**
 * Recommended location for scaffold in monorepo
 */
export interface RecommendedLocation {
  label: string;
  path: string;
  recommended: boolean;
}

/**
 * Scaffold preflight started event payload (V1)
 */
export interface ScaffoldPreflightStartedPayload {
  scaffold_id: string;
  workspace_root: string;
  created_at_iso: string;
}

/**
 * Scaffold target chosen event payload (V1)
 */
export interface ScaffoldTargetChosenPayload {
  scaffold_id: string;
  target_directory: string;
  reason: TargetChoiceReason;
  app_name?: string;
}

/**
 * Scaffold preflight completed event payload (V1)
 */
export interface ScaffoldPreflightCompletedPayload {
  scaffold_id: string;
  target_directory: string;
  is_empty_dir: boolean;
  has_package_json: boolean;
  detected_monorepo: boolean;
  monorepo_type?: MonorepoType;
  recommended_locations?: RecommendedLocation[];
  conflicts?: PreflightConflict[];
}

/**
 * Scaffold blocked event payload (V1)
 */
export interface ScaffoldBlockedPayload {
  scaffold_id: string;
  target_directory: string;
  reason: 'non_empty_dir' | 'monorepo_ambiguous' | 'user_cancelled';
  message: string;
}

// ============================================================================
// STEP 37: REFERENCE-BASED ENHANCEMENTS TYPES
// ============================================================================

/**
 * Reference attachment (image or URL provided by user)
 * Max 10 images allowed; URLs are design references, not scraped yet
 */
export type ReferenceAttachment =
  | { type: 'image'; id: string; path: string; mime: string }
  | { type: 'url'; id: string; url: string };

/**
 * Reference intent classification
 * Describes what the user intends to use the reference for
 */
export type ReferenceIntent = 'visual_style' | 'layout' | 'branding' | 'unknown';

/**
 * Reference context bundle - normalized container for all references
 * Attached to scaffold proposals, plan creation, and quick actions
 * 
 * CRITICAL: Do NOT interpret yet — just pass through
 */
export interface ReferenceContext {
  /** Image references (screenshots, design mockups) */
  images: ReferenceAttachment[];
  /** URL references (design systems, component libraries) */
  urls: ReferenceAttachment[];
  /** Source of references */
  source: 'user_upload';
  /** Detected intent for reference usage */
  intent: ReferenceIntent;
}

/**
 * Style source mode for reference usage
 * Used in scaffold approval UI to let user choose how references influence output
 */
export type StyleSourceMode = 'use_reference' | 'ignore_reference' | 'combine_with_design_pack';

/**
 * reference_attached event payload
 */
export interface ReferenceAttachedPayload {
  ref_ids: string[];
  types: ('image' | 'url')[];
}

/**
 * reference_context_built event payload
 */
export interface ReferenceContextBuiltPayload {
  intent: ReferenceIntent;
  ref_count: number;
}

/**
 * reference_used event payload
 */
export interface ReferenceUsedPayload {
  scope: 'scaffold' | 'quick_action' | 'plan';
  mode: 'combined' | 'exclusive';
}

/**
 * Vision tokens (legacy stub - kept for backward compatibility)
 * @deprecated Use ReferenceTokens instead
 */
export interface VisionTokens {
  status: 'pending' | 'analyzed';
  reason?: string;
  colors?: string[];
  layout?: string;
  components?: string[];
}

/**
 * Vision analyzer interface (legacy stub - kept for backward compatibility)
 * @deprecated Use RealVisionAnalyzer instead
 */
export interface VisionAnalyzer {
  analyze(refs: ReferenceContext): Promise<VisionTokens>;
}

// ============================================================================
// STEP 38: VISION + URL REFERENCE TOKEN EXTRACTION TYPES
// ============================================================================

/**
 * Reference Tokens - Structured style/layout hints extracted from user-provided references
 * 
 * This is the canonical output of vision analysis. It contains extracted design tokens
 * that can influence scaffold design pack selection and style overrides.
 * 
 * CRITICAL: Never store raw base64 or full OCR text in this structure.
 * Only derived/summarized tokens are stored.
 */
export interface ReferenceTokens {
  /** Source counts for traceability */
  source: {
    images_count: number;
    urls_count: number;
  };
  
  /** Style tokens extracted from references */
  style: {
    /** Color palette extracted from references */
    palette?: {
      primary?: string;    // Hex color, e.g., "#3B82F6"
      secondary?: string;  // Hex color
      accent?: string;     // Hex color
      neutrals?: string[]; // Array of neutral colors
    };
    /** Mood/vibe descriptors */
    mood?: string[];         // e.g., ["minimal", "enterprise", "vibrant", "modern"]
    /** Typography hints */
    typography?: {
      heading?: string;    // Font family suggestion, e.g., "Inter"
      body?: string;       // Font family suggestion
    };
    /** Content density */
    density?: 'compact' | 'default' | 'relaxed';
    /** Border radius style */
    radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
    /** Shadow intensity */
    shadows?: 'none' | 'subtle' | 'medium' | 'dramatic';
  };
  
  /** Layout structure hints */
  layout?: {
    structure?: string[];   // e.g., ["sidebar", "header", "grid", "cards"]
    components?: string[];  // e.g., ["nav", "hero", "footer", "form"]
  };
  
  /** UI framework/system hints */
  uiHints?: {
    component_system_preference?: 'shadcn' | 'mui' | 'chakra' | 'tailwind-plain';
  };
  
  /** Confidence score 0..1 */
  confidence: number;
  
  /** Warnings about extraction quality */
  warnings?: string[];
}

/**
 * Vision analysis status
 */
export type VisionAnalysisStatus = 'complete' | 'skipped' | 'error';

/**
 * Vision analyze result - output from RealVisionAnalyzer
 */
export interface VisionAnalyzeResult {
  /** Analysis status */
  status: VisionAnalysisStatus;
  /** Extracted tokens (only if status === 'complete') */
  tokens?: ReferenceTokens;
  /** Evidence reference for tokens file */
  tokensEvidenceRef?: string;
  /** Reason for skip/error */
  reason?: string;
  /** Whether error is retryable */
  retryable?: boolean;
  /** Duration of analysis in milliseconds */
  durationMs?: number;
}

/**
 * Vision mode configuration
 */
export type VisionMode = 'off' | 'prompt' | 'on';

/**
 * Vision provider selection (independent from chat model dropdown)
 */
export type VisionProvider = 'anthropic' | 'openai' | 'backend-default';

/**
 * Vision configuration - workspace settings
 */
export interface VisionConfig {
  /** Vision analysis mode (enterprise-safe: default 'off') */
  visionMode: VisionMode;
  /** Vision provider (independent from chat model) */
  visionProvider: VisionProvider;
  /** Maximum number of images to analyze (capped at 10) */
  maxImages: number;
  /** Maximum dimension for resized images (e.g., 1024) */
  maxPixels: number;
  /** Maximum total upload size in MB (e.g., 15) */
  maxTotalUploadMB: number;
}

/**
 * Vision analysis started event payload
 */
export interface VisionAnalysisStartedPayload {
  /** Associated run ID */
  run_id: string;
  /** Reference context ID for correlation */
  reference_context_id: string;
  /** Number of images to analyze */
  images_count: number;
  /** Number of URLs (for context hints) */
  urls_count: number;
}

/**
 * Vision analysis completed event payload
 */
export interface VisionAnalysisCompletedPayload {
  /** Associated run ID */
  run_id: string;
  /** Reference context ID for correlation */
  reference_context_id: string;
  /** Analysis status */
  status: VisionAnalysisStatus;
  /** Reason for skip/error */
  reason?: string;
  /** Duration in milliseconds */
  duration_ms?: number;
}

/**
 * Reference tokens extracted event payload
 * 
 * IMPORTANT: Never include raw base64 or full JSON here.
 * Only include summarized/compact info for mission feed display.
 */
export interface ReferenceTokensExtractedPayload {
  /** Associated run ID */
  run_id: string;
  /** Reference context ID for correlation */
  reference_context_id: string;
  /** Evidence reference path for tokens file */
  evidence_ref: string;
  /** Short palette summary for UI display, e.g., "#3B82F6, #10B981" */
  palette_summary?: string;
  /** Mood tags for UI display */
  moods?: string[];
  /** Confidence score 0..1 */
  confidence: number;
}

/**
 * Reference tokens used event payload
 * 
 * Emitted when tokens are actually applied to influence scaffold/plan/quick action.
 */
export interface ReferenceTokensUsedPayload {
  /** Associated run ID */
  run_id: string;
  /** Reference context ID for correlation */
  reference_context_id: string;
  /** Where tokens were used */
  used_in: 'scaffold_proposal' | 'quick_action' | 'plan';
  /** Design pack ID if scaffold context */
  design_pack_id?: string;
  /** Reference mode used */
  mode: 'use_reference' | 'combine' | 'ignore';
  /** Whether style overrides were applied */
  overrides_applied: boolean;
}

/**
 * Run context for vision analysis (for replay detection)
 */
export interface VisionRunContext {
  /** Run/task ID */
  runId: string;
  /** Whether this is a replay/audit run */
  isReplay: boolean;
  /** Workspace root path */
  workspaceRoot: string;
  /** Reference context ID */
  referenceContextId: string;
}

/**
 * Image data for vision provider
 */
export interface VisionImageData {
  /** MIME type */
  mime: string;
  /** Base64-encoded image data */
  base64: string;
  /** Original attachment ID */
  attachmentId: string;
}

/**
 * Vision consent decision from user
 */
export type VisionConsentDecision = 'analyze_once' | 'enable_always' | 'skip';

// ============================================================================
// STEP 40.5: INTELLIGENCE LAYER TYPES
// ============================================================================

/**
 * Context enriched event payload
 */
export interface ContextEnrichedPayload {
  /** Associated run ID */
  run_id: string;
  /** Original user input */
  original_input: string;
  /** Detected project type */
  project_type: string;
  /** Whether TypeScript is used */
  has_typescript: boolean;
  /** Detected component library */
  component_library: string;
  /** Number of references resolved */
  references_resolved: number;
  /** Whether clarification is needed */
  needs_clarification: boolean;
  /** Enrichment duration in ms */
  duration_ms: number;
}

/**
 * Clarification asked event payload
 */
export interface ClarificationAskedPayload {
  /** Associated run ID */
  run_id: string;
  /** Clarification question */
  question: string;
  /** Available options (if any) */
  options?: string[];
  /** Reason for clarification */
  reason: 'ambiguous_reference' | 'missing_context' | 'vague_input';
}

/**
 * Out of scope detected event payload
 */
export interface OutOfScopeDetectedPayload {
  /** Associated run ID */
  run_id: string;
  /** Original user input */
  original_input: string;
  /** Generated response */
  response: string;
  /** Detected category */
  category: 'weather' | 'general_knowledge' | 'entertainment' | 'personal' | 'other';
}

/**
 * Reference resolved event payload
 */
export interface ReferenceResolvedPayload {
  /** Associated run ID */
  run_id: string;
  /** Original reference text (e.g., "the button") */
  original: string;
  /** Resolved path/entity */
  resolved: string;
  /** Resolution source */
  source: 'session_history' | 'codebase_scan' | 'open_files' | 'recent_error';
  /** Confidence score (0-1) */
  confidence: number;
}

// ============================================================================
// STEP 41: DEV SERVER LIFECYCLE TYPES
// ============================================================================

/**
 * Process status lifecycle
 */
export type ProcessStatus = 'starting' | 'running' | 'ready' | 'stopped' | 'error';

/**
 * Process started event payload
 */
export interface ProcessStartedPayload {
  /** Associated run ID */
  run_id: string;
  /** Process ID */
  process_id: string;
  /** Command that was run */
  command: string;
  /** Command arguments */
  args: string[];
  /** Working directory */
  cwd: string;
  /** OS process ID */
  pid?: number;
}

/**
 * Process ready event payload
 */
export interface ProcessReadyPayload {
  /** Associated run ID */
  run_id: string;
  /** Process ID */
  process_id: string;
  /** Detected port (if applicable) */
  port?: number;
  /** Time to ready in ms */
  time_to_ready_ms: number;
}

/**
 * Process output event payload
 */
export interface ProcessOutputPayload {
  /** Associated run ID */
  run_id: string;
  /** Process ID */
  process_id: string;
  /** Output stream (stdout/stderr) */
  stream: 'stdout' | 'stderr';
  /** Output data */
  data: string;
  /** Whether output was truncated */
  truncated: boolean;
}

/**
 * Process stopped event payload
 */
export interface ProcessStoppedPayload {
  /** Associated run ID */
  run_id: string;
  /** Process ID */
  process_id: string;
  /** Exit code */
  exit_code?: number;
  /** Stop reason */
  reason: 'user_stopped' | 'extension_deactivate' | 'error' | 'completed';
  /** Runtime duration in ms */
  duration_ms: number;
}

/**
 * Process error event payload
 */
export interface ProcessErrorPayload {
  /** Associated run ID */
  run_id: string;
  /** Process ID */
  process_id: string;
  /** Error message */
  error: string;
  /** Whether error is recoverable */
  recoverable: boolean;
}

// ============================================================================
// STEP 43: SCAFFOLD QUALITY GATES (PREFLIGHT CHECKS + RESOLUTIONS + SAFE APPLY)
// ============================================================================

/**
 * Preflight check status
 */
export type PreflightCheckStatus = 'pass' | 'warn' | 'block';

/**
 * Resolution option action
 */
export type ResolutionAction = 'proceed' | 'modify' | 'cancel';

/**
 * Merge mode for scaffold apply when target is non-empty
 */
export type ScaffoldMergeMode = 'abort' | 'skip_conflicts' | 'replace_all';

/**
 * Monorepo placement option
 */
export type MonorepoPlacement = 'apps' | 'packages' | 'root';

/**
 * Resolution option presented to the user for a preflight check
 */
export interface ResolutionOption {
  /** Unique option identifier */
  id: string;
  /** Display label */
  label: string;
  /** Description of what this option does */
  description: string;
  /** Action type */
  action: ResolutionAction;
  /** Modifications to apply if selected */
  modifications?: {
    targetDir?: string;
    mergeMode?: ScaffoldMergeMode;
    monorepoPlacement?: MonorepoPlacement;
  };
}

/**
 * Single preflight check result
 */
export interface PreflightCheck {
  /** Unique check identifier */
  id: string;
  /** Human-readable check name */
  name: string;
  /** Check status */
  status: PreflightCheckStatus;
  /** Human-readable message */
  message: string;
  /** Resolution options (for warn/block) */
  resolution?: {
    options: ResolutionOption[];
  };
}

/**
 * Complete preflight result
 */
export interface PreflightResult {
  /** Whether scaffold can proceed (no unresolved blockers) */
  canProceed: boolean;
  /** All checks that were run */
  checks: PreflightCheck[];
  /** Checks with status 'block' */
  blockers: PreflightCheck[];
  /** Checks with status 'warn' */
  warnings: PreflightCheck[];
  /** User-selected resolutions (populated after user interaction) */
  selectedResolutions?: Record<string, string>;
}

/**
 * Scaffold preflight config (merge/placement policy)
 */
export interface ScaffoldPreflightConfig {
  /** Merge mode for non-empty directories */
  mergeMode: ScaffoldMergeMode;
  /** Override target directory */
  targetDirOverride?: string;
  /** Monorepo placement if detected */
  monorepoPlacement?: MonorepoPlacement;
}

/**
 * Scaffold preflight checks started event payload
 */
export interface ScaffoldPreflightChecksStartedPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Target directory being checked */
  target_directory: string;
  /** Planned files count */
  planned_files_count: number;
  /** ISO timestamp */
  created_at_iso: string;
}

/**
 * Scaffold preflight checks completed event payload
 */
export interface ScaffoldPreflightChecksCompletedPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Whether scaffold can proceed */
  can_proceed: boolean;
  /** Total checks run */
  total_checks: number;
  /** Number of blockers */
  blockers_count: number;
  /** Number of warnings */
  warnings_count: number;
  /** Check summaries for audit */
  check_summaries: Array<{ id: string; status: PreflightCheckStatus; message: string }>;
  /** Duration in ms */
  duration_ms: number;
}

/**
 * Scaffold preflight resolution selected event payload
 */
export interface ScaffoldPreflightResolutionSelectedPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Check ID the resolution applies to */
  check_id: string;
  /** Selected option ID */
  option_id: string;
  /** Resulting target directory (if modified) */
  resolved_target_dir?: string;
  /** Resulting merge mode (if modified) */
  resolved_merge_mode?: ScaffoldMergeMode;
  /** Resulting monorepo placement (if modified) */
  resolved_monorepo_placement?: MonorepoPlacement;
}

/**
 * Scaffold quality gates passed event payload
 */
export interface ScaffoldQualityGatesPassedPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Number of gates passed */
  gates_passed: number;
  /** Total duration in ms */
  total_duration_ms: number;
}

/**
 * Scaffold quality gates failed event payload
 */
export interface ScaffoldQualityGatesFailedPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Failed gate names */
  failed_gates: string[];
  /** Total duration in ms */
  total_duration_ms: number;
}

// ============================================================================
// SCAFFOLD FEATURE INTELLIGENCE (LLM-Powered Feature Generation)
// ============================================================================

/**
 * Data entity in the feature data model
 */
export interface DataEntity {
  name: string;
  fields: Array<{ name: string; type: string; required: boolean }>;
}

/**
 * Page requirement for the feature
 */
export interface PageRequirement {
  path: string;
  description: string;
  components: string[];
}

/**
 * Structured feature requirements extracted from user prompt via LLM
 */
export interface FeatureRequirements {
  /** App type detected (e.g., "todo", "blog", "ecommerce") */
  app_type: string;
  /** Feature list (e.g., ["task list", "add task", "mark complete"]) */
  features: string[];
  /** Data model entities */
  data_model: DataEntity[];
  /** Page/route requirements */
  pages: PageRequirement[];
  /** Whether auth is needed */
  has_auth: boolean;
  /** Whether database is needed */
  has_database: boolean;
  /** Styling preference */
  styling_preference?: string;
}

/**
 * File kind in generated feature code
 */
export type GeneratedFileKind = 'component' | 'page' | 'type' | 'hook' | 'util' | 'api' | 'config';

/**
 * A single generated file from LLM feature code generation
 */
export interface GeneratedFile {
  /** Relative path (e.g., "src/components/TodoList.tsx") */
  path: string;
  /** Full file content */
  content: string;
  /** Human-readable description */
  description: string;
  /** File kind classification */
  kind: GeneratedFileKind;
}

/**
 * A file modification (patch) to an existing scaffolded file
 */
export interface ModifiedFileEntry {
  /** Relative path to existing file */
  path: string;
  /** New full content for the file */
  content: string;
  /** Description of what changed */
  description: string;
}

/**
 * Result of LLM feature code generation
 */
export interface FeatureGenerationResult {
  /** New files to create */
  files: GeneratedFile[];
  /** Existing files to modify */
  modified_files: ModifiedFileEntry[];
  /** Human-readable summary */
  summary: string;
}

/**
 * Result of applying feature code to project
 */
export interface FeatureApplyResult {
  /** Files created */
  created_files: string[];
  /** Files modified */
  modified_files: string[];
  /** Errors encountered */
  errors: Array<{ file: string; error: string }>;
  /** Whether apply succeeded overall */
  success: boolean;
}

/**
 * Feature extraction started event payload
 */
export interface FeatureExtractionStartedPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Original user prompt */
  user_prompt: string;
  /** Recipe being used */
  recipe_id: string;
}

/**
 * Feature extraction completed event payload
 */
export interface FeatureExtractionCompletedPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Detected app type */
  app_type: string;
  /** Number of features detected */
  features_count: number;
  /** Number of pages planned */
  pages_count: number;
  /** Duration in ms */
  duration_ms: number;
}

/**
 * Feature code generating event payload
 */
export interface FeatureCodeGeneratingPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** App type being generated */
  app_type: string;
  /** Number of files planned */
  planned_files_count: number;
  /** Current status message */
  message: string;
}

/**
 * Feature code applied event payload
 */
export interface FeatureCodeAppliedPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Files created */
  created_files: string[];
  /** Files modified */
  modified_files: string[];
  /** Total files affected */
  total_files: number;
  /** Summary of what was generated */
  summary: string;
  /** Duration in ms */
  duration_ms: number;
}

/**
 * Feature code error event payload
 */
export interface FeatureCodeErrorPayload {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Run ID */
  run_id: string;
  /** Error message */
  error: string;
  /** Phase where error occurred */
  phase: 'extraction' | 'generation' | 'application';
  /** Whether this is recoverable (falls back to generic scaffold) */
  recoverable: boolean;
}

// ============================================================================
// VNext EVENT PAYLOADS
// Migration note: Runs created before VNext implementation won't have these
// events. All consumers (reducer, normalizer, UI) must tolerate their absence.
// ============================================================================

// --- Project Memory (V2-V5) ---

export interface MemoryFactsUpdatedPayload {
  /** Run ID that triggered the update */
  run_id: string;
  /** Short summary of what changed */
  delta_summary: string;
  /** Number of lines added */
  lines_added: number;
  /** Total facts line count after update */
  total_lines: number;
}

/** Verification metadata proving a solution is "proven" */
export interface SolutionVerification {
  /** Which check confirmed success */
  type: 'tests' | 'build' | 'lint' | 'manual';
  /** The actual command that passed */
  command: string;
  /** ISO timestamp of the verification event */
  passed_at: string;
  /** One-line result (e.g. "12 tests passed") */
  summary: string;
}

export interface SolutionCapturedPayload {
  /** Run ID where the solution was captured */
  run_id: string;
  /** Unique solution ID */
  solution_id: string;
  /** Problem description */
  problem: string;
  /** Fix description */
  fix: string;
  /** Files changed */
  files_changed: string[];
  /** Tags for retrieval */
  tags: string[];
  /** Verification that proves the solution works */
  verification: SolutionVerification;
}

// --- Generated Tools (V6-V8) ---

export interface GeneratedToolProposedPayload {
  /** Run ID */
  run_id: string;
  /** Unique proposal ID */
  proposal_id: string;
  /** Tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Tool input schema summary */
  inputs_summary: string;
  /** Tool output schema summary */
  outputs_summary: string;
}

export interface GeneratedToolSavedPayload {
  /** Run ID */
  run_id: string;
  /** Proposal ID that was approved */
  proposal_id: string;
  /** Saved tool name */
  name: string;
}

export interface GeneratedToolRunStartedPayload {
  /** Run ID */
  run_id: string;
  /** Tool name being executed */
  tool_name: string;
  /** Arguments passed to the tool (summary, not full data) */
  args_summary: string;
}

export interface GeneratedToolRunCompletedPayload {
  /** Run ID */
  run_id: string;
  /** Tool name */
  tool_name: string;
  /** Exit code */
  exit_code: number;
  /** Duration in milliseconds */
  duration_ms: number;
  /** Truncated stdout (first 500 chars) */
  stdout_preview: string;
}

export interface GeneratedToolRunFailedPayload {
  /** Run ID */
  run_id: string;
  /** Tool name */
  tool_name: string;
  /** Failure reason */
  reason: string;
  /** Whether it was blocked by static scan vs runtime failure */
  failure_type: 'blocked' | 'timeout' | 'runtime_error' | 'policy_denied';
  /** Duration in milliseconds (0 if blocked before execution) */
  duration_ms: number;
}

// --- Agent Mode Policy (V9) ---

export interface ModeChangedPayload {
  /** Run ID */
  run_id: string;
  /** Previous mode */
  from_mode: Mode;
  /** New mode */
  to_mode: Mode;
  /** Why the mode changed */
  reason: string;
  /** Whether the user explicitly initiated this change */
  user_initiated: boolean;
}

// --- Autonomy Loop Detection (W3) ---

export type LoopType = 'stuck' | 'regressing' | 'oscillating' | 'scope_creep';

export interface AutonomyLoopDetectedPayload {
  loopType: LoopType;
  iteration: number;
  evidence: Record<string, unknown>;
  recommendation: string;
}

export interface AutonomyDowngradedPayload {
  fromLevel: string;
  toLevel: string;
  reason: string;
  loopType: LoopType;
}

