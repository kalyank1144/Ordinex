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
} from 'core';
import * as vscode from 'vscode';
import {
  analyzeIntentWithFlow,
  detectActiveRun,
  isGreenfieldRequest,
  llmClassifyIntent,
  needsLlmClassification,
  detectCommandIntent,
  enrichUserInput,
  generateTemplatePlan,
  // Step 34.5: Command Execution imports
  runCommandPhase,
  CommandPhaseContext,
  resolveCommandPolicy,
  DEFAULT_COMMAND_POLICY,
  EventBus,
  InMemoryEvidenceStore,
} from 'core';

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

    // Intent analysis must see RAW user text, NOT enriched prompt with [Project: ...] metadata
    // that adds framework/noun keywords and triggers false greenfield detection
    const promptForIntent = text;

    // 2.5: Enrich follow-up prompt with scaffold context if available
    if (ctx.scaffoldProjectPath && ctx.eventStore && ctx.currentTaskId) {
      const recentEvents = ctx.eventStore.getEventsByTaskId(ctx.currentTaskId);
      const verifyErrors = recentEvents
        .filter((e: Event) => e.type === 'scaffold_verify_step_completed' && e.payload.step_status === 'fail')
        .map((e: Event) => `[${e.payload.step_name}] ${e.payload.message || ''}`)
        .join('\n');

      if (verifyErrors) {
        const scaffoldContext = `[Context: The scaffolded project at "${ctx.scaffoldProjectPath}" has build errors:\n${verifyErrors}\n]\n\n`;
        effectivePrompt = scaffoldContext + effectivePrompt;
        console.log('[ScaffoldContext] Enriched follow-up prompt with scaffold error context');
      } else {
        const scaffoldContext = `[Context: Working on scaffolded project at "${ctx.scaffoldProjectPath}"]\n\n`;
        effectivePrompt = scaffoldContext + effectivePrompt;
        console.log('[ScaffoldContext] Enriched follow-up prompt with scaffold path context');
      }
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
    if (enrichedInput?.clarificationNeeded) {
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
    }

    // 3. STEP 33: Build intent analysis context
    const events = ctx.eventStore?.getEventsByTaskId(taskId) || [];
    const activeRun = detectActiveRun(events);
    const analysisContext: IntentAnalysisContext = {
      clarificationAttempts: events.filter(e => e.type === 'clarification_requested').length,
      lastOpenEditor: vscode.window.activeTextEditor?.document.fileName,
      activeRun: activeRun === null ? undefined : activeRun,
      lastAppliedDiff: ctx.getLastAppliedDiff(events),
    };
    console.log('[Step33] Analysis context:', analysisContext);

    // 4. STEP 33: Analyze intent using ENRICHED prompt (behavior-first) with flow_kind detection
    const commandDetection = detectCommandIntent(promptForIntent);
    console.log('[Step33] Command detection:', commandDetection);

    // Use analyzeIntentWithFlow to get flow_kind for greenfield detection
    let analysisWithFlow = analyzeIntentWithFlow(promptForIntent, analysisContext);
    let analysis = analysisWithFlow; // Same object, but typed to include flow_kind

    console.log('[Step35] Flow kind:', analysisWithFlow.flow_kind);
    console.log('[Step35] Is greenfield request:', isGreenfieldRequest(promptForIntent));

    // LLM classifier fallback: when heuristics are ambiguous, use Haiku for classification
    const greenfieldSignal = isGreenfieldRequest(promptForIntent);
    const greenfieldConfidence = greenfieldSignal ? 0.9 : 0.1;
    const commandConfidence = commandDetection.confidence;
    if (needsLlmClassification(greenfieldConfidence, commandConfidence, analysis.confidence)) {
      try {
        const apiKey = await ctx._context.secrets.get('ordinex.apiKey');
        if (apiKey) {
          console.log('[LLM Classifier] Heuristics ambiguous — calling Haiku for classification');
          const llmResult = await llmClassifyIntent({
            text: promptForIntent,
            contextHint: ctx.scaffoldProjectPath ? 'Working in scaffolded project' : undefined,
            llmConfig: { apiKey, model: 'claude-haiku-4-5-20251001' },
          });
          console.log('[LLM Classifier] Result:', llmResult);

          if (llmResult.confidence >= 0.7) {
            // Map LLM intent to behavior/flow_kind override
            const intentToBehavior: Record<string, string> = {
              'SCAFFOLD': 'PLAN',
              'RUN_COMMAND': 'QUICK_ACTION',
              'PLAN': 'PLAN',
              'QUICK_ACTION': 'QUICK_ACTION',
              'ANSWER': 'ANSWER',
            };
            const intentToFlowKind: Record<string, string> = {
              'SCAFFOLD': 'scaffold',
              'RUN_COMMAND': 'standard',
              'PLAN': 'standard',
              'QUICK_ACTION': 'standard',
              'ANSWER': 'standard',
            };

            const mappedBehavior = intentToBehavior[llmResult.intent];
            const mappedFlowKind = intentToFlowKind[llmResult.intent];

            if (mappedBehavior) {
              console.log(`[LLM Classifier] Overriding behavior: ${analysis.behavior} → ${mappedBehavior}, flow: ${analysisWithFlow.flow_kind} → ${mappedFlowKind}`);
              analysis = {
                ...analysis,
                behavior: mappedBehavior as any,
                derived_mode: (llmResult.intent === 'ANSWER' ? 'ANSWER' : llmResult.intent === 'SCAFFOLD' ? 'SCAFFOLD' : 'MISSION') as Mode,
                reasoning: `LLM classifier: ${llmResult.reason}`,
                confidence: llmResult.confidence,
              };
              analysisWithFlow = { ...analysisWithFlow, flow_kind: mappedFlowKind as any };
            }
          }
        }
      } catch (llmError) {
        console.warn('[LLM Classifier] Fallback failed (graceful degradation):', llmError);
      }
    }

    // If a clear command intent is detected, do not block on stale active-run state
    if (analysis.behavior === 'CONTINUE_RUN' && commandDetection.isCommandIntent && commandDetection.confidence >= 0.75) {
      console.log('[Step33] Overriding CONTINUE_RUN due to command intent');
      analysis = {
        ...analysis,
        behavior: 'QUICK_ACTION',
        derived_mode: 'MISSION',
        reasoning: `Command intent override: ${commandDetection.reasoning}`,
      };
    }

    console.log('[Step33] Intent analysis:', {
      behavior: analysis.behavior,
      derived_mode: analysis.derived_mode,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning
    });

    // 4. Emit mode_set with Step 33 analysis
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'mode_set',
      mode: analysis.derived_mode,
      stage: ctx.currentStage,
      payload: {
        mode: analysis.derived_mode,
        effectiveMode: analysis.derived_mode,
        behavior: analysis.behavior,
        user_selected_mode: userSelectedMode,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    await ctx.setModeWithEvent(analysis.derived_mode, taskId, {
      reason: `Intent analysis derived mode: ${analysis.behavior}`,
      user_initiated: false,
    });
    await ctx.sendEventsToWebview(webview, taskId);

    // 5. STEP 35 FIX: SCAFFOLD CHECK BEFORE BEHAVIOR SWITCH
    // Greenfield requests route to scaffold flow UNLESS a clear command intent overrides
    const commandOverridesScaffold = commandDetection.isCommandIntent && commandDetection.confidence >= 0.75;

    if (analysisWithFlow.flow_kind === 'scaffold' && !commandOverridesScaffold) {
      console.log('[Step35] SCAFFOLD flow detected - routing DIRECTLY to scaffold handler');
      console.log('[Step35] Bypassing behavior switch (was:', analysis.behavior, ')');
      await handleScaffoldFlow(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview, attachments || []);
      console.log('[Step33] Behavior handling complete (scaffold flow)');
      return; // Exit early - scaffold flow handles everything
    }

    // Command intent overrides scaffold flow (e.g., "new start dev server")
    if (commandOverridesScaffold && analysisWithFlow.flow_kind === 'scaffold') {
      console.log('[Step35] Command intent overrides scaffold flow:', commandDetection.reasoning);
      analysis = { ...analysis, behavior: 'QUICK_ACTION', derived_mode: 'MISSION' as Mode, reasoning: `Command override: ${commandDetection.reasoning}` };
      analysisWithFlow = { ...analysisWithFlow, flow_kind: 'standard' };
    }

    // 6. STEP 33: Handle behavior-specific logic (non-scaffold)
    console.log(`[Step33] Executing behavior: ${analysis.behavior}`);

    switch (analysis.behavior) {
      case 'ANSWER':
        console.log('>>> BEHAVIOR: ANSWER <<<');
        await handleAnswerMode(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview);
        break;

      case 'PLAN':
        console.log('>>> BEHAVIOR: PLAN <<<');
        // Note: Scaffold flow is now handled BEFORE the behavior switch
        // If we reach here, it's a standard PLAN flow
        console.log('[Step35] Standard PLAN flow');
        await handlePlanMode(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview);
        break;

      case 'QUICK_ACTION':
        console.log('>>> BEHAVIOR: QUICK_ACTION <<<');
        await handleQuickAction(ctx, analysis, promptForIntent, effectivePrompt, taskId, modelId, webview);
        break;

      case 'CLARIFY':
        console.log('>>> BEHAVIOR: CLARIFY <<<');
        await handleClarify(ctx, analysis, taskId, webview);
        break;

      case 'CONTINUE_RUN':
        console.log('>>> BEHAVIOR: CONTINUE_RUN <<<');
        await handleContinueRun(ctx, analysisContext, taskId, webview);
        break;

      default:
        console.error(`[Step33] Unknown behavior: ${analysis.behavior}`);
        // Fallback to MISSION mode
        const fallbackPlan = generateTemplatePlan(text, 'MISSION');
        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'plan_created',
          mode: 'MISSION',
          stage: ctx.currentStage,
          payload: fallbackPlan as unknown as Record<string, unknown>,
          evidence_ids: [],
          parent_event_id: null,
        });
        await ctx.sendEventsToWebview(webview, taskId);
    }

    console.log('[Step33] Behavior handling complete');

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
  analysis: any,
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

      // Resolve command policy
      const commandPolicy = resolveCommandPolicy(
        DEFAULT_COMMAND_POLICY,
        {} // workspace settings - TODO: wire up from VS Code settings
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
      const referencedFiles = analysis.referenced_files || [];
      const fileHint = referencedFiles.length > 0 ? referencedFiles.join(', ') : 'target files';
      const stepDescription = `Edit ${fileHint} to resolve: ${effectivePrompt}`;

      const quickPlan: StructuredPlan = {
        goal: `Quick fix: ${effectivePrompt}`,
        assumptions: ['Single focused change', 'Minimal scope', 'Fast execution'],
        success_criteria: ['Issue resolved', 'No unintended changes'],
        scope_contract: {
          max_files: referencedFiles.length > 0 ? referencedFiles.length : 3,
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
  analysis: any,
  taskId: string,
  webview: vscode.Webview,
): Promise<void> {
  // Emit clarification_requested event
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'clarification_requested',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      question: analysis.clarification?.question || 'Could you provide more details?',
      options: analysis.clarification?.options || [],
      context_source: analysis.context_source,
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
