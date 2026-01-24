/**
 * Workspace Adapter Interfaces
 * 
 * These interfaces define contracts for workspace operations
 * WITHOUT importing vscode directly. This keeps core/ portable.
 * 
 * Implementations live in packages/extension/ and use VS Code APIs.
 */

/**
 * FilePatch represents a single file operation
 * Used for both checkpoint creation and applying changes
 */
export interface FilePatch {
  /** Relative path from workspace root */
  path: string;
  
  /** Type of operation */
  action: 'create' | 'update' | 'delete';
  
  /** 
   * Full new content for create/update operations
   * MUST be undefined for delete operations
   */
  newContent?: string;
  
  /**
   * SHA-256 hash (first 12 chars) of the file content used as base
   * Used for staleness detection
   * undefined/null for newly created files
   */
  baseSha?: string | null;
}

/**
 * WorkspaceWriter handles actual file system operations
 * Implementation uses VS Code APIs in packages/extension/
 */
export interface WorkspaceWriter {
  /**
   * Apply file patches to workspace
   * 
   * This method MUST:
   * - Create directories as needed
   * - Write full file content for create/update
   * - Delete files for delete operations
   * - Refresh/save any open documents
   * - Be atomic: either all succeed or all fail (rollback if needed)
   * 
   * @throws Error if any operation fails
   */
  applyPatches(patches: FilePatch[]): Promise<void>;
  
  /**
   * Open files in editor beside current view
   * 
   * Opens the specified files in VS Code's ViewColumn.Beside
   * with preserveFocus: true so user can see changes without losing focus
   * 
   * @param paths - Relative paths to open (typically just the first changed file)
   */
  openFilesBeside(paths: string[]): Promise<void>;
}

/**
 * CheckpointFile represents a backed-up file before changes
 */
export interface CheckpointFile {
  /** Relative path from workspace root */
  path: string;
  
  /** SHA-256 hash (first 12 chars) of content before changes */
  beforeSha: string;
  
  /** Path where backup is stored */
  backupPath: string;
  
  /** Whether file existed before the change */
  existedBefore: boolean;
  
  /** Original content (if existed before) */
  originalContent?: string;
}

/**
 * CheckpointResult returned after creating a checkpoint
 */
export interface CheckpointResult {
  /** Unique checkpoint ID */
  checkpointId: string;
  
  /** Files backed up */
  files: CheckpointFile[];
  
  /** Timestamp of checkpoint creation */
  createdAt: string;
}

/**
 * RollbackResult returned after rolling back a checkpoint
 */
export interface RollbackResult {
  /** Checkpoint ID that was rolled back */
  checkpointId: string;
  
  /** Files that were restored */
  filesRestored: Array<{
    path: string;
    action: 'restored' | 'deleted';  // restored: wrote back original, deleted: removed newly created file
  }>;
  
  /** Timestamp of rollback */
  rolledBackAt: string;
}

/**
 * CheckpointManager handles backup and rollback of file changes
 * Implementation stores backups in .ordinex/checkpoints/
 */
export interface CheckpointManager {
  /**
   * Create a checkpoint for the given patches
   * 
   * This method MUST:
   * - Read current content of all files
   * - Store existedBefore flag (false for create operations)
   * - Store originalContent (if file exists)
   * - Save checkpoint metadata to .ordinex/checkpoints/<id>.json
   * - Return checkpoint result with all backed up files
   * 
   * @param patches - File patches to create checkpoint for
   * @returns CheckpointResult with backup information
   */
  createCheckpoint(patches: FilePatch[]): Promise<CheckpointResult>;
  
  /**
   * Rollback a checkpoint (restore original state)
   * 
   * This method MUST:
   * - For files that existedBefore: restore originalContent
   * - For files that did NOT exist before: delete them
   * - Return list of files restored
   * 
   * Rollback strategy (SIMPLIFIED):
   * - If existedBefore: write originalContent back (regardless of current action)
   * - Else: delete the file if it exists
   * 
   * @param checkpointId - ID of checkpoint to rollback
   * @returns RollbackResult with files restored
   */
  rollback(checkpointId: string): Promise<RollbackResult>;
  
  /**
   * Get checkpoint information
   * @param checkpointId - ID of checkpoint
   * @returns CheckpointResult or undefined if not found
   */
  getCheckpoint(checkpointId: string): Promise<CheckpointResult | undefined>;
  
  /**
   * List all checkpoints (for debugging/recovery)
   * @returns Array of checkpoint results
   */
  listCheckpoints(): Promise<CheckpointResult[]>;
}
