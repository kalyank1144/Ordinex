/**
 * SystemsViewModel: Pure reducer from events to operational truth
 * Step 29: Systems Tab (Real-time operational truth from events)
 * 
 * Requirements:
 * - Single-pass deterministic reduction over events
 * - No I/O, no LLM calls, no hidden state
 * - Replay-safe: same events → same output
 * - Everything derived from events
 */

import { Event, Stage, Mode } from './types';

// ============================================================================
// SYSTEMS VIEW MODEL INTERFACES
// ============================================================================

/**
 * Retrieved file with location info
 */
export interface RetrievedFile {
  file: string;
  startLine: number;
  endLine: number;
  reason: string;
}

/**
 * Pending approval info
 */
export interface PendingApproval {
  approvalId: string;
  type: string;
  description: string;
  requestedAt: string;
}

/**
 * Pending decision point info
 */
export interface PendingDecisionPoint {
  decisionId: string;
  description: string;
  options: string[];
  requestedAt: string;
}

/**
 * Diff info (proposed or applied)
 */
export interface DiffInfo {
  diffId: string;
  filesChanged: string[];
  timestamp: string;
  success?: boolean;
  kind?: string; // 'edit' | 'repair'
}

/**
 * Checkpoint info
 */
export interface CheckpointInfo {
  checkpointId: string;
  timestamp: string;
}

/**
 * Test result info
 */
export interface TestInfo {
  command: string;
  timestamp: string;
  passed: boolean;
  exitCode?: number;
  summary?: string;
}

/**
 * Failure info
 */
export interface FailureInfo {
  summary: string;
  timestamp: string;
  category?: string;
  signature?: string;
}

/**
 * Timeout info
 */
export interface TimeoutInfo {
  stage: string;
  timestamp: string;
  configuredMs?: number;
}

/**
 * SystemsViewModel: Complete operational truth derived from events
 * 
 * Sections:
 * 1. Status - mission, stage, running/paused/completed/cancelled
 * 2. WaitingFor - pending approvals and decision points
 * 3. Scope - workspace roots, allowed roots, expansions, denied patterns
 * 4. ContextIncluded - retrieved files, token estimate
 * 5. Changes - diffs proposed/applied, checkpoints
 * 6. TestsAndRepair - test results, repair attempts, allowlisted commands
 * 7. ToolActivity - counts per tool type
 * 8. Timeouts - stage timeout config, last timeout
 */
export interface SystemsViewModel {
  // 1. Status
  status: {
    currentMission: string | null;
    missionGoal: string | null;
    currentStage: Stage;
    runStatus: 'running' | 'paused' | 'completed' | 'cancelled' | 'idle';
    pausedReason: string | null;
    currentStep: {
      index: number;
      description: string;
    } | null;
  };

  // 2. Waiting For
  waitingFor: {
    pendingApprovals: PendingApproval[];
    pendingDecisionPoints: PendingDecisionPoint[];
  };

  // 3. Scope
  scope: {
    workspaceRoots: string[];
    allowedCreateRoots: string[];
    deniedPatterns: string[];
    approvedExpansions: string[];
    maxFiles: number;
    maxLines: number;
    currentFilesInScope: number;
    currentLinesRetrieved: number;
  };

  // 4. Context Included
  contextIncluded: {
    retrievedFiles: RetrievedFile[];
    totalFiles: number;
    totalLines: number;
    tokenEstimate: number | null;
    totalCharacters: number | null;
  };

  // 5. Changes
  changes: {
    lastDiffProposed: DiffInfo | null;
    lastDiffApplied: DiffInfo | null;
    diffsProposedCount: number;
    diffsAppliedCount: number;
    filesChangedTotal: string[];
    checkpointsCreated: number;
    lastCheckpoint: CheckpointInfo | null;
  };

  // 6. Tests & Repair
  testsAndRepair: {
    lastTestRun: TestInfo | null;
    testsRan: number;
    testsPassed: number;
    testsFailed: number;
    allowlistedCommands: string[];
    repairAttempts: {
      used: number;
      remaining: number;
      max: number;
    };
    lastFailure: FailureInfo | null;
    failureCount: number;
  };

  // 7. Tool Activity
  toolActivity: {
    counts: Record<string, number>;
    totalCalls: number;
    lastToolCall: {
      tool: string;
      timestamp: string;
      success: boolean;
    } | null;
  };

  // 8. Timeouts
  timeouts: {
    stageTimeoutMs: number | null;
    lastTimeout: TimeoutInfo | null;
    timeoutCount: number;
  };
}

// ============================================================================
// DEFAULT / INITIAL STATE
// ============================================================================

/**
 * Create initial empty SystemsViewModel
 */
function createInitialViewModel(): SystemsViewModel {
  return {
    status: {
      currentMission: null,
      missionGoal: null,
      currentStage: 'none',
      runStatus: 'idle',
      pausedReason: null,
      currentStep: null,
    },
    waitingFor: {
      pendingApprovals: [],
      pendingDecisionPoints: [],
    },
    scope: {
      workspaceRoots: [],
      allowedCreateRoots: [],
      deniedPatterns: [],
      approvedExpansions: [],
      maxFiles: 10,
      maxLines: 1000,
      currentFilesInScope: 0,
      currentLinesRetrieved: 0,
    },
    contextIncluded: {
      retrievedFiles: [],
      totalFiles: 0,
      totalLines: 0,
      tokenEstimate: null,
      totalCharacters: null,
    },
    changes: {
      lastDiffProposed: null,
      lastDiffApplied: null,
      diffsProposedCount: 0,
      diffsAppliedCount: 0,
      filesChangedTotal: [],
      checkpointsCreated: 0,
      lastCheckpoint: null,
    },
    testsAndRepair: {
      lastTestRun: null,
      testsRan: 0,
      testsPassed: 0,
      testsFailed: 0,
      allowlistedCommands: [],
      repairAttempts: {
        used: 0,
        remaining: 3, // Default, will be overridden by repair_policy_snapshot
        max: 3,
      },
      lastFailure: null,
      failureCount: 0,
    },
    toolActivity: {
      counts: {},
      totalCalls: 0,
      lastToolCall: null,
    },
    timeouts: {
      stageTimeoutMs: null,
      lastTimeout: null,
      timeoutCount: 0,
    },
  };
}

// ============================================================================
// REDUCER: SINGLE-PASS PURE FUNCTION
// ============================================================================

/**
 * Reduce events to SystemsViewModel
 * 
 * CRITICAL: This is a pure function with no side effects.
 * Given the same events array, it MUST produce the same SystemsViewModel.
 * 
 * @param events - Array of events to reduce
 * @returns SystemsViewModel derived entirely from events
 */
export function reduceToSystemsViewModel(events: Event[]): SystemsViewModel {
  const vm = createInitialViewModel();

  // Track resolved approval IDs for filtering pending approvals
  const resolvedApprovalIds = new Set<string>();
  const resolvedDecisionIds = new Set<string>();

  // First pass: collect resolved IDs
  for (const event of events) {
    if (event.type === 'approval_resolved') {
      const approvalId = event.payload.approval_id as string | undefined;
      if (approvalId) {
        resolvedApprovalIds.add(approvalId);
      }
    }
    // Decision points can be resolved via clarification_received or approval_resolved
    if (event.type === 'clarification_received') {
      const decisionId = event.payload.decision_id as string | undefined;
      if (decisionId) {
        resolvedDecisionIds.add(decisionId);
      }
    }
  }

  // Second pass: process all events
  for (const event of events) {
    processEvent(vm, event, resolvedApprovalIds, resolvedDecisionIds);
  }

  // Calculate repair remaining
  vm.testsAndRepair.repairAttempts.remaining = Math.max(
    0,
    vm.testsAndRepair.repairAttempts.max - vm.testsAndRepair.repairAttempts.used
  );

  return vm;
}

/**
 * Process a single event and update the view model
 */
function processEvent(
  vm: SystemsViewModel,
  event: Event,
  resolvedApprovalIds: Set<string>,
  resolvedDecisionIds: Set<string>
): void {
  const payload = event.payload;

  switch (event.type) {
    // ========== STATUS EVENTS ==========
    case 'mission_started':
      vm.status.currentMission = (payload.mission_id as string) || null;
      vm.status.missionGoal = (payload.goal as string) || null;
      vm.status.runStatus = 'running';
      vm.status.pausedReason = null;
      break;

    case 'mission_completed':
      vm.status.runStatus = 'completed';
      vm.status.pausedReason = null;
      break;

    case 'mission_paused':
      vm.status.runStatus = 'paused';
      vm.status.pausedReason = (payload.reason as string) || 'Paused';
      break;

    case 'mission_cancelled':
      vm.status.runStatus = 'cancelled';
      vm.status.pausedReason = null;
      break;

    case 'execution_paused':
      vm.status.runStatus = 'paused';
      vm.status.pausedReason = (payload.reason as string) || 'Paused';
      break;

    case 'execution_resumed':
      vm.status.runStatus = 'running';
      vm.status.pausedReason = null;
      break;

    case 'stage_changed':
      vm.status.currentStage = (payload.to as Stage) || (payload.stage as Stage) || event.stage;
      break;

    case 'step_started':
      vm.status.currentStep = {
        index: (payload.step_index as number) || 0,
        description: (payload.description as string) || '',
      };
      break;

    case 'step_completed':
    case 'step_failed':
      // Step done, clear current step
      vm.status.currentStep = null;
      break;

    case 'final':
      vm.status.runStatus = 'completed';
      break;

    // ========== SCOPE EVENTS ==========
    case 'run_scope_initialized':
      vm.scope.workspaceRoots = (payload.workspaceRoots as string[]) || [];
      vm.scope.allowedCreateRoots = (payload.allowedCreateRoots as string[]) || [];
      vm.scope.deniedPatterns = (payload.deniedPatterns as string[]) || [];
      if (payload.maxFiles) vm.scope.maxFiles = payload.maxFiles as number;
      if (payload.maxLines) vm.scope.maxLines = payload.maxLines as number;
      break;

    case 'scope_expansion_resolved':
      if (payload.approved) {
        const requested = payload.requested as { files?: string[]; lines?: number } | undefined;
        if (requested?.files) {
          for (const f of requested.files) {
            if (!vm.scope.approvedExpansions.includes(f)) {
              vm.scope.approvedExpansions.push(f);
            }
          }
        }
        // Also track expanded scope in reason
        const reason = payload.reason as string | undefined;
        if (reason && !vm.scope.approvedExpansions.includes(reason)) {
          vm.scope.approvedExpansions.push(reason);
        }
      }
      break;

    // ========== CONTEXT / RETRIEVAL EVENTS ==========
    case 'retrieval_completed':
      const results = payload.results as RetrievedFile[] | undefined;
      if (results && Array.isArray(results)) {
        for (const r of results) {
          // Avoid duplicates
          const exists = vm.contextIncluded.retrievedFiles.some(
            f => f.file === r.file && f.startLine === r.startLine && f.endLine === r.endLine
          );
          if (!exists) {
            vm.contextIncluded.retrievedFiles.push({
              file: r.file,
              startLine: r.startLine,
              endLine: r.endLine,
              reason: r.reason || 'lexical_match',
            });
          }
        }
      }
      // Update counts
      const resultCount = (payload.result_count as number) || (payload.results_count as number) || 0;
      const totalLines = (payload.total_lines as number) || 0;
      vm.contextIncluded.totalFiles = Math.max(vm.contextIncluded.totalFiles, resultCount);
      vm.contextIncluded.totalLines += totalLines;
      vm.scope.currentFilesInScope = vm.contextIncluded.retrievedFiles.length;
      vm.scope.currentLinesRetrieved = vm.contextIncluded.totalLines;

      // Token estimate (if present)
      if (payload.tokenEstimate !== undefined) {
        vm.contextIncluded.tokenEstimate = payload.tokenEstimate as number;
      }
      if (payload.totalCharacters !== undefined) {
        vm.contextIncluded.totalCharacters = payload.totalCharacters as number;
      }
      break;

    case 'context_collected':
      // ANSWER/PLAN mode context collection
      const filesIncluded = payload.files_included as Array<{ path: string; lines?: number }> | undefined;
      if (filesIncluded && Array.isArray(filesIncluded)) {
        for (const f of filesIncluded) {
          const exists = vm.contextIncluded.retrievedFiles.some(rf => rf.file === f.path);
          if (!exists) {
            vm.contextIncluded.retrievedFiles.push({
              file: f.path,
              startLine: 1,
              endLine: f.lines || 100,
              reason: 'context_collected',
            });
          }
        }
      }
      if (payload.total_lines) {
        vm.contextIncluded.totalLines = payload.total_lines as number;
        vm.scope.currentLinesRetrieved = vm.contextIncluded.totalLines;
      }
      if (payload.tokenEstimate !== undefined) {
        vm.contextIncluded.tokenEstimate = payload.tokenEstimate as number;
      }
      vm.scope.currentFilesInScope = vm.contextIncluded.retrievedFiles.length;
      break;

    // ========== APPROVAL EVENTS ==========
    case 'approval_requested':
      const approvalId = payload.approval_id as string | undefined;
      if (approvalId && !resolvedApprovalIds.has(approvalId)) {
        vm.waitingFor.pendingApprovals.push({
          approvalId,
          type: (payload.approval_type as string) || 'unknown',
          description: (payload.description as string) || '',
          requestedAt: event.timestamp,
        });
        vm.status.runStatus = 'paused';
        vm.status.pausedReason = `Awaiting approval: ${(payload.approval_type as string) || 'action'}`;
      }
      // Track allowlisted commands for test approvals
      if (payload.approval_type === 'run_tests' || payload.approval_type === 'terminal') {
        const command = payload.command as string | undefined;
        if (command && !vm.testsAndRepair.allowlistedCommands.includes(command)) {
          // Will be marked as allowlisted when approved
        }
      }
      break;

    case 'approval_resolved':
      const resolvedApprovalId = payload.approval_id as string | undefined;
      if (resolvedApprovalId) {
        // Remove from pending
        vm.waitingFor.pendingApprovals = vm.waitingFor.pendingApprovals.filter(
          a => a.approvalId !== resolvedApprovalId
        );
        // Check if all approvals resolved
        if (vm.waitingFor.pendingApprovals.length === 0 && vm.waitingFor.pendingDecisionPoints.length === 0) {
          vm.status.runStatus = 'running';
          vm.status.pausedReason = null;
        }
        // Track allowlisted commands
        if (payload.approved && (payload.approval_type === 'run_tests' || payload.approval_type === 'terminal')) {
          const command = (payload.command as string) || (payload.details as { command?: string } | undefined)?.command;
          if (command && !vm.testsAndRepair.allowlistedCommands.includes(command)) {
            vm.testsAndRepair.allowlistedCommands.push(command);
          }
        }
      }
      break;

    // ========== DECISION POINT EVENTS ==========
    case 'decision_point_needed':
      const decisionId = payload.decision_id as string | undefined;
      if (decisionId && !resolvedDecisionIds.has(decisionId)) {
        vm.waitingFor.pendingDecisionPoints.push({
          decisionId,
          description: (payload.description as string) || '',
          options: (payload.options as string[]) || [],
          requestedAt: event.timestamp,
        });
        vm.status.runStatus = 'paused';
        vm.status.pausedReason = 'Awaiting decision';
      }
      break;

    case 'clarification_received':
      const resolvedDecisionId = payload.decision_id as string | undefined;
      if (resolvedDecisionId) {
        vm.waitingFor.pendingDecisionPoints = vm.waitingFor.pendingDecisionPoints.filter(
          d => d.decisionId !== resolvedDecisionId
        );
        if (vm.waitingFor.pendingApprovals.length === 0 && vm.waitingFor.pendingDecisionPoints.length === 0) {
          vm.status.runStatus = 'running';
          vm.status.pausedReason = null;
        }
      }
      break;

    // ========== DIFF / CHANGE EVENTS ==========
    case 'diff_proposed':
      const proposedDiffId = (payload.diff_id as string) || event.event_id;
      const filesChanged = (payload.files_changed as Array<string | { path: string }>) || [];
      const filesList = filesChanged.map(f => typeof f === 'string' ? f : f.path);
      
      vm.changes.lastDiffProposed = {
        diffId: proposedDiffId,
        filesChanged: filesList,
        timestamp: event.timestamp,
        kind: (payload.kind as string) || 'edit',
      };
      vm.changes.diffsProposedCount++;
      break;

    case 'diff_applied':
      const appliedDiffId = (payload.diff_id as string) || event.event_id;
      const appliedFiles = (payload.files_changed as Array<string | { path: string }>) || [];
      const appliedFilesList = appliedFiles.map(f => typeof f === 'string' ? f : f.path);
      const success = payload.success !== false;
      
      vm.changes.lastDiffApplied = {
        diffId: appliedDiffId,
        filesChanged: appliedFilesList,
        timestamp: event.timestamp,
        success,
        kind: (payload.kind as string) || 'edit',
      };
      vm.changes.diffsAppliedCount++;
      
      // Track all files changed
      for (const f of appliedFilesList) {
        if (!vm.changes.filesChangedTotal.includes(f)) {
          vm.changes.filesChangedTotal.push(f);
        }
      }
      
      // If this is a repair diff, increment repair used
      if (payload.kind === 'repair') {
        vm.testsAndRepair.repairAttempts.used++;
      }
      break;

    case 'checkpoint_created':
      const checkpointId = (payload.checkpoint_id as string) || event.event_id;
      vm.changes.lastCheckpoint = {
        checkpointId,
        timestamp: event.timestamp,
      };
      vm.changes.checkpointsCreated++;
      break;

    // ========== TEST EVENTS ==========
    case 'test_started':
      const testCommand = payload.command as string | undefined;
      if (testCommand && !vm.testsAndRepair.allowlistedCommands.includes(testCommand)) {
        vm.testsAndRepair.allowlistedCommands.push(testCommand);
      }
      break;

    case 'test_completed':
      vm.testsAndRepair.lastTestRun = {
        command: (payload.command as string) || '',
        timestamp: event.timestamp,
        passed: true,
        exitCode: (payload.exit_code as number) || 0,
        summary: (payload.summary as string) || 'Tests passed',
      };
      vm.testsAndRepair.testsRan++;
      vm.testsAndRepair.testsPassed++;
      break;

    case 'test_failed':
      vm.testsAndRepair.lastTestRun = {
        command: (payload.command as string) || '',
        timestamp: event.timestamp,
        passed: false,
        exitCode: (payload.exit_code as number) || 1,
        summary: (payload.summary as string) || (payload.error as string) || 'Tests failed',
      };
      vm.testsAndRepair.testsRan++;
      vm.testsAndRepair.testsFailed++;
      break;

    // ========== REPAIR / FAILURE EVENTS ==========
    case 'repair_policy_snapshot':
      vm.testsAndRepair.repairAttempts.max = (payload.maxRepairIterations as number) || 3;
      break;

    case 'repair_attempt_started':
      vm.testsAndRepair.repairAttempts.used++;
      break;

    case 'repair_attempt_completed':
      // Repair attempt finished (success tracked via follow-up events)
      break;

    case 'failure_detected':
      vm.testsAndRepair.lastFailure = {
        summary: (payload.error as string) || (payload.message as string) || 'Failure detected',
        timestamp: event.timestamp,
        category: (payload.category as string) || 'unknown',
      };
      vm.testsAndRepair.failureCount++;
      break;

    case 'failure_classified':
      vm.testsAndRepair.lastFailure = {
        summary: (payload.summary as string) || (payload.error as string) || 'Failure',
        timestamp: event.timestamp,
        category: (payload.category as string) || 'unknown',
        signature: (payload.signature as string) || undefined,
      };
      break;

    case 'repeated_failure_detected':
      vm.status.runStatus = 'paused';
      vm.status.pausedReason = 'Repeated failure detected';
      break;

    // ========== TOOL ACTIVITY EVENTS ==========
    case 'tool_start':
      const toolName = (payload.tool as string) || (payload.tool_name as string) || 'unknown';
      vm.toolActivity.counts[toolName] = (vm.toolActivity.counts[toolName] || 0) + 1;
      vm.toolActivity.totalCalls++;
      vm.toolActivity.lastToolCall = {
        tool: toolName,
        timestamp: event.timestamp,
        success: true, // Assume success until tool_end
      };
      break;

    case 'tool_end':
      const endToolName = (payload.tool as string) || (payload.tool_name as string) || 'unknown';
      const toolSuccess = payload.success !== false;
      if (vm.toolActivity.lastToolCall && vm.toolActivity.lastToolCall.tool === endToolName) {
        vm.toolActivity.lastToolCall.success = toolSuccess;
      }
      break;

    // ========== TIMEOUT EVENTS ==========
    case 'stage_timeout':
      const timeoutStage = (payload.stage as string) || event.stage;
      vm.timeouts.lastTimeout = {
        stage: timeoutStage,
        timestamp: event.timestamp,
        configuredMs: (payload.timeout_ms as number) || undefined,
      };
      vm.timeouts.timeoutCount++;
      vm.status.runStatus = 'paused';
      vm.status.pausedReason = `Stage timeout: ${timeoutStage}`;
      break;

    // Default: no-op for unhandled events
    default:
      // Unknown events are logged but don't change view model
      break;
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR UI
// ============================================================================

/**
 * Get top N retrieved files
 */
export function getTopRetrievedFiles(vm: SystemsViewModel, count: number = 5): RetrievedFile[] {
  return vm.contextIncluded.retrievedFiles.slice(0, count);
}

/**
 * Check if there are more files than the top N
 */
export function hasMoreRetrievedFiles(vm: SystemsViewModel, topCount: number = 5): boolean {
  return vm.contextIncluded.retrievedFiles.length > topCount;
}

/**
 * Get all unique file paths that have been changed
 */
export function getAllChangedFiles(vm: SystemsViewModel): string[] {
  return [...vm.changes.filesChangedTotal];
}

/**
 * Get human-friendly status summary
 */
export function getStatusSummary(vm: SystemsViewModel): string {
  const { runStatus, currentStage, pausedReason } = vm.status;
  
  switch (runStatus) {
    case 'idle':
      return 'Ready';
    case 'running':
      return currentStage !== 'none' ? `Running: ${currentStage}` : 'Running';
    case 'paused':
      return pausedReason || 'Paused';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

/**
 * Get waiting summary for UI display
 */
export function getWaitingSummary(vm: SystemsViewModel): string | null {
  const approvalCount = vm.waitingFor.pendingApprovals.length;
  const decisionCount = vm.waitingFor.pendingDecisionPoints.length;
  
  if (approvalCount === 0 && decisionCount === 0) {
    return null;
  }
  
  const parts: string[] = [];
  if (approvalCount > 0) {
    parts.push(`${approvalCount} approval${approvalCount > 1 ? 's' : ''}`);
  }
  if (decisionCount > 0) {
    parts.push(`${decisionCount} decision${decisionCount > 1 ? 's' : ''}`);
  }
  
  return `Waiting for: ${parts.join(', ')}`;
}

/**
 * Format token estimate for display
 */
export function formatTokenEstimate(tokenEstimate: number | null): string {
  if (tokenEstimate === null) return '';
  if (tokenEstimate < 1000) return `~${tokenEstimate} tokens`;
  return `~${(tokenEstimate / 1000).toFixed(1)}k tokens`;
}
