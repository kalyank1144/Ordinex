/**
 * Task Persistence — Minimal metadata interface for crash recovery.
 *
 * NOT a state snapshot. State is derived from event replay via StateReducer.
 * This only tracks WHICH task was active and WHETHER the exit was clean.
 *
 * P1 compliant: NO fs imports. Extension implements the FS layer.
 */

// ---------------------------------------------------------------------------
// Minimal metadata — pointer to active task
// ---------------------------------------------------------------------------

export interface ActiveTaskMetadata {
  task_id: string;
  run_id?: string;
  mode: string;
  stage: string;
  status: 'running' | 'paused';
  last_updated_at: string; // ISO timestamp
  cleanly_exited: boolean;
  last_checkpoint_id?: string;
}

export interface ActiveTaskPointer {
  active_task_id: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Recovery analysis (pure, computed by crashRecoveryPolicy)
// ---------------------------------------------------------------------------

export interface RecoveryOption {
  id: 'resume' | 'restore_checkpoint' | 'discard';
  label: string;
  description: string;
  enabled: boolean;
}

export interface RecoveryAnalysis {
  task: ActiveTaskMetadata;
  options: RecoveryOption[];
  recommended_action: 'resume' | 'restore_checkpoint' | 'discard';
  reason: string;
  event_count: number;
  time_since_interruption_ms: number;
}

// ---------------------------------------------------------------------------
// Service interface — implemented by extension (fsTaskPersistenceService)
// ---------------------------------------------------------------------------

export interface TaskPersistenceService {
  setActiveTask(metadata: ActiveTaskMetadata): Promise<void>;
  getActiveTask(): Promise<ActiveTaskMetadata | null>;
  markCleanExit(taskId: string): Promise<void>;
  clearActiveTask(): Promise<void>;
}
