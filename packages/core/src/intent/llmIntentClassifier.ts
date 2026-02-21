/**
 * Step 35.8: LLM Intent Classifier (Ambiguity Handler)
 * 
 * Used ONLY when heuristic detection is ambiguous.
 * Makes a cheap LLM call to classify user intent.
 * 
 * Returns strict JSON with intent classification.
 */

import { LLMService, LLMConfig } from '../llmService';

/**
 * Possible intents the LLM can classify
 */
export type LlmIntent = 
  | 'SCAFFOLD'      // Create new project from scratch
  | 'RUN_COMMAND'   // Execute terminal command
  | 'PLAN'          // Large work requiring planning
  | 'QUICK_ACTION'  // Small code change
  | 'ANSWER'        // Just answer a question
  | 'CLARIFY';      // Need more information

/**
 * Result from LLM intent classification
 */
export interface LlmIntentResult {
  /** Classified intent */
  intent: LlmIntent;
  /** Confidence level (0.0 - 1.0) */
  confidence: number;
  /** Brief reasoning */
  reason: string;
}

/**
 * Arguments for LLM classification
 */
export interface LlmClassifyArgs {
  /** User's input text */
  text: string;
  /** Optional context hint (keep small) */
  contextHint?: string;
  /** LLM configuration */
  llmConfig: LLMConfig;
}

/**
 * System prompt for intent classification.
 * Designed to be concise to minimize token usage.
 */
const SYSTEM_PROMPT = `You are an intent classifier. Analyze the user's request and classify it into ONE of these intents:

INTENTS:
- SCAFFOLD: User wants to create a NEW project/app from scratch (greenfield)
- RUN_COMMAND: User wants to execute a terminal command (npm, yarn, build, test)
- PLAN: User wants to implement a large feature or make significant changes
- QUICK_ACTION: User wants to make a small, focused code change
- ANSWER: User is asking a question that doesn't require code changes
- CLARIFY: The request is too vague to understand

EXAMPLES:
Input: "Creating a new fitness app"
Output: {"intent":"SCAFFOLD","confidence":0.95,"reason":"Creating new app from scratch"}

Input: "run npm test"
Output: {"intent":"RUN_COMMAND","confidence":0.98,"reason":"Explicit command execution"}

Input: "make the button blue"
Output: {"intent":"QUICK_ACTION","confidence":0.9,"reason":"Small visual change"}

Input: "new start dev server"
Output: {"intent":"RUN_COMMAND","confidence":0.92,"reason":"Start dev server command despite 'new' prefix"}

Input: "i am getting build errors fix it"
Output: {"intent":"QUICK_ACTION","confidence":0.85,"reason":"Fixing existing build errors in current project"}

RULES:
- Return ONLY valid JSON, no other text
- confidence must be 0.0-1.0
- reason must be 1 short sentence
- If unsure, return CLARIFY with lower confidence`;

/**
 * User prompt template
 */
function buildUserPrompt(text: string, contextHint?: string): string {
  let prompt = `Classify this request:\n"${text}"`;
  if (contextHint) {
    prompt += `\n\nContext: ${contextHint}`;
  }
  prompt += '\n\nReturn JSON only:';
  return prompt;
}

/**
 * Parse LLM response into LlmIntentResult
 */
function parseResponse(response: string): LlmIntentResult {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate required fields
    if (!parsed.intent || typeof parsed.confidence !== 'number' || !parsed.reason) {
      throw new Error('Missing required fields');
    }

    // Validate intent value
    const validIntents: LlmIntent[] = ['SCAFFOLD', 'RUN_COMMAND', 'PLAN', 'QUICK_ACTION', 'ANSWER', 'CLARIFY'];
    if (!validIntents.includes(parsed.intent)) {
      throw new Error(`Invalid intent: ${parsed.intent}`);
    }

    // Clamp confidence
    const confidence = Math.max(0, Math.min(1, parsed.confidence));

    return {
      intent: parsed.intent as LlmIntent,
      confidence,
      reason: String(parsed.reason).slice(0, 100), // Limit reason length
    };
  } catch (error) {
    // If parsing fails, return CLARIFY with low confidence
    console.error('[llmIntentClassifier] Failed to parse response:', error);
    return {
      intent: 'CLARIFY',
      confidence: 0.3,
      reason: 'Failed to parse LLM response',
    };
  }
}

/**
 * Classify user intent using LLM.
 * 
 * This is only called when heuristic detection is ambiguous.
 * Uses minimal tokens for fast, cheap classification.
 * 
 * @param args - Classification arguments
 * @returns LlmIntentResult with intent, confidence, and reason
 */
export async function llmClassifyIntent(args: LlmClassifyArgs): Promise<LlmIntentResult> {
  const { text, contextHint, llmConfig } = args;

  try {
    // Build prompts
    const userPrompt = buildUserPrompt(text, contextHint);

    // Make LLM call with small token budget
    const response = await callLlmForClassification(
      SYSTEM_PROMPT,
      userPrompt,
      llmConfig
    );

    // Parse and return result
    return parseResponse(response);
  } catch (error) {
    console.error('[llmIntentClassifier] LLM call failed:', error);
    
    // Fallback to CLARIFY on error
    return {
      intent: 'CLARIFY',
      confidence: 0.3,
      reason: `LLM classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Make the actual LLM API call for classification.
 * Uses a small token budget (256 max tokens).
 */
async function callLlmForClassification(
  systemPrompt: string,
  userPrompt: string,
  llmConfig: LLMConfig
): Promise<string> {
  // Using fetch directly for a simple, fast call
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': llmConfig.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: llmConfig.model,
      max_tokens: 256, // Small budget for classification
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as { content?: Array<{ text?: string }> };
  
  // Extract text from response
  if (data.content && data.content.length > 0) {
    return data.content[0].text || '';
  }

  throw new Error('Empty response from LLM');
}

/**
 * Check if LLM classification is needed based on confidence scores.
 * 
 * @param greenfieldConfidence - Confidence from greenfield detector
 * @param commandConfidence - Confidence from command detector
 * @param behaviorConfidence - Confidence from Step 33 intent analysis
 * @returns true if LLM classification should be called
 */
export function needsLlmClassification(
  greenfieldConfidence: number,
  commandConfidence: number,
  behaviorConfidence: number
): boolean {
  // Condition 1: Greenfield is ambiguous (not clear yes or no)
  const greenfieldAmbiguous = greenfieldConfidence > 0.3 && greenfieldConfidence < 0.85;
  
  // Condition 2: Greenfield and command are close
  const closeToCommand = Math.abs(greenfieldConfidence - commandConfidence) < 0.2;
  
  // Condition 3: Step 33 behavior analysis is uncertain
  const behaviorUncertain = behaviorConfidence < 0.6;

  return greenfieldAmbiguous || closeToCommand || behaviorUncertain;
}
