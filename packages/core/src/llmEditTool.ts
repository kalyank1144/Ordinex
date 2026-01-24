/**
 * LLM Edit Tool for MISSION EDIT stage
 * Based on spec Section 2: ADD TOOL: llm_edit_step
 * 
 * This is the tool that calls LLM to generate unified diffs
 * with proper system prompt, input/output schema validation
 */

import { EventBus } from './eventBus';
import { Mode, Stage } from './types';
import { FileContextEntry } from './excerptSelector';
import { validateDiff, ParsedDiff } from './unifiedDiffParser';
import { LLMConfig } from './llmService';
import { randomUUID } from 'crypto';

/**
 * LLM Edit Step Input (as per spec)
 */
export interface LLMEditStepInput {
  task_id: string;
  step_id: string;
  step_text: string;
  repo_signals?: {
    stack?: string;
    top_dirs?: string[];
  };
  file_context: FileContextEntry[];
  constraints: {
    max_files: number;
    max_changed_lines: number;
    forbid_create: boolean;
    forbid_delete: boolean;
    forbid_rename: boolean;
  };
  preconditions: {
    staleness_guard: string;
  };
}

/**
 * LLM Edit Step Output (V1 FULL CONTENT STRATEGY)
 * 
 * IMPORTANT: unified_diff is for DISPLAY/REVIEW only.
 * Actual file changes use touched_files[].new_content (full file content).
 */
export interface LLMEditStepOutput {
  unified_diff: string;  // For display/review only
  touched_files: Array<{
    path: string;
    action: 'create' | 'update' | 'delete';
    new_content?: string;  // REQUIRED for create/update, undefined for delete
    base_sha?: string | null;  // null for newly created files
  }>;
  confidence: 'low' | 'medium' | 'high';
  notes: string;
  validation_status: 'ok' | 'stale_context' | 'cannot_edit';
}

/**
 * Result from calling llm_edit_step
 */
export interface LLMEditStepResult {
  success: boolean;
  output?: LLMEditStepOutput;
  parsed_diff?: ParsedDiff;
  error?: {
    type: 'llm_error' | 'parse_error' | 'validation_error' | 'schema_error';
    message: string;
    details?: Record<string, unknown>;
  };
  duration_ms: number;
}

/**
 * Model fallback map
 */
const MODEL_MAP: Record<string, string> = {
  'claude-3-haiku': 'claude-3-haiku-20240307',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-opus': 'claude-3-opus-20240229',
  'sonnet-4.5': 'claude-3-haiku-20240307',
  'opus-4.5': 'claude-3-haiku-20240307',
  'gpt-5.2': 'claude-3-haiku-20240307',
  'gemini-3': 'claude-3-haiku-20240307',
};

const DEFAULT_MODEL = 'claude-3-haiku-20240307';

/**
 * LLM Edit Tool - calls LLM to generate unified diffs
 */
export class LLMEditTool {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly mode: Mode;

  constructor(taskId: string, eventBus: EventBus, mode: Mode = 'MISSION') {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.mode = mode;
  }

  /**
   * Execute llm_edit_step tool
   * Emits: tool_start, tool_end
   */
  async execute(
    input: LLMEditStepInput,
    config: LLMConfig
  ): Promise<LLMEditStepResult> {
    const startTime = Date.now();
    const toolStartEventId = this.generateId();
    
    const userSelectedModel = config.model;
    const actualModel = MODEL_MAP[userSelectedModel] || DEFAULT_MODEL;

    // Emit tool_start
    await this.eventBus.publish({
      event_id: toolStartEventId,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode: this.mode,
      stage: 'edit',
      payload: {
        tool: 'llm_edit_step',
        step_id: input.step_id,
        model_id: actualModel,
        file_count: input.file_context.length,
        constraints: input.constraints,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    try {
      // Build system prompt (MANDATORY - verbatim from spec)
      const systemPrompt = this.buildSystemPrompt();
      
      // Build user prompt with file context
      const userPrompt = this.buildUserPrompt(input);
      
      // Call LLM
      const llmResponse = await this.callLLM(
        systemPrompt,
        userPrompt,
        config.apiKey,
        actualModel,
        config.maxTokens || 8192
      );

      const duration_ms = Date.now() - startTime;

      // Parse and validate output
      const parseResult = this.parseOutput(llmResponse);
      
      if (!parseResult.success || !parseResult.output) {
        // Emit tool_end with failure
        await this.eventBus.publish({
          event_id: this.generateId(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'tool_end',
          mode: this.mode,
          stage: 'edit',
          payload: {
            tool: 'llm_edit_step',
            status: 'failed',
            error: parseResult.error?.message || 'Failed to parse LLM output',
            duration_ms,
          },
          evidence_ids: [],
          parent_event_id: toolStartEventId,
        });

        return {
          success: false,
          error: parseResult.error,
          duration_ms,
        };
      }

      const output = parseResult.output;

      // Check validation_status from LLM
      if (output.validation_status !== 'ok') {
        await this.eventBus.publish({
          event_id: this.generateId(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'tool_end',
          mode: this.mode,
          stage: 'edit',
          payload: {
            tool: 'llm_edit_step',
            status: 'failed',
            validation_status: output.validation_status,
            confidence: output.confidence,
            notes: output.notes,
            duration_ms,
          },
          evidence_ids: [],
          parent_event_id: toolStartEventId,
        });

        return {
          success: false,
          output,
          error: {
            type: 'validation_error',
            message: `LLM returned validation_status: ${output.validation_status}`,
            details: { notes: output.notes, confidence: output.confidence },
          },
          duration_ms,
        };
      }

      // Validate new_content presence for create/update actions
      for (const file of output.touched_files) {
        if ((file.action === 'create' || file.action === 'update') && !file.new_content) {
          await this.eventBus.publish({
            event_id: this.generateId(),
            task_id: this.taskId,
            timestamp: new Date().toISOString(),
            type: 'tool_end',
            mode: this.mode,
            stage: 'edit',
            payload: {
              tool: 'llm_edit_step',
              status: 'failed',
              error: `Missing new_content for ${file.action} action on ${file.path}`,
              duration_ms,
            },
            evidence_ids: [],
            parent_event_id: toolStartEventId,
          });

          return {
            success: false,
            output,
            error: {
              type: 'schema_error',
              message: `touched_files[${file.path}] must have new_content for ${file.action} action`,
            },
            duration_ms,
          };
        }
      }

      // V1 FULL CONTENT STRATEGY: unified_diff is display-only, don't parse it
      // Build mock ParsedDiff from touched_files for compatibility
      const totalAdditions = output.touched_files.reduce((sum, tf) => 
        sum + (tf.new_content ? tf.new_content.split('\n').length : 0), 0);
      const totalDeletions = output.touched_files.reduce((sum, tf) => 
        sum + (tf.action === 'delete' ? 100 : 0), 0);
      
      const mockParsedDiff: ParsedDiff = {
        files: output.touched_files.map(tf => ({
          oldPath: tf.action === 'create' ? '/dev/null' : tf.path,
          newPath: tf.action === 'delete' ? '/dev/null' : tf.path,
          additions: tf.new_content ? tf.new_content.split('\n').length : 0,
          deletions: tf.action === 'delete' ? 100 : 0, // Estimated
          hunks: [], // Not used in V1
          isCreate: tf.action === 'create',
          isDelete: tf.action === 'delete',
          isRename: false,
          hasModeChange: false,
        })),
        totalAdditions,
        totalDeletions,
        totalChangedLines: totalAdditions + totalDeletions,
      };

      // Validate constraints using mock parsed diff
      if (mockParsedDiff.files.length > input.constraints.max_files) {
        await this.eventBus.publish({
          event_id: this.generateId(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'tool_end',
          mode: this.mode,
          stage: 'edit',
          payload: {
            tool: 'llm_edit_step',
            status: 'failed',
            error: `Exceeds max_files constraint: ${mockParsedDiff.files.length} > ${input.constraints.max_files}`,
            duration_ms,
          },
          evidence_ids: [],
          parent_event_id: toolStartEventId,
        });

        return {
          success: false,
          output,
          error: {
            type: 'validation_error',
            message: `Exceeds max_files constraint: ${mockParsedDiff.files.length} > ${input.constraints.max_files}`,
          },
          duration_ms,
        };
      }

      const totalChangedLines = mockParsedDiff.totalAdditions + mockParsedDiff.totalDeletions;
      if (totalChangedLines > input.constraints.max_changed_lines) {
        await this.eventBus.publish({
          event_id: this.generateId(),
          task_id: this.taskId,
          timestamp: new Date().toISOString(),
          type: 'tool_end',
          mode: this.mode,
          stage: 'edit',
          payload: {
            tool: 'llm_edit_step',
            status: 'failed',
            error: `Exceeds max_changed_lines constraint: ${totalChangedLines} > ${input.constraints.max_changed_lines}`,
            duration_ms,
          },
          evidence_ids: [],
          parent_event_id: toolStartEventId,
        });

        return {
          success: false,
          output,
          error: {
            type: 'validation_error',
            message: `Exceeds max_changed_lines constraint: ${totalChangedLines} > ${input.constraints.max_changed_lines}`,
          },
          duration_ms,
        };
      }

      // Success
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: 'edit',
        payload: {
          tool: 'llm_edit_step',
          status: 'success',
          files_touched: output.touched_files.length,
          confidence: output.confidence,
          total_additions: mockParsedDiff.totalAdditions,
          total_deletions: mockParsedDiff.totalDeletions,
          duration_ms,
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      return {
        success: true,
        output,
        parsed_diff: mockParsedDiff,
        duration_ms,
      };

    } catch (error) {
      const duration_ms = Date.now() - startTime;

      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: 'edit',
        payload: {
          tool: 'llm_edit_step',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          duration_ms,
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      return {
        success: false,
        error: {
          type: 'llm_error',
          message: error instanceof Error ? error.message : String(error),
        },
        duration_ms,
      };
    }
  }

  /**
   * Build system prompt (V1 FULL CONTENT STRATEGY)
   */
  private buildSystemPrompt(): string {
    return `You are editing code for a specific task step. You will receive file excerpts with their base_sha hashes.

OUTPUT REQUIREMENTS:

Output ONLY valid JSON with these exact fields: unified_diff, touched_files, confidence, notes, validation_status

touched_files array structure (CRITICAL):
Each entry MUST have:
- path: string (file path)
- action: "create" | "update" | "delete" (operation type)
- new_content: string (REQUIRED for create/update actions - THE COMPLETE NEW FILE CONTENT)
- base_sha: string | null (the base_sha from input, or null for newly created files)

unified_diff is for DISPLAY/REVIEW ONLY. The actual file changes will use touched_files[].new_content.
For create/update actions, new_content MUST contain the ENTIRE new file content, not just the changes.

validation_status field MUST be EXACTLY one of:
- "ok" - successfully generated changes
- "stale_context" - file content seems outdated/incomplete
- "cannot_edit" - cannot make the requested change

CRITICAL RULES:

1. For update actions: new_content must contain the FULL file with all changes applied
2. For create actions: new_content must contain the COMPLETE new file
3. For delete actions: new_content must be omitted/undefined
4. Do NOT create files (action: "create") unless explicitly requested
5. Do NOT delete files (action: "delete") unless explicitly requested
6. ONLY modify files provided in file_context
7. If uncertain, set validation_status to "cannot_edit" with explanation in notes
8. Use LF line endings only (no CRLF)
9. Do NOT add explanations outside the JSON structure`;
  }

  /**
   * Build user prompt with file context
   */
  private buildUserPrompt(input: LLMEditStepInput): string {
    const fileContextStr = input.file_context.map(f => {
      return `=== FILE: ${f.path} (base_sha: ${f.base_sha}) ===
Lines ${f.line_start}-${f.line_end} (${f.is_full_file ? 'FULL FILE' : 'EXCERPT'})
${f.content}
=== END FILE ===`;
    }).join('\n\n');

    const constraintsStr = `
CONSTRAINTS:
- Maximum files to modify: ${input.constraints.max_files}
- Maximum changed lines (additions + deletions): ${input.constraints.max_changed_lines}
- File creation: ${input.constraints.forbid_create ? 'FORBIDDEN' : 'allowed'}
- File deletion: ${input.constraints.forbid_delete ? 'FORBIDDEN' : 'allowed'}
- File rename: ${input.constraints.forbid_rename ? 'FORBIDDEN' : 'allowed'}`;

    const repoSignalsStr = input.repo_signals ? `
REPOSITORY INFO:
- Stack: ${input.repo_signals.stack || 'unknown'}
- Top directories: ${input.repo_signals.top_dirs?.join(', ') || 'unknown'}` : '';

    return `TASK STEP: ${input.step_text}
${repoSignalsStr}
${constraintsStr}

PRECONDITION: ${input.preconditions.staleness_guard}

FILE CONTEXT:
${fileContextStr}

Generate the unified diff to implement this step. Output ONLY valid JSON.`;
  }

  /**
   * Parse LLM output into structured format
   */
  private parseOutput(response: string): { success: boolean; output?: LLMEditStepOutput; error?: LLMEditStepResult['error'] } {
    try {
      // Try to extract JSON from response
      let jsonStr = response.trim();
      
      // Remove markdown code blocks if present
      const jsonBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        jsonStr = jsonBlockMatch[1].trim();
      } else {
        const codeBlockMatch = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }
      }

      // Try to extract JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      const requiredFields = ['unified_diff', 'touched_files', 'confidence', 'notes', 'validation_status'];
      for (const field of requiredFields) {
        if (!(field in parsed)) {
          return {
            success: false,
            error: {
              type: 'schema_error',
              message: `Missing required field: ${field}`,
            },
          };
        }
      }

      // Validate confidence values
      if (!['low', 'medium', 'high'].includes(parsed.confidence)) {
        return {
          success: false,
          error: {
            type: 'schema_error',
            message: `Invalid confidence value: ${parsed.confidence}`,
          },
        };
      }

      // Validate and normalize validation_status values
      const rawStatus = parsed.validation_status as string;
      const rawStatusLower = rawStatus.toLowerCase();
      let normalizedStatus: 'ok' | 'stale_context' | 'cannot_edit' | null = null;
      let statusWasMapped = false;

      // Direct matches (case-insensitive)
      if (['ok'].includes(rawStatusLower)) {
        normalizedStatus = 'ok';
      } else if (['stale_context'].includes(rawStatusLower)) {
        normalizedStatus = 'stale_context';
      } else if (['cannot_edit'].includes(rawStatusLower)) {
        normalizedStatus = 'cannot_edit';
      }
      // Alias mappings
      else if (['success', 'valid', 'completed'].includes(rawStatusLower)) {
        normalizedStatus = 'ok';
        statusWasMapped = true;
        console.warn(`[llmEditTool] Normalized validation_status: "${rawStatus}" -> "ok"`);
      } else if (['error', 'failed', 'failure'].includes(rawStatusLower)) {
        normalizedStatus = 'cannot_edit';
        statusWasMapped = true;
        console.warn(`[llmEditTool] Normalized validation_status: "${rawStatus}" -> "cannot_edit"`);
      } else if (['outdated', 'stale'].includes(rawStatusLower)) {
        normalizedStatus = 'stale_context';
        statusWasMapped = true;
        console.warn(`[llmEditTool] Normalized validation_status: "${rawStatus}" -> "stale_context"`);
      }

      if (!normalizedStatus) {
        return {
          success: false,
          error: {
            type: 'schema_error',
            message: `Invalid validation_status value: "${rawStatus}". Expected: ok | stale_context | cannot_edit`,
            details: {
              raw_validation_status: rawStatus,
              raw_response_preview: response.substring(0, 300),
            },
          },
        };
      }

      // Update parsed object with normalized status
      parsed.validation_status = normalizedStatus;
      
      // Add telemetry flag if status was mapped
      if (statusWasMapped) {
        (parsed as any).status_was_mapped = true;
        (parsed as any).original_status = rawStatus;
      }

      // Validate touched_files structure
      if (!Array.isArray(parsed.touched_files)) {
        return {
          success: false,
          error: {
            type: 'schema_error',
            message: 'touched_files must be an array',
          },
        };
      }

      for (const file of parsed.touched_files) {
        if (!file.path || !file.base_sha) {
          return {
            success: false,
            error: {
              type: 'schema_error',
              message: 'Each touched_file must have path and base_sha',
            },
          };
        }
      }

      return {
        success: true,
        output: parsed as LLMEditStepOutput,
      };

    } catch (error) {
      return {
        success: false,
        error: {
          type: 'parse_error',
          message: error instanceof Error ? error.message : 'Failed to parse JSON',
          details: { raw_response: response.substring(0, 500) },
        },
      };
    }
  }

  /**
   * Call LLM API
   */
  private async callLLM(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    model: string,
    maxTokens: number
  ): Promise<string> {
    // Dynamic import to avoid bundling issues
    const Anthropic = await this.loadAnthropicSDK();
    
    const client = new Anthropic({
      apiKey: apiKey,
    });

    const response = await client.messages.create({
      model: model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    // Extract text content
    const content = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('');

    return content;
  }

  /**
   * Dynamically load Anthropic SDK
   */
  private async loadAnthropicSDK(): Promise<any> {
    try {
      const anthropic = require('@anthropic-ai/sdk');
      return anthropic.default || anthropic;
    } catch (error) {
      throw new Error(
        'Anthropic SDK not installed. Please run: npm install @anthropic-ai/sdk'
      );
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}

/**
 * Default constraints for llm_edit_step
 */
export const DEFAULT_EDIT_CONSTRAINTS = {
  max_files: 3,
  max_changed_lines: 100,
  forbid_create: true,
  forbid_delete: true,
  forbid_rename: true,
};

/**
 * Default preconditions for llm_edit_step
 */
export const DEFAULT_PRECONDITIONS = {
  staleness_guard: "You MUST base your diff on the provided base_sha for each file. If you cannot confidently produce a diff because context seems incomplete, return empty unified_diff with confidence 'low' and notes explaining the issue.",
};
