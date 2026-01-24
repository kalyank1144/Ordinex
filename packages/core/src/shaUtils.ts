/**
 * SHA Utilities for MISSION EDIT
 * Based on spec requirements for base_sha validation
 * 
 * Handles:
 * - Computing SHA-256 hash of file content
 * - Truncating to 12 hex characters
 * - Comparing SHAs for staleness detection
 */

import { createHash } from 'crypto';

/**
 * Compute SHA-256 hash of content, truncated to 12 hex characters
 * This is the base_sha format used throughout the EDIT flow
 */
export function computeBaseSha(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex').substring(0, 12);
}

/**
 * Compute full SHA-256 hash (for evidence/audit purposes)
 */
export function computeFullSha(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Compare two SHAs for equality
 */
export function shaEquals(sha1: string, sha2: string): boolean {
  return sha1.toLowerCase() === sha2.toLowerCase();
}

/**
 * Check if a file has changed by comparing current content SHA to expected SHA
 */
export function isFileStale(currentContent: string, expectedSha: string): boolean {
  const currentSha = computeBaseSha(currentContent);
  return !shaEquals(currentSha, expectedSha);
}

/**
 * File SHA info used throughout the EDIT flow
 */
export interface FileShaInfo {
  path: string;
  base_sha: string;
  full_sha?: string;
  computed_at: string;
}

/**
 * Compute SHA info for a file
 */
export function computeFileShaInfo(path: string, content: string): FileShaInfo {
  return {
    path,
    base_sha: computeBaseSha(content),
    full_sha: computeFullSha(content),
    computed_at: new Date().toISOString(),
  };
}

/**
 * Batch compute SHAs for multiple files
 */
export function computeBatchShaInfo(
  files: Array<{ path: string; content: string }>
): Map<string, FileShaInfo> {
  const result = new Map<string, FileShaInfo>();
  
  for (const file of files) {
    result.set(file.path, computeFileShaInfo(file.path, file.content));
  }
  
  return result;
}

/**
 * Check staleness for multiple files
 * Returns list of stale files
 */
export function checkBatchStaleness(
  currentContents: Map<string, string>,
  expectedShas: Map<string, string>
): Array<{ path: string; expected_sha: string; actual_sha: string }> {
  const staleFiles: Array<{ path: string; expected_sha: string; actual_sha: string }> = [];
  
  for (const [path, expectedSha] of expectedShas.entries()) {
    const currentContent = currentContents.get(path);
    if (currentContent !== undefined) {
      const actualSha = computeBaseSha(currentContent);
      if (!shaEquals(actualSha, expectedSha)) {
        staleFiles.push({ path, expected_sha: expectedSha, actual_sha: actualSha });
      }
    }
  }
  
  return staleFiles;
}
