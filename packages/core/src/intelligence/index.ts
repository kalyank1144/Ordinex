/**
 * Step 40.5: Intelligence Layer - Module Index (Enhanced)
 *
 * The Intelligence Layer provides contextual understanding
 * by enriching user input with codebase and session context.
 *
 * ARCHITECTURE:
 * User Input → Context Enricher → Intent Router → Execute
 *
 * EXPORTS:
 * - enrichUserInput: Main entry point for the enricher
 * - CodebaseContext, gatherCodebaseContext: Codebase analysis
 * - SessionContext, SessionContextManager: Session history tracking
 * - EditorContext, DiagnosticEntry: Editor integration types
 * - Detection functions: testing, CI/CD, Docker, cloud
 * - Various helper functions and types
 */

// Main enricher
export {
  enrichUserInput,
  isOutOfScope,
  generateOutOfScopeResponse,
  shouldClarify,
  resolveReferences,
  buildEnrichedPrompt,
  redactSecrets,
} from './contextEnricher';

export type {
  EnrichedInput,
  EnricherOptions,
  ResolvedReference,
  EditorContext,
  DiagnosticEntry,
} from './contextEnricher';

// Codebase context
export {
  gatherCodebaseContext,
  detectProjectType,
  detectTypeScript,
  detectPackageManager,
  detectAuth,
  detectDatabase,
  detectComponentLibrary,
  detectSrcStructure,
  detectMonorepo,
  getRecentlyModifiedFiles,
  getDependencies,
  detectTestingFramework,
  detectCICD,
  detectContainerTool,
  detectCloudProvider,
  DEFAULT_INTELLIGENCE_SETTINGS,
} from './codebaseContext';

export type {
  CodebaseContext,
  ProjectType,
  PackageManager,
  SrcStructure,
  ComponentLibrary,
  TestingFramework,
  CICDProvider,
  ContainerTool,
  CloudProvider,
  IntelligenceSettings,
} from './codebaseContext';

// Session context
export {
  SessionContextManager,
  getSessionContextManager,
  resetSessionContextManager,
  getSessionContext,
  COMPONENT_TYPES,
} from './sessionContext';

export type {
  SessionContext,
  TopicEntry,
  FileMention,
  DecisionEntry,
  PendingClarification,
  ErrorMention,
} from './sessionContext';
