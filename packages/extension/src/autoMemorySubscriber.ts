/**
 * AutoMemorySubscriber — Wires event-triggered auto-memory extraction.
 *
 * Subscribes to EventBus and triggers LLM-based fact extraction
 * on specific events (plan_approved, failure_fix, mission_completed,
 * scaffold_completed). Layer 3 of the memory system.
 *
 * Usage:
 *   const subscriber = new AutoMemorySubscriber(memoryService, llmClientFactory);
 *   eventBus.subscribe(event => subscriber.onEvent(event, allRecentEvents));
 */

import type { Event } from 'core';
import {
  shouldExtract,
  buildAutoMemoryPrompt,
  parseExtractionResult,
  deduplicateFacts,
  shouldSkipDueToFactCount,
  createExtractionState,
  recordExtraction,
} from 'core';
import type { ExtractionState, MemoryFact } from 'core';
import type { FsEnhancedMemoryService } from './fsEnhancedMemoryService';

export interface AutoMemoryLLMClient {
  complete(prompt: string): Promise<string>;
}

export class AutoMemorySubscriber {
  private state: ExtractionState;
  private extracting = false;

  constructor(
    private readonly memoryService: FsEnhancedMemoryService,
    private readonly llmClientFactory: () => AutoMemoryLLMClient | null,
  ) {
    this.state = createExtractionState();
  }

  /**
   * Reset extraction state (call at start of each new task).
   */
  resetForNewTask(): void {
    this.state = createExtractionState();
  }

  /**
   * Process an event for potential auto-memory extraction.
   * Non-blocking — extraction runs in background.
   */
  async onEvent(event: Event, recentEvents: Event[]): Promise<void> {
    if (this.extracting) return;

    const trigger = shouldExtract(event, recentEvents, this.state);
    if (!trigger) return;

    const doc = await this.memoryService.loadDocument();
    if (shouldSkipDueToFactCount(doc.facts.length)) return;

    const llmClient = this.llmClientFactory();
    if (!llmClient) return;

    this.extracting = true;

    try {
      const prompt = buildAutoMemoryPrompt(trigger, doc.facts);
      const response = await llmClient.complete(prompt);
      const extracted = parseExtractionResult(response);

      if (extracted.length === 0) {
        recordExtraction(this.state, trigger.triggerType, 0);
        return;
      }

      const deduplicated = deduplicateFacts(extracted, doc.facts);
      if (deduplicated.length === 0) {
        recordExtraction(this.state, trigger.triggerType, 0);
        return;
      }

      for (const fact of deduplicated) {
        await this.memoryService.addFact(fact.section, fact.content);
      }

      recordExtraction(this.state, trigger.triggerType, deduplicated.length);
      console.log(`[AutoMemory] Extracted ${deduplicated.length} facts from ${trigger.triggerType}`);
    } catch (err) {
      console.warn('[AutoMemory] Extraction failed:', err);
    } finally {
      this.extracting = false;
    }
  }
}
