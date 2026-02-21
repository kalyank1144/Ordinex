/**
 * Post-Scaffold Orchestrator — Public API facade.
 *
 * After CLI scaffold command runs (npx create-next-app, etc.), this module:
 * 1. Polls for project completion (package.json exists)
 * 2. Delegates to pipelineRunner for the enhanced pipeline
 *
 * All stage logic lives in stages/ modules. This file is the entry point only.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RecipeId } from './recipeTypes';
import {
  getDesignPackById,
  generateGlobalsCss,
  generateTailwindConfig,
  DesignPack,
  DesignPackId,
} from './designPacks';
import { getRecipeDisplayName as configDisplayName } from './recipeConfig';

// Re-export types from pipelineTypes for backward compatibility
export type {
  PostScaffoldContext,
  PostScaffoldResult,
  PostScaffoldPollingConfig,
  EventPublisher,
} from './pipelineTypes';
export { DEFAULT_POLLING_CONFIG } from './pipelineTypes';

import type {
  PostScaffoldContext,
  PostScaffoldResult,
  PostScaffoldPollingConfig,
} from './pipelineTypes';
import { DEFAULT_POLLING_CONFIG } from './pipelineTypes';

import { emitScaffoldProgress } from './pipelineEvents';
import { runEnhancedPipeline } from './pipelineRunner';

// ============================================================================
// POLLING LOGIC
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function pollForCompletion(
  targetPath: string,
  config: PostScaffoldPollingConfig,
  onProgress?: (elapsedMs: number) => void,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < config.maxWaitMs) {
    if (fs.existsSync(targetPath)) {
      return true;
    }

    if (onProgress) {
      onProgress(Date.now() - startTime);
    }

    await sleep(config.pollIntervalMs);
  }

  return false;
}

// ============================================================================
// DESIGN PACK APPLICATION (standalone utility)
// ============================================================================

export interface DesignPackApplyResult {
  success: boolean;
  modifiedFiles: string[];
  error?: string;
}

export async function applyDesignPackToProject(
  projectPath: string,
  designPackId: DesignPackId,
): Promise<DesignPackApplyResult> {
  const pack = getDesignPackById(designPackId);
  if (!pack) {
    return { success: false, modifiedFiles: [], error: `Design pack '${designPackId}' not found` };
  }

  const modifiedFiles: string[] = [];

  try {
    interface CssTarget { path: string; type: 'globals' | 'tailwind' | 'module'; }
    const targets = getCssTargetsForRecipe(projectPath);

    for (const target of targets) {
      const fullPath = path.join(projectPath, target.path);
      if (!fs.existsSync(fullPath)) continue;

      if (target.type === 'globals') {
        const css = generateGlobalsCss(pack);
        fs.writeFileSync(fullPath, css, 'utf-8');
        modifiedFiles.push(target.path);
      } else if (target.type === 'tailwind') {
        const config = generateTailwindConfig(pack);
        fs.writeFileSync(fullPath, config, 'utf-8');
        modifiedFiles.push(target.path);
      }
    }
  } catch (err) {
    return { success: false, modifiedFiles, error: err instanceof Error ? err.message : String(err) };
  }

  return { success: true, modifiedFiles };
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

export async function startPostScaffoldOrchestration(
  ctx: PostScaffoldContext,
  pollingConfig: PostScaffoldPollingConfig = DEFAULT_POLLING_CONFIG,
): Promise<PostScaffoldResult> {
  const LOG_PREFIX = '[PostScaffoldOrchestrator]';
  const projectPath = path.join(ctx.targetDirectory, ctx.appName);

  console.log(`${LOG_PREFIX} Starting post-scaffold orchestration`);
  console.log(`${LOG_PREFIX} Project path: ${projectPath}`);
  console.log(`${LOG_PREFIX} Recipe: ${ctx.recipeId}, Design Pack: ${ctx.designPackId}`);
  console.log(`${LOG_PREFIX} Blueprint: ${ctx.blueprint ? `app_type=${ctx.blueprint.app_type}, pages=${ctx.blueprint.pages.length}` : 'NOT PROVIDED'}`);
  console.log(`${LOG_PREFIX} LLM client: ${ctx.llmClient ? 'available' : 'NOT available'}`);
  console.log(`${LOG_PREFIX} User prompt: "${ctx.userPrompt?.slice(0, 100) || 'none'}"`);

  try {
    await emitScaffoldProgress(ctx, 'creating', {
      message: `Setting up ${configDisplayName(ctx.recipeId)} project...`,
      project_path: projectPath,
    });

    // Poll for project completion (package.json)
    console.log(`${LOG_PREFIX} Polling for project completion...`);
    const completionMarkerPath = path.join(projectPath, pollingConfig.completionMarker);

    const projectReady = await pollForCompletion(
      completionMarkerPath,
      pollingConfig,
      (elapsedMs) => {
        if (elapsedMs % 10000 < pollingConfig.pollIntervalMs) {
          emitScaffoldProgress(ctx, 'creating', {
            message: `Still creating project... (${Math.floor(elapsedMs / 1000)}s)`,
            elapsed_ms: elapsedMs,
          });
        }
      },
    );

    if (!projectReady) {
      console.log(`${LOG_PREFIX} ❌ Timeout waiting for project completion`);
      await emitScaffoldProgress(ctx, 'timeout', {
        message: 'Scaffold command may still be running. Check the terminal.',
        project_path: projectPath,
      });
      return {
        success: false,
        error: 'Timeout waiting for project completion',
        failedStage: 'polling',
      };
    }

    // Wait for node_modules
    const nodeModulesPath = path.join(projectPath, 'node_modules');
    console.log(`${LOG_PREFIX} Waiting for node_modules (npm install)...`);
    const depsReady = await pollForCompletion(
      nodeModulesPath,
      { ...pollingConfig, maxWaitMs: 180000, completionMarker: 'node_modules' },
      (elapsedMs) => {
        if (elapsedMs % 10000 < pollingConfig.pollIntervalMs) {
          emitScaffoldProgress(ctx, 'creating', {
            message: `Installing dependencies... (${Math.floor(elapsedMs / 1000)}s)`,
            elapsed_ms: elapsedMs,
          });
        }
      },
    );

    if (!depsReady) {
      console.warn(`${LOG_PREFIX} ⚠ node_modules not found after timeout — continuing anyway`);
    } else {
      console.log(`${LOG_PREFIX} node_modules found, waiting for install to stabilize...`);
      await sleep(pollingConfig.stabilizationDelayMs ?? 5000);
    }

    console.log(`${LOG_PREFIX} ✓ Project created successfully`);

    // Delegate to pipeline runner
    return await runEnhancedPipeline(ctx, projectPath, LOG_PREFIX);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} ❌ Error:`, error);

    await emitScaffoldProgress(ctx, 'error', {
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
// CSS TARGET HELPERS
// ============================================================================

interface CssTarget {
  path: string;
  type: 'globals' | 'tailwind' | 'module';
}

function getCssTargetsForRecipe(projectPath: string): CssTarget[] {
  const targets: CssTarget[] = [];
  const hasSrcDir = fs.existsSync(path.join(projectPath, 'src'));

  const globalsPaths = hasSrcDir
    ? ['src/app/globals.css', 'src/styles/globals.css']
    : ['app/globals.css', 'styles/globals.css'];

  for (const p of globalsPaths) {
    if (fs.existsSync(path.join(projectPath, p))) {
      targets.push({ path: p, type: 'globals' });
      break;
    }
  }

  const tailwindPaths = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs'];
  for (const p of tailwindPaths) {
    if (fs.existsSync(path.join(projectPath, p))) {
      targets.push({ path: p, type: 'tailwind' });
      break;
    }
  }

  return targets;
}

// NOTE: pollForCompletion, applyDesignPackToProject, startPostScaffoldOrchestration
// are exported inline via their function declarations above.
