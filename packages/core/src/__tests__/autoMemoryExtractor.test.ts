/**
 * Layer 3: Auto Memory Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import {
  shouldExtract,
  buildAutoMemoryPrompt,
  parseExtractionResult,
  deduplicateFacts,
  shouldSkipDueToFactCount,
  createExtractionState,
  recordExtraction,
} from '../memory/autoMemoryExtractor';
import type { Event } from '../types';
import type { MemoryFact } from '../memory/memoryDocument';

// ============================================================================
// Helpers
// ============================================================================

function makeEvent(overrides: Partial<Event> & { type: string }): Event {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    task_id: 'task_test',
    timestamp: new Date().toISOString(),
    mode: 'AGENT' as any,
    stage: 'none' as any,
    payload: {},
    evidence_ids: [],
    parent_event_id: null,
    ...overrides,
  };
}

function makeFact(content: string, section: string = 'general'): MemoryFact {
  return {
    id: Math.random().toString(36).slice(2, 6),
    section: section as any,
    content,
    createdAt: new Date().toISOString(),
    referenceCount: 0,
  };
}

// ============================================================================
// shouldExtract Tests
// ============================================================================

describe('shouldExtract', () => {
  it('triggers on plan_created with preceding plan_approval', () => {
    const state = createExtractionState();
    const recentEvents = [
      makeEvent({ type: 'approval_resolved', payload: { approval_type: 'plan_approval', decision: 'approved' } }),
    ];
    const event = makeEvent({ type: 'plan_created' });

    const match = shouldExtract(event, recentEvents, state);
    expect(match).not.toBeNull();
    expect(match!.triggerType).toBe('plan_approved');
    expect(match!.targetSection).toBe('architecture');
  });

  it('does not trigger plan_approved without approval event', () => {
    const state = createExtractionState();
    const event = makeEvent({ type: 'plan_created' });
    expect(shouldExtract(event, [], state)).toBeNull();
  });

  it('triggers on diff_applied with preceding failure', () => {
    const state = createExtractionState();
    const recentEvents = [
      makeEvent({ type: 'failure_classified', payload: { failureSignature: 'Error' } }),
    ];
    const event = makeEvent({ type: 'diff_applied' });

    const match = shouldExtract(event, recentEvents, state);
    expect(match).not.toBeNull();
    expect(match!.triggerType).toBe('failure_fix');
    expect(match!.targetSection).toBe('patterns');
  });

  it('does not trigger diff_applied without preceding failure', () => {
    const state = createExtractionState();
    const event = makeEvent({ type: 'diff_applied' });
    expect(shouldExtract(event, [], state)).toBeNull();
  });

  it('triggers on mission_completed with success', () => {
    const state = createExtractionState();
    const event = makeEvent({ type: 'mission_completed', payload: { success: true } });

    const match = shouldExtract(event, [], state);
    expect(match).not.toBeNull();
    expect(match!.triggerType).toBe('mission_completed');
  });

  it('does not trigger on failed mission_completed', () => {
    const state = createExtractionState();
    const event = makeEvent({ type: 'mission_completed', payload: { success: false } });
    expect(shouldExtract(event, [], state)).toBeNull();
  });

  it('triggers on scaffold_completed', () => {
    const state = createExtractionState();
    const event = makeEvent({ type: 'scaffold_completed' });

    const match = shouldExtract(event, [], state);
    expect(match).not.toBeNull();
    expect(match!.triggerType).toBe('scaffold_completed');
    expect(match!.targetSection).toBe('stack');
  });

  it('rate-limits: same trigger type fires only once per task', () => {
    const state = createExtractionState();
    const event = makeEvent({ type: 'scaffold_completed' });

    const first = shouldExtract(event, [], state);
    expect(first).not.toBeNull();
    recordExtraction(state, 'scaffold_completed', 1);

    const second = shouldExtract(event, [], state);
    expect(second).toBeNull();
  });

  it('stops after MAX_FACTS_PER_TASK reached', () => {
    const state = createExtractionState();
    state.factsExtractedCount = 5;
    const event = makeEvent({ type: 'scaffold_completed' });
    expect(shouldExtract(event, [], state)).toBeNull();
  });

  it('ignores unrelated event types', () => {
    const state = createExtractionState();
    const event = makeEvent({ type: 'tool_start' });
    expect(shouldExtract(event, [], state)).toBeNull();
  });
});

// ============================================================================
// buildExtractionPrompt Tests
// ============================================================================

describe('buildAutoMemoryPrompt', () => {
  it('includes trigger type and target section', () => {
    const trigger = {
      triggerType: 'scaffold_completed' as const,
      targetSection: 'stack' as const,
      triggerEvent: makeEvent({ type: 'scaffold_completed' }),
      contextEvents: [makeEvent({ type: 'scaffold_completed', payload: { template: 'react' } })],
    };

    const prompt = buildAutoMemoryPrompt(trigger, []);
    expect(prompt).toContain('scaffold_completed');
    expect(prompt).toContain('stack');
    expect(prompt).toContain('JSON');
  });

  it('includes existing facts for deduplication', () => {
    const trigger = {
      triggerType: 'mission_completed' as const,
      targetSection: 'conventions' as const,
      triggerEvent: makeEvent({ type: 'mission_completed' }),
      contextEvents: [],
    };

    const existing = [makeFact('Uses vitest for testing', 'conventions')];
    const prompt = buildAutoMemoryPrompt(trigger, existing);
    expect(prompt).toContain('Uses vitest for testing');
  });

  it('shows (none) when no existing facts', () => {
    const trigger = {
      triggerType: 'mission_completed' as const,
      targetSection: 'conventions' as const,
      triggerEvent: makeEvent({ type: 'mission_completed' }),
      contextEvents: [],
    };

    const prompt = buildAutoMemoryPrompt(trigger, []);
    expect(prompt).toContain('(none)');
  });
});

// ============================================================================
// parseExtractionResult Tests
// ============================================================================

describe('parseExtractionResult', () => {
  it('parses valid JSON response', () => {
    const response = '{"facts":[{"section":"stack","content":"Uses Node.js 20"}]}';
    const facts = parseExtractionResult(response);
    expect(facts).toHaveLength(1);
    expect(facts[0].section).toBe('stack');
    expect(facts[0].content).toBe('Uses Node.js 20');
  });

  it('parses JSON embedded in text', () => {
    const response = 'Here are the facts:\n{"facts":[{"section":"architecture","content":"Monorepo"}]}\nDone.';
    const facts = parseExtractionResult(response);
    expect(facts).toHaveLength(1);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseExtractionResult('not json at all')).toEqual([]);
  });

  it('returns empty array for missing facts key', () => {
    expect(parseExtractionResult('{"data": []}')).toEqual([]);
  });

  it('filters out facts longer than 200 chars', () => {
    const longContent = 'a'.repeat(201);
    const response = `{"facts":[{"section":"general","content":"${longContent}"}]}`;
    expect(parseExtractionResult(response)).toEqual([]);
  });

  it('validates section values', () => {
    const response = '{"facts":[{"section":"invalid_section","content":"test"}]}';
    const facts = parseExtractionResult(response);
    expect(facts[0].section).toBe('general');
  });

  it('filters out empty content', () => {
    const response = '{"facts":[{"section":"general","content":""}]}';
    expect(parseExtractionResult(response)).toEqual([]);
  });
});

// ============================================================================
// deduplicateFacts Tests
// ============================================================================

describe('deduplicateFacts', () => {
  it('filters exact duplicates', () => {
    const newFacts = [{ section: 'general' as const, content: 'Uses TypeScript' }];
    const existing = [makeFact('Uses TypeScript')];
    expect(deduplicateFacts(newFacts, existing)).toEqual([]);
  });

  it('filters near-duplicates (>70% token overlap)', () => {
    const newFacts = [{ section: 'general' as const, content: 'Project uses TypeScript and React' }];
    const existing = [makeFact('Project uses TypeScript and React framework')];
    expect(deduplicateFacts(newFacts, existing)).toEqual([]);
  });

  it('keeps genuinely new facts', () => {
    const newFacts = [{ section: 'stack' as const, content: 'Database is PostgreSQL 16' }];
    const existing = [makeFact('Uses TypeScript')];
    const result = deduplicateFacts(newFacts, existing);
    expect(result).toHaveLength(1);
  });

  it('handles empty existing facts', () => {
    const newFacts = [{ section: 'general' as const, content: 'New fact' }];
    expect(deduplicateFacts(newFacts, [])).toHaveLength(1);
  });

  it('filters out empty content', () => {
    const newFacts = [{ section: 'general' as const, content: '' }];
    expect(deduplicateFacts(newFacts, [])).toEqual([]);
  });
});

// ============================================================================
// State Management Tests
// ============================================================================

describe('ExtractionState', () => {
  it('createExtractionState returns fresh state', () => {
    const state = createExtractionState();
    expect(state.firedTriggers.size).toBe(0);
    expect(state.factsExtractedCount).toBe(0);
  });

  it('recordExtraction updates state', () => {
    const state = createExtractionState();
    recordExtraction(state, 'plan_approved', 2);
    expect(state.firedTriggers.has('plan_approved')).toBe(true);
    expect(state.factsExtractedCount).toBe(2);
  });

  it('shouldSkipDueToFactCount returns true at 500+', () => {
    expect(shouldSkipDueToFactCount(499)).toBe(false);
    expect(shouldSkipDueToFactCount(500)).toBe(true);
    expect(shouldSkipDueToFactCount(1000)).toBe(true);
  });
});
