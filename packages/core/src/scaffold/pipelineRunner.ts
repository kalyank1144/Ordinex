/**
 * Pipeline Runner — Conical pipeline orchestrator.
 *
 * Runs post-scaffold stages in sequence. No business logic here —
 * each stage is a self-contained module. This file handles:
 * 1. Stage ordering
 * 2. Pipeline state threading
 * 3. Error wrapping (each stage is non-fatal except polling)
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PostScaffoldContext,
  PostScaffoldResult,
  PipelineState,
} from './pipelineTypes';
import { DEFAULT_DESIGN_TOKENS } from './pipelineTypes';
import { detectTailwindVersion } from './overlayApplier';

import { runInitStage } from './stages/init';
import { runDesignSystemStage } from './stages/designSystem';
import { runFeatureGenerationStage } from './stages/featureGeneration';
import { runQualityGateStage } from './stages/qualityGate';
import { runSummaryStage } from './stages/summary';
import { correctAppTypeForRecipe } from './appBlueprintExtractor';

export async function runEnhancedPipeline(
  ctx: PostScaffoldContext,
  projectPath: string,
  logPrefix: string,
): Promise<PostScaffoldResult> {
  const hasSrcDir = fs.existsSync(path.join(projectPath, 'src'));
  const twVersion = detectTailwindVersion(projectPath);

  const state: PipelineState = {
    designTokens: { ...DEFAULT_DESIGN_TOKENS },
    shadcnVars: {},
    featureCodeApplied: false,
    doctorStatus: {
      tsc: 'unknown',
      eslint: 'unknown',
      build: 'unknown',
      devServer: { status: 'unknown', url: '' },
    },
    hasSrcDir,
    tailwindVersion: twVersion,
  };

  const stageCtx = { ctx, projectPath, logPrefix };

  console.log(`[ORDINEX_DEBUG] ========== PIPELINE RUNNER START ==========`);
  console.log(`[ORDINEX_DEBUG] projectPath: ${projectPath}`);
  console.log(`[ORDINEX_DEBUG] hasSrcDir: ${hasSrcDir}`);
  console.log(`[ORDINEX_DEBUG] twVersion: ${twVersion}`);
  console.log(`[ORDINEX_DEBUG] ctx.modelId: ${ctx.modelId}`);
  console.log(`[ORDINEX_DEBUG] ctx.llmClient: ${!!ctx.llmClient}`);
  console.log(`[ORDINEX_DEBUG] ctx.designPackId: ${ctx.designPackId}`);
  console.log(`[ORDINEX_DEBUG] ctx.blueprint: ${ctx.blueprint ? JSON.stringify({ app_type: ctx.blueprint.app_type, pages: ctx.blueprint.pages.length }) : 'null'}`);

  // Stage 1: Git Init + Project Context
  console.log(`[ORDINEX_DEBUG] >>> Stage 1: Init`);
  await runInitStage(stageCtx, state);
  console.log(`[ORDINEX_DEBUG] <<< Stage 1: Init complete`);

  // Correct app_type if it conflicts with the recipe (e.g. LLM says "mobile_app" but recipe is Next.js)
  if (ctx.blueprint) {
    const corrected = correctAppTypeForRecipe(ctx.blueprint, ctx.recipeId);
    if (corrected.app_type !== ctx.blueprint.app_type) {
      console.log(`${logPrefix} [BLUEPRINT] Corrected app_type: "${ctx.blueprint.app_type}" → "${corrected.app_type}" (recipe=${ctx.recipeId})`);
      ctx.blueprint = corrected;
    }
  }

  // Stage 2-4: Design System (style, overlay, shadcn)
  console.log(`[ORDINEX_DEBUG] >>> Stage 2-4: Design System`);
  await runDesignSystemStage(stageCtx, state);
  console.log(`[ORDINEX_DEBUG] <<< Stage 2-4: Design System complete`);
  console.log(`[ORDINEX_DEBUG] After design system — designTokens.primary: ${state.designTokens.primary}, background: ${state.designTokens.background}, accent: ${state.designTokens.accent}`);
  console.log(`[ORDINEX_DEBUG] After design system — shadcnVars count: ${Object.keys(state.shadcnVars).length}`);
  console.log(`[ORDINEX_DEBUG] After design system — darkTokens present: ${!!state.darkTokens}`);

  // Stage 5-6: Feature Generation + CSS verify + pre-QG fixes + deps
  console.log(`[ORDINEX_DEBUG] >>> Stage 5-6: Feature Generation`);
  await runFeatureGenerationStage(stageCtx, state);
  console.log(`[ORDINEX_DEBUG] <<< Stage 5-6: Feature Generation complete`);
  console.log(`[ORDINEX_DEBUG] After features — featureCodeApplied: ${state.featureCodeApplied}`);

  // Stage 7: Quality Gates (non-blocking diagnostics)
  console.log(`[ORDINEX_DEBUG] >>> Stage 7: Quality Gates`);
  await runQualityGateStage(stageCtx, state);
  console.log(`[ORDINEX_DEBUG] <<< Stage 7: Quality Gates complete`);

  // Stage 8-9: Verification + Summary
  console.log(`[ORDINEX_DEBUG] >>> Stage 8-9: Summary`);
  const { verificationOutcome, verificationSteps } = await runSummaryStage(stageCtx, state);
  console.log(`[ORDINEX_DEBUG] <<< Stage 8-9: Summary complete`);
  console.log(`[ORDINEX_DEBUG] ========== PIPELINE RUNNER END ==========`);

  console.log(`${logPrefix} ✅ Enhanced post-scaffold pipeline complete`);

  return {
    success: true,
    projectPath,
    designPackApplied: true,
    featureCodeApplied: state.featureCodeApplied,
    featureRequirements: state.featureRequirements,
    verificationOutcome,
    verificationSteps,
    doctorCard: state.doctorCard,
    lastCommitHash: state.lastCommitHash,
  };
}
