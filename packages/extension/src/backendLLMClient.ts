import type {
  LLMClient,
  LLMClientCapabilities,
  LLMClientResponse,
  ConversationMessage,
  ToolSchema,
  ToolChoice,
} from 'core';
import { getMaxOutputTokens, getContextWindow } from 'core';
import type { BackendClient } from './backendClient';

export class BackendLLMClient implements LLMClient {
  public readonly capabilities: LLMClientCapabilities;

  constructor(
    private readonly backend: BackendClient,
    modelId?: string,
  ) {
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
    tool_choice?: ToolChoice;
  }): Promise<LLMClientResponse> {
    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages,
    };

    if (params.system) body.system = params.system;
    if (params.tools?.length) body.tools = params.tools;
    if (params.tool_choice) body.tool_choice = params.tool_choice;

    const response = await this.backend.request<any>('POST', '/api/llm/messages', body);

    const content: LLMClientResponse['content'] = [];
    for (const block of response.content || []) {
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
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  }

  async createMessageStream(params: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: ConversationMessage[];
    tools?: ToolSchema[];
    tool_choice?: ToolChoice;
    onDelta: (delta: string) => void;
  }): Promise<LLMClientResponse> {
    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages,
    };

    if (params.system) body.system = params.system;
    if (params.tools?.length) body.tools = params.tools;
    if (params.tool_choice) body.tool_choice = params.tool_choice;

    const contentBlocks: LLMClientResponse['content'] = [];
    let currentTextBlock = '';
    let currentTextIndex = -1;
    let responseId = '';
    let stopReason = 'end_turn';
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    await this.backend.requestStream('POST', '/api/llm/messages/stream', body, (eventType, data) => {
      if (data.type === 'message_start') {
        responseId = data.message?.id || '';
        if (data.message?.usage) {
          usage = { input_tokens: data.message.usage.input_tokens, output_tokens: 0 };
        }
      } else if (data.type === 'content_block_start') {
        if (data.content_block?.type === 'text') {
          currentTextIndex = data.index;
          currentTextBlock = '';
        } else if (data.content_block?.type === 'tool_use') {
          contentBlocks.push({
            type: 'tool_use',
            id: data.content_block.id,
            name: data.content_block.name,
            input: {} as Record<string, unknown>,
          });
        }
      } else if (data.type === 'content_block_delta') {
        if (data.delta?.type === 'text_delta') {
          currentTextBlock += data.delta.text;
          params.onDelta(data.delta.text);
        } else if (data.delta?.type === 'input_json_delta') {
          const lastBlock = contentBlocks[contentBlocks.length - 1];
          if (lastBlock?.type === 'tool_use') {
            (lastBlock as any)._rawInput = ((lastBlock as any)._rawInput || '') + data.delta.partial_json;
          }
        }
      } else if (data.type === 'content_block_stop') {
        if (currentTextIndex >= 0 && currentTextBlock) {
          contentBlocks.push({ type: 'text', text: currentTextBlock });
          currentTextIndex = -1;
          currentTextBlock = '';
        }
        const lastBlock = contentBlocks[contentBlocks.length - 1];
        if (lastBlock?.type === 'tool_use' && (lastBlock as any)._rawInput) {
          try {
            lastBlock.input = JSON.parse((lastBlock as any)._rawInput);
          } catch {
            lastBlock.input = {};
          }
          delete (lastBlock as any)._rawInput;
        }
      } else if (data.type === 'message_delta') {
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        if (data.usage && usage) usage.output_tokens = data.usage.output_tokens;
      }
    });

    return {
      id: responseId,
      content: contentBlocks,
      stop_reason: stopReason,
      usage,
    };
  }
}
