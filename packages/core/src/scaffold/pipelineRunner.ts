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

  // Stage 1: Git Init + Project Context
  await runInitStage(stageCtx, state);

  // Stage 2-4: Design System (style, overlay, shadcn)
  await runDesignSystemStage(stageCtx, state);

  // Stage 5-6: Feature Generation + CSS verify + pre-QG fixes + deps
  await runFeatureGenerationStage(stageCtx, state);

  // Stage 7: Quality Gates (non-blocking diagnostics)
  await runQualityGateStage(stageCtx, state);

  // Stage 8-9: Verification + Summary
  const { verificationOutcome, verificationSteps } = await runSummaryStage(stageCtx, state);

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
