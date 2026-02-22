/**
 * Stage 8-9: Verification + Summary
 *
 * 8. Legacy verification pipeline (package.json, install check)
 * 9. LLM summary + next steps + scaffold_final_complete emission
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FeatureRequirements } from '../../types';
import type { PipelineStageContext, PipelineState } from '../pipelineTypes';
import type { DoctorStatus } from '../blueprintSchema';
import {
  emitVerifyStarted,
  emitVerifyStepCompleted,
  emitVerifyCompleted,
  emitNextStepsShown,
  emitScaffoldFinalComplete,
} from '../pipelineEvents';
import {
  verifyPackageJson,
  runInstallStep,
  computeOutcome,
  detectPackageManager as detectPM,
  VerifyStepResult,
} from '../postVerify';
import {
  getNextStepsForRecipe,
  getFeatureAwareNextSteps,
  NextStepsContext,
} from '../nextSteps';
import { detectPackageManager } from './helpers';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function collectProjectFiles(dir: string, maxDepth: number, currentDepth: number = 0): string[] {
  if (currentDepth >= maxDepth) return [];
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
      if (entry.isDirectory()) {
        files.push(entry.name + '/');
        const subFiles = collectProjectFiles(path.join(dir, entry.name), maxDepth, currentDepth + 1);
        files.push(...subFiles.map(f => entry.name + '/' + f));
      } else {
        files.push(entry.name);
      }
    }
  } catch { /* ignore */ }
  return files;
}

export async function runSummaryStage(
  { ctx, projectPath, logPrefix }: PipelineStageContext,
  state: PipelineState,
): Promise<{
  verificationOutcome: ReturnType<typeof computeOutcome>;
  verificationSteps: VerifyStepResult[];
}> {
  // --- Stage 8: Verification Pipeline (legacy compatibility) ---
  const verifySteps: VerifyStepResult[] = [];
  const pkgManager = detectPM(projectPath);

  await emitVerifyStarted(ctx, projectPath, ctx.recipeId as string);

  const pkgResult = verifyPackageJson(projectPath);
  verifySteps.push(pkgResult);
  await emitVerifyStepCompleted(ctx, pkgResult);

  if (pkgResult.status !== 'fail') {
    const installResult = await runInstallStep(projectPath, pkgManager, 120000, 1);
    verifySteps.push(installResult);
    await emitVerifyStepCompleted(ctx, installResult);
  }

  const verifyOutcome = computeOutcome(verifySteps);
  const verifyDuration = verifySteps.reduce((sum, s) => sum + s.durationMs, 0);
  await emitVerifyCompleted(ctx, verifyOutcome, verifySteps, verifyDuration, pkgManager);

  // --- Stage 9: Generate Summary + Next Steps ---
  console.log(`${logPrefix} [SUMMARY] Generating project summary...`);
  const projectSummary = await generateProjectSummary(ctx, projectPath, state.doctorStatus, logPrefix);

  const nextStepsContext: NextStepsContext = {
    scaffold_id: ctx.scaffoldId,
    recipe_id: ctx.recipeId,
    design_pack_id: ctx.designPackId,
    target_directory: projectPath,
    package_manager: detectPackageManager(projectPath),
  };

  const suggestions = state.featureRequirements
    ? getFeatureAwareNextSteps(nextStepsContext, state.featureRequirements)
    : getNextStepsForRecipe(nextStepsContext);

  await emitNextStepsShown(ctx, nextStepsContext, suggestions);
  await emitScaffoldFinalComplete(ctx, projectPath, true, suggestions.length, state.doctorCard, state.doctorStatus, projectSummary);

  return { verificationOutcome: verifyOutcome, verificationSteps: verifySteps };
}

async function generateProjectSummary(
  ctx: any,
  projectPath: string,
  doctorStatus: DoctorStatus,
  logPrefix: string,
): Promise<{ summary: string; features_built: string[]; suggested_features: string[]; access_url: string } | null> {
  if (!ctx.llmClient) return null;

  const projectFiles = collectProjectFiles(projectPath, 2);
  const pkgJsonPath = path.join(projectPath, 'package.json');
  let pkgJson = '';
  try { pkgJson = fs.readFileSync(pkgJsonPath, 'utf-8'); } catch { /* skip */ }

  const srcFiles = projectFiles.filter(f => /\.(tsx?|jsx?)$/.test(f) && !f.includes('node_modules'));

  const summaryPrompt = `You are summarizing a newly scaffolded project for the developer.

Project: ${ctx.appName}
Recipe: ${ctx.recipeId}
User's original request: "${ctx.userPrompt || 'Create a new app'}"

Project files: ${srcFiles.join(', ')}
package.json: ${pkgJson.slice(0, 1500)}

Quality status: tsc=${doctorStatus.tsc}, eslint=${doctorStatus.eslint}, build=${doctorStatus.build}

${ctx.blueprint ? `Blueprint: ${JSON.stringify({ app_type: ctx.blueprint.app_type, pages: ctx.blueprint.pages.map((p: any) => p.name), features: ctx.blueprint.features })}` : ''}

Return ONLY valid JSON with this structure:
{
  "summary": "A 2-3 sentence summary of what was built",
  "features_built": ["feature 1", "feature 2", ...],
  "suggested_features": ["feature to add 1", "feature to add 2", ...],
  "access_url": "http://localhost:3000"
}`;

  try {
    const response = await withTimeout(
      ctx.llmClient.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: 'You are a helpful project summary assistant. Return ONLY valid JSON, no markdown or explanation.',
        messages: [{ role: 'user', content: summaryPrompt }],
      }),
      60_000,
      'Project summary generation',
    );

    const text = (response as any)?.content
      ?.filter((b: any) => b.type === 'text')
      ?.map((b: any) => b.text)
      ?.join('') || '';

    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    console.log(`${logPrefix} [SUMMARY] Generated project summary with ${parsed.features_built?.length || 0} features built`);
    return parsed;
  } catch (err) {
    console.warn(`${logPrefix} [SUMMARY] Failed to generate summary:`, err);
    return null;
  }
}
