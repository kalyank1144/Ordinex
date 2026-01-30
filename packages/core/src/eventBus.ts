/**
 * EventBus: Persist before fan-out event distribution
 * Based on 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * STEP 32 EXTENSION: Correlation ID support for error recovery tracking
 * - run_id: Immutable identifier for a single execution run
 * - step_id: Current step within the run
 * - attempt_id: Retry attempt within a step
 * - file_id: Optional per-file chunk identifier
 * 
 * Requirements:
 * - Publish execution events
 * - Persist events immediately
 * - Notify subscribers (UI, logger, persistence)
 * - Append-only, ordered
 * - Synchronous persistence before fan-out
 * - Correlation IDs for deterministic replay/audit
 */

import { Event, EventType, Mode, Stage, PrimitiveEventType, isPrimitiveEventType } from './types';
import { EventStore } from './eventStore';

// ============================================================================
// CORRELATION IDS (Step 32)
// ============================================================================

/**
 * Event correlation identifiers for tracking and replay
 * 
 * IMPORTANT DISTINCTIONS:
 * - task_id: User's thread/conversation/mission set (long-lived)
 * - run_id: Single execution instance (immutable event stream)
 * - step_id: Current step within the run
 * - attempt_id: Retry attempt within a step
 * - file_id: Optional per-file edit chunk
 */
export interface EventCorrelation {
  /** Immutable run identifier - one run = one event stream */
  run_id: string;
  
  /** Current step identifier */
  step_id?: string;
  
  /** Retry attempt within step */
  attempt_id?: string;
  
  /** Per-file chunk identifier for edit operations */
  file_id?: string;
}

/**
 * Generate a unique run ID for a new execution
 * Format: run_<timestamp>_<random>
 * 
 * RULE: run_id is created ONCE at mission start and NEVER changes during execution.
 * This ensures all events in a run can be correlated for replay/audit.
 */
export function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `run_${timestamp}_${random}`;
}

/**
 * Generate a step ID for a new step within a run
 * Format: step_<run_id_suffix>_<index>
 */
export function generateStepId(runId: string, stepIndex: number): string {
  const runSuffix = runId.split('_').pop() || runId;
  return `step_${runSuffix}_${stepIndex}`;
}

/**
 * Generate an attempt ID for a retry within a step
 * Format: attempt_<step_id_suffix>_<index>
 */
export function generateAttemptId(stepId: string, attemptIndex: number): string {
  const stepSuffix = stepId.split('_').pop() || stepId;
  return `attempt_${stepSuffix}_${attemptIndex}`;
}

/**
 * Generate a file ID for per-file edit tracking
 * Format: file_<sha256_first8>_<path_hash>
 */
export function generateFileId(filePath: string): string {
  // Simple hash for path
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `file_${Math.abs(hash).toString(36)}`;
}

export type EventSubscriber = (event: Event) => void | Promise<void>;

/**
 * Input for emitting primitive events
 * New features should use this interface instead of raw EventType
 */
export interface PrimitiveEventInput {
  /** Stable primitive type */
  type: PrimitiveEventType;
  /** Open-ended kind for sub-categorization */
  kind: string;
  /** Optional code for warnings/errors */
  code?: string;
  /** Task ID this event belongs to */
  taskId: string;
  /** Current mode */
  mode: Mode;
  /** Current stage */
  stage: Stage;
  /** Event payload (excluding primitive metadata - those are added automatically) */
  payload?: Record<string, unknown>;
  /** Evidence IDs referenced by this event */
  evidenceIds?: string[];
  /** Parent event ID for nesting */
  parentEventId?: string | null;
}

/**
 * Mapping from PrimitiveEventType to canonical EventType for storage
 * This ensures we always store a valid canonical type
 */
const PRIMITIVE_TO_CANONICAL: Record<PrimitiveEventType, EventType> = {
  'run_started': 'intent_received',
  'run_completed': 'final',
  'step_started': 'step_started',
  'step_completed': 'step_completed',
  'tool_started': 'tool_start',
  'tool_completed': 'tool_end',
  'artifact_proposed': 'plan_created',
  'artifact_applied': 'diff_applied',
  'decision_point_needed': 'decision_point_needed',
  'user_action_taken': 'approval_resolved',
  'progress_updated': 'context_collected',
  'state_changed': 'stage_changed',
  'warning_raised': 'mode_violation',
  'error_raised': 'failure_detected',
  'unknown_event': 'failure_detected', // fallback
};

export class EventBus {
  private readonly eventStore: EventStore;
  private subscribers: EventSubscriber[] = [];

  constructor(eventStore: EventStore) {
    this.eventStore = eventStore;
  }

  /**
   * Publish an event
   * CRITICAL: Persists to EventStore before notifying subscribers
   */
  async publish(event: Event): Promise<void> {
    // Persist first (synchronous persistence before fan-out)
    await this.eventStore.append(event);

    // Then notify all subscribers
    await this.notifySubscribers(event);
  }

  /**
   * Subscribe to events
   * Returns unsubscribe function
   */
  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.push(subscriber);

    // Return unsubscribe function
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      if (index !== -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  /**
   * Get number of active subscribers
   */
  getSubscriberCount(): number {
    return this.subscribers.length;
  }

  /**
   * Notify all subscribers of an event
   */
  private async notifySubscribers(event: Event): Promise<void> {
    // Call all subscribers in parallel
    // (In V1, we could do sequential if needed for determinism)
    const notifications = this.subscribers.map(sub => {
      try {
        return Promise.resolve(sub(event));
      } catch (err) {
        console.error('Subscriber error:', err);
        return Promise.resolve();
      }
    });

    await Promise.all(notifications);
  }

  /**
   * Emit a primitive event (recommended for new features)
   * 
   * This helper converts PrimitiveEventType + kind/code into a canonical Event.
   * The primitive metadata is stored in the payload for normalization at read-time.
   * 
   * @example
   * await eventBus.emitPrimitive({
   *   type: 'warning_raised',
   *   kind: 'truncation',
   *   code: 'TRUNCATED_OUTPUT_RECOVERED',
   *   taskId,
   *   mode: 'MISSION',
   *   stage: 'edit',
   *   payload: { file: 'foo.ts', recovered: true }
   * });
   */
  async emitPrimitive(input: PrimitiveEventInput): Promise<Event> {
    // Map primitive type to canonical EventType for storage
    const canonicalType = PRIMITIVE_TO_CANONICAL[input.type];
    
    // Build payload with primitive metadata embedded
    const payload: Record<string, unknown> = {
      ...input.payload,
      // Embed primitive metadata for the normalizer to use
      _primitive: {
        type: input.type,
        kind: input.kind,
        code: input.code,
      },
    };
    
    // Create the event
    const event: Event = {
      event_id: this.generateEventId(),
      task_id: input.taskId,
      timestamp: new Date().toISOString(),
      type: canonicalType,
      mode: input.mode,
      stage: input.stage,
      payload,
      evidence_ids: input.evidenceIds || [],
      parent_event_id: input.parentEventId ?? null,
    };
    
    // Publish the event
    await this.publish(event);
    
    return event;
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return `evt_${timestamp}_${random}`;
  }

  /**
   * For testing: clear all subscribers
   */
  _clearSubscribersForTesting(): void {
    this.subscribers = [];
  }
}

/**
 * Helper to create a primitive event input
 * Provides good defaults and type safety
 */
export function createPrimitiveInput(
  type: PrimitiveEventType,
  kind: string,
  taskId: string,
  options: {
    code?: string;
    mode?: Mode;
    stage?: Stage;
    payload?: Record<string, unknown>;
    evidenceIds?: string[];
    parentEventId?: string | null;
  } = {}
): PrimitiveEventInput {
  return {
    type,
    kind,
    taskId,
    mode: options.mode || 'MISSION',
    stage: options.stage || 'none',
    code: options.code,
    payload: options.payload,
    evidenceIds: options.evidenceIds,
    parentEventId: options.parentEventId,
  };
}
