/**
 * LLM Service for ANSWER mode
 * Provides streaming LLM integration with support for Anthropic Claude API
 * 
 * V1: Single provider (Anthropic)
 * Future: Multi-provider support
 */

import { EventBus } from './eventBus';
import { Mode, Stage, Evidence } from './types';
import { safeJsonParse } from './jsonRepair';
import { resolveModel, didModelFallback } from './modelRegistry';
import type { ConversationMessage } from './conversationHistory';
import { validateContextFitsSync, validateContextFits } from './tokenCounter';
import type { TokenCounter } from './tokenCounter';

export interface LLMConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * LLM Error types for provider integration
 */
export type LLMErrorType = 
  | 'model_not_available'
  | 'unauthorized'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'timeout'
  | 'unknown';

/**
 * Map Anthropic API error codes to LLMErrorType
 */
function mapApiErrorToType(error: Error): LLMErrorType {
  const message = error.message.toLowerCase();
  
  if (message.includes('model') && (message.includes('not found') || message.includes('not available') || message.includes('does not exist'))) {
    return 'model_not_available';
  }
  if (message.includes('unauthorized') || message.includes('invalid api key') || message.includes('authentication')) {
    return 'unauthorized';
  }
  if (message.includes('rate limit') || message.includes('too many requests') || message.includes('quota')) {
    return 'rate_limit';
  }
  if (message.includes('invalid') || message.includes('bad request') || message.includes('malformed')) {
    return 'invalid_request';
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }
  if (message.includes('server') || message.includes('internal') || message.includes('503') || message.includes('500')) {
    return 'server_error';
  }
  
  return 'unknown';
}

/**
 * LLM Service for ANSWER mode
 * Handles streaming LLM calls with event emission
 */
export class LLMService {
  private taskId: string;
  private eventBus: EventBus;
  private mode: Mode;
  private stage: Stage;

  constructor(taskId: string, eventBus: EventBus, mode: Mode, stage: Stage) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.mode = mode;
    this.stage = stage;
  }

  /**
   * Stream LLM answer with project context
   * Emits events: tool_start, stream_delta, stream_complete, tool_end
   */
  async streamAnswerWithContext(
    userQuestion: string,
    systemContext: string,
    config: LLMConfig,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMResponse> {
    console.log('=== LLMService.streamAnswerWithContext START ===');
    console.log('User question:', userQuestion);
    console.log('System context length:', systemContext.length);

    const userSelectedModel = config.model;
    const actualModel = resolveModel(userSelectedModel);
    const didFallback = didModelFallback(userSelectedModel);

    console.log('Model mapping:', { userSelectedModel, actualModel, didFallback });

    // Emit model_fallback_used if we had to fallback
    if (didFallback) {
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'model_fallback_used',
        mode: this.mode,
        stage: this.stage,
        payload: {
          requested_model: userSelectedModel,
          actual_model: actualModel,
          reason: 'unsupported_model',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
    }

    // Emit tool_start
    const toolStartEventId = this.generateId();
    await this.eventBus.publish({
      event_id: toolStartEventId,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode: this.mode,
      stage: this.stage,
      payload: {
        tool: 'llm_answer',
        model: actualModel,
        max_tokens: config.maxTokens || 4096,
        has_context: systemContext.length > 0,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    try {
      // Call Anthropic API with streaming and context
      const response = await this.callAnthropicStreamWithContext(
        userQuestion,
        systemContext,
        config.apiKey,
        actualModel,
        config.maxTokens || 4096,
        onChunk
      );

      // Emit tool_end with success
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: this.stage,
        payload: {
          tool: 'llm_answer',
          status: 'success',
          model: actualModel,
          usage: response.usage,
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      return response;
    } catch (error) {
      // Emit tool_end with failure
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: this.stage,
        payload: {
          tool: 'llm_answer',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      throw error;
    }
  }

  /**
   * Stream LLM answer for a user question
   * Emits events: tool_start, tool_end, model_fallback_used (if applicable)
   * Calls onChunk for each streaming delta
   */
  async streamAnswer(
    userQuestion: string,
    config: LLMConfig,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMResponse> {
    console.log('=== LLMService.streamAnswer START ===');
    console.log('User question:', userQuestion);
    console.log('Config:', { model: config.model, maxTokens: config.maxTokens, hasApiKey: !!config.apiKey });

    const userSelectedModel = config.model;
    const actualModel = resolveModel(userSelectedModel);
    const didFallback = didModelFallback(userSelectedModel);

    console.log('Model mapping:', { userSelectedModel, actualModel, didFallback });

    // Emit model_fallback_used if we had to fallback
    if (didFallback) {
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'model_fallback_used',
        mode: this.mode,
        stage: this.stage,
        payload: {
          requested_model: userSelectedModel,
          actual_model: actualModel,
          reason: 'unsupported_model',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
    }

    // Emit tool_start
    const toolStartEventId = this.generateId();
    await this.eventBus.publish({
      event_id: toolStartEventId,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode: this.mode,
      stage: this.stage,
      payload: {
        tool: 'llm_answer',
        model: actualModel,
        max_tokens: config.maxTokens || 4096,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    try {
      // Call Anthropic API with streaming
      const response = await this.callAnthropicStream(
        userQuestion,
        config.apiKey,
        actualModel,
        config.maxTokens || 4096,
        onChunk
      );

      // Emit tool_end with success
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: this.stage,
        payload: {
          tool: 'llm_answer',
          status: 'success',
          model: actualModel,
          usage: response.usage,
        },
        evidence_ids: [], // Will be added by caller after evidence creation
        parent_event_id: toolStartEventId,
      });

      return response;
    } catch (error) {
      // Emit tool_end with failure
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: this.stage,
        payload: {
          tool: 'llm_answer',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      throw error;
    }
  }

  /**
   * Stream LLM answer with full conversation history (multi-turn A2).
   * Like streamAnswerWithContext but passes the full ConversationMessage[]
   * instead of a single user message, enabling multi-turn conversations.
   */
  async streamAnswerWithHistory(
    messages: ConversationMessage[],
    systemContext: string,
    config: LLMConfig,
    onChunk: (chunk: LLMStreamChunk) => void,
    tokenCounter?: TokenCounter,
  ): Promise<LLMResponse> {
    const userSelectedModel = config.model;
    const actualModel = resolveModel(userSelectedModel);
    const didFallback = didModelFallback(userSelectedModel);

    // Pre-request context validation
    if (tokenCounter) {
      try {
        const fit = await validateContextFits(tokenCounter, messages, actualModel, {
          system: systemContext,
          maxOutputTokens: config.maxTokens || 4096,
        });
        if (!fit.fits) {
          console.warn(
            `[LLMService] Context overflow: ${fit.estimatedInputTokens} tokens ` +
            `exceeds ${fit.availableForInput} available (overflow: ${fit.overflowTokens})`
          );
        }
      } catch {
        // Ignore counter errors, proceed with API call
      }
    } else {
      const fit = validateContextFitsSync(messages, actualModel, {
        system: systemContext,
        maxOutputTokens: config.maxTokens || 4096,
      });
      if (!fit.fits) {
        console.warn(
          `[LLMService] Context overflow (estimate): ${fit.estimatedInputTokens} tokens ` +
          `exceeds ${fit.availableForInput} available (overflow: ${fit.overflowTokens})`
        );
      }
    }

    if (didFallback) {
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'model_fallback_used',
        mode: this.mode,
        stage: this.stage,
        payload: {
          requested_model: userSelectedModel,
          actual_model: actualModel,
          reason: 'unsupported_model',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
    }

    const toolStartEventId = this.generateId();
    await this.eventBus.publish({
      event_id: toolStartEventId,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode: this.mode,
      stage: this.stage,
      payload: {
        tool: 'llm_answer',
        model: actualModel,
        max_tokens: config.maxTokens || 4096,
        has_context: systemContext.length > 0,
        message_count: messages.length,
        multi_turn: messages.length > 1,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    try {
      const response = await this.callAnthropicStreamWithHistory(
        messages,
        systemContext,
        config.apiKey,
        actualModel,
        config.maxTokens || 4096,
        onChunk
      );

      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: this.stage,
        payload: {
          tool: 'llm_answer',
          status: 'success',
          model: actualModel,
          usage: response.usage,
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      return response;
    } catch (error) {
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: this.stage,
        payload: {
          tool: 'llm_answer',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      throw error;
    }
  }

  /**
   * Call Anthropic API with streaming, passing full conversation history.
   */
  private async callAnthropicStreamWithHistory(
    messages: ConversationMessage[],
    systemContext: string,
    apiKey: string,
    model: string,
    maxTokens: number,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMResponse> {
    const Anthropic = await this.loadAnthropicSDK();
    const client = new Anthropic({ apiKey });

    let fullContent = '';
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    const stream = await client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemContext,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          const delta = event.delta.text;
          fullContent += delta;

          await this.eventBus.publish({
            event_id: this.generateId(),
            task_id: this.taskId,
            timestamp: new Date().toISOString(),
            type: 'stream_delta',
            mode: this.mode,
            stage: this.stage,
            payload: { delta },
            evidence_ids: [],
            parent_event_id: null,
          });

          onChunk({ delta, done: false });
        }
      } else if (event.type === 'message_start') {
        if (event.message.usage) {
          usage = {
            input_tokens: event.message.usage.input_tokens,
            output_tokens: 0,
          };
        }
      } else if (event.type === 'message_delta') {
        if (event.usage && usage) {
          usage.output_tokens = event.usage.output_tokens;
        }
      }
    }

    await this.eventBus.publish({
      event_id: this.generateId(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'stream_complete',
      mode: this.mode,
      stage: this.stage,
      payload: {
        total_tokens: usage ? usage.input_tokens + usage.output_tokens : 0,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    onChunk({ delta: '', done: true });

    return { content: fullContent, model, usage };
  }

  /**
   * Call Anthropic API with streaming support and system context
   */
  private async callAnthropicStreamWithContext(
    userQuestion: string,
    systemContext: string,
    apiKey: string,
    model: string,
    maxTokens: number,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMResponse> {
    console.log('Step 2: callAnthropicStreamWithContext - Loading Anthropic SDK...');
    
    // Dynamic import to avoid bundling issues
    const Anthropic = await this.loadAnthropicSDK();
    console.log('Step 3: Anthropic SDK loaded successfully');
    
    console.log('Step 4: Creating Anthropic client...');
    const client = new Anthropic({
      apiKey: apiKey,
    });
    console.log('Step 5: Client created');

    let fullContent = '';
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    console.log('Step 6: Starting stream request to Anthropic API with context...');
    console.log('Request params:', { model, maxTokens, questionLength: userQuestion.length, contextLength: systemContext.length });
    
    const stream = await client.messages.stream({
      model: model,
      max_tokens: maxTokens,
      system: systemContext,  // Inject project context as system message
      messages: [
        {
          role: 'user',
          content: userQuestion,
        },
      ],
    });

    // Process streaming chunks
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          const delta = event.delta.text;
          fullContent += delta;
          
          // Emit stream_delta event
          await this.eventBus.publish({
            event_id: this.generateId(),
            task_id: this.taskId,
            timestamp: new Date().toISOString(),
            type: 'stream_delta',
            mode: this.mode,
            stage: this.stage,
            payload: {
              delta: delta,
            },
            evidence_ids: [],
            parent_event_id: null,
          });
          
          // Send chunk to UI
          onChunk({
            delta: delta,
            done: false,
          });
        }
      } else if (event.type === 'message_start') {
        // Capture initial usage stats
        if (event.message.usage) {
          usage = {
            input_tokens: event.message.usage.input_tokens,
            output_tokens: 0,
          };
        }
      } else if (event.type === 'message_delta') {
        // Update output token count
        if (event.usage && usage) {
          usage.output_tokens = event.usage.output_tokens;
        }
      }
    }

    // Emit stream_complete event
    await this.eventBus.publish({
      event_id: this.generateId(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'stream_complete',
      mode: this.mode,
      stage: this.stage,
      payload: {
        total_tokens: usage ? usage.input_tokens + usage.output_tokens : 0,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Signal completion
    onChunk({
      delta: '',
      done: true,
    });

    return {
      content: fullContent,
      model: model,
      usage: usage,
    };
  }

  /**
   * Call Anthropic API with streaming support
   */
  private async callAnthropicStream(
    userQuestion: string,
    apiKey: string,
    model: string,
    maxTokens: number,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMResponse> {
    console.log('Step 2: callAnthropicStream - Loading Anthropic SDK...');
    
    // Dynamic import to avoid bundling issues
    const Anthropic = await this.loadAnthropicSDK();
    console.log('Step 3: Anthropic SDK loaded successfully');
    
    console.log('Step 4: Creating Anthropic client...');
    const client = new Anthropic({
      apiKey: apiKey,
    });
    console.log('Step 5: Client created');

    let fullContent = '';
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    console.log('Step 6: Starting stream request to Anthropic API...');
    console.log('Request params:', { model, maxTokens, questionLength: userQuestion.length });
    
    const stream = await client.messages.stream({
      model: model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: userQuestion,
        },
      ],
    });

    // Process streaming chunks
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          const delta = event.delta.text;
          fullContent += delta;
          
          // Send chunk to UI
          onChunk({
            delta: delta,
            done: false,
          });
        }
      } else if (event.type === 'message_start') {
        // Capture initial usage stats
        if (event.message.usage) {
          usage = {
            input_tokens: event.message.usage.input_tokens,
            output_tokens: 0,
          };
        }
      } else if (event.type === 'message_delta') {
        // Update output token count
        if (event.usage && usage) {
          usage.output_tokens = event.usage.output_tokens;
        }
      }
    }

    // Signal completion
    onChunk({
      delta: '',
      done: true,
    });

    return {
      content: fullContent,
      model: model,
      usage: usage,
    };
  }

  /**
   * Dynamically load Anthropic SDK
   * This prevents bundling issues and allows the SDK to be optional
   */
  private async loadAnthropicSDK(): Promise<any> {
    try {
      // Try to require the SDK
      const anthropic = require('@anthropic-ai/sdk');
      return anthropic.default || anthropic;
    } catch (error) {
      throw new Error(
        'Anthropic SDK not installed. Please run: npm install @anthropic-ai/sdk'
      );
    }
  }

  /**
   * Generate edit patches for MISSION mode EDIT stage
   * Returns structured patches for file changes
   */
  async generateEditPatches(params: {
    stepText: string;
    repoContextSummary: string;
    files: Array<{ path: string; content: string }>;
    config: LLMConfig;
  }): Promise<{
    patches: Array<{
      path: string;
      action: 'update' | 'create' | 'delete';
      content?: string;
    }>;
  }> {
    const { stepText, repoContextSummary, files, config } = params;

    const userSelectedModel = config.model;
    const actualModel = resolveModel(userSelectedModel);

    // Build system prompt for edit generation
    const systemPrompt = `You are in MISSION EDIT stage. Your task is to generate file edits to accomplish the given step.

CRITICAL RULES:
- Output ONLY valid JSON, no markdown formatting, no explanations, no code blocks
- Return patches that fully replace file contents
- Use "update" for modifying existing files, "create" for new files, "delete" to remove files
- For update/create, the "content" field MUST be a STRING containing the FULL file content
- DO NOT nest the content in an object - it must be a flat string with properly escaped quotes and newlines
- For delete, omit the "content" field
- Escape all special characters in content strings: use \\n for newlines, \\" for quotes, \\\\ for backslashes

OUTPUT SCHEMA (strict JSON only):
{
  "patches": [
    { "path": "relative/path/to/file", "action": "update", "content": "full file content as a STRING with escaped newlines \\n and quotes \\"" },
    { "path": "another/file", "action": "create", "content": "full new file content as a STRING" },
    { "path": "old/file", "action": "delete" }
  ]
}

IMPORTANT: The "content" field must be a STRING, NOT an object or array. It should contain the raw file content with proper JSON string escaping.

Repository Context:
${repoContextSummary}

Current Files to Edit:
${files.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}`;

    const userPrompt = `Step to implement: ${stepText}

Generate the necessary file changes to complete this step. Output ONLY the JSON object with patches array.`;

    // Emit tool_start
    const toolStartEventId = this.generateId();
    await this.eventBus.publish({
      event_id: toolStartEventId,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode: this.mode,
      stage: this.stage,
      payload: {
        tool: 'llm_edit',
        model: actualModel,
        max_tokens: config.maxTokens || 4096,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    try {
      // Call Anthropic API (non-streaming for structured output)
      const response = await this.callAnthropicForEdit(
        userPrompt,
        systemPrompt,
        config.apiKey,
        actualModel,
        config.maxTokens || 4096
      );

      // Parse JSON response with robust extraction
      let patches;
      try {
        patches = this.extractPatchesFromResponse(response.content);

        if (!Array.isArray(patches)) {
          throw new Error('Response does not contain patches array');
        }
      } catch (parseError) {
        // Retry once with corrective prompt
        console.warn('[LLMService] First parse failed, retrying with corrective prompt');
        console.warn('[LLMService] Parse error:', parseError);
        console.warn('[LLMService] Response preview:', response.content.substring(0, 500));
        
        const retryPrompt = `The previous response was not valid JSON. Please provide ONLY a JSON object with this exact structure, no markdown formatting, no code blocks, no explanations:

{ "patches": [ { "path": "file.ts", "action": "update", "content": "..." } ] }

CRITICAL: Ensure all string content is properly escaped. Use double quotes for JSON strings, escape backslashes and quotes inside content.

Step to implement: ${stepText}`;

        const retryResponse = await this.callAnthropicForEdit(
          retryPrompt,
          systemPrompt,
          config.apiKey,
          actualModel,
          config.maxTokens || 8192 // Increase tokens for retry
        );

        try {
          patches = this.extractPatchesFromResponse(retryResponse.content);

          if (!Array.isArray(patches)) {
            throw new Error('Retry response does not contain patches array');
          }
        } catch (retryParseError) {
          // Both attempts failed - log full response for debugging
          console.error('[LLMService] Failed to parse after retry');
          console.error('[LLMService] Original response:', response.content);
          console.error('[LLMService] Retry response:', retryResponse.content);
          
          throw new Error(
            `Failed to parse LLM response as JSON after retry: ${retryParseError instanceof Error ? retryParseError.message : String(retryParseError)}`
          );
        }
      }

      // Emit tool_end with success
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: this.stage,
        payload: {
          tool: 'llm_edit',
          status: 'success',
          model: actualModel,
          patches_count: patches.length,
          usage: response.usage,
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      return { patches };
    } catch (error) {
      // Emit tool_end with failure
      await this.eventBus.publish({
        event_id: this.generateId(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode: this.mode,
        stage: this.stage,
        payload: {
          tool: 'llm_edit',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        evidence_ids: [],
        parent_event_id: toolStartEventId,
      });

      throw error;
    }
  }

  /**
   * Call Anthropic API for edit generation (non-streaming)
   */
  private async callAnthropicForEdit(
    userPrompt: string,
    systemPrompt: string,
    apiKey: string,
    model: string,
    maxTokens: number
  ): Promise<LLMResponse> {
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

    return {
      content,
      model: model,
      usage: response.usage ? {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      } : undefined,
    };
  }

  /**
   * Extract patches from LLM response with robust JSON extraction
   * Uses safeJsonParse for handling malformed LLM JSON output
   */
  private extractPatchesFromResponse(content: string): any[] {
    // Use robust JSON repair utility
    const parseResult = safeJsonParse(content);
    
    if (!parseResult.success || !parseResult.data) {
      console.error('[LLMService] JSON parse failed:', parseResult.error);
      console.error('[LLMService] Repairs attempted:', parseResult.repairs);
      throw new Error(parseResult.error || 'Failed to parse JSON');
    }
    
    // Log successful repairs for debugging
    if (parseResult.repairs && parseResult.repairs.length > 0) {
      console.log('[LLMService] JSON repairs applied:', parseResult.repairs);
    }

    // Extract patches array
    if (parseResult.data.patches && Array.isArray(parseResult.data.patches)) {
      return parseResult.data.patches;
    }

    throw new Error('No patches array found in response');
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}
