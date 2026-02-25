/**
 * R2: Handler Context Interface
 *
 * All extracted handlers receive an IProvider instance instead of using `this`.
 * This interface exposes the subset of MissionControlViewProvider that handlers need.
 * Handlers import this with `import type` to avoid circular dependencies.
 */

import type * as vscode from 'vscode';
import type {
  EventStore,
  Event,
  Mode,
  ApprovalManager,
  RepairOrchestrator,
  MissionExecutor,
  ProjectMemoryManager,
  GeneratedToolManager,
  UndoStack,
  CommandPhaseContext,
  LightContextBundle,
  ModeTransitionResult,
  ScaffoldFlowCoordinator,
  ActiveTaskMetadata,
  ConversationHistory,
  ScaffoldSession,
} from 'core';
import type { FileReadResult, ToolExecutionPolicy, PreflightChecksInput, PreflightOrchestratorCtx, VerifyRecipeInfo, VerifyConfig, VerifyEventCtx, EditorContext } from 'core';
import type { TokenCounter } from 'core/src/tokenCounter';
import type { FsTaskPersistenceService } from './fsTaskPersistenceService';
import type { FsUndoService } from './fsUndoService';
import type { BackendClient } from './backendClient';

/**
 * Mutable extension state — handlers read and write these properties directly.
 */
export interface IProvider {
  // ─── Core State ───
  eventStore: EventStore | null;
  currentTaskId: string | null;
  currentMode: Mode;
  currentStage: 'plan' | 'retrieve' | 'edit' | 'test' | 'repair' | 'none';
  isProcessing: boolean;
  isMissionExecuting: boolean;
  currentExecutingMissionId: string | null;

  // ─── Active Orchestrators ───
  activeApprovalManager: ApprovalManager | null;
  activeMissionExecutor: MissionExecutor | null;
  repairOrchestrator: RepairOrchestrator | null;
  activeScaffoldCoordinator: ScaffoldFlowCoordinator | null;

  // ─── Workspace ───
  selectedWorkspaceRoot: string | null;
  scaffoldProjectPath: string | null;
  scaffoldSession: ScaffoldSession | null;

  // ─── Pending State ───
  pendingPreflightResult: any;
  pendingPreflightInput: PreflightChecksInput | null;
  pendingPreflightCtx: PreflightOrchestratorCtx | null;
  pendingVerifyTargetDir: string | null;
  pendingVerifyRecipe: VerifyRecipeInfo | null;
  pendingVerifyScaffoldId: string | null;
  pendingCommandContexts: Map<string, CommandPhaseContext>;
  activeTerminals: Map<string, vscode.Terminal>;

  // ─── Settings ───
  settingsPanel: vscode.WebviewPanel | null;

  // ─── Plan Mode State ───
  planModeContext: LightContextBundle | null;
  planModeOriginalPrompt: string | null;

  // ─── Memory & Tools ───
  recentEventsWindow: Event[];

  // ─── Conversation (A2) ───
  conversationHistories: Map<string, ConversationHistory>;

  // ─── Undo ───
  _undoBeforeCache: Map<string, Map<string, FileReadResult>>;

  // ─── VS Code ───
  readonly _extensionUri: vscode.Uri;
  readonly _context: vscode.ExtensionContext;
  _currentWebview: vscode.Webview | null;

  // ─── Service Accessors ───
  getWorkspaceRoot(): string | undefined;
  getProjectMemoryManager(): ProjectMemoryManager | null;
  getGeneratedToolManager(): GeneratedToolManager | null;
  getGeneratedToolPolicy(): ToolExecutionPolicy;
  getTaskPersistenceService(): FsTaskPersistenceService | null;
  getUndoStack(): UndoStack;
  getFsUndoService(): FsUndoService | null;
  getBackendClient(): BackendClient;

  // ─── Conversation (A2) ───
  getConversationHistory(taskId: string): ConversationHistory;

  // ─── Token Counter (Task #5) ───
  getTokenCounter(): TokenCounter | null;

  // ─── Core Actions ───
  emitEvent(event: Event): Promise<void>;
  sendEventsToWebview(webview: vscode.Webview, taskId: string): Promise<void>;
  setModeWithEvent(
    newMode: Mode,
    taskId: string,
    opts: { reason: string; user_initiated: boolean },
  ): Promise<ModeTransitionResult>;
  enforceMissionMode(action: string, taskId: string): Promise<boolean>;

  // ─── Helpers ───
  generateId(): string;
  buildEditorContext(): EditorContext;
  updateTaskPersistence(
    taskId: string,
    updates: Partial<Pick<ActiveTaskMetadata, 'mode' | 'stage' | 'last_checkpoint_id'>>,
  ): Promise<void>;
  clearTaskPersistence(): Promise<void>;
  captureForUndo(event: Event): Promise<void>;
  getLastAppliedDiff(events: Event[]): { files: string[]; timestamp: string } | undefined;

  /** Step 47: Set module-level global task ID for deactivate() crash recovery. */
  setGlobalCurrentTaskId(taskId: string | null): void;

  // ─── Memory System (5-Layer) ───
  getRulesContext(activeFile?: string): Promise<string>;
  getSessionContext(): Promise<string>;
}
