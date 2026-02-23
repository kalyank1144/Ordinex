/**
 * A8: Intent Routing Integration Tests
 *
 * Tests the full routing pipeline from extension perspective:
 * slash overrides, workspace quick-reject, LLM classification, heuristic fallback.
 * Supplements the core-package intentClassifier tests with extension-level scenarios.
 */

import { describe, it, expect } from 'vitest';
import { routeIntent } from 'core/src/intent/intentRouter';
import type { LLMClient, LLMClientResponse, ConversationMessage, ToolSchema } from 'core/src/agenticLoop';
import type { ToolChoice } from 'core/src/toolSchemas';
import type { WorkspaceState } from 'core/src/intent/intentRouter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLLMClient(intent: 'SCAFFOLD' | 'AGENT', confidence = 0.9): LLMClient {
  return {
    async createMessage(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ConversationMessage[];
      tools?: ToolSchema[];
      tool_choice?: ToolChoice;
    }): Promise<LLMClientResponse> {
      return {
        id: 'mock-resp',
        content: [{
          type: 'tool_use',
          id: 'tc-1',
          name: 'classify_intent',
          input: { intent, confidence, reasoning: `Test: ${intent}` },
        }],
        stop_reason: 'tool_use',
      };
    },
  };
}

const EMPTY: WorkspaceState = { fileCount: 0, hasPackageJson: false, hasGitRepo: false };
const SMALL_NODE: WorkspaceState = { fileCount: 3, hasPackageJson: true, hasGitRepo: false };
const LARGE_NODE: WorkspaceState = { fileCount: 80, hasPackageJson: true, hasGitRepo: true };
const LARGE_PYTHON: WorkspaceState = { fileCount: 40, hasPackageJson: false, hasGitRepo: true };
const TINY_NO_PKG: WorkspaceState = { fileCount: 2, hasPackageJson: false, hasGitRepo: false };

// ---------------------------------------------------------------------------
// Slash Override Tests
// ---------------------------------------------------------------------------

describe('routeIntent — slash overrides', () => {
  it('/scaffold routes to SCAFFOLD in empty workspace', async () => {
    const result = await routeIntent('/scaffold my-app', { workspace: EMPTY });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('slash');
    expect(result.confidence).toBe(1.0);
  });

  it('/scaffold routes to SCAFFOLD even in existing project', async () => {
    const result = await routeIntent('/scaffold redesign', { workspace: LARGE_NODE });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('slash');
  });

  it('/scaffold overrides LLM client that would say AGENT', async () => {
    const client = mockLLMClient('AGENT');
    const result = await routeIntent('/scaffold new dashboard', {
      workspace: LARGE_NODE,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('slash');
  });

  it('normal prompt with "scaffold" in text does NOT trigger slash override', async () => {
    const result = await routeIntent('How does the scaffold pipeline work?', {
      workspace: LARGE_NODE,
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).not.toBe('slash');
  });
});

// ---------------------------------------------------------------------------
// Quick-Reject Tests
// ---------------------------------------------------------------------------

describe('routeIntent — filesystem quick-reject', () => {
  it('rejects to AGENT for large Node project', async () => {
    const client = mockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a landing page', {
      workspace: LARGE_NODE,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });

  it('rejects to AGENT for small Node project (package.json alone triggers)', async () => {
    const client = mockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a landing page', {
      workspace: SMALL_NODE,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });

  it('rejects to AGENT for large Python project (no package.json, high fileCount)', async () => {
    const client = mockLLMClient('SCAFFOLD');
    const result = await routeIntent('Create a new web app', {
      workspace: LARGE_PYTHON,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });

  it('does NOT quick-reject tiny workspace without package.json', async () => {
    const client = mockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a landing page', {
      workspace: TINY_NO_PKG,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('llm');
  });
});

// ---------------------------------------------------------------------------
// LLM Classification Tests
// ---------------------------------------------------------------------------

describe('routeIntent — LLM classification', () => {
  it('uses LLM for empty workspace', async () => {
    const client = mockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a SaaS dashboard', {
      workspace: EMPTY,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('llm');
  });

  it('LLM can classify as AGENT in empty workspace', async () => {
    const client = mockLLMClient('AGENT');
    const result = await routeIntent('What is TypeScript?', {
      workspace: EMPTY,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('llm');
  });

  it('uses LLM for tiny no-package workspace', async () => {
    const client = mockLLMClient('SCAFFOLD', 0.85);
    const result = await routeIntent('Create a React app with Tailwind', {
      workspace: TINY_NO_PKG,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('llm');
    expect(result.confidence).toBe(0.85);
  });

  it('uses LLM when workspace is undefined', async () => {
    const client = mockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a portfolio site', {
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('llm');
  });
});

// ---------------------------------------------------------------------------
// Heuristic Fallback Tests
// ---------------------------------------------------------------------------

describe('routeIntent — heuristic fallback', () => {
  it('uses heuristic when LLM client not provided', async () => {
    const result = await routeIntent('Create a new fitness tracking app', {
      workspace: EMPTY,
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('heuristic');
  });

  it('uses heuristic when LLM throws', async () => {
    const failingClient: LLMClient = {
      async createMessage() { throw new Error('Network timeout'); },
    };
    const result = await routeIntent('Build me a landing page', {
      workspace: EMPTY,
      llmClient: failingClient,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('heuristic');
  });

  it('skips heuristic for non-empty workspace without LLM', async () => {
    const midWorkspace: WorkspaceState = { fileCount: 8, hasPackageJson: false, hasGitRepo: true };
    const result = await routeIntent('Build me a landing page', {
      workspace: midWorkspace,
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });

  it('defaults to AGENT when heuristic has low confidence', async () => {
    const result = await routeIntent('hello', { workspace: EMPTY });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('routeIntent — edge cases', () => {
  it('handles empty string input', async () => {
    const result = await routeIntent('', { workspace: EMPTY });
    expect(result.intent).toBe('AGENT');
  });

  it('handles whitespace-only input', async () => {
    const result = await routeIntent('   \n  ', { workspace: EMPTY });
    expect(result.intent).toBe('AGENT');
  });

  it('handles no context at all', async () => {
    const result = await routeIntent('Build an app');
    expect(['SCAFFOLD', 'AGENT']).toContain(result.intent);
  });

  it('preserves confidence from LLM classification', async () => {
    const client = mockLLMClient('SCAFFOLD', 0.72);
    const result = await routeIntent('Make me a blog', {
      workspace: EMPTY,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.confidence).toBe(0.72);
  });

  it('workspace with exactly 10 files (boundary) passes through to LLM', async () => {
    const boundary: WorkspaceState = { fileCount: 10, hasPackageJson: false, hasGitRepo: false };
    const client = mockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a landing page', {
      workspace: boundary,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('llm');
  });

  it('workspace with 11 files (above boundary) triggers quick-reject', async () => {
    const boundary: WorkspaceState = { fileCount: 11, hasPackageJson: false, hasGitRepo: false };
    const client = mockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a landing page', {
      workspace: boundary,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });
});
