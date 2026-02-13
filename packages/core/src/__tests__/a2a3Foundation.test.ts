import { describe, it, expect, beforeEach } from 'vitest';

// --- modelRegistry imports ---
import {
  MODEL_MAP,
  DEFAULT_MODEL,
  FAST_MODEL,
  CAPABLE_MODEL,
  EDIT_MODEL,
  resolveModel,
  didModelFallback,
} from '../modelRegistry';

// --- conversationHistory imports ---
import {
  ConversationHistory,
  ConversationMessage,
  ContentBlock,
} from '../conversationHistory';

// --- toolSchemas imports ---
import {
  ALL_TOOLS,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  EXEC_TOOLS,
  toolNameToCategory,
  getToolSchema,
  buildToolsParam,
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  RUN_COMMAND_TOOL,
  SEARCH_FILES_TOOL,
  LIST_DIRECTORY_TOOL,
} from '../toolSchemas';

// ==========================================================================
// 1. modelRegistry
// ==========================================================================

describe('modelRegistry', () => {
  describe('MODEL_MAP', () => {
    it('all entries map to strings ending in 8 digits', () => {
      for (const [alias, modelId] of Object.entries(MODEL_MAP)) {
        expect(modelId, `MODEL_MAP["${alias}"] should end with 8 digits`).toMatch(
          /\d{8}$/,
        );
      }
    });

    it('contains expected short aliases', () => {
      expect(MODEL_MAP['haiku']).toBeDefined();
      expect(MODEL_MAP['sonnet']).toBeDefined();
      expect(MODEL_MAP['sonnet-4']).toBeDefined();
      expect(MODEL_MAP['sonnet-4.5']).toBeDefined();
    });

    it('contains expected full-name aliases', () => {
      expect(MODEL_MAP['claude-haiku-4-5']).toBeDefined();
      expect(MODEL_MAP['claude-sonnet-4-5']).toBeDefined();
      expect(MODEL_MAP['claude-sonnet-4']).toBeDefined();
    });

    it('contains legacy aliases', () => {
      expect(MODEL_MAP['claude-3-haiku']).toBeDefined();
      expect(MODEL_MAP['claude-3-sonnet']).toBeDefined();
      expect(MODEL_MAP['claude-3-opus']).toBeDefined();
    });

    it('contains non-Anthropic fallback aliases', () => {
      expect(MODEL_MAP['opus-4.5']).toBeDefined();
      expect(MODEL_MAP['gpt-5.2']).toBeDefined();
      expect(MODEL_MAP['gemini-3']).toBeDefined();
    });
  });

  describe('named model constants', () => {
    it('DEFAULT_MODEL ends with 8 digits', () => {
      expect(DEFAULT_MODEL).toMatch(/\d{8}$/);
    });

    it('FAST_MODEL ends with 8 digits', () => {
      expect(FAST_MODEL).toMatch(/\d{8}$/);
    });

    it('CAPABLE_MODEL ends with 8 digits', () => {
      expect(CAPABLE_MODEL).toMatch(/\d{8}$/);
    });

    it('EDIT_MODEL ends with 8 digits', () => {
      expect(EDIT_MODEL).toMatch(/\d{8}$/);
    });

    it('FAST_MODEL equals DEFAULT_MODEL', () => {
      expect(FAST_MODEL).toBe(DEFAULT_MODEL);
    });
  });

  describe('resolveModel', () => {
    it('known short alias "haiku" returns mapped model', () => {
      expect(resolveModel('haiku')).toBe('claude-haiku-4-5-20251001');
    });

    it('known short alias "sonnet" returns mapped model', () => {
      expect(resolveModel('sonnet')).toBe('claude-sonnet-4-5-20250929');
    });

    it('known short alias "sonnet-4" returns mapped model', () => {
      expect(resolveModel('sonnet-4')).toBe('claude-sonnet-4-20250514');
    });

    it('known short alias "sonnet-4.5" returns mapped model', () => {
      expect(resolveModel('sonnet-4.5')).toBe('claude-sonnet-4-5-20250929');
    });

    it('full-name alias "claude-haiku-4-5" returns mapped model', () => {
      expect(resolveModel('claude-haiku-4-5')).toBe('claude-haiku-4-5-20251001');
    });

    it('full-name alias "claude-sonnet-4" returns mapped model', () => {
      expect(resolveModel('claude-sonnet-4')).toBe('claude-sonnet-4-20250514');
    });

    it('legacy alias "claude-3-opus" returns mapped model', () => {
      expect(resolveModel('claude-3-opus')).toBe('claude-sonnet-4-5-20250929');
    });

    it('non-Anthropic alias "gpt-5.2" returns haiku fallback', () => {
      expect(resolveModel('gpt-5.2')).toBe('claude-haiku-4-5-20251001');
    });

    it('fully-qualified model ID (8-digit suffix) returned as-is', () => {
      const fullId = 'claude-sonnet-4-20250514';
      expect(resolveModel(fullId)).toBe(fullId);
    });

    it('arbitrary string with 8-digit suffix returned as-is', () => {
      const custom = 'my-custom-model-20260101';
      expect(resolveModel(custom)).toBe(custom);
    });

    it('unknown string without date suffix falls back to DEFAULT_MODEL', () => {
      expect(resolveModel('unknown-model')).toBe(DEFAULT_MODEL);
    });

    it('empty string falls back to DEFAULT_MODEL', () => {
      expect(resolveModel('')).toBe(DEFAULT_MODEL);
    });

    it('all MODEL_MAP aliases resolve correctly', () => {
      for (const [alias, expected] of Object.entries(MODEL_MAP)) {
        expect(resolveModel(alias), `resolveModel("${alias}")`).toBe(expected);
      }
    });
  });

  describe('didModelFallback', () => {
    it('returns false for known alias "haiku"', () => {
      expect(didModelFallback('haiku')).toBe(false);
    });

    it('returns false for known alias "sonnet"', () => {
      expect(didModelFallback('sonnet')).toBe(false);
    });

    it('returns false for known alias "claude-sonnet-4"', () => {
      expect(didModelFallback('claude-sonnet-4')).toBe(false);
    });

    it('returns false for fully-qualified ID', () => {
      expect(didModelFallback('claude-sonnet-4-20250514')).toBe(false);
    });

    it('returns false for arbitrary string with 8-digit suffix', () => {
      expect(didModelFallback('anything-12345678')).toBe(false);
    });

    it('returns true for unknown string without date suffix', () => {
      expect(didModelFallback('unknown-model')).toBe(true);
    });

    it('returns true for empty string', () => {
      expect(didModelFallback('')).toBe(true);
    });

    it('returns true for gibberish', () => {
      expect(didModelFallback('xyzzy')).toBe(true);
    });

    it('returns false for all MODEL_MAP aliases', () => {
      for (const alias of Object.keys(MODEL_MAP)) {
        expect(didModelFallback(alias), `didModelFallback("${alias}")`).toBe(false);
      }
    });
  });
});

// ==========================================================================
// 2. ConversationHistory
// ==========================================================================

describe('ConversationHistory', () => {
  let history: ConversationHistory;

  beforeEach(() => {
    history = new ConversationHistory();
  });

  describe('addUserMessage / addAssistantMessage / addMessage', () => {
    it('addUserMessage appends a user message', () => {
      history.addUserMessage('hello');
      expect(history.length).toBe(1);
      const msgs = history.getMessages();
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content).toBe('hello');
    });

    it('addAssistantMessage appends an assistant message', () => {
      history.addAssistantMessage('hi there');
      expect(history.length).toBe(1);
      const msgs = history.getMessages();
      expect(msgs[0].role).toBe('assistant');
      expect(msgs[0].content).toBe('hi there');
    });

    it('addMessage appends a generic message with correct role', () => {
      history.addMessage({ role: 'user', content: 'msg1' });
      history.addMessage({ role: 'assistant', content: 'msg2' });
      expect(history.length).toBe(2);
      expect(history.getMessages()[0].role).toBe('user');
      expect(history.getMessages()[1].role).toBe('assistant');
    });

    it('addMessage makes a shallow copy of the message object', () => {
      const msg: ConversationMessage = { role: 'user', content: 'original' };
      history.addMessage(msg);
      msg.content = 'mutated';
      // Internal copy should NOT reflect the mutation
      expect(history.getMessages()[0].content).toBe('original');
    });

    it('addUserMessage supports ContentBlock[] content', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ];
      history.addUserMessage(blocks);
      const msg = history.getMessages()[0];
      expect(Array.isArray(msg.content)).toBe(true);
      expect((msg.content as ContentBlock[]).length).toBe(2);
    });

    it('addAssistantMessage supports ContentBlock[] content', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'a.ts' } },
      ];
      history.addAssistantMessage(blocks);
      const msg = history.getMessages()[0];
      expect(Array.isArray(msg.content)).toBe(true);
    });
  });

  describe('getMessages', () => {
    it('returns a shallow copy (not the internal array)', () => {
      history.addUserMessage('a');
      const msgs1 = history.getMessages();
      const msgs2 = history.getMessages();
      expect(msgs1).not.toBe(msgs2);
      expect(msgs1).toEqual(msgs2);
    });

    it('mutating the returned array does not affect internal state', () => {
      history.addUserMessage('a');
      const msgs = history.getMessages();
      msgs.push({ role: 'assistant', content: 'injected' });
      expect(history.length).toBe(1);
    });
  });

  describe('length property', () => {
    it('returns 0 for empty history', () => {
      expect(history.length).toBe(0);
    });

    it('increments as messages are added', () => {
      history.addUserMessage('1');
      expect(history.length).toBe(1);
      history.addAssistantMessage('2');
      expect(history.length).toBe(2);
      history.addUserMessage('3');
      expect(history.length).toBe(3);
    });
  });

  describe('lastMessage', () => {
    it('returns undefined for empty history', () => {
      expect(history.lastMessage()).toBeUndefined();
    });

    it('returns the most recently added message', () => {
      history.addUserMessage('first');
      history.addAssistantMessage('second');
      const last = history.lastMessage();
      expect(last?.role).toBe('assistant');
      expect(last?.content).toBe('second');
    });
  });

  describe('clear', () => {
    it('empties all messages', () => {
      history.addUserMessage('a');
      history.addAssistantMessage('b');
      history.clear();
      expect(history.length).toBe(0);
      expect(history.getMessages()).toEqual([]);
      expect(history.lastMessage()).toBeUndefined();
    });
  });

  describe('estimateTokens', () => {
    it('returns 0 for empty history', () => {
      expect(history.estimateTokens()).toBe(0);
    });

    it('returns reasonable value for string content', () => {
      // "hello world" = 11 chars, default charsPerToken=4, ceil(11/4)=3
      history.addUserMessage('hello world');
      expect(history.estimateTokens()).toBe(3);
    });

    it('returns reasonable value for multiple messages', () => {
      history.addUserMessage('aaaa'); // 4 chars -> 1 token
      history.addAssistantMessage('bbbbbbbb'); // 8 chars -> 2 tokens
      expect(history.estimateTokens()).toBe(3);
    });

    it('accounts for ContentBlock[] content', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'abcdefgh' }, // 8 chars
      ];
      history.addUserMessage(blocks);
      // 8 chars / 4 charsPerToken = 2
      expect(history.estimateTokens()).toBe(2);
    });

    it('respects custom charsPerToken config', () => {
      const custom = new ConversationHistory({ charsPerToken: 2 });
      custom.addUserMessage('abcdefgh'); // 8 chars / 2 = 4 tokens
      expect(custom.estimateTokens()).toBe(4);
    });

    it('accounts for image blocks with rough estimate', () => {
      const blocks: ContentBlock[] = [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
      ];
      history.addUserMessage(blocks);
      // Image: 4000 chars / 4 charsPerToken = 1000
      expect(history.estimateTokens()).toBe(1000);
    });

    it('accounts for tool_use blocks', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'a.ts' } },
      ];
      history.addAssistantMessage(blocks);
      // name.length + JSON.stringify(input).length
      const expectedChars = 'read_file'.length + JSON.stringify({ path: 'a.ts' }).length;
      expect(history.estimateTokens()).toBe(Math.ceil(expectedChars / 4));
    });

    it('accounts for tool_result blocks with string content', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_result', tool_use_id: 'tu1', content: 'file contents here' },
      ];
      history.addUserMessage(blocks);
      // 'file contents here'.length = 18 chars / 4 = 5 (ceil)
      expect(history.estimateTokens()).toBe(Math.ceil(18 / 4));
    });
  });

  describe('trim', () => {
    it('does nothing when under budget', () => {
      history.addUserMessage('short');
      const removed = history.trim();
      expect(removed).toBe(0);
      expect(history.length).toBe(1);
    });

    it('removes oldest messages when over budget (small maxTokens)', () => {
      // Use a small maxTokens to force trimming. minMessages=2 means at least 2
      // are always kept, so the last 2 messages must fit within the budget.
      const h = new ConversationHistory({ maxTokens: 10, minMessages: 2, charsPerToken: 1 });
      // Add messages: each 4 chars = 4 tokens
      h.addUserMessage('aaaa');    // 4 tokens
      h.addAssistantMessage('bbbb'); // 4 tokens -> total 8
      h.addUserMessage('cccc');    // 4 tokens -> total 12, over 10
      h.addAssistantMessage('dd'); // 2 tokens -> total 14, over 10

      const removed = h.trim();
      expect(removed).toBeGreaterThan(0);
      // After trim: the last 2 messages (cccc=4 + dd=2 = 6 tokens) fit in 10
      expect(h.length).toBeLessThan(4);
      expect(h.estimateTokens()).toBeLessThanOrEqual(10);
    });

    it('preserves at least minMessages', () => {
      const h = new ConversationHistory({ maxTokens: 1, minMessages: 4, charsPerToken: 1 });
      h.addUserMessage('aaaa');
      h.addAssistantMessage('bbbb');
      h.addUserMessage('cccc');
      h.addAssistantMessage('dddd');

      h.trim();
      // Even though over budget, should keep at least 4 messages
      expect(h.length).toBeGreaterThanOrEqual(4);
    });

    it('ensures conversation starts with "user" role after trim', () => {
      const h = new ConversationHistory({ maxTokens: 10, minMessages: 1, charsPerToken: 1 });
      // Add enough messages to force trimming
      h.addUserMessage('a'.repeat(5));
      h.addAssistantMessage('b'.repeat(5));
      h.addUserMessage('c'.repeat(5));
      h.addAssistantMessage('d'.repeat(5));

      h.trim();
      const msgs = h.getMessages();
      if (msgs.length > 0) {
        expect(msgs[0].role).toBe('user');
      }
    });

    it('returns count of removed messages', () => {
      const h = new ConversationHistory({ maxTokens: 5, minMessages: 2, charsPerToken: 1 });
      h.addUserMessage('a'.repeat(10));
      h.addAssistantMessage('b'.repeat(10));
      h.addUserMessage('c'.repeat(3));
      h.addAssistantMessage('d'.repeat(2));

      const removed = h.trim();
      expect(removed).toBeGreaterThan(0);
      expect(typeof removed).toBe('number');
    });
  });

  describe('toApiMessages', () => {
    it('auto-trims and returns messages', () => {
      const h = new ConversationHistory({ maxTokens: 5, minMessages: 2, charsPerToken: 1 });
      h.addUserMessage('a'.repeat(10));
      h.addAssistantMessage('b'.repeat(10));
      h.addUserMessage('c'.repeat(3));
      h.addAssistantMessage('d'.repeat(2));

      const apiMsgs = h.toApiMessages();
      // Should be trimmed: total tokens within budget or at minMessages
      expect(apiMsgs.length).toBeLessThanOrEqual(4);
      expect(apiMsgs.length).toBeGreaterThanOrEqual(2);
    });

    it('returns all messages when under budget', () => {
      history.addUserMessage('hello');
      history.addAssistantMessage('hi');
      const apiMsgs = history.toApiMessages();
      expect(apiMsgs).toHaveLength(2);
      expect(apiMsgs[0].content).toBe('hello');
      expect(apiMsgs[1].content).toBe('hi');
    });

    it('returns a shallow copy', () => {
      history.addUserMessage('a');
      const msgs1 = history.toApiMessages();
      const msgs2 = history.toApiMessages();
      expect(msgs1).not.toBe(msgs2);
    });
  });

  describe('toJSON / fromJSON round-trip', () => {
    it('serializes and deserializes correctly', () => {
      history.addUserMessage('hello');
      history.addAssistantMessage('world');

      const json = history.toJSON();
      expect(json.messages).toHaveLength(2);
      expect(json.config).toBeDefined();
      expect(json.config.maxTokens).toBe(100_000);

      const restored = ConversationHistory.fromJSON(json);
      expect(restored.length).toBe(2);
      const msgs = restored.getMessages();
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content).toBe('hello');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('world');
    });

    it('round-trip preserves ContentBlock[] messages', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'x.ts' } },
      ];
      history.addAssistantMessage(blocks);
      const json = history.toJSON();
      const restored = ConversationHistory.fromJSON(json);
      const msg = restored.getMessages()[0];
      expect(Array.isArray(msg.content)).toBe(true);
      expect((msg.content as ContentBlock[]).length).toBe(2);
    });

    it('fromJSON with no config uses defaults', () => {
      const restored = ConversationHistory.fromJSON({
        messages: [{ role: 'user', content: 'test' }],
      });
      expect(restored.length).toBe(1);
      // Default maxTokens is 100_000 — verify token estimate works normally
      expect(restored.estimateTokens()).toBeGreaterThan(0);
    });

    it('fromJSON with partial config overrides defaults', () => {
      const restored = ConversationHistory.fromJSON({
        messages: [{ role: 'user', content: 'test' }],
        config: { maxTokens: 50 },
      });
      const json = restored.toJSON();
      expect(json.config.maxTokens).toBe(50);
      // Other defaults should still be present
      expect(json.config.minMessages).toBe(4);
      expect(json.config.charsPerToken).toBe(4);
    });
  });

  describe('config defaults', () => {
    it('default config works when no config provided', () => {
      const h = new ConversationHistory();
      const json = h.toJSON();
      expect(json.config.maxTokens).toBe(100_000);
      expect(json.config.minMessages).toBe(4);
      expect(json.config.charsPerToken).toBe(4);
    });

    it('custom config overrides defaults', () => {
      const h = new ConversationHistory({
        maxTokens: 50_000,
        minMessages: 2,
        charsPerToken: 3,
      });
      const json = h.toJSON();
      expect(json.config.maxTokens).toBe(50_000);
      expect(json.config.minMessages).toBe(2);
      expect(json.config.charsPerToken).toBe(3);
    });

    it('partial config merges with defaults', () => {
      const h = new ConversationHistory({ maxTokens: 200 });
      const json = h.toJSON();
      expect(json.config.maxTokens).toBe(200);
      expect(json.config.minMessages).toBe(4);
      expect(json.config.charsPerToken).toBe(4);
    });
  });
});

// ==========================================================================
// 3. toolSchemas
// ==========================================================================

describe('toolSchemas', () => {
  describe('tool collections', () => {
    it('ALL_TOOLS has 6 tools', () => {
      expect(ALL_TOOLS).toHaveLength(6);
    });

    it('READ_ONLY_TOOLS has 3 tools (read_file, search_files, list_directory)', () => {
      expect(READ_ONLY_TOOLS).toHaveLength(3);
      const names = READ_ONLY_TOOLS.map(t => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('search_files');
      expect(names).toContain('list_directory');
    });

    it('WRITE_TOOLS has 2 tools (write_file, edit_file)', () => {
      expect(WRITE_TOOLS).toHaveLength(2);
      const names = WRITE_TOOLS.map(t => t.name);
      expect(names).toContain('write_file');
      expect(names).toContain('edit_file');
    });

    it('EXEC_TOOLS has 1 tool (run_command)', () => {
      expect(EXEC_TOOLS).toHaveLength(1);
      expect(EXEC_TOOLS[0].name).toBe('run_command');
    });

    it('ALL_TOOLS = READ_ONLY_TOOLS + WRITE_TOOLS + EXEC_TOOLS (same tool names)', () => {
      const allNames = ALL_TOOLS.map(t => t.name).sort();
      const combinedNames = [
        ...READ_ONLY_TOOLS.map(t => t.name),
        ...WRITE_TOOLS.map(t => t.name),
        ...EXEC_TOOLS.map(t => t.name),
      ].sort();
      expect(allNames).toEqual(combinedNames);
    });
  });

  describe('tool schema structure', () => {
    it('every tool has name, description, and input_schema with type "object"', () => {
      for (const tool of ALL_TOOLS) {
        expect(tool.name, `tool should have name`).toBeTruthy();
        expect(typeof tool.name).toBe('string');
        expect(tool.description, `${tool.name} should have description`).toBeTruthy();
        expect(typeof tool.description).toBe('string');
        expect(tool.input_schema, `${tool.name} should have input_schema`).toBeDefined();
        expect(tool.input_schema.type).toBe('object');
      }
    });

    it('every tool has a required array', () => {
      for (const tool of ALL_TOOLS) {
        expect(
          Array.isArray(tool.input_schema.required),
          `${tool.name} should have required array`,
        ).toBe(true);
      }
    });

    it('every tool has a properties object', () => {
      for (const tool of ALL_TOOLS) {
        expect(typeof tool.input_schema.properties).toBe('object');
      }
    });
  });

  describe('individual tool exports', () => {
    it('READ_FILE_TOOL has correct name', () => {
      expect(READ_FILE_TOOL.name).toBe('read_file');
    });

    it('WRITE_FILE_TOOL has correct name', () => {
      expect(WRITE_FILE_TOOL.name).toBe('write_file');
    });

    it('EDIT_FILE_TOOL has correct name', () => {
      expect(EDIT_FILE_TOOL.name).toBe('edit_file');
    });

    it('RUN_COMMAND_TOOL has correct name', () => {
      expect(RUN_COMMAND_TOOL.name).toBe('run_command');
    });

    it('SEARCH_FILES_TOOL has correct name', () => {
      expect(SEARCH_FILES_TOOL.name).toBe('search_files');
    });

    it('LIST_DIRECTORY_TOOL has correct name', () => {
      expect(LIST_DIRECTORY_TOOL.name).toBe('list_directory');
    });

    it('READ_FILE_TOOL requires "path"', () => {
      expect(READ_FILE_TOOL.input_schema.required).toContain('path');
    });

    it('WRITE_FILE_TOOL requires "path" and "content"', () => {
      expect(WRITE_FILE_TOOL.input_schema.required).toContain('path');
      expect(WRITE_FILE_TOOL.input_schema.required).toContain('content');
    });

    it('EDIT_FILE_TOOL requires "path", "old_text", "new_text"', () => {
      expect(EDIT_FILE_TOOL.input_schema.required).toContain('path');
      expect(EDIT_FILE_TOOL.input_schema.required).toContain('old_text');
      expect(EDIT_FILE_TOOL.input_schema.required).toContain('new_text');
    });

    it('RUN_COMMAND_TOOL requires "command"', () => {
      expect(RUN_COMMAND_TOOL.input_schema.required).toContain('command');
    });

    it('SEARCH_FILES_TOOL requires "query"', () => {
      expect(SEARCH_FILES_TOOL.input_schema.required).toContain('query');
    });

    it('LIST_DIRECTORY_TOOL has empty required array', () => {
      expect(LIST_DIRECTORY_TOOL.input_schema.required).toEqual([]);
    });
  });

  describe('toolNameToCategory', () => {
    it('read_file maps to "read"', () => {
      expect(toolNameToCategory('read_file')).toBe('read');
    });

    it('search_files maps to "read"', () => {
      expect(toolNameToCategory('search_files')).toBe('read');
    });

    it('list_directory maps to "read"', () => {
      expect(toolNameToCategory('list_directory')).toBe('read');
    });

    it('write_file maps to "write"', () => {
      expect(toolNameToCategory('write_file')).toBe('write');
    });

    it('edit_file maps to "write"', () => {
      expect(toolNameToCategory('edit_file')).toBe('write');
    });

    it('run_command maps to "exec"', () => {
      expect(toolNameToCategory('run_command')).toBe('exec');
    });

    it('unknown tool name defaults to "read"', () => {
      expect(toolNameToCategory('nonexistent_tool')).toBe('read');
    });

    it('empty string defaults to "read"', () => {
      expect(toolNameToCategory('')).toBe('read');
    });
  });

  describe('getToolSchema', () => {
    it('finds existing tool by name', () => {
      const schema = getToolSchema('read_file');
      expect(schema).toBeDefined();
      expect(schema!.name).toBe('read_file');
    });

    it('finds write_file tool', () => {
      const schema = getToolSchema('write_file');
      expect(schema).toBeDefined();
      expect(schema!.name).toBe('write_file');
    });

    it('finds run_command tool', () => {
      const schema = getToolSchema('run_command');
      expect(schema).toBeDefined();
      expect(schema!.name).toBe('run_command');
    });

    it('returns undefined for unknown tool name', () => {
      expect(getToolSchema('nonexistent_tool')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getToolSchema('')).toBeUndefined();
    });

    it('finds all 6 tools by name', () => {
      const names = ['read_file', 'write_file', 'edit_file', 'run_command', 'search_files', 'list_directory'];
      for (const name of names) {
        expect(getToolSchema(name), `getToolSchema("${name}")`).toBeDefined();
      }
    });
  });

  describe('buildToolsParam', () => {
    it('with no options returns ALL_TOOLS', () => {
      const tools = buildToolsParam();
      expect(tools).toHaveLength(ALL_TOOLS.length);
      expect(tools.map(t => t.name).sort()).toEqual(ALL_TOOLS.map(t => t.name).sort());
    });

    it('with undefined options returns ALL_TOOLS', () => {
      const tools = buildToolsParam(undefined);
      expect(tools).toHaveLength(ALL_TOOLS.length);
    });

    it('with empty options object returns ALL_TOOLS', () => {
      const tools = buildToolsParam({});
      expect(tools).toHaveLength(ALL_TOOLS.length);
    });

    it('with readOnly returns READ_ONLY_TOOLS', () => {
      const tools = buildToolsParam({ readOnly: true });
      expect(tools).toHaveLength(READ_ONLY_TOOLS.length);
      const names = tools.map(t => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('search_files');
      expect(names).toContain('list_directory');
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('edit_file');
      expect(names).not.toContain('run_command');
    });

    it('with include filter returns only specified tools', () => {
      const tools = buildToolsParam({ include: ['read_file', 'run_command'] });
      expect(tools).toHaveLength(2);
      const names = tools.map(t => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('run_command');
    });

    it('with include filter for non-existent tool returns empty', () => {
      const tools = buildToolsParam({ include: ['nonexistent'] });
      expect(tools).toHaveLength(0);
    });

    it('with exclude filter removes specified tools', () => {
      const tools = buildToolsParam({ exclude: ['run_command'] });
      expect(tools).toHaveLength(ALL_TOOLS.length - 1);
      const names = tools.map(t => t.name);
      expect(names).not.toContain('run_command');
      expect(names).toContain('read_file');
    });

    it('with exclude filter for all tools returns empty', () => {
      const allNames = ALL_TOOLS.map(t => t.name);
      const tools = buildToolsParam({ exclude: allNames });
      expect(tools).toHaveLength(0);
    });

    it('readOnly + include works (filters within read-only set)', () => {
      const tools = buildToolsParam({ readOnly: true, include: ['read_file'] });
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('read_file');
    });

    it('readOnly + include with write tool returns empty (write tools not in readOnly)', () => {
      const tools = buildToolsParam({ readOnly: true, include: ['write_file'] });
      expect(tools).toHaveLength(0);
    });

    it('readOnly + exclude works (removes from read-only set)', () => {
      const tools = buildToolsParam({ readOnly: true, exclude: ['list_directory'] });
      expect(tools).toHaveLength(2);
      const names = tools.map(t => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('search_files');
      expect(names).not.toContain('list_directory');
    });

    it('include + exclude combined: include first, then exclude', () => {
      const tools = buildToolsParam({
        include: ['read_file', 'write_file', 'run_command'],
        exclude: ['write_file'],
      });
      expect(tools).toHaveLength(2);
      const names = tools.map(t => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('run_command');
      expect(names).not.toContain('write_file');
    });
  });
});
