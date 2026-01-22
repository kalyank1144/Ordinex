/**
 * Prompt Quality Judge: Assesses clarity of PLAN requests and provides structured guidance
 * 
 * Purpose: Prevent vague prompts from producing generic plans
 * 
 * Flow:
 * - clarity=high: Proceed as-is
 * - clarity=medium: Rewrite into structured planning request
 * - clarity=low: Ask one clarifying question + pause
 */

import { EventBus } from './eventBus';
import { LLMService, LLMConfig } from './llmService';

/**
 * Prompt Quality Assessment Result (STRICT JSON)
 */
export interface PromptQualityAssessment {
  clarity: 'high' | 'medium' | 'low';
  detected_intent: 'answer' | 'plan' | 'mission';
  missing_info: string[];
  safe_rewrite: string;
  clarifying_question: string;
}

/**
 * Lightweight context for prompt assessment (no big file excerpts)
 */
export interface AssessmentContext {
  inferred_stack: string[];
  top_level_files: string[];
  open_files: string[];
}

/**
 * Prompt Quality Judge
 * Uses a cheap LLM model to assess prompt clarity before plan generation
 */
export class PromptQualityJudge {
  constructor(
    private taskId: string,
    private eventBus: EventBus,
    private llmConfig: LLMConfig
  ) {}

  /**
   * Assess prompt quality and return structured result
   * 
   * @param userPrompt - The user's planning request
   * @param context - Lightweight repo context (stack, file names only)
   * @returns Assessment with clarity level and guidance
   */
  async assessPrompt(
    userPrompt: string,
    context: AssessmentContext
  ): Promise<PromptQualityAssessment> {
    // Build system message for quality assessment
    const systemMessage = this.buildAssessmentSystemMessage(context);

    // Build user message with assessment instructions
    const assessmentPrompt = this.buildAssessmentPrompt(userPrompt);

    try {
      // Use LLMService for the judge call (cheap model)
      const llmService = new LLMService(this.taskId, this.eventBus, 'PLAN', 'none');
      
      // Use a cheaper model for assessment (override config)
      const judgeConfig: LLMConfig = {
        ...this.llmConfig,
        model: 'claude-3-haiku-20240307', // Force haiku for cheap assessment
        maxTokens: 1024, // Smaller token limit
      };

      // Call LLM without streaming
      const response = await llmService.streamAnswerWithContext(
        assessmentPrompt,
        systemMessage,
        judgeConfig,
        () => {} // No streaming callback for judge
      );

      // Parse JSON response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('⚠️ [PromptQualityJudge] No JSON found in response, using fallback');
        return this.getFallbackAssessment(userPrompt);
      }

      const assessment: PromptQualityAssessment = JSON.parse(jsonMatch[0]);

      // Validate assessment structure
      if (!assessment.clarity || !assessment.detected_intent) {
        console.warn('⚠️ [PromptQualityJudge] Invalid assessment structure, using fallback');
        return this.getFallbackAssessment(userPrompt);
      }

      // Set defaults for optional fields
      assessment.missing_info = assessment.missing_info || [];
      assessment.safe_rewrite = assessment.safe_rewrite || userPrompt;
      assessment.clarifying_question = assessment.clarifying_question || '';

      console.log('✓ [PromptQualityJudge] Assessment completed:', {
        clarity: assessment.clarity,
        detected_intent: assessment.detected_intent,
        missing_info_count: assessment.missing_info.length
      });

      return assessment;

    } catch (error) {
      console.error('❌ [PromptQualityJudge] Assessment failed:', error);
      // Fallback to medium clarity on failure (proceed with rewrite attempt)
      return this.getFallbackAssessment(userPrompt);
    }
  }

  /**
   * Build system message for prompt assessment
   * Includes lightweight project context
   */
  private buildAssessmentSystemMessage(context: AssessmentContext): string {
    return `You are a prompt quality judge for a VS Code extension that generates implementation plans.

# Your Role
Assess the clarity and specificity of planning requests and provide guidance.

# Project Context (Lightweight)
**Tech Stack**: ${context.inferred_stack.join(', ') || 'Unknown'}
**Top-Level Files**: ${context.top_level_files.slice(0, 10).join(', ') || 'Unknown'}
**Open Files**: ${context.open_files.slice(0, 5).join(', ') || 'None'}

# Assessment Criteria

## High Clarity
- Prompt mentions specific files, components, or features from the project
- Clear goal with enough detail to generate a concrete plan
- No major gaps in information
- Example: "Add error handling to UserService.ts and display errors in LoginForm.tsx"

## Medium Clarity
- Prompt has a clear intent but lacks specificity
- Could benefit from structure (asking for options, effort tiers, tradeoffs)
- Not mentioning specific project elements
- Example: "Improve error handling" or "Add authentication"

## Low Clarity
- Prompt is too vague or open-ended
- Unclear goal or exploratory question
- Would produce generic advice without clarification
- Example: "What features can we add?" or "Make it better"

# Your Task
1. Assess clarity: high, medium, or low
2. Detect intent: answer, plan, or mission
3. Identify missing_info if applicable
4. Provide safe_rewrite for medium clarity (structured request with options framing)
5. Provide clarifying_question for low clarity (ONE focused question)

# Rules for safe_rewrite (Medium Clarity)
- NEVER invent specific features or requirements
- Add structure by asking the model to:
  - Present multiple options with tradeoffs
  - Estimate effort tiers
  - Ground recommendations in repo evidence
  - Compare approaches
- Example transformation:
  - Original: "Improve error handling"
  - Rewrite: "Analyze current error handling in the codebase and propose 2-3 improvement options with effort estimates and tradeoffs. Ground recommendations in specific files found in the project."

# Output Format (STRICT JSON)
{
  "clarity": "high" | "medium" | "low",
  "detected_intent": "answer" | "plan" | "mission",
  "missing_info": ["what", "needs", "clarification"],
  "safe_rewrite": "structured version of prompt (for medium clarity)",
  "clarifying_question": "ONE focused question to ask user (for low clarity)"
}

Respond with ONLY the JSON object, no additional text.`;
  }

  /**
   * Build assessment prompt
   */
  private buildAssessmentPrompt(userPrompt: string): string {
    return `Assess this planning request:

"${userPrompt}"

Provide your assessment in strict JSON format.`;
  }

  /**
   * Get fallback assessment when judge fails
   * Default to medium clarity to proceed with rewrite attempt
   */
  private getFallbackAssessment(userPrompt: string): PromptQualityAssessment {
    return {
      clarity: 'medium',
      detected_intent: 'plan',
      missing_info: ['prompt_assess_failed'],
      safe_rewrite: this.generateSimpleRewrite(userPrompt),
      clarifying_question: ''
    };
  }

  /**
   * Generate a simple rewrite when judge fails
   * Adds basic structure without inventing requirements
   */
  private generateSimpleRewrite(userPrompt: string): string {
    return `${userPrompt}

Please analyze the codebase and provide a structured implementation plan with:
- Specific files and components to modify
- Step-by-step approach grounded in project structure
- Estimated effort and potential risks
- Multiple implementation options if applicable`;
  }
}

/**
 * Combine original prompt with clarification answer
 * Used when user provides clarification for low-clarity prompts
 */
export function combinePromptWithClarification(
  originalPrompt: string,
  clarificationAnswer: string
): string {
  return `# Original Request
${originalPrompt}

# Clarification Provided
${clarificationAnswer}

Based on the original request and the clarification above, generate a detailed implementation plan.`;
}
