/**
 * Recipe Configuration — Single source of truth for all recipe-specific values.
 *
 * Every hardcoded recipe command, display name, component list, file path,
 * and version pin lives here. No other file should duplicate these values.
 */

import { RecipeId } from './recipeTypes';

// ============================================================================
// RECIPE DEFINITION
// ============================================================================

export interface RecipeDefinition {
  id: RecipeId;
  displayName: string;
  /** CLI command template. `{{appName}}` is replaced at runtime. */
  createCommand: string;
  devCommand: string;
  buildCommand: string;
  /** Key files to open in editor after scaffold (tried in order, max 3) */
  keyFiles: string[];
  /** Estimated file/dir counts for proposal card */
  estimates: { files: number; dirs: number };
  /** shadcn/ui components to install (empty for non-shadcn recipes) */
  shadcnComponents: string[];
  /** Overlay directory name for premium shell */
  overlayDir: string;
}

// ============================================================================
// RECIPE REGISTRY
// ============================================================================

const RECIPES: Record<RecipeId, RecipeDefinition> = {
  nextjs_app_router: {
    id: 'nextjs_app_router',
    displayName: 'Next.js',
    createCommand: 'npx --yes create-next-app@latest {{appName}} --typescript --tailwind --eslint --app --src-dir --turbopack --use-npm --import-alias "@/*"',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    keyFiles: [
      'src/app/page.tsx',
      'src/app/layout.tsx',
      'src/app/globals.css',
      'app/page.tsx',
      'app/layout.tsx',
      'app/globals.css',
    ],
    estimates: { files: 24, dirs: 8 },
    shadcnComponents: [
      'button', 'card', 'input', 'label', 'separator',
      'sidebar', 'sheet', 'tooltip', 'avatar', 'dropdown-menu',
      'badge', 'dialog', 'table', 'tabs', 'select', 'textarea',
      'checkbox', 'skeleton', 'scroll-area',
    ],
    overlayDir: 'overlay-next15',
  },

  vite_react: {
    id: 'vite_react',
    displayName: 'Vite + React',
    createCommand: 'npm create vite@latest {{appName}} -- --template react-ts',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    keyFiles: [
      'src/App.tsx',
      'src/main.tsx',
      'index.html',
    ],
    estimates: { files: 18, dirs: 6 },
    shadcnComponents: [
      'button', 'card', 'input', 'label', 'separator',
      'tooltip', 'badge', 'dialog', 'tabs', 'select',
    ],
    overlayDir: 'overlay-vite',
  },

  expo: {
    id: 'expo',
    displayName: 'Expo',
    createCommand: 'npx --yes create-expo-app {{appName}} --template blank-typescript',
    devCommand: 'npx expo start',
    buildCommand: 'npx expo export',
    keyFiles: [
      'App.tsx',
      'app/(tabs)/index.tsx',
      'app/_layout.tsx',
    ],
    estimates: { files: 22, dirs: 7 },
    shadcnComponents: [],
    overlayDir: 'overlay-expo',
  },
};

// ============================================================================
// PUBLIC API
// ============================================================================

export function getRecipeConfig(recipeId: RecipeId): RecipeDefinition {
  return RECIPES[recipeId];
}

export function getRecipeDisplayName(recipeId: RecipeId): string {
  return RECIPES[recipeId]?.displayName ?? recipeId;
}

export function getCreateCommand(recipeId: RecipeId, appName: string): string {
  return RECIPES[recipeId].createCommand.replace('{{appName}}', appName);
}

export function getDevCommand(recipeId: RecipeId): string {
  return RECIPES[recipeId].devCommand;
}

export function getBuildCommand(recipeId: RecipeId): string {
  return RECIPES[recipeId].buildCommand;
}

export function getKeyFiles(recipeId: RecipeId): string[] {
  return RECIPES[recipeId].keyFiles;
}

export function getEstimates(recipeId: RecipeId): { files: number; dirs: number } {
  return RECIPES[recipeId].estimates;
}

export function getShadcnComponents(recipeId: RecipeId): string[] {
  return RECIPES[recipeId].shadcnComponents;
}

export function getOverlayDir(recipeId: RecipeId): string {
  return RECIPES[recipeId].overlayDir;
}

export function getAllRecipeIds(): RecipeId[] {
  return Object.keys(RECIPES) as RecipeId[];
}
