/**
 * Anthropic Token Counter — real API-based token counting (Task #5)
 *
 * Wraps the Anthropic SDK's countTokens() endpoint to get exact token counts.
 * Used by the extension when an API key is available.
 */

import type { TokenCounter, TokenCountResult } from 'core/src/tokenCounter';
import type { ConversationMessage } from 'core/src/conversationHistory';
import type { ToolSchema } from 'core/src/toolSchemas';

/**
 * Token counter that uses the Anthropic API for exact token counts.
 */
export class AnthropicTokenCounter implements TokenCounter {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async countTokens(params: {
    messages: ConversationMessage[];
    system?: string;
    tools?: ToolSchema[];
    model: string;
  }): Promise<TokenCountResult> {
    const Anthropic = this.loadAnthropicSDK();
    const client = new Anthropic({ apiKey: this.apiKey });

    const requestParams: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
    };

    if (params.system) {
      requestParams.system = params.system;
    }

    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools;
    }

    const result = await client.messages.countTokens(requestParams as any);

    return {
      inputTokens: result.input_tokens,
      isEstimate: false,
    };
  }

  private loadAnthropicSDK(): any {
    try {
      const anthropic = require('@anthropic-ai/sdk');
      return anthropic.default || anthropic;
    } catch {
      throw new Error(
        'Anthropic SDK not installed. Please run: npm install @anthropic-ai/sdk'
      );
    }
  }
}
