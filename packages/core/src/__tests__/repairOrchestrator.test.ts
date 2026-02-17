/**
 * Tests for RepairOrchestrator — LLM-powered diagnosis + code fix generation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RepairOrchestrator, DiagnosisResult, ReadFileFn } from '../repairOrchestrator';
import { EventStore } from '../eventStore';
import { EventBus } from '../eventBus';
import { AutonomyController, DEFAULT_A1_BUDGETS } from '../autonomyController';
import { TestRunner } from '../testRunner';
import { DiffManager, FileDiff } from '../diffManager';
import { ApprovalManager } from '../approvalManager';
import { CheckpointManager } from '../checkpointManager';
import { ModeManager } from '../modeManager';
import { InMemoryEvidenceStore } from '../toolExecutor';
import { FAST_MODEL, EDIT_MODEL } from '../modelRegistry';
import type { LLMClient, LLMClientResponse } from '../agenticLoop';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _tmpDirs: string[] = [];

function createTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-repair-'));
  _tmpDirs.push(dir);
  return dir;
}

function createEventBus(): EventBus {
  const dir = createTmpDir();
  const store = new EventStore(path.join(dir, 'events.jsonl'));
  return new EventBus(store);
}

function textResponse(text: string, stopReason: string = 'end_turn'): LLMClientResponse {
  return {
    id: 'msg_test',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/** Create a mock LLMClient */
function createMockLLMClient(handler?: (params: any) => LLMClientResponse): LLMClient {
  return {
    createMessage: vi.fn().mockImplementation(async (params) => {
      if (handler) return handler(params);
      return textResponse('{}');
    }),
  };
}

/** Build a RepairOrchestrator with all mock dependencies */
function buildOrchestrator(opts?: {
  llmClient?: LLMClient | null;
  readFile?: ReadFileFn | null;
}) {
  const eventBus = createEventBus();
  const dir = createTmpDir();
  const checkpointManager = new CheckpointManager(eventBus, path.join(dir, 'checkpoints'));
  const approvalManager = new ApprovalManager(eventBus);
  const modeManager = new ModeManager('task-1', eventBus);
  const autonomyController = new AutonomyController(
    'task-1', eventBus, checkpointManager, modeManager, DEFAULT_A1_BUDGETS
  );

  const evidenceStore = new InMemoryEvidenceStore();
  const diffManager = new DiffManager(
    'task-1', eventBus, approvalManager, checkpointManager, evidenceStore, dir
  );

  // Mock proposeDiff to return a proposal ID
  vi.spyOn(diffManager, 'proposeDiff').mockResolvedValue('proposal-123');

  // Create TestRunner with mock evidence store
  const testEvidenceDir = path.join(dir, 'evidence');
  fs.mkdirSync(testEvidenceDir, { recursive: true });

  // We don't create a real TestRunner since its constructor needs various deps
  // Instead we create the orchestrator directly
  const testRunner = {
    runTests: vi.fn().mockResolvedValue(null),
    detectTestCommand: vi.fn().mockResolvedValue(null),
  } as unknown as TestRunner;

  const orchestrator = new RepairOrchestrator(
    'task-1',
    eventBus,
    autonomyController,
    testRunner,
    diffManager,
    approvalManager,
    opts?.llmClient,
    opts?.readFile,
  );

  return { orchestrator, eventBus, autonomyController, diffManager, testRunner };
}

const TEST_FAILURE = {
  command: 'npm test',
  exit_code: 1,
  stderr: 'FAIL src/utils.test.ts\n  TypeError: Cannot read properties of undefined (reading "foo")\n    at Object.<anonymous> (src/utils.ts:42:12)',
  stdout: '',
  summary: 'TypeError in utils.ts',
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true }); } catch { /* ok */ }
  }
  _tmpDirs = [];
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Diagnosis Tests — LLM path
// ---------------------------------------------------------------------------

describe('RepairOrchestrator — LLM Diagnosis', () => {
  it('calls FAST_MODEL and parses valid JSON diagnosis', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({
        failure_summary: 'TypeError in utils.ts line 42',
        likely_causes: ['Property access on undefined variable'],
        affected_files: ['src/utils.ts'],
        root_cause_file: 'src/utils.ts',
        suggested_fix_approach: 'Add null check before accessing .foo',
        confidence: 0.9,
      }))
    );

    const { orchestrator, eventBus } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    // Access private method via any cast
    const diagnosis = await (orchestrator as any).diagnoseLLM();

    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.failure_summary).toBe('TypeError in utils.ts line 42');
    expect(diagnosis!.likely_causes).toEqual(['Property access on undefined variable']);
    expect(diagnosis!.affected_files).toEqual(['src/utils.ts']);
    expect(diagnosis!.root_cause_file).toBe('src/utils.ts');
    expect(diagnosis!.confidence).toBe(0.9);

    expect(llmClient.createMessage).toHaveBeenCalledOnce();
    const callArgs = (llmClient.createMessage as any).mock.calls[0][0];
    expect(callArgs.model).toBe(FAST_MODEL);
    expect(callArgs.max_tokens).toBe(2048);
  });

  it('falls back to heuristic on max_tokens stop_reason', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse('{"failure_summary": "partial...', 'max_tokens')
    );

    const { orchestrator } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis = await (orchestrator as any).diagnoseLLM();
    expect(diagnosis).toBeNull();
  });

  it('falls back to heuristic on JSON parse failure', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse('This is not valid JSON at all')
    );

    const { orchestrator } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis = await (orchestrator as any).diagnoseLLM();
    expect(diagnosis).toBeNull();
  });

  it('throws on LLM error (caller catches and falls back)', async () => {
    const llmClient: LLMClient = {
      createMessage: vi.fn().mockRejectedValue(new Error('API rate limit')),
    };

    const { orchestrator } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    // diagnoseLLM propagates the error; diagnoseFailure catches it
    await expect((orchestrator as any).diagnoseLLM()).rejects.toThrow('API rate limit');
  });

  it('falls back to heuristic when llmClient is null', async () => {
    const { orchestrator } = buildOrchestrator({ llmClient: null });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis = await (orchestrator as any).diagnoseLLM();
    expect(diagnosis).toBeNull();
  });

  it('caps affected_files at 5', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({
        failure_summary: 'Multi-file failure',
        likely_causes: ['Bug'],
        affected_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'],
        suggested_fix_approach: 'Fix it',
      }))
    );

    const { orchestrator } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis = await (orchestrator as any).diagnoseLLM();
    expect(diagnosis!.affected_files).toHaveLength(5);
  });

  it('returns null when required fields are missing from LLM response', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({
        failure_summary: 'Some failure',
        // missing likely_causes and affected_files
      }))
    );

    const { orchestrator } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis = await (orchestrator as any).diagnoseLLM();
    expect(diagnosis).toBeNull();
  });

  it('caps likely_causes at 4', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({
        failure_summary: 'Failure',
        likely_causes: ['a', 'b', 'c', 'd', 'e', 'f'],
        affected_files: ['src/a.ts'],
        suggested_fix_approach: 'Fix',
      }))
    );

    const { orchestrator } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis = await (orchestrator as any).diagnoseLLM();
    expect(diagnosis!.likely_causes).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Diagnosis Tests — Heuristic path
// ---------------------------------------------------------------------------

describe('RepairOrchestrator — Heuristic Diagnosis', () => {
  it('extracts file paths from error text', () => {
    const { orchestrator } = buildOrchestrator();
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis = (orchestrator as any).diagnoseHeuristic() as DiagnosisResult;
    expect(diagnosis.affected_files).toContain('src/utils.test.ts');
    expect(diagnosis.affected_files).toContain('src/utils.ts');
    expect(diagnosis.likely_causes).toHaveLength(4);
    expect(diagnosis.suggested_fix_approach).toContain('Review error messages');
  });

  it('uses summary when no error lines found', () => {
    const { orchestrator } = buildOrchestrator();
    orchestrator.setLastTestFailure({
      command: 'npm test',
      exit_code: 1,
      stderr: '',
      stdout: 'some output without known patterns',
      summary: 'Custom summary',
    });

    const diagnosis = (orchestrator as any).diagnoseHeuristic() as DiagnosisResult;
    expect(diagnosis.failure_summary).toBe('Custom summary');
  });

  it('provides fallback when no files found', () => {
    const { orchestrator } = buildOrchestrator();
    orchestrator.setLastTestFailure({
      command: 'npm test',
      exit_code: 1,
      stderr: 'Something went wrong',
      stdout: '',
      summary: 'Error',
    });

    const diagnosis = (orchestrator as any).diagnoseHeuristic() as DiagnosisResult;
    expect(diagnosis.affected_files).toEqual(['(unknown - check test output)']);
  });
});

// ---------------------------------------------------------------------------
// diagnoseFailure — integration (LLM-first, heuristic fallback)
// ---------------------------------------------------------------------------

describe('RepairOrchestrator — diagnoseFailure integration', () => {
  it('emits repair_attempted event with diagnosis_source: llm on success', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({
        failure_summary: 'LLM diagnosis',
        likely_causes: ['cause1'],
        affected_files: ['file.ts'],
        suggested_fix_approach: 'Fix approach',
      }))
    );

    const { orchestrator, eventBus } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const publishedEvents: any[] = [];
    eventBus.subscribe(async (event) => { publishedEvents.push(event); });

    const diagnosis = await (orchestrator as any).diagnoseFailure('MISSION', 'repair');

    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.failure_summary).toBe('LLM diagnosis');

    const repairEvent = publishedEvents.find(e => e.type === 'repair_attempted');
    expect(repairEvent).toBeDefined();
    expect(repairEvent.payload.diagnosis_source).toBe('llm');
  });

  it('emits repair_attempted event with diagnosis_source: heuristic when LLM fails', async () => {
    const llmClient: LLMClient = {
      createMessage: vi.fn().mockRejectedValue(new Error('API error')),
    };

    const { orchestrator, eventBus } = buildOrchestrator({ llmClient });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const publishedEvents: any[] = [];
    eventBus.subscribe(async (event) => { publishedEvents.push(event); });

    const diagnosis = await (orchestrator as any).diagnoseFailure('MISSION', 'repair');

    expect(diagnosis).not.toBeNull();
    const repairEvent = publishedEvents.find(e => e.type === 'repair_attempted');
    expect(repairEvent.payload.diagnosis_source).toBe('heuristic');
  });

  it('emits heuristic when no llmClient', async () => {
    const { orchestrator, eventBus } = buildOrchestrator({ llmClient: null });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const publishedEvents: any[] = [];
    eventBus.subscribe(async (event) => { publishedEvents.push(event); });

    await (orchestrator as any).diagnoseFailure('MISSION', 'repair');

    const repairEvent = publishedEvents.find(e => e.type === 'repair_attempted');
    expect(repairEvent.payload.diagnosis_source).toBe('heuristic');
  });

  it('returns null when no test failure set', async () => {
    const { orchestrator } = buildOrchestrator();
    const diagnosis = await (orchestrator as any).diagnoseFailure('MISSION', 'repair');
    expect(diagnosis).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Code Fix Tests — LLM path
// ---------------------------------------------------------------------------

describe('RepairOrchestrator — LLM Code Fix', () => {
  const mockReadFile: ReadFileFn = async (filePath) => {
    if (filePath === 'src/utils.ts') {
      return 'export function foo() {\n  return bar.baz;\n}\n';
    }
    return null;
  };

  it('calls EDIT_MODEL and converts touched_files to FileDiff[]', async () => {
    const llmClient = createMockLLMClient((params) => {
      expect(params.model).toBe(EDIT_MODEL);
      expect(params.max_tokens).toBe(16384);
      return textResponse(JSON.stringify({
        touched_files: [
          {
            path: 'src/utils.ts',
            action: 'modify',
            new_content: 'export function foo() {\n  return bar?.baz;\n}\n',
          },
        ],
        explanation: 'Added optional chaining',
        confidence: 0.95,
      }));
    });

    const { orchestrator, diffManager } = buildOrchestrator({ llmClient, readFile: mockReadFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis: DiagnosisResult = {
      failure_summary: 'TypeError in utils.ts',
      likely_causes: ['Property access on undefined'],
      affected_files: ['src/utils.ts'],
      suggested_fix_approach: 'Add null check',
    };

    const proposalId = await (orchestrator as any).generateLLMFix(diagnosis);
    expect(proposalId).toBe('proposal-123');

    expect(diffManager.proposeDiff).toHaveBeenCalledOnce();
    const callArgs = (diffManager.proposeDiff as any).mock.calls[0];
    const diffs: FileDiff[] = callArgs[3];
    expect(diffs).toHaveLength(1);
    expect(diffs[0].file_path).toBe('src/utils.ts');
    expect(diffs[0].operation).toBe('modify');
    expect(diffs[0].old_content).toBe('export function foo() {\n  return bar.baz;\n}\n');
    expect(diffs[0].new_content).toBe('export function foo() {\n  return bar?.baz;\n}\n');
  });

  it('sets operation: create for new files', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({
        touched_files: [
          {
            path: 'src/newHelper.ts',
            action: 'create',
            new_content: 'export const helper = true;\n',
          },
        ],
        explanation: 'Created helper',
      }))
    );

    const { orchestrator, diffManager } = buildOrchestrator({ llmClient, readFile: mockReadFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis: DiagnosisResult = {
      failure_summary: 'Missing helper',
      likely_causes: ['Missing file'],
      affected_files: ['src/newHelper.ts'],
      suggested_fix_approach: 'Create it',
    };

    await (orchestrator as any).generateLLMFix(diagnosis);

    const diffs: FileDiff[] = (diffManager.proposeDiff as any).mock.calls[0][3];
    expect(diffs[0].operation).toBe('create');
    expect(diffs[0].old_content).toBeUndefined();
  });

  it('falls back when readFile returns null for modify action', async () => {
    const readFile: ReadFileFn = async () => null;
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({
        touched_files: [
          {
            path: 'src/missing.ts',
            action: 'modify',
            new_content: 'content',
          },
        ],
        explanation: 'Fix',
      }))
    );

    const { orchestrator, diffManager } = buildOrchestrator({ llmClient, readFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis: DiagnosisResult = {
      failure_summary: 'Error',
      likely_causes: ['Bug'],
      affected_files: ['src/missing.ts'],
      suggested_fix_approach: 'Fix it',
    };

    await (orchestrator as any).generateLLMFix(diagnosis);

    const diffs: FileDiff[] = (diffManager.proposeDiff as any).mock.calls[0][3];
    // When file can't be read, treated as create
    expect(diffs[0].operation).toBe('create');
  });

  it('returns null on max_tokens stop_reason', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse('{"touched_files": [{"path": "a.ts"', 'max_tokens')
    );

    const { orchestrator } = buildOrchestrator({ llmClient, readFile: mockReadFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const result = await (orchestrator as any).generateLLMFix({
      failure_summary: 'Error', likely_causes: [], affected_files: [],
      suggested_fix_approach: '',
    });
    expect(result).toBeNull();
  });

  it('returns null on JSON parse failure', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse('Not valid JSON response')
    );

    const { orchestrator } = buildOrchestrator({ llmClient, readFile: mockReadFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const result = await (orchestrator as any).generateLLMFix({
      failure_summary: 'Error', likely_causes: [], affected_files: [],
      suggested_fix_approach: '',
    });
    expect(result).toBeNull();
  });

  it('returns null on LLM error', async () => {
    const llmClient: LLMClient = {
      createMessage: vi.fn().mockRejectedValue(new Error('API error')),
    };

    const { orchestrator } = buildOrchestrator({ llmClient, readFile: mockReadFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    // generateLLMFix will throw (caller catches)
    await expect((orchestrator as any).generateLLMFix({
      failure_summary: 'Error', likely_causes: [], affected_files: [],
      suggested_fix_approach: '',
    })).rejects.toThrow('API error');
  });

  it('returns null when touched_files is empty', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({ touched_files: [], explanation: 'Nothing to fix' }))
    );

    const { orchestrator } = buildOrchestrator({ llmClient, readFile: mockReadFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const result = await (orchestrator as any).generateLLMFix({
      failure_summary: 'Error', likely_causes: [], affected_files: [],
      suggested_fix_approach: '',
    });
    expect(result).toBeNull();
  });

  it('caps touched_files at 5', async () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `src/file${i}.ts`,
      action: 'create',
      new_content: `// file ${i}`,
    }));

    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({ touched_files: files, explanation: 'Many files' }))
    );

    const { orchestrator, diffManager } = buildOrchestrator({ llmClient, readFile: mockReadFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    await (orchestrator as any).generateLLMFix({
      failure_summary: 'Error', likely_causes: [], affected_files: [],
      suggested_fix_approach: '',
    });

    const diffs: FileDiff[] = (diffManager.proposeDiff as any).mock.calls[0][3];
    expect(diffs.length).toBeLessThanOrEqual(5);
  });

  it('returns null when no llmClient', async () => {
    const { orchestrator } = buildOrchestrator({ llmClient: null });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const result = await (orchestrator as any).generateLLMFix({
      failure_summary: 'Error', likely_causes: [], affected_files: [],
      suggested_fix_approach: '',
    });
    expect(result).toBeNull();
  });

  it('returns null when no readFile', async () => {
    const llmClient = createMockLLMClient();
    const { orchestrator } = buildOrchestrator({ llmClient, readFile: null });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const result = await (orchestrator as any).generateLLMFix({
      failure_summary: 'Error', likely_causes: [], affected_files: [],
      suggested_fix_approach: '',
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readAffectedFiles
// ---------------------------------------------------------------------------

describe('RepairOrchestrator — readAffectedFiles', () => {
  it('reads up to 5 files, skips nulls and placeholders', async () => {
    const readFile: ReadFileFn = async (p) => {
      if (p === 'a.ts') return 'content-a';
      if (p === 'b.ts') return 'content-b';
      if (p === 'missing.ts') return null;
      return null;
    };

    const { orchestrator } = buildOrchestrator({ readFile });

    const files = await (orchestrator as any).readAffectedFiles([
      'a.ts', '(unknown)', 'b.ts', 'missing.ts',
    ]);

    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ path: 'a.ts', content: 'content-a' });
    expect(files[1]).toEqual({ path: 'b.ts', content: 'content-b' });
  });

  it('truncates files longer than 500 lines', async () => {
    const longContent = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
    const readFile: ReadFileFn = async () => longContent;

    const { orchestrator } = buildOrchestrator({ readFile });

    const files = await (orchestrator as any).readAffectedFiles(['big.ts']);
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('... (truncated)');
    expect(files[0].content.split('\n').length).toBeLessThanOrEqual(502); // 500 + truncation line
  });

  it('returns empty when no readFile', async () => {
    const { orchestrator } = buildOrchestrator({ readFile: null });
    const files = await (orchestrator as any).readAffectedFiles(['a.ts']);
    expect(files).toHaveLength(0);
  });

  it('skips files that throw', async () => {
    const readFile: ReadFileFn = async (p) => {
      if (p === 'error.ts') throw new Error('Permission denied');
      return 'ok';
    };

    const { orchestrator } = buildOrchestrator({ readFile });
    const files = await (orchestrator as any).readAffectedFiles(['error.ts', 'good.ts']);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('good.ts');
  });
});

// ---------------------------------------------------------------------------
// proposeRepairFix — integration (LLM-first, heuristic fallback)
// ---------------------------------------------------------------------------

describe('RepairOrchestrator — proposeRepairFix integration', () => {
  it('uses LLM when both llmClient and readFile available', async () => {
    const llmClient = createMockLLMClient(() =>
      textResponse(JSON.stringify({
        touched_files: [{ path: 'src/a.ts', action: 'create', new_content: 'fixed' }],
        explanation: 'Fixed the bug',
      }))
    );
    const readFile: ReadFileFn = async () => null;

    const { orchestrator, diffManager } = buildOrchestrator({ llmClient, readFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis: DiagnosisResult = {
      failure_summary: 'Error', likely_causes: ['Bug'],
      affected_files: ['src/a.ts'], suggested_fix_approach: 'Fix',
    };

    const result = await (orchestrator as any).proposeRepairFix('MISSION', 'repair', diagnosis);
    expect(result).toBe('proposal-123');
    // proposeDiff should have been called from generateLLMFix path
    expect(diffManager.proposeDiff).toHaveBeenCalledOnce();
  });

  it('falls back to heuristic when LLM fix fails', async () => {
    const llmClient: LLMClient = {
      createMessage: vi.fn().mockRejectedValue(new Error('LLM broke')),
    };
    const readFile: ReadFileFn = async () => null;

    const { orchestrator, diffManager } = buildOrchestrator({ llmClient, readFile });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis: DiagnosisResult = {
      failure_summary: 'Error', likely_causes: ['Bug'],
      affected_files: [], suggested_fix_approach: 'Fix',
    };

    const result = await (orchestrator as any).proposeRepairFix('MISSION', 'repair', diagnosis);
    expect(result).toBe('proposal-123');
    // Should still call proposeDiff (via heuristic path)
    expect(diffManager.proposeDiff).toHaveBeenCalledOnce();
    // Heuristic creates docs/ file
    const diffs: FileDiff[] = (diffManager.proposeDiff as any).mock.calls[0][3];
    expect(diffs[0].file_path).toMatch(/^docs\/repair_attempt_/);
  });

  it('uses heuristic when no llmClient', async () => {
    const { orchestrator, diffManager } = buildOrchestrator({ llmClient: null });
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis: DiagnosisResult = {
      failure_summary: 'Error', likely_causes: ['Bug'],
      affected_files: [], suggested_fix_approach: 'Fix',
    };

    const result = await (orchestrator as any).proposeRepairFix('MISSION', 'repair', diagnosis);
    expect(result).toBe('proposal-123');
    const diffs: FileDiff[] = (diffManager.proposeDiff as any).mock.calls[0][3];
    expect(diffs[0].file_path).toMatch(/^docs\/repair_attempt_/);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe('RepairOrchestrator — backward compatibility', () => {
  it('6-param constructor still works (V1 heuristic path)', async () => {
    const eventBus = createEventBus();
    const dir = createTmpDir();
    const checkpointManager = new CheckpointManager(eventBus, path.join(dir, 'checkpoints'));
    const approvalManager = new ApprovalManager(eventBus);
    const modeManager = new ModeManager('task-1', eventBus);
    const autonomyController = new AutonomyController(
      'task-1', eventBus, checkpointManager, modeManager, DEFAULT_A1_BUDGETS
    );
    const evidenceStore = new InMemoryEvidenceStore();
    const diffManager = new DiffManager(
      'task-1', eventBus, approvalManager, checkpointManager, evidenceStore, dir
    );
    vi.spyOn(diffManager, 'proposeDiff').mockResolvedValue('proposal-v1');

    const testRunner = {
      runTests: vi.fn().mockResolvedValue(null),
    } as unknown as TestRunner;

    // Old 6-param constructor (no llmClient, no readFile)
    const orchestrator = new RepairOrchestrator(
      'task-1', eventBus, autonomyController, testRunner, diffManager, approvalManager
    );

    orchestrator.setLastTestFailure(TEST_FAILURE);

    // diagnoseHeuristic should work fine
    const diagnosis = (orchestrator as any).diagnoseHeuristic() as DiagnosisResult;
    expect(diagnosis.failure_summary).toBe('TypeError in utils.ts');
    expect(diagnosis.likely_causes).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// proposeHeuristicFix
// ---------------------------------------------------------------------------

describe('RepairOrchestrator — proposeHeuristicFix', () => {
  it('creates a docs/ markdown file via DiffManager', async () => {
    const { orchestrator, diffManager } = buildOrchestrator();
    orchestrator.setLastTestFailure(TEST_FAILURE);

    const diagnosis: DiagnosisResult = {
      failure_summary: 'Test failure',
      likely_causes: ['cause1', 'cause2'],
      affected_files: ['src/a.ts'],
      suggested_fix_approach: 'Fix approach',
    };

    const proposalId = await (orchestrator as any).proposeHeuristicFix('MISSION', 'repair', diagnosis);
    expect(proposalId).toBe('proposal-123');

    expect(diffManager.proposeDiff).toHaveBeenCalledOnce();
    const callArgs = (diffManager.proposeDiff as any).mock.calls[0];
    expect(callArgs[0]).toBe('MISSION'); // mode
    expect(callArgs[1]).toBe('repair');  // stage
    expect(callArgs[4]).toBe(true);      // requiresCheckpoint

    const diffs: FileDiff[] = callArgs[3];
    expect(diffs).toHaveLength(1);
    expect(diffs[0].file_path).toMatch(/^docs\/repair_attempt_/);
    expect(diffs[0].operation).toBe('create');
    expect(diffs[0].new_content).toContain('Test failure');
    expect(diffs[0].new_content).toContain('cause1');
  });
});
