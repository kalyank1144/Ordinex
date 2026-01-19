/**
 * Tool Execution Tests
 * Verifies: 
 * - Tools cannot bypass approvals
 * - Evidence is generated for all tool calls
 * - Mode gating is enforced
 * - All tool activity is observable
 */

import { EventBus } from '../eventBus';
import { EventStore } from '../eventStore';
import { ModeManager } from '../modeManager';
import { ApprovalManager } from '../approvalManager';
import { ToolExecutor, InMemoryEvidenceStore, ToolInvocation } from '../toolExecutor';
import { Event, Mode, Stage } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('ToolExecutor', () => {
  let eventBus: EventBus;
  let eventStore: EventStore;
  let modeManager: ModeManager;
  let approvalManager: ApprovalManager;
  let evidenceStore: InMemoryEvidenceStore;
  let toolExecutor: ToolExecutor;
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
    evidenceStore = new InMemoryEvidenceStore();
    toolExecutor = new ToolExecutor(
      taskId,
      eventBus,
      modeManager,
      approvalManager,
      evidenceStore,
      workspaceRoot
    );
  });

  afterEach(async () => {
    // Cleanup temp workspace
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    approvalManager._abortAllForTesting();
  });

  describe('Mode Gating Enforcement', () => {
    test('read tools are blocked in ANSWER mode', async () => {
      modeManager.setMode('ANSWER');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'test.txt' },
        requiresApproval: false,
      };

      await expect(toolExecutor.executeTool(invocation)).rejects.toThrow(
        /not permitted in ANSWER mode/
      );

      // Verify mode_violation was emitted
      const events = eventStore.getEventsByTaskId(taskId);
      const violations = events.filter(e => e.type === 'mode_violation');
      expect(violations.length).toBe(1);
    });

    test('write tools are blocked in PLAN mode', async () => {
      modeManager.setMode('PLAN');

      const invocation: ToolInvocation = {
        toolName: 'writeFile',
        category: 'write',
        inputs: { path: 'test.txt', content: 'test' },
        requiresApproval: true,
      };

      await expect(toolExecutor.executeTool(invocation)).rejects.toThrow(
        /not permitted in PLAN mode/
      );

      const events = eventStore.getEventsByTaskId(taskId);
      const violations = events.filter(e => e.type === 'mode_violation');
      expect(violations.length).toBe(1);
    });

    test('read tools are allowed in MISSION mode', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      // Create test file
      const testFile = path.join(workspaceRoot, 'test.txt');
      await fs.writeFile(testFile, 'test content', 'utf-8');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'test.txt' },
        requiresApproval: false,
      };

      const result = await toolExecutor.executeTool(invocation);
      expect(result.success).toBe(true);
      expect(result.output).toBe('test content');
    });
  });

  describe('Approval Enforcement (CRITICAL)', () => {
    test('exec tools MUST request approval', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');

      const invocation: ToolInvocation = {
        toolName: 'executeCommand',
        category: 'exec',
        inputs: { command: 'echo test' },
        requiresApproval: true,
      };

      // Start execution (will block on approval)
      const executionPromise = toolExecutor.executeTool(invocation);

      // Wait for approval_requested event
      await new Promise(resolve => setTimeout(resolve, 50));

      const events = eventStore.getEventsByTaskId(taskId);
      const approvalRequests = events.filter(e => e.type === 'approval_requested');
      expect(approvalRequests.length).toBe(1);
      expect(approvalRequests[0].payload.approval_type).toBe('terminal');

      // Verify execution is blocked
      const pendingApprovals = approvalManager.getPendingApprovals();
      expect(pendingApprovals.length).toBe(1);

      // Approve the request
      await approvalManager.resolveApproval(
        taskId,
        'MISSION',
        'test',
        pendingApprovals[0].approval_id,
        'approved'
      );

      // Now execution should complete
      const result = await executionPromise;
      expect(result.success).toBe(true);
    });

    test('write tools MUST request approval', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('edit');

      const invocation: ToolInvocation = {
        toolName: 'writeFile',
        category: 'write',
        inputs: { path: 'test.txt', content: 'new content' },
        requiresApproval: true,
      };

      const executionPromise = toolExecutor.executeTool(invocation);
      await new Promise(resolve => setTimeout(resolve, 50));

      const events = eventStore.getEventsByTaskId(taskId);
      const approvalRequests = events.filter(e => e.type === 'approval_requested');
      expect(approvalRequests.length).toBe(1);
      expect(approvalRequests[0].payload.approval_type).toBe('apply_diff');

      // Deny the request
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.denyApproval(
        taskId,
        'MISSION',
        'edit',
        pendingApprovals[0].approval_id
      );

      // Execution should throw
      await expect(executionPromise).rejects.toThrow(/denied by user/);
    });

    test('read tools do NOT require approval', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      const testFile = path.join(workspaceRoot, 'test.txt');
      await fs.writeFile(testFile, 'test content', 'utf-8');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'test.txt' },
        requiresApproval: false,
      };

      const result = await toolExecutor.executeTool(invocation);
      expect(result.success).toBe(true);

      // Verify NO approval was requested
      const events = eventStore.getEventsByTaskId(taskId);
      const approvalRequests = events.filter(e => e.type === 'approval_requested');
      expect(approvalRequests.length).toBe(0);
    });
  });

  describe('Event Emission (Mandatory)', () => {
    test('every tool call emits tool_start and tool_end', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      const testFile = path.join(workspaceRoot, 'test.txt');
      await fs.writeFile(testFile, 'test content', 'utf-8');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'test.txt' },
        requiresApproval: false,
      };

      await toolExecutor.executeTool(invocation);

      const events = eventStore.getEventsByTaskId(taskId);
      const toolStarts = events.filter(e => e.type === 'tool_start');
      const toolEnds = events.filter(e => e.type === 'tool_end');

      expect(toolStarts.length).toBe(1);
      expect(toolEnds.length).toBe(1);

      // Verify tool_start payload
      expect(toolStarts[0].payload.tool).toBe('readFile');
      expect(toolStarts[0].payload.category).toBe('read');

      // Verify tool_end references tool_start
      expect(toolEnds[0].parent_event_id).toBe(toolStarts[0].event_id);
    });

    test('failed tool calls emit tool_end with error', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'nonexistent.txt' },
        requiresApproval: false,
      };

      const result = await toolExecutor.executeTool(invocation);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      const events = eventStore.getEventsByTaskId(taskId);
      const toolEnds = events.filter(e => e.type === 'tool_end');

      expect(toolEnds.length).toBe(1);
      expect(toolEnds[0].payload.success).toBe(false);
      expect(toolEnds[0].payload.error).toBeDefined();
    });
  });

  describe('Evidence Generation (Mandatory)', () => {
    test('successful tool execution generates evidence', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      const testFile = path.join(workspaceRoot, 'test.txt');
      await fs.writeFile(testFile, 'test content', 'utf-8');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'test.txt' },
        requiresApproval: false,
      };

      await toolExecutor.executeTool(invocation);

      // Verify evidence was generated
      const allEvidence = evidenceStore.getAll();
      expect(allEvidence.length).toBe(1);
      expect(allEvidence[0].type).toBe('file');
      expect(allEvidence[0].summary).toContain('readFile completed');

      // Verify tool_end references evidence
      const events = eventStore.getEventsByTaskId(taskId);
      const toolEnds = events.filter(e => e.type === 'tool_end');
      expect(toolEnds[0].evidence_ids.length).toBe(1);
      expect(toolEnds[0].evidence_ids[0]).toBe(allEvidence[0].evidence_id);
    });

    test('failed tool execution generates error evidence', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'nonexistent.txt' },
        requiresApproval: false,
      };

      await toolExecutor.executeTool(invocation);

      const allEvidence = evidenceStore.getAll();
      expect(allEvidence.length).toBe(1);
      expect(allEvidence[0].type).toBe('error');
      expect(allEvidence[0].summary).toContain('failed');
    });

    test('evidence contains source_event_id linkage', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      const testFile = path.join(workspaceRoot, 'test.txt');
      await fs.writeFile(testFile, 'test content', 'utf-8');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'test.txt' },
        requiresApproval: false,
      };

      await toolExecutor.executeTool(invocation);

      const events = eventStore.getEventsByTaskId(taskId);
      const toolStarts = events.filter(e => e.type === 'tool_start');
      const allEvidence = evidenceStore.getAll();

      expect(allEvidence[0].source_event_id).toBe(toolStarts[0].event_id);
    });
  });

  describe('Security Constraints', () => {
    test('path traversal is blocked', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: '../../../etc/passwd' },
        requiresApproval: false,
      };

      const result = await toolExecutor.executeTool(invocation);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal detected');
    });

    test('sensitive inputs are redacted in events', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');

      const invocation: ToolInvocation = {
        toolName: 'executeCommand',
        category: 'exec',
        inputs: { 
          command: 'curl -H "Authorization: Bearer secret-token"',
          token: 'super-secret',
          password: 'my-password'
        },
        requiresApproval: true,
      };

      const executionPromise = toolExecutor.executeTool(invocation);
      await new Promise(resolve => setTimeout(resolve, 50));

      const events = eventStore.getEventsByTaskId(taskId);
      const toolStarts = events.filter(e => e.type === 'tool_start');
      
      // Verify sensitive inputs are redacted
      expect(toolStarts[0].payload.inputs).toEqual({
        command: 'curl -H "Authorization: Bearer secret-token"',
        token: '[REDACTED]',
        password: '[REDACTED]'
      });

      // Cleanup
      const pendingApprovals = approvalManager.getPendingApprovals();
      await approvalManager.denyApproval(
        taskId,
        'MISSION',
        'test',
        pendingApprovals[0].approval_id
      );
      await executionPromise.catch(() => {}); // Ignore error
    });
  });

  describe('Tool Implementations', () => {
    test('readFile returns file content', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      const testFile = path.join(workspaceRoot, 'test.txt');
      const content = 'Hello, Ordinex!';
      await fs.writeFile(testFile, content, 'utf-8');

      const invocation: ToolInvocation = {
        toolName: 'readFile',
        category: 'read',
        inputs: { path: 'test.txt' },
        requiresApproval: false,
      };

      const result = await toolExecutor.executeTool(invocation);
      expect(result.success).toBe(true);
      expect(result.output).toBe(content);
    });

    test('listFiles returns directory contents', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('retrieve');

      // Create test files
      await fs.writeFile(path.join(workspaceRoot, 'file1.txt'), 'test', 'utf-8');
      await fs.writeFile(path.join(workspaceRoot, 'file2.txt'), 'test', 'utf-8');

      const invocation: ToolInvocation = {
        toolName: 'listFiles',
        category: 'read',
        inputs: { path: '.', recursive: false },
        requiresApproval: false,
      };

      const result = await toolExecutor.executeTool(invocation);
      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.txt');
      expect(result.output).toContain('file2.txt');
    });
  });
});
