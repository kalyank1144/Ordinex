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
  | 'command_progress';

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

