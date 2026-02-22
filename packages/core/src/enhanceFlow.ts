/**
 * Enhance Flow (Step 36)
 * 
 * Orchestrates the "Enhance Existing Project" flow for non-greenfield scenarios.
 * Reuses existing mechanics: Intent Analyzer, VERIFY, REPAIR, diff pipeline.
 * 
 * CRITICAL RULES:
 * - NEVER overwrite or delete existing project by default
 * - All code changes MUST be diff-gated + approval-gated
 * - Reuse VERIFY + REPAIR (no new validation loops)
 * - Context selection is deterministic (no random files)
 * - Max 2 clarification questions
 * - Replay/Audit must not re-execute commands
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Event, Mode, Stage, IntentAnalysis, Behavior, FlowKind } from './types';
import {
  buildProjectSnapshot,
  ProjectSnapshot,
  isExistingProject,
  getSnapshotSummary,
  getRecommendedVerifyCommands,
} from './projectSnapshot';
import {
  buildEnhanceContext,
  EnhanceContextResult,
  RecentRunMetadata,
  readSelectedFiles,
  buildContextString,
  getContextSummary,
} from './enhanceContextBuilder';
import { analyzeIntent, IntentAnalysisContext, detectActiveRun } from './intentAnalyzer';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Flow kind extended for enhance flow
 */
export type EnhanceFlowKind = 'standard' | 'scaffold' | 'enhance';

/**
 * Enhance flow result
 */
export interface EnhanceFlowResult {
  /** Flow kind that was selected */
  flowKind: EnhanceFlowKind;
  
  /** Whether this is an existing project */
  isExistingProject: boolean;
  
  /** Project snapshot (if existing project) */
  snapshot?: ProjectSnapshot;
  
  /** Context result (files selected) */
  context?: EnhanceContextResult;
  
  /** Intent analysis result */
  intentAnalysis: IntentAnalysis;
  
  /** Whether approval card should be shown */
  showProposalCard: boolean;
  
  /** Proposal card data */
  proposalCardData?: EnhanceProposalData;
  
  /** Whether to proceed directly (QUICK_ACTION small change) */
  proceedDirectly: boolean;
  
  /** Error if any */
  error?: string;
}

/**
 * Enhance proposal card data
 */
export interface EnhanceProposalData {
  /** Title for the card */
  title: string;
  
  /** Detected stack description */
  detectedStack: string;
  
  /** Files to read count */
  filesToReadCount: number;
  
  /** Files to read list (for View expansion) */
  filesToRead: string[];
  
  /** Verify commands to run */
  verifyCommands: string[];
  
  /** Key reassurances */
  reassurances: string[];
  
  /** Snapshot summary */
  snapshotSummary: string;
}

/**
 * Enhance flow options
 */
export interface EnhanceFlowOptions {
  /** User prompt */
  userPrompt: string;
  
  /** Workspace root */
  workspaceRoot: string;
  
  /** Intent analysis context */
  analysisContext?: IntentAnalysisContext;
  
  /** Recent run metadata for context resolution */
  recentRunMetadata?: RecentRunMetadata;
  
  /** Event bus for emitting events */
  eventBus?: EventEmitter;
  
  /** Run ID for correlation */
  runId?: string;
  
  /** Recent events for active run detection */
  recentEvents?: Event[];
}

// ============================================================================
// MAIN FLOW FUNCTION
// ============================================================================

/**
 * Run the enhance existing project flow
 * 
 * This is the main entry point when Ordinex detects an existing project.
 * It builds a snapshot, selects relevant context, and prepares for execution.
 * 
 * @param options - Flow options
 * @returns Flow result with next steps
 */
export async function runEnhanceFlow(
  options: EnhanceFlowOptions
): Promise<EnhanceFlowResult> {
  const {
    userPrompt,
    workspaceRoot,
    analysisContext = { clarificationAttempts: 0 },
    recentRunMetadata,
    eventBus,
    runId,
    recentEvents = [],
  } = options;
  
  const taskId = runId || randomUUID();
  
  // Emit enhance flow started
  if (eventBus) {
    emitEvent(eventBus, taskId, 'enhance_flow_started', {
      workspace_root: workspaceRoot,
      prompt_length: userPrompt.length,
    });
  }
  
  try {
    // 1. Build project snapshot (fast, deterministic)
    const snapshot = await buildProjectSnapshot({
      workspaceRoot,
      eventBus,
      runId: taskId,
    });
    
    // 2. Check if this is an existing project
    const existing = isExistingProject(snapshot);
    
    if (!existing) {
      // Not an existing project - might be empty dir or greenfield
      return {
        flowKind: 'standard',
        isExistingProject: false,
        snapshot,
        intentAnalysis: analyzeIntent(userPrompt, analysisContext),
        showProposalCard: false,
        proceedDirectly: false,
      };
    }
    
    // 3. Run intent analysis
    // Check for active run first
    const activeRun = detectActiveRun(recentEvents);
    const contextWithRun: IntentAnalysisContext = {
      ...analysisContext,
      activeRun: activeRun || undefined,
      lastAppliedDiff: recentRunMetadata?.lastAppliedDiffFiles ? {
        files: recentRunMetadata.lastAppliedDiffFiles,
        timestamp: recentRunMetadata.lastAppliedDiffTimestamp || new Date().toISOString(),
      } : undefined,
      lastOpenEditor: recentRunMetadata?.activeEditorFile,
      lastArtifactProposed: recentRunMetadata?.lastArtifactProposed,
    };
    
    const intentAnalysis = analyzeIntent(userPrompt, contextWithRun);
    
    // 4. Handle CONTINUE_RUN (active run detected)
    if (intentAnalysis.behavior === 'CONTINUE_RUN') {
      return {
        flowKind: 'standard',
        isExistingProject: true,
        snapshot,
        intentAnalysis,
        showProposalCard: false,
        proceedDirectly: false,
      };
    }
    
    // 5. Handle ANSWER behavior (agent handles everything)
    if (intentAnalysis.behavior === 'ANSWER') {
      return {
        flowKind: 'standard',
        isExistingProject: true,
        snapshot,
        intentAnalysis,
        showProposalCard: false,
        proceedDirectly: false,
      };
    }
    
    // 6. Build targeted context for enhance flow
    const context = await buildEnhanceContext({
      userRequest: userPrompt,
      snapshot,
      recentRunMetadata,
      workspaceRoot,
      eventBus,
      runId: taskId,
    });
    
    // 7. Handle CLARIFY behavior (needs clarification)
    if (intentAnalysis.behavior === 'CLARIFY' || context.needsClarification) {
      return {
        flowKind: 'enhance',
        isExistingProject: true,
        snapshot,
        context,
        intentAnalysis: context.needsClarification ? {
          ...intentAnalysis,
          behavior: 'CLARIFY' as Behavior,
          clarification: {
            question: context.needsClarification.question,
            options: context.needsClarification.options.map(o => ({
              label: o.label,
              action: 'provide_file' as const,
              value: o.value,
            })),
          },
        } : intentAnalysis,
        showProposalCard: false,
        proceedDirectly: false,
      };
    }
    
    // 8. Determine if we show proposal card or proceed directly
    const scope = intentAnalysis.detected_scope || 'small';
    const showProposal = scope === 'medium' || scope === 'large' || intentAnalysis.behavior === 'PLAN';
    
    // Build proposal card data
    const proposalCardData: EnhanceProposalData = {
      title: 'Enhance Existing Project',
      detectedStack: getSnapshotSummary(snapshot),
      filesToReadCount: context.filesToRead.length,
      filesToRead: context.filesToRead,
      verifyCommands: context.recommendedVerifyCommands,
      reassurances: buildReassurances(snapshot, context),
      snapshotSummary: buildSnapshotSummaryForCard(snapshot),
    };
    
    // Emit enhance proposal ready
    if (eventBus) {
      emitEvent(eventBus, taskId, 'enhance_proposal_ready', {
        detected_stack: proposalCardData.detectedStack,
        files_count: proposalCardData.filesToReadCount,
        verify_commands_count: proposalCardData.verifyCommands.length,
        behavior: intentAnalysis.behavior,
        scope,
      });
    }
    
    return {
      flowKind: 'enhance',
      isExistingProject: true,
      snapshot,
      context,
      intentAnalysis,
      showProposalCard: showProposal,
      proposalCardData,
      proceedDirectly: !showProposal && (scope === 'trivial' || scope === 'small'),
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (eventBus) {
      emitEvent(eventBus, taskId, 'enhance_flow_failed', {
        error: errorMessage,
      });
    }
    
    return {
      flowKind: 'standard',
      isExistingProject: false,
      intentAnalysis: analyzeIntent(userPrompt, analysisContext),
      showProposalCard: false,
      proceedDirectly: false,
      error: errorMessage,
    };
  }
}

// ============================================================================
// ROUTING FUNCTIONS
// ============================================================================

/**
 * Detect if enhance flow should be used
 * 
 * Returns true when:
 * - Target directory is non-empty
 * - Project markers exist (package.json, src/, app/, etc.)
 * - User intent ≠ "create new project"
 */
export async function shouldUseEnhanceFlow(
  workspaceRoot: string,
  userPrompt: string
): Promise<boolean> {
  // Check for greenfield patterns (should NOT use enhance flow)
  const greenfieldPatterns = [
    'create a new',
    'new project',
    'start a new',
    'from scratch',
    'greenfield',
    'scaffold',
    'bootstrap',
  ];
  
  const promptLower = userPrompt.toLowerCase();
  const isGreenfieldRequest = greenfieldPatterns.some(p => promptLower.includes(p));
  
  if (isGreenfieldRequest) {
    return false;
  }
  
  // Build snapshot to check if existing project
  try {
    const snapshot = await buildProjectSnapshot({ workspaceRoot });
    return isExistingProject(snapshot);
  } catch {
    return false;
  }
}

/**
 * Determine flow kind from prompt and workspace state
 */
export async function determineFlowKind(
  workspaceRoot: string,
  userPrompt: string
): Promise<EnhanceFlowKind> {
  const promptLower = userPrompt.toLowerCase();
  
  // Check for explicit greenfield/scaffold patterns
  const greenfieldPatterns = [
    'create a new app',
    'create a new project',
    'start a new project',
    'from scratch',
    'greenfield',
    'scaffold',
    'bootstrap',
    'new nextjs app',
    'new react app',
    'new vite app',
    'new expo app',
  ];
  
  if (greenfieldPatterns.some(p => promptLower.includes(p))) {
    return 'scaffold';
  }
  
  // Check if existing project
  const useEnhance = await shouldUseEnhanceFlow(workspaceRoot, userPrompt);
  if (useEnhance) {
    return 'enhance';
  }
  
  return 'standard';
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build reassurance messages for the proposal card
 */
function buildReassurances(
  snapshot: ProjectSnapshot,
  context: EnhanceContextResult
): string[] {
  const reassurances: string[] = [];
  
  // No overwrites
  reassurances.push('No files will be overwritten without approval');
  
  // Targeted files only
  reassurances.push(`Only ${context.filesToRead.length} relevant files will be read`);
  
  // Verify commands
  if (context.recommendedVerifyCommands.length > 0) {
    reassurances.push(`Verification: ${context.recommendedVerifyCommands.join(', ')}`);
  }
  
  // Diffs are gated
  reassurances.push('All changes require your approval before applying');
  
  return reassurances;
}

/**
 * Build snapshot summary for card display
 */
function buildSnapshotSummaryForCard(snapshot: ProjectSnapshot): string {
  const parts: string[] = [];
  
  // Framework
  if (snapshot.framework !== 'unknown') {
    parts.push(`Framework: ${snapshot.framework}`);
  }
  
  // Language
  if (snapshot.language !== 'unknown') {
    parts.push(`Language: ${snapshot.language}`);
  }
  
  // Package manager
  if (snapshot.packageManager !== 'unknown') {
    parts.push(`Package Manager: ${snapshot.packageManager}`);
  }
  
  // Patterns
  if (snapshot.patterns.length > 0) {
    parts.push(`Patterns: ${snapshot.patterns.join(', ')}`);
  }
  
  // Scripts
  const scripts: string[] = [];
  if (snapshot.hasLintScript) scripts.push('lint');
  if (snapshot.hasTestScript) scripts.push('test');
  if (snapshot.hasBuildScript) scripts.push('build');
  if (scripts.length > 0) {
    parts.push(`Scripts: ${scripts.join(', ')}`);
  }
  
  return parts.join('\n');
}

/**
 * Emit event helper
 */
function emitEvent(
  eventBus: EventEmitter,
  taskId: string,
  type: string,
  payload: Record<string, unknown>
): void {
  const event: Event = {
    event_id: randomUUID(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: type as any,
    mode: 'MISSION' as Mode,
    stage: 'none' as Stage,
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };
  
  eventBus.emit('event', event);
}

// ============================================================================
// ENHANCE EXECUTION (REUSE EXISTING MECHANICS)
// ============================================================================

/**
 * Execute enhance action (reuses existing diff/verify/repair mechanics)
 * 
 * This function prepares the context for existing execution pipelines.
 * It does NOT implement new execution logic - it wires to existing handlers.
 */
export interface EnhanceExecutionContext {
  /** Project snapshot */
  snapshot: ProjectSnapshot;
  
  /** Context result with files to read */
  context: EnhanceContextResult;
  
  /** File contents (pre-read) */
  fileContents: Map<string, string>;
  
  /** Context string for LLM */
  contextString: string;
  
  /** Recommended verify commands */
  verifyCommands: string[];
}

/**
 * Prepare execution context for enhance flow
 * 
 * Reads selected files and builds context for LLM.
 * Does NOT execute - that's handled by existing pipelines.
 */
export async function prepareEnhanceExecution(
  snapshot: ProjectSnapshot,
  context: EnhanceContextResult,
  workspaceRoot: string
): Promise<EnhanceExecutionContext> {
  // Read selected files
  const fileContents = await readSelectedFiles(
    context.filesToRead,
    workspaceRoot
  );
  
  // Build context string for LLM
  const contextString = buildContextString(fileContents, snapshot);
  
  return {
    snapshot,
    context,
    fileContents,
    contextString,
    verifyCommands: context.recommendedVerifyCommands,
  };
}

/**
 * Build system prompt enhancement for enhance flow
 * 
 * Injects snapshot info into existing PLAN/MISSION system prompts.
 */
export function buildEnhanceSystemPromptAddition(
  snapshot: ProjectSnapshot
): string {
  const parts: string[] = [];
  
  parts.push('# EXISTING PROJECT CONTEXT\n');
  parts.push('You are enhancing an EXISTING project. DO NOT create new project structure.');
  parts.push('Work within the existing codebase and patterns.\n');
  
  // Framework
  if (snapshot.framework !== 'unknown') {
    parts.push(`Framework: ${formatFrameworkForPrompt(snapshot.framework)}`);
    parts.push(getFrameworkGuidance(snapshot.framework));
  }
  
  // Language
  if (snapshot.language === 'typescript') {
    parts.push('Language: TypeScript (maintain type safety)');
  }
  
  // Patterns
  if (snapshot.patterns.length > 0) {
    parts.push(`Patterns in use: ${snapshot.patterns.join(', ')}`);
    parts.push('Follow existing patterns, do not introduce conflicting approaches.');
  }
  
  // ESLint/Prettier
  if (snapshot.hasEslint) {
    parts.push('ESLint is configured - ensure code passes lint checks.');
  }
  if (snapshot.hasPrettier) {
    parts.push('Prettier is configured - follow existing formatting.');
  }
  
  // Key files hint
  if (snapshot.keyFiles.length > 0) {
    parts.push('\nKey files:');
    for (const kf of snapshot.keyFiles.slice(0, 5)) {
      if (kf.framework_role) {
        parts.push(`- ${kf.path} (${kf.framework_role})`);
      }
    }
  }
  
  parts.push('\n---\n');
  
  return parts.join('\n');
}

/**
 * Format framework name for prompt
 */
function formatFrameworkForPrompt(framework: string): string {
  const names: Record<string, string> = {
    nextjs_app_router: 'Next.js with App Router',
    nextjs_pages_router: 'Next.js with Pages Router',
    vite_react: 'Vite + React',
    vite_vue: 'Vite + Vue',
    create_react_app: 'Create React App',
    expo: 'Expo (React Native)',
    express: 'Express.js',
    nestjs: 'NestJS',
    astro: 'Astro',
    remix: 'Remix',
    nuxt: 'Nuxt',
    angular: 'Angular',
    svelte: 'SvelteKit',
  };
  
  return names[framework] || framework;
}

/**
 * Get framework-specific guidance
 */
function getFrameworkGuidance(framework: string): string {
  const guidance: Record<string, string> = {
    nextjs_app_router: 'Use App Router conventions (app/, layout.tsx, page.tsx). Use Server Components by default.',
    nextjs_pages_router: 'Use Pages Router conventions (pages/, _app.tsx). Use getServerSideProps/getStaticProps for data.',
    vite_react: 'Standard React patterns. Components in src/components.',
    expo: 'Use Expo SDK. Follow React Native patterns. Test on simulator.',
    express: 'RESTful routes. Middleware patterns. Error handling.',
    nestjs: 'Use decorators. Modules, controllers, services pattern.',
  };
  
  return guidance[framework] || '';
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  buildProjectSnapshot,
  buildEnhanceContext,
  getSnapshotSummary,
  getContextSummary,
  isExistingProject,
};
