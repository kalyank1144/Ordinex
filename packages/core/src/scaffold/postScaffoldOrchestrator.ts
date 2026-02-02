/**
 * Post-Scaffold Orchestrator (Greenfield Flow Completion)
 * 
 * After CLI scaffold command runs (npx create-next-app, etc.), this module:
 * 1. Polls for project completion (package.json exists)
 * 2. Applies design pack tokens to generated project
 * 3. Emits next_steps_shown event to trigger NextStepsCard
 * 
 * This bridges the gap between terminal command completion and feature implementation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Event, Mode, Stage } from '../types';
import type { RecipeId } from './recipeTypes';
import { 
  getDesignPackById, 
  generateGlobalsCss, 
  DesignPack,
  DesignPackId 
} from './designPacks';
import { 
  getNextStepsForRecipe, 
  buildNextStepsShownPayload,
  NextStepsContext,
  NextStepSuggestion 
} from './nextSteps';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Simple interface for event publishing (compatible with Ordinex EventBus)
 * The EventBus uses `publish(event)` to persist and fan-out events.
 */
interface EventPublisher {
  publish(event: Event): void | Promise<void>;
}

export interface PostScaffoldContext {
  /** Task/run ID for event association */
  taskId: string;
  /** Scaffold operation ID */
  scaffoldId: string;
  /** Target directory where project was created */
  targetDirectory: string;
  /** App name (subdirectory name) */
  appName: string;
  /** Selected recipe ID */
  recipeId: RecipeId;
  /** Selected design pack ID */
  designPackId: DesignPackId;
  /** Event publisher for emitting events (must have publish method) */
  eventBus: EventPublisher;
  /** Current mode */
  mode: Mode;
}

export interface PostScaffoldResult {
  /** Whether orchestration completed successfully */
  success: boolean;
  /** Path to the created project (with app name) */
  projectPath?: string;
  /** Whether design pack was applied */
  designPackApplied?: boolean;
  /** Files modified by design pack application */
  modifiedFiles?: string[];
  /** Error message if failed */
  error?: string;
  /** Stage where failure occurred */
  failedStage?: 'polling' | 'design_pack' | 'next_steps';
}

export interface PostScaffoldPollingConfig {
  /** Maximum time to wait for project completion (ms) */
  maxWaitMs: number;
  /** Polling interval (ms) */
  pollIntervalMs: number;
  /** File to check for project completion */
  completionMarker: string;
}

const DEFAULT_POLLING_CONFIG: PostScaffoldPollingConfig = {
  maxWaitMs: 180000, // 3 minutes (CLI scaffolds can take a while)
  pollIntervalMs: 2000, // 2 seconds
  completionMarker: 'package.json',
};

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Start post-scaffold orchestration
 * 
 * This is the main entry point called after terminal.sendText(createCmd).
 * It handles the entire post-scaffold flow asynchronously.
 * 
 * @param ctx - Post-scaffold context
 * @param pollingConfig - Optional polling configuration
 * @returns Promise resolving to result when complete
 */
export async function startPostScaffoldOrchestration(
  ctx: PostScaffoldContext,
  pollingConfig: PostScaffoldPollingConfig = DEFAULT_POLLING_CONFIG
): Promise<PostScaffoldResult> {
  const LOG_PREFIX = '[PostScaffoldOrchestrator]';
  
  // Determine project path (workspace root + app name)
  const projectPath = path.join(ctx.targetDirectory, ctx.appName);
  
  console.log(`${LOG_PREFIX} Starting post-scaffold orchestration`);
  console.log(`${LOG_PREFIX} Project path: ${projectPath}`);
  console.log(`${LOG_PREFIX} Recipe: ${ctx.recipeId}, Design Pack: ${ctx.designPackId}`);
  
  try {
    // STEP 1: Emit "Creating Project" status event
    emitScaffoldProgress(ctx, 'creating', {
      message: `Setting up ${getRecipeDisplayName(ctx.recipeId)} project...`,
      project_path: projectPath,
    });
    
    // STEP 2: Poll for project completion
    console.log(`${LOG_PREFIX} Polling for project completion...`);
    const completionMarkerPath = path.join(projectPath, pollingConfig.completionMarker);
    
    const projectReady = await pollForCompletion(
      completionMarkerPath,
      pollingConfig,
      (elapsedMs) => {
        // Emit progress updates every 10 seconds
        if (elapsedMs % 10000 < pollingConfig.pollIntervalMs) {
          emitScaffoldProgress(ctx, 'creating', {
            message: `Still creating project... (${Math.floor(elapsedMs / 1000)}s)`,
            elapsed_ms: elapsedMs,
          });
        }
      }
    );
    
    if (!projectReady) {
      console.log(`${LOG_PREFIX} ❌ Timeout waiting for project completion`);
      emitScaffoldProgress(ctx, 'timeout', {
        message: 'Scaffold command may still be running. Check the terminal.',
        project_path: projectPath,
      });
      return {
        success: false,
        error: 'Timeout waiting for project completion',
        failedStage: 'polling',
      };
    }
    
    console.log(`${LOG_PREFIX} ✓ Project created successfully`);
    
    // STEP 3: Emit "Applying Design" status event
    emitScaffoldProgress(ctx, 'applying_design', {
      message: 'Applying design pack...',
      design_pack_id: ctx.designPackId,
    });
    
    // STEP 4: Apply design pack
    const designPack = getDesignPackById(ctx.designPackId);
    let designPackApplied = false;
    let modifiedFiles: string[] = [];
    
    if (designPack) {
      console.log(`${LOG_PREFIX} Applying design pack: ${designPack.name}`);
      const applyResult = await applyDesignPackToProject(
        projectPath,
        ctx.recipeId,
        designPack
      );
      designPackApplied = applyResult.success;
      modifiedFiles = applyResult.modifiedFiles;
      
      if (designPackApplied) {
        console.log(`${LOG_PREFIX} ✓ Design pack applied, modified ${modifiedFiles.length} files`);
        emitDesignPackApplied(ctx, designPack, modifiedFiles);
      } else {
        console.log(`${LOG_PREFIX} ⚠️ Design pack application skipped: ${applyResult.reason}`);
      }
    } else {
      console.log(`${LOG_PREFIX} ⚠️ Design pack not found: ${ctx.designPackId}`);
    }
    
    // STEP 5: Generate and emit Next Steps
    console.log(`${LOG_PREFIX} Generating next steps...`);
    
    const nextStepsContext: NextStepsContext = {
      scaffold_id: ctx.scaffoldId,
      recipe_id: ctx.recipeId,
      design_pack_id: ctx.designPackId,
      target_directory: projectPath,
      package_manager: detectPackageManager(projectPath),
    };
    
    const suggestions = getNextStepsForRecipe(nextStepsContext);
    console.log(`${LOG_PREFIX} ✓ Generated ${suggestions.length} next steps`);
    
    // Emit next_steps_shown event (triggers NextStepsCard in UI)
    emitNextStepsShown(ctx, nextStepsContext, suggestions);
    
    // STEP 6: Emit final scaffold completion
    emitScaffoldFinalComplete(ctx, projectPath, designPackApplied, suggestions.length);
    
    console.log(`${LOG_PREFIX} ✅ Post-scaffold orchestration complete`);
    
    return {
      success: true,
      projectPath,
      designPackApplied,
      modifiedFiles,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    
    emitScaffoldProgress(ctx, 'error', {
      message: `Post-scaffold failed: ${errorMessage}`,
      error: errorMessage,
    });
    
    return {
      success: false,
      error: errorMessage,
      failedStage: 'design_pack',
    };
  }
}

// ============================================================================
// POLLING LOGIC
// ============================================================================

/**
 * Poll for file existence with timeout
 */
async function pollForCompletion(
  filePath: string,
  config: PostScaffoldPollingConfig,
  onProgress?: (elapsedMs: number) => void
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < config.maxWaitMs) {
    // Check if file exists
    if (fs.existsSync(filePath)) {
      // Additional check: wait a bit more to ensure file is fully written
      await sleep(500);
      if (fs.existsSync(filePath)) {
        return true;
      }
    }
    
    // Progress callback
    if (onProgress) {
      onProgress(Date.now() - startTime);
    }
    
    // Wait before next check
    await sleep(config.pollIntervalMs);
  }
  
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// DESIGN PACK APPLICATION
// ============================================================================

interface DesignPackApplyResult {
  success: boolean;
  modifiedFiles: string[];
  reason?: string;
}

/**
 * Apply design pack tokens to a generated project
 * 
 * Modifies CSS files to include design tokens (colors, fonts, etc.)
 */
async function applyDesignPackToProject(
  projectPath: string,
  recipeId: RecipeId,
  designPack: DesignPack
): Promise<DesignPackApplyResult> {
  const modifiedFiles: string[] = [];
  
  try {
    // Determine which CSS file to modify based on recipe
    const cssTargets = getCssTargetsForRecipe(recipeId, projectPath);
    
    for (const cssTarget of cssTargets) {
      const cssPath = path.join(projectPath, cssTarget.path);
      
      // Check if file exists
      if (!fs.existsSync(cssPath)) {
        console.log(`[DesignPack] CSS target not found: ${cssTarget.path}`);
        continue;
      }
      
      // Read existing content
      const existingContent = fs.readFileSync(cssPath, 'utf-8');
      
      // Generate new content based on strategy
      let newContent: string;
      
      if (cssTarget.strategy === 'replace') {
        // For globals.css, generate complete file
        newContent = generateGlobalsCss(designPack);
      } else {
        // For other files, prepend design tokens
        const tokenVars = generateDesignTokenVariables(designPack);
        newContent = tokenVars + '\n\n' + existingContent;
      }
      
      // Write modified content
      fs.writeFileSync(cssPath, newContent, 'utf-8');
      modifiedFiles.push(cssTarget.path);
      console.log(`[DesignPack] ✓ Modified: ${cssTarget.path}`);
    }
    
    // Also try to add font links if using custom fonts
    await addFontImportsIfNeeded(projectPath, recipeId, designPack);
    
    return {
      success: modifiedFiles.length > 0,
      modifiedFiles,
      reason: modifiedFiles.length === 0 ? 'No CSS files found to modify' : undefined,
    };
    
  } catch (error) {
    return {
      success: false,
      modifiedFiles,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

interface CssTarget {
  path: string;
  strategy: 'replace' | 'prepend';
}

/**
 * Get CSS file targets based on recipe type
 */
function getCssTargetsForRecipe(recipeId: RecipeId, projectPath: string): CssTarget[] {
  switch (recipeId) {
    case 'nextjs_app_router':
      // Next.js App Router uses app/globals.css
      return [
        { path: 'app/globals.css', strategy: 'replace' },
        { path: 'src/app/globals.css', strategy: 'replace' }, // Alternative location
      ];
    
    case 'vite_react':
      // Vite React uses src/index.css
      return [
        { path: 'src/index.css', strategy: 'replace' },
      ];
    
    case 'expo':
      // Expo doesn't use traditional CSS, skip for now
      return [];
    
    default:
      return [
        { path: 'styles/globals.css', strategy: 'replace' },
        { path: 'src/styles/globals.css', strategy: 'replace' },
      ];
  }
}

/**
 * Generate CSS variable declarations from design pack
 */
function generateDesignTokenVariables(designPack: DesignPack): string {
  const { colors, fonts } = designPack.tokens;
  
  return `/* Ordinex Design Pack: ${designPack.name} */
:root {
  --primary: ${colors.primary};
  --secondary: ${colors.secondary};
  --accent: ${colors.accent};
  --background: ${colors.background};
  --foreground: ${colors.foreground};
  --muted: ${colors.muted};
  --border: ${colors.border};
  --font-heading: "${fonts.heading}", system-ui, sans-serif;
  --font-body: "${fonts.body}", system-ui, sans-serif;
}`;
}

/**
 * Add Google Fonts import if using custom fonts
 */
async function addFontImportsIfNeeded(
  projectPath: string,
  recipeId: RecipeId,
  designPack: DesignPack
): Promise<void> {
  const { heading, body } = designPack.tokens.fonts;
  
  // Skip if using system fonts
  const systemFonts = ['Inter', 'system-ui', 'sans-serif', 'serif'];
  if (systemFonts.includes(heading) && systemFonts.includes(body)) {
    return;
  }
  
  // For Next.js, we could add to layout.tsx or globals.css
  // For simplicity, we'll add a CSS import to globals.css
  const fontFamilies = [heading, body].filter(f => !systemFonts.includes(f));
  if (fontFamilies.length === 0) return;
  
  const googleFontsUrl = `https://fonts.googleapis.com/css2?family=${fontFamilies.map(f => f.replace(/\s+/g, '+')).join('&family=')}&display=swap`;
  const fontImport = `@import url('${googleFontsUrl}');\n\n`;
  
  // Try to prepend to globals.css
  const cssTargets = getCssTargetsForRecipe(recipeId, projectPath);
  for (const target of cssTargets) {
    const cssPath = path.join(projectPath, target.path);
    if (fs.existsSync(cssPath)) {
      const content = fs.readFileSync(cssPath, 'utf-8');
      if (!content.includes('fonts.googleapis.com')) {
        fs.writeFileSync(cssPath, fontImport + content, 'utf-8');
        console.log(`[DesignPack] ✓ Added font imports to ${target.path}`);
      }
      break;
    }
  }
}

// ============================================================================
// EVENT EMISSION
// ============================================================================

function generateEventId(): string {
  return `evt_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function emitScaffoldProgress(
  ctx: PostScaffoldContext,
  status: 'creating' | 'applying_design' | 'timeout' | 'error',
  details: Record<string, unknown>
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_progress' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      status,
      ...details,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.publish(event);
}

function emitDesignPackApplied(
  ctx: PostScaffoldContext,
  designPack: DesignPack,
  modifiedFiles: string[]
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'design_pack_applied' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      design_pack_id: designPack.id,
      design_pack_name: designPack.name,
      vibe: designPack.vibe,
      primary_color: designPack.tokens.colors.primary,
      modified_files: modifiedFiles,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.publish(event);
}

function emitNextStepsShown(
  ctx: PostScaffoldContext,
  nextStepsContext: NextStepsContext,
  suggestions: NextStepSuggestion[]
): void {
  const payload = buildNextStepsShownPayload(nextStepsContext, suggestions);
  
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'next_steps_shown',
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      ...payload,
      suggestions: suggestions, // Include full suggestion objects for UI
    } as unknown as Record<string, unknown>,
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.publish(event);
}

function emitScaffoldFinalComplete(
  ctx: PostScaffoldContext,
  projectPath: string,
  designPackApplied: boolean,
  nextStepsCount: number
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_final_complete' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      project_path: projectPath,
      design_pack_applied: designPackApplied,
      next_steps_available: nextStepsCount,
      status: 'success',
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  ctx.eventBus.publish(event);
}

// ============================================================================
// HELPERS
// ============================================================================

function getRecipeDisplayName(recipeId: RecipeId): string {
  const names: Record<RecipeId, string> = {
    'nextjs_app_router': 'Next.js',
    'vite_react': 'Vite + React',
    'expo': 'Expo',
  };
  return names[recipeId] || recipeId;
}

function detectPackageManager(projectPath: string): 'npm' | 'pnpm' | 'yarn' {
  // Check for lockfiles in order of preference
  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  pollForCompletion,
  applyDesignPackToProject,
  DEFAULT_POLLING_CONFIG,
};
