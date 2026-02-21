/**
 * Feature Extractor (Scaffold Intelligence)
 *
 * Extracts structured feature requirements from the user's prompt via a single
 * lightweight LLM call. This is the first phase of the Feature Implementation
 * Pipeline that runs AFTER CLI scaffolding to generate feature-specific code.
 *
 * Key design decisions:
 * - Single LLM call (~200-500 tokens output) for speed and cost
 * - Returns structured JSON (FeatureRequirements) — no code generation yet
 * - Separates reasoning (what to build) from execution (how to build it)
 * - Graceful fallback if LLM fails or API key is missing
 */

import type { FeatureRequirements, DataEntity, PageRequirement } from '../types';
import type { RecipeId } from './recipeTypes';
import type { LLMConfig } from '../llmService';

// ============================================================================
// LLM CLIENT INTERFACE (adapter pattern for testability)
// ============================================================================

/**
 * Minimal LLM client interface for feature extraction.
 * Matches the subset of Anthropic SDK we need — allows easy mocking in tests.
 */
export interface FeatureLLMClient {
  createMessage(params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<{
    content: Array<{ type: string; text?: string }>;
    stop_reason?: string;
    usage?: { input_tokens: number; output_tokens: number };
  }>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are a feature requirements extractor for a code scaffold system.

Given a user's prompt describing an app they want to build, extract structured feature requirements.

You MUST respond with ONLY valid JSON matching this exact schema (no markdown, no explanation):

{
  "app_type": "string (e.g., 'todo', 'blog', 'ecommerce', 'dashboard', 'chat', 'portfolio')",
  "features": ["array of feature descriptions"],
  "data_model": [
    {
      "name": "EntityName",
      "fields": [
        { "name": "fieldName", "type": "string|number|boolean|Date|string[]", "required": true/false }
      ]
    }
  ],
  "pages": [
    {
      "path": "/route-path",
      "description": "What this page shows",
      "components": ["ComponentName1", "ComponentName2"]
    }
  ],
  "has_auth": false,
  "has_database": false,
  "styling_preference": "minimal"
}

Rules:
- Keep data models simple (3-6 fields per entity, max 3 entities)
- Keep pages to 1-3 for simple apps
- Set has_auth=true ONLY if user explicitly mentions login/auth/users
- Set has_database=false for simple apps (use local state)
- Component names should be PascalCase React component names
- styling_preference should be "minimal", "modern", or "colorful"
- If the prompt is too vague or generic (just "an app", "a website"), set app_type to "generic"`;

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;

// ============================================================================
// FEATURE EXTRACTION
// ============================================================================

/**
 * Extract structured feature requirements from user prompt via LLM.
 *
 * @param userPrompt - Original user prompt (e.g., "create a todo app")
 * @param recipeId - Selected recipe (provides framework context)
 * @param llmClient - LLM client for making API calls
 * @param model - Optional model override
 * @returns Structured feature requirements, or null if extraction fails
 */
export async function extractFeatureRequirements(
  userPrompt: string,
  recipeId: RecipeId,
  llmClient: FeatureLLMClient,
  model?: string,
): Promise<FeatureRequirements | null> {
  try {
    const frameworkContext = getFrameworkContext(recipeId);
    const userMessage = `Framework: ${frameworkContext}\nUser prompt: "${userPrompt}"\n\nExtract the feature requirements as JSON.`;

    const response = await llmClient.createMessage({
      model: model || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract text content from response
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock?.text) {
      console.warn('[FeatureExtractor] No text in LLM response');
      return null;
    }

    // Parse JSON response
    const parsed = parseFeatureRequirements(textBlock.text);
    if (!parsed) {
      console.warn('[FeatureExtractor] Failed to parse LLM response as FeatureRequirements');
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[FeatureExtractor] LLM call failed:', error);
    return null;
  }
}

/**
 * Check if a prompt describes a specific feature (not just "create an app").
 * Returns true by default — only returns false for explicitly generic prompts
 * that contain no meaningful feature intent beyond "create a <framework> app".
 */
export function hasSpecificFeature(userPrompt: string): boolean {
  const prompt = userPrompt.toLowerCase().trim();

  if (!prompt || prompt.length < 3) return false;

  const genericPatterns = [
    /^(create|build|make|start|generate|scaffold|init|initialize)\s+(a\s+)?(new\s+)?(react|next\.?js|nextjs|vite|expo|web|mobile|frontend|fullstack)?\s*(app|application|project|site|website)?$/i,
    /^(create|build|make|start)\s+(a\s+)?(new\s+)?app$/i,
    /^(create|build|make|start)\s+(a\s+)?(new\s+)?project$/i,
    /^(scaffold|init|initialize)\s+(a\s+)?(new\s+)?(app|project)$/i,
    /^(hello|hi|hey|test|testing)$/i,
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(prompt)) {
      return false;
    }
  }

  // Any non-generic prompt is assumed to have feature intent
  return true;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function getFrameworkContext(recipeId: RecipeId): string {
  switch (recipeId) {
    case 'nextjs_app_router':
      return 'Next.js 14 App Router (app/ directory, React Server Components, TypeScript, Tailwind CSS)';
    case 'vite_react':
      return 'Vite + React (src/ directory, TypeScript, Tailwind CSS, SPA)';
    case 'expo':
      return 'Expo React Native (TypeScript, mobile-first, StyleSheet)';
    default:
      return 'React TypeScript project';
  }
}

/**
 * Parse and validate LLM output as FeatureRequirements.
 * Handles JSON embedded in markdown code blocks.
 */
function parseFeatureRequirements(text: string): FeatureRequirements | null {
  try {
    // Strip markdown code block if present (handle trailing whitespace/newlines)
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\s*```\s*$/, '');
    }
    // Also try extracting JSON from within a larger response
    if (!jsonStr.startsWith('{')) {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (typeof parsed.app_type !== 'string') return null;
    if (!Array.isArray(parsed.features)) return null;

    // Normalize and provide defaults
    const requirements: FeatureRequirements = {
      app_type: parsed.app_type || 'generic',
      features: Array.isArray(parsed.features) ? parsed.features.filter((f: unknown) => typeof f === 'string') : [],
      data_model: validateDataModel(parsed.data_model),
      pages: validatePages(parsed.pages),
      has_auth: Boolean(parsed.has_auth),
      has_database: Boolean(parsed.has_database),
      styling_preference: parsed.styling_preference || 'minimal',
    };

    return requirements;
  } catch {
    return null;
  }
}

function validateDataModel(raw: unknown): DataEntity[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entity: any) => typeof entity?.name === 'string' && Array.isArray(entity?.fields))
    .map((entity: any) => ({
      name: String(entity.name),
      fields: (entity.fields || [])
        .filter((f: any) => typeof f?.name === 'string' && typeof f?.type === 'string')
        .map((f: any) => ({
          name: String(f.name),
          type: String(f.type),
          required: Boolean(f.required),
        })),
    }));
}

function validatePages(raw: unknown): PageRequirement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((page: any) => typeof page?.path === 'string')
    .map((page: any) => ({
      path: String(page.path),
      description: String(page.description || ''),
      components: Array.isArray(page.components)
        ? page.components.filter((c: unknown) => typeof c === 'string')
        : [],
    }));
}

// ============================================================================
// LLM CLIENT FACTORY
// ============================================================================

/**
 * Creates a FeatureLLMClient from an API key.
 * Uses @anthropic-ai/sdk which is a dependency of the core package.
 * The extension should call this factory instead of trying to import the SDK directly.
 */
export async function createFeatureLLMClient(apiKey: string): Promise<FeatureLLMClient | null> {
  try {
    // @anthropic-ai/sdk is a dependency of the core package
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    return {
      async createMessage(params) {
        const response = await client.messages.create({
          model: params.model,
          max_tokens: params.max_tokens,
          system: params.system,
          messages: params.messages as any,
        });
        return response as any;
      },
    };
  } catch (error) {
    console.error('[createFeatureLLMClient] Failed to create LLM client:', error);
    return null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  EXTRACTION_SYSTEM_PROMPT,
  parseFeatureRequirements,
};
