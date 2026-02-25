/**
 * A8: AnthropicLLMClient Tests
 *
 * Tests the LLM client adapter by mocking the internal loadSDK method.
 * This avoids the dynamic require() issue with vitest module mocking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicLLMClient } from '../anthropicLLMClient';

const mockCreate = vi.fn();
const mockStream = vi.fn();

function createClientWithMockSDK(apiKey = 'test-key', modelId?: string): AnthropicLLMClient {
  const client = new AnthropicLLMClient(apiKey, modelId);
  // Override the private loadSDK method to return our mock
  (client as any).loadSDK = vi.fn().mockResolvedValue(
    class MockAnthropic {
      messages = { create: mockCreate, stream: mockStream };
      constructor(_opts: any) {}
    },
  );
  return client;
}

describe('AnthropicLLMClient', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  describe('constructor', () => {
    it('sets capabilities with default values when no modelId', () => {
      const client = new AnthropicLLMClient('test-key');
      expect(client.capabilities.maxOutputTokens).toBe(8192);
      expect(client.capabilities.contextWindow).toBe(200_000);
      expect(client.capabilities.provider).toBe('anthropic');
    });

    it('resolves capabilities from modelId when provided', () => {
      const client = new AnthropicLLMClient('test-key', 'claude-sonnet-4-20250514');
      expect(client.capabilities.provider).toBe('anthropic');
      expect(client.capabilities.maxOutputTokens).toBeGreaterThan(0);
      expect(client.capabilities.contextWindow).toBeGreaterThan(0);
    });
  });

  describe('createMessage', () => {
    it('builds request with required fields and maps response', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg-123',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const client = createClientWithMockSDK();
      const response = await client.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      const req = mockCreate.mock.calls[0][0];
      expect(req.model).toBe('claude-sonnet-4-20250514');
      expect(req.max_tokens).toBe(1024);
      expect(req.messages).toEqual([{ role: 'user', content: 'Hi' }]);

      expect(response.id).toBe('msg-123');
      expect(response.content).toEqual([{ type: 'text', text: 'Hello' }]);
      expect(response.stop_reason).toBe('end_turn');
      expect(response.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    });

    it('includes system prompt when provided', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg-1',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      });

      const client = createClientWithMockSDK();
      await client.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(mockCreate.mock.calls[0][0].system).toBe('You are helpful');
    });

    it('includes tools when provided', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg-1',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      });

      const tools = [{
        name: 'test_tool',
        description: 'A test tool',
        input_schema: { type: 'object' as const, properties: {}, required: [] },
      }];

      const client = createClientWithMockSDK();
      await client.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
        tools,
      });

      expect(mockCreate.mock.calls[0][0].tools).toEqual(tools);
    });

    it('forwards tool_choice when provided', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg-1',
        content: [{
          type: 'tool_use',
          id: 'tc-1',
          name: 'classify',
          input: { intent: 'SCAFFOLD' },
        }],
        stop_reason: 'tool_use',
      });

      const client = createClientWithMockSDK();
      const response = await client.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
        tools: [{
          name: 'classify',
          description: 'classify intent',
          strict: true,
          input_schema: { type: 'object' as const, properties: {}, required: [] },
        }],
        tool_choice: { type: 'tool', name: 'classify' },
      });

      expect(mockCreate.mock.calls[0][0].tool_choice).toEqual({ type: 'tool', name: 'classify' });
      expect(response.content[0].type).toBe('tool_use');
      if (response.content[0].type === 'tool_use') {
        expect(response.content[0].name).toBe('classify');
        expect(response.content[0].input).toEqual({ intent: 'SCAFFOLD' });
      }
    });

    it('maps tool_use blocks in response', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg-1',
        content: [
          { type: 'text', text: 'Let me help' },
          { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'src/index.ts' } },
        ],
        stop_reason: 'tool_use',
      });

      const client = createClientWithMockSDK();
      const response = await client.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(response.content).toHaveLength(2);
      expect(response.content[0]).toEqual({ type: 'text', text: 'Let me help' });
      expect(response.content[1]).toEqual({
        type: 'tool_use',
        id: 'tu-1',
        name: 'read_file',
        input: { path: 'src/index.ts' },
      });
    });

    it('throws on API error with descriptive message', async () => {
      mockCreate.mockRejectedValue(new Error('Rate limit exceeded'));

      const client = createClientWithMockSDK();
      await expect(
        client.createMessage({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'test' }],
        }),
      ).rejects.toThrow('Anthropic API error: Rate limit exceeded');
    });

    it('omits system and tools from request when not provided', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg-1',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      });

      const client = createClientWithMockSDK();
      await client.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      });

      const req = mockCreate.mock.calls[0][0];
      expect(req.system).toBeUndefined();
      expect(req.tools).toBeUndefined();
      expect(req.tool_choice).toBeUndefined();
    });

    it('handles missing usage in response', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg-1',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      });

      const client = createClientWithMockSDK();
      const response = await client.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(response.usage).toBeUndefined();
    });

    it('handles missing stop_reason in response (defaults to end_turn)', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg-1',
        content: [{ type: 'text', text: 'ok' }],
      });

      const client = createClientWithMockSDK();
      const response = await client.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(response.stop_reason).toBe('end_turn');
    });

    it('handles non-Error thrown objects', async () => {
      mockCreate.mockRejectedValue('string error');

      const client = createClientWithMockSDK();
      await expect(
        client.createMessage({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'test' }],
        }),
      ).rejects.toThrow('Anthropic API error: string error');
    });
  });
});
