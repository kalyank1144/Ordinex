/**
 * Project Context — Persistence for `.ordinex/context.json`.
 *
 * Created at blueprint extraction, updated after every scaffold stage.
 * Serves as the project's memory for post-scaffold features, doctor card,
 * and recovery mode.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  OrdinexProjectContext,
  StageHistoryEntry,
  DoctorStatus,
  AppBlueprint,
  StyleInput,
} from './blueprintSchema';
import { createEmptyProjectContext } from './blueprintSchema';

// ============================================================================
// PUBLIC API
// ============================================================================

const CONTEXT_FILENAME = 'context.json';
const ORDINEX_DIR = '.ordinex';

function contextPath(projectDir: string): string {
  return path.join(projectDir, ORDINEX_DIR, CONTEXT_FILENAME);
}

/**
 * Load project context from disk. Returns null if not found.
 */
export async function loadProjectContext(projectDir: string): Promise<OrdinexProjectContext | null> {
  const p = contextPath(projectDir);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = await fs.promises.readFile(p, 'utf-8');
    return JSON.parse(raw) as OrdinexProjectContext;
  } catch {
    return null;
  }
}

/**
 * Save project context to disk (creates .ordinex/ if missing).
 */
export async function saveProjectContext(projectDir: string, ctx: OrdinexProjectContext): Promise<void> {
  const dir = path.join(projectDir, ORDINEX_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(contextPath(projectDir), JSON.stringify(ctx, null, 2), 'utf-8');
}

/**
 * Initialize a brand-new project context with stack information.
 */
export async function initProjectContext(
  projectDir: string,
  opts: {
    recipe: string;
    frameworkVersion: string;
    blueprint?: AppBlueprint;
  },
): Promise<OrdinexProjectContext> {
  const ctx = createEmptyProjectContext();
  ctx.stack.recipe = opts.recipe;
  ctx.stack.frameworkVersion = opts.frameworkVersion;

  if (opts.blueprint) {
    ctx.blueprint = opts.blueprint;
    ctx.inventory.routes = opts.blueprint.pages.map(p => p.path);
    ctx.inventory.components = [...new Set(opts.blueprint.pages.flatMap(p => p.key_components))];
    ctx.inventory.dataModels = opts.blueprint.data_models.map(dm => dm.name);
  }

  await saveProjectContext(projectDir, ctx);
  return ctx;
}

/**
 * Append a stage history entry and persist.
 */
export async function recordStageResult(
  projectDir: string,
  entry: StageHistoryEntry,
): Promise<void> {
  let ctx = await loadProjectContext(projectDir);
  if (!ctx) ctx = createEmptyProjectContext();

  ctx.history.push(entry);
  await saveProjectContext(projectDir, ctx);
}

/**
 * Update doctor status and persist.
 */
export async function updateDoctorStatus(
  projectDir: string,
  patch: Partial<DoctorStatus>,
): Promise<void> {
  let ctx = await loadProjectContext(projectDir);
  if (!ctx) ctx = createEmptyProjectContext();

  ctx.doctor = { ...ctx.doctor, ...patch };
  await saveProjectContext(projectDir, ctx);
}

/**
 * Update style information and persist.
 */
export async function updateStyleInfo(
  projectDir: string,
  input: StyleInput,
  tokens: Record<string, string>,
  shadcnCssVars: Record<string, string>,
): Promise<void> {
  let ctx = await loadProjectContext(projectDir);
  if (!ctx) ctx = createEmptyProjectContext();

  ctx.style = { input, tokens, shadcnCssVars };
  await saveProjectContext(projectDir, ctx);
}

/**
 * Get the last successful stage from history.
 */
export async function getLastSuccessfulStage(
  projectDir: string,
): Promise<StageHistoryEntry | null> {
  const ctx = await loadProjectContext(projectDir);
  if (!ctx || ctx.history.length === 0) return null;

  for (let i = ctx.history.length - 1; i >= 0; i--) {
    if (ctx.history[i].result === 'pass') return ctx.history[i];
  }
  return null;
}
