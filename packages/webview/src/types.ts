/**
 * Webview types - mirrors core types for UI rendering
 * These are duplicated to avoid cross-package dependencies in webview
 */

export type ToolCategory = 'read' | 'exec' | 'write';

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

export interface TouchedFile {
  path: string;
  operations: Array<{
    type: 'read' | 'write' | 'execute';
    timestamp: string;
    event_id: string;
    line_range?: { start: number; end: number };
  }>;
}

export interface ScopeSummary {
  contract: ScopeContract;
  in_scope_files: string[];
  touched_files: TouchedFile[];
  lines_retrieved: number;
  tools_used: ToolCategory[];
}

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
 * Mission Control UI types - event-driven rendering
 */

export type Mode = 'ANSWER' | 'PLAN' | 'MISSION';

export type Stage = 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'none';

export type TaskStatus = 'ready' | 'running' | 'paused' | 'awaiting_approval' | 'error';

export type TabName = 'mission' | 'systems' | 'logs';

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
  | 'autonomy_completed'
  // ANSWER Mode
  | 'context_collected'
  | 'stream_delta'
  | 'stream_complete';

export interface Event {
  event_id: string;
  task_id: string;
  timestamp: string;
  type: EventType;
  mode: Mode;
  stage: Stage;
  payload: Record<string, unknown>;
  evidence_ids: string[];
  parent_event_id: string | null;
}

export interface NarrationCard {
  type: 'intent' | 'plan' | 'evidence' | 'tool_run' | 'diff_proposed' | 'approval' | 'result';
  title: string;
  content: string;
  timestamp: string;
  event_ids: string[];
  status?: 'pending' | 'approved' | 'rejected' | 'complete';
}

export interface CheckpointInfo {
  checkpoint_id: string;
  created_at: string;
  event_count: number;
}

/**
 * Evidence object schema (mirrors core Evidence type)
 */
export interface Evidence {
  evidence_id: string;
  type: 'log' | 'diff' | 'file' | 'test' | 'error';
  source_event_id: string;
  content_ref: string;
  summary: string;
  created_at: string;
}

export interface MissionControlState {
  // Tab management
  activeTab: TabName;
  
  // Status
  taskStatus: TaskStatus;
  currentStage: Stage;
  currentMode: Mode;
  
  // Mission tab: narration cards derived from events
  narrationCards: NarrationCard[];
  
  // Systems tab: scope and checkpoint data
  scopeSummary: ScopeSummary;
  latestCheckpoint: CheckpointInfo | null;
  pendingScopeExpansion: ScopeExpansionRequest | null;
  
  // Logs tab: raw event list
  events: Event[];
  
  // Evidence storage (keyed by evidence_id)
  evidence: Record<string, Evidence>;
  
  // Evidence content cache (for loaded content)
  evidenceContent: Record<string, string>;
  
  // Composer
  selectedModel: string;
  promptText: string;
  
  // Counters
  counters: {
    filesInScope: number;
    filesTouched: number;
    linesIncluded: number;
    toolCallsUsed: number;
    toolCallsMax: number;
  };
}
