/**
 * Recipe Registry (Step 35.3)
 * 
 * Central registry for scaffold recipes with plan building and helpers.
 */

import { RecipeId, RecipeBuilder, RecipeContext, RecipePlan, FilePlanItem, RECIPE_NAMES, RECIPE_DESCRIPTIONS } from './recipeTypes';
import { nextjsAppRouterRecipe } from './recipes/nextjsAppRouter';
import { viteReactRecipe } from './recipes/viteReact';
import { expoRecipe } from './recipes/expo';

/** All registered recipes */
const RECIPE_REGISTRY: Map<RecipeId, RecipeBuilder> = new Map([
  ['nextjs_app_router', nextjsAppRouterRecipe],
  ['vite_react', viteReactRecipe],
  ['expo', expoRecipe],
]);

/** Get a recipe by ID */
export function getRecipe(id: RecipeId): RecipeBuilder | undefined {
  return RECIPE_REGISTRY.get(id);
}

/** Build a recipe plan */
export function buildRecipePlan(ctx: RecipeContext): RecipePlan {
  const recipe = RECIPE_REGISTRY.get(ctx.scaffold_id as RecipeId) || nextjsAppRouterRecipe;
  return recipe.build(ctx);
}

/** Get recipe display name */
export function getRecipeName(id: RecipeId): string {
  return RECIPE_NAMES[id] || id;
}

/** Get recipe description */
export function getRecipeDescription(id: RecipeId): string {
  return RECIPE_DESCRIPTIONS[id] || '';
}

/** Build file tree preview (max 18 lines) */
export function buildFileTreePreview(files: FilePlanItem[], maxLines = 18): string[] {
  const preview: string[] = [];
  const dirs = files.filter(f => f.kind === 'dir');
  const filesOnly = files.filter(f => f.kind === 'file');
  
  // Add directories first
  for (const d of dirs.slice(0, 5)) {
    preview.push(`📁 ${d.path}/`);
    if (preview.length >= maxLines) break;
  }
  
  // Add key files
  const keyFiles = ['package.json', 'tsconfig.json', 'README.md'];
  for (const kf of keyFiles) {
    const f = filesOnly.find(file => file.path === kf);
    if (f && preview.length < maxLines) {
      preview.push(`📄 ${f.path}`);
    }
  }
  
  // Add remaining files
  for (const f of filesOnly) {
    if (!keyFiles.includes(f.path) && preview.length < maxLines) {
      preview.push(`📄 ${f.path}`);
    }
  }
  
  if (files.length > preview.length) {
    preview.push(`... and ${files.length - preview.length} more`);
  }
  
  return preview;
}

/** Calculate file/dir counts */
export function countFilesAndDirs(files: FilePlanItem[]): { files: number; dirs: number } {
  return {
    files: files.filter(f => f.kind === 'file').length,
    dirs: files.filter(f => f.kind === 'dir').length,
  };
}

/** Summarize commands for display */
export function summarizeCommands(plan: RecipePlan): string[] {
  const postApply = plan.commands.filter(c => c.when === 'post_apply');
  const userExplicit = plan.commands.filter(c => c.when === 'user_explicit');
  
  const lines: string[] = [];
  if (postApply.length > 0) {
    lines.push(`After create: ${postApply.map(c => c.label).join(', ')}`);
  }
  if (userExplicit.length > 0) {
    lines.push(`Manual: ${userExplicit.map(c => c.label).join(', ')}`);
  }
  return lines;
}

export { RECIPE_REGISTRY };
