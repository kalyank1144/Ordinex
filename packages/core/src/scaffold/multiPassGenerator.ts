/**
 * Multi-Pass Generator — Orchestrates staged code generation.
 *
 * For apps with >= 5 pages, runs 5 passes:
 *   1. Layout pass    — app/layout.tsx + responsive shell
 *   2. Routes pass    — route files + route groups
 *   3. Components pass — reusable shadcn-first components
 *   4. Pages pass     — page implementations using components
 *   5. Polish pass    — loading.tsx, error.tsx, responsive, a11y
 *
 * For simple apps (<= 3 pages), runs a single-pass generation.
 * Quality gates remain mandatory in both modes.
 *
 * Each pass produces a manifest before writes — no direct ad hoc writes.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AppBlueprint, ScaffoldStage, PassManifest, ManifestEntry } from './blueprintSchema';
import type { FeatureLLMClient } from './featureExtractor';
import type { DesignPack } from './designPacks';
import type { DesignTokens } from './tokenValidator';
import { callLLMWithHeartbeat, HEARTBEAT_TIMEOUT_MS } from './featureCodeGenerator';

// ============================================================================
// TYPES
// ============================================================================

export type PassType = 'layout' | 'routes' | 'components' | 'pages' | 'polish' | 'single';

export interface GeneratedFile {
  relativePath: string;
  content: string;
}

export interface PassResult {
  pass: PassType;
  stage: ScaffoldStage;
  files: GeneratedFile[];
  manifest: PassManifest;
}

export interface MultiPassConfig {
  blueprint: AppBlueprint;
  projectDir: string;
  recipeId: string;
}

export interface GenerationPlan {
  singlePass: boolean;
  passes: PassType[];
  totalFiles: number;
}

// ============================================================================
// PLANNING
// ============================================================================

/**
 * Determine whether to use multi-pass or single-pass generation.
 */
export function planGeneration(blueprint: AppBlueprint): GenerationPlan {
  const pageCount = blueprint.pages.length;
  const singlePass = pageCount <= 3;

  if (singlePass) {
    return {
      singlePass: true,
      passes: ['single'],
      totalFiles: estimateFileCount(blueprint),
    };
  }

  // Skip layout (overlay handles it) and polish (overlay creates loading/error/not-found).
  // Generate components first, then pages in batches of ~4 to stay within token limits.
  const passes: PassType[] = ['components'];

  // Batch pages: each "pages" pass handles a subset of blueprint pages.
  // We store the batch indices externally via pageBatches.
  const PAGES_PER_BATCH = 4;
  const batchCount = Math.ceil(pageCount / PAGES_PER_BATCH);
  for (let i = 0; i < batchCount; i++) {
    passes.push('pages');
  }

  return {
    singlePass: false,
    passes,
    totalFiles: estimateFileCount(blueprint),
  };
}

function estimateFileCount(bp: AppBlueprint): number {
  let count = 3; // layout, globals, utils
  count += bp.pages.length; // page files
  count += bp.pages.length; // loading files
  count += new Set(bp.pages.flatMap(p => p.key_components)).size; // unique components
  count += bp.data_models.length; // type/model files
  return count;
}

// ============================================================================
// MANIFEST CREATION
// ============================================================================

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Build a manifest from a list of generated files.
 * Checks existing files in projectDir to determine create vs modify.
 */
export function buildPassManifest(
  stage: ScaffoldStage,
  files: GeneratedFile[],
  projectDir: string,
): PassManifest {
  const create: ManifestEntry[] = [];
  const modify: ManifestEntry[] = [];

  for (const file of files) {
    const absPath = path.join(projectDir, file.relativePath);
    const newHash = sha256(file.content);

    if (fs.existsSync(absPath)) {
      try {
        const existing = fs.readFileSync(absPath, 'utf-8');
        modify.push({
          path: file.relativePath,
          baseSha256: sha256(existing),
          newSha256: newHash,
        });
      } catch {
        create.push({ path: file.relativePath, newSha256: newHash });
      }
    } else {
      create.push({ path: file.relativePath, newSha256: newHash });
    }
  }

  return { stage, create, modify };
}

const PROTECTED_PATHS = ['globals.css', 'layout.tsx', 'lib/utils.ts'];

/**
 * Apply a manifest's files atomically to the project directory.
 * Writes all files after creating necessary directories.
 * Skips protected files that should not be overwritten by LLM output.
 */
export async function applyPassManifest(
  files: GeneratedFile[],
  projectDir: string,
): Promise<void> {
  const safeFiles = files.filter(f => {
    const isProtected = PROTECTED_PATHS.some(p => f.relativePath.endsWith(p));
    if (isProtected) {
      console.log(`[applyPassManifest] Skipping protected file: ${f.relativePath}`);
    }
    return !isProtected;
  });

  const dirs = new Set(safeFiles.map(f => path.dirname(path.join(projectDir, f.relativePath))));
  for (const dir of dirs) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  for (const file of safeFiles) {
    const absPath = path.join(projectDir, file.relativePath);
    await fs.promises.writeFile(absPath, file.content, 'utf-8');
  }
}

// ============================================================================
// PASS-SPECIFIC PROMPT BUILDERS
// ============================================================================

export function buildLayoutPassPrompt(blueprint: AppBlueprint, prefix: string = ''): string {
  return `Generate the root layout for a ${blueprint.app_type} app called "${blueprint.app_name}".

Layout: ${blueprint.primary_layout}
Pages: ${blueprint.pages.map(p => p.name).join(', ')}

Requirements:
- Use shadcn/ui components (import from @/components/ui/*)
- Responsive: sidebar collapses to Sheet on mobile (< 768px)
- Include proper metadata
- Use Inter font from next/font/google
- Import globals.css

Return ONLY the file content for ${prefix}app/layout.tsx. No markdown, no explanations.`;
}

export function buildRoutesPassPrompt(blueprint: AppBlueprint, prefix: string = ''): string {
  const pages = blueprint.pages.map(p =>
    `- ${p.name}: path="${p.path}", layout=${p.layout}, auth=${p.is_auth_required}`
  ).join('\n');

  return `Generate route files for these pages:

${pages}

Requirements:
- Each page should be a proper Next.js page component (export default function)
- Pages that need auth should be in a (auth) route group
- Use shadcn/ui Card, Button, Badge components — NO raw HTML
- Add "use client" if using hooks or event handlers
- Include meaningful UI with proper styling, not just text placeholders
- Use TypeScript

For EACH page, return the file as:
--- FILE: ${prefix}app{path}/page.tsx ---
{content}
--- END FILE ---`;
}

export function buildComponentsPassPrompt(blueprint: AppBlueprint, prefix: string = ''): string {
  const components = [...new Set(blueprint.pages.flatMap(p => p.key_components))];

  return `Generate reusable React components for a ${blueprint.app_type} app.

Components needed: ${components.join(', ')}

Requirements:
- Use shadcn/ui as the base — import Button, Card, Input, Badge, etc. from @/components/ui/*
- NEVER use raw HTML <button>, <input>, <table> — ALWAYS use shadcn equivalents
- Each component should be in ${prefix}components/ directory
- TypeScript with proper prop interfaces
- Responsive and accessible
- Use cn() from @/lib/utils for conditional classes
- Include hover states and transitions
- Add "use client" if using hooks or event handlers

Available shadcn components: ${blueprint.shadcn_components.join(', ')}

For EACH component, return as:
--- FILE: ${prefix}components/{name}.tsx ---
{content}
--- END FILE ---`;
}

export function buildPagesPassPrompt(blueprint: AppBlueprint, prefix: string = ''): string {
  const pages = blueprint.pages.map(p =>
    `- ${p.name} (${p.path}): ${p.description}. Components: ${p.key_components.join(', ')}`
  ).join('\n');

  return `Implement full page content for each page in a ${blueprint.app_type} app.

Pages:
${pages}

Data models:
${blueprint.data_models.map(dm => `- ${dm.name}: ${dm.fields.join(', ')}`).join('\n')}

Requirements:
- Import and use the generated components from @/components/
- Use shadcn/ui for ALL UI elements (Button, Card, Input, Badge, Tabs, Dialog, etc.)
- NEVER use raw HTML <button>, <input>, <select> — ALWAYS import from @/components/ui/*
- Wrap content in <Card> with <CardHeader>/<CardContent>
- Include empty states with icons and muted-foreground text
- Add "use client" if using hooks or event handlers
- Use proper TypeScript types
- Use mock data that looks realistic
- Each page should be complete, functional, and visually polished

For EACH page, return as:
--- FILE: ${prefix}app{path}/page.tsx ---
{content}
--- END FILE ---`;
}

export function buildPolishPassPrompt(blueprint: AppBlueprint, prefix: string = ''): string {
  return `Add polish files for a ${blueprint.app_type} app.

Generate:
1. ${prefix}app/loading.tsx - Skeleton loading state
2. ${prefix}app/error.tsx - Error boundary with retry button
3. ${prefix}app/not-found.tsx - Custom 404 page

Requirements:
- Use shadcn/ui Skeleton component for loading
- Error page should show error message and retry Button (from @/components/ui/button)
- 404 page should have a link back to home with styled Button
- All pages should be responsive
- Use Card components for content containers

For EACH file, return as:
--- FILE: {path} ---
{content}
--- END FILE ---`;
}

/**
 * Parse LLM response containing multiple files into GeneratedFile array.
 * Handles multiple formats:
 *   1. --- FILE: path --- ... --- END FILE ---
 *   2. Markdown code blocks with file path in meta/comment
 *   3. // FILE: path ... // END FILE
 */
export function parseMultiFileResponse(response: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const seen = new Set<string>();

  const addFile = (relativePath: string, content: string) => {
    let p = relativePath.trim().replace(/^\/+/, '');
    // Strip any trailing asterisks, colons, or backticks
    p = p.replace(/[\*:`]+$/g, '').trim();
    const c = content.trim();
    if (p && c && !seen.has(p) && /\.(tsx?|jsx?|css|json)$/.test(p)) {
      seen.add(p);
      files.push({ relativePath: p, content: c });
    }
  };

  // Strategy 1: --- FILE: path --- ... --- END FILE ---
  const fileRegex = /---\s*FILE:\s*(.+?)\s*---\r?\n([\s\S]*?)---\s*END\s*FILE\s*---/gi;
  let match;
  while ((match = fileRegex.exec(response)) !== null) {
    addFile(match[1], match[2]);
  }
  if (files.length > 0) return files;

  // Strategy 1b: --- FILE: path --- blocks separated by next --- FILE: (without END markers)
  const splitRegex = /---\s*FILE:\s*(.+?)\s*---\r?\n([\s\S]*?)(?=---\s*FILE:|$)/gi;
  while ((match = splitRegex.exec(response)) !== null) {
    let content = match[2].trim();
    // Remove trailing --- END FILE --- if present
    content = content.replace(/---\s*END\s*FILE\s*---\s*$/i, '').trim();
    addFile(match[1], content);
  }
  if (files.length > 0) return files;

  // Strategy 2: Markdown code blocks with path annotations
  // Handles: ```tsx title="src/app/page.tsx"  or  ```tsx // src/app/page.tsx
  // or a line like `**src/app/page.tsx**:` or `### src/app/page.tsx` before the block
  const codeBlockRegex = /(?:(?:^|\n)(?:\*{1,2}|#{1,4}\s*)?([a-zA-Z][\w./\\-]*\.(?:tsx?|jsx?|css|json))\*{0,2}:?\s*\n)?```(?:tsx?|jsx?|css|json)?(?:\s+(?:title=["']?)?([a-zA-Z][\w./\\-]*\.(?:tsx?|jsx?|css|json))["']?)?\s*\n([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    const pathFromHeader = match[1];
    const pathFromMeta = match[2];
    const code = match[3];
    const filePath = pathFromMeta || pathFromHeader;
    if (filePath && code?.trim()) {
      addFile(filePath, code);
    }
  }
  if (files.length > 0) return files;

  // Strategy 3: // FILE: path at start of code block content
  const codeBlocks = response.matchAll(/```(?:tsx?|jsx?|css)?\s*\n([\s\S]*?)```/g);
  for (const block of codeBlocks) {
    const content = block[1];
    const firstLine = content.split('\n')[0].trim();
    const fileComment = firstLine.match(/^\/\/\s*(?:FILE|file|File):\s*(.+)/);
    if (fileComment) {
      const rest = content.split('\n').slice(1).join('\n');
      addFile(fileComment[1], rest);
    }
  }
  if (files.length > 0) return files;

  // Strategy 4: Single code block fallback
  if (response.trim().length > 0) {
    const singleBlock = response.match(/```(?:tsx?|jsx?)?\n([\s\S]*?)```/);
    if (singleBlock) {
      addFile('generated.tsx', singleBlock[1]);
    }
  }

  return files;
}

/**
 * Build a prompt for a specific batch of pages (not all pages at once).
 * Keeps the prompt focused and ensures the LLM generates complete files
 * without hitting token limits.
 */
function buildBatchedPagesPrompt(
  blueprint: AppBlueprint,
  batch: AppBlueprint['pages'],
  hasSrcDir?: boolean,
): string {
  const prefix = hasSrcDir ? 'src/' : '';

  const pages = batch.map(p =>
    `- ${p.name} (${p.path}): ${p.description}. Components: ${p.key_components.join(', ')}`
  ).join('\n');

  const models = blueprint.data_models.map(dm =>
    `- ${dm.name}: ${dm.fields.join(', ')}`
  ).join('\n');

  return `Generate COMPLETE, production-quality page implementations for these ${batch.length} pages in a ${blueprint.app_type.replace(/_/g, ' ')} app called "${blueprint.app_name}".

Pages to generate:
${pages}

Data models:
${models}

Requirements:
- Each page must be a fully functional Next.js page component
- Import and use shadcn/ui components (Card, Button, Badge, Table, Tabs, Dialog, Input, etc.)
- NEVER use raw HTML <button>, <input>, <select>, <table> — ALWAYS use shadcn/ui
- Add "use client" at the top of files that use React hooks or event handlers
- Use TypeScript with proper types
- Use mock data arrays that look realistic (3-5 sample items)
- Style with Tailwind CSS classes: container mx-auto, space-y-6, rounded-lg border, etc.
- Include empty states, hover effects, and responsive layout
- Each page should look polished and professional

For EACH page, output as:
--- FILE: ${prefix}app{route_path}/page.tsx ---
{complete file content}
--- END FILE ---

Generate ALL ${batch.length} pages. Do not skip any.`;
}

// ============================================================================
// STAGE MAPPING
// ============================================================================

export function passToStage(pass: PassType): ScaffoldStage {
  switch (pass) {
    case 'layout': return 'gen_layout';
    case 'routes': return 'gen_routes';
    case 'components': return 'gen_components';
    case 'pages': return 'gen_pages';
    case 'polish': return 'gen_polish';
    case 'single': return 'gen_pages';
  }
}

// ============================================================================
// LLM-POWERED MULTI-PASS EXECUTION
// ============================================================================

const MULTI_PASS_LOG = '[MultiPass]';
const MULTI_PASS_MAX_TOKENS = 16384;

function getPassPrompt(pass: PassType, blueprint: AppBlueprint, hasSrcDir?: boolean): string {
  const prefix = hasSrcDir ? 'src/' : '';
  switch (pass) {
    case 'layout': return buildLayoutPassPrompt(blueprint, prefix);
    case 'routes': return buildRoutesPassPrompt(blueprint, prefix);
    case 'components': return buildComponentsPassPrompt(blueprint, prefix);
    case 'pages': return buildPagesPassPrompt(blueprint, prefix);
    case 'polish': return buildPolishPassPrompt(blueprint, prefix);
    case 'single': return buildPagesPassPrompt(blueprint, prefix);
  }
}

function buildMultiPassSystemPrompt(
  blueprint: AppBlueprint,
  designPack: DesignPack | null,
  designTokens?: DesignTokens,
  hasSrcDir?: boolean,
  tailwindVersion?: 3 | 4,
): string {
  const tokenString = designTokens
    ? Object.entries(designTokens)
        .map(([k, v]) => `  --${k.replace(/_/g, '-')}: ${v};`)
        .join('\n')
    : '';

  const prefix = hasSrcDir ? 'src/' : '';
  const twV = tailwindVersion || 3;

  const tailwindNote = twV === 4
    ? `\nTAILWIND CSS VERSION: v4
- This project uses Tailwind CSS v4 with @import "tailwindcss" (NOT @tailwind directives)
- Color utilities work the same: bg-primary, text-foreground, border-border, etc.
- DO NOT generate @tailwind base/components/utilities — the project uses @import "tailwindcss"
- DO NOT modify globals.css or tailwind.config — they are pre-configured
- All shadcn/ui classes and Tailwind utilities work normally`
    : `\nTAILWIND CSS VERSION: v3
- This project uses Tailwind CSS v3 with @tailwind base/components/utilities
- Color utilities: bg-primary, text-foreground, border-border, etc.
- DO NOT modify globals.css or tailwind.config — they are pre-configured`;

  return `You are a senior frontend engineer generating production-quality Next.js code.
Your code MUST look like a polished, professional app — not a developer prototype.

App: "${blueprint.app_name}" (${blueprint.app_type.replace(/_/g, ' ')})
Layout: ${blueprint.primary_layout}
${designPack ? `Design: ${designPack.name} (${designPack.vibe})` : ''}
${tokenString ? `\nCSS Custom Properties (use these via Tailwind classes where possible):\n${tokenString}` : ''}
${tailwindNote}

FILE PATHS:
- Pages go in ${prefix}app/ directory (e.g., ${prefix}app/page.tsx, ${prefix}app/dashboard/page.tsx)
- Components go in ${prefix}components/ directory
- Types go in ${prefix}types/ directory
- Hooks go in ${prefix}hooks/ directory

SHADCN/UI COMPONENTS (MANDATORY — NEVER USE RAW HTML):
Available at @/components/ui/*:
- Button: import { Button } from "@/components/ui/button"
- Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter: from "@/components/ui/card"
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
Also: import { cn } from "@/lib/utils"

CRITICAL RULES:
- NEVER use raw <input>, <button>, <select>, <table> HTML elements — ALWAYS use shadcn/ui equivalents
- Use TypeScript with proper types and interfaces
- Add "use client" at the VERY TOP of files that use hooks/events/browser APIs
- Use Tailwind CSS classes: bg-primary, text-foreground, border-border, etc.
- Make all UIs responsive (mobile-first)
- Use mock data that looks realistic — no empty placeholders
- Apply design tokens consistently — use bg-primary, text-primary-foreground, etc.
- Include hover states and transitions: hover:shadow-lg, transition-all, hover:bg-primary/90
- Wrap forms in <Card> with <CardHeader>/<CardContent>
- Use <Badge> for status/categories, <Separator> between sections
- Use generous spacing: container mx-auto py-8 px-4, sections with space-y-6
- Include empty states with muted-foreground text and icons
- Generate complete, production-quality code — NO TODO placeholders, NO template boilerplate`;
}

export interface MultiPassExecutionResult {
  passes: PassResult[];
  totalFiles: number;
  success: boolean;
}

export type PassProgressCallback = (pass: PassType, passIndex: number, totalPasses: number) => void;

/**
 * Execute multi-pass code generation for complex apps (>= 5 pages).
 * Each pass generates a subset of files with focused context.
 *
 * @param writeDir - Directory to write files to (can be staging or project dir)
 * @param manifestDir - Directory to check existing files for manifest (usually the real project dir)
 */
export async function executeMultiPassGeneration(
  plan: GenerationPlan,
  blueprint: AppBlueprint,
  writeDir: string,
  llmClient: FeatureLLMClient,
  designPack: DesignPack | null,
  modelId: string,
  designTokens?: DesignTokens,
  onProgress?: PassProgressCallback,
  manifestDir?: string,
  hasSrcDir?: boolean,
  tailwindVersion?: 3 | 4,
): Promise<MultiPassExecutionResult> {
  const systemPrompt = buildMultiPassSystemPrompt(blueprint, designPack, designTokens, hasSrcDir, tailwindVersion);
  const passResults: PassResult[] = [];
  let totalFiles = 0;
  const manifestBase = manifestDir || writeDir;

  // Split blueprint pages into batches for "pages" passes
  const PAGES_PER_BATCH = 4;
  const pageBatches: AppBlueprint['pages'][] = [];
  for (let i = 0; i < blueprint.pages.length; i += PAGES_PER_BATCH) {
    pageBatches.push(blueprint.pages.slice(i, i + PAGES_PER_BATCH));
  }
  let pageBatchIndex = 0;

  for (let i = 0; i < plan.passes.length; i++) {
    const pass = plan.passes[i];
    const stage = passToStage(pass);

    // For batched page passes, get the current batch
    let batchLabel = pass as string;
    let currentBatch: AppBlueprint['pages'] | undefined;
    if (pass === 'pages' && pageBatches.length > 0) {
      currentBatch = pageBatches[pageBatchIndex];
      batchLabel = `pages (batch ${pageBatchIndex + 1}/${pageBatches.length}: ${currentBatch.map(p => p.name).join(', ')})`;
      pageBatchIndex++;
    }

    console.log(`${MULTI_PASS_LOG} Pass ${i + 1}/${plan.passes.length}: ${batchLabel}`);
    onProgress?.(pass, i, plan.passes.length);

    // Build prompt: for pages pass use only the current batch of pages
    let userPrompt: string;
    if (pass === 'pages' && currentBatch) {
      userPrompt = buildBatchedPagesPrompt(blueprint, currentBatch, hasSrcDir);
    } else {
      userPrompt = getPassPrompt(pass, blueprint, hasSrcDir);
    }

    try {
      console.log(`${MULTI_PASS_LOG} Calling LLM for ${batchLabel} (heartbeat: ${HEARTBEAT_TIMEOUT_MS / 1000}s inactivity threshold)...`);
      const response = await callLLMWithHeartbeat(
        llmClient, modelId, MULTI_PASS_MAX_TOKENS, systemPrompt, userPrompt, i + 1,
      );

      const textContent = response.content.find(c => c.type === 'text');
      const text = textContent && 'text' in textContent ? (textContent as { type: 'text'; text: string }).text : '';

      const files = parseMultiFileResponse(text);
      console.log(`${MULTI_PASS_LOG} ${batchLabel}: LLM returned ${text.length} chars, parsed ${files.length} files: ${files.map(f => f.relativePath).join(', ')}`);

      if (files.length === 0 && text.trim().length > 200) {
        console.warn(`${MULTI_PASS_LOG} WARNING: Got ${text.length} chars but parsed 0 files. First 500 chars: ${text.slice(0, 500)}`);
      }

      const manifest = buildPassManifest(stage, files, manifestBase);
      await applyPassManifest(files, writeDir);

      const result: PassResult = { pass, stage, files, manifest };
      passResults.push(result);
      totalFiles += files.length;

      console.log(`${MULTI_PASS_LOG} ✓ ${batchLabel}: ${files.length} files written`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`${MULTI_PASS_LOG} ✗ ${batchLabel} failed: ${errMsg}`);
      if (err instanceof Error && err.stack) {
        console.error(`${MULTI_PASS_LOG}   Stack: ${err.stack.split('\n').slice(0, 3).join(' | ')}`);
      }
      passResults.push({
        pass,
        stage,
        files: [],
        manifest: { stage, create: [], modify: [] },
      });
    }
  }

  return {
    passes: passResults,
    totalFiles,
    success: passResults.some(r => r.files.length > 0),
  };
}
