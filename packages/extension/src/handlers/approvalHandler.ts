/**
 * Approval & Decision-Point Handler
 * Extracted from MissionControlViewProvider.
 *
 * Covers:
 *   - handleResolveApproval   (approve/reject diff or command)
 *   - handleResolveDecisionPoint (scaffold, command, continue-run)
 *
 * All functions take `ctx: IProvider` as first parameter instead of `this`.
 */

import type { IProvider } from '../handlerContext';
import type {
  Event,
  PreflightOrchestratorCtx,
  PreflightChecksInput,
} from 'core';
import {
  EventBus,
  detectActiveRun,
  processContinueRunResponse,
  selectRecipe,
  runPreflightChecksWithEvents,
  extractAppNameFromPrompt,
  createScaffoldSession,
  resolveModel,
} from 'core';
import * as path from 'path';
import * as vscode from 'vscode';
import { fileExists } from '../utils/fsAsync';

// ---------------------------------------------------------------------------
// handleResolveApproval
// ---------------------------------------------------------------------------

export async function handleResolveApproval(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id, approval_id, decision } = message;

  if (!task_id || !approval_id || !decision) {
    console.error('Missing required fields in resolveApproval');
    return;
  }

  try {
    // CRITICAL FIX: Call the active approval manager to resolve the Promise
    if (!ctx.activeApprovalManager) {
      console.error('[handleResolveApproval] No active approval manager found!');
      vscode.window.showErrorMessage('No active approval manager. Please try again.');
      return;
    }

    // Get events to find the approval request
    const events = ctx.eventStore?.getEventsByTaskId(task_id) || [];
    const approvalRequest = events.find(
      (e: Event) => e.type === 'approval_requested' && e.payload.approval_id === approval_id,
    );

    if (!approvalRequest) {
      console.error('Approval request not found');
      return;
    }

    const approved = decision === 'approved';

    // V9: Enforce MISSION mode for diff approvals (writes to disk)
    const approvalTypeForGate = approvalRequest.payload.approval_type as string;
    if (approved && approvalTypeForGate === 'diff' && !await ctx.enforceMissionMode('apply_diff', task_id)) {
      await ctx.sendEventsToWebview(webview, task_id);
      return;
    }

    console.log(`[handleResolveApproval] Resolving approval: ${approval_id}, decision: ${decision}`);

    // Resolve via approval manager (this resolves the Promise and unblocks execution!)
    await ctx.activeApprovalManager.resolveApproval(
      task_id,
      ctx.currentMode,
      ctx.currentStage,
      approval_id,
      approved ? 'approved' : 'denied',
      'once',
    );

    // V6: If this is a generated_tool approval, approve/reject the tool proposal
    const approvalType = approvalRequest.payload.approval_type as string;
    if (approvalType === 'generated_tool') {
      const gtm = ctx.getGeneratedToolManager();
      const proposalId = approvalRequest.payload.details
        ? (approvalRequest.payload.details as Record<string, unknown>).proposal_id as string
        : approval_id;
      if (gtm && proposalId) {
        if (approved) {
          await gtm.approveTool(proposalId, task_id, ctx.currentMode);
          console.log(`[V6] Tool proposal approved and saved: ${proposalId}`);
        } else {
          gtm.rejectTool(proposalId);
          console.log(`[V6] Tool proposal rejected: ${proposalId}`);
        }
      }
    }

    // Send updated events to webview
    await ctx.sendEventsToWebview(webview, task_id);

    console.log('[handleResolveApproval] Approval resolved successfully:', { approval_id, approved, decision });

  } catch (error) {
    console.error('Error handling resolveApproval:', error);
    vscode.window.showErrorMessage(`Failed to resolve approval: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleResolveDecisionPoint
// ---------------------------------------------------------------------------

export async function handleResolveDecisionPoint(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id, decision_event_id, action } = message;

  if (!task_id || !decision_event_id || !action) {
    console.error('Missing required fields in resolveDecisionPoint');
    return;
  }

  if (!ctx.eventStore) {
    console.error('EventStore not initialized');
    return;
  }

  try {
    const events = ctx.eventStore.getEventsByTaskId(task_id);

    // Look for decision_point_needed OR scaffold_decision_requested events
    let decisionEvent = events.find(
      (e: Event) => e.type === 'decision_point_needed' && e.event_id === decision_event_id,
    );

    // Also check for scaffold_decision_requested (Step 35)
    if (!decisionEvent) {
      decisionEvent = events.find(
        (e: Event) => e.type === 'scaffold_decision_requested' && e.event_id === decision_event_id,
      );
    }

    // Extract scaffold context from message if present (sent by ScaffoldCard component)
    const scaffoldContext = message.scaffold_context;

    // If no event found by ID but we have scaffold context, find by scaffold_id
    if (!decisionEvent && scaffoldContext?.scaffold_id) {
      decisionEvent = events.find(
        (e: Event) =>
          e.type === 'scaffold_decision_requested' &&
          e.payload?.scaffold_id === scaffoldContext.scaffold_id,
      );
      console.log('[handleResolveDecisionPoint] Found scaffold event by scaffold_id:', !!decisionEvent);
    }

    if (!decisionEvent) {
      console.error('Decision point event not found');
      return;
    }

    const payload = decisionEvent.payload || {};
    let decisionType = payload.decision_type as string | undefined;
    const decisionContext = payload.context as string | undefined;

    // Infer decision type from event type if not explicitly set
    if (!decisionType && decisionEvent.type === 'scaffold_decision_requested') {
      decisionType = 'scaffold_approval';
    }

    // ── continue_run ──────────────────────────────────────────────────────
    if (decisionType === 'continue_run') {
      const activeRun = (payload.active_run as any) || detectActiveRun(events);
      if (!activeRun) {
        console.error('No active run found for continue_run decision');
        return;
      }

      const allowedActions = new Set(['resume', 'pause', 'abort', 'propose_fix']);
      if (!allowedActions.has(action)) {
        console.error('Invalid continue_run action:', action);
        return;
      }

      const eventBus = new EventBus(ctx.eventStore);
      eventBus.subscribe(async () => {
        await ctx.sendEventsToWebview(webview, task_id);
      });

      await processContinueRunResponse(
        action as 'resume' | 'pause' | 'abort' | 'propose_fix',
        activeRun,
        eventBus,
        task_id,
      );

      await ctx.sendEventsToWebview(webview, task_id);
      return;
    }

    // ── command_execution ─────────────────────────────────────────────────
    if (decisionContext === 'command_execution') {
      const pendingContext = ctx.pendingCommandContexts.get(task_id);
      if (!pendingContext) {
        console.error('No pending command context found for task');
        return;
      }

      if (action === 'run_commands') {
        // FIXED: Use VS Code terminal API to run commands visibly
        console.log('[handleResolveDecisionPoint] Running commands in VS Code terminal');

        // V9: Enforce MISSION mode for command execution
        if (!await ctx.enforceMissionMode('execute_command', task_id)) {
          await ctx.sendEventsToWebview(webview, task_id);
          return;
        }

        ctx.pendingCommandContexts.delete(task_id);

        const commands = pendingContext.commands || [];
        const workspaceRoot = pendingContext.workspaceRoot;

        for (const command of commands) {
          // Emit command_started event
          await ctx.emitEvent({
            event_id: ctx.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'command_started',
            mode: ctx.currentMode,
            stage: 'command',
            payload: {
              command,
              method: 'vscode_terminal',
              cwd: workspaceRoot,
            },
            evidence_ids: [],
            parent_event_id: null,
          });

          // Create and show VS Code terminal
          const terminalName = `Ordinex: ${command.split(' ')[0]}`;

          // Dispose old terminal if exists
          const existingTerminal = ctx.activeTerminals.get(task_id);
          if (existingTerminal) {
            existingTerminal.dispose();
          }

          // Create new terminal
          const terminal = vscode.window.createTerminal({
            name: terminalName,
            cwd: workspaceRoot,
          });

          ctx.activeTerminals.set(task_id, terminal);

          // Show terminal and send command
          terminal.show(true); // true = preserve focus
          terminal.sendText(command);

          console.log(`[handleResolveDecisionPoint] Command sent to terminal: ${command}`);

          // Emit command_running event (since we can't track output from sendText)
          await ctx.emitEvent({
            event_id: ctx.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'command_progress',
            mode: ctx.currentMode,
            stage: 'command',
            payload: {
              command,
              status: 'running_in_terminal',
              message: `Command running in VS Code terminal "${terminalName}"`,
            },
            evidence_ids: [],
            parent_event_id: null,
          });
        }

        // Emit completion event
        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'command_completed',
          mode: ctx.currentMode,
          stage: 'command',
          payload: {
            success: true,
            commands_executed: commands,
            method: 'vscode_terminal',
            message: `Command(s) started in VS Code terminal. Check terminal for output.`,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await ctx.sendEventsToWebview(webview, task_id);

        // CRITICAL FIX: Clear currentTaskId so next prompt starts a fresh task
        // This prevents "Active Run Detected" on follow-up prompts
        console.log(`[handleResolveDecisionPoint] Command task completed, clearing currentTaskId`);
        ctx.currentTaskId = null;
        ctx.currentStage = 'none';

        vscode.window.showInformationMessage(
          `Command started in terminal. Check the "${commands.length > 0 ? commands[0].split(' ')[0] : 'Ordinex'}" terminal for output.`,
        );
        return;

      } else if (action === 'skip_once') {
        ctx.pendingCommandContexts.delete(task_id);

        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'command_skipped',
          mode: ctx.currentMode,
          stage: 'command',
          payload: {
            reason: 'User skipped command execution',
            commands: pendingContext.commands,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await ctx.sendEventsToWebview(webview, task_id);

        // CRITICAL FIX: Clear currentTaskId so next prompt starts a fresh task
        console.log(`[handleResolveDecisionPoint] Command skipped, clearing currentTaskId`);
        ctx.currentTaskId = null;
        ctx.currentStage = 'none';
        return;

      } else if (action === 'disable_commands') {
        ctx.pendingCommandContexts.delete(task_id);

        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'command_skipped',
          mode: ctx.currentMode,
          stage: 'command',
          payload: {
            reason: 'User disabled command execution',
            commands: pendingContext.commands,
            permanently_disabled: true,
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await ctx.sendEventsToWebview(webview, task_id);
        vscode.window.showInformationMessage('Command execution disabled for this workspace.');
        return;

      } else {
        console.error('Unknown command decision action:', action);
        return;
      }
    }

    // ── scaffold_approval ─────────────────────────────────────────────────
    if (decisionType === 'scaffold_approval') {
      console.log('[handleResolveDecisionPoint] Scaffold approval action:', action);

      if (!ctx.activeScaffoldCoordinator) {
        console.error('No active scaffold coordinator found');
        vscode.window.showErrorMessage('Scaffold flow not active. Please try again.');
        return;
      }

      try {
        // Step 35.5: Handle change_style separately - it does NOT complete the flow
        if (action === 'change_style') {
          console.log('[handleResolveDecisionPoint] Showing design pack picker...');
          await ctx.activeScaffoldCoordinator.handleStyleChange();
          console.log('[handleResolveDecisionPoint] Style picker shown, awaiting user selection');
          await ctx.sendEventsToWebview(webview, task_id);
          // Do NOT clear currentTaskId - flow continues in awaiting_decision state
          return;
        }

        // Step 35.5: Handle style selection (when user picks a pack from the picker)
        if (action === 'select_style' && scaffoldContext?.selected_pack_id) {
          console.log('[handleResolveDecisionPoint] Design pack selected:', scaffoldContext.selected_pack_id);
          await ctx.activeScaffoldCoordinator.handleStyleSelect(scaffoldContext.selected_pack_id);
          console.log('[handleResolveDecisionPoint] Style selected, back to decision state');
          await ctx.sendEventsToWebview(webview, task_id);
          return;
        }

        // Style Intent: Handle set_style_intent from the new Style Intent UI
        if (action === 'set_style_intent' && scaffoldContext?.style_input) {
          const styleInput = scaffoldContext.style_input as { mode: string; value: string };
          console.log(`[handleResolveDecisionPoint] Style intent set: mode=${styleInput.mode}, value="${styleInput.value}"`);
          if ((ctx.activeScaffoldCoordinator as any).setStyleInput) {
            (ctx.activeScaffoldCoordinator as any).setStyleInput(styleInput);
          }
          return;
        }

        // Map button actions to scaffold flow actions for finalizing (proceed/cancel only)
        let scaffoldAction: 'proceed' | 'cancel';

        switch (action) {
          case 'proceed':
            scaffoldAction = 'proceed';
            break;
          case 'cancel':
            scaffoldAction = 'cancel';
            break;
          default:
            console.error('Unknown scaffold action:', action);
            vscode.window.showErrorMessage(`Unknown action: ${action}`);
            return;
        }

        // Call the coordinator to handle the action (finalizing only)
        const updatedState = await ctx.activeScaffoldCoordinator.handleUserAction(scaffoldAction);
        console.log('[handleResolveDecisionPoint] Scaffold action handled:', updatedState.completionStatus);

        // Capture blueprint and style data BEFORE clearing the coordinator
        const savedBlueprint = (ctx.activeScaffoldCoordinator as any).getBlueprint?.();
        const savedStyleResolution = (ctx.activeScaffoldCoordinator as any).getState?.()?.styleResolution;
        const savedStyleInput = (ctx.activeScaffoldCoordinator as any).getStyleInput?.()
          || savedStyleResolution?.input
          || undefined;

        // Clear the coordinator reference
        ctx.activeScaffoldCoordinator = null;

        await ctx.sendEventsToWebview(webview, task_id);

        if (updatedState.completionStatus === 'ready_for_step_35_2') {
          // STEP 43: Run preflight checks before recipe selection
          console.log('[handleResolveDecisionPoint] Scaffold approved, running preflight checks...');

          try {
            // Get workspace root
            const scaffoldWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!scaffoldWorkspaceRoot) {
              throw new Error('No workspace folder open');
            }

            // Get the original intent to determine recipe
            const scaffoldEvents = ctx.eventStore?.getEventsByTaskId(task_id) || [];
            const scaffoldIntentEvent = scaffoldEvents.find((e: Event) => e.type === 'intent_received');
            const scaffoldPrompt = (scaffoldIntentEvent?.payload.prompt as string) || 'Create a new project';

            // Extract app name from user prompt (e.g. "create new todo app" → "todo")
            const scaffoldAppName = extractAppNameFromPrompt(scaffoldPrompt);
            console.log(`[handleResolveDecisionPoint] Extracted app name: "${scaffoldAppName}" from prompt: "${scaffoldPrompt}"`);

            // Step 43: Run preflight checks — target the SUBDIRECTORY where the project will be created
            const scaffoldTargetDir = path.join(scaffoldWorkspaceRoot, scaffoldAppName);
            const preflightEventBus = new EventBus(ctx.eventStore!);
            preflightEventBus.subscribe(async () => {
              await ctx.sendEventsToWebview(webview, task_id);
            });

            const scaffoldIdFromEvents =
              (scaffoldEvents.find(e => e.type === 'scaffold_started')?.payload?.scaffold_id as string) ||
              ctx.generateId();

            const preflightCtx: PreflightOrchestratorCtx = {
              scaffoldId: scaffoldIdFromEvents,
              runId: task_id,
              eventBus: preflightEventBus as any,
              mode: ctx.currentMode,
            };

            const preflightInput: PreflightChecksInput = {
              targetDir: scaffoldTargetDir,
              workspaceRoot: scaffoldWorkspaceRoot,
              plannedFiles: ['package.json', 'src/index.ts', 'tsconfig.json'], // placeholder
              appName: scaffoldAppName,
            };

            const preflightResult = await runPreflightChecksWithEvents(preflightInput, preflightCtx);
            console.log('[handleResolveDecisionPoint] Preflight result:', {
              canProceed: preflightResult.canProceed,
              blockers: preflightResult.blockers.length,
              warnings: preflightResult.warnings.length,
            });

            await ctx.sendEventsToWebview(webview, task_id);

            if (!preflightResult.canProceed) {
              // Store state for resolution handling
              ctx.pendingPreflightResult = preflightResult;
              ctx.pendingPreflightInput = preflightInput;
              ctx.pendingPreflightCtx = preflightCtx;
              console.log('[handleResolveDecisionPoint] Preflight blocked — awaiting user resolution');

              // Send preflight card data to webview
              webview.postMessage({
                type: 'ordinex:preflightCard',
                payload: {
                  scaffold_id: scaffoldIdFromEvents,
                  run_id: task_id,
                  target_directory: preflightInput.targetDir,
                  can_proceed: preflightResult.canProceed,
                  checks: preflightResult.checks,
                  blockers_count: preflightResult.blockers.length,
                  warnings_count: preflightResult.warnings.length,
                },
              });
              return; // Wait for user to resolve via preflight_resolution_selected messages
            }

            // Preflight passed — continue to recipe selection
            console.log('[handleResolveDecisionPoint] Preflight passed, selecting recipe...');

            // Select recipe based on user prompt
            const recipeSelection = selectRecipe(scaffoldPrompt);
            console.log(`[handleResolveDecisionPoint] Recipe selected: ${recipeSelection.recipe_id}`);

            // Build non-interactive create command with app name from prompt
            const createCmd =
              recipeSelection.recipe_id === 'nextjs_app_router'
                ? `npx --yes create-next-app@latest ${scaffoldAppName} --typescript --tailwind --eslint --app --src-dir --use-npm --import-alias "@/*"`
                : recipeSelection.recipe_id === 'vite_react'
                  ? `npm create vite@latest ${scaffoldAppName} -- --template react-ts`
                  : `npx --yes create-expo-app ${scaffoldAppName} --template blank-typescript`;

            // Emit scaffold_decision_resolved event to indicate recipe selection
            await ctx.emitEvent({
              event_id: ctx.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'scaffold_decision_resolved',
              mode: ctx.currentMode,
              stage: ctx.currentStage,
              payload: {
                decision: 'proceed',
                recipe_id: recipeSelection.recipe_id,
                app_name: scaffoldAppName,
                next_steps:
                  recipeSelection.recipe_id === 'nextjs_app_router'
                    ? [createCmd, `cd ${scaffoldAppName}`, 'npm run dev']
                    : recipeSelection.recipe_id === 'vite_react'
                      ? [createCmd, `cd ${scaffoldAppName}`, 'npm install', 'npm run dev']
                      : [createCmd, `cd ${scaffoldAppName}`, 'npx expo start'],
              },
              evidence_ids: [],
              parent_event_id: null,
            });

            await ctx.sendEventsToWebview(webview, task_id);

            // STEP 35.4 FIX: Automatically run the scaffold command in terminal
            const recipeNames: Record<string, string> = {
              'nextjs_app_router': 'Next.js',
              'vite_react': 'Vite + React',
              'expo': 'Expo',
            };

            // Emit scaffold_apply_started event
            await ctx.emitEvent({
              event_id: ctx.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'scaffold_apply_started',
              mode: ctx.currentMode,
              stage: ctx.currentStage,
              payload: {
                recipe_id: recipeSelection.recipe_id,
                command: createCmd,
                target_directory: scaffoldTargetDir,
                app_name: scaffoldAppName,
              },
              evidence_ids: [],
              parent_event_id: null,
            });

            await ctx.sendEventsToWebview(webview, task_id);

            // V9: User clicked "Proceed" — escalate to MISSION for file creation (user-initiated)
            await ctx.setModeWithEvent('MISSION', task_id, {
              reason: 'Scaffold approved by user — escalating to MISSION for file creation',
              user_initiated: true,
            });

            // Create terminal and RUN the scaffold command automatically
            console.log('[handleResolveDecisionPoint] Auto-running scaffold command:', createCmd);

            const terminal = vscode.window.createTerminal({
              name: `Scaffold: ${recipeNames[recipeSelection.recipe_id] || 'Project'}`,
              cwd: scaffoldWorkspaceRoot,
            });
            terminal.show(true); // Show terminal with focus
            terminal.sendText(createCmd);

            // Track scaffold terminal for failure detection
            const scaffoldTerminalRef = terminal;
            const scaffoldTargetPkg = path.join(scaffoldWorkspaceRoot, scaffoldAppName, 'package.json');
            const terminalCloseListener = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
              if (closedTerminal !== scaffoldTerminalRef) return;
              terminalCloseListener.dispose();
              // Give filesystem a moment to flush
              await new Promise(r => setTimeout(r, 1000));
              if (!(await fileExists(scaffoldTargetPkg))) {
                console.error('[handleResolveDecisionPoint] Scaffold terminal closed before project was created');
                await ctx.emitEvent({
                  event_id: ctx.generateId(),
                  task_id: task_id,
                  timestamp: new Date().toISOString(),
                  type: 'scaffold_progress' as any,
                  mode: ctx.currentMode,
                  stage: ctx.currentStage,
                  payload: {
                    scaffold_id: scaffoldIdFromEvents,
                    status: 'error',
                    message: 'Scaffold terminal closed before project was created. Please try again.',
                  },
                  evidence_ids: [],
                  parent_event_id: null,
                });
                await ctx.sendEventsToWebview(webview, task_id);
                vscode.window.showErrorMessage('Scaffold terminal closed before project was created. Please try again.');
              }
            });

            // START POST-SCAFFOLD ORCHESTRATION
            // Polls for project completion, applies design pack, emits next_steps_shown
            const postScaffoldEventBus = new EventBus(ctx.eventStore!);

            // Extract scaffold ID from events or generate one
            const postScaffoldEvents = ctx.eventStore?.getEventsByTaskId(task_id) || [];
            const scaffoldDecisionEvent = postScaffoldEvents.find(e => e.type === 'scaffold_decision_requested');
            const scaffoldIdForPost = (scaffoldDecisionEvent?.payload?.scaffold_id as string) || ctx.generateId();

            // Extract design pack ID from events (not scaffoldContext which uses wrong field names)
            // Priority: scaffold_style_selected (user changed style) > scaffold_proposal_created (default style)
            const styleSelectedEvent = postScaffoldEvents.find(e => e.type === 'scaffold_style_selected');
            const proposalEvent = postScaffoldEvents.find(e => e.type === 'scaffold_proposal_created');
            const designPackIdForPost =
              (styleSelectedEvent?.payload?.pack_id as string) ||
              (proposalEvent?.payload?.design_pack_id as string) ||
              'minimal-light';
            console.log(
              `[handleResolveDecisionPoint] Design pack ID: ${designPackIdForPost} (from: ${styleSelectedEvent ? 'style_selected' : proposalEvent ? 'proposal' : 'fallback'})`,
            );

            // Import startPostScaffoldOrchestration from core
            const coreModule = await import('core');
            const startPostScaffoldOrchestration = coreModule.startPostScaffoldOrchestration;

            if (typeof startPostScaffoldOrchestration === 'function') {
              // Build LLM client adapter for feature generation
              const featureApiKey = await ctx._context.secrets.get('ordinex.apiKey');
              let featureLLMClient: any = undefined;
              if (featureApiKey) {
                try {
                  // Use core's factory -- core has @anthropic-ai/sdk as a dependency
                  const { createFeatureLLMClient } = await import('core');
                  featureLLMClient = await createFeatureLLMClient(featureApiKey);
                  if (featureLLMClient) {
                    console.log('[handleResolveDecisionPoint] Feature LLM client created successfully');
                  } else {
                    console.warn('[handleResolveDecisionPoint] createFeatureLLMClient returned null');
                  }
                } catch (llmError) {
                  console.warn('[handleResolveDecisionPoint] Could not create LLM client for feature generation:', llmError);
                }
              } else {
                console.warn('[handleResolveDecisionPoint] No API key found (ordinex.apiKey) -- feature generation will be skipped');
              }

              // Extract user prompt from scaffold events
              const scaffoldIntentEvt = ctx.eventStore?.getEventsByTaskId(task_id)?.find((e: Event) => e.type === 'intent_received');
              const scaffoldUserPrompt = (scaffoldIntentEvt?.payload?.prompt as string) || '';
              const userModelId = (scaffoldIntentEvt?.payload?.model_id as string) || '';
              const resolvedModelId = resolveModel(userModelId);
              console.log(
                `[handleResolveDecisionPoint] User prompt for feature generation: "${scaffoldUserPrompt}" (found event: ${!!scaffoldIntentEvt})`,
              );

              // Use blueprint/style data saved before coordinator was cleared
              console.log(
                `[handleResolveDecisionPoint] Blueprint: ${savedBlueprint ? `app_type=${savedBlueprint.app_type}, pages=${savedBlueprint.pages?.length}` : 'undefined'}`,
              );
              console.log(
                `[handleResolveDecisionPoint] Style input: ${savedStyleInput ? `mode=${savedStyleInput.mode}, value=${savedStyleInput.value}` : 'undefined'}`,
              );

              const postScaffoldCtx = {
                taskId: task_id,
                scaffoldId: scaffoldIdForPost,
                targetDirectory: scaffoldWorkspaceRoot,
                appName: scaffoldAppName,
                recipeId: recipeSelection.recipe_id as any,
                designPackId: designPackIdForPost,
                eventBus: postScaffoldEventBus,
                mode: ctx.currentMode,
                userPrompt: scaffoldUserPrompt,
                llmClient: featureLLMClient,
                blueprint: savedBlueprint || undefined,
                styleInput: savedStyleInput,
                modelId: resolvedModelId,
              };

              // Subscribe to post-scaffold events for UI updates + capture project path + build session
              postScaffoldEventBus.subscribe(async (event) => {
                if ((event as any).type === 'scaffold_final_complete' && (event as any).payload?.project_path) {
                  const payload = (event as any).payload;
                  ctx.scaffoldProjectPath = payload.project_path as string;

                  ctx.scaffoldSession = createScaffoldSession({
                    projectPath: payload.project_path,
                    appName: scaffoldAppName,
                    recipeId: recipeSelection.recipe_id as any,
                    designPackId: designPackIdForPost,
                    blueprint: payload.blueprint_summary || savedBlueprint,
                    doctorStatus: payload.doctor_status,
                    doctorCard: payload.doctor_card,
                    projectSummary: payload.project_summary,
                  });
                  console.log(`[handleResolveDecisionPoint] ScaffoldSession created for: ${scaffoldAppName}`);
                }
                await ctx.sendEventsToWebview(webview, task_id);
              });

              // Fire and forget - orchestrator handles polling and event emission
              startPostScaffoldOrchestration(postScaffoldCtx)
                .then((result: any) => {
                  console.log('[handleResolveDecisionPoint] Post-scaffold complete:', result);
                  if (result?.projectPath) {
                    ctx.scaffoldProjectPath = result.projectPath;
                    console.log(`[handleResolveDecisionPoint] Stored scaffoldProjectPath: ${ctx.scaffoldProjectPath}`);
                  }
                })
                .catch((error: any) => {
                  console.error('[handleResolveDecisionPoint] Post-scaffold error:', error);
                });
            } else {
              console.warn('[handleResolveDecisionPoint] startPostScaffoldOrchestration not available, skipping post-scaffold');
            }

            // Emit scaffold_applied event (command started)
            await ctx.emitEvent({
              event_id: ctx.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'scaffold_applied',
              mode: ctx.currentMode,
              stage: ctx.currentStage,
              payload: {
                recipe_id: recipeSelection.recipe_id,
                command: createCmd,
                method: 'vscode_terminal',
                message: `Scaffold command running in terminal. Follow the prompts to complete setup.`,
              },
              evidence_ids: [],
              parent_event_id: null,
            });

            await ctx.sendEventsToWebview(webview, task_id);

            vscode.window.showInformationMessage(
              `${recipeNames[recipeSelection.recipe_id] || 'Project'} scaffold started! Follow the terminal prompts to complete setup.`,
            );

            // Preserve taskId for follow-up prompts (post-scaffold context)
            console.log('[handleResolveDecisionPoint] Scaffold apply complete, preserving currentTaskId for follow-ups');
            ctx.currentStage = 'none';

          } catch (scaffoldApplyError) {
            console.error('[handleResolveDecisionPoint] Scaffold error:', scaffoldApplyError);
            vscode.window.showErrorMessage(`Scaffold failed: ${scaffoldApplyError}`);
            ctx.currentTaskId = null;
            ctx.currentStage = 'none';
          }
        } else if (updatedState.completionStatus === 'cancelled') {
          vscode.window.showInformationMessage('Scaffold cancelled.');
          ctx.currentTaskId = null;
          ctx.currentStage = 'none';
        }

        return;

      } catch (scaffoldError) {
        console.error('[handleResolveDecisionPoint] Scaffold error:', scaffoldError);
        vscode.window.showErrorMessage(`Scaffold action failed: ${scaffoldError}`);
        return;
      }
    }

    console.error('Decision point not handled:', { decisionType, decisionContext });
  } catch (error) {
    console.error('Error handling resolveDecisionPoint:', error);
    vscode.window.showErrorMessage(`Failed to resolve decision point: ${error}`);
  }
}
