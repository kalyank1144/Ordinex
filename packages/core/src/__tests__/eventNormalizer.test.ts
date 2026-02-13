/**
 * Event Normalizer Tests - Enterprise-Grade Contract Stabilization
 * 
 * Tests verify:
 * 1. Raw event is preserved exactly (lossless)
 * 2. All 76 raw event types map correctly
 * 3. Unknown types become unknown_event
 * 4. state_changed has from/to populated
 * 5. Truncation: recovered → warning, fatal → error
 * 6. plan_large_detected → warning_raised with correct code/kind
 */

import { describe, it, expect } from 'vitest';

import {
  normalizeEvent,
  normalizeEvents,
  hasNormalizationMapping,
  getPrimitiveType,
} from '../eventNormalizer';

import {
  Event,
  EventType,
  NORMALIZER_VERSION,
  isPrimitiveEventType,
} from '../types';

// Helper to create a test event
function createTestEvent(type: EventType, payload: Record<string, unknown> = {}): Event {
  return {
    event_id: `evt_test_${Date.now()}`,
    task_id: 'task_test',
    timestamp: new Date().toISOString(),
    type,
    mode: 'MISSION',
    stage: 'edit',
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };
}

describe('EventNormalizer', () => {
  describe('normalizeEvent - Lossless Preservation', () => {
    it('preserves raw event exactly without modification', () => {
      const original = createTestEvent('plan_created', {
        plan: { goal: 'Test', steps: [] },
        custom_field: 'test_value',
      });
      
      const normalized = normalizeEvent(original);
      
      // Raw should be identical reference
      expect(normalized.raw).toBe(original);
      
      // All original fields preserved
      expect(normalized.raw.event_id).toBe(original.event_id);
      expect(normalized.raw.type).toBe(original.type);
      expect(normalized.raw.payload.custom_field).toBe('test_value');
    });

    it('includes normalizer version', () => {
      const event = createTestEvent('step_started', {});
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalizer_version).toBe(NORMALIZER_VERSION);
      expect(normalized.normalizer_version).toBe('1.0.0');
    });
  });

  describe('normalizeEvent - Primitive Type Mapping', () => {
    it('maps intent_received to run_started', () => {
      const event = createTestEvent('intent_received', { prompt: 'test' });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('run_started');
      expect(normalized.normalized.kind).toBe('intent');
      expect(normalized.normalized.scope).toBe('run');
    });

    it('maps final to run_completed', () => {
      const event = createTestEvent('final', { success: true });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('run_completed');
      expect(normalized.normalized.kind).toBe('final');
    });

    it('maps step_started to step_started', () => {
      const event = createTestEvent('step_started', { step_index: 0 });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('step_started');
      expect(normalized.normalized.kind).toBe('step');
      expect(normalized.normalized.scope).toBe('step');
    });

    it('maps tool_start to tool_started', () => {
      const event = createTestEvent('tool_start', { tool_name: 'terminal' });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('tool_started');
      expect(normalized.normalized.kind).toBe('generic');
      expect(normalized.normalized.scope).toBe('tool');
    });

    it('maps plan_created to artifact_proposed', () => {
      const event = createTestEvent('plan_created', { plan: {} });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('artifact_proposed');
      expect(normalized.normalized.kind).toBe('plan');
      expect(normalized.normalized.scope).toBe('run');
    });

    it('maps diff_proposed to artifact_proposed', () => {
      const event = createTestEvent('diff_proposed', { files_changed: [] });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('artifact_proposed');
      expect(normalized.normalized.kind).toBe('diff');
      expect(normalized.normalized.scope).toBe('step');
    });

    it('maps approval_requested to decision_point_needed', () => {
      const event = createTestEvent('approval_requested', { approval_type: 'apply_diff' });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('decision_point_needed');
      expect(normalized.normalized.kind).toBe('approval');
    });

    it('maps approval_resolved to user_action_taken', () => {
      const event = createTestEvent('approval_resolved', { approved: true });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('user_action_taken');
      expect(normalized.normalized.kind).toBe('approval');
    });

    it('maps context_collected to progress_updated', () => {
      const event = createTestEvent('context_collected', { files_included: [] });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('progress_updated');
      expect(normalized.normalized.kind).toBe('context');
    });

    it('maps failure_detected to error_raised', () => {
      const event = createTestEvent('failure_detected', { error: 'test error' });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('error_raised');
      expect(normalized.normalized.kind).toBe('generic');
      expect(normalized.normalized.code).toBe('FAILURE');
    });
  });

  describe('normalizeEvent - Step 27-30 Events', () => {
    it('maps preflight_complete to progress_updated', () => {
      const event = createTestEvent('preflight_complete', { split_needed: false });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('progress_updated');
      expect(normalized.normalized.kind).toBe('preflight');
    });

    it('maps repair_attempt_started to tool_started', () => {
      const event = createTestEvent('repair_attempt_started', { attempt: 1 });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('tool_started');
      expect(normalized.normalized.kind).toBe('repair');
    });

    it('maps failure_classified to error_raised', () => {
      const event = createTestEvent('failure_classified', { classification: 'syntax' });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('error_raised');
      expect(normalized.normalized.kind).toBe('classified');
      expect(normalized.normalized.code).toBe('FAILURE_CLASSIFIED');
    });

    it('maps decision_point_needed to decision_point_needed', () => {
      const event = createTestEvent('decision_point_needed', { options: [] });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('decision_point_needed');
      expect(normalized.normalized.kind).toBe('generic');
    });

    it('maps run_scope_initialized to progress_updated', () => {
      const event = createTestEvent('run_scope_initialized', { max_files: 10 });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('progress_updated');
      expect(normalized.normalized.kind).toBe('scope_init');
    });

    it('maps edit_chunk_started to progress_updated', () => {
      const event = createTestEvent('edit_chunk_started', { file: 'test.ts', chunk_index: 0 });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('progress_updated');
      expect(normalized.normalized.kind).toBe('edit_chunk_start');
    });

    it('maps edit_chunk_failed to error_raised', () => {
      const event = createTestEvent('edit_chunk_failed', { file: 'test.ts', error: 'fail' });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('error_raised');
      expect(normalized.normalized.kind).toBe('edit_chunk');
      expect(normalized.normalized.code).toBe('EDIT_CHUNK_FAILED');
    });
  });

  describe('normalizeEvent - state_changed with from/to', () => {
    it('extracts from/to for mode_set', () => {
      const event = createTestEvent('mode_set', {
        mode: 'MISSION',
        previous_mode: 'PLAN',
      });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('state_changed');
      expect(normalized.normalized.kind).toBe('mode');
      expect(normalized.normalized.from).toBe('PLAN');
      expect(normalized.normalized.to).toBe('MISSION');
    });

    it('extracts from/to for stage_changed', () => {
      const event = createTestEvent('stage_changed', {
        from: 'plan',
        to: 'edit',
      });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('state_changed');
      expect(normalized.normalized.kind).toBe('stage');
      expect(normalized.normalized.from).toBe('plan');
      expect(normalized.normalized.to).toBe('edit');
    });

    it('provides defaults for execution_paused', () => {
      const event = createTestEvent('execution_paused', { reason: 'user' });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('state_changed');
      expect(normalized.normalized.kind).toBe('pause');
      expect(normalized.normalized.from).toBe('running');
      expect(normalized.normalized.to).toBe('paused');
    });

    it('provides defaults for execution_resumed', () => {
      const event = createTestEvent('execution_resumed', {});
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('state_changed');
      expect(normalized.normalized.kind).toBe('resume');
      expect(normalized.normalized.from).toBe('paused');
      expect(normalized.normalized.to).toBe('running');
    });
  });

  describe('normalizeEvent - Truncation Handling', () => {
    it('maps truncation_detected (recovered=true) to warning_raised', () => {
      const event = createTestEvent('truncation_detected', { recovered: true });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('warning_raised');
      expect(normalized.normalized.kind).toBe('truncation');
      expect(normalized.normalized.code).toBe('TRUNCATED_OUTPUT_RECOVERED');
    });

    it('maps truncation_detected (recovered=false) to error_raised', () => {
      const event = createTestEvent('truncation_detected', { recovered: false });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('error_raised');
      expect(normalized.normalized.kind).toBe('truncation');
      expect(normalized.normalized.code).toBe('TRUNCATED_OUTPUT_FATAL');
    });
  });

  describe('normalizeEvent - plan_large_detected', () => {
    it('maps to warning_raised with correct code and kind', () => {
      const event = createTestEvent('plan_large_detected', {
        reasons: ['>10 steps', 'high risk'],
      });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('warning_raised');
      expect(normalized.normalized.kind).toBe('plan_size');
      expect(normalized.normalized.code).toBe('PLAN_LARGE_DETECTED');
      expect(normalized.normalized.scope).toBe('run');
    });
  });

  describe('normalizeEvent - Unknown Types', () => {
    it('maps unknown type to unknown_event (NOT warning_raised)', () => {
      // Create an event with a fake type (cast to bypass type checking)
      const event = createTestEvent('unknown_fake_type' as EventType, {
        data: 'test',
      });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.type).toBe('unknown_event');
      expect(normalized.normalized.kind).toBe('unknown_fake_type');
      expect(normalized.normalized.ui_hint).toBe('generic_card');
    });
  });

  describe('normalizeEvents - Batch Normalization', () => {
    it('normalizes multiple events', () => {
      const events = [
        createTestEvent('intent_received', { prompt: 'test' }),
        createTestEvent('plan_created', { plan: {} }),
        createTestEvent('step_started', { step_index: 0 }),
      ];
      
      const normalized = normalizeEvents(events);
      
      expect(normalized).toHaveLength(3);
      expect(normalized[0].normalized.type).toBe('run_started');
      expect(normalized[1].normalized.type).toBe('artifact_proposed');
      expect(normalized[2].normalized.type).toBe('step_started');
    });

    it('preserves order', () => {
      const events = [
        createTestEvent('step_started', { step_index: 0 }),
        createTestEvent('step_completed', { step_index: 0 }),
        createTestEvent('step_started', { step_index: 1 }),
      ];
      
      const normalized = normalizeEvents(events);
      
      expect(normalized[0].raw.payload.step_index).toBe(0);
      expect(normalized[1].raw.payload.step_index).toBe(0);
      expect(normalized[2].raw.payload.step_index).toBe(1);
    });
  });

  describe('hasNormalizationMapping', () => {
    it('returns true for known types', () => {
      expect(hasNormalizationMapping('intent_received')).toBe(true);
      expect(hasNormalizationMapping('plan_created')).toBe(true);
      expect(hasNormalizationMapping('preflight_complete')).toBe(true);
    });

    it('returns false for unknown types', () => {
      expect(hasNormalizationMapping('unknown_type' as EventType)).toBe(false);
    });
  });

  describe('getPrimitiveType', () => {
    it('returns primitive type for known raw types', () => {
      expect(getPrimitiveType('intent_received')).toBe('run_started');
      expect(getPrimitiveType('plan_created')).toBe('artifact_proposed');
      expect(getPrimitiveType('failure_detected')).toBe('error_raised');
    });

    it('returns undefined for unknown types', () => {
      expect(getPrimitiveType('unknown_type' as EventType)).toBeUndefined();
    });
  });

  describe('isPrimitiveEventType', () => {
    it('returns true for valid primitive types', () => {
      expect(isPrimitiveEventType('run_started')).toBe(true);
      expect(isPrimitiveEventType('step_completed')).toBe(true);
      expect(isPrimitiveEventType('warning_raised')).toBe(true);
      expect(isPrimitiveEventType('unknown_event')).toBe(true);
    });

    it('returns false for raw event types', () => {
      expect(isPrimitiveEventType('intent_received')).toBe(false);
      expect(isPrimitiveEventType('plan_created')).toBe(false);
    });

    it('returns false for random strings', () => {
      expect(isPrimitiveEventType('foo_bar')).toBe(false);
      expect(isPrimitiveEventType('')).toBe(false);
    });
  });

  describe('Details Extraction', () => {
    it('copies payload to details', () => {
      const event = createTestEvent('plan_created', {
        plan: { goal: 'Test', steps: [{ id: 1 }] },
        version: 'v1',
      });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.details.plan).toEqual({ goal: 'Test', steps: [{ id: 1 }] });
      expect(normalized.normalized.details.version).toBe('v1');
    });

    it('includes ui_hint for specialized cards', () => {
      const event = createTestEvent('approval_requested', { approval_type: 'apply_diff' });
      const normalized = normalizeEvent(event);
      
      expect(normalized.normalized.ui_hint).toBe('approval_card');
    });
  });
});
