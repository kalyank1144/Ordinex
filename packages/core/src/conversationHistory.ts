/**
 * ConversationHistory — Multi-turn conversation state for LLM interactions (A2)
 *
 * Pure core class (P1 compliant — no FS, no side effects).
 * Stores the message array for Anthropic Messages API and provides
 * sliding-window trimming to stay within token budgets.
 */

import { estimateTokensImproved } from './tokenCounter';
import type { TokenCounter } from './tokenCounter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single content block inside a message (text or tool_use/tool_result) */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean };

/** A conversation message in the Anthropic Messages API format */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** Configuration for conversation history management */
export interface ConversationHistoryConfig {
  /** Max estimated tokens before trimming oldest messages (default 100_000) */
  maxTokens: number;
  /** Min messages to always keep (most recent N), even when trimming (default 4) */
  minMessages: number;
  /** Average chars-per-token estimate for fast token counting (default 4) */
  charsPerToken: number;
}

const DEFAULT_CONFIG: ConversationHistoryConfig = {
  maxTokens: 100_000,
  minMessages: 4,
  charsPerToken: 4,
};

// ---------------------------------------------------------------------------
// ConversationHistory class
// ---------------------------------------------------------------------------

export class ConversationHistory {
  private messages: ConversationMessage[] = [];
  private readonly config: ConversationHistoryConfig;

  constructor(config?: Partial<ConversationHistoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Mutators
  // -----------------------------------------------------------------------

  /** Append a user message */
  addUserMessage(content: string | ContentBlock[]): void {
    this.messages.push({ role: 'user', content });
  }

  /** Append an assistant message */
  addAssistantMessage(content: string | ContentBlock[]): void {
    this.messages.push({ role: 'assistant', content });
  }

  /** Append a generic message (user or assistant) */
  addMessage(msg: ConversationMessage): void {
    this.messages.push({ ...msg });
  }

  /** Remove all messages */
  clear(): void {
    this.messages = [];
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Return a shallow copy of all messages (safe to pass to API) */
  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  /** Number of messages currently stored */
  get length(): number {
    return this.messages.length;
  }

  /** Most recent message, or undefined if empty */
  lastMessage(): ConversationMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  // -----------------------------------------------------------------------
  // Token estimation
  // -----------------------------------------------------------------------

  /**
   * Fast token estimate based on character count.
   * Intentionally conservative (over-estimates) to avoid context overflow.
   */
  estimateTokens(): number {
    let chars = 0;
    for (const msg of this.messages) {
      chars += this.messageChars(msg);
    }
    return Math.ceil(chars / this.config.charsPerToken);
  }

  /** Estimate tokens for a single message */
  estimateMessageTokens(msg: ConversationMessage): number {
    return Math.ceil(this.messageChars(msg) / this.config.charsPerToken);
  }

  // -----------------------------------------------------------------------
  // Trimming / sliding window
  // -----------------------------------------------------------------------

  /**
   * Trim oldest messages until estimated token count is within budget.
   * Always preserves at least `config.minMessages` most-recent messages.
   * Returns the number of messages removed.
   *
   * Messages are removed in pairs (user + assistant) from the front to keep
   * the conversation valid (must start with user, alternate roles).
   */
  trim(): number {
    const { maxTokens, minMessages } = this.config;
    let removed = 0;

    while (
      this.messages.length > minMessages &&
      this.estimateTokens() > maxTokens
    ) {
      // Remove the oldest message
      this.messages.shift();
      removed++;
    }

    // Ensure conversation still starts with 'user' (Anthropic requirement)
    while (this.messages.length > 0 && this.messages[0].role !== 'user') {
      this.messages.shift();
      removed++;
    }

    return removed;
  }

  /**
   * Build the messages array for an API call.
   * Trims if over budget, then returns the messages.
   */
  toApiMessages(): ConversationMessage[] {
    this.trim();
    return this.getMessages();
  }

  // -----------------------------------------------------------------------
  // Improved token estimation (Task #5)
  // -----------------------------------------------------------------------

  /**
   * Improved token estimate using per-block-type ratios.
   * More accurate than estimateTokens() for code-heavy conversations.
   */
  estimateTokensImproved(): number {
    return estimateTokensImproved(this.messages);
  }

  // -----------------------------------------------------------------------
  // Async trimming with real token counter (Task #5)
  // -----------------------------------------------------------------------

  /**
   * Trim oldest messages using a real TokenCounter for accurate counts.
   * Falls back to sync trim() on counter error.
   * Returns the number of messages removed.
   */
  async trimAsync(counter: TokenCounter, model: string): Promise<number> {
    const { maxTokens, minMessages } = this.config;
    let removed = 0;

    try {
      while (this.messages.length > minMessages) {
        const result = await counter.countTokens({
          messages: this.messages,
          model,
        });

        if (result.inputTokens <= maxTokens) break;

        this.messages.shift();
        removed++;
      }

      // Ensure conversation still starts with 'user' (Anthropic requirement)
      while (this.messages.length > 0 && this.messages[0].role !== 'user') {
        this.messages.shift();
        removed++;
      }
    } catch {
      // Fallback to sync trim on any counter error
      if (removed === 0) {
        return this.trim();
      }
      // If we already removed some, do a final sync pass
      removed += this.trim();
    }

    return removed;
  }

  /**
   * Build the messages array for an API call using async token counting.
   * Falls back to sync toApiMessages() on error.
   */
  async toApiMessagesAsync(counter: TokenCounter, model: string): Promise<ConversationMessage[]> {
    await this.trimAsync(counter, model);
    return this.getMessages();
  }

  // -----------------------------------------------------------------------
  // Serialization (for persistence, not FS — caller handles I/O)
  // -----------------------------------------------------------------------

  /** Serialize to a JSON-safe object */
  toJSON(): { messages: ConversationMessage[]; config: ConversationHistoryConfig } {
    return {
      messages: this.getMessages(),
      config: { ...this.config },
    };
  }

  /** Restore from a previously serialized object */
  static fromJSON(data: {
    messages: ConversationMessage[];
    config?: Partial<ConversationHistoryConfig>;
  }): ConversationHistory {
    const history = new ConversationHistory(data.config);
    for (const msg of data.messages) {
      history.addMessage(msg);
    }
    return history;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private messageChars(msg: ConversationMessage): number {
    if (typeof msg.content === 'string') {
      return msg.content.length;
    }
    let total = 0;
    for (const block of msg.content) {
      if (block.type === 'text') {
        total += block.text.length;
      } else if (block.type === 'tool_use') {
        total += JSON.stringify(block.input).length + block.name.length;
      } else if (block.type === 'tool_result') {
        if (typeof block.content === 'string') {
          total += block.content.length;
        } else {
          total += JSON.stringify(block.content).length;
        }
      } else if (block.type === 'image') {
        // Images are expensive — rough estimate: 1000 tokens
        total += 4000;
      }
    }
    return total;
  }
}
