/**
 * Diff Management Tests
 * Verifies:
 * - Diff proposals emit diff_proposed events
 * - Diff application requires approval
 * - Checkpoints are created before applying diffs
 * - No silent writes
 */

import { EventBus } from '../eventBus';
import { EventStore } from '../eventStore';
import { ModeManager } from '../modeManager';
import { ApprovalManager } from '../approvalManager';
import { CheckpointManager } from '../checkpointManager';
import { DiffManager, FileDiff } from '../diffManager';
import { InMemoryEvidenceStore } from '../toolExecutor';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('DiffManager', () => {
  let eventBus: EventBus;
  let eventStore: EventStore;
  let modeManager: ModeManager;
  let approvalManager: ApprovalManager;
  let checkpointManager: CheckpointManager;
  let diffManager: DiffManager;
  let evidenceStore: InMemoryEvidenceStore;
  let taskId: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    // Create temp workspace
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinex-test-'));

    taskId = 'test-task-1';
    const storePath = path.join(workspaceRoot, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    modeManager = new ModeManager(taskId, eventBus);
    approvalManager = new ApprovalManager(eventBus);
    checkpointManager = new CheckpointManager(eventBus, workspaceRoot);
    evidenceStore = new InMemoryEvidenceStore();
    diffManager = new DiffManager(
      taskId,
      eventBus,
      approvalManager,
      checkpointManager,
      evidenceStore,
      workspaceRoot
    );
  });

  afterEach(async () => {
    // Cleanup temp workspace
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    approvalManager._abortAllForTesting();
  });

  describe('Diff Proposal (CRITICAL)', () => {
    test('proposeDiff emits diff_proposed event', async () => {
      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'create',
          new_content: 'Hello, world!',
        },
      ];

      const proposalId = await diffManager.proposeDiff(
        'MISSION',
        'edit',
        'Create test file',
        diffs
      );

      expect(proposalId).toBeDefined();

      // Verify diff_proposed event was emitted
      const events = eventStore.getEventsByTaskId(taskId);
      const proposedEvents = events.filter(e => e.type === 'diff_proposed');
      expect(proposedEvents.length).toBe(1);
      expect(proposedEvents[0].payload.proposal_id).toBe(proposalId);
      expect(proposedEvents[0].payload.description).toBe('Create test file');
    });

    test('proposeDiff generates diff evidence', async () => {
      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'modify',
          old_content: 'old',
          new_content: 'new',
        },
      ];

      await diffManager.proposeDiff('MISSION', 'edit', 'Update file', diffs);

      const allEvidence = evidenceStore.getAll();
      expect(allEvidence.length).toBe(1);
      expect(allEvidence[0].type).toBe('diff');
      expect(allEvidence[0].summary).toContain('Update file');
    });

    test('proposeDiff does NOT apply changes immediately', async () => {
      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'create',
          new_content: 'Content',
        },
      ];

      await diffManager.proposeDiff('MISSION', 'edit', 'Create file', diffs);

      // File should NOT exist yet
      const filePath = path.join(workspaceRoot, 'test.txt');
      await expect(fs.access(filePath)).rejects.toThrow();
    });
  });

  describe('Diff Application - Approval Gating (CRITICAL)', () => {
    test('applyDiff MUST request approval', async () => {
      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'create',
          new_content: 'Hello',
        },
      ];

      const proposalId = await diffManager.proposeDiff(
        'MISSION',
        'edit',
        'Create file',
        diffs
      );

      // Start apply (will block on approval)
      const applyPromise = diffManager.applyDiff('MISSION', 'edit', proposalId);

      // Wait for approval_requested
      await new Promise(resolve => setTimeout(resolve, 50));

      const events = eventStore.getEventsByTaskId(taskId);
      const approvalRequests = events.filter(e => e.type === 'approval_requested');
      expect(approvalRequests.length).toBe(1);
      expect(approvalRequests[0].payload.approval_type).toBe('apply_diff');

      // Approve
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id,
        'approved'
      );

      const result = await applyPromise;
      expect(result.success).toBe(true);
    });

    test('applyDiff fails if approval is denied', async () => {
      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'create',
          new_content: 'Hello',
        },
      ];

      const proposalId = await diffManager.proposeDiff(
        'MISSION',
        'edit',
        'Create file',
        diffs
      );

      const applyPromise = diffManager.applyDiff('MISSION', 'edit', proposalId);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Deny
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.denyApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id
      );

      await expect(applyPromise).rejects.toThrow(/denied by user/);

      // File should NOT exist
      const filePath = path.join(workspaceRoot, 'test.txt');
      await expect(fs.access(filePath)).rejects.toThrow();
    });
  });

  describe('Checkpoint Integration (CRITICAL)', () => {
    test('applyDiff creates checkpoint BEFORE applying changes', async () => {
      // Create existing file
      const testFile = path.join(workspaceRoot, 'test.txt');
      await fs.writeFile(testFile, 'original content', 'utf-8');

      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'modify',
          old_content: 'original content',
          new_content: 'modified content',
        },
      ];

      const proposalId = await diffManager.proposeDiff(
        'MISSION',
        'edit',
        'Modify file',
        diffs,
        true // requires checkpoint
      );

      const applyPromise = diffManager.applyDiff('MISSION', 'edit', proposalId);
      await new Promise(resolve => setTimeout(resolve, 50));

      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id,
        'approved'
      );

      const result = await applyPromise;
      expect(result.success).toBe(true);
      expect(result.checkpoint_id).toBeDefined();

      // Verify checkpoint was created BEFORE modification
      const events = eventStore.getEventsByTaskId(taskId);
      const checkpointEvents = events.filter(e => e.type === 'checkpoint_created');
      const diffAppliedEvents = events.filter(e => e.type === 'diff_applied');

      expect(checkpointEvents.length).toBe(1);
      expect(diffAppliedEvents.length).toBe(1);

      // Checkpoint must come BEFORE diff_applied
      const checkpointIndex = events.indexOf(checkpointEvents[0]);
      const appliedIndex = events.indexOf(diffAppliedEvents[0]);
      expect(checkpointIndex).toBeLessThan(appliedIndex);
    });
  });

  describe('Diff Application - File Operations', () => {
    test('create operation creates new file', async () => {
      const diffs: FileDiff[] = [
        {
          file_path: 'newfile.txt',
          operation: 'create',
          new_content: 'New content',
        },
      ];

      const proposalId = await diffManager.proposeDiff('MISSION', 'edit', 'Create', diffs);
      const applyPromise = diffManager.applyDiff('MISSION', 'edit', proposalId);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id,
        'approved'
      );

      await applyPromise;

      const content = await fs.readFile(path.join(workspaceRoot, 'newfile.txt'), 'utf-8');
      expect(content).toBe('New content');
    });

    test('modify operation updates existing file', async () => {
      const testFile = path.join(workspaceRoot, 'test.txt');
      await fs.writeFile(testFile, 'old', 'utf-8');

      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'modify',
          new_content: 'new',
        },
      ];

      const proposalId = await diffManager.proposeDiff('MISSION', 'edit', 'Modify', diffs);
      const applyPromise = diffManager.applyDiff('MISSION', 'edit', proposalId);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id,
        'approved'
      );

      await applyPromise;

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('new');
    });

    test('delete operation removes file', async () => {
      const testFile = path.join(workspaceRoot, 'test.txt');
      await fs.writeFile(testFile, 'content', 'utf-8');

      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'delete',
        },
      ];

      const proposalId = await diffManager.proposeDiff('MISSION', 'edit', 'Delete', diffs);
      const applyPromise = diffManager.applyDiff('MISSION', 'edit', proposalId);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id,
        'approved'
      );

      await applyPromise;

      await expect(fs.access(testFile)).rejects.toThrow();
    });
  });

  describe('Security Constraints', () => {
    test('path traversal is blocked', async () => {
      const diffs: FileDiff[] = [
        {
          file_path: '../../../etc/passwd',
          operation: 'create',
          new_content: 'malicious',
        },
      ];

      const proposalId = await diffManager.proposeDiff('MISSION', 'edit', 'Attack', diffs);
      const applyPromise = diffManager.applyDiff('MISSION', 'edit', proposalId);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id,
        'approved'
      );

      const result = await applyPromise;
      expect(result.success).toBe(false);
      expect(result.failed_files.length).toBe(1);
      expect(result.failed_files[0].error).toContain('Path traversal');
    });
  });

  describe('Event Emission', () => {
    test('applyDiff emits diff_applied event', async () => {
      const diffs: FileDiff[] = [
        {
          file_path: 'test.txt',
          operation: 'create',
          new_content: 'content',
        },
      ];

      const proposalId = await diffManager.proposeDiff('MISSION', 'edit', 'Create', diffs);
      const applyPromise = diffManager.applyDiff('MISSION', 'edit', proposalId);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id,
        'approved'
      );

      await applyPromise;

      const events = eventStore.getEventsByTaskId(taskId);
      const appliedEvents = events.filter(e => e.type === 'diff_applied');
      expect(appliedEvents.length).toBe(1);
      expect(appliedEvents[0].payload.success).toBe(true);
      expect(appliedEvents[0].payload.applied_files).toContain('test.txt');
    });
  });
});
