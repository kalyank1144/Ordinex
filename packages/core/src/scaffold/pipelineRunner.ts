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
import { debugLog } from './debugLog';

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

  const log = (msg: string) => { debugLog(msg); ctx.logger?.(msg); };

  log(`[COLOR_PIPELINE] ========== PIPELINE RUNNER START ==========`);
  log(`[COLOR_PIPELINE] projectPath: ${projectPath}`);
  log(`[COLOR_PIPELINE] hasSrcDir: ${hasSrcDir}, twVersion: ${twVersion}`);
  log(`[COLOR_PIPELINE] modelId: ${ctx.modelId}, llmClient: ${!!ctx.llmClient}`);
  log(`[COLOR_PIPELINE] designPackId: ${ctx.designPackId}`);
  log(`[COLOR_PIPELINE] userPrompt: "${ctx.userPrompt?.slice(0, 100) || '(none)'}"`);
  log(`[COLOR_PIPELINE] styleInput: ${ctx.styleInput ? `mode=${ctx.styleInput.mode}, value="${ctx.styleInput.value}"` : '(none)'}`);
  log(`[COLOR_PIPELINE] blueprint: ${ctx.blueprint ? `app_type=${ctx.blueprint.app_type}, pages=${ctx.blueprint.pages.length}` : 'null'}`);

  // Stage 1: Git Init + Project Context
  log(`[COLOR_PIPELINE] >>> Stage 1: Init`);
  await runInitStage(stageCtx, state);
  log(`[COLOR_PIPELINE] <<< Stage 1: Init complete`);

  // Correct app_type if it conflicts with the recipe (e.g. LLM says "mobile_app" but recipe is Next.js)
  if (ctx.blueprint) {
    const corrected = correctAppTypeForRecipe(ctx.blueprint, ctx.recipeId);
    if (corrected.app_type !== ctx.blueprint.app_type) {
      debugLog(`${logPrefix} [BLUEPRINT] Corrected app_type: "${ctx.blueprint.app_type}" → "${corrected.app_type}" (recipe=${ctx.recipeId})`);
      ctx.blueprint = corrected;
    }
  }

  // Stage 2-4: Design System (style, overlay, shadcn)
  log(`[COLOR_PIPELINE] >>> Stage 2-4: Design System`);
  await runDesignSystemStage(stageCtx, state);
  log(`[COLOR_PIPELINE] <<< Stage 2-4: Design System complete`);
  log(`[COLOR_PIPELINE] After design system — primary: ${state.designTokens.primary}, bg: ${state.designTokens.background}, accent: ${state.designTokens.accent}`);
  log(`[COLOR_PIPELINE] After design system — shadcnVars: ${Object.keys(state.shadcnVars).length}, darkTokens: ${!!state.darkTokens}`);

  // Stage 5-6: Feature Generation + CSS verify + pre-QG fixes + deps
  log(`[COLOR_PIPELINE] >>> Stage 5-6: Feature Generation`);
  await runFeatureGenerationStage(stageCtx, state);
  log(`[COLOR_PIPELINE] <<< Stage 5-6: Feature Generation complete (featureCodeApplied=${state.featureCodeApplied})`);

  // Stage 7: Quality Gates (non-blocking diagnostics)
  log(`[COLOR_PIPELINE] >>> Stage 7: Quality Gates`);
  await runQualityGateStage(stageCtx, state);
  log(`[COLOR_PIPELINE] <<< Stage 7: Quality Gates complete`);

  // Stage 8-9: Verification + Summary
  log(`[COLOR_PIPELINE] >>> Stage 8-9: Summary`);
  const { verificationOutcome, verificationSteps } = await runSummaryStage(stageCtx, state);
  log(`[COLOR_PIPELINE] <<< Stage 8-9: Summary complete`);
  log(`[COLOR_PIPELINE] ========== PIPELINE RUNNER END ==========`);

  debugLog(`${logPrefix} ✅ Enhanced post-scaffold pipeline complete`);

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
