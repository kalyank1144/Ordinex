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

/** Result of a compaction attempt */
export interface CompactionResult {
  compacted: boolean;
  tokensUsed?: number;
  tokensBeforeCompaction?: number;
  tokensAfterCompaction?: number;
  tokensSaved?: number;
  compactionCount?: number;
}

/** Minimal LLM client for compaction summaries */
export interface CompactionLLMClient {
  createMessage(params: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: ConversationMessage[];
  }): Promise<{ content: Array<{ type: string; text?: string }> }>;
}

export class ConversationHistory {
  private messages: ConversationMessage[] = [];
  private readonly config: ConversationHistoryConfig;
  private _compactionCount = 0;

  constructor(config?: Partial<ConversationHistoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get compactionCount(): number {
    return this._compactionCount;
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
  // Auto-Compaction — summarize older messages when context grows large
  // -----------------------------------------------------------------------

  /**
   * Check if compaction is needed and do it.
   * Compacts at 75% of the real model window. The remaining 25% is reserved
   * for the current turn (prompt + tools + output).
   */
  async maybeCompact(options: {
    modelContextWindow: number;
    llmClient?: CompactionLLMClient;
  }): Promise<CompactionResult> {
    const currentTokens = this.estimateTokens();
    const threshold = options.modelContextWindow * 0.75;

    if (currentTokens < threshold) {
      return { compacted: false, tokensUsed: currentTokens };
    }

    this._compactionCount++;

    // Keep last 3 exchanges verbatim (most recent context)
    const recentMessages = this.messages.slice(-6);
    const olderMessages = this.messages.slice(0, -6);

    if (olderMessages.length === 0) {
      return { compacted: false, tokensUsed: currentTokens };
    }

    let summary: string;
    if (options.llmClient && this._compactionCount >= 3) {
      try {
        summary = await this.llmSummarize(olderMessages, options.llmClient);
      } catch {
        summary = this.extractKeyFacts(olderMessages);
      }
    } else {
      summary = this.extractKeyFacts(olderMessages);
    }

    this.messages = [
      { role: 'user', content: `[Session summary from ${olderMessages.length} previous messages]\n${summary}` },
      { role: 'assistant', content: 'Understood. I have context from our previous conversation. How can I help?' },
      ...recentMessages,
    ];

    const newTokens = this.estimateTokens();
    return {
      compacted: true,
      tokensBeforeCompaction: currentTokens,
      tokensAfterCompaction: newTokens,
      tokensSaved: currentTokens - newTokens,
      compactionCount: this._compactionCount,
    };
  }

  /**
   * Extract key facts from messages (free, instant, deterministic).
   * Extracts file paths, commands, error messages, and decisions.
   * Errors are highest priority — capped at 5 most recent.
   */
  private extractKeyFacts(messages: ConversationMessage[]): string {
    const facts: string[] = [];
    const errors: string[] = [];

    for (const msg of messages) {
      const text = this.messageText(msg);

      const filePaths = text.match(/[\w\-/.]+\.(ts|tsx|js|jsx|css|json|md)/g);
      if (filePaths) facts.push(`Files discussed: ${[...new Set(filePaths)].join(', ')}`);

      const commands = text.match(/(?:npm|pnpm|yarn|npx|node|python)\s+\S+/g);
      if (commands) facts.push(`Commands: ${[...new Set(commands)].join(', ')}`);

      const errorLines = text.split('\n').filter(line =>
        /\b(error|Error|ERROR|failed|Failed|TypeError|ReferenceError|SyntaxError|Cannot find module|Module not found|ENOENT|unexpected token)/i.test(line)
      );
      for (const errLine of errorLines) {
        const fileInError = errLine.match(/[\w\-/.]+\.(ts|tsx|js|jsx|css|json)/);
        const cleanError = errLine.trim().slice(0, 150);
        errors.push(fileInError ? `${cleanError} (in ${fileInError[0]})` : cleanError);
      }

      const decisions = text.match(/(?:decided|chose|using|switched to|created|built|fixed|added)\s+[^.]{10,60}/gi);
      if (decisions) facts.push(...decisions.slice(0, 5).map(d => d.trim()));
    }

    const recentErrors = errors.slice(-5);
    if (recentErrors.length > 0) {
      facts.unshift(`Recent errors:\n${recentErrors.join('\n')}`);
    }

    return [...new Set(facts)].slice(0, 25).join('\n');
  }

  /**
   * LLM-based summarization for high-quality compaction (used after 3+ compactions).
   */
  private async llmSummarize(messages: ConversationMessage[], client: CompactionLLMClient): Promise<string> {
    const messageTexts = messages.map(m => `${m.role}: ${this.messageText(m).slice(0, 500)}`).join('\n');
    const response = await client.createMessage({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      system: 'Summarize this conversation history concisely. Include: files discussed, key decisions, commands run, errors encountered, and what was built. Be specific with file paths and error messages.',
      messages: [{ role: 'user', content: `Summarize this conversation:\n\n${messageTexts}` }],
    });
    const textBlock = response.content.find(b => b.type === 'text' && b.text);
    return (textBlock as any)?.text || this.extractKeyFacts(messages);
  }

  private messageText(msg: ConversationMessage): string {
    if (typeof msg.content === 'string') return msg.content;
    return msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join(' ');
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
