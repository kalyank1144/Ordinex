/**
 * Mission Handler -- extracted from MissionControlViewProvider.
 *
 * Contains mission-mode lifecycle methods:
 *   handleConfirmMode, handleExecutePlan, handleSelectMission,
 *   handleStartSelectedMission, handleMissionCompletionSequencing,
 *   handleCancelMission, handleStartAutonomy, handleStopAutonomy.
 *
 * All functions take `ctx: IProvider` as first parameter instead of `this`.
 */

import type { IProvider } from '../handlerContext';
import type {
  Event,
  StructuredPlan,
} from 'core';

import * as vscode from 'vscode';
import * as path from 'path';

import {
  EventBus,
  CheckpointManager,
  ApprovalManager,
  MissionExecutor,
  DiffManager,
  InMemoryEvidenceStore,
  ModeManager,
  AutonomyController,
  DEFAULT_A1_BUDGETS,
  TestRunner,
  FileTestEvidenceStore,
  RepairOrchestrator,
  generateTemplatePlan,
} from 'core';

import { VSCodeWorkspaceWriter } from '../vscodeWorkspaceWriter';
import { VSCodeCheckpointManager } from '../vscodeCheckpointManager';

// ---------------------------------------------------------------------------
// handleConfirmMode
// ---------------------------------------------------------------------------

export async function handleConfirmMode(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { taskId, confirmedMode } = message;

  if (!taskId || !confirmedMode) {
    console.error('Missing required fields in confirmMode');
    return;
  }

  // Emit mode_set with confirmed mode
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'mode_set',
    mode: confirmedMode,
    stage: ctx.currentStage,
    payload: {
      mode: confirmedMode,
      effectiveMode: confirmedMode,
      requiresConfirmation: false,
    },
    evidence_ids: [],
    parent_event_id: null,
  });

  await ctx.setModeWithEvent(confirmedMode, taskId, {
    reason: 'User confirmed mode',
    user_initiated: true,
  });

  // Now generate plan if needed
  if (confirmedMode === 'PLAN' || confirmedMode === 'MISSION') {
    // Get the original prompt from intent_received event
    const events = ctx.eventStore?.getEventsByTaskId(taskId) || [];
    const intentEvent = events.find((e: Event) => e.type === 'intent_received');
    const prompt = intentEvent?.payload.prompt as string || 'Complete the task';

    const plan = generateTemplatePlan(prompt, confirmedMode);

    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'plan_created',
      mode: confirmedMode,
      stage: ctx.currentStage,
      payload: plan as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  // Send updated events to webview
  await ctx.sendEventsToWebview(webview, taskId);
}

// ---------------------------------------------------------------------------
// handleExecutePlan
// ---------------------------------------------------------------------------

export async function handleExecutePlan(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { taskId, planOverride, missionId, emitMissionStarted } = message;

  if (!taskId) {
    console.error('Missing taskId in executePlan');
    return;
  }

  try {
    console.log('[handleExecutePlan] Starting MISSION execution for task:', taskId);

    // Get events to extract the approved plan
    const events = ctx.eventStore?.getEventsByTaskId(taskId) || [];

    // Find the most recent plan (plan_created or plan_revised)
    const planEvents = events.filter((e: Event) =>
      e.type === 'plan_created' || e.type === 'plan_revised'
    );
    const planEvent = planEvents[planEvents.length - 1];

    if (!planEvent && !planOverride) {
      throw new Error('No plan found to execute');
    }

    const plan = (planOverride || planEvent?.payload) as unknown as StructuredPlan;
    if (planOverride) {
      console.log('[handleExecutePlan] Using mission-scoped plan override', {
        missionId,
        steps: plan.steps?.length || 0,
        goal: plan.goal
      });
    } else {
      console.log('[handleExecutePlan] Using latest stored plan event', {
        steps: plan.steps?.length || 0,
        goal: plan.goal
      });
    }
    console.log('[handleExecutePlan] Found plan with', plan.steps?.length || 0, 'steps');

    // Initialize required components
    if (!ctx.eventStore) {
      throw new Error('EventStore not initialized');
    }

    const vsCodeWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!vsCodeWorkspaceRoot) {
      throw new Error('No workspace folder open');
    }

    // Use scaffold project path if available (so mission operates in the scaffolded project dir)
    const workspaceRoot = ctx.scaffoldProjectPath || vsCodeWorkspaceRoot;
    if (ctx.scaffoldProjectPath) {
      console.log(`[handleExecutePlan] Using scaffoldProjectPath as workspace: ${workspaceRoot}`);
    }

    // Get API key for LLM calls
    const apiKey = await ctx._context.secrets.get('ordinex.apiKey');
    if (!apiKey) {
      vscode.window.showErrorMessage('Ordinex API key not configured. Please run "Ordinex: Set API Key" command.');
      throw new Error('No API key configured');
    }

    // Get model ID from intent event or use default
    const intentEvent = events.find((e: Event) => e.type === 'intent_received');
    const modelId = (intentEvent?.payload.model_id as string) || 'claude-3-haiku';

    const eventBus = new EventBus(ctx.eventStore);
    const checkpointDir = path.join(ctx._context.globalStorageUri.fsPath, 'checkpoints');
    const checkpointManager = new CheckpointManager(eventBus, checkpointDir);
    const approvalManager = new ApprovalManager(eventBus);

    // CRITICAL: Store approval manager so handleResolveApproval can use it
    ctx.activeApprovalManager = approvalManager;

    // Subscribe to events from MissionExecutor
    eventBus.subscribe(async (event) => {
      // Events are already persisted by MissionExecutor's eventBus
      // We just need to send updated events to webview in real-time
      await ctx.sendEventsToWebview(webview, taskId);

      // CRITICAL: Handle mission completion to trigger next mission in breakdown
      if (event.type === 'mission_completed') {
        console.log('[handleExecutePlan] mission_completed detected, triggering sequencing logic');
        console.log('[handleExecutePlan] Event payload:', JSON.stringify(event.payload, null, 2));

        // CRITICAL: Clear mission executing flag so next mission can start
        ctx.isMissionExecuting = false;
        ctx.currentExecutingMissionId = null;
        console.log('[handleExecutePlan] Mission execution flag cleared');

        await handleMissionCompletionSequencing(ctx, taskId, webview);
      }
    });

    // Prepare LLM config for edit stage
    // CRITICAL: Use 16384 tokens to avoid truncation on complex file generation
    const llmConfig = {
      apiKey,
      model: modelId,
      maxTokens: 16384  // Increased from 4096 to handle complex files like auth.ts
    };

    // PHASE 6: Create workspace adapters for real file operations
    const workspaceWriter = new VSCodeWorkspaceWriter(workspaceRoot);
    const workspaceCheckpointMgr = new VSCodeCheckpointManager(workspaceRoot);

    // Create MissionExecutor with new required dependencies
    const missionExecutor = new MissionExecutor(
      taskId,
      eventBus,
      checkpointManager,
      approvalManager,
      workspaceRoot,
      llmConfig,
      workspaceWriter,           // Real file writer
      workspaceCheckpointMgr,    // Real checkpoint manager
      null,  // retriever - TODO: wire up later
      null,  // diffManager - TODO: wire up later
      null,  // testRunner - TODO: wire up later
      null   // repairOrchestrator - TODO: wire up later
    );

    console.log('[handleExecutePlan] MissionExecutor created, starting execution...');

    // Execute the plan (runs asynchronously)
    missionExecutor.executePlan(plan, {
      missionId,
      emitMissionStarted
    }).catch(error => {
      console.error('[handleExecutePlan] Mission execution error:', error);
      vscode.window.showErrorMessage(`Mission execution failed: ${error}`);
    });

    console.log('[handleExecutePlan] Mission execution started');

  } catch (error) {
    console.error('Error handling executePlan:', error);

    // Emit failure_detected
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'failure_detected',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        kind: 'execution_start_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);
    vscode.window.showErrorMessage(`Failed to start execution: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleSelectMission
// ---------------------------------------------------------------------------

/**
 * Step 26: Handle mission selection from breakdown
 */
export async function handleSelectMission(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id, mission_id, breakdown_id } = message;
  const LOG_PREFIX = '[Ordinex:MissionBreakdown]';

  if (!task_id || !mission_id) {
    console.error('Missing required fields in selectMission');
    return;
  }

  console.log(`${LOG_PREFIX} Mission selected: ${mission_id}`);

  try {
    // Get events to find the breakdown
    const events = ctx.eventStore?.getEventsByTaskId(task_id) || [];
    const breakdownEvent = events.find((e: Event) => e.type === 'mission_breakdown_created');

    if (!breakdownEvent) {
      console.error('No breakdown found');
      vscode.window.showErrorMessage('Mission breakdown not found. Please try again.');
      return;
    }

    // Emit mission_selected event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'mission_selected',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        mission_id: mission_id,
        breakdown_id: breakdown_id || breakdownEvent.payload.breakdown_id
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Emit execution_paused ready to start mission
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'execution_paused',
      mode: 'MISSION',
      stage: ctx.currentStage,
      payload: {
        reason: 'awaiting_mission_start',
        description: 'Mission selected - ready to start execution'
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, task_id);

    console.log(`${LOG_PREFIX} Mission selection recorded: ${mission_id}`);

  } catch (error) {
    console.error('Error handling selectMission:', error);
    vscode.window.showErrorMessage(`Failed to select mission: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleStartSelectedMission
// ---------------------------------------------------------------------------

/**
 * Step 26: Start execution of the selected mission
 */
export async function handleStartSelectedMission(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id } = message;
  const LOG_PREFIX = '[Ordinex:MissionBreakdown]';

  if (!task_id) {
    console.error('Missing task_id in startSelectedMission');
    return;
  }

  // CRITICAL: Check if mission is already executing (prevent duplicate starts from multiple clicks)
  if (ctx.isMissionExecuting) {
    console.log(`${LOG_PREFIX} Mission already executing, ignoring duplicate start request`);
    vscode.window.showWarningMessage('Mission is already running. Please wait for it to complete.');
    return;
  }

  console.log(`${LOG_PREFIX} Starting selected mission...`);

  try {
    // Get events to find the selected mission
    const events = ctx.eventStore?.getEventsByTaskId(task_id) || [];

    // CRITICAL FIX: Find the LAST mission_selected event, not the first
    // After mission 1 completes, a new mission_selected is emitted for mission 2
    const missionSelectionEvents = events.filter((e: Event) => e.type === 'mission_selected');
    const selectionEvent = missionSelectionEvents[missionSelectionEvents.length - 1];

    const breakdownEvent = events.find((e: Event) => e.type === 'mission_breakdown_created');

    if (!selectionEvent || !breakdownEvent) {
      console.error('No mission selected or breakdown found');
      vscode.window.showErrorMessage('Please select a mission first.');
      return;
    }

    const selectedMissionId = selectionEvent.payload.mission_id as string;
    const missions = breakdownEvent.payload.missions as any[];
    const selectedMission = missions.find(m => m.missionId === selectedMissionId);

    if (!selectedMission) {
      console.error('Selected mission not found in breakdown');
      vscode.window.showErrorMessage('Selected mission not found. Please select again.');
      return;
    }

    console.log(`${LOG_PREFIX} Starting mission: ${selectedMission.title}`);
    console.log(`${LOG_PREFIX} Selected mission ID: ${selectedMissionId}`);

    // Create a filtered plan with only the selected mission's steps
    const planEvents = events.filter((e: Event) =>
      e.type === 'plan_created' || e.type === 'plan_revised'
    );
    const planEvent = planEvents[planEvents.length - 1];

    if (!planEvent) {
      throw new Error('No plan found');
    }

    const fullPlan = planEvent.payload as any;
    const missionStepIds = selectedMission.includedSteps.map((s: any) => s.stepId);

    // Filter steps to only include mission steps
    const missionSteps = fullPlan.steps.filter((step: any, index: number) => {
      const stepId = step.id || step.step_id || `step_${index + 1}`;
      return missionStepIds.includes(stepId);
    });

    // Create mission-scoped plan
    const missionPlan: StructuredPlan = {
      goal: selectedMission.title,
      assumptions: fullPlan.assumptions || [],
      success_criteria: selectedMission.acceptance || [],
      scope_contract: fullPlan.scope_contract || {
        max_files: 10,
        max_lines: 1000,
        allowed_tools: ['read', 'write', 'lint', 'test']
      },
      steps: missionSteps.length > 0 ? missionSteps : fullPlan.steps.slice(0, 3),
      risks: selectedMission.risk?.notes || []
    };
    console.log(`${LOG_PREFIX} Mission plan scoped: steps=${missionPlan.steps.length}, filtered=${missionSteps.length > 0}`);

    // CRITICAL: Set mission executing flag BEFORE starting execution
    ctx.isMissionExecuting = true;
    ctx.currentExecutingMissionId = selectedMissionId;
    console.log(`${LOG_PREFIX} Mission execution flag set, ID: ${selectedMissionId}`);

    // Trigger handleExecutePlan with the mission plan
    // We'll emit the mission_started event and then call executePlan logic
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'mission_started',
      mode: 'MISSION',
      stage: ctx.currentStage,
      payload: {
        mission_id: selectedMissionId,
        goal: selectedMission.title,
        mission_title: selectedMission.title,
        steps_count: missionPlan.steps.length
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // CRITICAL FIX: Send events to webview immediately so UI updates before execution starts
    await ctx.sendEventsToWebview(webview, task_id);
    console.log(`${LOG_PREFIX} mission_started event broadcasted to webview`);

    // Now call the existing execute plan logic
    await handleExecutePlan(
      ctx,
      { taskId: task_id, planOverride: missionPlan, missionId: selectedMissionId, emitMissionStarted: false },
      webview
    );

  } catch (error) {
    console.error('Error handling startSelectedMission:', error);
    vscode.window.showErrorMessage(`Failed to start mission: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleMissionCompletionSequencing
// ---------------------------------------------------------------------------

/**
 * Handle mission completion sequencing - check if there are more missions and trigger next
 */
export async function handleMissionCompletionSequencing(
  ctx: IProvider,
  taskId: string,
  webview: vscode.Webview,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:MissionSequencing]';
  console.log(`${LOG_PREFIX} ========================================`);
  console.log(`${LOG_PREFIX} Mission completed, checking for next mission...`);

  try {
    if (!ctx.eventStore) {
      console.log(`${LOG_PREFIX} No eventStore available`);
      return;
    }

    const events = ctx.eventStore.getEventsByTaskId(taskId);
    console.log(`${LOG_PREFIX} Found ${events.length} total events for task ${taskId}`);

    // Find the breakdown event
    const breakdownEvent = events.find((e: Event) => e.type === 'mission_breakdown_created');
    if (!breakdownEvent) {
      console.log(`${LOG_PREFIX} No breakdown found - single mission, done`);
      return;
    }

    console.log(`${LOG_PREFIX} Found breakdown event`);
    const missions = breakdownEvent.payload.missions as any[];
    const totalMissions = missions.length;
    console.log(`${LOG_PREFIX} Total missions in breakdown: ${totalMissions}`);

    // Find all mission_completed events to see how many are done
    const completedMissionEvents = events.filter((e: Event) => e.type === 'mission_completed');

    // CRITICAL FIX: Count UNIQUE completed missions (prevent duplicates from causing wrong index)
    const completedMissionIds = new Set<string>();
    for (const event of completedMissionEvents) {
      const missionId = event.payload.mission_id as string || event.payload.missionId as string;
      if (missionId) {
        completedMissionIds.add(missionId);
      }
    }

    const completedCount = completedMissionIds.size;
    console.log(`${LOG_PREFIX} Progress: ${completedCount}/${totalMissions} missions completed`);
    console.log(`${LOG_PREFIX} Unique completed mission IDs:`, Array.from(completedMissionIds));

    // CRITICAL FIX: The next mission index = number of completed missions
    // This is reliable because missions are executed in order (0, 1, 2...)
    let nextMissionIndex = completedCount;

    // Safety checks
    if (nextMissionIndex < 0) {
      console.log(`${LOG_PREFIX} Invalid nextMissionIndex (${nextMissionIndex}), defaulting to 0`);
      nextMissionIndex = 0;
    }

    if (nextMissionIndex >= totalMissions) {
      console.log(`${LOG_PREFIX} nextMissionIndex (${nextMissionIndex}) >= totalMissions (${totalMissions})`);
    } else {
      console.log(`${LOG_PREFIX} Next mission index: ${nextMissionIndex} (${nextMissionIndex + 1}/${totalMissions})`);
    }

    if (nextMissionIndex >= totalMissions) {
      // All missions complete!
      console.log(`${LOG_PREFIX} ========================================`);
      console.log(`${LOG_PREFIX} All ${totalMissions} missions completed!`);

      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'final',
        mode: 'MISSION',
        stage: ctx.currentStage,
        payload: {
          success: true,
          total_missions: totalMissions,
          completed_missions: completedCount,
          message: `All ${totalMissions} missions completed successfully`
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await ctx.sendEventsToWebview(webview, taskId);
      vscode.window.showInformationMessage(`All ${totalMissions} missions completed successfully!`);
      return;
    }

    // There's a next mission - auto-select it and pause for user to start
    const nextMission = missions[nextMissionIndex];
    console.log(`${LOG_PREFIX} ========================================`);
    console.log(`${LOG_PREFIX} Next mission available: ${nextMission.title}`);
    console.log(`${LOG_PREFIX} Mission ${nextMissionIndex + 1}/${totalMissions}`);
    console.log(`${LOG_PREFIX} Mission ID: ${nextMission.missionId}`);

    // Emit mission_selected for the next mission
    console.log(`${LOG_PREFIX} Emitting mission_selected event...`);
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'mission_selected',
      mode: 'MISSION',
      stage: ctx.currentStage,
      payload: {
        mission_id: nextMission.missionId,
        breakdown_id: breakdownEvent.payload.breakdown_id,
        mission_index: nextMissionIndex,
        total_missions: totalMissions,
        auto_selected: true,
        previous_mission_completed: true
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    console.log(`${LOG_PREFIX} mission_selected event emitted`);

    console.log(`${LOG_PREFIX} Sending updated events to webview...`);
    await ctx.sendEventsToWebview(webview, taskId);
    console.log(`${LOG_PREFIX} Events sent to webview`);

    // PAUSE: Let user manually start the next mission
    // Emit execution_paused so UI shows "Start" button (not auto-start)
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_paused',
      mode: 'MISSION',
      stage: ctx.currentStage,
      payload: {
        reason: 'awaiting_mission_start',
        description: `Mission ${nextMissionIndex + 1}/${totalMissions} selected - click Start to begin`
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    console.log(`${LOG_PREFIX} Paused - awaiting user to click Start for mission ${nextMissionIndex + 1}/${totalMissions}`);
    console.log(`${LOG_PREFIX} ========================================`);

  } catch (error) {
    console.error(`${LOG_PREFIX} ========================================`);
    console.error(`${LOG_PREFIX} Error handling mission sequencing:`, error);
    console.error(`${LOG_PREFIX} Error stack:`, error instanceof Error ? error.stack : 'N/A');
    console.error(`${LOG_PREFIX} ========================================`);
  }
}

// ---------------------------------------------------------------------------
// handleCancelMission
// ---------------------------------------------------------------------------

/**
 * Step 27: Cancel an active mission
 */
export async function handleCancelMission(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id, reason } = message;
  const LOG_PREFIX = '[Ordinex:MissionRunner]';

  if (!task_id) {
    console.error('Missing task_id in cancelMission');
    return;
  }

  console.log(`${LOG_PREFIX} Cancelling mission...`);

  try {
    // Check if we have an active mission runner
    if (ctx.activeMissionRunner) {
      await ctx.activeMissionRunner.cancelMission(reason || 'user_requested');
      ctx.activeMissionRunner = null;
      console.log(`${LOG_PREFIX} Mission cancelled via MissionRunner`);
    } else {
      // Fallback: emit cancellation event directly
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'mission_cancelled',
        mode: 'MISSION',
        stage: ctx.currentStage,
        payload: {
          reason: reason || 'user_requested',
          cancelled_by: 'user',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      console.log(`${LOG_PREFIX} Mission cancelled via direct event`);
    }

    // Send updated events to webview
    await ctx.sendEventsToWebview(webview, task_id);

  } catch (error) {
    console.error('Error handling cancelMission:', error);
    vscode.window.showErrorMessage(`Failed to cancel mission: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleStartAutonomy
// ---------------------------------------------------------------------------

export async function handleStartAutonomy(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { taskId } = message;

  if (!taskId) {
    console.error('Missing taskId in startAutonomy');
    return;
  }

  try {
    // Verify mode is MISSION
    if (ctx.currentMode !== 'MISSION') {
      vscode.window.showWarningMessage('A1 repair autonomy requires MISSION mode');
      return;
    }

    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // Initialize required components
    if (!ctx.eventStore) {
      throw new Error('EventStore not initialized');
    }

    const eventBus = new EventBus(ctx.eventStore);
    const approvalManager = new ApprovalManager(eventBus);
    const checkpointDir = path.join(ctx._context.globalStorageUri.fsPath, 'checkpoints');
    const checkpointManager = new CheckpointManager(eventBus, checkpointDir);
    const evidenceStore = new InMemoryEvidenceStore();
    const diffManager = new DiffManager(
      taskId,
      eventBus,
      approvalManager,
      checkpointManager,
      evidenceStore,
      workspaceRoot
    );

    const modeManager = new ModeManager(taskId, eventBus);
    const autonomyController = new AutonomyController(
      taskId,
      eventBus,
      checkpointManager,
      modeManager,
      DEFAULT_A1_BUDGETS
    );

    // Set preconditions (for V1, auto-approve to enable autonomy)
    autonomyController.setPlanApproved(true);
    autonomyController.setToolsApproved(true);

    const evidenceDir = path.join(ctx._context.globalStorageUri.fsPath, 'evidence');
    const testEvidenceStore = new FileTestEvidenceStore(evidenceDir);
    const testRunner = new TestRunner(
      taskId,
      eventBus,
      approvalManager,
      testEvidenceStore,
      workspaceRoot
    );

    // Create repair orchestrator
    ctx.repairOrchestrator = new RepairOrchestrator(
      taskId,
      eventBus,
      autonomyController,
      testRunner,
      diffManager,
      approvalManager
    );

    // Subscribe to events from repair loop
    eventBus.subscribe(async (event) => {
      // Persist event to event store
      await ctx.emitEvent(event);
      // Send updated events to webview
      await ctx.sendEventsToWebview(webview, taskId);

      // For V1, auto-approve repair diffs (in future this would wait for user input)
      if (event.type === 'approval_requested') {
        const approvalId = event.payload.approval_id as string;

        // Wait a bit to let the UI update
        setTimeout(async () => {
          try {
            await approvalManager.resolveApproval(
              taskId,
              ctx.currentMode,
              event.stage,
              approvalId,
              'approved',
              'once'
            );
            // Send updated events after approval
            await ctx.sendEventsToWebview(webview, taskId);
          } catch (error) {
            console.error('Error auto-approving repair:', error);
          }
        }, 100);
      }
    });

    // Get last test failure from events
    const events = ctx.eventStore.getEventsByTaskId(taskId);
    const lastFailureEvent = events.filter((e: Event) => e.type === 'failure_detected' && e.payload.kind === 'tests_failed').pop();

    if (lastFailureEvent) {
      // Set last test failure for diagnosis
      ctx.repairOrchestrator.setLastTestFailure({
        command: lastFailureEvent.payload.command as string || 'npm test',
        exit_code: lastFailureEvent.payload.exit_code as number || 1,
        stderr: '',
        stdout: '',
        summary: lastFailureEvent.payload.summary as string || 'Test failure detected',
      });
    }

    // Start repair autonomy (runs async)
    ctx.repairOrchestrator.startRepair(ctx.currentMode).catch(error => {
      console.error('Repair autonomy error:', error);
      vscode.window.showErrorMessage(`Repair failed: ${error}`);
    });

    console.log('A1 repair autonomy started');

  } catch (error) {
    console.error('Error handling startAutonomy:', error);
    vscode.window.showErrorMessage(`Failed to start autonomy: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleStopAutonomy
// ---------------------------------------------------------------------------

export async function handleStopAutonomy(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { taskId } = message;

  if (!taskId) {
    console.error('Missing taskId in stopAutonomy');
    return;
  }

  try {
    if (!ctx.repairOrchestrator) {
      console.log('No active repair orchestrator to stop');
      return;
    }

    // Stop the repair loop
    await ctx.repairOrchestrator.stop(ctx.currentMode);

    // Send updated events to webview
    await ctx.sendEventsToWebview(webview, taskId);

    console.log('A1 repair autonomy stopped');

  } catch (error) {
    console.error('Error handling stopAutonomy:', error);
    vscode.window.showErrorMessage(`Failed to stop autonomy: ${error}`);
  }
}
