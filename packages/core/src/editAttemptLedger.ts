/**
 * Edit Attempt Ledger - Tracks file edit status for truncation-safe execution
 * 
 * Ensures:
 * - Never re-request diffs for files marked done
 * - Cap attempts per file (e.g., 2)
 * - Cap total chunks per step (e.g., 5)
 * - Deterministic retries
 */

export type FileEditStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

export interface FileEditAttempt {
  path: string;
  reason: string;  // Why this file is in the target set
  status: FileEditStatus;
  attempts: number;
  lastError?: string;
  completedDiff?: {
    unified_diff: string;
    new_content?: string;
    action: 'create' | 'update' | 'delete';
    base_sha?: string | null;
  };
}

export interface EditAttemptLedgerState {
  stepId: string;
  targetFiles: FileEditAttempt[];
  totalChunksAttempted: number;
  maxAttemptsPerFile: number;
  maxTotalChunks: number;
  startedAt: string;
  completedAt?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'paused' | 'failed';
  pauseReason?: string;
}

export class EditAttemptLedger {
  private state: EditAttemptLedgerState;

  constructor(
    stepId: string,
    targetFiles: Array<{ path: string; reason: string }>,
    options: {
      maxAttemptsPerFile?: number;
      maxTotalChunks?: number;
    } = {}
  ) {
    this.state = {
      stepId,
      targetFiles: targetFiles.map(f => ({
        path: f.path,
        reason: f.reason,
        status: 'pending',
        attempts: 0,
      })),
      totalChunksAttempted: 0,
      maxAttemptsPerFile: options.maxAttemptsPerFile || 2,
      maxTotalChunks: options.maxTotalChunks || 10,
      startedAt: new Date().toISOString(),
      status: 'pending',
    };
  }

  /**
   * Get current ledger state
   */
  getState(): Readonly<EditAttemptLedgerState> {
    return { ...this.state };
  }

  /**
   * Get all target files
   */
  getTargetFiles(): readonly FileEditAttempt[] {
    return this.state.targetFiles;
  }

  /**
   * Get next file to process (pending files first, then failed if retries available)
   */
  getNextFile(): FileEditAttempt | null {
    // Check caps first
    if (this.state.totalChunksAttempted >= this.state.maxTotalChunks) {
      return null;
    }

    // Find pending files
    const pending = this.state.targetFiles.find(f => f.status === 'pending');
    if (pending) {
      return pending;
    }

    // Find failed files that can be retried
    const retriable = this.state.targetFiles.find(
      f => f.status === 'failed' && f.attempts < this.state.maxAttemptsPerFile
    );
    
    return retriable || null;
  }

  /**
   * Get all pending files
   */
  getPendingFiles(): FileEditAttempt[] {
    return this.state.targetFiles.filter(f => 
      f.status === 'pending' || 
      (f.status === 'failed' && f.attempts < this.state.maxAttemptsPerFile)
    );
  }

  /**
   * Get all completed files
   */
  getCompletedFiles(): FileEditAttempt[] {
    return this.state.targetFiles.filter(f => f.status === 'done');
  }

  /**
   * Get all failed files (exhausted retries)
   */
  getFailedFiles(): FileEditAttempt[] {
    return this.state.targetFiles.filter(f => 
      f.status === 'failed' && f.attempts >= this.state.maxAttemptsPerFile
    );
  }

  /**
   * Mark file as in progress
   */
  markInProgress(path: string): void {
    const file = this.state.targetFiles.find(f => f.path === path);
    if (!file) {
      throw new Error(`File not in ledger: ${path}`);
    }
    
    file.status = 'in_progress';
    file.attempts++;
    this.state.totalChunksAttempted++;
    this.state.status = 'in_progress';
  }

  /**
   * Mark file as done with completed diff
   */
  markDone(
    path: string,
    result: {
      unified_diff: string;
      new_content?: string;
      action: 'create' | 'update' | 'delete';
      base_sha?: string | null;
    }
  ): void {
    const file = this.state.targetFiles.find(f => f.path === path);
    if (!file) {
      throw new Error(`File not in ledger: ${path}`);
    }
    
    file.status = 'done';
    file.completedDiff = result;
    file.lastError = undefined;
  }

  /**
   * Mark file as failed
   */
  markFailed(path: string, error: string): void {
    const file = this.state.targetFiles.find(f => f.path === path);
    if (!file) {
      throw new Error(`File not in ledger: ${path}`);
    }
    
    file.status = 'failed';
    file.lastError = error;
  }

  /**
   * Mark file as skipped (e.g., no changes needed)
   */
  markSkipped(path: string, reason?: string): void {
    const file = this.state.targetFiles.find(f => f.path === path);
    if (!file) {
      throw new Error(`File not in ledger: ${path}`);
    }
    
    file.status = 'skipped';
    file.lastError = reason;
  }

  /**
   * Check if we've exceeded caps and should pause
   */
  shouldPause(): { pause: boolean; reason?: string } {
    // Check total chunks cap
    if (this.state.totalChunksAttempted >= this.state.maxTotalChunks) {
      const pending = this.getPendingFiles();
      if (pending.length > 0) {
        return {
          pause: true,
          reason: `Reached maximum chunks (${this.state.maxTotalChunks}) with ${pending.length} files remaining`,
        };
      }
    }

    // Check if any files have exhausted retries
    const exhausted = this.getFailedFiles();
    if (exhausted.length > 0) {
      return {
        pause: true,
        reason: `${exhausted.length} file(s) failed after maximum retries: ${exhausted.map(f => f.path).join(', ')}`,
      };
    }

    return { pause: false };
  }

  /**
   * Pause execution with reason
   */
  pause(reason: string): void {
    this.state.status = 'paused';
    this.state.pauseReason = reason;
  }

  /**
   * Check if all files are processed (done or skipped)
   */
  isComplete(): boolean {
    return this.state.targetFiles.every(f => 
      f.status === 'done' || f.status === 'skipped'
    );
  }

  /**
   * Mark ledger as completed
   */
  complete(): void {
    this.state.status = 'completed';
    this.state.completedAt = new Date().toISOString();
  }

  /**
   * Mark ledger as failed
   */
  fail(reason: string): void {
    this.state.status = 'failed';
    this.state.pauseReason = reason;
    this.state.completedAt = new Date().toISOString();
  }

  /**
   * Get progress summary
   */
  getProgress(): {
    total: number;
    done: number;
    failed: number;
    pending: number;
    skipped: number;
    attemptsUsed: number;
    attemptsMax: number;
  } {
    const files = this.state.targetFiles;
    return {
      total: files.length,
      done: files.filter(f => f.status === 'done').length,
      failed: files.filter(f => f.status === 'failed').length,
      pending: files.filter(f => f.status === 'pending' || f.status === 'in_progress').length,
      skipped: files.filter(f => f.status === 'skipped').length,
      attemptsUsed: this.state.totalChunksAttempted,
      attemptsMax: this.state.maxTotalChunks,
    };
  }

  /**
   * Combine all completed diffs into a single unified diff
   */
  getCombinedDiff(): string {
    const completed = this.getCompletedFiles();
    if (completed.length === 0) {
      return '';
    }

    return completed
      .filter(f => f.completedDiff?.unified_diff)
      .map(f => f.completedDiff!.unified_diff)
      .join('\n');
  }

  /**
   * Get all touched files for the output
   */
  getTouchedFiles(): Array<{
    path: string;
    action: 'create' | 'update' | 'delete';
    new_content?: string;
    base_sha?: string | null;
  }> {
    return this.getCompletedFiles()
      .filter(f => f.completedDiff)
      .map(f => ({
        path: f.path,
        action: f.completedDiff!.action,
        new_content: f.completedDiff!.new_content,
        base_sha: f.completedDiff!.base_sha,
      }));
  }

  /**
   * Serialize ledger state for persistence
   */
  toJSON(): EditAttemptLedgerState {
    return { ...this.state };
  }

  /**
   * Restore ledger from persisted state
   */
  static fromJSON(state: EditAttemptLedgerState): EditAttemptLedger {
    const ledger = new EditAttemptLedger(state.stepId, []);
    ledger.state = { ...state };
    return ledger;
  }
}
