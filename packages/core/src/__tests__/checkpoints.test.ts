/**
 * Tests for CheckpointManager
 * Proves checkpoint restoration is deterministic as required by 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventStore } from '../eventStore';
import { EventBus } from '../eventBus';
import { CheckpointManager } from '../checkpointManager';
import { Event } from '../types';

describe('CheckpointManager', () => {
  let tempDir: string;
  let workspaceDir: string;
  let checkpointDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let checkpointManager: CheckpointManager;
  const taskId = 'test-task-001';

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-checkpoint-test-'));
    workspaceDir = path.join(tempDir, 'workspace');
    checkpointDir = path.join(tempDir, 'checkpoints');
    storePath = path.join(tempDir, 'events.jsonl');

    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(checkpointDir, { recursive: true });

    // Initialize components
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    checkpointManager = new CheckpointManager(eventBus, checkpointDir);
  });

  afterEach(() => {
    // Cleanup
    checkpointManager._clearForTesting();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('Checkpoint Creation', () => {
    it('should create a checkpoint with snapshot', async () => {
      // Create test files
      const file1 = path.join(workspaceDir, 'file1.ts');
      const file2 = path.join(workspaceDir, 'file2.ts');
      fs.writeFileSync(file1, 'const x = 1;', 'utf8');
      fs.writeFileSync(file2, 'const y = 2;', 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Before applying changes',
        [file1, file2],
        'snapshot'
      );

      expect(checkpointId).toBeDefined();
      expect(checkpointId).toMatch(/^cp_/);

      const checkpoint = checkpointManager.getCheckpoint(checkpointId);
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.description).toBe('Before applying changes');
      expect(checkpoint?.scope).toEqual([file1, file2]);
      expect(checkpoint?.restore_method).toBe('snapshot');
    });

    it('should emit checkpoint_created event', async () => {
      const events: Event[] = [];
      eventBus.subscribe((event) => {
        events.push(event);
      });

      const file1 = path.join(workspaceDir, 'file1.ts');
      fs.writeFileSync(file1, 'const x = 1;', 'utf8');

      await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Test checkpoint',
        [file1],
        'snapshot'
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('checkpoint_created');
      expect(events[0].payload.description).toBe('Test checkpoint');
      expect(events[0].payload.restore_method).toBe('snapshot');
    });

    it('should set active checkpoint ID', async () => {
      const file1 = path.join(workspaceDir, 'file1.ts');
      fs.writeFileSync(file1, 'test', 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Test',
        [file1]
      );

      expect(checkpointManager.getActiveCheckpointId()).toBe(checkpointId);
    });
  });

  describe('Checkpoint Restoration - Deterministic Rollback', () => {
    it('should restore files to exact snapshot state', async () => {
      // Create original files
      const file1 = path.join(workspaceDir, 'file1.ts');
      const file2 = path.join(workspaceDir, 'file2.ts');
      const originalContent1 = 'const original = 1;';
      const originalContent2 = 'const data = { a: 1, b: 2 };';

      fs.writeFileSync(file1, originalContent1, 'utf8');
      fs.writeFileSync(file2, originalContent2, 'utf8');

      // Create checkpoint
      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Before modifications',
        [file1, file2]
      );

      // Modify files (simulate editing)
      fs.writeFileSync(file1, 'const modified = 999;', 'utf8');
      fs.writeFileSync(file2, 'const broken = undefined;', 'utf8');

      // Verify files are modified
      expect(fs.readFileSync(file1, 'utf8')).toBe('const modified = 999;');
      expect(fs.readFileSync(file2, 'utf8')).toBe('const broken = undefined;');

      // Restore checkpoint
      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);

      // Verify files are restored to EXACT original state (deterministic)
      expect(fs.readFileSync(file1, 'utf8')).toBe(originalContent1);
      expect(fs.readFileSync(file2, 'utf8')).toBe(originalContent2);
    });

    it('should emit checkpoint_restored event', async () => {
      const file1 = path.join(workspaceDir, 'test.ts');
      fs.writeFileSync(file1, 'original', 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Test',
        [file1]
      );

      const events: Event[] = [];
      eventBus.subscribe((event) => {
        if (event.type === 'checkpoint_restored') {
          events.push(event);
        }
      });

      fs.writeFileSync(file1, 'modified', 'utf8');

      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('checkpoint_restored');
      expect(events[0].payload.checkpoint_id).toBe(checkpointId);
    });

    it('should handle multiple restore operations deterministically', async () => {
      const file1 = path.join(workspaceDir, 'file.ts');
      const original = 'const version = 1;';

      fs.writeFileSync(file1, original, 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Version 1',
        [file1]
      );

      // Modify multiple times
      fs.writeFileSync(file1, 'const version = 2;', 'utf8');
      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);
      expect(fs.readFileSync(file1, 'utf8')).toBe(original);

      fs.writeFileSync(file1, 'const version = 3;', 'utf8');
      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);
      expect(fs.readFileSync(file1, 'utf8')).toBe(original);

      // Every restore should produce the EXACT same result
      fs.writeFileSync(file1, 'completely different code', 'utf8');
      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);
      expect(fs.readFileSync(file1, 'utf8')).toBe(original);
    });

    it('should restore files with complex content exactly', async () => {
      const file1 = path.join(workspaceDir, 'complex.ts');
      const complexContent = `
// This is a complex file
export interface Config {
  name: string;
  version: number;
  settings: {
    debug: boolean;
    timeout: number;
  };
}

export function processData(input: string): Config {
  return JSON.parse(input);
}

// Special characters: \n \t \r " ' \` \\ 
const regex = /^[a-zA-Z0-9_]+$/;
const template = \`Hello \${name}, welcome!\`;
      `.trim();

      fs.writeFileSync(file1, complexContent, 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Complex content test',
        [file1]
      );

      // Completely overwrite
      fs.writeFileSync(file1, 'simple', 'utf8');

      // Restore
      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);

      // Must match EXACTLY, character for character
      expect(fs.readFileSync(file1, 'utf8')).toBe(complexContent);
    });
  });

  describe('Checkpoint Persistence', () => {
    it('should persist checkpoint metadata to disk', async () => {
      const file1 = path.join(workspaceDir, 'file.ts');
      fs.writeFileSync(file1, 'test', 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Persistent test',
        [file1]
      );

      // Check metadata file exists
      const metadataPath = path.join(checkpointDir, 'checkpoints.json');
      expect(fs.existsSync(metadataPath)).toBe(true);

      // Check snapshot file exists
      const snapshotPath = path.join(checkpointDir, `${checkpointId}.json`);
      expect(fs.existsSync(snapshotPath)).toBe(true);
    });

    it('should load checkpoint from disk and restore correctly', async () => {
      const file1 = path.join(workspaceDir, 'file.ts');
      const original = 'persisted content';
      fs.writeFileSync(file1, original, 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Persistence test',
        [file1]
      );

      // Create new checkpoint manager (simulates restart)
      const newCheckpointManager = new CheckpointManager(eventBus, checkpointDir);
      await newCheckpointManager.loadCheckpointMetadata();

      // Modify file
      fs.writeFileSync(file1, 'modified after restart', 'utf8');

      // Restore using new manager (loads snapshot from disk)
      await newCheckpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);

      // Should restore to original
      expect(fs.readFileSync(file1, 'utf8')).toBe(original);

      newCheckpointManager._clearForTesting();
    });
  });

  describe('Integration: Checkpoint Before Write Operations', () => {
    it('should enforce checkpoint before applying changes', async () => {
      // Simulate write operation flow
      const file1 = path.join(workspaceDir, 'important.ts');
      const original = 'const critical = "data";';
      fs.writeFileSync(file1, original, 'utf8');

      // STEP 1: Create checkpoint BEFORE write
      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Before applying diff',
        [file1]
      );

      expect(checkpointManager.hasCheckpoint(checkpointId)).toBe(true);

      // STEP 2: Apply changes
      const newContent = 'const critical = "modified";';
      fs.writeFileSync(file1, newContent, 'utf8');

      // Verify change applied
      expect(fs.readFileSync(file1, 'utf8')).toBe(newContent);

      // STEP 3: If something goes wrong, restore
      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);

      // Verify rollback to original
      expect(fs.readFileSync(file1, 'utf8')).toBe(original);
    });

    it('should handle multiple files in checkpoint scope', async () => {
      const files = [
        path.join(workspaceDir, 'file1.ts'),
        path.join(workspaceDir, 'file2.ts'),
        path.join(workspaceDir, 'file3.ts'),
      ];

      const originals = [
        'const a = 1;',
        'const b = 2;',
        'const c = 3;',
      ];

      files.forEach((file, i) => {
        fs.writeFileSync(file, originals[i], 'utf8');
      });

      // Checkpoint all files
      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Multi-file checkpoint',
        files
      );

      // Modify all files
      files.forEach((file, i) => {
        fs.writeFileSync(file, `modified ${i}`, 'utf8');
      });

      // Restore all
      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);

      // All should be restored exactly
      files.forEach((file, i) => {
        expect(fs.readFileSync(file, 'utf8')).toBe(originals[i]);
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw error when restoring non-existent checkpoint', async () => {
      await expect(
        checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', 'non-existent-id')
      ).rejects.toThrow('Checkpoint not found');
    });

    it('should handle missing files gracefully during snapshot', async () => {
      const existingFile = path.join(workspaceDir, 'exists.ts');
      const nonExistentFile = path.join(workspaceDir, 'does-not-exist.ts');

      fs.writeFileSync(existingFile, 'content', 'utf8');

      // Should not throw even if one file doesn't exist
      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Mixed files',
        [existingFile, nonExistentFile]
      );

      expect(checkpointId).toBeDefined();
    });
  });

  describe('Determinism Verification', () => {
    it('should produce identical state after restore regardless of modifications', async () => {
      const file = path.join(workspaceDir, 'deterministic.ts');
      const original = 'const DETERMINISTIC = true;';

      fs.writeFileSync(file, original, 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Determinism test',
        [file]
      );

      // Try various modifications
      const modifications = [
        'completely different',
        '',
        'a'.repeat(10000),
        'with\nnewlines\nand\ttabs',
        original + ' modified',
      ];

      for (const mod of modifications) {
        fs.writeFileSync(file, mod, 'utf8');
        await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);
        
        // Every single restore must produce IDENTICAL result
        const restored = fs.readFileSync(file, 'utf8');
        expect(restored).toBe(original);
        expect(restored.length).toBe(original.length);
        
        // Character-by-character comparison
        for (let i = 0; i < original.length; i++) {
          expect(restored.charCodeAt(i)).toBe(original.charCodeAt(i));
        }
      }
    });

    it('should persist and restore checkpoint across manager instances', async () => {
      const file = path.join(workspaceDir, 'cross-instance.ts');
      const original = 'ORIGINAL STATE';

      fs.writeFileSync(file, original, 'utf8');

      // First manager creates checkpoint
      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Cross-instance test',
        [file]
      );

      // Modify file
      fs.writeFileSync(file, 'MODIFIED', 'utf8');

      // Create second manager (simulates restart/reload)
      const manager2 = new CheckpointManager(eventBus, checkpointDir);
      await manager2.loadCheckpointMetadata();

      // Restore with second manager
      await manager2.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);

      // Must restore to exact original
      expect(fs.readFileSync(file, 'utf8')).toBe(original);

      manager2._clearForTesting();
    });
  });

  describe('Event Store Integration', () => {
    it('should persist checkpoint events to event store', async () => {
      const file = path.join(workspaceDir, 'file.ts');
      fs.writeFileSync(file, 'test', 'utf8');

      const checkpointId = await checkpointManager.createCheckpoint(
        taskId,
        'MISSION',
        'edit',
        'Event test',
        [file]
      );

      fs.writeFileSync(file, 'modified', 'utf8');

      await checkpointManager.restoreCheckpoint(taskId, 'MISSION', 'edit', checkpointId);

      // Both events should be in store
      const allEvents = eventStore.getAllEvents();
      const createdEvent = allEvents.find(e => e.type === 'checkpoint_created');
      const restoredEvent = allEvents.find(e => e.type === 'checkpoint_restored');

      expect(createdEvent).toBeDefined();
      expect(restoredEvent).toBeDefined();
      expect(createdEvent?.payload.checkpoint_id).toBe(checkpointId);
      expect(restoredEvent?.payload.checkpoint_id).toBe(checkpointId);
    });
  });
});
