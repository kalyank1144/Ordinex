/**
 * Intent Analyzer: Pre-execution Intelligence Layer (Step 33)
 * 
 * Core Concept: Behavior is selected FIRST, Mode is a downstream consequence.
 * 
 * The 5 Behaviors:
 * - ANSWER: Discussion, explanation, opinions (no execution)
 * - CLARIFY: Missing info → ask + offer tools
 * - QUICK_ACTION: Small, obvious change → gated diff/tool
 * - PLAN: Large or greenfield work
 * - CONTINUE_RUN: Mid-execution interruption handling
 * 
 * Behavior Selection Algorithm:
 * 1. Is there an active run? → CONTINUE_RUN
 * 2. Is this a pure question? → ANSWER
 * 3. Is required information missing? → CLARIFY (max 2 attempts)
 * 4. Determine scope → trivial/small → QUICK_ACTION, medium/large → PLAN
 * 5. Resolve references ("this", "it") → Priority stack or CLARIFY
 * 
 * NO LLM CALLS for primary decision. Deterministic. Fast (<10ms).
 */

import {
  Behavior,
  Mode,
  IntentAnalysis,
  ContextSource,
  ClarificationRequest,
  ClarificationOption,
  ActiveRunStatus,
  ScopeDetectionResult,
  ReferenceResolution,
} from './types';
import { Event } from './types';
import { detectCommandIntent } from './userCommandDetector';

// ============================================================================
// CONFIGURATION (Tunable)
// ============================================================================

const CONFIG = {
  /** Maximum clarification attempts before forcing a decision */
  maxClarificationAttempts: 2,
  
  /** Confidence thresholds */
  highConfidence: 0.8,
  mediumConfidence: 0.5,
  
  /** Scope thresholds (files) */
  trivialScope: 1,      // Single file
  smallScope: 3,        // 1-3 files
  mediumScope: 10,      // 4-10 files
  // large = > 10 files
};

// ============================================================================
// PATTERN MATCHING (Deterministic Heuristics)
// ============================================================================

/**
 * Pure question patterns (ANSWER behavior)
 */
const QUESTION_PATTERNS = {
  starters: [
    'what is', 'what are', 'what does', 'what do', 'what\'s',
    'why is', 'why are', 'why does', 'why do',
    'how is', 'how are', 'how does', 'how do', 'how can', 'how to',
    'when is', 'when are', 'when does', 'when do',
    'where is', 'where are', 'where does', 'where do',
    'which is', 'which are', 'which one',
    'who is', 'who are', 'who does',
    'explain', 'describe', 'tell me about', 'can you explain',
    'what\'s the difference', 'difference between',
    'is it possible', 'is there a way',
  ],
  
  // Patterns that look like questions but are actually action requests
  actionQuestionPhrases: [
    'can you add', 'can you fix', 'can you create', 'can you implement',
    'can you update', 'can you change', 'can you modify', 'can you remove',
    'could you add', 'could you fix', 'could you create', 'could you implement',
    'would you add', 'would you fix', 'would you create', 'would you implement',
    'please add', 'please fix', 'please create', 'please implement',
    'help me add', 'help me fix', 'help me create', 'help me implement',
  ],
};

/**
 * Action patterns (QUICK_ACTION or PLAN behavior)
 */
const ACTION_PATTERNS = {
  trivialVerbs: [
    'fix typo', 'fix typos', 'correct typo', 'fix spelling',
    'rename', 'update comment', 'fix comment',
    'add import', 'remove unused', 'fix whitespace',
  ],
  
  smallVerbs: [
    'add', 'fix', 'update', 'change', 'modify', 'remove', 'delete',
    'rename', 'move', 'copy', 'replace', 'insert', 'append',
  ],
  
  largeVerbs: [
    'refactor', 'migrate', 'rewrite', 'restructure', 'overhaul',
    'implement', 'create', 'build', 'develop', 'design', 'architect',
    'integrate', 'upgrade', 'setup', 'configure', 'deploy',
  ],
  
  greenFieldPhrases: [
    'new project', 'from scratch', 'new app', 'new application',
    'build a', 'create a new', 'set up a', 'start a new',
    'greenfield', 'blank slate', 'initial setup',
  ],
};

/**
 * Explanation / diagnosis intent patterns
 */
const EXPLAIN_PATTERNS = [
  'explain', 'why', 'what is', 'what are', 'what does', 'what do',
  'how does', 'how do', 'describe', 'diagnose', 'root cause',
  'what\'s happening', 'what happened', 'understand', 'reason for',
];

/**
 * Proposal / planning intent patterns
 */
const PLAN_PATTERNS = [
  'plan', 'proposal', 'propose', 'recommend', 'suggest', 'outline',
  'approach', 'strategy', 'steps', 'best way', 'how should',
];

/**
 * Structural signals that usually imply an editable target
 */
const STRUCTURE_PATTERNS = [
  /```[\s\S]*?```/g,
  /\b(stack trace|traceback|exception|error:)\b/gi,
  /\bline \d+\b/gi,
  /\b(diff|patch)\b/gi,
];

/**
 * Ambiguous reference patterns ("this", "it", etc.)
 */
const REFERENCE_PATTERNS = [
  /\b(this|it|that|these|those)\b(?!\s+(is|are|was|were|will|would|should|could|can|might|may))/gi,
  /\bthe (file|function|class|method|component|module)\b/gi,
  /\bsame (file|thing|approach)\b/gi,
  /\bhere\b/gi,
  /\b(above|below|previous|last)\b/gi,
];

/**
 * File reference patterns
 */
const FILE_PATTERNS = [
  /[a-zA-Z0-9_\-/.]+\.(ts|tsx|js|jsx|py|go|java|cpp|c|h|rs|rb|php|swift|kt)(?:\s|$|,|:)/g,
  /\bsrc\//g,
  /\bpackages\//g,
  /\blib\//g,
  /\btest[s]?\//g,
  /\bspec[s]?\//g,
];

// ============================================================================
// USER OVERRIDE COMMANDS
// ============================================================================

/**
 * User override commands that bypass intent analysis
 */
const USER_OVERRIDES: Record<string, Behavior> = {
  '/chat': 'ANSWER',
  '/ask': 'ANSWER',
  '/do': 'QUICK_ACTION',
  '/edit': 'QUICK_ACTION',
  '/run': 'CONTINUE_RUN',
  '/plan': 'PLAN',
  '/mission': 'PLAN',
};

// ============================================================================
// INTENT ANALYSIS CONTEXT
// ============================================================================

/**
 * Context for intent analysis
 */
export interface IntentAnalysisContext {
  /** Active run status (if any) */
  activeRun?: ActiveRunStatus;
  
  /** Previous clarification attempts for this conversation */
  clarificationAttempts: number;
  
  /** Last applied diff (for reference resolution) */
  lastAppliedDiff?: {
    files: string[];
    timestamp: string;
  };
  
  /** Currently open editor file */
  lastOpenEditor?: string;
  
  /** Last proposed artifact */
  lastArtifactProposed?: {
    type: 'diff' | 'plan' | 'checkpoint';
    files?: string[];
    timestamp: string;
  };
  
  /** Recent events for context */
  recentEvents?: Event[];
  
  /** Previous task ID (for follow-up detection) */
  previousTaskId?: string;
}

// ============================================================================
// MAIN INTENT ANALYZER
// ============================================================================

/**
 * Analyze user intent and determine behavior
 * 
 * This is the core function of Step 33. It implements the behavior selection
 * algorithm defined in the spec.
 * 
 * @param prompt - User's input prompt
 * @param context - Analysis context with state information
 * @returns IntentAnalysis with selected behavior and reasoning
 */
export function analyzeIntent(
  prompt: string,
  context: IntentAnalysisContext = { clarificationAttempts: 0 }
): IntentAnalysis {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const originalPrompt = prompt.trim();
  
  // =========================================================================
  // STEP 0: Check for user override commands
  // =========================================================================
  const overrideResult = checkUserOverride(originalPrompt);
  if (overrideResult) {
    return createIntentAnalysis(
      overrideResult.behavior,
      { type: 'fresh' },
      1.0,
      `User override: ${overrideResult.command}`,
      overrideResult.command
    );
  }
  
  // =========================================================================
  // STEP 0.5: Check for command intent (Step 34.5 integration)
  // Commands should be detected early, before active run check
  // =========================================================================
  const commandDetection = detectCommandIntent(originalPrompt);
  if (commandDetection.isCommandIntent && commandDetection.confidence >= 0.75) {
    // This is a command request, not a continue-run request
    const keywords = commandDetection.detectedKeywords?.join(', ') || 'command execution';
    return createIntentAnalysis(
      'QUICK_ACTION',
      { type: 'fresh' },
      commandDetection.confidence,
      `Command intent detected: ${keywords}`,
      undefined,
      undefined,
      'small', // Commands are typically small scope
      commandDetection.inferredCommands
    );
  }
  
  // =========================================================================
  // STEP 1: Is there an active run? → CONTINUE_RUN
  // Only if NOT a command intent
  // =========================================================================
  if (context.activeRun) {
    return createIntentAnalysis(
      'CONTINUE_RUN',
      { type: 'follow_up', previous_task_id: context.activeRun.task_id },
      0.95,
      `Active ${context.activeRun.status} run detected (stage: ${context.activeRun.stage})`
    );
  }
  
  // =========================================================================
  // STEP 2: Is this a pure question? → ANSWER
  // =========================================================================
  if (isPureQuestion(normalizedPrompt)) {
    return createIntentAnalysis(
      'ANSWER',
      { type: 'fresh' },
      0.85,
      'Detected as pure question/explanation request'
    );
  }
  
  // =========================================================================
  // STEP 3: Resolve references ("this", "it")
  // =========================================================================
  const referenceResult = resolveReferences(originalPrompt, context);

  // =========================================================================
  // STEP 3.5: Score intent signals (keywords + structure + context)
  // =========================================================================
  const intentSignals = scoreIntentSignals(originalPrompt, referenceResult, context);
  
  // =========================================================================
  // STEP 4: Check for missing information → CLARIFY
  // =========================================================================
  const completenessResult = checkCompleteness(
    originalPrompt,
    referenceResult,
    context,
    intentSignals
  );
  
  if (!completenessResult.complete && context.clarificationAttempts < CONFIG.maxClarificationAttempts) {
    return createIntentAnalysis(
      'CLARIFY',
      { type: referenceResult.resolved ? 'follow_up' : 'fresh' },
      0.7,
      completenessResult.reason,
      undefined,
      completenessResult.clarification
    );
  }

  // =========================================================================
  // STEP 4.5: Resolve proposal/explain intent
  // =========================================================================
  if (intentSignals.preferred === 'ANSWER') {
    return createIntentAnalysis(
      'ANSWER',
      { type: referenceResult.resolved ? 'follow_up' : 'fresh' },
      intentSignals.confidence,
      `Intent signals prefer explanation (${intentSignals.evidence.join(', ')})`
    );
  }

  if (intentSignals.preferred === 'PLAN') {
    return createIntentAnalysis(
      'PLAN',
      { type: referenceResult.resolved ? 'follow_up' : 'fresh', files: referenceResult.files },
      intentSignals.confidence,
      `Intent signals prefer proposal/plan (${intentSignals.evidence.join(', ')})`,
      undefined,
      undefined,
      undefined,
      referenceResult.files
    );
  }
  
  // =========================================================================
  // STEP 5: Determine scope → QUICK_ACTION vs PLAN
  // =========================================================================
  const scopeResult = detectScope(originalPrompt, referenceResult, context);
  
  // Extract referenced files
  const referencedFiles = extractReferencedFiles(originalPrompt);
  if (referenceResult.files) {
    referencedFiles.push(...referenceResult.files);
  }
  
  // Default bias: small → QUICK_ACTION (per spec)
  if (scopeResult.scope === 'trivial' || scopeResult.scope === 'small') {
    return createIntentAnalysis(
      'QUICK_ACTION',
      { 
        type: referenceResult.resolved ? 'follow_up' : 'fresh',
        files: [...new Set(referencedFiles)],
      },
      scopeResult.confidence,
      `Scope: ${scopeResult.scope} (${scopeResult.reasons.join(', ')})`,
      undefined,
      undefined,
      scopeResult.scope,
      [...new Set(referencedFiles)]
    );
  }
  
  // Medium/large → PLAN
  return createIntentAnalysis(
    'PLAN',
    {
      type: referenceResult.resolved ? 'follow_up' : 'fresh',
      files: [...new Set(referencedFiles)],
    },
    scopeResult.confidence,
    `Scope: ${scopeResult.scope} (${scopeResult.reasons.join(', ')})`,
    undefined,
    undefined,
    scopeResult.scope,
    [...new Set(referencedFiles)]
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check for user override commands
 */
function checkUserOverride(prompt: string): { behavior: Behavior; command: string } | null {
  const firstWord = prompt.split(/\s+/)[0]?.toLowerCase();
  
  for (const [command, behavior] of Object.entries(USER_OVERRIDES)) {
    if (firstWord === command || firstWord === command.slice(1)) {
      return { behavior, command };
    }
  }
  
  return null;
}

/**
 * Check if the prompt is a pure question (ANSWER behavior)
 */
function isPureQuestion(normalizedPrompt: string): boolean {
  // Check if it ends with ?
  const endsWithQuestion = normalizedPrompt.endsWith('?');
  
  // Check for question starters
  const hasQuestionStarter = QUESTION_PATTERNS.starters.some(
    starter => normalizedPrompt.startsWith(starter)
  );
  
  // Check for action-like question phrases (these are NOT pure questions)
  const hasActionQuestion = QUESTION_PATTERNS.actionQuestionPhrases.some(
    phrase => normalizedPrompt.includes(phrase)
  );
  
  // Check for action verbs that indicate work
  const hasActionVerb = [
    ...ACTION_PATTERNS.smallVerbs,
    ...ACTION_PATTERNS.largeVerbs,
  ].some(verb => {
    const regex = new RegExp(`\\b${verb}\\b`, 'i');
    return regex.test(normalizedPrompt);
  });
  
  // Pure question: has question form AND no action intent
  if (hasActionQuestion || hasActionVerb) {
    return false;
  }
  
  return endsWithQuestion || hasQuestionStarter;
}

/**
 * Resolve ambiguous references ("this", "it", etc.)
 */
function resolveReferences(
  prompt: string,
  context: IntentAnalysisContext
): ReferenceResolution {
  // Check if prompt has ambiguous references
  const hasAmbiguousRef = REFERENCE_PATTERNS.some(pattern => pattern.test(prompt));
  
  if (!hasAmbiguousRef) {
    // No ambiguous references, check for explicit file references
    const files = extractReferencedFiles(prompt);
    return {
      resolved: files.length > 0,
      files: files.length > 0 ? files : undefined,
    };
  }
  
  // Priority resolution (per spec):
  // 1. last_applied_diff
  // 2. last_open_editor
  // 3. last_artifact_proposed
  // 4. else → ambiguous
  
  if (context.lastAppliedDiff?.files.length) {
    return {
      resolved: true,
      source: 'last_applied_diff',
      files: context.lastAppliedDiff.files,
      context: `Recently applied diff to: ${context.lastAppliedDiff.files.join(', ')}`,
    };
  }
  
  if (context.lastOpenEditor) {
    return {
      resolved: true,
      source: 'last_open_editor',
      files: [context.lastOpenEditor],
      context: `Currently open: ${context.lastOpenEditor}`,
    };
  }
  
  if (context.lastArtifactProposed?.files?.length) {
    return {
      resolved: true,
      source: 'last_artifact_proposed',
      files: context.lastArtifactProposed.files,
      context: `Last ${context.lastArtifactProposed.type}: ${context.lastArtifactProposed.files.join(', ')}`,
    };
  }
  
  // Could not resolve
  return {
    resolved: false,
  };
}

/**
 * Check if the prompt has enough information to proceed
 */
function checkCompleteness(
  prompt: string,
  referenceResult: ReferenceResolution,
  context: IntentAnalysisContext,
  intentSignals?: IntentSignalScores
): { complete: boolean; reason: string; clarification?: ClarificationRequest } {
  const normalizedPrompt = prompt.toLowerCase();
  
  // Check 0: Conflicting intent (explain vs action)
  if (intentSignals?.conflict && context.clarificationAttempts < CONFIG.maxClarificationAttempts) {
    return {
      complete: false,
      reason: 'Conflicting intent signals',
      clarification: {
        question: 'Do you want a fix, an explanation, or a plan?',
        options: [
          { label: 'Explain only', action: 'confirm_intent', value: 'ANSWER' },
          { label: 'Make a quick fix', action: 'confirm_intent', value: 'QUICK_ACTION' },
          { label: 'Create a plan', action: 'confirm_intent', value: 'PLAN' },
          { label: 'Cancel', action: 'cancel' },
        ],
      },
    };
  }
  
  // Check 1: Unresolved references
  if (!referenceResult.resolved && REFERENCE_PATTERNS.some(p => p.test(prompt))) {
    const options: ClarificationOption[] = [];
    if (context.lastOpenEditor) {
      options.push({ label: 'Currently open file', action: 'provide_file', value: context.lastOpenEditor });
    }
    options.push({ label: 'Specify file path', action: 'provide_file' });
    options.push({ label: 'Cancel', action: 'cancel' });
    
    return {
      complete: false,
      reason: 'Ambiguous reference detected',
      clarification: {
        question: 'What file or component are you referring to?',
        options,
      },
    };
  }
  
  // Check 2: Vague scope without file context
  const vagueScopePatterns = [
    'improve', 'enhance', 'optimize', 'update', 'change', 'modify',
  ];
  const hasVagueScope = vagueScopePatterns.some(p => normalizedPrompt.includes(p));
  const hasNoFileContext = extractReferencedFiles(prompt).length === 0 && !referenceResult.files?.length;
  
  if (hasVagueScope && hasNoFileContext) {
    return {
      complete: false,
      reason: 'Unclear scope - no specific file or component mentioned',
      clarification: {
        question: 'Which file(s) or component(s) should be modified?',
        options: [
          { label: 'Currently open file', action: 'provide_file', value: context.lastOpenEditor },
          { label: 'Specify file(s)', action: 'provide_file' },
          { label: 'Apply to entire project', action: 'provide_scope', value: 'project' },
          { label: 'Cancel', action: 'cancel' },
        ],
      },
    };
  }
  
  // Check 3: Ambiguous intent
  const ambiguousPatterns = [
    'not sure', 'maybe', 'possibly', 'might want', 'could you',
    'what do you think', 'best way to', 'should i',
  ];
  const hasAmbiguousIntent = ambiguousPatterns.some(p => normalizedPrompt.includes(p));
  
  // Only clarify ambiguous intent if max attempts not reached
  if (hasAmbiguousIntent && context.clarificationAttempts === 0) {
    return {
      complete: false,
      reason: 'Ambiguous intent - unclear if action is requested',
      clarification: {
        question: 'What would you like me to do?',
        options: [
          { label: 'Just explain/discuss', action: 'confirm_intent', value: 'ANSWER' },
          { label: 'Make a small change', action: 'confirm_intent', value: 'QUICK_ACTION' },
          { label: 'Create a full plan', action: 'confirm_intent', value: 'PLAN' },
          { label: 'Cancel', action: 'cancel' },
        ],
      },
    };
  }
  
  return { complete: true, reason: 'Prompt is complete' };
}

/**
 * Score intent signals (keywords + structure + context)
 */
type IntentSignalScores = {
  action: number;
  explain: number;
  plan: number;
  evidence: string[];
  preferred?: 'ANSWER' | 'PLAN';
  confidence: number;
  conflict: boolean;
};

function scoreIntentSignals(
  prompt: string,
  referenceResult: ReferenceResolution,
  context: IntentAnalysisContext
): IntentSignalScores {
  const normalizedPrompt = prompt.toLowerCase();
  const evidence: string[] = [];
  let action = 0;
  let explain = 0;
  let plan = 0;
  
  // Keyword signals
  if (EXPLAIN_PATTERNS.some(p => normalizedPrompt.includes(p))) {
    explain += 4;
    evidence.push('explain_keywords');
  }
  if (PLAN_PATTERNS.some(p => normalizedPrompt.includes(p))) {
    plan += 6;
    evidence.push('plan_keywords');
  }
  
  const hasActionVerb = [
    ...ACTION_PATTERNS.trivialVerbs,
    ...ACTION_PATTERNS.smallVerbs,
    ...ACTION_PATTERNS.largeVerbs,
  ].some(v => new RegExp(`\\b${v}\\b`, 'i').test(normalizedPrompt));
  if (hasActionVerb) {
    action += 3;
    evidence.push('action_verbs');
  }
  
  // Structural signals
  const hasStructure = STRUCTURE_PATTERNS.some(p => p.test(prompt));
  if (hasStructure) {
    action += 2;
    evidence.push('structure_signal');
  }
  
  const explicitFiles = extractReferencedFiles(prompt);
  if (explicitFiles.length > 0) {
    action += 2;
    evidence.push('file_reference');
  }
  
  // Context signals
  if (referenceResult.files?.length) {
    action += 1;
    evidence.push('resolved_reference');
  }
  if (context.lastOpenEditor) {
    action += 1;
    evidence.push('open_editor');
  }
  
  const top = Math.max(action, explain, plan);
  const scores = [action, explain, plan].sort((a, b) => b - a);
  const second = scores[1] || 0;
  const gap = top - second;
  const confidence = Math.min(0.95, 0.4 + (top * 0.1) + (gap * 0.05));
  
  const explainDominant = explain >= action + 2 && explain >= plan + 1;
  const planDominant = plan >= action + 1 && plan >= explain + 1;
  const conflict = !explainDominant && !planDominant && top >= 3 && second >= 3 && gap <= 1;
  
  let preferred: IntentSignalScores['preferred'];
  if (!conflict && top >= 4) {
    if (explainDominant) {
      preferred = 'ANSWER';
    } else if (planDominant) {
      preferred = 'PLAN';
    }
  }
  
  return {
    action,
    explain,
    plan,
    evidence,
    preferred,
    confidence,
    conflict,
  };
}

/**
 * Detect scope of the requested work
 */
function detectScope(
  prompt: string,
  referenceResult: ReferenceResolution,
  context: IntentAnalysisContext
): ScopeDetectionResult {
  const normalizedPrompt = prompt.toLowerCase();
  const reasons: string[] = [];
  let complexityScore = 0;
  
  // Check for trivial patterns
  if (ACTION_PATTERNS.trivialVerbs.some(v => normalizedPrompt.includes(v))) {
    reasons.push('trivial action verb detected');
    return {
      scope: 'trivial',
      confidence: 0.9,
      reasons,
      metrics: {
        estimated_files: 1,
        complexity_score: 0,
        has_dependencies: false,
      },
    };
  }
  
  // Check for greenfield patterns → large
  if (ACTION_PATTERNS.greenFieldPhrases.some(p => normalizedPrompt.includes(p))) {
    reasons.push('greenfield project detected');
    return {
      scope: 'large',
      confidence: 0.95,
      reasons,
      metrics: {
        estimated_files: 20,
        complexity_score: 80,
        has_dependencies: true,
      },
    };
  }
  
  // Check for large verbs
  const largeVerbCount = ACTION_PATTERNS.largeVerbs.filter(v => 
    new RegExp(`\\b${v}\\b`, 'i').test(normalizedPrompt)
  ).length;
  if (largeVerbCount > 0) {
    complexityScore += largeVerbCount * 20;
    reasons.push(`${largeVerbCount} large scope verb(s)`);
  }
  
  // Check for small verbs
  const smallVerbCount = ACTION_PATTERNS.smallVerbs.filter(v =>
    new RegExp(`\\b${v}\\b`, 'i').test(normalizedPrompt)
  ).length;
  if (smallVerbCount > 0) {
    complexityScore += smallVerbCount * 5;
    reasons.push(`${smallVerbCount} action verb(s)`);
  }
  
  // Estimate files from explicit references
  const explicitFiles = extractReferencedFiles(prompt);
  const resolvedFiles = referenceResult.files || [];
  const estimatedFiles = Math.max(explicitFiles.length, resolvedFiles.length, 1);
  
  if (estimatedFiles === 1) {
    reasons.push('single file scope');
  } else if (estimatedFiles <= CONFIG.smallScope) {
    complexityScore += estimatedFiles * 5;
    reasons.push(`${estimatedFiles} files referenced`);
  } else {
    complexityScore += estimatedFiles * 10;
    reasons.push(`${estimatedFiles} files referenced`);
  }
  
  // Check for multi-step indicators
  const multiStepPatterns = [
    'then', 'after that', 'next', 'finally', 'first', 'second', 'third',
    'multiple', 'several', 'all', 'each', 'every',
  ];
  const hasMultiStep = multiStepPatterns.some(p => normalizedPrompt.includes(p));
  if (hasMultiStep) {
    complexityScore += 15;
    reasons.push('multi-step indicators');
  }
  
  // Check for dependency indicators
  const dependencyPatterns = [
    'database', 'api', 'backend', 'frontend', 'auth', 'payment',
    'integration', 'migrate', 'schema', 'config',
  ];
  const hasDependencies = dependencyPatterns.some(p => normalizedPrompt.includes(p));
  if (hasDependencies) {
    complexityScore += 20;
    reasons.push('system dependency indicators');
  }
  
  // Determine scope from complexity score
  let scope: ScopeDetectionResult['scope'];
  let confidence: number;
  
  if (complexityScore <= 10) {
    scope = 'trivial';
    confidence = 0.8;
  } else if (complexityScore <= 25) {
    scope = 'small';
    confidence = 0.75;
  } else if (complexityScore <= 50) {
    scope = 'medium';
    confidence = 0.7;
  } else {
    scope = 'large';
    confidence = 0.65;
  }
  
  return {
    scope,
    confidence,
    reasons,
    metrics: {
      estimated_files: estimatedFiles,
      complexity_score: complexityScore,
      has_dependencies: hasDependencies,
    },
  };
}

/**
 * Extract file references from prompt
 */
function extractReferencedFiles(prompt: string): string[] {
  const files: string[] = [];
  
  for (const pattern of FILE_PATTERNS) {
    const matches = prompt.match(pattern);
    if (matches) {
      for (const match of matches) {
        const cleanedPath = match.trim().replace(/[,:;]$/, '');
        if (cleanedPath && !files.includes(cleanedPath)) {
          files.push(cleanedPath);
        }
      }
    }
  }
  
  return files;
}

/**
 * Create IntentAnalysis result
 */
function createIntentAnalysis(
  behavior: Behavior,
  contextSource: ContextSource,
  confidence: number,
  reasoning: string,
  userOverride?: string,
  clarification?: ClarificationRequest,
  detectedScope?: 'trivial' | 'small' | 'medium' | 'large',
  referencedFiles?: string[]
): IntentAnalysis {
  // Derive mode from behavior
  let derivedMode: Mode;
  switch (behavior) {
    case 'ANSWER':
    case 'CLARIFY':
      derivedMode = 'ANSWER';
      break;
    case 'QUICK_ACTION':
      derivedMode = 'MISSION';
      break;
    case 'PLAN':
      derivedMode = 'PLAN';
      break;
    case 'CONTINUE_RUN':
      derivedMode = 'MISSION';
      break;
    default:
      derivedMode = 'ANSWER';
  }
  
  return {
    behavior,
    context_source: contextSource,
    clarification,
    confidence,
    reasoning,
    derived_mode: derivedMode,
    detected_scope: detectedScope,
    referenced_files: referencedFiles,
    user_override: userOverride,
  };
}

// ============================================================================
// ACTIVE RUN DETECTION
// ============================================================================

/**
 * Detect if there's an active run from events
 * 
 * ULTRA-CONSERVATIVE: Only treat as active if there's CLEAR blocking state
 * 1. Must have approval_requested waiting for resolution
 * 2. OR decision_point_needed waiting for user
 * 3. Everything else (including old paused states) = NO active run
 * 
 * This fixes false positives where leftover state incorrectly triggers CONTINUE_RUN
 * 
 * CRITICAL FIX: command_completed is a TERMINAL event for command-only tasks.
 * After a terminal command is started, the task is DONE.
 */
export function detectActiveRun(events: Event[]): ActiveRunStatus | null {
  if (!events.length) return null;
  
  // STEP 1: Find terminal events (final, mission_completed, mission_cancelled, command_completed)
  // command_completed is terminal because once we've sent the command to the terminal, we're done
  const terminalEvents = events.filter(e =>
    ['final', 'mission_completed', 'mission_cancelled', 'command_completed', 'command_skipped'].includes(e.type)
  );
  
  // Get the most recent terminal event timestamp
  const latestTerminalTime = terminalEvents.length > 0
    ? Math.max(...terminalEvents.map(e => new Date(e.timestamp).getTime()))
    : 0;
  
  // STEP 2: Find unresolved approval requests (BLOCKING state)
  const approvalRequests = events.filter(e =>
    e.type === 'approval_requested' &&
    new Date(e.timestamp).getTime() > latestTerminalTime
  );
  
  for (const approval of approvalRequests) {
    const approvalId = approval.payload.approval_id as string;
    
    // Check if this approval has been resolved
    const resolved = events.some(e =>
      e.type === 'approval_resolved' &&
      e.payload.approval_id === approvalId &&
      new Date(e.timestamp).getTime() > new Date(approval.timestamp).getTime()
    );
    
    if (!resolved) {
      // Found an unresolved approval - this IS an active run
      return {
        task_id: approval.task_id,
        mission_id: approval.payload.mission_id as string,
        stage: approval.stage,
        status: 'awaiting_approval',
        started_at: approval.timestamp,
        last_event_at: approval.timestamp,
      };
    }
  }
  
  // STEP 3: Find unhandled decision points (BLOCKING state)
  const decisionEvents = events.filter(e =>
    e.type === 'decision_point_needed' &&
    new Date(e.timestamp).getTime() > latestTerminalTime
  );
  
  for (const decision of decisionEvents) {
    // Check if this decision context is 'continue_run' (old state pattern) - skip it
    const context = decision.payload.context || decision.payload.decision_type;
    if (context === 'continue_run' || context === 'awaiting_continue_decision') {
      continue; // Skip old continue_run decision points
    }
    
    // If we get here, this is a real blocking decision point
    return {
      task_id: decision.task_id,
      mission_id: decision.payload.mission_id as string,
      stage: decision.stage,
      status: 'awaiting_approval',
      started_at: decision.timestamp,
      last_event_at: decision.timestamp,
    };
  }
  
  // STEP 4: Everything else = NO active run
  // This includes:
  // - Old execution_paused states
  // - mission_started without clear blocking state
  // - awaiting_continue_decision (old state)
  // - awaiting_mission_start (user needs to click button)
  
  return null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  CONFIG as INTENT_ANALYZER_CONFIG,
  USER_OVERRIDES,
  isPureQuestion,
  resolveReferences,
  checkCompleteness,
  detectScope,
  extractReferencedFiles,
};
