/**
 * ToolExecutor: Tool invocation with mode gating, approval coordination, and evidence generation
 * Based on 02_AGENT_TOOL_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 * 
 * Requirements:
 * - No tool runs without permission
 * - No tool runs in the wrong mode
 * - Every tool call produces evidence
 * - All tool activity is observable
 * - Tools never bypass approval system
 */

import { EventBus } from './eventBus';
import { ModeManager, Action } from './modeManager';
import { ApprovalManager } from './approvalManager';
import { Event, Mode, Stage, Evidence, ToolCategory } from './types';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Tool result shape
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  duration_ms: number;
}

/**
 * Tool invocation parameters
 */
export interface ToolInvocation {
  toolName: string;
  category: ToolCategory;
  inputs: Record<string, unknown>;
  requiresApproval: boolean;
}

/**
 * Evidence store interface (simplified for V1)
 */
export interface EvidenceStore {
  store(evidence: Evidence): Promise<void>;
  get(evidenceId: string): Promise<Evidence | null>;
}

/**
 * Simple in-memory evidence store for V1
 */
export class InMemoryEvidenceStore implements EvidenceStore {
  private evidence = new Map<string, Evidence>();

  async store(evidence: Evidence): Promise<void> {
    this.evidence.set(evidence.evidence_id, evidence);
  }

  async get(evidenceId: string): Promise<Evidence | null> {
    return this.evidence.get(evidenceId) ?? null;
  }

  // For testing
  getAll(): Evidence[] {
    return Array.from(this.evidence.values());
  }

  clear(): void {
    this.evidence.clear();
  }
}

/**
 * ToolExecutor coordinates tool invocation with all safety gates
 */
export class ToolExecutor {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly modeManager: ModeManager;
  private readonly approvalManager: ApprovalManager;
  private readonly evidenceStore: EvidenceStore;
  private readonly workspaceRoot: string;

  constructor(
    taskId: string,
    eventBus: EventBus,
    modeManager: ModeManager,
    approvalManager: ApprovalManager,
    evidenceStore: EvidenceStore,
    workspaceRoot: string
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.modeManager = modeManager;
    this.approvalManager = approvalManager;
    this.evidenceStore = evidenceStore;
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Execute a tool with full safety gates:
   * 1. Mode validation
   * 2. Approval (if required)
   * 3. Evidence generation
   * 4. Event emission
   */
  async executeTool(invocation: ToolInvocation): Promise<ToolResult> {
    const { toolName, category, inputs, requiresApproval } = invocation;
    const mode = this.modeManager.getMode();
    const stage = this.modeManager.getStage();

    // Step 1: Pre-invocation validation - mode gating
    const modeAction = this.categoryToAction(category);
    const allowed = await this.modeManager.enforceAction(modeAction);
    
    if (!allowed) {
      throw new Error(
        `Tool '${toolName}' (${category}) is not permitted in ${mode} mode, stage ${stage}`
      );
    }

    // Step 2: Request approval if required
    if (requiresApproval) {
      const approvalType = this.categoryToApprovalType(category);
      const resolution = await this.approvalManager.requestApproval(
        this.taskId,
        mode,
        stage,
        approvalType,
        `Execute ${toolName}`,
        { tool: toolName, inputs }
      );

      if (resolution.decision === 'denied') {
        throw new Error(`Tool execution denied by user: ${toolName}`);
      }

      // Use modified details if provided (edit_requested)
      if (resolution.modified_details) {
        invocation.inputs = resolution.modified_details as Record<string, unknown>;
      }
    }

    // Step 3: Emit tool_start event
    const startTime = Date.now();
    const toolStartEvent = await this.emitToolStart(toolName, category, inputs, mode, stage);

    // Step 4: Execute the tool
    let result: ToolResult;
    let evidenceId: string | null = null;

    try {
      result = await this.invokeToolInternal(toolName, category, inputs);
      
      // Step 5: Generate evidence
      evidenceId = await this.generateEvidence(
        toolName,
        category,
        inputs,
        result,
        toolStartEvent.event_id
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: duration,
      };

      // Generate error evidence
      evidenceId = await this.generateEvidence(
        toolName,
        category,
        inputs,
        result,
        toolStartEvent.event_id
      );
    }

    // Step 6: Emit tool_end event
    await this.emitToolEnd(
      toolName,
      result,
      mode,
      stage,
      evidenceId ? [evidenceId] : [],
      toolStartEvent.event_id
    );

    return result;
  }

  /**
   * Emit tool_start event
   */
  private async emitToolStart(
    toolName: string,
    category: ToolCategory,
    inputs: Record<string, unknown>,
    mode: Mode,
    stage: Stage
  ): Promise<Event> {
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode,
      stage,
      payload: {
        tool: toolName,
        category,
        inputs: this.sanitizeInputs(inputs),
      },
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);
    return event;
  }

  /**
   * Emit tool_end event
   */
  private async emitToolEnd(
    toolName: string,
    result: ToolResult,
    mode: Mode,
    stage: Stage,
    evidenceIds: string[],
    parentEventId: string
  ): Promise<void> {
    const event: Event = {
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_end',
      mode,
      stage,
      payload: {
        tool: toolName,
        success: result.success,
        duration_ms: result.duration_ms,
        error: result.error,
      },
      evidence_ids: evidenceIds,
      parent_event_id: parentEventId,
    };

    await this.eventBus.publish(event);
  }

  /**
   * Generate evidence from tool execution
   */
  private async generateEvidence(
    toolName: string,
    category: ToolCategory,
    inputs: Record<string, unknown>,
    result: ToolResult,
    sourceEventId: string
  ): Promise<string> {
    const evidenceId = randomUUID();
    
    const evidence: Evidence = {
      evidence_id: evidenceId,
      type: result.success ? (category === 'exec' ? 'log' : 'file') : 'error',
      source_event_id: sourceEventId,
      content_ref: `evidence_${evidenceId}.json`,
      summary: this.generateEvidenceSummary(toolName, result),
      created_at: new Date().toISOString(),
    };

    await this.evidenceStore.store(evidence);
    return evidenceId;
  }

  /**
   * Generate human-readable evidence summary
   */
  private generateEvidenceSummary(toolName: string, result: ToolResult): string {
    if (!result.success) {
      return `${toolName} failed: ${result.error}`;
    }

    if (result.output) {
      const outputPreview = result.output.substring(0, 100);
      return `${toolName} completed (${outputPreview}${result.output.length > 100 ? '...' : ''})`;
    }

    return `${toolName} completed successfully`;
  }

  /**
   * Internal tool invocation - implements actual tool logic
   */
  private async invokeToolInternal(
    toolName: string,
    category: ToolCategory,
    inputs: Record<string, unknown>
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      let output: string | undefined;

      // Dispatch based on tool name
      switch (toolName) {
        case 'readFile':
          output = await this.readFile(inputs.path as string);
          break;
        
        case 'listFiles':
          output = await this.listFiles(inputs.path as string, inputs.recursive as boolean);
          break;
        
        case 'searchFiles':
          output = await this.searchFiles(
            inputs.path as string,
            inputs.pattern as string
          );
          break;

        case 'executeCommand':
          // This would integrate with terminal in real implementation
          output = `[Terminal execution simulated: ${inputs.command}]`;
          break;

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      const duration = Date.now() - startTime;
      return {
        success: true,
        output,
        duration_ms: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      throw error; // Let caller handle evidence generation
    }
  }

  /**
   * Read file tool implementation
   */
  private async readFile(filePath: string): Promise<string> {
    const fullPath = path.resolve(this.workspaceRoot, filePath);
    
    // Security: prevent path traversal
    if (!fullPath.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected');
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    return content;
  }

  /**
   * List files tool implementation
   */
  private async listFiles(dirPath: string, recursive: boolean = false): Promise<string> {
    const fullPath = path.resolve(this.workspaceRoot, dirPath);
    
    if (!fullPath.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected');
    }

    const files = await fs.readdir(fullPath, { withFileTypes: true });
    const result: string[] = [];

    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      
      if (file.isDirectory() && recursive) {
        result.push(`${filePath}/`);
        const subFiles = await this.listFiles(filePath, true);
        result.push(subFiles);
      } else {
        result.push(filePath);
      }
    }

    return result.join('\n');
  }

  /**
   * Search files tool implementation (simple grep-like)
   */
  private async searchFiles(dirPath: string, pattern: string): Promise<string> {
    const fullPath = path.resolve(this.workspaceRoot, dirPath);
    
    if (!fullPath.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected');
    }

    // In real implementation, this would use the indexer/retriever
    return `[Search for '${pattern}' in ${dirPath} - integrate with retrieval system]`;
  }

  /**
   * Map tool category to mode action
   */
  private categoryToAction(category: ToolCategory): Action {
    switch (category) {
      case 'read':
        return 'read_file';
      case 'exec':
        return 'execute_command';
      case 'write':
        return 'write_file';
      default:
        throw new Error(`Unknown category: ${category}`);
    }
  }

  /**
   * Map tool category to approval type
   */
  private categoryToApprovalType(category: ToolCategory): 'terminal' | 'apply_diff' {
    switch (category) {
      case 'exec':
        return 'terminal';
      case 'write':
        return 'apply_diff';
      default:
        throw new Error(`Category ${category} does not require approval`);
    }
  }

  /**
   * Sanitize inputs to prevent logging sensitive data
   */
  private sanitizeInputs(inputs: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...inputs };
    
    // Redact sensitive keys
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key'];
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }
}
