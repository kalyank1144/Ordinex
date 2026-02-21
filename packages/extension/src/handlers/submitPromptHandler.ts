/**
 * Submit Prompt Handler — extracted from MissionControlViewProvider.
 *
 * This is the MAIN entry point for all user submissions. It combines intent
 * analysis, mode routing, enrichment, and all behavior paths (answer, plan,
 * scaffold, quick-action, clarify, continue-run).
 *
 * All functions take `ctx: IProvider` as first parameter instead of using `this`.
 */

import type { IProvider } from '../handlerContext';
import type {
  EnrichedInput,
  IntentAnalysisContext,
  Mode,
  Event,
  StructuredPlan,
  CommandMode,
} from 'core';
import * as vscode from 'vscode';
import {
  routeIntent,
  detectActiveRun,
  detectCommandIntent,
  enrichUserInput,
  generateTemplatePlan,
  buildFollowUpContext,
  runCommandPhase,
  CommandPhaseContext,
  resolveCommandPolicy,
  EventBus,
  InMemoryEvidenceStore,
} from 'core';
import type { RoutedIntent, IntentRoutingResult } from 'core';

// Cross-handler imports
import { handleAnswerMode } from './answerHandler';
import { handlePlanMode } from './planHandler';
import { handleScaffoldFlow } from './scaffoldHandler';
import { handleExecutePlan } from './missionHandler';

// ---------------------------------------------------------------------------
// handleSubmitPrompt
// ---------------------------------------------------------------------------

/**
 * Main entry point for all user prompt submissions.
 *
 * Flow:
 *  1. Create task if none active, emit intent_received
 *  2. Enrich user input with intelligence layer
 *  3. Analyze intent (heuristic + optional LLM classifier fallback)
 *  4. Route to behavior: ANSWER, PLAN, scaffold, QUICK_ACTION, CLARIFY, CONTINUE_RUN
 */
export async function handleSubmitPrompt(
  ctx: IProvider,
  msg: any,
  webview: vscode.Webview,
): Promise<void> {
  console.log('=== handleSubmitPrompt START (Step 33) ===');
  const { text, userSelectedMode, modelId, attachments } = msg;
  console.log('Params:', { text, userSelectedMode, modelId, attachmentCount: attachments?.length || 0 });

  if (!text || !userSelectedMode) {
    console.error('Missing required fields in submitPrompt');
    return;
  }

  // Create task_id if not active
  console.log('Checking currentTaskId:', ctx.currentTaskId);
  if (!ctx.currentTaskId) {
    ctx.currentTaskId = ctx.generateId();
    ctx.currentStage = 'none';
    await ctx.setModeWithEvent(userSelectedMode, ctx.currentTaskId, {
      reason: 'User selected mode for new task',
      user_initiated: true,
    });
    console.log('Created new task ID:', ctx.currentTaskId);
  }

  const taskId = ctx.currentTaskId;
  // Step 47: Track currentTaskId at module level for deactivate()
  ctx.setGlobalCurrentTaskId(taskId);
  console.log('Using task ID:', taskId);

  // PHASE 4: Extract attachment evidence_ids for storing in intent_received
  const attachmentEvidenceIds: string[] = (attachments || [])
    .filter((a: any) => a.evidence_id)
    .map((a: any) => a.evidence_id);

  if (attachmentEvidenceIds.length > 0) {
    console.log(`[Attachments] ${attachmentEvidenceIds.length} attachment evidence IDs:`, attachmentEvidenceIds);
  }

  try {
    // 1. Emit intent_received event (includes attachments in payload and evidence_ids)
    console.log('About to emit intent_received event...');
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'intent_received',
      mode: userSelectedMode,
      stage: ctx.currentStage,
      payload: {
        prompt: text,
        model_id: modelId || 'sonnet-4.5',
        user_selected_mode: userSelectedMode,
        // PHASE 4: Store attachment refs in payload for replay/audit
        attachments: attachments || [],
      },
      evidence_ids: attachmentEvidenceIds, // PHASE 4: Link to evidence
      parent_event_id: null,
    });
    console.log('intent_received event emitted');
    await ctx.sendEventsToWebview(webview, taskId);

    // Step 47: Persist active task after intent_received
    await ctx.updateTaskPersistence(taskId, { mode: userSelectedMode, stage: ctx.currentStage });

    // 2. STEP 40.5: Enrich user input with intelligence layer
    const workspaceRoot = ctx.selectedWorkspaceRoot
      || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      || '';
    const openFilePaths = vscode.workspace.textDocuments
      .filter(doc => doc.uri.scheme === 'file')
      .map(doc => doc.uri.fsPath);

    let enrichedInput: EnrichedInput | null = null;
    let effectivePrompt = text; // Falls back to raw text if enrichment fails

    if (workspaceRoot) {
      try {
        const editorContext = ctx.buildEditorContext();
        enrichedInput = await enrichUserInput(text, {
          workspaceRoot,
          openFiles: openFilePaths,
          editorContext,
          projectMemoryManager: ctx.getProjectMemoryManager() || undefined,
        });
        effectivePrompt = enrichedInput.enrichedPrompt;
        console.log('[Step40.5] Enrichment complete:', {
          outOfScope: enrichedInput.outOfScope,
          clarificationNeeded: enrichedInput.clarificationNeeded,
          resolvedCount: enrichedInput.metadata.resolvedCount,
          durationMs: enrichedInput.metadata.enrichmentDurationMs,
        });
      } catch (enrichErr) {
        console.warn('[Step40.5] Enrichment failed, using raw input:', enrichErr);
      }
    } else {
      console.warn('[Step40.5] No workspace root, skipping enrichment');
    }

    // 2.5: Enrich follow-up prompt with scaffold session context
    if (ctx.scaffoldSession) {
      const sessionContext = buildFollowUpContext(ctx.scaffoldSession);
      effectivePrompt = `${sessionContext}\n\n${effectivePrompt}`;
      console.log('[ScaffoldSession] Enriched follow-up prompt with structured session context');
    } else if (ctx.scaffoldProjectPath) {
      effectivePrompt = `[Context: Working on scaffolded project at "${ctx.scaffoldProjectPath}"]\n\n${effectivePrompt}`;
      console.log('[ScaffoldContext] Fallback: enriched with scaffold path only');
    }

    // 2a. Handle out-of-scope requests
    if (enrichedInput?.outOfScope) {
      console.log('[Step40.5] Out-of-scope request detected, sending redirect');
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'stream_complete',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          response: enrichedInput.outOfScopeResponse || 'I focus on coding tasks. Is there code I can help you with?',
          out_of_scope: true,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.sendEventsToWebview(webview, taskId);
      ctx.currentTaskId = null;
      return;
    }

    // 2b. Handle clarification needed from enrichment
    if (enrichedInput?.clarificationNeeded && userSelectedMode !== 'PLAN') {
      console.log('[Step40.5] Clarification needed:', enrichedInput.clarificationQuestion);
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'clarification_requested',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          question: enrichedInput.clarificationQuestion || 'Could you provide more details?',
          options: enrichedInput.clarificationOptions || [],
          context_source: 'intelligence_layer',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'execution_paused',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          reason: 'awaiting_clarification',
          description: 'Intelligence layer needs more information',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.sendEventsToWebview(webview, taskId);
      return;
    } else if (enrichedInput?.clarificationNeeded) {
      console.log('[Step40.5] Clarification needed but skipping for PLAN mode — planHandler will handle');
    }

    // =========================================================================
    // 3. UNIFIED INTENT ROUTING — single pipeline, no hardcoded models
    //
    // Uses routeIntent() which handles:
    //   slash overrides → high-confidence heuristics → LLM classification → fallback
    // The user's selected model is passed through for any LLM classification.
    // =========================================================================
    const events = ctx.eventStore?.getEventsByTaskId(taskId) || [];
    const activeRun = detectActiveRun(events);

    let llmConfig: { apiKey: string; model: string } | undefined;
    try {
      const apiKey = await ctx._context.secrets.get('ordinex.apiKey');
      if (apiKey) {
        llmConfig = { apiKey, model: modelId || 'claude-sonnet-4-5-20241022' };
      }
    } catch { /* no API key — heuristic-only routing */ }

    const routingResult: IntentRoutingResult = await routeIntent(text, {
      llmConfig,
      behaviorConfidence: 0.5,
      events,
    });

    console.log('[IntentRouter] Result:', {
      intent: routingResult.intent,
      source: routingResult.source,
      confidence: routingResult.confidence,
      llmCalled: routingResult.llmCalled,
      reasoning: routingResult.reasoning,
    });

    // Map RoutedIntent → Mode for event emission
    const intentToMode: Record<RoutedIntent, Mode> = {
      SCAFFOLD: 'PLAN',
      PLAN: 'PLAN',
      RUN_COMMAND: 'MISSION',
      QUICK_ACTION: 'MISSION',
      ANSWER: 'ANSWER',
      CLARIFY: 'ANSWER',
    };
    const derivedMode = intentToMode[routingResult.intent] || 'ANSWER';

    // Emit mode_set event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'mode_set',
      mode: derivedMode,
      stage: ctx.currentStage,
      payload: {
        mode: derivedMode,
        effectiveMode: derivedMode,
        behavior: routingResult.intent,
        user_selected_mode: userSelectedMode,
        confidence: routingResult.confidence,
        reasoning: routingResult.reasoning,
        routing_source: routingResult.source,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Respect user's explicit mode selection
    const effectiveMode = (userSelectedMode === 'ANSWER' || userSelectedMode === 'PLAN' || userSelectedMode === 'MISSION')
      ? userSelectedMode as Mode
      : derivedMode;
    if (effectiveMode !== ctx.currentMode) {
      await ctx.setModeWithEvent(effectiveMode, taskId, {
        reason: effectiveMode === userSelectedMode
          ? `User selected mode: ${userSelectedMode}`
          : `Intent router: ${routingResult.reasoning}`,
        user_initiated: effectiveMode === userSelectedMode,
      });
    }
    await ctx.sendEventsToWebview(webview, taskId);

    // =========================================================================
    // 4. ROUTE TO HANDLER based on unified intent
    // =========================================================================

    // SCAFFOLD — route to scaffold flow
    if (routingResult.intent === 'SCAFFOLD') {
      console.log('[IntentRouter] Routing to SCAFFOLD flow');
      await handleScaffoldFlow(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview, attachments || []);
      return;
    }

    // Check for active run that needs continuation
    if (activeRun && routingResult.intent !== 'RUN_COMMAND') {
      const commandDetection = detectCommandIntent(text);
      if (!commandDetection.isCommandIntent || commandDetection.confidence < 0.75) {
        console.log('[IntentRouter] Active run detected, routing to CONTINUE_RUN');
        await handleContinueRun(ctx, {
          clarificationAttempts: events.filter(e => e.type === 'clarification_requested').length,
          lastOpenEditor: vscode.window.activeTextEditor?.document.fileName,
          activeRun,
          lastAppliedDiff: ctx.getLastAppliedDiff(events),
        }, taskId, webview);
        return;
      }
    }

    // Map intent to effective behavior, respecting user's mode override
    let effectiveBehavior: string = routingResult.intent;
    if (userSelectedMode === 'PLAN' && effectiveBehavior !== 'CLARIFY') {
      effectiveBehavior = 'PLAN';
    } else if (userSelectedMode === 'ANSWER' && effectiveBehavior !== 'CLARIFY') {
      effectiveBehavior = 'ANSWER';
    }
    console.log(`[IntentRouter] Executing behavior: ${effectiveBehavior} (routed: ${routingResult.intent}, userSelected: ${userSelectedMode})`);

    switch (effectiveBehavior) {
      case 'ANSWER':
        console.log('>>> INTENT: ANSWER <<<');
        await handleAnswerMode(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview);
        break;

      case 'PLAN':
        console.log('>>> INTENT: PLAN <<<');
        await handlePlanMode(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview);
        break;

      case 'QUICK_ACTION':
        console.log('>>> INTENT: QUICK_ACTION <<<');
        await handleQuickAction(ctx, routingResult, text, effectivePrompt, taskId, modelId, webview);
        break;

      case 'RUN_COMMAND':
        console.log('>>> INTENT: RUN_COMMAND <<<');
        await handleQuickAction(ctx, routingResult, text, effectivePrompt, taskId, modelId, webview);
        break;

      case 'CLARIFY':
        console.log('>>> INTENT: CLARIFY <<<');
        await handleClarify(ctx, routingResult, taskId, webview);
        break;

      default:
        console.log(`[IntentRouter] Unhandled intent: ${effectiveBehavior}, falling back to PLAN`);
        await handlePlanMode(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview);
    }

    console.log('[IntentRouter] Routing complete');

  } catch (error) {
    console.error('Error handling submitPrompt:', error);
    vscode.window.showErrorMessage(`Ordinex: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleQuickAction (private helper)
// ---------------------------------------------------------------------------

/**
 * QUICK_ACTION behavior: either command execution or quick edit via MissionExecutor.
 */
async function handleQuickAction(
  ctx: IProvider,
  routingResult: IntentRoutingResult,
  promptForIntent: string,
  effectivePrompt: string,
  taskId: string,
  modelId: string | undefined,
  webview: vscode.Webview,
): Promise<void> {
  // STEP 34.5: Check if this is a command execution request
  const commandIntent = detectCommandIntent(promptForIntent);

  if (commandIntent.isCommandIntent && commandIntent.confidence >= 0.75) {
    // This is a COMMAND with high confidence - route to command execution phase
    console.log('[QUICK_ACTION] Detected command intent:', commandIntent);

    try {
      const workspaceRoot = ctx.scaffoldProjectPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (ctx.scaffoldProjectPath) {
        console.log(`[QUICK_ACTION] Using scaffoldProjectPath as workspace: ${workspaceRoot}`);
      }
      if (!workspaceRoot) {
        throw new Error('No workspace folder open');
      }

      if (!ctx.eventStore) {
        throw new Error('EventStore not initialized');
      }

      // Resolve command policy from VS Code settings
      const cfg = vscode.workspace.getConfiguration('ordinex');
      const userMode = cfg.get<string>('commandPolicy.mode');
      const commandPolicy = resolveCommandPolicy(
        userMode ? { mode: userMode as CommandMode } : undefined,
      );

      // Create EventBus for command phase (it needs emit() method)
      const commandEventBus = new EventBus(ctx.eventStore);

      // Subscribe to events for UI updates
      commandEventBus.subscribe(async (event) => {
        await ctx.sendEventsToWebview(webview, taskId);
      });

      // Build command phase context with all required properties
      const evidenceStore = new InMemoryEvidenceStore();

      const commandContext: CommandPhaseContext = {
        run_id: taskId,
        mission_id: undefined,
        step_id: undefined,
        workspaceRoot,
        eventBus: commandEventBus as any, // EventBus has emit() method that commandPhase needs
        mode: ctx.currentMode,
        previousStage: ctx.currentStage,
        commandPolicy,
        commands: commandIntent.inferredCommands || ['npm run dev'], // Use inferred commands or fallback
        executionContext: 'user' as any, // User-initiated command execution
        isReplayOrAudit: false,
        writeEvidence: async (type: string, content: string, summary: string) => {
          const evidenceId = ctx.generateId();
          await evidenceStore.store({
            evidence_id: evidenceId,
            type: type as any,
            source_event_id: taskId,
            content_ref: content,
            summary,
            created_at: new Date().toISOString()
          });
          return evidenceId;
        }
      };

      // Execute command phase
      console.log('[QUICK_ACTION] Running command phase...');
      const result = await runCommandPhase(commandContext);

      console.log('[QUICK_ACTION] Command phase completed:', result.status);

      if (result.status === 'awaiting_approval') {
        ctx.pendingCommandContexts.set(taskId, commandContext);
      } else {
        // Emit final event
        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'final',
          mode: ctx.currentMode,
          stage: 'command',
          payload: {
            success: result.status === 'success',
            command_result: result
          },
          evidence_ids: result.evidenceRefs || [],
          parent_event_id: null,
        });
      }

      await ctx.sendEventsToWebview(webview, taskId);

    } catch (error) {
      console.error('[QUICK_ACTION] Command execution error:', error);
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: 'MISSION',
        stage: ctx.currentStage,
        payload: {
          error: error instanceof Error ? error.message : 'Unknown error',
          kind: 'command_execution_failed'
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.sendEventsToWebview(webview, taskId);
      vscode.window.showErrorMessage(`Command execution failed: ${error}`);
    }
  } else {
    // This is an EDIT - use MissionExecutor pipeline
    console.log('[QUICK_ACTION] Using MissionExecutor edit pipeline (no plan UI)');

    try {
      const fileHint = 'target files';
      const stepDescription = `Edit ${fileHint} to resolve: ${effectivePrompt}`;

      const quickPlan: StructuredPlan = {
        goal: `Quick fix: ${effectivePrompt}`,
        assumptions: ['Single focused change', 'Minimal scope', 'Fast execution'],
        success_criteria: ['Issue resolved', 'No unintended changes'],
        scope_contract: {
          max_files: 5,
          max_lines: 200,
          allowed_tools: ['read', 'write']
        },
        steps: [
          {
            step_id: 'quick_step_1',
            description: stepDescription,
            expected_evidence: ['diff_proposed', 'diff_applied']
          }
        ],
        risks: ['May require clarification if file context is missing']
      };

      await handleExecutePlan(
        ctx,
        { taskId, planOverride: quickPlan, emitMissionStarted: true },
        webview
      );
    } catch (error) {
      console.error('[QUICK_ACTION] Error:', error);
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: 'MISSION',
        stage: ctx.currentStage,
        payload: {
          error: error instanceof Error ? error.message : 'Unknown error',
          kind: 'quick_action_failed'
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.sendEventsToWebview(webview, taskId);
      vscode.window.showErrorMessage(`Quick action failed: ${error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// handleClarify (private helper)
// ---------------------------------------------------------------------------

/**
 * CLARIFY behavior: emit clarification_requested + execution_paused events.
 */
async function handleClarify(
  ctx: IProvider,
  routingResult: IntentRoutingResult,
  taskId: string,
  webview: vscode.Webview,
): Promise<void> {
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'clarification_requested',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      question: 'Could you provide more details about what you\'d like me to do?',
      options: [],
      context_source: routingResult.source,
    },
    evidence_ids: [],
    parent_event_id: null,
  });

  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'execution_paused',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      reason: 'awaiting_clarification',
      description: 'Need more information to proceed'
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  await ctx.sendEventsToWebview(webview, taskId);
}

// ---------------------------------------------------------------------------
// handleContinueRun (private helper)
// ---------------------------------------------------------------------------

/**
 * CONTINUE_RUN behavior: show decision options for an active run.
 */
async function handleContinueRun(
  ctx: IProvider,
  analysisContext: IntentAnalysisContext,
  taskId: string,
  webview: vscode.Webview,
): Promise<void> {
  // Show options to resume, pause, or abort
  const activeRunStatus = analysisContext.activeRun;
  const statusText = activeRunStatus
    ? `An earlier run is ${activeRunStatus.status} (stage: ${activeRunStatus.stage}).`
    : 'An earlier run appears to be pending user input.';
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'decision_point_needed',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      decision_type: 'continue_run',
      title: 'Active Run Detected',
      description: `${statusText} Choose an action to continue.`,
      options: ['resume', 'pause', 'abort', 'propose_fix'],
      active_run: analysisContext.activeRun,
    },
    evidence_ids: [],
    parent_event_id: null,
  });

  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'execution_paused',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      reason: 'awaiting_continue_decision',
      description: 'Choose how to handle active mission'
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  await ctx.sendEventsToWebview(webview, taskId);
}
