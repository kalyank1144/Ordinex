/**
 * RepairOrchestrator: Coordinates A1 repair iteration loop
 * Based on Step 18 requirements
 * 
 * Orchestrates: diagnose → propose → approve → apply → test
 * With strict budget enforcement and safety gates
 */

import { EventBus } from './eventBus';
import { AutonomyController } from './autonomyController';
import { TestRunner, TestResult } from './testRunner';
import { DiffManager, FileDiff } from './diffManager';
import { ApprovalManager } from './approvalManager';
import { Event, Mode, Stage } from './types';
import { randomUUID } from 'crypto';

/**
 * Diagnosis result from test failure
 */
export interface DiagnosisResult {
  failure_summary: string;
  likely_causes: string[];
  affected_files: string[];
  suggested_fix_approach: string;
}

/**
 * Repair iteration result
 */
export interface RepairIterationResult {
  success: boolean;
  test_passed: boolean;
  diagnosis?: DiagnosisResult;
  proposal_id?: string;
  failure_reason?: string;
  evidence_ids?: string[];
}

/**
 * RepairOrchestrator coordinates the A1 repair loop
 */
export class RepairOrchestrator {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly autonomyController: AutonomyController;
  private readonly testRunner: TestRunner;
  private readonly diffManager: DiffManager;
  private readonly approvalManager: ApprovalManager;

  // Last test failure info (used for diagnosis)
  private lastTestFailure: {
    command: string;
    exit_code: number;
    stderr: string;
    stdout: string;
    summary: string;
  } | null = null;

  constructor(
    taskId: string,
    eventBus: EventBus,
    autonomyController: AutonomyController,
    testRunner: TestRunner,
    diffManager: DiffManager,
    approvalManager: ApprovalManager
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.autonomyController = autonomyController;
    this.testRunner = testRunner;
    this.diffManager = diffManager;
    this.approvalManager = approvalManager;
  }

  /**
   * Start A1 repair autonomy
   * Entry point when user clicks "Attempt Auto-Repair (A1)"
   */
  async startRepair(mode: Mode): Promise<void> {
    // Verify mode is MISSION
    if (mode !== 'MISSION') {
      throw new Error('A1 repair autonomy requires MISSION mode');
    }

    // Start autonomy (emits autonomy_started)
    await this.autonomyController.startAutonomy(mode, 'repair');

    // Emit stage_changed to repair
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'stage_changed',
      mode,
      stage: 'repair',
      payload: {
        from: 'test',
        to: 'repair',
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Begin iteration loop
    await this.runRepairLoop(mode);
  }

  /**
   * Run the bounded repair loop
   */
  private async runRepairLoop(mode: Mode): Promise<void> {
    let shouldContinue = true;

    while (shouldContinue) {
      try {
        shouldContinue = await this.autonomyController.executeIteration(
          mode,
          'repair',
          async () => await this.executeRepairIteration(mode)
        );
      } catch (error) {
        console.error('Repair iteration error:', error);
        await this.autonomyController.halt(
          mode,
          'repair',
          `Iteration error: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      }
    }

    // Check final state
    const state = this.autonomyController.getState();
    if (state === 'completed') {
      // Success case is already handled by iteration_succeeded
    } else if (state === 'budget_exhausted') {
      // Budget exhaustion is already handled
    } else if (state === 'halted') {
      // Halt is already handled
    }
  }

  /**
   * Execute a single repair iteration
   * Returns { success: true } if tests pass, { success: false } otherwise
   */
  private async executeRepairIteration(mode: Mode): Promise<RepairIterationResult> {
    const stage: Stage = 'repair';

    // Step 1: Diagnose failure
    const diagnosis = await this.diagnoseFailure(mode, stage);

    if (!diagnosis) {
      return {
        success: false,
        test_passed: false,
        failure_reason: 'No test failure information available for diagnosis',
      };
    }

    // Step 2: Propose fix (using diagnosis)
    const proposalId = await this.proposeRepairFix(mode, stage, diagnosis);

    if (!proposalId) {
      return {
        success: false,
        test_passed: false,
        diagnosis,
        failure_reason: 'Failed to generate repair proposal',
      };
    }

    // Step 3: Apply fix (with approval gate + checkpoint)
    try {
      const applyResult = await this.diffManager.applyDiff(mode, stage, proposalId);

      if (!applyResult.success) {
        return {
          success: false,
          test_passed: false,
          diagnosis,
          proposal_id: proposalId,
          failure_reason: `Failed to apply diff: ${applyResult.failed_files.map(f => f.error).join(', ')}`,
        };
      }

      // Track tool calls (diff application counts as tool use)
      this.autonomyController.incrementToolCalls(1);

    } catch (error) {
      // User might have rejected approval
      if (error instanceof Error && error.message.includes('denied')) {
        await this.autonomyController.halt(mode, stage, 'user_rejected_fix');
        return {
          success: false,
          test_passed: false,
          diagnosis,
          proposal_id: proposalId,
          failure_reason: 'User rejected fix',
        };
      }
      throw error;
    }

    // Step 4: Rerun tests
    const testResult = await this.testRunner.runTests(mode, stage);

    // Track test execution as tool call
    this.autonomyController.incrementToolCalls(1);

    if (!testResult) {
      // No test command detected - treat as inconclusive
      return {
        success: false,
        test_passed: false,
        diagnosis,
        proposal_id: proposalId,
        failure_reason: 'No test command available to verify fix',
      };
    }

    // Step 5: Check test result
    if (testResult.success) {
      // Tests passed! Repair successful!
      await this.autonomyController.complete(mode, stage);
      
      return {
        success: true,
        test_passed: true,
        diagnosis,
        proposal_id: proposalId,
      };
    } else {
      // Tests still failing - store new failure info for next iteration
      this.captureTestFailure(testResult);

      return {
        success: false,
        test_passed: false,
        diagnosis,
        proposal_id: proposalId,
        failure_reason: testResult.stderr || 'Tests still failing after repair attempt',
      };
    }
  }

  /**
   * Diagnose test failure from evidence
   * V1: Uses deterministic heuristics (no LLM required)
   */
  private async diagnoseFailure(mode: Mode, stage: Stage): Promise<DiagnosisResult | null> {
    if (!this.lastTestFailure) {
      return null;
    }

    const { stderr, stdout, summary, command } = this.lastTestFailure;

    // V1 deterministic diagnosis: extract error patterns
    const failureText = stderr || stdout;
    const lines = failureText.split('\n').filter(line => line.trim());

    // Look for common error patterns
    const errorLines = lines.filter(line =>
      line.includes('Error') ||
      line.includes('FAIL') ||
      line.includes('failed') ||
      line.includes('✗') ||
      line.includes('×') ||
      line.includes('expected') ||
      line.includes('AssertionError')
    );

    // Extract potential file references
    const fileMatches = failureText.match(/[\w\-_/.]+\.(ts|js|tsx|jsx|json|md|txt)/g) || [];
    const affectedFiles = Array.from(new Set(fileMatches)).slice(0, 5); // Top 5 unique files

    // V1 generic fix approach (future: use LLM for smarter diagnosis)
    const diagnosis: DiagnosisResult = {
      failure_summary: summary || errorLines[0] || 'Test failure detected',
      likely_causes: [
        'Syntax error or type mismatch',
        'Failed assertion or expectation',
        'Missing dependency or import',
        'Logic error in implementation',
      ],
      affected_files: affectedFiles.length > 0 ? affectedFiles : ['(unknown - check test output)'],
      suggested_fix_approach: 'Review error messages and adjust implementation to satisfy test expectations',
    };

    // Emit repair_attempted event with diagnosis
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'repair_attempted',
      mode,
      stage,
      payload: {
        iteration: this.autonomyController.getCurrentIteration(),
        diagnosis: diagnosis,
        command: command,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    return diagnosis;
  }

  /**
   * Propose a repair fix based on diagnosis
   * V1: Creates a deterministic placeholder fix (no LLM required)
   */
  private async proposeRepairFix(
    mode: Mode,
    stage: Stage,
    diagnosis: DiagnosisResult
  ): Promise<string | null> {
    // V1: Create a repair proposal document (safe placeholder)
    // In production, this would use LLM to generate actual code fixes

    const timestamp = new Date().toISOString();
    const iteration = this.autonomyController.getCurrentIteration();
    const targetPath = `docs/repair_attempt_${iteration}_${Date.now()}.md`;

    const proposalContent = `# Repair Attempt ${iteration}

**Timestamp**: ${timestamp}

## Diagnosis

**Failure Summary**: ${diagnosis.failure_summary}

**Likely Causes**:
${diagnosis.likely_causes.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**Affected Files**:
${diagnosis.affected_files.map(f => `- ${f}`).join('\n')}

## Suggested Fix Approach

${diagnosis.suggested_fix_approach}

## Status

This is a V1 deterministic repair proposal document.

In production, this would be replaced with:
1. LLM-powered code analysis of the failing test
2. Intelligent diff generation targeting the actual error
3. Precise code fixes to satisfy test expectations

For V1 demonstration, this document captures the repair attempt metadata.

---

*Generated by Ordinex A1 Repair Loop (Step 18)*
`;

    // Create file diff for the proposal document
    const diff: FileDiff = {
      file_path: targetPath,
      operation: 'create',
      new_content: proposalContent,
    };

    // Propose diff using DiffManager
    const proposalId = await this.diffManager.proposeDiff(
      mode,
      stage,
      `A1 Repair Attempt ${iteration}: ${diagnosis.failure_summary.substring(0, 60)}...`,
      [diff],
      true // requires checkpoint
    );

    return proposalId;
  }

  /**
   * Capture test failure information for diagnosis
   */
  captureTestFailure(testResult: TestResult): void {
    this.lastTestFailure = {
      command: testResult.command,
      exit_code: testResult.exit_code,
      stderr: testResult.stderr,
      stdout: testResult.stdout,
      summary: this.extractErrorSummary(testResult.stderr, testResult.stdout),
    };
  }

  /**
   * Extract error summary from test output
   */
  private extractErrorSummary(stderr: string, stdout: string): string {
    // Try stderr first
    if (stderr) {
      const lines = stderr.split('\n').filter(line => line.trim());
      if (lines.length > 0) {
        return lines[0].substring(0, 200);
      }
    }

    // Fall back to stdout
    if (stdout) {
      const lines = stdout.split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (
          line.includes('FAIL') ||
          line.includes('Error') ||
          line.includes('failed')
        ) {
          return line.substring(0, 200);
        }
      }
      if (lines.length > 0) {
        return lines[0].substring(0, 200);
      }
    }

    return 'Test execution failed';
  }

  /**
   * Set the last test failure (called from external test failure detection)
   */
  setLastTestFailure(failure: {
    command: string;
    exit_code: number;
    stderr: string;
    stdout: string;
    summary: string;
  }): void {
    this.lastTestFailure = failure;
  }

  /**
   * Emit event via EventBus
   */
  private async emitEvent(event: Event): Promise<void> {
    await this.eventBus.publish(event);
  }

  /**
   * Stop autonomy (called when user clicks Stop)
   */
  async stop(mode: Mode): Promise<void> {
    // Emit execution_stopped
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'execution_stopped',
      mode,
      stage: 'repair',
      payload: {
        reason: 'User requested stop',
        iteration: this.autonomyController.getCurrentIteration(),
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Halt autonomy
    await this.autonomyController.halt(mode, 'repair', 'user_stopped');
  }
}
