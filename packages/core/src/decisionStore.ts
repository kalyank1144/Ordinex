/**
 * Decision Store: Audit trail for plan refinements and key decisions
 * 
 * Persists to .Ordinex/state/decisions.json
 * 
 * Requirements from Step 25:
 * - Append a record for each plan_refinement
 * - Record type, from_version → to_version, instruction, summary_of_changes, timestamp
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Decision record types
 */
export type DecisionType = 
  | 'plan_refinement'
  | 'plan_approved'
  | 'plan_rejected'
  | 'mode_switch';

/**
 * Plan refinement decision record
 */
export interface PlanRefinementDecision {
  type: 'plan_refinement';
  task_id: string;
  from_plan_id: string;
  from_version: number;
  to_plan_id: string;
  to_version: number;
  instruction: string;
  summary_of_changes: string;
  timestamp: string;
}

/**
 * Plan approval decision record
 */
export interface PlanApprovalDecision {
  type: 'plan_approved' | 'plan_rejected';
  task_id: string;
  plan_id: string;
  plan_version: number;
  reason?: string;
  timestamp: string;
}

/**
 * Mode switch decision record
 */
export interface ModeSwitchDecision {
  type: 'mode_switch';
  task_id: string;
  from_mode: string;
  to_mode: string;
  reason: string;
  timestamp: string;
}

export type DecisionRecord = 
  | PlanRefinementDecision 
  | PlanApprovalDecision 
  | ModeSwitchDecision;

/**
 * Decisions file structure
 */
export interface DecisionsFile {
  version: number;
  created_at: string;
  decisions: DecisionRecord[];
}

/**
 * DecisionStore: Manages decisions.json persistence
 */
export class DecisionStore {
  private filePath: string;

  constructor(workspaceRoot: string) {
    const ordinexDir = path.join(workspaceRoot, '.Ordinex', 'state');
    this.filePath = path.join(ordinexDir, 'decisions.json');
  }

  /**
   * Ensure the decisions directory exists
   */
  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load existing decisions or create new file
   */
  private load(): DecisionsFile {
    this.ensureDir();

    if (fs.existsSync(this.filePath)) {
      try {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(content) as DecisionsFile;
      } catch (error) {
        console.warn('Failed to parse decisions.json, creating new:', error);
      }
    }

    return {
      version: 1,
      created_at: new Date().toISOString(),
      decisions: []
    };
  }

  /**
   * Save decisions to file
   */
  private save(data: DecisionsFile): void {
    this.ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Append a decision record (atomic append)
   */
  append(record: DecisionRecord): void {
    const data = this.load();
    data.decisions.push(record);
    this.save(data);
  }

  /**
   * Append a plan refinement decision
   */
  appendRefinement(
    taskId: string,
    fromPlanId: string,
    fromVersion: number,
    toPlanId: string,
    toVersion: number,
    instruction: string,
    summaryOfChanges: string
  ): void {
    this.append({
      type: 'plan_refinement',
      task_id: taskId,
      from_plan_id: fromPlanId,
      from_version: fromVersion,
      to_plan_id: toPlanId,
      to_version: toVersion,
      instruction,
      summary_of_changes: summaryOfChanges,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Append a plan approval decision
   */
  appendApproval(
    taskId: string,
    planId: string,
    planVersion: number,
    approved: boolean,
    reason?: string
  ): void {
    this.append({
      type: approved ? 'plan_approved' : 'plan_rejected',
      task_id: taskId,
      plan_id: planId,
      plan_version: planVersion,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Append a mode switch decision
   */
  appendModeSwitch(
    taskId: string,
    fromMode: string,
    toMode: string,
    reason: string
  ): void {
    this.append({
      type: 'mode_switch',
      task_id: taskId,
      from_mode: fromMode,
      to_mode: toMode,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get all decisions for a task
   */
  getDecisionsForTask(taskId: string): DecisionRecord[] {
    const data = this.load();
    return data.decisions.filter(d => d.task_id === taskId);
  }

  /**
   * Get all decisions
   */
  getAllDecisions(): DecisionRecord[] {
    const data = this.load();
    return data.decisions;
  }

  /**
   * Get plan refinement history for a task
   */
  getRefinementHistory(taskId: string): PlanRefinementDecision[] {
    return this.getDecisionsForTask(taskId)
      .filter((d): d is PlanRefinementDecision => d.type === 'plan_refinement');
  }
}

/**
 * Generate summary of changes between two plan versions
 * Deterministic comparison - no LLM needed
 */
export function generateChangesSummary(
  oldPlan: Record<string, unknown>,
  newPlan: Record<string, unknown>
): string {
  const changes: string[] = [];

  // Compare goals
  if (oldPlan.goal !== newPlan.goal) {
    changes.push('Goal updated');
  }

  // Compare step counts
  const oldSteps = (oldPlan.steps as unknown[] | undefined)?.length || 0;
  const newSteps = (newPlan.steps as unknown[] | undefined)?.length || 0;
  
  if (newSteps > oldSteps) {
    changes.push(`${newSteps - oldSteps} step(s) added`);
  } else if (newSteps < oldSteps) {
    changes.push(`${oldSteps - newSteps} step(s) removed`);
  }

  // Compare risks
  const oldRisks = (oldPlan.risks as unknown[] | undefined)?.length || 0;
  const newRisks = (newPlan.risks as unknown[] | undefined)?.length || 0;
  
  if (newRisks !== oldRisks) {
    changes.push(`Risks: ${oldRisks} → ${newRisks}`);
  }

  // Compare scope contract
  const oldScope = oldPlan.scope_contract as Record<string, unknown> | undefined;
  const newScope = newPlan.scope_contract as Record<string, unknown> | undefined;
  
  if (oldScope && newScope) {
    if (oldScope.max_files !== newScope.max_files) {
      changes.push(`Max files: ${oldScope.max_files} → ${newScope.max_files}`);
    }
    if (oldScope.max_lines !== newScope.max_lines) {
      changes.push(`Max lines: ${oldScope.max_lines} → ${newScope.max_lines}`);
    }
  }

  // Compare assumptions
  const oldAssumptions = (oldPlan.assumptions as unknown[] | undefined)?.length || 0;
  const newAssumptions = (newPlan.assumptions as unknown[] | undefined)?.length || 0;
  
  if (newAssumptions !== oldAssumptions) {
    changes.push(`Assumptions: ${oldAssumptions} → ${newAssumptions}`);
  }

  if (changes.length === 0) {
    return 'Minor refinements to step details';
  }

  return changes.join('; ');
}
