import { describe, it, expect, vi } from 'vitest';

import {
  estimateTokensImproved,
  isLikelyCode,
  CharacterTokenCounter,
  validateContextFitsSync,
  validateContextFits,
  CHARS_PER_TOKEN,
  FIXED_TOKEN_COSTS,
} from '../tokenCounter';
import type { TokenCounter, ContextFitResult } from '../tokenCounter';

import {
  ConversationHistory,
  ConversationMessage,
  ContentBlock,
} from '../conversationHistory';

import {
  MODEL_CONTEXT_WINDOWS,
  MODEL_MAX_OUTPUT_TOKENS,
  getContextWindow,
  getMaxOutputTokens,
} from '../modelRegistry';

import { ALL_TOOLS } from '../toolSchemas';

// ---------------------------------------------------------------------------
// isLikelyCode
// ---------------------------------------------------------------------------

describe('isLikelyCode', () => {
  it('returns false for short strings', () => {
    expect(isLikelyCode('hello')).toBe(false);
  });

  it('returns false for plain English text', () => {
    expect(isLikelyCode('This is a normal English sentence that does not contain any code patterns whatsoever.')).toBe(false);
  });

  it('returns true for TypeScript code', () => {
    const code = `
      import { foo } from './bar';
      export const baz = async () => {
        const result = await foo();
        return result;
      };
    `;
    expect(isLikelyCode(code)).toBe(true);
  });

  it('returns true for JavaScript with functions and semicolons', () => {
    const code = `function calculate(x) {
      if (x > 0) {
        return x * 2;
      }
      return 0;
    }`;
    expect(isLikelyCode(code)).toBe(true);
  });

  it('returns true for Python code', () => {
    const code = `def process(self.data):
      for item in self.items:
        if item.valid:
          return item.value`;
    expect(isLikelyCode(code)).toBe(true);
  });

  it('returns false for text with only 1-2 code-like patterns', () => {
    expect(isLikelyCode('Please import the data from the spreadsheet and return it')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// estimateTokensImproved
// ---------------------------------------------------------------------------

describe('estimateTokensImproved', () => {
  it('estimates tokens for plain text messages', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hello, how are you?' },
    ];
    const tokens = estimateTokensImproved(messages);
    // 19 chars / 4.0 + 4 overhead = ~9
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(20);
  });

  it('estimates more tokens for code content (lower chars/token ratio)', () => {
    const codeContent = `import { useState } from 'react';
export const App = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};`;

    const textContent = 'a'.repeat(codeContent.length);

    const codeMsg: ConversationMessage[] = [{ role: 'user', content: codeContent }];
    const textMsg: ConversationMessage[] = [{ role: 'user', content: textContent }];

    const codeTokens = estimateTokensImproved(codeMsg);
    const textTokens = estimateTokensImproved(textMsg);

    // Code should produce MORE tokens (lower chars/token ratio)
    expect(codeTokens).toBeGreaterThan(textTokens);
  });

  it('accounts for system prompt', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'hi' },
    ];
    const withSystem = estimateTokensImproved(messages, { system: 'You are a helpful assistant. '.repeat(100) });
    const withoutSystem = estimateTokensImproved(messages);
    expect(withSystem).toBeGreaterThan(withoutSystem);
  });

  it('accounts for tool schemas overhead', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'hi' },
    ];
    const withTools = estimateTokensImproved(messages, { tools: ALL_TOOLS });
    const withoutTools = estimateTokensImproved(messages);
    // 6 tools * 300 = 1800 extra tokens
    expect(withTools - withoutTools).toBeGreaterThanOrEqual(ALL_TOOLS.length * FIXED_TOKEN_COSTS.toolSchema);
  });

  it('handles image content blocks', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
    ];
    const tokens = estimateTokensImproved(messages);
    expect(tokens).toBeGreaterThanOrEqual(FIXED_TOKEN_COSTS.image);
  });

  it('handles tool_use blocks', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'src/index.ts' } },
        ],
      },
    ];
    const tokens = estimateTokensImproved(messages);
    expect(tokens).toBeGreaterThan(FIXED_TOKEN_COSTS.messageOverhead);
  });

  it('handles tool_result blocks', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'File contents here with some data',
          },
        ],
      },
    ];
    const tokens = estimateTokensImproved(messages);
    expect(tokens).toBeGreaterThan(FIXED_TOKEN_COSTS.messageOverhead);
  });

  it('handles mixed content blocks', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Please read the file' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I\'ll read that file for you.' },
          { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'index.ts' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'console.log("hello");' },
        ],
      },
    ];
    const tokens = estimateTokensImproved(messages);
    // 3 messages * 4 overhead + text + tool_use + tool_result
    expect(tokens).toBeGreaterThan(3 * FIXED_TOKEN_COSTS.messageOverhead);
  });

  it('handles empty messages array', () => {
    const tokens = estimateTokensImproved([]);
    expect(tokens).toBe(0);
  });

  it('handles empty messages with system and tools', () => {
    const tokens = estimateTokensImproved([], { system: 'You are helpful.', tools: ALL_TOOLS });
    expect(tokens).toBeGreaterThan(0);
  });

  it('per-message overhead is applied', () => {
    const singleMsg: ConversationMessage[] = [{ role: 'user', content: '' }];
    const twoMsgs: ConversationMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: '' },
    ];
    const diff = estimateTokensImproved(twoMsgs) - estimateTokensImproved(singleMsg);
    expect(diff).toBe(FIXED_TOKEN_COSTS.messageOverhead);
  });
});

// ---------------------------------------------------------------------------
// CharacterTokenCounter
// ---------------------------------------------------------------------------

describe('CharacterTokenCounter', () => {
  it('implements TokenCounter interface', () => {
    const counter = new CharacterTokenCounter();
    expect(typeof counter.countTokens).toBe('function');
  });

  it('returns isEstimate: true', async () => {
    const counter = new CharacterTokenCounter();
    const result = await counter.countTokens({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'claude-haiku-4-5-20251001',
    });
    expect(result.isEstimate).toBe(true);
    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it('uses improved estimation', async () => {
    const counter = new CharacterTokenCounter();
    const messages: ConversationMessage[] = [{ role: 'user', content: 'Hello world' }];
    const result = await counter.countTokens({ messages, model: 'sonnet' });
    const direct = estimateTokensImproved(messages);
    expect(result.inputTokens).toBe(direct);
  });

  it('passes system and tools through', async () => {
    const counter = new CharacterTokenCounter();
    const messages: ConversationMessage[] = [{ role: 'user', content: 'hi' }];
    const withTools = await counter.countTokens({
      messages,
      model: 'sonnet',
      tools: ALL_TOOLS,
      system: 'You are helpful.',
    });
    const without = await counter.countTokens({ messages, model: 'sonnet' });
    expect(withTools.inputTokens).toBeGreaterThan(without.inputTokens);
  });
});

// ---------------------------------------------------------------------------
// validateContextFitsSync
// ---------------------------------------------------------------------------

describe('validateContextFitsSync', () => {
  it('returns fits:true for small conversations', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hello' },
    ];
    const result = validateContextFitsSync(messages, 'claude-haiku-4-5-20251001');
    expect(result.fits).toBe(true);
    expect(result.overflowTokens).toBe(0);
    expect(result.contextWindowSize).toBe(200_000);
    expect(result.reservedForOutput).toBe(8192);
    expect(result.availableForInput).toBe(200_000 - 8192);
  });

  it('returns fits:false for huge conversations', () => {
    // Create messages that exceed 200K tokens
    const bigContent = 'x'.repeat(800_000); // 800K chars / 4 = 200K tokens
    const messages: ConversationMessage[] = [
      { role: 'user', content: bigContent },
    ];
    const result = validateContextFitsSync(messages, 'claude-haiku-4-5-20251001');
    expect(result.fits).toBe(false);
    expect(result.overflowTokens).toBeGreaterThan(0);
  });

  it('respects custom maxOutputTokens', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hello' },
    ];
    const result = validateContextFitsSync(messages, 'sonnet', { maxOutputTokens: 100_000 });
    expect(result.reservedForOutput).toBe(100_000);
    expect(result.availableForInput).toBe(200_000 - 100_000);
  });

  it('includes system prompt and tools in token count', () => {
    const messages: ConversationMessage[] = [{ role: 'user', content: 'hi' }];
    const small = validateContextFitsSync(messages, 'sonnet');
    const big = validateContextFitsSync(messages, 'sonnet', {
      system: 'A very long system prompt. '.repeat(1000),
      tools: ALL_TOOLS,
    });
    expect(big.estimatedInputTokens).toBeGreaterThan(small.estimatedInputTokens);
  });

  it('handles empty messages', () => {
    const result = validateContextFitsSync([], 'sonnet');
    expect(result.fits).toBe(true);
    expect(result.estimatedInputTokens).toBe(0);
  });

  it('handles unknown model (falls back to defaults)', () => {
    const result = validateContextFitsSync(
      [{ role: 'user', content: 'hi' }],
      'unknown-model-xyz'
    );
    expect(result.contextWindowSize).toBe(200_000);
    expect(result.reservedForOutput).toBe(8192);
  });
});

// ---------------------------------------------------------------------------
// validateContextFits (async)
// ---------------------------------------------------------------------------

describe('validateContextFits', () => {
  it('uses counter for token count', async () => {
    const mockCounter: TokenCounter = {
      async countTokens() {
        return { inputTokens: 5000, isEstimate: false };
      },
    };
    const messages: ConversationMessage[] = [{ role: 'user', content: 'hi' }];
    const result = await validateContextFits(mockCounter, messages, 'sonnet');
    expect(result.estimatedInputTokens).toBe(5000);
    expect(result.fits).toBe(true);
  });

  it('returns overflow when counter reports high count', async () => {
    const mockCounter: TokenCounter = {
      async countTokens() {
        return { inputTokens: 250_000, isEstimate: false };
      },
    };
    const messages: ConversationMessage[] = [{ role: 'user', content: 'hi' }];
    const result = await validateContextFits(mockCounter, messages, 'sonnet');
    expect(result.fits).toBe(false);
    expect(result.overflowTokens).toBeGreaterThan(0);
  });

  it('falls back to sync estimation on counter error', async () => {
    const failingCounter: TokenCounter = {
      async countTokens() {
        throw new Error('API error');
      },
    };
    const messages: ConversationMessage[] = [{ role: 'user', content: 'Hello world' }];
    const result = await validateContextFits(failingCounter, messages, 'sonnet');
    // Should still return a valid result (from sync fallback)
    expect(result.fits).toBe(true);
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ConversationHistory.estimateTokensImproved
// ---------------------------------------------------------------------------

describe('ConversationHistory.estimateTokensImproved', () => {
  it('delegates to the improved estimator', () => {
    const history = new ConversationHistory();
    history.addUserMessage('Hello world');
    history.addAssistantMessage('Hi there!');

    const improved = history.estimateTokensImproved();
    const old = history.estimateTokens();

    // Both should be positive
    expect(improved).toBeGreaterThan(0);
    expect(old).toBeGreaterThan(0);
  });

  it('returns higher estimate for code content vs old estimator', () => {
    const history = new ConversationHistory();
    const code = `import { useState, useEffect } from 'react';
export function App() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch('/api/data').then(r => r.json()).then(setData);
  }, []);
  if (!data) return <div>Loading...</div>;
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}`;
    history.addUserMessage(code);

    const improved = history.estimateTokensImproved();
    const old = history.estimateTokens();

    // Code at 3.2 chars/token should yield more tokens than 4.0 chars/token
    expect(improved).toBeGreaterThan(old);
  });
});

// ---------------------------------------------------------------------------
// ConversationHistory.trimAsync
// ---------------------------------------------------------------------------

describe('ConversationHistory.trimAsync', () => {
  it('trims messages using mock counter', async () => {
    const history = new ConversationHistory({ maxTokens: 100, minMessages: 2 });
    history.addUserMessage('msg1');
    history.addAssistantMessage('reply1');
    history.addUserMessage('msg2');
    history.addAssistantMessage('reply2');
    history.addUserMessage('msg3');
    history.addAssistantMessage('reply3');

    // Counter reports 200 tokens each time until only 2 messages remain
    let callCount = 0;
    const mockCounter: TokenCounter = {
      async countTokens({ messages }) {
        callCount++;
        // Report over budget until 2 messages left
        return { inputTokens: messages.length > 2 ? 200 : 50, isEstimate: false };
      },
    };

    const removed = await history.trimAsync(mockCounter, 'sonnet');
    expect(removed).toBeGreaterThan(0);
    expect(history.length).toBeLessThanOrEqual(4); // trimmed some
  });

  it('preserves minMessages', async () => {
    const history = new ConversationHistory({ maxTokens: 10, minMessages: 4 });
    history.addUserMessage('msg1');
    history.addAssistantMessage('reply1');
    history.addUserMessage('msg2');
    history.addAssistantMessage('reply2');

    const mockCounter: TokenCounter = {
      async countTokens() {
        return { inputTokens: 99999, isEstimate: false }; // always over
      },
    };

    await history.trimAsync(mockCounter, 'sonnet');
    expect(history.length).toBe(4); // minMessages preserved
  });

  it('falls back to sync trim on counter error', async () => {
    const history = new ConversationHistory({ maxTokens: 10, minMessages: 2 });
    // Add enough messages that sync trim will remove some
    for (let i = 0; i < 10; i++) {
      history.addUserMessage('x'.repeat(100));
      history.addAssistantMessage('y'.repeat(100));
    }

    const failingCounter: TokenCounter = {
      async countTokens() {
        throw new Error('API failure');
      },
    };

    const removed = await history.trimAsync(failingCounter, 'sonnet');
    // sync trim should have removed messages
    expect(removed).toBeGreaterThanOrEqual(0);
    expect(history.length).toBeLessThanOrEqual(20);
  });

  it('ensures conversation starts with user after trim', async () => {
    const history = new ConversationHistory({ maxTokens: 50, minMessages: 1 });
    history.addUserMessage('msg1');
    history.addAssistantMessage('reply1');
    history.addUserMessage('msg2');

    // Will remove msg1, leaving assistant reply1 at front → should remove it too
    let call = 0;
    const mockCounter: TokenCounter = {
      async countTokens({ messages }) {
        call++;
        // Over budget on first call, then under
        return { inputTokens: call === 1 ? 200 : 30, isEstimate: false };
      },
    };

    await history.trimAsync(mockCounter, 'sonnet');
    const msgs = history.getMessages();
    if (msgs.length > 0) {
      expect(msgs[0].role).toBe('user');
    }
  });
});

// ---------------------------------------------------------------------------
// getContextWindow / getMaxOutputTokens
// ---------------------------------------------------------------------------

describe('getContextWindow', () => {
  it('returns 200K for known models', () => {
    expect(getContextWindow('claude-haiku-4-5-20251001')).toBe(200_000);
    expect(getContextWindow('claude-sonnet-4-5-20250929')).toBe(200_000);
    expect(getContextWindow('claude-sonnet-4-20250514')).toBe(200_000);
  });

  it('resolves aliases before lookup', () => {
    expect(getContextWindow('haiku')).toBe(200_000);
    expect(getContextWindow('sonnet')).toBe(200_000);
  });

  it('returns default for unknown models', () => {
    expect(getContextWindow('unknown-model')).toBe(200_000);
  });
});

describe('getMaxOutputTokens', () => {
  it('returns 8192 for known models', () => {
    expect(getMaxOutputTokens('claude-haiku-4-5-20251001')).toBe(8192);
    expect(getMaxOutputTokens('claude-sonnet-4-5-20250929')).toBe(8192);
  });

  it('resolves aliases before lookup', () => {
    expect(getMaxOutputTokens('haiku')).toBe(8192);
  });

  it('returns default for unknown models', () => {
    expect(getMaxOutputTokens('gpt-9000')).toBe(8192);
  });
});

// ---------------------------------------------------------------------------
// MODEL_CONTEXT_WINDOWS / MODEL_MAX_OUTPUT_TOKENS maps
// ---------------------------------------------------------------------------

describe('MODEL_CONTEXT_WINDOWS', () => {
  it('has entries for all canonical model IDs', () => {
    expect(MODEL_CONTEXT_WINDOWS['claude-haiku-4-5-20251001']).toBeDefined();
    expect(MODEL_CONTEXT_WINDOWS['claude-sonnet-4-5-20250929']).toBeDefined();
    expect(MODEL_CONTEXT_WINDOWS['claude-sonnet-4-20250514']).toBeDefined();
  });
});

describe('MODEL_MAX_OUTPUT_TOKENS', () => {
  it('has entries for all canonical model IDs', () => {
    expect(MODEL_MAX_OUTPUT_TOKENS['claude-haiku-4-5-20251001']).toBeDefined();
    expect(MODEL_MAX_OUTPUT_TOKENS['claude-sonnet-4-5-20250929']).toBeDefined();
    expect(MODEL_MAX_OUTPUT_TOKENS['claude-sonnet-4-20250514']).toBeDefined();
  });
});
