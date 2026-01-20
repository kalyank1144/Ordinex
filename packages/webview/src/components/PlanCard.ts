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
 * - Action buttons (Approve, Edit, Cancel)
 */

import { Event } from '../types';

export function renderPlanCard(event: Event): string {
  console.log('🎨 [PlanCard] renderPlanCard called');
  console.log('🎨 [PlanCard] event:', JSON.stringify(event, null, 2));
  
  // Handle both StructuredPlan and PlanPayload (template) formats
  const rawPlan = (event.payload.plan || event.payload) as any;
  console.log('🎨 [PlanCard] rawPlan:', JSON.stringify(rawPlan, null, 2));
  
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

  return `
    <div class="card plan-card" data-event-id="${event.event_id}">
      <div class="card-header">
        <span class="icon">📋</span>
        <span class="title">Plan Created</span>
        <span class="timestamp">${formatTime(event.timestamp)}</span>
      </div>
      <div class="card-body">
        <div class="plan-goal">
          <h3 class="goal-title">Goal</h3>
          <p class="goal-text">${escapeHtml(plan.goal)}</p>
        </div>

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
            onclick="handleEditPlan('${event.task_id}', '${event.event_id}')"
            disabled
            title="Plan editing coming in future version"
          >
            ✏️ Edit Plan
          </button>
          <button 
            class="btn btn-tertiary"
            onclick="handleCancelPlan('${event.task_id}')"
          >
            ✕ Cancel
          </button>
        </div>

        <div class="plan-note">
          <p>This plan was generated in PLAN mode. Review it carefully before switching to MISSION mode to execute.</p>
        </div>
      </div>
    </div>
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
