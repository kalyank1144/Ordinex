/**
 * Git Committer — Stage-level commits with blueprint context.
 *
 * Commits only after a stage passes all quality gates.
 * Handles both new repos (git init in staging) and existing repos (worktree).
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import * as fs from 'fs';
import * as path from 'path';
import type { ScaffoldStage, AppBlueprint } from './blueprintSchema';

// ============================================================================
// TYPES
// ============================================================================

export interface CommitResult {
  success: boolean;
  commitHash?: string;
  error?: string;
}

export interface CommitContext {
  stage: ScaffoldStage;
  blueprint?: Partial<AppBlueprint>;
  extra?: Record<string, string | number>;
}

// ============================================================================
// COMMIT MESSAGE TEMPLATES
// ============================================================================

const STAGE_MESSAGES: Record<ScaffoldStage, string> = {
  blueprint: 'ordinex: extract blueprint',
  preflight: 'ordinex: preflight checks',
  cli_scaffold: 'ordinex: scaffold base',
  overlay: 'ordinex: apply overlay',
  shadcn_init: 'ordinex: init shadcn',
  tokens: 'ordinex: apply style tokens',
  gen_layout: 'ordinex: generate layout',
  gen_routes: 'ordinex: generate routes',
  gen_components: 'ordinex: generate components',
  gen_pages: 'ordinex: generate pages',
  gen_polish: 'ordinex: polish',
  pre_publish: 'ordinex: pre-publish validation',
  llm_repair: 'ordinex: auto-fix build errors',
  publish: 'ordinex: publish',
  staging_publish: 'ordinex: publish staged changes',
  dev_smoke: 'ordinex: dev server smoke test',
};

function buildCommitMessage(ctx: CommitContext): string {
  const base = STAGE_MESSAGES[ctx.stage] || `ordinex: ${ctx.stage}`;
  const parts: string[] = [];

  if (ctx.blueprint?.app_type) parts.push(`app_type=${ctx.blueprint.app_type}`);
  if (ctx.blueprint?.primary_layout) parts.push(`layout=${ctx.blueprint.primary_layout}`);
  if (ctx.blueprint?.pages) parts.push(`pages=${ctx.blueprint.pages.length}`);

  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) {
      parts.push(`${k}=${v}`);
    }
  }

  return parts.length > 0 ? `${base} (${parts.join(', ')})` : base;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Ensure the working directory has a git repo initialized.
 * Safe to call multiple times (no-op if already initialized).
 */
export async function ensureGitInit(dir: string): Promise<void> {
  const dotGit = path.join(dir, '.git');
  if (fs.existsSync(dotGit)) return;

  await execAsync('git init', { cwd: dir, encoding: 'utf-8', timeout: 10_000 });
  await execAsync('git checkout -b main', { cwd: dir, encoding: 'utf-8', timeout: 5_000 });
}

/**
 * Stage all changes and commit with blueprint context.
 * Returns the commit hash on success.
 */
export async function commitStage(dir: string, ctx: CommitContext): Promise<CommitResult> {
  try {
    await ensureGitInit(dir);

    await execAsync('git add -A', { cwd: dir, encoding: 'utf-8', timeout: 30_000 });

    const { stdout: status } = await execAsync('git status --porcelain', { cwd: dir, encoding: 'utf-8', timeout: 10_000 });
    if (!status.trim()) {
      return { success: true, commitHash: await getCurrentHash(dir) };
    }

    const message = buildCommitMessage(ctx);
    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 30_000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ordinex',
        GIT_AUTHOR_EMAIL: 'scaffold@ordinex.dev',
        GIT_COMMITTER_NAME: 'Ordinex',
        GIT_COMMITTER_EMAIL: 'scaffold@ordinex.dev',
      },
    });

    const hash = await getCurrentHash(dir);
    return { success: true, commitHash: hash };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Get the current HEAD commit hash (short).
 */
export async function getCurrentHash(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('git rev-parse --short HEAD', { cwd: dir, encoding: 'utf-8', timeout: 5_000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Get the current HEAD commit hash (full).
 */
export async function getFullHash(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8', timeout: 5_000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Check whether a directory is inside a git working tree.
 */
export async function isInsideGitRepo(dir: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: dir, encoding: 'utf-8', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
