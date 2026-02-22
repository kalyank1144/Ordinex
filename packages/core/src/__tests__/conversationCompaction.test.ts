/**
 * ConversationHistory Auto-Compaction Tests
 */

import { describe, it, expect } from 'vitest';
import { ConversationHistory } from '../conversationHistory';

describe('ConversationHistory — Auto-Compaction', () => {
  describe('maybeCompact', () => {
    it('does not compact when below threshold', async () => {
      const h = new ConversationHistory();
      h.addUserMessage('Hello');
      h.addAssistantMessage('Hi there!');

      const result = await h.maybeCompact({ modelContextWindow: 200_000 });
      expect(result.compacted).toBe(false);
      expect(h.compactionCount).toBe(0);
    });

    it('compacts when above 75% of model window', async () => {
      const h = new ConversationHistory({ charsPerToken: 1 });

      // Add enough messages to exceed 75% of a small window
      for (let i = 0; i < 20; i++) {
        h.addUserMessage('x'.repeat(500));
        h.addAssistantMessage('y'.repeat(500));
      }

      const result = await h.maybeCompact({ modelContextWindow: 10_000 });
      expect(result.compacted).toBe(true);
      expect(result.tokensSaved).toBeGreaterThan(0);
      expect(h.compactionCount).toBe(1);
    });

    it('keeps last 3 exchanges verbatim', async () => {
      const h = new ConversationHistory({ charsPerToken: 1 });

      for (let i = 0; i < 20; i++) {
        h.addUserMessage(`User message ${i} ${'x'.repeat(400)}`);
        h.addAssistantMessage(`Assistant message ${i} ${'y'.repeat(400)}`);
      }

      await h.maybeCompact({ modelContextWindow: 10_000 });

      const messages = h.getMessages();
      // Should have: 1 summary user + 1 summary assistant + 6 recent (3 exchanges)
      expect(messages.length).toBe(8);
      // Last message should be the most recent
      const lastMsg = messages[messages.length - 1];
      expect(typeof lastMsg.content === 'string' && lastMsg.content).toContain('Assistant message 19');
    });

    it('extracts error messages in compacted summary', async () => {
      const h = new ConversationHistory({ charsPerToken: 1 });

      h.addUserMessage('Please fix my code');
      h.addAssistantMessage('I see a TypeError: Cannot read property x in src/App.tsx');
      // Add enough to trigger compaction
      for (let i = 0; i < 20; i++) {
        h.addUserMessage('More content '.repeat(50));
        h.addAssistantMessage('Response '.repeat(50));
      }

      await h.maybeCompact({ modelContextWindow: 10_000 });

      const messages = h.getMessages();
      const summaryMsg = messages[0];
      expect(typeof summaryMsg.content === 'string' && summaryMsg.content).toContain('error');
    });

    it('increments compactionCount on each compaction', async () => {
      const h = new ConversationHistory({ charsPerToken: 1 });

      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 20; i++) {
          h.addUserMessage('x'.repeat(500));
          h.addAssistantMessage('y'.repeat(500));
        }
        await h.maybeCompact({ modelContextWindow: 10_000 });
      }

      expect(h.compactionCount).toBe(3);
    });

    it('does not compact when there are too few messages', async () => {
      const h = new ConversationHistory({ charsPerToken: 1 });
      // Add 3 exchanges (6 messages) — same as the "keep recent" count
      for (let i = 0; i < 3; i++) {
        h.addUserMessage('x'.repeat(2000));
        h.addAssistantMessage('y'.repeat(2000));
      }

      const result = await h.maybeCompact({ modelContextWindow: 5_000 });
      // Even though token count exceeds threshold, there's nothing older to compact
      expect(result.compacted).toBe(false);
    });
  });

  describe('extractKeyFacts (via compaction)', () => {
    it('extracts file paths from conversation', async () => {
      const h = new ConversationHistory({ charsPerToken: 1 });

      h.addUserMessage('Please update src/components/Header.tsx and src/App.tsx');
      h.addAssistantMessage('Done! I updated both files.');
      // Fill enough to trigger compaction
      for (let i = 0; i < 20; i++) {
        h.addUserMessage('x'.repeat(500));
        h.addAssistantMessage('y'.repeat(500));
      }

      await h.maybeCompact({ modelContextWindow: 10_000 });

      const messages = h.getMessages();
      const summary = typeof messages[0].content === 'string' ? messages[0].content : '';
      expect(summary).toContain('Header.ts');
    });

    it('extracts commands from conversation', async () => {
      const h = new ConversationHistory({ charsPerToken: 1 });

      h.addUserMessage('Run npm run build');
      h.addAssistantMessage('Build completed.');
      for (let i = 0; i < 20; i++) {
        h.addUserMessage('x'.repeat(500));
        h.addAssistantMessage('y'.repeat(500));
      }

      await h.maybeCompact({ modelContextWindow: 10_000 });

      const messages = h.getMessages();
      const summary = typeof messages[0].content === 'string' ? messages[0].content : '';
      expect(summary).toContain('npm run');
    });
  });
});
