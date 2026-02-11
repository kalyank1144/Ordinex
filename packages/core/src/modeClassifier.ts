/**
 * Mode Classifier V2: Deterministic Heuristic Classification
 * 
 * SCORING PRECEDENCE:
 * 1. Action verbs + conversational phrases → MISSION (high priority)
 * 2. Planning/contract terms without immediate action → PLAN
 * 3. File/error references → MISSION boost (unless planning context)
 * 4. Question form → ANSWER (low priority, can be overridden by action intent)
 * 
 * CONFIDENCE RULES:
 * - maxScore < 2.0 → low
 * - delta < 1.0 → low (too close/ambiguous)
 * - delta < 2.0 → medium
 * - else → high
 * 
 * NO LLM CALLS. Deterministic. Fast (<1ms).
 * 
 * TUNING: Adjust WEIGHTS constants below to change behavior.
 */

import { Mode, ReasonTag, ClassificationResultV2 } from './types';

/**
 * Scoring weights (TUNABLE)
 * Increase values to prioritize that mode more strongly
 */
const WEIGHTS = {
  // MISSION boosters
  ACTION_VERB: 3.0,              // Strong MISSION signal: "add", "fix", "implement"
  CONVERSATIONAL_ACTION: 2.5,    // "Let's add X", "Can you help me fix Y"
  FILE_REFERENCE: 2.0,           // src/foo.ts, packages/bar.js
  ERROR_REFERENCE: 1.5,          // "error", "failing", "TypeError"
  
  // PLAN boosters
  PLANNING_TERMS: 2.5,           // "plan", "roadmap", "strategy"
  PLANNING_WITH_FILE: 1.0,       // "Plan how to fix src/..." (bonus to PLAN)
  
  // ANSWER boosters
  QUESTION_FORM: 3.0,            // "What is...?", "How does..."
  
  // Modifiers
  ACTION_OVERRIDES_QUESTION: true // "Can you add X?" → MISSION despite "?"
};

/**
 * Keyword patterns (TUNABLE)
 * Add keywords to expand recognition
 */
const PATTERNS = {
  ACTION_VERBS: [
    'add', 'implement', 'fix', 'refactor', 'create', 'migrate',
    'setup', 'build', 'remove', 'rename', 'upgrade', 'optimize',
    'debug', 'write', 'develop', 'make', 'repair', 'resolve',
    'correct', 'update', 'modify', 'change', 'edit', 'delete',
    'clean', 'install', 'configure'
  ],
  
  CONVERSATIONAL_STARTERS: [
    "let's", "lets", "i need to", "can we", "help me",
    "please", "could you", "can you", "would you"
  ],
  
  PLANNING_TERMS: [
    'plan', 'roadmap', 'outline', 'strategy', 'approach', 'design',
    'architecture', 'proposal', 'next steps', 'milestones', 'phases',
    'breakdown', 'steps', 'scope', 'spec', 'blueprint'
  ],
  
  QUESTION_STARTERS: [
    'what is', 'what are', 'what does', 'what do',
    'why is', 'why are', 'why does', 'why do',
    'how is', 'how are', 'how does', 'how do', 'how can', 'how to',
    'explain', 'describe', 'tell me'
  ],
  
  FILE_PATH_INDICATORS: [
    'src/', 'packages/', 'apps/', 'lib/', 'test/', 'tests/', 'spec/',
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.cpp', '.c', '.h'
  ],
  
  ERROR_INDICATORS: [
    'error', 'fails', 'failing', 'failed', 'stack trace', 'traceback',
    'typeerror', 'referenceerror', 'syntaxerror', 'exception',
    'exit code', 'crash', 'bug'
  ]
};

/**
 * Feature extraction result
 */
interface Features {
  hasActionVerbs: boolean;
  hasConversationalAction: boolean;
  hasPlanningTerms: boolean;
  hasQuestionForm: boolean;
  hasFileReference: boolean;
  hasErrorReference: boolean;
  tags: ReasonTag[];
}

/**
 * Backward compatible result (for existing callers)
 */
export interface ClassificationResult {
  suggestedMode: Mode;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

/**
 * Normalize prompt for consistent matching
 */
function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Extract features from normalized prompt
 * Returns boolean flags and reason tags for transparency
 */
function extractFeatures(normalized: string): Features {
  const tags: ReasonTag[] = [];
  
  // 1. Check for question form
  const hasQuestionForm = 
    normalized.endsWith('?') ||
    PATTERNS.QUESTION_STARTERS.some(starter => normalized.startsWith(starter)) ||
    normalized.includes('what is ') ||
    normalized.includes('how to ');
  
  if (hasQuestionForm) {
    tags.push('question_form');
  }
  
  // 2. Check for action verbs
  const hasActionVerbs = PATTERNS.ACTION_VERBS.some(verb => {
    // Match as word boundary to avoid false positives
    const regex = new RegExp(`\\b${verb}\\b`, 'i');
    return regex.test(normalized);
  });
  
  if (hasActionVerbs) {
    tags.push('action_verbs');
  }
  
  // 3. Check for conversational action (starter + verb within proximity)
  let hasConversationalAction = false;
  for (const starter of PATTERNS.CONVERSATIONAL_STARTERS) {
    if (normalized.includes(starter)) {
      // Check if action verb appears within next 8 words
      const starterIndex = normalized.indexOf(starter);
      const fragment = normalized.slice(starterIndex, starterIndex + 80); // ~10-15 words
      
      if (PATTERNS.ACTION_VERBS.some(verb => {
        const regex = new RegExp(`\\b${verb}\\b`, 'i');
        return regex.test(fragment);
      })) {
        hasConversationalAction = true;
        tags.push('conversational_action');
        break;
      }
    }
  }
  
  // 4. Check for planning terms
  const hasPlanningTerms = PATTERNS.PLANNING_TERMS.some(term => 
    normalized.includes(term)
  );
  
  if (hasPlanningTerms) {
    tags.push('planning_terms');
  }
  
  // 5. Check for file references
  const hasFileReference = PATTERNS.FILE_PATH_INDICATORS.some(indicator =>
    normalized.includes(indicator)
  );
  
  if (hasFileReference) {
    tags.push('file_reference');
  }
  
  // 6. Check for error references
  const hasErrorReference = PATTERNS.ERROR_INDICATORS.some(indicator =>
    normalized.includes(indicator)
  );
  
  if (hasErrorReference) {
    tags.push('error_reference');
  }
  
  return {
    hasActionVerbs,
    hasConversationalAction,
    hasPlanningTerms,
    hasQuestionForm,
    hasFileReference,
    hasErrorReference,
    tags
  };
}

/**
 * Compute scores for each mode based on extracted features
 */
function computeScores(features: Features): {
  answer: number;
  plan: number;
  mission: number;
} {
  let answerScore = 0;
  let planScore = 0;
  let missionScore = 0;
  
  // ANSWER scoring
  if (features.hasQuestionForm) {
    answerScore += WEIGHTS.QUESTION_FORM;
  }
  
  // MISSION scoring
  if (features.hasActionVerbs) {
    missionScore += WEIGHTS.ACTION_VERB;
  }
  
  if (features.hasConversationalAction) {
    missionScore += WEIGHTS.CONVERSATIONAL_ACTION;
  }
  
  if (features.hasFileReference) {
    missionScore += WEIGHTS.FILE_REFERENCE;
  }
  
  if (features.hasErrorReference) {
    missionScore += WEIGHTS.ERROR_REFERENCE;
  }
  
  // PLAN scoring
  if (features.hasPlanningTerms) {
    planScore += WEIGHTS.PLANNING_TERMS;
    
    // Bonus: Planning + file reference = "plan how to fix X"
    if (features.hasFileReference) {
      planScore += WEIGHTS.PLANNING_WITH_FILE;
    }
  }
  
  // ACTION OVERRIDES QUESTION rule
  // "Can you help me add X?" → MISSION despite question form
  if (WEIGHTS.ACTION_OVERRIDES_QUESTION) {
    if (features.hasQuestionForm && (features.hasActionVerbs || features.hasConversationalAction)) {
      // Reduce ANSWER score when action intent present
      answerScore *= 0.5;
    }
  }
  
  return { answer: answerScore, plan: planScore, mission: missionScore };
}

/**
 * Determine confidence level based on scores
 */
function determineConfidence(scores: {
  answer: number;
  plan: number;
  mission: number;
}): 'high' | 'medium' | 'low' {
  const maxScore = Math.max(scores.answer, scores.plan, scores.mission);
  
  // Sort to get second highest
  const sortedScores = [scores.answer, scores.plan, scores.mission].sort((a, b) => b - a);
  const secondScore = sortedScores[1];
  const delta = maxScore - secondScore;
  
  // Low confidence if max score too low or scores too close
  if (maxScore < 2.0) {
    return 'low';
  }
  
  if (delta < 1.0) {
    return 'low'; // Ambiguous
  }
  
  if (delta < 2.0) {
    return 'medium';
  }
  
  return 'high';
}

/**
 * Main export: Classify prompt with full V2 result
 */
export function classifyPromptV2(prompt: string): ClassificationResultV2 {
  const normalized = normalizePrompt(prompt);
  const features = extractFeatures(normalized);
  const scores = computeScores(features);
  const confidence = determineConfidence(scores);
  
  // Determine winner
  const maxScore = Math.max(scores.answer, scores.plan, scores.mission);
  let suggestedMode: Mode;
  
  if (scores.mission === maxScore) {
    suggestedMode = 'MISSION';
  } else if (scores.plan === maxScore) {
    suggestedMode = 'PLAN';
  } else {
    suggestedMode = 'ANSWER';
  }
  
  // Generate stable reasonSignature for caching
  const sortedTags = [...features.tags].sort();
  const reasonSignature = sortedTags.length > 0
    ? `${sortedTags.join(',')}→${suggestedMode}`
    : `no_tags→${suggestedMode}`;
  
  return {
    suggestedMode,
    confidence,
    reasonTags: features.tags,
    scores,
    reasonSignature
  };
}

/**
 * Backward compatible wrapper (for existing callers)
 * Returns simplified ClassificationResult
 */
export function classifyPrompt(prompt: string): ClassificationResult {
  const v2 = classifyPromptV2(prompt);
  
  return {
    suggestedMode: v2.suggestedMode,
    confidence: v2.confidence,
    reasoning: v2.reasonTags.length > 0
      ? `Detected: ${v2.reasonTags.join(', ')}`
      : 'No clear indicators detected'
  };
}

/**
 * DEPRECATED: Old shouldRequireConfirmation function
 * Kept for backward compatibility but confirmation logic should move to caller
 * 
 * @deprecated Use ModeConfirmationPolicy instead
 */
export function shouldRequireConfirmation(
  userSelectedMode: Mode,
  suggestedMode: Mode,
  confidence: 'high' | 'medium' | 'low'
): boolean {
  // No confirmation needed if modes match
  if (userSelectedMode === suggestedMode) {
    return false;
  }

  // IMPORTANT: Never require confirmation for ANSWER mode
  // ANSWER mode is read-only (no file changes), so it's always safe to proceed
  if (userSelectedMode === 'ANSWER') {
    return false;
  }

  // IMPORTANT: Never require confirmation for PLAN mode
  // PLAN mode is also read-only (no file changes, just generates a plan)
  // User explicitly selected PLAN mode, trust their choice
  if (userSelectedMode === 'PLAN') {
    return false;
  }

  // If confidence is low, don't require confirmation (let user's choice stand)
  if (confidence === 'low') {
    return false;
  }

  // At this point, only MISSION mode can reach here (ANSWER and PLAN return early)
  // If confidence is high and user selected MISSION but classifier suggests PLAN, require confirmation
  if (confidence === 'high' && suggestedMode === 'PLAN') {
    return true;
  }

  // Medium confidence with mode mismatch - require confirmation for MISSION → other modes
  if (confidence === 'medium' && suggestedMode !== 'MISSION') {
    return true;
  }

  return false;
}
