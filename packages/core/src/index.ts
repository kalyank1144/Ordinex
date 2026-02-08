/**
 * Ordinex Core - Event-Sourcing Foundation
 * 
 * This package provides the deterministic, event-driven core for Ordinex.
 * All components are based on 03_API_DATA_SPEC.md and 05_TECHNICAL_IMPLEMENTATION_SPEC.md
 */

export const version = '0.0.0';

// Export types
export * from './types';

// Step 35.8: Greenfield Intent Detection (Single Source of Truth)
export {
  detectGreenfieldIntent,
  isDefinitelyGreenfield,
  isAmbiguousGreenfield,
  IntentSignal,
} from './intent/greenfieldDetector';

export {
  llmClassifyIntent,
  needsLlmClassification,
  LlmIntent,
  LlmIntentResult,
  LlmClassifyArgs,
} from './intent/llmIntentClassifier';

// Step 40: Production-Grade Intent Routing (Unified Router)
export {
  detectGreenfieldIntent as detectGreenfieldSignal,
  detectCommandIntent as detectCommandSignal,
  detectEditScale,
  detectSlashOverride,
  normalizeUserInput,
} from './intent/intentSignals';

export {
  routeIntent,
  routeUserInput,
  isDefinitelyScaffold,
  isDefinitelyRunCommand,
  shouldCallLLM,
  generateClarificationQuestion,
} from './intent/intentRouter';

export type {
  RoutedIntent,
  RoutingContext,
  IntentRoutingResult,
} from './intent/intentRouter';

// Export event-sourcing components
export { EventStore } from './eventStore';
export { EventBus, EventSubscriber, PrimitiveEventInput, createPrimitiveInput } from './eventBus';
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

// Export Systems View Model (Step 29 - Operational Truth from Events)
export {
  reduceToSystemsViewModel,
  getTopRetrievedFiles,
  hasMoreRetrievedFiles,
  getAllChangedFiles,
  getStatusSummary,
  getWaitingSummary,
  formatTokenEstimate,
} from './systemsViewModel';

export type {
  SystemsViewModel,
  RetrievedFile,
  PendingApproval,
  PendingDecisionPoint,
  DiffInfo,
  CheckpointInfo as SystemsCheckpointInfo,
  TestInfo,
  FailureInfo,
  TimeoutInfo,
} from './systemsViewModel';

// Export JSON Repair Utility (robust LLM JSON parsing)
export {
  safeJsonParse,
  parseJsonWithContext,
} from './jsonRepair';

export type {
  JsonRepairResult,
} from './jsonRepair';

// Export Edit Attempt Ledger (Truncation-Safe Execution)
export {
  EditAttemptLedger,
} from './editAttemptLedger';

export type {
  FileEditStatus,
  FileEditAttempt,
  EditAttemptLedgerState,
} from './editAttemptLedger';

// Export Truncation-Safe Executor (Production-Hardened Edit Execution)
export {
  TruncationSafeExecutor,
  createTruncationSafeExecutor,
} from './truncationSafeExecutor';

export type {
  TruncationDetectionResult,
  SingleFileEditOutput,
  PreflightResult,
  TruncationSafeResult,
  TruncationSafeConfig,
} from './truncationSafeExecutor';

// Export Event Normalizer (Enterprise-Grade Event Contract Stabilization)
export {
  normalizeEvent,
  normalizeEvents,
  hasNormalizationMapping,
  getPrimitiveType,
} from './eventNormalizer';

// Export Workspace Resolver (Safe Multi-Root Workspace Targeting)
export {
  resolveTargetWorkspace,
  scoreWorkspaceCandidate,
  getWorkspaceCandidateInfo,
} from './workspaceResolver';

export type {
  WorkspaceCandidate,
  WorkspaceSelection,
} from './workspaceResolver';

// Export File Operation Classifier (File Existence Safety)
export {
  classifyFileOperation,
  classifyFileOperations,
  validateFileOperations,
  generateSafePatches,
} from './fileOperationClassifier';

export type {
  FileOperationClass,
  FileOperationIssue,
} from './fileOperationClassifier';

// Step 33: Mode Behavior Refinement (Pre-execution Intelligence Layer)
export {
  analyzeIntent,
  analyzeIntentWithFlow,
  detectActiveRun,
  detectFlowKind,
  isGreenfieldRequest,
  isPureQuestion,
  resolveReferences,
  detectScope,
  extractReferencedFiles,
  INTENT_ANALYZER_CONFIG,
  USER_OVERRIDES,
  GREENFIELD_PATTERNS,
} from './intentAnalyzer';

export type {
  IntentAnalysisContext,
} from './intentAnalyzer';

export {
  executeBehavior,
  processClarificationResponse,
  processContinueRunResponse,
  behaviorToMode,
  behaviorRequiresResponse,
  behaviorModifiesState,
} from './behaviorHandlers';

export type {
  BehaviorHandlerResult,
  HandlerContext,
} from './behaviorHandlers';

// Step 34: Auto-Verify + Repair (Phase-Based, Enterprise-Safe)
export {
  DEFAULT_VERIFY_POLICY,
  isCommandSafe,
} from './verifyPolicy';

export type {
  VerifyMode,
  VerifyPolicyConfig,
  DiscoveredCommand,
  VerifyStatus,
  VerifyPhaseResult,
  CommandExecutionResult,
} from './verifyPolicy';

export {
  discoverVerifyCommands,
  filterSafeCommands,
  getDiscoverySummary,
  createNoCommandsDecisionOptions,
  createNoSafeCommandsDecisionOptions,
} from './commandDiscovery';

export {
  runVerifyPhase,
  shouldRunVerify,
  clearVerifyBatchTracking,
} from './verifyPhase';

export type {
  VerifyPhaseContext,
} from './verifyPhase';

// Step 34.5: Command Execution Phase (Shared, Reusable, Replay-Safe)
export {
  DEFAULT_COMMAND_POLICY,
  classifyCommandKind,
  isCommandSafe as isCommandSafeForExecution,
  resolveCommandPolicy,
  serializeCommandPolicy,
  deserializeCommandPolicy,
} from './commandPolicy';

export type {
  CommandMode,
  CommandPolicyConfig,
} from './commandPolicy';

export {
  runCommandPhase,
} from './commandPhase';

export type {
  CommandPhaseContext,
} from './commandPhase';

export {
  detectCommandIntent,
  matchesCommandPattern,
} from './userCommandDetector';

export type {
  CommandIntentResult,
} from './userCommandDetector';

// Step 35: Greenfield Scaffold Flow (Decision-Point-Based Scaffolding)
export {
  ScaffoldFlowCoordinator,
  isScaffoldDecisionPoint,
  extractScaffoldId,
  deriveScaffoldFlowState,
  generatePlaceholderSummary,
  buildScaffoldDecisionOptions,
} from './scaffoldFlow';

export type {
  ScaffoldFlowState,
  ScaffoldDecisionOptions,
} from './scaffoldFlow';

// Step 35.3: Recipe Selection (Deterministic, No-LLM Framework Detection)
export {
  selectRecipe,
  detectCharacteristics,
  detectPackageManager,
  getInstallCommand,
  getRunCommand,
  getExecCommand,
} from './scaffold/recipeSelector';

// Step 35.3: Recipe Registry (Plan Building)
export {
  getRecipe,
  buildRecipePlan,
  getRecipeName,
  getRecipeDescription,
  buildFileTreePreview,
  countFilesAndDirs,
  summarizeCommands,
} from './scaffold/recipeRegistry';

// Step 35.4: Scaffold Apply (File Creation)
export {
  applyScaffoldPlan,
} from './scaffold/scaffoldApplyExecutor';

export type {
  ScaffoldApplyContext,
  ScaffoldApplyResult,
  ConflictMode,
  ApplyStage,
} from './scaffold/scaffoldApplyExecutor';

// Step 35.3: Recipe Types
export type {
  RecipeId,
  RecipeContext,
  RecipePlan,
  FilePlanItem,
  CommandPlanItem,
  RecipeSelection,
  RecipeDetection,
  PackageManager,
} from './scaffold/recipeTypes';

// Step 35.X: Post-Scaffold Orchestrator (Design Pack Application + Next Steps)
export {
  startPostScaffoldOrchestration,
  pollForCompletion,
  applyDesignPackToProject,
  DEFAULT_POLLING_CONFIG,
} from './scaffold/postScaffoldOrchestrator';

export type {
  PostScaffoldContext,
  PostScaffoldResult,
  PostScaffoldPollingConfig,
} from './scaffold/postScaffoldOrchestrator';

// Step 35.5: Design Packs
export {
  getDesignPackById,
  getDefaultPacksForPicker,
  getPacksByVibe,
  generateCssVariables,
  generateGlobalsCss,
  generateTailwindConfig,
  DESIGN_PACKS,
} from './scaffold/designPacks';

export type {
  DesignPack,
  DesignPackId,
  DesignVibe,
  DesignTokens,
  ColorTokens,
  FontTokens,
} from './scaffold/designPacks';

// Step 35.6: Next Steps (Post-scaffold suggestions)
export {
  getNextStepsForRecipe,
  getFeatureAwareNextSteps,
  buildNextStepsShownPayload,
} from './scaffold/nextSteps';

export type {
  NextStepSuggestion,
  NextStepsContext,
} from './scaffold/nextSteps';

// Scaffold Feature Intelligence (LLM-Powered Feature Generation)
export {
  extractFeatureRequirements,
  hasSpecificFeature,
  createFeatureLLMClient,
} from './scaffold/featureExtractor';

export type {
  FeatureLLMClient,
} from './scaffold/featureExtractor';

export {
  generateFeatureCode,
} from './scaffold/featureCodeGenerator';

export {
  applyFeatureCode,
} from './scaffold/featureApplicator';

// ============================================================================
// Step 40.5: Intelligence Layer (Context Enricher)
// ============================================================================

export {
  // Main enricher
  enrichUserInput,
  isOutOfScope,
  generateOutOfScopeResponse,
  shouldClarify,
  resolveReferences as resolveContextReferences,
  buildEnrichedPrompt as buildContextEnrichedPrompt,
  redactSecrets as redactIntelligenceSecrets,
  // Codebase context
  gatherCodebaseContext,
  detectProjectType,
  detectTypeScript,
  detectPackageManager as detectPkgManager,
  detectAuth,
  detectDatabase,
  detectComponentLibrary,
  detectSrcStructure,
  detectMonorepo,
  getRecentlyModifiedFiles,
  getDependencies,
  // New detection functions (Step 40.5 Enhancement)
  detectTestingFramework,
  detectCICD,
  detectContainerTool,
  detectCloudProvider,
  DEFAULT_INTELLIGENCE_SETTINGS,
  // Session context
  getSessionContextManager,
  resetSessionContextManager,
  getSessionContext,
  SessionContextManager,
  COMPONENT_TYPES,
} from './intelligence';

export type {
  // Enricher types
  EnrichedInput,
  EnricherOptions,
  ResolvedReference,
  EditorContext,
  DiagnosticEntry,
  // Codebase context types
  CodebaseContext,
  ProjectType,
  PackageManager as CodebasePackageManager,
  SrcStructure,
  ComponentLibrary,
  TestingFramework,
  CICDProvider,
  ContainerTool,
  CloudProvider,
  IntelligenceSettings,
  // Session context types
  SessionContext,
  TopicEntry,
  FileMention,
  DecisionEntry,
  PendingClarification,
  ErrorMention,
} from './intelligence';

// ============================================================================
// Step 41: Dev Server Lifecycle + Long-Running Command UX
// ============================================================================

export {
  ProcessManager,
  getProcessManager,
  resetProcessManager,
  generateProcessId,
  detectProcessType,
  getDefaultDevCommand,
  PROCESS_READY_SIGNALS,
} from './processManager';

export type {
  ProcessStatus as DevProcessStatus,
  ProcessReadySignal,
  LongRunningProcess,
  StartProcessOpts,
  ProcessOutputEvent,
  ProcessStatusEvent,
} from './processManager';

// ============================================================================
// Step 46: Enhanced Checkpoint System (#1 Differentiator)
// ============================================================================

export {
  CheckpointManagerV2,
  initCheckpointManagerV2,
  getCheckpointManagerV2,
  createPreScaffoldCheckpoint,
  createPreMissionCheckpoint,
  createPreEditCheckpoint,
} from './checkpointManagerV2';

export type {
  CheckpointReason,
  CheckpointV2,
  CheckpointFileInfo,
  GitStateInfo,
  RestorePreview,
  CreateCheckpointOptions,
} from './checkpointManagerV2';

// ============================================================================
// Step 43: Scaffold Quality Gates
// ============================================================================

export {
  runPreApplyQualityGates,
  runPostApplyValidation,
  checkCheckpointReady,
  atomicApplyScaffold,
  DEFAULT_MIN_DISK_SPACE,
  DEFAULT_MIN_MEMORY,
  DEFAULT_NETWORK_TIMEOUT,
} from './scaffold/qualityGates';

export type {
  GateStatus,
  GateResult,
  QualityCheckResult,
  QualityGate,
  GateConfig,
  AtomicApplyContext,
  ScaffoldAtomicApplyResult,
  PostApplyValidation,
} from './scaffold/qualityGates';

// ============================================================================
// Step 43: Scaffold Preflight Checks (Preflight Engine + Resolutions)
// ============================================================================

export {
  runPreflightChecks,
  runPreflightChecksWithEvents,
  emitPreflightResolutionSelected,
  checkDirectoryEmpty,
  checkMonorepo,
  checkWritePermissions,
  checkDiskSpace,
  checkGitDirty,
  checkConflictingFiles,
  applyResolutions,
} from './scaffold/preflightChecks';

export type {
  PreflightChecksInput,
  PreflightOrchestratorCtx,
} from './scaffold/preflightChecks';

// ============================================================================
// Step 44: Post-Scaffold Verification Pipeline
// ============================================================================

export {
  runPostVerification,
  runPostVerificationWithEvents,
  verifyPackageJson,
  runInstallStep,
  runLintStep,
  runTypecheckStep,
  runBuildStep,
  detectPackageManager as detectScaffoldPackageManager,
  detectTypeScript as detectScaffoldTypeScript,
  hasScript,
  runScriptCmd,
  computeOutcome,
} from './scaffold/postVerify';

export type {
  VerifyStepStatus,
  VerifyOutcome,
  VerifyStepResult,
  VerifyResult,
  VerifyConfig,
  VerifyRecipeInfo,
  VerifyEventCtx,
} from './scaffold/postVerify';
