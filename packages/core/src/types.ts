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
  | 'mission_breakdown_created'
  | 'mission_selected'
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
  | 'autonomy_completed';

export const CANONICAL_EVENT_TYPES: readonly EventType[] = [
  'intent_received',
  'mode_set',
  'plan_created',
  'mission_breakdown_created',
  'mission_selected',
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
] as const;

export type Mode = 'ANSWER' | 'PLAN' | 'MISSION';

export type Stage = 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'none';

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
