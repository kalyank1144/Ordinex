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
import type { Event, Mode, Stage, FeatureRequirements } from '../types';
import type { RecipeId } from './recipeTypes';
import {
  getDesignPackById,
  generateGlobalsCss,
  DesignPack,
  DesignPackId
} from './designPacks';
import {
  getNextStepsForRecipe,
  getFeatureAwareNextSteps,
  buildNextStepsShownPayload,
  NextStepsContext,
  NextStepSuggestion
} from './nextSteps';
import { extractFeatureRequirements, hasSpecificFeature, FeatureLLMClient } from './featureExtractor';
import { generateFeatureCode, ProjectContext } from './featureCodeGenerator';
import { applyFeatureCode } from './featureApplicator';
import {
  verifyPackageJson,
  runInstallStep,
  runLintStep,
  runTypecheckStep,
  runBuildStep,
  detectPackageManager as detectPM,
  detectTypeScript,
  computeOutcome,
  VerifyStepResult,
  VerifyOutcome,
} from './postVerify';

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
  /** Original user prompt (for feature extraction) */
  userPrompt?: string;
  /** LLM client for feature generation (optional — graceful degradation if absent) */
  llmClient?: FeatureLLMClient;
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
  /** Whether feature code was generated and applied */
  featureCodeApplied?: boolean;
  /** Feature requirements extracted (if any) */
  featureRequirements?: FeatureRequirements;
  /** Verification outcome */
  verificationOutcome?: VerifyOutcome;
  /** Verification step results */
  verificationSteps?: VerifyStepResult[];
  /** Error message if failed */
  error?: string;
  /** Stage where failure occurred */
  failedStage?: 'polling' | 'design_pack' | 'feature_generation' | 'verification' | 'next_steps';
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
    
    // STEP 5: Feature Implementation Phase (LLM-powered, optional)
    let featureCodeApplied = false;
    let featureRequirements: FeatureRequirements | undefined;

    const shouldGenerateFeatures = ctx.userPrompt
      && ctx.llmClient
      && hasSpecificFeature(ctx.userPrompt);

    if (shouldGenerateFeatures) {
      console.log(`${LOG_PREFIX} Starting feature extraction for: "${ctx.userPrompt}"`);

      // 5a: Extract feature requirements
      const extractionStart = Date.now();
      emitFeatureEvent(ctx, 'feature_extraction_started', {
        scaffold_id: ctx.scaffoldId,
        run_id: ctx.taskId,
        user_prompt: ctx.userPrompt,
        recipe_id: ctx.recipeId,
      });

      const requirements = await extractFeatureRequirements(
        ctx.userPrompt!,
        ctx.recipeId,
        ctx.llmClient!,
      );

      if (requirements && requirements.app_type !== 'generic') {
        featureRequirements = requirements;
        const extractionDuration = Date.now() - extractionStart;

        console.log(`${LOG_PREFIX} ✓ Feature extraction complete: ${requirements.app_type} (${requirements.features.length} features)`);
        emitFeatureEvent(ctx, 'feature_extraction_completed', {
          scaffold_id: ctx.scaffoldId,
          run_id: ctx.taskId,
          app_type: requirements.app_type,
          features_count: requirements.features.length,
          pages_count: requirements.pages.length,
          duration_ms: extractionDuration,
        });

        // 5b: Generate feature code
        emitFeatureEvent(ctx, 'feature_code_generating', {
          scaffold_id: ctx.scaffoldId,
          run_id: ctx.taskId,
          app_type: requirements.app_type,
          planned_files_count: requirements.pages.reduce((sum, p) => sum + p.components.length, 0) + requirements.data_model.length + 1,
          message: `Generating ${requirements.app_type} components...`,
        });

        // Collect project context for informed code generation
        const projectContext = collectProjectContext(projectPath);

        const generationResult = await generateFeatureCode(
          requirements,
          ctx.recipeId,
          designPack || null,
          ctx.llmClient!,
          undefined,
          projectContext,
        );

        if (generationResult) {
          console.log(`${LOG_PREFIX} ✓ Feature code generated: ${generationResult.files.length} new files, ${generationResult.modified_files.length} modifications`);

          // 5c: Apply feature code to project
          const applyStart = Date.now();
          const featureApplyResult = await applyFeatureCode(projectPath, generationResult);
          const applyDuration = Date.now() - applyStart;

          if (featureApplyResult.success) {
            featureCodeApplied = true;
            console.log(`${LOG_PREFIX} ✓ Feature code applied: ${featureApplyResult.created_files.length} created, ${featureApplyResult.modified_files.length} modified`);

            emitFeatureEvent(ctx, 'feature_code_applied', {
              scaffold_id: ctx.scaffoldId,
              run_id: ctx.taskId,
              created_files: featureApplyResult.created_files,
              modified_files: featureApplyResult.modified_files,
              total_files: featureApplyResult.created_files.length + featureApplyResult.modified_files.length,
              summary: generationResult.summary,
              duration_ms: applyDuration + extractionDuration,
            });
          } else {
            console.warn(`${LOG_PREFIX} ⚠️ Feature code application had errors:`, featureApplyResult.errors);
            emitFeatureEvent(ctx, 'feature_code_error', {
              scaffold_id: ctx.scaffoldId,
              run_id: ctx.taskId,
              error: `Application errors: ${featureApplyResult.errors.map(e => e.error).join(', ')}`,
              phase: 'application',
              recoverable: true,
            });
          }
        } else {
          console.warn(`${LOG_PREFIX} ⚠️ Feature code generation returned null — falling back to generic scaffold`);
          emitFeatureEvent(ctx, 'feature_code_error', {
            scaffold_id: ctx.scaffoldId,
            run_id: ctx.taskId,
            error: 'Code generation returned empty result',
            phase: 'generation',
            recoverable: true,
          });
        }
      } else {
        console.log(`${LOG_PREFIX} Feature extraction returned generic/null — skipping feature generation`);
      }
    } else {
      console.log(`${LOG_PREFIX} Skipping feature generation (no specific feature in prompt or no LLM client)`);
    }

    // STEP 6: Post-scaffold verification pipeline (streaming)
    console.log(`${LOG_PREFIX} Running post-scaffold verification...`);
    const verifySteps: VerifyStepResult[] = [];
    const pkgManager = detectPM(projectPath);
    const isTypeScript = detectTypeScript(projectPath);
    const recipeInfo = { recipeId: ctx.recipeId as string, hasTypeScript: isTypeScript };

    // Emit verify started
    emitVerifyStarted(ctx, projectPath, recipeInfo.recipeId);

    // Step 6a: package.json
    const pkgResult = verifyPackageJson(projectPath);
    verifySteps.push(pkgResult);
    emitVerifyStepCompleted(ctx, pkgResult);

    if (pkgResult.status !== 'fail') {
      // Step 6b: npm install (async)
      const installResult = await runInstallStep(projectPath, pkgManager, 120000, 1);
      verifySteps.push(installResult);
      emitVerifyStepCompleted(ctx, installResult);

      // Step 6c: lint
      const lintResult = runLintStep(projectPath, pkgManager, 60000);
      verifySteps.push(lintResult);
      emitVerifyStepCompleted(ctx, lintResult);

      // Step 6d: typecheck
      const typecheckResult = runTypecheckStep(projectPath, pkgManager, isTypeScript, 60000);
      verifySteps.push(typecheckResult);
      emitVerifyStepCompleted(ctx, typecheckResult);

      // Step 6e: build
      const buildResult = runBuildStep(projectPath, pkgManager, true, 120000);
      verifySteps.push(buildResult);
      emitVerifyStepCompleted(ctx, buildResult);
    }

    const verifyOutcome = computeOutcome(verifySteps);
    const verifyDuration = verifySteps.reduce((sum, s) => sum + s.durationMs, 0);
    emitVerifyCompleted(ctx, verifyOutcome, verifySteps, verifyDuration, pkgManager);
    console.log(`${LOG_PREFIX} ✓ Verification complete: ${verifyOutcome} (${Math.round(verifyDuration / 1000)}s)`);

    // STEP 6.5: Iterative auto-fix attempts if verification failed or partially failed
    const MAX_AUTOFIX_ATTEMPTS = 3;
    let currentOutcome = verifyOutcome;
    let currentVerifySteps = verifySteps;

    if ((currentOutcome === 'fail' || currentOutcome === 'partial') && ctx.llmClient) {
      for (let attempt = 1; attempt <= MAX_AUTOFIX_ATTEMPTS; attempt++) {
        console.log(`${LOG_PREFIX} Verification failed (${currentOutcome}), auto-fix attempt ${attempt}/${MAX_AUTOFIX_ATTEMPTS}...`);

        const previousErrors = currentVerifySteps
          .filter(s => s.status === 'fail')
          .map(s => `[${s.id}] ${s.message || ''}\n${s.output || ''}`.trim())
          .join('\n\n');

        const autoFixResult = await attemptAutoFix(ctx, projectPath, currentVerifySteps, pkgManager, isTypeScript, attempt);

        if (!autoFixResult) {
          console.log(`${LOG_PREFIX} Auto-fix attempt ${attempt} returned no fixes, stopping`);
          break;
        }

        // Update steps with re-verification results
        currentVerifySteps = autoFixResult.steps;
        currentOutcome = computeOutcome(currentVerifySteps);

        if (currentOutcome === 'pass') {
          console.log(`${LOG_PREFIX} Auto-fix attempt ${attempt} resolved all errors`);
          break;
        }

        // Stale detection: if same failures persist, stop trying
        const newErrors = currentVerifySteps
          .filter(s => s.status === 'fail')
          .map(s => `[${s.id}] ${s.message || ''}\n${s.output || ''}`.trim())
          .join('\n\n');

        if (newErrors === previousErrors) {
          console.log(`${LOG_PREFIX} Same errors persist after attempt ${attempt}, stopping auto-fix`);
          break;
        }
      }

      // Update verifySteps with final results
      verifySteps.length = 0;
      verifySteps.push(...currentVerifySteps);
    }

    const finalVerifyOutcome = computeOutcome(verifySteps);

    // STEP 7: Generate and emit Next Steps
    console.log(`${LOG_PREFIX} Generating next steps...`);

    const nextStepsContext: NextStepsContext = {
      scaffold_id: ctx.scaffoldId,
      recipe_id: ctx.recipeId,
      design_pack_id: ctx.designPackId,
      target_directory: projectPath,
      package_manager: detectPackageManager(projectPath),
    };

    // Use feature-aware next steps if we have feature requirements
    const suggestions = featureRequirements
      ? getFeatureAwareNextSteps(nextStepsContext, featureRequirements)
      : getNextStepsForRecipe(nextStepsContext);
    console.log(`${LOG_PREFIX} ✓ Generated ${suggestions.length} next steps`);

    // Emit next_steps_shown event (triggers NextStepsCard in UI)
    emitNextStepsShown(ctx, nextStepsContext, suggestions);

    // STEP 8: Emit final scaffold completion
    emitScaffoldFinalComplete(ctx, projectPath, designPackApplied, suggestions.length);

    console.log(`${LOG_PREFIX} ✅ Post-scaffold orchestration complete`);

    return {
      success: true,
      projectPath,
      designPackApplied,
      modifiedFiles,
      featureCodeApplied,
      featureRequirements,
      verificationOutcome: finalVerifyOutcome,
      verificationSteps: verifySteps,
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

function emitFeatureEvent(
  ctx: PostScaffoldContext,
  type: 'feature_extraction_started' | 'feature_extraction_completed' | 'feature_code_generating' | 'feature_code_applied' | 'feature_code_error',
  payload: Record<string, unknown>
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: type as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };

  ctx.eventBus.publish(event);
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
      target_directory: nextStepsContext.target_directory,
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
// VERIFICATION EVENT HELPERS
// ============================================================================

function emitVerifyStarted(
  ctx: PostScaffoldContext,
  projectPath: string,
  recipeId: string
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_verify_started' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      project_path: projectPath,
      recipe_id: recipeId,
      message: 'Running post-scaffold verification...',
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  ctx.eventBus.publish(event);
}

function emitVerifyStepCompleted(
  ctx: PostScaffoldContext,
  step: VerifyStepResult
): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_verify_step_completed' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      step_name: step.id,
      step_status: step.status,
      duration_ms: step.durationMs,
      message: step.message || `${step.id}: ${step.status}`,
      output: step.output || undefined,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  ctx.eventBus.publish(event);
}

function emitVerifyCompleted(
  ctx: PostScaffoldContext,
  outcome: VerifyOutcome,
  steps: VerifyStepResult[],
  durationMs: number,
  packageManager: string
): void {
  const passCount = steps.filter(s => s.status === 'pass').length;
  const failCount = steps.filter(s => s.status === 'fail').length;
  const warnCount = steps.filter(s => s.status === 'warn').length;
  const skipCount = steps.filter(s => s.status === 'skipped').length;

  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_verify_completed' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      outcome,
      total_steps: steps.length,
      pass_count: passCount,
      fail_count: failCount,
      warn_count: warnCount,
      skip_count: skipCount,
      duration_ms: durationMs,
      package_manager: packageManager,
      message: `Verification ${outcome}: ${passCount} passed, ${failCount} failed, ${warnCount} warnings, ${skipCount} skipped`,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  ctx.eventBus.publish(event);
}

/**
 * Attempt a single bounded auto-fix cycle when verification fails.
 * Collects error messages from failed steps, sends them to LLM for fixes,
 * applies fixes, and re-runs verification. Max 1 attempt to avoid loops.
 */
async function attemptAutoFix(
  ctx: PostScaffoldContext,
  projectPath: string,
  failedSteps: VerifyStepResult[],
  pkgManager: 'npm' | 'pnpm' | 'yarn',
  isTypeScript: boolean,
  attemptNumber: number = 1
): Promise<{ steps: VerifyStepResult[] } | null> {
  const LOG_PREFIX = '[PostScaffoldOrchestrator:AutoFix]';

  try {
    // Collect error details from failed steps
    const errors = failedSteps
      .filter(s => s.status === 'fail')
      .map(s => `[${s.id}] ${s.message || ''}\n${s.output || ''}`.trim())
      .join('\n\n');

    if (!errors || !ctx.llmClient) {
      return null;
    }

    // Emit autofix started
    const autofixEvent: Event = {
      event_id: generateEventId(),
      task_id: ctx.taskId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_autofix_started' as any,
      mode: ctx.mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: ctx.scaffoldId,
        failed_steps: failedSteps.filter(s => s.status === 'fail').map(s => s.id),
        message: 'Analyzing errors and generating fixes...',
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    ctx.eventBus.publish(autofixEvent);

    console.log(`${LOG_PREFIX} Attempting auto-fix for ${failedSteps.filter(s => s.status === 'fail').length} failed steps`);

    // Ask LLM to generate fixes
    const fixPrompt = buildAutoFixPrompt(projectPath, errors, ctx.recipeId, pkgManager, attemptNumber);
    const response = await ctx.llmClient.createMessage({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: 'You are a code fix assistant. Given build/lint/typecheck errors from a scaffolded project, generate file patches to fix them. Respond with ONLY valid JSON.',
      messages: [{ role: 'user', content: fixPrompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock?.text) {
      console.warn(`${LOG_PREFIX} No text in LLM auto-fix response`);
      emitAutofixFailed(ctx, 'LLM returned empty response');
      return null;
    }

    // Parse fix response
    const fixes = parseAutoFixResponse(textBlock.text);
    if (!fixes || fixes.length === 0) {
      console.warn(`${LOG_PREFIX} No fixes parsed from LLM response`);
      emitAutofixFailed(ctx, 'Could not parse fixes from LLM response');
      return null;
    }

    // Apply fixes
    let filesFixed = 0;
    for (const fix of fixes) {
      try {
        const filePath = path.join(projectPath, fix.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, fix.content, 'utf-8');
        filesFixed++;
        console.log(`${LOG_PREFIX} ✓ Fixed: ${fix.path}`);
      } catch (err) {
        console.warn(`${LOG_PREFIX} Failed to write fix for ${fix.path}:`, err);
      }
    }

    if (filesFixed === 0) {
      emitAutofixFailed(ctx, 'No fixes could be applied');
      return null;
    }

    // Emit autofix applied
    const appliedEvent: Event = {
      event_id: generateEventId(),
      task_id: ctx.taskId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_autofix_applied' as any,
      mode: ctx.mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: ctx.scaffoldId,
        files_fixed: filesFixed,
        message: `Applied fixes to ${filesFixed} file(s), re-verifying...`,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    ctx.eventBus.publish(appliedEvent);

    // Re-run verification
    console.log(`${LOG_PREFIX} Re-running verification after auto-fix...`);
    const reSteps: VerifyStepResult[] = [];

    const rePkg = verifyPackageJson(projectPath);
    reSteps.push(rePkg);

    if (rePkg.status !== 'fail') {
      const reInstall = await runInstallStep(projectPath, pkgManager, 120000, 1);
      reSteps.push(reInstall);
      const reLint = runLintStep(projectPath, pkgManager, 60000);
      reSteps.push(reLint);
      const reTypecheck = runTypecheckStep(projectPath, pkgManager, isTypeScript, 60000);
      reSteps.push(reTypecheck);
      const reBuild = runBuildStep(projectPath, pkgManager, true, 120000);
      reSteps.push(reBuild);
    }

    const reOutcome = computeOutcome(reSteps);
    console.log(`${LOG_PREFIX} Re-verification result: ${reOutcome}`);

    return { steps: reSteps };
  } catch (error) {
    console.error(`${LOG_PREFIX} Auto-fix failed:`, error);
    emitAutofixFailed(ctx, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function emitAutofixFailed(ctx: PostScaffoldContext, error: string): void {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_autofix_failed' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      error,
      message: `Auto-fix failed: ${error}`,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  ctx.eventBus.publish(event);
}

function buildAutoFixPrompt(
  projectPath: string,
  errors: string,
  recipeId: RecipeId,
  pkgManager: string,
  attemptNumber: number = 1
): string {
  // Read relevant files to give LLM context
  let tsConfigContent = '';
  let packageJsonContent = '';
  try {
    const tsConfigPath = path.join(projectPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsConfigContent = fs.readFileSync(tsConfigPath, 'utf-8');
    }
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      packageJsonContent = fs.readFileSync(pkgPath, 'utf-8');
    }
  } catch { /* ignore read errors */ }

  // Extract file references from errors and read their contents
  const errorFilePaths = extractFileReferencesFromErrors(errors);
  let failingFileContents = '';
  const MAX_FILES_TO_READ = 5;
  const MAX_FILE_CHARS = 3000;
  let filesRead = 0;

  for (const filePath of errorFilePaths) {
    if (filesRead >= MAX_FILES_TO_READ) break;
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath);
      if (fs.existsSync(fullPath)) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        if (content.length > MAX_FILE_CHARS) {
          content = content.substring(0, MAX_FILE_CHARS) + '\n... (truncated)';
        }
        const relativePath = path.isAbsolute(filePath)
          ? path.relative(projectPath, filePath)
          : filePath;
        failingFileContents += `\n--- ${relativePath} ---\n${content}\n`;
        filesRead++;
      }
    } catch { /* ignore read errors */ }
  }

  // RSC rules for Next.js
  const rscGuidance = recipeId === 'nextjs_app_router' ? `
NEXT.JS APP ROUTER RULES (CRITICAL):
- Files in app/ directory are Server Components by default
- Any file using React hooks (useState, useEffect, useReducer, etc.), event handlers (onClick, onChange, etc.),
  or browser APIs (window, document) MUST have "use client" at the very top
- Type-only files do NOT need "use client"
- A common fix: if a file uses useState/useEffect but is missing "use client", add it as the first line
` : '';

  const attemptContext = attemptNumber > 1
    ? `\nThis is auto-fix attempt ${attemptNumber}. Previous attempt(s) did not fully resolve the errors. Focus on the remaining issues.\n`
    : '';

  return `Fix build/lint/typecheck errors in a ${recipeId} project.${attemptContext}

PACKAGE MANAGER: ${pkgManager}
TSCONFIG: ${tsConfigContent || '(not found)'}
PACKAGE.JSON: ${packageJsonContent || '(not found)'}
${rscGuidance}
ERRORS:
${errors}
${failingFileContents ? `\nFAILING FILE CONTENTS:\n${failingFileContents}` : ''}
Respond with JSON:
{
  "fixes": [
    { "path": "relative/file/path.tsx", "content": "complete fixed file content", "description": "what was fixed" }
  ]
}

Rules:
- Only fix files that have errors
- Provide the COMPLETE file content (not patches)
- Keep changes minimal — only fix what's broken
- Do not change working code`;
}

/**
 * Extract file paths referenced in error output.
 * Matches patterns like: src/components/Foo.tsx(10,5), ./app/page.tsx:15:3, etc.
 */
function extractFileReferencesFromErrors(errors: string): string[] {
  const filePattern = /(?:^|\s|\/)([\w\-./]+\.(?:ts|tsx|js|jsx))(?:[:()\s,]|$)/gm;
  const files = new Set<string>();

  let match;
  while ((match = filePattern.exec(errors)) !== null) {
    const filePath = match[1];
    // Skip node_modules and common non-source paths
    if (!filePath.includes('node_modules') && !filePath.includes('.d.ts')) {
      files.add(filePath);
    }
  }

  return Array.from(files);
}

interface AutoFixEntry {
  path: string;
  content: string;
  description?: string;
}

function parseAutoFixResponse(text: string): AutoFixEntry[] | null {
  try {
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\s*```\s*$/, '');
    }
    if (!jsonStr.startsWith('{')) {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
    }
    const parsed = JSON.parse(jsonStr);
    if (!parsed?.fixes || !Array.isArray(parsed.fixes)) return null;

    return parsed.fixes
      .filter((f: any) => typeof f?.path === 'string' && typeof f?.content === 'string' && f.content.length > 0)
      .map((f: any) => ({
        path: String(f.path),
        content: String(f.content),
        description: String(f.description || ''),
      }));
  } catch {
    return null;
  }
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

/**
 * Collect project context for LLM code generation.
 * Reads tsconfig.json, package.json, and lists files up to 2 levels deep.
 */
function collectProjectContext(projectPath: string): ProjectContext {
  const projectContext: ProjectContext = {};

  try {
    const tsConfigPath = path.join(projectPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      projectContext.tsconfigContent = fs.readFileSync(tsConfigPath, 'utf-8');
    }
  } catch { /* ignore */ }

  try {
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      projectContext.packageJsonContent = fs.readFileSync(pkgPath, 'utf-8');
    }
  } catch { /* ignore */ }

  try {
    projectContext.existingFiles = collectProjectFiles(projectPath, 2);
  } catch { /* ignore */ }

  return projectContext;
}

/**
 * List project files up to maxDepth levels, excluding node_modules and dotfiles.
 */
function collectProjectFiles(dir: string, maxDepth: number, currentDepth: number = 0): string[] {
  if (currentDepth >= maxDepth) return [];
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip node_modules, dotfiles/dirs, and common non-source dirs
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
        continue;
      }

      const relativePath = currentDepth === 0
        ? entry.name
        : entry.name;

      if (entry.isDirectory()) {
        files.push(entry.name + '/');
        const subFiles = collectProjectFiles(
          path.join(dir, entry.name),
          maxDepth,
          currentDepth + 1,
        );
        files.push(...subFiles.map(f => entry.name + '/' + f));
      } else {
        files.push(relativePath);
      }
    }
  } catch { /* ignore */ }

  return files;
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
