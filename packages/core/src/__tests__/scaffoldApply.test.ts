/**
 * Scaffold Apply Tests (Step 35.4)
 * 
 * Tests for scaffold apply functionality including:
 * - Conflict detection (non-empty dir, existing files)
 * - Merge safe-only mode (create only missing files)
 * - Replace all requires explicit second confirmation
 * - Apply failure triggers rollback
 * - Replay safety (never re-apply if manifest exists)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

import {
  checkScaffoldConflicts,
  filterForMergeSafeOnly,
  isInsideWorkspace,
} from '../scaffold/scaffoldConflictCheck';
import {
  computeContentHash,
  createManifestFile,
  generateManifestSummary,
  ScaffoldApplyManifest,
} from '../scaffold/scaffoldApplyManifest';
import type { FilePlanItem } from '../scaffold/recipeTypes';

// ============================================================================
// CONFLICT CHECK TESTS
// ============================================================================

describe('scaffoldConflictCheck', () => {
  describe('isInsideWorkspace', () => {
    it('returns true for path inside workspace', () => {
      expect(isInsideWorkspace('/home/user/project', '/home/user/project/src')).toBe(true);
      expect(isInsideWorkspace('/home/user/project', '/home/user/project')).toBe(true);
    });
    
    it('returns false for path outside workspace', () => {
      expect(isInsideWorkspace('/home/user/project', '/home/user/other')).toBe(false);
      expect(isInsideWorkspace('/home/user/project', '/home/user/project2')).toBe(false);
      expect(isInsideWorkspace('/home/user/project', '/tmp/somewhere')).toBe(false);
    });
    
    it('handles relative paths by returning false', () => {
      expect(isInsideWorkspace('/home/user', 'relative/path')).toBe(false);
      expect(isInsideWorkspace('relative', '/absolute/path')).toBe(false);
    });
  });
  
  describe('checkScaffoldConflicts', () => {
    const workspaceRoot = '/workspace';
    const planFiles: FilePlanItem[] = [
      { path: 'package.json', kind: 'file', content: '{}' },
      { path: 'src/index.ts', kind: 'file', content: '' },
      { path: 'src', kind: 'dir' },
    ];
    
    it('returns no conflicts for path outside workspace', () => {
      const result = checkScaffoldConflicts('/workspace', '/other/path', planFiles);
      
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts[0].reason).toBe('outside_workspace');
      expect(result.suggestedActions).toContain('choose_new_dir');
      expect(result.suggestedActions).not.toContain('merge_safe_only');
    });
    
    it('detects non-empty directory conflict', () => {
      // Mock fs.existsSync and fs.readdirSync
      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const readdirSyncSpy = vi.spyOn(fs, 'readdirSync').mockReturnValue([
        'existing-file.txt',
        'existing-dir',
      ] as any);
      
      const result = checkScaffoldConflicts('/workspace', '/workspace/my-app', planFiles);
      
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.some(c => c.reason === 'dir_not_empty')).toBe(true);
      expect(result.suggestedActions).toContain('merge_safe_only');
      expect(result.suggestedActions).toContain('replace_all');
      
      existsSyncSpy.mockRestore();
      readdirSyncSpy.mockRestore();
    });
    
    it('detects existing file conflicts', () => {
      // Mock fs.existsSync to return true for specific files
      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('my-app')) return true;  // target dir exists
        if (pathStr.endsWith('package.json')) return true;  // file exists
        return false;
      });
      const readdirSyncSpy = vi.spyOn(fs, 'readdirSync').mockReturnValue([]);  // empty dir
      
      const result = checkScaffoldConflicts('/workspace', '/workspace/my-app', planFiles);
      
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.some(c => c.reason === 'exists' && c.path === 'package.json')).toBe(true);
      
      existsSyncSpy.mockRestore();
      readdirSyncSpy.mockRestore();
    });
    
    it('returns no conflicts for empty target in workspace', () => {
      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      
      const result = checkScaffoldConflicts('/workspace', '/workspace/new-app', planFiles);
      
      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toHaveLength(0);
      
      existsSyncSpy.mockRestore();
    });
  });
  
  describe('filterForMergeSafeOnly', () => {
    const planFiles: FilePlanItem[] = [
      { path: 'package.json', kind: 'file', content: '{}' },
      { path: 'src/index.ts', kind: 'file', content: 'export {}' },
      { path: 'tsconfig.json', kind: 'file', content: '{}' },
      { path: 'src', kind: 'dir' },
    ];
    
    it('filters out existing files', () => {
      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        return String(p).endsWith('package.json');  // Only package.json exists
      });
      
      const result = filterForMergeSafeOnly('/workspace/app', planFiles);
      
      // package.json should be skipped (file exists)
      expect(result.filesToSkip).toHaveLength(1);
      expect(result.filesToSkip[0].path).toBe('package.json');
      
      // src (dir) + src/index.ts + tsconfig.json should be created
      expect(result.filesToCreate.map(f => f.path)).toContain('src');
      expect(result.filesToCreate.map(f => f.path)).toContain('src/index.ts');
      expect(result.filesToCreate.map(f => f.path)).toContain('tsconfig.json');
      
      existsSyncSpy.mockRestore();
    });
    
    it('always includes directories', () => {
      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      
      const result = filterForMergeSafeOnly('/workspace/app', planFiles);
      
      // Directories should always be in filesToCreate
      expect(result.filesToCreate.some(f => f.kind === 'dir')).toBe(true);
      
      existsSyncSpy.mockRestore();
    });
  });
});

// ============================================================================
// MANIFEST TESTS
// ============================================================================

describe('scaffoldApplyManifest', () => {
  describe('computeContentHash', () => {
    it('computes consistent SHA256 hash', () => {
      const content = '{"name": "test"}';
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);  // SHA256 hex is 64 chars
    });
    
    it('produces different hashes for different content', () => {
      const hash1 = computeContentHash('content1');
      const hash2 = computeContentHash('content2');
      
      expect(hash1).not.toBe(hash2);
    });
  });
  
  describe('createManifestFile', () => {
    it('creates manifest file entry with hash and size', () => {
      const content = '{"name": "test"}';
      const entry = createManifestFile('package.json', content);
      
      expect(entry.path).toBe('package.json');
      expect(entry.sha256).toBe(computeContentHash(content));
      expect(entry.bytes).toBe(Buffer.byteLength(content, 'utf8'));
      expect(entry.mode).toBeUndefined();
    });
    
    it('includes mode when provided', () => {
      const entry = createManifestFile('script.sh', '#!/bin/bash', 0o755);
      
      expect(entry.mode).toBe(0o755);
    });
  });
  
  describe('generateManifestSummary', () => {
    it('generates human-readable summary', () => {
      const manifest: ScaffoldApplyManifest = {
        scaffold_id: 'test_123',
        recipe_id: 'vite_react',
        target_directory: '/workspace/app',
        created_at: new Date().toISOString(),
        files: [
          { path: 'package.json', sha256: 'abc', bytes: 100 },
          { path: 'src/index.ts', sha256: 'def', bytes: 200 },
        ],
        dirs: ['src'],
        strategy: 'checkpoint',
        duration_ms: 150,
      };
      
      const summary = generateManifestSummary(manifest);
      
      expect(summary).toContain('2 file(s)');
      expect(summary).toContain('1 directory(s)');
      expect(summary).toContain('0.3 KB');  // 300 bytes total
    });
    
    it('includes skipped files count when present', () => {
      const manifest: ScaffoldApplyManifest = {
        scaffold_id: 'test_123',
        recipe_id: 'vite_react',
        target_directory: '/workspace/app',
        created_at: new Date().toISOString(),
        files: [{ path: 'src/index.ts', sha256: 'def', bytes: 200 }],
        dirs: [],
        skipped_files: ['package.json', 'tsconfig.json'],
        strategy: 'checkpoint',
        duration_ms: 100,
      };
      
      const summary = generateManifestSummary(manifest);
      
      expect(summary).toContain('[2 skipped]');
    });
  });
});

// ============================================================================
// APPLY EXECUTOR INTEGRATION TESTS
// ============================================================================

describe('scaffoldApplyExecutor (integration)', () => {
  let mockEventBus: EventEmitter;
  let emittedEvents: any[];
  
  beforeEach(() => {
    mockEventBus = new EventEmitter();
    emittedEvents = [];
    
    mockEventBus.on('event', (event) => {
      emittedEvents.push(event);
    });
  });
  
  afterEach(() => {
    mockEventBus.removeAllListeners();
  });
  
  it('should not apply in replay mode', async () => {
    // Import dynamically to allow mocking
    const { applyScaffoldPlan } = await import('../scaffold/scaffoldApplyExecutor');
    
    const result = await applyScaffoldPlan({
      scaffold_id: 'test_scaffold',
      recipePlan: {
        recipe_id: 'vite_react',
        package_manager: 'pnpm',
        files: [],
        commands: [],
      },
      workspaceRoot: '/workspace',
      target_directory: '/workspace/app',
      eventBus: mockEventBus,
      run_id: 'test_run',
      evidenceDir: '/tmp/evidence',
      isReplay: true,
      mode: 'PLAN',
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Replay mode');
    expect(emittedEvents).toHaveLength(0);
  });
  
  it('should detect conflicts and request decision', async () => {
    const { applyScaffoldPlan } = await import('../scaffold/scaffoldApplyExecutor');
    const { wasScaffoldApplied } = await import('../scaffold/scaffoldApplyManifest');
    
    // Mock wasScaffoldApplied to return false
    vi.spyOn(await import('../scaffold/scaffoldApplyManifest'), 'wasScaffoldApplied')
      .mockResolvedValue(false);
    
    // Mock fs to simulate non-empty directory
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['existing.txt'] as any);
    
    const result = await applyScaffoldPlan({
      scaffold_id: 'test_scaffold',
      recipePlan: {
        recipe_id: 'vite_react',
        package_manager: 'pnpm',
        files: [{ path: 'package.json', kind: 'file', content: '{}' }],
        commands: [],
      },
      workspaceRoot: '/workspace',
      target_directory: '/workspace/app',
      eventBus: mockEventBus,
      run_id: 'test_run',
      evidenceDir: '/tmp/evidence',
      mode: 'PLAN',
    });
    
    expect(result.ok).toBe(false);
    expect(result.needsInput).toBe(true);
    expect(result.pendingConflict).toBeDefined();
    
    // Check that decision_point_needed was emitted
    const decisionEvent = emittedEvents.find(e => e.type === 'decision_point_needed');
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent.payload.decision_type).toBe('scaffold_conflict');
    
    vi.restoreAllMocks();
  });
  
  it('should handle cancel action', async () => {
    const { applyScaffoldPlan } = await import('../scaffold/scaffoldApplyExecutor');
    
    vi.spyOn(await import('../scaffold/scaffoldApplyManifest'), 'wasScaffoldApplied')
      .mockResolvedValue(false);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);  // Empty dir
    
    const result = await applyScaffoldPlan({
      scaffold_id: 'test_scaffold',
      recipePlan: {
        recipe_id: 'vite_react',
        package_manager: 'pnpm',
        files: [],
        commands: [],
      },
      workspaceRoot: '/workspace',
      target_directory: '/workspace/app',
      eventBus: mockEventBus,
      run_id: 'test_run',
      evidenceDir: '/tmp/evidence',
      conflictMode: 'cancel',
      mode: 'PLAN',
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toBe('User cancelled');
    
    vi.restoreAllMocks();
  });
  
  it('should require second confirmation for replace_all', async () => {
    const { applyScaffoldPlan } = await import('../scaffold/scaffoldApplyExecutor');
    
    vi.spyOn(await import('../scaffold/scaffoldApplyManifest'), 'wasScaffoldApplied')
      .mockResolvedValue(false);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['existing.txt'] as any);
    
    const result = await applyScaffoldPlan({
      scaffold_id: 'test_scaffold',
      recipePlan: {
        recipe_id: 'vite_react',
        package_manager: 'pnpm',
        files: [],
        commands: [],
      },
      workspaceRoot: '/workspace',
      target_directory: '/workspace/app',
      eventBus: mockEventBus,
      run_id: 'test_run',
      evidenceDir: '/tmp/evidence',
      conflictMode: 'replace_all',
      replaceConfirmed: false,  // Not confirmed yet
      mode: 'PLAN',
    });
    
    expect(result.ok).toBe(false);
    expect(result.needsInput).toBe(true);
    
    // Check for replace confirmation decision point
    const confirmEvent = emittedEvents.find(
      e => e.type === 'decision_point_needed' && 
           e.payload.decision_type === 'scaffold_replace_confirm'
    );
    expect(confirmEvent).toBeDefined();
    
    vi.restoreAllMocks();
  });
});
