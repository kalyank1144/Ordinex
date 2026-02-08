/**
 * Next Steps Suggestion System (Step 35.6)
 * 
 * After scaffold succeeds (or verify completes), provides deterministic,
 * actionable suggestions for the user to continue their project.
 * 
 * PRINCIPLES:
 * - Deterministic ordering based on recipe
 * - 4-6 items max (not overwhelming)
 * - Safety-aware (long-running commands always prompt)
 * - Routes to correct pipelines (command/quick_action/plan)
 * - Replay-safe (events capture which suggestion was clicked)
 */

import { RecipeId } from './recipeTypes';
import type { FeatureRequirements } from '../types';

// ============================================================================
// NEXT STEP ID TYPES
// ============================================================================

/**
 * Canonical next step identifiers
 */
export type NextStepId =
  | 'start_dev_server'
  | 'run_lint'
  | 'run_tests'
  | 'run_build'
  | 'open_readme'
  | 'add_auth'
  | 'add_database'
  | 'create_page'
  | 'add_deploy_config';

/**
 * Kind of action the next step triggers
 */
export type NextStepKind = 'command' | 'quick_action' | 'plan';

/**
 * Safety level for the action
 */
export type NextStepSafety = 'safe' | 'prompt' | 'risky';

// ============================================================================
// NEXT STEP SUGGESTION INTERFACE
// ============================================================================

/**
 * Command configuration for command-type next steps
 */
export interface NextStepCommand {
  /** Command to execute */
  cmd: string;
  /** Working directory (usually target_directory) */
  cwd: string;
  /** Whether this is a long-running process (dev server) */
  longRunning?: boolean;
}

/**
 * Next step suggestion
 */
export interface NextStepSuggestion {
  /** Unique identifier */
  id: NextStepId;
  /** Display title */
  title: string;
  /** Short description (1-liner) */
  description?: string;
  /** Kind of action */
  kind: NextStepKind;
  /** Safety level */
  safety: NextStepSafety;
  /** For command type: command configuration */
  command?: NextStepCommand;
  /** For quick_action/plan: prompt template to seed agent */
  promptTemplate?: string;
  /** Icon hint for UI */
  icon?: string;
  /** Whether this is a primary action (highlighted in UI) */
  primary?: boolean;
}

// ============================================================================
// NEXT STEPS SHOWN EVENT PAYLOAD
// ============================================================================

/**
 * Payload for next_steps_shown event
 */
export interface NextStepsShownPayload {
  scaffold_id: string;
  recipe_id: string;
  design_pack_id?: string;
  suggestions: Array<{
    id: string;
    title: string;
    kind: NextStepKind;
    safety: NextStepSafety;
  }>;
}

/**
 * Payload for next_step_selected event
 */
export interface NextStepSelectedPayload {
  scaffold_id: string;
  suggestion_id: string;
  kind: NextStepKind;
}

/**
 * Payload for next_step_dismissed event
 */
export interface NextStepDismissedPayload {
  scaffold_id: string;
  reason?: string;
}

// ============================================================================
// RECIPE-SPECIFIC SUGGESTIONS
// ============================================================================

/**
 * Context for generating next steps
 */
export interface NextStepsContext {
  /** Scaffold ID */
  scaffold_id: string;
  /** Selected recipe */
  recipe_id: RecipeId;
  /** Design pack ID if selected */
  design_pack_id?: string;
  /** Target directory (for commands) */
  target_directory: string;
  /** Whether auth is already wired */
  has_auth_wired?: boolean;
  /** Whether database is already wired */
  has_db_wired?: boolean;
  /** Detected package manager */
  package_manager?: 'npm' | 'pnpm' | 'yarn';
}

/**
 * Next.js App Router suggestions
 */
const NEXTJS_SUGGESTIONS: NextStepSuggestion[] = [
  {
    id: 'start_dev_server',
    title: 'Start Dev Server',
    description: 'Launch the development server',
    kind: 'command',
    safety: 'prompt',
    icon: '🚀',
    primary: true,
    command: {
      cmd: 'npm run dev',
      cwd: '{{target_directory}}',
      longRunning: true,
    },
  },
  {
    id: 'create_page',
    title: 'Create New Page',
    description: 'Add a new route/page to your app',
    kind: 'quick_action',
    safety: 'safe',
    icon: '📄',
    promptTemplate: 'Create a new route page at app/{{slug}}/page.tsx with a simple header and placeholder content. Update navigation if present.',
  },
  {
    id: 'add_auth',
    title: 'Add Authentication',
    description: 'Set up auth with login/signup',
    kind: 'plan',
    safety: 'prompt',
    icon: '🔐',
    promptTemplate: 'Add authentication to this Next.js app. Use Supabase or NextAuth. Include login page, signup page, protected route, and user context.',
  },
  {
    id: 'add_database',
    title: 'Add Database',
    description: 'Wire up database with schema',
    kind: 'plan',
    safety: 'prompt',
    icon: '🗄️',
    promptTemplate: 'Add database support to this Next.js app. Set up Prisma or Drizzle with PostgreSQL. Create initial schema and client configuration.',
  },
  {
    id: 'run_lint',
    title: 'Run Lint',
    description: 'Check code for issues',
    kind: 'command',
    safety: 'safe',
    icon: '🔍',
    command: {
      cmd: 'npm run lint',
      cwd: '{{target_directory}}',
    },
  },
  {
    id: 'run_build',
    title: 'Run Build',
    description: 'Build for production',
    kind: 'command',
    safety: 'safe',
    icon: '📦',
    command: {
      cmd: 'npm run build',
      cwd: '{{target_directory}}',
    },
  },
];

/**
 * Vite React suggestions
 */
const VITE_SUGGESTIONS: NextStepSuggestion[] = [
  {
    id: 'start_dev_server',
    title: 'Start Dev Server',
    description: 'Launch the Vite development server',
    kind: 'command',
    safety: 'prompt',
    icon: '🚀',
    primary: true,
    command: {
      cmd: 'npm run dev',
      cwd: '{{target_directory}}',
      longRunning: true,
    },
  },
  {
    id: 'create_page',
    title: 'Create Component',
    description: 'Add a new page or component',
    kind: 'quick_action',
    safety: 'safe',
    icon: '📄',
    promptTemplate: 'Create a new React component at src/components/{{name}}.tsx with TypeScript and proper exports.',
  },
  {
    id: 'add_auth',
    title: 'Add Authentication',
    description: 'Set up auth with login/signup',
    kind: 'plan',
    safety: 'prompt',
    icon: '🔐',
    promptTemplate: 'Add authentication to this Vite React app. Use Supabase or Auth0. Include login page, signup page, protected route, and auth context.',
  },
  {
    id: 'run_lint',
    title: 'Run Lint',
    description: 'Check code for issues',
    kind: 'command',
    safety: 'safe',
    icon: '🔍',
    command: {
      cmd: 'npm run lint',
      cwd: '{{target_directory}}',
    },
  },
  {
    id: 'run_build',
    title: 'Run Build',
    description: 'Build for production',
    kind: 'command',
    safety: 'safe',
    icon: '📦',
    command: {
      cmd: 'npm run build',
      cwd: '{{target_directory}}',
    },
  },
  {
    id: 'add_deploy_config',
    title: 'Add Deploy Config',
    description: 'Set up Vercel/Netlify deploy',
    kind: 'quick_action',
    safety: 'safe',
    icon: '☁️',
    promptTemplate: 'Add deployment configuration for Vercel or Netlify. Create the config file and update any environment handling.',
  },
];

/**
 * Expo (React Native) suggestions
 */
const EXPO_SUGGESTIONS: NextStepSuggestion[] = [
  {
    id: 'start_dev_server',
    title: 'Start Expo',
    description: 'Launch Expo development server',
    kind: 'command',
    safety: 'prompt',
    icon: '🚀',
    primary: true,
    command: {
      cmd: 'npm run start',
      cwd: '{{target_directory}}',
      longRunning: true,
    },
  },
  {
    id: 'create_page',
    title: 'Create Screen',
    description: 'Add a new screen to your app',
    kind: 'quick_action',
    safety: 'safe',
    icon: '📱',
    promptTemplate: 'Create a new screen at app/{{name}}.tsx with proper Expo Router setup and basic layout.',
  },
  {
    id: 'add_auth',
    title: 'Add Authentication',
    description: 'Set up mobile auth flow',
    kind: 'plan',
    safety: 'prompt',
    icon: '🔐',
    promptTemplate: 'Add authentication to this Expo app. Use Supabase or Firebase Auth. Include login screen, signup screen, protected navigation, and auth context.',
  },
  {
    id: 'add_database',
    title: 'Add Database',
    description: 'Wire up backend or local storage',
    kind: 'plan',
    safety: 'prompt',
    icon: '🗄️',
    promptTemplate: 'Add data persistence to this Expo app. Options: Supabase backend, Firebase, or local SQLite with expo-sqlite.',
  },
  {
    id: 'run_lint',
    title: 'Run Lint',
    description: 'Check code for issues',
    kind: 'command',
    safety: 'safe',
    icon: '🔍',
    command: {
      cmd: 'npm run lint',
      cwd: '{{target_directory}}',
    },
  },
];

/**
 * Recipe to suggestions mapping
 */
const RECIPE_SUGGESTIONS: Record<RecipeId, NextStepSuggestion[]> = {
  'nextjs_app_router': NEXTJS_SUGGESTIONS,
  'vite_react': VITE_SUGGESTIONS,
  'expo': EXPO_SUGGESTIONS,
};

// ============================================================================
// MAIN EXPORT FUNCTION
// ============================================================================

/**
 * Get next steps for a recipe
 * 
 * Returns a deterministic, ordered list of 4-6 suggestions
 * based on the recipe and context.
 * 
 * @param ctx - Next steps context
 * @returns Array of next step suggestions
 */
export function getNextStepsForRecipe(ctx: NextStepsContext): NextStepSuggestion[] {
  // Get base suggestions for recipe
  const baseSuggestions = RECIPE_SUGGESTIONS[ctx.recipe_id] || NEXTJS_SUGGESTIONS;
  
  // Filter and customize based on context
  const suggestions: NextStepSuggestion[] = [];
  
  for (const suggestion of baseSuggestions) {
    // Skip auth if already wired
    if (suggestion.id === 'add_auth' && ctx.has_auth_wired) {
      continue;
    }
    
    // Skip database if already wired
    if (suggestion.id === 'add_database' && ctx.has_db_wired) {
      continue;
    }
    
    // Customize command with actual target directory
    let customized: NextStepSuggestion = { ...suggestion };
    
    if (customized.command) {
      customized = {
        ...customized,
        command: {
          ...customized.command,
          cwd: customized.command.cwd.replace('{{target_directory}}', ctx.target_directory),
          cmd: adjustCommandForPackageManager(customized.command.cmd, ctx.package_manager),
        },
      };
    }
    
    suggestions.push(customized);
    
    // Limit to 6 suggestions max
    if (suggestions.length >= 6) {
      break;
    }
  }
  
  return suggestions;
}

/**
 * Adjust command for package manager
 */
function adjustCommandForPackageManager(
  cmd: string,
  packageManager?: 'npm' | 'pnpm' | 'yarn'
): string {
  if (!packageManager || packageManager === 'npm') {
    return cmd;
  }
  
  if (packageManager === 'pnpm') {
    return cmd.replace(/^npm run/, 'pnpm');
  }
  
  if (packageManager === 'yarn') {
    return cmd.replace(/^npm run/, 'yarn');
  }
  
  return cmd;
}

/**
 * Get a specific suggestion by ID
 */
export function getNextStepById(
  id: NextStepId,
  ctx: NextStepsContext
): NextStepSuggestion | undefined {
  const suggestions = getNextStepsForRecipe(ctx);
  return suggestions.find(s => s.id === id);
}

/**
 * Check if a next step should always prompt (even in auto mode)
 */
export function shouldAlwaysPrompt(suggestion: NextStepSuggestion): boolean {
  // Long-running commands always prompt
  if (suggestion.command?.longRunning) {
    return true;
  }
  
  // Plan actions always prompt (involve multiple changes)
  if (suggestion.kind === 'plan') {
    return true;
  }
  
  // Risky safety level always prompts
  if (suggestion.safety === 'risky') {
    return true;
  }
  
  return false;
}

/**
 * Build event payload for next_steps_shown
 */
export function buildNextStepsShownPayload(
  ctx: NextStepsContext,
  suggestions: NextStepSuggestion[]
): NextStepsShownPayload {
  return {
    scaffold_id: ctx.scaffold_id,
    recipe_id: ctx.recipe_id,
    design_pack_id: ctx.design_pack_id,
    suggestions: suggestions.map(s => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      safety: s.safety,
    })),
  };
}

/**
 * Build event payload for next_step_selected
 */
export function buildNextStepSelectedPayload(
  scaffold_id: string,
  suggestion: NextStepSuggestion
): NextStepSelectedPayload {
  return {
    scaffold_id,
    suggestion_id: suggestion.id,
    kind: suggestion.kind,
  };
}

// ============================================================================
// FEATURE-AWARE NEXT STEPS
// ============================================================================

/**
 * Generate feature-aware next steps based on extracted requirements.
 *
 * Instead of generic suggestions like "Add Database" or "Create New Page",
 * this generates suggestions tailored to the user's feature (e.g., for a todo
 * app: "Add Task Persistence", "Add Due Dates", "Add User Authentication").
 *
 * @param ctx - Next steps context
 * @param requirements - Extracted feature requirements
 * @returns Array of feature-aware suggestions
 */
export function getFeatureAwareNextSteps(
  ctx: NextStepsContext,
  requirements: FeatureRequirements,
): NextStepSuggestion[] {
  const suggestions: NextStepSuggestion[] = [];
  const pm = ctx.package_manager || 'npm';

  // Always start with dev server
  suggestions.push({
    id: 'start_dev_server',
    title: 'Start Dev Server',
    description: `Launch the development server to see your ${requirements.app_type} app`,
    kind: 'command',
    safety: 'prompt',
    icon: '🚀',
    primary: true,
    command: {
      cmd: adjustCommandForPM('npm run dev', pm),
      cwd: ctx.target_directory,
      longRunning: true,
    },
  });

  // Feature-specific enhancement suggestions
  const appSuggestions = getAppSpecificSuggestions(requirements);
  for (const suggestion of appSuggestions) {
    if (suggestions.length >= 6) break;
    suggestions.push(suggestion);
  }

  // Add lint/build if we have room
  if (suggestions.length < 5) {
    suggestions.push({
      id: 'run_lint',
      title: 'Run Lint',
      description: 'Check code for issues',
      kind: 'command',
      safety: 'safe',
      icon: '🔍',
      command: {
        cmd: adjustCommandForPM('npm run lint', pm),
        cwd: ctx.target_directory,
      },
    });
  }

  if (suggestions.length < 6) {
    suggestions.push({
      id: 'run_build',
      title: 'Run Build',
      description: 'Build for production',
      kind: 'command',
      safety: 'safe',
      icon: '📦',
      command: {
        cmd: adjustCommandForPM('npm run build', pm),
        cwd: ctx.target_directory,
      },
    });
  }

  return suggestions;
}

/**
 * Get app-type-specific enhancement suggestions
 */
function getAppSpecificSuggestions(requirements: FeatureRequirements): NextStepSuggestion[] {
  const appType = requirements.app_type.toLowerCase();

  // Common patterns for different app types
  const suggestionMap: Record<string, NextStepSuggestion[]> = {
    todo: [
      {
        id: 'add_database' as NextStepId,
        title: 'Add Task Persistence',
        description: 'Connect to a database to persist tasks across sessions',
        kind: 'plan',
        safety: 'prompt',
        icon: '🗄️',
        promptTemplate: 'Add database persistence to this todo app. Store tasks in a database so they survive page refreshes. Use Prisma with SQLite for simplicity.',
      },
      {
        id: 'add_auth' as NextStepId,
        title: 'Add User Authentication',
        description: 'Add login so each user has their own task list',
        kind: 'plan',
        safety: 'prompt',
        icon: '🔐',
        promptTemplate: 'Add user authentication to this todo app so each user has their own private task list.',
      },
      {
        id: 'create_page' as NextStepId,
        title: 'Add Due Dates',
        description: 'Add date picker and deadline tracking to tasks',
        kind: 'quick_action',
        safety: 'safe',
        icon: '📅',
        promptTemplate: 'Add due date functionality to the todo app. Add a date picker to the task form and display due dates on each task. Highlight overdue tasks.',
      },
    ],
    blog: [
      {
        id: 'create_page' as NextStepId,
        title: 'Add Markdown Support',
        description: 'Add MDX for rich blog posts with code blocks',
        kind: 'plan',
        safety: 'prompt',
        icon: '📝',
        promptTemplate: 'Add markdown/MDX support to this blog app for rich blog posts with code syntax highlighting.',
      },
      {
        id: 'add_database' as NextStepId,
        title: 'Add Post Categories',
        description: 'Organize posts with categories and tags',
        kind: 'quick_action',
        safety: 'safe',
        icon: '🏷️',
        promptTemplate: 'Add categories and tags to blog posts. Include a category filter on the main page.',
      },
      {
        id: 'add_auth' as NextStepId,
        title: 'Add Author Dashboard',
        description: 'Add admin panel for creating and editing posts',
        kind: 'plan',
        safety: 'prompt',
        icon: '📊',
        promptTemplate: 'Add an author dashboard for creating, editing, and deleting blog posts with a rich text editor.',
      },
    ],
    ecommerce: [
      {
        id: 'add_database' as NextStepId,
        title: 'Add Product Database',
        description: 'Connect to a database for product catalog',
        kind: 'plan',
        safety: 'prompt',
        icon: '🗄️',
        promptTemplate: 'Add a product database to this ecommerce app using Prisma with PostgreSQL. Include product CRUD operations.',
      },
      {
        id: 'add_auth' as NextStepId,
        title: 'Add Checkout Flow',
        description: 'Add cart summary and checkout page',
        kind: 'plan',
        safety: 'prompt',
        icon: '💳',
        promptTemplate: 'Add a checkout flow to this ecommerce app with cart summary, shipping info form, and order confirmation.',
      },
      {
        id: 'create_page' as NextStepId,
        title: 'Add Product Search',
        description: 'Add search and filter functionality',
        kind: 'quick_action',
        safety: 'safe',
        icon: '🔍',
        promptTemplate: 'Add product search and filter functionality with category filters, price range, and sorting options.',
      },
    ],
    dashboard: [
      {
        id: 'create_page' as NextStepId,
        title: 'Add Charts',
        description: 'Add data visualization with charts',
        kind: 'plan',
        safety: 'prompt',
        icon: '📊',
        promptTemplate: 'Add charts and data visualization to this dashboard using Recharts. Include line, bar, and pie charts.',
      },
      {
        id: 'add_database' as NextStepId,
        title: 'Add Data API',
        description: 'Connect to a real data source',
        kind: 'plan',
        safety: 'prompt',
        icon: '🔌',
        promptTemplate: 'Add API integration to this dashboard to fetch real data. Create API routes and data fetching hooks.',
      },
      {
        id: 'add_auth' as NextStepId,
        title: 'Add User Roles',
        description: 'Add authentication with admin/viewer roles',
        kind: 'plan',
        safety: 'prompt',
        icon: '🔐',
        promptTemplate: 'Add role-based authentication with admin and viewer roles. Admin can edit, viewer is read-only.',
      },
    ],
  };

  // Try exact match, then partial match, then default
  if (suggestionMap[appType]) {
    return suggestionMap[appType];
  }

  // Partial match
  for (const [key, suggestions] of Object.entries(suggestionMap)) {
    if (appType.includes(key) || key.includes(appType)) {
      return suggestions;
    }
  }

  // Default feature suggestions based on what's missing
  const defaults: NextStepSuggestion[] = [];

  if (!requirements.has_database) {
    defaults.push({
      id: 'add_database' as NextStepId,
      title: 'Add Data Persistence',
      description: 'Connect a database to persist your data',
      kind: 'plan',
      safety: 'prompt',
      icon: '🗄️',
      promptTemplate: `Add database persistence to this ${requirements.app_type} app. Use Prisma with SQLite for local development.`,
    });
  }

  if (!requirements.has_auth) {
    defaults.push({
      id: 'add_auth' as NextStepId,
      title: 'Add Authentication',
      description: 'Add user login and signup',
      kind: 'plan',
      safety: 'prompt',
      icon: '🔐',
      promptTemplate: `Add user authentication to this ${requirements.app_type} app with login and signup pages.`,
    });
  }

  defaults.push({
    id: 'create_page' as NextStepId,
    title: 'Add New Feature',
    description: `Extend your ${requirements.app_type} app with more functionality`,
    kind: 'quick_action',
    safety: 'safe',
    icon: '✨',
    promptTemplate: `Add a new feature to this ${requirements.app_type} app. The current features are: ${requirements.features.join(', ')}.`,
  });

  return defaults;
}

function adjustCommandForPM(cmd: string, pm: string): string {
  if (pm === 'pnpm') return cmd.replace(/^npm run/, 'pnpm');
  if (pm === 'yarn') return cmd.replace(/^npm run/, 'yarn');
  return cmd;
}

// ============================================================================
// COMMAND DISCOVERY FOR DEV SERVER
// ============================================================================

/**
 * Package.json script detection result
 */
export interface DevServerDetection {
  /** Detected command */
  command: string;
  /** Script name in package.json */
  scriptName: string;
  /** Whether detection is ambiguous (multiple options) */
  ambiguous: boolean;
  /** Alternative commands if ambiguous */
  alternatives?: string[];
}

/**
 * Detect dev server command from package.json
 * 
 * Does NOT rely on LLM - uses deterministic script detection.
 * 
 * @param packageJson - Parsed package.json content
 * @param packageManager - Package manager to use
 * @returns Detection result
 */
export function detectDevServerCommand(
  packageJson: { scripts?: Record<string, string> },
  packageManager: 'npm' | 'pnpm' | 'yarn' = 'npm'
): DevServerDetection {
  const scripts = packageJson.scripts || {};
  
  // Priority order for dev server script names
  const devScriptNames = ['dev', 'start', 'serve', 'develop'];
  const foundScripts: string[] = [];
  
  for (const name of devScriptNames) {
    if (scripts[name]) {
      foundScripts.push(name);
    }
  }
  
  // Check for Expo specifically
  if (scripts['start'] && scripts['start'].includes('expo')) {
    const cmd = getRunCommand('start', packageManager);
    return {
      command: cmd,
      scriptName: 'start',
      ambiguous: false,
    };
  }
  
  // If no scripts found, return default
  if (foundScripts.length === 0) {
    return {
      command: getRunCommand('dev', packageManager),
      scriptName: 'dev',
      ambiguous: false,
    };
  }
  
  // If only one found, use it
  if (foundScripts.length === 1) {
    return {
      command: getRunCommand(foundScripts[0], packageManager),
      scriptName: foundScripts[0],
      ambiguous: false,
    };
  }
  
  // If multiple found, prefer 'dev' if present, otherwise flag as ambiguous
  if (foundScripts.includes('dev')) {
    return {
      command: getRunCommand('dev', packageManager),
      scriptName: 'dev',
      ambiguous: false,
      alternatives: foundScripts.filter(s => s !== 'dev').map(s => getRunCommand(s, packageManager)),
    };
  }
  
  // Ambiguous - let user choose
  return {
    command: getRunCommand(foundScripts[0], packageManager),
    scriptName: foundScripts[0],
    ambiguous: true,
    alternatives: foundScripts.slice(1).map(s => getRunCommand(s, packageManager)),
  };
}

/**
 * Get run command for a script
 */
function getRunCommand(scriptName: string, packageManager: 'npm' | 'pnpm' | 'yarn'): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm ${scriptName}`;
    case 'yarn':
      return `yarn ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  NEXTJS_SUGGESTIONS,
  VITE_SUGGESTIONS,
  EXPO_SUGGESTIONS,
  RECIPE_SUGGESTIONS,
};
