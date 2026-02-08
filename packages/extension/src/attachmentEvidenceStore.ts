/**
 * Attachment Evidence Store (Step 37 - Phase 3)
 * 
 * Handles storage of user-uploaded attachments as evidence:
 * - SHA256 deduplication (don't re-store identical files)
 * - Write to .ordinex/evidence/{sha256_prefix}/{evidence_id}.{ext}
 * - Return evidence_id for event inclusion
 * 
 * CRITICAL: All attachments become immutable evidence for replay/audit
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Attachment data received from webview
 */
export interface AttachmentData {
  id: string;           // Temp ID from webview
  name: string;         // Original filename
  mimeType: string;     // MIME type
  data: string;         // Base64-encoded file content
}

/**
 * Result of storing an attachment
 */
export interface AttachmentStoreResult {
  success: boolean;
  evidenceId?: string;       // Unique evidence ID (sha256-based)
  evidencePath?: string;     // Relative path from workspace root
  sha256?: string;           // Full SHA256 hash
  deduplicated?: boolean;    // True if file already existed
  error?: string;            // Error message if failed
}

/**
 * Evidence directory structure under workspace root
 */
const EVIDENCE_DIR = '.ordinex/evidence/attachments';

/**
 * Compute SHA256 hash of buffer
 */
function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get file extension from filename or MIME type
 */
function getExtension(filename: string, mimeType: string): string {
  // Try to get from filename first
  const ext = path.extname(filename).toLowerCase();
  if (ext) return ext;
  
  // Fallback to MIME type mapping
  const mimeToExt: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'text/plain': '.txt',
    'application/json': '.json',
    'application/pdf': '.pdf',
    'text/markdown': '.md',
    'text/csv': '.csv',
  };
  
  return mimeToExt[mimeType] || '.bin';
}

/**
 * Generate evidence ID from SHA256 hash
 * Format: att_{first12chars}
 */
function generateEvidenceId(sha256: string): string {
  return `att_${sha256.substring(0, 12)}`;
}

/**
 * Store an attachment as evidence
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param attachment - Attachment data from webview
 * @returns Store result with evidence ID and path
 */
export async function storeAttachment(
  workspaceRoot: string,
  attachment: AttachmentData
): Promise<AttachmentStoreResult> {
  try {
    // Decode base64 data
    const buffer = Buffer.from(attachment.data, 'base64');
    
    // Compute SHA256 for deduplication
    const sha256 = computeSha256(buffer);
    const evidenceId = generateEvidenceId(sha256);
    
    // Build storage path
    // Use first 2 chars of hash for subdirectory (prevents too many files in one dir)
    const hashPrefix = sha256.substring(0, 2);
    const ext = getExtension(attachment.name, attachment.mimeType);
    const filename = `${evidenceId}${ext}`;
    
    const relativeDir = path.join(EVIDENCE_DIR, hashPrefix);
    const absoluteDir = path.join(workspaceRoot, relativeDir);
    const relativePath = path.join(relativeDir, filename);
    const absolutePath = path.join(workspaceRoot, relativePath);
    
    // Check if file already exists (deduplication)
    if (fs.existsSync(absolutePath)) {
      console.log(`[AttachmentStore] Deduplicated: ${attachment.name} → ${evidenceId}`);
      return {
        success: true,
        evidenceId,
        evidencePath: relativePath,
        sha256,
        deduplicated: true,
      };
    }
    
    // Create directory if needed
    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
    }
    
    // Write file
    fs.writeFileSync(absolutePath, buffer);
    
    // Also write metadata file for audit/replay
    const metadataPath = absolutePath + '.meta.json';
    const metadata = {
      evidenceId,
      originalName: attachment.name,
      mimeType: attachment.mimeType,
      size: buffer.length,
      sha256,
      storedAt: new Date().toISOString(),
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`[AttachmentStore] Stored: ${attachment.name} → ${relativePath}`);
    
    return {
      success: true,
      evidenceId,
      evidencePath: relativePath,
      sha256,
      deduplicated: false,
    };
  } catch (error) {
    console.error('[AttachmentStore] Error storing attachment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Read attachment content from evidence store
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param evidencePath - Relative path to evidence file
 * @returns File content as Buffer, or null if not found
 */
export async function readAttachment(
  workspaceRoot: string,
  evidencePath: string
): Promise<Buffer | null> {
  try {
    const absolutePath = path.join(workspaceRoot, evidencePath);
    if (!fs.existsSync(absolutePath)) {
      return null;
    }
    return fs.readFileSync(absolutePath);
  } catch (error) {
    console.error('[AttachmentStore] Error reading attachment:', error);
    return null;
  }
}

/**
 * Check if attachment exists in evidence store
 */
export function attachmentExists(
  workspaceRoot: string,
  evidencePath: string
): boolean {
  const absolutePath = path.join(workspaceRoot, evidencePath);
  return fs.existsSync(absolutePath);
}

/**
 * Get attachment metadata from evidence store
 */
export async function getAttachmentMetadata(
  workspaceRoot: string,
  evidencePath: string
): Promise<Record<string, unknown> | null> {
  try {
    const absolutePath = path.join(workspaceRoot, evidencePath) + '.meta.json';
    if (!fs.existsSync(absolutePath)) {
      return null;
    }
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[AttachmentStore] Error reading metadata:', error);
    return null;
  }
}

/**
 * Validate attachment before storing
 * Mirrors the webview validation but enforces on backend
 */
export function validateAttachment(
  attachment: AttachmentData
): { valid: boolean; error?: string } {
  // Validate size (5 MB limit)
  const MAX_SIZE = 5 * 1024 * 1024;
  const buffer = Buffer.from(attachment.data, 'base64');
  if (buffer.length > MAX_SIZE) {
    return { valid: false, error: `File too large: ${buffer.length} bytes (max ${MAX_SIZE})` };
  }
  
  // Validate MIME type
  const ALLOWED_TYPES = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'text/plain', 'application/json', 'application/pdf',
    'text/markdown', 'text/csv'
  ];
  if (!ALLOWED_TYPES.includes(attachment.mimeType)) {
    return { valid: false, error: `Unsupported MIME type: ${attachment.mimeType}` };
  }
  
  return { valid: true };
}
