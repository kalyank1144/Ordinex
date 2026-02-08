/**
 * Step 38: Reference Tokens Evidence Store
 * 
 * Stores extracted ReferenceTokens as evidence for replay safety.
 * 
 * Rules:
 * - NEVER re-run vision analysis in replay/audit mode
 * - Load tokens from evidence file instead
 * - Evidence includes version + checksum for integrity
 */

import { createHash } from 'crypto';
import type { ReferenceTokens } from '../types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Tokens evidence file structure
 */
export interface TokensEvidenceFile {
  /** Version identifier for schema changes */
  version: 'reference_tokens_v1';
  /** Reference context ID this evidence belongs to */
  reference_context_id: string;
  /** SHA256 checksum of the tokens JSON */
  checksum: string;
  /** ISO timestamp when evidence was created */
  created_at: string;
  /** The actual tokens */
  tokens: ReferenceTokens;
}

/**
 * File system interface (injected for testability)
 */
export interface FileSystem {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

// ============================================================================
// PATH HELPERS
// ============================================================================

/**
 * Evidence directory under workspace root
 */
const EVIDENCE_DIR = '.ordinex/evidence';

/**
 * Build evidence file path for tokens
 * 
 * @param workspaceRoot - Workspace root path
 * @param referenceContextId - Unique reference context ID
 * @returns Absolute path to evidence file
 */
export function buildTokensEvidencePath(
  workspaceRoot: string,
  referenceContextId: string
): string {
  // Sanitize referenceContextId to prevent path traversal
  const safeId = referenceContextId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${workspaceRoot}/${EVIDENCE_DIR}/reference_tokens_${safeId}.json`;
}

/**
 * Build evidence reference (relative path for events)
 * 
 * @param referenceContextId - Unique reference context ID
 * @returns Relative path for evidence_ref field
 */
export function buildTokensEvidenceRef(referenceContextId: string): string {
  const safeId = referenceContextId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${EVIDENCE_DIR}/reference_tokens_${safeId}.json`;
}

// ============================================================================
// CHECKSUM
// ============================================================================

/**
 * Compute SHA256 checksum of tokens
 */
export function computeTokensChecksum(tokens: ReferenceTokens): string {
  const json = JSON.stringify(tokens, null, 0);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Verify checksum matches tokens
 */
export function verifyChecksum(tokens: ReferenceTokens, checksum: string): boolean {
  return computeTokensChecksum(tokens) === checksum;
}

// ============================================================================
// WRITE TOKENS
// ============================================================================

/**
 * Write tokens to evidence store
 * 
 * @param fs - File system interface
 * @param workspaceRoot - Workspace root path
 * @param referenceContextId - Unique reference context ID
 * @param tokens - Extracted reference tokens
 * @returns Evidence reference (relative path)
 */
export async function writeTokensEvidence(
  fs: FileSystem,
  workspaceRoot: string,
  referenceContextId: string,
  tokens: ReferenceTokens
): Promise<string> {
  const filePath = buildTokensEvidencePath(workspaceRoot, referenceContextId);
  const evidenceRef = buildTokensEvidenceRef(referenceContextId);
  
  // Ensure directory exists
  const dir = `${workspaceRoot}/${EVIDENCE_DIR}`;
  await fs.mkdir(dir, { recursive: true });
  
  // Build evidence file
  const evidenceFile: TokensEvidenceFile = {
    version: 'reference_tokens_v1',
    reference_context_id: referenceContextId,
    checksum: computeTokensChecksum(tokens),
    created_at: new Date().toISOString(),
    tokens,
  };
  
  // Write JSON with pretty formatting for auditability
  const content = JSON.stringify(evidenceFile, null, 2);
  await fs.writeFile(filePath, content);
  
  console.log(`[TokensEvidence] Written: ${evidenceRef}`);
  
  return evidenceRef;
}

// ============================================================================
// READ TOKENS
// ============================================================================

/**
 * Read tokens from evidence store
 * 
 * @param fs - File system interface
 * @param workspaceRoot - Workspace root path
 * @param referenceContextId - Unique reference context ID
 * @returns Tokens if found and valid, null otherwise
 */
export async function readTokensEvidence(
  fs: FileSystem,
  workspaceRoot: string,
  referenceContextId: string
): Promise<ReferenceTokens | null> {
  const filePath = buildTokensEvidencePath(workspaceRoot, referenceContextId);
  
  // Check if evidence file exists
  const exists = await fs.exists(filePath);
  if (!exists) {
    console.warn(`[TokensEvidence] Not found: ${filePath}`);
    return null;
  }
  
  try {
    // Read and parse evidence file
    const content = await fs.readFile(filePath);
    const evidenceFile: TokensEvidenceFile = JSON.parse(content);
    
    // Validate version
    if (evidenceFile.version !== 'reference_tokens_v1') {
      console.warn(`[TokensEvidence] Unknown version: ${evidenceFile.version}`);
      return null;
    }
    
    // Validate checksum
    if (!verifyChecksum(evidenceFile.tokens, evidenceFile.checksum)) {
      console.warn(`[TokensEvidence] Checksum mismatch for ${referenceContextId}`);
      return null;
    }
    
    console.log(`[TokensEvidence] Loaded: ${referenceContextId}`);
    return evidenceFile.tokens;
  } catch (error) {
    console.error(`[TokensEvidence] Error reading ${filePath}:`, error);
    return null;
  }
}

/**
 * Read tokens from evidence by evidence reference
 * 
 * @param fs - File system interface
 * @param workspaceRoot - Workspace root path
 * @param evidenceRef - Evidence reference (relative path)
 * @returns Tokens if found and valid, null otherwise
 */
export async function readTokensByEvidenceRef(
  fs: FileSystem,
  workspaceRoot: string,
  evidenceRef: string
): Promise<ReferenceTokens | null> {
  const filePath = `${workspaceRoot}/${evidenceRef}`;
  
  const exists = await fs.exists(filePath);
  if (!exists) {
    console.warn(`[TokensEvidence] Not found by ref: ${evidenceRef}`);
    return null;
  }
  
  try {
    const content = await fs.readFile(filePath);
    const evidenceFile: TokensEvidenceFile = JSON.parse(content);
    
    if (evidenceFile.version !== 'reference_tokens_v1') {
      console.warn(`[TokensEvidence] Unknown version: ${evidenceFile.version}`);
      return null;
    }
    
    if (!verifyChecksum(evidenceFile.tokens, evidenceFile.checksum)) {
      console.warn(`[TokensEvidence] Checksum mismatch`);
      return null;
    }
    
    return evidenceFile.tokens;
  } catch (error) {
    console.error(`[TokensEvidence] Error reading by ref:`, error);
    return null;
  }
}

// ============================================================================
// CHECK EXISTS
// ============================================================================

/**
 * Check if tokens evidence exists for a reference context
 */
export async function tokensEvidenceExists(
  fs: FileSystem,
  workspaceRoot: string,
  referenceContextId: string
): Promise<boolean> {
  const filePath = buildTokensEvidencePath(workspaceRoot, referenceContextId);
  return fs.exists(filePath);
}

// ============================================================================
// NODE.JS FILE SYSTEM ADAPTER
// ============================================================================

/**
 * Create a FileSystem adapter from Node.js fs module
 * 
 * @param nodeFs - Node.js fs/promises module
 * @returns FileSystem interface implementation
 */
export function createNodeFileSystem(nodeFs: {
  readFile: (path: string, encoding: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  access: (path: string) => Promise<void>;
}): FileSystem {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await nodeFs.access(path);
        return true;
      } catch {
        return false;
      }
    },
    async readFile(path: string): Promise<string> {
      return nodeFs.readFile(path, 'utf-8');
    },
    async writeFile(path: string, content: string): Promise<void> {
      await nodeFs.writeFile(path, content);
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      await nodeFs.mkdir(path, options);
    },
  };
}

// ============================================================================
// PALETTE SUMMARY BUILDER
// ============================================================================

/**
 * Build a compact palette summary for UI display
 * 
 * @param tokens - Reference tokens
 * @returns Compact string like "#3B82F6, #10B981, #F59E0B"
 */
export function buildPaletteSummary(tokens: ReferenceTokens): string | undefined {
  const palette = tokens.style?.palette;
  if (!palette) return undefined;
  
  const colors: string[] = [];
  if (palette.primary) colors.push(palette.primary);
  if (palette.secondary) colors.push(palette.secondary);
  if (palette.accent) colors.push(palette.accent);
  
  if (colors.length === 0) return undefined;
  
  return colors.join(', ');
}

/**
 * Build a compact summary of extracted tokens for event payload
 * 
 * IMPORTANT: Never include raw base64 or full JSON.
 */
export function buildTokensSummary(tokens: ReferenceTokens): {
  palette_summary?: string;
  moods?: string[];
  confidence: number;
} {
  return {
    palette_summary: buildPaletteSummary(tokens),
    moods: tokens.style?.mood,
    confidence: tokens.confidence,
  };
}
