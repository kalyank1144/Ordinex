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
  resetSessionContextManager,
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
  ConversationHistory,
  resetCheckpointManagerV2,
  modeConfirmationPolicy,
} from 'core';
import type { FileReadResult } from 'core';
import type { ModeTransitionResult } from 'core';
import type { ToolRegistryService, ToolExecutionPolicy } from 'core';
import type { ProcessStatusEvent, ProcessOutputEvent } from 'core';
import type { PreflightChecksInput, PreflightOrchestratorCtx, VerifyRecipeInfo, VerifyConfig, VerifyEventCtx } from 'core';
import type { EnrichedInput, EditorContext, DiagnosticEntry } from 'core';
import type { SolutionCaptureContext } from 'core';
import type { ActiveTaskMetadata } from 'core';
import type { StagedEditBuffer } from 'core';
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
  handleApprovePlanAndExecute,
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
  public activeMissionExecutor: import('core').MissionExecutor | null = null;
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
  public conversationHistories: Map<string, ConversationHistory> = new Map();
  public _currentWebview: vscode.Webview | null = null;
  public _webviewView: vscode.WebviewView | null = null;

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

    // P2-1: Watch for workspace folder changes to invalidate cached services
    this.setupWorkspaceChangeListener();
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
    // A2: Clear conversation history for the ended task
    // (keep other tasks' histories in case of multi-task scenarios)
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

  // -------------------------------------------------------------------------
  // A2: Conversation History — per-task, lazy-initialized
  // -------------------------------------------------------------------------

  /**
   * Get or create a ConversationHistory for the given task.
   * Enables multi-turn conversations in ANSWER mode.
   */
  public getConversationHistory(taskId: string): ConversationHistory {
    let history = this.conversationHistories.get(taskId);
    if (!history) {
      history = new ConversationHistory();
      this.conversationHistories.set(taskId, history);
    }
    return history;
  }

  // ─── Token Counter (Task #5) ─────────────────────────────────────────
  private _tokenCounter: import('./anthropicTokenCounter').AnthropicTokenCounter | null = null;

  public getTokenCounter(): import('core/src/tokenCounter').TokenCounter | null {
    return this._tokenCounter;
  }

  /** Reset the token counter (e.g. when API key changes). */
  public resetTokenCounter(): void {
    this._tokenCounter = null;
  }

  /**
   * Lazily create or re-create the AnthropicTokenCounter when an API key
   * becomes available. Called before ANSWER/MISSION mode flows.
   */
  private async ensureTokenCounter(): Promise<void> {
    if (this._tokenCounter) return;
    const apiKey = await this._context.secrets.get('ordinex.apiKey');
    if (apiKey) {
      try {
        const { AnthropicTokenCounter } = require('./anthropicTokenCounter');
        this._tokenCounter = new AnthropicTokenCounter(apiKey);
      } catch {
        // SDK not available — stay null, CharacterTokenCounter will be used
      }
    }
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

    // Refresh open editor tabs so the user sees the reverted content.
    // VS Code caches file content in the editor; we must explicitly revert the documents.
    const workspaceRoot = this.scaffoldProjectPath
      || this.selectedWorkspaceRoot
      || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      || '';
    const allAffectedFiles = [...filesRestored, ...filesRecreated];
    for (const relPath of allAffectedFiles) {
      try {
        const absPath = require('path').resolve(workspaceRoot, relPath);
        const uri = vscode.Uri.file(absPath);
        // Find the document if it's open, and revert it to disk content
        const openDoc = vscode.workspace.textDocuments.find(
          d => d.uri.fsPath === uri.fsPath
        );
        if (openDoc && !openDoc.isClosed) {
          // Open and show the reverted file, then revert to the on-disk version
          const editor = await vscode.window.showTextDocument(openDoc, { preview: false, preserveFocus: true });
          await vscode.commands.executeCommand('workbench.action.files.revert');
        }
      } catch (revertErr) {
        console.warn(`[Step48] Could not revert editor for ${relPath}:`, revertErr);
      }
    }
    // Close tabs for files that were deleted (created files undone = deleted)
    for (const relPath of filesDeleted) {
      try {
        const absPath = require('path').resolve(workspaceRoot, relPath);
        const uri = vscode.Uri.file(absPath);
        // Find and close any open tab for the deleted file
        const tabGroups = vscode.window.tabGroups;
        for (const group of tabGroups.all) {
          for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === uri.fsPath) {
              await vscode.window.tabGroups.close(tab);
            }
          }
        }
      } catch (closeErr) {
        console.warn(`[Step48] Could not close tab for ${relPath}:`, closeErr);
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
   * A9: Check if this is the user's first run and show onboarding if so.
   * Uses globalState to persist the onboarding completion flag.
   */
  private checkAndShowOnboarding(webview: vscode.Webview): void {
    const onboardingCompleted = this._context.globalState.get<boolean>('ordinex.onboardingCompleted', false);
    if (!onboardingCompleted) {
      console.log('[A9] First run detected — showing onboarding');
      // Small delay to let the webview fully initialize before showing overlay
      setTimeout(() => {
        webview.postMessage({ type: 'ordinex:showOnboarding' });
      }, 500);
    } else {
      console.log('[A9] Onboarding already completed');
    }
  }

  /**
   * Task restoration on webview activation.
   *
   * Case 1: Extension state already has currentTaskId (panel was hidden/shown, not restarted)
   *         → Silently re-send events. No card needed.
   * Case 2: No currentTaskId but persistence has an active task (IDE restart)
   *         → If clean exit: silently restore timeline. No card.
   *         → If actual crash (cleanly_exited=false, status=running): show recovery card.
   * Case 3: No persisted task → clean empty state (nothing to do).
   */
  private async restoreOrDetectCrash(webview: vscode.Webview): Promise<void> {
    // Case 1: Extension already knows the active task (panel was just hidden/shown)
    if (this.currentTaskId && this.eventStore) {
      const events = this.eventStore.getEventsByTaskId(this.currentTaskId);
      if (events.length > 0) {
        console.log('[Persistence] Silent restore — re-sending', events.length, 'events for task', this.currentTaskId);
        webview.postMessage({
          type: 'ordinex:taskSwitched',
          task_id: this.currentTaskId,
          events,
          mode: this.currentMode,
          stage: this.currentStage,
        });
        this.syncUndoStateToWebview(webview);
        return;
      }
    }

    // Case 2: Check file-based persistence (IDE restart scenario)
    const service = this.getTaskPersistenceService();
    if (!service) return;

    try {
      const task = await service.getActiveTask();
      if (!task) return; // Case 3: No persisted task — clean state

      const isLikelyCrash = !task.cleanly_exited && task.status === 'running';

      if (isLikelyCrash) {
        // Actual crash — show recovery card so user can choose to restore checkpoint
        console.log('[Persistence] Crash detected for task', task.task_id, '— showing recovery card');

        let eventCount = 0;
        if (this.eventStore) {
          eventCount = this.eventStore.getEventsByTaskId(task.task_id).length;
        }

        const hasCheckpoint = !!task.last_checkpoint_id;
        const analysis = analyzeRecoveryOptions(task, eventCount, hasCheckpoint);

        const interruptedEvent: Event = {
          event_id: this.generateId(),
          task_id: task.task_id,
          timestamp: new Date().toISOString(),
          type: 'task_interrupted',
          mode: (task.mode as Mode) || 'ANSWER',
          stage: (task.stage as any) || 'none',
          payload: {
            task_id: task.task_id,
            was_clean_exit: false,
            is_likely_crash: true,
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
      } else {
        // Clean exit (paused) — silently restore the timeline
        console.log('[Persistence] Clean restore for task', task.task_id);

        // Rehydrate extension state
        this.currentTaskId = task.task_id;
        globalCurrentTaskId = task.task_id;
        this.currentMode = (task.mode as Mode) || 'ANSWER';
        this.currentStage = (task.stage as any) || 'none';

        // Send events to webview for seamless timeline display
        if (this.eventStore) {
          const events = this.eventStore.getEventsByTaskId(task.task_id);
          if (events.length > 0) {
            webview.postMessage({
              type: 'ordinex:taskSwitched',
              task_id: task.task_id,
              events,
              mode: this.currentMode,
              stage: this.currentStage,
            });
            this.syncUndoStateToWebview(webview);
          }
        }
      }
    } catch (err) {
      console.error('[Persistence] Error in restoreOrDetectCrash:', err);
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

  // -------------------------------------------------------------------------
  // P2-1: Workspace change invalidation
  // -------------------------------------------------------------------------

  /**
   * Reset all cached workspace-specific services.
   * Called when VS Code workspace folders change so that lazy getters
   * re-initialize with the new workspace root on next access.
   */
  public resetWorkspaceServices(): void {
    console.log('[P2-1] Invalidating cached workspace services...');

    // Extension-level lazy singletons
    this._projectMemoryManager = null;
    this._memoryService = null;
    this._generatedToolManager = null;
    this._toolRegistryService = null;
    this._taskPersistenceService = null;
    this._undoStack = null;
    this._fsUndoService = null;
    this._undoBeforeCache.clear();

    // Core-level module singletons
    resetSessionContextManager();
    resetCheckpointManagerV2();
    modeConfirmationPolicy.clearCache();

    // Clear task & mission state
    this.currentTaskId = null;
    this.currentMode = 'ANSWER';
    this.currentStage = 'none';
    this.isMissionExecuting = false;
    this.currentExecutingMissionId = null;
    this.activeMissionRunner = null;
    this.activeMissionExecutor = null;
    this.activeApprovalManager = null;
    this.repairOrchestrator = null;
    this.recentEventsWindow = [];
    this.pendingCommandContexts.clear();
    this.conversationHistories.clear();
    this.pendingPreflightResult = null;
    this.pendingPreflightInput = null;
    this.pendingPreflightCtx = null;

    // Clear module-level refs
    globalTaskPersistenceService = null;
    globalCurrentTaskId = null;

    // Reset VS Code context keys
    vscode.commands.executeCommand('setContext', 'ordinex.isRunning', false);
    vscode.commands.executeCommand('setContext', 'ordinex.hasUndoableEdits', false);

    // Re-initialize session persistence for the new workspace
    this.initSessionPersistence();

    // Notify the webview to clear its state
    if (this._currentWebview) {
      this._currentWebview.postMessage({ type: 'ordinex:newChat' });
    }

    console.log('[P2-1] Workspace services reset complete');
  }

  /**
   * Set up workspace folder change listener.
   * Called from the constructor to register the subscription.
   */
  public setupWorkspaceChangeListener(): void {
    this._context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        console.log('[P2-1] Workspace folders changed:', {
          added: event.added.map(f => f.uri.fsPath),
          removed: event.removed.map(f => f.uri.fsPath),
        });
        this.resetWorkspaceServices();
      })
    );
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

    // Step 52: Store WebviewView reference for focus/reveal commands
    this._webviewView = webviewView;

    // Set up message passing
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message, webviewView.webview);
      }
    );

    // A9: Check if onboarding should be shown (first-run detection)
    this.checkAndShowOnboarding(webviewView.webview);

    // Silent task restoration or crash detection.
    // Clean exits: silently restore the timeline (no card).
    // Actual crashes: show recovery card with working Resume/Discard.
    this.restoreOrDetectCrash(webviewView.webview).catch(err => {
      console.error('[Persistence] restoreOrDetectCrash failed:', err);
    });
  }


  private async handleMessage(message: any, webview: vscode.Webview) {
    console.log('Message from webview:', message);
    // R2: Cast `this` to IProvider for extracted handler functions
    const ctx = this as unknown as IProvider;

    switch (message.type) {
      case 'ordinex:submitPrompt':
        await this.ensureTokenCounter();
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

      case 'ordinex:approvePlanAndExecute':
        await handleApprovePlanAndExecute(ctx, message, webview);
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

      case 'ordinex:loopAction':
        await this.handleLoopAction(message, webview);
        break;

      // A9: Onboarding complete — persist the flag
      case 'ordinex:onboardingComplete':
        await this._context.globalState.update('ordinex.onboardingCompleted', true);
        console.log('[A9] Onboarding completed — flag persisted');
        break;

      // Step 52: New Chat — reset extension-side state for a fresh session
      case 'ordinex:newChat':
        console.log('[Step52] New chat requested — resetting provider state');
        this.currentTaskId = null;
        this.currentMode = 'ANSWER';
        this.currentStage = 'none';
        this.isMissionExecuting = false;
        this.currentExecutingMissionId = null;
        this.recentEventsWindow = [];
        this.activeMissionRunner = null;
        this.activeMissionExecutor = null;
        this.activeApprovalManager = null;
        this.repairOrchestrator = null;
        this.pendingCommandContexts.clear();
        this.pendingPreflightResult = null;
        this.pendingPreflightInput = null;
        this.pendingPreflightCtx = null;
        vscode.commands.executeCommand('setContext', 'ordinex.isRunning', false);
        vscode.commands.executeCommand('setContext', 'ordinex.hasUndoableEdits', false);
        break;

      // Task History: Return all distinct task summaries for the history panel
      case 'ordinex:getTaskHistory':
        if (this.eventStore) {
          const summaries = this.eventStore.getDistinctTaskSummaries();
          webview.postMessage({
            type: 'ordinex:taskHistory',
            tasks: summaries,
            currentTaskId: this.currentTaskId,
          });
        }
        break;

      // Task History: Switch to a previously completed task
      case 'ordinex:switchTask': {
        const switchTaskId = message.task_id;
        if (!switchTaskId || !this.eventStore) break;

        console.log('[TaskHistory] Switching to task:', switchTaskId);

        // Reset running state (don't interrupt running missions)
        if (this.isMissionExecuting) {
          vscode.window.showWarningMessage('Cannot switch tasks while a mission is executing. Stop the current mission first.');
          break;
        }

        // Load events for the target task
        const taskEvents = this.eventStore.getEventsByTaskId(switchTaskId);
        if (taskEvents.length === 0) {
          vscode.window.showWarningMessage('No events found for this task.');
          break;
        }

        // Update extension state — reset to defaults first to avoid leaking
        // the previous task's mode/stage when the target task lacks those events.
        this.currentTaskId = switchTaskId;
        globalCurrentTaskId = switchTaskId;
        this.currentMode = 'ANSWER';
        this.currentStage = 'none';

        // Derive mode and stage from the task's events (if available)
        const lastModeEvent = [...taskEvents].reverse().find((e: Event) => e.type === 'mode_set');
        if (lastModeEvent && lastModeEvent.payload?.mode) {
          this.currentMode = lastModeEvent.payload.mode as Mode;
        } else {
          // Fallback: use the mode from the first event
          const firstEventMode = taskEvents[0]?.mode;
          if (firstEventMode) {
            this.currentMode = firstEventMode as Mode;
          }
        }
        const lastStageEvent = [...taskEvents].reverse().find((e: Event) => e.type === 'stage_changed');
        if (lastStageEvent && lastStageEvent.payload?.to) {
          this.currentStage = lastStageEvent.payload.to as typeof this.currentStage;
        }

        // Reset transient state
        this.isMissionExecuting = false;
        this.currentExecutingMissionId = null;
        this.recentEventsWindow = [];
        this.activeMissionRunner = null;
        this.activeMissionExecutor = null;
        this.activeApprovalManager = null;
        this.repairOrchestrator = null;
        this.pendingCommandContexts.clear();
        this.pendingPreflightResult = null;
        this.pendingPreflightInput = null;
        this.pendingPreflightCtx = null;
        vscode.commands.executeCommand('setContext', 'ordinex.isRunning', false);

        // Clear undo stack from the previous task so stale edits aren't attributed
        // to the newly switched task, then sync the clean state to the webview.
        this._undoStack = null;
        this._undoBeforeCache.clear();
        vscode.commands.executeCommand('setContext', 'ordinex.hasUndoableEdits', false);
        webview.postMessage({
          type: 'updateUndoState',
          undoable_group_ids: [],
          top_undoable_group_id: null,
        });

        // Persist the active-task pointer so IDE restart restores this task
        const persistService = this.getTaskPersistenceService();
        if (persistService) {
          await persistService.setActiveTask({
            task_id: switchTaskId,
            mode: this.currentMode,
            stage: this.currentStage,
            status: 'paused',
            last_updated_at: new Date().toISOString(),
            cleanly_exited: true,
          });
        }

        // Send events to webview — webview handles re-rendering
        webview.postMessage({
          type: 'ordinex:taskSwitched',
          task_id: switchTaskId,
          events: taskEvents,
          mode: this.currentMode,
          stage: this.currentStage,
        });

        console.log('[TaskHistory] Switched to task:', switchTaskId, 'with', taskEvents.length, 'events');
        break;
      }

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  /**
   * Handle AgenticLoop actions (Continue, Approve Partial, Discard).
   */
  private async handleLoopAction(message: any, webview: vscode.Webview): Promise<void> {
    const { action, step_id, session_id, task_id } = message;
    const taskId = task_id || this.currentTaskId;

    console.log(`[handleLoopAction] action=${action}, step_id=${step_id}, session_id=${session_id}`);

    if (!this.activeMissionExecutor) {
      console.error('[handleLoopAction] No active MissionExecutor');
      vscode.window.showErrorMessage('No active mission executor for loop action');
      return;
    }

    const executor = this.activeMissionExecutor;

    try {
      switch (action) {
        case 'continue_loop': {
          // Find the step from the stored plan
          const session = executor.getActiveLoopSession(step_id);
          if (!session) {
            vscode.window.showErrorMessage(`No active loop session for step ${step_id}`);
            return;
          }

          // We need the step object — get it from events
          const events = this.eventStore?.getEventsByTaskId(taskId) || [];
          const stepEvent = events.find((e: Event) =>
            e.type === 'step_started' && e.payload.step_id === step_id
          );
          const step = {
            step_id,
            description: (stepEvent?.payload.description as string) || step_id,
          };

          const result = await executor.continueLoop(step_id, step as any);
          if (result.success) {
            console.log('[handleLoopAction] Continue succeeded');
          } else {
            console.log('[handleLoopAction] Continue resulted in pause:', result.pauseReason);
          }
          break;
        }

        case 'approve_partial': {
          const session = executor.getActiveLoopSession(step_id);
          const buffer = executor.getActiveStagedBuffer(step_id);
          if (!session || !buffer) {
            vscode.window.showErrorMessage('No staged changes to approve');
            return;
          }

          // Open VS Code diff viewer for each staged file so user can review
          const workspaceRoot = this.scaffoldProjectPath
            || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceRoot) {
            await this.openStagedDiffs(buffer, workspaceRoot);
          }

          const events = this.eventStore?.getEventsByTaskId(taskId) || [];
          const stepEvent = events.find((e: Event) =>
            e.type === 'step_started' && e.payload.step_id === step_id
          );
          const step = {
            step_id,
            description: (stepEvent?.payload.description as string) || step_id,
          };

          const result = await executor.applyStagedEdits(step as any, session, buffer);
          if (result.success) {
            console.log('[handleLoopAction] Approve partial succeeded');
          } else {
            console.log('[handleLoopAction] Approve partial failed:', result.error);
          }

          // Send updated events to webview after approval completes
          await this.sendEventsToWebview(webview, taskId);
          break;
        }

        case 'discard_loop': {
          executor.discardLoop(step_id);

          // Emit loop_completed to close the loop lifecycle cleanly
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'loop_completed',
            mode: this.currentMode,
            stage: this.currentStage,
            payload: {
              result: 'discarded',
              step_id,
              session_id,
              files_applied: 0,
              iterations: 0,
            },
            evidence_ids: [],
            parent_event_id: null,
          });

          // Also emit execution_paused for status tracking
          await this.emitEvent({
            event_id: this.generateId(),
            task_id: taskId,
            timestamp: new Date().toISOString(),
            type: 'execution_paused',
            mode: this.currentMode,
            stage: this.currentStage,
            payload: {
              reason: 'loop_discarded',
              step_id,
              session_id,
            },
            evidence_ids: [],
            parent_event_id: null,
          });

          console.log('[handleLoopAction] Loop discarded');
          break;
        }

        default:
          console.warn(`[handleLoopAction] Unknown action: ${action}`);
      }
    } catch (error) {
      console.error('[handleLoopAction] Error:', error);
      vscode.window.showErrorMessage(`Loop action failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Update webview
    if (taskId) {
      await this.sendEventsToWebview(webview, taskId);
    }
  }

  /**
   * Open VS Code diff viewer tabs for each staged file.
   * Shows before (disk) vs after (staged) so user can review changes.
   */
  private async openStagedDiffs(buffer: StagedEditBuffer, workspaceRoot: string): Promise<void> {
    const modifiedFiles = buffer.getModifiedFiles();
    if (modifiedFiles.length === 0) return;

    // Limit to 5 tabs to avoid overwhelming the editor
    const filesToShow = modifiedFiles.slice(0, 5);

    for (const stagedFile of filesToShow) {
      try {
        const fullPath = path.resolve(workspaceRoot, stagedFile.path);

        // Read current disk content (before)
        let beforeContent = '';
        if (!stagedFile.isNew) {
          try {
            beforeContent = await fs.promises.readFile(fullPath, 'utf-8');
          } catch {
            beforeContent = ''; // File may not exist on disk
          }
        }

        // Create virtual URIs for before/after content
        const beforeUri = vscode.Uri.parse(
          `untitled:${stagedFile.path}.before`
        ).with({ scheme: 'ordinex-before' });
        const afterUri = vscode.Uri.parse(
          `untitled:${stagedFile.path}.after`
        ).with({ scheme: 'ordinex-after' });

        // Use temp files for diff since custom URI schemes need providers
        const tmpDir = path.join(this._context.globalStorageUri.fsPath, 'diff-preview');
        await fs.promises.mkdir(tmpDir, { recursive: true });

        const safeName = stagedFile.path.replace(/[/\\]/g, '__');
        const beforePath = path.join(tmpDir, `${safeName}.before`);
        const afterPath = path.join(tmpDir, `${safeName}.after`);

        await fs.promises.writeFile(beforePath, beforeContent, 'utf-8');
        await fs.promises.writeFile(afterPath, stagedFile.content, 'utf-8');

        const beforeFileUri = vscode.Uri.file(beforePath);
        const afterFileUri = vscode.Uri.file(afterPath);

        const label = stagedFile.isNew
          ? `${stagedFile.path} (New File)`
          : `${stagedFile.path} (Staged Changes)`;

        await vscode.commands.executeCommand(
          'vscode.diff',
          beforeFileUri,
          afterFileUri,
          label,
        );
      } catch (err) {
        console.warn(`[openStagedDiffs] Failed to open diff for ${stagedFile.path}:`, err);
      }
    }

    if (modifiedFiles.length > 5) {
      vscode.window.showInformationMessage(
        `Showing diffs for first 5 of ${modifiedFiles.length} files. Review remaining files in the Mission tab.`
      );
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
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
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
        // Reset token counter so it picks up the new key on next prompt
        provider.resetTokenCounter();
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

      // Wire up message handling — delegate to extracted settings handler
      panel.webview.onDidReceiveMessage(async (message) => {
        await handleSettingsMessageHandler(provider as unknown as IProvider, message, panel.webview);
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

  // Step 52: Keyboard shortcut commands
  // Cmd+Shift+O — Focus/reveal the Ordinex sidebar panel
  context.subscriptions.push(
    vscode.commands.registerCommand('ordinex.focusPanel', () => {
      const webviewView = (provider as any)._webviewView as vscode.WebviewView | null;
      if (webviewView) {
        webviewView.show(true);
      } else {
        // Fallback: open the sidebar view via built-in command
        vscode.commands.executeCommand('ordinex.missionControl.focus');
      }
    })
  );

  // Cmd+L — Focus the prompt input inside the webview
  context.subscriptions.push(
    vscode.commands.registerCommand('ordinex.focusInput', () => {
      const webviewView = (provider as any)._webviewView as vscode.WebviewView | null;
      const webview = (provider as any)._currentWebview as vscode.Webview | null;
      if (webviewView) {
        webviewView.show(true);
      }
      if (webview) {
        webview.postMessage({ type: 'ordinex:focusInput' });
      }
    })
  );

  // Cmd+Shift+N — New chat (clear conversation and focus input)
  context.subscriptions.push(
    vscode.commands.registerCommand('ordinex.newChat', () => {
      const webviewView = (provider as any)._webviewView as vscode.WebviewView | null;
      const webview = (provider as any)._currentWebview as vscode.Webview | null;
      if (webviewView) {
        webviewView.show(true);
      }
      if (webview) {
        webview.postMessage({ type: 'ordinex:newChat' });
      }
    })
  );

  // Escape — Stop current execution (only when Ordinex is focused & running)
  context.subscriptions.push(
    vscode.commands.registerCommand('ordinex.stopExecution', () => {
      const webview = (provider as any)._currentWebview as vscode.Webview | null;
      const providerRef = provider as any;
      if (providerRef.isMissionExecuting && webview) {
        webview.postMessage({ type: 'ordinex:triggerStop' });
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
