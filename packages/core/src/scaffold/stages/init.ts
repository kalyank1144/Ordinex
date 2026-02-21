/**
 * Stage 1: Git Init + Project Context
 *
 * Initializes git repository, creates project context file,
 * and commits the initial CLI scaffold.
 */

import type { PipelineStageContext, PipelineState } from '../pipelineTypes';
import { emitScaffoldProgress } from '../pipelineEvents';
import { ensureGitInit, commitStage } from '../gitCommitter';
import { initProjectContext } from '../projectContext';

export async function runInitStage(
  { ctx, projectPath, logPrefix }: PipelineStageContext,
  state: PipelineState,
): Promise<void> {
  await emitScaffoldProgress(ctx, 'initializing' as any, {
    message: 'Initializing project context...',
    stage: 'init',
  });

  try {
    await ensureGitInit(projectPath);

    const fwVersion = ctx.recipeId === 'nextjs_app_router' ? '15.0.0'
      : ctx.recipeId === 'vite_react' ? '6.0.0' : '52.0.0';
    await initProjectContext(projectPath, {
      recipe: ctx.recipeId,
      frameworkVersion: fwVersion,
      blueprint: ctx.blueprint || undefined,
    });

    const commitResult = await commitStage(projectPath, {
      stage: 'cli_scaffold',
      extra: { app_name: ctx.appName, recipe: ctx.recipeId },
    });
    if (commitResult.success) state.lastCommitHash = commitResult.commitHash;
    console.log(`${logPrefix} ✓ Git init + project context (${state.lastCommitHash?.slice(0, 7) || 'n/a'})`);
  } catch (err) {
    console.warn(`${logPrefix} Git init warning (non-fatal):`, err);
  }
}
