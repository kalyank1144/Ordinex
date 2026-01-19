/**
 * Unit tests for TaskLifecycleController and ModeManager
 * Tests mode transitions, violations, stage changes, and pause/resume/stop
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventStore } from '../eventStore';
import { EventBus } from '../eventBus';
import { TaskLifecycleController } from '../taskLifecycle';
import { ModeManager } from '../modeManager';

describe('ModeManager', () => {
  let testDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let modeManager: ModeManager;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
    storePath = path.join(testDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    modeManager = new ModeManager('task_test', eventBus);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Mode Transitions', () => {
    it('should start in ANSWER mode', () => {
      expect(modeManager.getMode()).toBe('ANSWER');
      expect(modeManager.isAnswerMode()).toBe(true);
    });

    it('should transition to PLAN mode', () => {
      modeManager.setMode('PLAN');
      expect(modeManager.getMode()).toBe('PLAN');
      expect(modeManager.isPlanMode()).toBe(true);
      expect(modeManager.isAnswerMode()).toBe(false);
    });

    it('should transition to MISSION mode', () => {
      modeManager.setMode('MISSION');
      expect(modeManager.getMode()).toBe('MISSION');
      expect(modeManager.isMissionMode()).toBe(true);
    });

    it('should reset stage to none when switching from MISSION', () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('edit');
      expect(modeManager.getStage()).toBe('edit');

      modeManager.setMode('PLAN');
      expect(modeManager.getStage()).toBe('none');
    });
  });

  describe('Stage Transitions', () => {
    it('should allow stage changes in MISSION mode', () => {
      modeManager.setMode('MISSION');
      modeManager.setStage('plan');
      expect(modeManager.getStage()).toBe('plan');

      modeManager.setStage('retrieve');
      expect(modeManager.getStage()).toBe('retrieve');

      modeManager.setStage('edit');
      expect(modeManager.getStage()).toBe('edit');
    });

    it('should reject non-none stages in ANSWER mode', () => {
      expect(() => {
        modeManager.setStage('edit');
      }).toThrow(/only valid in MISSION mode/);
    });

    it('should reject non-none stages in PLAN mode', () => {
      modeManager.setMode('PLAN');
      expect(() => {
        modeManager.setStage('retrieve');
      }).toThrow(/only valid in MISSION mode/);
    });

    it('should allow none stage in any mode', () => {
      modeManager.setMode('ANSWER');
      modeManager.setStage('none');
      expect(modeManager.getStage()).toBe('none');

      modeManager.setMode('PLAN');
      modeManager.setStage('none');
      expect(modeManager.getStage()).toBe('none');
    });
  });

  describe('Mode Violations', () => {
    it('should reject write_file in ANSWER mode', () => {
      const result = modeManager.validateAction('write_file');
      expect(result.allowed).toBe(false);
      expect(result.violation?.currentMode).toBe('ANSWER');
      expect(result.violation?.attemptedAction).toBe('write_file');
    });

    it('should reject execute_command in ANSWER mode', () => {
      const result = modeManager.validateAction('execute_command');
      expect(result.allowed).toBe(false);
    });

    it('should allow read_file in ANSWER mode', () => {
      const result = modeManager.validateAction('read_file');
      expect(result.allowed).toBe(true);
    });

    it('should allow retrieve in ANSWER mode', () => {
      const result = modeManager.validateAction('retrieve');
      expect(result.allowed).toBe(true);
    });

    it('should reject write_file in PLAN mode', () => {
      modeManager.setMode('PLAN');
      const result = modeManager.validateAction('write_file');
      expect(result.allowed).toBe(false);
    });

    it('should allow plan action in PLAN mode', () => {
      modeManager.setMode('PLAN');
      const result = modeManager.validateAction('plan');
      expect(result.allowed).toBe(true);
    });

    it('should allow all actions in MISSION mode', () => {
      modeManager.setMode('MISSION');
      
      expect(modeManager.validateAction('read_file').allowed).toBe(true);
      expect(modeManager.validateAction('write_file').allowed).toBe(true);
      expect(modeManager.validateAction('execute_command').allowed).toBe(true);
      expect(modeManager.validateAction('retrieve').allowed).toBe(true);
      expect(modeManager.validateAction('plan').allowed).toBe(true);
      expect(modeManager.validateAction('diff').allowed).toBe(true);
      expect(modeManager.validateAction('checkpoint').allowed).toBe(true);
    });

    it('should emit mode_violation event when enforcing illegal action', async () => {
      const events: string[] = [];
      eventBus.subscribe((event) => {
        events.push(event.type);
      });

      const allowed = await modeManager.enforceAction('write_file');
      
      expect(allowed).toBe(false);
      expect(events).toContain('mode_violation');
    });

    it('should return true when enforcing legal action', async () => {
      const allowed = await modeManager.enforceAction('read_file');
      expect(allowed).toBe(true);
    });
  });

  describe('Stage Permissions', () => {
    beforeEach(() => {
      modeManager.setMode('MISSION');
    });

    it('should enforce stage permissions in plan stage', () => {
      modeManager.setStage('plan');
      
      expect(modeManager.validateAction('read_file').allowed).toBe(true);
      expect(modeManager.validateAction('retrieve').allowed).toBe(true);
      expect(modeManager.validateAction('plan').allowed).toBe(true);
      expect(modeManager.validateAction('write_file').allowed).toBe(false);
      expect(modeManager.validateAction('execute_command').allowed).toBe(false);
    });

    it('should enforce stage permissions in retrieve stage', () => {
      modeManager.setStage('retrieve');
      
      expect(modeManager.validateAction('read_file').allowed).toBe(true);
      expect(modeManager.validateAction('retrieve').allowed).toBe(true);
      expect(modeManager.validateAction('write_file').allowed).toBe(false);
    });

    it('should enforce stage permissions in edit stage', () => {
      modeManager.setStage('edit');
      
      expect(modeManager.validateAction('read_file').allowed).toBe(true);
      expect(modeManager.validateAction('write_file').allowed).toBe(true);
      expect(modeManager.validateAction('diff').allowed).toBe(true);
      expect(modeManager.validateAction('checkpoint').allowed).toBe(true);
      expect(modeManager.validateAction('execute_command').allowed).toBe(false);
    });

    it('should enforce stage permissions in test stage', () => {
      modeManager.setStage('test');
      
      expect(modeManager.validateAction('read_file').allowed).toBe(true);
      expect(modeManager.validateAction('execute_command').allowed).toBe(true);
      expect(modeManager.validateAction('write_file').allowed).toBe(false);
    });

    it('should enforce stage permissions in repair stage', () => {
      modeManager.setStage('repair');
      
      expect(modeManager.validateAction('read_file').allowed).toBe(true);
      expect(modeManager.validateAction('write_file').allowed).toBe(true);
      expect(modeManager.validateAction('diff').allowed).toBe(true);
      expect(modeManager.validateAction('checkpoint').allowed).toBe(true);
      expect(modeManager.validateAction('execute_command').allowed).toBe(true);
    });

    it('should provide detailed violation info for stage violations', () => {
      modeManager.setStage('edit');
      const result = modeManager.validateAction('execute_command');
      
      expect(result.allowed).toBe(false);
      expect(result.violation?.currentStage).toBe('edit');
      expect(result.violation?.reason).toContain('not permitted in stage');
    });
  });
});

describe('TaskLifecycleController', () => {
  let testDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let controller: TaskLifecycleController;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
    storePath = path.join(testDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    controller = new TaskLifecycleController('task_lifecycle', eventBus);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Phase 1: Intent Intake', () => {
    it('should receive intent and emit intent_received event', async () => {
      await controller.receiveIntent('Test intent', 'MISSION');
      
      const events = eventStore.getAllEvents();
      const intentEvent = events.find(e => e.type === 'intent_received');
      
      expect(intentEvent).toBeDefined();
      expect(intentEvent?.payload.intent).toBe('Test intent');
    });

    it('should set mode and emit mode_set event', async () => {
      await controller.receiveIntent('Test', 'PLAN');
      
      const events = eventStore.getAllEvents();
      const modeEvent = events.find(e => e.type === 'mode_set');
      
      expect(modeEvent).toBeDefined();
      expect(modeEvent?.payload.mode).toBe('PLAN');
      expect(controller.getState().mode).toBe('PLAN');
    });

    it('should transition to running status', async () => {
      await controller.receiveIntent('Test', 'MISSION');
      expect(controller.isRunning()).toBe(true);
    });

    it('should reject intent when not idle', async () => {
      await controller.receiveIntent('Test', 'MISSION');
      
      await expect(
        controller.receiveIntent('Another', 'PLAN')
      ).rejects.toThrow(/Cannot receive intent/);
    });
  });

  describe('Phase 2: Planning', () => {
    beforeEach(async () => {
      await controller.receiveIntent('Test', 'PLAN');
    });

    it('should complete planning and emit plan_created', async () => {
      await controller.completePlanning({ goal: 'test' });
      
      const events = eventStore.getAllEvents();
      const planEvent = events.find(e => e.type === 'plan_created');
      
      expect(planEvent).toBeDefined();
      expect(planEvent?.payload.plan).toEqual({ goal: 'test' });
    });

    it('should complete task when in PLAN mode', async () => {
      await controller.completePlanning({ goal: 'test' });
      expect(controller.isComplete()).toBe(true);
    });

    it('should not complete task when in MISSION mode', async () => {
      // Create new controller in MISSION mode
      const missionController = new TaskLifecycleController('task_mission', eventBus);
      await missionController.receiveIntent('Test', 'MISSION');
      await missionController.completePlanning({ goal: 'test' });
      
      expect(missionController.isComplete()).toBe(false);
      expect(missionController.isRunning()).toBe(true);
    });
  });

  describe('Phase 3: Mission Breakdown', () => {
    beforeEach(async () => {
      await controller.receiveIntent('Test', 'MISSION');
    });

    it('should create breakdown and emit mission_breakdown_created', async () => {
      await controller.createMissionBreakdown(['mission1', 'mission2']);
      
      const events = eventStore.getAllEvents();
      const breakdownEvent = events.find(e => e.type === 'mission_breakdown_created');
      
      expect(breakdownEvent).toBeDefined();
      expect(breakdownEvent?.payload.missions).toEqual(['mission1', 'mission2']);
    });

    it('should pause execution after breakdown', async () => {
      await controller.createMissionBreakdown(['mission1', 'mission2']);
      expect(controller.isPausedState()).toBe(true);
    });

    it('should select mission and emit mission_selected', async () => {
      await controller.createMissionBreakdown(['mission1', 'mission2']);
      await controller.selectMission(1);
      
      const events = eventStore.getAllEvents();
      const selectEvent = events.find(e => e.type === 'mission_selected');
      
      expect(selectEvent).toBeDefined();
      expect(selectEvent?.payload.missionIndex).toBe(1);
    });

    it('should resume execution after mission selection', async () => {
      await controller.createMissionBreakdown(['mission1', 'mission2']);
      await controller.selectMission(0);
      
      expect(controller.isRunning()).toBe(true);
    });
  });

  describe('Phase 4: Stage Changes', () => {
    beforeEach(async () => {
      await controller.receiveIntent('Test', 'MISSION');
    });

    it('should change stage and emit stage_changed', async () => {
      await controller.changeStage('plan');
      
      const events = eventStore.getAllEvents();
      const stageEvent = events.find(e => e.type === 'stage_changed');
      
      expect(stageEvent).toBeDefined();
      expect(stageEvent?.payload.stage).toBe('plan');
      expect(controller.getState().stage).toBe('plan');
    });

    it('should allow multiple stage transitions', async () => {
      await controller.changeStage('plan');
      await controller.changeStage('retrieve');
      await controller.changeStage('edit');
      
      expect(controller.getState().stage).toBe('edit');
      
      const events = eventStore.getEventsByType('stage_changed');
      expect(events).toHaveLength(3);
    });

    it('should reject stage changes in non-MISSION mode', async () => {
      const planController = new TaskLifecycleController('task_plan', eventBus);
      await planController.receiveIntent('Test', 'PLAN');
      
      await expect(
        planController.changeStage('edit')
      ).rejects.toThrow(/only valid in MISSION mode/);
    });

    it('should reject stage changes when not running', async () => {
      await controller.pause();
      
      await expect(
        controller.changeStage('edit')
      ).rejects.toThrow(/Cannot change stage/);
    });
  });

  describe('Phase 5: Completion', () => {
    beforeEach(async () => {
      await controller.receiveIntent('Test', 'MISSION');
    });

    it('should complete and emit final event', async () => {
      await controller.complete();
      
      const events = eventStore.getAllEvents();
      const finalEvent = events.find(e => e.type === 'final');
      
      expect(finalEvent).toBeDefined();
      expect(controller.isComplete()).toBe(true);
    });

    it('should reject completing already complete task', async () => {
      await controller.complete();
      
      await expect(controller.complete()).rejects.toThrow(/already complete/);
    });
  });

  describe('Pause/Resume/Stop', () => {
    beforeEach(async () => {
      await controller.receiveIntent('Test', 'MISSION');
    });

    it('should pause execution and emit execution_paused', async () => {
      await controller.pause();
      
      const events = eventStore.getAllEvents();
      const pauseEvent = events.find(e => e.type === 'execution_paused');
      
      expect(pauseEvent).toBeDefined();
      expect(controller.isPausedState()).toBe(true);
    });

    it('should resume execution and emit execution_resumed', async () => {
      await controller.pause();
      await controller.resume();
      
      const events = eventStore.getAllEvents();
      const resumeEvent = events.find(e => e.type === 'execution_resumed');
      
      expect(resumeEvent).toBeDefined();
      expect(controller.isRunning()).toBe(true);
    });

    it('should stop execution and emit execution_stopped', async () => {
      await controller.stop();
      
      const events = eventStore.getAllEvents();
      const stopEvent = events.find(e => e.type === 'execution_stopped');
      
      expect(stopEvent).toBeDefined();
      expect(controller.getState().status).toBe('idle');
    });

    it('should reject pause when not running', async () => {
      await controller.pause();
      await expect(controller.pause()).rejects.toThrow(/Cannot pause/);
    });

    it('should reject resume when not paused', async () => {
      await expect(controller.resume()).rejects.toThrow(/Cannot resume/);
    });

    it('should reject stop when idle', async () => {
      const idleController = new TaskLifecycleController('task_idle', eventBus);
      await expect(idleController.stop()).rejects.toThrow(/Cannot stop/);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await controller.receiveIntent('Test', 'MISSION');
    });

    it('should report failure and emit failure_detected', async () => {
      const error = new Error('Test error');
      await controller.reportFailure(error);
      
      const events = eventStore.getAllEvents();
      const failureEvent = events.find(e => e.type === 'failure_detected');
      
      expect(failureEvent).toBeDefined();
      expect(failureEvent?.payload.error).toBe('Test error');
      expect(controller.hasError()).toBe(true);
    });

    it('should include evidence in failure event', async () => {
      await controller.reportFailure(new Error('Test'), ['evidence_1', 'evidence_2']);
      
      const events = eventStore.getAllEvents();
      const failureEvent = events.find(e => e.type === 'failure_detected');
      
      expect(failureEvent?.evidence_ids).toEqual(['evidence_1', 'evidence_2']);
    });
  });

  describe('State Management', () => {
    it('should provide accurate lifecycle state', async () => {
      await controller.receiveIntent('Test', 'MISSION');
      await controller.changeStage('edit');
      
      const state = controller.getState();
      
      expect(state.taskId).toBe('task_lifecycle');
      expect(state.mode).toBe('MISSION');
      expect(state.stage).toBe('edit');
      expect(state.status).toBe('running');
      expect(state.canResume).toBe(false);
    });

    it('should indicate canResume when paused', async () => {
      await controller.receiveIntent('Test', 'MISSION');
      await controller.pause();
      
      const state = controller.getState();
      expect(state.canResume).toBe(true);
    });

    it('should provide access to mode manager', () => {
      const modeManager = controller.getModeManager();
      expect(modeManager).toBeInstanceOf(ModeManager);
      expect(modeManager.getMode()).toBe('ANSWER');
    });
  });
});

describe('Integration: Lifecycle + Mode Enforcement', () => {
  let testDir: string;
  let storePath: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let controller: TaskLifecycleController;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
    storePath = path.join(testDir, 'events.jsonl');
    eventStore = new EventStore(storePath);
    eventBus = new EventBus(eventStore);
    controller = new TaskLifecycleController('task_integration', eventBus);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should enforce mode safety throughout lifecycle', async () => {
    const modeManager = controller.getModeManager();
    
    // Start in ANSWER mode - can only read
    expect(modeManager.validateAction('read_file').allowed).toBe(true);
    expect(modeManager.validateAction('write_file').allowed).toBe(false);
    
    // Transition to MISSION mode
    await controller.receiveIntent('Test', 'MISSION');
    expect(modeManager.validateAction('write_file').allowed).toBe(true);
    
    // Enter edit stage
    await controller.changeStage('edit');
    expect(modeManager.validateAction('diff').allowed).toBe(true);
    expect(modeManager.validateAction('execute_command').allowed).toBe(false);
    
    // Enter test stage
    await controller.changeStage('test');
    expect(modeManager.validateAction('execute_command').allowed).toBe(true);
    expect(modeManager.validateAction('write_file').allowed).toBe(false);
  });

  it('should emit mode_violation for illegal actions', async () => {
    await controller.receiveIntent('Test', 'PLAN');
    
    const modeManager = controller.getModeManager();
    const allowed = await modeManager.enforceAction('write_file');
    
    expect(allowed).toBe(false);
    
    const events = eventStore.getAllEvents();
    const violation = events.find(e => e.type === 'mode_violation');
    
    expect(violation).toBeDefined();
    expect(violation?.payload.violation).toBeDefined();
  });

  it('should complete full MISSION lifecycle', async () => {
    await controller.receiveIntent('Build feature', 'MISSION');
    await controller.completePlanning({ steps: ['step1', 'step2'] });
    await controller.changeStage('plan');
    await controller.changeStage('retrieve');
    await controller.changeStage('edit');
    await controller.changeStage('test');
    await controller.complete();
    
    const events = eventStore.getAllEvents();
    
    expect(events.find(e => e.type === 'intent_received')).toBeDefined();
    expect(events.find(e => e.type === 'mode_set')).toBeDefined();
    expect(events.find(e => e.type === 'plan_created')).toBeDefined();
    expect(events.filter(e => e.type === 'stage_changed')).toHaveLength(4);
    expect(events.find(e => e.type === 'final')).toBeDefined();
    
    expect(controller.isComplete()).toBe(true);
  });
});
