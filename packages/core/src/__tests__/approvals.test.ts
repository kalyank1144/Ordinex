/**
 * Tests for ApprovalManager
 * Proves approvals block progress as required by 02_AGENT_TOOL_SPEC.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventStore } from '../eventStore';
import { EventBus } from '../eventBus';
import { ApprovalManager } from '../approvalManager';
import { Event } from '../types';

describe('ApprovalManager', () => {
  let tempDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let approvalManager: ApprovalManager;
  const taskId = 'test-task-001';

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-approval-test-'));
    storePath = path.join(tempDir, 'events.jsonl');

    // Initialize components
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    approvalManager = new ApprovalManager(eventBus);
  });

  afterEach(() => {
    // Cleanup
    approvalManager._abortAllForTesting();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('Approval Request Flow', () => {
    it('should emit approval_requested event', async () => {
      const events: Event[] = [];
      eventBus.subscribe((event) => {
        events.push(event);
      });

      // Request approval (don't await - it will block)
      const approvalPromise = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'apply_diff',
        'Apply changes to file.ts',
        { file: 'file.ts', lines_changed: 10 }
      );

      // Give it time to emit event
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have pending approval
      expect(approvalManager.hasPendingApprovals()).toBe(true);
      expect(approvalManager.getPendingApprovals()).toHaveLength(1);

      // Should have emitted approval_requested event
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('approval_requested');
      expect(events[0].payload.approval_type).toBe('apply_diff');
      expect(events[0].payload.description).toBe('Apply changes to file.ts');

      // Cleanup - resolve the approval
      const request = approvalManager.getPendingApprovals()[0];
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        request.approval_id,
        'approved'
      );
      await approvalPromise;
    });

    it('should block execution until approval is resolved', async () => {
      let executionContinued = false;

      // Request approval
      const approvalPromise = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'terminal',
        'Run build command',
        { command: 'npm run build' }
      ).then((resolution) => {
        executionContinued = true;
        return resolution;
      });

      // Execution should not have continued yet
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(executionContinued).toBe(false);
      expect(approvalManager.hasPendingApprovals()).toBe(true);

      // Resolve approval
      const request = approvalManager.getPendingApprovals()[0];
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        request.approval_id,
        'approved'
      );

      // Wait for promise to resolve
      const resolution = await approvalPromise;

      // Now execution should have continued
      expect(executionContinued).toBe(true);
      expect(resolution.decision).toBe('approved');
      expect(approvalManager.hasPendingApprovals()).toBe(false);
    });

    it('should handle approval denial', async () => {
      const approvalPromise = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'apply_diff',
        'Apply risky changes',
        { file: 'important.ts' }
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const request = approvalManager.getPendingApprovals()[0];
      await approvalManager.denyApproval(taskId, 'MISSION', 'edit', request.approval_id);

      const resolution = await approvalPromise;
      expect(resolution.decision).toBe('denied');
      expect(approvalManager.hasPendingApprovals()).toBe(false);
    });

    it('should support edit requests with modified details', async () => {
      const approvalPromise = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'terminal',
        'Run command',
        { command: 'rm -rf /' }
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const request = approvalManager.getPendingApprovals()[0];
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        request.approval_id,
        'edit_requested',
        'once',
        { command: 'rm -rf ./build' } // User modified the command
      );

      const resolution = await approvalPromise;
      expect(resolution.decision).toBe('edit_requested');
      expect(resolution.modified_details).toEqual({ command: 'rm -rf ./build' });
    });
  });

  describe('Approval Event Emission', () => {
    it('should emit approval_resolved event with correct payload', async () => {
      const events: Event[] = [];
      eventBus.subscribe((event) => {
        events.push(event);
      });

      const approvalPromise = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'scope_expansion',
        'Expand scope to include additional files',
        { files: ['file1.ts', 'file2.ts'] }
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const request = approvalManager.getPendingApprovals()[0];
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        request.approval_id,
        'approved',
        'always'
      );

      await approvalPromise;

      // Should have both approval_requested and approval_resolved
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('approval_requested');
      expect(events[1].type).toBe('approval_resolved');
      expect(events[1].payload.decision).toBe('approved');
      expect(events[1].payload.scope).toBe('always');
    });

    it('should persist approval events to event store', async () => {
      const approvalPromise = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'terminal',
        'Run tests',
        { command: 'npm test' }
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const request = approvalManager.getPendingApprovals()[0];
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        request.approval_id,
        'approved'
      );

      await approvalPromise;

      // Events should be in the store
      const allEvents = eventStore.getAllEvents();
      expect(allEvents).toHaveLength(2);
      
      const requestedEvent = allEvents.find(e => e.type === 'approval_requested');
      const resolvedEvent = allEvents.find(e => e.type === 'approval_resolved');
      
      expect(requestedEvent).toBeDefined();
      expect(resolvedEvent).toBeDefined();
      expect(requestedEvent?.payload.approval_id).toBe(resolvedEvent?.payload.approval_id);
    });
  });

  describe('Multiple Approvals', () => {
    it('should handle multiple concurrent approval requests', async () => {
      const approval1 = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'terminal',
        'Command 1',
        {}
      );

      const approval2 = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'apply_diff',
        'Diff 1',
        {}
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(approvalManager.getPendingApprovals()).toHaveLength(2);

      const requests = approvalManager.getPendingApprovals();
      
      // Resolve first approval
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        requests[0].approval_id,
        'approved'
      );

      const resolution1 = await approval1;
      expect(resolution1.decision).toBe('approved');
      expect(approvalManager.getPendingApprovals()).toHaveLength(1);

      // Resolve second approval
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        requests[1].approval_id,
        'approved'
      );

      const resolution2 = await approval2;
      expect(resolution2.decision).toBe('approved');
      expect(approvalManager.getPendingApprovals()).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should be idempotent when resolving non-existent approval', async () => {
      // resolveApproval is idempotent: logs warning and returns for non-existent IDs
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        'non-existent-id',
        'approved'
      );
      // Should not throw - idempotent behavior
      expect(approvalManager.hasPendingApprovals()).toBe(false);
    });

    it('should be idempotent on duplicate resolution of same approval', async () => {
      const approvalPromise = approvalManager.requestApproval(
        taskId,
        'MISSION',
        'edit',
        'terminal',
        'Test',
        {}
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const request = approvalManager.getPendingApprovals()[0];

      // Resolve once
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        request.approval_id,
        'approved'
      );

      await approvalPromise;

      // Try to resolve again - should be a no-op (idempotent)
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        request.approval_id,
        'approved'
      );
      // Should not throw - idempotent behavior
      expect(approvalManager.hasPendingApprovals()).toBe(false);
    });
  });

  describe('Integration: Approval Blocks Progress', () => {
    it('should prove that execution cannot proceed without approval', async () => {
      // This test simulates a tool execution that requires approval

      let toolExecuted = false;

      const executeToolWithApproval = async () => {
        // Step 1: Request approval
        const resolution = await approvalManager.requestApproval(
          taskId,
          'MISSION',
          'edit',
          'terminal',
          'Execute dangerous command',
          { command: 'rm -rf ./dist' }
        );

        // Step 2: Only execute if approved
        if (resolution.decision === 'approved') {
          toolExecuted = true;
        }

        return resolution;
      };

      // Start the execution (but don't await yet)
      const executionPromise = executeToolWithApproval();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Tool should NOT have executed yet
      expect(toolExecuted).toBe(false);
      expect(approvalManager.hasPendingApprovals()).toBe(true);

      // Approve it
      const request = approvalManager.getPendingApprovals()[0];
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'edit',
        request.approval_id,
        'approved'
      );

      // Wait for execution to complete
      await executionPromise;

      // NOW tool should have executed
      expect(toolExecuted).toBe(true);
      expect(approvalManager.hasPendingApprovals()).toBe(false);
    });

    it('should prevent execution when approval is denied', async () => {
      let toolExecuted = false;

      const executeToolWithApproval = async () => {
        const resolution = await approvalManager.requestApproval(
          taskId,
          'MISSION',
          'edit',
          'apply_diff',
          'Apply critical changes',
          {}
        );

        if (resolution.decision === 'approved') {
          toolExecuted = true;
        }

        return resolution;
      };

      const executionPromise = executeToolWithApproval();
      await new Promise(resolve => setTimeout(resolve, 50));

      const request = approvalManager.getPendingApprovals()[0];
      await approvalManager.denyApproval(taskId, 'MISSION', 'edit', request.approval_id);

      await executionPromise;

      // Tool should NOT have executed
      expect(toolExecuted).toBe(false);
    });
  });
});
