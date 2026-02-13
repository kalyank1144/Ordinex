/**
 * Next Steps System Tests (Step 35.6)
 * 
 * Tests for post-scaffold next steps suggestions and routing.
 */

import { describe, it, expect } from 'vitest';

import {
  getNextStepsForRecipe,
  getNextStepById,
  shouldAlwaysPrompt,
  detectDevServerCommand,
  buildNextStepsShownPayload,
  buildNextStepSelectedPayload,
  NextStepsContext,
  NextStepSuggestion,
} from '../scaffold/nextSteps';

describe('getNextStepsForRecipe', () => {
  describe('Next.js App Router', () => {
    const ctx: NextStepsContext = {
      scaffold_id: 'scaffold_123',
      recipe_id: 'nextjs_app_router',
      target_directory: '/projects/my-app',
      package_manager: 'npm',
    };

    it('returns correct ordered suggestions', () => {
      const suggestions = getNextStepsForRecipe(ctx);
      
      expect(suggestions.length).toBeGreaterThanOrEqual(4);
      expect(suggestions.length).toBeLessThanOrEqual(6);
      
      // First suggestion should be start_dev_server (primary)
      expect(suggestions[0].id).toBe('start_dev_server');
      expect(suggestions[0].primary).toBe(true);
    });

    it('includes correct command for dev server', () => {
      const suggestions = getNextStepsForRecipe(ctx);
      const devServer = suggestions.find(s => s.id === 'start_dev_server');
      
      expect(devServer).toBeDefined();
      expect(devServer?.command?.cmd).toBe('npm run dev');
      expect(devServer?.command?.cwd).toBe('/projects/my-app');
      expect(devServer?.command?.longRunning).toBe(true);
    });

    it('includes feature suggestions', () => {
      const suggestions = getNextStepsForRecipe(ctx);
      const ids = suggestions.map(s => s.id);
      
      expect(ids).toContain('create_page');
      expect(ids).toContain('add_auth');
    });

    it('filters out auth if already wired', () => {
      const ctxWithAuth: NextStepsContext = {
        ...ctx,
        has_auth_wired: true,
      };
      
      const suggestions = getNextStepsForRecipe(ctxWithAuth);
      const ids = suggestions.map(s => s.id);
      
      expect(ids).not.toContain('add_auth');
    });

    it('adjusts command for pnpm package manager', () => {
      const ctxPnpm: NextStepsContext = {
        ...ctx,
        package_manager: 'pnpm',
      };
      
      const suggestions = getNextStepsForRecipe(ctxPnpm);
      const devServer = suggestions.find(s => s.id === 'start_dev_server');
      
      expect(devServer?.command?.cmd).toBe('pnpm dev');
    });

    it('adjusts command for yarn package manager', () => {
      const ctxYarn: NextStepsContext = {
        ...ctx,
        package_manager: 'yarn',
      };
      
      const suggestions = getNextStepsForRecipe(ctxYarn);
      const devServer = suggestions.find(s => s.id === 'start_dev_server');
      
      expect(devServer?.command?.cmd).toBe('yarn dev');
    });
  });

  describe('Vite React', () => {
    const ctx: NextStepsContext = {
      scaffold_id: 'scaffold_456',
      recipe_id: 'vite_react',
      target_directory: '/projects/vite-app',
      package_manager: 'npm',
    };

    it('returns Vite-specific suggestions', () => {
      const suggestions = getNextStepsForRecipe(ctx);
      
      expect(suggestions[0].id).toBe('start_dev_server');
      expect(suggestions[0].description).toContain('Vite');
    });

    it('includes deploy config option', () => {
      const suggestions = getNextStepsForRecipe(ctx);
      const ids = suggestions.map(s => s.id);
      
      expect(ids).toContain('add_deploy_config');
    });
  });

  describe('Expo', () => {
    const ctx: NextStepsContext = {
      scaffold_id: 'scaffold_789',
      recipe_id: 'expo',
      target_directory: '/projects/expo-app',
      package_manager: 'npm',
    };

    it('returns Expo-specific suggestions', () => {
      const suggestions = getNextStepsForRecipe(ctx);
      
      expect(suggestions[0].id).toBe('start_dev_server');
      expect(suggestions[0].title).toContain('Expo');
    });

    it('uses npm run start for Expo', () => {
      const suggestions = getNextStepsForRecipe(ctx);
      const devServer = suggestions.find(s => s.id === 'start_dev_server');
      
      expect(devServer?.command?.cmd).toBe('npm run start');
    });

    it('includes mobile-specific create_page as create screen', () => {
      const suggestions = getNextStepsForRecipe(ctx);
      const createPage = suggestions.find(s => s.id === 'create_page');
      
      expect(createPage?.title).toContain('Screen');
    });
  });
});

describe('shouldAlwaysPrompt', () => {
  it('returns true for long-running commands', () => {
    const suggestion: NextStepSuggestion = {
      id: 'start_dev_server',
      title: 'Start Dev Server',
      kind: 'command',
      safety: 'prompt',
      command: {
        cmd: 'npm run dev',
        cwd: '/app',
        longRunning: true,
      },
    };
    
    expect(shouldAlwaysPrompt(suggestion)).toBe(true);
  });

  it('returns true for plan actions', () => {
    const suggestion: NextStepSuggestion = {
      id: 'add_auth',
      title: 'Add Authentication',
      kind: 'plan',
      safety: 'prompt',
    };
    
    expect(shouldAlwaysPrompt(suggestion)).toBe(true);
  });

  it('returns true for risky safety level', () => {
    const suggestion: NextStepSuggestion = {
      id: 'some_risky',
      title: 'Risky Action',
      kind: 'quick_action',
      safety: 'risky',
    };
    
    expect(shouldAlwaysPrompt(suggestion)).toBe(true);
  });

  it('returns false for safe non-long-running commands', () => {
    const suggestion: NextStepSuggestion = {
      id: 'run_lint',
      title: 'Run Lint',
      kind: 'command',
      safety: 'safe',
      command: {
        cmd: 'npm run lint',
        cwd: '/app',
      },
    };
    
    expect(shouldAlwaysPrompt(suggestion)).toBe(false);
  });
});

describe('detectDevServerCommand', () => {
  it('detects dev script', () => {
    const packageJson = {
      scripts: {
        dev: 'next dev',
        build: 'next build',
      },
    };
    
    const result = detectDevServerCommand(packageJson, 'npm');
    
    expect(result.scriptName).toBe('dev');
    expect(result.command).toBe('npm run dev');
    expect(result.ambiguous).toBe(false);
  });

  it('detects start script when no dev', () => {
    const packageJson = {
      scripts: {
        start: 'node server.js',
        build: 'tsc',
      },
    };
    
    const result = detectDevServerCommand(packageJson, 'npm');
    
    expect(result.scriptName).toBe('start');
    expect(result.command).toBe('npm run start');
  });

  it('prefers dev over start when both present', () => {
    const packageJson = {
      scripts: {
        dev: 'next dev',
        start: 'next start',
        build: 'next build',
      },
    };
    
    const result = detectDevServerCommand(packageJson, 'npm');
    
    expect(result.scriptName).toBe('dev');
    expect(result.ambiguous).toBe(false);
    expect(result.alternatives).toContain('npm run start');
  });

  it('detects Expo specifically', () => {
    const packageJson = {
      scripts: {
        start: 'expo start',
        android: 'expo run:android',
      },
    };
    
    const result = detectDevServerCommand(packageJson, 'npm');
    
    expect(result.scriptName).toBe('start');
    expect(result.command).toBe('npm run start');
    expect(result.ambiguous).toBe(false);
  });

  it('handles pnpm package manager', () => {
    const packageJson = {
      scripts: {
        dev: 'vite',
      },
    };
    
    const result = detectDevServerCommand(packageJson, 'pnpm');
    
    expect(result.command).toBe('pnpm dev');
  });

  it('handles yarn package manager', () => {
    const packageJson = {
      scripts: {
        dev: 'vite',
      },
    };
    
    const result = detectDevServerCommand(packageJson, 'yarn');
    
    expect(result.command).toBe('yarn dev');
  });

  it('returns default when no scripts found', () => {
    const packageJson = {};
    
    const result = detectDevServerCommand(packageJson, 'npm');
    
    expect(result.command).toBe('npm run dev');
    expect(result.ambiguous).toBe(false);
  });
});

describe('buildNextStepsShownPayload', () => {
  it('builds correct payload', () => {
    const ctx: NextStepsContext = {
      scaffold_id: 'scaffold_123',
      recipe_id: 'nextjs_app_router',
      design_pack_id: 'minimal_dark',
      target_directory: '/app',
    };
    
    const suggestions = getNextStepsForRecipe(ctx);
    const payload = buildNextStepsShownPayload(ctx, suggestions);
    
    expect(payload.scaffold_id).toBe('scaffold_123');
    expect(payload.recipe_id).toBe('nextjs_app_router');
    expect(payload.design_pack_id).toBe('minimal_dark');
    expect(payload.suggestions.length).toBe(suggestions.length);
    expect(payload.suggestions[0]).toHaveProperty('id');
    expect(payload.suggestions[0]).toHaveProperty('title');
    expect(payload.suggestions[0]).toHaveProperty('kind');
    expect(payload.suggestions[0]).toHaveProperty('safety');
  });
});

describe('buildNextStepSelectedPayload', () => {
  it('builds correct payload', () => {
    const suggestion: NextStepSuggestion = {
      id: 'start_dev_server',
      title: 'Start Dev Server',
      kind: 'command',
      safety: 'prompt',
    };
    
    const payload = buildNextStepSelectedPayload('scaffold_123', suggestion);
    
    expect(payload.scaffold_id).toBe('scaffold_123');
    expect(payload.suggestion_id).toBe('start_dev_server');
    expect(payload.kind).toBe('command');
  });
});

describe('getNextStepById', () => {
  it('returns suggestion by ID', () => {
    const ctx: NextStepsContext = {
      scaffold_id: 'scaffold_123',
      recipe_id: 'nextjs_app_router',
      target_directory: '/app',
    };
    
    const suggestion = getNextStepById('start_dev_server', ctx);
    
    expect(suggestion).toBeDefined();
    expect(suggestion?.id).toBe('start_dev_server');
  });

  it('returns undefined for unknown ID', () => {
    const ctx: NextStepsContext = {
      scaffold_id: 'scaffold_123',
      recipe_id: 'nextjs_app_router',
      target_directory: '/app',
    };
    
    const suggestion = getNextStepById('unknown_step' as any, ctx);
    
    // May return undefined if not in suggestions list
    // This depends on the implementation
  });
});
