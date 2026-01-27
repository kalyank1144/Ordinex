/**
 * EventBus: Persist before fan-out event distribution
 * Based on 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - Publish execution events
 * - Persist events immediately
 * - Notify subscribers (UI, logger, persistence)
 * - Append-only, ordered
 * - Synchronous persistence before fan-out
 */

import { Event, EventType, Mode, Stage, PrimitiveEventType, isPrimitiveEventType } from './types';
import { EventStore } from './eventStore';

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
