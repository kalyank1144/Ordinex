/**
 * ApprovalManager: Approval coordination system
 * Based on 02_AGENT_TOOL_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - Request approvals before side effects (terminal, apply_diff, scope_expansion)
 * - Emit approval_requested / approval_resolved events
 * - Block execution until approval is granted or denied
 * - Support granular approval types (once, always, deny, edit)
 * - Non-modal, but blocks execution flow
 * - All approvals logged and reversible
 */

import { EventBus } from './eventBus';
import { Event, Mode, Stage } from './types';
import { randomUUID } from 'crypto';

export type ApprovalType = 'terminal' | 'apply_diff' | 'scope_expansion';
export type ApprovalDecision = 'approved' | 'denied' | 'edit_requested';
export type ApprovalScope = 'once' | 'always' | 'session';

export interface ApprovalRequest {
  approval_id: string;
  type: ApprovalType;
  description: string;
  details: Record<string, unknown>;
  requested_at: string;
}

export interface ApprovalResolution {
  approval_id: string;
  decision: ApprovalDecision;
  scope: ApprovalScope;
  resolved_at: string;
  modified_details?: Record<string, unknown>;
}

/**
 * ApprovalManager coordinates approval flow
 * CRITICAL: Execution must be blocked until approval is resolved
 */
export class ApprovalManager {
  private readonly eventBus: EventBus;
  private pendingApprovals = new Map<string, ApprovalRequest>();
  private approvalResolvers = new Map<string, {
    resolve: (resolution: ApprovalResolution) => void;
    reject: (error: Error) => void;
  }>();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Request approval for an action
   * Returns a Promise that resolves when approval is granted/denied
   * BLOCKS execution until resolved
   */
  async requestApproval(
    taskId: string,
    mode: Mode,
    stage: Stage,
    type: ApprovalType,
    description: string,
    details: Record<string, unknown> = {}
  ): Promise<ApprovalResolution> {
    const approvalId = randomUUID();
    const timestamp = new Date().toISOString();

    const request: ApprovalRequest = {
      approval_id: approvalId,
      type,
      description,
      details,
      requested_at: timestamp,
    };

    // Store pending approval
    this.pendingApprovals.set(approvalId, request);

    // Emit approval_requested event (blocks execution)
    const event: Event = {
      event_id: randomUUID(),
      task_id: taskId,
      timestamp,
      type: 'approval_requested',
      mode,
      stage,
      payload: {
        approval_id: approvalId,
        approval_type: type,
        description,
        details,
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);

    // Create a Promise that will be resolved when approval is granted/denied
    return new Promise<ApprovalResolution>((resolve, reject) => {
      this.approvalResolvers.set(approvalId, { resolve, reject });
    });
  }

  /**
   * Resolve an approval request
   * Called by UI or approval handler
   */
  async resolveApproval(
    taskId: string,
    mode: Mode,
    stage: Stage,
    approvalId: string,
    decision: ApprovalDecision,
    scope: ApprovalScope = 'once',
    modifiedDetails?: Record<string, unknown>
  ): Promise<void> {
    const request = this.pendingApprovals.get(approvalId);
    if (!request) {
      throw new Error(`No pending approval found with id: ${approvalId}`);
    }

    const timestamp = new Date().toISOString();

    const resolution: ApprovalResolution = {
      approval_id: approvalId,
      decision,
      scope,
      resolved_at: timestamp,
      modified_details: modifiedDetails,
    };

    // Emit approval_resolved event
    const event: Event = {
      event_id: randomUUID(),
      task_id: taskId,
      timestamp,
      type: 'approval_resolved',
      mode,
      stage,
      payload: {
        approval_id: approvalId,
        decision,
        scope,
        modified_details: modifiedDetails,
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);

    // Remove from pending
    this.pendingApprovals.delete(approvalId);

    // Resolve the waiting Promise
    const resolver = this.approvalResolvers.get(approvalId);
    if (resolver) {
      resolver.resolve(resolution);
      this.approvalResolvers.delete(approvalId);
    }
  }

  /**
   * Deny an approval request (convenience method)
   */
  async denyApproval(
    taskId: string,
    mode: Mode,
    stage: Stage,
    approvalId: string
  ): Promise<void> {
    await this.resolveApproval(taskId, mode, stage, approvalId, 'denied', 'once');
  }

  /**
   * Check if there are pending approvals
   */
  hasPendingApprovals(): boolean {
    return this.pendingApprovals.size > 0;
  }

  /**
   * Get all pending approvals
   */
  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values());
  }

  /**
   * Get a specific pending approval
   */
  getPendingApproval(approvalId: string): ApprovalRequest | undefined {
    return this.pendingApprovals.get(approvalId);
  }

  /**
   * For testing: abort all pending approvals
   */
  _abortAllForTesting(): void {
    for (const [approvalId, resolver] of this.approvalResolvers.entries()) {
      resolver.reject(new Error('Aborted for testing'));
      this.approvalResolvers.delete(approvalId);
    }
    this.pendingApprovals.clear();
  }
}
