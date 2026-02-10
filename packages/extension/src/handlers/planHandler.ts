/**
 * Plan Handler — extracted from MissionControlViewProvider.
 *
 * All functions take `ctx: IProvider` as first parameter instead of using `this`.
 * Covers: handlePlanMode, generateAndEmitPlan, inferStack, handleExportRun,
 * handleRequestPlanApproval, handleResolvePlanApproval, handleRefinePlan,
 * handleSelectClarificationOption, handleSkipClarification.
 */

import type { IProvider } from '../handlerContext';
import type {
  Event,
  LightContextBundle,
  ClarificationOption,
  StructuredPlan,
  ExportResult,
  PlanStepForAnalysis,
} from 'core';
import * as vscode from 'vscode';
import * as path from 'path';
import {
  collectLightContext,
  assessPromptClarity,
  shouldShowClarification,
  generateClarificationOptions,
  buildEnrichedPrompt,
  buildFallbackPrompt,
  generateLLMPlan,
  refinePlan,
  EventBus,
  shouldBreakIntoMissions,
  detectLargePlan,
  buildPlanTextForAnalysis,
  generateMissionBreakdown,
  exportRun,
} from 'core';

// ---------------------------------------------------------------------------
// handlePlanMode
// ---------------------------------------------------------------------------

/**
 * Handle PLAN mode: Deterministic Ground -> Ask -> Plan pipeline
 *
 * Flow:
 * 1. Collect light context (< 3s)
 * 2. Assess prompt clarity (heuristic, no LLM)
 * 3. If low/medium clarity: show clarification card, pause
 * 4. On selection: build enriched prompt, generate LLM plan
 *
 * NEVER emits tool_start tool="llm_answer" in PLAN mode
 */
export async function handlePlanMode(
  ctx: IProvider,
  userPrompt: string,
  taskId: string,
  modelId: string,
  webview: vscode.Webview,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:PlanEnhancement]';
  console.log('=== PLAN MODE START (Deterministic v2) ===');
  console.log('Prompt:', userPrompt);
  console.log('Task ID:', taskId);
  console.log('Model ID:', modelId);

  try {
    // Store original prompt for later use
    ctx.planModeOriginalPrompt = userPrompt;

    // 1. Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // 2. LIGHT CONTEXT COLLECTION (< 3s budget)
    console.log(`${LOG_PREFIX} Step 1: Collecting light context...`);

    const lightContext = await collectLightContext(workspaceRoot);
    ctx.planModeContext = lightContext; // Store for selection handling

    // Emit context_collected event with level:"light"
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'context_collected',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        level: 'light',
        stack: lightContext.stack,
        top_dirs: lightContext.top_dirs,
        anchor_files: lightContext.anchor_files,
        todo_count: lightContext.todo_count,
        files_scanned: lightContext.files_scanned,
        scan_duration_ms: lightContext.scan_duration_ms,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);
    console.log(`${LOG_PREFIX} Light context collected in ${lightContext.scan_duration_ms}ms`);

    // 3. PROMPT ASSESSMENT (Heuristic only, no LLM)
    console.log(`${LOG_PREFIX} Step 2: Assessing prompt clarity (heuristic)...`);

    const assessment = assessPromptClarity(userPrompt, lightContext.anchor_files);

    // Emit prompt_assessed event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'prompt_assessed',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        clarity: assessment.clarity,
        clarity_score: assessment.clarity_score,
        intent: assessment.intent,
        reasoning: assessment.reasoning,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);
    console.log(`${LOG_PREFIX} Prompt assessed: clarity=${assessment.clarity}, score=${assessment.clarity_score}`);

    // Optional: Show hint if intent is answer_like and clarity is high
    if (assessment.intent === 'answer_like' && assessment.clarity === 'high') {
      vscode.window.showInformationMessage(
        'This looks like a question. You can also use ANSWER mode.',
        'Switch to ANSWER',
      ).then(action => {
        if (action === 'Switch to ANSWER') {
          // User can manually switch - we don't auto-switch per spec
        }
      });
    }

    // 4. CLARIFICATION DECISION
    const needsClarification = shouldShowClarification(assessment, userPrompt);

    if (needsClarification) {
      // SHOW CLARIFICATION CARD
      console.log(`${LOG_PREFIX} Clarity ${assessment.clarity} - showing clarification card`);

      // Generate deterministic options
      const options = generateClarificationOptions(lightContext, userPrompt);
      console.log(`${LOG_PREFIX} Generated ${options.length} options:`, options.map(o => o.id));

      // Emit clarification_presented event
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'clarification_presented',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          task_id: taskId,
          options: options,
          fallback_option_id: 'fallback-suggest',
          anchor_files_count: lightContext.anchor_files.length,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      // Emit execution_paused with awaiting_selection
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'execution_paused',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          reason: 'awaiting_selection',
          description: 'Choose a focus area to generate a targeted plan',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await ctx.sendEventsToWebview(webview, taskId);

      // Send clarification data to webview for rendering
      webview.postMessage({
        type: 'ordinex:clarificationPresented',
        task_id: taskId,
        options: options,
        fallback_option_id: 'fallback-suggest',
        anchor_files_count: lightContext.anchor_files.length,
      });

      console.log(`${LOG_PREFIX} Execution paused - awaiting user selection`);
      return; // Stop here - wait for user selection
    }

    // HIGH CLARITY: Skip clarification, go directly to LLM plan
    console.log(`${LOG_PREFIX} High clarity - skipping clarification, generating plan directly`);
    try {
      await generateAndEmitPlan(ctx, userPrompt, taskId, modelId, webview, lightContext, null);
    } catch (planError) {
      console.error(`${LOG_PREFIX} Plan generation failed:`, planError);

      // Emit failure_detected so user sees what went wrong
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          error: planError instanceof Error ? planError.message : 'Plan generation failed',
          suggestion: 'Check API key is set (Cmd+Shift+P \u2192 "Ordinex: Set API Key") or try a more exploratory prompt',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await ctx.sendEventsToWebview(webview, taskId);

      vscode.window.showErrorMessage(
        `Plan generation failed: ${planError instanceof Error ? planError.message : 'Unknown error'}. Check if API key is configured.`,
        'Set API Key',
      ).then(action => {
        if (action === 'Set API Key') {
          vscode.commands.executeCommand('ordinex.setApiKey');
        }
      });
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error in PLAN mode:`, error);

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
        stack: error instanceof Error ? error.stack : undefined,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    vscode.window.showErrorMessage(`PLAN mode failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ---------------------------------------------------------------------------
// generateAndEmitPlan
// ---------------------------------------------------------------------------

/**
 * Generate and emit LLM plan (called after clarification selection or for high clarity)
 */
export async function generateAndEmitPlan(
  ctx: IProvider,
  userPrompt: string,
  taskId: string,
  modelId: string,
  webview: vscode.Webview,
  lightContext: LightContextBundle,
  selectedOption: ClarificationOption | null,
): Promise<void> {
  const LOG_PREFIX = '[Ordinex:PlanEnhancement]';

  // Get API key
  const apiKey = await ctx._context.secrets.get('ordinex.apiKey');
  if (!apiKey) {
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'failure_detected',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        error: 'No API key configured',
        suggestion: 'Run command "Ordinex: Set API Key" to configure your Anthropic API key',
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    vscode.window.showErrorMessage(
      'Ordinex API key not found. Please run "Ordinex: Set API Key" command.',
      'Set API Key',
    ).then(action => {
      if (action === 'Set API Key') {
        vscode.commands.executeCommand('ordinex.setApiKey');
      }
    });

    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
  const openFiles = vscode.workspace.textDocuments
    .filter(doc => doc.uri.scheme === 'file')
    .map(doc => ({
      path: vscode.workspace.asRelativePath(doc.uri),
      content: doc.getText(),
    }));

  if (!ctx.eventStore) {
    throw new Error('EventStore not initialized');
  }
  const eventBus = new EventBus(ctx.eventStore);

  // Build the final prompt
  let finalPrompt: string;

  if (selectedOption) {
    // User selected a focus area OR clicked skip/fallback
    if (selectedOption.id === 'fallback-suggest') {
      finalPrompt = buildFallbackPrompt(userPrompt, lightContext);
      console.log(`${LOG_PREFIX} Using fallback prompt for idea suggestions`);
    } else {
      finalPrompt = buildEnrichedPrompt(userPrompt, selectedOption, lightContext);
      console.log(`${LOG_PREFIX} Using enriched prompt for focus: ${selectedOption.title}`);
    }
  } else {
    // High clarity, no selection needed - use original prompt
    finalPrompt = userPrompt;
    console.log(`${LOG_PREFIX} Using original prompt (high clarity)`);
  }

  // Emit tool_start for llm_plan (NOT llm_answer)
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'tool_start',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      tool: 'llm_plan',
      tool_name: 'llm_plan',
      prompt_length: finalPrompt.length,
      focus: selectedOption?.title || 'original_prompt',
    },
    evidence_ids: [],
    parent_event_id: null,
  });

  await ctx.sendEventsToWebview(webview, taskId);

  console.log(`${LOG_PREFIX} Step 3: Generating LLM plan...`);

  const plan = await generateLLMPlan(
    finalPrompt,
    taskId,
    eventBus,
    {
      apiKey,
      model: modelId,
      maxTokens: 4096,
    },
    workspaceRoot,
    openFiles,
  );

  // Emit tool_end for llm_plan
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'tool_end',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: {
      tool: 'llm_plan',
      tool_name: 'llm_plan',
      success: true,
      steps_count: plan.steps.length,
    },
    evidence_ids: [],
    parent_event_id: null,
  });

  console.log(`${LOG_PREFIX} Step 4: Plan generated successfully`);
  console.log(`${LOG_PREFIX} Plan goal:`, plan.goal);
  console.log(`${LOG_PREFIX} Plan steps:`, plan.steps.length);

  // Emit plan_created event with the structured plan
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'plan_created',
    mode: ctx.currentMode,
    stage: ctx.currentStage,
    payload: plan as unknown as Record<string, unknown>,
    evidence_ids: [],
    parent_event_id: null,
  });

  // Send updated events to webview
  await ctx.sendEventsToWebview(webview, taskId);

  // Also send plan created message
  webview.postMessage({
    type: 'ordinex:planCreated',
    task_id: taskId,
    plan: plan,
  });

  console.log(`${LOG_PREFIX} PLAN mode completed successfully`);
}

// ---------------------------------------------------------------------------
// inferStack
// ---------------------------------------------------------------------------

/**
 * Infer technology stack from file names and extensions
 */
export function inferStack(
  _ctx: IProvider,
  files: string[],
  openFiles: string[],
): string[] {
  const stack: Set<string> = new Set();

  const allFiles = [...files, ...openFiles];

  // Check for common technology indicators
  if (allFiles.some(f => f.includes('package.json'))) stack.add('Node.js');
  if (allFiles.some(f => f.endsWith('.ts') || f.endsWith('.tsx'))) stack.add('TypeScript');
  if (allFiles.some(f => f.endsWith('.jsx') || f.includes('react'))) stack.add('React');
  if (allFiles.some(f => f.includes('vue'))) stack.add('Vue');
  if (allFiles.some(f => f.includes('angular'))) stack.add('Angular');
  if (allFiles.some(f => f.endsWith('.py'))) stack.add('Python');
  if (allFiles.some(f => f.endsWith('.java'))) stack.add('Java');
  if (allFiles.some(f => f.endsWith('.go'))) stack.add('Go');
  if (allFiles.some(f => f.endsWith('.rs'))) stack.add('Rust');
  if (allFiles.some(f => f.includes('Cargo.toml'))) stack.add('Rust');
  if (allFiles.some(f => f.includes('go.mod'))) stack.add('Go');
  if (allFiles.some(f => f.includes('requirements.txt') || f.includes('setup.py'))) stack.add('Python');

  return Array.from(stack);
}

// ---------------------------------------------------------------------------
// handleExportRun
// ---------------------------------------------------------------------------

export async function handleExportRun(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { taskId } = message;

  if (!taskId) {
    console.error('Missing taskId in exportRun');
    return;
  }

  try {
    if (!ctx.eventStore) {
      throw new Error('EventStore not initialized');
    }

    // Get events for this task
    const events = ctx.eventStore.getEventsByTaskId(taskId);

    if (events.length === 0) {
      vscode.window.showWarningMessage('No events to export for this task');
      return;
    }

    // Get workspace info
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name;
    const evidenceDir = path.join(ctx._context.globalStorageUri.fsPath, 'evidence');
    const extensionVersion = vscode.extensions.getExtension('ordinex.ordinex')?.packageJSON?.version || '0.0.0';

    // Show progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting Run',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Creating export archive...' });

        // Call export function
        const result: ExportResult = await exportRun({
          taskId,
          events,
          evidenceDir,
          workspaceRoot,
          workspaceName,
          extensionVersion,
        });

        if (result.success && result.zipPath) {
          // Show success message with option to reveal
          const action = await vscode.window.showInformationMessage(
            `Run exported successfully to: ${path.basename(result.zipPath)}`,
            'Open Folder',
            'Copy Path',
          );

          if (action === 'Open Folder') {
            // Reveal in file explorer
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.zipPath));
          } else if (action === 'Copy Path') {
            // Copy path to clipboard
            await vscode.env.clipboard.writeText(result.zipPath);
            vscode.window.showInformationMessage('Export path copied to clipboard');
          }

          // Send success message to webview
          webview.postMessage({
            type: 'ordinex:exportComplete',
            success: true,
            zipPath: result.zipPath,
            exportDir: result.exportDir,
          });

          console.log('Run exported successfully:', result.zipPath);
        } else {
          throw new Error(result.error || 'Export failed');
        }
      },
    );
  } catch (error) {
    console.error('Error handling exportRun:', error);
    vscode.window.showErrorMessage(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

    // Send error message to webview
    webview.postMessage({
      type: 'ordinex:exportComplete',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// ---------------------------------------------------------------------------
// handleRequestPlanApproval
// ---------------------------------------------------------------------------

export async function handleRequestPlanApproval(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id, plan_id } = message;

  if (!task_id || !plan_id) {
    console.error('Missing required fields in requestPlanApproval');
    return;
  }

  try {
    // Get events to extract plan details
    const events = ctx.eventStore?.getEventsByTaskId(task_id) || [];
    const planEvent = events.find((e: Event) => e.event_id === plan_id);

    if (!planEvent || (planEvent.type !== 'plan_created' && planEvent.type !== 'plan_revised')) {
      console.error('Plan event not found');
      return;
    }

    // Check for existing pending approval for this plan (idempotent)
    const existingApproval = events.find(
      (e: Event) =>
        e.type === 'approval_requested' &&
        e.payload.approval_type === 'plan_approval' &&
        e.payload.details &&
        (e.payload.details as any).plan_id === plan_id &&
        // Check if not already resolved
        !events.some(
          (re: Event) =>
            re.type === 'approval_resolved' &&
            re.payload.approval_id === e.payload.approval_id,
        ),
    );

    if (existingApproval) {
      console.log('Plan approval already pending, not creating duplicate');
      // Just re-send events to update UI
      await ctx.sendEventsToWebview(webview, task_id);
      return;
    }

    const plan = planEvent.payload;
    const approvalId = ctx.generateId();

    // Check if plan is too large/complex
    const sizeCheck = shouldBreakIntoMissions(plan as any as StructuredPlan);

    // Emit approval_requested event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'approval_requested',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        approval_id: approvalId,
        approval_type: 'plan_approval',
        description: 'Approve plan to start mission',
        details: {
          plan_id: plan_id,
          goal: (plan as any).goal || '',
          steps_count: ((plan as any).steps || []).length,
          scope_contract: (plan as any).scope_contract || {},
          risks: (plan as any).risks || [],
          size_check: sizeCheck,
        },
        risk_level: 'low',
      },
      evidence_ids: [],
      parent_event_id: plan_id,
    });

    // Emit execution_paused with specific reason
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'execution_paused',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        reason: 'awaiting_plan_approval',
        description: 'Waiting for plan approval before proceeding',
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Send updated events to webview
    await ctx.sendEventsToWebview(webview, task_id);

    console.log('Plan approval requested:', approvalId);
  } catch (error) {
    console.error('Error handling requestPlanApproval:', error);
    vscode.window.showErrorMessage(`Failed to request plan approval: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleResolvePlanApproval
// ---------------------------------------------------------------------------

export async function handleResolvePlanApproval(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id, approval_id, decision } = message;

  if (!task_id || !approval_id || !decision) {
    console.error('Missing required fields in resolvePlanApproval');
    return;
  }

  try {
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

    // Emit approval_resolved event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'approval_resolved',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        approval_id: approval_id,
        decision: decision,
        approved: approved,
        decided_at: new Date().toISOString(),
      },
      evidence_ids: [],
      parent_event_id: approvalRequest.event_id,
    });

    if (approved) {
      // Switch mode to MISSION
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'mode_set',
        mode: 'MISSION',
        stage: ctx.currentStage,
        payload: {
          mode: 'MISSION',
          effectiveMode: 'MISSION',
          previous_mode: ctx.currentMode,
          reason: 'Plan approved - switching to MISSION mode',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await ctx.setModeWithEvent('MISSION', task_id, {
        reason: 'Plan approved - switching to MISSION mode',
        user_initiated: true,
      });

      // STEP 26: Check if plan is too large and needs breakdown
      const planEvents = events.filter(
        (e: Event) => e.type === 'plan_created' || e.type === 'plan_revised',
      );
      const planEvent = planEvents[planEvents.length - 1];

      if (planEvent) {
        const plan = planEvent.payload as any;
        const planId = planEvent.event_id;
        const planVersion = (plan.plan_version as number) || 1;

        // Convert plan steps to format needed for analysis
        const stepsForAnalysis: PlanStepForAnalysis[] = (plan.steps || []).map(
          (step: any, index: number) => ({
            step_id: step.id || step.step_id || `step_${index + 1}`,
            description: step.description || '',
            expected_evidence: step.expected_evidence || [],
          }),
        );

        // Build plan text for analysis
        const planText = buildPlanTextForAnalysis(plan.goal || '', stepsForAnalysis);

        // Detect if plan is large
        const detection = detectLargePlan(stepsForAnalysis, planText, {});

        console.log('[handleResolvePlanApproval] Large plan detection:', {
          largePlan: detection.largePlan,
          score: detection.score,
          reasons: detection.reasons,
        });

        if (detection.largePlan) {
          // Emit plan_large_detected event
          await ctx.emitEvent({
            event_id: ctx.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'plan_large_detected',
            mode: 'MISSION',
            stage: ctx.currentStage,
            payload: {
              plan_id: planId,
              plan_version: planVersion,
              large_plan: true,
              score: detection.score,
              reasons: detection.reasons,
              metrics: detection.metrics,
            },
            evidence_ids: [],
            parent_event_id: planId,
          });

          // Generate mission breakdown
          const breakdown = generateMissionBreakdown(
            planId,
            planVersion,
            plan.goal || '',
            stepsForAnalysis,
            detection,
          );

          console.log(
            '[handleResolvePlanApproval] Generated breakdown with',
            breakdown.missions.length,
            'missions',
          );

          // Emit mission_breakdown_created event
          await ctx.emitEvent({
            event_id: ctx.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'mission_breakdown_created',
            mode: 'MISSION',
            stage: ctx.currentStage,
            payload: {
              plan_id: planId,
              plan_version: planVersion,
              breakdown_id: breakdown.breakdownId,
              missions: breakdown.missions,
            },
            evidence_ids: [],
            parent_event_id: planId,
          });

          // Emit execution_paused awaiting mission selection (NOT execute_plan)
          await ctx.emitEvent({
            event_id: ctx.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'execution_paused',
            mode: 'MISSION',
            stage: ctx.currentStage,
            payload: {
              reason: 'awaiting_mission_selection',
              description: 'Plan is too large - select ONE mission to execute',
            },
            evidence_ids: [],
            parent_event_id: null,
          });
        } else {
          // Plan is NOT large - proceed directly to Execute Plan
          await ctx.emitEvent({
            event_id: ctx.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'execution_paused',
            mode: 'MISSION',
            stage: ctx.currentStage,
            payload: {
              reason: 'awaiting_execute_plan',
              description: 'Plan approved - ready to execute',
            },
            evidence_ids: [],
            parent_event_id: null,
          });
        }
      } else {
        // No plan found - fallback to awaiting_execute_plan
        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: 'MISSION',
          stage: ctx.currentStage,
          payload: {
            reason: 'awaiting_execute_plan',
            description: 'Plan approved - ready to execute',
          },
          evidence_ids: [],
          parent_event_id: null,
        });
      }
    } else {
      // Plan rejected - remain in PLAN mode
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'execution_paused',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          reason: 'plan_rejected',
          description: 'Plan rejected by user',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
    }

    // Send updated events to webview
    await ctx.sendEventsToWebview(webview, task_id);

    console.log('Plan approval resolved:', { approved, decision });
  } catch (error) {
    console.error('Error handling resolvePlanApproval:', error);
    vscode.window.showErrorMessage(`Failed to resolve plan approval: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleRefinePlan
// ---------------------------------------------------------------------------

export async function handleRefinePlan(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id, plan_id, refinement_text } = message;

  if (!task_id || !plan_id || !refinement_text) {
    console.error('Missing required fields in refinePlan');
    return;
  }

  try {
    // Get API key
    const apiKey = await ctx._context.secrets.get('ordinex.apiKey');
    if (!apiKey) {
      vscode.window.showErrorMessage('API key not configured');
      return;
    }

    // Get events to extract plan and original prompt
    const events = ctx.eventStore?.getEventsByTaskId(task_id) || [];
    const planEvent = events.find((e: Event) => e.event_id === plan_id);
    const intentEvent = events.find((e: Event) => e.type === 'intent_received');

    if (!planEvent || (planEvent.type !== 'plan_created' && planEvent.type !== 'plan_revised')) {
      console.error('Plan event not found');
      return;
    }

    const originalPlan = planEvent.payload as any as StructuredPlan;
    const originalPrompt = (intentEvent?.payload.prompt as string) || '';

    // Get workspace info
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const openFiles = vscode.workspace.textDocuments
      .filter(doc => doc.uri.scheme === 'file')
      .map(doc => ({
        path: vscode.workspace.asRelativePath(doc.uri),
        content: doc.getText(),
      }));

    // Initialize event bus
    if (!ctx.eventStore) {
      throw new Error('EventStore not initialized');
    }
    const eventBus = new EventBus(ctx.eventStore);

    // Cancel pending approvals for old plan
    const pendingApprovals = events.filter(
      (e: Event) =>
        e.type === 'approval_requested' &&
        e.payload.approval_type === 'plan_approval' &&
        e.payload.details &&
        (e.payload.details as any).plan_id === plan_id &&
        // Check if not already resolved
        !events.some(
          (re: Event) =>
            re.type === 'approval_resolved' &&
            re.payload.approval_id === e.payload.approval_id,
        ),
    );

    for (const approval of pendingApprovals) {
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'approval_resolved',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          approval_id: approval.payload.approval_id,
          decision: 'denied',
          approved: false,
          reason: 'superseded',
          decided_at: new Date().toISOString(),
        },
        evidence_ids: [],
        parent_event_id: approval.event_id,
      });
    }

    // Show progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Refining Plan',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Calling LLM to refine plan...' });

        // Call refinePlan
        const revisedPlan = await refinePlan(
          originalPlan,
          originalPrompt,
          refinement_text,
          task_id,
          eventBus,
          {
            apiKey,
            model: 'claude-3-haiku',
            maxTokens: 4096,
          },
          workspaceRoot,
          openFiles,
        );

        // Emit plan_revised event
        await ctx.emitEvent({
          event_id: ctx.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'plan_revised',
          mode: ctx.currentMode,
          stage: ctx.currentStage,
          payload: {
            ...revisedPlan,
            previous_plan_id: plan_id,
            refinement_instruction: refinement_text,
          } as unknown as Record<string, unknown>,
          evidence_ids: [],
          parent_event_id: plan_id,
        });

        // Send updated events to webview
        await ctx.sendEventsToWebview(webview, task_id);

        console.log('Plan refined successfully');
      },
    );
  } catch (error) {
    console.error('Error handling refinePlan:', error);
    vscode.window.showErrorMessage(`Failed to refine plan: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// handleSelectClarificationOption
// ---------------------------------------------------------------------------

/**
 * Handle clarification option selection (PLAN mode v2)
 */
export async function handleSelectClarificationOption(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id, option_id } = message;
  const LOG_PREFIX = '[Ordinex:PlanEnhancement]';

  if (!task_id || !option_id) {
    console.error('Missing required fields in selectClarificationOption');
    return;
  }

  console.log(`${LOG_PREFIX} Selection received: option_id=${option_id}`);

  try {
    // Get events to find the clarification_presented event and extract options
    const events = ctx.eventStore?.getEventsByTaskId(task_id) || [];
    const clarificationEvent = events.find((e: Event) => e.type === 'clarification_presented');

    if (!clarificationEvent) {
      console.error('No clarification_presented event found');
      vscode.window.showErrorMessage('Failed to send selection. Please try again.');
      return;
    }

    const options = clarificationEvent.payload.options as ClarificationOption[];
    const selectedOption = options.find((o: ClarificationOption) => o.id === option_id);

    if (!selectedOption) {
      console.error('Selected option not found:', option_id);
      vscode.window.showErrorMessage('Failed to send selection. Please try again.');
      return;
    }

    // Emit clarification_received event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'clarification_received',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        option_id: selectedOption.id,
        title: selectedOption.title,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, task_id);

    // Get original prompt and context
    const intentEvent = events.find((e: Event) => e.type === 'intent_received');
    const userPrompt = ctx.planModeOriginalPrompt || (intentEvent?.payload.prompt as string) || '';
    const modelId = (intentEvent?.payload.model_id as string) || 'sonnet-4.5';

    // Use stored context or re-collect
    const lightContext = ctx.planModeContext;
    if (!lightContext) {
      console.error('No light context available');
      vscode.window.showErrorMessage('Plan generation failed. Try again or choose "Skip and suggest ideas".');
      return;
    }

    // Generate plan with selected option
    console.log(`${LOG_PREFIX} Generating plan with focus: ${selectedOption.title}`);
    await generateAndEmitPlan(ctx, userPrompt, task_id, modelId, webview, lightContext, selectedOption);
  } catch (error) {
    console.error('Error handling selectClarificationOption:', error);
    vscode.window.showErrorMessage('Plan generation failed. Try again or choose "Skip and suggest ideas".');
  }
}

// ---------------------------------------------------------------------------
// handleSkipClarification
// ---------------------------------------------------------------------------

/**
 * Handle skip clarification (PLAN mode v2)
 * Skip NEVER pauses - always generates a useful plan
 */
export async function handleSkipClarification(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { task_id } = message;
  const LOG_PREFIX = '[Ordinex:PlanEnhancement]';

  if (!task_id) {
    console.error('Missing task_id in skipClarification');
    return;
  }

  console.log(`${LOG_PREFIX} Skip clarification - generating fallback plan`);

  try {
    // Get events to find context
    const events = ctx.eventStore?.getEventsByTaskId(task_id) || [];
    const intentEvent = events.find((e: Event) => e.type === 'intent_received');
    const userPrompt = ctx.planModeOriginalPrompt || (intentEvent?.payload.prompt as string) || '';
    const modelId = (intentEvent?.payload.model_id as string) || 'sonnet-4.5';

    // Use stored context or re-collect
    const lightContext = ctx.planModeContext;
    if (!lightContext) {
      console.error('No light context available');
      vscode.window.showErrorMessage('Plan generation failed. Please try again.');
      return;
    }

    // Create fallback option
    const fallbackOption: ClarificationOption = {
      id: 'fallback-suggest',
      title: 'Suggest ideas based on analysis',
      description: 'Let me analyze and suggest 5\u20138 feature ideas grouped by effort',
      evidence: ['Will suggest 5\u20138 ideas grouped by effort'],
    };

    // Emit clarification_received for skip
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'clarification_received',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        option_id: 'fallback-suggest',
        title: 'Skip - suggest ideas',
        skipped: true,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, task_id);

    // Generate plan with fallback option
    console.log(`${LOG_PREFIX} Generating fallback plan with idea suggestions`);
    await generateAndEmitPlan(ctx, userPrompt, task_id, modelId, webview, lightContext, fallbackOption);
  } catch (error) {
    console.error('Error handling skipClarification:', error);
    vscode.window.showErrorMessage('Plan generation failed. Please try again.');
  }
}
