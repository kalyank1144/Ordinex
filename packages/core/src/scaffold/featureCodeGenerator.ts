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
import type { DesignTokens } from './tokenValidator';
import { debugLog, debugWarn } from './debugLog';

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

const GENERATION_MAX_TOKENS = 32768;
const GENERATION_RETRY_MAX_TOKENS = 65536;
const MAX_GENERATION_ATTEMPTS = 2;
const LOG_PREFIX = '[FeatureCodeGenerator]';
const HEARTBEAT_TIMEOUT_MS = 90_000; // Kill if no streamed tokens for 90s

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
 * @param model - Anthropic model ID (required — must come from user's selection)
 * @returns Generated files and modifications, or null if generation fails
 */
export async function generateFeatureCode(
  requirements: FeatureRequirements,
  recipeId: RecipeId,
  designPack: DesignPack | null,
  llmClient: FeatureLLMClient,
  model: string,
  projectContext?: ProjectContext,
  hasSrcDir?: boolean,
  designTokens?: DesignTokens,
): Promise<FeatureGenerationResult | null> {
  if (!model) {
    throw new Error('[FeatureCodeGenerator] model is required — the user\'s selected model must be passed through the pipeline');
  }
  debugLog(`========== FEATURE CODE GENERATION START ==========`);
  debugLog(`generateFeatureCode called`);
  debugLog(`  app_type: ${requirements.app_type}`);
  debugLog(`  features: ${requirements.features.length} → ${JSON.stringify(requirements.features)}`);
  debugLog(`  pages: ${requirements.pages.length} → ${JSON.stringify(requirements.pages.map(p => p.path))}`);
  debugLog(`  recipeId: ${recipeId}`);
  debugLog(`  model: ${model}`);
  debugLog(`  designPack: ${designPack ? designPack.id : 'null'}`);
  debugLog(`  hasSrcDir: ${hasSrcDir}`);
  debugLog(`  projectContext keys: ${projectContext ? Object.keys(projectContext).join(', ') : 'none'}`);

  const systemPrompt = buildGenerationSystemPrompt(recipeId, designPack, projectContext, hasSrcDir, designTokens);
  debugLog(`System prompt length: ${systemPrompt.length} chars`);

  debugLog(`--- Attempt 1: maxTokens=${GENERATION_MAX_TOKENS} ---`);
  const attempt1 = await callGenerationLLM(
    llmClient, systemPrompt, requirements, recipeId, model, GENERATION_MAX_TOKENS, 1, hasSrcDir,
  );
  if (attempt1.result) {
    debugLog(`✅ Attempt 1 succeeded: ${attempt1.result.files.length} files, ${attempt1.result.modified_files?.length || 0} modified`);
    debugLog(`========== FEATURE CODE GENERATION END ==========`);
    return attempt1.result;
  }
  debugLog(`❌ Attempt 1 failed. truncated=${attempt1.truncated}`);

  if (attempt1.truncated) {
    debugLog(`--- Attempt 2: maxTokens=${GENERATION_RETRY_MAX_TOKENS} (retry after truncation) ---`);
    const attempt2 = await callGenerationLLM(
      llmClient, systemPrompt, requirements, recipeId, model, GENERATION_RETRY_MAX_TOKENS, 2, hasSrcDir,
    );
    if (attempt2.result) {
      debugLog(`✅ Attempt 2 succeeded: ${attempt2.result.files.length} files`);
      debugLog(`========== FEATURE CODE GENERATION END ==========`);
      return attempt2.result;
    }
    debugLog(`❌ Attempt 2 failed. truncated=${attempt2.truncated}`);

    if (attempt2.truncated && requirements.features.length > 4) {
      debugLog(`--- Attempt 3: Reducing scope from ${requirements.features.length} features ---`);
      const reducedRequirements = reduceFeatureScope(requirements);
      debugLog(`Reduced to ${reducedRequirements.features.length} features, ${reducedRequirements.pages.length} pages`);

      const attempt3 = await callGenerationLLM(
        llmClient, systemPrompt, reducedRequirements, recipeId, model, GENERATION_RETRY_MAX_TOKENS, 3, hasSrcDir,
      );
      if (attempt3.result) {
        debugLog(`✅ Attempt 3 succeeded: ${attempt3.result.files.length} files`);
        debugLog(`========== FEATURE CODE GENERATION END ==========`);
        return attempt3.result;
      }
      debugLog(`❌ Attempt 3 also failed.`);
    }
  }

  debugWarn(`❌ ALL generation attempts failed for "${requirements.app_type}" (${requirements.features.length} features, ${requirements.pages.length} pages)`);
  debugLog(`========== FEATURE CODE GENERATION END ==========`);
  return null;
}

/**
 * Call the LLM with heartbeat-based timeout.
 * Uses streaming when available: as long as tokens keep arriving, the call stays alive.
 * Only kills the call if no tokens arrive for HEARTBEAT_TIMEOUT_MS (90s).
 * Falls back to non-streaming createMessage for test mocks.
 */
async function callLLMWithHeartbeat(
  llmClient: FeatureLLMClient,
  model: string,
  maxTokens: number,
  systemPrompt: string,
  userMessage: string,
  attemptNumber: number,
): Promise<{
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}> {
  if (llmClient.createMessageStream) {
    debugLog(`Using STREAMING mode with heartbeat (${HEARTBEAT_TIMEOUT_MS / 1000}s inactivity threshold)`);
    let heartbeatTimer: ReturnType<typeof setTimeout>;
    let rejectHeartbeat: (err: Error) => void;
    let chunkCount = 0;

    const heartbeatPromise = new Promise<never>((_, reject) => {
      rejectHeartbeat = reject;
    });

    const resetHeartbeat = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        rejectHeartbeat(new Error(
          `LLM generation stalled — no response for ${HEARTBEAT_TIMEOUT_MS / 1000}s ` +
          `(attempt ${attemptNumber}, received ${chunkCount} chunks before stall)`
        ));
      }, HEARTBEAT_TIMEOUT_MS);
    };

    resetHeartbeat();

    const streamPromise = llmClient.createMessageStream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      onDelta: (_delta: string) => {
        chunkCount++;
        resetHeartbeat();
        if (chunkCount % 200 === 0) {
          debugLog(`[HEARTBEAT] ${chunkCount} chunks received, still streaming...`);
        }
      },
    });

    try {
      const response = await Promise.race([streamPromise, heartbeatPromise]);
      clearTimeout(heartbeatTimer!);
      debugLog(`Stream complete: ${chunkCount} total chunks`);
      return response;
    } catch (err) {
      clearTimeout(heartbeatTimer!);
      throw err;
    }
  }

  debugLog(`No streaming available — using non-streaming createMessage`);
  const NON_STREAMING_TIMEOUT_MS = 5 * 60_000; // 5 minutes — generous but bounded
  const result = await Promise.race([
    llmClient.createMessage({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `Non-streaming LLM call timed out after ${NON_STREAMING_TIMEOUT_MS / 1000}s (attempt ${attemptNumber})`
      )), NON_STREAMING_TIMEOUT_MS),
    ),
  ]);
  return result;
}

/**
 * Single LLM call attempt with truncation detection and structured error reporting.
 * Uses heartbeat-based streaming timeout — no fixed deadline.
 */
async function callGenerationLLM(
  llmClient: FeatureLLMClient,
  systemPrompt: string,
  requirements: FeatureRequirements,
  recipeId: RecipeId,
  model: string,
  maxTokens: number,
  attemptNumber: number,
  hasSrcDir?: boolean,
): Promise<{ result: FeatureGenerationResult | null; truncated: boolean }> {
  debugLog(`callGenerationLLM attempt ${attemptNumber}`);
  debugLog(`  model: ${model}`);
  debugLog(`  maxTokens: ${maxTokens}`);

  try {
    const userMessage = buildGenerationUserMessage(requirements, recipeId, hasSrcDir);
    debugLog(`  user message length: ${userMessage.length} chars`);
    debugLog(`  user message (first 500 chars): ${userMessage.substring(0, 500)}`);

    debugLog(`Calling LLM for code generation...`);
    const response = await callLLMWithHeartbeat(
      llmClient, model, maxTokens, systemPrompt, userMessage, attemptNumber,
    );
    debugLog(`LLM code generation response received`);

    const stopReason = response.stop_reason || 'unknown';
    const usage = response.usage;
    debugLog(`  stop_reason: ${stopReason}`);
    debugLog(`  usage: ${JSON.stringify(usage)}`);
    debugLog(`  content blocks: ${response.content.length}, types: ${response.content.map(b => b.type).join(', ')}`);

    if (stopReason === 'max_tokens') {
      debugWarn(`❌ OUTPUT TRUNCATED (attempt ${attemptNumber}) at max_tokens=${maxTokens}`);
      return { result: null, truncated: true };
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock?.text) {
      debugWarn(`❌ Attempt ${attemptNumber}: No text block in LLM response`);
      return { result: null, truncated: false };
    }

    debugLog(`Raw generation response: ${textBlock.text.length} chars`);
    debugLog(`Response first 1000 chars: ${textBlock.text.substring(0, 1000)}`);
    debugLog(`Response last 500 chars: ${textBlock.text.substring(Math.max(0, textBlock.text.length - 500))}`);

    debugLog(`Parsing generation result...`);
    const result = parseGenerationResult(textBlock.text, recipeId);

    if (!result) {
      const openBraces = (textBlock.text.match(/\{/g) || []).length;
      const closeBraces = (textBlock.text.match(/\}/g) || []).length;
      debugWarn(`❌ Attempt ${attemptNumber}: Parse failed. openBraces=${openBraces}, closeBraces=${closeBraces}`);
      if (openBraces > closeBraces + 2) {
        debugWarn(`Likely truncated JSON — treating as truncated`);
        return { result: null, truncated: true };
      }
      debugWarn(`Response was NOT valid JSON. Full response dumped above.`);
      return { result: null, truncated: false };
    }

    debugLog(`✅ Attempt ${attemptNumber} parse succeeded`);
    debugLog(`  files: ${result.files.length} → ${result.files.map(f => f.path).join(', ')}`);
    debugLog(`  modified_files: ${result.modified_files?.length || 0}`);

    return { result, truncated: false };
  } catch (error) {
    debugWarn(`❌ Attempt ${attemptNumber} LLM call EXCEPTION`);
    debugWarn(`Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    debugWarn(`Error message: ${error instanceof Error ? error.message : String(error)}`);
    debugWarn(`Error stack: ${error instanceof Error ? error.stack : 'N/A'}`);
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

function buildGenerationSystemPrompt(recipeId: RecipeId, designPack: DesignPack | null, projectContext?: ProjectContext, hasSrcDir?: boolean, tokens?: DesignTokens): string {
  const recipeConstraints = getRecipeConstraints(recipeId, hasSrcDir);

  const tokenSource = designPack ? 'designPack' : tokens ? 'designTokens' : 'fallback (no tokens!)';
  console.log(`[COLOR_PIPELINE] buildGenerationSystemPrompt — token source: ${tokenSource}`);
  if (tokens) {
    console.log(`[COLOR_PIPELINE]   tokens.primary: ${tokens.primary}, tokens.background: ${tokens.background}, tokens.accent: ${tokens.accent}`);
  }
  if (designPack) {
    console.log(`[COLOR_PIPELINE]   designPack: ${designPack.id} (${designPack.name})`);
  }
  if (!designPack && !tokens) {
    console.log(`[COLOR_PIPELINE]   ⚠️ WARNING: No tokens passed — LLM will use generic semantic class fallback`);
  }

  const designTokensStr = designPack
    ? getDesignTokenString(designPack)
    : tokens
      ? getTokensOnlyDesignString(tokens)
      : getSemanticClassFallback();

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
- Use Tailwind CSS + shadcn/ui for ALL styling
- Follow ${recipeConstraints.fileConvention} file conventions
- Components must be functional React components with hooks
- Use React hooks for state management (useState, useReducer — no external state library)
- Keep code simple and readable — no over-engineering
- Each file must be complete and self-contained (all imports included)
- Generate clean, production-quality code
${rscRules}
DESIGN TOKENS:
${designTokensStr}

SHADCN/UI COMPONENTS (CRITICAL — USE THESE INSTEAD OF RAW HTML):
The project has shadcn/ui installed with these components available at @/components/ui/*:
- Button: import { Button } from "@/components/ui/button"
- Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter: import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
- Input: import { Input } from "@/components/ui/input"
- Label: import { Label } from "@/components/ui/label"
- Badge: import { Badge } from "@/components/ui/badge"
- Checkbox: import { Checkbox } from "@/components/ui/checkbox"
- Select, SelectTrigger, SelectValue, SelectContent, SelectItem: from "@/components/ui/select"
- Textarea: import { Textarea } from "@/components/ui/textarea"
- Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter: from "@/components/ui/dialog"
- Table, TableHeader, TableRow, TableHead, TableBody, TableCell: from "@/components/ui/table"
- Tabs, TabsList, TabsTrigger, TabsContent: from "@/components/ui/tabs"
- Separator: import { Separator } from "@/components/ui/separator"
- Skeleton: import { Skeleton } from "@/components/ui/skeleton"
- Tooltip, TooltipTrigger, TooltipContent, TooltipProvider: from "@/components/ui/tooltip"
- ScrollArea: import { ScrollArea } from "@/components/ui/scroll-area"

MANDATORY: Use <Button>, <Input>, <Card>, <Badge>, <Checkbox>, <Select>, <Tabs>, <Dialog>, <Table> etc. from shadcn/ui.
NEVER use raw <input>, <button>, <select>, <table> HTML elements. Always import from @/components/ui/*.
Also import the cn() utility: import { cn } from "@/lib/utils"

CRITICAL CSS RULES:
- DO NOT generate or modify globals.css, layout.tsx, or lib/utils.ts — these are managed by the overlay system
- DO NOT include @tailwind directives or @import "tailwindcss" in any generated file
- Tailwind utility classes (bg-primary, text-foreground, border-border, etc.) work the same regardless of Tailwind version

VISUAL QUALITY RULES:
- COMPLETELY replace default template content in the home page — NO default logos, SVGs, hero sections, or Next.js/Vite boilerplate
- Page layout: wrap in a container div with className="container mx-auto py-8 px-4 max-w-5xl"
- Typography hierarchy: use text-3xl font-bold font-heading for h1, text-xl font-semibold for h2, text-base for body
- Wrap forms and lists in <Card> with <CardHeader> and <CardContent>
- List items should use individual <Card> components with hover effects
- Include empty states with muted-foreground text and subtle icons
- Use responsive layout: flex flex-col gap-4 for mobile, md:flex-row for desktop
- Add spacing between sections: space-y-6 or gap-6
- Use <Badge variant="secondary"> for tags, priorities, categories
- Use <Separator> between sections

OUTPUT FORMAT:
Respond with ONLY valid JSON matching this schema (no markdown, no explanation).
CRITICAL: The "content" field contains code as a JSON string. You MUST properly escape all special characters:
- Newlines → \\n
- Tabs → \\t  
- Double quotes inside code → \\"
- Backslashes → \\\\
The JSON must be parseable by JSON.parse(). Do NOT use literal newlines inside string values.

{
  "files": [
    {
      "path": "relative/path/to/File.tsx",
      "content": "'use client';\\nimport { useState } from 'react';\\n...",
      "description": "what this file does",
      "kind": "component|page|type|hook|util|api|config"
    }
  ],
  "modified_files": [
    {
      "path": "relative/path/to/existing/file",
      "content": "complete new file content with \\n for newlines",
      "description": "what was changed"
    }
  ],
  "summary": "Brief description of what was generated"
}

EXAMPLE COMPONENT (shows correct shadcn/ui + Tailwind usage):
\`\`\`tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Task { id: string; title: string; done: boolean; }

export function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState('');

  const addTask = () => {
    if (!input.trim()) return;
    setTasks(prev => [...prev, { id: crypto.randomUUID(), title: input, done: false }]);
    setInput('');
  };

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-3xl">
      <h1 className="text-3xl font-bold font-heading mb-6">Tasks</h1>
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add a task..."
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              className="flex-1"
            />
            <Button onClick={addTask}>Add Task</Button>
          </div>
        </CardContent>
      </Card>
      <div className="flex items-center gap-2 mb-4">
        <Badge variant="secondary">{tasks.length} total</Badge>
        <Badge variant="outline">{tasks.filter(t => t.done).length} done</Badge>
      </div>
      {tasks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No tasks yet. Add one above!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <Card key={task.id} className="transition-colors hover:bg-muted/50">
              <CardContent className="flex items-center gap-3 py-3">
                <Checkbox checked={task.done} onCheckedChange={() => toggleTask(task.id)} />
                <span className={cn('flex-1', task.done && 'line-through text-muted-foreground')}>
                  {task.title}
                </span>
                {task.done && <Badge variant="outline" className="text-xs">Done</Badge>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
\`\`\`

IMPORTANT:
- File content must be valid TypeScript/TSX
- Use double quotes for JSON strings, escape internal quotes
- Include all necessary imports in each file
- For modified_files, provide the COMPLETE new file content (not a diff)
- Do NOT generate or modify layout.tsx — the layout with sidebar/header is already set up
- Do NOT generate or modify globals.css — the design system CSS is already configured
- Do NOT generate lib/utils.ts — the cn() helper is already set up`;
}

function buildGenerationUserMessage(requirements: FeatureRequirements, recipeId: RecipeId, hasSrcDir?: boolean): string {
  const recipeConstraints = getRecipeConstraints(recipeId, hasSrcDir);

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

VISUAL QUALITY (CRITICAL — this determines if the app looks professional):
- MUST use shadcn/ui components: <Button>, <Input>, <Card>, <Badge>, <Checkbox>, <Select>, <Dialog>, <Table>, <Tabs> etc.
- NEVER use raw HTML <input>, <button>, <select>, <table> — always use shadcn/ui equivalents
- Import from @/components/ui/* and import cn from @/lib/utils
- Wrap forms in <Card> with <CardHeader>/<CardContent>
- Use <Badge> for status, priority, categories
- List items should use individual <Card> components
- Include empty state messaging with an icon and muted text when no items exist
- The home page MUST be fully replaced — no default template content remaining
- Apply the DESIGN STYLE PATTERNS from the system prompt to ALL components (cards, buttons, inputs, headers)
- Add hover effects, transitions, and micro-interactions (transition-all, hover:shadow-lg, etc.)
- Use generous spacing: containers with py-8 px-6, sections with space-y-6, items with gap-4
- Create a polished header/title area with proper hierarchy (text-3xl font-bold + text-muted-foreground subtitle)
- The app should look like a production-ready product, not a developer prototype

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

function getRecipeConstraints(recipeId: RecipeId, hasSrcDir?: boolean): RecipeConstraints {
  switch (recipeId) {
    case 'nextjs_app_router': {
      const prefix = hasSrcDir ? 'src/' : '';
      return {
        framework: 'Next.js 14 App Router',
        fileConvention: `${prefix}app/ directory for routes, ${prefix}components/ for components, ${prefix}types/ for types, ${prefix}hooks/ for hooks`,
        homePagePath: `${prefix}app/page.tsx`,
        componentDir: `${prefix}components`,
        typesDir: `${prefix}types`,
        hooksDir: `${prefix}hooks`,
      };
    }
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

function getVibeStyleGuide(vibe: string): string {
  switch (vibe) {
    case 'glass':
      return `
DESIGN STYLE: GLASSMORPHISM
Apply frosted glass aesthetic throughout the entire app:

CARD PATTERNS (use for ALL cards, panels, sections):
- className="bg-white/60 backdrop-blur-xl border border-white/30 shadow-lg rounded-xl"
- For hover: add "hover:bg-white/70 hover:shadow-xl transition-all duration-300"
- For dark sections: "bg-black/20 backdrop-blur-xl border border-white/10"

INPUT PATTERNS:
- className="bg-white/50 backdrop-blur-sm border border-white/30 rounded-lg focus:bg-white/70 focus:border-primary/50 transition-all"

HEADER/NAVBAR:
- className="bg-white/60 backdrop-blur-xl border-b border-white/30 sticky top-0 z-50"

SIDEBAR:
- className="bg-white/30 backdrop-blur-2xl border-r border-white/20"

BUTTON PATTERNS:
- Primary: className="bg-primary/90 backdrop-blur-sm text-primary-foreground rounded-lg px-6 py-2.5 hover:bg-primary shadow-lg hover:shadow-xl transition-all"
- Ghost: className="bg-white/20 backdrop-blur-sm border border-white/30 hover:bg-white/40 rounded-lg transition-all"

LAYOUT PRINCIPLES:
- Add subtle gradient background to the page body (already configured in globals.css)
- Use generous padding (p-6, p-8) and rounded-xl corners
- Add shadow-lg to elevated elements
- Use border-white/20 or border-white/30 for borders (not border-border for glass effect)
- Use text-foreground/80 for secondary text
- Space sections with gap-6 or space-y-6`;

    case 'neo':
      return `
DESIGN STYLE: NEON/CYBERPUNK
Apply dark futuristic aesthetic with cyan glow effects:

CARD PATTERNS:
- className="bg-card border border-cyan-500/20 rounded-sm shadow-[0_0_15px_rgba(34,211,238,0.1)]"
- For hover: add "hover:border-cyan-500/40 hover:shadow-[0_0_25px_rgba(34,211,238,0.2)] transition-all"

INPUT PATTERNS:
- className="bg-background border border-cyan-500/20 rounded-sm focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all"

BUTTON PATTERNS:
- Primary: className="bg-cyan-500 text-black font-bold rounded-sm px-6 py-2.5 hover:bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all"
- Ghost: className="border border-cyan-500/30 text-cyan-400 rounded-sm hover:bg-cyan-500/10 transition-all"

LAYOUT PRINCIPLES:
- Use sharp corners (rounded-sm or rounded-none)
- Add cyan glow effects to interactive elements
- Use monospace font for data/numbers: className="font-mono"
- Dark backgrounds with subtle radial gradients (already configured)
- Use border-cyan-500/20 for borders`;

    case 'vibrant':
      return `
DESIGN STYLE: VIBRANT & PLAYFUL
Apply colorful, energetic aesthetic with purple accents:

CARD PATTERNS:
- className="bg-card border border-border rounded-2xl shadow-md hover:shadow-lg transition-all"
- For featured: add "ring-2 ring-primary/20"

BUTTON PATTERNS:
- Primary: className="bg-primary text-primary-foreground rounded-full px-6 py-2.5 hover:bg-primary/90 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"

LAYOUT PRINCIPLES:
- Use generous rounded corners (rounded-2xl, rounded-full for buttons)
- Add subtle hover animations (translate, scale)
- Use gradient accents: className="bg-gradient-to-r from-primary to-accent"
- Bold typography with playful spacing`;

    case 'warm':
      return `
DESIGN STYLE: WARM & APPROACHABLE
Apply cozy, amber-toned aesthetic:

CARD PATTERNS:
- className="bg-card border border-border rounded-xl shadow-sm hover:shadow-md transition-all"

BUTTON PATTERNS:
- Primary: className="bg-primary text-primary-foreground rounded-xl px-6 py-2.5 hover:bg-primary/90 transition-all"

LAYOUT PRINCIPLES:
- Soft rounded corners (rounded-xl)
- Warm amber tones for accents
- Comfortable spacing and generous padding
- Use bg-muted for subtle section backgrounds`;

    case 'enterprise':
      return `
DESIGN STYLE: ENTERPRISE PROFESSIONAL
Apply clean, structured corporate aesthetic:

CARD PATTERNS:
- className="bg-card border border-border rounded-lg shadow-sm"

BUTTON PATTERNS:
- Primary: className="bg-primary text-primary-foreground rounded-md px-5 py-2 hover:bg-primary/90 font-medium transition-colors"

LAYOUT PRINCIPLES:
- Precise alignment and consistent spacing
- Structured data presentation with tables
- Professional blue tones
- Dense but readable layouts`;

    case 'dark':
      return `
DESIGN STYLE: DARK MODERN (Linear-inspired)
Apply sleek, minimal dark aesthetic:

CARD PATTERNS:
- className="bg-card border border-border rounded-lg hover:border-muted-foreground/30 transition-colors"

BUTTON PATTERNS:
- Primary: className="bg-primary text-primary-foreground rounded-md px-5 py-2 hover:bg-primary/90 transition-colors"

LAYOUT PRINCIPLES:
- Minimal borders (border-border)
- Subtle hover state changes
- Zinc/neutral color palette
- Clean typography with good contrast`;

    case 'gradient':
      return `
DESIGN STYLE: GRADIENT & COLORFUL
Apply vibrant gradient aesthetic:

CARD PATTERNS:
- className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg"

BUTTON PATTERNS:
- Primary: className="bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-lg px-6 py-2.5 hover:opacity-90 shadow-lg transition-all"

TEXT PATTERNS:
- Hero text: className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent"

LAYOUT PRINCIPLES:
- Gradient backgrounds and accent elements
- Semi-transparent card surfaces
- Bold, colorful interactive elements`;

    default:
      return `
DESIGN STYLE: MINIMAL CLEAN
Use clean, content-first aesthetic with semantic Tailwind classes.`;
  }
}

function getTokensOnlyDesignString(tkns: DesignTokens): string {
  const tokenVars = Object.entries(tkns)
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `  --${k.replace(/_/g, '-')}: ${v};`)
    .join('\n');

  return `Custom design tokens have been applied to globals.css as CSS variables:
${tokenVars}

SEMANTIC COLOR CLASSES (always available — USE THESE, never hardcode colors):
- Primary (CTAs, buttons): bg-primary text-primary-foreground
- Secondary (secondary actions): bg-secondary text-secondary-foreground
- Accent (highlights, links): bg-accent text-accent-foreground
- Muted (subtle backgrounds): bg-muted text-muted-foreground
- Background/Foreground: bg-background text-foreground
- Card surfaces: bg-card text-card-foreground
- Borders: border-border
- Inputs: border-input
- Focus rings: ring-ring
- Destructive: bg-destructive text-destructive-foreground

CARD PATTERNS:
- className="bg-card border border-border rounded-lg shadow-sm"
- For featured: add "ring-2 ring-ring/20"

BUTTON PATTERNS:
- Primary: className="bg-primary text-primary-foreground rounded-md px-5 py-2 hover:bg-primary/90 transition-colors"

CRITICAL RULES:
- Do NOT use arbitrary value syntax like text-[var(--primary)] or bg-[var(--background)]
- Do NOT use hardcoded colors like bg-blue-500, border-gray-200, text-white, bg-white, border-white/20
- ALWAYS use semantic class names: bg-primary, text-foreground, border-border, bg-card, etc.
- The app should feel cohesive and visually polished, not like a default template`;
}

function getSemanticClassFallback(): string {
  return `The project uses shadcn/ui's CSS variable-based design system with semantic Tailwind classes.

SEMANTIC COLOR CLASSES (always available — USE THESE, never hardcode colors):
- Primary (CTAs, buttons): bg-primary text-primary-foreground
- Secondary (secondary actions): bg-secondary text-secondary-foreground
- Accent (highlights, links): bg-accent text-accent-foreground
- Muted (subtle backgrounds): bg-muted text-muted-foreground
- Background/Foreground: bg-background text-foreground
- Card surfaces: bg-card text-card-foreground
- Borders: border-border
- Inputs: border-input
- Focus rings: ring-ring
- Destructive: bg-destructive text-destructive-foreground

CARD PATTERNS:
- className="bg-card border border-border rounded-lg shadow-sm"

BUTTON PATTERNS:
- Primary: className="bg-primary text-primary-foreground rounded-md px-5 py-2 hover:bg-primary/90 transition-colors"

CRITICAL RULES:
- Do NOT use arbitrary value syntax like text-[var(--primary)] or bg-[var(--background)]
- Do NOT use hardcoded colors like bg-blue-500, border-gray-200, text-white, bg-white, border-white/20
- ALWAYS use semantic class names: bg-primary, text-foreground, border-border, bg-card, etc.
- The app should feel cohesive and visually polished, not like a default template`;
}

function getDesignTokenString(designPack: DesignPack): string {
  const vibeGuide = getVibeStyleGuide(designPack.vibe);

  return `Design pack: "${designPack.name}" (${designPack.vibe} vibe).
The tailwind.config.ts has been extended with design pack colors mapped to CSS variables.
${vibeGuide}

SEMANTIC COLOR CLASSES (always available):
- Primary (CTAs, buttons): bg-primary text-primary-foreground
- Secondary (secondary actions): bg-secondary text-secondary-foreground
- Accent (highlights, links): bg-accent text-accent-foreground
- Muted (subtle backgrounds): bg-muted text-muted-foreground
- Background/Foreground: bg-background text-foreground
- Borders: border-border

CRITICAL RULES:
- Do NOT use arbitrary value syntax like text-[var(--primary)] or bg-[var(--background)]
- Use the semantic class names (bg-primary, text-foreground, border-border, etc.) and the design-specific patterns above
- Apply the design style consistently across ALL components — every card, button, input, header should follow the patterns above
- The app should feel cohesive and visually polished, not like a default template`;
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

function parseGenerationResult(text: string, _recipeId: RecipeId): FeatureGenerationResult | null {
  const jsonStr = extractJsonFromResponse(text);
  if (!jsonStr) {
    console.warn(`${LOG_PREFIX} Could not extract JSON from response (${text.length} chars)`);
    return null;
  }

  // Strategy 1: Direct JSON.parse
  let parsed = tryJsonParse(jsonStr);

  // Strategy 2: Repair common JSON issues from LLM output (unescaped newlines, tabs in strings)
  if (!parsed) {
    console.log(`${LOG_PREFIX} Direct parse failed, attempting JSON repair...`);
    const repaired = repairJsonString(jsonStr);
    parsed = tryJsonParse(repaired);
    if (parsed) {
      console.log(`${LOG_PREFIX} JSON repair succeeded`);
    }
  }

  // Strategy 3: Extract files individually using regex (preserves modified_files semantics)
  if (!parsed) {
    console.log(`${LOG_PREFIX} JSON repair failed, attempting regex file extraction...`);
    const extracted = extractFilesViaRegex(text);
    if (extracted && (extracted.files.length > 0 || extracted.modified_files.length > 0)) {
      const totalCount = extracted.files.length + extracted.modified_files.length;
      console.log(`${LOG_PREFIX} Regex extraction found ${extracted.files.length} new files, ${extracted.modified_files.length} modified files`);
      return {
        files: extracted.files,
        modified_files: extracted.modified_files,
        summary: `Generated ${totalCount} files (extracted via fallback parser)`,
      };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    console.warn(`${LOG_PREFIX} All parse strategies failed`);
    return null;
  }

  return validateParsedResult(parsed);
}

function extractJsonFromResponse(text: string): string | null {
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\s*```\s*$/, '');
  }
  if (!jsonStr.startsWith('{')) {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    } else {
      return null;
    }
  }
  return jsonStr;
}

function tryJsonParse(str: string): any | null {
  try {
    return JSON.parse(str);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`${LOG_PREFIX} JSON.parse error: ${msg}`);
    return null;
  }
}

function repairJsonString(str: string): string {
  // The LLM often puts real newlines/tabs inside JSON string values.
  // Walk through the string and escape unescaped control chars inside string values.
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }

    result += ch;
  }

  return result;
}

function extractFilesViaRegex(text: string): { files: GeneratedFile[]; modified_files: ModifiedFileEntry[] } | null {
  const files: GeneratedFile[] = [];
  const modifiedFiles: ModifiedFileEntry[] = [];

  // Locate the "modified_files" section boundary so entries found after it
  // are treated as modifications, not new files.
  const modifiedSectionStart = text.indexOf('"modified_files"');

  const fileRegex = /"path"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;

  while ((match = fileRegex.exec(text)) !== null) {
    const filePath = match[1];
    let content: string;
    try {
      content = JSON.parse(`"${match[2]}"`);
    } catch {
      content = match[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
    }
    if (!filePath || !content || content.length === 0) continue;

    const isModified = modifiedSectionStart !== -1 && match.index > modifiedSectionStart;

    if (isModified) {
      modifiedFiles.push({ path: filePath, content, description: '' });
    } else {
      files.push({
        path: filePath,
        content,
        description: '',
        kind: filePath.includes('/page') ? 'page' : 'component',
      });
    }
  }

  return (files.length > 0 || modifiedFiles.length > 0)
    ? { files, modified_files: modifiedFiles }
    : null;
}

function validateParsedResult(parsed: any): FeatureGenerationResult | null {
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
  callLLMWithHeartbeat,
  GENERATION_MAX_TOKENS,
  GENERATION_RETRY_MAX_TOKENS,
  MAX_GENERATION_ATTEMPTS,
  HEARTBEAT_TIMEOUT_MS,
};

export type { RecipeConstraints };
