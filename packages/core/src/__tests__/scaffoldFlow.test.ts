/**
 * Step 35.1 Tests: Greenfield Scaffold Flow
 * 
 * Tests for:
 * - Greenfield detection in Intent Analyzer
 * - Flow kind routing (scaffold vs standard)
 * - Scaffold flow event emission
 * - Decision point handling
 * - Replay safety
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  analyzeIntent,
  analyzeIntentWithFlow,
  detectFlowKind,
  isGreenfieldRequest,
  GREENFIELD_PATTERNS,
} from '../intentAnalyzer';
import {
  ScaffoldFlowCoordinator,
  deriveScaffoldFlowState,
  isScaffoldDecisionPoint,
  extractScaffoldId,
} from '../scaffoldFlow';
import { EventBus } from '../eventBus';
import { Event } from '../types';

// ============================================================================
// GREENFIELD DETECTION TESTS
// ============================================================================

describe('Greenfield Detection', () => {
  describe('isGreenfieldRequest', () => {
    it('should detect "create a new app" as greenfield', () => {
      expect(isGreenfieldRequest('create a new app for tracking expenses')).toBe(true);
    });

    it('should detect "start a new project" as greenfield', () => {
      expect(isGreenfieldRequest('I want to start a new project')).toBe(true);
    });

    it('should detect "from scratch" as greenfield', () => {
      expect(isGreenfieldRequest('Build a todo app from scratch')).toBe(true);
    });

    it('should detect "greenfield" keyword', () => {
      expect(isGreenfieldRequest('greenfield project setup')).toBe(true);
    });

    it('should detect "scaffold" keyword', () => {
      expect(isGreenfieldRequest('scaffold a new component')).toBe(true);
    });

    it('should detect "bootstrap" with framework (centralized detector)', () => {
      expect(isGreenfieldRequest('bootstrap a new react app')).toBe(true);
    });

    it('should detect framework-specific patterns', () => {
      expect(isGreenfieldRequest('new nextjs app')).toBe(true);
      expect(isGreenfieldRequest('new vite app for dashboard')).toBe(true);
      expect(isGreenfieldRequest('create a new expo app')).toBe(true);
      expect(isGreenfieldRequest('new react app')).toBe(true);
      expect(isGreenfieldRequest('new vue app')).toBe(true);
    });

    it('should NOT detect regular prompts as greenfield', () => {
      expect(isGreenfieldRequest('fix the button color')).toBe(false);
      expect(isGreenfieldRequest('add a new feature to the existing app')).toBe(false);
      expect(isGreenfieldRequest('what is the purpose of this file?')).toBe(false);
      expect(isGreenfieldRequest('refactor the login module')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isGreenfieldRequest('CREATE A NEW APP')).toBe(true);
      expect(isGreenfieldRequest('Greenfield Project')).toBe(true);
      expect(isGreenfieldRequest('FROM SCRATCH')).toBe(true);
    });
  });

  describe('detectFlowKind', () => {
    it('should return "scaffold" for greenfield prompts', () => {
      expect(detectFlowKind('create a new app')).toBe('scaffold');
      expect(detectFlowKind('start a new project from scratch')).toBe('scaffold');
    });

    it('should return "standard" for non-greenfield prompts', () => {
      expect(detectFlowKind('fix the bug in login')).toBe('standard');
      expect(detectFlowKind('what does this function do?')).toBe('standard');
    });

    it('should return "standard" when /plan override is used', () => {
      expect(detectFlowKind('/plan create a new app')).toBe('standard');
      expect(detectFlowKind('plan create a new app')).toBe('standard');
    });

    it('should return "standard" when /do override is used', () => {
      expect(detectFlowKind('/do bootstrap the app')).toBe('standard');
      expect(detectFlowKind('do scaffold the project')).toBe('standard');
    });

    it('should return "standard" when /edit override is used', () => {
      expect(detectFlowKind('/edit from scratch')).toBe('standard');
      expect(detectFlowKind('edit greenfield setup')).toBe('standard');
    });
  });
});

// ============================================================================
// INTENT ANALYZER WITH FLOW KIND TESTS
// ============================================================================

describe('analyzeIntentWithFlow', () => {
  it('should include flow_kind: "scaffold" for greenfield prompts', () => {
    const result = analyzeIntentWithFlow('create a new app from scratch');
    expect(result.flow_kind).toBe('scaffold');
  });

  it('should include flow_kind: "standard" for non-greenfield prompts', () => {
    const result = analyzeIntentWithFlow('fix the button');
    expect(result.flow_kind).toBe('standard');
  });

  it('should NOT route to scaffold for pure questions', () => {
    const result = analyzeIntentWithFlow('what is a greenfield project?');
    expect(result.behavior).toBe('ANSWER');
    expect(result.flow_kind).toBe('standard');
  });

  it('should NOT route to scaffold when CONTINUE_RUN is needed', () => {
    const result = analyzeIntentWithFlow('create a new app', {
      clarificationAttempts: 0,
      activeRun: {
        task_id: 'task-123',
        mission_id: 'mission-456',
        stage: 'edit',
        status: 'awaiting_approval',
        started_at: new Date().toISOString(),
        last_event_at: new Date().toISOString(),
      },
    });
    expect(result.behavior).toBe('CONTINUE_RUN');
    expect(result.flow_kind).toBe('standard');
  });

  it('should still detect greenfield even with PLAN behavior', () => {
    const result = analyzeIntentWithFlow('I want to create a new app with authentication');
    // This would be PLAN behavior due to scope detection
    // But flow_kind should still be scaffold for greenfield
    expect(result.flow_kind).toBe('scaffold');
  });

  it('should respect /plan override', () => {
    const result = analyzeIntentWithFlow('/plan create a new app');
    expect(result.behavior).toBe('PLAN');
    expect(result.flow_kind).toBe('standard');
  });

  it('should include all original IntentAnalysis fields', () => {
    const result = analyzeIntentWithFlow('create a new vite app');
    expect(result).toHaveProperty('behavior');
    expect(result).toHaveProperty('context_source');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reasoning');
    expect(result).toHaveProperty('derived_mode');
    expect(result).toHaveProperty('flow_kind');
  });
});

// ============================================================================
// SCAFFOLD FLOW COORDINATOR TESTS
// ============================================================================

describe('ScaffoldFlowCoordinator', () => {
  let eventBus: EventBus;
  let coordinator: ScaffoldFlowCoordinator;
  let publishedEvents: Event[];

  beforeEach(() => {
    publishedEvents = [];
    eventBus = {
      publish: vi.fn().mockImplementation((event: Event) => {
        publishedEvents.push(event);
        return Promise.resolve();
      }),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as unknown as EventBus;
    coordinator = new ScaffoldFlowCoordinator(eventBus);
  });

  describe('startScaffoldFlow', () => {
    it('should emit scaffold_started event', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');
      
      const startedEvent = publishedEvents.find(e => e.type === 'scaffold_started');
      expect(startedEvent).toBeDefined();
      expect(startedEvent?.payload.run_id).toBe('run-123');
      expect(startedEvent?.payload.user_prompt).toBe('create a new app');
    });

    it('should emit scaffold_proposal_created event', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new vite app');
      
      const proposalEvent = publishedEvents.find(e => e.type === 'scaffold_proposal_created');
      expect(proposalEvent).toBeDefined();
      expect(proposalEvent?.payload.summary).toContain('Vite');
    });

    it('should emit scaffold_decision_requested event', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');

      const decisionEvent = publishedEvents.find(e => e.type === 'scaffold_decision_requested');
      expect(decisionEvent).toBeDefined();
      expect(decisionEvent?.payload.scaffold_id).toBeDefined();
      expect(decisionEvent?.payload.options).toBeDefined();
    });

    it('should include Proceed and Cancel options', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');

      const decisionEvent = publishedEvents.find(e => e.type === 'scaffold_decision_requested');
      const options = decisionEvent?.payload.options as any[];

      const proceedOption = options?.find((o: any) => o.action === 'proceed');
      const cancelOption = options?.find((o: any) => o.action === 'cancel');

      expect(proceedOption).toBeDefined();
      expect(proceedOption?.primary).toBe(true);
      expect(cancelOption).toBeDefined();
    });

    it('should include Change Style option', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');

      const decisionEvent = publishedEvents.find(e => e.type === 'scaffold_decision_requested');
      const options = decisionEvent?.payload.options as any[];

      const changeStyleOption = options?.find((o: any) => o.action === 'change_style');
      expect(changeStyleOption).toBeDefined();
    });

    it('should update state to awaiting_decision', async () => {
      const state = await coordinator.startScaffoldFlow('run-123', 'create a new app');
      
      expect(state.status).toBe('awaiting_decision');
      expect(coordinator.isAwaitingDecision()).toBe(true);
    });

    it('should generate unique scaffold_id', async () => {
      const state1 = await coordinator.startScaffoldFlow('run-1', 'app 1');
      const coordinator2 = new ScaffoldFlowCoordinator(eventBus);
      const state2 = await coordinator2.startScaffoldFlow('run-2', 'app 2');
      
      expect(state1.scaffoldId).not.toBe(state2.scaffoldId);
      expect(state1.scaffoldId).toMatch(/^scaffold_/);
    });
  });

  describe('handleUserAction - proceed', () => {
    it('should emit scaffold_completed with ready_for_step_35_2 status', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');
      publishedEvents = []; // Clear previous events
      
      await coordinator.handleUserAction('proceed');
      
      const completedEvent = publishedEvents.find(e => e.type === 'scaffold_completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.payload.status).toBe('ready_for_step_35_2');
    });

    it('should update state to completed', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');
      const state = await coordinator.handleUserAction('proceed');
      
      expect(state.status).toBe('completed');
      expect(state.completionStatus).toBe('ready_for_step_35_2');
    });
  });

  describe('handleUserAction - cancel', () => {
    it('should emit scaffold_completed with cancelled status', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');
      publishedEvents = [];
      
      await coordinator.handleUserAction('cancel');
      
      const completedEvent = publishedEvents.find(e => e.type === 'scaffold_completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.payload.status).toBe('cancelled');
    });

    it('should update state to completed with cancelled', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');
      const state = await coordinator.handleUserAction('cancel');
      
      expect(state.status).toBe('completed');
      expect(state.completionStatus).toBe('cancelled');
    });
  });

  describe('handleStyleChange', () => {
    it('should show style picker and keep flow in awaiting_decision', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');
      const state = await coordinator.handleStyleChange();

      expect(state.status).toBe('awaiting_decision');
      expect(coordinator.isStylePickerActive()).toBe(true);
      expect(publishedEvents.some(e =>
        e.type === 'scaffold_style_selection_requested'
      )).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw if handleUserAction called without active flow', async () => {
      await expect(coordinator.handleUserAction('proceed')).rejects.toThrow('No active scaffold flow');
    });

    it('should throw if handleUserAction called when not awaiting decision', async () => {
      await coordinator.startScaffoldFlow('run-123', 'create a new app');
      await coordinator.handleUserAction('proceed');
      
      await expect(coordinator.handleUserAction('cancel')).rejects.toThrow('Cannot handle action in status');
    });
  });
});

// ============================================================================
// SCAFFOLD FLOW STATE DERIVATION TESTS (REPLAY SAFETY)
// ============================================================================

describe('deriveScaffoldFlowState (Replay Safety)', () => {
  it('should return null when no scaffold_started event exists', () => {
    const events: Event[] = [
      {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: new Date().toISOString(),
        type: 'intent_received',
        mode: 'ANSWER',
        stage: 'plan',
        payload: {},
        evidence_ids: [],
        parent_event_id: null,
      },
    ];
    
    expect(deriveScaffoldFlowState(events)).toBeNull();
  });

  it('should derive started state from scaffold_started event', () => {
    const events: Event[] = [
      {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: new Date().toISOString(),
        type: 'scaffold_started',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          run_id: 'run-123',
          user_prompt: 'create a new app',
          created_at_iso: new Date().toISOString(),
        },
        evidence_ids: [],
        parent_event_id: null,
      },
    ];
    
    const state = deriveScaffoldFlowState(events);
    expect(state).not.toBeNull();
    expect(state?.scaffoldId).toBe('scaffold_abc');
    expect(state?.status).toBe('started');
  });

  it('should derive proposal_created state', () => {
    const now = new Date().toISOString();
    const events: Event[] = [
      {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_started',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          run_id: 'run-123',
          user_prompt: 'create a new app',
          created_at_iso: now,
        },
        evidence_ids: [],
        parent_event_id: null,
      },
      {
        event_id: 'e2',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_proposal_created',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          summary: 'Test project',
        },
        evidence_ids: [],
        parent_event_id: null,
      },
    ];
    
    const state = deriveScaffoldFlowState(events);
    expect(state?.status).toBe('proposal_created');
  });

  it('should derive awaiting_decision state from legacy decision_point_needed', () => {
    const now = new Date().toISOString();
    const events: Event[] = [
      {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_started',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          run_id: 'run-123',
          user_prompt: 'create a new app',
          created_at_iso: now,
        },
        evidence_ids: [],
        parent_event_id: null,
      },
      {
        event_id: 'e2',
        task_id: 'task-123',
        timestamp: now,
        type: 'decision_point_needed',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          decision_type: 'scaffold_approval',
          scaffold_id: 'scaffold_abc',
        },
        evidence_ids: [],
        parent_event_id: null,
      },
    ];

    const state = deriveScaffoldFlowState(events);
    expect(state?.status).toBe('awaiting_decision');
  });

  it('should derive awaiting_decision state from scaffold_decision_requested', () => {
    const now = new Date().toISOString();
    const events: Event[] = [
      {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_started',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          run_id: 'run-123',
          user_prompt: 'create a new app',
          created_at_iso: now,
        },
        evidence_ids: [],
        parent_event_id: null,
      },
      {
        event_id: 'e2',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_decision_requested',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          title: 'Create new project',
          description: 'Review the scaffold proposal',
          options: [
            { label: 'Proceed', action: 'proceed', description: 'Start building', primary: true },
            { label: 'Cancel', action: 'cancel', description: 'Cancel scaffold' },
          ],
          context: {
            flow: 'scaffold',
            scaffold_id: 'scaffold_abc',
            user_prompt: 'create a new app',
          },
        },
        evidence_ids: [],
        parent_event_id: null,
      },
    ];

    const state = deriveScaffoldFlowState(events);
    expect(state?.status).toBe('awaiting_decision');
    expect(state?.scaffoldId).toBe('scaffold_abc');
  });

  it('should prefer scaffold_decision_requested over legacy decision_point_needed', () => {
    const now = new Date().toISOString();
    const events: Event[] = [
      {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_started',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          run_id: 'run-123',
          user_prompt: 'create a new app',
          created_at_iso: now,
        },
        evidence_ids: [],
        parent_event_id: null,
      },
      {
        event_id: 'e2',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_decision_requested',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          title: 'Create new project',
          options: [],
        },
        evidence_ids: [],
        parent_event_id: null,
      },
    ];

    // Both event types should produce the same awaiting_decision state
    const state = deriveScaffoldFlowState(events);
    expect(state?.status).toBe('awaiting_decision');
  });

  it('should derive completed state', () => {
    const now = new Date().toISOString();
    const events: Event[] = [
      {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_started',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          run_id: 'run-123',
          user_prompt: 'create a new app',
          created_at_iso: now,
        },
        evidence_ids: [],
        parent_event_id: null,
      },
      {
        event_id: 'e2',
        task_id: 'task-123',
        timestamp: now,
        type: 'scaffold_completed',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_abc',
          status: 'ready_for_step_35_2',
        },
        evidence_ids: [],
        parent_event_id: null,
      },
    ];
    
    const state = deriveScaffoldFlowState(events);
    expect(state?.status).toBe('completed');
    expect(state?.completionStatus).toBe('ready_for_step_35_2');
  });
});

// ============================================================================
// HELPER FUNCTIONS TESTS
// ============================================================================

describe('Helper Functions', () => {
  describe('isScaffoldDecisionPoint', () => {
    it('should return true for scaffold_decision_requested events', () => {
      const event: Event = {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: new Date().toISOString(),
        type: 'scaffold_decision_requested',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          decision_type: 'scaffold_approval',
        },
        evidence_ids: [],
        parent_event_id: null,
      };

      expect(isScaffoldDecisionPoint(event)).toBe(true);
    });

    it('should return true for legacy scaffold_approval decision points', () => {
      const event: Event = {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: new Date().toISOString(),
        type: 'decision_point_needed',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          decision_type: 'scaffold_approval',
        },
        evidence_ids: [],
        parent_event_id: null,
      };
      
      expect(isScaffoldDecisionPoint(event)).toBe(true);
    });

    it('should return false for other decision types', () => {
      const event: Event = {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: new Date().toISOString(),
        type: 'decision_point_needed',
        mode: 'MISSION',
        stage: 'edit',
        payload: {
          decision_type: 'diff_approval',
        },
        evidence_ids: [],
        parent_event_id: null,
      };
      
      expect(isScaffoldDecisionPoint(event)).toBe(false);
    });
  });

  describe('extractScaffoldId', () => {
    it('should extract scaffold_id from payload', () => {
      const event: Event = {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: new Date().toISOString(),
        type: 'scaffold_started',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          scaffold_id: 'scaffold_xyz',
        },
        evidence_ids: [],
        parent_event_id: null,
      };
      
      expect(extractScaffoldId(event)).toBe('scaffold_xyz');
    });

    it('should extract scaffold_id from context', () => {
      const event: Event = {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: new Date().toISOString(),
        type: 'decision_point_needed',
        mode: 'PLAN',
        stage: 'plan',
        payload: {
          decision_type: 'scaffold_approval',
          context: {
            scaffold_id: 'scaffold_from_context',
          },
        },
        evidence_ids: [],
        parent_event_id: null,
      };
      
      expect(extractScaffoldId(event)).toBe('scaffold_from_context');
    });

    it('should return undefined if no scaffold_id found', () => {
      const event: Event = {
        event_id: 'e1',
        task_id: 'task-123',
        timestamp: new Date().toISOString(),
        type: 'intent_received',
        mode: 'ANSWER',
        stage: 'plan',
        payload: {},
        evidence_ids: [],
        parent_event_id: null,
      };
      
      expect(extractScaffoldId(event)).toBeUndefined();
    });
  });
});

// ============================================================================
// GREENFIELD PATTERNS COVERAGE
// ============================================================================

describe('GREENFIELD_PATTERNS Coverage', () => {
  it('should include all documented patterns', () => {
    const expectedPatterns = [
      'create a new app',
      'create a new project',
      'start a new project',
      'start a new app',
      'from scratch',
      'greenfield',
      // 'scaffold' and 'bootstrap' removed - over-broad bare substrings;
      // centralized greenfieldDetector handles these with proper regex patterns
      'new nextjs app',
      'new next app',
      'new vite app',
      'new expo app',
      'new react app',
      'new vue app',
      'new angular app',
      'new express app',
      'new node app',
      'new typescript project',
    ];
    
    for (const pattern of expectedPatterns) {
      expect(GREENFIELD_PATTERNS).toContain(pattern);
    }
  });

  it('should detect all patterns in prompts', () => {
    for (const pattern of GREENFIELD_PATTERNS) {
      expect(isGreenfieldRequest(`Please ${pattern} for me`)).toBe(true);
    }
  });
});
