/**
 * Ordinex Core - Event-Sourcing Foundation
 * 
 * This package provides the deterministic, event-driven core for Ordinex.
 * All components are based on 03_API_DATA_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 */

export const version = '0.0.0';

// Export types
export * from './types';

// Export event-sourcing components
export { EventStore } from './eventStore';
export { EventBus, EventSubscriber } from './eventBus';
export { StateReducer, createStateReducer } from './stateReducer';
export { ScopeManager, DEFAULT_SCOPE_CONTRACT } from './scopeManager';
export type { ScopeValidationResult } from './scopeManager';

// Export lifecycle and mode management
export { TaskLifecycleController, TaskLifecycleState } from './taskLifecycle';
export { ModeManager, Action, ModeValidationResult } from './modeManager';

// Export approval and checkpoint managers
export { 
  ApprovalManager, 
  ApprovalType, 
  ApprovalDecision, 
  ApprovalScope,
  ApprovalRequest,
  ApprovalResolution 
} from './approvalManager';
export { 
  CheckpointManager, 
  RestoreMethod, 
  CheckpointMetadata, 
  CheckpointSnapshot 
} from './checkpointManager';

// Export retrieval components
export { Indexer } from './retrieval/indexer';
export { Retriever } from './retrieval/retriever';
export * from './retrieval/types';

// Export tool execution and diff management
export {
  ToolExecutor,
  InMemoryEvidenceStore,
  ToolResult,
  ToolInvocation,
  EvidenceStore
} from './toolExecutor';
export {
  DiffManager,
  DiffOperation,
  FileDiff,
  DiffProposal,
  DiffApplicationResult
} from './diffManager';
export {
  generateDiffProposal,
  isFileInScope,
  validateDiffAgainstScope,
  DiffProposalInput,
  DiffProposalOutput
} from './diffProposalGenerator';

// Export autonomy controller
export {
  AutonomyController,
  DEFAULT_A1_BUDGETS,
  AutonomyBudgets,
  AutonomyState,
  IterationResult,
  PreconditionCheck
} from './autonomyController';

// Export repair orchestrator
export {
  RepairOrchestrator,
  DiagnosisResult,
  RepairIterationResult
} from './repairOrchestrator';

// Export test runner
export {
  TestRunner,
  FileTestEvidenceStore,
  TestCommand,
  TestResult,
  TestEvidenceStore
} from './testRunner';

// Export mode classifier and plan generator
export {
  classifyPrompt,
  classifyPromptV2,
  shouldRequireConfirmation,
  ClassificationResult
} from './modeClassifier';
export {
  ModeConfirmationPolicy,
  modeConfirmationPolicy,
  ConfirmationDecision,
  UserOverride
} from './modeConfirmationPolicy';
export {
  generateTemplatePlan,
  generateLLMPlan,
  refinePlan,
  shouldBreakIntoMissions,
  PlanPayload,
  StructuredPlan
} from './planGenerator';

// Export Plan Version Manager (Step 25)
export {
  PlanVersionManager,
  derivePlanState,
  deriveLargePlanState,
  deriveBreakdownState,
  deriveMissionSelectionState,
  hasBreakdownForLatestPlan,
  isMissionSelectedForLatestPlan,
  CurrentPlanState,
  LargePlanState,
  BreakdownState,
  MissionSelectionState,
  VersionedPlanPayload
} from './planVersionManager';

// Export Large Plan Detector (Step 26)
export {
  detectLargePlan,
  buildPlanTextForAnalysis,
  LARGE_PLAN_CONFIG,
  LargePlanDetectionResult,
  PlanStepForAnalysis,
  RepoSignals
} from './largePlanDetector';

// Export Mission Breakdown Generator (Step 26)
export {
  generateMissionBreakdown,
  MissionV1,
  MissionBreakdown,
  MissionDomain,
  RiskLevel,
  MissionSize
} from './missionBreakdownGenerator';

// Export Decision Store (Step 25)
export {
  DecisionStore,
  generateChangesSummary,
  DecisionRecord,
  PlanRefinementDecision,
  PlanApprovalDecision
} from './decisionStore';

// Export run exporter
export {
  exportRun,
  redactSecrets,
  ExportOptions,
  ExportMetadata,
  ExportResult
} from './runExporter';

// Export LLM service
export {
  LLMService,
  LLMConfig,
  LLMStreamChunk,
  LLMResponse
} from './llmService';

// Export Answer context collector
export {
  collectAnswerContext,
  buildAnswerModeSystemMessage,
  AnswerContextBundle,
  ContextCollectionOptions
} from './answerContextCollector';

// Export Plan context collector
export {
  collectPlanContext,
  buildPlanModeSystemMessage,
  PlanContextBundle,
  PlanContextCollectionOptions
} from './planContextCollector';

// Export Mission executor
export {
  MissionExecutor
} from './missionExecutor';

// Export Mission Runner (Step 27 - Mission Execution Harness)
export {
  MissionRunner,
  MissionRunStage,
  TransitionEvent,
  MissionRunState,
  Mission,
  PatchPlan,
  convertPlanToMission,
  MissionBreakdownItem
} from './missionRunner';

// Export Context Snapshot Manager (Step 27 - Stale Context Detection)
export {
  ContextSnapshotManager,
  ContextSnapshot,
  StalenessResult
} from './contextSnapshotManager';

// Export Self-Correction Loop (Step 28)
export {
  classifyFailure,
  normalizeOutput,
  FailureType,
  FailureClassification,
  ConsecutiveFailureTracker,
} from './failureClassifier';

export {
  SelfCorrectionPolicy,
  DEFAULT_SELF_CORRECTION_POLICY,
  RepairLoopState,
  createRepairLoopState,
  checkStopConditions,
  generateDecisionOptions,
  StopReason,
  DecisionOption,
  RepairAttemptResult,
  RepairAttemptRecord,
  StopConditionResult,
  updateStateAfterFailure,
  updateStateAfterDiffApplied,
  updateStateAfterDiagnosisTimeout,
  updateStateAfterDiffGenTimeout,
} from './selfCorrectionPolicy';

export {
  SelfCorrectionRunner,
  TestFailureInput,
  RepairContext,
  RepairDiffProposal,
  RepairIterationOutcome,
  DecisionPoint,
} from './selfCorrectionRunner';

// Export Prompt Quality Judge
export {
  PromptQualityJudge,
  combinePromptWithClarification,
  PromptQualityAssessment,
  AssessmentContext
} from './promptQualityJudge';

// Export Plan Enhancer (deterministic PLAN mode pipeline)
export {
  collectLightContext,
  assessPromptClarity,
  shouldShowClarification,
  generateClarificationOptions,
  buildEnrichedPrompt,
  buildFallbackPrompt,
  isClarificationPending,
  getPendingClarificationOptions,
  LightContextBundle,
  PromptAssessment,
  ClarificationOption,
  ClarificationPresented,
  CONTEXT_TIMEOUT_MS,
  TODO_SCAN_TIMEOUT_MS
} from './planEnhancer';

// Export MISSION EDIT utilities (spec-compliant unified diff flow)
export {
  parseUnifiedDiff,
  validateDiff,
  applyDiffToContent,
  generateUnifiedDiff,
  DiffHunk,
  DiffLine,
  ParsedFileDiff,
  ParsedDiff,
  DiffValidationResult,
  DiffValidationError
} from './unifiedDiffParser';

export {
  computeBaseSha,
  computeFullSha,
  shaEquals,
  isFileStale,
  computeFileShaInfo,
  computeBatchShaInfo,
  checkBatchStaleness,
  FileShaInfo
} from './shaUtils';

export {
  selectEditContext,
  buildBaseShaMap,
  FileContextEntry,
  FileSelectionEvidence,
  EditContextSelectionResult,
  FileSelectionSource,
  ExcerptSelectionConfig
} from './excerptSelector';

export {
  AtomicDiffApplier,
  createDiffId,
  createCheckpointId,
  AtomicApplyResult,
  CheckpointInfo
} from './atomicDiffApply';

export {
  LLMEditTool,
  DEFAULT_EDIT_CONSTRAINTS,
  DEFAULT_PRECONDITIONS,
  LLMEditStepInput,
  LLMEditStepOutput,
  LLMEditStepResult
} from './llmEditTool';

export {
  EditEvidenceManager,
  buildDiffProposedPayload,
  buildDiffAppliedPayload,
  DiffManifest,
  ApplyEvidence
} from './editEvidenceManager';

// Export Create Path Fence (SAFE file creation validation)
export {
  validateCreatesInDiff,
  validateCreatePath,
  isPathInAllowedRoots,
  isPathInDeniedPaths,
  getBlockedPathsSummary,
  extendAllowedPaths,
  createCustomFenceConfig,
  DEFAULT_CREATE_PATH_FENCE,
  CreatePathFenceConfig,
  CreateValidationResult
} from './createPathFence';

// Export workspace adapter interfaces (NO vscode imports - implemented in extension)
export type {
  FilePatch,
  WorkspaceWriter,
  CheckpointFile,
  CheckpointResult,
  RollbackResult,
  CheckpointManager as WorkspaceCheckpointManager
} from './workspaceAdapter';
