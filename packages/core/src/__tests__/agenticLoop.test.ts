/**
 * Tests for AgenticLoop — LLM ↔ tool execution loop (A3)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgenticLoop, LLMClient, LLMClientResponse, ToolExecutionProvider } from '../agenticLoop';
import { ConversationHistory } from '../conversationHistory';
import { EventStore } from '../eventStore';
import { EventBus } from '../eventBus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _tmpDirs: string[] = [];

function createEventBus(): EventBus {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-agentic-'));
  _tmpDirs.push(dir);
  const store = new EventStore(path.join(dir, 'events.jsonl'));
  return new EventBus(store);
}

function createHistory(): ConversationHistory {
  const h = new ConversationHistory();
  h.addUserMessage('Write a hello world function');
  return h;
}

/** Build a mock LLM response (text only) */
function textResponse(text: string): LLMClientResponse {
  return {
    id: 'msg_test',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/** Build a mock LLM response with tool use */
function toolUseResponse(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId = 'toolu_test_1',
  text?: string,
): LLMClientResponse {
  const content: LLMClientResponse['content'] = [];
  if (text) content.push({ type: 'text', text });
  content.push({ type: 'tool_use', id: toolUseId, name: toolName, input: toolInput });
  return {
    id: 'msg_test',
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgenticLoop', () => {
  afterEach(() => {
    for (const dir of _tmpDirs) {
      try { fs.rmSync(dir, { recursive: true }); } catch {}
    }
    _tmpDirs = [];
  });

  describe('basic text response (no tool use)', () => {
    it('returns final text when LLM responds with end_turn', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const mockClient: LLMClient = {
        createMessage: vi.fn().mockResolvedValue(textResponse('Hello world!')),
      };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn(),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
        systemPrompt: 'You are a coding assistant',
      });

      expect(result.finalText).toBe('Hello world!');
      expect(result.stopReason).toBe('end_turn');
      expect(result.iterations).toBe(1);
      expect(result.toolCalls).toHaveLength(0);
      expect(mockClient.createMessage).toHaveBeenCalledTimes(1);
      expect(mockProvider.executeTool).not.toHaveBeenCalled();
    });

    it('adds assistant response to conversation history', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const mockClient: LLMClient = {
        createMessage: vi.fn().mockResolvedValue(textResponse('Done!')),
      };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn(),
      };

      await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      // History should now have: user message + assistant message
      expect(history.length).toBe(2);
      const last = history.lastMessage();
      expect(last?.role).toBe('assistant');
    });
  });

  describe('single tool use iteration', () => {
    it('executes tool and returns final text', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const createMessage = vi.fn()
        // First call: tool use
        .mockResolvedValueOnce(
          toolUseResponse('read_file', { path: 'src/index.ts' })
        )
        // Second call: text response after tool result
        .mockResolvedValueOnce(textResponse('Here is the file content'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({
          success: true,
          output: 'console.log("hello")',
        }),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      expect(result.finalText).toBe('Here is the file content');
      expect(result.stopReason).toBe('end_turn');
      expect(result.iterations).toBe(2);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read_file');
      expect(result.toolCalls[0].success).toBe(true);
      expect(mockProvider.executeTool).toHaveBeenCalledWith('read_file', { path: 'src/index.ts' });
    });

    it('handles tool execution failure gracefully', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const createMessage = vi.fn()
        .mockResolvedValueOnce(
          toolUseResponse('read_file', { path: 'missing.ts' })
        )
        .mockResolvedValueOnce(textResponse('File not found, creating it instead'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({
          success: false,
          output: '',
          error: 'File not found: missing.ts',
        }),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      expect(result.finalText).toBe('File not found, creating it instead');
      expect(result.toolCalls[0].success).toBe(false);
      // LLM should still get called a second time with the tool_result error
      expect(createMessage).toHaveBeenCalledTimes(2);
    });

    it('handles tool execution throwing an exception', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const createMessage = vi.fn()
        .mockResolvedValueOnce(
          toolUseResponse('run_command', { command: 'npm test' })
        )
        .mockResolvedValueOnce(textResponse('Command failed'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockRejectedValue(new Error('Permission denied')),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      expect(result.toolCalls[0].success).toBe(false);
      expect(result.toolCalls[0].output).toBe('');
      expect(result.stopReason).toBe('end_turn');
    });
  });

  describe('multi-tool iteration', () => {
    it('handles multiple tool calls in sequence', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const createMessage = vi.fn()
        .mockResolvedValueOnce(
          toolUseResponse('read_file', { path: 'a.ts' }, 'toolu_1')
        )
        .mockResolvedValueOnce(
          toolUseResponse('write_file', { path: 'b.ts', content: 'new' }, 'toolu_2')
        )
        .mockResolvedValueOnce(textResponse('All done'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      expect(result.iterations).toBe(3);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('read_file');
      expect(result.toolCalls[1].name).toBe('write_file');
      expect(result.finalText).toBe('All done');
    });
  });

  describe('safety limits', () => {
    it('stops after maxIterations', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION', { maxIterations: 3 });

      // Always return tool use — should stop after 3 iterations
      const createMessage = vi.fn().mockResolvedValue(
        toolUseResponse('read_file', { path: 'x.ts' })
      );

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      expect(result.stopReason).toBe('max_iterations');
      expect(result.iterations).toBe(3);
      expect(result.toolCalls).toHaveLength(3);
    });

    it('stops when maxTotalTokens is exceeded', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION', {
        maxIterations: 100,
        maxTotalTokens: 200, // Very low budget
      });

      // Each call uses 150 tokens (100 input + 50 output)
      const createMessage = vi.fn()
        .mockResolvedValueOnce(
          toolUseResponse('read_file', { path: 'a.ts' })
        )
        .mockResolvedValueOnce(textResponse('Done'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      // First call uses 150 tokens (within 200), second call would push to 300 (over 200)
      expect(result.stopReason).toBe('max_tokens');
    });
  });

  describe('LLM error handling', () => {
    it('returns error result when LLM call fails', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const mockClient: LLMClient = {
        createMessage: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn(),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      expect(result.stopReason).toBe('error');
      expect(result.error).toContain('API rate limit exceeded');
      expect(result.iterations).toBe(1);
    });
  });

  describe('token tracking', () => {
    it('accumulates token usage across iterations', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const createMessage = vi.fn()
        .mockResolvedValueOnce(
          toolUseResponse('read_file', { path: 'a.ts' })
        )
        .mockResolvedValueOnce(textResponse('Done'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      };

      const result = await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      // 2 API calls × (100 input + 50 output) each
      expect(result.totalTokens.input).toBe(200);
      expect(result.totalTokens.output).toBe(100);
    });
  });

  describe('onText callback', () => {
    it('calls onText for each text block', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const mockClient: LLMClient = {
        createMessage: vi.fn().mockResolvedValue(textResponse('Hello!')),
      };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn(),
      };

      const onText = vi.fn();
      await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
        onText,
      });

      expect(onText).toHaveBeenCalledWith('Hello!');
    });

    it('calls onText for text alongside tool use', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const createMessage = vi.fn()
        .mockResolvedValueOnce(
          toolUseResponse('read_file', { path: 'a.ts' }, 'toolu_1', 'Let me read the file')
        )
        .mockResolvedValueOnce(textResponse('Done'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      };

      const onText = vi.fn();
      await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
        onText,
      });

      expect(onText).toHaveBeenCalledWith('Let me read the file');
      expect(onText).toHaveBeenCalledWith('Done');
    });
  });

  describe('event emission', () => {
    it('emits tool_start and tool_end events for LLM calls', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-agentic-'));
      _tmpDirs.push(dir);
      const store = new EventStore(path.join(dir, 'events.jsonl'));
      const eventBus = new EventBus(store);
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const mockClient: LLMClient = {
        createMessage: vi.fn().mockResolvedValue(textResponse('Ok')),
      };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn(),
      };

      await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      const events = store.getEventsByTaskId('task-1');
      const toolStarts = events.filter(e => e.type === 'tool_start');
      const toolEnds = events.filter(e => e.type === 'tool_end');

      // 1 LLM call = 1 tool_start + 1 tool_end
      expect(toolStarts.length).toBeGreaterThanOrEqual(1);
      expect(toolEnds.length).toBeGreaterThanOrEqual(1);
    });

    it('emits events for tool executions', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-agentic-'));
      _tmpDirs.push(dir);
      const store = new EventStore(path.join(dir, 'events.jsonl'));
      const eventBus = new EventBus(store);
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const createMessage = vi.fn()
        .mockResolvedValueOnce(toolUseResponse('read_file', { path: 'a.ts' }))
        .mockResolvedValueOnce(textResponse('Done'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      };

      await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      const events = store.getEventsByTaskId('task-1');
      const toolStarts = events.filter(e => e.type === 'tool_start');
      const toolEnds = events.filter(e => e.type === 'tool_end');

      // 2 LLM calls + 1 tool execution = at least 3 tool_start + 3 tool_end
      expect(toolStarts.length).toBeGreaterThanOrEqual(3);
      expect(toolEnds.length).toBeGreaterThanOrEqual(3);

      // Check tool execution event
      const toolExecStart = toolStarts.find(e => e.payload?.tool === 'read_file');
      expect(toolExecStart).toBeDefined();
      expect(toolExecStart!.payload.category).toBe('read');
    });
  });

  describe('conversation history management', () => {
    it('adds tool_result messages as user messages', async () => {
      const eventBus = createEventBus();
      const history = createHistory();
      const loop = new AgenticLoop(eventBus, 'task-1', 'MISSION');

      const createMessage = vi.fn()
        .mockResolvedValueOnce(toolUseResponse('read_file', { path: 'a.ts' }))
        .mockResolvedValueOnce(textResponse('Done'));

      const mockClient: LLMClient = { createMessage };
      const mockProvider: ToolExecutionProvider = {
        executeTool: vi.fn().mockResolvedValue({ success: true, output: 'file content here' }),
      };

      await loop.run({
        llmClient: mockClient,
        toolProvider: mockProvider,
        history,
        model: 'haiku',
      });

      // History: initial user + assistant (tool_use) + user (tool_result) + assistant (text)
      expect(history.length).toBe(4);
      const msgs = history.getMessages();
      expect(msgs[0].role).toBe('user');     // initial question
      expect(msgs[1].role).toBe('assistant'); // tool_use
      expect(msgs[2].role).toBe('user');     // tool_result
      expect(msgs[3].role).toBe('assistant'); // final text
    });
  });
});
