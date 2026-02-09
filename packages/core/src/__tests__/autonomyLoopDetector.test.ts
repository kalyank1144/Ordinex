/**
 * Autonomy Loop Detector Tests (W3)
 *
 * Verifies all 4 detection patterns:
 *   - stuck (2-of-3 and 3-consecutive)
 *   - regressing (strictly decreasing test pass count)
 *   - oscillating (A-B-A-B failure signatures or success alternation)
 *   - scope_creep (files outside declared scope)
 *   - detectLoop combined (priority order)
 */

import { describe, test, expect } from 'vitest';
import {
  detectStuck,
  detectRegressing,
  detectOscillating,
  detectScopeCreep,
  detectLoop,
  IterationOutcome,
} from '../autonomyLoopDetector';

function makeOutcome(
  iteration: number,
  overrides: Partial<IterationOutcome> = {},
): IterationOutcome {
  return {
    iteration,
    success: false,
    failureSignature: null,
    testPassCount: -1,
    testFailCount: -1,
    filesTouched: [],
    ...overrides,
  };
}

describe('detectStuck', () => {
  test('2-of-3 same signature → detected', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'TypeError: x is undefined' }),
      makeOutcome(2, { failureSignature: 'SyntaxError: unexpected token' }),
      makeOutcome(3, { failureSignature: 'TypeError: x is undefined' }),
    ];
    const result = detectStuck(history);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('stuck');
    expect(result.evidence.signature).toBe('TypeError: x is undefined');
    expect(result.evidence.occurrences).toBe(2);
  });

  test('3 consecutive same signature → detected', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Build failed' }),
      makeOutcome(2, { failureSignature: 'Build failed' }),
      makeOutcome(3, { failureSignature: 'Build failed' }),
    ];
    const result = detectStuck(history);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('stuck');
    expect(result.evidence.occurrences).toBe(3);
  });

  test('1-of-3 same signature → NOT detected', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error B' }),
      makeOutcome(3, { failureSignature: 'Error C' }),
    ];
    const result = detectStuck(history);
    expect(result.detected).toBe(false);
  });

  test('different signatures → NOT detected', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error B' }),
    ];
    const result = detectStuck(history);
    expect(result.detected).toBe(false);
  });

  test('only 1 iteration → NOT detected', () => {
    const history = [makeOutcome(1, { failureSignature: 'Error A' })];
    const result = detectStuck(history);
    expect(result.detected).toBe(false);
  });

  test('null signatures → NOT detected', () => {
    const history = [
      makeOutcome(1),
      makeOutcome(2),
      makeOutcome(3),
    ];
    const result = detectStuck(history);
    expect(result.detected).toBe(false);
  });

  test('2 consecutive but not 2-of-3 (only 2 items) → NOT detected', () => {
    // With only 2 items, the 2-of-3 rule needs 3 items
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error A' }),
    ];
    const result = detectStuck(history);
    expect(result.detected).toBe(false);
  });
});

describe('detectRegressing', () => {
  test('strictly decreasing pass counts → detected', () => {
    const history = [
      makeOutcome(1, { testPassCount: 8 }),
      makeOutcome(2, { testPassCount: 6 }),
      makeOutcome(3, { testPassCount: 4 }),
    ];
    const result = detectRegressing(history);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('regressing');
    expect(result.evidence.passCounts).toEqual([8, 6, 4]);
    expect(result.evidence.trend).toBe('decreasing');
  });

  test('increasing pass counts → NOT detected', () => {
    const history = [
      makeOutcome(1, { testPassCount: 4 }),
      makeOutcome(2, { testPassCount: 6 }),
      makeOutcome(3, { testPassCount: 8 }),
    ];
    const result = detectRegressing(history);
    expect(result.detected).toBe(false);
  });

  test('flat pass counts → NOT detected', () => {
    const history = [
      makeOutcome(1, { testPassCount: 8 }),
      makeOutcome(2, { testPassCount: 8 }),
      makeOutcome(3, { testPassCount: 8 }),
    ];
    const result = detectRegressing(history);
    expect(result.detected).toBe(false);
  });

  test('any -1 (unknown) → NOT detected', () => {
    const history = [
      makeOutcome(1, { testPassCount: 8 }),
      makeOutcome(2, { testPassCount: -1 }),
      makeOutcome(3, { testPassCount: 4 }),
    ];
    const result = detectRegressing(history);
    expect(result.detected).toBe(false);
  });

  test('fewer than 3 iterations → NOT detected', () => {
    const history = [
      makeOutcome(1, { testPassCount: 8 }),
      makeOutcome(2, { testPassCount: 6 }),
    ];
    const result = detectRegressing(history);
    expect(result.detected).toBe(false);
  });
});

describe('detectOscillating', () => {
  test('failure signatures A-B-A-B → detected', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error B' }),
      makeOutcome(3, { failureSignature: 'Error A' }),
      makeOutcome(4, { failureSignature: 'Error B' }),
    ];
    const result = detectOscillating(history);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('oscillating');
    expect(result.evidence.cycleLength).toBe(2);
  });

  test('success values T-F-T-F → detected', () => {
    const history = [
      makeOutcome(1, { success: true }),
      makeOutcome(2, { success: false }),
      makeOutcome(3, { success: true }),
      makeOutcome(4, { success: false }),
    ];
    const result = detectOscillating(history);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('oscillating');
  });

  test('all different signatures A-B-C-D → NOT detected', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error B' }),
      makeOutcome(3, { failureSignature: 'Error C' }),
      makeOutcome(4, { failureSignature: 'Error D' }),
    ];
    const result = detectOscillating(history);
    expect(result.detected).toBe(false);
  });

  test('fewer than 4 iterations → NOT detected', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error B' }),
      makeOutcome(3, { failureSignature: 'Error A' }),
    ];
    const result = detectOscillating(history);
    expect(result.detected).toBe(false);
  });

  test('all same signature → NOT detected (not oscillating, just stuck)', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error A' }),
      makeOutcome(3, { failureSignature: 'Error A' }),
      makeOutcome(4, { failureSignature: 'Error A' }),
    ];
    const result = detectOscillating(history);
    expect(result.detected).toBe(false);
  });
});

describe('detectScopeCreep', () => {
  test('all files within scope → NOT detected', () => {
    const history = [
      makeOutcome(1, { filesTouched: ['src/a.ts'] }),
      makeOutcome(2, { filesTouched: ['src/b.ts'] }),
    ];
    const result = detectScopeCreep(history, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(result.detected).toBe(false);
  });

  test('files outside scope → detected', () => {
    const history = [
      makeOutcome(1, { filesTouched: ['src/a.ts'] }),
      makeOutcome(2, { filesTouched: ['src/d.ts', 'src/e.ts'] }),
    ];
    const result = detectScopeCreep(history, ['src/a.ts', 'src/b.ts']);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('scope_creep');
    expect(result.evidence.outOfScopeFiles).toEqual(['src/d.ts', 'src/e.ts']);
    expect(result.evidence.declaredCount).toBe(2);
    expect(result.evidence.touchedCount).toBe(3);
  });

  test('no declared scope → NOT detected', () => {
    const history = [
      makeOutcome(1, { filesTouched: ['src/a.ts'] }),
    ];
    const result = detectScopeCreep(history);
    expect(result.detected).toBe(false);
  });

  test('empty history → NOT detected', () => {
    const result = detectScopeCreep([], ['src/a.ts']);
    expect(result.detected).toBe(false);
  });
});

describe('detectLoop (combined)', () => {
  test('stuck has priority over oscillating', () => {
    // This history triggers both stuck (2-of-3) and would trigger oscillating
    // if we added one more item. But stuck wins since it checks first.
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error B' }),
      makeOutcome(3, { failureSignature: 'Error A' }),
    ];
    const result = detectLoop(history);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('stuck');
  });

  test('clean history → NOT detected', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Error A' }),
      makeOutcome(2, { failureSignature: 'Error B' }),
    ];
    const result = detectLoop(history);
    expect(result.detected).toBe(false);
  });

  test('regressing detected when no stuck', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'Error A', testPassCount: 10 }),
      makeOutcome(2, { failureSignature: 'Error B', testPassCount: 7 }),
      makeOutcome(3, { failureSignature: 'Error C', testPassCount: 3 }),
    ];
    const result = detectLoop(history);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('regressing');
  });

  test('recommendation strings are non-empty', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'X' }),
      makeOutcome(2, { failureSignature: 'X' }),
      makeOutcome(3, { failureSignature: 'X' }),
    ];
    const result = detectLoop(history);
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  test('scope creep detected via combined function', () => {
    const history = [
      makeOutcome(1, { failureSignature: 'A', filesTouched: ['src/x.ts'] }),
      makeOutcome(2, { failureSignature: 'B', filesTouched: ['src/y.ts'] }),
    ];
    const result = detectLoop(history, ['src/x.ts']);
    expect(result.detected).toBe(true);
    expect(result.loopType).toBe('scope_creep');
  });
});
