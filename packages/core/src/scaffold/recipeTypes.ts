/**
 * Recipe System Types (Step 35.3)
 *
 * Type definitions for scaffold recipes including file plans,
 * command plans, and recipe context.
 */

import { DesignPack } from './designPacks';

// ============================================================================
// RECIPE IDENTIFIERS
// ============================================================================

/**
 * Supported recipe identifiers
 */
export type RecipeId = 'nextjs_app_router' | 'vite_react' | 'expo';

/**
 * Human-readable recipe names
 */
export const RECIPE_NAMES: Record<RecipeId, string> = {
  'nextjs_app_router': 'Next.js (App Router)',
  'vite_react': 'Vite + React',
  'expo': 'Expo (React Native)',
};

/**
 * Recipe descriptions
 */
export const RECIPE_DESCRIPTIONS: Record<RecipeId, string> = {
  'nextjs_app_router': 'Full-stack React framework with SSR, file-based routing, and App Router',
  'vite_react': 'Fast, lightweight React SPA with Vite build tooling',
  'expo': 'Cross-platform mobile app with React Native and Expo SDK',
};

// ============================================================================
// PACKAGE MANAGERS
// ============================================================================

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

// ============================================================================
// RECIPE CONTEXT
// ============================================================================

/**
 * Context passed to recipe builders
 */
export interface RecipeContext {
  /** Stable scaffold ID */
  scaffold_id: string;
  /** Workspace root (absolute path) */
  workspace_root: string;
  /** Target directory for scaffold (absolute path) */
  target_directory: string;
  /** App name (extracted from user prompt or default) */
  app_name: string;
  /** Original user prompt */
  user_prompt: string;
  /** Platform hint from analysis */
  platform_hint?: 'web' | 'mobile';
  /** SSR preference hint */
  ssr_hint?: 'ssr' | 'no_ssr';
  /** Language hint */
  language_hint?: 'ts' | 'js';
  /** Package manager to use */
  package_manager: PackageManager;
  /** Selected design pack for styling (Step 35.5) */
  design_pack?: DesignPack;
}

// ============================================================================
// FILE PLAN
// ============================================================================

/**
 * Single file or directory in the plan
 */
export interface FilePlanItem {
  /** Path relative to target_directory */
  path: string;
  /** Whether this is a file or directory */
  kind: 'file' | 'dir';
  /** File content (only for files, V1: store full content) */
  content?: string;
  /** Whether file should be executable */
  executable?: boolean;
  /** Description for UI display */
  description?: string;
}

// ============================================================================
// COMMAND PLAN
// ============================================================================

/**
 * When a command should run
 */
export type CommandWhen = 'post_apply' | 'user_explicit';

/**
 * Single command in the plan
 */
export interface CommandPlanItem {
  /** Human-readable label */
  label: string;
  /** Command to run */
  cmd: string;
  /** Working directory (usually target_directory) */
  cwd: string;
  /** When this command should run */
  when: CommandWhen;
  /** Description for UI */
  description?: string;
}

// ============================================================================
// RECIPE PLAN (OUTPUT)
// ============================================================================

/**
 * Complete recipe plan output
 */
export interface RecipePlan {
  /** Recipe identifier */
  recipe_id: RecipeId;
  /** Package manager used */
  package_manager: PackageManager;
  /** Files and directories to create */
  files: FilePlanItem[];
  /** Commands to run */
  commands: CommandPlanItem[];
  /** Additional notes for the user */
  notes?: string[];
  /** Design pack ID (Step 35.5) */
  design_pack_id?: string;
  /** Design seed for deterministic selection (Step 35.5) */
  design_seed?: string;
  /** Design tokens summary for display (Step 35.5) */
  design_tokens_summary?: string;
  /** Preview asset ID for UI (Step 35.5) */
  preview_asset_id?: string;
}

// ============================================================================
// RECIPE SELECTION
// ============================================================================

/**
 * Reason for recipe selection
 */
export type RecipeSelectionReason = 
  | 'explicit_user'       // User explicitly mentioned the framework
  | 'default_web'         // Default for web apps (Next.js)
  | 'default_simple_web'  // Default for simple web/SPA (Vite)
  | 'default_mobile'      // Default for mobile apps (Expo)
  | 'user_override';      // User override via decision point

/**
 * Detected characteristics from user prompt
 */
export interface RecipeDetection {
  /** Detected platform */
  platform: 'web' | 'mobile' | 'unknown';
  /** SSR preference */
  ssr_preference: 'ssr' | 'no_ssr' | 'unknown';
  /** Framework hint from prompt */
  framework_hint?: string;
  /** Language preference */
  language: 'ts' | 'js' | 'unknown';
}

/**
 * Recipe selection result
 */
export interface RecipeSelection {
  /** Selected recipe ID */
  recipe_id: RecipeId;
  /** Why this recipe was selected */
  reason: RecipeSelectionReason;
  /** Detected characteristics */
  detected: RecipeDetection;
  /** Confidence in selection (0-1) */
  confidence: number;
  /** Whether user confirmation is recommended */
  needs_confirmation: boolean;
}

// ============================================================================
// RECIPE BUILDER INTERFACE
// ============================================================================

/**
 * Interface for recipe builders
 */
export interface RecipeBuilder {
  /** Recipe ID */
  id: RecipeId;
  /** Build the recipe plan */
  build(ctx: RecipeContext): RecipePlan;
}
