/**
 * AnthropicLLMClient — Adapter wrapping the Anthropic SDK for AgenticLoop (A3 wiring)
 *
 * Implements the LLMClient interface from core's agenticLoop.ts so the
 * AgenticLoop can call the Anthropic Messages API.  Lives in the extension
 * package because it needs the SDK (dynamic import) and the API key.
 */

import type {
  LLMClient,
  LLMClientCapabilities,
  LLMClientResponse,
  ConversationMessage,
  ToolSchema,
} from 'core';
import { getMaxOutputTokens, getContextWindow } from 'core';

export class AnthropicLLMClient implements LLMClient {
  private readonly apiKey: string;
  public readonly capabilities: LLMClientCapabilities;

  constructor(apiKey: string, modelId?: string) {
    this.apiKey = apiKey;
    this.capabilities = {
      maxOutputTokens: modelId ? getMaxOutputTokens(modelId) : 8192,
      contextWindow: modelId ? getContextWindow(modelId) : 200_000,
      provider: 'anthropic',
    };
  }

  async createMessage(params: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: ConversationMessage[];
    tools?: ToolSchema[];
  }): Promise<LLMClientResponse> {
    const Anthropic = await this.loadSDK();
    const client = new Anthropic({ apiKey: this.apiKey });

    // Build Anthropic-compatible request
    const request: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages,
    };

    if (params.system) {
      request.system = params.system;
    }

    if (params.tools && params.tools.length > 0) {
      request.tools = params.tools;
    }

    let response: any;
    try {
      response = await client.messages.create(request);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AnthropicLLMClient] create() failed:', msg);
      console.error('[AnthropicLLMClient] Request params:', {
        model: params.model,
        max_tokens: params.max_tokens,
        hasSystem: !!params.system,
        messageCount: params.messages?.length,
        toolCount: params.tools?.length,
      });
      throw new Error(`Anthropic API error: ${msg}`);
    }

    // Map response to LLMClientResponse
    const content: LLMClientResponse['content'] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      id: response.id,
      content,
      stop_reason: response.stop_reason || 'end_turn',
      usage: response.usage
        ? {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          }
        : undefined,
    };
  }

  /**
   * A6: Streaming variant — calls onDelta for each text chunk, returns full response.
   */
  async createMessageStream(params: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: import('core').ConversationMessage[];
    tools?: import('core').ToolSchema[];
    onDelta: (delta: string) => void;
  }): Promise<LLMClientResponse> {
    const Anthropic = await this.loadSDK();
    const client = new Anthropic({ apiKey: this.apiKey });

    const request: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages,
    };

    if (params.system) {
      request.system = params.system;
    }
    if (params.tools && params.tools.length > 0) {
      request.tools = params.tools;
    }

    let stream: any;
    try {
      stream = await client.messages.stream(request);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AnthropicLLMClient] stream() call failed:', msg);
      console.error('[AnthropicLLMClient] Request params:', {
        model: params.model,
        max_tokens: params.max_tokens,
        hasSystem: !!params.system,
        messageCount: params.messages?.length,
        toolCount: params.tools?.length,
        toolNames: params.tools?.map(t => t.name),
      });
      throw new Error(`Anthropic API stream error: ${msg}`);
    }

    // Accumulate the full response while streaming deltas
    const contentBlocks: LLMClientResponse['content'] = [];
    let currentTextBlock = '';
    let currentTextIndex = -1;
    let responseId = '';
    let stopReason = 'end_turn';
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    try {
      for await (const event of stream) {
        if (event.type === 'message_start') {
          responseId = event.message.id;
          if (event.message.usage) {
            usage = {
              input_tokens: event.message.usage.input_tokens,
              output_tokens: 0,
            };
          }
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            currentTextIndex = event.index;
            currentTextBlock = '';
          } else if (event.content_block.type === 'tool_use') {
            contentBlocks.push({
              type: 'tool_use',
              id: event.content_block.id,
              name: event.content_block.name,
              input: {} as Record<string, unknown>,
            });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            currentTextBlock += event.delta.text;
            params.onDelta(event.delta.text);
          } else if (event.delta.type === 'input_json_delta') {
            // Accumulate tool input JSON (streamed incrementally)
            const lastBlock = contentBlocks[contentBlocks.length - 1];
            if (lastBlock && lastBlock.type === 'tool_use') {
              // We'll parse the full JSON at content_block_stop
              (lastBlock as any)._rawInput = ((lastBlock as any)._rawInput || '') + event.delta.partial_json;
            }
          }
        } else if (event.type === 'content_block_stop') {
          if (currentTextIndex >= 0 && currentTextBlock) {
            contentBlocks.push({ type: 'text', text: currentTextBlock });
            currentTextIndex = -1;
            currentTextBlock = '';
          }
          // Parse accumulated tool input JSON
          const lastBlock = contentBlocks[contentBlocks.length - 1];
          if (lastBlock && lastBlock.type === 'tool_use' && (lastBlock as any)._rawInput) {
            try {
              lastBlock.input = JSON.parse((lastBlock as any)._rawInput);
            } catch {
              lastBlock.input = {};
            }
            delete (lastBlock as any)._rawInput;
          }
        } else if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason;
          }
          if (event.usage && usage) {
            usage.output_tokens = event.usage.output_tokens;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AnthropicLLMClient] Stream iteration error:', msg);
      throw new Error(`Anthropic API stream error during iteration: ${msg}`);
    }

    return {
      id: responseId,
      content: contentBlocks,
      stop_reason: stopReason,
      usage,
    };
  }

  private async loadSDK(): Promise<any> {
    try {
      const anthropic = require('@anthropic-ai/sdk');
      return anthropic.default || anthropic;
    } catch {
      throw new Error(
        'Anthropic SDK not installed. Please run: npm install @anthropic-ai/sdk',
      );
    }
  }
}
