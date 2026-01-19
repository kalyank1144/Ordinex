/**
 * DiffManager: Diff proposal and application with approval + checkpoint gating
 * Based on 02_AGENT_TOOL_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - Write tools must never write silently
 * - Diff-first always (no direct writes)
 * - Apply diff only after approval
 * - Checkpoint before irreversible actions
 * - All diffs visible and logged
 */

import { EventBus } from './eventBus';
import { ApprovalManager } from './approvalManager';
import { CheckpointManager } from './checkpointManager';
import { Event, Mode, Stage, Evidence } from './types';
import { EvidenceStore } from './toolExecutor';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Diff operation types
 */
export type DiffOperation = 'create' | 'modify' | 'delete';

/**
 * Individual file diff
 */
export interface FileDiff {
  file_path: string;
  operation: DiffOperation;
  old_content?: string;
  new_content?: string;
  patch?: string; // Unified diff format
}

/**
 * Diff proposal (before approval)
 */
export interface DiffProposal {
  proposal_id: string;
  description: string;
  diffs: FileDiff[];
  created_at: string;
  requires_checkpoint: boolean;
}

/**
 * Diff application result
 */
export interface DiffApplicationResult {
  success: boolean;
  applied_files: string[];
  failed_files: Array<{
    file: string;
    error: string;
  }>;
  checkpoint_id?: string;
}

/**
 * DiffManager coordinates diff proposal and application with safety gates
 */
export class DiffManager {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly approvalManager: ApprovalManager;
  private readonly checkpointManager: CheckpointManager;
  private readonly evidenceStore: EvidenceStore;
  private readonly workspaceRoot: string;
  private pendingProposals = new Map<string, DiffProposal>();

  constructor(
    taskId: string,
    eventBus: EventBus,
    approvalManager: ApprovalManager,
    checkpointManager: CheckpointManager,
    evidenceStore: EvidenceStore,
    workspaceRoot: string
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.approvalManager = approvalManager;
    this.checkpointManager = checkpointManager;
    this.evidenceStore = evidenceStore;
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Propose a diff (does not apply immediately)
   * Emits diff_proposed event
   * Returns proposal ID for later application
   */
  async proposeDiff(
    mode: Mode,
    stage: Stage,
    description: string,
    diffs: FileDiff[],
    requiresCheckpoint: boolean = true
  ): Promise<string> {
    const proposalId = randomUUID();
    const timestamp = new Date().toISOString();

    const proposal: DiffProposal = {
      proposal_id: proposalId,
      description,
      diffs,
      created_at: timestamp,
      requires_checkpoint: requiresCheckpoint,
    };

    // Store proposal
    this.pendingProposals.set(proposalId, proposal);

    // Generate diff evidence
    const evidenceId = await this.generateDiffEvidence(proposal);

    // Emit diff_proposed event
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp,
      type: 'diff_proposed',
      mode,
      stage,
      payload: {
        proposal_id: proposalId,
        description,
        file_count: diffs.length,
        files: diffs.map(d => d.file_path),
        requires_checkpoint: requiresCheckpoint,
      },
      evidence_ids: [evidenceId],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);

    return proposalId;
  }

  /**
   * Apply a diff proposal (requires approval)
   * CRITICAL: This is approval-gated and creates checkpoint if needed
   */
  async applyDiff(
    mode: Mode,
    stage: Stage,
    proposalId: string
  ): Promise<DiffApplicationResult> {
    const proposal = this.pendingProposals.get(proposalId);
    
    if (!proposal) {
      throw new Error(`No pending diff proposal found with id: ${proposalId}`);
    }

    // Step 1: Request approval (BLOCKING)
    const resolution = await this.approvalManager.requestApproval(
      this.taskId,
      mode,
      stage,
      'apply_diff',
      `Apply diff: ${proposal.description}`,
      {
        proposal_id: proposalId,
        files: proposal.diffs.map(d => d.file_path),
      }
    );

    if (resolution.decision === 'denied') {
      throw new Error(`Diff application denied by user: ${proposalId}`);
    }

    // Step 2: Create checkpoint if required (BEFORE applying changes)
    let checkpointId: string | undefined;
    
    if (proposal.requires_checkpoint) {
      checkpointId = await this.checkpointManager.createCheckpoint(
        this.taskId,
        mode,
        stage,
        `Before applying: ${proposal.description}`,
        proposal.diffs.map(d => d.file_path)
      );
    }

    // Step 3: Apply the diff
    const result = await this.applyDiffInternal(proposal);
    result.checkpoint_id = checkpointId;

    // Step 4: Generate evidence and emit diff_applied event
    const evidenceId = await this.generateApplicationEvidence(proposal, result);

    const event: Event = {
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'diff_applied',
      mode,
      stage,
      payload: {
        proposal_id: proposalId,
        success: result.success,
        applied_files: result.applied_files,
        failed_files: result.failed_files,
        checkpoint_id: checkpointId,
      },
      evidence_ids: [evidenceId],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);

    // Step 5: Remove from pending
    this.pendingProposals.delete(proposalId);

    return result;
  }

  /**
   * Internal diff application logic
   */
  private async applyDiffInternal(proposal: DiffProposal): Promise<DiffApplicationResult> {
    const appliedFiles: string[] = [];
    const failedFiles: Array<{ file: string; error: string }> = [];

    for (const diff of proposal.diffs) {
      try {
        await this.applyFileDiff(diff);
        appliedFiles.push(diff.file_path);
      } catch (error) {
        failedFiles.push({
          file: diff.file_path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: failedFiles.length === 0,
      applied_files: appliedFiles,
      failed_files: failedFiles,
    };
  }

  /**
   * Apply a single file diff
   */
  private async applyFileDiff(diff: FileDiff): Promise<void> {
    const fullPath = path.resolve(this.workspaceRoot, diff.file_path);
    
    // Security: prevent path traversal
    if (!fullPath.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected');
    }

    switch (diff.operation) {
      case 'create':
        if (!diff.new_content) {
          throw new Error('new_content required for create operation');
        }
        await this.ensureDirectoryExists(path.dirname(fullPath));
        await fs.writeFile(fullPath, diff.new_content, 'utf-8');
        break;

      case 'modify':
        if (!diff.new_content) {
          throw new Error('new_content required for modify operation');
        }
        // Verify file exists
        await fs.access(fullPath);
        await fs.writeFile(fullPath, diff.new_content, 'utf-8');
        break;

      case 'delete':
        await fs.unlink(fullPath);
        break;

      default:
        throw new Error(`Unknown diff operation: ${diff.operation}`);
    }
  }

  /**
   * Ensure directory exists (create if needed)
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Generate evidence for diff proposal
   */
  private async generateDiffEvidence(proposal: DiffProposal): Promise<string> {
    const evidenceId = randomUUID();
    
    // Create unified diff format
    const diffContent = this.generateUnifiedDiff(proposal.diffs);
    
    const evidence: Evidence = {
      evidence_id: evidenceId,
      type: 'diff',
      source_event_id: '', // Will be set by event
      content_ref: `diff_${evidenceId}.patch`,
      summary: `Diff proposal: ${proposal.description} (${proposal.diffs.length} files)`,
      created_at: new Date().toISOString(),
    };

    await this.evidenceStore.store(evidence);
    return evidenceId;
  }

  /**
   * Generate evidence for diff application
   */
  private async generateApplicationEvidence(
    proposal: DiffProposal,
    result: DiffApplicationResult
  ): Promise<string> {
    const evidenceId = randomUUID();
    
    const summary = result.success
      ? `Applied diff: ${proposal.description} (${result.applied_files.length} files)`
      : `Partially applied diff: ${proposal.description} (${result.applied_files.length} succeeded, ${result.failed_files.length} failed)`;
    
    const evidence: Evidence = {
      evidence_id: evidenceId,
      type: 'diff',
      source_event_id: '', // Will be set by event
      content_ref: `diff_applied_${evidenceId}.json`,
      summary,
      created_at: new Date().toISOString(),
    };

    await this.evidenceStore.store(evidence);
    return evidenceId;
  }

  /**
   * Generate unified diff format for display
   */
  private generateUnifiedDiff(diffs: FileDiff[]): string {
    const lines: string[] = [];

    for (const diff of diffs) {
      lines.push(`--- ${diff.file_path}`);
      lines.push(`+++ ${diff.file_path}`);
      
      if (diff.patch) {
        lines.push(diff.patch);
      } else if (diff.operation === 'create') {
        lines.push(`@@ -0,0 +1,${this.countLines(diff.new_content || '')} @@`);
        const newLines = (diff.new_content || '').split('\n');
        newLines.forEach(line => lines.push(`+${line}`));
      } else if (diff.operation === 'delete') {
        lines.push(`@@ -1,${this.countLines(diff.old_content || '')} +0,0 @@`);
        const oldLines = (diff.old_content || '').split('\n');
        oldLines.forEach(line => lines.push(`-${line}`));
      } else if (diff.operation === 'modify') {
        // Simple line-by-line diff (in production, use proper diff algorithm)
        lines.push(`@@ modified @@`);
        lines.push('(full diff requires proper diff algorithm)');
      }
      
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Count lines in content
   */
  private countLines(content: string): number {
    if (!content) return 0;
    return content.split('\n').length;
  }

  /**
   * Get a pending proposal
   */
  getPendingProposal(proposalId: string): DiffProposal | undefined {
    return this.pendingProposals.get(proposalId);
  }

  /**
   * Get all pending proposals
   */
  getPendingProposals(): DiffProposal[] {
    return Array.from(this.pendingProposals.values());
  }

  /**
   * Check if there are pending proposals
   */
  hasPendingProposals(): boolean {
    return this.pendingProposals.size > 0;
  }

  /**
   * For testing: clear all pending proposals
   */
  _clearAllForTesting(): void {
    this.pendingProposals.clear();
  }
}
