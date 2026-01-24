/**
 * Large Plan Detector: Composite scoring model for detecting plans too large to execute safely
 * 
 * Step 26 - Anti-Failure Guard (Enterprise-Grade)
 * 
 * This module determines whether a plan requires mission breakdown before execution.
 * It uses structural heuristics PLUS LLM-provided planMeta for intelligent detection.
 * 
 * Core Design Principle:
 * - PLAN = intelligence (LLM provides planMeta)
 * - Step 26 = validation (deterministic, explainable)
 * - planMeta can INCREASE detection confidence, but NEVER suppress safety checks
 */

import { PlanMeta } from './types';

// Configurable thresholds - easy to tune
export const LARGE_PLAN_CONFIG = {
  // Score thresholds
  scoreLargeThreshold: 60, // score >= 60 = large plan
  
  // Step count thresholds
  stepCountWarn: 10,  // >= 10 steps = warning
  stepCountLarge: 16, // >= 16 steps = definitely large
  
  // File touch estimation (per step verb category)
  fileTouchEstimates: {
    small: 2,   // simple: read, review, analyze, update
    medium: 5,  // moderate: add, create, implement, write
    large: 10,  // complex: refactor, migrate, integrate, rewrite
  },
  
  // Score weights
  weights: {
    stepCount: 3,          // points per step over threshold
    riskFlag: 10,          // points per risk flag
    bigScopeKeyword: 5,    // points per big-scope keyword hit
    ambiguityFlag: 8,      // points per ambiguity phrase
    multiDomain: 12,       // points for multi-domain (mobile+web+backend)
    highFileTouch: 0.5,    // points per estimated file touch over 20
  },
  
  // Combined rule: riskFlags >= 2 AND stepCount >= 10
  riskFlagsForForce: 2,
  stepCountForRiskForce: 10,
};

// Big-scope keywords that indicate complex features
const BIG_SCOPE_KEYWORDS = [
  'auth', 'authentication', 'login', 'oauth', 'sso',
  'payments', 'payment', 'stripe', 'billing', 'subscription',
  'analytics', 'telemetry', 'tracking', 'metrics',
  'theming', 'theme', 'dark mode', 'styling system',
  'offline', 'sync', 'offline-first', 'caching',
  'i18n', 'internationalization', 'localization', 'translations',
  'ci/cd', 'cicd', 'deployment', 'deploy', 'pipeline',
  'database', 'db', 'schema', 'migration', 'orm',
  'backend', 'api', 'server', 'endpoints', 'rest', 'graphql',
  'refactor', 'restructure', 'rewrite', 'overhaul',
  'state management', 'redux', 'zustand', 'mobx',
  'permissions', 'rbac', 'authorization', 'roles',
  'push notifications', 'notifications', 'websocket',
];

// Risk flags - security/payments/migration/major refactor
const RISK_KEYWORDS = [
  // Security / Auth risk
  { keywords: ['auth', 'authentication', 'login', 'password', 'session', 'token', 'oauth', 'sso', 'security'], category: 'security' },
  // Payment risk
  { keywords: ['payment', 'stripe', 'billing', 'subscription', 'checkout', 'invoice'], category: 'payments' },
  // Data migration risk
  { keywords: ['migration', 'migrate', 'data migration', 'schema change', 'database migration'], category: 'migration' },
  // Major refactor risk
  { keywords: ['refactor', 'rewrite', 'restructure', 'overhaul', 'major upgrade', 'breaking change'], category: 'refactor' },
  // Framework upgrade risk
  { keywords: ['upgrade', 'major version', 'version bump', 'framework upgrade'], category: 'upgrade' },
];

// Ambiguity phrases that indicate unclear scope
const AMBIGUITY_PHRASES = [
  'complete app',
  'entire system',
  'full application',
  'choose best',
  'best approach',
  'full architecture',
  'production ready',
  'enterprise grade',
  'scalable solution',
  'comprehensive solution',
  'implement complete',
  'set up entire',
  'build entire',
  'design architecture',
];

// Domain keywords for multi-domain detection
const DOMAIN_KEYWORDS = {
  mobile: ['mobile', 'ios', 'android', 'react native', 'flutter', 'expo', 'native'],
  web: ['web', 'website', 'webapp', 'next', 'nextjs', 'react', 'vue', 'angular', 'browser'],
  backend: ['backend', 'server', 'api', 'database', 'endpoints', 'rest', 'graphql', 'node', 'express'],
};

// Verb categories for file touch estimation
const VERB_CATEGORIES = {
  small: ['read', 'review', 'analyze', 'check', 'verify', 'update', 'fix', 'tweak', 'adjust'],
  medium: ['add', 'create', 'implement', 'write', 'build', 'develop', 'set up', 'configure', 'install'],
  large: ['refactor', 'migrate', 'integrate', 'rewrite', 'restructure', 'overhaul', 'redesign', 'replace'],
};

/**
 * Detection result with transparent scoring
 */
export interface LargePlanDetectionResult {
  largePlan: boolean;
  score: number; // 0-100
  reasons: string[]; // User-readable reasons
  metrics: {
    stepCount: number;
    estimatedFileTouch: number;
    riskFlags: string[];
    ambiguityFlags: string[];
    keywordHits: string[];
    domains: string[];
  };
}

/**
 * Plan step for analysis
 */
export interface PlanStepForAnalysis {
  step_id: string;
  description: string;
  expected_evidence?: string[];
}

/**
 * Optional repository signals for enhanced detection
 */
export interface RepoSignals {
  fileCount?: number;
  hasTests?: boolean;
  frameworks?: string[];
  hasMobile?: boolean;
  hasWeb?: boolean;
  hasBackend?: boolean;
}

/**
 * Detect if a plan is too large to execute safely
 * 
 * Uses structural heuristics + planMeta (if available) for intelligent detection.
 * planMeta can INCREASE detection confidence but NEVER suppress safety checks.
 * 
 * @param planSteps - Structured plan steps
 * @param planText - Full plan text (goal + descriptions)
 * @param repoSignals - Optional repository signals
 * @param planMeta - Optional LLM-provided plan metadata (enterprise-grade detection)
 * @returns Detection result with score and reasons
 */
export function detectLargePlan(
  planSteps: PlanStepForAnalysis[],
  planText: string,
  repoSignals?: RepoSignals,
  planMeta?: PlanMeta
): LargePlanDetectionResult {
  const textLower = planText.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  // Metrics collection
  const stepCount = planSteps.length;
  const riskFlags: string[] = [];
  const ambiguityFlags: string[] = [];
  const keywordHits: string[] = [];
  const domains: string[] = [];

  // 1. Step count scoring
  if (stepCount >= LARGE_PLAN_CONFIG.stepCountLarge) {
    score += (stepCount - LARGE_PLAN_CONFIG.stepCountLarge + 1) * LARGE_PLAN_CONFIG.weights.stepCount;
    reasons.push(`Plan has ${stepCount} steps (threshold: ${LARGE_PLAN_CONFIG.stepCountLarge})`);
  } else if (stepCount >= LARGE_PLAN_CONFIG.stepCountWarn) {
    score += (stepCount - LARGE_PLAN_CONFIG.stepCountWarn) * LARGE_PLAN_CONFIG.weights.stepCount;
    reasons.push(`Plan has ${stepCount} steps (approaching large threshold)`);
  }

  // 2. Risk flags detection
  for (const riskDef of RISK_KEYWORDS) {
    for (const keyword of riskDef.keywords) {
      if (textLower.includes(keyword)) {
        if (!riskFlags.includes(riskDef.category)) {
          riskFlags.push(riskDef.category);
          score += LARGE_PLAN_CONFIG.weights.riskFlag;
        }
        break; // Only count category once
      }
    }
  }
  if (riskFlags.length > 0) {
    reasons.push(`Contains high-risk areas: ${riskFlags.join(', ')}`);
  }

  // 3. Big-scope keywords
  for (const keyword of BIG_SCOPE_KEYWORDS) {
    if (textLower.includes(keyword) && !keywordHits.includes(keyword)) {
      keywordHits.push(keyword);
      score += LARGE_PLAN_CONFIG.weights.bigScopeKeyword;
    }
  }
  if (keywordHits.length >= 3) {
    reasons.push(`Mentions multiple complex features: ${keywordHits.slice(0, 5).join(', ')}${keywordHits.length > 5 ? '...' : ''}`);
  }

  // 4. Ambiguity flags
  for (const phrase of AMBIGUITY_PHRASES) {
    if (textLower.includes(phrase)) {
      ambiguityFlags.push(phrase);
      score += LARGE_PLAN_CONFIG.weights.ambiguityFlag;
    }
  }
  if (ambiguityFlags.length > 0) {
    reasons.push(`Contains vague scope phrases: "${ambiguityFlags.slice(0, 2).join('", "')}"`);
  }

  // 5. Multi-domain detection
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const keyword of keywords) {
      if (textLower.includes(keyword)) {
        if (!domains.includes(domain)) {
          domains.push(domain);
        }
        break;
      }
    }
  }
  
  // Check repo signals for domain info too
  if (repoSignals) {
    if (repoSignals.hasMobile && !domains.includes('mobile')) domains.push('mobile');
    if (repoSignals.hasWeb && !domains.includes('web')) domains.push('web');
    if (repoSignals.hasBackend && !domains.includes('backend')) domains.push('backend');
  }

  if (domains.length >= 2) {
    score += LARGE_PLAN_CONFIG.weights.multiDomain;
    reasons.push(`Spans multiple domains: ${domains.join(' + ')}`);
  }

  // 6. Estimated file touch (from heuristics)
  let estimatedFileTouch = estimateFilesTouched(planSteps);
  if (estimatedFileTouch > 20) {
    score += (estimatedFileTouch - 20) * LARGE_PLAN_CONFIG.weights.highFileTouch;
    reasons.push(`Estimated to touch ~${estimatedFileTouch} files`);
  }

  // ======================================================================
  // 7. PLANMETA DETECTION (Enterprise-Grade - catches "sneaky" complex plans)
  // 
  // planMeta is LLM-provided advisory metadata. It can INCREASE detection
  // confidence but NEVER suppress safety checks (structural heuristics above).
  // ======================================================================
  if (planMeta) {
    // 7a. LLM's estimated file touch (more accurate than heuristics)
    if (typeof planMeta.estimatedFileTouch === 'number' && planMeta.estimatedFileTouch > 15) {
      const metaFileTouchScore = (planMeta.estimatedFileTouch - 15) * 1.5;
      score += metaFileTouchScore;
      reasons.push(`LLM estimates ${planMeta.estimatedFileTouch} files will be modified`);
      // Use LLM estimate if higher than heuristic
      if (planMeta.estimatedFileTouch > estimatedFileTouch) {
        estimatedFileTouch = planMeta.estimatedFileTouch;
      }
    }

    // 7b. LLM's estimated dev hours (catches hidden complexity)
    if (typeof planMeta.estimatedDevHours === 'number' && planMeta.estimatedDevHours > 8) {
      const devHoursScore = (planMeta.estimatedDevHours - 8) * 2;
      score += devHoursScore;
      reasons.push(`LLM estimates ${planMeta.estimatedDevHours}+ hours of dev work`);
    }

    // 7c. LLM's risk areas (catches domain-specific risks)
    if (planMeta.riskAreas && planMeta.riskAreas.length >= 2) {
      const llmRiskScore = planMeta.riskAreas.length * 8;
      score += llmRiskScore;
      // Add unique risks not already detected
      for (const area of planMeta.riskAreas) {
        if (!riskFlags.includes(area)) {
          riskFlags.push(area);
        }
      }
      reasons.push(`LLM identified risk areas: ${planMeta.riskAreas.join(', ')}`);
    }

    // 7d. LLM's domains (catches multi-domain plans)
    if (planMeta.domains && planMeta.domains.length >= 2) {
      // Add unique domains not already detected
      for (const domain of planMeta.domains) {
        if (!domains.includes(domain)) {
          domains.push(domain);
        }
      }
      if (planMeta.domains.length >= 3) {
        score += 10;
        reasons.push(`LLM indicates plan spans ${planMeta.domains.length} domains`);
      }
    }

    // 7e. LOW CONFIDENCE + moderate scope = force breakdown
    // This catches "4 steps but I'm not sure about scope" plans
    if (planMeta.confidence === 'low' && stepCount >= 5) {
      score += 20;
      reasons.push(`LLM has low confidence in plan scope (steps: ${stepCount})`);
    }
  }

  // Cap score at 100
  score = Math.min(100, Math.round(score));

  // Decision rules
  let largePlan = false;

  // Rule 1: score >= threshold
  if (score >= LARGE_PLAN_CONFIG.scoreLargeThreshold) {
    largePlan = true;
  }

  // Rule 2: stepCount >= 16 (hard threshold)
  if (stepCount >= LARGE_PLAN_CONFIG.stepCountLarge) {
    largePlan = true;
    if (!reasons.some(r => r.includes('steps'))) {
      reasons.push(`Plan has ${stepCount} steps (exceeds safe execution limit)`);
    }
  }

  // Rule 3: riskFlags >= 2 AND stepCount >= 10
  if (riskFlags.length >= LARGE_PLAN_CONFIG.riskFlagsForForce &&
      stepCount >= LARGE_PLAN_CONFIG.stepCountForRiskForce) {
    largePlan = true;
    if (!reasons.some(r => r.includes('high-risk'))) {
      reasons.push(`Multiple high-risk areas (${riskFlags.length}) with ${stepCount} steps`);
    }
  }

  // Add summary reason if large
  if (largePlan && reasons.length === 0) {
    reasons.push('Plan complexity exceeds safe single-execution threshold');
  }

  return {
    largePlan,
    score,
    reasons,
    metrics: {
      stepCount,
      estimatedFileTouch,
      riskFlags,
      ambiguityFlags,
      keywordHits,
      domains,
    },
  };
}

/**
 * Estimate number of files that will be touched based on step descriptions
 */
function estimateFilesTouched(steps: PlanStepForAnalysis[]): number {
  let total = 0;

  for (const step of steps) {
    const descLower = step.description.toLowerCase();
    let stepEstimate = LARGE_PLAN_CONFIG.fileTouchEstimates.small; // default

    // Check for large verbs first (highest priority)
    for (const verb of VERB_CATEGORIES.large) {
      if (descLower.includes(verb)) {
        stepEstimate = LARGE_PLAN_CONFIG.fileTouchEstimates.large;
        break;
      }
    }

    // Check for medium verbs if not already large
    if (stepEstimate !== LARGE_PLAN_CONFIG.fileTouchEstimates.large) {
      for (const verb of VERB_CATEGORIES.medium) {
        if (descLower.includes(verb)) {
          stepEstimate = LARGE_PLAN_CONFIG.fileTouchEstimates.medium;
          break;
        }
      }
    }

    total += stepEstimate;
  }

  return total;
}

/**
 * Build full plan text from goal and steps for analysis
 */
export function buildPlanTextForAnalysis(
  goal: string,
  steps: PlanStepForAnalysis[],
  assumptions?: string[],
  risks?: string[]
): string {
  const parts: string[] = [goal];
  
  for (const step of steps) {
    parts.push(step.description);
    if (step.expected_evidence) {
      parts.push(...step.expected_evidence);
    }
  }
  
  if (assumptions) {
    parts.push(...assumptions);
  }
  
  if (risks) {
    parts.push(...risks);
  }
  
  return parts.join(' ');
}
