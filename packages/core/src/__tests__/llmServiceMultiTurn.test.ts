/**
 * Tests for LLMService.streamAnswerWithHistory (A2 multi-turn wiring)
 *
 * Since the Anthropic SDK is not available in tests, we mock loadAnthropicSDK
 * on the prototype to return a fake constructor that yields controllable streams.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventStore } from '../eventStore';
import { EventBus } from '../eventBus';
import { LLMService, LLMConfig, LLMStreamChunk, LLMResponse } from '../llmService';
import { ConversationMessage } from '../conversationHistory';
import { Event } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock async-iterable stream yielding the given events */
function makeMockStream(events: Array<Record<string, any>>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/** Convenience: standard stream that produces "Hello world" in two chunks */
function helloWorldStream() {
  return makeMockStream([
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
    { type: 'message_delta', usage: { output_tokens: 5 } },
  ]);
}

/** Wire the mock Anthropic SDK onto an LLMService instance */
function wireAnthropicMock(
  llmService: LLMService,
  mockStream: ReturnType<typeof makeMockStream>,
) {
  const streamFn = vi.fn().mockResolvedValue(mockStream);
  const mockClient = { messages: { stream: streamFn } };

  // Override the private loadAnthropicSDK method
  (llmService as any).loadAnthropicSDK = vi.fn().mockResolvedValue(
    function MockAnthropic() {
      return mockClient;
    },
  );

  return { mockClient, streamFn };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('LLMService.streamAnswerWithHistory', () => {
  let testDir: string;
  let eventStore: EventStore;
  let eventBus: EventBus;
  let llmService: LLMService;
  let config: LLMConfig;
  let collectedEvents: Event[];
  let unsubscribe: () => void;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-llm-mt-'));
    eventStore = new EventStore(path.join(testDir, 'events.jsonl'));
    eventBus = new EventBus(eventStore);
    llmService = new LLMService('task_mt_1', eventBus, 'ANSWER', 'none');
    config = { apiKey: 'test-key', model: 'sonnet', maxTokens: 1024 };

    // Capture all events published on the bus
    collectedEvents = [];
    unsubscribe = eventBus.subscribe((event: Event) => {
      collectedEvents.push(event);
    });
  });

  afterEach(() => {
    unsubscribe();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // 1. Full message array is passed through to the API
  // -----------------------------------------------------------------------

  describe('passes full message array to Anthropic API', () => {
    it('sends multi-turn messages array in the API call', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What is TypeScript?' },
        { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
        { role: 'user', content: 'How do I use generics?' },
      ];

      const stream = helloWorldStream();
      const { streamFn } = wireAnthropicMock(llmService, stream);
      const onChunk = vi.fn();

      await llmService.streamAnswerWithHistory(messages, 'You are a coding assistant.', config, onChunk);

      // Verify the API was called with the full messages array
      expect(streamFn).toHaveBeenCalledTimes(1);
      const callArgs = streamFn.mock.calls[0][0];
      expect(callArgs.messages).toEqual(messages);
      expect(callArgs.messages).toHaveLength(3);
      expect(callArgs.system).toBe('You are a coding assistant.');
    });

    it('sends a single message when only one message is provided', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const stream = helloWorldStream();
      const { streamFn } = wireAnthropicMock(llmService, stream);
      const onChunk = vi.fn();

      await llmService.streamAnswerWithHistory(messages, '', config, onChunk);

      const callArgs = streamFn.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe('user');
      expect(callArgs.messages[0].content).toBe('Hello');
    });
  });

  // -----------------------------------------------------------------------
  // 2. Streaming chunks via onChunk callback
  // -----------------------------------------------------------------------

  describe('streams chunks via onChunk callback', () => {
    it('calls onChunk for each text delta and a final done signal', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'test' },
      ];

      const stream = helloWorldStream();
      wireAnthropicMock(llmService, stream);
      const onChunk = vi.fn();

      await llmService.streamAnswerWithHistory(messages, '', config, onChunk);

      // Should have 3 calls: "Hello", " world", and done
      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onChunk).toHaveBeenNthCalledWith(1, { delta: 'Hello', done: false });
      expect(onChunk).toHaveBeenNthCalledWith(2, { delta: ' world', done: false });
      expect(onChunk).toHaveBeenNthCalledWith(3, { delta: '', done: true });
    });

    it('accumulates full content in the returned response', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'test' },
      ];

      wireAnthropicMock(llmService, helloWorldStream());

      const result = await llmService.streamAnswerWithHistory(messages, '', config, vi.fn());

      expect(result.content).toBe('Hello world');
    });
  });

  // -----------------------------------------------------------------------
  // 3. Event emission: tool_start, stream_delta, stream_complete, tool_end
  // -----------------------------------------------------------------------

  describe('emits correct event sequence', () => {
    it('emits tool_start, stream_delta(s), stream_complete, tool_end on success', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'test' },
      ];

      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(messages, 'ctx', config, vi.fn());

      const eventTypes = collectedEvents.map(e => e.type);

      // tool_start should come first
      expect(eventTypes[0]).toBe('tool_start');

      // stream_delta events for each text chunk
      const deltas = collectedEvents.filter(e => e.type === 'stream_delta');
      expect(deltas).toHaveLength(2);
      expect(deltas[0].payload.delta).toBe('Hello');
      expect(deltas[1].payload.delta).toBe(' world');

      // stream_complete after all deltas
      const completeEvents = collectedEvents.filter(e => e.type === 'stream_complete');
      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].payload.total_tokens).toBe(15); // 10 input + 5 output

      // tool_end is the last event
      const lastEvent = collectedEvents[collectedEvents.length - 1];
      expect(lastEvent.type).toBe('tool_end');
      expect(lastEvent.payload.tool).toBe('llm_answer');
      expect(lastEvent.payload.status).toBe('success');
    });

    it('tool_start contains llm_answer tool marker', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], 'ctx', config, vi.fn(),
      );

      const toolStart = collectedEvents.find(e => e.type === 'tool_start');
      expect(toolStart).toBeDefined();
      expect(toolStart!.payload.tool).toBe('llm_answer');
    });

    it('tool_end references correct parent_event_id from tool_start', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], 'ctx', config, vi.fn(),
      );

      const toolStart = collectedEvents.find(e => e.type === 'tool_start')!;
      const toolEnd = collectedEvents.find(e => e.type === 'tool_end')!;
      expect(toolEnd.parent_event_id).toBe(toolStart.event_id);
    });

    it('all events share the same task_id, mode, and stage', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, vi.fn(),
      );

      for (const event of collectedEvents) {
        expect(event.task_id).toBe('task_mt_1');
        expect(event.mode).toBe('ANSWER');
        expect(event.stage).toBe('none');
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. Multi-turn flag in tool_start payload
  // -----------------------------------------------------------------------

  describe('multi_turn flag in tool_start payload', () => {
    it('sets multi_turn: true when messages.length > 1', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ];

      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(messages, '', config, vi.fn());

      const toolStart = collectedEvents.find(e => e.type === 'tool_start')!;
      expect(toolStart.payload.multi_turn).toBe(true);
      expect(toolStart.payload.message_count).toBe(3);
    });

    it('sets multi_turn: false when messages.length === 1', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'solo question' },
      ];

      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(messages, '', config, vi.fn());

      const toolStart = collectedEvents.find(e => e.type === 'tool_start')!;
      expect(toolStart.payload.multi_turn).toBe(false);
      expect(toolStart.payload.message_count).toBe(1);
    });

    it('sets has_context based on systemContext length', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], 'Some context', config, vi.fn(),
      );

      const toolStart = collectedEvents.find(e => e.type === 'tool_start')!;
      expect(toolStart.payload.has_context).toBe(true);
    });

    it('sets has_context: false when systemContext is empty', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, vi.fn(),
      );

      const toolStart = collectedEvents.find(e => e.type === 'tool_start')!;
      expect(toolStart.payload.has_context).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Model resolution and fallback
  // -----------------------------------------------------------------------

  describe('model resolution and fallback', () => {
    it('resolves known alias to canonical model ID', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      const result = await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }],
        '',
        { apiKey: 'k', model: 'sonnet', maxTokens: 512 },
        vi.fn(),
      );

      // 'sonnet' maps to claude-sonnet-4-5-20250929 in the current MODEL_MAP
      expect(result.model).toMatch(/^claude-sonnet-4-5-\d{8}$/);
    });

    it('emits model_fallback_used when model is unknown', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }],
        '',
        { apiKey: 'k', model: 'unknown-model-xyz' },
        vi.fn(),
      );

      const fallbackEvents = collectedEvents.filter(e => e.type === 'model_fallback_used');
      expect(fallbackEvents).toHaveLength(1);
      expect(fallbackEvents[0].payload.requested_model).toBe('unknown-model-xyz');
      expect(fallbackEvents[0].payload.reason).toBe('unsupported_model');
    });

    it('does NOT emit model_fallback_used for a known model', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }],
        '',
        { apiKey: 'k', model: 'haiku' },
        vi.fn(),
      );

      const fallbackEvents = collectedEvents.filter(e => e.type === 'model_fallback_used');
      expect(fallbackEvents).toHaveLength(0);
    });

    it('does NOT emit model_fallback_used for a fully-qualified ID', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }],
        '',
        { apiKey: 'k', model: 'claude-sonnet-4-20250514' },
        vi.fn(),
      );

      const fallbackEvents = collectedEvents.filter(e => e.type === 'model_fallback_used');
      expect(fallbackEvents).toHaveLength(0);
    });

    it('passes resolved model to the API, not the alias', async () => {
      const { streamFn } = wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }],
        '',
        { apiKey: 'k', model: 'haiku' },
        vi.fn(),
      );

      const callArgs = streamFn.mock.calls[0][0];
      expect(callArgs.model).toMatch(/^claude-haiku-4-5-\d{8}$/);
      expect(callArgs.model).not.toBe('haiku');
    });
  });

  // -----------------------------------------------------------------------
  // 6. Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('emits tool_end with status=failed and re-throws on stream error', async () => {
      const failingStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { usage: { input_tokens: 5 } } };
          throw new Error('Connection lost');
        },
      };

      wireAnthropicMock(llmService, failingStream as any);

      await expect(
        llmService.streamAnswerWithHistory(
          [{ role: 'user', content: 'q' }], '', config, vi.fn(),
        ),
      ).rejects.toThrow('Connection lost');

      const toolEnd = collectedEvents.find(e => e.type === 'tool_end');
      expect(toolEnd).toBeDefined();
      expect(toolEnd!.payload.status).toBe('failed');
      expect(toolEnd!.payload.error).toBe('Connection lost');
    });

    it('emits tool_end with status=failed when SDK load fails', async () => {
      (llmService as any).loadAnthropicSDK = vi.fn().mockRejectedValue(
        new Error('Anthropic SDK not installed'),
      );

      await expect(
        llmService.streamAnswerWithHistory(
          [{ role: 'user', content: 'q' }], '', config, vi.fn(),
        ),
      ).rejects.toThrow('Anthropic SDK not installed');

      const toolEnd = collectedEvents.find(e => e.type === 'tool_end');
      expect(toolEnd).toBeDefined();
      expect(toolEnd!.payload.status).toBe('failed');
      expect(toolEnd!.payload.error).toBe('Anthropic SDK not installed');
    });

    it('emits tool_end with status=failed for non-Error throws', async () => {
      const failingStream = {
        async *[Symbol.asyncIterator]() {
          throw 'string error';
        },
      };

      wireAnthropicMock(llmService, failingStream as any);

      await expect(
        llmService.streamAnswerWithHistory(
          [{ role: 'user', content: 'q' }], '', config, vi.fn(),
        ),
      ).rejects.toThrow();

      const toolEnd = collectedEvents.find(e => e.type === 'tool_end');
      expect(toolEnd).toBeDefined();
      expect(toolEnd!.payload.status).toBe('failed');
    });
  });

  // -----------------------------------------------------------------------
  // 7. Usage tracking
  // -----------------------------------------------------------------------

  describe('usage tracking', () => {
    it('returns usage with input_tokens and output_tokens', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      const result = await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, vi.fn(),
      );

      expect(result.usage).toBeDefined();
      expect(result.usage!.input_tokens).toBe(10);
      expect(result.usage!.output_tokens).toBe(5);
    });

    it('tool_end payload includes usage stats', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, vi.fn(),
      );

      const toolEnd = collectedEvents.find(e => e.type === 'tool_end')!;
      expect(toolEnd.payload.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5,
      });
    });

    it('stream_complete reports total_tokens as sum of input + output', async () => {
      wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, vi.fn(),
      );

      const complete = collectedEvents.find(e => e.type === 'stream_complete')!;
      expect(complete.payload.total_tokens).toBe(15);
    });

    it('handles stream with no usage data gracefully', async () => {
      const noUsageStream = makeMockStream([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
      ]);

      wireAnthropicMock(llmService, noUsageStream);
      const result = await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, vi.fn(),
      );

      // Content should still work
      expect(result.content).toBe('ok');
      // Usage undefined when no message_start
      expect(result.usage).toBeUndefined();

      // stream_complete total_tokens = 0 when no usage
      const complete = collectedEvents.find(e => e.type === 'stream_complete')!;
      expect(complete.payload.total_tokens).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Config handling
  // -----------------------------------------------------------------------

  describe('config handling', () => {
    it('uses default maxTokens of 4096 when not specified', async () => {
      const { streamFn } = wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }],
        '',
        { apiKey: 'k', model: 'haiku' },  // no maxTokens
        vi.fn(),
      );

      const callArgs = streamFn.mock.calls[0][0];
      expect(callArgs.max_tokens).toBe(4096);

      const toolStart = collectedEvents.find(e => e.type === 'tool_start')!;
      expect(toolStart.payload.max_tokens).toBe(4096);
    });

    it('passes custom maxTokens through to API and tool_start event', async () => {
      const { streamFn } = wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }],
        '',
        { apiKey: 'k', model: 'haiku', maxTokens: 8192 },
        vi.fn(),
      );

      const callArgs = streamFn.mock.calls[0][0];
      expect(callArgs.max_tokens).toBe(8192);

      const toolStart = collectedEvents.find(e => e.type === 'tool_start')!;
      expect(toolStart.payload.max_tokens).toBe(8192);
    });

    it('passes systemContext as system param to API', async () => {
      const { streamFn } = wireAnthropicMock(llmService, helloWorldStream());
      const systemContext = 'You are a helpful coding assistant for a TypeScript project.';

      await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }],
        systemContext,
        config,
        vi.fn(),
      );

      const callArgs = streamFn.mock.calls[0][0];
      expect(callArgs.system).toBe(systemContext);
    });
  });

  // -----------------------------------------------------------------------
  // 9. ContentBlock messages (tool_use / tool_result)
  // -----------------------------------------------------------------------

  describe('ContentBlock messages', () => {
    it('passes tool_use and tool_result blocks through to API', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Read the file package.json' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me read that file.' },
            { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'package.json' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: '{"name": "test"}' },
          ],
        },
        { role: 'assistant', content: 'The package name is "test".' },
        { role: 'user', content: 'What about the version?' },
      ];

      const { streamFn } = wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(messages, '', config, vi.fn());

      const callArgs = streamFn.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(5);
      // Verify ContentBlock messages are preserved
      expect(Array.isArray(callArgs.messages[1].content)).toBe(true);
      expect(callArgs.messages[1].content[1].type).toBe('tool_use');
      expect(Array.isArray(callArgs.messages[2].content)).toBe(true);
      expect(callArgs.messages[2].content[0].type).toBe('tool_result');
    });
  });

  // -----------------------------------------------------------------------
  // 10. Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty text deltas without errors', async () => {
      const stream = makeMockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
        { type: 'message_delta', usage: { output_tokens: 1 } },
      ]);

      wireAnthropicMock(llmService, stream);
      const onChunk = vi.fn();
      const result = await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, onChunk,
      );

      expect(result.content).toBe('ok');
      // 3 onChunk calls: empty delta, 'ok' delta, done
      expect(onChunk).toHaveBeenCalledTimes(3);
    });

    it('handles stream with only message_start and message_delta (no content)', async () => {
      const stream = makeMockStream([
        { type: 'message_start', message: { usage: { input_tokens: 3 } } },
        { type: 'message_delta', usage: { output_tokens: 0 } },
      ]);

      wireAnthropicMock(llmService, stream);
      const result = await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, vi.fn(),
      );

      expect(result.content).toBe('');
      expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 0 });
    });

    it('ignores non-text_delta content_block_delta events', async () => {
      const stream = makeMockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'real' } },
        { type: 'message_delta', usage: { output_tokens: 1 } },
      ]);

      wireAnthropicMock(llmService, stream);
      const onChunk = vi.fn();
      const result = await llmService.streamAnswerWithHistory(
        [{ role: 'user', content: 'q' }], '', config, onChunk,
      );

      expect(result.content).toBe('real');
      // Only the 'real' text delta + done = 2 calls
      expect(onChunk).toHaveBeenCalledTimes(2);
    });

    it('handles many messages in a long conversation', async () => {
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
      }
      // Ensure last message is from user
      messages.push({ role: 'user', content: 'Final question' });

      const { streamFn } = wireAnthropicMock(llmService, helloWorldStream());
      await llmService.streamAnswerWithHistory(messages, '', config, vi.fn());

      const callArgs = streamFn.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(21);

      const toolStart = collectedEvents.find(e => e.type === 'tool_start')!;
      expect(toolStart.payload.multi_turn).toBe(true);
      expect(toolStart.payload.message_count).toBe(21);
    });
  });
});
