/**
 * Staging Workspace — Atomic publish safety layer.
 *
 * All file modifications during the enhanced pipeline go through the staging
 * directory first (`.ordinex-staging/`). Once a stage completes successfully,
 * changes are atomically published (copied) to the real project directory.
 *
 * If a stage fails, the staging directory is cleaned up and the project
 * remains untouched.
 */

import * as fs from 'fs';
import * as path from 'path';

const STAGING_DIR = '.ordinex-staging';

export interface StagingContext {
  projectPath: string;
  stagingPath: string;
}

export function initStagingWorkspace(projectPath: string): StagingContext {
  const stagingPath = path.join(projectPath, STAGING_DIR);
  if (fs.existsSync(stagingPath)) {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingPath, { recursive: true });

  // Add staging dir to .gitignore if not already present
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes(STAGING_DIR)) {
      fs.appendFileSync(gitignorePath, `\n# Ordinex staging\n${STAGING_DIR}/\n`);
    }
  }

  return { projectPath, stagingPath };
}

/**
 * Stage a file modification — writes to staging dir mirroring project structure.
 */
export function stageFile(ctx: StagingContext, relativePath: string, content: string): void {
  const fullPath = path.join(ctx.stagingPath, relativePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

/**
 * Read a file from either staging (if modified) or original project.
 */
export function readStagedOrOriginal(ctx: StagingContext, relativePath: string): string | null {
  const stagedPath = path.join(ctx.stagingPath, relativePath);
  if (fs.existsSync(stagedPath)) {
    return fs.readFileSync(stagedPath, 'utf8');
  }
  const originalPath = path.join(ctx.projectPath, relativePath);
  if (fs.existsSync(originalPath)) {
    return fs.readFileSync(originalPath, 'utf8');
  }
  return null;
}

/**
 * Atomically publish staged files to the real project directory.
 * Returns list of published file paths (relative).
 */
export function publishStaged(ctx: StagingContext): string[] {
  const published: string[] = [];
  if (!fs.existsSync(ctx.stagingPath)) return published;

  copyDirRecursive(ctx.stagingPath, ctx.projectPath, '', published);
  return published;
}

function copyDirRecursive(src: string, dest: string, relativePath: string, published: string[]): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath, relPath, published);
    } else {
      fs.copyFileSync(srcPath, destPath);
      published.push(relPath);
    }
  }
}

/**
 * Clean up the staging directory.
 */
export function cleanupStaging(ctx: StagingContext): void {
  if (fs.existsSync(ctx.stagingPath)) {
    fs.rmSync(ctx.stagingPath, { recursive: true, force: true });
  }
}

/**
 * Get the list of staged files (relative paths).
 */
export function listStagedFiles(ctx: StagingContext): string[] {
  const files: string[] = [];
  if (!fs.existsSync(ctx.stagingPath)) return files;
  collectFiles(ctx.stagingPath, '', files);
  return files;
}

function collectFiles(dir: string, relativePath: string, files: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectFiles(path.join(dir, entry.name), relPath, files);
    } else {
      files.push(relPath);
    }
  }
}
