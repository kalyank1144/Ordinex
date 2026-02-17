/**
 * RepairOrchestrator: Coordinates A1 repair iteration loop
 * Based on Step 18 requirements
 *
 * Orchestrates: diagnose → propose → approve → apply → test
 * With strict budget enforcement and safety gates
 *
 * V2: LLM-powered diagnosis + code fix generation (with heuristic fallback)
 */

import { EventBus } from './eventBus';
import { AutonomyController } from './autonomyController';
import { TestRunner, TestResult } from './testRunner';
import { DiffManager, FileDiff } from './diffManager';
import { ApprovalManager } from './approvalManager';
import { Event, Mode, Stage } from './types';
import { randomUUID } from 'crypto';
import type { LLMClient, LLMClientResponse } from './agenticLoop';
import { FAST_MODEL, EDIT_MODEL } from './modelRegistry';
import { safeJsonParse } from './jsonRepair';

/**
 * Function signature for reading a file by path.
 * Returns file content as string, or null if the file cannot be read.
 */
export type ReadFileFn = (path: string) => Promise<string | null>;

/**
 * Diagnosis result from test failure
 */
export interface DiagnosisResult {
  failure_summary: string;
  likely_causes: string[];
  affected_files: string[];
  suggested_fix_approach: string;
  root_cause_file?: string;
  confidence?: number;
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
  private readonly llmClient: LLMClient | null;
  private readonly readFile: ReadFileFn | null;

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
    approvalManager: ApprovalManager,
    llmClient?: LLMClient | null,
    readFile?: ReadFileFn | null,
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.autonomyController = autonomyController;
    this.testRunner = testRunner;
    this.diffManager = diffManager;
    this.approvalManager = approvalManager;
    this.llmClient = llmClient ?? null;
    this.readFile = readFile ?? null;
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
   * Diagnose test failure — tries LLM first, falls back to heuristics.
   */
  private async diagnoseFailure(mode: Mode, stage: Stage): Promise<DiagnosisResult | null> {
    if (!this.lastTestFailure) {
      return null;
    }

    let diagnosis: DiagnosisResult;
    let diagnosisSource: 'llm' | 'heuristic';

    if (this.llmClient) {
      try {
        const llmDiagnosis = await this.diagnoseLLM();
        if (llmDiagnosis) {
          diagnosis = llmDiagnosis;
          diagnosisSource = 'llm';
        } else {
          diagnosis = this.diagnoseHeuristic();
          diagnosisSource = 'heuristic';
        }
      } catch {
        diagnosis = this.diagnoseHeuristic();
        diagnosisSource = 'heuristic';
      }
    } else {
      diagnosis = this.diagnoseHeuristic();
      diagnosisSource = 'heuristic';
    }

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
        diagnosis_source: diagnosisSource,
        command: this.lastTestFailure.command,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    return diagnosis;
  }

  /**
   * LLM-powered diagnosis using FAST_MODEL (Haiku).
   * Returns structured DiagnosisResult or null on failure.
   */
  private async diagnoseLLM(): Promise<DiagnosisResult | null> {
    if (!this.llmClient || !this.lastTestFailure) return null;

    const { stderr, stdout, command } = this.lastTestFailure;
    const failureText = (stderr || stdout).substring(0, 8000);

    const systemPrompt = `You are a test failure diagnosis assistant. Analyze the test output and return a JSON object with these fields:
- failure_summary: string (1-2 sentence summary of what failed)
- likely_causes: string[] (2-4 specific likely causes based on the actual error)
- affected_files: string[] (file paths mentioned in the error, max 5)
- root_cause_file: string (the single most likely file that needs fixing)
- suggested_fix_approach: string (specific fix approach based on the actual error)
- confidence: number (0.0-1.0, how confident you are in the diagnosis)

Return ONLY valid JSON, no markdown fences or explanation.`;

    const response: LLMClientResponse = await this.llmClient.createMessage({
      model: FAST_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Test command: ${command}\n\nTest output:\n${failureText}` }],
        },
      ],
    });

    if (response.stop_reason === 'max_tokens') {
      return null;
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;

    const parsed = safeJsonParse(textBlock.text);
    if (!parsed.success || !parsed.data) return null;

    const data = parsed.data;

    // Validate required fields
    if (
      typeof data.failure_summary !== 'string' ||
      !Array.isArray(data.likely_causes) ||
      !Array.isArray(data.affected_files)
    ) {
      return null;
    }

    return {
      failure_summary: data.failure_summary,
      likely_causes: data.likely_causes.slice(0, 4),
      affected_files: data.affected_files.slice(0, 5),
      root_cause_file: typeof data.root_cause_file === 'string' ? data.root_cause_file : undefined,
      suggested_fix_approach: typeof data.suggested_fix_approach === 'string'
        ? data.suggested_fix_approach
        : 'Review error messages and adjust implementation',
      confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
    };
  }

  /**
   * V1 heuristic diagnosis — deterministic pattern matching (no LLM).
   */
  private diagnoseHeuristic(): DiagnosisResult {
    const { stderr, stdout, summary } = this.lastTestFailure!;

    const failureText = stderr || stdout;
    const lines = failureText.split('\n').filter(line => line.trim());

    const errorLines = lines.filter(line =>
      line.includes('Error') ||
      line.includes('FAIL') ||
      line.includes('failed') ||
      line.includes('\u2717') ||
      line.includes('\u00d7') ||
      line.includes('expected') ||
      line.includes('AssertionError')
    );

    const fileMatches = failureText.match(/[\w\-_/.]+\.(ts|js|tsx|jsx|json|md|txt)/g) || [];
    const affectedFiles = Array.from(new Set(fileMatches)).slice(0, 5);

    return {
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
  }

  /**
   * Propose a repair fix — tries LLM first, falls back to heuristic.
   */
  private async proposeRepairFix(
    mode: Mode,
    stage: Stage,
    diagnosis: DiagnosisResult
  ): Promise<string | null> {
    if (this.llmClient && this.readFile) {
      try {
        const llmResult = await this.generateLLMFix(diagnosis);
        if (llmResult) {
          return llmResult;
        }
      } catch {
        // Fall through to heuristic
      }
    }

    return this.proposeHeuristicFix(mode, stage, diagnosis);
  }

  /**
   * LLM-powered code fix generation using EDIT_MODEL (Sonnet 4).
   * Reads affected files, asks LLM to generate fixes, converts to FileDiff[].
   */
  private async generateLLMFix(diagnosis: DiagnosisResult): Promise<string | null> {
    if (!this.llmClient || !this.readFile) return null;

    // Read affected files for context
    const fileContents = await this.readAffectedFiles(diagnosis.affected_files);

    const fileContext = fileContents
      .map(f => `=== ${f.path} ===\n${f.content}`)
      .join('\n\n');

    const { stderr, stdout, command } = this.lastTestFailure!;
    const failureText = (stderr || stdout).substring(0, 4000);

    const systemPrompt = `You are a code repair assistant. Given a test failure diagnosis and the relevant source files, generate the minimal code fixes needed to make the tests pass.

Return ONLY valid JSON with this structure:
{
  "touched_files": [
    {
      "path": "relative/path/to/file.ts",
      "action": "modify" | "create",
      "new_content": "full file content after fix"
    }
  ],
  "explanation": "brief explanation of what was fixed",
  "confidence": 0.0-1.0
}

Rules:
- Only modify files that need changes
- Return the COMPLETE new file content for each modified file
- Keep changes minimal — fix only what's needed to resolve the test failure
- Maximum 5 files`;

    const userMessage = `## Diagnosis
Failure: ${diagnosis.failure_summary}
Likely causes: ${diagnosis.likely_causes.join('; ')}
Root cause file: ${diagnosis.root_cause_file || 'unknown'}
Suggested approach: ${diagnosis.suggested_fix_approach}

## Test output
Command: ${command}
${failureText}

## Source files
${fileContext}`;

    const response = await this.llmClient.createMessage({
      model: EDIT_MODEL,
      max_tokens: 16384,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: userMessage }],
        },
      ],
    });

    if (response.stop_reason === 'max_tokens') {
      return null;
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;

    const parsed = safeJsonParse(textBlock.text);
    if (!parsed.success || !parsed.data) return null;

    const data = parsed.data;
    if (!Array.isArray(data.touched_files) || data.touched_files.length === 0) return null;

    // Convert touched_files to FileDiff[]
    const diffs: FileDiff[] = [];
    for (const file of data.touched_files.slice(0, 5)) {
      if (typeof file.path !== 'string' || typeof file.new_content !== 'string') continue;

      if (file.action === 'create') {
        diffs.push({
          file_path: file.path,
          operation: 'create',
          new_content: file.new_content,
        });
      } else {
        // modify — read old content
        let oldContent: string | undefined;
        try {
          const content = await this.readFile!(file.path);
          if (content !== null) {
            oldContent = content;
          }
        } catch {
          // If we can't read, treat as create
        }

        diffs.push({
          file_path: file.path,
          operation: oldContent !== undefined ? 'modify' : 'create',
          old_content: oldContent,
          new_content: file.new_content,
        });
      }
    }

    if (diffs.length === 0) return null;

    const iteration = this.autonomyController.getCurrentIteration();
    const explanation = typeof data.explanation === 'string' ? data.explanation : diagnosis.failure_summary;

    // Propose diff using DiffManager
    const proposalId = await this.diffManager.proposeDiff(
      'MISSION' as Mode,
      'repair' as Stage,
      `A1 Repair Attempt ${iteration}: ${explanation.substring(0, 60)}`,
      diffs,
      true
    );

    return proposalId;
  }

  /**
   * Read up to 5 affected files via the injected readFile function.
   * Each file is truncated to 500 lines.
   */
  private async readAffectedFiles(filePaths: string[]): Promise<Array<{ path: string; content: string }>> {
    if (!this.readFile) return [];

    const results: Array<{ path: string; content: string }> = [];

    for (const filePath of filePaths.slice(0, 5)) {
      // Skip placeholder entries
      if (filePath.startsWith('(')) continue;

      try {
        const content = await this.readFile(filePath);
        if (content !== null) {
          // Truncate to 500 lines
          const lines = content.split('\n');
          const truncated = lines.length > 500
            ? lines.slice(0, 500).join('\n') + '\n... (truncated)'
            : content;
          results.push({ path: filePath, content: truncated });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * V1 heuristic fix proposal — creates a markdown document (no LLM).
   */
  private async proposeHeuristicFix(
    mode: Mode,
    stage: Stage,
    diagnosis: DiagnosisResult
  ): Promise<string | null> {
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

    const diff: FileDiff = {
      file_path: targetPath,
      operation: 'create',
      new_content: proposalContent,
    };

    const proposalId = await this.diffManager.proposeDiff(
      mode,
      stage,
      `A1 Repair Attempt ${iteration}: ${diagnosis.failure_summary.substring(0, 60)}...`,
      [diff],
      true
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
