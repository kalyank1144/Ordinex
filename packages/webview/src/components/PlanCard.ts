/**
 * PlanCard: Displays structured plan output from PLAN mode
 * 
 * Renders:
 * - Goal
 * - Assumptions
 * - Success criteria
 * - Steps with expected evidence
 * - Scope contract
 * - Risks
 * - Plan version info (v1, v2, etc.)
 * - Action buttons (Approve, Refine, Cancel)
 * 
 * Step 25: Added "Refine Plan" functionality with version display
 */

import { Event } from '../types';

export function renderPlanCard(event: Event): string {
  console.log('🎨 [PlanCard] renderPlanCard called');
  console.log('🎨 [PlanCard] event:', JSON.stringify(event, null, 2));
  
  // Handle both StructuredPlan and PlanPayload (template) formats
  const rawPlan = (event.payload.plan || event.payload) as any;
  console.log('🎨 [PlanCard] rawPlan:', JSON.stringify(rawPlan, null, 2));
  
  // Extract plan version info (Step 25)
  const planId = (event.payload.plan_id as string) || event.event_id;
  const planVersion = (event.payload.plan_version as number) || 1;
  const refinementOfPlanId = (event.payload.refinement_of_plan_id as string) || null;
  const refinementInstruction = (event.payload.refinement_instruction as string) || null;
  const isRefinement = event.type === 'plan_revised' || !!refinementOfPlanId;
  
  // Normalize to StructuredPlan format
  const plan = {
    goal: rawPlan.goal || '',
    assumptions: Array.isArray(rawPlan.assumptions) ? rawPlan.assumptions : (rawPlan.assumptions ? [rawPlan.assumptions] : []),
    success_criteria: Array.isArray(rawPlan.success_criteria) ? rawPlan.success_criteria : (rawPlan.success_criteria ? [rawPlan.success_criteria] : []),
    scope_contract: rawPlan.scope_contract || {
      max_files: 10,
      max_lines: 1000,
      allowed_tools: ['read', 'write']
    },
    steps: (rawPlan.steps || []).map((step: any, index: number) => ({
      id: step.id || step.step_id || `step_${index + 1}`,
      description: step.description || '',
      expected_evidence: step.expected_evidence || (step.stage ? [`Stage: ${step.stage}`] : [])
    })),
    risks: Array.isArray(rawPlan.risks) ? rawPlan.risks : []
  };

  if (!plan) {
    return `
      <div class="card plan-card error">
        <div class="card-header">
          <span class="icon">📋</span>
          <span class="title">Plan Error</span>
          <span class="timestamp">${formatTime(event.timestamp)}</span>
        </div>
        <div class="card-body">
          <p class="error-message">Plan data is missing or malformed.</p>
        </div>
      </div>
    `;
  }

  const stepsHtml = plan.steps.map((step: any, index: number) => `
    <div class="plan-step">
      <div class="step-header">
        <span class="step-number">${index + 1}</span>
        <span class="step-description">${escapeHtml(step.description)}</span>
      </div>
      ${step.expected_evidence && step.expected_evidence.length > 0 ? `
        <div class="step-evidence">
          <span class="evidence-label">Expected Evidence:</span>
          <ul class="evidence-list">
            ${step.expected_evidence.map((ev: string) => `<li>${escapeHtml(ev)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `).join('');

  const assumptionsHtml = plan.assumptions && plan.assumptions.length > 0
    ? `
      <div class="plan-section">
        <h4 class="section-title">Assumptions</h4>
        <ul class="assumption-list">
          ${plan.assumptions.map((a: string) => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const successCriteriaHtml = plan.success_criteria && plan.success_criteria.length > 0
    ? `
      <div class="plan-section">
        <h4 class="section-title">Success Criteria</h4>
        <ul class="criteria-list">
          ${plan.success_criteria.map((c: string) => `<li>${escapeHtml(c)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const risksHtml = plan.risks && plan.risks.length > 0
    ? `
      <div class="plan-section risks">
        <h4 class="section-title">⚠️ Risks</h4>
        <ul class="risk-list">
          ${plan.risks.map((r: string) => `<li>${escapeHtml(r)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const scopeContractHtml = plan.scope_contract
    ? `
      <div class="plan-section scope-contract">
        <h4 class="section-title">Scope Contract</h4>
        <div class="contract-details">
          <div class="contract-item">
            <span class="label">Max Files:</span>
            <span class="value">${plan.scope_contract.max_files}</span>
          </div>
          <div class="contract-item">
            <span class="label">Max Lines:</span>
            <span class="value">${plan.scope_contract.max_lines}</span>
          </div>
          <div class="contract-item">
            <span class="label">Allowed Tools:</span>
            <span class="value">${plan.scope_contract.allowed_tools.join(', ')}</span>
          </div>
        </div>
      </div>
    `
    : '';

  // Version badge and refinement info (Step 25)
  const versionBadgeHtml = `
    <span class="plan-version-badge" title="Plan version ${planVersion}">
      v${planVersion}
    </span>
  `;

  const refinementInfoHtml = isRefinement && refinementInstruction
    ? `
      <div class="plan-section refinement-info">
        <h4 class="section-title">🔄 Refinement</h4>
        <p class="refinement-instruction">${escapeHtml(refinementInstruction)}</p>
      </div>
    `
    : '';

  // Card type based on whether it's original or refined
  const cardTitle = isRefinement ? 'Plan Refined' : 'Plan Created';
  const cardIcon = isRefinement ? '🔄' : '📋';

  return `
    <div class="card plan-card" data-event-id="${event.event_id}" data-plan-id="${planId}" data-plan-version="${planVersion}">
      <div class="card-header">
        <span class="icon">${cardIcon}</span>
        <span class="title">${cardTitle}</span>
        ${versionBadgeHtml}
        <span class="timestamp">${formatTime(event.timestamp)}</span>
      </div>
      <div class="card-body">
        <div class="plan-goal">
          <h3 class="goal-title">Goal</h3>
          <p class="goal-text">${escapeHtml(plan.goal)}</p>
        </div>

        ${refinementInfoHtml}

        ${assumptionsHtml}

        <div class="plan-section">
          <h4 class="section-title">Implementation Steps</h4>
          <div class="steps-container">
            ${stepsHtml}
          </div>
        </div>

        ${successCriteriaHtml}

        ${scopeContractHtml}

        ${risksHtml}

        <div class="plan-actions">
          <button 
            class="btn btn-primary"
            onclick="handleRequestPlanApproval('${event.task_id}', '${event.event_id}')"
          >
            ✓ Approve Plan → Start Mission
          </button>
          <button 
            class="btn btn-secondary"
            onclick="toggleRefinePlanInput('${event.task_id}', '${planId}', ${planVersion})"
          >
            ✏️ Refine Plan
          </button>
          <button 
            class="btn btn-tertiary"
            onclick="handleCancelPlan('${event.task_id}')"
          >
            ✕ Cancel
          </button>
        </div>

        <!-- Refine Plan Input (hidden by default) -->
        <div id="refine-plan-input-${planId}" class="refine-plan-container" style="display: none;">
          <div class="refine-plan-header">
            <h4>Refine Plan v${planVersion}</h4>
            <button class="btn btn-icon" onclick="toggleRefinePlanInput('${event.task_id}', '${planId}', ${planVersion})">✕</button>
          </div>
          <div class="refine-plan-form">
            <label for="refinement-instruction-${planId}">Refinement Instruction:</label>
            <textarea 
              id="refinement-instruction-${planId}" 
              class="refinement-textarea" 
              placeholder="Describe what you want to change about this plan. For example: 'Add a step for writing tests' or 'Break step 3 into smaller steps' or 'Focus more on error handling'..."
              rows="3"
            ></textarea>
            <div class="refine-plan-actions">
              <button 
                class="btn btn-primary"
                onclick="submitPlanRefinement('${event.task_id}', '${planId}', ${planVersion})"
              >
                🔄 Generate Refined Plan
              </button>
              <button 
                class="btn btn-tertiary"
                onclick="toggleRefinePlanInput('${event.task_id}', '${planId}', ${planVersion})"
              >
                Cancel
              </button>
            </div>
          </div>
          <p class="refine-plan-note">
            Refining a plan will create a new version (v${planVersion + 1}) and require re-approval.
            Any pending approvals for v${planVersion} will be automatically canceled.
          </p>
        </div>

        <div class="plan-note">
          <p>This plan was generated in PLAN mode. Review it carefully before switching to MISSION mode to execute.</p>
        </div>
      </div>
    </div>

    <style>
      .plan-version-badge {
        display: inline-block;
        background: #4a5568;
        color: #fff;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 600;
        margin-left: 8px;
      }

      .refinement-info {
        background: #2d3748;
        border-left: 3px solid #68d391;
        padding: 8px 12px;
        margin: 12px 0;
      }

      .refinement-instruction {
        font-style: italic;
        color: #a0aec0;
        margin: 0;
      }

      .refine-plan-container {
        margin-top: 16px;
        padding: 16px;
        background: #1a202c;
        border: 1px solid #4a5568;
        border-radius: 8px;
      }

      .refine-plan-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .refine-plan-header h4 {
        margin: 0;
        color: #68d391;
      }

      .refine-plan-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .refine-plan-form label {
        font-weight: 500;
        color: #e2e8f0;
      }

      .refinement-textarea {
        width: 100%;
        padding: 8px 12px;
        background: #2d3748;
        border: 1px solid #4a5568;
        border-radius: 4px;
        color: #e2e8f0;
        font-family: inherit;
        font-size: 0.9rem;
        resize: vertical;
      }

      .refinement-textarea:focus {
        outline: none;
        border-color: #68d391;
      }

      .refinement-textarea::placeholder {
        color: #718096;
      }

      .refine-plan-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      .refine-plan-note {
        margin-top: 12px;
        font-size: 0.85rem;
        color: #a0aec0;
        font-style: italic;
      }

      .btn-icon {
        background: none;
        border: none;
        color: #a0aec0;
        cursor: pointer;
        padding: 4px 8px;
        font-size: 1rem;
      }

      .btn-icon:hover {
        color: #e2e8f0;
      }
    </style>
  `;
}

/**
 * Format timestamp to human-readable time
 */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
