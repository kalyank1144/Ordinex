/**
 * ScopeManager: Enforces scope boundaries and tracks file/line/tool usage
 * Based on 01_UI_UX_SPEC.md Section 8 and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - Derive ScopeSummary from events
 * - Enforce scope boundaries (files/lines/tools/budgets)
 * - Track touched files (append-only history)
 * - Request scope expansion (approval-gated)
 * - Block execution until approval
 */

import {
  Event,
  ScopeSummary,
  ScopeContract,
  TouchedFile,
  ScopeExpansionRequest,
  ToolCategory,
} from './types';
import { EventBus } from './eventBus';

/**
 * Default scope contract for new missions
 */
export const DEFAULT_SCOPE_CONTRACT: ScopeContract = {
  max_files: 10,
  max_lines: 1000,
  allowed_tools: ['read', 'exec', 'write'],
  budgets: {
    max_iterations: 3,
    max_tool_calls: 50,
    max_time_ms: 300000, // 5 minutes
  },
};

/**
 * Result of scope validation
 */
export interface ScopeValidationResult {
  allowed: boolean;
  reason?: string;
  requires_expansion?: ScopeExpansionRequest;
}

/**
 * ScopeManager: Tracks and enforces scope boundaries
 */
export class ScopeManager {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Derive scope summary from event stream
   * Pure function - deterministic from events only
   */
  deriveScopeSummary(taskId: string, events: Event[]): ScopeSummary {
    const taskEvents = events.filter(e => e.task_id === taskId);

    // Find the initial scope contract (from plan_created or mission start)
    let contract: ScopeContract = { ...DEFAULT_SCOPE_CONTRACT };
    const planEvent = taskEvents.find(e => e.type === 'plan_created');
    if (planEvent && planEvent.payload.scope_contract) {
      contract = planEvent.payload.scope_contract as ScopeContract;
    }

    // Apply any approved scope expansions
    const expansionEvents = taskEvents.filter(
      e => e.type === 'scope_expansion_resolved' && e.payload.approved === true
    );
    for (const expansion of expansionEvents) {
      const request = expansion.payload.request as ScopeExpansionRequest;
      if (request.requested.files && Array.isArray(request.requested.files)) {
        contract.max_files += request.requested.files.length;
      }
      if (typeof request.requested.lines === 'number') {
        contract.max_lines += request.requested.lines;
      }
      if (request.requested.tools) {
        contract.allowed_tools = [
          ...new Set([...contract.allowed_tools, ...request.requested.tools]),
        ];
      }
    }

    // Track in-scope files (files explicitly added to scope)
    const inScopeFiles: string[] = [];
    for (const event of taskEvents) {
      if (event.type === 'plan_created' && event.payload.files) {
        inScopeFiles.push(...(event.payload.files as string[]));
      }
      if (
        event.type === 'scope_expansion_resolved' &&
        event.payload.approved === true &&
        event.payload.request
      ) {
        const request = event.payload.request as ScopeExpansionRequest;
        if (request.requested.files) {
          inScopeFiles.push(...request.requested.files);
        }
      }
    }

    // Track touched files (append-only history)
    const touchedFilesMap = new Map<string, TouchedFile>();

    for (const event of taskEvents) {
      // Track retrieval events (reads)
      if (event.type === 'retrieval_completed' && event.payload.files) {
        const files = event.payload.files as Array<{
          path: string;
          line_range?: { start: number; end: number };
        }>;
        for (const file of files) {
          this.addTouchedOperation(touchedFilesMap, file.path, {
            type: 'read',
            timestamp: event.timestamp,
            event_id: event.event_id,
            line_range: file.line_range,
          });
        }
      }

      // Track diff applied events (writes)
      if (event.type === 'diff_applied' && event.payload.files) {
        const files = event.payload.files as string[];
        for (const filePath of files) {
          this.addTouchedOperation(touchedFilesMap, filePath, {
            type: 'write',
            timestamp: event.timestamp,
            event_id: event.event_id,
          });
        }
      }

      // Track tool execution (exec)
      if (event.type === 'tool_end' && event.payload.tool_name === 'terminal') {
        // Terminal tools are tracked as exec category
        this.addTouchedOperation(touchedFilesMap, '<terminal>', {
          type: 'execute',
          timestamp: event.timestamp,
          event_id: event.event_id,
        });
      }
    }

    const touchedFiles = Array.from(touchedFilesMap.values());

    // Calculate lines retrieved
    const linesRetrieved = this.calculateLinesRetrieved(touchedFiles);

    // Determine which tool categories have been used
    const toolsUsed = this.calculateToolsUsed(touchedFiles);

    return {
      contract,
      in_scope_files: [...new Set(inScopeFiles)],
      touched_files: touchedFiles,
      lines_retrieved: linesRetrieved,
      tools_used: toolsUsed,
    };
  }

  /**
   * Validate if an action is within scope
   */
  validateAction(
    summary: ScopeSummary,
    action: {
      type: 'read' | 'write' | 'execute';
      files?: string[];
      lines?: number;
    }
  ): ScopeValidationResult {
    // Check tool category
    const toolCategory = this.mapActionToToolCategory(action.type);
    if (!summary.contract.allowed_tools.includes(toolCategory)) {
      return {
        allowed: false,
        reason: `Tool category '${toolCategory}' not allowed in current scope`,
        requires_expansion: {
          requested: { tools: [toolCategory] },
          reason: `${action.type} operation requires '${toolCategory}' tool permission`,
          impact_level: this.calculateImpactLevel({ tools: [toolCategory] }),
        },
      };
    }

    // Check files
    if (action.files) {
      const currentFileCount = summary.in_scope_files.length;
      const newFiles = action.files.filter(f => !summary.in_scope_files.includes(f));
      if (currentFileCount + newFiles.length > summary.contract.max_files) {
        return {
          allowed: false,
          reason: `Would exceed max files (${summary.contract.max_files})`,
          requires_expansion: {
            requested: { files: newFiles },
            reason: `Need to access ${newFiles.length} additional file(s): ${newFiles.join(', ')}`,
            impact_level: this.calculateImpactLevel({ files: newFiles }),
          },
        };
      }
    }

    // Check lines
    if (action.lines) {
      const newTotal = summary.lines_retrieved + action.lines;
      if (newTotal > summary.contract.max_lines) {
        return {
          allowed: false,
          reason: `Would exceed max lines (${summary.contract.max_lines})`,
          requires_expansion: {
            requested: { lines: action.lines },
            reason: `Need to retrieve ${action.lines} more lines (current: ${summary.lines_retrieved}, max: ${summary.contract.max_lines})`,
            impact_level: this.calculateImpactLevel({ lines: action.lines }),
          },
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Request scope expansion (emits approval-gated event)
   */
  async requestScopeExpansion(
    taskId: string,
    mode: string,
    stage: string,
    request: ScopeExpansionRequest
  ): Promise<boolean> {
    const approvalId = `scope_exp_${Date.now()}`;

    // Emit scope_expansion_requested event
    this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'scope_expansion_requested',
      mode: mode as any,
      stage: stage as any,
      payload: {
        approval_id: approvalId,
        request,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // In real implementation, this would wait for user approval
    // For now, return false (denied) - requires integration with approvalManager
    return false;
  }

  /**
   * Resolve scope expansion (after user approval/denial)
   */
  resolveScopeExpansion(
    taskId: string,
    mode: string,
    stage: string,
    approvalId: string,
    approved: boolean,
    request: ScopeExpansionRequest
  ): void {
    this.eventBus.publish({
      event_id: `evt_${Date.now()}_${Math.random()}`,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'scope_expansion_resolved',
      mode: mode as any,
      stage: stage as any,
      payload: {
        approval_id: approvalId,
        approved,
        request,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  // Helper methods

  private addTouchedOperation(
    map: Map<string, TouchedFile>,
    path: string,
    operation: TouchedFile['operations'][0]
  ): void {
    const existing = map.get(path);
    if (existing) {
      existing.operations.push(operation);
    } else {
      map.set(path, { path, operations: [operation] });
    }
  }

  private calculateLinesRetrieved(touchedFiles: TouchedFile[]): number {
    let total = 0;
    for (const file of touchedFiles) {
      for (const op of file.operations) {
        if (op.type === 'read' && op.line_range) {
          total += op.line_range.end - op.line_range.start + 1;
        }
      }
    }
    return total;
  }

  private calculateToolsUsed(touchedFiles: TouchedFile[]): ToolCategory[] {
    const used = new Set<ToolCategory>();
    for (const file of touchedFiles) {
      for (const op of file.operations) {
        used.add(this.mapActionToToolCategory(op.type));
      }
    }
    return Array.from(used);
  }

  private mapActionToToolCategory(actionType: 'read' | 'write' | 'execute'): ToolCategory {
    if (actionType === 'read') return 'read';
    if (actionType === 'write') return 'write';
    return 'exec';
  }

  private calculateImpactLevel(
    requested: ScopeExpansionRequest['requested']
  ): 'low' | 'medium' | 'high' {
    let score = 0;

    if (requested.files && requested.files.length > 5) score += 2;
    else if (requested.files && requested.files.length > 0) score += 1;

    if (requested.lines && requested.lines > 500) score += 2;
    else if (requested.lines && requested.lines > 0) score += 1;

    if (requested.tools?.includes('write')) score += 2;
    else if (requested.tools?.includes('exec')) score += 1;

    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }
}
