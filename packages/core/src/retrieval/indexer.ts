/**
 * Indexer: File discovery and lexical indexing
 * Based on 04_INDEXING_RETRIEVAL_SPEC.md
 * 
 * Requirements:
 * - File discovery via git ls-files (preferred) or filesystem walk
 * - Respect .gitignore and .ordinexignore
 * - Default ignored paths (node_modules, dist, etc.)
 * - Lexical search (token-based full-text)
 * - Deterministic results
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  IndexerConfig,
  FileMetadata,
  SearchMatch,
} from './types';

/**
 * Default paths to ignore (MANDATORY from spec)
 */
const DEFAULT_IGNORE_PATHS = [
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.next/',
  '.out/',
];

export class Indexer {
  private config: IndexerConfig;
  private fileCache: Map<string, FileMetadata> = new Map();
  private ignorePatterns: Set<string> = new Set();

  constructor(workspaceRoot: string, customIgnorePatterns: string[] = []) {
    this.config = {
      workspaceRoot,
      useGit: this.checkGitAvailable(),
      ignorePatterns: customIgnorePatterns,
      defaultIgnorePaths: DEFAULT_IGNORE_PATHS,
    };

    this.initializeIgnorePatterns();
  }

  /**
   * Check if git is available and workspace is a git repo
   */
  private checkGitAvailable(): boolean {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: this.config.workspaceRoot,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize ignore patterns from .gitignore and .ordinexignore
   */
  private initializeIgnorePatterns(): void {
    // Add default ignore paths
    DEFAULT_IGNORE_PATHS.forEach(p => this.ignorePatterns.add(p));

    // Add custom ignore patterns
    this.config.ignorePatterns.forEach(p => this.ignorePatterns.add(p));

    // Read .gitignore if exists
    this.loadIgnoreFile('.gitignore');

    // Read .ordinexignore if exists
    this.loadIgnoreFile('.ordinexignore');
  }

  /**
   * Load ignore patterns from a file
   */
  private loadIgnoreFile(filename: string): void {
    const filePath = path.join(this.config.workspaceRoot, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        content.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            this.ignorePatterns.add(trimmed);
          }
        });
      } catch (err) {
        // Ignore read errors
      }
    }
  }

  /**
   * Check if a path should be ignored
   */
  private shouldIgnore(relativePath: string): boolean {
    // Check against all ignore patterns
    for (const pattern of this.ignorePatterns) {
      if (this.matchPattern(relativePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple pattern matching for ignore rules
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Directory patterns (ending with /)
    if (pattern.endsWith('/')) {
      return path.startsWith(pattern) || path.includes('/' + pattern);
    }

    // Exact match or contains
    if (path === pattern || path.startsWith(pattern + '/') || path.includes('/' + pattern)) {
      return true;
    }

    // Wildcard patterns (simple * support)
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(path);
    }

    return false;
  }

  /**
   * Discover files using git ls-files (preferred) or filesystem walk
   * RETURNS: List of relative file paths
   */
  async discoverFiles(): Promise<string[]> {
    if (this.config.useGit) {
      return this.discoverFilesGit();
    } else {
      return this.discoverFilesFilesystem();
    }
  }

  /**
   * Discover files using git ls-files
   */
  private discoverFilesGit(): string[] {
    try {
      const output = execSync('git ls-files', {
        cwd: this.config.workspaceRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const files = output
        .split('\n')
        .filter(line => line.trim().length > 0)
        .filter(file => !this.shouldIgnore(file));

      return files.sort(); // Deterministic ordering
    } catch (err) {
      // Fallback to filesystem walk on error
      return this.discoverFilesFilesystem();
    }
  }

  /**
   * Discover files via filesystem walk (fallback)
   */
  private discoverFilesFilesystem(): string[] {
    const files: string[] = [];
    this.walkDirectory(this.config.workspaceRoot, '', files);
    return files.sort(); // Deterministic ordering
  }

  /**
   * Recursive directory walk
   */
  private walkDirectory(baseDir: string, relativePath: string, files: string[]): void {
    const fullPath = path.join(baseDir, relativePath);

    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (this.shouldIgnore(entryRelPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          this.walkDirectory(baseDir, entryRelPath, files);
        } else if (entry.isFile()) {
          files.push(entryRelPath);
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  /**
   * Index a file (store metadata for caching)
   */
  async indexFile(relativePath: string): Promise<void> {
    const fullPath = path.join(this.config.workspaceRoot, relativePath);

    try {
      const stats = fs.statSync(fullPath);
      this.fileCache.set(relativePath, {
        path: relativePath,
        size: stats.size,
        lastModified: stats.mtimeMs,
      });
    } catch (err) {
      // File doesn't exist or can't be read
    }
  }

  /**
   * Lexical search across files
   * Uses simple grep-like search for V1
   * Returns matches with context
   */
  async search(query: string, maxResults: number = 100): Promise<SearchMatch[]> {
    const files = await this.discoverFiles();
    const matches: SearchMatch[] = [];
    const queryLower = query.toLowerCase();

    for (const file of files) {
      if (matches.length >= maxResults) {
        break;
      }

      const fileMatches = await this.searchInFile(file, queryLower);
      matches.push(...fileMatches);

      if (matches.length >= maxResults) {
        matches.splice(maxResults);
        break;
      }
    }

    return matches;
  }

  /**
   * Search for query in a single file
   */
  private async searchInFile(relativePath: string, queryLower: string): Promise<SearchMatch[]> {
    const fullPath = path.join(this.config.workspaceRoot, relativePath);
    const matches: SearchMatch[] = [];

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();
        const matchStart = lineLower.indexOf(queryLower);

        if (matchStart !== -1) {
          matches.push({
            file: relativePath,
            line: i + 1, // 1-indexed
            content: line,
            matchStart,
            matchEnd: matchStart + queryLower.length,
          });
        }
      }
    } catch (err) {
      // Skip files we can't read (binary, permissions, etc.)
    }

    return matches;
  }

  /**
   * Read file content for excerpt extraction
   */
  async readFileLines(relativePath: string, startLine: number, endLine: number): Promise<string> {
    const fullPath = path.join(this.config.workspaceRoot, relativePath);

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      
      // Clamp to valid range (1-indexed)
      const start = Math.max(0, startLine - 1);
      const end = Math.min(lines.length, endLine);
      
      return lines.slice(start, end).join('\n');
    } catch (err) {
      return '';
    }
  }

  /**
   * Get file metadata from cache
   */
  getFileMetadata(relativePath: string): FileMetadata | undefined {
    return this.fileCache.get(relativePath);
  }

  /**
   * Clear cache (for testing)
   */
  clearCache(): void {
    this.fileCache.clear();
  }
}
