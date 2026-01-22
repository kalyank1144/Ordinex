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
  shouldRequireConfirmation,
  ClassificationResult
} from './modeClassifier';
export {
  generateTemplatePlan,
  generateLLMPlan,
  refinePlan,
  shouldBreakIntoMissions,
  PlanPayload,
  StructuredPlan
} from './planGenerator';

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
