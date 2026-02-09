/**
 * V6: GeneratedToolManager - Pure Logic (No FS)
 *
 * Manages tool proposal lifecycle: propose → approve/reject → save.
 * Takes ToolRegistryService (injected) + EventPublisher for event emission.
 *
 * DESIGN DECISIONS (per user feedback):
 * 1. Approval uses the EXISTING ApprovalManager pipeline (kind=generated_tool).
 *    No separate approval path.
 * 2. Pending proposals are rebuilt from events (event-sourced), NOT stored
 *    only in a transient Map. This survives extension reloads.
 * 3. All payload fields use snake_case (consistent with rest of codebase).
 *
 * CONSTRAINT: NO require('fs'). All IO via injected ToolRegistryService.
 */

import type { Event, Mode, Stage } from '../types';
import type {
  EventPublisher,
  ToolRegistryService,
  ToolProposal,
  ToolRegistry,
  ToolEntry,
} from './toolRegistryService';

// ============================================================================
// HELPERS
// ============================================================================

function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `evt_${ts}_${rand}`;
}

function generateProposalId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `tp_${ts}_${rand}`;
}

// ============================================================================
// GENERATED TOOL MANAGER
// ============================================================================

export class GeneratedToolManager {
  /**
   * Pending proposals that haven't been approved or rejected yet.
   * Rebuilt from events via rebuildPendingProposals().
   */
  private pendingProposals: Map<string, ToolProposal> = new Map();

  constructor(
    private readonly registryService: ToolRegistryService,
    private readonly eventBus: EventPublisher,
  ) {}

  /**
   * Rebuild the pending proposals map from event history.
   * Call this on activation to survive extension reloads.
   *
   * A proposal is "pending" if generated_tool_proposed exists
   * but no matching generated_tool_saved or approval_resolved(denied) exists.
   */
  rebuildPendingProposals(events: Event[]): void {
    const proposals = new Map<string, ToolProposal>();
    const resolved = new Set<string>();

    for (const event of events) {
      if (event.type === 'generated_tool_saved') {
        const pid = event.payload.proposal_id as string;
        if (pid) resolved.add(pid);
      }
      if (event.type === 'approval_resolved') {
        // Check if this resolution is for a generated_tool approval
        const aid = event.payload.approval_id as string;
        const decision = event.payload.decision as string;
        if (aid && decision === 'denied') {
          // Find the proposal_id linked to this approval
          // The approval_id IS the proposal_id (we use proposal_id as approval_id)
          resolved.add(aid);
        }
      }
    }

    for (const event of events) {
      if (event.type === 'generated_tool_proposed') {
        const pid = event.payload.proposal_id as string;
        if (pid && !resolved.has(pid)) {
          proposals.set(pid, {
            name: event.payload.name as string,
            description: (event.payload.description as string) || '',
            code: (event.payload.code as string) || '',
            readme: event.payload.readme as string | undefined,
            inputs_schema: event.payload.inputs_schema as Record<string, unknown> | undefined,
            outputs_schema: event.payload.outputs_schema as Record<string, unknown> | undefined,
            allow: event.payload.allow as ToolProposal['allow'],
          });
        }
      }
    }

    this.pendingProposals = proposals;
  }

  /**
   * Propose a new tool. Emits generated_tool_proposed event.
   * The proposal enters pending state until approved/rejected via the
   * existing approval pipeline.
   *
   * Returns the proposal_id (also used as the approval_id).
   */
  async proposeTool(
    tool: ToolProposal,
    taskId: string,
    mode: Mode,
  ): Promise<string> {
    const proposalId = generateProposalId();

    // Store in pending map
    this.pendingProposals.set(proposalId, tool);

    // Emit generated_tool_proposed
    const event: Event = {
      event_id: generateEventId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'generated_tool_proposed',
      mode,
      stage: 'edit' as Stage,
      payload: {
        proposal_id: proposalId,
        name: tool.name,
        description: tool.description,
        code: tool.code,
        readme: tool.readme,
        inputs_schema: tool.inputs_schema,
        outputs_schema: tool.outputs_schema,
        allow: tool.allow,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    await this.eventBus.publish(event);

    return proposalId;
  }

  /**
   * Approve a pending proposal. Persists tool via registryService
   * and emits generated_tool_saved event.
   *
   * Called when approval_resolved(approved) comes through the
   * existing approval pipeline.
   */
  async approveTool(
    proposalId: string,
    taskId: string,
    mode: Mode,
  ): Promise<void> {
    const proposal = this.pendingProposals.get(proposalId);
    if (!proposal) {
      throw new Error(`No pending proposal found: ${proposalId}`);
    }

    // Delegate persistence to the injected registry service (FS write in extension)
    await this.registryService.saveTool(proposal.name, proposal.code, {
      description: proposal.description,
      inputs_schema: proposal.inputs_schema,
      outputs_schema: proposal.outputs_schema,
      allow: proposal.allow,
    });

    // Remove from pending
    this.pendingProposals.delete(proposalId);

    // Emit generated_tool_saved
    const event: Event = {
      event_id: generateEventId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'generated_tool_saved',
      mode,
      stage: 'edit' as Stage,
      payload: {
        proposal_id: proposalId,
        name: proposal.name,
        description: proposal.description,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    await this.eventBus.publish(event);
  }

  /**
   * Reject a pending proposal. No FS write occurs.
   * Called when approval_resolved(denied) comes through.
   */
  rejectTool(proposalId: string): void {
    this.pendingProposals.delete(proposalId);
  }

  /**
   * Get a pending proposal by ID (for display in approval card).
   */
  getPendingProposal(proposalId: string): ToolProposal | undefined {
    return this.pendingProposals.get(proposalId);
  }

  /**
   * Get all pending proposal IDs.
   */
  getPendingProposalIds(): string[] {
    return Array.from(this.pendingProposals.keys());
  }

  /**
   * Delegate: load full registry of approved tools.
   */
  async getRegistry(): Promise<ToolRegistry> {
    return this.registryService.loadRegistry();
  }

  /**
   * Delegate: get a single approved tool entry by name.
   */
  async getTool(name: string): Promise<ToolEntry | null> {
    return this.registryService.getTool(name);
  }

  /**
   * Delegate: load tool source code by name.
   */
  async getToolCode(name: string): Promise<string | null> {
    return this.registryService.loadToolCode(name);
  }

  /**
   * Delegate: delete an approved tool.
   */
  async deleteTool(name: string): Promise<void> {
    return this.registryService.deleteTool(name);
  }
}
