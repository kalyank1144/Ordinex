/**
 * Scaffold Handler — extracted from MissionControlViewProvider.
 *
 * Contains all scaffold-related methods:
 *  - handleScaffoldFlow (recipe selection, scaffold apply)
 *  - handlePreflightResolution (apply preflight resolution + retry)
 *  - handlePreflightProceed (post-resolution verification, error handling)
 *  - triggerPostScaffoldVerification (verify recipe & scaffold, emit events)
 *  - handleVerificationRetry (retry failed verification)
 *  - handleVerificationRestore (restore from checkpoint, retry)
 *  - handleVerificationContinue (continue after verification, clean up)
 *  - handleNextStepSelected (post-scaffold cleanup, error recovery routing)
 *
 * All functions take `ctx: IProvider` as first parameter instead of using `this`.
 */

import type { IProvider } from '../handlerContext';
import type {
  Event,
  VerifyRecipeInfo,
  VerifyConfig,
  VerifyEventCtx,
  ProcessStatusEvent,
  ProcessOutputEvent,
} from 'core';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  EventBus,
  ScaffoldFlowCoordinator,
  selectRecipe,
  runPreflightChecksWithEvents,
  emitPreflightResolutionSelected,
  applyResolutions,
  runPostVerificationWithEvents,
  getProcessManager,
  generateProcessId,
  detectProcessType,
} from 'core';

// ---------------------------------------------------------------------------
// handleScaffoldFlow
// ---------------------------------------------------------------------------

/**
 * Routes detected greenfield requests to the ScaffoldFlowCoordinator
 * which handles recipe/design pack selection and project creation.
 */
export async function handleScaffoldFlow(
  ctx: IProvider,
  userPrompt: string,
  taskId: string,
  modelId: string,
  webview: vscode.Webview,
  attachments: any[],
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:ScaffoldFlow]';
  console.log(`${LOG_PREFIX} === SCAFFOLD FLOW START ===`);
  console.log(`${LOG_PREFIX} Prompt:`, userPrompt);
  console.log(`${LOG_PREFIX} Attachments:`, attachments.length);

  try {
    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // Initialize EventBus
    if (!ctx.eventStore) {
      throw new Error('EventStore not initialized');
    }
    const eventBus = new EventBus(ctx.eventStore);

    // Subscribe to events for UI updates
    eventBus.subscribe(async (event) => {
      await ctx.sendEventsToWebview(webview, taskId);
    });

    // Create ScaffoldFlowCoordinator
    const coordinator = new ScaffoldFlowCoordinator(eventBus);
    ctx.activeScaffoldCoordinator = coordinator;

    // Convert attachments to AttachmentInput format for reference context
    const attachmentInputs = attachments.map((a: any) => ({
      id: a.id || a.evidence_id,
      name: a.name,
      mimeType: a.mimeType,
      type: a.type || 'image',
      evidence_id: a.evidence_id,
      data: a.data, // base64 (optional for URL references)
      url: a.url,   // For URL references
    }));

    console.log(`${LOG_PREFIX} Starting scaffold flow...`);

    // Start the scaffold flow
    const state = await coordinator.startScaffoldFlow(
      taskId,
      userPrompt,
      workspaceRoot,
      attachmentInputs.length > 0 ? attachmentInputs : undefined,
      undefined // styleSourceMode - will use default from reference context
    );

    console.log(`${LOG_PREFIX} ✓ Scaffold flow started:`, {
      scaffoldId: state.scaffoldId,
      status: state.status,
      hasReferenceContext: !!state.referenceContext,
    });

    // Send events to webview
    await ctx.sendEventsToWebview(webview, taskId);

    console.log(`${LOG_PREFIX} === SCAFFOLD FLOW INITIALIZED ===`);
    console.log(`${LOG_PREFIX} Awaiting user decision (Proceed/Cancel)...`);

  } catch (error) {
    console.error(`${LOG_PREFIX} Error in scaffold flow:`, error);

    // Emit failure_detected event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'failure_detected',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        error: error instanceof Error ? error.message : 'Unknown error',
        context: 'scaffold_flow_start',
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    vscode.window.showErrorMessage(`Scaffold flow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ---------------------------------------------------------------------------
// handlePreflightResolution
// ---------------------------------------------------------------------------

/**
 * Step 43: Handle preflight resolution selection from webview.
 *
 * Called when user clicks a resolution option in the PreflightCard.
 * Applies the resolution, re-runs checks, and either proceeds or shows updated card.
 */
export async function handlePreflightResolution(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { scaffoldId, checkId, optionId, modifications } = message;
  const LOG_PREFIX = '[Ordinex:Preflight]';

  console.log(`${LOG_PREFIX} Resolution selected:`, { scaffoldId, checkId, optionId });

  if (!ctx.pendingPreflightResult || !ctx.pendingPreflightInput || !ctx.pendingPreflightCtx) {
    console.error(`${LOG_PREFIX} No pending preflight state`);
    return;
  }

  try {
    // Emit the resolution selected event
    emitPreflightResolutionSelected(
      ctx.pendingPreflightCtx,
      checkId,
      optionId,
      modifications?.targetDir,
      modifications?.mergeMode,
      modifications?.monorepoPlacement,
    );

    // Apply the resolution to the input
    const selections: Record<string, string> = { [checkId]: optionId };
    const updatedInput = applyResolutions(
      ctx.pendingPreflightInput,
      ctx.pendingPreflightResult,
      selections
    );

    if (!updatedInput) {
      // User cancelled
      console.log(`${LOG_PREFIX} User cancelled via preflight resolution`);
      ctx.pendingPreflightResult = null;
      ctx.pendingPreflightInput = null;
      ctx.pendingPreflightCtx = null;
      vscode.window.showInformationMessage('Scaffold cancelled.');
      return;
    }

    // Re-run preflight with updated input
    const rerunResult = await runPreflightChecksWithEvents(updatedInput, ctx.pendingPreflightCtx);
    console.log(`${LOG_PREFIX} Re-run result:`, {
      canProceed: rerunResult.canProceed,
      blockers: rerunResult.blockers.length,
    });

    const taskId = ctx.pendingPreflightCtx.runId;
    await ctx.sendEventsToWebview(webview, taskId);

    if (!rerunResult.canProceed) {
      // Still blocked — update stored state and send updated card
      ctx.pendingPreflightResult = rerunResult;
      ctx.pendingPreflightInput = updatedInput;

      webview.postMessage({
        type: 'ordinex:preflightCard',
        payload: {
          scaffold_id: scaffoldId,
          run_id: taskId,
          target_directory: updatedInput.targetDir,
          can_proceed: rerunResult.canProceed,
          checks: rerunResult.checks,
          blockers_count: rerunResult.blockers.length,
          warnings_count: rerunResult.warnings.length,
        },
      });
      return;
    }

    // All clear — proceed (trigger the same flow as preflight_proceed)
    console.log(`${LOG_PREFIX} All blockers resolved, proceeding...`);
    await handlePreflightProceed(ctx, { scaffoldId }, webview);

  } catch (error) {
    console.error(`${LOG_PREFIX} Error handling resolution:`, error);
    vscode.window.showErrorMessage(`Preflight resolution failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// handlePreflightProceed
// ---------------------------------------------------------------------------

/**
 * Step 43: Handle preflight proceed from webview.
 *
 * Called when all preflight checks pass and user clicks "Continue to Scaffold".
 * Clears pending preflight state and triggers recipe selection + apply.
 */
export async function handlePreflightProceed(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:Preflight]';
  console.log(`${LOG_PREFIX} Proceeding after preflight...`);

  // Clean up preflight state
  const preflightInput = ctx.pendingPreflightInput;
  ctx.pendingPreflightResult = null;
  ctx.pendingPreflightInput = null;
  ctx.pendingPreflightCtx = null;

  if (!ctx.currentTaskId || !ctx.eventStore) {
    console.error(`${LOG_PREFIX} No active task or event store`);
    return;
  }

  const taskId = ctx.currentTaskId;
  const targetDir = preflightInput?.targetDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!targetDir) {
    vscode.window.showErrorMessage('No target directory determined');
    return;
  }

  // Emit quality gates passed event
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_quality_gates_passed',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      scaffold_id: message.scaffoldId || ctx.generateId(),
      run_id: taskId,
      gates_passed: 6,
      total_duration_ms: 0,
    },
    evidence_ids: [],
    parent_event_id: null,
  });

  await ctx.sendEventsToWebview(webview, taskId);

  // Now continue with recipe selection and apply (same as existing flow)
  try {
    const events = ctx.eventStore.getEventsByTaskId(taskId);
    const intentEvent = events.find((e: Event) => e.type === 'intent_received');
    const scaffoldPrompt = (intentEvent?.payload.prompt as string) || 'Create a new project';

    const recipeSelection = selectRecipe(scaffoldPrompt);
    console.log(`${LOG_PREFIX} Recipe selected: ${recipeSelection.recipe_id}`);

    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_decision_resolved',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        decision: 'proceed',
        recipe_id: recipeSelection.recipe_id,
        target_directory: targetDir,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    // Emit scaffold_apply_started
    const recipeNames: Record<string, string> = {
      'nextjs_app_router': 'Next.js',
      'vite_react': 'Vite + React',
      'expo': 'Expo',
    };

    const createCmd = recipeSelection.recipe_id === 'nextjs_app_router'
      ? 'npx create-next-app@latest my-app'
      : recipeSelection.recipe_id === 'vite_react'
      ? 'npm create vite@latest my-app -- --template react-ts'
      : 'npx create-expo-app my-app';

    // Emit checkpoint_created event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_checkpoint_created',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        reason: 'pre_scaffold',
        target_directory: targetDir,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_apply_started',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        recipe_id: recipeSelection.recipe_id,
        command: createCmd,
        target_directory: targetDir,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    // V9: Scaffold writes require MISSION mode (prompt escalation)
    if (!await ctx.enforceMissionMode('scaffold_write', taskId)) {
      await ctx.sendEventsToWebview(webview, taskId);
      return;
    }

    // Run scaffold in terminal
    const terminal = vscode.window.createTerminal({
      name: `Scaffold: ${recipeNames[recipeSelection.recipe_id] || 'Project'}`,
      cwd: targetDir,
    });
    terminal.show(true);
    terminal.sendText(createCmd);

    // Emit scaffold_applied
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_applied',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        recipe_id: recipeSelection.recipe_id,
        command: createCmd,
        method: 'vscode_terminal',
        message: 'Scaffold command running in terminal.',
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    vscode.window.showInformationMessage(
      `${recipeNames[recipeSelection.recipe_id] || 'Project'} scaffold started! Follow the terminal prompts.`
    );

    // START POST-SCAFFOLD ORCHESTRATION (same as direct proceed path)
    const scaffoldId = message.scaffoldId || ctx.generateId();

    try {
      const coreModule = await import('core');
      const startPostScaffoldOrchestration = coreModule.startPostScaffoldOrchestration;

      if (typeof startPostScaffoldOrchestration === 'function') {
        const postScaffoldEventBus = new EventBus(ctx.eventStore!);

        // Extract design pack ID from events
        // Priority: scaffold_style_selected (user changed style) > scaffold_proposal_created (default style)
        const scaffoldStyleEvent = events.find((e: Event) => e.type === 'scaffold_style_selected');
        const proposalEvent = events.find((e: Event) => e.type === 'scaffold_proposal_created');
        const designPackIdForPost = (scaffoldStyleEvent?.payload?.pack_id as string)
          || (proposalEvent?.payload?.design_pack_id as string)
          || 'minimal-light';
        console.log(`${LOG_PREFIX} Design pack ID: ${designPackIdForPost}`);

        // Build LLM client using core's factory
        const featureApiKey = await ctx._context.secrets.get('ordinex.apiKey');
        let featureLLMClient: any = undefined;
        if (featureApiKey) {
          try {
            const { createFeatureLLMClient } = coreModule;
            featureLLMClient = await createFeatureLLMClient(featureApiKey);
            if (featureLLMClient) {
              console.log(`${LOG_PREFIX} Feature LLM client created successfully`);
            } else {
              console.warn(`${LOG_PREFIX} createFeatureLLMClient returned null`);
            }
          } catch (llmError) {
            console.warn(`${LOG_PREFIX} Could not create LLM client:`, llmError);
          }
        } else {
          console.warn(`${LOG_PREFIX} No API key (ordinex.apiKey) — feature generation will be skipped`);
        }

        const postScaffoldCtx = {
          taskId: taskId,
          scaffoldId: scaffoldId,
          targetDirectory: targetDir,
          appName: 'my-app',
          recipeId: recipeSelection.recipe_id as any,
          designPackId: designPackIdForPost,
          eventBus: postScaffoldEventBus,
          mode: ctx.currentMode,
          userPrompt: scaffoldPrompt,
          llmClient: featureLLMClient,
        };

        console.log(`${LOG_PREFIX} Starting post-scaffold orchestration with userPrompt: "${scaffoldPrompt}"`);

        // Subscribe to post-scaffold events for UI updates
        postScaffoldEventBus.subscribe(async () => {
          await ctx.sendEventsToWebview(webview, taskId);
        });

        // Fire and forget
        startPostScaffoldOrchestration(postScaffoldCtx).then((result: any) => {
          console.log(`${LOG_PREFIX} Post-scaffold complete:`, result);
          if (result?.projectPath) {
            ctx.scaffoldProjectPath = result.projectPath;
            console.log(`${LOG_PREFIX} Stored scaffoldProjectPath: ${ctx.scaffoldProjectPath}`);
          }
        }).catch((error: any) => {
          console.error(`${LOG_PREFIX} Post-scaffold error:`, error);
        });
      } else {
        console.warn(`${LOG_PREFIX} startPostScaffoldOrchestration not available, falling back to verification`);
        // Fallback to old verification pipeline
        const verifyRecipe: VerifyRecipeInfo = {
          recipeId: recipeSelection.recipe_id,
          recipeName: recipeNames[recipeSelection.recipe_id],
          hasTypeScript: recipeSelection.recipe_id === 'nextjs_app_router' || recipeSelection.recipe_id === 'vite_react',
        };
        ctx.pendingVerifyTargetDir = targetDir;
        ctx.pendingVerifyRecipe = verifyRecipe;
        ctx.pendingVerifyScaffoldId = scaffoldId;
        triggerPostScaffoldVerification(ctx, targetDir, verifyRecipe, scaffoldId, taskId, webview);
      }
    } catch (coreImportError) {
      console.error(`${LOG_PREFIX} Failed to import core module:`, coreImportError);
      // Fallback to verification
      const verifyRecipe: VerifyRecipeInfo = {
        recipeId: recipeSelection.recipe_id,
        recipeName: recipeNames[recipeSelection.recipe_id],
        hasTypeScript: recipeSelection.recipe_id === 'nextjs_app_router' || recipeSelection.recipe_id === 'vite_react',
      };
      ctx.pendingVerifyTargetDir = targetDir;
      ctx.pendingVerifyRecipe = verifyRecipe;
      ctx.pendingVerifyScaffoldId = scaffoldId;
      triggerPostScaffoldVerification(ctx, targetDir, verifyRecipe, scaffoldId, taskId, webview);
    }

  } catch (error) {
    console.error(`${LOG_PREFIX} Error in post-preflight apply:`, error);
    vscode.window.showErrorMessage(`Scaffold failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// triggerPostScaffoldVerification
// ---------------------------------------------------------------------------

/**
 * Step 44: Trigger post-scaffold verification pipeline.
 *
 * Waits for scaffold command to create files (polls for package.json),
 * then runs verification checks and sends results to webview.
 */
export async function triggerPostScaffoldVerification(
  ctx: IProvider,
  targetDir: string,
  recipe: VerifyRecipeInfo,
  scaffoldId: string,
  taskId: string,
  webview: vscode.Webview,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:Verify]';
  console.log(`${LOG_PREFIX} Waiting for scaffold to create files in ${targetDir}...`);

  // Poll for package.json up to 3 minutes (scaffold CLI takes time)
  const maxWaitMs = 180_000;
  const pollIntervalMs = 3_000;
  const startWait = Date.now();
  let found = false;

  while (Date.now() - startWait < maxWaitMs) {
    if (fs.existsSync(path.join(targetDir, 'package.json'))) {
      found = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  if (!found) {
    console.log(`${LOG_PREFIX} package.json not found after ${maxWaitMs / 1000}s, skipping verification`);
    return;
  }

  // Small delay for file system to settle
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(`${LOG_PREFIX} Running post-scaffold verification...`);

  const eventBus = new (require('events').EventEmitter)();
  const events: Event[] = [];
  eventBus.on('event', (e: Event) => {
    events.push(e);
    // Store events as they come in
    if (ctx.eventStore) {
      ctx.eventStore.append(e);
    }
  });

  const verifyCtx: VerifyEventCtx = {
    scaffoldId,
    runId: taskId,
    eventBus,
    mode: ctx.currentMode,
  };

  const config: VerifyConfig = {
    installTimeoutMs: 120_000,
    lintTimeoutMs: 60_000,
    typecheckTimeoutMs: 60_000,
    buildTimeoutMs: 120_000,
    allowBuild: true,
    installMaxRetries: 1,
    replayMode: false,
  };

  try {
    const result = await runPostVerificationWithEvents(targetDir, recipe, config, verifyCtx);

    console.log(`${LOG_PREFIX} Verification complete: ${result.outcome}`);

    // Send verification result to webview
    webview.postMessage({
      type: 'ordinex:verificationCard',
      payload: {
        scaffold_id: scaffoldId,
        run_id: taskId,
        outcome: result.outcome,
        steps: result.steps,
        total_duration_ms: result.totalDurationMs,
        package_manager: result.packageManager,
        from_replay: result.fromReplay,
        allow_continue: result.outcome !== 'fail',
      },
    });

    // Clear verification state on success (but preserve taskId for follow-ups)
    if (result.outcome === 'pass') {
      ctx.currentStage = 'none';
      ctx.pendingVerifyTargetDir = null;
      ctx.pendingVerifyRecipe = null;
      ctx.pendingVerifyScaffoldId = null;
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Verification error:`, error);
  }
}

// ---------------------------------------------------------------------------
// handleVerificationRetry
// ---------------------------------------------------------------------------

/**
 * Step 44: Handle verification retry from webview.
 */
export async function handleVerificationRetry(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:Verify]';
  console.log(`${LOG_PREFIX} Retry requested for scaffold ${message.scaffoldId}`);

  const targetDir = ctx.pendingVerifyTargetDir;
  const recipe = ctx.pendingVerifyRecipe;
  const scaffoldId = ctx.pendingVerifyScaffoldId || message.scaffoldId;
  const taskId = ctx.currentTaskId || ctx.generateId();

  if (!targetDir || !recipe) {
    console.error(`${LOG_PREFIX} No pending verification context for retry`);
    vscode.window.showErrorMessage('Cannot retry verification: no pending context.');
    return;
  }

  await triggerPostScaffoldVerification(ctx, targetDir, recipe, scaffoldId, taskId, webview);
}

// ---------------------------------------------------------------------------
// handleVerificationRestore
// ---------------------------------------------------------------------------

/**
 * Step 44: Handle verification restore (rollback to checkpoint).
 */
export async function handleVerificationRestore(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:Verify]';
  console.log(`${LOG_PREFIX} Restore checkpoint requested for scaffold ${message.scaffoldId}`);

  const taskId = ctx.currentTaskId || ctx.generateId();

  // Emit checkpoint restored event
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_checkpoint_restored',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      scaffold_id: message.scaffoldId,
      reason: 'verification_failed',
      restored_at_iso: new Date().toISOString(),
    },
    evidence_ids: [],
    parent_event_id: null,
  });

  // Clean up state
  ctx.pendingVerifyTargetDir = null;
  ctx.pendingVerifyRecipe = null;
  ctx.pendingVerifyScaffoldId = null;
  ctx.currentTaskId = null;
  ctx.currentStage = 'none';

  vscode.window.showInformationMessage('Scaffold checkpoint restored. You can try again.');
  await ctx.sendEventsToWebview(webview, taskId);
}

// ---------------------------------------------------------------------------
// handleVerificationContinue
// ---------------------------------------------------------------------------

/**
 * Step 44: Handle verification continue anyway.
 */
export async function handleVerificationContinue(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:Verify]';
  console.log(`${LOG_PREFIX} Continue anyway after verification for scaffold ${message.scaffoldId}`);

  const taskId = ctx.currentTaskId || ctx.generateId();

  // Emit final complete event
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_final_complete',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      scaffold_id: message.scaffoldId,
      verification_outcome: 'continued_with_warnings',
      completed_at_iso: new Date().toISOString(),
    },
    evidence_ids: [],
    parent_event_id: null,
  });

  // Clean up verification state (but preserve taskId for follow-ups)
  ctx.pendingVerifyTargetDir = null;
  ctx.pendingVerifyRecipe = null;
  ctx.pendingVerifyScaffoldId = null;
  ctx.currentStage = 'none';

  vscode.window.showInformationMessage('Scaffold complete! Some verification checks had warnings.');
  await ctx.sendEventsToWebview(webview, taskId);
}

// ---------------------------------------------------------------------------
// handleNextStepSelected
// ---------------------------------------------------------------------------

/**
 * Handle next_step_selected message from webview.
 * Routes to the correct action based on the suggestion kind:
 *  - 'command': Run command via ProcessManager (generic — any command in cwd)
 *  - 'browser': Open URL in external browser
 *  - 'task': Emit event for future follow-up feature implementation
 *  - 'info': Just show info message
 */
export async function handleNextStepSelected(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:NextStep]';

  // Normalize snake_case → camelCase (S2 ScaffoldCompleteCard sends snake_case)
  const scaffoldId = message.scaffoldId || message.scaffold_id || '';
  const suggestionId = message.suggestionId || message.step_id || '';
  let kind: string = message.kind || '';
  let suggestion: any = message.suggestion || {};

  // S3: Handle S2 default buttons — step_id shortcuts without explicit kind
  if (!kind && suggestionId === 'dev_server') {
    kind = 'command';
    suggestion = {
      command: message.command || 'npm run dev',
      projectPath: ctx.pendingVerifyTargetDir || '',
    };
  } else if (!kind && suggestionId === 'open_editor') {
    kind = 'editor';
  } else if (!kind && message.command) {
    // Dynamic next steps with command field
    kind = 'command';
    suggestion = { command: message.command, projectPath: ctx.pendingVerifyTargetDir || '' };
  }

  console.log(`${LOG_PREFIX} Action selected: kind=${kind}, suggestionId=${suggestionId}`);

  const taskId = ctx.currentTaskId || ctx.generateId();

  try {
    switch (kind) {
      case 'command': {
        // Run command via ProcessManager (generic — any command in cwd)
        const projectPath = suggestion?.projectPath || suggestion?.target_directory || ctx.pendingVerifyTargetDir;
        if (!projectPath) {
          vscode.window.showWarningMessage('No project path available to run command.');
          return;
        }

        const commandStr = suggestion?.command;
        if (!commandStr) {
          vscode.window.showWarningMessage('No command specified.');
          return;
        }
        console.log(`${LOG_PREFIX} Starting process: ${commandStr} in ${projectPath}`);

        // Emit process_started event
        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'process_started' as any,
          mode: ctx.currentMode,
          stage: ctx.currentStage,
          payload: {
            scaffold_id: scaffoldId,
            command: commandStr,
            project_path: projectPath,
            message: `Starting: ${commandStr}`,
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        await ctx.sendEventsToWebview(webview, taskId);

        // Use ProcessManager to start the process
        const pm = getProcessManager();
        const processId = generateProcessId('devserver');
        const processType = detectProcessType(commandStr);

        // Wire ProcessManager events to Ordinex events
        const statusHandler = async (evt: ProcessStatusEvent) => {
          if (evt.processId !== processId) return;

          if (evt.newStatus === 'ready') {
            console.log(`${LOG_PREFIX} Process ready${evt.port ? ` on port ${evt.port}` : ''}`);
            await ctx.emitEvent({
              event_id: ctx.generateId(),
              task_id: taskId,
              timestamp: new Date().toISOString(),
              type: 'process_ready' as any,
              mode: ctx.currentMode,
              stage: ctx.currentStage,
              payload: {
                scaffold_id: scaffoldId,
                process_id: processId,
                port: evt.port,
                message: `Process ready${evt.port ? ` on http://localhost:${evt.port}` : ''}`,
              },
              evidence_ids: [],
              parent_event_id: null,
            });
            await ctx.sendEventsToWebview(webview, taskId);

            // Auto-open browser if port detected
            if (evt.port) {
              const url = `http://localhost:${evt.port}`;
              const openBrowser = await vscode.window.showInformationMessage(
                `Process ready on port ${evt.port}`,
                'Open in Browser'
              );
              if (openBrowser === 'Open in Browser') {
                await vscode.env.openExternal(vscode.Uri.parse(url));
              }
            }
          } else if (evt.newStatus === 'stopped') {
            // Flush any remaining buffered output before emitting stopped
            if (outputFlushTimer) { clearTimeout(outputFlushTimer); outputFlushTimer = null; }
            await flushOutput();
            await ctx.emitEvent({
              event_id: ctx.generateId(),
              task_id: taskId,
              timestamp: new Date().toISOString(),
              type: 'process_stopped' as any,
              mode: ctx.currentMode,
              stage: ctx.currentStage,
              payload: {
                scaffold_id: scaffoldId,
                process_id: processId,
                exit_code: evt.exitCode,
                message: `Process stopped${evt.exitCode !== undefined ? ` (exit code: ${evt.exitCode})` : ''}`,
              },
              evidence_ids: [],
              parent_event_id: null,
            });
            await ctx.sendEventsToWebview(webview, taskId);
            pm.removeListener('status', statusHandler);
            pm.removeListener('output', outputHandler);
          } else if (evt.newStatus === 'error') {
            // Flush any remaining buffered output before emitting failed
            if (outputFlushTimer) { clearTimeout(outputFlushTimer); outputFlushTimer = null; }
            await flushOutput();
            await ctx.emitEvent({
              event_id: ctx.generateId(),
              task_id: taskId,
              timestamp: new Date().toISOString(),
              type: 'process_failed' as any,
              mode: ctx.currentMode,
              stage: ctx.currentStage,
              payload: {
                scaffold_id: scaffoldId,
                process_id: processId,
                error: evt.error || 'Unknown error',
                message: `Process failed: ${evt.error || 'Unknown'}`,
              },
              evidence_ids: [],
              parent_event_id: null,
            });
            await ctx.sendEventsToWebview(webview, taskId);
            pm.removeListener('status', statusHandler);
            pm.removeListener('output', outputHandler);
          }
        };

        // Debounced output forwarding — batch lines every 500ms to avoid flooding webview
        const MAX_OUTPUT_BUFFER = 50;
        let outputBuffer: string[] = [];
        let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;

        const flushOutput = async () => {
          if (outputBuffer.length === 0) return;
          const lines = outputBuffer.slice(-MAX_OUTPUT_BUFFER);
          outputBuffer = [];
          outputFlushTimer = null;

          await ctx.emitEvent({
            event_id: ctx.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'process_output' as any,
            mode: ctx.currentMode,
            stage: ctx.currentStage,
            payload: {
              scaffold_id: scaffoldId,
              process_id: processId,
              lines,
              line_count: lines.length,
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          await ctx.sendEventsToWebview(webview, taskId);
        };

        const outputHandler = async (evt: ProcessOutputEvent) => {
          if (evt.processId !== processId) return;
          // Buffer lines, cap at MAX_OUTPUT_BUFFER
          const newLines = evt.data.split('\n').filter((l: string) => l.trim());
          outputBuffer.push(...newLines);
          if (outputBuffer.length > MAX_OUTPUT_BUFFER) {
            outputBuffer = outputBuffer.slice(-MAX_OUTPUT_BUFFER);
          }
          // Debounce flush at 500ms
          if (!outputFlushTimer) {
            outputFlushTimer = setTimeout(() => flushOutput(), 500);
          }
        };

        pm.on('status', statusHandler);
        pm.on('output', outputHandler);

        // Parse command into command + args
        const parts = commandStr.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);

        try {
          await pm.startProcess({
            id: processId,
            command: cmd,
            args,
            cwd: projectPath,
            processType,
            timeout: 60000,
            runId: taskId,
          });
          console.log(`${LOG_PREFIX} Process started: ${processId}`);
        } catch (err: any) {
          console.error(`${LOG_PREFIX} Failed to start process:`, err);
          await ctx.emitEvent({
            event_id: ctx.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'process_failed' as any,
            mode: ctx.currentMode,
            stage: ctx.currentStage,
            payload: {
              scaffold_id: scaffoldId,
              process_id: processId,
              error: err.message || 'Failed to start process',
              message: `Failed to start process: ${err.message}`,
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          await ctx.sendEventsToWebview(webview, taskId);
          pm.removeListener('status', statusHandler);
          pm.removeListener('output', outputHandler);
        }
        break;
      }

      case 'browser': {
        // Open in external browser
        const url = suggestion?.url || suggestion?.command || '';
        if (url) {
          console.log(`${LOG_PREFIX} Opening in browser: ${url}`);
          await vscode.env.openExternal(vscode.Uri.parse(url));
        } else {
          vscode.window.showWarningMessage('No URL available to open.');
        }
        break;
      }

      case 'editor': {
        // S3: Open project folder in editor
        const editorPath = suggestion?.projectPath || ctx.pendingVerifyTargetDir;
        if (editorPath) {
          console.log(`${LOG_PREFIX} Opening in editor: ${editorPath}`);
          const uri = vscode.Uri.file(editorPath);
          await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
        } else {
          vscode.window.showWarningMessage('No project path available to open.');
        }
        break;
      }

      case 'task': {
        // Future feature suggestion — emit event and show info
        console.log(`${LOG_PREFIX} Task suggestion selected: ${suggestion?.title || suggestionId}`);
        vscode.window.showInformationMessage(
          `Feature suggestion: ${suggestion?.title || 'Selected'}. This will be available in a future update.`
        );

        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'next_step_selected' as any,
          mode: ctx.currentMode,
          stage: ctx.currentStage,
          payload: {
            scaffold_id: scaffoldId,
            suggestion_id: suggestionId,
            kind,
            title: suggestion?.title || '',
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        break;
      }

      case 'info':
      default: {
        // Just show info
        console.log(`${LOG_PREFIX} Info step selected: ${suggestion?.title || suggestionId}`);
        if (suggestion?.description) {
          vscode.window.showInformationMessage(suggestion.description);
        }
        break;
      }
    }
  } catch (error: any) {
    console.error(`${LOG_PREFIX} Error handling next step:`, error);
    vscode.window.showErrorMessage(`Failed to execute action: ${error.message}`);
  }
}
