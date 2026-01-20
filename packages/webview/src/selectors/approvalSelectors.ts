/**
 * Approval Selectors
 * Deterministic selectors to compute pending approvals from events
 * 
 * CRITICAL: A pending approval is defined as:
 * - approval_requested(approval_id=X) exists
 * - and no approval_resolved(approval_id=X) exists yet
 * 
 * This MUST be computed from events, not from ephemeral state.
 */

import { Event } from '../types';

export interface PendingApproval {
  approvalId: string;
  approvalType: string;
  requestEvent: Event;
  requestedAt: string;
}

/**
 * Get all pending approvals from event list
 * A pending approval = approval_requested without matching approval_resolved
 */
export function getPendingApprovals(events: Event[]): PendingApproval[] {
  const pendingApprovals: PendingApproval[] = [];
  const resolvedApprovalIds = new Set<string>();

  // First pass: collect all resolved approval IDs
  for (const event of events) {
    if (event.type === 'approval_resolved') {
      const approvalId = event.payload.approval_id as string;
      if (approvalId) {
        resolvedApprovalIds.add(approvalId);
      }
    }
  }

  // Second pass: find approval_requested events that are not resolved
  for (const event of events) {
    if (event.type === 'approval_requested') {
      const approvalId = event.payload.approval_id as string;
      if (approvalId && !resolvedApprovalIds.has(approvalId)) {
        pendingApprovals.push({
          approvalId,
          approvalType: event.payload.approval_type as string,
          requestEvent: event,
          requestedAt: event.timestamp,
        });
      }
    }
  }

  return pendingApprovals;
}

/**
 * Check if there are any pending approvals
 */
export function hasPendingApprovals(events: Event[]): boolean {
  return getPendingApprovals(events).length > 0;
}

/**
 * Get a specific pending approval by ID
 */
export function getPendingApprovalById(
  events: Event[],
  approvalId: string
): PendingApproval | null {
  const pending = getPendingApprovals(events);
  return pending.find(p => p.approvalId === approvalId) || null;
}

/**
 * Get pending scope expansion approval (if any)
 * Used by Systems tab to show scope expansion request
 */
export function getPendingScopeExpansionApproval(
  events: Event[]
): PendingApproval | null {
  const pending = getPendingApprovals(events);
  return pending.find(p => p.approvalType === 'scope_expansion') || null;
}
