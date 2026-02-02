import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getWebviewContent } from 'webview';
import { VSCodeWorkspaceWriter } from './vscodeWorkspaceWriter';
import { VSCodeCheckpointManager } from './vscodeCheckpointManager';
import { 
  storeAttachment, 
  validateAttachment, 
  AttachmentData, 
  AttachmentStoreResult 
} from './attachmentEvidenceStore';
import { 
  EventStore, 
  Event, 
  Mode, 
  classifyPrompt, 
  classifyPromptV2,
  modeConfirmationPolicy,
  shouldRequireConfirmation, 
  generateTemplatePlan,
  generateLLMPlan,
  refinePlan,
  shouldBreakIntoMissions,
  StructuredPlan,
  Evidence,
  TestRunner,
  FileTestEvidenceStore,
  EventBus,
  ApprovalManager,
  RepairOrchestrator,
  AutonomyController,
  CheckpointManager,
  DiffManager,
  InMemoryEvidenceStore,
  ModeManager,
  DEFAULT_A1_BUDGETS,
  exportRun,
  ExportResult,
  LLMService,
  collectAnswerContext,
  buildAnswerModeSystemMessage,
  AnswerContextBundle,
  collectPlanContext,
  buildPlanModeSystemMessage,
  MissionExecutor,
  PromptQualityJudge,
  combinePromptWithClarification,
  PromptQualityAssessment,
  AssessmentContext,
  // Step 34.5: Command Execution imports
  runCommandPhase,
  CommandPhaseContext,
  resolveCommandPolicy,
  CommandPolicyConfig,
  DEFAULT_COMMAND_POLICY,
  CommandIntentResult,
  discoverVerifyCommands,
  detectCommandIntent,
  // New Plan Enhancer imports
  collectLightContext,
  assessPromptClarity,
  shouldShowClarification,
  generateClarificationOptions,
  buildEnrichedPrompt,
  buildFallbackPrompt,
  isClarificationPending,
  getPendingClarificationOptions,
  LightContextBundle,
  ClarificationOption,
  // Step 26: Mission Breakdown imports
  detectLargePlan,
  buildPlanTextForAnalysis,
  generateMissionBreakdown,
  PlanStepForAnalysis,
  // Step 27: Mission Runner (Production Harness)
  MissionRunner,
  convertPlanToMission,
  Mission,
  // Step 28: Self-Correction Loop
  SelfCorrectionRunner,
  DEFAULT_SELF_CORRECTION_POLICY,
  classifyFailure as classifyTestFailure,
  FailureClassification,
  SelfCorrectionPolicy,
  DecisionPoint,
  StopReason,
  // Workspace Safety imports
  resolveTargetWorkspace,
  getWorkspaceCandidateInfo,
  validateFileOperations,
  classifyFileOperations,
  // Step 33: Intent Analysis & Behavior Handlers
  analyzeIntent,
  analyzeIntentWithFlow,
  executeBehavior,
  detectActiveRun,
  IntentAnalysisContext,
  BehaviorHandlerResult,
  processClarificationResponse,
  processContinueRunResponse,
  // Step 35: Scaffold Flow
  ScaffoldFlowCoordinator,
  isGreenfieldRequest,
  // Step 35.3-35.4: Recipe Selection & Scaffold Apply
  selectRecipe,
  buildRecipePlan,
  applyScaffoldPlan,
  RecipeContext,
  ScaffoldApplyContext,
} from 'core';

class MissionControlViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ordinex.missionControl';
  private eventStore: EventStore | null = null;
  private currentTaskId: string | null = null;
  private currentMode: Mode = 'ANSWER';
  private currentStage: 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'none' = 'none';
  private repairOrchestrator: RepairOrchestrator | null = null;
  private isProcessing: boolean = false; // Prevent double submissions
  private activeApprovalManager: ApprovalManager | null = null; // Store active approval manager
  private activeMissionRunner: MissionRunner | null = null; // Step 27: Store active mission runner for cancellation
  private selectedWorkspaceRoot: string | null = null; // Workspace targeting: store selected workspace for this session
  private isMissionExecuting: boolean = false; // CRITICAL: Prevent duplicate mission starts
  private currentExecutingMissionId: string | null = null; // Track which mission is running
  private pendingCommandContexts: Map<string, CommandPhaseContext> = new Map(); // Awaiting command approval by task
  private activeTerminals: Map<string, vscode.Terminal> = new Map(); // Track terminals by task ID

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    // Initialize event store
    const storePath = path.join(_context.globalStorageUri.fsPath, 'events.jsonl');
    this.eventStore = new EventStore(storePath);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Set up message passing
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message, webviewView.webview);
      }
    );
  }

  private async handleMessage(message: any, webview: vscode.Webview) {
    console.log('Message from webview:', message);

    switch (message.type) {
      case 'ordinex:submitPrompt':
        await this.handleSubmitPrompt(message, webview);
        break;
      
      case 'ordinex:getEvents':
        await this.handleGetEvents(message, webview);
        break;
      
      case 'ordinex:confirmMode':
        await this.handleConfirmMode(message, webview);
        break;

      case 'ordinex:executePlan':
        await this.handleExecutePlan(message, webview);
        break;

      case 'ordinex:proposeDiff':
        await this.handleProposeDiff(message, webview);
        break;

      case 'ordinex:runTests':
        await this.handleRunTests(message, webview);
        break;

      case 'ordinex:startAutonomy':
        await this.handleStartAutonomy(message, webview);
        break;

      case 'ordinex:stopAutonomy':
        await this.handleStopAutonomy(message, webview);
        break;

      case 'ordinex:exportRun':
        await this.handleExportRun(message, webview);
        break;

      case 'ordinex:requestPlanApproval':
        await this.handleRequestPlanApproval(message, webview);
        break;

      case 'ordinex:resolvePlanApproval':
        await this.handleResolvePlanApproval(message, webview);
        break;

      case 'ordinex:resolveApproval':
        await this.handleResolveApproval(message, webview);
        break;

      case 'ordinex:resolveDecisionPoint':
        await this.handleResolveDecisionPoint(message, webview);
        break;

      case 'ordinex:refinePlan':
        await this.handleRefinePlan(message, webview);
        break;

      // Clarification handlers (PLAN mode v2)
      case 'ordinex:selectClarificationOption':
        await this.handleSelectClarificationOption(message, webview);
        break;

      case 'ordinex:skipClarification':
        await this.handleSkipClarification(message, webview);
        break;

      // Step 26: Mission Breakdown handlers
      case 'ordinex:selectMission':
        await this.handleSelectMission(message, webview);
        break;

      case 'ordinex:startSelectedMission':
        await this.handleStartSelectedMission(message, webview);
        break;

      // Step 27: Mission Runner cancellation
      case 'ordinex:cancelMission':
        await this.handleCancelMission(message, webview);
        break;

      // Start mission execution (from Mission Control Bar "Start" button)
      case 'ordinex:startMission':
        await this.handleStartSelectedMission(message, webview);
        break;

      // Step 37: Attachment Upload handler
      case 'ordinex:uploadAttachment':
        await this.handleUploadAttachment(message, webview);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  private async handleSubmitPrompt(message: any, webview: vscode.Webview) {
    console.log('=== handleSubmitPrompt START (Step 33) ===');
    const { text, userSelectedMode, modelId, attachments } = message;
    console.log('Params:', { text, userSelectedMode, modelId, attachmentCount: attachments?.length || 0 });
    
    if (!text || !userSelectedMode) {
      console.error('Missing required fields in submitPrompt');
      return;
    }

    // Create task_id if not active
    console.log('Checking currentTaskId:', this.currentTaskId);
    if (!this.currentTaskId) {
      this.currentTaskId = this.generateId();
      this.currentMode = userSelectedMode;
      this.currentStage = 'none';
      console.log('Created new task ID:', this.currentTaskId);
    }

    const taskId = this.currentTaskId;
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
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'intent_received',
        mode: userSelectedMode,
        stage: this.currentStage,
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
      console.log('✓ intent_received event emitted');
      await this.sendEventsToWebview(webview, taskId);

      // 2. STEP 33: Build intent analysis context
      const events = this.eventStore?.getEventsByTaskId(taskId) || [];
      const activeRun = detectActiveRun(events);
      const analysisContext: IntentAnalysisContext = {
        clarificationAttempts: events.filter(e => e.type === 'clarification_requested').length,
        lastOpenEditor: vscode.window.activeTextEditor?.document.fileName,
        activeRun: activeRun === null ? undefined : activeRun,
        lastAppliedDiff: this.getLastAppliedDiff(events),
      };
      console.log('[Step33] Analysis context:', analysisContext);

      // 3. STEP 33: Analyze intent (behavior-first) with flow_kind detection
      const commandDetection = detectCommandIntent(text);
      console.log('[Step33] Command detection:', commandDetection);

      // Use analyzeIntentWithFlow to get flow_kind for greenfield detection
      let analysisWithFlow = analyzeIntentWithFlow(text, analysisContext);
      let analysis = analysisWithFlow; // Same object, but typed to include flow_kind
      
      console.log('[Step35] Flow kind:', analysisWithFlow.flow_kind);
      console.log('[Step35] Is greenfield request:', isGreenfieldRequest(text));

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
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'mode_set',
        mode: analysis.derived_mode,
        stage: this.currentStage,
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
      this.currentMode = analysis.derived_mode;
      await this.sendEventsToWebview(webview, taskId);

      // 5. STEP 35 FIX: SCAFFOLD CHECK BEFORE BEHAVIOR SWITCH
      // Greenfield requests MUST route to scaffold flow regardless of behavior classification
      if (analysisWithFlow.flow_kind === 'scaffold') {
        console.log('[Step35] 🏗️ SCAFFOLD flow detected - routing DIRECTLY to scaffold handler');
        console.log('[Step35] Bypassing behavior switch (was:', analysis.behavior, ')');
        await this.handleScaffoldFlow(text, taskId, modelId || 'sonnet-4.5', webview, attachments || []);
        console.log('[Step33] Behavior handling complete (scaffold flow)');
        return; // Exit early - scaffold flow handles everything
      }

      // 6. STEP 33: Handle behavior-specific logic (non-scaffold)
      console.log(`[Step33] Executing behavior: ${analysis.behavior}`);
      
      switch (analysis.behavior) {
        case 'ANSWER':
          console.log('>>> BEHAVIOR: ANSWER <<<');
          await this.handleAnswerMode(text, taskId, modelId || 'sonnet-4.5', webview);
          break;

        case 'PLAN':
          console.log('>>> BEHAVIOR: PLAN <<<');
          // Note: Scaffold flow is now handled BEFORE the behavior switch
          // If we reach here, it's a standard PLAN flow
          console.log('[Step35] Standard PLAN flow');
          await this.handlePlanMode(text, taskId, modelId || 'sonnet-4.5', webview);
          break;

        case 'QUICK_ACTION':
          console.log('>>> BEHAVIOR: QUICK_ACTION <<<');
          
          // STEP 34.5: Check if this is a command execution request
          const commandIntent = detectCommandIntent(text);
          
          if (commandIntent.isCommandIntent) {
            // This is a COMMAND - route to command execution phase
            console.log('[QUICK_ACTION] Detected command intent:', commandIntent);
            
            try {
              const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              if (!workspaceRoot) {
                throw new Error('No workspace folder open');
              }

              if (!this.eventStore) {
                throw new Error('EventStore not initialized');
              }

              // Resolve command policy
              const commandPolicy = resolveCommandPolicy(
                DEFAULT_COMMAND_POLICY,
                {} // workspace settings - TODO: wire up from VS Code settings
              );

              // Create EventBus for command phase (it needs emit() method)
              const commandEventBus = new EventBus(this.eventStore);
              
              // Subscribe to events for UI updates
              commandEventBus.subscribe(async (event) => {
                await this.sendEventsToWebview(webview, taskId);
              });

              // Build command phase context with all required properties
              const evidenceStore = new InMemoryEvidenceStore();
              
              const commandContext: CommandPhaseContext = {
                run_id: taskId,
                mission_id: undefined,
                step_id: undefined,
                workspaceRoot,
                eventBus: commandEventBus as any, // EventBus has emit() method that commandPhase needs
                mode: this.currentMode,
                previousStage: this.currentStage,
                commandPolicy,
                commands: commandIntent.inferredCommands || ['npm run dev'], // Use inferred commands or fallback
                executionContext: 'user' as any, // User-initiated command execution
                isReplayOrAudit: false,
                writeEvidence: async (type: string, content: string, summary: string) => {
                  const evidenceId = this.generateId();
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
                this.pendingCommandContexts.set(taskId, commandContext);
              } else {
                // Emit final event
                await this.emitEvent({
                  event_id: this.generateId(),
                  task_id: taskId,
                  timestamp: new Date().toISOString(),
                  type: 'final',
                  mode: this.currentMode,
                  stage: 'command',
                  payload: {
                    success: result.status === 'success',
                    command_result: result
                  },
                  evidence_ids: result.evidenceRefs || [],
                  parent_event_id: null,
                });
              }

              await this.sendEventsToWebview(webview, taskId);

            } catch (error) {
              console.error('[QUICK_ACTION] Command execution error:', error);
              await this.emitEvent({
                event_id: this.generateId(),
                task_id: taskId,
                timestamp: new Date().toISOString(),
                type: 'failure_detected',
                mode: 'MISSION',
                stage: this.currentStage,
                payload: {
                  error: error instanceof Error ? error.message : 'Unknown error',
                  kind: 'command_execution_failed'
                },
                evidence_ids: [],
                parent_event_id: null,
              });
              await this.sendEventsToWebview(webview, taskId);
              vscode.window.showErrorMessage(`Command execution failed: ${error}`);
            }
          } else {
            // This is an EDIT - use MissionExecutor pipeline
            console.log('[QUICK_ACTION] Using MissionExecutor edit pipeline (no plan UI)');

            try {
              const referencedFiles = analysis.referenced_files || [];
              const fileHint = referencedFiles.length > 0 ? referencedFiles.join(', ') : 'target files';
              const stepDescription = `Edit ${fileHint} to resolve: ${text}`;

              const quickPlan: StructuredPlan = {
                goal: `Quick fix: ${text}`,
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

              await this.handleExecutePlan(
                { taskId, planOverride: quickPlan, emitMissionStarted: true },
                webview
              );
            } catch (error) {
              console.error('[QUICK_ACTION] Error:', error);
              await this.emitEvent({
                event_id: this.generateId(),
                task_id: taskId,
                timestamp: new Date().toISOString(),
                type: 'failure_detected',
                mode: 'MISSION',
                stage: this.currentStage,
                payload: {
                  error: error instanceof Error ? error.message : 'Unknown error',
                  kind: 'quick_action_failed'
                },
                evidence_ids: [],
                parent_event_id: null,
              });
              await this.sendEventsToWebview(webview, taskId);
              vscode.window.showErrorMessage(`Quick action failed: ${error}`);
            }
          }
          break;

        case 'CLARIFY':
          console.log('>>> BEHAVIOR: CLARIFY <<<');
          // Emit clarification_requested event
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'clarification_requested',
            mode: this.currentMode,
            stage: this.currentStage,
            payload: {
              question: analysis.clarification?.question || 'Could you provide more details?',
              options: analysis.clarification?.options || [],
              context_source: analysis.context_source,
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'execution_paused',
            mode: this.currentMode,
            stage: this.currentStage,
            payload: {
              reason: 'awaiting_clarification',
              description: 'Need more information to proceed'
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          await this.sendEventsToWebview(webview, taskId);
          break;

        case 'CONTINUE_RUN':
          console.log('>>> BEHAVIOR: CONTINUE_RUN <<<');
          // Show options to resume, pause, or abort
          const activeRunStatus = analysisContext.activeRun;
          const statusText = activeRunStatus
            ? `An earlier run is ${activeRunStatus.status} (stage: ${activeRunStatus.stage}).`
            : 'An earlier run appears to be pending user input.';
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'decision_point_needed',
            mode: this.currentMode,
            stage: this.currentStage,
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
          
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'execution_paused',
            mode: this.currentMode,
            stage: this.currentStage,
            payload: {
              reason: 'awaiting_continue_decision',
              description: 'Choose how to handle active mission'
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          await this.sendEventsToWebview(webview, taskId);
          break;

        default:
          console.error(`[Step33] Unknown behavior: ${analysis.behavior}`);
          // Fallback to MISSION mode
          const fallbackPlan = generateTemplatePlan(text, 'MISSION');
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'plan_created',
            mode: 'MISSION',
            stage: this.currentStage,
            payload: fallbackPlan as unknown as Record<string, unknown>,
            evidence_ids: [],
            parent_event_id: null,
          });
          await this.sendEventsToWebview(webview, taskId);
      }

      console.log('[Step33] Behavior handling complete');

    } catch (error) {
      console.error('Error handling submitPrompt:', error);
      vscode.window.showErrorMessage(`Ordinex: ${error}`);
    }
  }

  /**
   * Step 33: Helper to extract last applied diff from events
   */
  private getLastAppliedDiff(events: Event[]): { files: string[]; timestamp: string } | undefined {
    const diffAppliedEvents = events
      .filter(e => e.type === 'diff_applied')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    if (diffAppliedEvents.length === 0) return undefined;
    
    const lastDiff = diffAppliedEvents[0];
    return {
      files: (lastDiff.payload.files_changed as string[]) || [],
      timestamp: lastDiff.timestamp,
    };
  }

  private async handleGetEvents(message: any, webview: vscode.Webview) {
    const { taskId } = message;
    
    if (!this.eventStore) {
      return;
    }

    let events: Event[];
    if (taskId) {
      events = this.eventStore.getEventsByTaskId(taskId);
    } else if (this.currentTaskId) {
      events = this.eventStore.getEventsByTaskId(this.currentTaskId);
    } else {
      events = this.eventStore.getAllEvents();
    }

    webview.postMessage({
      type: 'ordinex:eventsUpdate',
      events,
    });
  }

  private async handleConfirmMode(message: any, webview: vscode.Webview) {
    const { taskId, confirmedMode } = message;

    if (!taskId || !confirmedMode) {
      console.error('Missing required fields in confirmMode');
      return;
    }

    // Emit mode_set with confirmed mode
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'mode_set',
      mode: confirmedMode,
      stage: this.currentStage,
      payload: {
        mode: confirmedMode,
        effectiveMode: confirmedMode,
        requiresConfirmation: false,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    this.currentMode = confirmedMode;

    // Now generate plan if needed
    if (confirmedMode === 'PLAN' || confirmedMode === 'MISSION') {
      // Get the original prompt from intent_received event
      const events = this.eventStore?.getEventsByTaskId(taskId) || [];
      const intentEvent = events.find((e: Event) => e.type === 'intent_received');
      const prompt = intentEvent?.payload.prompt as string || 'Complete the task';

      const plan = generateTemplatePlan(prompt, confirmedMode);
      
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'plan_created',
        mode: confirmedMode,
        stage: this.currentStage,
        payload: plan as unknown as Record<string, unknown>,
        evidence_ids: [],
        parent_event_id: null,
      });
    }

    // Send updated events to webview
    await this.sendEventsToWebview(webview, taskId);
  }

  private async handleExecutePlan(message: any, webview: vscode.Webview) {
    const { taskId, planOverride, missionId, emitMissionStarted } = message;

    if (!taskId) {
      console.error('Missing taskId in executePlan');
      return;
    }

    try {
      console.log('[handleExecutePlan] Starting MISSION execution for task:', taskId);

      // Get events to extract the approved plan
      const events = this.eventStore?.getEventsByTaskId(taskId) || [];
      
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
      if (!this.eventStore) {
        throw new Error('EventStore not initialized');
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('No workspace folder open');
      }

      // Get API key for LLM calls
      const apiKey = await this._context.secrets.get('ordinex.apiKey');
      if (!apiKey) {
        vscode.window.showErrorMessage('Ordinex API key not configured. Please run "Ordinex: Set API Key" command.');
        throw new Error('No API key configured');
      }

      // Get model ID from intent event or use default
      const intentEvent = events.find((e: Event) => e.type === 'intent_received');
      const modelId = (intentEvent?.payload.model_id as string) || 'claude-3-haiku';

      const eventBus = new EventBus(this.eventStore);
      const checkpointDir = path.join(this._context.globalStorageUri.fsPath, 'checkpoints');
      const checkpointManager = new CheckpointManager(eventBus, checkpointDir);
      const approvalManager = new ApprovalManager(eventBus);

      // CRITICAL: Store approval manager so handleResolveApproval can use it
      this.activeApprovalManager = approvalManager;

      // Subscribe to events from MissionExecutor
      eventBus.subscribe(async (event) => {
        // Events are already persisted by MissionExecutor's eventBus
        // We just need to send updated events to webview in real-time
        await this.sendEventsToWebview(webview, taskId);
        
        // CRITICAL: Handle mission completion to trigger next mission in breakdown
        if (event.type === 'mission_completed') {
          console.log('[handleExecutePlan] 🎉 mission_completed detected, triggering sequencing logic');
          console.log('[handleExecutePlan] Event payload:', JSON.stringify(event.payload, null, 2));
          
          // CRITICAL: Clear mission executing flag so next mission can start
          this.isMissionExecuting = false;
          this.currentExecutingMissionId = null;
          console.log('[handleExecutePlan] ✓ Mission execution flag cleared');
          
          await this.handleMissionCompletionSequencing(taskId, webview);
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
        workspaceWriter,           // NEW: Real file writer
        workspaceCheckpointMgr,    // NEW: Real checkpoint manager
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
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          kind: 'execution_start_failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);
      vscode.window.showErrorMessage(`Failed to start execution: ${error}`);
    }
  }

  private async handleProposeDiff(message: any, webview: vscode.Webview) {
    const { taskId } = message;

    if (!taskId) {
      console.error('Missing taskId in proposeDiff');
      return;
    }

    try {
      // Get events for this task to extract context
      const events = this.eventStore?.getEventsByTaskId(taskId) || [];
      const intentEvent = events.find((e: Event) => e.type === 'intent_received');
      const planEvent = events.find((e: Event) => e.type === 'plan_created');
      
      const userIntent = intentEvent?.payload.prompt as string || 'Complete task';
      const planSteps = (planEvent?.payload.steps as any[]) || [];

      // 1. Emit stage_changed → edit (if not already in edit stage)
      if (this.currentStage !== 'edit') {
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'stage_changed',
          mode: this.currentMode,
          stage: 'edit',
          payload: {
            from: this.currentStage,
            to: 'edit',
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        this.currentStage = 'edit';
      }

      // 2. Generate diff proposal using the deterministic generator
      // V1: Uses placeholder logic (no LLM required)
      const proposalInput = {
        userIntent,
        planSteps: planSteps.map((step: any) => ({ description: step.description || step })),
      };

      // Generate diff using inline logic (same as diffProposalGenerator)
      const targetPath = 'docs/ordinex_proposal.md';
      const timestamp = new Date().toISOString();
      const stepsText = proposalInput.planSteps
        .map((step, idx) => `${idx + 1}. ${step.description}`)
        .join('\n');

      const proposalContent = `# Ordinex Proposal Document

**Generated**: ${timestamp}

## User Intent

${userIntent}

## Planned Approach

${stepsText}

## Status

This proposal document was generated by Ordinex Step 15 (Edit Stage - Propose Diff).

The proposed changes are based on the user's intent and the generated plan.
This demonstrates the diff proposal pipeline without requiring LLM integration.

## Next Steps

- Review this proposal
- Click "View Diff" to see the proposed changes
- Click "Request Apply" to proceed with applying the diff
- The system will request approval before making any actual changes

---

*This is a V1 deterministic placeholder. Future versions will use LLM-powered diff generation.*
`;

      // Create unified diff patch
      const newLines = proposalContent.split('\n');
      const patchLines: string[] = [];
      patchLines.push(`--- /dev/null`);
      patchLines.push(`+++ ${targetPath}`);
      patchLines.push(`@@ -0,0 +1,${newLines.length} @@`);
      newLines.forEach(line => patchLines.push(`+${line}`));
      const patch = patchLines.join('\n');

      // 3. Create evidence for the diff
      const diffEvidenceId = this.generateId();
      const diffEvidence: Evidence = {
        evidence_id: diffEvidenceId,
        type: 'diff',
        source_event_id: '', // Will be populated by event
        content_ref: patch, // Store patch directly in content_ref for now
        summary: `Proposed changes to ${targetPath}`,
        created_at: timestamp,
      };

      // 4. Emit diff_proposed event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp,
        type: 'diff_proposed',
        mode: this.currentMode,
        stage: 'edit',
        payload: {
          diff_id: this.generateId(),
          files_changed: [targetPath],
          summary: `Proposal document based on: "${userIntent.substring(0, 50)}..."`,
          change_intent: 'Create proposal document capturing intent and planned changes',
          risk_level: 'low',
          rationale: [
            'Creates new file in docs/ directory (safe location)',
            'No modifications to existing code',
            'Demonstrates full diff proposal pipeline',
            'Based on user intent and generated plan'
          ]
        },
        evidence_ids: [diffEvidenceId],
        parent_event_id: null,
      });

      // Send updated events to webview
      await this.sendEventsToWebview(webview, taskId);

      console.log('Diff proposal created successfully');

    } catch (error) {
      console.error('Error handling proposeDiff:', error);
      vscode.window.showErrorMessage(`Diff proposal failed: ${error}`);
    }
  }

  private async handleRunTests(message: any, webview: vscode.Webview) {
    const { taskId } = message;

    if (!taskId) {
      console.error('Missing taskId in runTests');
      return;
    }

    try {
      // Get workspace root
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      // Initialize required components
      // Use the existing event store for the eventBus
      if (!this.eventStore) {
        throw new Error('EventStore not initialized');
      }
      
      const eventBus = new EventBus(this.eventStore);
      const approvalManager = new ApprovalManager(eventBus);
      const evidenceDir = path.join(this._context.globalStorageUri.fsPath, 'evidence');
      const evidenceStore = new FileTestEvidenceStore(evidenceDir);

      // Subscribe to events from TestRunner
      eventBus.subscribe(async (event) => {
        // Persist event to event store
        await this.emitEvent(event);
        // Send updated events to webview
        await this.sendEventsToWebview(webview, taskId);

        // For V1, auto-approve test commands (in future this would wait for user input)
        // When an approval_requested event is emitted, auto-approve it
        if (event.type === 'approval_requested') {
          const approvalId = event.payload.approval_id as string;
          
          // Wait a bit to let the UI update
          setTimeout(async () => {
            try {
              await approvalManager.resolveApproval(
                taskId,
                this.currentMode,
                event.stage,
                approvalId,
                'approved',
                'once'
              );
              // Send updated events after approval
              await this.sendEventsToWebview(webview, taskId);
            } catch (error) {
              console.error('Error auto-approving:', error);
            }
          }, 100);
        }
      });

      // Create test runner
      const testRunner = new TestRunner(
        taskId,
        eventBus,
        approvalManager,
        evidenceStore,
        workspaceRoot
      );

      // Run tests
      const result = await testRunner.runTests(this.currentMode, this.currentStage);

      if (result) {
        console.log('Test execution completed:', result.success ? 'PASSED' : 'FAILED');
      } else {
        console.log('No test command detected');
      }

    } catch (error) {
      console.error('Error handling runTests:', error);
      vscode.window.showErrorMessage(`Test execution failed: ${error}`);
    }
  }

  private async handleStartAutonomy(message: any, webview: vscode.Webview) {
    const { taskId } = message;

    if (!taskId) {
      console.error('Missing taskId in startAutonomy');
      return;
    }

    try {
      // Verify mode is MISSION
      if (this.currentMode !== 'MISSION') {
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
      if (!this.eventStore) {
        throw new Error('EventStore not initialized');
      }

      const eventBus = new EventBus(this.eventStore);
      const approvalManager = new ApprovalManager(eventBus);
      const checkpointDir = path.join(this._context.globalStorageUri.fsPath, 'checkpoints');
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

      const evidenceDir = path.join(this._context.globalStorageUri.fsPath, 'evidence');
      const testEvidenceStore = new FileTestEvidenceStore(evidenceDir);
      const testRunner = new TestRunner(
        taskId,
        eventBus,
        approvalManager,
        testEvidenceStore,
        workspaceRoot
      );

      // Create repair orchestrator
      this.repairOrchestrator = new RepairOrchestrator(
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
        await this.emitEvent(event);
        // Send updated events to webview
        await this.sendEventsToWebview(webview, taskId);

        // For V1, auto-approve repair diffs (in future this would wait for user input)
        if (event.type === 'approval_requested') {
          const approvalId = event.payload.approval_id as string;
          
          // Wait a bit to let the UI update
          setTimeout(async () => {
            try {
              await approvalManager.resolveApproval(
                taskId,
                this.currentMode,
                event.stage,
                approvalId,
                'approved',
                'once'
              );
              // Send updated events after approval
              await this.sendEventsToWebview(webview, taskId);
            } catch (error) {
              console.error('Error auto-approving repair:', error);
            }
          }, 100);
        }
      });

      // Get last test failure from events
      const events = this.eventStore.getEventsByTaskId(taskId);
      const lastFailureEvent = events.filter((e: Event) => e.type === 'failure_detected' && e.payload.kind === 'tests_failed').pop();

      if (lastFailureEvent) {
        // Set last test failure for diagnosis
        this.repairOrchestrator.setLastTestFailure({
          command: lastFailureEvent.payload.command as string || 'npm test',
          exit_code: lastFailureEvent.payload.exit_code as number || 1,
          stderr: '',
          stdout: '',
          summary: lastFailureEvent.payload.summary as string || 'Test failure detected',
        });
      }

      // Start repair autonomy (runs async)
      this.repairOrchestrator.startRepair(this.currentMode).catch(error => {
        console.error('Repair autonomy error:', error);
        vscode.window.showErrorMessage(`Repair failed: ${error}`);
      });

      console.log('A1 repair autonomy started');

    } catch (error) {
      console.error('Error handling startAutonomy:', error);
      vscode.window.showErrorMessage(`Failed to start autonomy: ${error}`);
    }
  }

  private async handleStopAutonomy(message: any, webview: vscode.Webview) {
    const { taskId } = message;

    if (!taskId) {
      console.error('Missing taskId in stopAutonomy');
      return;
    }

    try {
      if (!this.repairOrchestrator) {
        console.log('No active repair orchestrator to stop');
        return;
      }

      // Stop the repair loop
      await this.repairOrchestrator.stop(this.currentMode);

      // Send updated events to webview
      await this.sendEventsToWebview(webview, taskId);

      console.log('A1 repair autonomy stopped');

    } catch (error) {
      console.error('Error handling stopAutonomy:', error);
      vscode.window.showErrorMessage(`Failed to stop autonomy: ${error}`);
    }
  }

  /**
   * Handle ANSWER mode: Stream LLM response with project context
   */
  private async handleAnswerMode(
    userQuestion: string,
    taskId: string,
    modelId: string,
    webview: vscode.Webview
  ): Promise<void> {
    console.log('=== ANSWER MODE START ===');
    console.log('Question:', userQuestion);
    console.log('Task ID:', taskId);
    console.log('Model ID:', modelId);
    
    try {
      // 1. Get API key from SecretStorage
      console.log('Step 1: Getting API key from SecretStorage...');
      const apiKey = await this._context.secrets.get('ordinex.apiKey');
      console.log('API key retrieved:', apiKey ? `YES (length: ${apiKey.length})` : 'NO');
      
      if (!apiKey) {
        // No API key - emit failure and prompt user to set it
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.currentMode,
          stage: this.currentStage,
          payload: {
            error: 'No API key configured',
            suggestion: 'Run command "Ordinex: Set API Key" to configure your Anthropic API key',
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.sendEventsToWebview(webview, taskId);
        
        vscode.window.showErrorMessage(
          'Ordinex API key not found. Please run "Ordinex: Set API Key" command.',
          'Set API Key'
        ).then(action => {
          if (action === 'Set API Key') {
            vscode.commands.executeCommand('ordinex.setApiKey');
          }
        });
        
        return;
      }

      // 2. Collect project context for ANSWER mode
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      // Get open files from VS Code
      const openFiles = vscode.workspace.textDocuments
        .filter(doc => doc.uri.scheme === 'file')
        .map(doc => ({
          path: vscode.workspace.asRelativePath(doc.uri),
          content: doc.getText()
        }));

      console.log('Step 2: Collecting project context...');
      const contextBundle = await collectAnswerContext({
        workspaceRoot,
        openFiles,
        maxFileLines: 200,
        maxTreeDepth: 2
      });
      console.log('Context collected:', {
        filesCount: contextBundle.files.length,
        openFilesCount: contextBundle.open_files.length,
        inferredStack: contextBundle.inferred_stack
      });

      // Emit context_collected event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'context_collected',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          files_included: contextBundle.files.map(f => f.path),
          open_files_count: contextBundle.open_files.length,
          total_lines: contextBundle.files.reduce((sum, f) => sum + f.excerpt.split('\n').length, 0),
          inferred_stack: contextBundle.inferred_stack,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      
      // Send to webview immediately so UI updates
      await this.sendEventsToWebview(webview, taskId);

      // Build system message with context
      const systemContext = buildAnswerModeSystemMessage(contextBundle);
      console.log('System context length:', systemContext.length);

      // 3. Initialize event bus and LLM service
      if (!this.eventStore) {
        throw new Error('EventStore not initialized');
      }

      const eventBus = new EventBus(this.eventStore);
      const llmService = new LLMService(taskId, eventBus, this.currentMode, this.currentStage);
      
      // Subscribe to events from LLMService to send them to webview in real-time
      // Skip stream events - they're handled separately via streamDelta messages
      eventBus.subscribe(async (event) => {
        // Don't send eventsUpdate for stream events - they're handled separately via streamDelta messages
        if (event.type === 'stream_delta' || event.type === 'stream_complete') {
          return;
        }
        
        // For all other events (including tool_start, tool_end), send full update immediately
        await this.sendEventsToWebview(webview, taskId);
      });

      // 4. Stream LLM response with project context
      let fullAnswer = '';

      const response = await llmService.streamAnswerWithContext(
        userQuestion,
        systemContext,
        {
          apiKey,
          model: modelId,
          maxTokens: 4096,
        },
        (chunk) => {
          if (!chunk.done) {
            fullAnswer += chunk.delta;
            
            // Send streaming delta to webview
            webview.postMessage({
              type: 'ordinex:streamDelta',
              task_id: taskId,
              delta: chunk.delta,
            });
          } else {
            // Send completion signal
            webview.postMessage({
              type: 'ordinex:streamComplete',
              task_id: taskId,
            });
          }
        }
      );

      // 4. Create evidence for the assistant answer
      const evidenceDir = path.join(this._context.globalStorageUri.fsPath, 'evidence');
      
      // Ensure evidence directory exists
      if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
      }

      const evidenceId = this.generateId();
      const evidenceFilePath = path.join(evidenceDir, `${evidenceId}.txt`);
      
      // Write answer to evidence file
      fs.writeFileSync(evidenceFilePath, response.content, 'utf-8');

      // 5. Update the last tool_end event to include evidence_ids
      // (The LLMService already emitted tool_end, but we need to add evidence to it)
      // For now, we'll just emit a new event with the evidence
      // In production, we'd update the existing tool_end event
      
      await this.sendEventsToWebview(webview, taskId);

      console.log('ANSWER mode completed successfully');

    } catch (error) {
      console.error('Error in ANSWER mode:', error);

      // Emit failure_detected event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);

      vscode.window.showErrorMessage(`ANSWER mode failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Store light context for use in selection handling
  private planModeContext: LightContextBundle | null = null;
  private planModeOriginalPrompt: string | null = null;
  // Step 35: Store active scaffold coordinator for decision handling
  private activeScaffoldCoordinator: ScaffoldFlowCoordinator | null = null;

  /**
   * Handle PLAN mode: Deterministic Ground → Ask → Plan pipeline
   * 
   * Flow:
   * 1. Collect light context (< 3s)
   * 2. Assess prompt clarity (heuristic, no LLM)
   * 3. If low/medium clarity: show clarification card, pause
   * 4. On selection: build enriched prompt, generate LLM plan
   * 
   * NEVER emits tool_start tool="llm_answer" in PLAN mode
   */
  private async handlePlanMode(
    userPrompt: string,
    taskId: string,
    modelId: string,
    webview: vscode.Webview
  ): Promise<void> {
    const LOG_PREFIX = '[Ordinex:PlanEnhancement]';
    console.log('=== PLAN MODE START (Deterministic v2) ===');
    console.log('Prompt:', userPrompt);
    console.log('Task ID:', taskId);
    console.log('Model ID:', modelId);
    
    try {
      // Store original prompt for later use
      this.planModeOriginalPrompt = userPrompt;

      // 1. Get workspace root
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      // 2. LIGHT CONTEXT COLLECTION (< 3s budget)
      console.log(`${LOG_PREFIX} Step 1: Collecting light context...`);
      
      const lightContext = await collectLightContext(workspaceRoot);
      this.planModeContext = lightContext; // Store for selection handling

      // Emit context_collected event with level:"light"
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'context_collected',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          level: 'light',
          stack: lightContext.stack,
          top_dirs: lightContext.top_dirs,
          anchor_files: lightContext.anchor_files,
          todo_count: lightContext.todo_count,
          files_scanned: lightContext.files_scanned,
          scan_duration_ms: lightContext.scan_duration_ms
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);
      console.log(`${LOG_PREFIX} ✓ Light context collected in ${lightContext.scan_duration_ms}ms`);

      // 3. PROMPT ASSESSMENT (Heuristic only, no LLM)
      console.log(`${LOG_PREFIX} Step 2: Assessing prompt clarity (heuristic)...`);
      
      const assessment = assessPromptClarity(userPrompt, lightContext.anchor_files);

      // Emit prompt_assessed event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'prompt_assessed',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          clarity: assessment.clarity,
          clarity_score: assessment.clarity_score,
          intent: assessment.intent,
          reasoning: assessment.reasoning
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);
      console.log(`${LOG_PREFIX} ✓ Prompt assessed: clarity=${assessment.clarity}, score=${assessment.clarity_score}`);

      // Optional: Show hint if intent is answer_like and clarity is high
      if (assessment.intent === 'answer_like' && assessment.clarity === 'high') {
        vscode.window.showInformationMessage(
          'This looks like a question. You can also use ANSWER mode.',
          'Switch to ANSWER'
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
        console.log(`${LOG_PREFIX} ⚠️ Clarity ${assessment.clarity} - showing clarification card`);
        
        // Generate deterministic options
        const options = generateClarificationOptions(lightContext, userPrompt);
        console.log(`${LOG_PREFIX} Generated ${options.length} options:`, options.map(o => o.id));

        // Emit clarification_presented event
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'clarification_presented',
          mode: this.currentMode,
          stage: this.currentStage,
          payload: {
            task_id: taskId,
            options: options,
            fallback_option_id: 'fallback-suggest',
            anchor_files_count: lightContext.anchor_files.length
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        // Emit execution_paused with awaiting_selection
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.currentMode,
          stage: this.currentStage,
          payload: {
            reason: 'awaiting_selection',
            description: 'Choose a focus area to generate a targeted plan'
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.sendEventsToWebview(webview, taskId);

        // Send clarification data to webview for rendering
        webview.postMessage({
          type: 'ordinex:clarificationPresented',
          task_id: taskId,
          options: options,
          fallback_option_id: 'fallback-suggest',
          anchor_files_count: lightContext.anchor_files.length
        });

        console.log(`${LOG_PREFIX} 🛑 Execution paused - awaiting user selection`);
        return; // Stop here - wait for user selection
      }

      // HIGH CLARITY: Skip clarification, go directly to LLM plan
      console.log(`${LOG_PREFIX} ✓ High clarity - skipping clarification, generating plan directly`);
      try {
        await this.generateAndEmitPlan(userPrompt, taskId, modelId, webview, lightContext, null);
      } catch (planError) {
        console.error(`${LOG_PREFIX} Plan generation failed:`, planError);
        
        // Emit failure_detected so user sees what went wrong
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'failure_detected',
          mode: this.currentMode,
          stage: this.currentStage,
          payload: {
            error: planError instanceof Error ? planError.message : 'Plan generation failed',
            suggestion: 'Check API key is set (Cmd+Shift+P → "Ordinex: Set API Key") or try a more exploratory prompt',
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        
        await this.sendEventsToWebview(webview, taskId);
        
        vscode.window.showErrorMessage(
          `Plan generation failed: ${planError instanceof Error ? planError.message : 'Unknown error'}. Check if API key is configured.`,
          'Set API Key'
        ).then(action => {
          if (action === 'Set API Key') {
            vscode.commands.executeCommand('ordinex.setApiKey');
          }
        });
      }

    } catch (error) {
      console.error(`${LOG_PREFIX} Error in PLAN mode:`, error);

      // Emit failure_detected event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);

      vscode.window.showErrorMessage(`PLAN mode failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate and emit LLM plan (called after clarification selection or for high clarity)
   */
  private async generateAndEmitPlan(
    userPrompt: string,
    taskId: string,
    modelId: string,
    webview: vscode.Webview,
    lightContext: LightContextBundle,
    selectedOption: ClarificationOption | null
  ): Promise<void> {
    const LOG_PREFIX = '[Ordinex:PlanEnhancement]';
    
    // Get API key
    const apiKey = await this._context.secrets.get('ordinex.apiKey');
    if (!apiKey) {
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          error: 'No API key configured',
          suggestion: 'Run command "Ordinex: Set API Key" to configure your Anthropic API key',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);
      
      vscode.window.showErrorMessage(
        'Ordinex API key not found. Please run "Ordinex: Set API Key" command.',
        'Set API Key'
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
        content: doc.getText()
      }));

    if (!this.eventStore) {
      throw new Error('EventStore not initialized');
    }
    const eventBus = new EventBus(this.eventStore);

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
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: {
        tool: 'llm_plan',
        tool_name: 'llm_plan',
        prompt_length: finalPrompt.length,
        focus: selectedOption?.title || 'original_prompt'
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await this.sendEventsToWebview(webview, taskId);

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
      openFiles
    );

    // Emit tool_end for llm_plan
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_end',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: {
        tool: 'llm_plan',
        tool_name: 'llm_plan',
        success: true,
        steps_count: plan.steps.length
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    console.log(`${LOG_PREFIX} Step 4: Plan generated successfully`);
    console.log(`${LOG_PREFIX} Plan goal:`, plan.goal);
    console.log(`${LOG_PREFIX} Plan steps:`, plan.steps.length);

    // Emit plan_created event with the structured plan
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'plan_created',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: plan as unknown as Record<string, unknown>,
      evidence_ids: [],
      parent_event_id: null,
    });

    // Send updated events to webview
    await this.sendEventsToWebview(webview, taskId);

    // Also send plan created message
    webview.postMessage({
      type: 'ordinex:planCreated',
      task_id: taskId,
      plan: plan
    });

    console.log(`${LOG_PREFIX} PLAN mode completed successfully`);
  }

  /**
   * Infer technology stack from file names and extensions
   */
  private inferStack(files: string[], openFiles: string[]): string[] {
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

  private async handleExportRun(message: any, webview: vscode.Webview) {
    const { taskId } = message;

    if (!taskId) {
      console.error('Missing taskId in exportRun');
      return;
    }

    try {
      if (!this.eventStore) {
        throw new Error('EventStore not initialized');
      }

      // Get events for this task
      const events = this.eventStore.getEventsByTaskId(taskId);
      
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
      const evidenceDir = path.join(this._context.globalStorageUri.fsPath, 'evidence');
      const extensionVersion = vscode.extensions.getExtension('ordinex.ordinex')?.packageJSON?.version || '0.0.0';

      // Show progress notification
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting Run',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Creating export archive...' });

        // Call export function
        const result: ExportResult = await exportRun({
          taskId,
          events,
          evidenceDir,
          workspaceRoot,
          workspaceName,
          extensionVersion
        });

        if (result.success && result.zipPath) {
          // Show success message with option to reveal
          const action = await vscode.window.showInformationMessage(
            `Run exported successfully to: ${path.basename(result.zipPath)}`,
            'Open Folder',
            'Copy Path'
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
            exportDir: result.exportDir
          });

          console.log('Run exported successfully:', result.zipPath);
        } else {
          throw new Error(result.error || 'Export failed');
        }
      });

    } catch (error) {
      console.error('Error handling exportRun:', error);
      vscode.window.showErrorMessage(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Send error message to webview
      webview.postMessage({
        type: 'ordinex:exportComplete',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleRequestPlanApproval(message: any, webview: vscode.Webview) {
    const { task_id, plan_id } = message;

    if (!task_id || !plan_id) {
      console.error('Missing required fields in requestPlanApproval');
      return;
    }

    try {
      // Get events to extract plan details
      const events = this.eventStore?.getEventsByTaskId(task_id) || [];
      const planEvent = events.find((e: Event) => e.event_id === plan_id);

      if (!planEvent || (planEvent.type !== 'plan_created' && planEvent.type !== 'plan_revised')) {
        console.error('Plan event not found');
        return;
      }

      // Check for existing pending approval for this plan (idempotent)
      const existingApproval = events.find((e: Event) => 
        e.type === 'approval_requested' &&
        e.payload.approval_type === 'plan_approval' &&
        e.payload.details && (e.payload.details as any).plan_id === plan_id &&
        // Check if not already resolved
        !events.some((re: Event) => 
          re.type === 'approval_resolved' && 
          re.payload.approval_id === e.payload.approval_id
        )
      );

      if (existingApproval) {
        console.log('Plan approval already pending, not creating duplicate');
        // Just re-send events to update UI
        await this.sendEventsToWebview(webview, task_id);
        return;
      }

      const plan = planEvent.payload;
      const approvalId = this.generateId();

      // Check if plan is too large/complex
      const sizeCheck = shouldBreakIntoMissions(plan as any as StructuredPlan);

      // Emit approval_requested event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'approval_requested',
        mode: this.currentMode,
        stage: this.currentStage,
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
            size_check: sizeCheck
          },
          risk_level: 'low'
        },
        evidence_ids: [],
        parent_event_id: plan_id,
      });

      // Emit execution_paused with specific reason
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'execution_paused',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          reason: 'awaiting_plan_approval',
          description: 'Waiting for plan approval before proceeding'
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      // Send updated events to webview
      await this.sendEventsToWebview(webview, task_id);

      console.log('Plan approval requested:', approvalId);

    } catch (error) {
      console.error('Error handling requestPlanApproval:', error);
      vscode.window.showErrorMessage(`Failed to request plan approval: ${error}`);
    }
  }

  private async handleResolvePlanApproval(message: any, webview: vscode.Webview) {
    const { task_id, approval_id, decision } = message;

    if (!task_id || !approval_id || !decision) {
      console.error('Missing required fields in resolvePlanApproval');
      return;
    }

    try {
      // Get events to find the approval request
      const events = this.eventStore?.getEventsByTaskId(task_id) || [];
      const approvalRequest = events.find(
        (e: Event) => e.type === 'approval_requested' && e.payload.approval_id === approval_id
      );

      if (!approvalRequest) {
        console.error('Approval request not found');
        return;
      }

      const approved = decision === 'approved';

      // Emit approval_resolved event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'approval_resolved',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          approval_id: approval_id,
          decision: decision,
          approved: approved,
          decided_at: new Date().toISOString()
        },
        evidence_ids: [],
        parent_event_id: approvalRequest.event_id,
      });

      if (approved) {
        // Switch mode to MISSION
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'mode_set',
          mode: 'MISSION',
          stage: this.currentStage,
          payload: {
            mode: 'MISSION',
            effectiveMode: 'MISSION',
            previous_mode: this.currentMode,
            reason: 'Plan approved - switching to MISSION mode'
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        this.currentMode = 'MISSION';

        // STEP 26: Check if plan is too large and needs breakdown
        const planEvents = events.filter((e: Event) => 
          e.type === 'plan_created' || e.type === 'plan_revised'
        );
        const planEvent = planEvents[planEvents.length - 1];
        
        if (planEvent) {
          const plan = planEvent.payload as any;
          const planId = planEvent.event_id;
          const planVersion = (plan.plan_version as number) || 1;
          
          // Convert plan steps to format needed for analysis
          const stepsForAnalysis: PlanStepForAnalysis[] = (plan.steps || []).map((step: any, index: number) => ({
            step_id: step.id || step.step_id || `step_${index + 1}`,
            description: step.description || '',
            expected_evidence: step.expected_evidence || []
          }));

          // Build plan text for analysis
          const planText = buildPlanTextForAnalysis(plan.goal || '', stepsForAnalysis);

          // Detect if plan is large
          const detection = detectLargePlan(stepsForAnalysis, planText, {});
          
          console.log('[handleResolvePlanApproval] Large plan detection:', {
            largePlan: detection.largePlan,
            score: detection.score,
            reasons: detection.reasons
          });

          if (detection.largePlan) {
            // Emit plan_large_detected event
            await this.emitEvent({
              event_id: this.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'plan_large_detected',
              mode: 'MISSION',
              stage: this.currentStage,
              payload: {
                plan_id: planId,
                plan_version: planVersion,
                large_plan: true,
                score: detection.score,
                reasons: detection.reasons,
                metrics: detection.metrics
              },
              evidence_ids: [],
              parent_event_id: planId,
            });

            // Generate mission breakdown
            const breakdown = generateMissionBreakdown(planId, planVersion, plan.goal || '', stepsForAnalysis, detection);
            
            console.log('[handleResolvePlanApproval] Generated breakdown with', breakdown.missions.length, 'missions');

            // Emit mission_breakdown_created event
            await this.emitEvent({
              event_id: this.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'mission_breakdown_created',
              mode: 'MISSION',
              stage: this.currentStage,
              payload: {
                plan_id: planId,
                plan_version: planVersion,
                breakdown_id: breakdown.breakdownId,
                missions: breakdown.missions
              },
              evidence_ids: [],
              parent_event_id: planId,
            });

            // Emit execution_paused awaiting mission selection (NOT execute_plan)
            await this.emitEvent({
              event_id: this.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'execution_paused',
              mode: 'MISSION',
              stage: this.currentStage,
              payload: {
                reason: 'awaiting_mission_selection',
                description: 'Plan is too large - select ONE mission to execute'
              },
              evidence_ids: [],
              parent_event_id: null,
            });
          } else {
            // Plan is NOT large - proceed directly to Execute Plan
            await this.emitEvent({
              event_id: this.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'execution_paused',
              mode: 'MISSION',
              stage: this.currentStage,
              payload: {
                reason: 'awaiting_execute_plan',
                description: 'Plan approved - ready to execute'
              },
              evidence_ids: [],
              parent_event_id: null,
            });
          }
        } else {
          // No plan found - fallback to awaiting_execute_plan
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'execution_paused',
            mode: 'MISSION',
            stage: this.currentStage,
            payload: {
              reason: 'awaiting_execute_plan',
              description: 'Plan approved - ready to execute'
            },
            evidence_ids: [],
            parent_event_id: null,
          });
        }
      } else {
        // Plan rejected - remain in PLAN mode
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: this.currentMode,
          stage: this.currentStage,
          payload: {
            reason: 'plan_rejected',
            description: 'Plan rejected by user'
          },
          evidence_ids: [],
          parent_event_id: null,
        });
      }

      // Send updated events to webview
      await this.sendEventsToWebview(webview, task_id);

      console.log('Plan approval resolved:', { approved, decision });

    } catch (error) {
      console.error('Error handling resolvePlanApproval:', error);
      vscode.window.showErrorMessage(`Failed to resolve plan approval: ${error}`);
    }
  }

  private async handleResolveApproval(message: any, webview: vscode.Webview) {
    const { task_id, approval_id, decision } = message;

    if (!task_id || !approval_id || !decision) {
      console.error('Missing required fields in resolveApproval');
      return;
    }

    try {
      // CRITICAL FIX: Call the active approval manager to resolve the Promise
      if (!this.activeApprovalManager) {
        console.error('[handleResolveApproval] No active approval manager found!');
        vscode.window.showErrorMessage('No active approval manager. Please try again.');
        return;
      }

      // Get events to find the approval request
      const events = this.eventStore?.getEventsByTaskId(task_id) || [];
      const approvalRequest = events.find(
        (e: Event) => e.type === 'approval_requested' && e.payload.approval_id === approval_id
      );

      if (!approvalRequest) {
        console.error('Approval request not found');
        return;
      }

      const approved = decision === 'approved';

      console.log(`[handleResolveApproval] Resolving approval: ${approval_id}, decision: ${decision}`);

      // Resolve via approval manager (this resolves the Promise and unblocks execution!)
      await this.activeApprovalManager.resolveApproval(
        task_id,
        this.currentMode,
        this.currentStage,
        approval_id,
        approved ? 'approved' : 'denied',
        'once'
      );

      // Send updated events to webview
      await this.sendEventsToWebview(webview, task_id);

      console.log('[handleResolveApproval] Approval resolved successfully:', { approval_id, approved, decision });

    } catch (error) {
      console.error('Error handling resolveApproval:', error);
      vscode.window.showErrorMessage(`Failed to resolve approval: ${error}`);
    }
  }

  private async handleResolveDecisionPoint(message: any, webview: vscode.Webview) {
    const { task_id, decision_event_id, action } = message;

    if (!task_id || !decision_event_id || !action) {
      console.error('Missing required fields in resolveDecisionPoint');
      return;
    }

    if (!this.eventStore) {
      console.error('EventStore not initialized');
      return;
    }

    try {
      const events = this.eventStore.getEventsByTaskId(task_id);
      
      // Look for decision_point_needed OR scaffold_decision_requested events
      let decisionEvent = events.find(
        (e: Event) => e.type === 'decision_point_needed' && e.event_id === decision_event_id
      );
      
      // Also check for scaffold_decision_requested (Step 35)
      if (!decisionEvent) {
        decisionEvent = events.find(
          (e: Event) => e.type === 'scaffold_decision_requested' && e.event_id === decision_event_id
        );
      }

      // Extract scaffold context from message if present (sent by ScaffoldCard component)
      const scaffoldContext = message.scaffold_context;
      
      // If no event found by ID but we have scaffold context, find by scaffold_id
      if (!decisionEvent && scaffoldContext?.scaffold_id) {
        decisionEvent = events.find(
          (e: Event) => e.type === 'scaffold_decision_requested' && 
                        e.payload?.scaffold_id === scaffoldContext.scaffold_id
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

        const eventBus = new EventBus(this.eventStore);
        eventBus.subscribe(async () => {
          await this.sendEventsToWebview(webview, task_id);
        });

        await processContinueRunResponse(
          action as 'resume' | 'pause' | 'abort' | 'propose_fix',
          activeRun,
          eventBus,
          task_id
        );

        await this.sendEventsToWebview(webview, task_id);
        return;
      }

      if (decisionContext === 'command_execution') {
        const pendingContext = this.pendingCommandContexts.get(task_id);
        if (!pendingContext) {
          console.error('No pending command context found for task');
          return;
        }

        if (action === 'run_commands') {
          // FIXED: Use VS Code terminal API to run commands visibly
          console.log('[handleResolveDecisionPoint] Running commands in VS Code terminal');
          
          this.pendingCommandContexts.delete(task_id);
          
          const commands = pendingContext.commands || [];
          const workspaceRoot = pendingContext.workspaceRoot;
          
          for (const command of commands) {
            // Emit command_started event
            await this.emitEvent({
              event_id: this.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'command_started',
              mode: this.currentMode,
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
            const existingTerminal = this.activeTerminals.get(task_id);
            if (existingTerminal) {
              existingTerminal.dispose();
            }
            
            // Create new terminal
            const terminal = vscode.window.createTerminal({
              name: terminalName,
              cwd: workspaceRoot,
            });
            
            this.activeTerminals.set(task_id, terminal);
            
            // Show terminal and send command
            terminal.show(true); // true = preserve focus
            terminal.sendText(command);
            
            console.log(`[handleResolveDecisionPoint] ✓ Command sent to terminal: ${command}`);
            
            // Emit command_running event (since we can't track output from sendText)
            await this.emitEvent({
              event_id: this.generateId(),
              task_id: task_id,
              timestamp: new Date().toISOString(),
              type: 'command_progress',
              mode: this.currentMode,
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
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'command_completed',
            mode: this.currentMode,
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
          
          await this.sendEventsToWebview(webview, task_id);
          
          // CRITICAL FIX: Clear currentTaskId so next prompt starts a fresh task
          // This prevents "Active Run Detected" on follow-up prompts
          console.log(`[handleResolveDecisionPoint] ✓ Command task completed, clearing currentTaskId`);
          this.currentTaskId = null;
          this.currentStage = 'none';
          
          vscode.window.showInformationMessage(
            `Command started in terminal. Check the "${commands.length > 0 ? commands[0].split(' ')[0] : 'Ordinex'}" terminal for output.`
          );
          return;
          
        } else if (action === 'skip_once') {
          this.pendingCommandContexts.delete(task_id);
          
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'command_skipped',
            mode: this.currentMode,
            stage: 'command',
            payload: {
              reason: 'User skipped command execution',
              commands: pendingContext.commands,
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          
          await this.sendEventsToWebview(webview, task_id);
          
          // CRITICAL FIX: Clear currentTaskId so next prompt starts a fresh task
          console.log(`[handleResolveDecisionPoint] ✓ Command skipped, clearing currentTaskId`);
          this.currentTaskId = null;
          this.currentStage = 'none';
          return;
          
        } else if (action === 'disable_commands') {
          this.pendingCommandContexts.delete(task_id);
          
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: task_id,
            timestamp: new Date().toISOString(),
            type: 'command_skipped',
            mode: this.currentMode,
            stage: 'command',
            payload: {
              reason: 'User disabled command execution',
              commands: pendingContext.commands,
              permanently_disabled: true,
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          
          await this.sendEventsToWebview(webview, task_id);
          vscode.window.showInformationMessage('Command execution disabled for this workspace.');
          return;
          
        } else {
          console.error('Unknown command decision action:', action);
          return;
        }
      }

      // STEP 35: Handle scaffold_approval decision type
      if (decisionType === 'scaffold_approval') {
        console.log('[handleResolveDecisionPoint] Scaffold approval action:', action);
        
        if (!this.activeScaffoldCoordinator) {
          console.error('No active scaffold coordinator found');
          vscode.window.showErrorMessage('Scaffold flow not active. Please try again.');
          return;
        }
        
        try {
          // Step 35.5: Handle change_style separately - it does NOT complete the flow
          if (action === 'change_style') {
            console.log('[handleResolveDecisionPoint] Showing design pack picker...');
            await this.activeScaffoldCoordinator.handleStyleChange();
            console.log('[handleResolveDecisionPoint] Style picker shown, awaiting user selection');
            await this.sendEventsToWebview(webview, task_id);
            // Do NOT clear currentTaskId - flow continues in awaiting_decision state
            return;
          }
          
          // Step 35.5: Handle style selection (when user picks a pack from the picker)
          if (action === 'select_style' && scaffoldContext?.selected_pack_id) {
            console.log('[handleResolveDecisionPoint] Design pack selected:', scaffoldContext.selected_pack_id);
            await this.activeScaffoldCoordinator.handleStyleSelect(scaffoldContext.selected_pack_id);
            console.log('[handleResolveDecisionPoint] Style selected, back to decision state');
            await this.sendEventsToWebview(webview, task_id);
            // Do NOT clear currentTaskId - flow continues in awaiting_decision state
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
          const updatedState = await this.activeScaffoldCoordinator.handleUserAction(scaffoldAction);
          console.log('[handleResolveDecisionPoint] Scaffold action handled:', updatedState.completionStatus);
          
          // Clear the coordinator reference
          this.activeScaffoldCoordinator = null;
          
          // CRITICAL: Clear currentTaskId so next prompt starts fresh
          console.log('[handleResolveDecisionPoint] Scaffold completed, clearing currentTaskId');
          this.currentTaskId = null;
          this.currentStage = 'none';
          
          await this.sendEventsToWebview(webview, task_id);
          
          if (updatedState.completionStatus === 'ready_for_step_35_2') {
            // STEP 35.4: Scaffold approved - select recipe and show next steps
            // NOTE: scaffold_completed was already emitted by ScaffoldFlowCoordinator
            console.log('[handleResolveDecisionPoint] Scaffold approved, selecting recipe...');
            
            try {
              // Get workspace root
              const scaffoldWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              if (!scaffoldWorkspaceRoot) {
                throw new Error('No workspace folder open');
              }
              
              // Get the original intent to determine recipe
              const scaffoldEvents = this.eventStore?.getEventsByTaskId(task_id) || [];
              const scaffoldIntentEvent = scaffoldEvents.find((e: Event) => e.type === 'intent_received');
              const scaffoldPrompt = (scaffoldIntentEvent?.payload.prompt as string) || 'Create a new project';
              
              // Select recipe based on user prompt
              const recipeSelection = selectRecipe(scaffoldPrompt);
              console.log(`[handleResolveDecisionPoint] Recipe selected: ${recipeSelection.recipe_id}`);
              
              // DON'T emit scaffold_completed again - it was already emitted by ScaffoldFlowCoordinator
              // Instead, emit a scaffold_decision_resolved event to indicate recipe selection
              await this.emitEvent({
                event_id: this.generateId(),
                task_id: task_id,
                timestamp: new Date().toISOString(),
                type: 'scaffold_decision_resolved',
                mode: this.currentMode,
                stage: this.currentStage,
                payload: {
                  decision: 'proceed',
                  recipe_id: recipeSelection.recipe_id,
                  next_steps: recipeSelection.recipe_id === 'nextjs_app_router' 
                    ? ['npx create-next-app@latest my-app', 'cd my-app', 'npm run dev']
                    : recipeSelection.recipe_id === 'vite_react'
                    ? ['npm create vite@latest my-app -- --template react-ts', 'cd my-app', 'npm install', 'npm run dev']
                    : ['npx create-expo-app my-app', 'cd my-app', 'npx expo start'],
                },
                evidence_ids: [],
                parent_event_id: null,
              });
              
              await this.sendEventsToWebview(webview, task_id);
              
              // STEP 35.4 FIX: Automatically run the scaffold command in terminal
              // Don't just show a message - actually CREATE the project!
              const recipeNames: Record<string, string> = {
                'nextjs_app_router': 'Next.js',
                'vite_react': 'Vite + React',
                'expo': 'Expo',
              };
              
              // Determine the create command based on recipe
              const createCmd = recipeSelection.recipe_id === 'nextjs_app_router'
                ? 'npx create-next-app@latest my-app'
                : recipeSelection.recipe_id === 'vite_react'
                ? 'npm create vite@latest my-app -- --template react-ts'
                : 'npx create-expo-app my-app';
              
              // Emit scaffold_apply_started event
              await this.emitEvent({
                event_id: this.generateId(),
                task_id: task_id,
                timestamp: new Date().toISOString(),
                type: 'scaffold_apply_started',
                mode: this.currentMode,
                stage: this.currentStage,
                payload: {
                  recipe_id: recipeSelection.recipe_id,
                  command: createCmd,
                  target_directory: scaffoldWorkspaceRoot,
                },
                evidence_ids: [],
                parent_event_id: null,
              });
              
              await this.sendEventsToWebview(webview, task_id);
              
              // Create terminal and RUN the scaffold command automatically
              console.log('[handleResolveDecisionPoint] 🚀 Auto-running scaffold command:', createCmd);
              
              const terminal = vscode.window.createTerminal({
                name: `Scaffold: ${recipeNames[recipeSelection.recipe_id] || 'Project'}`,
                cwd: scaffoldWorkspaceRoot,
              });
              terminal.show(true); // Show terminal with focus
              terminal.sendText(createCmd);

              // 🚀 START POST-SCAFFOLD ORCHESTRATION
              // Polls for project completion, applies design pack, emits next_steps_shown
              const postScaffoldEventBus = new EventBus(this.eventStore!);
              
              // Extract scaffold ID from events or generate one
              const postScaffoldEvents = this.eventStore?.getEventsByTaskId(task_id) || [];
              const scaffoldDecisionEvent = postScaffoldEvents.find(e => e.type === 'scaffold_decision_requested');
              const scaffoldIdForPost = (scaffoldDecisionEvent?.payload?.scaffold_id as string) || this.generateId();
              
              // Extract design pack ID from scaffold context if available
              const designPackIdForPost = (scaffoldContext?.design_pack_id as string) || 'minimal-light';
              
              // Import startPostScaffoldOrchestration from core
              const coreModule = await import('core');
              const startPostScaffoldOrchestration = coreModule.startPostScaffoldOrchestration;
              
              if (typeof startPostScaffoldOrchestration === 'function') {
                const postScaffoldCtx = {
                  taskId: task_id,
                  scaffoldId: scaffoldIdForPost,
                  targetDirectory: scaffoldWorkspaceRoot,
                  appName: 'my-app', // TODO: Extract from createCmd
                  recipeId: recipeSelection.recipe_id as any,
                  designPackId: designPackIdForPost,
                  eventBus: postScaffoldEventBus,
                  mode: this.currentMode,
                };
                
                // Subscribe to post-scaffold events for UI updates
                postScaffoldEventBus.subscribe(async () => {
                  await this.sendEventsToWebview(webview, task_id);
                });
                
                // Fire and forget - orchestrator handles polling and event emission
                startPostScaffoldOrchestration(postScaffoldCtx).then((result: any) => {
                  console.log('[handleResolveDecisionPoint] ✅ Post-scaffold complete:', result);
                }).catch((error: any) => {
                  console.error('[handleResolveDecisionPoint] ❌ Post-scaffold error:', error);
                });
              } else {
                console.warn('[handleResolveDecisionPoint] ⚠️ startPostScaffoldOrchestration not available, skipping post-scaffold');
              }
              
              // Emit scaffold_applied event (command started)
              await this.emitEvent({
                event_id: this.generateId(),
                task_id: task_id,
                timestamp: new Date().toISOString(),
                type: 'scaffold_applied',
                mode: this.currentMode,
                stage: this.currentStage,
                payload: {
                  recipe_id: recipeSelection.recipe_id,
                  command: createCmd,
                  method: 'vscode_terminal',
                  message: `Scaffold command running in terminal. Follow the prompts to complete setup.`,
                },
                evidence_ids: [],
                parent_event_id: null,
              });
              
              await this.sendEventsToWebview(webview, task_id);
              
              vscode.window.showInformationMessage(
                `🎉 ${recipeNames[recipeSelection.recipe_id] || 'Project'} scaffold started! Follow the terminal prompts to complete setup.`
              );
              
            } catch (scaffoldApplyError) {
              console.error('[handleResolveDecisionPoint] Scaffold error:', scaffoldApplyError);
              vscode.window.showErrorMessage(`Scaffold failed: ${scaffoldApplyError}`);
            }
          } else if (updatedState.completionStatus === 'cancelled') {
            vscode.window.showInformationMessage('Scaffold cancelled.');
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

  private async handleRefinePlan(message: any, webview: vscode.Webview) {
    const { task_id, plan_id, refinement_text } = message;

    if (!task_id || !plan_id || !refinement_text) {
      console.error('Missing required fields in refinePlan');
      return;
    }

    try {
      // Get API key
      const apiKey = await this._context.secrets.get('ordinex.apiKey');
      if (!apiKey) {
        vscode.window.showErrorMessage('API key not configured');
        return;
      }

      // Get events to extract plan and original prompt
      const events = this.eventStore?.getEventsByTaskId(task_id) || [];
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
          content: doc.getText()
        }));

      // Initialize event bus
      if (!this.eventStore) {
        throw new Error('EventStore not initialized');
      }
      const eventBus = new EventBus(this.eventStore);

      // Cancel pending approvals for old plan
      const pendingApprovals = events.filter((e: Event) => 
        e.type === 'approval_requested' &&
        e.payload.approval_type === 'plan_approval' &&
        e.payload.details && (e.payload.details as any).plan_id === plan_id &&
        // Check if not already resolved
        !events.some((re: Event) => 
          re.type === 'approval_resolved' && 
          re.payload.approval_id === e.payload.approval_id
        )
      );

      for (const approval of pendingApprovals) {
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'approval_resolved',
          mode: this.currentMode,
          stage: this.currentStage,
          payload: {
            approval_id: approval.payload.approval_id,
            decision: 'denied',
            approved: false,
            reason: 'superseded',
            decided_at: new Date().toISOString()
          },
          evidence_ids: [],
          parent_event_id: approval.event_id,
        });
      }

      // Show progress notification
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Refining Plan',
        cancellable: false
      }, async (progress) => {
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
            maxTokens: 4096
          },
          workspaceRoot,
          openFiles
        );

        // Emit plan_revised event
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'plan_revised',
          mode: this.currentMode,
          stage: this.currentStage,
          payload: {
            ...revisedPlan,
            previous_plan_id: plan_id,
            refinement_instruction: refinement_text
          } as unknown as Record<string, unknown>,
          evidence_ids: [],
          parent_event_id: plan_id,
        });

        // Send updated events to webview
        await this.sendEventsToWebview(webview, task_id);

        console.log('Plan refined successfully');
      });

    } catch (error) {
      console.error('Error handling refinePlan:', error);
      vscode.window.showErrorMessage(`Failed to refine plan: ${error}`);
    }
  }

  /**
   * Handle clarification option selection (PLAN mode v2)
   */
  private async handleSelectClarificationOption(message: any, webview: vscode.Webview) {
    const { task_id, option_id } = message;
    const LOG_PREFIX = '[Ordinex:PlanEnhancement]';

    if (!task_id || !option_id) {
      console.error('Missing required fields in selectClarificationOption');
      return;
    }

    console.log(`${LOG_PREFIX} Selection received: option_id=${option_id}`);

    try {
      // Get events to find the clarification_presented event and extract options
      const events = this.eventStore?.getEventsByTaskId(task_id) || [];
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
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'clarification_received',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          option_id: selectedOption.id,
          title: selectedOption.title
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, task_id);

      // Get original prompt and context
      const intentEvent = events.find((e: Event) => e.type === 'intent_received');
      const userPrompt = this.planModeOriginalPrompt || (intentEvent?.payload.prompt as string) || '';
      const modelId = (intentEvent?.payload.model_id as string) || 'sonnet-4.5';

      // Use stored context or re-collect
      const lightContext = this.planModeContext;
      if (!lightContext) {
        console.error('No light context available');
        vscode.window.showErrorMessage('Plan generation failed. Try again or choose "Skip and suggest ideas".');
        return;
      }

      // Generate plan with selected option
      console.log(`${LOG_PREFIX} Generating plan with focus: ${selectedOption.title}`);
      await this.generateAndEmitPlan(userPrompt, task_id, modelId, webview, lightContext, selectedOption);

    } catch (error) {
      console.error('Error handling selectClarificationOption:', error);
      vscode.window.showErrorMessage('Plan generation failed. Try again or choose "Skip and suggest ideas".');
    }
  }

  /**
   * Handle skip clarification (PLAN mode v2)
   * Skip NEVER pauses - always generates a useful plan
   */
  private async handleSkipClarification(message: any, webview: vscode.Webview) {
    const { task_id } = message;
    const LOG_PREFIX = '[Ordinex:PlanEnhancement]';

    if (!task_id) {
      console.error('Missing task_id in skipClarification');
      return;
    }

    console.log(`${LOG_PREFIX} Skip clarification - generating fallback plan`);

    try {
      // Get events to find context
      const events = this.eventStore?.getEventsByTaskId(task_id) || [];
      const intentEvent = events.find((e: Event) => e.type === 'intent_received');
      const userPrompt = this.planModeOriginalPrompt || (intentEvent?.payload.prompt as string) || '';
      const modelId = (intentEvent?.payload.model_id as string) || 'sonnet-4.5';

      // Use stored context or re-collect
      const lightContext = this.planModeContext;
      if (!lightContext) {
        console.error('No light context available');
        vscode.window.showErrorMessage('Plan generation failed. Please try again.');
        return;
      }

      // Create fallback option
      const fallbackOption: ClarificationOption = {
        id: 'fallback-suggest',
        title: 'Suggest ideas based on analysis',
        description: 'Let me analyze and suggest 5–8 feature ideas grouped by effort',
        evidence: ['Will suggest 5–8 ideas grouped by effort']
      };

      // Emit clarification_received for skip
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'clarification_received',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          option_id: 'fallback-suggest',
          title: 'Skip - suggest ideas',
          skipped: true
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, task_id);

      // Generate plan with fallback option
      console.log(`${LOG_PREFIX} Generating fallback plan with idea suggestions`);
      await this.generateAndEmitPlan(userPrompt, task_id, modelId, webview, lightContext, fallbackOption);

    } catch (error) {
      console.error('Error handling skipClarification:', error);
      vscode.window.showErrorMessage('Plan generation failed. Please try again.');
    }
  }

  /**
   * Step 26: Handle mission selection from breakdown
   */
  private async handleSelectMission(message: any, webview: vscode.Webview) {
    const { task_id, mission_id, breakdown_id } = message;
    const LOG_PREFIX = '[Ordinex:MissionBreakdown]';

    if (!task_id || !mission_id) {
      console.error('Missing required fields in selectMission');
      return;
    }

    console.log(`${LOG_PREFIX} Mission selected: ${mission_id}`);

    try {
      // Get events to find the breakdown
      const events = this.eventStore?.getEventsByTaskId(task_id) || [];
      const breakdownEvent = events.find((e: Event) => e.type === 'mission_breakdown_created');

      if (!breakdownEvent) {
        console.error('No breakdown found');
        vscode.window.showErrorMessage('Mission breakdown not found. Please try again.');
        return;
      }

      // Emit mission_selected event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'mission_selected',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          mission_id: mission_id,
          breakdown_id: breakdown_id || breakdownEvent.payload.breakdown_id
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      // Emit execution_paused ready to start mission
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'execution_paused',
        mode: 'MISSION',
        stage: this.currentStage,
        payload: {
          reason: 'awaiting_mission_start',
          description: 'Mission selected - ready to start execution'
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, task_id);

      console.log(`${LOG_PREFIX} Mission selection recorded: ${mission_id}`);

    } catch (error) {
      console.error('Error handling selectMission:', error);
      vscode.window.showErrorMessage(`Failed to select mission: ${error}`);
    }
  }

  /**
   * Step 26: Start execution of the selected mission
   */
  private async handleStartSelectedMission(message: any, webview: vscode.Webview) {
    const { task_id } = message;
    const LOG_PREFIX = '[Ordinex:MissionBreakdown]';

    if (!task_id) {
      console.error('Missing task_id in startSelectedMission');
      return;
    }

    // CRITICAL: Check if mission is already executing (prevent duplicate starts from multiple clicks)
    if (this.isMissionExecuting) {
      console.log(`${LOG_PREFIX} ⚠️ Mission already executing, ignoring duplicate start request`);
      vscode.window.showWarningMessage('Mission is already running. Please wait for it to complete.');
      return;
    }

    console.log(`${LOG_PREFIX} Starting selected mission...`);

    try {
      // Get events to find the selected mission
      const events = this.eventStore?.getEventsByTaskId(task_id) || [];
      
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
      this.isMissionExecuting = true;
      this.currentExecutingMissionId = selectedMissionId;
      console.log(`${LOG_PREFIX} ✓ Mission execution flag set, ID: ${selectedMissionId}`);

      // Trigger handleExecutePlan with the mission plan
      // We'll emit the mission_started event and then call executePlan logic
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'mission_started',
        mode: 'MISSION',
        stage: this.currentStage,
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
      await this.sendEventsToWebview(webview, task_id);
      console.log(`${LOG_PREFIX} ✓ mission_started event broadcasted to webview`);

      // Now call the existing execute plan logic
      await this.handleExecutePlan(
        { taskId: task_id, planOverride: missionPlan, missionId: selectedMissionId, emitMissionStarted: false },
        webview
      );

    } catch (error) {
      console.error('Error handling startSelectedMission:', error);
      vscode.window.showErrorMessage(`Failed to start mission: ${error}`);
    }
  }

  /**
   * Handle mission completion sequencing - check if there are more missions and trigger next
   */
  private async handleMissionCompletionSequencing(taskId: string, webview: vscode.Webview) {
    const LOG_PREFIX = '[Ordinex:MissionSequencing]';
    console.log(`${LOG_PREFIX} ========================================`);
    console.log(`${LOG_PREFIX} Mission completed, checking for next mission...`);

    try {
      if (!this.eventStore) {
        console.log(`${LOG_PREFIX} ❌ No eventStore available`);
        return;
      }

      const events = this.eventStore.getEventsByTaskId(taskId);
      console.log(`${LOG_PREFIX} Found ${events.length} total events for task ${taskId}`);
      
      // Find the breakdown event
      const breakdownEvent = events.find((e: Event) => e.type === 'mission_breakdown_created');
      if (!breakdownEvent) {
        console.log(`${LOG_PREFIX} ℹ️ No breakdown found - single mission, done`);
        return;
      }

      console.log(`${LOG_PREFIX} ✓ Found breakdown event`);
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
      console.log(`${LOG_PREFIX} ✓ Progress: ${completedCount}/${totalMissions} missions completed`);
      console.log(`${LOG_PREFIX} ✓ Unique completed mission IDs:`, Array.from(completedMissionIds));

      // CRITICAL FIX: The next mission index = number of completed missions
      // This is reliable because missions are executed in order (0, 1, 2...)
      let nextMissionIndex = completedCount;
      
      // Safety checks
      if (nextMissionIndex < 0) {
        console.log(`${LOG_PREFIX} ⚠️ Invalid nextMissionIndex (${nextMissionIndex}), defaulting to 0`);
        nextMissionIndex = 0;
      }
      
      if (nextMissionIndex >= totalMissions) {
        console.log(`${LOG_PREFIX} ✓ nextMissionIndex (${nextMissionIndex}) >= totalMissions (${totalMissions})`);
      } else {
        console.log(`${LOG_PREFIX} ✓ Next mission index: ${nextMissionIndex} (${nextMissionIndex + 1}/${totalMissions})`);
      }

      if (nextMissionIndex >= totalMissions) {
        // All missions complete!
        console.log(`${LOG_PREFIX} ========================================`);
        console.log(`${LOG_PREFIX} 🎉 All ${totalMissions} missions completed!`);
        
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'final',
          mode: 'MISSION',
          stage: this.currentStage,
          payload: {
            success: true,
            total_missions: totalMissions,
            completed_missions: completedCount,
            message: `All ${totalMissions} missions completed successfully`
          },
          evidence_ids: [],
          parent_event_id: null,
        });

        await this.sendEventsToWebview(webview, taskId);
        vscode.window.showInformationMessage(`🎉 All ${totalMissions} missions completed successfully!`);
        return;
      }

      // There's a next mission - auto-select it and pause for user to start
      const nextMission = missions[nextMissionIndex];
      console.log(`${LOG_PREFIX} ========================================`);
      console.log(`${LOG_PREFIX} ➡️ Next mission available: ${nextMission.title}`);
      console.log(`${LOG_PREFIX} Mission ${nextMissionIndex + 1}/${totalMissions}`);
      console.log(`${LOG_PREFIX} Mission ID: ${nextMission.missionId}`);

      // Emit mission_selected for the next mission
      console.log(`${LOG_PREFIX} 📤 Emitting mission_selected event...`);
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'mission_selected',
        mode: 'MISSION',
        stage: this.currentStage,
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
      console.log(`${LOG_PREFIX} ✓ mission_selected event emitted`);

      console.log(`${LOG_PREFIX} 📤 Sending updated events to webview...`);
      await this.sendEventsToWebview(webview, taskId);
      console.log(`${LOG_PREFIX} ✓ Events sent to webview`);

      // PAUSE: Let user manually start the next mission
      // Emit execution_paused so UI shows "Start" button (not auto-start)
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'execution_paused',
        mode: 'MISSION',
        stage: this.currentStage,
        payload: {
          reason: 'awaiting_mission_start',
          description: `Mission ${nextMissionIndex + 1}/${totalMissions} selected - click Start to begin`
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);
      
      console.log(`${LOG_PREFIX} ⏸️ Paused - awaiting user to click Start for mission ${nextMissionIndex + 1}/${totalMissions}`);
      console.log(`${LOG_PREFIX} ========================================`);

    } catch (error) {
      console.error(`${LOG_PREFIX} ========================================`);
      console.error(`${LOG_PREFIX} ❌ Error handling mission sequencing:`, error);
      console.error(`${LOG_PREFIX} Error stack:`, error instanceof Error ? error.stack : 'N/A');
      console.error(`${LOG_PREFIX} ========================================`);
    }
  }

  /**
   * Step 35: Handle Scaffold Flow for greenfield project requests
   * 
   * Routes detected greenfield requests to the ScaffoldFlowCoordinator
   * which handles recipe/design pack selection and project creation.
   */
  private async handleScaffoldFlow(
    userPrompt: string,
    taskId: string,
    modelId: string,
    webview: vscode.Webview,
    attachments: any[]
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
      if (!this.eventStore) {
        throw new Error('EventStore not initialized');
      }
      const eventBus = new EventBus(this.eventStore);

      // Subscribe to events for UI updates
      eventBus.subscribe(async (event) => {
        await this.sendEventsToWebview(webview, taskId);
      });

      // Create ScaffoldFlowCoordinator
      const coordinator = new ScaffoldFlowCoordinator(eventBus);
      this.activeScaffoldCoordinator = coordinator;

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
      await this.sendEventsToWebview(webview, taskId);

      console.log(`${LOG_PREFIX} === SCAFFOLD FLOW INITIALIZED ===`);
      console.log(`${LOG_PREFIX} Awaiting user decision (Proceed/Cancel)...`);

    } catch (error) {
      console.error(`${LOG_PREFIX} Error in scaffold flow:`, error);

      // Emit failure_detected event
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          error: error instanceof Error ? error.message : 'Unknown error',
          context: 'scaffold_flow_start',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);

      vscode.window.showErrorMessage(`Scaffold flow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Step 27: Cancel an active mission
   */
  private async handleCancelMission(message: any, webview: vscode.Webview) {
    const { task_id, reason } = message;
    const LOG_PREFIX = '[Ordinex:MissionRunner]';

    if (!task_id) {
      console.error('Missing task_id in cancelMission');
      return;
    }

    console.log(`${LOG_PREFIX} Cancelling mission...`);

    try {
      // Check if we have an active mission runner
      if (this.activeMissionRunner) {
        await this.activeMissionRunner.cancelMission(reason || 'user_requested');
        this.activeMissionRunner = null;
        console.log(`${LOG_PREFIX} Mission cancelled via MissionRunner`);
      } else {
        // Fallback: emit cancellation event directly
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'mission_cancelled',
          mode: 'MISSION',
          stage: this.currentStage,
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
      await this.sendEventsToWebview(webview, task_id);

    } catch (error) {
      console.error('Error handling cancelMission:', error);
      vscode.window.showErrorMessage(`Failed to cancel mission: ${error}`);
    }
  }

  /**
   * Step 37: Handle attachment upload from webview
   * 
   * Receives base64-encoded attachment data from webview,
   * validates, stores to evidence directory, and returns evidence_id.
   */
  private async handleUploadAttachment(message: any, webview: vscode.Webview) {
    const { id, name, mimeType, data } = message;
    const LOG_PREFIX = '[Ordinex:AttachmentUpload]';

    console.log(`${LOG_PREFIX} Upload request received: ${name} (${mimeType})`);

    // Validate required fields
    if (!id || !name || !mimeType || !data) {
      console.error(`${LOG_PREFIX} Missing required fields in uploadAttachment`);
      webview.postMessage({
        type: 'ordinex:uploadResult',
        id,
        success: false,
        error: 'Missing required fields: id, name, mimeType, or data',
      });
      return;
    }

    try {
      // Get workspace root
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('No workspace folder open');
      }

      // Build attachment data object
      const attachmentData: AttachmentData = {
        id,
        name,
        mimeType,
        data,
      };

      // Validate attachment (size, MIME type)
      const validation = validateAttachment(attachmentData);
      if (!validation.valid) {
        console.error(`${LOG_PREFIX} Validation failed: ${validation.error}`);
        webview.postMessage({
          type: 'ordinex:uploadResult',
          id,
          success: false,
          error: validation.error,
        });
        return;
      }

      // Store attachment to evidence directory
      const result: AttachmentStoreResult = await storeAttachment(workspaceRoot, attachmentData);

      if (result.success) {
        console.log(`${LOG_PREFIX} ✓ Upload successful: ${result.evidenceId} (deduplicated: ${result.deduplicated})`);
        
        webview.postMessage({
          type: 'ordinex:uploadResult',
          id,
          success: true,
          evidenceId: result.evidenceId,
          evidencePath: result.evidencePath,
          deduplicated: result.deduplicated,
        });
      } else {
        console.error(`${LOG_PREFIX} ✗ Storage failed: ${result.error}`);
        webview.postMessage({
          type: 'ordinex:uploadResult',
          id,
          success: false,
          error: result.error,
        });
      }

    } catch (error) {
      console.error(`${LOG_PREFIX} ✗ Error:`, error);
      webview.postMessage({
        type: 'ordinex:uploadResult',
        id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async emitEvent(event: Event): Promise<void> {
    console.log('→ emitEvent called for type:', event.type);
    console.log('→ eventStore exists:', !!this.eventStore);
    
    if (!this.eventStore) {
      console.error('→ ERROR: EventStore is null!');
      throw new Error('EventStore not initialized');
    }
    
    console.log('→ Calling eventStore.append...');
    try {
      await this.eventStore.append(event);
      console.log('→ ✓ eventStore.append completed');
    } catch (appendError) {
      console.error('→ ❌ eventStore.append FAILED:', appendError);
      throw appendError;
    }
  }

  private async sendEventsToWebview(webview: vscode.Webview, taskId: string) {
    if (!this.eventStore) {
      return;
    }

    const events = this.eventStore.getEventsByTaskId(taskId);
    webview.postMessage({
      type: 'ordinex:eventsUpdate',
      events,
    });
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Use the Mission Control UI from the webview package
    return getWebviewContent();
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Ordinex extension activated');

  // Ensure global storage exists
  context.globalStorageUri.fsPath;

  // Register the WebviewViewProvider for the Activity Bar view
  const provider = new MissionControlViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MissionControlViewProvider.viewType,
      provider
    )
  );

  // Register API Key commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ordinex.setApiKey', async () => {
      const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your Anthropic API key',
        password: true,
        placeHolder: 'sk-ant-...',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'API key cannot be empty';
          }
          if (!value.startsWith('sk-ant-')) {
            return 'Invalid Anthropic API key format (should start with sk-ant-)';
          }
          return null;
        }
      });

      if (apiKey) {
        await context.secrets.store('ordinex.apiKey', apiKey);
        vscode.window.showInformationMessage('Ordinex API key saved successfully');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ordinex.clearApiKey', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to clear the stored API key?',
        'Clear',
        'Cancel'
      );

      if (confirm === 'Clear') {
        await context.secrets.delete('ordinex.apiKey');
        vscode.window.showInformationMessage('Ordinex API key cleared');
      }
    })
  );

  // Keep the existing command for backward compatibility
  const disposable = vscode.commands.registerCommand('ordinex.openPanel', () => {
    const panel = vscode.window.createWebviewPanel(
      'ordinexPanel',
      'Ordinex',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = getWebviewContent();
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  console.log('Ordinex extension deactivated');
}
