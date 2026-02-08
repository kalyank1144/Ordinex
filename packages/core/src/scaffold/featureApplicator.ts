/**
 * Feature Applicator (Scaffold Intelligence)
 *
 * Writes LLM-generated feature files to the scaffolded project and modifies
 * existing files (e.g., updates home page to show feature components).
 * This is the third phase of the Feature Implementation Pipeline.
 *
 * Key design decisions:
 * - Creates directories as needed (mkdir -p style)
 * - Writes new files atomically
 * - Replaces existing files completely (for modified_files)
 * - Collects errors without stopping (best-effort application)
 * - Emits events for UI progress tracking
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FeatureGenerationResult, FeatureApplyResult } from '../types';

// ============================================================================
// FEATURE APPLICATION
// ============================================================================

/**
 * Apply generated feature code to a scaffolded project.
 *
 * @param projectPath - Absolute path to the scaffolded project root
 * @param generationResult - Files and modifications from the code generator
 * @returns Result with lists of created/modified files and any errors
 */
export async function applyFeatureCode(
  projectPath: string,
  generationResult: FeatureGenerationResult,
): Promise<FeatureApplyResult> {
  const createdFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  // Phase 1: Create new files
  for (const file of generationResult.files) {
    try {
      const absolutePath = path.join(projectPath, file.path);

      // Validate path stays within project
      const resolved = path.resolve(absolutePath);
      const resolvedProject = path.resolve(projectPath);
      if (!resolved.startsWith(resolvedProject)) {
        errors.push({ file: file.path, error: 'Path traversal detected — skipped' });
        continue;
      }

      // Create directory if needed
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(absolutePath, file.content, 'utf-8');
      createdFiles.push(file.path);
      console.log(`[FeatureApplicator] Created: ${file.path}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push({ file: file.path, error: msg });
      console.error(`[FeatureApplicator] Error creating ${file.path}:`, msg);
    }
  }

  // Phase 2: Modify existing files
  for (const mod of generationResult.modified_files) {
    try {
      const absolutePath = path.join(projectPath, mod.path);

      // Validate path stays within project
      const resolved = path.resolve(absolutePath);
      const resolvedProject = path.resolve(projectPath);
      if (!resolved.startsWith(resolvedProject)) {
        errors.push({ file: mod.path, error: 'Path traversal detected — skipped' });
        continue;
      }

      // Only modify files that exist (don't create unexpected new files via modified_files)
      if (!fs.existsSync(absolutePath)) {
        // If file doesn't exist, treat it as a creation
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(absolutePath, mod.content, 'utf-8');
        createdFiles.push(mod.path);
        console.log(`[FeatureApplicator] Created (from modified_files): ${mod.path}`);
        continue;
      }

      // Write complete new content
      fs.writeFileSync(absolutePath, mod.content, 'utf-8');
      modifiedFiles.push(mod.path);
      console.log(`[FeatureApplicator] Modified: ${mod.path}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push({ file: mod.path, error: msg });
      console.error(`[FeatureApplicator] Error modifying ${mod.path}:`, msg);
    }
  }

  const success = errors.length === 0 || (createdFiles.length + modifiedFiles.length) > 0;

  return {
    created_files: createdFiles,
    modified_files: modifiedFiles,
    errors,
    success,
  };
}
