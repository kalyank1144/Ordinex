/**
 * Layer 3: Auto Memory Extractor — Event-Triggered Learning
 *
 * Automatically extracts learnings from meaningful events and writes
 * them to MEMORY.md. Uses EventStore triggers (not a timer) for
 * precise, cost-efficient extraction.
 *
 * Trigger events:
 *   plan_approved         → architectural decisions
 *   failure_classified    → debugging insights (with diff_applied)
 *   mission_completed     → what was built and why
 *   scaffold_completed    → project setup choices
 */

import type { Event } from '../types';
import type { MemoryFact, MemorySection } from './memoryDocument';

// ============================================================================
// TYPES
// ============================================================================

export interface TriggerMatch {
  triggerType: 'plan_approved' | 'failure_fix' | 'mission_completed' | 'scaffold_completed';
  targetSection: MemorySection;
  triggerEvent: Event;
  contextEvents: Event[];
}

export interface ExtractedFact {
  section: MemorySection;
  content: string;
}

export interface ExtractionState {
  /** Trigger types already fired for this task (rate limiting) */
  firedTriggers: Set<string>;
  /** Total facts extracted this task */
  factsExtractedCount: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_FACTS_PER_TASK = 5;
const MAX_EXISTING_FACTS = 500;
const CONTEXT_WINDOW_SIZE = 10;

// ============================================================================
// TRIGGER DETECTION
// ============================================================================

/**
 * Check if an event should trigger auto-memory extraction.
 * Returns a TriggerMatch with context events, or null.
 */
export function shouldExtract(
  event: Event,
  recentEvents: Event[],
  state: ExtractionState,
): TriggerMatch | null {
  if (state.factsExtractedCount >= MAX_FACTS_PER_TASK) return null;

  const contextEvents = recentEvents.slice(-CONTEXT_WINDOW_SIZE);

  if (event.type === 'plan_created' && hasPlanApproval(event, recentEvents)) {
    if (state.firedTriggers.has('plan_approved')) return null;
    return {
      triggerType: 'plan_approved',
      targetSection: 'architecture',
      triggerEvent: event,
      contextEvents,
    };
  }

  if (event.type === 'diff_applied' && hasPrecedingFailure(recentEvents)) {
    if (state.firedTriggers.has('failure_fix')) return null;
    return {
      triggerType: 'failure_fix',
      targetSection: 'patterns',
      triggerEvent: event,
      contextEvents,
    };
  }

  if (event.type === 'mission_completed' && event.payload.success === true) {
    if (state.firedTriggers.has('mission_completed')) return null;
    return {
      triggerType: 'mission_completed',
      targetSection: 'conventions',
      triggerEvent: event,
      contextEvents,
    };
  }

  if (event.type === 'scaffold_completed') {
    if (state.firedTriggers.has('scaffold_completed')) return null;
    return {
      triggerType: 'scaffold_completed',
      targetSection: 'stack',
      triggerEvent: event,
      contextEvents,
    };
  }

  return null;
}

function hasPlanApproval(event: Event, recentEvents: Event[]): boolean {
  if (event.type === 'plan_created') {
    return recentEvents.some(e =>
      e.type === 'approval_resolved' &&
      e.payload.approval_type === 'plan_approval' &&
      e.payload.decision === 'approved',
    );
  }
  return false;
}

function hasPrecedingFailure(recentEvents: Event[]): boolean {
  for (let i = recentEvents.length - 1; i >= 0; i--) {
    if (recentEvents[i].type === 'failure_classified') return true;
    if (recentEvents[i].type === 'diff_applied') return false;
  }
  return false;
}

// ============================================================================
// EXTRACTION PROMPT
// ============================================================================

/**
 * Build the LLM prompt for extracting learnings from events.
 */
export function buildAutoMemoryPrompt(
  trigger: TriggerMatch,
  existingFacts: MemoryFact[],
): string {
  const eventSummaries = trigger.contextEvents.map(e => {
    const payloadStr = JSON.stringify(e.payload, null, 0).substring(0, 200);
    return `- [${e.type}] ${payloadStr}`;
  }).join('\n');

  const existingStr = existingFacts.length > 0
    ? existingFacts.map(f => `- [${f.section}] ${f.content}`).join('\n')
    : '(none)';

  return `You are extracting project learnings from a coding session.

Trigger: ${trigger.triggerType}
Target section: ${trigger.targetSection}

Events:
${eventSummaries}

Existing project facts (do NOT duplicate these):
${existingStr}

Extract 1-3 key facts worth remembering for future sessions.
Each fact must be:
- A single line, max 120 characters
- Actionable or informational (not narrative)
- Not duplicating or restating any existing fact

Return ONLY valid JSON:
{"facts":[{"section":"${trigger.targetSection}","content":"..."}]}`;
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

/**
 * Parse LLM extraction response into facts.
 */
export function parseExtractionResult(llmResponse: string): ExtractedFact[] {
  try {
    const jsonMatch = llmResponse.match(/\{[\s\S]*"facts"\s*:\s*\[[\s\S]*\]\s*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.facts)) return [];

    return parsed.facts
      .filter((f: any) =>
        typeof f.section === 'string' &&
        typeof f.content === 'string' &&
        f.content.trim().length > 0 &&
        f.content.length <= 200,
      )
      .map((f: any) => ({
        section: validateSection(f.section),
        content: f.content.trim(),
      }));
  } catch {
    return [];
  }
}

function validateSection(section: string): MemorySection {
  const valid: MemorySection[] = ['architecture', 'stack', 'conventions', 'patterns', 'general'];
  return valid.includes(section as MemorySection) ? section as MemorySection : 'general';
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

/**
 * Filter out facts that are duplicates or near-duplicates of existing facts.
 * Uses token overlap — Layer 5 (embeddings) will enhance this with cosine similarity.
 */
export function deduplicateFacts(
  newFacts: ExtractedFact[],
  existing: MemoryFact[],
): ExtractedFact[] {
  return newFacts.filter(newFact => {
    const newTokens = tokenize(newFact.content);
    if (newTokens.size === 0) return false;

    for (const ex of existing) {
      if (ex.content === newFact.content) return false;

      const exTokens = tokenize(ex.content);
      const shared = countShared(newTokens, exTokens);
      const overlapRatio = shared / Math.min(newTokens.size, exTokens.size);
      if (overlapRatio > 0.7) return false;
    }

    return true;
  });
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s_\-./]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2),
  );
}

function countShared(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count++;
  }
  return count;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Check if extraction should be skipped due to fact count limit.
 */
export function shouldSkipDueToFactCount(existingFactCount: number): boolean {
  return existingFactCount >= MAX_EXISTING_FACTS;
}

/**
 * Create a fresh extraction state for a new task.
 */
export function createExtractionState(): ExtractionState {
  return {
    firedTriggers: new Set(),
    factsExtractedCount: 0,
  };
}

/**
 * Record that a trigger fired and facts were extracted.
 */
export function recordExtraction(state: ExtractionState, triggerType: string, factsAdded: number): void {
  state.firedTriggers.add(triggerType);
  state.factsExtractedCount += factsAdded;
}
