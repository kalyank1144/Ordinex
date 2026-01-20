/**
 * Mode Classifier: Lightweight prompt classification
 * 
 * Determines the most appropriate mode (ANSWER/PLAN/MISSION) for a given prompt.
 * No LLM calls - uses simple heuristics.
 */

import { Mode } from './types';

export interface ClassificationResult {
  suggestedMode: Mode;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

/**
 * Classify a prompt to suggest the most appropriate mode
 */
export function classifyPrompt(prompt: string): ClassificationResult {
  const normalized = prompt.toLowerCase().trim();

  // Check for ANSWER indicators (questions, explanations)
  const answerPatterns = [
    /^what (is|are|does|do)/,
    /^why (is|are|does|do)/,
    /^how (is|are|does|do|can)/,
    /^explain/,
    /^describe/,
    /^tell me (about|how|what|why)/,
    /\?$/,
    /^can you explain/,
    /^could you explain/,
  ];

  // Check for MISSION indicators (build/create/implement actions)
  const missionPatterns = [
    /^(create|build|add|implement|write|develop|make)/,
    /^(fix|repair|debug|resolve|correct)/,
    /^(refactor|improve|optimize|enhance)/,
    /^(update|modify|change|edit)/,
    /^(remove|delete|clean)/,
    /^(install|setup|configure)/,
  ];

  // Check for PLAN indicators (planning without immediate action)
  const planPatterns = [
    /^(plan|design|architect|outline)/,
    /^how (should|would|could) (i|we)/,
    /^what (steps|approach|strategy)/,
    /help me (plan|design|think)/,
    /strategy for/,
  ];

  // Score each category
  let answerScore = 0;
  let missionScore = 0;
  let planScore = 0;

  for (const pattern of answerPatterns) {
    if (pattern.test(normalized)) {
      answerScore += 2;
    }
  }

  for (const pattern of missionPatterns) {
    if (pattern.test(normalized)) {
      missionScore += 3;
    }
  }

  for (const pattern of planPatterns) {
    if (pattern.test(normalized)) {
      planScore += 2;
    }
  }

  // Additional scoring based on keywords
  const answerKeywords = ['what', 'why', 'how', 'explain', 'describe', '?'];
  const missionKeywords = ['create', 'build', 'implement', 'fix', 'add', 'write', 'refactor'];
  const planKeywords = ['plan', 'design', 'strategy', 'approach', 'steps'];

  for (const keyword of answerKeywords) {
    if (normalized.includes(keyword)) answerScore += 0.5;
  }

  for (const keyword of missionKeywords) {
    if (normalized.includes(keyword)) missionScore += 1;
  }

  for (const keyword of planKeywords) {
    if (normalized.includes(keyword)) planScore += 1;
  }

  // Determine the winner
  const maxScore = Math.max(answerScore, missionScore, planScore);
  
  if (maxScore === 0) {
    // No clear indicators - default to ANSWER with low confidence
    return {
      suggestedMode: 'ANSWER',
      confidence: 'low',
      reasoning: 'No clear action indicators detected. Defaulting to ANSWER mode.',
    };
  }

  let suggestedMode: Mode;
  let confidence: 'high' | 'medium' | 'low';
  let reasoning: string;

  if (missionScore > answerScore && missionScore > planScore) {
    suggestedMode = 'MISSION';
    confidence = missionScore >= 3 ? 'high' : missionScore >= 2 ? 'medium' : 'low';
    reasoning = 'Detected action-oriented keywords suggesting implementation work.';
  } else if (planScore > answerScore) {
    suggestedMode = 'PLAN';
    confidence = planScore >= 2 ? 'high' : 'medium';
    reasoning = 'Detected planning/design keywords without immediate action intent.';
  } else {
    suggestedMode = 'ANSWER';
    confidence = answerScore >= 2 ? 'high' : answerScore >= 1 ? 'medium' : 'low';
    reasoning = 'Detected question or explanation request.';
  }

  return {
    suggestedMode,
    confidence,
    reasoning,
  };
}

/**
 * Determine if mode suggestion should require user confirmation
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

  // If confidence is low, don't require confirmation (let user's choice stand)
  if (confidence === 'low') {
    return false;
  }

  // If confidence is high and modes differ significantly, require confirmation
  if (confidence === 'high') {
    // MISSION vs PLAN is a significant mismatch - user wants to plan but we detect action intent
    if ((userSelectedMode === 'PLAN' && suggestedMode === 'MISSION') ||
        (userSelectedMode === 'MISSION' && suggestedMode === 'PLAN')) {
      return true;
    }
  }

  // Medium confidence with mode mismatch - require confirmation
  // (Only for PLAN/MISSION mismatches, ANSWER is already handled above)
  if (confidence === 'medium' && userSelectedMode !== suggestedMode) {
    return true;
  }

  return false;
}
