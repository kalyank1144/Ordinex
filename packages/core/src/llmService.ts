/**
 * LLM Service for ANSWER mode
 * Provides streaming LLM integration with support for Anthropic Claude API
 * 
 * V1: Single provider (Anthropic)
 * Future: Multi-provider support
 */

import { EventBus } from './eventBus';
import { Mode, Stage, Evidence } from './types';

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
 * Model fallback map
 * Maps user-selected model IDs to actual Anthropic model names
 */
const MODEL_MAP: Record<string, string> = {
  'claude-3-haiku': 'claude-3-haiku-20240307',  // Most widely available
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-opus': 'claude-3-opus-20240229',
  'sonnet-4.5': 'claude-3-haiku-20240307',  // Fallback to Haiku
  'opus-4.5': 'claude-3-haiku-20240307',
  'gpt-5.2': 'claude-3-haiku-20240307',
  'gemini-3': 'claude-3-haiku-20240307',
};

const DEFAULT_MODEL = 'claude-3-haiku-20240307';

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
    const actualModel = MODEL_MAP[userSelectedModel] || DEFAULT_MODEL;
    const didFallback = !MODEL_MAP[userSelectedModel];
    
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
    const actualModel = MODEL_MAP[userSelectedModel] || DEFAULT_MODEL;
    const didFallback = !MODEL_MAP[userSelectedModel];
    
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

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}
