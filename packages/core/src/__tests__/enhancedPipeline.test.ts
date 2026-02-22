/**
 * Enhanced Pipeline Tests
 *
 * Tests for the post-scaffold orchestration enhanced pipeline:
 * - Overlay application stage
 * - shadcn/ui component setup stage
 * - Quality gate pipeline stage
 * - Event emission for all stages
 * - Error handling / graceful degradation
 * - No legacy pipeline fallback
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

vi.mock('child_process', () => ({
  exec: vi.fn((_cmd: string, _opts: any, cb?: Function) => {
    if (cb) cb(null, '', '');
    return { on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } };
  }),
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: vi.fn((fn: any) => async (...args: any[]) => {
      return { stdout: '', stderr: '' };
    }),
  };
});

// ---------------------------------------------------------------------------
// Module-level mocks — these MUST come before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    promises: {
      ...actual.promises,
      readFile: vi.fn(async () => '{}'),
      writeFile: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
    },
  };
});

vi.mock('../scaffold/overlayApplier', () => ({
  applyOverlay: vi.fn(async () => ({
    filesCreated: ['layout.tsx', 'sidebar.tsx', 'header.tsx'],
    filesModified: ['globals.css'],
  })),
  detectTailwindVersion: vi.fn(() => 4),
  appendVibeStylesToGlobals: vi.fn(async () => false),
  rewriteGlobalsCss: vi.fn(async () => true),
}));

vi.mock('../scaffold/designPackToShadcn', () => ({
  initShadcn: vi.fn(async () => ({
    componentsInstalled: ['button', 'card', 'input', 'label', 'separator'],
    errors: [],
  })),
  updateGlobalsCssTokens: vi.fn(async () => undefined),
}));

vi.mock('../scaffold/qualityGatePipeline', () => ({
  runQualityGatePipeline: vi.fn(async () => ({
    stage: 'pre_publish',
    passed: true,
    checks: [
      { name: 'autofix', status: 'skip', durationMs: 0, output: 'No fixes needed' },
      { name: 'tsc', status: 'pass', durationMs: 1200, output: '' },
      { name: 'eslint', status: 'pass', durationMs: 800, output: '' },
      { name: 'build', status: 'pass', durationMs: 3500, output: '' },
    ],
    doctorStatus: {
      tsc: 'pass',
      eslint: 'pass',
      build: 'pass',
    },
  })),
}));

vi.mock('../scaffold/gitCommitter', () => ({
  commitStage: vi.fn(async () => ({ success: true, commitHash: 'abc1234' })),
  ensureGitInit: vi.fn(async () => undefined),
  getCurrentHash: vi.fn(async () => 'abc1234'),
}));

vi.mock('../scaffold/projectContext', () => ({
  initProjectContext: vi.fn(async () => undefined),
  recordStageResult: vi.fn(async () => undefined),
  updateDoctorStatus: vi.fn(async () => undefined),
  updateStyleInfo: vi.fn(async () => undefined),
}));

vi.mock('../scaffold/deterministicAutofix', () => ({
  runDeterministicAutofix: vi.fn(async () => ({ applied: false, fixes: [], errors: [] })),
}));

vi.mock('../scaffold/doctorCard', () => ({
  buildDoctorCardPayload: vi.fn(() => ({
    title: 'Project Health',
    checks: [],
    overall: 'pass',
  })),
  pipelineToDoctorStatus: vi.fn(() => ({
    tsc: 'pass',
    eslint: 'pass',
    build: 'pass',
    devServer: { status: 'unknown', url: '' },
  })),
}));

vi.mock('../scaffold/stagingWorkspace', () => ({
  initStagingWorkspace: vi.fn(() => ({ stagingPath: '/tmp/staging', originalPath: '/tmp/project' })),
  stageFile: vi.fn(),
  publishStaged: vi.fn(() => []),
  cleanupStaging: vi.fn(),
}));

vi.mock('../scaffold/recipeConfig', () => ({
  getRecipeDisplayName: vi.fn((id: string) => id === 'nextjs_app_router' ? 'Next.js' : id),
  getShadcnComponents: vi.fn(() => [
    'button', 'card', 'input', 'label', 'separator',
    'sidebar', 'sheet', 'tooltip', 'avatar', 'dropdown-menu',
    'badge', 'dialog', 'table', 'tabs', 'select', 'textarea',
    'checkbox', 'skeleton', 'scroll-area',
  ]),
  getCreateCommand: vi.fn((_id: string, name: string) => `npx create-next-app@latest ${name}`),
  getDevCommand: vi.fn(() => 'npm run dev'),
  getBuildCommand: vi.fn(() => 'npm run build'),
  getKeyFiles: vi.fn(() => ['src/app/page.tsx', 'src/app/layout.tsx']),
  getEstimates: vi.fn(() => ({ files: 24, dirs: 8 })),
  getOverlayDir: vi.fn(() => 'overlay-next15'),
  getRecipeConfig: vi.fn(() => ({})),
  getAllRecipeIds: vi.fn(() => ['nextjs_app_router', 'vite_react', 'expo']),
}));

vi.mock('../scaffold/styleIntentResolver', () => ({
  resolveStyleIntent: vi.fn(() => ({
    tokens: {
      background: '#ffffff',
      foreground: '#0f172a',
      primary: '#6366f1',
      primary_foreground: '#ffffff',
      secondary: '#f1f5f9',
      secondary_foreground: '#1e293b',
      muted: '#f1f5f9',
      muted_foreground: '#64748b',
      destructive: '#ef4444',
      destructive_foreground: '#ffffff',
      accent: '#8b5cf6',
      accent_foreground: '#ffffff',
      card: '#ffffff',
      card_foreground: '#0f172a',
      border: '#e2e8f0',
      input: '#e2e8f0',
      ring: '#6366f1',
    },
    shadcnVars: { '--primary': '239 84% 67%' },
  })),
  resolveStyleIntentWithLLM: vi.fn(async () => ({
    tokens: { background: '#ffffff', foreground: '#0f172a', primary: '#6366f1', primary_foreground: '#ffffff', secondary: '#f1f5f9', secondary_foreground: '#1e293b', muted: '#f1f5f9', muted_foreground: '#64748b', destructive: '#ef4444', destructive_foreground: '#ffffff', accent: '#8b5cf6', accent_foreground: '#ffffff', card: '#ffffff', card_foreground: '#0f172a', border: '#e2e8f0', input: '#e2e8f0', ring: '#6366f1' },
    shadcnVars: { '--primary': '239 84% 67%' },
  })),
  getAppTypeDefaultStyle: vi.fn(() => undefined),
}));

vi.mock('../scaffold/featureExtractor', () => ({
  extractFeatureRequirements: vi.fn(async () => null),
  hasSpecificFeature: vi.fn(() => false),
}));

vi.mock('../scaffold/featureCodeGenerator', () => ({
  generateFeatureCode: vi.fn(async () => null),
}));

vi.mock('../scaffold/featureApplicator', () => ({
  applyFeatureCode: vi.fn(async () => ({ success: true, created_files: [], modified_files: [] })),
}));

vi.mock('../scaffold/designPacks', () => ({
  getDesignPackById: vi.fn(() => ({
    id: 'minimal-light',
    name: 'Minimal Light',
    description: 'Clean minimal theme',
    vibe: 'minimal',
    tokens: {
      colors: {
        primary: '#6366f1',
        secondary: '#f1f5f9',
        accent: '#8b5cf6',
        background: '#ffffff',
        foreground: '#0f172a',
        muted: '#f1f5f9',
        border: '#e2e8f0',
        muted_foreground: '#64748b',
        primary_foreground: '#ffffff',
        secondary_foreground: '#1e293b',
        accent_foreground: '#ffffff',
      },
      radius: 'md',
    },
    previewColors: ['#6366f1', '#f1f5f9'],
  })),
  generateGlobalsCss: vi.fn(() => ''),
  generateTailwindConfig: vi.fn(() => ''),
}));

vi.mock('../scaffold/nextSteps', () => ({
  getNextStepsForRecipe: vi.fn(() => [
    { id: 'dev_server', title: 'Start dev server', kind: 'command', command: 'npm run dev' },
  ]),
  getFeatureAwareNextSteps: vi.fn(() => []),
  buildNextStepsShownPayload: vi.fn(() => ({})),
}));

vi.mock('../scaffold/postVerify', () => ({
  verifyPackageJson: vi.fn(() => ({
    step: 'package_json',
    status: 'pass',
    durationMs: 10,
    output: 'OK',
  })),
  runInstallStep: vi.fn(async () => ({
    step: 'install',
    status: 'pass',
    durationMs: 5000,
    output: 'installed',
  })),
  detectPackageManager: vi.fn(() => 'npm'),
  computeOutcome: vi.fn(() => 'pass' as const),
}));

vi.mock('../scaffold/blueprintSchema', () => ({
  createEmptyProjectContext: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { startPostScaffoldOrchestration } from '../scaffold/postScaffoldOrchestrator';
import type { PostScaffoldContext, PostScaffoldPollingConfig } from '../scaffold/postScaffoldOrchestrator';
import { applyOverlay, rewriteGlobalsCss } from '../scaffold/overlayApplier';
import { initShadcn, updateGlobalsCssTokens } from '../scaffold/designPackToShadcn';
import { runQualityGatePipeline } from '../scaffold/qualityGatePipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEventBus() {
  const events: any[] = [];
  return {
    publish: vi.fn(async (event: any) => {
      events.push(event);
    }),
    events,
  };
}

function createTestContext(overrides?: Partial<PostScaffoldContext>): PostScaffoldContext {
  return {
    taskId: 'task-test-001',
    scaffoldId: 'scaffold-test-001',
    targetDirectory: '/tmp/workspace',
    appName: 'test-app',
    recipeId: 'nextjs_app_router',
    designPackId: 'minimal-light',
    eventBus: createMockEventBus(),
    mode: 'PLAN',
    userPrompt: 'Create a task management app',
    ...overrides,
  };
}

const FAST_POLLING: PostScaffoldPollingConfig = {
  maxWaitMs: 100,
  pollIntervalMs: 10,
  completionMarker: 'package.json',
  stabilizationDelayMs: 0,
};

// ============================================================================
// TESTS
// ============================================================================

describe('Enhanced Pipeline — startPostScaffoldOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as Mock).mockReturnValue(true);
  }, 15000);

  // --------------------------------------------------------------------------
  // Basic flow
  // --------------------------------------------------------------------------

  it('should complete successfully with all stages', async () => {
    const ctx = createTestContext();
    const result = await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(result.success).toBe(true);
    expect(result.projectPath).toBe('/tmp/workspace/test-app');
    expect(result.designPackApplied).toBe(true);
  });

  it('should return timeout when project is not created', async () => {
    (fs.existsSync as Mock).mockReturnValue(false);
    const ctx = createTestContext();
    const result = await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(result.success).toBe(false);
    expect(result.failedStage).toBe('polling');
    expect(result.error).toContain('Timeout');
  });

  // --------------------------------------------------------------------------
  // No legacy pipeline — only enhanced
  // --------------------------------------------------------------------------

  it('should always run enhanced pipeline regardless of useEnhancedPipeline flag', async () => {
    const ctxWithFlag = createTestContext({ useEnhancedPipeline: true });
    const resultWithFlag = await startPostScaffoldOrchestration(ctxWithFlag, FAST_POLLING);
    expect(resultWithFlag.success).toBe(true);

    vi.clearAllMocks();
    (fs.existsSync as Mock).mockReturnValue(true);

    const ctxWithoutFlag = createTestContext({ useEnhancedPipeline: false });
    const resultWithoutFlag = await startPostScaffoldOrchestration(ctxWithoutFlag, FAST_POLLING);
    expect(resultWithoutFlag.success).toBe(true);

    // Both should call overlay (enhanced pipeline)
    expect(applyOverlay).toHaveBeenCalled();
  });
});

describe('Enhanced Pipeline — Overlay Application (Stage 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as Mock).mockReturnValue(true);
  });

  it('should call applyOverlay with correct config', async () => {
    const ctx = createTestContext();
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(applyOverlay).toHaveBeenCalledTimes(1);
    const [projectPath, config] = (applyOverlay as Mock).mock.calls[0];
    expect(projectPath).toBe('/tmp/workspace/test-app');
    expect(config.recipeId).toBe('nextjs_app_router');
    expect(config.appName).toBe('test-app');
    expect(config.primaryLayout).toBe('sidebar');
  });

  it('should emit scaffold_progress events for overlay stage', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const overlayEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_progress' && e.payload?.stage === 'overlay'
    );

    expect(overlayEvents.length).toBeGreaterThanOrEqual(2);

    const doneEvent = overlayEvents.find((e: any) => e.payload?.status === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent.payload.message).toContain('shell files');
  });

  it('should emit error status when overlay fails', async () => {
    (applyOverlay as Mock).mockRejectedValueOnce(new Error('Overlay write failed'));

    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    const result = await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    // Pipeline should still succeed (overlay failure is non-fatal to overall result)
    expect(result.success).toBe(true);

    const overlayErrorEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_progress' && e.payload?.stage === 'overlay' && e.payload?.status === 'error'
    );
    expect(overlayErrorEvents.length).toBe(1);
    expect(overlayErrorEvents[0].payload.message).toContain('Overlay failed');
  });

  it('should use blueprint primary_layout for overlay config', async () => {
    const ctx = createTestContext({
      blueprint: {
        app_type: 'dashboard',
        primary_layout: 'topnav',
        pages: [],
        features: [],
      } as any,
    });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const [, config] = (applyOverlay as Mock).mock.calls[0];
    expect(config.primaryLayout).toBe('topnav');
  });
});

describe('Enhanced Pipeline — shadcn/ui Setup (Stage 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as Mock).mockReturnValue(true);
  });

  it('should call initShadcn with the expected components list', async () => {
    const ctx = createTestContext();
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(initShadcn).toHaveBeenCalledTimes(1);
    const [projectPath, components] = (initShadcn as Mock).mock.calls[0];
    expect(projectPath).toBe('/tmp/workspace/test-app');
    expect(components).toContain('button');
    expect(components).toContain('card');
    expect(components).toContain('sidebar');
    expect(components).toContain('dropdown-menu');
    expect(components.length).toBeGreaterThan(10);
  });

  it('should emit scaffold_progress events for shadcn stage', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const shadcnEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_progress' && e.payload?.stage === 'shadcn'
    );

    expect(shadcnEvents.length).toBeGreaterThanOrEqual(2);

    const doneEvent = shadcnEvents.find((e: any) => e.payload?.status === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent.payload.message).toContain('shadcn/ui components');
  });

  it('should rewrite globals.css with OKLCH tokens after shadcn init', async () => {
    const ctx = createTestContext();
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(rewriteGlobalsCss).toHaveBeenCalledTimes(1);
  });

  it('should emit error status when shadcn init fails', async () => {
    (initShadcn as Mock).mockRejectedValueOnce(new Error('npx shadcn-ui init failed'));

    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    const result = await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(result.success).toBe(true);

    const shadcnErrorEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_progress' && e.payload?.stage === 'shadcn' && e.payload?.status === 'error'
    );
    expect(shadcnErrorEvents.length).toBe(1);
    expect(shadcnErrorEvents[0].payload.message).toContain('shadcn/ui init failed');
  });
});

describe('Enhanced Pipeline — Quality Gates (Stage 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as Mock).mockReturnValue(true);
  });

  it('should run quality gate pipeline', async () => {
    const ctx = createTestContext();
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(runQualityGatePipeline).toHaveBeenCalledTimes(1);
    const [config] = (runQualityGatePipeline as Mock).mock.calls[0];
    expect(config.projectDir).toBe('/tmp/workspace/test-app');
    expect(config.skipBuild).toBe(false);
    expect(config.skipLint).toBe(false);
  });

  it('should emit scaffold_progress events for quality_gates stage', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const qgEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_progress' && e.payload?.stage === 'quality_gates'
    );

    expect(qgEvents.length).toBeGreaterThanOrEqual(2);

    const doneEvent = qgEvents.find((e: any) => e.payload?.status === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent.payload.message).toMatch(/All checks passed|Completed with/);
  });

  it('should emit scaffold_doctor_card event after quality gates', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const doctorEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_doctor_card'
    );
    expect(doctorEvents.length).toBe(1);
    expect(doctorEvents[0].payload.scaffold_id).toBe('scaffold-test-001');
    expect(doctorEvents[0].payload.doctor_card).toBeDefined();
    expect(doctorEvents[0].payload.doctor_status).toBeDefined();
  });

  it('should emit error status when quality gates fail', async () => {
    (runQualityGatePipeline as Mock).mockRejectedValueOnce(new Error('tsc crashed'));

    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    const result = await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(result.success).toBe(true);

    const qgErrorEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_progress' && e.payload?.stage === 'quality_gates' && e.payload?.status === 'error'
    );
    expect(qgErrorEvents.length).toBe(1);
    expect(qgErrorEvents[0].payload.message).toContain('Quality gates error');
  });

  it('should report doctor status correctly for failing checks', async () => {
    const { pipelineToDoctorStatus } = await import('../scaffold/doctorCard');
    (pipelineToDoctorStatus as Mock).mockReturnValue({
      tsc: 'fail',
      eslint: 'warn',
      build: 'fail',
      devServer: { status: 'unknown', url: '' },
    });
    // Mock the pipeline to return failing results so the loop sees failures
    (runQualityGatePipeline as Mock).mockResolvedValue({
      stage: 'pre_publish',
      passed: false,
      checks: [
        { name: 'tsc', status: 'fail', durationMs: 1200, output: 'error TS2322: ...' },
        { name: 'eslint', status: 'pass', durationMs: 800, output: '' },
        { name: 'build', status: 'fail', durationMs: 3500, output: 'Build failed' },
      ],
      doctorStatus: { tsc: 'fail', eslint: 'warn', build: 'fail' },
    });

    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const qgDoneEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_progress' && e.payload?.stage === 'quality_gates'
        && (e.payload?.status === 'done' || e.payload?.status === 'error')
    );

    expect(qgDoneEvents.length).toBeGreaterThanOrEqual(1);
    const statusEvent = qgDoneEvents[qgDoneEvents.length - 1];
    expect(statusEvent.payload.status).toBe('error');
    expect(statusEvent.payload.detail).toContain('tsc: fail');
  });
});

describe('Enhanced Pipeline — Event Completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as Mock).mockReturnValue(true);
  });

  it('should emit scaffold_final_complete at the end', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const finalEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_final_complete'
    );
    expect(finalEvents.length).toBe(1);
    expect(finalEvents[0].payload.project_path).toBe('/tmp/workspace/test-app');
    expect(finalEvents[0].payload.success).toBe(true);
  });

  it('should emit next_steps_shown before final complete', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const nextStepsEvents = eventBus.events.filter(
      (e: any) => e.type === 'next_steps_shown'
    );
    expect(nextStepsEvents.length).toBe(1);
  });

  it('should emit design_pack_applied event', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const designPackEvents = eventBus.events.filter(
      (e: any) => e.type === 'design_pack_applied'
    );
    expect(designPackEvents.length).toBe(1);
  });

  it('should emit scaffold_verify_started and verify events', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const verifyStartEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_verify_started'
    );
    expect(verifyStartEvents.length).toBe(1);

    const verifyCompleteEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_verify_completed'
    );
    expect(verifyCompleteEvents.length).toBe(1);
  });

  it('should emit events in correct order', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ eventBus });
    await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    const eventTypes = eventBus.events.map((e: any) => e.type);

    const progressIdx = eventTypes.indexOf('scaffold_progress');
    const designPackIdx = eventTypes.indexOf('design_pack_applied');
    const verifyIdx = eventTypes.indexOf('scaffold_verify_started');
    const nextStepsIdx = eventTypes.indexOf('next_steps_shown');
    const finalIdx = eventTypes.indexOf('scaffold_final_complete');

    expect(progressIdx).toBeLessThan(designPackIdx);
    expect(designPackIdx).toBeLessThan(verifyIdx);
    expect(verifyIdx).toBeLessThan(nextStepsIdx);
    expect(nextStepsIdx).toBeLessThan(finalIdx);
  });
});

describe('Enhanced Pipeline — Feature Generation (Stage 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as Mock).mockReturnValue(true);
  });

  it('should skip features when no LLM client is provided', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({ llmClient: undefined, eventBus });
    const result = await startPostScaffoldOrchestration(ctx, FAST_POLLING);

    expect(result.success).toBe(true);

    const featureSkipEvents = eventBus.events.filter(
      (e: any) => e.type === 'scaffold_progress' && e.payload?.stage === 'features' && e.payload?.status === 'skipped'
    );
    expect(featureSkipEvents.length).toBe(1);
  });

  it('should skip features when prompt has no specific features and no blueprint', async () => {
    const eventBus = createMockEventBus();
    const ctx = createTestContext({
      llmClient: {} as any,
      blueprint: undefined,
      userPrompt: 'Create a new app',
      eventBus,
    });

    const result = await startPostScaffoldOrchestration(ctx, FAST_POLLING);
    expect(result.success).toBe(true);
    expect(result.featureCodeApplied).toBeFalsy();
  });
});
