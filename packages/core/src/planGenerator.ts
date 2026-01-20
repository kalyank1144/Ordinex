/**
 * Plan Generator: LLM-based and template-based plan creation
 * 
 * - PLAN mode: Uses LLM to generate structured plans with project context
 * - MISSION mode: Uses deterministic templates
 * 
 * PLAN mode plans include:
 * - Project-aware reasoning
 * - Structured steps with evidence expectations
 * - Scope contracts
 * - Risk assessment
 */

import { Mode } from './types';
import { EventBus } from './eventBus';
import { LLMService, LLMConfig } from './llmService';
import { 
  collectPlanContext, 
  buildPlanModeSystemMessage,
  PlanContextBundle 
} from './planContextCollector';

/**
 * Structured plan output schema (STRICT)
 * This is what the LLM must produce in PLAN mode
 */
export interface StructuredPlan {
  goal: string;
  assumptions: string[];
  success_criteria: string[];
  scope_contract: {
    max_files: number;
    max_lines: number;
    allowed_tools: string[];
  };
  steps: Array<{
    id: string;
    description: string;
    expected_evidence: string[];
  }>;
  risks: string[];
}

/**
 * Legacy plan payload for MISSION mode (backward compatibility)
 */
export interface PlanPayload {
  goal: string;
  assumptions: string[];
  success_criteria: string;
  scope_contract: {
    max_files: number;
    max_lines: number;
    allowed_tools: string[];
  };
  steps: Array<{
    step_id: string;
    description: string;
    stage: string;
    estimated_effort: string;
  }>;
}

/**
 * Generate a structured plan using LLM for PLAN mode
 * Returns a promise that resolves to a structured plan
 */
export async function generateLLMPlan(
  prompt: string,
  taskId: string,
  eventBus: EventBus,
  llmConfig: LLMConfig,
  workspaceRoot: string,
  openFiles?: Array<{ path: string; content?: string }>
): Promise<StructuredPlan> {
  // Collect project context
  const contextBundle = await collectPlanContext({
    workspaceRoot,
    openFiles,
    maxFileLines: 300,
    maxTreeDepth: 3,
    maxFilesToInclude: 10
  });

  console.log('📊 [PlanGenerator] Context collected:', {
    total_files: contextBundle.total_files_scanned,
    total_lines: contextBundle.total_lines_included,
    files_count: contextBundle.files.length,
    open_files_count: contextBundle.open_files.length,
    stack: contextBundle.inferred_stack
  });

  // Emit context_collected event (match ANSWER mode format)
  await eventBus.publish({
    event_id: generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'context_collected',
    mode: 'PLAN',
    stage: 'none',
    payload: {
      files_included: contextBundle.files.map(f => f.path),
      open_files_count: contextBundle.open_files.length,
      total_lines: contextBundle.total_lines_included,
      inferred_stack: contextBundle.inferred_stack,
      total_files_scanned: contextBundle.total_files_scanned
    },
    evidence_ids: [],
    parent_event_id: null
  });

  // Build system message with PLAN mode constraints
  const systemMessage = buildPlanModeSystemMessage(contextBundle);

  // Create LLM service for PLAN mode
  const llmService = new LLMService(taskId, eventBus, 'PLAN', 'none');

  // Call LLM and get structured plan
  let fullResponse = '';
  const response = await llmService.streamAnswerWithContext(
    prompt,
    systemMessage,
    llmConfig,
    (chunk) => {
      if (!chunk.done) {
        fullResponse += chunk.delta;
      }
    }
  );

  // Parse JSON response
  try {
    // Extract JSON from response (in case LLM adds extra text)
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in LLM response');
    }

    const plan: StructuredPlan = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!plan.goal || !plan.steps || !Array.isArray(plan.steps)) {
      throw new Error('Invalid plan structure: missing required fields');
    }

    // Set defaults for optional fields
    plan.assumptions = plan.assumptions || [];
    plan.success_criteria = plan.success_criteria || [];
    plan.risks = plan.risks || [];
    plan.scope_contract = plan.scope_contract || {
      max_files: 10,
      max_lines: 1000,
      allowed_tools: ['read']
    };

    return plan;
  } catch (error) {
    console.error('Failed to parse LLM plan:', error);
    console.error('LLM response:', response.content);
    
    // Fallback to a basic plan structure
    return {
      goal: prompt,
      assumptions: ['LLM failed to generate proper plan structure'],
      success_criteria: ['Complete the requested task'],
      scope_contract: {
        max_files: 10,
        max_lines: 1000,
        allowed_tools: ['read', 'write']
      },
      steps: [
        {
          id: 'step_1',
          description: 'Analyze requirements',
          expected_evidence: ['Project files examined']
        },
        {
          id: 'step_2',
          description: 'Implement solution',
          expected_evidence: ['Files modified']
        },
        {
          id: 'step_3',
          description: 'Verify results',
          expected_evidence: ['Tests passed']
        }
      ],
      risks: ['Unknown - LLM plan generation failed']
    };
  }
}

/**
 * Generate a template-based plan from a prompt
 * This is for MISSION mode (backward compatibility)
 */
export function generateTemplatePlan(prompt: string, mode: Mode): PlanPayload {
  const goal = `Complete: ${prompt}`;
  
  // Generate default assumptions
  const assumptions = [
    'Required context is accessible in workspace',
    'Tools and permissions are available',
    'Changes will be validated before applying',
  ];

  // Generate success criteria based on mode
  let successCriteria = '';
  if (mode === 'PLAN') {
    successCriteria = 'A clear, actionable plan is created and approved';
  } else if (mode === 'MISSION') {
    successCriteria = 'All planned changes are implemented and verified successfully';
  } else {
    successCriteria = 'User question is answered accurately';
  }

  // Default scope contract
  const scopeContract = {
    max_files: 10,
    max_lines: 1000,
    allowed_tools: ['read', 'write', 'exec'],
  };

  // Generate template steps based on mode
  const steps = generateTemplateSteps(prompt, mode);

  return {
    goal,
    assumptions,
    success_criteria: successCriteria,
    scope_contract: scopeContract,
    steps,
  };
}

/**
 * Generate template steps based on prompt and mode
 */
function generateTemplateSteps(prompt: string, mode: Mode): PlanPayload['steps'] {
  if (mode === 'PLAN') {
    return [
      {
        step_id: 'step_1',
        description: 'Analyze the request and gather context',
        stage: 'plan',
        estimated_effort: 'low',
      },
      {
        step_id: 'step_2',
        description: 'Research and identify solution approaches',
        stage: 'retrieve',
        estimated_effort: 'medium',
      },
      {
        step_id: 'step_3',
        description: 'Create detailed implementation plan',
        stage: 'plan',
        estimated_effort: 'medium',
      },
      {
        step_id: 'step_4',
        description: 'Present plan for review and approval',
        stage: 'plan',
        estimated_effort: 'low',
      },
    ];
  } else if (mode === 'MISSION') {
    // Check for action indicators to customize steps
    const promptLower = prompt.toLowerCase();
    const isCreate = /create|build|add|implement|write/.test(promptLower);
    const isFix = /fix|repair|debug|resolve/.test(promptLower);
    const isRefactor = /refactor|improve|optimize/.test(promptLower);

    if (isFix) {
      return [
        {
          step_id: 'step_1',
          description: 'Analyze the issue and gather diagnostic information',
          stage: 'retrieve',
          estimated_effort: 'medium',
        },
        {
          step_id: 'step_2',
          description: 'Identify root cause and solution approach',
          stage: 'plan',
          estimated_effort: 'medium',
        },
        {
          step_id: 'step_3',
          description: 'Implement fix with minimal changes',
          stage: 'edit',
          estimated_effort: 'high',
        },
        {
          step_id: 'step_4',
          description: 'Test the fix and verify resolution',
          stage: 'test',
          estimated_effort: 'medium',
        },
        {
          step_id: 'step_5',
          description: 'Document changes and complete mission',
          stage: 'edit',
          estimated_effort: 'low',
        },
      ];
    } else if (isRefactor) {
      return [
        {
          step_id: 'step_1',
          description: 'Analyze current code structure',
          stage: 'retrieve',
          estimated_effort: 'medium',
        },
        {
          step_id: 'step_2',
          description: 'Design refactoring approach',
          stage: 'plan',
          estimated_effort: 'medium',
        },
        {
          step_id: 'step_3',
          description: 'Apply refactoring changes incrementally',
          stage: 'edit',
          estimated_effort: 'high',
        },
        {
          step_id: 'step_4',
          description: 'Verify functionality remains intact',
          stage: 'test',
          estimated_effort: 'medium',
        },
      ];
    } else {
      // Default create/build flow
      return [
        {
          step_id: 'step_1',
          description: 'Gather requirements and context',
          stage: 'retrieve',
          estimated_effort: 'medium',
        },
        {
          step_id: 'step_2',
          description: 'Design solution architecture',
          stage: 'plan',
          estimated_effort: 'medium',
        },
        {
          step_id: 'step_3',
          description: 'Implement core functionality',
          stage: 'edit',
          estimated_effort: 'high',
        },
        {
          step_id: 'step_4',
          description: 'Add tests and validation',
          stage: 'test',
          estimated_effort: 'medium',
        },
        {
          step_id: 'step_5',
          description: 'Review and finalize',
          stage: 'edit',
          estimated_effort: 'low',
        },
      ];
    }
  } else {
    // ANSWER mode - no complex steps needed
    return [
      {
        step_id: 'step_1',
        description: 'Analyze question and gather relevant information',
        stage: 'retrieve',
        estimated_effort: 'low',
      },
      {
        step_id: 'step_2',
        description: 'Formulate comprehensive answer',
        stage: 'plan',
        estimated_effort: 'low',
      },
    ];
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
