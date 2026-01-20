/**
 * TestRunner: Deterministic test command detection and execution with approval gating
 * Based on Step 17 requirements
 * 
 * Requirements:
 * - Detect test commands from package.json
 * - Execute with approval gating
 * - Capture outputs as evidence
 * - Emit appropriate events (tool_start, tool_end, failure_detected)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventBus } from './eventBus';
import { ApprovalManager } from './approvalManager';
import { Event, Mode, Stage, Evidence } from './types';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Test command detection result
 */
export interface TestCommand {
  command: string;
  type: 'test' | 'lint' | 'typecheck' | 'build';
  found: boolean;
  reason?: string;
}

/**
 * Test execution result
 */
export interface TestResult {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  command: string;
}

/**
 * Evidence store interface for test outputs
 */
export interface TestEvidenceStore {
  storeTestOutput(
    taskId: string,
    command: string,
    result: TestResult,
    sourceEventId: string
  ): Promise<string>;
}

/**
 * Simple file-based evidence store for test outputs
 */
export class FileTestEvidenceStore implements TestEvidenceStore {
  constructor(private readonly evidenceDir: string) {}

  async storeTestOutput(
    taskId: string,
    command: string,
    result: TestResult,
    sourceEventId: string
  ): Promise<string> {
    const evidenceId = randomUUID();
    const timestamp = new Date().toISOString();
    
    // Create evidence directory if needed
    await fs.mkdir(this.evidenceDir, { recursive: true });

    // Store the full output
    const outputPath = path.join(this.evidenceDir, `test_${evidenceId}.log`);
    const outputContent = [
      `Command: ${command}`,
      `Exit Code: ${result.exit_code}`,
      `Duration: ${result.duration_ms}ms`,
      `Timestamp: ${timestamp}`,
      '',
      '=== STDOUT ===',
      result.stdout,
      '',
      '=== STDERR ===',
      result.stderr,
    ].join('\n');

    await fs.writeFile(outputPath, outputContent, 'utf-8');

    return evidenceId;
  }
}

/**
 * TestRunner coordinates test execution with approval gating and evidence capture
 */
export class TestRunner {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly approvalManager: ApprovalManager;
  private readonly evidenceStore: TestEvidenceStore;
  private readonly workspaceRoot: string;

  constructor(
    taskId: string,
    eventBus: EventBus,
    approvalManager: ApprovalManager,
    evidenceStore: TestEvidenceStore,
    workspaceRoot: string
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.approvalManager = approvalManager;
    this.evidenceStore = evidenceStore;
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Detect test command from package.json using deterministic strategy
   * Preference order: test > lint > typecheck
   */
  async detectTestCommand(): Promise<TestCommand> {
    try {
      const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
      
      // Check if package.json exists
      try {
        await fs.access(packageJsonPath);
      } catch {
        return {
          command: '',
          type: 'test',
          found: false,
          reason: 'No package.json found in workspace root',
        };
      }

      // Parse package.json
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      const scripts = packageJson.scripts || {};

      // Deterministic preference order
      if (scripts.test) {
        return {
          command: 'npm test',
          type: 'test',
          found: true,
        };
      }

      if (scripts.lint) {
        return {
          command: 'npm run lint',
          type: 'lint',
          found: true,
        };
      }

      if (scripts.typecheck) {
        return {
          command: 'npm run typecheck',
          type: 'typecheck',
          found: true,
        };
      }

      // No known test command found
      return {
        command: '',
        type: 'test',
        found: false,
        reason: 'No test, lint, or typecheck scripts found in package.json',
      };
    } catch (error) {
      return {
        command: '',
        type: 'test',
        found: false,
        reason: `Error detecting test command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Run tests with full approval gating and evidence capture
   */
  async runTests(mode: Mode, stage: Stage): Promise<TestResult | null> {
    // 1. Detect test command
    const testCommand = await this.detectTestCommand();

    if (!testCommand.found) {
      // No test command - not a failure, just emit info
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'tool_end',
        mode,
        stage,
        payload: {
          tool: 'test_detection',
          success: false,
          message: testCommand.reason || 'No test runner detected',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      return null;
    }

    // 2. Request approval
    const approval = await this.approvalManager.requestApproval(
      this.taskId,
      mode,
      stage,
      'terminal',
      'Run tests after applying diff',
      {
        command: testCommand.command,
        risk_level: 'med',
      }
    );

    if (approval.decision === 'denied') {
      // User rejected - don't run anything
      return null;
    }

    // 3. Ensure we're in test stage
    if (stage !== 'test') {
      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'stage_changed',
        mode,
        stage: 'test',
        payload: {
          from: stage,
          to: 'test',
        },
        evidence_ids: [],
        parent_event_id: null,
      });
    }

    // 4. Emit tool_start
    const toolStartEventId = randomUUID();
    const startTime = Date.now();

    await this.emitEvent({
      event_id: toolStartEventId,
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      mode,
      stage: 'test',
      payload: {
        tool: 'terminal',
        command: testCommand.command,
        category: 'exec',
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // 5. Execute command
    let result: TestResult;
    try {
      const { stdout, stderr } = await execAsync(testCommand.command, {
        cwd: this.workspaceRoot,
        timeout: 60000, // 60 second timeout
        env: { ...process.env, CI: 'true' }, // Set CI to prevent interactive prompts
      });

      const duration = Date.now() - startTime;
      result = {
        success: true,
        exit_code: 0,
        stdout,
        stderr,
        duration_ms: duration,
        command: testCommand.command,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      result = {
        success: false,
        exit_code: error.code || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        duration_ms: duration,
        command: testCommand.command,
      };
    }

    // 6. Capture evidence
    const evidenceId = await this.evidenceStore.storeTestOutput(
      this.taskId,
      testCommand.command,
      result,
      toolStartEventId
    );

    // 7. Emit tool_end
    await this.emitEvent({
      event_id: randomUUID(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: 'tool_end',
      mode,
      stage: 'test',
      payload: {
        tool: 'terminal',
        command: testCommand.command,
        exit_code: result.exit_code,
        success: result.success,
        duration_ms: result.duration_ms,
      },
      evidence_ids: [evidenceId],
      parent_event_id: toolStartEventId,
    });

    // 8. If failed, emit failure_detected
    if (!result.success) {
      const errorSummary = this.extractErrorSummary(result.stderr, result.stdout);

      await this.emitEvent({
        event_id: randomUUID(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode,
        stage: 'test',
        payload: {
          kind: 'tests_failed',
          command: testCommand.command,
          exit_code: result.exit_code,
          summary: errorSummary,
        },
        evidence_ids: [evidenceId],
        parent_event_id: toolStartEventId,
      });
    }

    return result;
  }

  /**
   * Extract first-line error summary from test output
   */
  private extractErrorSummary(stderr: string, stdout: string): string {
    // Try stderr first
    if (stderr) {
      const lines = stderr.split('\n').filter(line => line.trim());
      if (lines.length > 0) {
        return lines[0].substring(0, 200); // First line, max 200 chars
      }
    }

    // Fall back to stdout
    if (stdout) {
      const lines = stdout.split('\n').filter(line => line.trim());
      // Look for common error patterns
      for (const line of lines) {
        if (
          line.includes('FAIL') ||
          line.includes('Error') ||
          line.includes('failed') ||
          line.includes('✗') ||
          line.includes('×')
        ) {
          return line.substring(0, 200);
        }
      }
      // If no error pattern, return first non-empty line
      if (lines.length > 0) {
        return lines[0].substring(0, 200);
      }
    }

    return 'Test execution failed (see evidence for details)';
  }

  /**
   * Emit event via EventBus
   */
  private async emitEvent(event: Event): Promise<void> {
    await this.eventBus.publish(event);
  }
}
