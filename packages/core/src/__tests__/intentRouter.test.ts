/**
 * Intent Router Tests — Workspace-Aware Scaffold Detection + Pass-Through
 *
 * Tests the simplified 2-intent router (SCAFFOLD | AGENT).
 */

import { describe, it, expect } from 'vitest';

import {
  detectGreenfieldIntent,
  detectSlashOverride,
} from '../intent/intentSignals';
import {
  routeIntent,
} from '../intent/intentRouter';
import type { WorkspaceState } from '../intent/intentRouter';

// ============================================================================
// intentSignals (trimmed module)
// ============================================================================

describe('intentSignals', () => {
  describe('detectGreenfieldIntent', () => {
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

    it('rejects "run the dev server"', () => {
      const result = detectGreenfieldIntent('run the dev server');
      expect(result.isMatch).toBe(false);
    });

    it('rejects "fix the login bug"', () => {
      const result = detectGreenfieldIntent('fix the login bug');
      expect(result.isMatch).toBe(false);
    });

    it('rejects "why is my app crashing?"', () => {
      const result = detectGreenfieldIntent('why is my app crashing?');
      expect(result.isMatch).toBe(false);
    });
  });

  describe('detectSlashOverride', () => {
    it('detects /scaffold', () => {
      expect(detectSlashOverride('/scaffold my app')).toBe('scaffold');
    });

    it('detects bare "scaffold"', () => {
      expect(detectSlashOverride('scaffold my app')).toBe('scaffold');
    });

    it('returns null for /plan (no longer supported)', () => {
      expect(detectSlashOverride('/plan big feature')).toBe(null);
    });

    it('returns null for /run (no longer supported)', () => {
      expect(detectSlashOverride('/run tests')).toBe(null);
    });

    it('returns null for regular prompts', () => {
      expect(detectSlashOverride('make a button blue')).toBe(null);
    });
  });
});

// ============================================================================
// routeIntent (simplified 2-intent router)
// ============================================================================

describe('routeIntent', () => {
  describe('slash override', () => {
    it('routes /scaffold to SCAFFOLD', async () => {
      const result = await routeIntent('/scaffold my app');
      expect(result.intent).toBe('SCAFFOLD');
      expect(result.source).toBe('slash');
      expect(result.confidence).toBe(1.0);
    });

    it('/plan passes through to AGENT (no longer a slash override)', async () => {
      const result = await routeIntent('/plan big feature');
      expect(result.intent).toBe('AGENT');
    });
  });

  describe('without workspace state (fallback to regex)', () => {
    it('routes high-confidence greenfield to SCAFFOLD', async () => {
      const result = await routeIntent('Creating a new fitness app');
      expect(result.intent).toBe('SCAFFOLD');
      expect(result.source).toBe('heuristic');
    });

    it('routes low-confidence greenfield to AGENT', async () => {
      const result = await routeIntent('build something');
      expect(result.intent).toBe('AGENT');
    });

    it('routes commands to AGENT', async () => {
      const result = await routeIntent('npm run dev');
      expect(result.intent).toBe('AGENT');
    });

    it('routes questions to AGENT', async () => {
      const result = await routeIntent('What is React?');
      expect(result.intent).toBe('AGENT');
    });

    it('routes edit requests to AGENT', async () => {
      const result = await routeIntent('make the button blue');
      expect(result.intent).toBe('AGENT');
    });
  });

  describe('with empty workspace', () => {
    const emptyWorkspace: WorkspaceState = {
      fileCount: 0,
      hasPackageJson: false,
      hasGitRepo: false,
    };

    it('routes greenfield intent to SCAFFOLD with lower threshold', async () => {
      const result = await routeIntent('Build me a todo app', { workspace: emptyWorkspace });
      expect(result.intent).toBe('SCAFFOLD');
    });

    it('routes non-greenfield to AGENT', async () => {
      const result = await routeIntent('How do I use React?', { workspace: emptyWorkspace });
      expect(result.intent).toBe('AGENT');
    });
  });

  describe('with existing project workspace', () => {
    const projectWorkspace: WorkspaceState = {
      fileCount: 50,
      hasPackageJson: true,
      hasGitRepo: true,
    };

    it('quick-rejects non-greenfield prompts', async () => {
      const result = await routeIntent('Build me a dashboard', { workspace: projectWorkspace });
      expect(result.intent).toBe('AGENT');
      expect(result.source).toBe('passthrough');
    });

    it('never routes to SCAFFOLD (use /scaffold in existing projects)', async () => {
      const result = await routeIntent('Create a new React app from scratch', { workspace: projectWorkspace });
      expect(result.intent).toBe('AGENT');
    });

    it('routes /scaffold to SCAFFOLD even in existing project', async () => {
      const result = await routeIntent('/scaffold a new app', { workspace: projectWorkspace });
      expect(result.intent).toBe('SCAFFOLD');
    });

    it('routes "start dev server" to AGENT (not PLAN!)', async () => {
      const result = await routeIntent('Start the dev server', { workspace: projectWorkspace });
      expect(result.intent).toBe('AGENT');
    });

    it('routes "refactor auth module" to AGENT (LLM decides)', async () => {
      const result = await routeIntent('Refactor the authentication module', { workspace: projectWorkspace });
      expect(result.intent).toBe('AGENT');
    });

    it('routes questions to AGENT', async () => {
      const result = await routeIntent('What does this function do?', { workspace: projectWorkspace });
      expect(result.intent).toBe('AGENT');
    });
  });
});
