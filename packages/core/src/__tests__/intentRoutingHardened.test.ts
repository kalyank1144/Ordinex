/**
 * Intent Routing Hardened Tests — Workspace-Aware Scaffold Detection
 *
 * Tests the simplified router (SCAFFOLD | AGENT) against critical
 * real-world prompts. Every case is a locked regression.
 */

import { describe, it, expect } from 'vitest';
import { routeIntent } from '../intent/intentRouter';
import type { WorkspaceState } from '../intent/intentRouter';
import { detectGreenfieldIntent, detectSlashOverride } from '../intent/intentSignals';

// ============================================================================
// WORKSPACE FIXTURES
// ============================================================================

const EMPTY_WORKSPACE: WorkspaceState = { fileCount: 0, hasPackageJson: false, hasGitRepo: false };
const PROJECT_WORKSPACE: WorkspaceState = { fileCount: 50, hasPackageJson: true, hasGitRepo: true };

// ============================================================================
// SCAFFOLD DETECTION
// ============================================================================

describe('Scaffold Detection', () => {
  const scaffoldPrompts = [
    'Creating a new fitness app',
    'Build a dashboard from scratch',
    'Scaffold a React project',
    'I want to make a workout tracker app',
    'New Next.js project for my startup',
    'Create a new e-commerce application',
    'Build me a todo app with authentication',
    'Start fresh with a Vite + React setup',
    'Initialize a new TypeScript project',
  ];

  scaffoldPrompts.forEach(prompt => {
    it(`empty workspace: "${prompt.slice(0, 40)}" → SCAFFOLD`, async () => {
      const result = await routeIntent(prompt, { workspace: EMPTY_WORKSPACE });
      expect(result.intent).toBe('SCAFFOLD');
    });
  });

  it('existing project: "Build me a dashboard" → AGENT (quick reject)', async () => {
    const result = await routeIntent('Build me a dashboard', { workspace: PROJECT_WORKSPACE });
    expect(result.intent).toBe('AGENT');
  });

  it('existing project: even very explicit greenfield → AGENT (use /scaffold)', async () => {
    const result = await routeIntent('Create a new React app from scratch', { workspace: PROJECT_WORKSPACE });
    expect(result.intent).toBe('AGENT');
  });
});

// ============================================================================
// AGENT PASS-THROUGH (everything non-scaffold)
// ============================================================================

describe('Agent Pass-Through', () => {
  const agentPrompts = [
    { prompt: 'npm run dev', note: 'command' },
    { prompt: 'run the tests', note: 'command' },
    { prompt: 'start the dev server', note: 'command' },
    { prompt: 'What is React?', note: 'question' },
    { prompt: 'Why is my app crashing?', note: 'question' },
    { prompt: 'How does useState work?', note: 'question' },
    { prompt: 'fix typo in README', note: 'trivial edit' },
    { prompt: 'make the button blue', note: 'small edit' },
    { prompt: 'refactor the authentication module', note: 'large edit' },
    { prompt: 'Add error handling to the API endpoint', note: 'feature' },
    { prompt: 'Deploy the app to production', note: 'command' },
  ];

  agentPrompts.forEach(({ prompt, note }) => {
    it(`"${prompt.slice(0, 40)}" → AGENT (${note})`, async () => {
      const result = await routeIntent(prompt, { workspace: PROJECT_WORKSPACE });
      expect(result.intent).toBe('AGENT');
    });
  });
});

// ============================================================================
// SLASH OVERRIDE
// ============================================================================

describe('Slash Override', () => {
  it('/scaffold always wins', async () => {
    const result = await routeIntent('/scaffold make button blue');
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('slash');
    expect(result.confidence).toBe(1.0);
  });

  it('other slash commands pass through to AGENT', async () => {
    const others = ['/plan', '/run', '/answer', '/chat', '/do'];
    for (const cmd of others) {
      const result = await routeIntent(`${cmd} something`);
      expect(result.intent).toBe('AGENT');
    }
  });
});

// ============================================================================
// CRITICAL REGRESSION LOCKS
// ============================================================================

describe('Critical Regression Locks', () => {
  it('"Start the dev server" → AGENT (not PLAN, not RUN_COMMAND)', async () => {
    const result = await routeIntent('Start the dev server', { workspace: PROJECT_WORKSPACE });
    expect(result.intent).toBe('AGENT');
  });

  it('"Creating a new fitness app" in empty workspace → SCAFFOLD', async () => {
    const result = await routeIntent('Creating a new fitness app', { workspace: EMPTY_WORKSPACE });
    expect(result.intent).toBe('SCAFFOLD');
  });

  it('"Creating a new fitness app" in project workspace → AGENT (quick reject)', async () => {
    const result = await routeIntent('Creating a new fitness app', { workspace: PROJECT_WORKSPACE });
    expect(result.intent).toBe('AGENT');
  });

  it('"Build me a dashboard" in existing project → AGENT', async () => {
    const result = await routeIntent('Build me a dashboard', { workspace: PROJECT_WORKSPACE });
    expect(result.intent).toBe('AGENT');
  });

  it('"What is React?" → AGENT (LLM answers naturally)', async () => {
    const result = await routeIntent('What is React?');
    expect(result.intent).toBe('AGENT');
  });

  it('"npm run dev" → AGENT (LLM uses run_command tool)', async () => {
    const result = await routeIntent('npm run dev');
    expect(result.intent).toBe('AGENT');
  });
});

// ============================================================================
// SIGNAL-LEVEL CHECKS
// ============================================================================

describe('Signal-level checks', () => {
  describe('detectGreenfieldIntent', () => {
    it('detects strong greenfield with high confidence', () => {
      const result = detectGreenfieldIntent('Creating a new fitness app');
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('rejects "run the dev server"', () => {
      const result = detectGreenfieldIntent('run the dev server');
      expect(result.isMatch).toBe(false);
    });

    it('rejects "Run the app"', () => {
      const result = detectGreenfieldIntent('Run the app');
      expect(result.isMatch).toBe(false);
    });
  });

  describe('detectSlashOverride', () => {
    it('detects /scaffold', () => {
      expect(detectSlashOverride('/scaffold my app')).toBe('scaffold');
    });

    it('returns null for non-scaffold slashes', () => {
      expect(detectSlashOverride('/plan feature')).toBe(null);
      expect(detectSlashOverride('/run tests')).toBe(null);
    });

    it('returns null for regular prompts', () => {
      expect(detectSlashOverride('make a button blue')).toBe(null);
    });
  });
});

// ============================================================================
// ROUTING METADATA
// ============================================================================

describe('Routing metadata', () => {
  it('scaffold routes have heuristic source', async () => {
    const result = await routeIntent('Creating a new fitness app', { workspace: EMPTY_WORKSPACE });
    expect(result.source).toBe('heuristic');
  });

  it('pass-through routes have passthrough source', async () => {
    const result = await routeIntent('npm run dev', { workspace: PROJECT_WORKSPACE });
    expect(result.source).toBe('passthrough');
  });

  it('slash overrides have confidence 1.0', async () => {
    const result = await routeIntent('/scaffold new app');
    expect(result.confidence).toBe(1.0);
    expect(result.source).toBe('slash');
  });

  it('provides human-readable reasoning', async () => {
    const result = await routeIntent('Creating a new fitness app', { workspace: EMPTY_WORKSPACE });
    expect(result.reasoning.length).toBeGreaterThan(0);
  });
});
