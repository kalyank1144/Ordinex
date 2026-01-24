/**
 * Plan Version Manager: Handles plan versioning for deterministic replay
 * 
 * Requirements from Step 25:
 * - Track plan_id and plan_version
 * - Represent refinement as NEW plan_created with plan_version++
 * - Support replay to reconstruct latest plan version
 * - Cancel old approvals when new plan version is created
 * 
 * Event payload structure:
 * plan_created / plan_revised {
 *   plan_id: string (uuid)
 *   plan_version: number (1, 2, 3...)
 *   refinement_of_plan_id: string | null
 *   refinement_of_plan_version: number | null
 *   refinement_instruction: string | null
 *   plan: StructuredPlan
 * }
 * 
 * approval_requested {
 *   ...existing fields
 *   plan_id: string
 *   plan_version: number
 * }
 * 
 * approval_resolved (for superseded) {
 *   approved: false
 *   reason: "superseded_by_plan_version"
 *   superseded_by_plan_id: string
 *   superseded_by_plan_version: number
 * }
 */

import { Event, Mode, Stage } from './types';
import { EventBus } from './eventBus';
import { randomUUID } from 'crypto';

/**
 * Plan version metadata
 */
export interface PlanVersionInfo {
  plan_id: string;
  plan_version: number;
  refinement_of_plan_id: string | null;
  refinement_of_plan_version: number | null;
  refinement_instruction: string | null;
  created_at: string;
  event_id: string;
}

/**
 * Current plan state derived from events
 */
export interface CurrentPlanState {
  latest_plan_id: string | null;
  latest_plan_version: number;
  all_versions: PlanVersionInfo[];
  pending_approvals_for_plan: Array<{
    approval_id: string;
    plan_id: string;
    plan_version: number;
  }>;
}

/**
 * Derive current plan state from event stream
 * Pure function - no side effects
 */
export function derivePlanState(events: Event[]): CurrentPlanState {
  const state: CurrentPlanState = {
    latest_plan_id: null,
    latest_plan_version: 0,
    all_versions: [],
    pending_approvals_for_plan: []
  };

  const resolvedApprovalIds = new Set<string>();

  // First pass: collect resolved approval IDs
  for (const event of events) {
    if (event.type === 'approval_resolved') {
      resolvedApprovalIds.add(event.payload.approval_id as string);
    }
  }

  // Second pass: process events
  for (const event of events) {
    if (event.type === 'plan_created' || event.type === 'plan_revised') {
      const planId = (event.payload.plan_id as string) || event.event_id;
      const planVersion = (event.payload.plan_version as number) || state.latest_plan_version + 1;
      
      const versionInfo: PlanVersionInfo = {
        plan_id: planId,
        plan_version: planVersion,
        refinement_of_plan_id: (event.payload.refinement_of_plan_id as string) || null,
        refinement_of_plan_version: (event.payload.refinement_of_plan_version as number) || null,
        refinement_instruction: (event.payload.refinement_instruction as string) || null,
        created_at: event.timestamp,
        event_id: event.event_id
      };

      state.all_versions.push(versionInfo);

      // Update latest if this is the highest version
      if (planVersion > state.latest_plan_version) {
        state.latest_plan_id = planId;
        state.latest_plan_version = planVersion;
      }
    }

    if (event.type === 'approval_requested' && event.payload.approval_type === 'plan_approval') {
      const approvalId = event.payload.approval_id as string;
      const details = event.payload.details as Record<string, unknown> | undefined;
      
      // Only add if not already resolved
      if (!resolvedApprovalIds.has(approvalId)) {
        state.pending_approvals_for_plan.push({
          approval_id: approvalId,
          plan_id: (details?.plan_id as string) || '',
          plan_version: (details?.plan_version as number) || 0
        });
      }
    }

    if (event.type === 'approval_resolved') {
      const approvalId = event.payload.approval_id as string;
      state.pending_approvals_for_plan = state.pending_approvals_for_plan.filter(
        a => a.approval_id !== approvalId
      );
    }
  }

  return state;
}

/**
 * Check if there are pending approvals for older plan versions
 */
export function hasPendingApprovalsForOlderVersions(
  planState: CurrentPlanState,
  currentPlanId: string,
  currentVersion: number
): Array<{ approval_id: string; plan_id: string; plan_version: number }> {
  return planState.pending_approvals_for_plan.filter(a => 
    a.plan_id !== currentPlanId || a.plan_version < currentVersion
  );
}

/**
 * Generate plan_id for a new plan
 */
export function generatePlanId(): string {
  return randomUUID();
}

/**
 * Create versioned plan payload
 */
export interface VersionedPlanPayload {
  plan_id: string;
  plan_version: number;
  refinement_of_plan_id: string | null;
  refinement_of_plan_version: string | null;
  refinement_instruction: string | null;
  plan: Record<string, unknown>;
}

export function createVersionedPlanPayload(
  plan: Record<string, unknown>,
  previousPlanId: string | null,
  previousVersion: number,
  refinementInstruction: string | null
): VersionedPlanPayload {
  return {
    plan_id: generatePlanId(),
    plan_version: previousVersion + 1,
    refinement_of_plan_id: previousPlanId,
    refinement_of_plan_version: previousPlanId ? String(previousVersion) : null,
    refinement_instruction: refinementInstruction,
    plan
  };
}

/**
 * Create approval_resolved payload for superseded approval
 */
export function createSupersededApprovalPayload(
  approvalId: string,
  newPlanId: string,
  newPlanVersion: number
): Record<string, unknown> {
  return {
    approval_id: approvalId,
    decision: 'denied',
    approved: false,
    reason: 'superseded_by_plan_version',
    superseded_by_plan_id: newPlanId,
    superseded_by_plan_version: newPlanVersion,
    decided_at: new Date().toISOString()
  };
}

/**
 * PlanVersionManager: Coordinates plan versioning and approval cancellation
 */
export class PlanVersionManager {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Emit plan_created with proper versioning
   * If this is a refinement, auto-cancels old pending approvals
   */
  async emitVersionedPlan(
    taskId: string,
    mode: Mode,
    stage: Stage,
    plan: Record<string, unknown>,
    previousPlanId: string | null,
    previousVersion: number,
    refinementInstruction: string | null,
    events: Event[]
  ): Promise<{ plan_id: string; plan_version: number }> {
    const newPlanId = generatePlanId();
    const newVersion = previousVersion + 1;

    // If this is a refinement, cancel old pending approvals first
    if (previousPlanId) {
      const planState = derivePlanState(events);
      const oldApprovals = hasPendingApprovalsForOlderVersions(planState, newPlanId, newVersion);

      for (const oldApproval of oldApprovals) {
        await this.eventBus.publish({
          event_id: randomUUID(),
          task_id: taskId,
          timestamp: new Date().toISOString(),
          type: 'approval_resolved',
          mode,
          stage,
          payload: createSupersededApprovalPayload(
            oldApproval.approval_id,
            newPlanId,
            newVersion
          ),
          evidence_ids: [],
          parent_event_id: null
        });
      }
    }

    // Emit the plan_created event with versioning
    const eventType = previousPlanId ? 'plan_revised' : 'plan_created';
    
    await this.eventBus.publish({
      event_id: randomUUID(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: eventType,
      mode,
      stage,
      payload: {
        plan_id: newPlanId,
        plan_version: newVersion,
        refinement_of_plan_id: previousPlanId,
        refinement_of_plan_version: previousPlanId ? previousVersion : null,
        refinement_instruction: refinementInstruction,
        ...plan
      },
      evidence_ids: [],
      parent_event_id: previousPlanId || null
    });

    // Emit execution_paused for new plan approval
    await this.eventBus.publish({
      event_id: randomUUID(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_paused',
      mode,
      stage,
      payload: {
        reason: 'awaiting_plan_approval',
        plan_id: newPlanId,
        plan_version: newVersion,
        description: previousPlanId 
          ? `Plan refined to version ${newVersion} - awaiting approval`
          : 'Plan created - awaiting approval'
      },
      evidence_ids: [],
      parent_event_id: null
    });

    return { plan_id: newPlanId, plan_version: newVersion };
  }

  /**
   * Create approval request with plan version info
   */
  async requestPlanApproval(
    taskId: string,
    mode: Mode,
    stage: Stage,
    planId: string,
    planVersion: number,
    planDetails: Record<string, unknown>
  ): Promise<string> {
    const approvalId = randomUUID();

    await this.eventBus.publish({
      event_id: randomUUID(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'approval_requested',
      mode,
      stage,
      payload: {
        approval_id: approvalId,
        approval_type: 'plan_approval',
        description: `Approve plan v${planVersion} to start mission`,
        plan_id: planId,
        plan_version: planVersion,
        details: {
          plan_id: planId,
          plan_version: planVersion,
          ...planDetails
        }
      },
      evidence_ids: [],
      parent_event_id: null
    });

    return approvalId;
  }
}

/**
 * Large plan detection state derived from events
 */
export interface LargePlanState {
  isLargePlan: boolean;
  score: number;
  reasons: string[];
  metrics: Record<string, unknown>;
  planId: string | null;
  planVersion: number;
}

/**
 * Mission breakdown state derived from events
 */
export interface BreakdownState {
  hasBreakdown: boolean;
  breakdownId: string | null;
  missions: Array<{
    missionId: string;
    title: string;
    size: string;
    risk: string;
    stepCount: number;
  }>;
  planId: string | null;
  planVersion: number;
}

/**
 * Mission selection state derived from events
 */
export interface MissionSelectionState {
  hasSelection: boolean;
  selectedMissionId: string | null;
  selectedMissionTitle: string | null;
  planId: string | null;
  planVersion: number;
}

/**
 * Derive large plan detection state from events
 * Returns null if no plan_large_detected event for latest plan
 */
export function deriveLargePlanState(events: Event[]): LargePlanState {
  const planState = derivePlanState(events);
  
  if (!planState.latest_plan_id) {
    return {
      isLargePlan: false,
      score: 0,
      reasons: [],
      metrics: {},
      planId: null,
      planVersion: 0,
    };
  }

  // Find the most recent plan_large_detected for the latest plan version
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'plan_large_detected') {
      const eventPlanId = event.payload.plan_id as string;
      const eventPlanVersion = event.payload.plan_version as number;
      
      if (eventPlanId === planState.latest_plan_id && eventPlanVersion === planState.latest_plan_version) {
        return {
          isLargePlan: (event.payload.large_plan as boolean) || false,
          score: (event.payload.score as number) || 0,
          reasons: (event.payload.reasons as string[]) || [],
          metrics: (event.payload.metrics as Record<string, unknown>) || {},
          planId: eventPlanId,
          planVersion: eventPlanVersion,
        };
      }
    }
  }

  // No detection event for current plan version
  return {
    isLargePlan: false,
    score: 0,
    reasons: [],
    metrics: {},
    planId: planState.latest_plan_id,
    planVersion: planState.latest_plan_version,
  };
}

/**
 * Derive breakdown state from events
 * Returns breakdown info for the latest plan version only
 */
export function deriveBreakdownState(events: Event[]): BreakdownState {
  const planState = derivePlanState(events);
  
  if (!planState.latest_plan_id) {
    return {
      hasBreakdown: false,
      breakdownId: null,
      missions: [],
      planId: null,
      planVersion: 0,
    };
  }

  // Find the most recent mission_breakdown_created for the latest plan version
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'mission_breakdown_created') {
      const eventPlanId = event.payload.plan_id as string;
      const eventPlanVersion = event.payload.plan_version as number;
      
      if (eventPlanId === planState.latest_plan_id && eventPlanVersion === planState.latest_plan_version) {
        const missions = (event.payload.missions as Array<{
          missionId: string;
          title: string;
          estimate?: { size: string };
          risk?: { level: string };
          includedSteps?: Array<unknown>;
        }>) || [];
        
        return {
          hasBreakdown: true,
          breakdownId: (event.payload.breakdown_id as string) || null,
          missions: missions.map(m => ({
            missionId: m.missionId,
            title: m.title,
            size: m.estimate?.size || 'M',
            risk: m.risk?.level || 'low',
            stepCount: m.includedSteps?.length || 0,
          })),
          planId: eventPlanId,
          planVersion: eventPlanVersion,
        };
      }
    }
  }

  return {
    hasBreakdown: false,
    breakdownId: null,
    missions: [],
    planId: planState.latest_plan_id,
    planVersion: planState.latest_plan_version,
  };
}

/**
 * Derive mission selection state from events
 * Returns selection info for the latest plan version only
 */
export function deriveMissionSelectionState(events: Event[]): MissionSelectionState {
  const planState = derivePlanState(events);
  const breakdownState = deriveBreakdownState(events);
  
  if (!planState.latest_plan_id) {
    return {
      hasSelection: false,
      selectedMissionId: null,
      selectedMissionTitle: null,
      planId: null,
      planVersion: 0,
    };
  }

  // Find the most recent mission_selected for the latest plan version
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'mission_selected') {
      const eventPlanId = event.payload.plan_id as string;
      const eventPlanVersion = event.payload.plan_version as number;
      
      if (eventPlanId === planState.latest_plan_id && eventPlanVersion === planState.latest_plan_version) {
        const selectedMissionId = event.payload.mission_id as string;
        
        // Get mission title from breakdown
        const selectedMission = breakdownState.missions.find(m => m.missionId === selectedMissionId);
        
        return {
          hasSelection: true,
          selectedMissionId,
          selectedMissionTitle: selectedMission?.title || null,
          planId: eventPlanId,
          planVersion: eventPlanVersion,
        };
      }
    }
  }

  return {
    hasSelection: false,
    selectedMissionId: null,
    selectedMissionTitle: null,
    planId: planState.latest_plan_id,
    planVersion: planState.latest_plan_version,
  };
}

/**
 * Check if breakdown exists for latest plan version
 */
export function hasBreakdownForLatestPlan(events: Event[]): boolean {
  return deriveBreakdownState(events).hasBreakdown;
}

/**
 * Check if a mission is selected for latest plan version
 */
export function isMissionSelectedForLatestPlan(events: Event[]): boolean {
  return deriveMissionSelectionState(events).hasSelection;
}

/**
 * Check if Execute Plan should be enabled
 * Returns true only if latest plan has an approved approval_resolved
 */
export function canExecutePlan(events: Event[]): {
  canExecute: boolean;
  reason: string;
  latestPlanId: string | null;
  latestPlanVersion: number;
} {
  const planState = derivePlanState(events);
  
  if (!planState.latest_plan_id) {
    return {
      canExecute: false,
      reason: 'No plan created yet',
      latestPlanId: null,
      latestPlanVersion: 0
    };
  }

  // Check if there's an approved approval_resolved for the latest plan
  let hasApproval = false;
  
  for (const event of events) {
    if (event.type === 'approval_resolved') {
      const approved = event.payload.approved as boolean;
      const details = event.payload.details as Record<string, unknown> | undefined;
      
      // Check if this approval is for the latest plan version
      // Could be in details or in parent_event lookup
      if (approved) {
        // Find the corresponding approval_requested
        const requestEvent = events.find(e => 
          e.type === 'approval_requested' &&
          e.payload.approval_id === event.payload.approval_id
        );
        
        if (requestEvent) {
          const reqDetails = requestEvent.payload.details as Record<string, unknown> | undefined;
          const reqPlanId = reqDetails?.plan_id as string || requestEvent.payload.plan_id as string;
          const reqPlanVersion = reqDetails?.plan_version as number || requestEvent.payload.plan_version as number;
          
          if (reqPlanId === planState.latest_plan_id && reqPlanVersion === planState.latest_plan_version) {
            hasApproval = true;
            break;
          }
        }
      }
    }
  }

  // Also check if there's a pending approval for the latest plan
  const hasPendingForLatest = planState.pending_approvals_for_plan.some(
    a => a.plan_id === planState.latest_plan_id && a.plan_version === planState.latest_plan_version
  );

  if (hasPendingForLatest) {
    return {
      canExecute: false,
      reason: 'Awaiting approval for latest plan',
      latestPlanId: planState.latest_plan_id,
      latestPlanVersion: planState.latest_plan_version
    };
  }

  if (!hasApproval) {
    return {
      canExecute: false,
      reason: 'Latest plan not yet approved',
      latestPlanId: planState.latest_plan_id,
      latestPlanVersion: planState.latest_plan_version
    };
  }

  return {
    canExecute: true,
    reason: 'Plan approved, ready to execute',
    latestPlanId: planState.latest_plan_id,
    latestPlanVersion: planState.latest_plan_version
  };
}
