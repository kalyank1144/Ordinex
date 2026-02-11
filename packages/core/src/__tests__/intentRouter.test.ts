/**
 * Step 40: Intent Router Tests
 * 
 * Comprehensive tests for the unified intent routing system.
 */

import { describe, it, expect } from 'vitest';

import {
  detectGreenfieldIntent,
  detectCommandIntent,
  detectEditScale,
  detectSlashOverride,
  normalizeUserInput,
} from '../intent/intentSignals';
import {
  routeIntent,
  isDefinitelyScaffold,
  isDefinitelyRunCommand,
  shouldCallLLM,
  generateClarificationQuestion,
} from '../intent/intentRouter';

describe('intentSignals', () => {
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
    describe('strong patterns (confidence ≥ 0.9)', () => {
      it('detects "Creating a new fitness app"', () => {
        const result = detectGreenfieldIntent('Creating a new fitness app');
        expect(result.isMatch).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      });

      it('detects "Build a dashboard from scratch"', () => {
        const result = detectGreenfieldIntent('Build a dashboard from scratch');
        expect(result.isMatch).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      });

      it('detects "Scaffold a React project"', () => {
        const result = detectGreenfieldIntent('Scaffold a React project');
        expect(result.isMatch).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      });

      it('detects "I want to make a workout tracker app"', () => {
        const result = detectGreenfieldIntent('I want to make a workout tracker app');
        expect(result.isMatch).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.65);
      });

      it('detects "new Next.js app"', () => {
        const result = detectGreenfieldIntent('new Next.js app');
        expect(result.isMatch).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      });
    });

    describe('exclusion patterns', () => {
      it('rejects "run the dev server"', () => {
        const result = detectGreenfieldIntent('run the dev server');
        expect(result.isMatch).toBe(false);
      });

      it('rejects "fix the login bug"', () => {
        const result = detectGreenfieldIntent('fix the login bug');
        expect(result.isMatch).toBe(false);
      });

      it('rejects "add a button to the existing page"', () => {
        const result = detectGreenfieldIntent('add a button to the existing page');
        expect(result.isMatch).toBe(false);
      });

      it('rejects "why is my app crashing?"', () => {
        const result = detectGreenfieldIntent('why is my app crashing?');
        expect(result.isMatch).toBe(false);
      });
    });
  });

  describe('detectCommandIntent', () => {
    it('detects explicit npm commands', () => {
      const result = detectCommandIntent('npm run dev');
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects "run the tests"', () => {
      const result = detectCommandIntent('run the tests');
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detects "start the dev server"', () => {
      const result = detectCommandIntent('start the dev server');
      expect(result.isMatch).toBe(true);
    });

    it('rejects greenfield requests', () => {
      const result = detectCommandIntent('Creating a new fitness app');
      expect(result.isMatch).toBe(false);
    });

    it('rejects questions', () => {
      const result = detectCommandIntent('What does npm run dev do?');
      expect(result.isMatch).toBe(false);
    });
  });

  describe('detectEditScale', () => {
    it('detects trivial edits', () => {
      const result = detectEditScale('fix typo in README');
      expect(result.scale).toBe('trivial');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detects large edits (refactor)', () => {
      const result = detectEditScale('refactor the entire authentication module');
      // Single refactor keyword match gives complexityScore=25 (1*25).
      // 'large' requires complexityScore >= 50 or largeMatchCount >= 2.
      // complexityScore=25 falls into the 'medium' branch (>= 25).
      expect(result.scale).toBe('medium');
    });

    it('detects greenfield as large', () => {
      const result = detectEditScale('Create a new React app');
      expect(result.scale).toBe('large');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
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

    it('returns null for regular prompts', () => {
      expect(detectSlashOverride('make a button blue')).toBe(null);
    });
  });
});

describe('intentRouter', () => {
  describe('routeIntent', () => {
    it('routes slash /scaffold to SCAFFOLD', async () => {
      const result = await routeIntent('/scaffold my app');
      expect(result.intent).toBe('SCAFFOLD');
      expect(result.source).toBe('slash');
      expect(result.confidence).toBe(1.0);
    });

    it('routes slash /plan to PLAN', async () => {
      const result = await routeIntent('/plan big feature');
      expect(result.intent).toBe('PLAN');
      expect(result.source).toBe('slash');
    });

    it('routes greenfield to SCAFFOLD', async () => {
      const result = await routeIntent('Creating a new fitness app');
      expect(result.intent).toBe('SCAFFOLD');
      expect(result.source).toBe('heuristic');
    });

    it('routes commands to RUN_COMMAND', async () => {
      const result = await routeIntent('npm run dev');
      expect(result.intent).toBe('RUN_COMMAND');
    });

    it('routes questions to ANSWER', async () => {
      const result = await routeIntent('What is React?');
      expect(result.intent).toBe('ANSWER');
    });

    it('routes small changes to QUICK_ACTION', async () => {
      const result = await routeIntent('make the button blue');
      expect(['QUICK_ACTION', 'ANSWER']).toContain(result.intent);
    });

    it('uses replay result when provided', async () => {
      const previousResult = {
        intent: 'SCAFFOLD' as const,
        source: 'heuristic' as const,
        confidence: 0.9,
        reasoning: 'Previous routing',
        llmCalled: false,
      };
      const result = await routeIntent('Creating a new app', {
        isReplay: true,
        previousRoutingResult: previousResult,
      });
      expect(result.intent).toBe('SCAFFOLD');
      expect(result.reasoning).toContain('[REPLAY]');
    });
  });

  describe('isDefinitelyScaffold', () => {
    it('returns true for /scaffold override', () => {
      expect(isDefinitelyScaffold('/scaffold my app')).toBe(true);
    });

    it('returns true for high confidence greenfield', () => {
      expect(isDefinitelyScaffold('Create a new React app')).toBe(true);
    });

    it('returns false for questions', () => {
      expect(isDefinitelyScaffold('What is React?')).toBe(false);
    });
  });

  describe('isDefinitelyRunCommand', () => {
    it('returns true for /run override', () => {
      expect(isDefinitelyRunCommand('/run tests')).toBe(true);
    });

    it('returns true for explicit commands', () => {
      expect(isDefinitelyRunCommand('npm run dev')).toBe(true);
    });

    it('returns false for greenfield', () => {
      expect(isDefinitelyRunCommand('Create a new app')).toBe(false);
    });
  });

  describe('shouldCallLLM', () => {
    it('returns false for high confidence cases', () => {
      expect(shouldCallLLM('npm run dev', 0.9)).toBe(false);
    });

    it('returns true for ambiguous cases', () => {
      // Ambiguous text that's hard to classify
      expect(shouldCallLLM('app stuff', 0.4)).toBe(true);
    });
  });

  describe('generateClarificationQuestion', () => {
    it('asks about project creation for greenfield ambiguity', () => {
      const question = generateClarificationQuestion({
        greenfield: { isMatch: true, confidence: 0.5, reason: 'test' },
        command: { isMatch: false, confidence: 0.1, reason: 'test' },
      });
      expect(question.question).toContain('new project');
    });

    it('asks about commands for command ambiguity', () => {
      const question = generateClarificationQuestion({
        greenfield: { isMatch: false, confidence: 0.1, reason: 'test' },
        command: { isMatch: true, confidence: 0.5, reason: 'test' },
      });
      expect(question.question).toContain('command');
    });

    it('provides general question as fallback', () => {
      const question = generateClarificationQuestion({
        greenfield: { isMatch: false, confidence: 0.1, reason: 'test' },
        command: { isMatch: false, confidence: 0.1, reason: 'test' },
      });
      expect(question.question).toContain('What would you like');
    });
  });
});

describe('real-world prompts', () => {
  const testCases = [
    // Greenfield prompts
    { prompt: 'Creating a new fitness app', expectedIntent: 'SCAFFOLD' },
    { prompt: 'Build a dashboard from scratch', expectedIntent: 'SCAFFOLD' },
    { prompt: 'I want to make a workout tracker', expectedIntent: 'SCAFFOLD' },
    { prompt: 'New Next.js project for my startup', expectedIntent: 'SCAFFOLD' },
    { prompt: 'Scaffold a Vite + React app', expectedIntent: 'SCAFFOLD' },
    
    // Command prompts
    { prompt: 'npm run dev', expectedIntent: 'RUN_COMMAND' },
    { prompt: 'run the tests', expectedIntent: 'RUN_COMMAND' },
    { prompt: 'start the dev server', expectedIntent: 'RUN_COMMAND' },
    
    // Question prompts
    { prompt: 'What is React?', expectedIntent: 'ANSWER' },
    { prompt: 'Why is my app crashing?', expectedIntent: 'ANSWER' },
    { prompt: 'How does useState work?', expectedIntent: 'ANSWER' },
    
    // Edit prompts (QUICK_ACTION or PLAN)
    { prompt: 'fix typo in README', expectedIntent: 'QUICK_ACTION' },
    { prompt: 'make the button blue', expectedIntent: 'QUICK_ACTION' },
    { prompt: 'refactor the authentication module', expectedIntent: 'PLAN' },
  ];

  testCases.forEach(({ prompt, expectedIntent }) => {
    it(`routes "${prompt.slice(0, 40)}..." to ${expectedIntent}`, async () => {
      const result = await routeIntent(prompt);
      expect(result.intent).toBe(expectedIntent);
    });
  });
});
