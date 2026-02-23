/**
 * Feature Code Generator Tests
 *
 * Tests for LLM-powered feature code generation from extracted requirements.
 */

import { describe, it, expect } from 'vitest';
import {
  generateFeatureCode,
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
  parseGenerationResult,
  getRecipeConstraints,
  reduceFeatureScope,
} from '../scaffold/featureCodeGenerator';
import { generateTailwindConfig } from '../scaffold/designPacks';
import type { FeatureLLMClient } from '../scaffold/featureExtractor';
import type { FeatureRequirements } from '../types';
import type { DesignPack } from '../scaffold/designPacks';

// ============================================================================
// FIXTURES
// ============================================================================

const TODO_REQUIREMENTS: FeatureRequirements = {
  app_type: 'todo',
  features: ['add task', 'mark complete', 'delete task', 'filter by status'],
  data_model: [
    {
      name: 'Task',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'title', type: 'string', required: true },
        { name: 'completed', type: 'boolean', required: true },
        { name: 'createdAt', type: 'Date', required: true },
      ],
    },
  ],
  pages: [
    {
      path: '/',
      description: 'Main task list with add form and filters',
      components: ['TaskList', 'TaskForm', 'TaskFilter'],
    },
  ],
  has_auth: false,
  has_database: false,
  styling_preference: 'minimal',
};

const MOCK_DESIGN_PACK: DesignPack = {
  id: 'minimal-light',
  name: 'Minimal Light',
  vibe: 'minimal',
  tokens: {
    colors: {
      primary: '#0f172a',
      secondary: '#64748b',
      accent: '#0ea5e9',
      background: '#ffffff',
      foreground: '#0f172a',
      muted: '#f1f5f9',
      border: '#e2e8f0',
      primary_foreground: '#ffffff',
      secondary_foreground: '#ffffff',
      accent_foreground: '#ffffff',
      muted_foreground: '#64748b',
    },
    fonts: {
      heading: 'Inter',
      body: 'Inter',
    },
    radius: 'md',
    density: 'default',
    shadow: 'subtle',
  },
  preview: {
    imageAssetId: 'minimal-light',
    description: 'Clean, modern design',
  },
};

function createMockLLMClient(response: string, stopReason: string = 'end_turn'): FeatureLLMClient {
  return {
    async createMessage() {
      return {
        content: [{ type: 'text', text: response }],
        stop_reason: stopReason,
        usage: { input_tokens: 500, output_tokens: 1000 },
      };
    },
  };
}

// ============================================================================
// getRecipeConstraints TESTS
// ============================================================================

describe('getRecipeConstraints', () => {
  it('returns Next.js constraints', () => {
    const constraints = getRecipeConstraints('nextjs_app_router');
    expect(constraints.framework).toContain('Next.js');
    expect(constraints.homePagePath).toBe('app/page.tsx');
    expect(constraints.componentDir).toBe('components');
  });

  it('returns Vite constraints', () => {
    const constraints = getRecipeConstraints('vite_react');
    expect(constraints.framework).toContain('Vite');
    expect(constraints.homePagePath).toBe('src/App.tsx');
    expect(constraints.componentDir).toBe('src/components');
  });

  it('returns Expo constraints', () => {
    const constraints = getRecipeConstraints('expo');
    expect(constraints.framework).toContain('Expo');
    expect(constraints.homePagePath).toBe('app/index.tsx');
    expect(constraints.componentDir).toBe('components');
  });
});

// ============================================================================
// buildGenerationSystemPrompt TESTS
// ============================================================================

describe('buildGenerationSystemPrompt', () => {
  it('includes framework name', () => {
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', MOCK_DESIGN_PACK);
    expect(prompt).toContain('Next.js');
  });

  it('includes semantic Tailwind design token classes', () => {
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', MOCK_DESIGN_PACK);
    expect(prompt).toContain('bg-primary');
    expect(prompt).toContain('text-primary-foreground');
    expect(prompt).toContain('bg-accent');
    expect(prompt).toContain('border-border');
    expect(prompt).toContain('Minimal Light');
  });

  it('forbids arbitrary value syntax', () => {
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', MOCK_DESIGN_PACK);
    expect(prompt).toContain('Do NOT use arbitrary value syntax');
    // The old prompt recommended "- Primary: text-[var(--primary)] bg-[var(--primary)]" — that pattern should NOT appear
    expect(prompt).not.toContain('- Primary: text-[var(--primary)]');
  });

  it('includes visual quality rules', () => {
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', MOCK_DESIGN_PACK);
    expect(prompt).toContain('COMPLETELY replace default template content');
    expect(prompt).toContain('max-w-5xl');
    expect(prompt).toContain('empty states');
  });

  it('includes RSC rules for Next.js', () => {
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', MOCK_DESIGN_PACK);
    expect(prompt).toContain('use client');
    expect(prompt).toContain('Server Component');
  });

  it('does not include RSC rules for non-Next.js recipes', () => {
    const prompt = buildGenerationSystemPrompt('vite_react', MOCK_DESIGN_PACK);
    expect(prompt).not.toContain('Server Component');
  });

  it('includes project context when provided', () => {
    const projectContext = {
      tsconfigContent: '{ "compilerOptions": { "strict": true } }',
      packageJsonContent: '{ "dependencies": { "next": "14.0.0", "react": "18.2.0" } }',
      existingFiles: ['app/', 'app/page.tsx', 'app/layout.tsx', 'src/', 'src/components/'],
    };
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', MOCK_DESIGN_PACK, projectContext);
    expect(prompt).toContain('next');
    expect(prompt).toContain('react');
    expect(prompt).toContain('TSCONFIG');
    expect(prompt).toContain('app/page.tsx');
  });

  it('handles null design pack', () => {
    const prompt = buildGenerationSystemPrompt('vite_react', null);
    expect(prompt).toContain('SEMANTIC COLOR CLASSES');
    expect(prompt).toContain('border-border');
    expect(prompt).toContain('bg-primary');
  });

  it('includes TypeScript constraint', () => {
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', null);
    expect(prompt).toContain('TypeScript');
  });

  it('includes Tailwind constraint', () => {
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', null);
    expect(prompt).toContain('Tailwind');
  });

  it('includes few-shot component example', () => {
    const prompt = buildGenerationSystemPrompt('nextjs_app_router', MOCK_DESIGN_PACK);
    expect(prompt).toContain('EXAMPLE COMPONENT');
    expect(prompt).toContain('bg-primary text-primary-foreground');
    expect(prompt).toContain('border-border');
    expect(prompt).toContain('text-muted-foreground');
    expect(prompt).toContain('font-heading');
  });
});

// ============================================================================
// buildGenerationUserMessage TESTS
// ============================================================================

describe('buildGenerationUserMessage', () => {
  it('includes app type', () => {
    const message = buildGenerationUserMessage(TODO_REQUIREMENTS, 'nextjs_app_router');
    expect(message).toContain('todo');
  });

  it('includes feature list', () => {
    const message = buildGenerationUserMessage(TODO_REQUIREMENTS, 'nextjs_app_router');
    expect(message).toContain('add task');
    expect(message).toContain('mark complete');
    expect(message).toContain('delete task');
  });

  it('includes data model', () => {
    const message = buildGenerationUserMessage(TODO_REQUIREMENTS, 'nextjs_app_router');
    expect(message).toContain('Task');
    expect(message).toContain('title');
    expect(message).toContain('completed');
  });

  it('includes page requirements', () => {
    const message = buildGenerationUserMessage(TODO_REQUIREMENTS, 'nextjs_app_router');
    expect(message).toContain('TaskList');
    expect(message).toContain('TaskForm');
  });

  it('includes correct home page path for recipe', () => {
    const nextjsMessage = buildGenerationUserMessage(TODO_REQUIREMENTS, 'nextjs_app_router');
    expect(nextjsMessage).toContain('app/page.tsx');

    const viteMessage = buildGenerationUserMessage(TODO_REQUIREMENTS, 'vite_react');
    expect(viteMessage).toContain('src/App.tsx');
  });
});

// ============================================================================
// parseGenerationResult TESTS
// ============================================================================

describe('parseGenerationResult', () => {
  it('parses valid generation result', () => {
    const json = JSON.stringify({
      files: [
        {
          path: 'src/types/task.ts',
          content: 'export interface Task { id: string; title: string; }',
          description: 'Task type definition',
          kind: 'type',
        },
        {
          path: 'src/components/TaskList.tsx',
          content: 'export function TaskList() { return <div>Tasks</div>; }',
          description: 'Task list component',
          kind: 'component',
        },
      ],
      modified_files: [
        {
          path: 'app/page.tsx',
          content: 'import { TaskList } from "../src/components/TaskList";\nexport default function Home() { return <TaskList />; }',
          description: 'Updated home page',
        },
      ],
      summary: 'Generated todo app with 2 new files and 1 modification',
    });

    const result = parseGenerationResult(json, 'nextjs_app_router');
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
    expect(result!.files[0].kind).toBe('type');
    expect(result!.files[1].kind).toBe('component');
    expect(result!.modified_files).toHaveLength(1);
    expect(result!.summary).toContain('todo');
  });

  it('handles JSON wrapped in code block', () => {
    const response = '```json\n' + JSON.stringify({
      files: [{ path: 'a.ts', content: 'code', description: 'desc', kind: 'type' }],
      modified_files: [],
      summary: 'test',
    }) + '\n```';

    const result = parseGenerationResult(response, 'nextjs_app_router');
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(1);
  });

  it('returns null for invalid JSON', () => {
    expect(parseGenerationResult('not json', 'nextjs_app_router')).toBeNull();
  });

  it('returns null for empty files array', () => {
    const json = JSON.stringify({ files: [], modified_files: [], summary: 'nothing' });
    expect(parseGenerationResult(json, 'nextjs_app_router')).toBeNull();
  });

  it('filters out files with missing content', () => {
    const json = JSON.stringify({
      files: [
        { path: 'valid.ts', content: 'code', description: 'desc', kind: 'type' },
        { path: 'invalid.ts', content: '', description: 'empty' },
        { path: 'also_invalid.ts', description: 'no content' },
      ],
      modified_files: [],
      summary: 'test',
    });

    const result = parseGenerationResult(json, 'nextjs_app_router');
    expect(result!.files).toHaveLength(1);
    expect(result!.files[0].path).toBe('valid.ts');
  });

  it('defaults to component kind for unknown kinds', () => {
    const json = JSON.stringify({
      files: [{ path: 'a.ts', content: 'code', description: 'desc', kind: 'unknown_kind' }],
      modified_files: [],
      summary: 'test',
    });

    const result = parseGenerationResult(json, 'nextjs_app_router');
    expect(result!.files[0].kind).toBe('component');
  });

  it('provides default summary if missing', () => {
    const json = JSON.stringify({
      files: [{ path: 'a.ts', content: 'code', description: 'desc', kind: 'type' }],
      modified_files: [],
    });

    const result = parseGenerationResult(json, 'nextjs_app_router');
    expect(result!.summary).toContain('Generated 1 files');
  });
});

// ============================================================================
// generateFeatureCode INTEGRATION TESTS
// ============================================================================

describe('generateFeatureCode', () => {
  it('generates feature code from requirements', async () => {
    const mockResponse = JSON.stringify({
      files: [
        {
          path: 'src/types/task.ts',
          content: 'export interface Task { id: string; title: string; completed: boolean; }',
          description: 'Task type definition',
          kind: 'type',
        },
        {
          path: 'src/components/TaskList.tsx',
          content: '"use client";\nimport { Task } from "../types/task";\nexport function TaskList() { return <div>Tasks</div>; }',
          description: 'Task list component',
          kind: 'component',
        },
      ],
      modified_files: [],
      summary: 'Generated todo components',
    });

    const client = createMockLLMClient(mockResponse);
    const result = await generateFeatureCode(TODO_REQUIREMENTS, 'nextjs_app_router', MOCK_DESIGN_PACK, client, 'claude-sonnet-4-5-20250929');

    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
    expect(result!.summary).toContain('todo');
  });

  it('returns null when LLM fails', async () => {
    const client: FeatureLLMClient = {
      async createMessage() {
        throw new Error('LLM error');
      },
    };

    const result = await generateFeatureCode(TODO_REQUIREMENTS, 'nextjs_app_router', MOCK_DESIGN_PACK, client, 'claude-sonnet-4-5-20250929');
    expect(result).toBeNull();
  });

  it('returns null when LLM returns empty content', async () => {
    const client: FeatureLLMClient = {
      async createMessage() {
        return { content: [] };
      },
    };

    const result = await generateFeatureCode(TODO_REQUIREMENTS, 'nextjs_app_router', MOCK_DESIGN_PACK, client, 'claude-sonnet-4-5-20250929');
    expect(result).toBeNull();
  });

  it('passes design pack null gracefully', async () => {
    const mockResponse = JSON.stringify({
      files: [{ path: 'a.ts', content: 'code', description: 'd', kind: 'type' }],
      modified_files: [],
      summary: 'test',
    });

    const client = createMockLLMClient(mockResponse);
    const result = await generateFeatureCode(TODO_REQUIREMENTS, 'nextjs_app_router', null, client, 'claude-sonnet-4-5-20250929');
    expect(result).not.toBeNull();
  });
});

// ============================================================================
// TRUNCATION DETECTION TESTS
// ============================================================================

describe('generateFeatureCode truncation handling', () => {
  it('returns null when LLM response is truncated (stop_reason=max_tokens)', async () => {
    const client: FeatureLLMClient = {
      async createMessage() {
        return {
          content: [{ type: 'text', text: '{"files": [{"path": "a.ts", "content": "partial...' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 500, output_tokens: 16384 },
        };
      },
    };

    const result = await generateFeatureCode(TODO_REQUIREMENTS, 'nextjs_app_router', MOCK_DESIGN_PACK, client, 'claude-sonnet-4-5-20250929');
    expect(result).toBeNull();
  });

  it('retries with increased token budget on truncation', async () => {
    let callCount = 0;
    const validResponse = JSON.stringify({
      files: [{ path: 'a.ts', content: 'code', description: 'd', kind: 'type' }],
      modified_files: [],
      summary: 'test',
    });

    const client: FeatureLLMClient = {
      async createMessage(params) {
        callCount++;
        if (callCount === 1) {
          // First call truncated
          return {
            content: [{ type: 'text', text: '{"files": [{"path": "incomplete' }],
            stop_reason: 'max_tokens',
            usage: { input_tokens: 500, output_tokens: 32768 },
          };
        }
        // Second call succeeds with higher budget
        return {
          content: [{ type: 'text', text: validResponse }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 3000 },
        };
      },
    };

    const result = await generateFeatureCode(TODO_REQUIREMENTS, 'nextjs_app_router', MOCK_DESIGN_PACK, client, 'claude-sonnet-4-5-20250929');
    expect(result).not.toBeNull();
    expect(callCount).toBe(2);
  });

  it('reduces scope after second truncation for complex features', async () => {
    let callCount = 0;
    const validResponse = JSON.stringify({
      files: [{ path: 'a.ts', content: 'code', description: 'd', kind: 'type' }],
      modified_files: [],
      summary: 'reduced scope success',
    });

    const complexRequirements: FeatureRequirements = {
      ...TODO_REQUIREMENTS,
      features: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10'],
      pages: [
        { path: '/p1', description: 'd1', components: ['C1'] },
        { path: '/p2', description: 'd2', components: ['C2'] },
        { path: '/p3', description: 'd3', components: ['C3'] },
        { path: '/p4', description: 'd4', components: ['C4'] },
      ],
    };

    const client: FeatureLLMClient = {
      async createMessage() {
        callCount++;
        if (callCount <= 2) {
          return {
            content: [{ type: 'text', text: '{"files": [{"truncated' }],
            stop_reason: 'max_tokens',
            usage: { input_tokens: 500, output_tokens: 65536 },
          };
        }
        // Third call with reduced scope succeeds
        return {
          content: [{ type: 'text', text: validResponse }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 400, output_tokens: 2000 },
        };
      },
    };

    const result = await generateFeatureCode(complexRequirements, 'nextjs_app_router', MOCK_DESIGN_PACK, client, 'claude-sonnet-4-5-20250929');
    expect(result).not.toBeNull();
    expect(callCount).toBe(3);
    expect(result!.summary).toContain('reduced scope');
  });
});

// ============================================================================
// reduceFeatureScope TESTS
// ============================================================================

describe('reduceFeatureScope', () => {
  it('limits features to 4', () => {
    const complex: FeatureRequirements = {
      ...TODO_REQUIREMENTS,
      features: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'],
    };
    const reduced = reduceFeatureScope(complex);
    expect(reduced.features).toHaveLength(4);
    expect(reduced.features[0]).toBe('f1');
  });

  it('limits pages to 2', () => {
    const complex: FeatureRequirements = {
      ...TODO_REQUIREMENTS,
      pages: [
        { path: '/a', description: 'a', components: [] },
        { path: '/b', description: 'b', components: [] },
        { path: '/c', description: 'c', components: [] },
        { path: '/d', description: 'd', components: [] },
      ],
    };
    const reduced = reduceFeatureScope(complex);
    expect(reduced.pages).toHaveLength(2);
  });

  it('limits data model to 2 entities', () => {
    const complex: FeatureRequirements = {
      ...TODO_REQUIREMENTS,
      data_model: [
        { name: 'A', fields: [] },
        { name: 'B', fields: [] },
        { name: 'C', fields: [] },
      ],
    };
    const reduced = reduceFeatureScope(complex);
    expect(reduced.data_model).toHaveLength(2);
  });

  it('preserves app_type and other fields', () => {
    const reduced = reduceFeatureScope(TODO_REQUIREMENTS);
    expect(reduced.app_type).toBe('todo');
    expect(reduced.has_auth).toBe(false);
  });
});

// ============================================================================
// generateTailwindConfig TESTS
// ============================================================================

describe('generateTailwindConfig', () => {
  it('generates valid tailwind config with design pack colors', () => {
    const config = generateTailwindConfig(MOCK_DESIGN_PACK);
    expect(config).toContain('import type { Config } from "tailwindcss"');
    expect(config).toContain('var(--primary)');
    expect(config).toContain('var(--primary-foreground)');
    expect(config).toContain('var(--secondary)');
    expect(config).toContain('var(--accent)');
    expect(config).toContain('var(--muted)');
    expect(config).toContain('var(--border)');
    expect(config).toContain('var(--background)');
    expect(config).toContain('var(--foreground)');
  });

  it('includes font family configuration', () => {
    const config = generateTailwindConfig(MOCK_DESIGN_PACK);
    expect(config).toContain('var(--font-heading)');
    expect(config).toContain('var(--font-body)');
  });

  it('includes border radius from pack', () => {
    const config = generateTailwindConfig(MOCK_DESIGN_PACK);
    // md radius = 0.5rem
    expect(config).toContain('0.5rem');
  });

  it('includes box shadow from pack', () => {
    const config = generateTailwindConfig(MOCK_DESIGN_PACK);
    // subtle shadow
    expect(config).toContain('boxShadow');
  });

  it('exports default config', () => {
    const config = generateTailwindConfig(MOCK_DESIGN_PACK);
    expect(config).toContain('export default config');
  });
});

// ============================================================================
// buildGenerationUserMessage VISUAL QUALITY TESTS
// ============================================================================

describe('buildGenerationUserMessage visual quality', () => {
  it('includes visual quality section', () => {
    const message = buildGenerationUserMessage(TODO_REQUIREMENTS, 'nextjs_app_router');
    expect(message).toContain('VISUAL QUALITY');
    expect(message).toContain('shadcn/ui');
    expect(message).toContain('<Card>');
    expect(message).toContain('empty state');
  });

  it('includes page replacement instruction', () => {
    const message = buildGenerationUserMessage(TODO_REQUIREMENTS, 'nextjs_app_router');
    expect(message).toContain('no default template content remaining');
  });
});
