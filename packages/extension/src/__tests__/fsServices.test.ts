/**
 * P3-2: Extension FS Services Tests
 *
 * Tests for the file-system service implementations that don't
 * require the VS Code API:
 *   - FsTaskPersistenceService
 *   - FsMemoryService
 *   - FsToolRegistryService
 *   - AttachmentEvidenceStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { FsTaskPersistenceService } from '../fsTaskPersistenceService';
import { FsMemoryService } from '../fsMemoryService';
import { FsToolRegistryService } from '../fsToolRegistryService';
import {
  storeAttachment,
  readAttachment,
  attachmentExists,
  getAttachmentMetadata,
  validateAttachment,
} from '../attachmentEvidenceStore';

// ============================================================================
// HELPERS
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-ext-test-'));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// FsTaskPersistenceService
// ============================================================================

describe('FsTaskPersistenceService', () => {
  let tempDir: string;
  let service: FsTaskPersistenceService;

  beforeEach(() => {
    tempDir = createTempDir();
    service = new FsTaskPersistenceService(tempDir);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it('setActiveTask creates metadata and active pointer', async () => {
    await service.setActiveTask({
      task_id: 'task_001',
      mode: 'ANSWER',
      stage: 'none',
      status: 'running',
      last_updated_at: new Date().toISOString(),
      cleanly_exited: false,
    });

    const active = await service.getActiveTask();
    expect(active).not.toBeNull();
    expect(active!.task_id).toBe('task_001');
    expect(active!.mode).toBe('ANSWER');
    expect(active!.status).toBe('running');
  });

  it('getActiveTask returns null when no active task', async () => {
    const active = await service.getActiveTask();
    expect(active).toBeNull();
  });

  it('markCleanExit sets cleanly_exited and paused status', async () => {
    await service.setActiveTask({
      task_id: 'task_002',
      mode: 'MISSION',
      stage: 'edit',
      status: 'running',
      last_updated_at: new Date().toISOString(),
      cleanly_exited: false,
    });

    await service.markCleanExit('task_002');

    const active = await service.getActiveTask();
    expect(active).not.toBeNull();
    expect(active!.cleanly_exited).toBe(true);
    expect(active!.status).toBe('paused');
  });

  it('markCleanExitSync works synchronously', async () => {
    await service.setActiveTask({
      task_id: 'task_003',
      mode: 'PLAN',
      stage: 'plan',
      status: 'running',
      last_updated_at: new Date().toISOString(),
      cleanly_exited: false,
    });

    // Synchronous call — no await
    service.markCleanExitSync('task_003');

    const active = await service.getActiveTask();
    expect(active!.cleanly_exited).toBe(true);
  });

  it('clearActiveTask removes metadata and pointer', async () => {
    await service.setActiveTask({
      task_id: 'task_004',
      mode: 'ANSWER',
      stage: 'none',
      status: 'running',
      last_updated_at: new Date().toISOString(),
      cleanly_exited: false,
    });

    await service.clearActiveTask();

    const active = await service.getActiveTask();
    expect(active).toBeNull();
  });

  it('handles multiple task updates', async () => {
    await service.setActiveTask({
      task_id: 'task_005',
      mode: 'ANSWER',
      stage: 'none',
      status: 'running',
      last_updated_at: new Date().toISOString(),
      cleanly_exited: false,
    });

    // Update same task with new stage
    await service.setActiveTask({
      task_id: 'task_005',
      mode: 'MISSION',
      stage: 'edit',
      status: 'running',
      last_updated_at: new Date().toISOString(),
      cleanly_exited: false,
    });

    const active = await service.getActiveTask();
    expect(active!.mode).toBe('MISSION');
    expect(active!.stage).toBe('edit');
  });
});

// ============================================================================
// FsMemoryService
// ============================================================================

describe('FsMemoryService', () => {
  let tempDir: string;
  let service: FsMemoryService;

  beforeEach(() => {
    tempDir = createTempDir();
    service = new FsMemoryService(path.join(tempDir, 'memory'));
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it('readFacts returns empty string when no facts exist', async () => {
    const facts = await service.readFacts();
    expect(facts).toBe('');
  });

  it('appendFacts writes and reads back facts', async () => {
    const lineCount = await service.appendFacts('Project uses React 18');
    expect(lineCount).toBe(1);

    const facts = await service.readFacts();
    expect(facts).toContain('React 18');
  });

  it('appendFacts appends to existing facts', async () => {
    await service.appendFacts('Fact 1');
    await service.appendFacts('Fact 2');

    const facts = await service.readFacts();
    expect(facts).toContain('Fact 1');
    expect(facts).toContain('Fact 2');
  });

  it('saveSolution and loadSolutions round-trip', async () => {
    const solution = {
      solution_id: 'sol_001',
      problem: 'Build failed',
      fix: 'Added missing dependency',
      files_changed: ['package.json'],
      tags: ['build', 'deps'],
      verification: {
        command: 'pnpm build',
        type: 'build' as const,
        passed_at: new Date().toISOString(),
        summary: 'Build succeeded',
      },
      captured_at: new Date().toISOString(),
      run_id: 'run_001',
    };

    await service.saveSolution(solution);

    const solutions = await service.loadSolutions();
    expect(solutions.length).toBe(1);
    expect(solutions[0].solution_id).toBe('sol_001');
    expect(solutions[0].problem).toBe('Build failed');
  });

  it('loadSolution returns null for non-existent solution', async () => {
    const result = await service.loadSolution('nonexistent');
    expect(result).toBeNull();
  });

  it('handles multiple solutions', async () => {
    for (let i = 1; i <= 3; i++) {
      await service.saveSolution({
        solution_id: `sol_${i}`,
        problem: `Problem ${i}`,
        fix: `Fix ${i}`,
        files_changed: [],
        tags: [],
        verification: {
          command: 'test',
          type: 'tests' as const,
          passed_at: new Date().toISOString(),
          summary: `Test ${i} passed`,
        },
        captured_at: new Date().toISOString(),
        run_id: `run_${i}`,
      });
    }

    const solutions = await service.loadSolutions();
    expect(solutions.length).toBe(3);
  });
});

// ============================================================================
// FsToolRegistryService
// ============================================================================

describe('FsToolRegistryService', () => {
  let tempDir: string;
  let service: FsToolRegistryService;

  beforeEach(() => {
    tempDir = createTempDir();
    service = new FsToolRegistryService(path.join(tempDir, 'tools'));
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it('loadRegistry returns empty registry when none exists', async () => {
    const registry = await service.loadRegistry();
    expect(registry.version).toBe(1);
    expect(registry.tools).toHaveLength(0);
  });

  it('saveTool saves code and registry entry', async () => {
    await service.saveTool('my_tool', 'module.exports = () => "hello";', {
      description: 'A test tool',
      inputs_schema: {},
      outputs_schema: {},
      allow: { network: false, commands: ['node'] },
    });

    const entry = await service.getTool('my_tool');
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe('my_tool');
    expect(entry!.description).toBe('A test tool');
    expect(entry!.code_hash).toBeTruthy();
  });

  it('loadToolCode reads back saved code', async () => {
    const code = 'module.exports = () => 42;';
    await service.saveTool('calc', code, {
      description: 'Calculator',
      inputs_schema: {},
      outputs_schema: {},
    });

    const loaded = await service.loadToolCode('calc');
    expect(loaded).toBe(code);
  });

  it('deleteTool removes code and registry entry', async () => {
    await service.saveTool('to_delete', 'code', {
      description: 'Temp',
      inputs_schema: {},
      outputs_schema: {},
    });

    await service.deleteTool('to_delete');

    const entry = await service.getTool('to_delete');
    expect(entry).toBeNull();

    const code = await service.loadToolCode('to_delete');
    expect(code).toBeNull();
  });

  it('upserts existing tool', async () => {
    await service.saveTool('evolving', 'v1', {
      description: 'Version 1',
      inputs_schema: {},
      outputs_schema: {},
    });

    await service.saveTool('evolving', 'v2', {
      description: 'Version 2',
      inputs_schema: {},
      outputs_schema: {},
    });

    const registry = await service.loadRegistry();
    const evolving = registry.tools.filter(t => t.name === 'evolving');
    expect(evolving).toHaveLength(1);
    expect(evolving[0].description).toBe('Version 2');

    const code = await service.loadToolCode('evolving');
    expect(code).toBe('v2');
  });
});

// ============================================================================
// AttachmentEvidenceStore
// ============================================================================

describe('AttachmentEvidenceStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it('validateAttachment accepts valid attachment', () => {
    const result = validateAttachment({
      id: 'att_1',
      name: 'test.png',
      mimeType: 'image/png',
      data: Buffer.from('fake image data').toString('base64'),
    });
    expect(result.valid).toBe(true);
  });

  it('validateAttachment rejects oversized file', () => {
    const bigData = Buffer.alloc(6 * 1024 * 1024).toString('base64');
    const result = validateAttachment({
      id: 'att_2',
      name: 'big.png',
      mimeType: 'image/png',
      data: bigData,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
  });

  it('validateAttachment rejects unsupported MIME type', () => {
    const result = validateAttachment({
      id: 'att_3',
      name: 'virus.exe',
      mimeType: 'application/x-msdownload',
      data: Buffer.from('evil').toString('base64'),
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported MIME type');
  });

  it('storeAttachment stores and reads back', async () => {
    const content = 'Hello attachment world!';
    const result = await storeAttachment(tempDir, {
      id: 'att_4',
      name: 'test.txt',
      mimeType: 'text/plain',
      data: Buffer.from(content).toString('base64'),
    });

    expect(result.success).toBe(true);
    expect(result.evidenceId).toBeTruthy();
    expect(result.sha256).toBeTruthy();
    expect(result.deduplicated).toBe(false);

    // Read back
    const buf = await readAttachment(tempDir, result.evidencePath!);
    expect(buf).not.toBeNull();
    expect(buf!.toString('utf-8')).toBe(content);
  });

  it('storeAttachment deduplicates identical files', async () => {
    const data = Buffer.from('same content').toString('base64');
    const att = { id: 'att_5', name: 'dup.txt', mimeType: 'text/plain', data };

    const first = await storeAttachment(tempDir, att);
    expect(first.deduplicated).toBe(false);

    const second = await storeAttachment(tempDir, { ...att, id: 'att_6' });
    expect(second.deduplicated).toBe(true);
    expect(second.evidenceId).toBe(first.evidenceId);
  });

  it('attachmentExists returns correct state', async () => {
    const result = await storeAttachment(tempDir, {
      id: 'att_7',
      name: 'exists.json',
      mimeType: 'application/json',
      data: Buffer.from('{}').toString('base64'),
    });

    expect(await attachmentExists(tempDir, result.evidencePath!)).toBe(true);
    expect(await attachmentExists(tempDir, 'nonexistent/path.txt')).toBe(false);
  });

  it('getAttachmentMetadata returns stored metadata', async () => {
    const result = await storeAttachment(tempDir, {
      id: 'att_8',
      name: 'meta.txt',
      mimeType: 'text/plain',
      data: Buffer.from('metadata test').toString('base64'),
    });

    const meta = await getAttachmentMetadata(tempDir, result.evidencePath!);
    expect(meta).not.toBeNull();
    expect(meta!.evidenceId).toBe(result.evidenceId);
    expect(meta!.originalName).toBe('meta.txt');
    expect(meta!.mimeType).toBe('text/plain');
    expect(meta!.sha256).toBe(result.sha256);
  });
});
