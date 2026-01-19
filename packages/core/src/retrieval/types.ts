/**
 * Types for retrieval system
 * Based on 04_INDEXING_RETRIEVAL_SPEC.md
 */

export type RetrievalMode = 'ANSWER' | 'PLAN' | 'MISSION';
export type RetrievalStage = 'plan' | 'retrieve' | 'edit' | 'test' | 'repair';

/**
 * Allowed reasons for retrieval (CRITICAL - exhaustive list)
 */
export type RetrievalReason =
  | 'user_attached'
  | 'active_file'
  | 'lexical_match'
  | 'symbol_reference'
  | 'import_dependency'
  | 'proximity';

/**
 * Retrieval request shape
 */
export interface RetrievalRequest {
  query: string;
  mode: RetrievalMode;
  stage: RetrievalStage;
  constraints: {
    max_files: number;
    max_lines: number;
  };
}

/**
 * Individual retrieval result
 */
export interface RetrievalResult {
  file: string;
  start_line: number;
  end_line: number;
  reason: RetrievalReason;
  excerpt?: string; // The actual content for evidence
}

/**
 * Retrieval response shape
 */
export interface RetrievalResponse {
  results: RetrievalResult[];
  summary: string;
}

/**
 * File metadata from indexer
 */
export interface FileMetadata {
  path: string;
  size: number;
  lastModified: number;
}

/**
 * Indexer configuration
 */
export interface IndexerConfig {
  workspaceRoot: string;
  useGit: boolean;
  ignorePatterns: string[];
  defaultIgnorePaths: string[];
}

/**
 * Search match from indexer
 */
export interface SearchMatch {
  file: string;
  line: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}
