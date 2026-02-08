/**
 * Step 40.5: Session Context - Intelligence Layer
 *
 * Tracks what has been discussed within the current VS Code session.
 * This enables "fix that thing" to resolve to the correct file.
 *
 * This is Deliverable B of the Intelligence Layer.
 *
 * Session context is in-memory by default.
 * Optional file-based persistence can be enabled via intelligence.sessionPersistence = 'on'.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Topic entry with metadata
 */
export interface TopicEntry {
  /** Topic name/description */
  topic: string;
  /** When the topic was discussed */
  timestamp: string;
  /** Associated files (if any) */
  files?: string[];
  /** Run ID where this topic was discussed */
  runId?: string;
}

/**
 * File mention entry
 */
export interface FileMention {
  /** File path (relative to workspace) */
  path: string;
  /** How the file was mentioned */
  context: 'edited' | 'mentioned' | 'error' | 'created' | 'deleted';
  /** When the file was mentioned */
  timestamp: string;
  /** Run ID where this file was touched */
  runId?: string;
}

/**
 * Decision entry
 */
export interface DecisionEntry {
  /** What was decided */
  decision: string;
  /** Context/reason for the decision */
  context?: string;
  /** When the decision was made */
  timestamp: string;
  /** Run ID where this decision was made */
  runId?: string;
}

/**
 * Pending clarification
 */
export interface PendingClarification {
  /** Clarification ID */
  id: string;
  /** The question asked */
  question: string;
  /** When it was asked */
  askedAt: string;
  /** Options provided */
  options?: string[];
  /** Whether it's still pending */
  pending: boolean;
  /** User's answer (if resolved) */
  answer?: string;
}

/**
 * Error mention for tracking "that error"
 */
export interface ErrorMention {
  /** Error message */
  message: string;
  /** File where error occurred */
  file?: string;
  /** Line number */
  line?: number;
  /** Error type/category */
  type: 'build' | 'lint' | 'runtime' | 'test' | 'unknown';
  /** When the error was discussed */
  timestamp: string;
  /** Run ID */
  runId?: string;
}

/**
 * Session context - tracks conversation history within session
 *
 * This enables contextual understanding of vague references:
 * - "fix that thing" → last error discussed
 * - "the button" → last component mentioned
 * - "that error" → last error mentioned
 */
export interface SessionContext {
  /** Recent topics discussed (newest first) */
  recentTopics: TopicEntry[];

  /** Recent files touched or mentioned (newest first) */
  recentFiles: FileMention[];

  /** User decisions made during session */
  recentDecisions: DecisionEntry[];

  /** Pending clarifications asked but not answered */
  pendingClarifications: PendingClarification[];

  /** Recent errors discussed */
  recentErrors: ErrorMention[];

  /** Session start time */
  sessionStartedAt: string;

  /** Last activity timestamp */
  lastActivityAt: string;

  /** Current run ID (if any) */
  currentRunId?: string;
}

// ============================================================================
// COMPONENT TYPES (expanded from 8 → 40+)
// ============================================================================

/**
 * Known component/code type keywords for reference resolution.
 * Used by resolveComponentReference to map vague refs to files.
 */
export const COMPONENT_TYPES: readonly string[] = [
  'button', 'form', 'modal', 'dialog', 'card', 'nav', 'header', 'footer',
  'sidebar', 'dropdown', 'table', 'input', 'select', 'hook', 'service',
  'api', 'page', 'test', 'style', 'config', 'middleware', 'handler',
  'reducer', 'store', 'provider', 'context', 'tooltip', 'toast', 'alert',
  'notification', 'spinner', 'menu', 'tabs', 'breadcrumb', 'pagination',
  'layout', 'grid', 'list', 'badge', 'chart', 'calendar', 'avatar',
  'icon', 'checkbox', 'radio', 'slider', 'switch', 'textarea',
];

// ============================================================================
// SESSION MANAGER CLASS
// ============================================================================

/**
 * Maximum entries to keep in each category
 */
const MAX_TOPICS = 10;
const MAX_FILES = 20;
const MAX_DECISIONS = 15;
const MAX_ERRORS = 10;
const MAX_CLARIFICATIONS = 5;

/**
 * Session Context Manager
 *
 * Manages the session context in memory.
 * Provides methods to update and query session history.
 */
export class SessionContextManager {
  private context: SessionContext;
  private persistPath: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SAVE_DEBOUNCE_MS = 2000;

  constructor() {
    this.context = this.createEmptyContext();
  }

  /**
   * Get current session context
   */
  getContext(): SessionContext {
    return { ...this.context };
  }

  /**
   * Get a snapshot for enrichment (read-only copy)
   */
  getSnapshot(): Readonly<SessionContext> {
    return Object.freeze({ ...this.context });
  }

  /**
   * Reset session context (e.g., on new VS Code window)
   */
  reset(): void {
    this.context = this.createEmptyContext();
  }

  /**
   * Set current run ID
   */
  setCurrentRun(runId: string): void {
    this.context.currentRunId = runId;
    this.updateActivity();
  }

  /**
   * Clear current run
   */
  clearCurrentRun(): void {
    this.context.currentRunId = undefined;
    this.updateActivity();
  }

  // -------------------------------------------------------------------------
  // TOPIC TRACKING
  // -------------------------------------------------------------------------

  /**
   * Add a topic that was discussed
   */
  addTopic(topic: string, files?: string[], runId?: string): void {
    const entry: TopicEntry = {
      topic,
      timestamp: new Date().toISOString(),
      files,
      runId: runId || this.context.currentRunId,
    };

    // Add to front, remove duplicates
    this.context.recentTopics = [
      entry,
      ...this.context.recentTopics.filter(t => t.topic !== topic),
    ].slice(0, MAX_TOPICS);

    this.updateActivity();
  }

  /**
   * Get recent topics
   */
  getRecentTopics(limit: number = 5): TopicEntry[] {
    return this.context.recentTopics.slice(0, limit);
  }

  /**
   * Check if a topic was recently discussed
   */
  wasTopicDiscussed(keyword: string): TopicEntry | undefined {
    const normalized = keyword.toLowerCase();
    return this.context.recentTopics.find(t =>
      t.topic.toLowerCase().includes(normalized)
    );
  }

  // -------------------------------------------------------------------------
  // FILE TRACKING
  // -------------------------------------------------------------------------

  /**
   * Add a file mention
   */
  addFileMention(
    filePath: string,
    context: FileMention['context'],
    runId?: string
  ): void {
    const entry: FileMention = {
      path: filePath,
      context,
      timestamp: new Date().toISOString(),
      runId: runId || this.context.currentRunId,
    };

    // Add to front, update existing if same file
    const existing = this.context.recentFiles.findIndex(f => f.path === filePath);
    if (existing >= 0) {
      this.context.recentFiles.splice(existing, 1);
    }

    this.context.recentFiles = [entry, ...this.context.recentFiles].slice(0, MAX_FILES);
    this.updateActivity();
  }

  /**
   * Get recently mentioned files
   */
  getRecentFiles(limit: number = 10): FileMention[] {
    return this.context.recentFiles.slice(0, limit);
  }

  /**
   * Get the last edited file
   */
  getLastEditedFile(): FileMention | undefined {
    return this.context.recentFiles.find(f =>
      f.context === 'edited' || f.context === 'created'
    );
  }

  /**
   * Get the last mentioned component file
   */
  getLastComponentFile(): FileMention | undefined {
    return this.context.recentFiles.find(f =>
      f.path.includes('component') ||
      f.path.endsWith('.tsx') ||
      f.path.endsWith('.jsx')
    );
  }

  /**
   * Find file by partial name
   */
  findFileByName(partialName: string): FileMention | undefined {
    const normalized = partialName.toLowerCase();
    return this.context.recentFiles.find(f =>
      f.path.toLowerCase().includes(normalized)
    );
  }

  // -------------------------------------------------------------------------
  // DECISION TRACKING
  // -------------------------------------------------------------------------

  /**
   * Record a user decision
   */
  addDecision(decision: string, context?: string, runId?: string): void {
    const entry: DecisionEntry = {
      decision,
      context,
      timestamp: new Date().toISOString(),
      runId: runId || this.context.currentRunId,
    };

    this.context.recentDecisions = [entry, ...this.context.recentDecisions].slice(
      0,
      MAX_DECISIONS
    );
    this.updateActivity();
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit: number = 5): DecisionEntry[] {
    return this.context.recentDecisions.slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // ERROR TRACKING
  // -------------------------------------------------------------------------

  /**
   * Add an error mention
   */
  addError(
    message: string,
    type: ErrorMention['type'] = 'unknown',
    file?: string,
    line?: number,
    runId?: string
  ): void {
    const entry: ErrorMention = {
      message,
      type,
      file,
      line,
      timestamp: new Date().toISOString(),
      runId: runId || this.context.currentRunId,
    };

    this.context.recentErrors = [entry, ...this.context.recentErrors].slice(0, MAX_ERRORS);
    this.updateActivity();
  }

  /**
   * Get the last error mentioned
   */
  getLastError(): ErrorMention | undefined {
    return this.context.recentErrors[0];
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 5): ErrorMention[] {
    return this.context.recentErrors.slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // CLARIFICATION TRACKING
  // -------------------------------------------------------------------------

  /**
   * Add a pending clarification
   */
  addClarification(id: string, question: string, options?: string[]): void {
    const entry: PendingClarification = {
      id,
      question,
      options,
      askedAt: new Date().toISOString(),
      pending: true,
    };

    this.context.pendingClarifications = [
      entry,
      ...this.context.pendingClarifications.filter(c => c.id !== id),
    ].slice(0, MAX_CLARIFICATIONS);

    this.updateActivity();
  }

  /**
   * Resolve a clarification with user's answer
   */
  resolveClarification(id: string, answer: string): void {
    const clarification = this.context.pendingClarifications.find(c => c.id === id);
    if (clarification) {
      clarification.pending = false;
      clarification.answer = answer;
    }
    this.updateActivity();
  }

  /**
   * Get pending clarifications
   */
  getPendingClarifications(): PendingClarification[] {
    return this.context.pendingClarifications.filter(c => c.pending);
  }

  /**
   * Check if there are pending clarifications
   */
  hasPendingClarifications(): boolean {
    return this.context.pendingClarifications.some(c => c.pending);
  }

  // -------------------------------------------------------------------------
  // REFERENCE RESOLUTION HELPERS
  // -------------------------------------------------------------------------

  /**
   * Resolve "the button" / "that component" type references with confidence scoring
   */
  resolveComponentReference(reference: string, activeFile?: string): { path: string; confidence: number } | undefined {
    const normalized = reference.toLowerCase();

    for (const type of COMPONENT_TYPES) {
      if (!normalized.includes(type)) continue;

      // 1. Exact file mention in session: high confidence
      const sessionMatch = this.context.recentFiles.find(f =>
        f.path.toLowerCase().includes(type)
      );

      // 2. Active editor file match: high confidence
      if (activeFile && activeFile.toLowerCase().includes(type)) {
        return { path: activeFile, confidence: 0.9 };
      }

      if (sessionMatch) {
        // Recently edited = higher confidence
        const confidence = sessionMatch.context === 'edited' ? 0.9 : 0.8;
        return { path: sessionMatch.path, confidence };
      }
    }

    // Generic "the component" → last component file
    if (normalized.includes('component')) {
      if (activeFile && (activeFile.endsWith('.tsx') || activeFile.endsWith('.jsx'))) {
        return { path: activeFile, confidence: 0.75 };
      }
      const lastComponent = this.getLastComponentFile();
      if (lastComponent) return { path: lastComponent.path, confidence: 0.6 };
    }

    return undefined;
  }

  /**
   * Legacy compat wrapper — returns path string only
   */
  resolveComponentReferencePath(reference: string, activeFile?: string): string | undefined {
    return this.resolveComponentReference(reference, activeFile)?.path;
  }

  /**
   * Resolve "that error" / "the error" type references
   */
  resolveErrorReference(): ErrorMention | undefined {
    return this.getLastError();
  }

  /**
   * Resolve "that file" / "the file" type references
   */
  resolveFileReference(): string | undefined {
    const lastFile = this.context.recentFiles[0];
    return lastFile?.path;
  }

  // -------------------------------------------------------------------------
  // PERSISTENCE
  // -------------------------------------------------------------------------

  /**
   * Enable auto-save to a file path. Call once during init.
   */
  enablePersistence(filePath: string): void {
    this.persistPath = filePath;
  }

  /**
   * Load session from a JSON file. Safe on missing or corrupt files.
   * Only restores metadata (files, topics, errors, decisions). No raw text.
   */
  loadFromFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || !data.sessionStartedAt) return false;

      // Restore only safe metadata fields
      this.context.recentTopics = Array.isArray(data.recentTopics) ? data.recentTopics.slice(0, MAX_TOPICS) : [];
      this.context.recentFiles = Array.isArray(data.recentFiles) ? data.recentFiles.slice(0, MAX_FILES) : [];
      this.context.recentDecisions = Array.isArray(data.recentDecisions) ? data.recentDecisions.slice(0, MAX_DECISIONS) : [];
      this.context.recentErrors = Array.isArray(data.recentErrors)
        ? data.recentErrors.slice(0, MAX_ERRORS).map((e: any) => ({
            ...e,
            message: typeof e.message === 'string' ? e.message.substring(0, 200) : '',
          }))
        : [];
      this.context.sessionStartedAt = data.sessionStartedAt;
      this.context.lastActivityAt = data.lastActivityAt || new Date().toISOString();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save session to a JSON file. Creates directories as needed.
   * Only persists metadata summaries — no raw selectedText or full diagnostics.
   */
  saveToFile(filePath: string): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        sessionStartedAt: this.context.sessionStartedAt,
        lastActivityAt: this.context.lastActivityAt,
        recentTopics: this.context.recentTopics,
        recentFiles: this.context.recentFiles,
        recentDecisions: this.context.recentDecisions,
        recentErrors: this.context.recentErrors.map(e => ({
          ...e,
          message: e.message.substring(0, 200),
        })),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Silently fail — persistence is best-effort
    }
  }

  /**
   * Get the default persistence path for a workspace
   */
  static getDefaultPersistencePath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.ordinex', 'session-context.json');
  }

  /**
   * Schedule a debounced auto-save (if persistence is enabled)
   */
  private scheduleSave(): void {
    if (!this.persistPath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.persistPath) {
        this.saveToFile(this.persistPath);
      }
    }, SessionContextManager.SAVE_DEBOUNCE_MS);
  }

  // -------------------------------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------------------------------

  private createEmptyContext(): SessionContext {
    const now = new Date().toISOString();
    return {
      recentTopics: [],
      recentFiles: [],
      recentDecisions: [],
      pendingClarifications: [],
      recentErrors: [],
      sessionStartedAt: now,
      lastActivityAt: now,
    };
  }

  private updateActivity(): void {
    this.context.lastActivityAt = new Date().toISOString();
    this.scheduleSave();
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global session context manager instance
 *
 * This is a singleton that persists for the lifetime of the VS Code session.
 * It resets when VS Code restarts.
 */
let globalSessionManager: SessionContextManager | null = null;

/**
 * Get the global session context manager
 */
export function getSessionContextManager(): SessionContextManager {
  if (!globalSessionManager) {
    globalSessionManager = new SessionContextManager();
  }
  return globalSessionManager;
}

/**
 * Reset the global session context manager
 * (useful for testing or explicit reset)
 */
export function resetSessionContextManager(): void {
  globalSessionManager = new SessionContextManager();
}

/**
 * Get current session context (convenience function)
 */
export function getSessionContext(): SessionContext {
  return getSessionContextManager().getContext();
}
