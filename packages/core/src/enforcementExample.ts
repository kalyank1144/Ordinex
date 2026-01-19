/**
 * Enforcement Pattern Example: Checkpoint Before Write Operations
 * Based on 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * This file demonstrates the REQUIRED pattern for all write/apply operations.
 * CRITICAL: Checkpoint MUST be created BEFORE any irreversible action.
 * 
 * This is a reference implementation showing how tool executors MUST integrate
 * ApprovalManager and CheckpointManager.
 */

import { ApprovalManager } from './approvalManager';
import { CheckpointManager } from './checkpointManager';
import { Mode, Stage } from './types';

/**
 * Example: Safe Write Operation with Checkpoint and Approval
 * 
 * This pattern MUST be followed by all tool executors that perform writes.
 */
export class SafeWriteOperationExample {
  constructor(
    private approvalManager: ApprovalManager,
    private checkpointManager: CheckpointManager
  ) {}

  /**
   * Apply a diff to files (example implementation)
   * 
   * Enforcement sequence:
   * 1. Create checkpoint BEFORE any changes
   * 2. Request approval (blocks until resolved)
   * 3. Apply changes ONLY if approved
   * 4. Can restore checkpoint if something fails
   */
  async applyDiff(
    taskId: string,
    mode: Mode,
    stage: Stage,
    targetFiles: string[],
    diffContent: string
  ): Promise<void> {
    // STEP 1: Create checkpoint BEFORE any modifications
    // This MUST happen first - no writes before checkpoint
    const checkpointId = await this.checkpointManager.createCheckpoint(
      taskId,
      mode,
      stage,
      `Before applying diff to ${targetFiles.length} file(s)`,
      targetFiles,
      'snapshot'
    );

    try {
      // STEP 2: Request approval (execution blocks here)
      const approval = await this.approvalManager.requestApproval(
        taskId,
        mode,
        stage,
        'apply_diff',
        `Apply changes to ${targetFiles.length} file(s)`,
        {
          files: targetFiles,
          diff: diffContent,
        }
      );

      // STEP 3: Check approval decision
      if (approval.decision === 'denied') {
        // User denied - restore checkpoint
        await this.checkpointManager.restoreCheckpoint(taskId, mode, stage, checkpointId);
        return;
      }

      if (approval.decision === 'edit_requested') {
        // User wants to modify - use modified details
        // (In real implementation, would use approval.modified_details)
      }

      // STEP 4: Only now can we perform the actual write
      // This is where actual file writes would happen
      // await this.performActualWrites(targetFiles, diffContent);

      // If write fails, restore checkpoint:
      // await this.checkpointManager.restoreCheckpoint(taskId, mode, stage, checkpointId);

    } catch (error) {
      // On any error, restore to checkpoint
      await this.checkpointManager.restoreCheckpoint(taskId, mode, stage, checkpointId);
      throw error;
    }
  }

  /**
   * Execute terminal command (example implementation)
   * 
   * Even though terminal commands may not need checkpoints,
   * they MUST still request approval.
   */
  async executeTerminalCommand(
    taskId: string,
    mode: Mode,
    stage: Stage,
    command: string
  ): Promise<void> {
    // STEP 1: Request approval for terminal execution
    const approval = await this.approvalManager.requestApproval(
      taskId,
      mode,
      stage,
      'terminal',
      `Execute command: ${command}`,
      { command }
    );

    // STEP 2: Only execute if approved
    if (approval.decision !== 'approved') {
      return; // User denied or wants to edit
    }

    // STEP 3: Execute the command
    // In real implementation:
    // await this.executeCommand(command);
  }

  /**
   * Scope expansion (example implementation)
   * 
   * Expanding scope MUST request approval.
   */
  async expandScope(
    taskId: string,
    mode: Mode,
    stage: Stage,
    additionalFiles: string[]
  ): Promise<boolean> {
    // Request approval for scope expansion
    const approval = await this.approvalManager.requestApproval(
      taskId,
      mode,
      stage,
      'scope_expansion',
      `Expand scope to include ${additionalFiles.length} additional file(s)`,
      { files: additionalFiles }
    );

    return approval.decision === 'approved';
  }
}

/**
 * ENFORCEMENT RULES (Non-Negotiable):
 * 
 * 1. CHECKPOINT FIRST
 *    - Create checkpoint BEFORE any write operation
 *    - Checkpoint must include ALL files that will be modified
 *    - Never write before checkpoint is created
 * 
 * 2. APPROVAL ALWAYS
 *    - Request approval for: terminal, apply_diff, scope_expansion
 *    - Execution BLOCKS until approval is resolved
 *    - Respect user's decision (approved/denied/edit)
 * 
 * 3. RESTORE ON FAILURE
 *    - If anything fails after checkpoint, restore immediately
 *    - Checkpoints guarantee deterministic rollback
 *    - Never leave workspace in inconsistent state
 * 
 * 4. EVENT EMISSION
 *    - All checkpoints emit checkpoint_created
 *    - All approvals emit approval_requested/approval_resolved
 *    - All restores emit checkpoint_restored
 *    - Events provide audit trail
 * 
 * 5. NO BYPASS
 *    - Cannot skip approval for "safe" operations
 *    - Cannot skip checkpoint for "small" changes
 *    - Tool layer is the last line of trust
 */

/**
 * INTEGRATION WITH TOOL EXECUTOR (Future Step 4)
 * 
 * When implementing actual tool execution:
 * 
 * 1. Tool Executor receives tool invocation request
 * 2. Validates mode allows the tool (ModeManager)
 * 3. If write operation:
 *    a. Creates checkpoint via CheckpointManager
 *    b. Requests approval via ApprovalManager
 *    c. Waits for approval (blocking)
 *    d. Executes tool only if approved
 * 4. Emits tool_start and tool_end events
 * 5. Captures output as evidence
 * 6. On failure, restores checkpoint
 */
