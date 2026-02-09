/**
 * V6: Generated Tools - ToolRegistryService Interface + Types
 *
 * Core defines the interface and pure data types.
 * Extension implements FsToolRegistryService for all FS operations.
 * Extension implements GeneratedToolRunner for execution.
 *
 * CONSTRAINT: Core must NOT write to disk. This file contains
 * only types and the ToolRegistryService interface contract.
 *
 * SECURITY: Generated tool execution uses best-effort isolation
 * (env scrubbing, static import scanning, timeouts). This is NOT
 * a secure sandbox. Default policy is "prompt" — user must approve.
 */

// Re-export EventPublisher so generatedToolManager doesn't need a separate import
export type { EventPublisher } from './memoryService';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Tool proposal — what the LLM generates before approval.
 * Stored transiently (rebuilt from events), persisted only after approval.
 */
export interface ToolProposal {
  /** Tool name (used as filename and registry key) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JavaScript source code */
  code: string;
  /** Optional usage instructions / README */
  readme?: string;
  /** JSON Schema for expected input arguments */
  inputs_schema?: Record<string, unknown>;
  /** JSON Schema for expected output */
  outputs_schema?: Record<string, unknown>;
  /** Permission policy for this tool */
  allow?: ToolAllowPolicy;
}

/**
 * Permission policy for a generated tool
 */
export interface ToolAllowPolicy {
  /** Whether the tool is allowed to make network requests (default: false) */
  network?: boolean;
  /** Allowed command prefixes (e.g. ["node", "npm"]) */
  commands?: string[];
}

/**
 * Tool entry — persisted in registry after approval.
 * Does NOT contain code (only hash). Code lives in <name>.js file.
 */
export interface ToolEntry {
  /** Tool name (matches filename) */
  name: string;
  /** Human-readable description */
  description: string;
  /** SHA-256 hash of the approved code */
  code_hash: string;
  /** JSON Schema for expected inputs */
  inputs_schema?: Record<string, unknown>;
  /** JSON Schema for expected outputs */
  outputs_schema?: Record<string, unknown>;
  /** Permission policy */
  allow?: ToolAllowPolicy;
  /** ISO timestamp when the tool was approved and saved */
  created_at: string;
}

/**
 * Tool registry — the .ordinex/tools/generated/registry.json schema
 */
export interface ToolRegistry {
  /** Schema version for forward compatibility */
  version: 1;
  /** All approved tools */
  tools: ToolEntry[];
}

/**
 * Metadata passed when saving a tool (code excluded — passed separately)
 */
export interface ToolMetadata {
  description: string;
  inputs_schema?: Record<string, unknown>;
  outputs_schema?: Record<string, unknown>;
  allow?: ToolAllowPolicy;
}

/**
 * Result of a tool execution
 */
export interface ToolRunResult {
  /** Captured stdout (truncated to 200KB) */
  stdout: string;
  /** Captured stderr (truncated to 200KB) */
  stderr: string;
  /** Process exit code */
  exit_code: number;
  /** Wall-clock execution time in milliseconds */
  duration_ms: number;
}

/**
 * Failure types for tool execution
 */
export type ToolRunFailureType = 'timeout' | 'blocked' | 'error' | 'policy';

/**
 * Tool execution policy
 */
export type ToolExecutionPolicy = 'disabled' | 'prompt' | 'auto';

// ============================================================================
// TOOL REGISTRY SERVICE INTERFACE
// ============================================================================

/**
 * ToolRegistryService — abstract storage layer for generated tools.
 *
 * Core defines this interface. Extension implements it (FsToolRegistryService)
 * with actual file system operations on .ordinex/tools/generated/.
 */
export interface ToolRegistryService {
  /** Save tool code + metadata to persistent storage */
  saveTool(name: string, code: string, metadata: ToolMetadata): Promise<void>;
  /** Load the full registry of approved tools */
  loadRegistry(): Promise<ToolRegistry>;
  /** Get a single tool entry by name, returns null if not found */
  getTool(name: string): Promise<ToolEntry | null>;
  /** Delete a tool from registry and remove its code file */
  deleteTool(name: string): Promise<void>;
  /** Load the raw code for a tool by name, returns null if not found */
  loadToolCode(name: string): Promise<string | null>;
}
