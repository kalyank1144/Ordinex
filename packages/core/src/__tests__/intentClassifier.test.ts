/**
 * Intent Classifier Tests — LLM-first classification via tool_use
 *
 * Uses a mock LLM client that returns deterministic tool_use responses.
 */

import { describe, it, expect } from 'vitest';
import { classifyIntentWithLLM } from '../intent/intentClassifier';
import { routeIntent } from '../intent/intentRouter';
import type { LLMClient, LLMClientResponse, ConversationMessage, ToolSchema } from '../agenticLoop';
import type { ToolChoice } from '../toolSchemas';
import type { WorkspaceState } from '../intent/intentRouter';

function createMockLLMClient(intent: 'SCAFFOLD' | 'AGENT', confidence = 0.95): LLMClient {
  return {
    async createMessage(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ConversationMessage[];
      tools?: ToolSchema[];
      tool_choice?: ToolChoice;
    }): Promise<LLMClientResponse> {
      expect(params.tool_choice).toEqual({ type: 'tool', name: 'classify_intent' });

      const tool = params.tools?.find(t => t.name === 'classify_intent');
      expect(tool).toBeDefined();
      expect(tool?.strict).toBe(true);

      return {
        id: 'mock-response',
        content: [
          {
            type: 'tool_use',
            id: 'tool-call-1',
            name: 'classify_intent',
            input: {
              intent,
              confidence,
              reasoning: `Mock classification: ${intent}`,
            },
          },
        ],
        stop_reason: 'tool_use',
      };
    },
  };
}

const EMPTY_WORKSPACE: WorkspaceState = { fileCount: 0, hasPackageJson: false, hasGitRepo: false };
const PROJECT_WORKSPACE: WorkspaceState = { fileCount: 50, hasPackageJson: true, hasGitRepo: true };

describe('classifyIntentWithLLM', () => {
  it('returns SCAFFOLD when LLM classifies as SCAFFOLD', async () => {
    const client = createMockLLMClient('SCAFFOLD');
    const result = await classifyIntentWithLLM('Build me a landing page', EMPTY_WORKSPACE, client, 'claude-sonnet-4-20250514');
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.confidence).toBe(0.95);
    expect(result.reasoning).toBe('Mock classification: SCAFFOLD');
  });

  it('returns AGENT when LLM classifies as AGENT', async () => {
    const client = createMockLLMClient('AGENT');
    const result = await classifyIntentWithLLM('What is React?', EMPTY_WORKSPACE, client, 'claude-sonnet-4-20250514');
    expect(result.intent).toBe('AGENT');
    expect(result.confidence).toBe(0.95);
  });

  it('passes workspace info in the user message', async () => {
    let capturedMessage = '';
    const client: LLMClient = {
      async createMessage(params) {
        const userMsg = params.messages[0];
        capturedMessage = typeof userMsg.content === 'string' ? userMsg.content : '';
        return {
          id: 'mock',
          content: [{
            type: 'tool_use',
            id: 'tc1',
            name: 'classify_intent',
            input: { intent: 'SCAFFOLD', confidence: 0.9, reasoning: 'test' },
          }],
          stop_reason: 'tool_use',
        };
      },
    };

    await classifyIntentWithLLM('Build me an app', EMPTY_WORKSPACE, client, 'claude-sonnet-4-20250514');
    expect(capturedMessage).toContain('package.json: no');
    expect(capturedMessage).toContain('0 visible files');
    expect(capturedMessage).toContain('Build me an app');
  });

  it('throws when no tool_use block in response', async () => {
    const client: LLMClient = {
      async createMessage() {
        return {
          id: 'mock',
          content: [{ type: 'text', text: 'SCAFFOLD' }],
          stop_reason: 'end_turn',
        };
      },
    };

    await expect(
      classifyIntentWithLLM('Build an app', EMPTY_WORKSPACE, client, 'claude-sonnet-4-20250514'),
    ).rejects.toThrow('no tool_use block');
  });
});

describe('routeIntent with LLM client', () => {
  it('uses LLM classification for empty workspace', async () => {
    const client = createMockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a landing page', {
      workspace: EMPTY_WORKSPACE,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('llm');
  });

  it('LLM can classify as AGENT in empty workspace', async () => {
    const client = createMockLLMClient('AGENT');
    const result = await routeIntent('What is React?', {
      workspace: EMPTY_WORKSPACE,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('llm');
  });

  it('quick-rejects existing project regardless of LLM', async () => {
    const client = createMockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a dashboard', {
      workspace: PROJECT_WORKSPACE,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });

  it('quick-rejects small project with package.json (fileCount < 10)', async () => {
    const smallProject: WorkspaceState = { fileCount: 3, hasPackageJson: true, hasGitRepo: false };
    const client = createMockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a landing page', {
      workspace: smallProject,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });

  it('quick-rejects large non-Node workspace (no package.json, many files)', async () => {
    const pythonProject: WorkspaceState = { fileCount: 40, hasPackageJson: false, hasGitRepo: true };
    const client = createMockLLMClient('SCAFFOLD');
    const result = await routeIntent('Build me a dashboard', {
      workspace: pythonProject,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('AGENT');
    expect(result.source).toBe('passthrough');
  });

  it('slash override wins over LLM', async () => {
    const client = createMockLLMClient('AGENT');
    const result = await routeIntent('/scaffold my app', {
      workspace: PROJECT_WORKSPACE,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('slash');
  });

  it('falls back to heuristic when LLM fails', async () => {
    const client: LLMClient = {
      async createMessage() {
        throw new Error('Network error');
      },
    };
    const result = await routeIntent('Creating a new fitness app', {
      workspace: EMPTY_WORKSPACE,
      llmClient: client,
      modelId: 'claude-sonnet-4-20250514',
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('heuristic');
  });

  it('falls back to heuristic when no LLM client provided', async () => {
    const result = await routeIntent('Creating a new fitness app', {
      workspace: EMPTY_WORKSPACE,
    });
    expect(result.intent).toBe('SCAFFOLD');
    expect(result.source).toBe('heuristic');
  });
});
