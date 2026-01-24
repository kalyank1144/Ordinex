/**
 * MISSION EDIT Implementation Tests
 * 
 * Tests for the spec-compliant unified diff flow:
 * - Unified diff parsing and validation
 * - SHA computation and staleness detection
 * - Excerpt selection strategy
 * - Atomic apply with rollback
 * - Evidence persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Import modules to test
import {
  parseUnifiedDiff,
  validateDiff,
  applyDiffToContent,
  generateUnifiedDiff,
} from '../unifiedDiffParser';

import {
  computeBaseSha,
  computeFullSha,
  shaEquals,
  isFileStale,
  checkBatchStaleness,
} from '../shaUtils';

import {
  selectEditContext,
  buildBaseShaMap,
} from '../excerptSelector';

import {
  AtomicDiffApplier,
  createDiffId,
  createCheckpointId,
} from '../atomicDiffApply';

import {
  EditEvidenceManager,
} from '../editEvidenceManager';

// ============================================================
// TEST 1: UNIFIED DIFF PARSER
// ============================================================
describe('UnifiedDiffParser', () => {
  const sampleDiff = `--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,6 @@
 // Utils module
+import { Logger } from './logger';
 
 export function foo() {
-  return 'foo';
+  return 'bar';
 }`;

  describe('parseUnifiedDiff', () => {
    it('should parse valid unified diff', () => {
      const result = parseUnifiedDiff(sampleDiff);
      
      expect(result.files.length).toBe(1);
      expect(result.files[0].oldPath).toBe('src/utils.ts');
      expect(result.files[0].newPath).toBe('src/utils.ts');
      expect(result.files[0].hunks.length).toBe(1);
      expect(result.totalAdditions).toBe(2);
      expect(result.totalDeletions).toBe(1);
    });

    it('should handle empty diff', () => {
      const result = parseUnifiedDiff('');
      expect(result.files.length).toBe(0);
      expect(result.totalAdditions).toBe(0);
      expect(result.totalDeletions).toBe(0);
    });

    it('should handle multi-file diff', () => {
      const multiFileDiff = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
-export const x = 10;
+export const x = 20;
 export const y = 30;`;

      const result = parseUnifiedDiff(multiFileDiff);
      expect(result.files.length).toBe(2);
      // 2 deletions + 2 additions = 4 changed lines
      expect(result.totalChangedLines).toBe(4);
    });
  });

  describe('validateDiff', () => {
    it('should pass valid diff within constraints', () => {
      const result = validateDiff(sampleDiff, {
        allowedPaths: ['src/utils.ts'],
        maxFiles: 3,
        maxChangedLines: 100,
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject diff exceeding max_files', () => {
      const multiFileDiff = `--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-a
+b
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-c
+d`;

      const result = validateDiff(multiFileDiff, {
        maxFiles: 1,
        maxChangedLines: 100,
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'SCOPE_FILES_EXCEEDED')).toBe(true);
    });

    it('should reject diff exceeding max_changed_lines', () => {
      const result = validateDiff(sampleDiff, {
        maxChangedLines: 1,
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'SCOPE_LINES_EXCEEDED')).toBe(true);
    });

    it('should reject file creation (safety check)', () => {
      const createDiff = `--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,3 @@
+const x = 1;
+const y = 2;
+const z = 3;`;

      const result = validateDiff(createDiff, {});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'FILE_CREATION')).toBe(true);
    });

    it('should reject file deletion (safety check)', () => {
      const deleteDiff = `--- a/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-const x = 1;
-const y = 2;
-const z = 3;`;

      const result = validateDiff(deleteDiff, {});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'FILE_DELETION')).toBe(true);
    });

    it('should reject file rename (safety check)', () => {
      const renameDiff = `--- a/old.ts
+++ b/new.ts
@@ -1 +1 @@
 const x = 1;`;

      const result = validateDiff(renameDiff, {});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'FILE_RENAME')).toBe(true);
    });

    it('should validate SHA mismatch', () => {
      const baseShaMap = new Map([['src/utils.ts', 'abc123def456']]);
      const touchedFiles = [{ path: 'src/utils.ts', base_sha: 'wrong_sha_12' }];

      const result = validateDiff(sampleDiff, {
        baseShaMap,
        touchedFiles,
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'SHA_MISMATCH')).toBe(true);
    });
  });

  describe('applyDiffToContent', () => {
    it('should apply simple hunk', () => {
      const original = `// Utils module

export function foo() {
  return 'foo';
}`;

      const parsed = parseUnifiedDiff(sampleDiff);
      const result = applyDiffToContent(original, parsed.files[0]);
      
      expect(result).toContain("import { Logger } from './logger';");
      expect(result).toContain("return 'bar';");
      expect(result).not.toContain("return 'foo';");
    });
  });

  describe('generateUnifiedDiff', () => {
    it('should generate valid unified diff', () => {
      const oldContent = 'const x = 1;\nconst y = 2;\n';
      const newContent = 'const x = 1;\nconst y = 3;\n';
      
      const diff = generateUnifiedDiff('test.ts', oldContent, newContent);
      
      expect(diff).toContain('--- a/test.ts');
      expect(diff).toContain('+++ b/test.ts');
      expect(diff).toContain('-const y = 2;');
      expect(diff).toContain('+const y = 3;');
    });
  });
});

// ============================================================
// TEST 2: SHA UTILITIES
// ============================================================
describe('ShaUtils', () => {
  describe('computeBaseSha', () => {
    it('should compute 12-char SHA', () => {
      const content = 'hello world';
      const sha = computeBaseSha(content);
      
      expect(sha.length).toBe(12);
      expect(/^[a-f0-9]+$/.test(sha)).toBe(true);
    });

    it('should be deterministic', () => {
      const content = 'test content';
      const sha1 = computeBaseSha(content);
      const sha2 = computeBaseSha(content);
      
      expect(sha1).toBe(sha2);
    });

    it('should differ for different content', () => {
      const sha1 = computeBaseSha('content A');
      const sha2 = computeBaseSha('content B');
      
      expect(sha1).not.toBe(sha2);
    });
  });

  describe('shaEquals', () => {
    it('should match equal SHAs', () => {
      expect(shaEquals('abc123def456', 'abc123def456')).toBe(true);
    });

    it('should not match different SHAs', () => {
      expect(shaEquals('abc123def456', 'xyz789abc123')).toBe(false);
    });
  });

  describe('isFileStale', () => {
    it('should detect stale file', () => {
      const currentContent = 'modified content';
      const expectedSha = computeBaseSha('original content');
      
      expect(isFileStale(currentContent, expectedSha)).toBe(true);
    });

    it('should not flag fresh file as stale', () => {
      const content = 'some content';
      const expectedSha = computeBaseSha(content);
      
      expect(isFileStale(content, expectedSha)).toBe(false);
    });
  });

  describe('checkBatchStaleness', () => {
    it('should detect multiple stale files', () => {
      const currentContents = new Map([
        ['a.ts', 'content A modified'],
        ['b.ts', 'content B original'],
      ]);
      const expectedShas = new Map([
        ['a.ts', computeBaseSha('content A original')],
        ['b.ts', computeBaseSha('content B original')],
      ]);
      
      const stale = checkBatchStaleness(currentContents, expectedShas);
      
      expect(stale.length).toBe(1);
      expect(stale[0].path).toBe('a.ts');
    });
  });
});

// ============================================================
// TEST 3: EXCERPT SELECTOR
// ============================================================
describe('ExcerptSelector', () => {
  describe('selectEditContext', () => {
    it('should select files from retrieval results', async () => {
      const readFile = async (p: string) => {
        if (p === 'src/a.ts') return 'const a = 1;\n'.repeat(50);
        if (p === 'src/b.ts') return 'const b = 2;\n'.repeat(50);
        throw new Error('Not found');
      };

      const result = await selectEditContext(
        {
          retrievalResults: [
            { path: 'src/a.ts', score: 0.9 },
            { path: 'src/b.ts', score: 0.8 },
          ],
        },
        'modify const a',
        readFile,
        { maxFiles: 6, maxTotalLines: 400 }
      );

      expect(result.file_context.length).toBe(2);
      expect(result.selection_method).toBe('retrieval');
    });

    it('should include base_sha for each file', async () => {
      const content = 'export const x = 1;\n';
      const readFile = async () => content;

      const result = await selectEditContext(
        { fallbackFiles: ['test.ts'] },
        'update export',
        readFile,
        { maxFiles: 1, maxTotalLines: 100 }
      );

      expect(result.file_context.length).toBe(1);
      expect(result.file_context[0].base_sha.length).toBe(12);
    });

    it('should respect line budget', async () => {
      // Create file with 500 lines
      const bigContent = 'line\n'.repeat(500);
      const readFile = async () => bigContent;

      const result = await selectEditContext(
        { fallbackFiles: ['big.ts'] },
        'test',
        readFile,
        { maxFiles: 6, maxTotalLines: 100 }
      );

      expect(result.total_lines).toBeLessThanOrEqual(100);
    });
  });

  describe('buildBaseShaMap', () => {
    it('should build map from file context', () => {
      const fileContext = [
        { path: 'a.ts', content: '', base_sha: 'abc123456789', line_start: 1, line_end: 10, is_full_file: true },
        { path: 'b.ts', content: '', base_sha: 'def789012345', line_start: 1, line_end: 20, is_full_file: true },
      ];

      const map = buildBaseShaMap(fileContext);
      
      expect(map.get('a.ts')).toBe('abc123456789');
      expect(map.get('b.ts')).toBe('def789012345');
    });
  });
});

// ============================================================
// TEST 4: ATOMIC DIFF APPLIER
// ============================================================
describe('AtomicDiffApplier', () => {
  let tempDir: string;
  let applier: AtomicDiffApplier;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinex-test-'));
    applier = new AtomicDiffApplier(tempDir);
    
    // Create test file
    await fs.writeFile(
      path.join(tempDir, 'test.ts'),
      'const x = 1;\nconst y = 2;\nconst z = 3;\n',
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createCheckpoint', () => {
    it('should backup files before apply', async () => {
      const checkpointId = createCheckpointId('task1', 'step1');
      const checkpoint = await applier.createCheckpoint(checkpointId, ['test.ts']);

      expect(checkpoint.files.length).toBe(1);
      expect(checkpoint.files[0].path).toBe('test.ts');
      
      // Verify backup exists
      const backupExists = await fs.access(checkpoint.files[0].backup_path)
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);
    });
  });

  describe('checkStaleness', () => {
    it('should detect when file has changed', async () => {
      const originalContent = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
      const expectedShas = new Map([['test.ts', computeBaseSha(originalContent)]]);
      
      // Modify file
      await fs.writeFile(path.join(tempDir, 'test.ts'), 'modified!', 'utf-8');
      
      const stale = await applier.checkStaleness(expectedShas);
      expect(stale.length).toBe(1);
    });

    it('should pass when file unchanged', async () => {
      const originalContent = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
      const expectedShas = new Map([['test.ts', computeBaseSha(originalContent)]]);
      
      const stale = await applier.checkStaleness(expectedShas);
      expect(stale.length).toBe(0);
    });
  });

  describe('applyDiffAtomically', () => {
    it('should apply valid diff successfully', async () => {
      const originalContent = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
      const checkpointId = createCheckpointId('task1', 'step1');
      const checkpoint = await applier.createCheckpoint(checkpointId, ['test.ts']);
      
      const expectedShas = new Map([['test.ts', computeBaseSha(originalContent)]]);
      
      const parsedDiff = parseUnifiedDiff(`--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 999;
 const z = 3;`);

      const result = await applier.applyDiffAtomically(parsedDiff, expectedShas, checkpoint);
      
      expect(result.success).toBe(true);
      expect(result.applied_files.length).toBe(1);
      
      // Verify file was modified
      const newContent = await fs.readFile(path.join(tempDir, 'test.ts'), 'utf-8');
      expect(newContent).toContain('const y = 999;');
    });

    it('should reject stale file', async () => {
      const checkpointId = createCheckpointId('task1', 'step1');
      const checkpoint = await applier.createCheckpoint(checkpointId, ['test.ts']);
      
      // Use wrong expected SHA
      const expectedShas = new Map([['test.ts', 'wrong_sha_12']]);
      
      const parsedDiff = parseUnifiedDiff(`--- a/test.ts
+++ b/test.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;`);

      const result = await applier.applyDiffAtomically(parsedDiff, expectedShas, checkpoint);
      
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('stale_context');
    });
  });

  describe('rollbackFromCheckpoint', () => {
    it('should restore files from checkpoint', async () => {
      const originalContent = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
      const checkpointId = createCheckpointId('task1', 'step1');
      const checkpoint = await applier.createCheckpoint(checkpointId, ['test.ts']);
      
      // Modify file
      await fs.writeFile(path.join(tempDir, 'test.ts'), 'CORRUPTED!', 'utf-8');
      
      // Rollback
      const success = await applier.rollbackFromCheckpoint(checkpoint);
      
      expect(success).toBe(true);
      
      // Verify restored
      const restoredContent = await fs.readFile(path.join(tempDir, 'test.ts'), 'utf-8');
      expect(restoredContent).toBe(originalContent);
    });
  });
});

// ============================================================
// TEST 5: EVIDENCE MANAGER
// ============================================================
describe('EditEvidenceManager', () => {
  let tempDir: string;
  let manager: EditEvidenceManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinex-evidence-'));
    manager = new EditEvidenceManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('persistProposedDiff', () => {
    it('should create .diff and .manifest.json files', async () => {
      const diffId = createDiffId('task1', 'step1');
      
      const { diffPath, manifestPath } = await manager.persistProposedDiff({
        diff_id: diffId,
        task_id: 'task1',
        step_id: 'step1',
        unified_diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new',
        parsed_diff: {
          files: [{
            oldPath: 'test.ts',
            newPath: 'test.ts',
            additions: 1,
            deletions: 1,
            hunks: [],
            isCreate: false,
            isDelete: false,
            isRename: false,
            hasModeChange: false,
          }],
          totalAdditions: 1,
          totalDeletions: 1,
          totalChangedLines: 2,
        },
        source_context: [{
          path: 'test.ts',
          base_sha: 'abc123def456',
          lines_included: 10,
          is_full_file: true,
          ranges: [[1, 10]],
        }],
        total_lines_sent: 10,
        llm_output: {
          unified_diff: '...',
          touched_files: [],
          confidence: 'high',
          notes: 'Test change',
          validation_status: 'ok',
        },
      });

      // Verify files exist
      const diffExists = await fs.access(diffPath).then(() => true).catch(() => false);
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
      
      expect(diffExists).toBe(true);
      expect(manifestExists).toBe(true);
    });
  });

  describe('readManifest', () => {
    it('should read persisted manifest', async () => {
      const diffId = createDiffId('task1', 'step1');
      
      await manager.persistProposedDiff({
        diff_id: diffId,
        task_id: 'task1',
        step_id: 'step1',
        unified_diff: 'test diff',
        parsed_diff: {
          files: [],
          totalAdditions: 5,
          totalDeletions: 3,
          totalChangedLines: 8,
        },
        source_context: [],
        total_lines_sent: 50,
        llm_output: {
          unified_diff: 'test diff',
          touched_files: [],
          confidence: 'medium',
          notes: 'Test',
          validation_status: 'ok',
        },
      });

      const manifest = await manager.readManifest(diffId);
      
      expect(manifest).not.toBeNull();
      expect(manifest?.diff_id).toBe(diffId);
      expect(manifest?.stats.additions).toBe(5);
      expect(manifest?.stats.deletions).toBe(3);
    });
  });
});

// ============================================================
// TEST 6: ID GENERATION
// ============================================================
describe('ID Generation', () => {
  describe('createDiffId', () => {
    it('should create deterministic ID format', () => {
      const id = createDiffId('task123456789', 'step987654321');
      
      expect(id).toMatch(/^diff_task1234_step9876_\d+$/);
    });
  });

  describe('createCheckpointId', () => {
    it('should create deterministic ID format', () => {
      const id = createCheckpointId('task123456789', 'step987654321');
      
      expect(id).toMatch(/^checkpoint_task1234_step9876_\d+$/);
    });
  });
});
