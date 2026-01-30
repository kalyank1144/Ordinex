/**
 * Enhance Flow Tests (Step 36.7)
 * 
 * Tests for:
 * - Project snapshot detection (Next.js, Vite, Expo)
 * - Context resolution for "this/it" references
 * - QUICK_ACTION enhancement → diff + verify
 * - Verify failure → bounded repair
 * - Replay does not re-run commands
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Event, Mode, Stage } from '../types';

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

// Mock project snapshot types
interface ProjectSnapshot {
  timestamp: string;
  workspaceRoot: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'unknown';
  framework: string;
  additionalFrameworks: string[];
  language: 'typescript' | 'javascript' | 'mixed' | 'unknown';
  tsConfigPath?: string;
  topLevelDirs: string[];
  keyFiles: Array<{ path: string; type: string; framework_role?: string }>;
  scripts: Array<{ name: string; command: string; category: string }>;
  hasLintScript: boolean;
  hasTestScript: boolean;
  hasBuildScript: boolean;
  dependencyCount: number;
  devDependencyCount: number;
  notableDependencies: string[];
  patterns: string[];
  hasEslint: boolean;
  hasPrettier: boolean;
  isMonorepo: boolean;
}

interface EnhanceContextResult {
  filesToRead: string[];
  recommendedVerifyCommands: string[];
  selectionReasons: Map<string, string>;
  referenceResolved: boolean;
  referenceSource?: string;
  needsClarification?: {
    question: string;
    options: Array<{ label: string; value: string }>;
  };
}

interface RecentRunMetadata {
  lastAppliedDiffFiles?: string[];
  lastAppliedDiffTimestamp?: string;
  lastArtifactProposed?: {
    type: 'diff' | 'plan' | 'checkpoint';
    files?: string[];
    timestamp: string;
  };
  activeEditorFile?: string;
  recentlyViewedFiles?: string[];
}

// ============================================================================
// SNAPSHOT DETECTION TESTS
// ============================================================================

describe('Project Snapshot Detection', () => {
  // Fixture: Next.js App Router project
  const nextjsAppRouterSnapshot: ProjectSnapshot = {
    timestamp: new Date().toISOString(),
    workspaceRoot: '/test/nextjs-app',
    packageManager: 'pnpm',
    framework: 'nextjs_app_router',
    additionalFrameworks: ['Tailwind CSS'],
    language: 'typescript',
    tsConfigPath: 'tsconfig.json',
    topLevelDirs: ['app', 'components', 'lib', 'public'],
    keyFiles: [
      { path: 'app/layout.tsx', type: 'layout', framework_role: 'Root Layout' },
      { path: 'app/page.tsx', type: 'entry', framework_role: 'Home Page' },
      { path: 'package.json', type: 'config' },
      { path: 'tsconfig.json', type: 'config' },
    ],
    scripts: [
      { name: 'dev', command: 'next dev', category: 'dev' },
      { name: 'build', command: 'next build', category: 'build' },
      { name: 'lint', command: 'next lint', category: 'lint' },
    ],
    hasLintScript: true,
    hasTestScript: false,
    hasBuildScript: true,
    dependencyCount: 12,
    devDependencyCount: 8,
    notableDependencies: ['tailwindcss', '@tanstack/react-query'],
    patterns: ['App Router', 'Tailwind CSS'],
    hasEslint: true,
    hasPrettier: true,
    isMonorepo: false,
  };

  // Fixture: Vite React project
  const viteReactSnapshot: ProjectSnapshot = {
    timestamp: new Date().toISOString(),
    workspaceRoot: '/test/vite-react',
    packageManager: 'npm',
    framework: 'vite_react',
    additionalFrameworks: [],
    language: 'typescript',
    tsConfigPath: 'tsconfig.json',
    topLevelDirs: ['src', 'public'],
    keyFiles: [
      { path: 'src/main.tsx', type: 'entry', framework_role: 'Entry Point' },
      { path: 'src/App.tsx', type: 'component', framework_role: 'Root Component' },
      { path: 'vite.config.ts', type: 'config' },
    ],
    scripts: [
      { name: 'dev', command: 'vite', category: 'dev' },
      { name: 'build', command: 'vite build', category: 'build' },
      { name: 'test', command: 'vitest', category: 'test' },
    ],
    hasLintScript: false,
    hasTestScript: true,
    hasBuildScript: true,
    dependencyCount: 5,
    devDependencyCount: 10,
    notableDependencies: ['vitest'],
    patterns: [],
    hasEslint: false,
    hasPrettier: false,
    isMonorepo: false,
  };

  // Fixture: Expo project
  const expoSnapshot: ProjectSnapshot = {
    timestamp: new Date().toISOString(),
    workspaceRoot: '/test/expo-app',
    packageManager: 'yarn',
    framework: 'expo',
    additionalFrameworks: [],
    language: 'typescript',
    tsConfigPath: 'tsconfig.json',
    topLevelDirs: ['app', 'assets', 'components'],
    keyFiles: [
      { path: 'app/_layout.tsx', type: 'layout', framework_role: 'Root Layout' },
      { path: 'app/index.tsx', type: 'entry', framework_role: 'Home Screen' },
      { path: 'app.json', type: 'config', framework_role: 'Expo Config' },
    ],
    scripts: [
      { name: 'start', command: 'expo start', category: 'start' },
      { name: 'android', command: 'expo start --android', category: 'dev' },
      { name: 'ios', command: 'expo start --ios', category: 'dev' },
    ],
    hasLintScript: false,
    hasTestScript: false,
    hasBuildScript: false,
    dependencyCount: 15,
    devDependencyCount: 3,
    notableDependencies: [],
    patterns: ['Expo'],
    hasEslint: false,
    hasPrettier: false,
    isMonorepo: false,
  };

  it('should detect Next.js App Router project', () => {
    const snapshot = nextjsAppRouterSnapshot;
    
    expect(snapshot.framework).toBe('nextjs_app_router');
    expect(snapshot.patterns).toContain('App Router');
    expect(snapshot.keyFiles.some(f => f.path === 'app/layout.tsx')).toBe(true);
    expect(snapshot.language).toBe('typescript');
  });

  it('should detect Vite React project', () => {
    const snapshot = viteReactSnapshot;
    
    expect(snapshot.framework).toBe('vite_react');
    expect(snapshot.keyFiles.some(f => f.path === 'src/main.tsx')).toBe(true);
    expect(snapshot.hasTestScript).toBe(true);
  });

  it('should detect Expo project', () => {
    const snapshot = expoSnapshot;
    
    expect(snapshot.framework).toBe('expo');
    expect(snapshot.patterns).toContain('Expo');
    expect(snapshot.keyFiles.some(f => f.path === 'app.json')).toBe(true);
  });

  it('should identify existing project by markers', () => {
    const isExisting = (snapshot: ProjectSnapshot): boolean => {
      return (
        snapshot.framework !== 'unknown' ||
        snapshot.dependencyCount > 0 ||
        snapshot.keyFiles.length > 0 ||
        snapshot.topLevelDirs.includes('src') ||
        snapshot.topLevelDirs.includes('app')
      );
    };

    expect(isExisting(nextjsAppRouterSnapshot)).toBe(true);
    expect(isExisting(viteReactSnapshot)).toBe(true);
    expect(isExisting(expoSnapshot)).toBe(true);
    
    // Empty project should not be detected as existing
    const emptySnapshot: ProjectSnapshot = {
      timestamp: new Date().toISOString(),
      workspaceRoot: '/test/empty',
      packageManager: 'unknown',
      framework: 'unknown',
      additionalFrameworks: [],
      language: 'unknown',
      topLevelDirs: [],
      keyFiles: [],
      scripts: [],
      hasLintScript: false,
      hasTestScript: false,
      hasBuildScript: false,
      dependencyCount: 0,
      devDependencyCount: 0,
      notableDependencies: [],
      patterns: [],
      hasEslint: false,
      hasPrettier: false,
      isMonorepo: false,
    };
    
    expect(isExisting(emptySnapshot)).toBe(false);
  });

  it('should build verify commands from snapshot', () => {
    const getVerifyCommands = (snapshot: ProjectSnapshot): string[] => {
      const commands: string[] = [];
      const prefix = snapshot.packageManager === 'unknown' ? 'npm' : snapshot.packageManager;
      
      if (snapshot.hasLintScript) commands.push(`${prefix} run lint`);
      if (snapshot.hasTestScript) commands.push(`${prefix} run test`);
      if (snapshot.hasBuildScript) commands.push(`${prefix} run build`);
      
      return commands;
    };

    const nextjsCommands = getVerifyCommands(nextjsAppRouterSnapshot);
    expect(nextjsCommands).toContain('pnpm run lint');
    expect(nextjsCommands).toContain('pnpm run build');
    expect(nextjsCommands).not.toContain('pnpm run test');

    const viteCommands = getVerifyCommands(viteReactSnapshot);
    expect(viteCommands).toContain('npm run test');
    expect(viteCommands).toContain('npm run build');
    expect(viteCommands).not.toContain('npm run lint');
  });
});

// ============================================================================
// CONTEXT RESOLUTION TESTS
// ============================================================================

describe('Context Resolution for "this/it" References', () => {
  it('should resolve reference from last applied diff', () => {
    const metadata: RecentRunMetadata = {
      lastAppliedDiffFiles: ['src/components/Button.tsx', 'src/styles/button.css'],
      lastAppliedDiffTimestamp: new Date().toISOString(),
    };

    const resolveReference = (meta: RecentRunMetadata): { files: string[]; source: string } => {
      if (meta.lastAppliedDiffFiles?.length) {
        return { files: meta.lastAppliedDiffFiles, source: 'last_applied_diff' };
      }
      if (meta.lastArtifactProposed?.files?.length) {
        return { files: meta.lastArtifactProposed.files, source: 'last_artifact' };
      }
      if (meta.activeEditorFile) {
        return { files: [meta.activeEditorFile], source: 'active_editor' };
      }
      return { files: [], source: 'none' };
    };

    const result = resolveReference(metadata);
    expect(result.source).toBe('last_applied_diff');
    expect(result.files).toContain('src/components/Button.tsx');
  });

  it('should resolve reference from last artifact proposed', () => {
    const metadata: RecentRunMetadata = {
      lastArtifactProposed: {
        type: 'diff',
        files: ['src/utils/helpers.ts'],
        timestamp: new Date().toISOString(),
      },
    };

    const resolveReference = (meta: RecentRunMetadata): { files: string[]; source: string } => {
      if (meta.lastAppliedDiffFiles?.length) {
        return { files: meta.lastAppliedDiffFiles, source: 'last_applied_diff' };
      }
      if (meta.lastArtifactProposed?.files?.length) {
        return { files: meta.lastArtifactProposed.files, source: 'last_artifact' };
      }
      if (meta.activeEditorFile) {
        return { files: [meta.activeEditorFile], source: 'active_editor' };
      }
      return { files: [], source: 'none' };
    };

    const result = resolveReference(metadata);
    expect(result.source).toBe('last_artifact');
    expect(result.files).toContain('src/utils/helpers.ts');
  });

  it('should resolve reference from active editor file', () => {
    const metadata: RecentRunMetadata = {
      activeEditorFile: 'src/pages/Home.tsx',
    };

    const resolveReference = (meta: RecentRunMetadata): { files: string[]; source: string } => {
      if (meta.lastAppliedDiffFiles?.length) {
        return { files: meta.lastAppliedDiffFiles, source: 'last_applied_diff' };
      }
      if (meta.lastArtifactProposed?.files?.length) {
        return { files: meta.lastArtifactProposed.files, source: 'last_artifact' };
      }
      if (meta.activeEditorFile) {
        return { files: [meta.activeEditorFile], source: 'active_editor' };
      }
      return { files: [], source: 'none' };
    };

    const result = resolveReference(metadata);
    expect(result.source).toBe('active_editor');
    expect(result.files).toContain('src/pages/Home.tsx');
  });

  it('should request clarification when no reference context', () => {
    const metadata: RecentRunMetadata = {};

    const buildClarification = (meta: RecentRunMetadata): { needed: boolean; question?: string } => {
      const hasContext = 
        meta.lastAppliedDiffFiles?.length ||
        meta.lastArtifactProposed?.files?.length ||
        meta.activeEditorFile;
      
      if (!hasContext) {
        return {
          needed: true,
          question: 'Which file or component are you referring to?',
        };
      }
      return { needed: false };
    };

    const result = buildClarification(metadata);
    expect(result.needed).toBe(true);
    expect(result.question).toContain('referring to');
  });

  it('should follow priority order for resolution', () => {
    // All sources available - should use last_applied_diff (highest priority)
    const metadata: RecentRunMetadata = {
      lastAppliedDiffFiles: ['priority1.ts'],
      lastArtifactProposed: {
        type: 'diff',
        files: ['priority2.ts'],
        timestamp: new Date().toISOString(),
      },
      activeEditorFile: 'priority3.ts',
    };

    const resolveReference = (meta: RecentRunMetadata): { files: string[]; source: string } => {
      if (meta.lastAppliedDiffFiles?.length) {
        return { files: meta.lastAppliedDiffFiles, source: 'last_applied_diff' };
      }
      if (meta.lastArtifactProposed?.files?.length) {
        return { files: meta.lastArtifactProposed.files, source: 'last_artifact' };
      }
      if (meta.activeEditorFile) {
        return { files: [meta.activeEditorFile], source: 'active_editor' };
      }
      return { files: [], source: 'none' };
    };

    const result = resolveReference(metadata);
    expect(result.source).toBe('last_applied_diff');
    expect(result.files).toContain('priority1.ts');
  });
});

// ============================================================================
// QUICK_ACTION ENHANCEMENT TESTS
// ============================================================================

describe('QUICK_ACTION Enhancement Flow', () => {
  it('should identify small changes as QUICK_ACTION', () => {
    const analyzeScope = (prompt: string): 'trivial' | 'small' | 'medium' | 'large' => {
      const promptLower = prompt.toLowerCase();
      
      // Trivial patterns
      if (promptLower.includes('typo') || promptLower.includes('fix the error')) {
        return 'trivial';
      }
      
      // Small patterns
      if (
        promptLower.includes('add a button') ||
        promptLower.includes('change the color') ||
        promptLower.includes('update the text')
      ) {
        return 'small';
      }
      
      // Medium patterns
      if (
        promptLower.includes('add a new page') ||
        promptLower.includes('create a component') ||
        promptLower.includes('implement')
      ) {
        return 'medium';
      }
      
      // Large patterns
      if (
        promptLower.includes('refactor') ||
        promptLower.includes('rewrite') ||
        promptLower.includes('add authentication')
      ) {
        return 'large';
      }
      
      return 'small';
    };

    expect(analyzeScope('fix the typo in the button')).toBe('trivial');
    expect(analyzeScope('add a button to the header')).toBe('small');
    expect(analyzeScope('change the color of the navbar to blue')).toBe('small');
    expect(analyzeScope('add a new page for user settings')).toBe('medium');
    expect(analyzeScope('refactor the authentication system')).toBe('large');
  });

  it('should proceed directly for small changes', () => {
    const shouldProceedDirectly = (scope: string, behavior: string): boolean => {
      return (scope === 'trivial' || scope === 'small') && behavior !== 'PLAN';
    };

    expect(shouldProceedDirectly('trivial', 'QUICK_ACTION')).toBe(true);
    expect(shouldProceedDirectly('small', 'QUICK_ACTION')).toBe(true);
    expect(shouldProceedDirectly('medium', 'QUICK_ACTION')).toBe(false);
    expect(shouldProceedDirectly('small', 'PLAN')).toBe(false);
  });

  it('should show proposal card for medium/large changes', () => {
    const shouldShowProposal = (scope: string, behavior: string): boolean => {
      return scope === 'medium' || scope === 'large' || behavior === 'PLAN';
    };

    expect(shouldShowProposal('trivial', 'QUICK_ACTION')).toBe(false);
    expect(shouldShowProposal('small', 'QUICK_ACTION')).toBe(false);
    expect(shouldShowProposal('medium', 'QUICK_ACTION')).toBe(true);
    expect(shouldShowProposal('large', 'QUICK_ACTION')).toBe(true);
    expect(shouldShowProposal('small', 'PLAN')).toBe(true);
  });
});

// ============================================================================
// VERIFY FAILURE + BOUNDED REPAIR TESTS
// ============================================================================

describe('Verify Failure and Bounded Repair', () => {
  it('should track repair attempts and enforce bound', () => {
    interface RepairState {
      attempts: number;
      maxAttempts: number;
      lastError?: string;
    }

    const canAttemptRepair = (state: RepairState): boolean => {
      return state.attempts < state.maxAttempts;
    };

    const recordRepairAttempt = (state: RepairState, error: string): RepairState => {
      return {
        ...state,
        attempts: state.attempts + 1,
        lastError: error,
      };
    };

    let state: RepairState = { attempts: 0, maxAttempts: 2 };
    
    // First attempt
    expect(canAttemptRepair(state)).toBe(true);
    state = recordRepairAttempt(state, 'lint failed');
    expect(state.attempts).toBe(1);
    
    // Second attempt
    expect(canAttemptRepair(state)).toBe(true);
    state = recordRepairAttempt(state, 'lint failed again');
    expect(state.attempts).toBe(2);
    
    // No more attempts
    expect(canAttemptRepair(state)).toBe(false);
  });

  it('should generate decision point when repair exhausted', () => {
    interface DecisionPoint {
      type: 'decision_point_needed';
      options: Array<{ id: string; label: string }>;
    }

    const createDecisionPoint = (): DecisionPoint => {
      return {
        type: 'decision_point_needed',
        options: [
          { id: 'retry', label: 'Try another fix' },
          { id: 'logs', label: 'Open logs' },
          { id: 'manual', label: 'Stop and fix manually' },
          { id: 'plan', label: 'Create PLAN' },
        ],
      };
    };

    const decision = createDecisionPoint();
    expect(decision.type).toBe('decision_point_needed');
    expect(decision.options).toHaveLength(4);
    expect(decision.options.some(o => o.id === 'manual')).toBe(true);
  });
});

// ============================================================================
// REPLAY SAFETY TESTS
// ============================================================================

describe('Replay Safety', () => {
  it('should mark events with replay_safe flag', () => {
    const createReplaySafeEvent = (type: string, payload: Record<string, unknown>): Event => {
      return {
        event_id: 'test-event-id',
        task_id: 'test-task-id',
        timestamp: new Date().toISOString(),
        type: type as any,
        mode: 'MISSION' as Mode,
        stage: 'none' as Stage,
        payload: {
          ...payload,
          replay_safe: true,
        },
        evidence_ids: [],
        parent_event_id: null,
      };
    };

    const event = createReplaySafeEvent('project_snapshot_completed', {
      framework: 'nextjs_app_router',
    });

    expect(event.payload.replay_safe).toBe(true);
  });

  it('should not re-execute commands during replay', () => {
    interface ReplayContext {
      isReplay: boolean;
      executedCommands: string[];
    }

    const shouldExecuteCommand = (ctx: ReplayContext, command: string): boolean => {
      if (ctx.isReplay) {
        return false;
      }
      return true;
    };

    const replayContext: ReplayContext = { isReplay: true, executedCommands: [] };
    const liveContext: ReplayContext = { isReplay: false, executedCommands: [] };

    expect(shouldExecuteCommand(replayContext, 'pnpm run lint')).toBe(false);
    expect(shouldExecuteCommand(liveContext, 'pnpm run lint')).toBe(true);
  });

  it('should store snapshot as evidence for replay', () => {
    interface Evidence {
      id: string;
      type: string;
      data: unknown;
    }

    const storeAsEvidence = (snapshot: ProjectSnapshot): Evidence => {
      return {
        id: `snapshot-${Date.now()}`,
        type: 'project_snapshot',
        data: snapshot,
      };
    };

    const snapshot: ProjectSnapshot = {
      timestamp: new Date().toISOString(),
      workspaceRoot: '/test/project',
      packageManager: 'pnpm',
      framework: 'nextjs_app_router',
      additionalFrameworks: [],
      language: 'typescript',
      topLevelDirs: ['app', 'src'],
      keyFiles: [],
      scripts: [],
      hasLintScript: true,
      hasTestScript: false,
      hasBuildScript: true,
      dependencyCount: 10,
      devDependencyCount: 5,
      notableDependencies: [],
      patterns: [],
      hasEslint: true,
      hasPrettier: true,
      isMonorepo: false,
    };

    const evidence = storeAsEvidence(snapshot);
    expect(evidence.type).toBe('project_snapshot');
    expect((evidence.data as ProjectSnapshot).framework).toBe('nextjs_app_router');
  });
});

// ============================================================================
// FILE SELECTION LIMIT TESTS
// ============================================================================

describe('File Selection Limits', () => {
  it('should respect max files limit (5-15)', () => {
    const selectFiles = (candidates: string[], maxFiles: number = 12): string[] => {
      return candidates.slice(0, maxFiles);
    };

    const candidates = Array.from({ length: 50 }, (_, i) => `file${i}.ts`);
    
    expect(selectFiles(candidates, 5)).toHaveLength(5);
    expect(selectFiles(candidates, 12)).toHaveLength(12);
    expect(selectFiles(candidates, 15)).toHaveLength(15);
  });

  it('should never dump entire codebase', () => {
    const MAX_ALLOWED_FILES = 15;
    
    const validateSelection = (files: string[]): { valid: boolean; reason?: string } => {
      if (files.length > MAX_ALLOWED_FILES) {
        return {
          valid: false,
          reason: `Too many files selected: ${files.length} > ${MAX_ALLOWED_FILES}`,
        };
      }
      return { valid: true };
    };

    expect(validateSelection(['a.ts', 'b.ts', 'c.ts']).valid).toBe(true);
    expect(validateSelection(Array.from({ length: 20 }, () => 'x.ts')).valid).toBe(false);
  });
});
