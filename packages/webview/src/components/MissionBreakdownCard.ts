/**
 * MissionBreakdownCard: UI component for Step 26 - Mission Breakdown display
 * 
 * Renders:
 * - "Mission Breakdown Required" banner with reasons
 * - List of missions with size/risk/domain tags
 * - Expandable mission details (intent, steps, acceptance, outOfScope)
 * - Mission selection button
 * - "Start Mission" button after selection
 * 
 * This component replaces "Execute Plan" when a plan is detected as large.
 */

import { Event } from '../types';
import { escapeHtml } from '../utils/cardHelpers';

/**
 * Mission data from mission_breakdown_created event
 */
interface MissionData {
  missionId: string;
  title: string;
  intent: string;
  includedSteps: Array<{ stepId: string; title: string }>;
  dependencies: string[];
  scope: {
    domains: string[];
    outOfScope: string[];
  };
  acceptance: string[];
  verification: {
    suggestedCommands: string[];
    manualChecks: string[];
  };
  risk: { level: 'low' | 'med' | 'high'; notes: string[] };
  estimate: { size: 'S' | 'M' | 'L'; rationale: string[] };
}

/**
 * Render the large plan detected banner
 */
export function renderLargePlanBanner(
  largePlanEvent: Event,
  taskId: string
): string {
  const reasons = (largePlanEvent.payload.reasons as string[]) || [];
  const score = (largePlanEvent.payload.score as number) || 0;
  const planId = largePlanEvent.payload.plan_id as string;
  const planVersion = largePlanEvent.payload.plan_version as number;

  const reasonsHtml = reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('');

  return `
    <div class="large-plan-banner" data-plan-id="${planId}" data-plan-version="${planVersion}">
      <div class="banner-header">
        <span class="banner-icon">⚠️</span>
        <span class="banner-title">Mission Breakdown Required</span>
        <span class="banner-score">Score: ${score}/100</span>
      </div>
      <div class="banner-body">
        <p class="banner-description">
          This plan is too large to execute safely in one run. You must select ONE mission to execute at a time.
        </p>
        ${reasons.length > 0 ? `
          <div class="banner-reasons">
            <strong>Why:</strong>
            <ul>${reasonsHtml}</ul>
          </div>
        ` : ''}
      </div>
    </div>

    <style>
      .large-plan-banner {
        background: var(--vscode-inputValidation-warningBackground);
        border: 2px solid var(--vscode-charts-yellow);
        border-radius: 8px;
        padding: 16px;
        margin: 12px 0;
        animation: pulseGlow 2s ease-in-out infinite;
      }

      @keyframes pulseGlow {
        0%, 100% { box-shadow: 0 0 8px rgba(255, 193, 7, 0.3); }
        50% { box-shadow: 0 0 16px rgba(255, 193, 7, 0.6); }
      }

      .banner-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }

      .banner-icon {
        font-size: 24px;
      }

      .banner-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--vscode-editor-foreground);
        flex: 1;
      }

      .banner-score {
        font-size: 12px;
        background: var(--vscode-charts-yellow);
        color: #000;
        padding: 4px 8px;
        border-radius: 12px;
        font-weight: 600;
      }

      .banner-body {
        font-size: 13px;
        line-height: 1.5;
      }

      .banner-description {
        margin: 0 0 12px 0;
        color: var(--vscode-editor-foreground);
      }

      .banner-reasons {
        background: var(--vscode-input-background);
        padding: 10px;
        border-radius: 4px;
      }

      .banner-reasons strong {
        color: var(--vscode-charts-yellow);
      }

      .banner-reasons ul {
        margin: 8px 0 0 0;
        padding-left: 20px;
      }

      .banner-reasons li {
        margin: 4px 0;
        color: var(--vscode-descriptionForeground);
      }
    </style>
  `;
}

/**
 * Render the mission breakdown list
 */
export function renderMissionBreakdownCard(
  breakdownEvent: Event,
  selectedMissionId: string | null,
  taskId: string
): string {
  const missions = (breakdownEvent.payload.missions as MissionData[]) || [];
  const breakdownId = breakdownEvent.payload.breakdown_id as string;
  const planId = breakdownEvent.payload.plan_id as string;
  const planVersion = breakdownEvent.payload.plan_version as number;

  const missionsHtml = missions.map((mission, index) => 
    renderMissionItem(mission, index, selectedMissionId, taskId, planId, planVersion)
  ).join('');

  return `
    <div class="mission-breakdown-card" data-breakdown-id="${breakdownId}" data-plan-id="${planId}">
      <div class="breakdown-header">
        <span class="breakdown-icon">📋</span>
        <span class="breakdown-title">Mission Breakdown</span>
        <span class="breakdown-count">${missions.length} missions</span>
      </div>

      <div class="breakdown-instructions">
        <p><strong>Select exactly ONE mission to execute:</strong></p>
        <p class="note">Remaining missions will be available after this one completes.</p>
      </div>

      <div class="missions-list">
        ${missionsHtml}
      </div>

      ${selectedMissionId ? renderStartMissionButton(missions.find(m => m.missionId === selectedMissionId)!, taskId, planId, planVersion) : ''}

      <div class="breakdown-actions">
        <button 
          class="btn btn-secondary"
          onclick="handleRegenerateBreakdown('${taskId}', '${planId}', ${planVersion})"
        >
          🔄 Regenerate Breakdown
        </button>
        <button 
          class="btn btn-tertiary"
          onclick="handleBackToPlan('${taskId}')"
        >
          ← Back to Plan
        </button>
      </div>
    </div>

    <style>
      .mission-breakdown-card {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 16px;
        margin: 12px 0;
      }

      .breakdown-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .breakdown-icon {
        font-size: 20px;
      }

      .breakdown-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--vscode-editor-foreground);
        flex: 1;
      }

      .breakdown-count {
        font-size: 12px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 3px 8px;
        border-radius: 10px;
      }

      .breakdown-instructions {
        margin-bottom: 16px;
        font-size: 13px;
      }

      .breakdown-instructions p {
        margin: 0 0 4px 0;
      }

      .breakdown-instructions .note {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }

      .missions-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .breakdown-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid var(--vscode-panel-border);
      }

      .btn {
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 4px;
        cursor: pointer;
        border: none;
      }

      .btn-secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }

      .btn-tertiary {
        background: transparent;
        color: var(--vscode-textLink-foreground);
        text-decoration: underline;
      }
    </style>
  `;
}

/**
 * Render a single mission item
 */
function renderMissionItem(
  mission: MissionData,
  index: number,
  selectedMissionId: string | null,
  taskId: string,
  planId: string,
  planVersion: number
): string {
  const isSelected = mission.missionId === selectedMissionId;
  const isExpanded = false; // Default collapsed

  // Size badge color
  const sizeColors = { S: 'var(--vscode-charts-green)', M: 'var(--vscode-charts-yellow)', L: 'var(--vscode-charts-red)' };
  const sizeColor = sizeColors[mission.estimate.size] || sizeColors.M;

  // Risk badge color
  const riskColors = { low: 'var(--vscode-charts-green)', med: 'var(--vscode-charts-yellow)', high: 'var(--vscode-charts-red)' };
  const riskColor = riskColors[mission.risk.level] || riskColors.med;

  // Domain badges
  const domainsHtml = mission.scope.domains.slice(0, 3).map(d => 
    `<span class="domain-badge">${escapeHtml(d)}</span>`
  ).join('');

  // Steps summary
  const stepsHtml = mission.includedSteps.slice(0, 4).map(s => 
    `<li>${escapeHtml(s.title.length > 60 ? s.title.substring(0, 60) + '...' : s.title)}</li>`
  ).join('');

  // Acceptance criteria
  const acceptanceHtml = mission.acceptance.slice(0, 4).map(a => 
    `<li>${escapeHtml(a)}</li>`
  ).join('');

  // Out of scope
  const outOfScopeHtml = mission.scope.outOfScope.slice(0, 4).map(o => 
    `<li>${escapeHtml(o)}</li>`
  ).join('');

  return `
    <div class="mission-item ${isSelected ? 'selected' : ''}" data-mission-id="${mission.missionId}">
      <div class="mission-header" onclick="toggleMissionExpand('${mission.missionId}')">
        <div class="mission-number">${index + 1}</div>
        <div class="mission-info">
          <div class="mission-title">${escapeHtml(mission.title)}</div>
          <div class="mission-badges">
            <span class="size-badge" style="background: ${sizeColor};">${mission.estimate.size}</span>
            <span class="risk-badge" style="background: ${riskColor};">${mission.risk.level.toUpperCase()}</span>
            ${domainsHtml}
          </div>
        </div>
        <button 
          class="select-mission-btn ${isSelected ? 'selected' : ''}"
          onclick="event.stopPropagation(); handleSelectMission('${taskId}', '${mission.missionId}', '${planId}', ${planVersion})"
        >
          ${isSelected ? '✓ Selected' : 'Select'}
        </button>
      </div>

      <div class="mission-details" id="mission-details-${mission.missionId}" style="display: none;">
        <div class="mission-intent">
          <strong>Intent:</strong> ${escapeHtml(mission.intent)}
        </div>

        <div class="mission-section">
          <strong>Steps (${mission.includedSteps.length}):</strong>
          <ul>${stepsHtml}</ul>
          ${mission.includedSteps.length > 4 ? `<div class="more-items">+${mission.includedSteps.length - 4} more steps</div>` : ''}
        </div>

        <div class="mission-section">
          <strong>Acceptance Criteria:</strong>
          <ul>${acceptanceHtml}</ul>
        </div>

        <div class="mission-section out-of-scope">
          <strong>Out of Scope:</strong>
          <ul>${outOfScopeHtml}</ul>
        </div>

        ${mission.dependencies.length > 0 ? `
          <div class="mission-section dependencies">
            <strong>Dependencies:</strong> ${mission.dependencies.length} mission(s) should be completed first
          </div>
        ` : ''}
      </div>
    </div>

    <style>
      .mission-item {
        background: var(--vscode-input-background);
        border: 2px solid var(--vscode-panel-border);
        border-radius: 6px;
        overflow: hidden;
        transition: all 0.2s ease;
      }

      .mission-item:hover {
        border-color: var(--vscode-focusBorder);
      }

      .mission-item.selected {
        border-color: var(--vscode-charts-green);
        background: var(--vscode-editor-inactiveSelectionBackground);
      }

      .mission-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        cursor: pointer;
      }

      .mission-number {
        width: 28px;
        height: 28px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        flex-shrink: 0;
      }

      .mission-info {
        flex: 1;
        min-width: 0;
      }

      .mission-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--vscode-editor-foreground);
        margin-bottom: 6px;
      }

      .mission-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .size-badge, .risk-badge, .domain-badge {
        padding: 2px 6px;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        color: #fff;
      }

      .domain-badge {
        background: var(--vscode-charts-blue);
      }

      .select-mission-btn {
        padding: 8px 16px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 4px;
        cursor: pointer;
        border: none;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        flex-shrink: 0;
        transition: all 0.2s ease;
      }

      .select-mission-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }

      .select-mission-btn.selected {
        background: var(--vscode-charts-green);
        color: #fff;
      }

      .mission-details {
        padding: 12px;
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 12px;
        line-height: 1.5;
      }

      .mission-intent {
        margin-bottom: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .mission-section {
        margin-bottom: 10px;
      }

      .mission-section strong {
        color: var(--vscode-editor-foreground);
        display: block;
        margin-bottom: 4px;
      }

      .mission-section ul {
        margin: 0;
        padding-left: 18px;
        color: var(--vscode-descriptionForeground);
      }

      .mission-section li {
        margin: 2px 0;
      }

      .mission-section.out-of-scope strong {
        color: var(--vscode-charts-orange);
      }

      .mission-section.dependencies {
        padding: 8px;
        background: var(--vscode-inputValidation-infoBackground);
        border-radius: 4px;
        color: var(--vscode-editor-foreground);
      }

      .more-items {
        font-style: italic;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        margin-top: 4px;
      }
    </style>
  `;
}

/**
 * Render the Start Mission button (shown after selection)
 */
function renderStartMissionButton(
  mission: MissionData,
  taskId: string,
  planId: string,
  planVersion: number
): string {
  return `
    <div class="start-mission-container">
      <button 
        class="start-mission-btn"
        onclick="handleStartMission('${taskId}', '${mission.missionId}', '${planId}', ${planVersion})"
      >
        🚀 Start Mission: ${escapeHtml(mission.title)}
      </button>
      <p class="start-mission-note">
        You will run only this mission. Remaining ${mission.includedSteps.length > 1 ? mission.includedSteps.length : 'these'} steps will be executed.
      </p>
    </div>

    <style>
      .start-mission-container {
        margin-top: 16px;
        padding: 16px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border: 2px solid var(--vscode-charts-green);
        border-radius: 8px;
        text-align: center;
      }

      .start-mission-btn {
        width: 100%;
        padding: 14px 20px;
        font-size: 15px;
        font-weight: 700;
        background: var(--vscode-charts-green);
        color: #fff;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
      }

      .start-mission-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(40, 167, 69, 0.5);
      }

      .start-mission-note {
        margin: 10px 0 0 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }
    </style>
  `;
}

