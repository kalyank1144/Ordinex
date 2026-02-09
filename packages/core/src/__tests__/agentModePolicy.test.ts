/**
 * V9: Agent Mode Policy Tests
 *
 * Tests ModeManager.setMode() transition result, isEscalation(), isDowngrade(),
 * and mode permission enforcement.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ModeManager, ModeTransitionResult, isEscalation, isDowngrade } from '../modeManager';
import type { Mode } from '../types';

// ============================================================================
// isEscalation / isDowngrade
// ============================================================================

describe('isEscalation', () => {
  it('should detect ANSWER → PLAN as escalation', () => {
    expect(isEscalation('ANSWER', 'PLAN')).toBe(true);
  });

  it('should detect ANSWER → MISSION as escalation', () => {
    expect(isEscalation('ANSWER', 'MISSION')).toBe(true);
  });

  it('should detect PLAN → MISSION as escalation', () => {
    expect(isEscalation('PLAN', 'MISSION')).toBe(true);
  });

  it('should NOT detect same mode as escalation', () => {
    expect(isEscalation('ANSWER', 'ANSWER')).toBe(false);
    expect(isEscalation('PLAN', 'PLAN')).toBe(false);
    expect(isEscalation('MISSION', 'MISSION')).toBe(false);
  });

  it('should NOT detect downgrades as escalation', () => {
    expect(isEscalation('MISSION', 'PLAN')).toBe(false);
    expect(isEscalation('MISSION', 'ANSWER')).toBe(false);
    expect(isEscalation('PLAN', 'ANSWER')).toBe(false);
  });
});

describe('isDowngrade', () => {
  it('should detect MISSION → PLAN as downgrade', () => {
    expect(isDowngrade('MISSION', 'PLAN')).toBe(true);
  });

  it('should detect MISSION → ANSWER as downgrade', () => {
    expect(isDowngrade('MISSION', 'ANSWER')).toBe(true);
  });

  it('should detect PLAN → ANSWER as downgrade', () => {
    expect(isDowngrade('PLAN', 'ANSWER')).toBe(true);
  });

  it('should NOT detect same mode as downgrade', () => {
    expect(isDowngrade('ANSWER', 'ANSWER')).toBe(false);
    expect(isDowngrade('PLAN', 'PLAN')).toBe(false);
    expect(isDowngrade('MISSION', 'MISSION')).toBe(false);
  });

  it('should NOT detect escalations as downgrade', () => {
    expect(isDowngrade('ANSWER', 'PLAN')).toBe(false);
    expect(isDowngrade('ANSWER', 'MISSION')).toBe(false);
    expect(isDowngrade('PLAN', 'MISSION')).toBe(false);
  });
});

// ============================================================================
// ModeManager.setMode() — ModeTransitionResult
// ============================================================================

describe('ModeManager.setMode() returns ModeTransitionResult', () => {
  let manager: ModeManager;

  beforeEach(() => {
    manager = new ModeManager('task_1');
  });

  it('should return changed=true when mode actually changes', () => {
    const result: ModeTransitionResult = manager.setMode('PLAN');
    expect(result.changed).toBe(true);
    expect(result.from_mode).toBe('ANSWER');
    expect(result.to_mode).toBe('PLAN');
  });

  it('should return changed=false when mode stays the same', () => {
    const result: ModeTransitionResult = manager.setMode('ANSWER');
    expect(result.changed).toBe(false);
    expect(result.from_mode).toBe('ANSWER');
    expect(result.to_mode).toBe('ANSWER');
  });

  it('should track sequential transitions correctly', () => {
    const r1 = manager.setMode('PLAN');
    expect(r1).toEqual({ changed: true, from_mode: 'ANSWER', to_mode: 'PLAN' });

    const r2 = manager.setMode('MISSION');
    expect(r2).toEqual({ changed: true, from_mode: 'PLAN', to_mode: 'MISSION' });

    const r3 = manager.setMode('ANSWER');
    expect(r3).toEqual({ changed: true, from_mode: 'MISSION', to_mode: 'ANSWER' });
  });

  it('should reset stage when switching away from MISSION', () => {
    manager.setMode('MISSION');
    manager.setStage('edit');
    expect(manager.getStage()).toBe('edit');

    manager.setMode('PLAN');
    expect(manager.getStage()).toBe('none');
  });

  it('should preserve stage when staying in MISSION', () => {
    manager.setMode('MISSION');
    manager.setStage('edit');

    const result = manager.setMode('MISSION');
    expect(result.changed).toBe(false);
    expect(manager.getStage()).toBe('edit');
  });

  it('should update getMode() after transition', () => {
    expect(manager.getMode()).toBe('ANSWER');
    manager.setMode('MISSION');
    expect(manager.getMode()).toBe('MISSION');
  });
});

// ============================================================================
// Mode permission matrix validation
// ============================================================================

describe('Mode permission enforcement', () => {
  let manager: ModeManager;

  beforeEach(() => {
    manager = new ModeManager('task_1');
  });

  it('ANSWER mode: allows read_file and retrieve only', () => {
    manager.setMode('ANSWER');
    expect(manager.validateAction('read_file').allowed).toBe(true);
    expect(manager.validateAction('retrieve').allowed).toBe(true);
    expect(manager.validateAction('write_file').allowed).toBe(false);
    expect(manager.validateAction('execute_command').allowed).toBe(false);
    expect(manager.validateAction('diff').allowed).toBe(false);
    expect(manager.validateAction('plan').allowed).toBe(false);
  });

  it('PLAN mode: allows read_file, retrieve, and plan only', () => {
    manager.setMode('PLAN');
    expect(manager.validateAction('read_file').allowed).toBe(true);
    expect(manager.validateAction('retrieve').allowed).toBe(true);
    expect(manager.validateAction('plan').allowed).toBe(true);
    expect(manager.validateAction('write_file').allowed).toBe(false);
    expect(manager.validateAction('execute_command').allowed).toBe(false);
    expect(manager.validateAction('diff').allowed).toBe(false);
  });

  it('MISSION mode: allows all actions', () => {
    manager.setMode('MISSION');
    expect(manager.validateAction('read_file').allowed).toBe(true);
    expect(manager.validateAction('write_file').allowed).toBe(true);
    expect(manager.validateAction('execute_command').allowed).toBe(true);
    expect(manager.validateAction('retrieve').allowed).toBe(true);
    expect(manager.validateAction('plan').allowed).toBe(true);
    expect(manager.validateAction('diff').allowed).toBe(true);
    expect(manager.validateAction('checkpoint').allowed).toBe(true);
  });

  it('violation includes action and mode info', () => {
    manager.setMode('ANSWER');
    const result = manager.validateAction('write_file');
    expect(result.allowed).toBe(false);
    expect(result.violation?.attemptedAction).toBe('write_file');
    expect(result.violation?.currentMode).toBe('ANSWER');
    expect(result.violation?.reason).toContain('write_file');
    expect(result.violation?.reason).toContain('ANSWER');
  });
});

// ============================================================================
// Transition + escalation combined scenarios
// ============================================================================

describe('Escalation detection on ModeTransitionResult', () => {
  let manager: ModeManager;

  beforeEach(() => {
    manager = new ModeManager('task_1');
  });

  it('can combine setMode result with isEscalation', () => {
    const result = manager.setMode('MISSION');
    expect(isEscalation(result.from_mode, result.to_mode)).toBe(true);
    expect(isDowngrade(result.from_mode, result.to_mode)).toBe(false);
  });

  it('can detect downgrade after transition', () => {
    manager.setMode('MISSION');
    const result = manager.setMode('ANSWER');
    expect(isDowngrade(result.from_mode, result.to_mode)).toBe(true);
    expect(isEscalation(result.from_mode, result.to_mode)).toBe(false);
  });

  it('no-op transition is neither escalation nor downgrade', () => {
    const result = manager.setMode('ANSWER');
    expect(result.changed).toBe(false);
    expect(isEscalation(result.from_mode, result.to_mode)).toBe(false);
    expect(isDowngrade(result.from_mode, result.to_mode)).toBe(false);
  });

  it('all 6 possible transitions classified correctly', () => {
    const transitions: Array<{ from: Mode; to: Mode; escalation: boolean; downgrade: boolean }> = [
      { from: 'ANSWER', to: 'PLAN', escalation: true, downgrade: false },
      { from: 'ANSWER', to: 'MISSION', escalation: true, downgrade: false },
      { from: 'PLAN', to: 'MISSION', escalation: true, downgrade: false },
      { from: 'MISSION', to: 'PLAN', escalation: false, downgrade: true },
      { from: 'MISSION', to: 'ANSWER', escalation: false, downgrade: true },
      { from: 'PLAN', to: 'ANSWER', escalation: false, downgrade: true },
    ];

    for (const t of transitions) {
      expect(isEscalation(t.from, t.to)).toBe(t.escalation);
      expect(isDowngrade(t.from, t.to)).toBe(t.downgrade);
    }
  });
});
