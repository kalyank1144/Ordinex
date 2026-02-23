/**
 * Feature Extractor Tests
 *
 * Tests for LLM-powered feature requirement extraction from user prompts.
 */

import { describe, it, expect } from 'vitest';
import {
  extractFeatureRequirements,
  hasSpecificFeature,
  parseFeatureRequirements,
  FeatureLLMClient,
} from '../scaffold/featureExtractor';

// ============================================================================
// MOCK LLM CLIENT
// ============================================================================

function createMockLLMClient(response: string): FeatureLLMClient {
  return {
    async createMessage() {
      return {
        content: [{ type: 'text', text: response }],
      };
    },
  };
}

function createFailingLLMClient(): FeatureLLMClient {
  return {
    async createMessage() {
      throw new Error('API error: rate limit exceeded');
    },
  };
}

// ============================================================================
// hasSpecificFeature TESTS
// ============================================================================

describe('hasSpecificFeature', () => {
  it('returns true for "create a todo app"', () => {
    expect(hasSpecificFeature('create a todo app')).toBe(true);
  });

  it('returns true for "build a blog platform"', () => {
    expect(hasSpecificFeature('build a blog platform')).toBe(true);
  });

  it('returns true for "make an ecommerce store"', () => {
    expect(hasSpecificFeature('make an ecommerce store')).toBe(true);
  });

  it('returns true for "create a dashboard app"', () => {
    expect(hasSpecificFeature('create a dashboard app')).toBe(true);
  });

  it('returns true for "build a chat application"', () => {
    expect(hasSpecificFeature('build a chat application')).toBe(true);
  });

  it('returns true for "create a recipe tracker"', () => {
    expect(hasSpecificFeature('create a recipe tracker')).toBe(true);
  });

  it('returns false for "create a new app"', () => {
    expect(hasSpecificFeature('create a new app')).toBe(false);
  });

  it('returns false for "create a react app"', () => {
    expect(hasSpecificFeature('create a react app')).toBe(false);
  });

  it('returns false for "build a next.js project"', () => {
    expect(hasSpecificFeature('build a next.js project')).toBe(false);
  });

  it('returns false for "scaffold a new project"', () => {
    expect(hasSpecificFeature('scaffold a new project')).toBe(false);
  });

  it('returns false for "create a vite app"', () => {
    expect(hasSpecificFeature('create a vite app')).toBe(false);
  });

  it('returns true for prompts with auth mention', () => {
    expect(hasSpecificFeature('create an app with login')).toBe(true);
  });

  it('returns true for "build a kanban board"', () => {
    expect(hasSpecificFeature('build a kanban board')).toBe(true);
  });
});

// ============================================================================
// parseFeatureRequirements TESTS
// ============================================================================

describe('parseFeatureRequirements', () => {
  it('parses valid JSON response', () => {
    const json = JSON.stringify({
      app_type: 'todo',
      features: ['add task', 'complete task', 'delete task'],
      data_model: [
        {
          name: 'Task',
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'title', type: 'string', required: true },
            { name: 'completed', type: 'boolean', required: true },
          ],
        },
      ],
      pages: [
        { path: '/', description: 'Main task list', components: ['TaskList', 'TaskForm'] },
      ],
      has_auth: false,
      has_database: false,
      styling_preference: 'minimal',
    });

    const result = parseFeatureRequirements(json);
    expect(result).not.toBeNull();
    expect(result!.app_type).toBe('todo');
    expect(result!.features).toHaveLength(3);
    expect(result!.data_model).toHaveLength(1);
    expect(result!.data_model[0].name).toBe('Task');
    expect(result!.pages).toHaveLength(1);
    expect(result!.has_auth).toBe(false);
    expect(result!.has_database).toBe(false);
  });

  it('handles JSON wrapped in markdown code block', () => {
    const response = '```json\n{"app_type":"blog","features":["list posts"],"data_model":[],"pages":[],"has_auth":false,"has_database":false}\n```';
    const result = parseFeatureRequirements(response);
    expect(result).not.toBeNull();
    expect(result!.app_type).toBe('blog');
  });

  it('handles JSON wrapped in plain code block', () => {
    const response = '```\n{"app_type":"chat","features":["send message"],"data_model":[],"pages":[],"has_auth":false,"has_database":false}\n```';
    const result = parseFeatureRequirements(response);
    expect(result).not.toBeNull();
    expect(result!.app_type).toBe('chat');
  });

  it('returns null for invalid JSON', () => {
    expect(parseFeatureRequirements('not json')).toBeNull();
  });

  it('returns null when app_type is missing', () => {
    expect(parseFeatureRequirements('{"features":[]}')).toBeNull();
  });

  it('returns null when features is not an array', () => {
    expect(parseFeatureRequirements('{"app_type":"todo","features":"not array"}')).toBeNull();
  });

  it('provides defaults for missing optional fields', () => {
    const json = JSON.stringify({
      app_type: 'test',
      features: ['feature1'],
    });

    const result = parseFeatureRequirements(json);
    expect(result).not.toBeNull();
    expect(result!.data_model).toEqual([]);
    expect(result!.pages).toEqual([]);
    expect(result!.has_auth).toBe(false);
    expect(result!.has_database).toBe(false);
    expect(result!.styling_preference).toBe('minimal');
  });

  it('filters invalid feature entries', () => {
    const json = JSON.stringify({
      app_type: 'test',
      features: ['valid', 123, null, 'also valid'],
    });

    const result = parseFeatureRequirements(json);
    expect(result!.features).toEqual(['valid', 'also valid']);
  });

  it('validates data model structure', () => {
    const json = JSON.stringify({
      app_type: 'test',
      features: ['f1'],
      data_model: [
        { name: 'Valid', fields: [{ name: 'id', type: 'string', required: true }] },
        { invalid: true }, // Missing name
        { name: 'NoFields' }, // Missing fields array
      ],
    });

    const result = parseFeatureRequirements(json);
    expect(result!.data_model).toHaveLength(1);
    expect(result!.data_model[0].name).toBe('Valid');
  });

  it('validates page structure', () => {
    const json = JSON.stringify({
      app_type: 'test',
      features: ['f1'],
      pages: [
        { path: '/', description: 'Home', components: ['App'] },
        { no_path: true }, // Missing path
      ],
    });

    const result = parseFeatureRequirements(json);
    expect(result!.pages).toHaveLength(1);
    expect(result!.pages[0].path).toBe('/');
  });
});

// ============================================================================
// extractFeatureRequirements TESTS
// ============================================================================

describe('extractFeatureRequirements', () => {
  it('extracts requirements from LLM response', async () => {
    const mockResponse = JSON.stringify({
      app_type: 'todo',
      features: ['add task', 'mark complete', 'delete task'],
      data_model: [
        {
          name: 'Task',
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'title', type: 'string', required: true },
            { name: 'completed', type: 'boolean', required: true },
          ],
        },
      ],
      pages: [
        { path: '/', description: 'Task list', components: ['TaskList', 'TaskForm'] },
      ],
      has_auth: false,
      has_database: false,
    });

    const client = createMockLLMClient(mockResponse);
    const result = await extractFeatureRequirements('create a todo app', 'nextjs_app_router', client, 'claude-haiku-4-5-20251001');

    expect(result).not.toBeNull();
    expect(result!.app_type).toBe('todo');
    expect(result!.features).toContain('add task');
    expect(result!.data_model[0].name).toBe('Task');
  });

  it('returns null when LLM fails', async () => {
    const client = createFailingLLMClient();
    const result = await extractFeatureRequirements('create a todo app', 'nextjs_app_router', client, 'claude-haiku-4-5-20251001');
    expect(result).toBeNull();
  });

  it('returns null when LLM returns empty content', async () => {
    const client: FeatureLLMClient = {
      async createMessage() {
        return { content: [] };
      },
    };
    const result = await extractFeatureRequirements('create a todo app', 'nextjs_app_router', client, 'claude-haiku-4-5-20251001');
    expect(result).toBeNull();
  });

  it('returns null when LLM returns invalid JSON', async () => {
    const client = createMockLLMClient('This is not JSON');
    const result = await extractFeatureRequirements('create a todo app', 'nextjs_app_router', client, 'claude-haiku-4-5-20251001');
    expect(result).toBeNull();
  });

  it('passes recipe context to LLM', async () => {
    let capturedMessages: any;
    const client: FeatureLLMClient = {
      async createMessage(params) {
        capturedMessages = params.messages;
        return {
          content: [{ type: 'text', text: JSON.stringify({ app_type: 'test', features: ['f'] }) }],
        };
      },
    };

    await extractFeatureRequirements('create a todo app', 'vite_react', client, 'claude-haiku-4-5-20251001');
    expect(capturedMessages[0].content).toContain('Vite');
  });
});
