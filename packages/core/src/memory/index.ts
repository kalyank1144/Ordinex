/**
 * Memory System — 5-Layer Persistent Memory Architecture
 *
 * Layer 1: Rules (always-on project/global instructions)
 * Layer 2: MEMORY.md (ID-based CRUD, structured sections)
 * Layer 3: Auto Memory (event-triggered LLM extraction)
 * Layer 4: Session Continuity (extractive compression)
 * Layer 5: Semantic Retrieval (local WASM embeddings)
 */

// Layer 1: Rules
export {
  Rule,
  RulesService,
  loadRules,
  buildRulesContext,
  globMatch,
} from './rulesLoader';

// Layer 2: Memory Document
export {
  MemorySection,
  MEMORY_SECTIONS,
  MemoryFact,
  MemoryDocument,
  MemoryMetadata,
  generateFactId,
  parseMemoryDocument,
  serializeMemoryDocument,
  serializeMetadata,
  addFact,
  updateFact,
  removeFact,
  listFacts,
  markFactReferenced,
  getMemoryContext,
  migrateFromFactsMd,
  createEmptyDocument,
} from './memoryDocument';

// Layer 3: Auto Memory
export {
  TriggerMatch,
  ExtractedFact,
  ExtractionState,
  shouldExtract,
  buildAutoMemoryPrompt,
  parseExtractionResult,
  deduplicateFacts,
  shouldSkipDueToFactCount,
  createExtractionState,
  recordExtraction,
} from './autoMemoryExtractor';

// Layer 4: Session Continuity
export {
  SessionSummary,
  FileChange,
  CommandRun,
  DecisionMade,
  ErrorFixed,
  compressSession,
  serializeSession,
  parseSessionHeader,
  buildSessionContext,
} from './sessionCompressor';

// Layer 5: Embedding Service
export {
  EmbeddingService,
  EmbeddingSidecar,
  EmbeddingEntry,
  ScoredItem,
  cosineSimilarity,
  createEmptySidecar,
  upsertEmbedding,
  removeEmbedding,
  queryBySimilarity,
  sidecarNeedsRebuild,
} from './embeddingService';
