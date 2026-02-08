/**
 * Feature Code Generator (Scaffold Intelligence)
 *
 * Uses extracted feature requirements + LLM to generate feature-specific files.
 * This is the second phase of the Feature Implementation Pipeline.
 *
 * Key design decisions:
 * - Constrained generation: always uses Tailwind + project's existing patterns
 * - Design tokens from the design pack are injected into the system prompt
 * - Framework-aware: generates files in the correct directory convention
 * - Returns structured file list ready to write (no disk I/O here)
 */

import type {
  FeatureRequirements,
  FeatureGenerationResult,
  GeneratedFile,
  ModifiedFileEntry,
  GeneratedFileKind,
} from '../types';
import type { RecipeId } from './recipeTypes';
import type { DesignPack } from './designPacks';
import type { FeatureLLMClient } from './featureExtractor';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Project context for informed code generation.
 * Provides the LLM with real project structure so it generates code that fits.
 */
export interface ProjectContext {
  tsconfigContent?: string;
  packageJsonContent?: string;
  existingFiles?: string[];  // relative paths, top 2 levels
}

// ============================================================================
// CONSTANTS
// ============================================================================

const GENERATION_MODEL = 'claude-sonnet-4-20250514';
const GENERATION_MAX_TOKENS = 16384;

// ============================================================================
// CODE GENERATION
// ============================================================================

/**
 * Generate feature-specific code files based on extracted requirements.
 *
 * @param requirements - Structured feature requirements from extraction phase
 * @param recipeId - Recipe type (determines file conventions)
 * @param designPack - Design pack for color/font tokens
 * @param llmClient - LLM client for API calls
 * @param model - Optional model override
 * @returns Generated files and modifications, or null if generation fails
 */
export async function generateFeatureCode(
  requirements: FeatureRequirements,
  recipeId: RecipeId,
  designPack: DesignPack | null,
  llmClient: FeatureLLMClient,
  model?: string,
  projectContext?: ProjectContext,
): Promise<FeatureGenerationResult | null> {
  try {
    const systemPrompt = buildGenerationSystemPrompt(recipeId, designPack, projectContext);
    const userMessage = buildGenerationUserMessage(requirements, recipeId);

    const response = await llmClient.createMessage({
      model: model || GENERATION_MODEL,
      max_tokens: GENERATION_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock?.text) {
      console.warn('[FeatureCodeGenerator] No text in LLM response');
      return null;
    }

    return parseGenerationResult(textBlock.text, recipeId);
  } catch (error) {
    console.error('[FeatureCodeGenerator] LLM call failed:', error);
    return null;
  }
}

// ============================================================================
// SYSTEM PROMPT CONSTRUCTION
// ============================================================================

function buildGenerationSystemPrompt(recipeId: RecipeId, designPack: DesignPack | null, projectContext?: ProjectContext): string {
  const recipeConstraints = getRecipeConstraints(recipeId);
  const designTokens = designPack ? getDesignTokenString(designPack) : 'Use default Tailwind colors';

  // Build project context section from real project files
  let projectContextSection = '';
  if (projectContext) {
    const parts: string[] = [];

    if (projectContext.packageJsonContent) {
      try {
        const pkg = JSON.parse(projectContext.packageJsonContent);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        parts.push(`INSTALLED DEPENDENCIES:\n${Object.keys(deps).join(', ')}`);
      } catch { /* ignore parse errors */ }
    }

    if (projectContext.tsconfigContent) {
      parts.push(`TSCONFIG:\n${projectContext.tsconfigContent}`);
    }

    if (projectContext.existingFiles && projectContext.existingFiles.length > 0) {
      parts.push(`EXISTING FILES:\n${projectContext.existingFiles.join('\n')}`);
    }

    if (parts.length > 0) {
      projectContextSection = `\nPROJECT CONTEXT:\n${parts.join('\n\n')}\n`;
    }
  }

  // RSC rules for Next.js App Router
  const rscRules = recipeId === 'nextjs_app_router' ? `
NEXT.JS APP ROUTER / REACT SERVER COMPONENT RULES (CRITICAL):
- Files in app/ directory are Server Components by default
- Add "use client" directive at the VERY TOP of any file that uses:
  - React hooks (useState, useEffect, useReducer, useRef, useCallback, useMemo, etc.)
  - Event handlers (onClick, onChange, onSubmit, etc.)
  - Browser APIs (window, document, localStorage, etc.)
  - React context (useContext, createContext)
- Type definition files (types only, no runtime code) do NOT need "use client"
- Layout files (layout.tsx) are typically Server Components — do NOT add "use client" unless they use hooks
- Page files (page.tsx) that only render other components do NOT need "use client"
- Import client components INTO server components — not the other way around
- NEVER import server-only modules (fs, path, crypto) in client components
` : '';

  return `You are a React code generator for a scaffolded project. Generate complete, working feature code files.

FRAMEWORK: ${recipeConstraints.framework}
FILE CONVENTIONS: ${recipeConstraints.fileConvention}
${projectContextSection}
CONSTRAINTS:
- Use TypeScript strict mode with proper type annotations
- Use Tailwind CSS for ALL styling (utility classes only, no custom CSS)
- Follow ${recipeConstraints.fileConvention} file conventions
- Components must be functional React components with hooks
- Use React hooks for state management (useState, useReducer — no external state library)
- Keep code simple and readable — no over-engineering
- Each file must be complete and self-contained (all imports included)
- Generate clean, production-quality code
${rscRules}
DESIGN TOKENS:
${designTokens}

OUTPUT FORMAT:
Respond with ONLY valid JSON matching this schema (no markdown, no explanation):

{
  "files": [
    {
      "path": "relative/path/to/File.tsx",
      "content": "full file content as string",
      "description": "what this file does",
      "kind": "component|page|type|hook|util|api|config"
    }
  ],
  "modified_files": [
    {
      "path": "relative/path/to/existing/file",
      "content": "complete new file content",
      "description": "what was changed"
    }
  ],
  "summary": "Brief description of what was generated"
}

IMPORTANT:
- File content must be valid TypeScript/TSX
- Use double quotes for JSON strings, escape internal quotes
- Include all necessary imports in each file
- For modified_files, provide the COMPLETE new file content (not a diff)`;
}

function buildGenerationUserMessage(requirements: FeatureRequirements, recipeId: RecipeId): string {
  const recipeConstraints = getRecipeConstraints(recipeId);

  return `Generate feature code for a "${requirements.app_type}" app.

FEATURES NEEDED:
${requirements.features.map((f, i) => `${i + 1}. ${f}`).join('\n')}

DATA MODEL:
${requirements.data_model.map(entity => {
    const fields = entity.fields.map(f => `  ${f.name}: ${f.type}${f.required ? ' (required)' : ''}`).join('\n');
    return `${entity.name}:\n${fields}`;
  }).join('\n\n')}

PAGES:
${requirements.pages.map(page => {
    return `${page.path}: ${page.description} [Components: ${page.components.join(', ')}]`;
  }).join('\n')}

GENERATE:
1. Type definitions file for the data model
2. Custom hook(s) for state management (useState/useReducer based)
3. UI components for each listed component
4. Modified home page (${recipeConstraints.homePagePath}) that imports and renders the main component

Keep it simple — use in-memory state with useState/useReducer. No external APIs or databases.`;
}

// ============================================================================
// RECIPE CONSTRAINTS
// ============================================================================

interface RecipeConstraints {
  framework: string;
  fileConvention: string;
  homePagePath: string;
  componentDir: string;
  typesDir: string;
  hooksDir: string;
}

function getRecipeConstraints(recipeId: RecipeId): RecipeConstraints {
  switch (recipeId) {
    case 'nextjs_app_router':
      return {
        framework: 'Next.js 14 App Router',
        fileConvention: 'app/ directory for routes, src/components/ for components, src/types/ for types, src/hooks/ for hooks',
        homePagePath: 'app/page.tsx',
        componentDir: 'src/components',
        typesDir: 'src/types',
        hooksDir: 'src/hooks',
      };
    case 'vite_react':
      return {
        framework: 'Vite + React SPA',
        fileConvention: 'src/ directory for all code, src/components/ for components, src/types/ for types, src/hooks/ for hooks',
        homePagePath: 'src/App.tsx',
        componentDir: 'src/components',
        typesDir: 'src/types',
        hooksDir: 'src/hooks',
      };
    case 'expo':
      return {
        framework: 'Expo React Native',
        fileConvention: 'app/ for routes (Expo Router), components/ for components, types/ for types, hooks/ for hooks',
        homePagePath: 'app/index.tsx',
        componentDir: 'components',
        typesDir: 'types',
        hooksDir: 'hooks',
      };
    default:
      return {
        framework: 'React TypeScript',
        fileConvention: 'src/ directory',
        homePagePath: 'src/App.tsx',
        componentDir: 'src/components',
        typesDir: 'src/types',
        hooksDir: 'src/hooks',
      };
  }
}

// ============================================================================
// DESIGN TOKEN INJECTION
// ============================================================================

function getDesignTokenString(designPack: DesignPack): string {
  return `Use CSS custom properties from the design pack "${designPack.name}".
The globals.css already defines these CSS variables — use them with Tailwind arbitrary value syntax:
- Primary: text-[var(--primary)] bg-[var(--primary)]
- Secondary: text-[var(--secondary)] bg-[var(--secondary)]
- Accent: text-[var(--accent)] bg-[var(--accent)]
- Background: bg-[var(--background)]
- Foreground: text-[var(--foreground)]
- Muted: bg-[var(--muted)] text-[var(--muted-foreground)]
- Border: border-[var(--border)]
- Font heading: font-[var(--font-heading)]
- Font body: font-[var(--font-body)]
Prefer standard Tailwind utility classes when possible (e.g. text-sm, p-4, rounded-lg).
For interactive elements, use the accent color for hover/focus states.`;
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

function parseGenerationResult(text: string, _recipeId: RecipeId): FeatureGenerationResult | null {
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

    if (!parsed || typeof parsed !== 'object') return null;

    const files: GeneratedFile[] = validateGeneratedFiles(parsed.files);
    const modifiedFiles: ModifiedFileEntry[] = validateModifiedFiles(parsed.modified_files);

    if (files.length === 0 && modifiedFiles.length === 0) {
      console.warn('[FeatureCodeGenerator] No files generated');
      return null;
    }

    return {
      files,
      modified_files: modifiedFiles,
      summary: typeof parsed.summary === 'string' ? parsed.summary : `Generated ${files.length} files`,
    };
  } catch (error) {
    console.error('[FeatureCodeGenerator] Failed to parse generation result:', error);
    return null;
  }
}

function validateGeneratedFiles(raw: unknown): GeneratedFile[] {
  if (!Array.isArray(raw)) return [];

  const validKinds: GeneratedFileKind[] = ['component', 'page', 'type', 'hook', 'util', 'api', 'config'];

  return raw
    .filter((f: any) =>
      typeof f?.path === 'string' &&
      typeof f?.content === 'string' &&
      f.content.length > 0
    )
    .map((f: any) => ({
      path: String(f.path),
      content: String(f.content),
      description: String(f.description || ''),
      kind: validKinds.includes(f.kind) ? f.kind : 'component' as GeneratedFileKind,
    }));
}

function validateModifiedFiles(raw: unknown): ModifiedFileEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((f: any) =>
      typeof f?.path === 'string' &&
      typeof f?.content === 'string' &&
      f.content.length > 0
    )
    .map((f: any) => ({
      path: String(f.path),
      content: String(f.content),
      description: String(f.description || ''),
    }));
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
  parseGenerationResult,
  getRecipeConstraints,
  GENERATION_MODEL,
  GENERATION_MAX_TOKENS,
};

export type { RecipeConstraints };
