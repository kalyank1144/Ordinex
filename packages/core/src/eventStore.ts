/**
 * EventStore: Append-only JSONL event storage
 * Based on 03_API_DATA_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - Append-only (no destructive mutation)
 * - Ordered
 * - Immutable once written
 * - Canonical event type validation (reject unknown types)
 * - Crash-safe (fsync on write)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Event, EventType, CANONICAL_EVENT_TYPES, ValidationResult } from './types';

export class EventStore {
  private readonly storePath: string;
  private events: Event[] = [];

  constructor(storePath: string) {
    this.storePath = storePath;
    this.ensureStoreExists();
    this.loadEvents();
  }

  /**
   * Append a new event to the store
   * Validates event type and persists immediately with fsync
   */
  async append(event: Event): Promise<void> {
    // Validate canonical event type
    const validation = this.validateEvent(event);
    if (!validation.valid) {
      throw new Error(`Event validation failed: ${validation.error}`);
    }

    // Append to in-memory store (ordered)
    this.events.push(event);

    // Persist immediately with fsync (crash-safe)
    await this.persistEvent(event);
  }

  /**
   * Get all events in order
   * Returns a deep copy to preserve immutability
   */
  getAllEvents(): Event[] {
    return this.events.map(e => this.cloneEvent(e));
  }

  /**
   * Get events for a specific task
   */
  getEventsByTaskId(taskId: string): Event[] {
    return this.events.filter(e => e.task_id === taskId).map(e => this.cloneEvent(e));
  }

  /**
   * Get events by type
   */
  getEventsByType(type: EventType): Event[] {
    return this.events.filter(e => e.type === type).map(e => this.cloneEvent(e));
  }

  /**
   * Get event by ID
   */
  getEventById(eventId: string): Event | undefined {
    const event = this.events.find(e => e.event_id === eventId);
    return event ? this.cloneEvent(event) : undefined;
  }

  /**
   * Deep clone an event to preserve immutability
   */
  private cloneEvent(event: Event): Event {
    return {
      ...event,
      payload: { ...event.payload },
      evidence_ids: [...event.evidence_ids],
    };
  }

  /**
   * Get total event count
   */
  count(): number {
    return this.events.length;
  }

  /**
   * Get distinct task IDs with summary metadata, ordered by most recent activity.
   * Returns: { task_id, title (first prompt), mode, first_event_at, last_event_at, event_count }
   */
  getDistinctTaskSummaries(): Array<{
    task_id: string;
    title: string;
    mode: string;
    first_event_at: string;
    last_event_at: string;
    event_count: number;
  }> {
    const taskMap = new Map<string, {
      task_id: string;
      title: string;
      mode: string;
      first_event_at: string;
      last_event_at: string;
      event_count: number;
    }>();

    for (const event of this.events) {
      const tid = event.task_id;
      if (!tid) continue;

      const existing = taskMap.get(tid);
      if (!existing) {
        taskMap.set(tid, {
          task_id: tid,
          title: '',
          mode: event.mode || 'ANSWER',
          first_event_at: event.timestamp,
          last_event_at: event.timestamp,
          event_count: 1,
        });
      } else {
        existing.last_event_at = event.timestamp;
        existing.event_count++;
      }

      // Extract title from intent_received event
      if (event.type === 'intent_received' && event.payload?.prompt) {
        const entry = taskMap.get(tid)!;
        if (!entry.title) {
          entry.title = String(event.payload.prompt);
        }
      }

      // Capture mode from mode_set event
      if (event.type === 'mode_set' && event.payload?.mode) {
        const entry = taskMap.get(tid)!;
        entry.mode = String(event.payload.mode);
      }
    }

    // Sort by last_event_at descending (most recent first)
    const summaries = Array.from(taskMap.values());
    summaries.sort((a, b) => {
      return new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime();
    });

    // Fill in default titles for tasks without intent_received
    for (const s of summaries) {
      if (!s.title) {
        s.title = `Task ${s.task_id.substring(0, 8)}...`;
      }
    }

    return summaries;
  }

  /**
   * Validate event against canonical types
   */
  private validateEvent(event: Event): ValidationResult {
    if (!event.event_id) {
      return { valid: false, error: 'Missing event_id' };
    }
    if (!event.task_id) {
      return { valid: false, error: 'Missing task_id' };
    }
    if (!event.timestamp) {
      return { valid: false, error: 'Missing timestamp' };
    }
    if (!event.type) {
      return { valid: false, error: 'Missing event type' };
    }

    // CRITICAL: Reject unknown event types
    if (!CANONICAL_EVENT_TYPES.includes(event.type)) {
      return {
        valid: false,
        error: `Unknown event type: ${event.type}. Only canonical event types are allowed.`
      };
    }

    return { valid: true };
  }

  /**
   * Ensure store directory and file exist
   */
  private ensureStoreExists(): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.storePath)) {
      fs.writeFileSync(this.storePath, '', 'utf8');
    }
  }

  /**
   * Load all events from JSONL file
   */
  private loadEvents(): void {
    const content = fs.readFileSync(this.storePath, 'utf8');
    if (!content.trim()) {
      this.events = [];
      return;
    }

    const lines = content.trim().split('\n');
    this.events = lines.map(line => {
      try {
        return JSON.parse(line) as Event;
      } catch (err) {
        throw new Error(`Failed to parse event line: ${line}`);
      }
    });
  }

  /**
   * Persist event to JSONL file with fsync
   */
  private async persistEvent(event: Event): Promise<void> {
    return new Promise((resolve, reject) => {
      const line = JSON.stringify(event) + '\n';
      
      // Open file for append
      fs.open(this.storePath, 'a', (err, fd) => {
        if (err) {
          return reject(err);
        }

        // Write event
        fs.write(fd, line, (writeErr) => {
          if (writeErr) {
            fs.close(fd, () => reject(writeErr));
            return;
          }

          // Fsync to ensure crash-safety
          fs.fsync(fd, (syncErr) => {
            if (syncErr) {
              fs.close(fd, () => reject(syncErr));
              return;
            }

            // Close file
            fs.close(fd, (closeErr) => {
              if (closeErr) {
                return reject(closeErr);
              }
              resolve();
            });
          });
        });
      });
    });
  }

  /**
   * For testing: clear all events (not part of production API)
   */
  _clearForTesting(): void {
    this.events = [];
    fs.writeFileSync(this.storePath, '', 'utf8');
  }
}
