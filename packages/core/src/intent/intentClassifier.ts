/**
 * LLM-based Intent Classifier — uses Anthropic tool_use with forced
 * tool_choice and strict schema for guaranteed structured output.
 *
 * This is the PRIMARY intent classification path. The regex-based
 * greenfieldDetector.ts is an offline-only fallback for when no API key
 * is available.
 */

import type { LLMClient } from '../agenticLoop';
import type { ToolSchema, ToolChoice } from '../toolSchemas';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

const CLASSIFY_INTENT_TOOL: ToolSchema = {
  name: 'classify_intent',
  description:
    'Classify the user\'s intent. SCAFFOLD means create a brand-new project from scratch. ' +
    'AGENT means work with existing code, answer questions, or any non-creation task.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: ['SCAFFOLD', 'AGENT'],
        description:
          'SCAFFOLD — user wants to create/build/make a new project, app, page, site, or tool from scratch. ' +
          'AGENT — everything else: questions, modifications, fixes, explanations, running commands.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence level from 0.0 to 1.0',
      },
      reasoning: {
        type: 'string',
        description: 'One-sentence explanation of why this intent was chosen',
      },
    },
    required: ['intent', 'confidence', 'reasoning'],
  },
};

const FORCED_TOOL_CHOICE: ToolChoice = {
  type: 'tool',
  name: 'classify_intent',
};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are an intent classifier for a VS Code coding assistant. Your job is to determine whether the user wants to CREATE a new project from scratch (SCAFFOLD) or do something else (AGENT).

Rules:
- SCAFFOLD: The user wants to build, create, make, or generate something NEW — an app, website, landing page, dashboard, API, portfolio, tool, component library, or any other project. The key signal is they want something that doesn't exist yet.
- AGENT: Everything else — questions, explanations, modifying existing code, fixing bugs, running commands, code reviews, refactoring, adding features to an existing project.

You will receive the user's prompt and their workspace state. Use both to make your decision.`;

// ============================================================================
// CLASSIFIER
// ============================================================================

export interface ClassificationResult {
  intent: 'SCAFFOLD' | 'AGENT';
  confidence: number;
  reasoning: string;
}

export async function classifyIntentWithLLM(
  prompt: string,
  workspace: { fileCount: number; hasPackageJson: boolean; hasGitRepo: boolean } | undefined,
  llmClient: LLMClient,
  modelId: string,
): Promise<ClassificationResult> {
  const workspaceDesc = workspace
    ? `Workspace: ${workspace.fileCount} visible files, ` +
      `package.json: ${workspace.hasPackageJson ? 'yes' : 'no'}, ` +
      `git repo: ${workspace.hasGitRepo ? 'yes' : 'no'}`
    : 'Workspace: unknown (no workspace info available)';

  const userMessage = `${workspaceDesc}\n\nUser prompt: "${prompt}"`;

  const response = await llmClient.createMessage({
    model: modelId,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools: [CLASSIFY_INTENT_TOOL],
    tool_choice: FORCED_TOOL_CHOICE,
  });

  const toolBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('Intent classification: no tool_use block in response');
  }

  const input = toolBlock.input as Record<string, unknown>;
  return {
    intent: input.intent as 'SCAFFOLD' | 'AGENT',
    confidence: (input.confidence as number) ?? 1.0,
    reasoning: (input.reasoning as string) ?? '',
  };
}
