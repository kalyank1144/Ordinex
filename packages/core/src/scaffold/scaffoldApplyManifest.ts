/**
 * Scaffold Apply Manifest (Step 35.4)
 * 
 * Defines the manifest structure for tracking scaffold apply operations.
 * The manifest is stored as evidence and used for:
 * - Replay safety (never re-apply if manifest exists)
 * - Audit trail (exact files created with hashes)
 * - Rollback reference (which files to remove on failure)
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// MANIFEST TYPES
// ============================================================================

/**
 * Single file in the apply manifest
 */
export interface ManifestFile {
  /** Path relative to target directory */
  path: string;
  /** SHA256 hash of content */
  sha256: string;
  /** Size in bytes */
  bytes: number;
  /** File mode (optional, Unix permissions) */
  mode?: number;
}

/**
 * Scaffold apply manifest
 * 
 * Complete record of what was created during scaffold apply.
 * Stored as evidence for replay safety and audit.
 */
export interface ScaffoldApplyManifest {
  /** Scaffold operation ID */
  scaffold_id: string;
  /** Recipe that was applied */
  recipe_id: string;
  /** Target directory (absolute path) */
  target_directory: string;
  /** ISO timestamp when created */
  created_at: string;
  /** Files created with hashes */
  files: ManifestFile[];
  /** Directories created (relative paths) */
  dirs: string[];
  /** Optional policy snapshot (for verification reference) */
  policy_snapshot?: {
    verify_mode: string;
    command_mode: string;
  };
  /** Commands planned for post-apply */
  commands_planned?: Array<{
    label: string;
    cmd: string;
    when: string;
  }>;
  /** Files skipped (merge_safe_only mode) */
  skipped_files?: string[];
  /** Checkpoint ID if one was created */
  checkpoint_id?: string;
  /** Apply strategy used */
  strategy: 'checkpoint' | 'temp_staging';
  /** Total duration in milliseconds */
  duration_ms: number;
}

// ============================================================================
// MANIFEST OPERATIONS
// ============================================================================

/**
 * Compute SHA256 hash of content
 */
export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Create a manifest file entry from content
 */
export function createManifestFile(
  relativePath: string,
  content: string,
  mode?: number
): ManifestFile {
  return {
    path: relativePath,
    sha256: computeContentHash(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    mode,
  };
}

/**
 * Write manifest to evidence store
 * 
 * @param manifest - The manifest to write
 * @param evidenceDir - Evidence directory (usually .ordinex/evidence)
 * @returns Evidence reference string
 */
export async function writeManifestEvidence(
  manifest: ScaffoldApplyManifest,
  evidenceDir: string
): Promise<string> {
  // Ensure evidence directory exists
  if (!fs.existsSync(evidenceDir)) {
    await fs.promises.mkdir(evidenceDir, { recursive: true });
  }
  
  const filename = `scaffold_apply_${manifest.scaffold_id}.json`;
  const evidencePath = path.join(evidenceDir, filename);
  
  await fs.promises.writeFile(
    evidencePath,
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  
  // Return reference in standard format
  return `evidence:scaffold_apply:${manifest.scaffold_id}`;
}

/**
 * Load manifest from evidence store
 * 
 * @param scaffoldId - Scaffold ID to load
 * @param evidenceDir - Evidence directory
 * @returns Manifest if found, undefined otherwise
 */
export async function loadManifestEvidence(
  scaffoldId: string,
  evidenceDir: string
): Promise<ScaffoldApplyManifest | undefined> {
  const filename = `scaffold_apply_${scaffoldId}.json`;
  const evidencePath = path.join(evidenceDir, filename);
  
  try {
    if (!fs.existsSync(evidencePath)) {
      return undefined;
    }
    
    const content = await fs.promises.readFile(evidencePath, 'utf8');
    return JSON.parse(content) as ScaffoldApplyManifest;
  } catch (err) {
    console.error(`Failed to load manifest evidence for ${scaffoldId}:`, err);
    return undefined;
  }
}

/**
 * Check if a scaffold was already applied (replay safety)
 * 
 * @param scaffoldId - Scaffold ID to check
 * @param evidenceDir - Evidence directory
 * @returns true if already applied
 */
export async function wasScaffoldApplied(
  scaffoldId: string,
  evidenceDir: string
): Promise<boolean> {
  const manifest = await loadManifestEvidence(scaffoldId, evidenceDir);
  return manifest !== undefined;
}

/**
 * Generate manifest summary for MissionFeed display
 * 
 * @param manifest - The manifest to summarize
 * @returns Human-readable summary
 */
export function generateManifestSummary(manifest: ScaffoldApplyManifest): string {
  const parts: string[] = [];
  
  parts.push(`Created ${manifest.files.length} file(s)`);
  
  if (manifest.dirs.length > 0) {
    parts.push(`${manifest.dirs.length} directory(s)`);
  }
  
  const totalBytes = manifest.files.reduce((sum, f) => sum + f.bytes, 0);
  if (totalBytes > 0) {
    const kb = (totalBytes / 1024).toFixed(1);
    parts.push(`(${kb} KB total)`);
  }
  
  if (manifest.skipped_files && manifest.skipped_files.length > 0) {
    parts.push(`[${manifest.skipped_files.length} skipped]`);
  }
  
  return parts.join(', ');
}

/**
 * Validate manifest integrity against actual files
 * 
 * Checks that all files in manifest exist and have correct hashes.
 * Used for post-apply verification.
 * 
 * @param manifest - Manifest to validate
 * @returns Validation result
 */
export async function validateManifestIntegrity(
  manifest: ScaffoldApplyManifest
): Promise<{
  valid: boolean;
  missingFiles: string[];
  hashMismatches: string[];
}> {
  const missingFiles: string[] = [];
  const hashMismatches: string[] = [];
  
  for (const file of manifest.files) {
    const absolutePath = path.join(manifest.target_directory, file.path);
    
    try {
      if (!fs.existsSync(absolutePath)) {
        missingFiles.push(file.path);
        continue;
      }
      
      const content = await fs.promises.readFile(absolutePath, 'utf8');
      const actualHash = computeContentHash(content);
      
      if (actualHash !== file.sha256) {
        hashMismatches.push(file.path);
      }
    } catch (err) {
      missingFiles.push(file.path);
    }
  }
  
  return {
    valid: missingFiles.length === 0 && hashMismatches.length === 0,
    missingFiles,
    hashMismatches,
  };
}
