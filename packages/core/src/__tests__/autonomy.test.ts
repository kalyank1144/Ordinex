/**
 * Autonomy Controller Tests
 * Verifies:
 * - Budget exhaustion halts autonomy
 * - No silent changes (all events emitted)
 * - Preconditions enforced
 * - Mandatory checkpoints per iteration
 * - Mode changes halt autonomy
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../eventBus';
import { EventStore } from '../eventStore';
import { ModeManager } from '../modeManager';
import { CheckpointManager } from '../checkpointManager';
import {
  AutonomyController,
  DEFAULT_A1_BUDGETS,
  AutonomyBudgets,
  IterationResult,
} from '../autonomyController';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('AutonomyController', () => {
  let eventBus: EventBus;
  let eventStore: EventStore;
  let modeManager: ModeManager;
  let checkpointManager: CheckpointManager;
  let autonomyController: AutonomyController;
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
    checkpointManager = new CheckpointManager(eventBus, workspaceRoot);
    autonomyController = new AutonomyController(
      taskId,
      eventBus,
      checkpointManager,
      modeManager
    );
  });

  afterEach(async () => {
    // Cleanup temp workspace
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  describe('Preconditions (MANDATORY)', () => {
    test('autonomy requires MISSION mode', () => {
      modeManager.setMode('ANSWER');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      const check = autonomyController.checkPreconditions();
      expect(check.satisfied).toBe(false);
      expect(check.missing).toContain('Current mode must be MISSION');
    });

    test('autonomy requires approved plan', () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('edit');
      autonomyController.setToolsApproved(true);
      // Plan not approved

      const check = autonomyController.checkPreconditions();
      expect(check.satisfied).toBe(false);
      expect(check.missing).toContain('Plan must be approved');
    });

    test('autonomy requires approved tools', () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('edit');
      autonomyController.setPlanApproved(true);
      // Tools not approved

      const check = autonomyController.checkPreconditions();
      expect(check.satisfied).toBe(false);
      expect(check.missing).toContain('Tools must be approved');
    });

    test('autonomy starts when all preconditions met', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('edit');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      const check = autonomyController.checkPreconditions();
      expect(check.satisfied).toBe(true);

      await autonomyController.startAutonomy('MISSION', 'edit');
      expect(autonomyController.getState()).toBe('running');
    });

    test('startAutonomy throws if preconditions not met', async () => {
      modeManager.setMode('ANSWER');

      await expect(
        autonomyController.startAutonomy('ANSWER', 'none')
      ).rejects.toThrow(/preconditions not satisfied/);
    });
  });

  describe('Budget Exhaustion (CRITICAL)', () => {
    test('iteration budget exhaustion halts autonomy', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      // Use small budget
      const budgets: AutonomyBudgets = {
        max_iterations: 2,
        max_wall_time_ms: 60000,
        max_tool_calls: 10,
      };
      const controller = new AutonomyController(
        taskId,
        eventBus,
        checkpointManager,
        modeManager,
        budgets
      );
      controller.setPlanApproved(true);
      controller.setToolsApproved(true);

      await controller.startAutonomy('MISSION', 'test');

      // Execute iterations until exhaustion
      let continueIterating = true;
      let iterationCount = 0;

      while (continueIterating && iterationCount < 10) {
        continueIterating = await controller.executeIteration(
          'MISSION',
          'test',
          async () => ({
            success: false,
            failure_reason: 'Test failure',
          })
        );
        iterationCount++;
      }

      // Should have stopped due to budget exhaustion
      expect(controller.getState()).toBe('budget_exhausted');
      expect(controller.getCurrentIteration()).toBe(2);

      // Verify budget_exhausted event emitted
      const events = eventStore.getEventsByTaskId(taskId);
      const budgetExhaustedEvents = events.filter(e => e.type === 'budget_exhausted');
      expect(budgetExhaustedEvents.length).toBe(1);
      expect(budgetExhaustedEvents[0].payload.exhausted_budget).toBe('max_iterations');
    });

    test('tool call budget exhaustion halts autonomy', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');

      const budgets: AutonomyBudgets = {
        max_iterations: 10,
        max_wall_time_ms: 60000,
        max_tool_calls: 3,
      };
      const controller = new AutonomyController(
        taskId,
        eventBus,
        checkpointManager,
        modeManager,
        budgets
      );
      controller.setPlanApproved(true);
      controller.setToolsApproved(true);

      await controller.startAutonomy('MISSION', 'test');

      // Use up tool call budget
      controller.incrementToolCalls(3);

      // Next iteration should fail due to budget
      const continueIterating = await controller.executeIteration(
        'MISSION',
        'test',
        async () => ({
          success: false,
          failure_reason: 'Test failure',
        })
      );

      expect(continueIterating).toBe(false);
      expect(controller.getState()).toBe('budget_exhausted');

      const events = eventStore.getEventsByTaskId(taskId);
      const budgetExhaustedEvents = events.filter(e => e.type === 'budget_exhausted');
      expect(budgetExhaustedEvents.length).toBe(1);
      expect(budgetExhaustedEvents[0].payload.exhausted_budget).toBe('max_tool_calls');
    });

    test('time budget exhaustion halts autonomy', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');

      const budgets: AutonomyBudgets = {
        max_iterations: 10,
        max_wall_time_ms: 100, // 100ms
        max_tool_calls: 10,
      };
      const controller = new AutonomyController(
        taskId,
        eventBus,
        checkpointManager,
        modeManager,
        budgets
      );
      controller.setPlanApproved(true);
      controller.setToolsApproved(true);

      await controller.startAutonomy('MISSION', 'test');

      // Wait for time to elapse
      await new Promise(resolve => setTimeout(resolve, 150));

      // Next iteration should fail due to time budget
      const continueIterating = await controller.executeIteration(
        'MISSION',
        'test',
        async () => ({
          success: false,
          failure_reason: 'Test failure',
        })
      );

      expect(continueIterating).toBe(false);
      expect(controller.getState()).toBe('budget_exhausted');
    });
  });

  describe('Checkpoint Creation (MANDATORY)', () => {
    test('checkpoint created BEFORE each iteration', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');

      // Execute one iteration
      await autonomyController.executeIteration('MISSION', 'test', async () => ({
        success: false,
        failure_reason: 'Test failure',
      }));

      // Verify checkpoint was created
      const events = eventStore.getEventsByTaskId(taskId);
      const checkpointEvents = events.filter(e => e.type === 'checkpoint_created');
      const iterationStartedEvents = events.filter(e => e.type === 'iteration_started');

      expect(checkpointEvents.length).toBe(1);
      expect(iterationStartedEvents.length).toBe(1);

      // Checkpoint must come BEFORE iteration_started
      const checkpointIndex = events.indexOf(checkpointEvents[0]);
      const iterationIndex = events.indexOf(iterationStartedEvents[0]);
      expect(checkpointIndex).toBeLessThan(iterationIndex);
    });

    test('multiple iterations create multiple checkpoints', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');

      // Execute 2 iterations
      await autonomyController.executeIteration('MISSION', 'test', async () => ({
        success: false,
        failure_reason: 'Test failure 1',
      }));

      await autonomyController.executeIteration('MISSION', 'test', async () => ({
        success: true,
      }));

      // Verify 2 checkpoints created
      const events = eventStore.getEventsByTaskId(taskId);
      const checkpointEvents = events.filter(e => e.type === 'checkpoint_created');
      expect(checkpointEvents.length).toBe(2);
    });
  });

  describe('Event Emission (NO SILENT CHANGES)', () => {
    test('autonomy_started emitted on start', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('edit');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'edit');

      const events = eventStore.getEventsByTaskId(taskId);
      const startedEvents = events.filter(e => e.type === 'autonomy_started');
      expect(startedEvents.length).toBe(1);
      expect(startedEvents[0].payload.budgets).toEqual(DEFAULT_A1_BUDGETS);
    });

    test('iteration_started emitted for each iteration', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');

      await autonomyController.executeIteration('MISSION', 'test', async () => ({
        success: false,
        failure_reason: 'Test failure',
      }));

      const events = eventStore.getEventsByTaskId(taskId);
      const iterationStartedEvents = events.filter(e => e.type === 'iteration_started');
      expect(iterationStartedEvents.length).toBe(1);
      expect(iterationStartedEvents[0].payload.iteration).toBe(1);
      expect(iterationStartedEvents[0].payload.budgets_remaining).toBeDefined();
    });

    test('iteration_succeeded emitted on success', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');

      await autonomyController.executeIteration('MISSION', 'test', async () => ({
        success: true,
        evidence_ids: ['evidence-1'],
      }));

      const events = eventStore.getEventsByTaskId(taskId);
      const succeededEvents = events.filter(e => e.type === 'iteration_succeeded');
      expect(succeededEvents.length).toBe(1);
      expect(succeededEvents[0].payload.iteration).toBe(1);
      expect(succeededEvents[0].payload.evidence_ids).toEqual(['evidence-1']);
    });

    test('iteration_failed emitted on failure', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');

      await autonomyController.executeIteration('MISSION', 'test', async () => ({
        success: false,
        failure_reason: 'Test failed: assertion error',
      }));

      const events = eventStore.getEventsByTaskId(taskId);
      const failedEvents = events.filter(e => e.type === 'iteration_failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0].payload.failure_reason).toBe('Test failed: assertion error');
    });

    test('repair_attempted emitted when repair is attempted', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('repair');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'repair');

      await autonomyController.attemptRepair(
        'MISSION',
        'repair',
        'Build failure',
        async () => {
          // Repair logic
        }
      );

      const events = eventStore.getEventsByTaskId(taskId);
      const repairEvents = events.filter(e => e.type === 'repair_attempted');
      expect(repairEvents.length).toBe(1);
      expect(repairEvents[0].payload.failure_reason).toBe('Build failure');
    });

    test('autonomy_completed emitted on successful completion', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');
      await autonomyController.complete('MISSION', 'test');

      const events = eventStore.getEventsByTaskId(taskId);
      const completedEvents = events.filter(e => e.type === 'autonomy_completed');
      expect(completedEvents.length).toBe(1);
      expect(completedEvents[0].payload.iterations_used).toBe(0);
    });
  });

  describe('Mode Change Safety (CRITICAL)', () => {
    test('mode change from MISSION halts autonomy', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');
      expect(autonomyController.getState()).toBe('running');

      // Mode changes to PLAN
      await autonomyController.checkModeChange('PLAN', 'test');

      expect(autonomyController.getState()).toBe('halted');

      const events = eventStore.getEventsByTaskId(taskId);
      const haltedEvents = events.filter(e => e.type === 'autonomy_halted');
      expect(haltedEvents.length).toBe(1);
      expect(haltedEvents[0].payload.reason).toContain('Mode changed from MISSION to PLAN');
    });

    test('mode change to ANSWER halts autonomy', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');

      await autonomyController.checkModeChange('ANSWER', 'none');

      expect(autonomyController.getState()).toBe('halted');
    });
  });

  describe('Pause/Resume/Halt', () => {
    test('pause stops autonomy temporarily', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');
      await autonomyController.pause('MISSION', 'test');

      expect(autonomyController.getState()).toBe('paused');

      const events = eventStore.getEventsByTaskId(taskId);
      const pausedEvents = events.filter(e => e.type === 'execution_paused');
      expect(pausedEvents.length).toBe(1);
    });

    test('resume restarts paused autonomy', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');
      await autonomyController.pause('MISSION', 'test');
      await autonomyController.resume('MISSION', 'test');

      expect(autonomyController.getState()).toBe('running');

      const events = eventStore.getEventsByTaskId(taskId);
      const resumedEvents = events.filter(e => e.type === 'execution_resumed');
      expect(resumedEvents.length).toBe(1);
    });

    test('halt stops autonomy permanently', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');
      autonomyController.setPlanApproved(true);
      autonomyController.setToolsApproved(true);

      await autonomyController.startAutonomy('MISSION', 'test');
      await autonomyController.halt('MISSION', 'test', 'User requested stop');

      expect(autonomyController.getState()).toBe('halted');

      const events = eventStore.getEventsByTaskId(taskId);
      const haltedEvents = events.filter(e => e.type === 'autonomy_halted');
      expect(haltedEvents.length).toBe(1);
      expect(haltedEvents[0].payload.reason).toBe('User requested stop');
    });
  });

  describe('Budget Tracking', () => {
    test('getBudgetsRemaining returns correct values', async () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('test');

      const budgets: AutonomyBudgets = {
        max_iterations: 5,
        max_wall_time_ms: 60000,
        max_tool_calls: 10,
      };
      const controller = new AutonomyController(
        taskId,
        eventBus,
        checkpointManager,
        modeManager,
        budgets
      );
      controller.setPlanApproved(true);
      controller.setToolsApproved(true);

      await controller.startAutonomy('MISSION', 'test');

      // Use some budgets
      controller.incrementToolCalls(3);
      await controller.executeIteration('MISSION', 'test', async () => ({
        success: false,
        failure_reason: 'Test failure',
      }));

      const remaining = controller.getBudgetsRemaining();
      expect(remaining.iterations).toBe(4); // 5 - 1
      expect(remaining.tool_calls).toBe(7); // 10 - 3
      expect(remaining.time_ms).toBeLessThanOrEqual(60000);
    });
  });
});
