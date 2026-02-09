/**
 * Autonomy Loop Detector (W3): Pure detection functions for stuck/regressing/oscillating loops.
 *
 * P1 compliant: No side effects, no event emission, no FS access.
 * All detection is pure-functional over an array of IterationOutcome records.
 */

import { LoopType } from './types';

/**
 * Outcome record for a single autonomy iteration.
 * Callers build this after each iteration completes.
 */
export interface IterationOutcome {
  iteration: number;
  success: boolean;
  failureSignature: string | null;
  testPassCount: number;  // -1 if unknown
  testFailCount: number;  // -1 if unknown
  filesTouched: string[];
}

/**
 * Result of loop detection analysis.
 */
export interface LoopDetectionResult {
  detected: boolean;
  loopType: LoopType | null;
  evidence: Record<string, unknown>;
  recommendation: string;
}

const NO_LOOP: LoopDetectionResult = {
  detected: false,
  loopType: null,
  evidence: {},
  recommendation: '',
};

/**
 * Detect "stuck" pattern: same failure repeating.
 *
 * Triggers if:
 *   - Same failureSignature in 2 of the last 3 iterations, OR
 *   - 3+ consecutive identical failureSignatures.
 */
export function detectStuck(history: IterationOutcome[]): LoopDetectionResult {
  if (history.length < 2) return NO_LOOP;

  // Check 3+ consecutive (requires at least 3 entries)
  if (history.length >= 3) {
    const last3 = history.slice(-3);
    const sigs = last3.map(o => o.failureSignature).filter(s => s !== null);
    if (sigs.length === 3 && sigs[0] === sigs[1] && sigs[1] === sigs[2]) {
      return {
        detected: true,
        loopType: 'stuck',
        evidence: { signature: sigs[0], occurrences: 3, window: 3 },
        recommendation: 'Same failure repeated 3 times consecutively. Consider a different repair strategy or ask the user for guidance.',
      };
    }
  }

  // Check 2-of-3 rule (requires at least 3 entries)
  if (history.length >= 3) {
    const last3 = history.slice(-3);
    const sigs = last3.map(o => o.failureSignature).filter(s => s !== null);
    if (sigs.length >= 2) {
      // Count occurrences of each signature
      const counts = new Map<string, number>();
      for (const sig of sigs) {
        counts.set(sig, (counts.get(sig) || 0) + 1);
      }
      for (const [sig, count] of counts) {
        if (count >= 2) {
          return {
            detected: true,
            loopType: 'stuck',
            evidence: { signature: sig, occurrences: count, window: 3 },
            recommendation: `Same failure "${sig}" appeared ${count} times in last 3 iterations. The repair strategy is not making progress.`,
          };
        }
      }
    }
  }

  return NO_LOOP;
}

/**
 * Detect "regressing" pattern: test pass count strictly decreasing.
 *
 * Triggers if testPassCount is strictly decreasing across the last 3 iterations
 * and all values are valid (not -1).
 */
export function detectRegressing(history: IterationOutcome[]): LoopDetectionResult {
  if (history.length < 3) return NO_LOOP;

  const last3 = history.slice(-3);
  const passCounts = last3.map(o => o.testPassCount);

  // All must be valid
  if (passCounts.some(c => c === -1)) return NO_LOOP;

  // Strictly decreasing
  if (passCounts[0] > passCounts[1] && passCounts[1] > passCounts[2]) {
    return {
      detected: true,
      loopType: 'regressing',
      evidence: { passCounts, trend: 'decreasing' },
      recommendation: `Test pass count is declining (${passCounts.join(' → ')}). Repairs are making things worse. Stop and reassess.`,
    };
  }

  return NO_LOOP;
}

/**
 * Detect "oscillating" pattern: A-B-A-B in failure signatures or success values.
 *
 * Triggers if:
 *   - Last 4 failureSignatures show A-B-A-B pattern (with non-null values), OR
 *   - Last 4 success values alternate true-false-true-false.
 */
export function detectOscillating(history: IterationOutcome[]): LoopDetectionResult {
  if (history.length < 4) return NO_LOOP;

  const last4 = history.slice(-4);

  // Check failure signature oscillation (A-B-A-B)
  const sigs = last4.map(o => o.failureSignature);
  if (sigs.every(s => s !== null)) {
    if (sigs[0] === sigs[2] && sigs[1] === sigs[3] && sigs[0] !== sigs[1]) {
      return {
        detected: true,
        loopType: 'oscillating',
        evidence: { pattern: sigs, cycleLength: 2 },
        recommendation: `Failure oscillating between "${sigs[0]}" and "${sigs[1]}". Repairs are flip-flopping between two states.`,
      };
    }
  }

  // Check success oscillation (T-F-T-F or F-T-F-T)
  const successes = last4.map(o => o.success);
  if (
    successes[0] === successes[2] &&
    successes[1] === successes[3] &&
    successes[0] !== successes[1]
  ) {
    return {
      detected: true,
      loopType: 'oscillating',
      evidence: { pattern: successes, cycleLength: 2 },
      recommendation: 'Success/failure oscillating. Repairs are undoing each other.',
    };
  }

  return NO_LOOP;
}

/**
 * Detect "scope creep" pattern: files touched exceed declared scope.
 *
 * Triggers if the union of all filesTouched across history exceeds declaredScope.
 */
export function detectScopeCreep(
  history: IterationOutcome[],
  declaredScope?: string[],
): LoopDetectionResult {
  if (!declaredScope || declaredScope.length === 0) return NO_LOOP;
  if (history.length === 0) return NO_LOOP;

  const allTouched = new Set<string>();
  for (const outcome of history) {
    for (const file of outcome.filesTouched) {
      allTouched.add(file);
    }
  }

  const declaredSet = new Set(declaredScope);
  const outOfScopeFiles = [...allTouched].filter(f => !declaredSet.has(f));

  if (outOfScopeFiles.length > 0) {
    return {
      detected: true,
      loopType: 'scope_creep',
      evidence: {
        outOfScopeFiles,
        declaredCount: declaredScope.length,
        touchedCount: allTouched.size,
      },
      recommendation: `${outOfScopeFiles.length} file(s) outside declared scope were modified. Repairs are expanding beyond the original task.`,
    };
  }

  return NO_LOOP;
}

/**
 * Run all 4 detectors in priority order and return first match.
 *
 * Priority: stuck > regressing > oscillating > scope_creep
 */
export function detectLoop(
  history: IterationOutcome[],
  declaredScope?: string[],
): LoopDetectionResult {
  const stuck = detectStuck(history);
  if (stuck.detected) return stuck;

  const regressing = detectRegressing(history);
  if (regressing.detected) return regressing;

  const oscillating = detectOscillating(history);
  if (oscillating.detected) return oscillating;

  const scopeCreep = detectScopeCreep(history, declaredScope);
  if (scopeCreep.detected) return scopeCreep;

  return NO_LOOP;
}
