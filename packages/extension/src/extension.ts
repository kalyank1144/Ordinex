import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getWebviewContent, getSettingsPanelContent } from 'webview';
import { VSCodeWorkspaceWriter } from './vscodeWorkspaceWriter';
import { VSCodeCheckpointManager } from './vscodeCheckpointManager';
import {
  EventStore,
  Event,
  Mode,
  StateReducer,
  ScopeManager,
  Evidence,
  TestRunner,
  FileTestEvidenceStore,
  EventBus,
  ApprovalManager,
  RepairOrchestrator,
  CommandPhaseContext,
  MissionRunner,
  getSessionContextManager,
  DEFAULT_INTELLIGENCE_SETTINGS,
  getProcessManager,
  ProjectMemoryManager,
  detectSolutionCandidate,
  GeneratedToolManager,
  isEscalation,
  analyzeRecoveryOptions,
  UndoStack,
  extractDiffFilePaths,
  getDiffCorrelationId,
  buildUndoGroup,
} from 'core';
import type { FileReadResult } from 'core';
import type { ModeTransitionResult } from 'core';
import type { ToolRegistryService, ToolExecutionPolicy } from 'core';
import type { ProcessStatusEvent, ProcessOutputEvent } from 'core';
import type { PreflightChecksInput, PreflightOrchestratorCtx, VerifyRecipeInfo, VerifyConfig, VerifyEventCtx } from 'core';
import type { EnrichedInput, EditorContext, DiagnosticEntry } from 'core';
import type { SolutionCaptureContext } from 'core';
import type { ActiveTaskMetadata } from 'core';
import { FsMemoryService } from './fsMemoryService';
import { FsToolRegistryService } from './fsToolRegistryService';
import { FsTaskPersistenceService } from './fsTaskPersistenceService';
import { FsUndoService } from './fsUndoService';

// R2: Extracted handler imports
import type { IProvider } from './handlerContext';
import { handleSubmitPrompt } from './handlers/submitPromptHandler';
import { handleAnswerMode } from './handlers/answerHandler';
import {
  handleConfirmMode,
  handleExecutePlan,
  handleSelectMission,
  handleStartSelectedMission,
  handleCancelMission,
  handleStartAutonomy,
  handleStopAutonomy,
} from './handlers/missionHandler';
import {
  handlePlanMode,
  handleExportRun,
  handleRequestPlanApproval,
  handleResolvePlanApproval,
  handleRefinePlan,
  handleSelectClarificationOption,
  handleSkipClarification,
} from './handlers/planHandler';
import {
  handleResolveApproval,
  handleResolveDecisionPoint,
} from './handlers/approvalHandler';
import {
  handleScaffoldFlow,
  handlePreflightResolution,
  handlePreflightProceed,
  handleVerificationRetry,
  handleVerificationRestore,
  handleVerificationContinue,
  handleNextStepSelected,
} from './handlers/scaffoldHandler';
import {
  handleGeneratedToolRun,
  handleProcessAction,
  handleRecoveryAction,
  handleOpenFile,
  handleUploadAttachment,
} from './handlers/toolsHandler';
import {
  openSettingsPanel as openSettingsPanelHandler,
  handleSettingsMessage as handleSettingsMessageHandler,
} from './handlers/settingsHandler';

// Step 47: Module-level ref for deactivate() access (synchronous, can't use lazy init)
let globalTaskPersistenceService: FsTaskPersistenceService | null = null;
let globalCurrentTaskId: string | null = null;

class MissionControlViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ordinex.missionControl';
  // R2: Properties made public for handler access via IProvider interface
  public eventStore: EventStore | null = null;
  public currentTaskId: string | null = null;
  public currentMode: Mode = 'ANSWER';
  public currentStage: 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'none' = 'none';
  public repairOrchestrator: RepairOrchestrator | null = null;
  public isProcessing: boolean = false;
  public activeApprovalManager: ApprovalManager | null = null;
  public activeMissionRunner: MissionRunner | null = null;
  public selectedWorkspaceRoot: string | null = null;
  public isMissionExecuting: boolean = false;
  public currentExecutingMissionId: string | null = null;
  public pendingCommandContexts: Map<string, CommandPhaseContext> = new Map();
  public activeTerminals: Map<string, vscode.Terminal> = new Map();
  public pendingPreflightResult: any = null;
  public pendingPreflightInput: PreflightChecksInput | null = null;
  public pendingPreflightCtx: PreflightOrchestratorCtx | null = null;
  public pendingVerifyTargetDir: string | null = null;
  public pendingVerifyRecipe: VerifyRecipeInfo | null = null;
  public pendingVerifyScaffoldId: string | null = null;
  public settingsPanel: vscode.WebviewPanel | null = null;
  public scaffoldProjectPath: string | null = null;
  private _memoryService: FsMemoryService | null = null;
  private _projectMemoryManager: ProjectMemoryManager | null = null;
  public recentEventsWindow: Event[] = [];
  private _toolRegistryService: FsToolRegistryService | null = null;
  private _generatedToolManager: GeneratedToolManager | null = null;
  private _taskPersistenceService: FsTaskPersistenceService | null = null;
  private _undoStack: UndoStack | null = null;
  private _fsUndoService: FsUndoService | null = null;
  public _undoBeforeCache: Map<string, Map<string, FileReadResult>> = new Map();
  public _currentWebview: vscode.Webview | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    // Initialize event store
    const storePath = path.join(_context.globalStorageUri.fsPath, 'events.jsonl');
    this.eventStore = new EventStore(storePath);

    // Step 40.5 Enhancement: Set up file change listeners for session context
    this.setupFileChangeListeners();

    // Step 40.5 Enhancement: Initialize session persistence if enabled
    this.initSessionPersistence();
  }

  // -------------------------------------------------------------------------
  // Step 40.5 Enhancement: EditorContext builder
  // -------------------------------------------------------------------------

  public buildEditorContext(): EditorContext {
    const editor = vscode.window.activeTextEditor;
    const maxDiag = DEFAULT_INTELLIGENCE_SETTINGS.maxDiagnostics;
    const maxSelected = DEFAULT_INTELLIGENCE_SETTINGS.maxSelectedTextChars;

    const editorCtx: EditorContext = {
      diagnostics: [],
      workspaceDiagnostics: [],
    };

    if (editor) {
      editorCtx.activeFile = editor.document.uri.fsPath;
      editorCtx.cursorLine = editor.selection.active.line;
      editorCtx.cursorColumn = editor.selection.active.character;

      // Selected text (capped)
      const sel = editor.document.getText(editor.selection);
      if (sel && sel.length > 0) {
        editorCtx.selectedText = sel.substring(0, maxSelected);
      }

      // File diagnostics (errors + warnings, capped)
      const fileDiags = vscode.languages.getDiagnostics(editor.document.uri);
      editorCtx.diagnostics = fileDiags
        .filter(d => d.severity <= vscode.DiagnosticSeverity.Warning)
        .slice(0, maxDiag)
        .map(d => ({
          message: d.message.substring(0, 200),
          severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' as const
            : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' as const
            : 'info' as const,
          file: editor.document.uri.fsPath,
          line: d.range.start.line,
        }));
    }

    // Workspace diagnostics (errors only, capped)
    const allDiags = vscode.languages.getDiagnostics();
    const wsErrors: DiagnosticEntry[] = [];
    for (const [uri, diags] of allDiags) {
      if (wsErrors.length >= maxDiag) break;
      for (const d of diags) {
        if (wsErrors.length >= maxDiag) break;
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          wsErrors.push({
            message: d.message.substring(0, 200),
            severity: 'error',
            file: uri.fsPath,
            line: d.range.start.line,
          });
        }
      }
    }
    editorCtx.workspaceDiagnostics = wsErrors;

    return editorCtx;
  }

  // -------------------------------------------------------------------------
  // V2-V5: Project Memory - Lazy initialization
  // -------------------------------------------------------------------------

  public getWorkspaceRoot(): string | undefined {
    return this.selectedWorkspaceRoot
      || this.scaffoldProjectPath
      || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  public getProjectMemoryManager(): ProjectMemoryManager | null {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return null;

    if (!this._projectMemoryManager) {
      const memoryRoot = path.join(workspaceRoot, '.ordinex', 'memory');
      this._memoryService = new FsMemoryService(memoryRoot);

      // Create a lightweight EventPublisher that delegates to emitEvent
      const publisher = {
        publish: (event: Event) => this.emitEvent(event),
      };
      this._projectMemoryManager = new ProjectMemoryManager(this._memoryService, publisher);
    }
    return this._projectMemoryManager;
  }

  // -------------------------------------------------------------------------
  // V6-V8: Generated Tools - Lazy initialization
  // -------------------------------------------------------------------------

  public getGeneratedToolManager(): GeneratedToolManager | null {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return null;

    if (!this._generatedToolManager) {
      const toolsRoot = path.join(workspaceRoot, '.ordinex', 'tools', 'generated');
      this._toolRegistryService = new FsToolRegistryService(toolsRoot);

      const publisher = {
        publish: (event: Event) => this.emitEvent(event),
      };
      this._generatedToolManager = new GeneratedToolManager(this._toolRegistryService, publisher);

      // Rebuild pending proposals from event history (survives extension reloads)
      if (this.eventStore && this.currentTaskId) {
        const events = this.eventStore.getEventsByTaskId(this.currentTaskId);
        this._generatedToolManager.rebuildPendingProposals(events);
      }
    }
    return this._generatedToolManager;
  }

  /**
   * V7: Get the generated tool execution policy from settings.
   */
  public getGeneratedToolPolicy(): ToolExecutionPolicy {
    const config = vscode.workspace.getConfiguration('ordinex.generatedTools');
    return config.get<ToolExecutionPolicy>('policy', 'prompt');
  }

  // -------------------------------------------------------------------------
  // Step 47: Task Persistence - Lazy initialization
  // -------------------------------------------------------------------------

  public getTaskPersistenceService(): FsTaskPersistenceService | null {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return null;

    if (!this._taskPersistenceService) {
      this._taskPersistenceService = new FsTaskPersistenceService(workspaceRoot);
      // Set module-level reference for deactivate() access
      globalTaskPersistenceService = this._taskPersistenceService;
    }
    return this._taskPersistenceService;
  }

  /**
   * Step 47: Update task persistence metadata at phase boundaries.
   * Lightweight — only updates metadata fields, not full state.
   */
  public async updateTaskPersistence(
    taskId: string,
    updates: Partial<Pick<ActiveTaskMetadata, 'mode' | 'stage' | 'last_checkpoint_id'>>,
  ): Promise<void> {
    const service = this.getTaskPersistenceService();
    if (!service) return;

    try {
      const metadata: ActiveTaskMetadata = {
        task_id: taskId,
        mode: updates.mode || this.currentMode,
        stage: updates.stage || this.currentStage,
        status: 'running',
        last_updated_at: new Date().toISOString(),
        cleanly_exited: false,
        last_checkpoint_id: updates.last_checkpoint_id,
      };
      await service.setActiveTask(metadata);
    } catch (err) {
      console.error('[Step47] Failed to update task persistence:', err);
    }
  }

  /**
   * Step 47: Clear task persistence (task completed or discarded).
   */
  public async clearTaskPersistence(): Promise<void> {
    const service = this.getTaskPersistenceService();
    if (!service) return;

    try {
      await service.clearActiveTask();
    } catch (err) {
      console.error('[Step47] Failed to clear task persistence:', err);
    }
  }

  /**
   * Step 47: Reset current task and clear persistence.
   * Centralized helper to avoid forgetting persistence cleanup.
   */
  public async resetCurrentTask(): Promise<void> {
    this.currentTaskId = null;
    globalCurrentTaskId = null;
    this.currentStage = 'none';
    await this.clearTaskPersistence();
  }

  // -------------------------------------------------------------------------
  // Step 48: Undo System - Lazy initialization + capture + execution
  // -------------------------------------------------------------------------

  public getUndoStack(): UndoStack {
    if (!this._undoStack) {
      this._undoStack = new UndoStack(50);
    }
    return this._undoStack;
  }

  public getFsUndoService(): FsUndoService | null {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return null;
    if (!this._fsUndoService) {
      this._fsUndoService = new FsUndoService(workspaceRoot);
    }
    return this._fsUndoService;
  }

  /**
   * Step 48: Capture file content for undo on diff_proposed / diff_applied events.
   * Called from emitEvent() after event is stored.
   */
  public async captureForUndo(event: Event): Promise<void> {
    const fsUndo = this.getFsUndoService();
    if (!fsUndo) return;

    if (event.type === 'diff_proposed') {
      const corrId = getDiffCorrelationId(event.payload);
      if (!corrId) return;
      const filePaths = extractDiffFilePaths(event.payload);
      const beforeMap = new Map<string, FileReadResult>();
      for (const fp of filePaths) {
        beforeMap.set(fp, await fsUndo.readFileContent(fp));
      }
      this._undoBeforeCache.set(corrId, beforeMap);
    }

    if (event.type === 'diff_applied') {
      const corrId = getDiffCorrelationId(event.payload);
      if (!corrId) return;
      const undoStack = this.getUndoStack();
      const beforeMap = this._undoBeforeCache.get(corrId);

      if (!beforeMap) {
        // Concern #6: No before cache → mark entire group non-undoable
        const filePaths = extractDiffFilePaths(event.payload);
        const emptyBefore = new Map<string, FileReadResult>();
        const afterMap = new Map<string, FileReadResult>();
        for (const fp of filePaths) {
          afterMap.set(fp, await fsUndo.readFileContent(fp));
        }
        const group = buildUndoGroup(event, emptyBefore, afterMap);
        undoStack.push(group);
      } else {
        const afterMap = new Map<string, FileReadResult>();
        for (const fp of beforeMap.keys()) {
          afterMap.set(fp, await fsUndo.readFileContent(fp));
        }
        // Check applied_files for any files not in before cache
        const appliedFiles = extractDiffFilePaths(event.payload);
        for (const fp of appliedFiles) {
          if (!beforeMap.has(fp)) {
            afterMap.set(fp, await fsUndo.readFileContent(fp));
          }
        }
        const group = buildUndoGroup(event, beforeMap, afterMap);
        undoStack.push(group);
      }
      this._undoBeforeCache.delete(corrId);
    }
  }

  /** Step 48: Sync undo state to webview. */
  public syncUndoStateToWebview(webview: vscode.Webview): void {
    const undoStack = this._undoStack;
    if (!undoStack) return;
    webview.postMessage({
      type: 'updateUndoState',
      undoable_group_ids: undoStack.getUndoableGroupIds(),
      top_undoable_group_id: undoStack.topUndoableGroupId(),
    });
  }

  /** Step 48: Handle undo action from webview or VS Code command. */
  private async handleUndoAction(message: any, webview: vscode.Webview): Promise<void> {
    const { group_id } = message;
    const undoStack = this._undoStack;
    const fsUndo = this.getFsUndoService();
    if (!undoStack || !fsUndo) return;
    const taskId = this.currentTaskId || 'unknown';

    // V9: Enforce MISSION mode for undo (writes to disk)
    if (!await this.enforceMissionMode('undo_edit', taskId)) {
      await this.sendEventsToWebview(webview, taskId);
      return;
    }

    const top = undoStack.peek();
    if (!top || top.group_id !== group_id) {
      vscode.window.showWarningMessage('Ordinex: Can only undo the most recent edit');
      return;
    }
    if (!top.undoable) {
      vscode.window.showWarningMessage('Ordinex: Undo unavailable — before state not captured');
      return;
    }

    undoStack.pop();

    // Apply undo — revert each action
    const filesRestored: string[] = [];
    const filesDeleted: string[] = [];
    const filesRecreated: string[] = [];

    for (const action of top.actions) {
      try {
        switch (action.type) {
          case 'file_edit':
            if (action.before_content !== null) {
              await fsUndo.writeFileContent(action.file_path, action.before_content);
              filesRestored.push(action.file_path);
            }
            break;
          case 'file_create':
            await fsUndo.deleteFile(action.file_path);
            filesDeleted.push(action.file_path);
            break;
          case 'file_delete':
            if (action.before_content !== null) {
              await fsUndo.ensureDirectory(action.file_path);
              await fsUndo.writeFileContent(action.file_path, action.before_content);
              filesRecreated.push(action.file_path);
            }
            break;
        }
      } catch (err) {
        console.error(`[Step48] Undo failed for ${action.file_path}:`, err);
      }
    }

    // Emit undo_performed event
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'undo_performed',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: {
        group_id,
        files_restored: filesRestored,
        files_deleted: filesDeleted,
        files_recreated: filesRecreated,
        description: top.description,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Update context key + sync webview
    vscode.commands.executeCommand('setContext', 'ordinex.hasUndoableEdits', undoStack.canUndo());
    this.syncUndoStateToWebview(webview);
    await this.sendEventsToWebview(webview, taskId);
  }

  /**
   * Step 47: Check for interrupted tasks on webview activation.
   * Reads pointer + metadata, runs pure analysis, emits task_interrupted event.
   */
  private async checkForInterruptedTasks(webview: vscode.Webview): Promise<void> {
    const service = this.getTaskPersistenceService();
    if (!service) return;

    try {
      const task = await service.getActiveTask();
      if (!task) return; // No active task — clean state

      // Get event count for this task
      let eventCount = 0;
      if (this.eventStore) {
        const events = this.eventStore.getEventsByTaskId(task.task_id);
        eventCount = events.length;
      }

      // Check if checkpoint exists
      const hasCheckpoint = !!task.last_checkpoint_id;

      // Pure analysis (from core)
      const analysis = analyzeRecoveryOptions(task, eventCount, hasCheckpoint);

      // Emit task_interrupted event with FULL payload (stateless card)
      const interruptedEvent: Event = {
        event_id: this.generateId(),
        task_id: task.task_id,
        timestamp: new Date().toISOString(),
        type: 'task_interrupted',
        mode: (task.mode as Mode) || 'ANSWER',
        stage: (task.stage as any) || 'none',
        payload: {
          task_id: task.task_id,
          was_clean_exit: task.cleanly_exited,
          is_likely_crash: !task.cleanly_exited && task.status === 'running',
          is_stale: analysis.recommended_action === 'discard',
          recommended_action: analysis.recommended_action,
          options: analysis.options,
          last_checkpoint_id: task.last_checkpoint_id || null,
          last_updated_at: task.last_updated_at,
          mode: task.mode,
          stage: task.stage,
          event_count: eventCount,
          time_since_interruption_ms: analysis.time_since_interruption_ms,
          reason: analysis.reason,
        },
        evidence_ids: [],
        parent_event_id: null,
      };

      await this.emitEvent(interruptedEvent);
      await this.sendEventsToWebview(webview, task.task_id);
    } catch (err) {
      console.error('[Step47] Error checking for interrupted tasks:', err);
    }
  }

  /**
   * Step 47: Handle user's recovery action choice from CrashRecoveryCard.
   */
  private async handleCrashRecovery(message: any, webview: vscode.Webview): Promise<void> {
    const { task_id, action, checkpoint_id } = message;
    const service = this.getTaskPersistenceService();

    if (action === 'discard') {
      // Emit task_discarded, clear persistence
      await this.emitEvent({
        event_id: this.generateId(),
        task_id,
        timestamp: new Date().toISOString(),
        type: 'task_discarded',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: { task_id },
        evidence_ids: [],
        parent_event_id: null,
      });
      this.currentTaskId = null;
      this.currentStage = 'none';
      this.currentMode = 'ANSWER';
      if (service) await service.clearActiveTask();
      await this.sendEventsToWebview(webview, task_id);
      return;
    }

    if (action === 'restore_checkpoint' && checkpoint_id) {
      // Restore checkpoint first, then resume
      await this.emitEvent({
        event_id: this.generateId(),
        task_id,
        timestamp: new Date().toISOString(),
        type: 'checkpoint_restored',
        mode: this.currentMode,
        stage: this.currentStage,
        payload: { checkpoint_id },
        evidence_ids: [],
        parent_event_id: null,
      });
      // Fall through to resume flow
    }

    // Resume: full event replay
    if (this.eventStore) {
      const events = this.eventStore.getEventsByTaskId(task_id);
      if (events.length > 0) {
        // Replay through StateReducer to derive state
        const eventBus = new EventBus(this.eventStore);
        const scopeManager = new ScopeManager(eventBus);
        const reducer = new StateReducer(scopeManager);
        const state = reducer.reduceForTask(task_id, events);

        // Rehydrate in-memory state
        this.currentTaskId = task_id;
        globalCurrentTaskId = task_id;
        this.currentMode = state.mode;
        this.currentStage = state.stage as any;

        // Send events to webview for MissionFeed replay
        await this.sendEventsToWebview(webview, task_id);
      }
    }

    // Emit task_recovery_started
    await this.emitEvent({
      event_id: this.generateId(),
      task_id,
      timestamp: new Date().toISOString(),
      type: 'task_recovery_started',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: {
        task_id,
        action,
        checkpoint_id: checkpoint_id || null,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Update persistence: running again
    if (service) {
      await service.setActiveTask({
        task_id,
        mode: this.currentMode,
        stage: this.currentStage,
        status: 'running',
        last_updated_at: new Date().toISOString(),
        cleanly_exited: false,
      });
    }

    await this.sendEventsToWebview(webview, task_id);
  }

  // -------------------------------------------------------------------------
  // V9: Mode transition wrapper — emits mode_changed event
  // -------------------------------------------------------------------------

  /**
   * Updates currentMode and emits a mode_changed event if the mode actually changed.
   * Pure wrapper: existing mode_set events are kept at call sites for backward compat.
   */
  public async setModeWithEvent(
    newMode: Mode,
    taskId: string,
    opts: {
      reason: string;
      user_initiated: boolean;
    },
  ): Promise<ModeTransitionResult> {
    const from = this.currentMode;

    // V9: Block non-user-initiated escalation UP (ANSWER→PLAN, ANSWER→MISSION, PLAN→MISSION).
    // Downgrades (MISSION→ANSWER, etc.) are always allowed automatically.
    if (isEscalation(from, newMode) && !opts.user_initiated) {
      console.log(`[V9] Blocked auto-escalation: ${from} → ${newMode} (reason: ${opts.reason})`);
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'mode_violation',
        mode: from,
        stage: this.currentStage,
        payload: {
          from_mode: from,
          to_mode: newMode,
          reason: `Auto-escalation blocked: ${from} → ${newMode}. User approval required.`,
          blocked: true,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      return { changed: false, from_mode: from, to_mode: from };
    }

    const changed = from !== newMode;
    this.currentMode = newMode;

    // Reset stage when leaving MISSION
    if (newMode !== 'MISSION') {
      this.currentStage = 'none';
    }

    if (changed) {
      await this.emitEvent({
        event_id: this.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'mode_changed',
        mode: newMode,
        stage: this.currentStage,
        payload: {
          run_id: taskId,
          from_mode: from,
          to_mode: newMode,
          reason: opts.reason,
          user_initiated: opts.user_initiated,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
    }

    return { changed, from_mode: from, to_mode: newMode };
  }

  /**
   * V9: Check if current mode allows a write/execute action.
   * Returns true if allowed, false if blocked (emits mode_violation event).
   */
  public async enforceMissionMode(
    action: string,
    taskId: string,
  ): Promise<boolean> {
    if (this.currentMode === 'MISSION') {
      return true;
    }
    console.log(`[V9] Mode enforcement: '${action}' blocked in ${this.currentMode} mode (requires MISSION)`);
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'mode_violation',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: {
        action,
        current_mode: this.currentMode,
        required_mode: 'MISSION',
        reason: `Action '${action}' requires MISSION mode, current mode is ${this.currentMode}`,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    return false;
  }

  /**
   * V3: Check if an event triggers solution capture.
   * Maintains a sliding window of recent events (max 50).
   */
  public async checkSolutionCapture(event: Event, runId: string): Promise<void> {
    this.recentEventsWindow.push(event);
    if (this.recentEventsWindow.length > 50) this.recentEventsWindow.shift();

    const pmm = this.getProjectMemoryManager();
    if (!pmm) return;

    const candidate = detectSolutionCandidate(event, {
      recentEvents: this.recentEventsWindow,
      runId,
    });
    if (candidate) {
      await pmm.captureSolution(candidate.solution, event.task_id, event.mode);
    }
  }

  // -------------------------------------------------------------------------
  // Step 40.5 Enhancement: File change listeners
  // -------------------------------------------------------------------------

  private setupFileChangeListeners(): void {
    const sessionManager = getSessionContextManager();

    this._context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.uri.scheme === 'file') {
          sessionManager.addFileMention(editor.document.uri.fsPath, 'mentioned');
        }
      })
    );

    this._context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme === 'file') {
          sessionManager.addFileMention(doc.uri.fsPath, 'edited');
        }
      })
    );

    this._context.subscriptions.push(
      vscode.languages.onDidChangeDiagnostics((event) => {
        for (const uri of event.uris) {
          const diags = vscode.languages.getDiagnostics(uri);
          for (const d of diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).slice(0, 3)) {
            sessionManager.addError(
              d.message.substring(0, 200),
              'build',
              uri.fsPath,
              d.range.start.line
            );
          }
        }
      })
    );
  }

  // -------------------------------------------------------------------------
  // Step 40.5 Enhancement: Session persistence
  // -------------------------------------------------------------------------

  private initSessionPersistence(): void {
    // Check VS Code settings for persistence preference
    const config = vscode.workspace.getConfiguration('ordinex.intelligence');
    const persistSetting = config.get<string>('sessionPersistence', 'off');

    if (persistSetting !== 'on') return;

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    const sessionManager = getSessionContextManager();
    const persistPath = path.join(workspaceRoot, '.ordinex', 'session-context.json');

    // Load existing session
    sessionManager.loadFromFile(persistPath);

    // Enable auto-save
    sessionManager.enablePersistence(persistPath);

    console.log('[Step40.5] Session persistence enabled:', persistPath);
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

    // Step 48: Store webview reference for Cmd+Shift+Z command
    this._currentWebview = webviewView.webview;

    // Set up message passing
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message, webviewView.webview);
      }
    );

    // Step 47: Check for interrupted tasks on webview activation
    this.checkForInterruptedTasks(webviewView.webview).catch(err => {
      console.error('[Step47] checkForInterruptedTasks failed:', err);
    });
  }


  private async handleMessage(message: any, webview: vscode.Webview) {
    console.log('Message from webview:', message);
    // R2: Cast `this` to IProvider for extracted handler functions
    const ctx = this as unknown as IProvider;

    switch (message.type) {
      case 'ordinex:submitPrompt':
        await handleSubmitPrompt(ctx, message, webview);
        break;

      case 'ordinex:getEvents':
        await this.handleGetEvents(message, webview);
        break;

      case 'ordinex:confirmMode':
        await handleConfirmMode(ctx, message, webview);
        break;

      case 'ordinex:executePlan':
        await handleExecutePlan(ctx, message, webview);
        break;

      case 'ordinex:proposeDiff':
        await this.handleProposeDiff(message, webview);
        break;

      case 'ordinex:runTests':
        await this.handleRunTests(message, webview);
        break;

      case 'ordinex:startAutonomy':
        await handleStartAutonomy(ctx, message, webview);
        break;

      case 'ordinex:stopAutonomy':
      case 'ordinex:stopExecution':
        await handleStopAutonomy(ctx, message, webview);
        break;

      case 'ordinex:exportRun':
        await handleExportRun(ctx, message, webview);
        break;

      case 'ordinex:requestPlanApproval':
        await handleRequestPlanApproval(ctx, message, webview);
        break;

      case 'ordinex:resolvePlanApproval':
        await handleResolvePlanApproval(ctx, message, webview);
        break;

      case 'ordinex:resolveApproval':
        await handleResolveApproval(ctx, message, webview);
        break;

      case 'ordinex:resolveDecisionPoint':
        await handleResolveDecisionPoint(ctx, message, webview);
        break;

      case 'ordinex:refinePlan':
        await handleRefinePlan(ctx, message, webview);
        break;

      case 'ordinex:selectClarificationOption':
        await handleSelectClarificationOption(ctx, message, webview);
        break;

      case 'ordinex:skipClarification':
        await handleSkipClarification(ctx, message, webview);
        break;

      case 'ordinex:selectMission':
        await handleSelectMission(ctx, message, webview);
        break;

      case 'ordinex:startSelectedMission':
        await handleStartSelectedMission(ctx, message, webview);
        break;

      case 'ordinex:cancelMission':
        await handleCancelMission(ctx, message, webview);
        break;

      case 'ordinex:startMission':
        await handleStartSelectedMission(ctx, message, webview);
        break;

      case 'ordinex:uploadAttachment':
        await handleUploadAttachment(ctx, message, webview);
        break;

      case 'preflight_resolution_selected':
        await handlePreflightResolution(ctx, message, webview);
        break;

      case 'preflight_proceed':
        await handlePreflightProceed(ctx, message, webview);
        break;

      case 'verification_retry':
        await handleVerificationRetry(ctx, message, webview);
        break;

      case 'verification_restore':
        await handleVerificationRestore(ctx, message, webview);
        break;

      case 'verification_continue':
        await handleVerificationContinue(ctx, message, webview);
        break;

      case 'next_step_selected':
        await handleNextStepSelected(ctx, message, webview);
        break;

      case 'process_action':
        await handleProcessAction(ctx, message);
        break;

      case 'generated_tool_run':
        await handleGeneratedToolRun(ctx, message, webview);
        break;

      case 'crash_recovery':
        await this.handleCrashRecovery(message, webview);
        break;

      case 'undo_action':
        await this.handleUndoAction(message, webview);
        break;

      case 'recovery_action':
        await handleRecoveryAction(ctx, message, webview);
        break;

      case 'open_file':
        await handleOpenFile(ctx, message);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  public getLastAppliedDiff(events: Event[]): { files: string[]; timestamp: string } | undefined {
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

  /** Step 47: Set module-level global task ID for deactivate() crash recovery. */
  public setGlobalCurrentTaskId(taskId: string | null): void {
    globalCurrentTaskId = taskId;
  }

  public async handleGetEvents(message: any, webview: vscode.Webview) {
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

  public async emitEvent(event: Event): Promise<void> {
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

    // V3: Check for solution capture (non-blocking)
    const runId = (event.payload.run_id as string) || event.task_id;
    this.checkSolutionCapture(event, runId).catch(err =>
      console.warn('[V3] Solution capture check failed:', err)
    );

    // Step 48: Capture file content for undo (non-blocking)
    this.captureForUndo(event).catch(err =>
      console.warn('[Step48] Undo capture failed:', err)
    );
  }

  public async sendEventsToWebview(webview: vscode.Webview, taskId: string) {
    if (!this.eventStore) {
      return;
    }

    const events = this.eventStore.getEventsByTaskId(taskId);
    webview.postMessage({
      type: 'ordinex:eventsUpdate',
      events,
    });

    // Step 48: Also sync undo state
    this.syncUndoStateToWebview(webview);
  }

  public generateId(): string {
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

  // Step 45: Register Settings command
  context.subscriptions.push(
    vscode.commands.registerCommand('ordinex.openSettings', () => {
      // Open settings as an editor tab
      const panel = vscode.window.createWebviewPanel(
        'ordinexSettings',
        'Ordinex Settings',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.webview.html = getSettingsPanelContent();

      // Wire up message handling
      panel.webview.onDidReceiveMessage(async (message) => {
        // Delegate to provider — we need a lightweight handler here since
        // the command is registered outside the class. Re-use the same logic.
        switch (message.type) {
          case 'ordinex:settings:getAll': {
            let apiKeyConfigured = false;
            let apiKeyPreview = '';
            try {
              const storedKey = await context.secrets.get('ordinex.apiKey');
              if (storedKey) {
                apiKeyConfigured = true;
                apiKeyPreview = 'sk-ant-...' + storedKey.slice(-4);
              }
            } catch { /* ignore */ }

            const cfg = vscode.workspace.getConfiguration('ordinex');
            panel.webview.postMessage({
              type: 'ordinex:settings:update',
              apiKeyConfigured,
              apiKeyPreview,
              commandPolicy: cfg.get<string>('commandPolicy.mode', 'prompt'),
              autonomyLevel: cfg.get<string>('autonomy.level', 'conservative'),
              sessionPersistence: cfg.get<string>('intelligence.sessionPersistence', 'off') === 'on',
              extensionVersion: context.extension?.packageJSON?.version || '0.0.0',
              workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '—',
              eventStorePath: path.join(context.globalStorageUri.fsPath, 'events.jsonl'),
              eventsCount: 0,
            });
            break;
          }
          case 'ordinex:settings:saveApiKey': {
            const key = message.apiKey?.trim();
            if (key && key.startsWith('sk-ant-')) {
              await context.secrets.store('ordinex.apiKey', key);
              panel.webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'API Key', success: true });
            } else {
              panel.webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'API Key', success: false, error: 'Invalid key format' });
            }
            break;
          }
          case 'ordinex:settings:clearApiKey':
            await context.secrets.delete('ordinex.apiKey');
            panel.webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'API Key', success: true });
            break;
          case 'ordinex:settings:setCommandPolicy':
            if (['off', 'prompt', 'auto'].includes(message.mode)) {
              await vscode.workspace.getConfiguration('ordinex.commandPolicy').update('mode', message.mode, vscode.ConfigurationTarget.Global);
              panel.webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'Command Policy', success: true });
            }
            break;
          case 'ordinex:settings:setAutonomyLevel':
            if (['conservative', 'balanced', 'aggressive'].includes(message.level)) {
              await vscode.workspace.getConfiguration('ordinex.autonomy').update('level', message.level, vscode.ConfigurationTarget.Global);
              panel.webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'Autonomy Level', success: true });
            }
            break;
          case 'ordinex:settings:setSessionPersistence': {
            const val = message.enabled ? 'on' : 'off';
            await vscode.workspace.getConfiguration('ordinex.intelligence').update('sessionPersistence', val, vscode.ConfigurationTarget.Global);
            panel.webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'Session Persistence', success: true });
            break;
          }
        }
      });
    })
  );

  // Keep the existing command for backward compatibility
  // Step 48: Register Undo command (Cmd+Shift+Z)
  context.subscriptions.push(
    vscode.commands.registerCommand('ordinex.undo', async () => {
      const undoStack = (provider as any)._undoStack as UndoStack | null;
      const webview = (provider as any)._currentWebview as vscode.Webview | null;
      if (!undoStack || !webview) {
        vscode.window.showInformationMessage('Ordinex: Nothing to undo');
        return;
      }
      if (undoStack.canUndo()) {
        const top = undoStack.peek();
        if (top && top.undoable) {
          await (provider as any).handleUndoAction({ group_id: top.group_id }, webview);
        } else if (top && !top.undoable) {
          vscode.window.showWarningMessage('Ordinex: Most recent edit cannot be undone');
        }
      } else {
        vscode.window.showInformationMessage('Ordinex: Nothing to undo');
      }
    })
  );

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
  console.log('Ordinex extension deactivating — stopping all processes...');

  // Step 47: Mark clean exit synchronously (within VS Code's deactivate time budget)
  if (globalTaskPersistenceService && globalCurrentTaskId) {
    try {
      globalTaskPersistenceService.markCleanExitSync(globalCurrentTaskId);
      console.log(`[Step47] Marked clean exit for task ${globalCurrentTaskId}`);
    } catch (err) {
      console.error('[Step47] Error marking clean exit on deactivate:', err);
    }
  }

  try {
    getProcessManager().stopAll('extension_deactivate');
  } catch (err) {
    console.error('Error stopping processes on deactivate:', err);
  }
  console.log('Ordinex extension deactivated');
}
