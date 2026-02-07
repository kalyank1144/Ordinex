/**
 * Step 42: Intent Routing Hardened Test Suite
 *
 * Table-driven tests loaded from a golden fixture JSON.
 * Every case is a locked regression — do NOT change expected intents
 * without team review.
 *
 * Uses routeUserInput() (heuristic-only, no LLM) as the single
 * testable entry point.
 */

import { describe, it, expect } from 'vitest';
import {
  routeUserInput,
  routeIntent,
  isDefinitelyScaffold,
  isDefinitelyRunCommand,
  shouldCallLLM,
  generateClarificationQuestion,
} from '../intent/intentRouter';
import {
  detectGreenfieldIntent,
  detectCommandIntent,
  detectEditScale,
  detectSlashOverride,
  normalizeUserInput,
} from '../intent/intentSignals';

import goldenCases from './fixtures/intentRoutingCases.json';

// ============================================================================
// TYPE for golden fixture
// ============================================================================

interface GoldenCase {
  id: string;
  group: string;
  input: string;
  expectedIntent: string;
  expectedIntentNot?: string;
  note: string;
}

const cases: GoldenCase[] = goldenCases.cases;

// ============================================================================
// TABLE-DRIVEN GOLDEN TESTS
// ============================================================================

describe('Step 42: Intent Routing Golden Fixture', () => {
  // Group A: SCAFFOLD
  describe('A — SCAFFOLD routing', () => {
    const scaffoldCases = cases.filter(c => c.group === 'A-scaffold');

    scaffoldCases.forEach(({ id, input, expectedIntent, note }) => {
      it(`[${id}] "${input.slice(0, 50)}" → ${expectedIntent}  (${note})`, async () => {
        const result = await routeUserInput(input);
        expect(result.intent).toBe(expectedIntent);
      });
    });
  });

  // Group B: RUN_COMMAND
  describe('B — RUN_COMMAND routing', () => {
    const commandCases = cases.filter(c => c.group === 'B-command');

    commandCases.forEach(({ id, input, expectedIntent, note }) => {
      it(`[${id}] "${input.slice(0, 50)}" → ${expectedIntent}  (${note})`, async () => {
        const result = await routeUserInput(input);
        expect(result.intent).toBe(expectedIntent);
      });
    });
  });

  // Group C: PLAN
  describe('C — PLAN routing', () => {
    const planCases = cases.filter(c => c.group === 'C-plan');

    planCases.forEach(({ id, input, expectedIntent, note }) => {
      it(`[${id}] "${input.slice(0, 50)}" → ${expectedIntent}  (${note})`, async () => {
        const result = await routeUserInput(input);
        expect(result.intent).toBe(expectedIntent);
      });
    });
  });

  // Group D: QUICK_ACTION
  describe('D — QUICK_ACTION routing', () => {
    const quickCases = cases.filter(c => c.group === 'D-quickAction');

    quickCases.forEach(({ id, input, expectedIntent, note }) => {
      it(`[${id}] "${input.slice(0, 50)}" → ${expectedIntent}  (${note})`, async () => {
        const result = await routeUserInput(input);
        expect(result.intent).toBe(expectedIntent);
      });
    });
  });

  // Group E: ANSWER
  describe('E — ANSWER routing', () => {
    const answerCases = cases.filter(c => c.group === 'E-answer');

    answerCases.forEach(({ id, input, expectedIntent, note }) => {
      it(`[${id}] "${input.slice(0, 50)}" → ${expectedIntent}  (${note})`, async () => {
        const result = await routeUserInput(input);
        expect(result.intent).toBe(expectedIntent);
      });
    });
  });

  // Group F: Slash overrides
  describe('F — Slash override routing', () => {
    const slashCases = cases.filter(c => c.group === 'F-slash');

    slashCases.forEach(({ id, input, expectedIntent, note }) => {
      it(`[${id}] "${input.slice(0, 50)}" → ${expectedIntent}  (${note})`, async () => {
        const result = await routeUserInput(input);
        expect(result.intent).toBe(expectedIntent);
        expect(result.source).toBe('slash');
        expect(result.confidence).toBe(1.0);
      });
    });
  });

  // Group G: Edge cases
  describe('G — Edge cases', () => {
    const edgeCases = cases.filter(c => c.group === 'G-edge');

    edgeCases.forEach(({ id, input, expectedIntent, expectedIntentNot, note }) => {
      it(`[${id}] "${input.slice(0, 50)}" → ${expectedIntent}  (${note})`, async () => {
        const result = await routeUserInput(input);
        expect(result.intent).toBe(expectedIntent);
        if (expectedIntentNot) {
          expect(result.intent).not.toBe(expectedIntentNot);
        }
      });
    });
  });
});

// ============================================================================
// CRITICAL REGRESSION LOCKS
// ============================================================================

describe('Step 42: Critical Regression Locks', () => {
  it('REGRESSION: "Creating a new fitness app" → SCAFFOLD', async () => {
    const result = await routeUserInput('Creating a new fitness app');
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('REGRESSION: "Run the app" → RUN_COMMAND', async () => {
    const result = await routeUserInput('Run the app');
    expect(result.intent).toBe('RUN_COMMAND');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('REGRESSION: "app" alone NEVER triggers RUN_COMMAND', async () => {
    const result = await routeUserInput('app');
    expect(result.intent).not.toBe('RUN_COMMAND');
    expect(result.intent).not.toBe('SCAFFOLD');
  });

  it('REGRESSION: "Run the tests" → RUN_COMMAND', async () => {
    const result = await routeUserInput('Run the tests');
    expect(result.intent).toBe('RUN_COMMAND');
  });

  it('REGRESSION: "What is React?" → ANSWER', async () => {
    const result = await routeUserInput('What is React?');
    expect(result.intent).toBe('ANSWER');
  });

  it('REGRESSION: "npm run dev" → RUN_COMMAND', async () => {
    const result = await routeUserInput('npm run dev');
    expect(result.intent).toBe('RUN_COMMAND');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('REGRESSION: "Start the dev server" → RUN_COMMAND', async () => {
    const result = await routeUserInput('Start the dev server');
    expect(result.intent).toBe('RUN_COMMAND');
  });

  it('REGRESSION: "/scaffold" always wins', async () => {
    const result = await routeUserInput('/scaffold make button blue');
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('slash');
  });
});

// ============================================================================
// SIGNAL-LEVEL UNIT TESTS (for debugging failures)
// ============================================================================

describe('Step 42: Signal-level checks', () => {
  describe('normalizeUserInput', () => {
    it('trims whitespace', () => {
      expect(normalizeUserInput('  hello  ')).toBe('hello');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeUserInput('hello   world')).toBe('hello world');
    });

    it('converts to lowercase', () => {
      expect(normalizeUserInput('Hello World')).toBe('hello world');
    });
  });

  describe('detectGreenfieldIntent', () => {
    it('detects strong greenfield with high confidence', () => {
      const result = detectGreenfieldIntent('Creating a new fitness app');
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('rejects "run the dev server" (exclusion)', () => {
      const result = detectGreenfieldIntent('run the dev server');
      expect(result.isMatch).toBe(false);
    });

    it('rejects "fix the login bug" (exclusion)', () => {
      const result = detectGreenfieldIntent('fix the login bug');
      expect(result.isMatch).toBe(false);
    });

    it('rejects "Run the app" (exclusion)', () => {
      const result = detectGreenfieldIntent('Run the app');
      expect(result.isMatch).toBe(false);
    });

    it('rejects "why is my app crashing?" (exclusion)', () => {
      const result = detectGreenfieldIntent('why is my app crashing?');
      expect(result.isMatch).toBe(false);
    });
  });

  describe('detectCommandIntent', () => {
    it('detects explicit npm commands (confidence ≥ 0.9)', () => {
      const result = detectCommandIntent('npm run dev');
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects "run the tests" (verb + target)', () => {
      const result = detectCommandIntent('run the tests');
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detects "Run the app" (verb + target)', () => {
      const result = detectCommandIntent('Run the app');
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detects "Start the development server"', () => {
      const result = detectCommandIntent('Start the development server');
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('rejects greenfield requests', () => {
      const result = detectCommandIntent('Creating a new fitness app');
      expect(result.isMatch).toBe(false);
    });

    it('rejects questions', () => {
      const result = detectCommandIntent('What does npm run dev do?');
      expect(result.isMatch).toBe(false);
    });

    it('"app" alone has low confidence (< 0.85)', () => {
      const result = detectCommandIntent('app');
      // "app" alone: no verb → target-only → confidence 0.6
      if (result.isMatch) {
        expect(result.confidence).toBeLessThan(0.85);
      }
    });
  });

  describe('detectEditScale', () => {
    it('detects trivial edits', () => {
      const result = detectEditScale('fix typo in README');
      expect(result.scale).toBe('trivial');
    });

    it('detects large edits (refactor)', () => {
      const result = detectEditScale('refactor the entire auth module');
      expect(['large', 'medium']).toContain(result.scale);
    });

    it('detects greenfield as large', () => {
      const result = detectEditScale('Create a new React app');
      expect(result.scale).toBe('large');
    });

    it('detects multi-step as medium+', () => {
      const result = detectEditScale('first update the DB then fix the API');
      expect(['large', 'medium']).toContain(result.scale);
    });
  });

  describe('detectSlashOverride', () => {
    it('detects /scaffold', () => {
      expect(detectSlashOverride('/scaffold my app')).toBe('scaffold');
    });

    it('detects /plan', () => {
      expect(detectSlashOverride('/plan big feature')).toBe('plan');
    });

    it('detects /run', () => {
      expect(detectSlashOverride('/run tests')).toBe('run');
    });

    it('detects /answer', () => {
      expect(detectSlashOverride('/answer what is react')).toBe('answer');
    });

    it('detects /do → run', () => {
      expect(detectSlashOverride('/do tests')).toBe('run');
    });

    it('detects /ask → answer', () => {
      expect(detectSlashOverride('/ask what is react')).toBe('answer');
    });

    it('returns null for regular prompts', () => {
      expect(detectSlashOverride('make a button blue')).toBe(null);
    });
  });
});

// ============================================================================
// ROUTER HELPERS
// ============================================================================

describe('Step 42: Router helpers', () => {
  describe('isDefinitelyScaffold', () => {
    it('true for /scaffold override', () => {
      expect(isDefinitelyScaffold('/scaffold my app')).toBe(true);
    });

    it('true for high-confidence greenfield', () => {
      expect(isDefinitelyScaffold('Create a new React app')).toBe(true);
    });

    it('false for questions', () => {
      expect(isDefinitelyScaffold('What is React?')).toBe(false);
    });

    it('false for commands', () => {
      expect(isDefinitelyScaffold('npm run dev')).toBe(false);
    });
  });

  describe('isDefinitelyRunCommand', () => {
    it('true for /run override', () => {
      expect(isDefinitelyRunCommand('/run tests')).toBe(true);
    });

    it('true for explicit commands', () => {
      expect(isDefinitelyRunCommand('npm run dev')).toBe(true);
    });

    it('false for greenfield', () => {
      expect(isDefinitelyRunCommand('Create a new app')).toBe(false);
    });

    it('false for questions', () => {
      expect(isDefinitelyRunCommand('What is React?')).toBe(false);
    });
  });

  describe('shouldCallLLM', () => {
    it('false for high confidence cases', () => {
      expect(shouldCallLLM('npm run dev', 0.9)).toBe(false);
    });

    it('true for ambiguous cases', () => {
      expect(shouldCallLLM('app stuff', 0.4)).toBe(true);
    });
  });

  describe('generateClarificationQuestion', () => {
    it('asks about project creation for greenfield ambiguity', () => {
      const q = generateClarificationQuestion({
        greenfield: { isMatch: true, confidence: 0.5, reason: 'test' },
        command: { isMatch: false, confidence: 0.1, reason: 'test' },
      });
      expect(q.question).toContain('new project');
    });

    it('asks about commands for command ambiguity', () => {
      const q = generateClarificationQuestion({
        greenfield: { isMatch: false, confidence: 0.1, reason: 'test' },
        command: { isMatch: true, confidence: 0.5, reason: 'test' },
      });
      expect(q.question).toContain('command');
    });

    it('provides general question as fallback', () => {
      const q = generateClarificationQuestion({
        greenfield: { isMatch: false, confidence: 0.1, reason: 'test' },
        command: { isMatch: false, confidence: 0.1, reason: 'test' },
      });
      expect(q.question).toContain('What would you like');
    });
  });

  describe('routeIntent replay', () => {
    it('uses cached result when isReplay + previousRoutingResult', async () => {
      const previous = {
        intent: 'SCAFFOLD' as const,
        source: 'heuristic' as const,
        confidence: 0.9,
        reasoning: 'Previous routing',
        llmCalled: false,
      };
      const result = await routeIntent('Creating a new app', {
        isReplay: true,
        previousRoutingResult: previous,
      });
      expect(result.intent).toBe('SCAFFOLD');
      expect(result.reasoning).toContain('[REPLAY]');
    });
  });
});

// ============================================================================
// METADATA & SIGNAL DEBUGGING
// ============================================================================

describe('Step 42: Routing metadata', () => {
  it('routeUserInput returns signals in result', async () => {
    const result = await routeUserInput('Creating a new fitness app');
    expect(result.signals).toBeDefined();
    expect(result.signals!.greenfield).toBeDefined();
    expect(result.signals!.command).toBeDefined();
  });

  it('heuristic routes set llmCalled=false', async () => {
    const result = await routeUserInput('npm run dev');
    expect(result.llmCalled).toBe(false);
  });

  it('slash overrides have confidence 1.0', async () => {
    const result = await routeUserInput('/scaffold new app');
    expect(result.confidence).toBe(1.0);
    expect(result.source).toBe('slash');
  });

  it('provides human-readable reasoning', async () => {
    const result = await routeUserInput('Creating a new fitness app');
    expect(result.reasoning.length).toBeGreaterThan(0);
  });
});
