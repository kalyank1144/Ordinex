/**
 * SystemsViewModel Tests - Step 29
 * 
 * Tests the pure reducer that derives operational truth from events.
 * Ensures replay-safe behavior: same events → identical output.
 */

import {
  reduceToSystemsViewModel,
  getTopRetrievedFiles,
  hasMoreRetrievedFiles,
  getStatusSummary,
  getWaitingSummary,
  formatTokenEstimate,
  SystemsViewModel,
} from '../systemsViewModel';
import { Event, Stage, Mode } from '../types';

// Helper to create test events
function createEvent(
  type: string,
  payload: Record<string, unknown> = {},
  overrides: Partial<Event> = {}
): Event {
  return {
    event_id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    task_id: 'test-task',
    timestamp: new Date().toISOString(),
    type: type as Event['type'],
    mode: 'MISSION' as Mode,
    stage: 'none' as Stage,
    payload,
    evidence_ids: [],
    parent_event_id: null,
    ...overrides,
  };
}

describe('SystemsViewModel Reducer', () => {
  describe('Status Section', () => {
    it('should start with idle status', () => {
      const vm = reduceToSystemsViewModel([]);
      expect(vm.status.runStatus).toBe('idle');
      expect(vm.status.currentStage).toBe('none');
      expect(vm.status.currentMission).toBeNull();
    });

    it('should update status on mission_started', () => {
      const events: Event[] = [
        createEvent('mission_started', { mission_id: 'mission-1', goal: 'Test goal' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.status.runStatus).toBe('running');
      expect(vm.status.currentMission).toBe('mission-1');
      expect(vm.status.missionGoal).toBe('Test goal');
    });

    it('should set paused status on execution_paused', () => {
      const events: Event[] = [
        createEvent('mission_started', { mission_id: 'm1' }),
        createEvent('execution_paused', { reason: 'Awaiting approval' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.status.runStatus).toBe('paused');
      expect(vm.status.pausedReason).toBe('Awaiting approval');
    });

    it('should update stage on stage_changed', () => {
      const events: Event[] = [
        createEvent('stage_changed', { from: 'none', to: 'retrieve' }, { stage: 'retrieve' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.status.currentStage).toBe('retrieve');
    });

    it('should track current step', () => {
      const events: Event[] = [
        createEvent('step_started', { step_index: 2, description: 'Implement feature' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.status.currentStep).toEqual({ index: 2, description: 'Implement feature' });
    });

    it('should clear step on step_completed', () => {
      const events: Event[] = [
        createEvent('step_started', { step_index: 0, description: 'Step 1' }),
        createEvent('step_completed', { step_index: 0, success: true }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.status.currentStep).toBeNull();
    });
  });

  describe('WaitingFor Section', () => {
    it('should track pending approvals', () => {
      const events: Event[] = [
        createEvent('approval_requested', {
          approval_id: 'apr-1',
          approval_type: 'apply_diff',
          description: 'Apply changes',
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.waitingFor.pendingApprovals).toHaveLength(1);
      expect(vm.waitingFor.pendingApprovals[0].approvalId).toBe('apr-1');
      expect(vm.waitingFor.pendingApprovals[0].type).toBe('apply_diff');
    });

    it('should remove resolved approvals', () => {
      const events: Event[] = [
        createEvent('approval_requested', { approval_id: 'apr-1', approval_type: 'terminal' }),
        createEvent('approval_resolved', { approval_id: 'apr-1', approved: true }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.waitingFor.pendingApprovals).toHaveLength(0);
    });

    it('should track pending decision points', () => {
      const events: Event[] = [
        createEvent('decision_point_needed', {
          decision_id: 'dec-1',
          description: 'Choose strategy',
          options: ['A', 'B', 'C'],
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.waitingFor.pendingDecisionPoints).toHaveLength(1);
      expect(vm.waitingFor.pendingDecisionPoints[0].options).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Scope Section', () => {
    it('should initialize scope from run_scope_initialized', () => {
      const events: Event[] = [
        createEvent('run_scope_initialized', {
          workspaceRoots: ['/home/user/project'],
          allowedCreateRoots: ['src/', 'tests/'],
          deniedPatterns: ['node_modules/', '.git/'],
          maxFiles: 20,
          maxLines: 2000,
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.scope.workspaceRoots).toEqual(['/home/user/project']);
      expect(vm.scope.allowedCreateRoots).toEqual(['src/', 'tests/']);
      expect(vm.scope.deniedPatterns).toEqual(['node_modules/', '.git/']);
      expect(vm.scope.maxFiles).toBe(20);
      expect(vm.scope.maxLines).toBe(2000);
    });

    it('should track approved expansions', () => {
      const events: Event[] = [
        createEvent('scope_expansion_resolved', {
          approved: true,
          requested: { files: ['extra/file.ts'] },
          reason: 'Need extra context',
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.scope.approvedExpansions).toContain('extra/file.ts');
    });
  });

  describe('Context Included Section', () => {
    it('should track retrieved files', () => {
      const events: Event[] = [
        createEvent('retrieval_completed', {
          result_count: 3,
          total_lines: 150,
          tokenEstimate: 2500,
          totalCharacters: 10000,
          results: [
            { file: 'src/index.ts', startLine: 1, endLine: 50, reason: 'lexical_match' },
            { file: 'src/utils.ts', startLine: 10, endLine: 60, reason: 'lexical_match' },
          ],
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.contextIncluded.retrievedFiles).toHaveLength(2);
      expect(vm.contextIncluded.tokenEstimate).toBe(2500);
      expect(vm.contextIncluded.totalCharacters).toBe(10000);
    });

    it('should handle context_collected events', () => {
      const events: Event[] = [
        createEvent('context_collected', {
          files_included: [
            { path: 'src/a.ts', lines: 100 },
            { path: 'src/b.ts', lines: 50 },
          ],
          total_lines: 150,
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.contextIncluded.retrievedFiles).toHaveLength(2);
      expect(vm.contextIncluded.totalLines).toBe(150);
    });
  });

  describe('Changes Section', () => {
    it('should track diff proposed', () => {
      const events: Event[] = [
        createEvent('diff_proposed', {
          diff_id: 'diff-1',
          files_changed: ['src/a.ts', 'src/b.ts'],
          kind: 'edit',
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.changes.lastDiffProposed?.diffId).toBe('diff-1');
      expect(vm.changes.lastDiffProposed?.filesChanged).toEqual(['src/a.ts', 'src/b.ts']);
      expect(vm.changes.diffsProposedCount).toBe(1);
    });

    it('should track diff applied', () => {
      const events: Event[] = [
        createEvent('diff_applied', {
          diff_id: 'diff-1',
          files_changed: ['src/a.ts'],
          success: true,
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.changes.lastDiffApplied?.success).toBe(true);
      expect(vm.changes.diffsAppliedCount).toBe(1);
      expect(vm.changes.filesChangedTotal).toContain('src/a.ts');
    });

    it('should track checkpoints', () => {
      const events: Event[] = [
        createEvent('checkpoint_created', { checkpoint_id: 'cp-1' }),
        createEvent('checkpoint_created', { checkpoint_id: 'cp-2' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.changes.checkpointsCreated).toBe(2);
      expect(vm.changes.lastCheckpoint?.checkpointId).toBe('cp-2');
    });
  });

  describe('Tests & Repair Section', () => {
    it('should track test results', () => {
      const events: Event[] = [
        createEvent('test_started', { command: 'npm test' }),
        createEvent('test_completed', { command: 'npm test', exit_code: 0, summary: 'All passed' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.testsAndRepair.lastTestRun?.passed).toBe(true);
      expect(vm.testsAndRepair.testsRan).toBe(1);
      expect(vm.testsAndRepair.testsPassed).toBe(1);
      expect(vm.testsAndRepair.allowlistedCommands).toContain('npm test');
    });

    it('should track test failures', () => {
      const events: Event[] = [
        createEvent('test_failed', { command: 'npm test', exit_code: 1, error: 'Assertion failed' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.testsAndRepair.lastTestRun?.passed).toBe(false);
      expect(vm.testsAndRepair.testsFailed).toBe(1);
    });

    it('should track repair policy from snapshot', () => {
      const events: Event[] = [
        createEvent('repair_policy_snapshot', { maxRepairIterations: 5 }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.testsAndRepair.repairAttempts.max).toBe(5);
    });

    it('should count repair attempts', () => {
      const events: Event[] = [
        createEvent('repair_policy_snapshot', { maxRepairIterations: 3 }),
        createEvent('repair_attempt_started', {}),
        createEvent('repair_attempt_started', {}),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.testsAndRepair.repairAttempts.used).toBe(2);
      expect(vm.testsAndRepair.repairAttempts.remaining).toBe(1);
    });

    it('should track failures', () => {
      const events: Event[] = [
        createEvent('failure_detected', { error: 'Something went wrong', category: 'runtime' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.testsAndRepair.lastFailure?.summary).toBe('Something went wrong');
      expect(vm.testsAndRepair.lastFailure?.category).toBe('runtime');
      expect(vm.testsAndRepair.failureCount).toBe(1);
    });
  });

  describe('Tool Activity Section', () => {
    it('should count tool calls', () => {
      const events: Event[] = [
        createEvent('tool_start', { tool: 'read_file' }),
        createEvent('tool_end', { tool: 'read_file', success: true }),
        createEvent('tool_start', { tool: 'write_file' }),
        createEvent('tool_end', { tool: 'write_file', success: true }),
        createEvent('tool_start', { tool: 'read_file' }),
        createEvent('tool_end', { tool: 'read_file', success: false }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.toolActivity.counts['read_file']).toBe(2);
      expect(vm.toolActivity.counts['write_file']).toBe(1);
      expect(vm.toolActivity.totalCalls).toBe(3);
      expect(vm.toolActivity.lastToolCall?.tool).toBe('read_file');
      expect(vm.toolActivity.lastToolCall?.success).toBe(false);
    });
  });

  describe('Timeouts Section', () => {
    it('should track stage timeouts', () => {
      const events: Event[] = [
        createEvent('stage_timeout', { stage: 'edit', timeout_ms: 60000 }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(vm.timeouts.lastTimeout?.stage).toBe('edit');
      expect(vm.timeouts.lastTimeout?.configuredMs).toBe(60000);
      expect(vm.timeouts.timeoutCount).toBe(1);
    });
  });

  describe('Replay Safety', () => {
    it('should produce identical output for same events', () => {
      const events: Event[] = [
        createEvent('mission_started', { mission_id: 'm1', goal: 'Test' }),
        createEvent('stage_changed', { to: 'retrieve' }),
        createEvent('retrieval_completed', { result_count: 5, total_lines: 200 }),
        createEvent('approval_requested', { approval_id: 'apr-1', approval_type: 'apply_diff' }),
        createEvent('approval_resolved', { approval_id: 'apr-1', approved: true }),
        createEvent('diff_proposed', { diff_id: 'd1', files_changed: ['a.ts'] }),
        createEvent('diff_applied', { diff_id: 'd1', files_changed: ['a.ts'], success: true }),
        createEvent('test_started', { command: 'npm test' }),
        createEvent('test_completed', { command: 'npm test' }),
        createEvent('mission_completed', {}),
      ];

      // Run reducer multiple times
      const vm1 = reduceToSystemsViewModel(events);
      const vm2 = reduceToSystemsViewModel(events);
      const vm3 = reduceToSystemsViewModel([...events]); // Copy of events

      // Results should be identical (deterministic)
      expect(JSON.stringify(vm1)).toBe(JSON.stringify(vm2));
      expect(JSON.stringify(vm2)).toBe(JSON.stringify(vm3));
    });

    it('should correctly handle event sequence after reload', () => {
      // Simulate events that would be loaded from storage
      const storedEvents: Event[] = [
        createEvent('run_scope_initialized', { workspaceRoots: ['/project'], maxFiles: 15 }),
        createEvent('repair_policy_snapshot', { maxRepairIterations: 4 }),
        createEvent('mission_started', { mission_id: 'm1', goal: 'Implement feature' }),
        createEvent('retrieval_completed', { result_count: 3, total_lines: 100, tokenEstimate: 800 }),
        createEvent('repair_attempt_started', {}),
        createEvent('test_failed', { command: 'npm test', exit_code: 1 }),
      ];

      const vm = reduceToSystemsViewModel(storedEvents);

      // Verify state is correctly reconstructed
      expect(vm.scope.workspaceRoots).toEqual(['/project']);
      expect(vm.scope.maxFiles).toBe(15);
      expect(vm.testsAndRepair.repairAttempts.max).toBe(4);
      expect(vm.testsAndRepair.repairAttempts.used).toBe(1);
      expect(vm.testsAndRepair.repairAttempts.remaining).toBe(3);
      expect(vm.status.currentMission).toBe('m1');
      expect(vm.contextIncluded.tokenEstimate).toBe(800);
      expect(vm.testsAndRepair.testsFailed).toBe(1);
    });
  });
});

describe('Helper Functions', () => {
  describe('getTopRetrievedFiles', () => {
    it('should return top N files', () => {
      const events: Event[] = [
        createEvent('retrieval_completed', {
          results: [
            { file: 'a.ts', startLine: 1, endLine: 10, reason: 'match' },
            { file: 'b.ts', startLine: 1, endLine: 10, reason: 'match' },
            { file: 'c.ts', startLine: 1, endLine: 10, reason: 'match' },
            { file: 'd.ts', startLine: 1, endLine: 10, reason: 'match' },
            { file: 'e.ts', startLine: 1, endLine: 10, reason: 'match' },
            { file: 'f.ts', startLine: 1, endLine: 10, reason: 'match' },
          ],
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      const top5 = getTopRetrievedFiles(vm, 5);
      expect(top5).toHaveLength(5);
      expect(top5[0].file).toBe('a.ts');
    });
  });

  describe('hasMoreRetrievedFiles', () => {
    it('should return true when more files exist', () => {
      const events: Event[] = [
        createEvent('retrieval_completed', {
          results: Array.from({ length: 10 }, (_, i) => ({
            file: `file${i}.ts`,
            startLine: 1,
            endLine: 10,
            reason: 'match',
          })),
        }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(hasMoreRetrievedFiles(vm, 5)).toBe(true);
    });
  });

  describe('getStatusSummary', () => {
    it('should return friendly status', () => {
      const vm = reduceToSystemsViewModel([]);
      expect(getStatusSummary(vm)).toBe('Ready');

      const runningVm = reduceToSystemsViewModel([
        createEvent('mission_started', { mission_id: 'm1' }),
        createEvent('stage_changed', { to: 'edit' }),
      ]);
      expect(getStatusSummary(runningVm)).toBe('Running: edit');
    });
  });

  describe('getWaitingSummary', () => {
    it('should return null when nothing pending', () => {
      const vm = reduceToSystemsViewModel([]);
      expect(getWaitingSummary(vm)).toBeNull();
    });

    it('should summarize pending items', () => {
      const events: Event[] = [
        createEvent('approval_requested', { approval_id: 'a1', approval_type: 'diff' }),
        createEvent('approval_requested', { approval_id: 'a2', approval_type: 'terminal' }),
      ];
      const vm = reduceToSystemsViewModel(events);
      expect(getWaitingSummary(vm)).toBe('Waiting for: 2 approvals');
    });
  });

  describe('formatTokenEstimate', () => {
    it('should format token counts', () => {
      expect(formatTokenEstimate(null)).toBe('');
      expect(formatTokenEstimate(500)).toBe('~500 tokens');
      expect(formatTokenEstimate(2500)).toBe('~2.5k tokens');
    });
  });
});
