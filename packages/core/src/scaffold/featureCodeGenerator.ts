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
const GENERATION_MAX_TOKENS = 32768;
const GENERATION_RETRY_MAX_TOKENS = 65536;
const MAX_GENERATION_ATTEMPTS = 2;
const LOG_PREFIX = '[FeatureCodeGenerator]';

// ============================================================================
// CODE GENERATION
// ============================================================================

/**
 * Generate feature-specific code files based on extracted requirements.
 *
 * Handles truncation detection and retries:
 * 1. First attempt with GENERATION_MAX_TOKENS (32K)
 * 2. If truncated, retries with GENERATION_RETRY_MAX_TOKENS (64K)
 * 3. If still truncated, retries with reduced feature scope (core features only)
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
  const systemPrompt = buildGenerationSystemPrompt(recipeId, designPack, projectContext);

  // Attempt 1: Full requirements with standard token budget
  const attempt1 = await callGenerationLLM(
    llmClient, systemPrompt, requirements, recipeId, model, GENERATION_MAX_TOKENS, 1,
  );
  if (attempt1.result) return attempt1.result;

  // If truncated, retry with increased token budget
  if (attempt1.truncated) {
    console.log(`${LOG_PREFIX} Output truncated at ${GENERATION_MAX_TOKENS} tokens, retrying with ${GENERATION_RETRY_MAX_TOKENS}...`);
    const attempt2 = await callGenerationLLM(
      llmClient, systemPrompt, requirements, recipeId, model, GENERATION_RETRY_MAX_TOKENS, 2,
    );
    if (attempt2.result) return attempt2.result;

    // If still truncated, reduce scope to core features only and retry
    if (attempt2.truncated && requirements.features.length > 4) {
      console.log(`${LOG_PREFIX} Still truncated, reducing scope to core features...`);
      const reducedRequirements = reduceFeatureScope(requirements);
      console.log(`${LOG_PREFIX} Reduced from ${requirements.features.length} to ${reducedRequirements.features.length} features, ${requirements.pages.length} to ${reducedRequirements.pages.length} pages`);

      const attempt3 = await callGenerationLLM(
        llmClient, systemPrompt, reducedRequirements, recipeId, model, GENERATION_RETRY_MAX_TOKENS, 3,
      );
      if (attempt3.result) return attempt3.result;
    }
  }

  // All attempts failed
  console.error(`${LOG_PREFIX} All generation attempts failed for "${requirements.app_type}" (${requirements.features.length} features, ${requirements.pages.length} pages)`);
  return null;
}

/**
 * Single LLM call attempt with truncation detection and structured error reporting.
 */
async function callGenerationLLM(
  llmClient: FeatureLLMClient,
  systemPrompt: string,
  requirements: FeatureRequirements,
  recipeId: RecipeId,
  model: string | undefined,
  maxTokens: number,
  attemptNumber: number,
): Promise<{ result: FeatureGenerationResult | null; truncated: boolean }> {
  try {
    const userMessage = buildGenerationUserMessage(requirements, recipeId);

    const response = await llmClient.createMessage({
      model: model || GENERATION_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Log token usage for debugging
    const stopReason = response.stop_reason || 'unknown';
    const usage = response.usage;
    if (usage) {
      console.log(`${LOG_PREFIX} Attempt ${attemptNumber}: stop_reason=${stopReason}, input=${usage.input_tokens}, output=${usage.output_tokens}, max=${maxTokens}`);
    } else {
      console.log(`${LOG_PREFIX} Attempt ${attemptNumber}: stop_reason=${stopReason}, max=${maxTokens}`);
    }

    // Detect truncation BEFORE attempting to parse
    if (stopReason === 'max_tokens') {
      console.warn(`${LOG_PREFIX} ========== OUTPUT TRUNCATED (attempt ${attemptNumber}) ==========`);
      console.warn(`${LOG_PREFIX} Response truncated at max_tokens=${maxTokens} for "${requirements.app_type}" (${requirements.features.length} features, ${requirements.pages.length} pages)`);
      return { result: null, truncated: true };
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock?.text) {
      console.warn(`${LOG_PREFIX} Attempt ${attemptNumber}: No text in LLM response`);
      return { result: null, truncated: false };
    }

    console.log(`${LOG_PREFIX} Attempt ${attemptNumber}: Received ${textBlock.text.length} chars, parsing...`);
    const result = parseGenerationResult(textBlock.text, recipeId);

    if (!result) {
      // Check if the text looks like truncated JSON (missing closing braces)
      const openBraces = (textBlock.text.match(/\{/g) || []).length;
      const closeBraces = (textBlock.text.match(/\}/g) || []).length;
      if (openBraces > closeBraces + 2) {
        console.warn(`${LOG_PREFIX} Attempt ${attemptNumber}: Parse failed — likely truncated JSON (open={${openBraces}}, close={${closeBraces}})`);
        return { result: null, truncated: true };
      }
      console.warn(`${LOG_PREFIX} Attempt ${attemptNumber}: Parse failed — response was not valid JSON`);
    }

    return { result, truncated: false };
  } catch (error) {
    console.error(`${LOG_PREFIX} Attempt ${attemptNumber} LLM call failed:`, error);
    return { result: null, truncated: false };
  }
}

/**
 * Reduce feature scope for retry when output is too large.
 * Keeps the first page (home), limits features to 4, and limits data model to 2 entities.
 */
function reduceFeatureScope(requirements: FeatureRequirements): FeatureRequirements {
  return {
    ...requirements,
    features: requirements.features.slice(0, 4),
    data_model: requirements.data_model.slice(0, 2),
    pages: requirements.pages.slice(0, 2),
  };
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

VISUAL QUALITY RULES:
- COMPLETELY replace default template content in the home page — NO default logos, SVGs, hero sections, or Next.js/Vite boilerplate
- Use max-w-4xl mx-auto p-6 for page layout with proper heading and structured sections
- Typography hierarchy: use text-3xl font-bold font-heading for h1, text-xl font-semibold for h2, text-base for body
- All form inputs MUST have visible labels (use <label> elements)
- List items should use card-based layout (border border-border rounded-lg p-4)
- Include empty states with helpful messages (e.g., "No tasks yet. Add one above!")
- Use responsive layout: flex flex-col gap-4 for mobile, md:flex-row for desktop where appropriate
- Add spacing between sections: space-y-6 or gap-6

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

EXAMPLE COMPONENT (shows correct Tailwind + design token usage):
\`\`\`tsx
'use client';
import { useState } from 'react';

interface Task { id: string; title: string; done: boolean; }

export function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState('');

  const addTask = () => {
    if (!input.trim()) return;
    setTasks(prev => [...prev, { id: crypto.randomUUID(), title: input, done: false }]);
    setInput('');
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold font-heading mb-6">Tasks</h1>
      <div className="flex gap-2 mb-6">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a task..."
          className="flex-1 border border-border bg-background rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          onClick={addTask}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 hover:opacity-90 transition-opacity"
        >
          Add
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No tasks yet. Add one above!</p>
      ) : (
        <ul className="space-y-3">
          {tasks.map(task => (
            <li key={task.id} className="flex items-center gap-3 border border-border rounded-lg p-4 bg-background shadow-sm">
              <input type="checkbox" checked={task.done} onChange={() => {}} className="w-4 h-4 accent-primary" />
              <span className={task.done ? 'line-through text-muted-foreground' : 'text-foreground'}>{task.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
\`\`\`

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

VISUAL QUALITY:
- Every form input MUST have a visible <label> with proper htmlFor/id pairing
- List items should be card-based (border, rounded corners, padding, shadow)
- Include empty state messaging when no items exist
- Use consistent spacing and alignment throughout
- The home page MUST be fully replaced — no default template content remaining

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
  return `Design pack: "${designPack.name}" (${designPack.vibe} vibe).
The tailwind.config.ts has been extended with design pack colors mapped to CSS variables.
Use these SEMANTIC Tailwind classes (NOT arbitrary value syntax):

COLORS:
- Primary (CTAs, buttons): bg-primary text-primary-foreground
- Secondary (secondary actions): bg-secondary text-secondary-foreground
- Accent (highlights, links): bg-accent text-accent-foreground
- Muted (subtle backgrounds): bg-muted text-muted-foreground
- Background/Foreground: bg-background text-foreground
- Borders: border-border

FONTS:
- Headings: font-heading
- Body text: font-body

COMPONENT PATTERNS:
- Button: bg-primary text-primary-foreground rounded-md px-4 py-2 hover:opacity-90 transition-opacity
- Secondary Button: bg-secondary text-secondary-foreground rounded-md px-4 py-2 hover:opacity-90
- Input: border border-border bg-background rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary
- Card: border border-border rounded-lg shadow p-6 bg-background
- Badge: bg-muted text-muted-foreground text-xs rounded-full px-2 py-0.5

CRITICAL: Do NOT use arbitrary value syntax like text-[var(--primary)], bg-[var(--background)], or border-[var(--border)].
Always use the semantic class names above (bg-primary, text-foreground, border-border, etc.).`;
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

    if (!parsed || typeof parsed !== 'object') {
      console.warn(`${LOG_PREFIX} Parsed result is not an object`);
      return null;
    }

    const files: GeneratedFile[] = validateGeneratedFiles(parsed.files);
    const modifiedFiles: ModifiedFileEntry[] = validateModifiedFiles(parsed.modified_files);

    const rawFileCount = Array.isArray(parsed.files) ? parsed.files.length : 0;
    const rawModifiedCount = Array.isArray(parsed.modified_files) ? parsed.modified_files.length : 0;

    if (files.length === 0 && modifiedFiles.length === 0) {
      console.warn(`${LOG_PREFIX} No valid files after validation (raw: ${rawFileCount} files, ${rawModifiedCount} modified)`);
      if (rawFileCount > 0) {
        console.warn(`${LOG_PREFIX} Files were filtered out during validation — likely empty content or missing paths`);
      }
      return null;
    }

    if (files.length < rawFileCount || modifiedFiles.length < rawModifiedCount) {
      console.warn(`${LOG_PREFIX} Some files filtered: ${rawFileCount} → ${files.length} files, ${rawModifiedCount} → ${modifiedFiles.length} modified`);
    }

    return {
      files,
      modified_files: modifiedFiles,
      summary: typeof parsed.summary === 'string' ? parsed.summary : `Generated ${files.length} files`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} JSON parse failed (${text.length} chars): ${errorMsg}`);
    // Log first 200 chars and last 200 chars for debugging
    if (text.length > 0) {
      console.error(`${LOG_PREFIX} Response starts with: ${text.substring(0, 200)}`);
      console.error(`${LOG_PREFIX} Response ends with: ${text.substring(Math.max(0, text.length - 200))}`);
    }
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
  reduceFeatureScope,
  GENERATION_MODEL,
  GENERATION_MAX_TOKENS,
  GENERATION_RETRY_MAX_TOKENS,
  MAX_GENERATION_ATTEMPTS,
};

export type { RecipeConstraints };
