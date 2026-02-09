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

export type Stage = 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'command' | 'none';

export type TaskStatus = 'ready' | 'running' | 'paused' | 'awaiting_approval' | 'error';

export type TabName = 'mission' | 'systems' | 'logs';

export type EventType =
  // Core Lifecycle
  | 'intent_received'
  | 'mode_set'
  | 'plan_created'
  | 'plan_revised'
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
  // Step 29: Systems Tab
  | 'run_scope_initialized'
  | 'repair_policy_snapshot'
  // Step 30: Truncation-Safe Edit Execution
  | 'preflight_complete'
  | 'truncation_detected'
  | 'edit_split_triggered'
  | 'edit_chunk_started'
  | 'edit_chunk_completed'
  | 'edit_chunk_failed'
  | 'edit_step_paused'
  // Large Plan Detection
  | 'plan_large_detected'
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
  // Step 37: Reference/Attachment Events
  | 'reference_attached'
  | 'reference_context_built'
  | 'reference_used'
  // Step 38: Vision Analysis Events
  | 'vision_analysis_started'
  | 'vision_analysis_completed'
  | 'reference_tokens_extracted'
  | 'reference_tokens_used'
  // Step 35: Scaffold Flow Events
  | 'scaffold_started'
  | 'scaffold_proposal_created'
  | 'scaffold_decision_resolved'
  | 'scaffold_apply_started'
  | 'scaffold_applied'
  | 'scaffold_cancelled'
  | 'scaffold_completed'
  // Step 35: Post-Scaffold Orchestration Events
  | 'scaffold_progress'
  | 'design_pack_applied'
  | 'scaffold_final_complete'
  // Step 35.6: Next Steps
  | 'next_steps_shown'
  | 'next_step_selected'
  | 'next_step_dismissed'
  // Feature Intelligence (LLM-Powered Feature Generation)
  | 'feature_extraction_started'
  | 'feature_extraction_completed'
  | 'feature_code_generating'
  | 'feature_code_applied'
  | 'feature_code_error'
  // Process Management
  | 'process_started'
  | 'process_ready'
  | 'process_output'
  | 'process_stopped'
  | 'process_failed'
  // Verification streaming
  | 'scaffold_verify_started'
  | 'scaffold_verify_step_completed'
  | 'scaffold_verify_completed'
  // Auto-fix
  | 'scaffold_autofix_started'
  | 'scaffold_autofix_applied'
  | 'scaffold_autofix_failed'
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
  | 'autonomy_downgraded'
  // Step 47: Resume After Crash
  | 'task_interrupted'
  | 'task_recovery_started'
  | 'task_discarded'
  // Step 48: Undo System
  | 'undo_performed'
  // Step 49: Error Recovery UX
  | 'recovery_action_taken';

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
