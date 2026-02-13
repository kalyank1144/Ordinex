/**
 * Agentic Loop — LLM ↔ Tool execution loop (A3)
 *
 * Implements the standard Anthropic tool-use pattern:
 *   user → LLM (with tools) → tool_use → execute → tool_result → LLM → …
 *
 * Pure core class (P1 compliant). Tool execution is delegated to a
 * ToolExecutionProvider interface — the extension supplies the real impl.
 */

import { EventBus } from './eventBus';
import { Mode, Stage } from './types';
import { ConversationHistory, ConversationMessage, ContentBlock } from './conversationHistory';
import { ToolSchema, ALL_TOOLS, toolNameToCategory, buildToolsParam } from './toolSchemas';
import { resolveModel } from './modelRegistry';
import { validateContextFitsSync, validateContextFits } from './tokenCounter';
import type { TokenCounter } from './tokenCounter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of executing a single tool invocation */
export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Provider interface for executing tools.
 * Extension implements this with real FS/command operations.
 */
export interface ToolExecutionProvider {
  executeTool(name: string, input: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/**
 * Anthropic API client interface (subset needed by the loop).
 * Matches the Anthropic SDK's messages.create() signature.
 */
export interface LLMClient {
  createMessage(params: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: ConversationMessage[];
    tools?: ToolSchema[];
  }): Promise<LLMClientResponse>;
}

export interface LLMClientResponse {
  id: string;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Configuration for the agentic loop */
export interface AgenticLoopConfig {
  /** Maximum number of tool-use iterations before stopping (default 25) */
  maxIterations: number;
  /** Maximum total tokens to accumulate before stopping (default 200_000) */
  maxTotalTokens: number;
  /** Which tools to expose (default: ALL_TOOLS) */
  tools?: ToolSchema[];
  /** Read-only mode — only expose read tools (default: false) */
  readOnly?: boolean;
}

const DEFAULT_CONFIG: AgenticLoopConfig = {
  maxIterations: 25,
  maxTotalTokens: 200_000,
};

/** Result of running the agentic loop to completion */
export interface AgenticLoopResult {
  /** Final text response from the LLM */
  finalText: string;
  /** Number of tool-use iterations performed */
  iterations: number;
  /** Total tokens consumed */
  totalTokens: { input: number; output: number };
  /** Reason the loop ended */
  stopReason: 'end_turn' | 'max_iterations' | 'max_tokens' | 'error';
  /** Error message if stopReason is 'error' */
  error?: string;
  /** All tool calls made during the loop */
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: string;
    success: boolean;
    iteration: number;
  }>;
}

// ---------------------------------------------------------------------------
// AgenticLoop
// ---------------------------------------------------------------------------

export class AgenticLoop {
  private readonly eventBus: EventBus;
  private readonly taskId: string;
  private readonly mode: Mode;
  private readonly config: AgenticLoopConfig;

  constructor(
    eventBus: EventBus,
    taskId: string,
    mode: Mode,
    config?: Partial<AgenticLoopConfig>,
  ) {
    this.eventBus = eventBus;
    this.taskId = taskId;
    this.mode = mode;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the agentic loop to completion.
   *
   * @param llmClient   - API client for calling the LLM
   * @param toolProvider - Provider for executing tools
   * @param history      - Conversation history (mutated in place with new messages)
   * @param systemPrompt - System prompt for the LLM
   * @param model        - User-facing model identifier
   * @param maxTokens    - Per-call max output tokens
   * @param onText       - Optional callback for streaming text chunks
   */
  async run(params: {
    llmClient: LLMClient;
    toolProvider: ToolExecutionProvider;
    history: ConversationHistory;
    systemPrompt?: string;
    model: string;
    maxTokens?: number;
    onText?: (text: string) => void;
    /** Optional async token counter for accurate context validation */
    tokenCounter?: TokenCounter;
  }): Promise<AgenticLoopResult> {
    const {
      llmClient,
      toolProvider,
      history,
      systemPrompt,
      model: userModel,
      maxTokens = 4096,
      onText,
      tokenCounter,
    } = params;

    const actualModel = resolveModel(userModel);
    const tools = this.config.tools ?? buildToolsParam({ readOnly: this.config.readOnly });

    const result: AgenticLoopResult = {
      finalText: '',
      iterations: 0,
      totalTokens: { input: 0, output: 0 },
      stopReason: 'end_turn',
      toolCalls: [],
    };

    // -----------------------------------------------------------------------
    // Main loop
    // -----------------------------------------------------------------------
    for (let i = 0; i < this.config.maxIterations; i++) {
      result.iterations = i + 1;

      // --- Pre-request context validation ---
      if (tokenCounter) {
        try {
          const fit = await validateContextFits(tokenCounter, history.getMessages(), actualModel, {
            system: systemPrompt,
            tools,
            maxOutputTokens: maxTokens,
          });
          if (!fit.fits) {
            const trimmed = await history.trimAsync(tokenCounter, actualModel);
            if (trimmed > 0) {
              console.log(`[AgenticLoop] Trimmed ${trimmed} messages to fit context window`);
            }
          }
        } catch {
          // Fall through to sync validation
        }
      } else {
        const fit = validateContextFitsSync(history.getMessages(), actualModel, {
          system: systemPrompt,
          tools,
          maxOutputTokens: maxTokens,
        });
        if (!fit.fits) {
          const trimmed = history.trim();
          if (trimmed > 0) {
            console.log(`[AgenticLoop] Sync-trimmed ${trimmed} messages to fit context window`);
          }
        }
      }

      // --- Call LLM ---
      const loopEventId = this.generateId();
      await this.emitToolStart(loopEventId, 'agentic_loop_call', {
        iteration: i + 1,
        model: actualModel,
        message_count: history.length,
      });

      let response: LLMClientResponse;
      try {
        response = await llmClient.createMessage({
          model: actualModel,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: history.toApiMessages(),
          tools: tools.length > 0 ? tools : undefined,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.emitToolEnd(loopEventId, false, { error: errMsg });
        result.stopReason = 'error';
        result.error = errMsg;
        return result;
      }

      // Track token usage
      if (response.usage) {
        result.totalTokens.input += response.usage.input_tokens;
        result.totalTokens.output += response.usage.output_tokens;
      }

      // Check total token budget
      const totalUsed = result.totalTokens.input + result.totalTokens.output;
      if (totalUsed > this.config.maxTotalTokens) {
        await this.emitToolEnd(loopEventId, true, { reason: 'token_budget_exceeded' });
        result.stopReason = 'max_tokens';
        // Still collect any text from this response
        result.finalText += this.extractText(response);
        return result;
      }

      // --- Process response content blocks ---
      const textParts: string[] = [];
      const toolUseBlocks: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
          onText?.(block.text);
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
        }
      }

      // Add assistant message to history (with all content blocks)
      const assistantContent: ContentBlock[] = response.content.map(block => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      });
      history.addAssistantMessage(assistantContent);

      await this.emitToolEnd(loopEventId, true, {
        stop_reason: response.stop_reason,
        text_length: textParts.join('').length,
        tool_calls: toolUseBlocks.length,
      });

      // --- If no tool use, we're done ---
      if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
        result.finalText += textParts.join('');
        result.stopReason = response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn';
        return result;
      }

      // --- Execute tools ---
      const toolResults: ContentBlock[] = [];

      for (const toolBlock of toolUseBlocks) {
        const toolEventId = this.generateId();
        await this.emitToolStart(toolEventId, toolBlock.name, {
          tool_use_id: toolBlock.id,
          category: toolNameToCategory(toolBlock.name),
          input: this.sanitizeInput(toolBlock.input),
        });

        let execResult: ToolExecutionResult;
        try {
          execResult = await toolProvider.executeTool(toolBlock.name, toolBlock.input);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          execResult = { success: false, output: '', error: errMsg };
        }

        result.toolCalls.push({
          name: toolBlock.name,
          input: toolBlock.input,
          output: execResult.output,
          success: execResult.success,
          iteration: i + 1,
        });

        await this.emitToolEnd(toolEventId, execResult.success, {
          tool_use_id: toolBlock.id,
          output_length: execResult.output.length,
          error: execResult.error,
        });

        // Build tool_result content block
        const resultContent = execResult.success
          ? execResult.output
          : `Error: ${execResult.error || 'Tool execution failed'}\n${execResult.output}`;

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: resultContent,
          is_error: !execResult.success,
        });
      }

      // Add tool results as a user message (Anthropic API requirement)
      history.addUserMessage(toolResults);

      // Collect any text the assistant provided alongside tool calls
      result.finalText += textParts.join('');
    }

    // Ran out of iterations
    result.stopReason = 'max_iterations';
    return result;
  }

  // -----------------------------------------------------------------------
  // Event helpers
  // -----------------------------------------------------------------------

  private async emitToolStart(
    eventId: string,
    tool: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventBus.publish({
      event_id: eventId,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode: this.mode,
      stage: 'edit' as Stage,
      payload: { tool, ...payload },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  private async emitToolEnd(
    parentEventId: string,
    success: boolean,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventBus.publish({
      event_id: this.generateId(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_end',
      mode: this.mode,
      stage: 'edit' as Stage,
      payload: { status: success ? 'success' : 'failed', ...payload },
      evidence_ids: [],
      parent_event_id: parentEventId,
    });
  }

  private extractText(response: LLMClientResponse): string {
    return response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');
  }

  private sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...input };
    // Truncate large content fields for event payload
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = value.substring(0, 500) + `... (${value.length} chars)`;
      }
    }
    return sanitized;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}
