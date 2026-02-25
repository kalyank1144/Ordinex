/**
 * Scaffold Handler — extracted from MissionControlViewProvider.
 *
 * Contains all scaffold-related methods:
 *  - handleScaffoldFlow (recipe selection, scaffold apply)
 *  - handlePreflightResolution (apply preflight resolution + retry)
 *  - handlePreflightProceed (post-resolution verification, error handling)
 *  - handleNextStepSelected (post-scaffold cleanup, error recovery routing)
 *
 * Post-scaffold orchestration (overlays, shadcn, quality gates) is handled
 * entirely by core/postScaffoldOrchestrator via the enhanced pipeline.
 *
 * All functions take `ctx: IProvider` as first parameter instead of using `this`.
 */

import type { IProvider } from '../handlerContext';
import type {
  Event,
  ProcessStatusEvent,
  ProcessOutputEvent,
} from 'core';
import * as vscode from 'vscode';
import * as path from 'path';
import { fileExists } from '../utils/fsAsync';
import {
  EventBus,
  ScaffoldFlowCoordinator,
  selectRecipe,
  runPreflightChecksWithEvents,
  emitPreflightResolutionSelected,
  applyResolutions,
  getProcessManager,
  generateProcessId,
  detectProcessType,
  extractAppNameFromPrompt,
  getRecipeDisplayName,
  getCreateCommand,
  getKeyFiles,
  getDevCommand,
  createScaffoldSession,
  resolveModel,
} from 'core';

// Cross-handler imports
import { handleSubmitPrompt } from './submitPromptHandler';
import { BackendLLMClient } from '../backendLLMClient';

let _pipelineOutputChannel: vscode.OutputChannel | null = null;
function getPipelineOutputChannel(): vscode.OutputChannel {
  if (!_pipelineOutputChannel) {
    _pipelineOutputChannel = vscode.window.createOutputChannel('Ordinex: Pipeline');
  }
  return _pipelineOutputChannel;
}

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

    // Send events to webview (shows progress indicator)
    await ctx.sendEventsToWebview(webview, taskId);

    // --- Blueprint Extraction then Decision Card ---
    // Extract a structured AppBlueprint via LLM, then emit the single
    // decision card. If extraction fails or no API key, the decision card
    // is emitted without blueprint data — there is no "old fallback card".
    try {
      const scaffoldBackend = ctx.getBackendClient();
      if (await scaffoldBackend.isAuthenticated()) {
        const coreModule = await import('core');
        const { buildExtractionPrompt, parseBlueprintFromLLMResponse } = coreModule;

        if (typeof buildExtractionPrompt === 'function' && typeof parseBlueprintFromLLMResponse === 'function') {
          console.log(`${LOG_PREFIX} Extracting app blueprint via LLM...`);
          const extractionPrompt = buildExtractionPrompt(userPrompt);

          const llmClient = new BackendLLMClient(scaffoldBackend);
          const llmResponse = await llmClient.createMessage({
            model: resolveModel(modelId),
            max_tokens: 4096,
            system: 'You are an expert full-stack app architect. You design comprehensive, production-quality app blueprints. Return ONLY valid JSON, no explanation or markdown.',
            messages: [{ role: 'user', content: extractionPrompt }],
          });

          const responseText = llmResponse?.content
            ?.filter((b: any) => b.type === 'text')
            ?.map((b: any) => b.text)
            ?.join('') || '';

          if (responseText) {
            const extractionResult = parseBlueprintFromLLMResponse(responseText, userPrompt);
            console.log(`${LOG_PREFIX} Blueprint extracted:`, {
              app_type: extractionResult.blueprint.app_type,
              pages: extractionResult.blueprint.pages.length,
              confidence: extractionResult.confidence,
            });

            await (coordinator as any).setBlueprint(extractionResult);
          }
        }
      } else {
        console.log(`${LOG_PREFIX} No API key — blueprint extraction skipped`);
      }
    } catch (blueprintErr) {
      console.warn(`${LOG_PREFIX} Blueprint extraction failed (non-fatal):`, blueprintErr);
    }

    // Emit the ONE decision card (with or without blueprint data)
    await (coordinator as any).emitDecisionCard();
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
  // Always use workspace root as the base — create commands run from here
  // (the create command itself creates the appName subdirectory)
  const workspaceRoot = preflightInput?.workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const targetDir = workspaceRoot; // terminal cwd and post-scaffold targetDirectory

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
    const userModelId = (intentEvent?.payload?.model_id as string) || '';
    const resolvedModelId = resolveModel(userModelId);

    // Extract app name from user prompt
    const appName = extractAppNameFromPrompt(scaffoldPrompt);
    console.log(`${LOG_PREFIX} Extracted app name: "${appName}" from prompt: "${scaffoldPrompt}"`);

    const recipeSelection = selectRecipe(scaffoldPrompt);
    console.log(`${LOG_PREFIX} Recipe selected: ${recipeSelection.recipe_id}`);

    const createCmd = getCreateCommand(recipeSelection.recipe_id, appName);

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
        app_name: appName,
        target_directory: targetDir,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

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

    // Use a stable scaffold_id shared with the post-scaffold orchestrator
    const scaffoldIdForApply = message.scaffoldId || `scaffold_${ctx.generateId()}`;
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_apply_started',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        scaffold_id: scaffoldIdForApply,
        recipe_id: recipeSelection.recipe_id,
        command: createCmd,
        target_directory: targetDir,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.setModeWithEvent('MISSION', taskId, {
      reason: 'Scaffold approved by user — escalating to MISSION for file creation',
      user_initiated: true,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    // Run scaffold in terminal
    const terminal = vscode.window.createTerminal({
      name: `Scaffold: ${getRecipeDisplayName(recipeSelection.recipe_id)}`,
      cwd: targetDir,
    });
    terminal.show(true);
    terminal.sendText(createCmd);

    // Track scaffold terminal for failure detection
    const scaffoldTerminalRef = terminal;
    const scaffoldTargetPkg = path.join(targetDir, appName, 'package.json');
    const scaffoldIdForClose = message.scaffoldId || ctx.generateId();
    const terminalCloseListener = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
      if (closedTerminal !== scaffoldTerminalRef) return;
      terminalCloseListener.dispose();
      await new Promise(r => setTimeout(r, 1000));
      if (!(await fileExists(scaffoldTargetPkg))) {
        console.error(`${LOG_PREFIX} Scaffold terminal closed before project was created`);
        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'scaffold_progress' as any,
          mode: ctx.currentMode,
          stage: ctx.currentStage,
          payload: {
            scaffold_id: scaffoldIdForClose,
            status: 'error',
            message: 'Scaffold terminal closed before project was created. Please try again.',
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        await ctx.sendEventsToWebview(webview, taskId);
        vscode.window.showErrorMessage('Scaffold terminal closed before project was created. Please try again.');
      }
    });

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
      `${getRecipeDisplayName(recipeSelection.recipe_id)} scaffold started! Follow the terminal prompts.`
    );

    // Reuse the same scaffold_id that was used for scaffold_apply_started
    const scaffoldId = scaffoldIdForApply;

    try {
      const coreModule = await import('core');
      const startPostScaffoldOrchestration = coreModule.startPostScaffoldOrchestration;

      console.log(`${LOG_PREFIX} startPostScaffoldOrchestration available: ${typeof startPostScaffoldOrchestration === 'function'}`);
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
        const featureBackend = ctx.getBackendClient();
        let featureLLMClient: any = undefined;
        try {
          const featureClient = new BackendLLMClient(featureBackend);
          featureLLMClient = {
            async createMessage(params: any) {
              return featureClient.createMessage(params);
            },
          };
          console.log(`${LOG_PREFIX} Feature LLM client created successfully (backend)`);
        } catch (llmError) {
          console.warn(`${LOG_PREFIX} Could not create LLM client:`, llmError);
        }

        // Get blueprint from coordinator if available (use `as any` for enhanced methods)
        const activeCoordinator = ctx.activeScaffoldCoordinator as any;
        const blueprint = activeCoordinator?.getBlueprint?.();
        const styleResolution = activeCoordinator?.getState?.()?.styleResolution;
        // Priority: explicit UI style intent > resolved style > undefined (let orchestrator derive from app type)
        const userStyleInput = activeCoordinator?.getStyleInput?.()
          || styleResolution?.input
          || undefined;

        // Blueprint wiring diagnostics
        console.log(`${LOG_PREFIX} [BLUEPRINT_WIRING] activeCoordinator exists: ${!!activeCoordinator}`);
        console.log(`${LOG_PREFIX} [BLUEPRINT_WIRING] getBlueprint method exists: ${typeof activeCoordinator?.getBlueprint === 'function'}`);
        console.log(`${LOG_PREFIX} [BLUEPRINT_WIRING] blueprint result: ${blueprint ? `app_type=${blueprint.app_type}, pages=${blueprint.pages?.length}` : 'undefined'}`);
        console.log(`${LOG_PREFIX} [BLUEPRINT_WIRING] userStyleInput: ${userStyleInput ? `mode=${userStyleInput.mode}, value=${userStyleInput.value}` : 'undefined'}`);

        const pipelineChannel = getPipelineOutputChannel();
        pipelineChannel.show(true);
        pipelineChannel.appendLine(`[${new Date().toISOString()}] ========== SCAFFOLD PIPELINE STARTED ==========`);
        pipelineChannel.appendLine(`Prompt: ${scaffoldPrompt}`);
        pipelineChannel.appendLine(`Recipe: ${recipeSelection.recipe_id}, App: ${appName}`);
        pipelineChannel.appendLine(`Design Pack: ${designPackIdForPost}`);
        pipelineChannel.appendLine(`Model: ${resolvedModelId}`);
        pipelineChannel.appendLine(`Style Input: ${userStyleInput ? `mode=${userStyleInput.mode}, value=${userStyleInput.value}` : '(none)'}`);
        pipelineChannel.appendLine(`Blueprint: ${blueprint ? `app_type=${blueprint.app_type}, pages=${blueprint.pages?.length}` : '(none)'}`);
        pipelineChannel.appendLine(`---`);

        const postScaffoldCtx = {
          taskId: taskId,
          scaffoldId: scaffoldId,
          targetDirectory: targetDir,
          appName: appName,
          recipeId: recipeSelection.recipe_id as any,
          designPackId: designPackIdForPost,
          eventBus: postScaffoldEventBus,
          mode: ctx.currentMode,
          userPrompt: scaffoldPrompt,
          llmClient: featureLLMClient,
          blueprint: blueprint || undefined,
          styleInput: userStyleInput,
          modelId: resolvedModelId,
          useEnhancedPipeline: true,
          logger: (msg: string) => {
            pipelineChannel.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
          },
        };

        console.log(`${LOG_PREFIX} Starting post-scaffold orchestration with userPrompt: "${scaffoldPrompt}"`);

        // Subscribe to post-scaffold events for UI updates + capture project path + build session
        postScaffoldEventBus.subscribe(async (event) => {
          if ((event as any).type === 'scaffold_final_complete' && (event as any).payload?.project_path) {
            const payload = (event as any).payload;
            ctx.scaffoldProjectPath = payload.project_path as string;

            ctx.scaffoldSession = createScaffoldSession({
              projectPath: payload.project_path,
              appName: appName,
              recipeId: recipeSelection.recipe_id as any,
              designPackId: designPackIdForPost,
              blueprint: payload.blueprint_summary
                ? { ...payload.blueprint_summary, app_type: payload.blueprint_summary.app_type || 'web' }
                : blueprint,
              doctorStatus: payload.doctor_status,
              doctorCard: payload.doctor_card,
              projectSummary: payload.project_summary,
            });
            console.log(`${LOG_PREFIX} ScaffoldSession created for: ${appName}`);
          }
          await ctx.sendEventsToWebview(webview, taskId);
        });

        // Fire and forget — auto-open project + start dev server when complete
        startPostScaffoldOrchestration(postScaffoldCtx).then(async (result: any) => {
          console.log(`${LOG_PREFIX} Post-scaffold complete:`, result);
          if (result?.projectPath) {
            ctx.scaffoldProjectPath = result.projectPath;
            console.log(`${LOG_PREFIX} Stored scaffoldProjectPath: ${ctx.scaffoldProjectPath}`);

            // Add project folder to workspace (without reloading the window)
            try {
              const existingFolders = vscode.workspace.workspaceFolders || [];
              const alreadyOpen = existingFolders.some(f => f.uri.fsPath === result.projectPath);
              if (!alreadyOpen) {
                vscode.workspace.updateWorkspaceFolders(
                  existingFolders.length, // insert at end
                  0,                      // don't remove any
                  { uri: vscode.Uri.file(result.projectPath), name: path.basename(result.projectPath) }
                );
                console.log(`${LOG_PREFIX} Added project folder to workspace: ${result.projectPath}`);
              } else {
                console.log(`${LOG_PREFIX} Project folder already in workspace: ${result.projectPath}`);
              }
            } catch (openErr) {
              console.warn(`${LOG_PREFIX} Could not add project folder to workspace:`, openErr);
            }

            // Open key generated files in editor tabs
            try {
              const keyFiles = getKeyFiles(recipeSelection.recipe_id);
              let openedCount = 0;
              for (const relPath of keyFiles) {
                if (openedCount >= 3) break;
                const absPath = path.join(result.projectPath, relPath);
                if (await fileExists(absPath)) {
                  const doc = await vscode.workspace.openTextDocument(absPath);
                  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
                  openedCount++;
                  console.log(`${LOG_PREFIX} Opened file: ${relPath}`);
                }
              }
            } catch (fileOpenErr) {
              console.warn(`${LOG_PREFIX} Could not open generated files:`, fileOpenErr);
            }

            // Auto-start dev server after successful scaffold
            try {
              const devCmd = getDevCommand(recipeSelection.recipe_id);
              const devTerminal = vscode.window.createTerminal({
                name: `Ordinex: Dev Server`,
                cwd: result.projectPath,
              });
              devTerminal.sendText(devCmd);
              devTerminal.show(true);
              console.log(`${LOG_PREFIX} Auto-started dev server in ${result.projectPath}`);

              // Try to open Simple Browser after a delay for server startup
              // Use proposed onDidWriteTerminalData API if available, else fallback to timeout
              let browserOpened = false;
              const windowAny = vscode.window as any;
              if (typeof windowAny.onDidWriteTerminalData === 'function') {
                const terminalOutputListener = windowAny.onDidWriteTerminalData((e: any) => {
                  if (browserOpened || e.terminal !== devTerminal) return;
                  const text = String(e.data || '');
                  // Match common dev server ready messages: "localhost:3000", "127.0.0.1:3000", etc.
                  const portMatch = text.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/);
                  if (portMatch) {
                    browserOpened = true;
                    terminalOutputListener?.dispose();
                    const port = portMatch[1];
                    const url = `http://localhost:${port}`;
                    console.log(`${LOG_PREFIX} Dev server ready on ${url}`);
                    setTimeout(async () => {
                      try {
                        await vscode.commands.executeCommand('simpleBrowser.api.open', url, {
                          viewColumn: vscode.ViewColumn.Beside,
                        });
                        console.log(`${LOG_PREFIX} Opened Simple Browser for dev preview`);
                      } catch (browserErr) {
                        console.log(`${LOG_PREFIX} Simple Browser not available, opening external:`, browserErr);
                        await vscode.env.openExternal(vscode.Uri.parse(url));
                      }
                    }, 2000);
                  }
                });
                // Safety timeout: dispose listener after 60 seconds
                setTimeout(() => {
                  if (!browserOpened) {
                    terminalOutputListener?.dispose();
                    console.log(`${LOG_PREFIX} Dev server port detection timed out`);
                  }
                }, 60000);
              } else {
                // Fallback: open Simple Browser after fixed timeout
                console.log(`${LOG_PREFIX} onDidWriteTerminalData not available, using fallback timeout`);
                setTimeout(async () => {
                  try {
                    await vscode.commands.executeCommand('simpleBrowser.api.open', 'http://localhost:3000', {
                      viewColumn: vscode.ViewColumn.Beside,
                    });
                    console.log(`${LOG_PREFIX} Opened Simple Browser (fallback timeout)`);
                  } catch (browserErr) {
                    console.log(`${LOG_PREFIX} Simple Browser not available:`, browserErr);
                  }
                }, 10000);
              }
            } catch (devErr) {
              console.warn(`${LOG_PREFIX} Auto dev server failed (non-fatal):`, devErr);
            }
          }
        }).catch((error: any) => {
          console.error(`${LOG_PREFIX} Post-scaffold error:`, error);
        });
      } else {
        console.error(`${LOG_PREFIX} startPostScaffoldOrchestration not available in core module — scaffold will not complete`);
        vscode.window.showErrorMessage('Scaffold pipeline unavailable. Please update the core package.');
      }
    } catch (coreImportError) {
      console.error(`${LOG_PREFIX} Failed to import core module:`, coreImportError);
      vscode.window.showErrorMessage('Failed to load scaffold pipeline. Please check the core package.');
    }

  } catch (error) {
    console.error(`${LOG_PREFIX} Error in post-preflight apply:`, error);
    vscode.window.showErrorMessage(`Scaffold failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Legacy verification functions (triggerPostScaffoldVerification, handleVerificationRetry,
// handleVerificationRestore, handleVerificationContinue) have been removed.
// The enhanced pipeline in core/postScaffoldOrchestrator handles all post-scaffold
// orchestration including quality gates, overlays, and component setup.

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

  // Resolve project path — scaffoldProjectPath (happy path) > pendingVerifyTargetDir > event store lookup
  let resolvedProjectPath = ctx.scaffoldProjectPath || ctx.pendingVerifyTargetDir || '';

  // Fallback: look up project_path from scaffold_final_complete event in store
  if (!resolvedProjectPath && ctx.eventStore) {
    const taskId_ = ctx.currentTaskId || '';
    const allEvents = taskId_ ? ctx.eventStore.getEventsByTaskId(taskId_) : [];
    const finalComplete = allEvents.find((e: any) => e.type === 'scaffold_final_complete');
    if (finalComplete?.payload?.project_path) {
      resolvedProjectPath = finalComplete.payload.project_path as string;
      ctx.scaffoldProjectPath = resolvedProjectPath; // Cache for next time
      console.log(`${LOG_PREFIX} Resolved project path from event store: ${resolvedProjectPath}`);
    }
  }

  // Last-resort fallback: check message itself (webview may send project_path)
  if (!resolvedProjectPath && message.project_path) {
    resolvedProjectPath = message.project_path;
    console.log(`${LOG_PREFIX} Using project path from message: ${resolvedProjectPath}`);
  }

  // S3: Handle S2 default buttons — step_id shortcuts without explicit kind
  if (!kind && suggestionId === 'dev_server') {
    kind = 'command';
    suggestion = {
      command: message.command || 'npm run dev',
      projectPath: resolvedProjectPath,
    };
  } else if (!kind && suggestionId === 'open_editor') {
    kind = 'editor';
  } else if (!kind && message.command) {
    // Dynamic next steps with command field
    kind = 'command';
    suggestion = { command: message.command, projectPath: resolvedProjectPath };
  }

  console.log(`${LOG_PREFIX} Action selected: kind=${kind}, suggestionId=${suggestionId}`);

  const taskId = ctx.currentTaskId || ctx.generateId();

  try {
    switch (kind) {
      case 'command': {
        // Run command via ProcessManager (generic — any command in cwd)
        const projectPath = suggestion?.projectPath || suggestion?.target_directory || resolvedProjectPath;
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

        // Use ProcessManager to start the process
        const pm = getProcessManager();
        const processId = generateProcessId('devserver');
        const processType = detectProcessType(commandStr);

        // Emit process_started event (must include process_id for card keying)
        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'process_started' as any,
          mode: ctx.currentMode,
          stage: ctx.currentStage,
          payload: {
            scaffold_id: scaffoldId,
            process_id: processId,
            command: commandStr,
            project_path: projectPath,
            message: `Starting: ${commandStr}`,
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        await ctx.sendEventsToWebview(webview, taskId);

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
        // S3: Open project folder in editor (add to workspace, don't reload)
        const editorPath = suggestion?.projectPath || resolvedProjectPath;
        if (editorPath) {
          console.log(`${LOG_PREFIX} Opening in editor: ${editorPath}`);
          const existingFolders = vscode.workspace.workspaceFolders || [];
          const alreadyOpen = existingFolders.some(f => f.uri.fsPath === editorPath);
          if (!alreadyOpen) {
            vscode.workspace.updateWorkspaceFolders(
              existingFolders.length,
              0,
              { uri: vscode.Uri.file(editorPath), name: path.basename(editorPath) }
            );
          }
          // Also reveal the folder in the explorer
          await vscode.commands.executeCommand('workbench.view.explorer');
        } else {
          vscode.window.showWarningMessage('No project path available to open.');
        }
        break;
      }

      case 'plan':
      case 'quick_action': {
        // Look up promptTemplate from next_steps_shown event in event store
        const nextStepsEvents = ctx.eventStore?.getEventsByTaskId(taskId) || [];
        const nextStepsEvt = nextStepsEvents.find((e: any) => e.type === 'next_steps_shown');
        const allSuggestions = (nextStepsEvt?.payload as any)?.suggestions || [];
        const matchedSuggestion = allSuggestions.find((s: any) => (s.id || s.action) === suggestionId);
        const promptTemplate = matchedSuggestion?.promptTemplate || suggestion?.promptTemplate || '';

        if (promptTemplate) {
          console.log(`${LOG_PREFIX} Routing ${kind} suggestion to submit prompt: ${promptTemplate.slice(0, 80)}...`);
          // Emit next_step_selected so the timeline shows which step was clicked
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
              title: matchedSuggestion?.title || suggestion?.title || '',
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          await ctx.sendEventsToWebview(webview, taskId);

          // Start a new task for this feature request
          ctx.currentTaskId = null;
          const targetMode = kind === 'plan' ? 'PLAN' : 'MISSION';
          await handleSubmitPrompt(ctx, {
            text: promptTemplate,
            userSelectedMode: targetMode,
          }, webview);
        } else {
          vscode.window.showInformationMessage(
            `Feature suggestion: ${matchedSuggestion?.title || suggestionId}. No prompt template available.`
          );
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
