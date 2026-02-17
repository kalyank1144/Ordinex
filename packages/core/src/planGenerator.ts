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

import { Mode, PlanMeta } from './types';
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
 * 
 * planMeta is OPTIONAL advisory metadata for Step 26 detection.
 * Plans without planMeta still work (backward compatible).
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
    step_id: string;
    description: string;
    expected_evidence: string[];
    /** Optional: category tag for visual grouping (e.g. "setup", "core", "testing", "deploy") */
    category?: string;
  }>;
  risks: string[];

  /**
   * Rich markdown overview of the plan.
   * Can include headers, lists, code blocks, and mermaid diagrams.
   * Displayed above the step list for context and architecture notes.
   */
  overview?: string;

  /**
   * Optional mermaid diagram source (e.g. flowchart, sequence diagram).
   * Rendered visually in the plan card when present.
   */
  architecture_diagram?: string;
  
  /**
   * Advisory metadata for Step 26 large plan detection.
   * LLM provides estimates; Step 26 uses them deterministically.
   * OPTIONAL for backward compatibility.
   */
  planMeta?: PlanMeta;
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
  openFiles?: Array<{ path: string; content?: string }>,
  /** A6: Optional callback for streaming text deltas to the UI */
  onStreamDelta?: (delta: string) => void,
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
        // A6: Forward streaming delta to caller for live UI updates
        onStreamDelta?.(chunk.delta);
      }
    }
  );

  // Parse JSON response with robust extraction
  try {
    const rawContent = response.content;
    console.log('[PlanGenerator] Raw response length:', rawContent.length);

    // Strategy 1: Extract JSON from markdown code fences (```json ... ```)
    let jsonStr: string | null = null;
    const fenceMatch = rawContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
      console.log('[PlanGenerator] Extracted JSON from code fence');
    }

    // Strategy 2: Match the outermost { ... }
    if (!jsonStr) {
      const braceMatch = rawContent.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        jsonStr = braceMatch[0];
        console.log('[PlanGenerator] Extracted JSON from brace match');
      }
    }

    if (!jsonStr) {
      throw new Error('No JSON object found in LLM response');
    }

    // Try to parse, and if it fails, attempt JSON repair for truncated responses
    let plan: StructuredPlan;
    try {
      plan = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn('[PlanGenerator] Initial JSON parse failed, attempting repair...');
      // Try to repair truncated JSON by closing open braces/brackets
      let repaired = jsonStr;

      // Remove trailing incomplete string values (cut off mid-string)
      repaired = repaired.replace(/,\s*"[^"]*$/, '');
      repaired = repaired.replace(/,\s*"[^"]*":\s*"[^"]*$/, '');
      repaired = repaired.replace(/,\s*"[^"]*":\s*\[[^\]]*$/, '');

      // Count open vs close braces/brackets and append missing closers
      const openBraces = (repaired.match(/\{/g) || []).length;
      const closeBraces = (repaired.match(/\}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/\]/g) || []).length;

      // Close any open strings
      const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        repaired += '"';
      }

      for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
      for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';

      console.log('[PlanGenerator] Repaired JSON, added', (openBraces - closeBraces), 'braces and', (openBrackets - closeBrackets), 'brackets');

      try {
        plan = JSON.parse(repaired);
        console.log('[PlanGenerator] Repaired JSON parsed successfully');
      } catch (repairErr) {
        // Last resort: try to extract just the goal and steps from partial JSON
        console.error('[PlanGenerator] JSON repair also failed:', repairErr);
        throw parseErr; // throw original error
      }
    }

    // Validate required fields
    if (!plan.goal || !plan.steps || !Array.isArray(plan.steps)) {
      throw new Error('Invalid plan structure: missing required fields (goal=' + !!plan.goal + ', steps=' + !!plan.steps + ')');
    }

    // Set defaults for optional fields
    plan.assumptions = plan.assumptions || [];
    plan.success_criteria = plan.success_criteria || [];
    plan.risks = plan.risks || [];
    plan.overview = plan.overview || '';
    plan.architecture_diagram = plan.architecture_diagram || '';
    plan.scope_contract = plan.scope_contract || {
      max_files: 10,
      max_lines: 1000,
      allowed_tools: ['read']
    };

    // Ensure every step has a step_id and category (LLM may use "id" instead of "step_id")
    plan.steps.forEach((step: any, i: number) => {
      if (!step.step_id && step.id) {
        step.step_id = step.id;
      }
      if (!step.step_id) {
        step.step_id = `step_${i + 1}`;
      }
      if (!step.category) {
        step.category = 'core';
      }
    });

    // Validate plan is project-specific (not generic) - for debugging only
    const validation = validatePlanSpecificity(plan, contextBundle);
    if (!validation.isSpecific) {
      console.warn('⚠️ [PLAN DEBUG] Plan may be too generic:', validation.reasons);
      console.warn('[PLAN DEBUG] Goal:', plan.goal);
      console.warn('[PLAN DEBUG] Steps:', plan.steps.map(s => s.description).join('; '));
    }

    console.log('[PlanGenerator] Successfully parsed plan with', plan.steps.length, 'steps');
    return plan;
  } catch (error) {
    console.error('Failed to parse LLM plan:', error);
    console.error('LLM response length:', response.content.length);
    console.error('LLM response (first 500 chars):', response.content.substring(0, 500));
    console.error('LLM response (last 200 chars):', response.content.substring(response.content.length - 200));
    
    // Fallback to a basic plan structure
    return {
      goal: prompt,
      assumptions: ['Plan generation encountered a parsing issue — try again or rephrase your request'],
      success_criteria: ['Complete the requested task'],
      scope_contract: {
        max_files: 10,
        max_lines: 1000,
        allowed_tools: ['read', 'write']
      },
      steps: [
        {
          step_id: 'step_1',
          description: 'Analyze requirements',
          expected_evidence: ['Project files examined']
        },
        {
          step_id: 'step_2',
          description: 'Implement solution',
          expected_evidence: ['Files modified']
        },
        {
          step_id: 'step_3',
          description: 'Verify results',
          expected_evidence: ['Tests passed']
        }
      ],
      risks: ['Plan JSON parsing failed — the LLM response may have been truncated']
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
 * Refine an existing plan with user feedback
 * Returns a revised plan with incremented version
 */
export async function refinePlan(
  originalPlan: StructuredPlan,
  originalPrompt: string,
  refinementInstruction: string,
  taskId: string,
  eventBus: EventBus,
  llmConfig: LLMConfig,
  workspaceRoot: string,
  openFiles?: Array<{ path: string; content?: string }>
): Promise<StructuredPlan> {
  // Collect project context (same as original plan generation)
  const contextBundle = await collectPlanContext({
    workspaceRoot,
    openFiles,
    maxFileLines: 300,
    maxTreeDepth: 3,
    maxFilesToInclude: 10
  });

  // Build system message with PLAN mode constraints
  const systemMessage = buildPlanModeSystemMessage(contextBundle);

  // Create LLM service for PLAN mode
  const llmService = new LLMService(taskId, eventBus, 'PLAN', 'none');

  // Build refinement prompt that includes original plan + refinement instruction
  const refinementPrompt = `# Plan Refinement Request

## Original Task
${originalPrompt}

## Current Plan
${JSON.stringify(originalPlan, null, 2)}

## Refinement Request
${refinementInstruction}

Please revise the plan based on the refinement request. Return a complete updated plan in JSON format with the same structure as the original plan, but incorporating the requested changes.`;

  // Call LLM and get revised plan
  let fullResponse = '';
  const response = await llmService.streamAnswerWithContext(
    refinementPrompt,
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
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in LLM response');
    }

    const revisedPlan: StructuredPlan = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!revisedPlan.goal || !revisedPlan.steps || !Array.isArray(revisedPlan.steps)) {
      throw new Error('Invalid plan structure: missing required fields');
    }

    // Set defaults for optional fields
    revisedPlan.assumptions = revisedPlan.assumptions || [];
    revisedPlan.success_criteria = revisedPlan.success_criteria || [];
    revisedPlan.risks = revisedPlan.risks || [];
    revisedPlan.overview = revisedPlan.overview || '';
    revisedPlan.architecture_diagram = revisedPlan.architecture_diagram || '';
    revisedPlan.scope_contract = revisedPlan.scope_contract || {
      max_files: 10,
      max_lines: 1000,
      allowed_tools: ['read']
    };

    // Ensure step_ids and categories are set
    revisedPlan.steps.forEach((step, i) => {
      if (!step.step_id) step.step_id = `step_${i + 1}`;
      if (!step.category) step.category = 'core';
    });

    return revisedPlan;
  } catch (error) {
    console.error('Failed to parse refined plan:', error);
    
    // If refinement fails, return original plan with note
    return {
      ...originalPlan,
      assumptions: [
        ...(originalPlan.assumptions || []),
        'Plan refinement failed - returning original plan'
      ]
    };
  }
}

/**
 * Check if a plan is too large/complex for single execution
 * Returns true if plan should be broken into missions
 */
export function shouldBreakIntoMissions(plan: StructuredPlan): {
  shouldBreak: boolean;
  reason?: string;
} {
  const steps = plan.steps || [];
  
  // Heuristic 1: More than 6 steps
  if (steps.length > 6) {
    return {
      shouldBreak: true,
      reason: `Plan has ${steps.length} steps (max recommended: 6)`
    };
  }

  // Heuristic 2: Check for "major feature" indicators in step descriptions
  const majorFeatureKeywords = [
    'implement',
    'create',
    'build',
    'develop',
    'design',
    'refactor',
    'migrate',
    'integrate'
  ];

  let majorFeatureCount = 0;
  for (const step of steps) {
    const description = step.description.toLowerCase();
    if (majorFeatureKeywords.some(keyword => description.includes(keyword))) {
      majorFeatureCount++;
    }
  }

  if (majorFeatureCount > 2) {
    return {
      shouldBreak: true,
      reason: `Plan contains ${majorFeatureCount} major features (max recommended: 2)`
    };
  }

  // Plan is reasonable size for single execution
  return {
    shouldBreak: false
  };
}

/**
 * Validate that a plan is project-specific (not generic)
 * Returns validation result with specificity check
 */
function validatePlanSpecificity(
  plan: StructuredPlan,
  context: PlanContextBundle
): { isSpecific: boolean; reasons: string[] } {
  const reasons: string[] = [];
  
  // Check 1: Does goal mention any specific files from context?
  const contextFiles = [
    ...context.files.map(f => f.path),
    ...context.open_files.map(f => f.path)
  ];
  
  const goalLower = plan.goal.toLowerCase();
  const hasFileReference = contextFiles.some(file => {
    const fileName = file.split('/').pop()?.toLowerCase() || '';
    const fileBase = fileName.replace(/\.[^/.]+$/, ''); // remove extension
    return goalLower.includes(fileName) || goalLower.includes(fileBase);
  });
  
  // Check 2: Do steps mention specific files or packages?
  let specificStepCount = 0;
  for (const step of plan.steps) {
    const stepLower = step.description.toLowerCase();
    
    // Check for file references
    const hasStepFileRef = contextFiles.some(file => {
      const fileName = file.split('/').pop()?.toLowerCase() || '';
      const fileBase = fileName.replace(/\.[^/.]+$/, '');
      return stepLower.includes(fileName) || stepLower.includes(fileBase);
    });
    
    // Check for directory references (src/, components/, etc.)
    const hasDirectoryRef = /src\/|components\/|lib\/|utils\/|pages\/|api\/|services\//.test(stepLower);
    
    // Check for package/technology references from stack
    const hasTechRef = context.inferred_stack.some(tech => 
      stepLower.includes(tech.toLowerCase())
    );
    
    if (hasStepFileRef || hasDirectoryRef || hasTechRef) {
      specificStepCount++;
    }
  }
  
  // Check 3: Generic warning keywords
  const genericKeywords = [
    'enhance the application',
    'improve user experience',
    'additional features',
    'align with project goals',
    'follow best practices',
    'meet project standards',
    'analyze user requirements',
    'identify new features'
  ];
  
  const hasGenericKeywords = genericKeywords.some(keyword => 
    goalLower.includes(keyword) || 
    plan.steps.some(step => step.description.toLowerCase().includes(keyword))
  );
  
  // Validation logic
  if (!hasFileReference && specificStepCount === 0) {
    reasons.push('No specific file or directory references found in goal or steps');
  }
  
  if (specificStepCount < Math.floor(plan.steps.length / 2)) {
    reasons.push(`Only ${specificStepCount} out of ${plan.steps.length} steps reference specific project elements`);
  }
  
  if (hasGenericKeywords) {
    reasons.push('Plan contains generic keywords that could apply to any project');
  }
  
  // Plan is specific if it has no validation failures
  const isSpecific = reasons.length === 0;
  
  return { isSpecific, reasons };
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
