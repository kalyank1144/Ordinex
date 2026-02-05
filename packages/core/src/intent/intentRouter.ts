/**
 * Step 40: Hybrid Intent Router - Single Authoritative Pipeline
 * 
 * This module provides the unified intent routing function that:
 * 1. Handles slash overrides (ALWAYS win)
 * 2. Runs heuristic detection (fast, free)
 * 3. Uses LLM classification ONLY for ambiguous cases
 * 4. Persists routing result in events for replay
 * 
 * ROUTING ALGORITHM (exact order):
 * 1. Slash override? → return immediately
 * 2. Heuristic pass (greenfield, command, behavior)
 * 3. High confidence shortcuts (≥0.85)
 * 4. Ambiguity check → LLM trigger
 * 5. LLM classification if needed
 * 6. Fallback to Step 33 behavior
 */

import { LLMConfig } from '../llmService';
import { Event } from '../types';
import { 
  detectGreenfieldIntent, 
  detectCommandIntent, 
  detectEditScale,
  detectSlashOverride,
  IntentSignal,
} from './intentSignals';
import { llmClassifyIntent, LlmIntent, needsLlmClassification } from './llmIntentClassifier';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Routed intent types
 */
export type RoutedIntent = 
  | 'SCAFFOLD'      // Create new project
  | 'RUN_COMMAND'   // Execute terminal command
  | 'PLAN'          // Large work requiring planning
  | 'QUICK_ACTION'  // Small code change
  | 'ANSWER'        // Just answer a question
  | 'CLARIFY';      // Need more information

/**
 * Source of the routing decision
 */
export type RoutingSource = 'slash' | 'heuristic' | 'llm' | 'behavior';

/**
 * Intent routing result
 */
export interface IntentRoutingResult {
  /** Final routed intent */
  intent: RoutedIntent;
  /** Source of the decision */
  source: RoutingSource;
  /** Confidence level (0-1) */
  confidence: number;
  /** Human-readable reasoning */
  reasoning: string;
  /** Whether LLM was called */
  llmCalled: boolean;
  /** Intermediate signals for debugging */
  signals?: {
    greenfield: IntentSignal;
    command: IntentSignal;
    behaviorConfidence: number;
  };
}

/**
 * Routing context
 */
export interface RoutingContext {
  /** Whether this is a replay (skip LLM) */
  isReplay?: boolean;
  /** Previous routing result from events (for replay) */
  previousRoutingResult?: IntentRoutingResult;
  /** LLM configuration (required if not replay) */
  llmConfig?: LLMConfig;
  /** Behavior confidence from Step 33 (0-1) */
  behaviorConfidence?: number;
  /** Run events for replay detection */
  events?: Event[];
}

// ============================================================================
// PURE QUESTION DETECTION
// ============================================================================

/**
 * Question starters that indicate ANSWER intent
 */
const QUESTION_STARTERS = [
  'what is', 'what are', 'what does', 'what do', "what's",
  'why is', 'why are', 'why does', 'why do',
  'how is', 'how are', 'how does', 'how do', 'how can', 'how to',
  'when is', 'when are', 'when does', 'when do',
  'where is', 'where are', 'where does', 'where do',
  'which is', 'which are', 'which one',
  'who is', 'who are', 'who does',
  'explain', 'describe', 'tell me about', 'can you explain',
  "what's the difference", 'difference between',
  'is it possible', 'is there a way',
];

/**
 * Action question phrases (NOT pure questions)
 */
const ACTION_QUESTION_PHRASES = [
  'can you add', 'can you fix', 'can you create', 'can you implement',
  'can you update', 'can you change', 'can you modify', 'can you remove',
  'could you add', 'could you fix', 'could you create', 'could you implement',
  'would you add', 'would you fix', 'would you create', 'would you implement',
  'please add', 'please fix', 'please create', 'please implement',
  'help me add', 'help me fix', 'help me create', 'help me implement',
];

/**
 * Check if prompt is a pure question (ANSWER intent)
 */
function isPureQuestion(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  
  // Check for action-like questions (NOT pure questions)
  if (ACTION_QUESTION_PHRASES.some(p => normalized.includes(p))) {
    return false;
  }
  
  // Check for question starters or ends with ?
  const hasQuestionStarter = QUESTION_STARTERS.some(s => normalized.startsWith(s));
  const endsWithQuestion = normalized.endsWith('?');
  
  return hasQuestionStarter || endsWithQuestion;
}

// ============================================================================
// MAIN ROUTING FUNCTION
// ============================================================================

/**
 * Route user intent through the unified pipeline
 * 
 * This is the SINGLE ENTRY POINT for intent routing.
 * All other routing code should call this function.
 * 
 * @param input - User's input text
 * @param context - Routing context
 * @returns IntentRoutingResult with final intent and metadata
 */
export async function routeIntent(
  input: string,
  context: RoutingContext = {}
): Promise<IntentRoutingResult> {
  const text = input.trim();

  // =========================================================================
  // STEP 1: Replay check - use cached result if available
  // =========================================================================
  if (context.isReplay && context.previousRoutingResult) {
    return {
      ...context.previousRoutingResult,
      reasoning: `[REPLAY] ${context.previousRoutingResult.reasoning}`,
    };
  }

  // Check events for previous routing result (replay detection)
  if (context.events) {
    const previousRouting = context.events.find(e => e.type === 'intent_routed');
    if (previousRouting) {
      return {
        intent: previousRouting.payload.intent as RoutedIntent,
        source: previousRouting.payload.source as RoutingSource,
        confidence: previousRouting.payload.confidence as number,
        reasoning: `[REPLAY] ${previousRouting.payload.reasoning}`,
        llmCalled: false,
      };
    }
  }

  // =========================================================================
  // STEP 2: Slash override? → return immediately
  // =========================================================================
  const slashOverride = detectSlashOverride(text);
  if (slashOverride) {
    const intentMap: Record<string, RoutedIntent> = {
      scaffold: 'SCAFFOLD',
      plan: 'PLAN',
      run: 'RUN_COMMAND',
      answer: 'ANSWER',
    };
    return {
      intent: intentMap[slashOverride] || 'ANSWER',
      source: 'slash',
      confidence: 1.0,
      reasoning: `Slash override: /${slashOverride}`,
      llmCalled: false,
    };
  }

  // =========================================================================
  // STEP 3: Heuristic pass (fast, free)
  // =========================================================================
  const greenfield = detectGreenfieldIntent(text);
  const command = detectCommandIntent(text);
  const behaviorConfidence = context.behaviorConfidence ?? 0.5;

  const signals = { greenfield, command, behaviorConfidence };

  // =========================================================================
  // STEP 4: Pure question check → ANSWER
  // =========================================================================
  if (isPureQuestion(text) && !greenfield.isMatch && !command.isMatch) {
    return {
      intent: 'ANSWER',
      source: 'heuristic',
      confidence: 0.85,
      reasoning: 'Pure question detected',
      llmCalled: false,
      signals,
    };
  }

  // =========================================================================
  // STEP 5: High confidence shortcuts (≥0.85)
  // =========================================================================
  if (greenfield.isMatch && greenfield.confidence >= 0.85) {
    return {
      intent: 'SCAFFOLD',
      source: 'heuristic',
      confidence: greenfield.confidence,
      reasoning: `Greenfield detected: ${greenfield.reason}`,
      llmCalled: false,
      signals,
    };
  }

  if (command.isMatch && command.confidence >= 0.85) {
    return {
      intent: 'RUN_COMMAND',
      source: 'heuristic',
      confidence: command.confidence,
      reasoning: `Command detected: ${command.reason}`,
      llmCalled: false,
      signals,
    };
  }

  // =========================================================================
  // STEP 6: Ambiguity check - determine if LLM needed
  // =========================================================================
  const needsLLM = needsLlmClassification(
    greenfield.confidence,
    command.confidence,
    behaviorConfidence
  );

  // =========================================================================
  // STEP 7: LLM classification if needed (not during replay)
  // =========================================================================
  if (needsLLM && !context.isReplay && context.llmConfig) {
    try {
      const llmResult = await llmClassifyIntent({
        text,
        llmConfig: context.llmConfig,
      });

      // Trust LLM result if confidence ≥ 0.7
      if (llmResult.confidence >= 0.7) {
        return {
          intent: llmResult.intent,
          source: 'llm',
          confidence: llmResult.confidence,
          reasoning: `LLM classified: ${llmResult.reason}`,
          llmCalled: true,
          signals,
        };
      }

      // LLM uncertain → CLARIFY
      if (llmResult.confidence < 0.7) {
        return {
          intent: 'CLARIFY',
          source: 'llm',
          confidence: llmResult.confidence,
          reasoning: `LLM uncertain (${llmResult.confidence.toFixed(2)}): ${llmResult.reason}`,
          llmCalled: true,
          signals,
        };
      }
    } catch (error) {
      console.error('[intentRouter] LLM classification failed:', error);
      // Fall through to heuristic fallback
    }
  }

  // =========================================================================
  // STEP 8: Heuristic fallback (medium confidence cases)
  // =========================================================================
  
  // Greenfield with medium confidence → SCAFFOLD
  if (greenfield.isMatch && greenfield.confidence >= 0.65) {
    return {
      intent: 'SCAFFOLD',
      source: 'heuristic',
      confidence: greenfield.confidence,
      reasoning: `Greenfield (medium confidence): ${greenfield.reason}`,
      llmCalled: false,
      signals,
    };
  }

  // Command with medium confidence → RUN_COMMAND
  if (command.isMatch && command.confidence >= 0.65) {
    return {
      intent: 'RUN_COMMAND',
      source: 'heuristic',
      confidence: command.confidence,
      reasoning: `Command (medium confidence): ${command.reason}`,
      llmCalled: false,
      signals,
    };
  }

  // =========================================================================
  // STEP 9: Behavior-based fallback (Step 33 integration)
  // =========================================================================
  const editScale = detectEditScale(text);

  // Large scope → PLAN
  if (editScale.scale === 'large' || editScale.scale === 'medium') {
    return {
      intent: 'PLAN',
      source: 'behavior',
      confidence: editScale.confidence,
      reasoning: `Edit scale: ${editScale.scale} - ${editScale.reason}`,
      llmCalled: false,
      signals,
    };
  }

  // Small/trivial scope → QUICK_ACTION
  if (editScale.scale === 'small' || editScale.scale === 'trivial') {
    return {
      intent: 'QUICK_ACTION',
      source: 'behavior',
      confidence: editScale.confidence,
      reasoning: `Edit scale: ${editScale.scale} - ${editScale.reason}`,
      llmCalled: false,
      signals,
    };
  }

  // =========================================================================
  // STEP 10: Ultimate fallback → ANSWER
  // =========================================================================
  return {
    intent: 'ANSWER',
    source: 'behavior',
    confidence: 0.5,
    reasoning: 'Default fallback to ANSWER',
    llmCalled: false,
    signals,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if intent routing is definitely SCAFFOLD (high confidence shortcut)
 * 
 * @param text - User's input text
 * @returns true if definitely scaffold
 */
export function isDefinitelyScaffold(text: string): boolean {
  const slashOverride = detectSlashOverride(text);
  if (slashOverride === 'scaffold') return true;
  
  const greenfield = detectGreenfieldIntent(text);
  return greenfield.isMatch && greenfield.confidence >= 0.85;
}

/**
 * Check if intent routing is definitely RUN_COMMAND (high confidence shortcut)
 * 
 * @param text - User's input text
 * @returns true if definitely run command
 */
export function isDefinitelyRunCommand(text: string): boolean {
  const slashOverride = detectSlashOverride(text);
  if (slashOverride === 'run') return true;
  
  const command = detectCommandIntent(text);
  return command.isMatch && command.confidence >= 0.85;
}

/**
 * Check if LLM classification is needed for this input
 * 
 * @param text - User's input text
 * @param behaviorConfidence - Step 33 behavior confidence
 * @returns true if LLM should be called
 */
export function shouldCallLLM(text: string, behaviorConfidence: number = 0.5): boolean {
  const greenfield = detectGreenfieldIntent(text);
  const command = detectCommandIntent(text);
  
  return needsLlmClassification(
    greenfield.confidence,
    command.confidence,
    behaviorConfidence
  );
}

/**
 * Generate clarification question for ambiguous intent
 * 
 * @param signals - Detection signals
 * @returns Clarification question and options
 */
export function generateClarificationQuestion(
  signals: { greenfield: IntentSignal; command: IntentSignal }
): { question: string; options: Array<{ label: string; intent: RoutedIntent }> } {
  // Greenfield vs existing project ambiguity
  if (signals.greenfield.isMatch && signals.greenfield.confidence > 0.3) {
    return {
      question: 'Are you trying to create a new project from scratch, or modify existing code?',
      options: [
        { label: 'Create new project', intent: 'SCAFFOLD' },
        { label: 'Modify existing code', intent: 'QUICK_ACTION' },
      ],
    };
  }

  // Command vs action ambiguity
  if (signals.command.isMatch && signals.command.confidence > 0.3) {
    return {
      question: 'Do you want to run a command, or make code changes?',
      options: [
        { label: 'Run a command', intent: 'RUN_COMMAND' },
        { label: 'Make code changes', intent: 'QUICK_ACTION' },
      ],
    };
  }

  // General ambiguity
  return {
    question: 'What would you like me to do?',
    options: [
      { label: 'Just explain/answer', intent: 'ANSWER' },
      { label: 'Make a small change', intent: 'QUICK_ACTION' },
      { label: 'Create a detailed plan', intent: 'PLAN' },
    ],
  };
}
