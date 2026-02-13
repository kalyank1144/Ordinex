/**
 * AnthropicLLMClient — Adapter wrapping the Anthropic SDK for AgenticLoop (A3 wiring)
 *
 * Implements the LLMClient interface from core's agenticLoop.ts so the
 * AgenticLoop can call the Anthropic Messages API.  Lives in the extension
 * package because it needs the SDK (dynamic import) and the API key.
 */

import type {
  LLMClient,
  LLMClientResponse,
  ConversationMessage,
  ToolSchema,
} from 'core';

export class AnthropicLLMClient implements LLMClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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

    const response = await client.messages.create(request);

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
