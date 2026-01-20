import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getWebviewContent } from 'webview';
import { 
  EventStore, 
  Event, 
  Mode, 
  classifyPrompt, 
  shouldRequireConfirmation, 
  generateTemplatePlan,
  generateLLMPlan,
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
  buildPlanModeSystemMessage
} from 'core';

class MissionControlViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ordinex.missionControl';
  private eventStore: EventStore | null = null;
  private currentTaskId: string | null = null;
  private currentMode: Mode = 'ANSWER';
  private currentStage: 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'none' = 'none';
  private repairOrchestrator: RepairOrchestrator | null = null;
  private isProcessing: boolean = false; // Prevent double submissions

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

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  private async handleSubmitPrompt(message: any, webview: vscode.Webview) {
    console.log('=== handleSubmitPrompt START ===');
    const { text, userSelectedMode, modelId } = message;
    console.log('Params:', { text, userSelectedMode, modelId });
    
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

    try {
      // 1. Emit intent_received event
      console.log('About to emit intent_received event...');
      try {
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
          },
          evidence_ids: [],
          parent_event_id: null,
        });
        console.log('✓ intent_received event emitted successfully');
        
        // Send to webview immediately so UI updates
        await this.sendEventsToWebview(webview, taskId);
      } catch (emitError) {
        console.error('❌ FAILED to emit intent_received event:', emitError);
        throw emitError;
      }

      // 2. Classify prompt to get suggested mode
      const classification = classifyPrompt(text);
      const requiresConfirmation = shouldRequireConfirmation(
        userSelectedMode,
        classification.suggestedMode,
        classification.confidence
      );

      // 3. Emit mode_set event
      const modeSetPayload: any = {
        mode: userSelectedMode,
        effectiveMode: userSelectedMode,
      };

      if (requiresConfirmation) {
        modeSetPayload.suggestedMode = classification.suggestedMode;
        modeSetPayload.suggestionReason = classification.reasoning;
        modeSetPayload.requiresConfirmation = true;
      }

      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'mode_set',
        mode: userSelectedMode,
        stage: this.currentStage,
        payload: modeSetPayload,
        evidence_ids: [],
        parent_event_id: null,
      });

      console.log('✓ mode_set event emitted successfully');
      console.log('Setting currentMode to:', userSelectedMode);
      this.currentMode = userSelectedMode;
      
      // Send to webview immediately so UI updates
      await this.sendEventsToWebview(webview, taskId);

      // 4. If confirmation required, stop here and wait
      console.log('Checking requiresConfirmation:', requiresConfirmation);
      if (requiresConfirmation) {
        console.log('Confirmation required - sending events to webview and returning');
        // Send events to webview
        await this.sendEventsToWebview(webview, taskId);
        console.log('Events sent, returning early');
        return;
      }

      // 5. If no confirmation needed, handle based on mode
      console.log('=== CHECKING MODE ===');
      console.log('userSelectedMode:', userSelectedMode);
      console.log('requiresConfirmation:', requiresConfirmation);
      console.log('About to handle mode-specific logic...');
      
      if (userSelectedMode === 'ANSWER') {
        console.log('>>> ENTERING ANSWER MODE BRANCH <<<');
        // ANSWER mode: Call LLM service with streaming
        await this.handleAnswerMode(text, taskId, modelId || 'sonnet-4.5', webview);
        console.log('>>> ANSWER MODE COMPLETED <<<');
      } else if (userSelectedMode === 'PLAN') {
        console.log('>>> ENTERING PLAN MODE BRANCH <<<');
        // PLAN mode: Generate LLM-based project-aware plan
        await this.handlePlanMode(text, taskId, modelId || 'sonnet-4.5', webview);
        console.log('>>> PLAN MODE COMPLETED <<<');
      } else if (userSelectedMode === 'MISSION') {
        console.log('>>> ENTERING MISSION MODE BRANCH <<<');
        // MISSION mode: Generate template plan (deterministic)
        const plan = generateTemplatePlan(text, userSelectedMode);
        
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'plan_created',
          mode: userSelectedMode,
          stage: this.currentStage,
          payload: plan as unknown as Record<string, unknown>,
          evidence_ids: [],
          parent_event_id: null,
        });
      }

      // Send events to webview
      await this.sendEventsToWebview(webview, taskId);

    } catch (error) {
      console.error('Error handling submitPrompt:', error);
      vscode.window.showErrorMessage(`Ordinex: ${error}`);
    }
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
    const { taskId } = message;

    if (!taskId) {
      console.error('Missing taskId in executePlan');
      return;
    }

    try {
      // Get events for this task to extract context
      const events = this.eventStore?.getEventsByTaskId(taskId) || [];
      const intentEvent = events.find((e: Event) => e.type === 'intent_received');
      const prompt = intentEvent?.payload.prompt as string || 'Execute task';

      // 1. Emit stage_changed → retrieve
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'stage_changed',
        mode: this.currentMode,
        stage: 'retrieve',
        payload: {
          from: this.currentStage,
          to: 'retrieve',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      this.currentStage = 'retrieve';

      // 2. Emit retrieval_started
      const retrievalId = this.generateId();
      await this.emitEvent({
        event_id: retrievalId,
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'retrieval_started',
        mode: this.currentMode,
        stage: 'retrieve',
        payload: {
          query: prompt,
          retrieval_id: retrievalId,
          constraints: {
            max_files: 10,
            max_lines: 400,
          },
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      // Send initial events to webview
      await this.sendEventsToWebview(webview, taskId);

      // 3. Perform V1 retrieval (simulated for now - would use real retriever in production)
      // TODO: Wire up actual Indexer + Retriever from packages/core/src/retrieval/
      // For now, we'll simulate the retrieval process
      
      // Simulated retrieval results
      const filesConsidered = 15;
      const filesSelected = 8;
      const totalLinesIncluded = 245;
      const evidenceIds: string[] = [];

      // Create evidence objects for retrieval results
      for (let i = 0; i < filesSelected; i++) {
        const evidenceId = this.generateId();
        evidenceIds.push(evidenceId);
        
        // In production, this would create actual Evidence objects
        // with file excerpts from the retriever
      }

      // 4. Emit retrieval_completed
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'retrieval_completed',
        mode: this.currentMode,
        stage: 'retrieve',
        payload: {
          retrieval_id: retrievalId,
          result_count: filesSelected,
          files_considered: filesConsidered,
          files_selected: filesSelected,
          total_lines_included: totalLinesIncluded,
          top_reasons: ['lexical_match', 'active_file'],
          summary: `Retrieved ${filesSelected} file(s) with ${totalLinesIncluded} total lines`,
        },
        evidence_ids: evidenceIds,
        parent_event_id: retrievalId,
      });

      // Send final events to webview
      await this.sendEventsToWebview(webview, taskId);

      console.log('Execute plan completed successfully');

    } catch (error) {
      console.error('Error handling executePlan:', error);
      
      // Emit retrieval_failed
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'retrieval_failed',
        mode: this.currentMode,
        stage: 'retrieve',
        payload: {
          error: error instanceof Error ? error.message : 'Unknown error',
          reason: 'unexpected_error',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await this.sendEventsToWebview(webview, taskId);
      vscode.window.showErrorMessage(`Retrieval failed: ${error}`);
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

  /**
   * Handle PLAN mode: Generate LLM-based project-aware plan
   */
  private async handlePlanMode(
    userPrompt: string,
    taskId: string,
    modelId: string,
    webview: vscode.Webview
  ): Promise<void> {
    console.log('=== PLAN MODE START ===');
    console.log('Prompt:', userPrompt);
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

      // 2. Collect project context for PLAN mode
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

      console.log('Step 2: Collecting project context for planning...');
      
      // Initialize event bus for context collection events
      if (!this.eventStore) {
        throw new Error('EventStore not initialized');
      }
      const eventBus = new EventBus(this.eventStore);

      // Generate LLM-based plan with project context
      const plan = await generateLLMPlan(
        userPrompt,
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

      console.log('Step 3: Plan generated successfully');
      console.log('Plan goal:', plan.goal);
      console.log('Plan steps:', plan.steps.length);

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

      console.log('PLAN mode completed successfully');

    } catch (error) {
      console.error('Error in PLAN mode:', error);

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

      if (!planEvent || planEvent.type !== 'plan_created') {
        console.error('Plan event not found');
        return;
      }

      const plan = planEvent.payload;
      const approvalId = this.generateId();

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
            risks: (plan as any).risks || []
          },
          risk_level: 'low'
        },
        evidence_ids: [],
        parent_event_id: plan_id,
      });

      // Emit execution_paused
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: task_id,
        timestamp: new Date().toISOString(),
        type: 'execution_paused',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: {
          reason: 'Awaiting plan approval'
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

        // Emit execution_paused (ready for Execute Plan)
        await this.emitEvent({
          event_id: this.generateId(),
          task_id: task_id,
          timestamp: new Date().toISOString(),
          type: 'execution_paused',
          mode: 'MISSION',
          stage: this.currentStage,
          payload: {
            reason: 'Awaiting Execute Plan action'
          },
          evidence_ids: [],
          parent_event_id: null,
        });
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
            reason: 'Plan rejected'
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
