/**
 * Recipe Selector (Step 35.3)
 * 
 * Deterministic recipe selection based on user prompt analysis.
 * NO LLM calls - purely regex/keyword based for predictability.
 */

import {
  RecipeId,
  RecipeSelection,
  RecipeSelectionReason,
  RecipeDetection,
  PackageManager,
} from './recipeTypes';

// ============================================================================
// PATTERN DEFINITIONS
// ============================================================================

/**
 * Patterns that explicitly indicate Next.js
 */
const NEXTJS_PATTERNS = [
  /\bnext\.?js\b/i,
  /\bnextjs\b/i,
  /\bapp\s*router\b/i,
  /\bserver\s*side\s*render/i,
  /\bssr\b/i,
  /\bserver\s*components?\b/i,
  /\breact\s*server\b/i,
];

/**
 * Patterns that explicitly indicate Vite
 */
const VITE_PATTERNS = [
  /\bvite\b/i,
  /\bspa\b/i,
  /\bsingle\s*page\s*app/i,
  /\bno\s*ssr\b/i,
  /\bclient[\s-]*side\s*only\b/i,
  /\bstatic\s*site\b/i,
];

/**
 * Patterns that indicate mobile/Expo
 */
const MOBILE_PATTERNS = [
  /\bexpo\b/i,
  /\breact[\s-]*native\b/i,
  /\bmobile\s*app\b/i,
  /\bios\b/i,
  /\bandroid\b/i,
  /\bcross[\s-]*platform\b/i,
  /\bnative\s*app\b/i,
  /\bphone\s*app\b/i,
];

/**
 * Patterns indicating web (non-mobile)
 */
const WEB_PATTERNS = [
  /\bweb\s*app\b/i,
  /\bwebsite\b/i,
  /\bweb\s*application\b/i,
  /\bdashboard\b/i,
  /\badmin\s*panel\b/i,
  /\bportal\b/i,
  /\blanding\s*page\b/i,
];

/**
 * Patterns for simple/lightweight apps (favor Vite)
 */
const SIMPLE_WEB_PATTERNS = [
  /\bsimple\b/i,
  /\blightweight\b/i,
  /\bminimal\b/i,
  /\bquick\b/i,
  /\bbasic\b/i,
  /\bprototype\b/i,
];

/**
 * TypeScript indicators
 */
const TYPESCRIPT_PATTERNS = [
  /\btypescript\b/i,
  /\bts\b/i,
  /\.tsx?\b/i,
];

/**
 * JavaScript indicators
 */
const JAVASCRIPT_PATTERNS = [
  /\bjavascript\b/i,
  /\bjs\b/i,
  /\bno\s*typescript\b/i,
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if any pattern matches the prompt
 */
function matchesAny(prompt: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(prompt));
}

/**
 * Get the first matching pattern's match (for extraction)
 */
function getMatch(prompt: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

// ============================================================================
// MAIN SELECTOR
// ============================================================================

/**
 * Select recipe based on user prompt (DETERMINISTIC - no LLM)
 * 
 * Rules (exact order):
 * 1. If explicit framework mentioned → use that
 * 2. If mobile indicators → expo
 * 3. If "simple web" + "no ssr" → vite
 * 4. If web indicators → next (default_web)
 * 5. Fallback → next (default_web)
 */
export function selectRecipe(userPrompt: string): RecipeSelection {
  const prompt = userPrompt.toLowerCase();
  
  // Detect characteristics
  const detected = detectCharacteristics(userPrompt);
  
  // Rule 1: Explicit framework mentions
  if (matchesAny(prompt, NEXTJS_PATTERNS)) {
    return {
      recipe_id: 'nextjs_app_router',
      reason: 'explicit_user',
      detected,
      confidence: 0.95,
      needs_confirmation: false,
    };
  }
  
  if (matchesAny(prompt, VITE_PATTERNS)) {
    return {
      recipe_id: 'vite_react',
      reason: 'explicit_user',
      detected,
      confidence: 0.95,
      needs_confirmation: false,
    };
  }
  
  if (matchesAny(prompt, MOBILE_PATTERNS)) {
    return {
      recipe_id: 'expo',
      reason: detected.framework_hint === 'expo' ? 'explicit_user' : 'default_mobile',
      detected,
      confidence: 0.9,
      needs_confirmation: false,
    };
  }
  
  // Rule 2: Platform-based selection
  if (detected.platform === 'mobile') {
    return {
      recipe_id: 'expo',
      reason: 'default_mobile',
      detected,
      confidence: 0.85,
      needs_confirmation: false,
    };
  }
  
  // Rule 3: Simple web / SPA / no-SSR preference
  const isSimpleWeb = matchesAny(prompt, SIMPLE_WEB_PATTERNS);
  const wantsNoSsr = detected.ssr_preference === 'no_ssr';
  
  if (isSimpleWeb && wantsNoSsr) {
    return {
      recipe_id: 'vite_react',
      reason: 'default_simple_web',
      detected,
      confidence: 0.85,
      needs_confirmation: false,
    };
  }
  
  // If explicitly no SSR, use Vite
  if (wantsNoSsr) {
    return {
      recipe_id: 'vite_react',
      reason: 'default_simple_web',
      detected,
      confidence: 0.8,
      needs_confirmation: false,
    };
  }
  
  // Rule 4: Web indicators → Next.js (default)
  if (detected.platform === 'web' || matchesAny(prompt, WEB_PATTERNS)) {
    return {
      recipe_id: 'nextjs_app_router',
      reason: 'default_web',
      detected,
      confidence: 0.8,
      needs_confirmation: false,
    };
  }
  
  // Rule 5: Fallback → Next.js
  return {
    recipe_id: 'nextjs_app_router',
    reason: 'default_web',
    detected,
    confidence: 0.7,
    needs_confirmation: false,
  };
}

/**
 * Detect characteristics from user prompt
 */
export function detectCharacteristics(userPrompt: string): RecipeDetection {
  const prompt = userPrompt.toLowerCase();
  
  // Platform detection
  let platform: 'web' | 'mobile' | 'unknown' = 'unknown';
  if (matchesAny(prompt, MOBILE_PATTERNS)) {
    platform = 'mobile';
  } else if (matchesAny(prompt, WEB_PATTERNS)) {
    platform = 'web';
  }
  
  // SSR preference
  let ssr_preference: 'ssr' | 'no_ssr' | 'unknown' = 'unknown';
  if (matchesAny(prompt, [/\bssr\b/i, /\bserver[\s-]*side/i, /\bserver\s*components?/i])) {
    ssr_preference = 'ssr';
  } else if (matchesAny(prompt, [/\bno[\s-]*ssr\b/i, /\bspa\b/i, /\bclient[\s-]*side\s*only/i, /\bstatic/i])) {
    ssr_preference = 'no_ssr';
  }
  
  // Framework hint
  let framework_hint: string | undefined;
  if (matchesAny(prompt, NEXTJS_PATTERNS)) {
    framework_hint = 'next';
  } else if (matchesAny(prompt, VITE_PATTERNS)) {
    framework_hint = 'vite';
  } else if (matchesAny(prompt, [/\bexpo\b/i])) {
    framework_hint = 'expo';
  } else if (matchesAny(prompt, [/\breact[\s-]*native\b/i])) {
    framework_hint = 'react-native';
  }
  
  // Language preference
  let language: 'ts' | 'js' | 'unknown' = 'unknown';
  if (matchesAny(prompt, TYPESCRIPT_PATTERNS)) {
    language = 'ts';
  } else if (matchesAny(prompt, JAVASCRIPT_PATTERNS)) {
    language = 'js';
  }
  
  return {
    platform,
    ssr_preference,
    framework_hint,
    language,
  };
}

// ============================================================================
// PACKAGE MANAGER DETECTION
// ============================================================================

/**
 * Detect package manager from workspace (DETERMINISTIC)
 * 
 * Checks for lock files in order:
 * 1. pnpm-lock.yaml → pnpm
 * 2. yarn.lock → yarn
 * 3. Fallback → npm
 */
export function detectPackageManager(
  workspaceFiles: string[]
): PackageManager {
  const fileSet = new Set(workspaceFiles.map(f => f.toLowerCase()));
  
  if (fileSet.has('pnpm-lock.yaml') || fileSet.has('pnpm-workspace.yaml')) {
    return 'pnpm';
  }
  
  if (fileSet.has('yarn.lock')) {
    return 'yarn';
  }
  
  if (fileSet.has('package-lock.json')) {
    return 'npm';
  }
  
  // Default to npm if no lock file found
  return 'npm';
}

/**
 * Interface for filesystem check (for DI/testing)
 */
export interface PackageManagerDetector {
  detect(workspaceRoot: string): Promise<PackageManager>;
}

/**
 * Get the install command for a package manager
 */
export function getInstallCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm': return 'pnpm install';
    case 'yarn': return 'yarn';
    case 'npm': return 'npm install';
  }
}

/**
 * Get the run command prefix for a package manager
 */
export function getRunCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm': return 'pnpm run';
    case 'yarn': return 'yarn';
    case 'npm': return 'npm run';
  }
}

/**
 * Get the exec command for a package manager
 */
export function getExecCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm': return 'pnpm exec';
    case 'yarn': return 'yarn';
    case 'npm': return 'npx';
  }
}
