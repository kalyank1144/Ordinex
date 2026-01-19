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

import { Event } from './types';
import { EventStore } from './eventStore';

export type EventSubscriber = (event: Event) => void | Promise<void>;

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
   * For testing: clear all subscribers
   */
  _clearSubscribersForTesting(): void {
    this.subscribers = [];
  }
}
