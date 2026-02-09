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

export type ApprovalType = 'terminal' | 'apply_diff' | 'scope_expansion' | 'plan_approval' | 'generated_tool' | 'generated_tool_run';
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
   * 
   * FOR PLAN APPROVALS: Idempotent - checks for existing pending approval
   * before creating a new one
   */
  async requestApproval(
    taskId: string,
    mode: Mode,
    stage: Stage,
    type: ApprovalType,
    description: string,
    details: Record<string, unknown> = {}
  ): Promise<ApprovalResolution> {
    // For plan_approval type, check if there's already a pending approval
    // with the same plan_id to ensure idempotency
    if (type === 'plan_approval' && details.plan_id) {
      const existingApproval = Array.from(this.pendingApprovals.values()).find(
        req => req.type === 'plan_approval' && 
               (req.details.plan_id === details.plan_id)
      );

      if (existingApproval) {
        // Return existing approval - reuse the same resolver
        const resolver = this.approvalResolvers.get(existingApproval.approval_id);
        if (resolver) {
          console.log(`Reusing existing plan approval: ${existingApproval.approval_id}`);
          return new Promise<ApprovalResolution>((resolve, reject) => {
            // This is a new promise, but we'll resolve it when the original resolves
            this.approvalResolvers.set(existingApproval.approval_id, { resolve, reject });
          });
        }
      }
    }

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

    // COMPREHENSIVE LOGGING
    console.log('[ApprovalManager] ========== REQUESTING APPROVAL ==========');
    console.log('[ApprovalManager] Type:', type);
    console.log('[ApprovalManager] Description:', description);
    console.log('[ApprovalManager] Details object:', details);
    console.log('[ApprovalManager] Details JSON:', JSON.stringify(details, null, 2));
    if (details.files_changed) {
      console.log('[ApprovalManager] files_changed type:', typeof details.files_changed);
      console.log('[ApprovalManager] files_changed isArray:', Array.isArray(details.files_changed));
      console.log('[ApprovalManager] files_changed value:', details.files_changed);
      console.log('[ApprovalManager] files_changed JSON:', JSON.stringify(details.files_changed, null, 2));
    }
    console.log('[ApprovalManager] ==========================================');

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

    console.log('[ApprovalManager] Event payload.details:', event.payload.details);
    console.log('[ApprovalManager] Event payload JSON:', JSON.stringify(event.payload, null, 2));

    await this.eventBus.publish(event);

    // Create a Promise that will be resolved when approval is granted/denied
    return new Promise<ApprovalResolution>((resolve, reject) => {
      this.approvalResolvers.set(approvalId, { resolve, reject });
    });
  }

  /**
   * Resolve an approval request
   * Called by UI or approval handler
   * IDEMPOTENT: If already resolved, logs warning and returns (no-op)
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
      // Idempotent: already resolved or never existed
      console.warn(`[ApprovalManager] No pending approval found with id: ${approvalId} (already resolved or duplicate)`);
      return;
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
        approved: decision === 'approved', // Add boolean for UI compatibility
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
   * Cancel/supersede pending approvals for a specific plan version
   * Used when a plan is revised to invalidate old approvals
   */
  async supersedePlanApprovals(
    taskId: string,
    mode: Mode,
    stage: Stage,
    oldPlanId: string,
    reason: string = 'superseded'
  ): Promise<void> {
    const approvalIdsToCancel: string[] = [];

    // Find all pending plan approvals for the old plan_id
    for (const [approvalId, request] of this.pendingApprovals.entries()) {
      if (request.type === 'plan_approval' && request.details.plan_id === oldPlanId) {
        approvalIdsToCancel.push(approvalId);
      }
    }

    // Cancel each pending approval
    for (const approvalId of approvalIdsToCancel) {
      await this.resolveApproval(
        taskId,
        mode,
        stage,
        approvalId,
        'denied',
        'once',
        { reason }
      );
    }
  }

  /**
   * Cancel all pending approvals for a specific task
   * Used when task is aborted or restarted
   */
  async cancelAllPending(
    taskId: string,
    mode: Mode,
    stage: Stage,
    reason: string = 'task_cancelled'
  ): Promise<number> {
    const approvalIdsToCancel: string[] = [];

    // Collect all pending approval IDs
    for (const [approvalId] of this.pendingApprovals.entries()) {
      approvalIdsToCancel.push(approvalId);
    }

    // Cancel each pending approval by denying with reason
    for (const approvalId of approvalIdsToCancel) {
      await this.resolveApproval(
        taskId,
        mode,
        stage,
        approvalId,
        'denied',
        'once',
        { reason }
      );
    }

    return approvalIdsToCancel.length;
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
