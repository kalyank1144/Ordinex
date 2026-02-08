/**
 * Next Steps Action Router (Step 35.6)
 * 
 * Routes next step selections to the correct execution pipelines:
 * - command: routes to Step 34.5 command execution phase
 * - quick_action: routes to Step 33 QUICK_ACTION with diff proposal
 * - plan: routes to Step 33 PLAN mode with approval-gated diffs
 * 
 * CRITICAL SAFETY RULES:
 * - Long-running commands (dev server): ALWAYS prompt, even if policy is auto
 * - Plan actions: ALWAYS require approval before execution
 * - Quick actions: Produce diff_proposed, require approval before apply
 * - All actions emit events for replay safety
 */

import { randomUUID } from 'crypto';
import type { Event, Mode, Stage } from '../types';
import type { EventBus } from '../eventBus';
import {
  NextStepSuggestion,
  NextStepKind,
  NextStepsContext,
  getNextStepById,
  shouldAlwaysPrompt,
  buildNextStepSelectedPayload,
} from './nextSteps';
import type { RecipeId } from './recipeTypes';

// ============================================================================
// ACTION ROUTER TYPES
// ============================================================================

/**
 * Router context provided by caller
 */
export interface NextStepsRouterContext {
  /** Run/task ID */
  run_id: string;
  /** Scaffold ID */
  scaffold_id: string;
  /** Recipe ID */
  recipe_id: RecipeId;
  /** Design pack ID if selected */
  design_pack_id?: string;
  /** Target directory */
  target_directory: string;
  /** Event bus for emitting events */
  eventBus: EventBus;
  /** Workspace root */
  workspaceRoot: string;
  /** Package manager */
  package_manager?: 'npm' | 'pnpm' | 'yarn';
}

/**
 * Result from routing a next step action
 */
export interface NextStepRouteResult {
  /** Whether routing succeeded */
  success: boolean;
  /** Pipeline routed to */
  pipeline: 'command' | 'quick_action' | 'plan' | 'none';
  /** Whether approval is needed before execution */
  needs_approval: boolean;
  /** Payload for the downstream handler */
  payload: Record<string, unknown>;
  /** Error message if routing failed */
  error?: string;
}

// ============================================================================
// COMMAND ROUTE RESULT
// ============================================================================

/**
 * Command execution payload
 */
export interface CommandRoutePayload {
  /** Command to execute */
  command: string;
  /** Working directory */
  cwd: string;
  /** Whether this is long-running */
  longRunning: boolean;
  /** Execution context */
  executionContext: 'user_run';
  /** Whether to force prompt (even if policy auto) */
  forcePrompt: boolean;
}

// ============================================================================
// QUICK_ACTION ROUTE RESULT
// ============================================================================

/**
 * Quick action payload
 */
export interface QuickActionRoutePayload {
  /** Internal prompt to seed the agent */
  promptTemplate: string;
  /** Suggestion title */
  title: string;
  /** Target directory */
  target_directory: string;
  /** Recipe context */
  recipe_id: RecipeId;
  /** Whether this is a gated action */
  gated: true;
}

// ============================================================================
// PLAN ROUTE RESULT
// ============================================================================

/**
 * Plan action payload
 */
export interface PlanRoutePayload {
  /** Internal prompt to seed the agent */
  promptTemplate: string;
  /** Suggestion title */
  title: string;
  /** Target directory */
  target_directory: string;
  /** Recipe context */
  recipe_id: RecipeId;
  /** Max clarification questions */
  maxClarifications: number;
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

/**
 * Route a next step selection to the appropriate pipeline
 * 
 * @param suggestionId - ID of the selected suggestion
 * @param ctx - Router context
 * @returns Route result with pipeline and payload
 */
export async function routeNextStepAction(
  suggestionId: string,
  ctx: NextStepsRouterContext
): Promise<NextStepRouteResult> {
  // Build NextStepsContext for lookup
  const nextStepsCtx: NextStepsContext = {
    scaffold_id: ctx.scaffold_id,
    recipe_id: ctx.recipe_id,
    design_pack_id: ctx.design_pack_id,
    target_directory: ctx.target_directory,
    package_manager: ctx.package_manager,
  };
  
  // Get the suggestion
  const suggestion = getNextStepById(suggestionId as any, nextStepsCtx);
  if (!suggestion) {
    return {
      success: false,
      pipeline: 'none',
      needs_approval: false,
      payload: {},
      error: `Unknown suggestion ID: ${suggestionId}`,
    };
  }
  
  // Emit next_step_selected event
  await emitNextStepSelected(ctx, suggestion);
  
  // Route based on kind
  switch (suggestion.kind) {
    case 'command':
      return routeCommand(suggestion, ctx);
    case 'quick_action':
      return routeQuickAction(suggestion, ctx);
    case 'plan':
      return routePlan(suggestion, ctx);
    default:
      return {
        success: false,
        pipeline: 'none',
        needs_approval: false,
        payload: {},
        error: `Unknown suggestion kind: ${suggestion.kind}`,
      };
  }
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Route command suggestion to Step 34.5 command execution
 */
function routeCommand(
  suggestion: NextStepSuggestion,
  ctx: NextStepsRouterContext
): NextStepRouteResult {
  if (!suggestion.command) {
    return {
      success: false,
      pipeline: 'command',
      needs_approval: false,
      payload: {},
      error: 'Command suggestion missing command configuration',
    };
  }
  
  const { cmd, cwd, longRunning = false } = suggestion.command;
  
  // Determine if we need to force prompt
  const forcePrompt = shouldAlwaysPrompt(suggestion);
  
  const payload: CommandRoutePayload = {
    command: cmd,
    cwd: cwd || ctx.target_directory,
    longRunning,
    executionContext: 'user_run',
    forcePrompt,
  };
  
  return {
    success: true,
    pipeline: 'command',
    needs_approval: forcePrompt,
    payload: payload as unknown as Record<string, unknown>,
  };
}

/**
 * Route quick_action suggestion to Step 33 QUICK_ACTION behavior
 */
function routeQuickAction(
  suggestion: NextStepSuggestion,
  ctx: NextStepsRouterContext
): NextStepRouteResult {
  const promptTemplate = suggestion.promptTemplate || 
    generateDefaultPromptTemplate(suggestion, ctx);
  
  const payload: QuickActionRoutePayload = {
    promptTemplate,
    title: suggestion.title,
    target_directory: ctx.target_directory,
    recipe_id: ctx.recipe_id,
    gated: true, // Always gated for quick actions
  };
  
  return {
    success: true,
    pipeline: 'quick_action',
    needs_approval: true, // Quick actions always need diff approval
    payload: payload as unknown as Record<string, unknown>,
  };
}

/**
 * Route plan suggestion to Step 33 PLAN behavior
 */
function routePlan(
  suggestion: NextStepSuggestion,
  ctx: NextStepsRouterContext
): NextStepRouteResult {
  const promptTemplate = suggestion.promptTemplate ||
    generateDefaultPromptTemplate(suggestion, ctx);
  
  const payload: PlanRoutePayload = {
    promptTemplate,
    title: suggestion.title,
    target_directory: ctx.target_directory,
    recipe_id: ctx.recipe_id,
    maxClarifications: 2, // Spec says max 2 clarification questions
  };
  
  return {
    success: true,
    pipeline: 'plan',
    needs_approval: true, // Plans always need approval
    payload: payload as unknown as Record<string, unknown>,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate default prompt template for a suggestion
 */
function generateDefaultPromptTemplate(
  suggestion: NextStepSuggestion,
  ctx: NextStepsRouterContext
): string {
  const recipeLabel = getRecipeLabel(ctx.recipe_id);
  
  switch (suggestion.id) {
    case 'create_page':
      return `Create a new page/route in this ${recipeLabel}. ` +
             `Target directory: ${ctx.target_directory}. ` +
             `Add routing, basic layout, and placeholder content.`;
    
    case 'add_auth':
      return `Add authentication to this ${recipeLabel}. ` +
             `Include login page, signup page, protected routes, and user context. ` +
             `Use Supabase if recipe supports it, otherwise use appropriate auth provider.`;
    
    case 'add_database':
      return `Add database support to this ${recipeLabel}. ` +
             `Set up Prisma or Drizzle with PostgreSQL. ` +
             `Create initial schema and client configuration.`;
    
    case 'add_deploy_config':
      return `Add deployment configuration for this ${recipeLabel}. ` +
             `Create config for Vercel or Netlify. ` +
             `Update environment handling as needed.`;
    
    default:
      return `${suggestion.title} for this ${recipeLabel}. ` +
             `Target directory: ${ctx.target_directory}.`;
  }
}

/**
 * Get human-readable recipe label
 */
function getRecipeLabel(recipeId: RecipeId): string {
  const labels: Record<RecipeId, string> = {
    'nextjs_app_router': 'Next.js App Router project',
    'vite_react': 'Vite React project',
    'expo': 'Expo React Native project',
  };
  return labels[recipeId] || 'project';
}

/**
 * Emit next_step_selected event
 */
async function emitNextStepSelected(
  ctx: NextStepsRouterContext,
  suggestion: NextStepSuggestion
): Promise<void> {
  const payload = buildNextStepSelectedPayload(ctx.scaffold_id, suggestion);
  
  const event: Event = {
    event_id: randomUUID(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'next_step_selected',
    mode: 'MISSION' as Mode,
    stage: 'none' as Stage,
    payload: payload as unknown as Record<string, unknown>,
    evidence_ids: [],
    parent_event_id: null,
  };
  
  await ctx.eventBus.publish(event);
}

/**
 * Emit next_step_dismissed event
 */
export async function emitNextStepDismissed(
  ctx: NextStepsRouterContext,
  reason?: string
): Promise<void> {
  const event: Event = {
    event_id: randomUUID(),
    task_id: ctx.run_id,
    timestamp: new Date().toISOString(),
    type: 'next_step_dismissed',
    mode: 'MISSION' as Mode,
    stage: 'none' as Stage,
    payload: {
      scaffold_id: ctx.scaffold_id,
      reason,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  
  await ctx.eventBus.publish(event);
}

// ============================================================================
// COMMAND DECISION POINT BUILDER
// ============================================================================

/**
 * Build decision point options for command execution
 */
export function buildCommandDecisionPoint(
  payload: CommandRoutePayload
): {
  title: string;
  description: string;
  options: Array<{
    label: string;
    action: string;
    description: string;
    primary?: boolean;
  }>;
} {
  const isDevServer = payload.longRunning;
  
  return {
    title: isDevServer ? 'Start Development Server?' : 'Run Command?',
    description: isDevServer
      ? `This will start a long-running process: ${payload.command}`
      : `Execute: ${payload.command}`,
    options: [
      {
        label: 'Run',
        action: 'run_command',
        description: payload.command,
        primary: true,
      },
      {
        label: 'Cancel',
        action: 'cancel',
        description: 'Do not run this command',
      },
      ...(isDevServer ? [{
        label: 'Run in Background',
        action: 'run_background',
        description: 'Run and continue (logs in Logs tab)',
      }] : []),
    ],
  };
}

