/**
 * Unified Diff Parser and Validator
 * Based on MISSION EDIT spec requirements
 * 
 * Handles:
 * - Parsing unified diff format
 * - Validating diff structure
 * - Extracting file changes and statistics
 * - Safety validation (no create/delete/rename/mode changes)
 */

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface ParsedFileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isCreate: boolean;
  isDelete: boolean;
  isRename: boolean;
  hasModeChange: boolean;
}

export interface ParsedDiff {
  files: ParsedFileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  totalChangedLines: number;
}

export interface DiffValidationResult {
  valid: boolean;
  errors: DiffValidationError[];
  warnings: string[];
  parsed?: ParsedDiff;
}

export interface DiffValidationError {
  type: 'parse_error' | 'safety_violation' | 'scope_violation' | 'sha_mismatch' | 'empty_diff';
  code: string; // Short error code for testing (e.g., 'FILE_CREATION', 'SHA_MISMATCH')
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Parse unified diff string into structured format
 */
export function parseUnifiedDiff(diffText: string): ParsedDiff {
  // Normalize line endings to LF
  const normalized = diffText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  
  const files: ParsedFileDiff[] = [];
  let currentFile: ParsedFileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];

    // File header: --- a/path
    if (line.startsWith('--- ')) {
      // Save previous file if exists
      if (currentFile) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
          currentHunk = null;
        }
        files.push(currentFile);
      }

      const oldPath = parseFilePath(line.substring(4));
      const nextLine = lines[lineIndex + 1] || '';
      
      if (!nextLine.startsWith('+++ ')) {
        throw new Error(`Expected +++ line after --- at line ${lineIndex + 1}`);
      }

      const newPath = parseFilePath(nextLine.substring(4));

      currentFile = {
        oldPath,
        newPath,
        hunks: [],
        additions: 0,
        deletions: 0,
        isCreate: oldPath === '/dev/null',
        isDelete: newPath === '/dev/null',
        isRename: oldPath !== newPath && oldPath !== '/dev/null' && newPath !== '/dev/null',
        hasModeChange: false,
      };

      lineIndex += 2;
      continue;
    }

    // Mode change detection
    if (line.startsWith('old mode ') || line.startsWith('new mode ') || 
        line.startsWith('similarity index') || line.startsWith('rename from') ||
        line.startsWith('rename to') || line.startsWith('new file mode') ||
        line.startsWith('deleted file mode')) {
      if (currentFile) {
        currentFile.hasModeChange = true;
      }
      lineIndex++;
      continue;
    }

    // Hunk header: @@ -start,count +start,count @@
    if (line.startsWith('@@')) {
      if (!currentFile) {
        throw new Error(`Hunk header found without file header at line ${lineIndex + 1}`);
      }

      // Save previous hunk
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const hunkMatch = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!hunkMatch) {
        throw new Error(`Invalid hunk header at line ${lineIndex + 1}: ${line}`);
      }

      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };

      lineIndex++;
      continue;
    }

    // Diff content lines
    if (currentHunk && currentFile) {
      if (line.startsWith(' ')) {
        // Context line
        currentHunk.lines.push({
          type: 'context',
          content: line.substring(1),
        });
      } else if (line.startsWith('-')) {
        // Deletion
        currentHunk.lines.push({
          type: 'deletion',
          content: line.substring(1),
        });
        currentFile.deletions++;
      } else if (line.startsWith('+')) {
        // Addition
        currentHunk.lines.push({
          type: 'addition',
          content: line.substring(1),
        });
        currentFile.additions++;
      } else if (line === '\\ No newline at end of file') {
        // Special marker, skip
      } else if (line === '' && lineIndex === lines.length - 1) {
        // Empty last line, skip
      } else if (line.startsWith('diff --git')) {
        // Git diff header, continue to next iteration
        lineIndex++;
        continue;
      }
    }

    lineIndex++;
  }

  // Save last file and hunk
  if (currentFile) {
    if (currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    files.push(currentFile);
  }

  // Calculate totals
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }

  return {
    files,
    totalAdditions,
    totalDeletions,
    totalChangedLines: totalAdditions + totalDeletions,
  };
}

/**
 * Parse file path from diff header
 * Handles "a/path", "b/path", "/dev/null"
 */
function parseFilePath(pathStr: string): string {
  const trimmed = pathStr.trim();
  
  if (trimmed === '/dev/null') {
    return '/dev/null';
  }

  // Remove a/ or b/ prefix
  if (trimmed.startsWith('a/') || trimmed.startsWith('b/')) {
    return trimmed.substring(2);
  }

  return trimmed;
}

/**
 * Validate unified diff against spec requirements
 */
export function validateDiff(
  diffText: string,
  options: Partial<{
    allowedPaths: string[];
    maxFiles: number;
    maxChangedLines: number;
    baseShaMap: Map<string, string>; // path -> expected base_sha
    touchedFiles: Array<{ path: string; base_sha: string }>; // from LLM response
  }> = {}
): DiffValidationResult {
  const errors: DiffValidationError[] = [];
  const warnings: string[] = [];
  let parsed: ParsedDiff | undefined;

  // Defaults
  const allowedPaths = options.allowedPaths || [];
  const maxFiles = options.maxFiles ?? Infinity;
  const maxChangedLines = options.maxChangedLines ?? Infinity;
  const baseShaMap = options.baseShaMap || new Map();
  const touchedFiles = options.touchedFiles || [];

  // 5a) PARSE VALIDATION
  try {
    parsed = parseUnifiedDiff(diffText);
  } catch (error) {
    errors.push({
      type: 'parse_error',
      code: 'PARSE_ERROR',
      message: error instanceof Error ? error.message : 'Failed to parse diff',
      details: { raw_error: String(error) },
    });
    return { valid: false, errors, warnings };
  }

  // 5f) EMPTY DIFF CHECK
  if (!diffText.trim() || parsed.files.length === 0) {
    errors.push({
      type: 'empty_diff',
      code: 'EMPTY_DIFF',
      message: 'Diff is empty or contains no file changes',
    });
    return { valid: false, errors, warnings, parsed };
  }

  // 5c) SAFETY VALIDATION
  for (const file of parsed.files) {
    // No file creation
    if (file.isCreate) {
      errors.push({
        type: 'safety_violation',
        code: 'FILE_CREATION',
        message: 'File creation is not allowed',
        details: { violation_type: 'create', file: file.newPath },
      });
    }

    // No file deletion
    if (file.isDelete) {
      errors.push({
        type: 'safety_violation',
        code: 'FILE_DELETION',
        message: 'File deletion is not allowed',
        details: { violation_type: 'delete', file: file.oldPath },
      });
    }

    // No rename
    if (file.isRename) {
      errors.push({
        type: 'safety_violation',
        code: 'FILE_RENAME',
        message: 'File rename is not allowed',
        details: { violation_type: 'rename', oldPath: file.oldPath, newPath: file.newPath },
      });
    }

    // No mode changes
    if (file.hasModeChange) {
      errors.push({
        type: 'safety_violation',
        code: 'MODE_CHANGE',
        message: 'File mode changes are not allowed',
        details: { violation_type: 'mode_change', file: file.newPath },
      });
    }

    // Path must be relative and within workspace
    const filePath = file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
    if (filePath.startsWith('/') || filePath.includes('..')) {
      errors.push({
        type: 'safety_violation',
        code: 'PATH_TRAVERSAL',
        message: 'Path must be relative and within workspace',
        details: { violation_type: 'path_traversal', file: filePath },
      });
    }

    // File must be in allowed paths (files we sent to LLM) - only check if allowedPaths is provided
    if (allowedPaths.length > 0 && !allowedPaths.includes(filePath)) {
      errors.push({
        type: 'safety_violation',
        code: 'UNKNOWN_FILE',
        message: 'File was not in the context sent to LLM',
        details: { violation_type: 'unknown_file', file: filePath },
      });
    }
  }

  // 5d) BASE_SHA VALIDATION
  for (const touchedFile of touchedFiles) {
    const expectedSha = baseShaMap.get(touchedFile.path);
    if (expectedSha && touchedFile.base_sha !== expectedSha) {
      errors.push({
        type: 'sha_mismatch',
        code: 'SHA_MISMATCH',
        message: `base_sha mismatch for ${touchedFile.path}`,
        details: {
          file: touchedFile.path,
          expected: expectedSha,
          got: touchedFile.base_sha,
        },
      });
    }
  }

  // 5e) SCOPE VALIDATION
  if (parsed.files.length > maxFiles) {
    errors.push({
      type: 'scope_violation',
      code: 'SCOPE_FILES_EXCEEDED',
      message: `Too many files changed: ${parsed.files.length} > ${maxFiles}`,
      details: {
        type: 'max_files',
        limit: maxFiles,
        actual: parsed.files.length,
      },
    });
  }

  if (parsed.totalChangedLines > maxChangedLines) {
    errors.push({
      type: 'scope_violation',
      code: 'SCOPE_LINES_EXCEEDED',
      message: `Too many lines changed: ${parsed.totalChangedLines} > ${maxChangedLines}`,
      details: {
        type: 'max_changed_lines',
        limit: maxChangedLines,
        actual: parsed.totalChangedLines,
      },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    parsed,
  };
}

/**
 * Apply a parsed diff to file content
 * Returns the new content after applying the diff
 */
export function applyDiffToContent(originalContent: string, fileDiff: ParsedFileDiff): string {
  const lines = originalContent.split('\n');
  const result: string[] = [];

  let oldLineNum = 1;

  for (const hunk of fileDiff.hunks) {
    // Copy lines before this hunk
    while (oldLineNum < hunk.oldStart) {
      result.push(lines[oldLineNum - 1] || '');
      oldLineNum++;
    }

    // Apply hunk
    for (const diffLine of hunk.lines) {
      switch (diffLine.type) {
        case 'context':
          // Context line - copy from original
          result.push(lines[oldLineNum - 1] || '');
          oldLineNum++;
          break;
        case 'deletion':
          // Skip this line from original
          oldLineNum++;
          break;
        case 'addition':
          // Add new line
          result.push(diffLine.content);
          break;
      }
    }
  }

  // Copy remaining lines after last hunk
  while (oldLineNum <= lines.length) {
    result.push(lines[oldLineNum - 1]);
    oldLineNum++;
  }

  return result.join('\n');
}

/**
 * Generate unified diff from old and new content
 */
export function generateUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  const diffLines: string[] = [];
  diffLines.push(`--- a/${filePath}`);
  diffLines.push(`+++ b/${filePath}`);

  // Simple diff algorithm - find changed regions
  // For production, use a proper diff library like 'diff'
  let i = 0;
  let j = 0;
  let hunkOldStart = 1;
  let hunkNewStart = 1;
  const hunkLines: string[] = [];

  const flushHunk = () => {
    if (hunkLines.length > 0) {
      const contextCount = hunkLines.filter(l => l.startsWith(' ')).length;
      const deletions = hunkLines.filter(l => l.startsWith('-')).length;
      const additions = hunkLines.filter(l => l.startsWith('+')).length;
      
      diffLines.push(`@@ -${hunkOldStart},${contextCount + deletions} +${hunkNewStart},${contextCount + additions} @@`);
      diffLines.push(...hunkLines);
      hunkLines.length = 0;
    }
  };

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      // Context line
      if (hunkLines.length > 0) {
        hunkLines.push(` ${oldLines[i]}`);
      }
      i++;
      j++;
    } else if (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
      // Addition
      if (hunkLines.length === 0) {
        hunkOldStart = i + 1;
        hunkNewStart = j + 1;
        // Add context before
        if (i > 0) {
          hunkOldStart = i;
          hunkNewStart = j;
          hunkLines.push(` ${oldLines[i - 1] || ''}`);
        }
      }
      hunkLines.push(`+${newLines[j]}`);
      j++;
    } else if (i < oldLines.length) {
      // Deletion
      if (hunkLines.length === 0) {
        hunkOldStart = i + 1;
        hunkNewStart = j + 1;
        // Add context before
        if (i > 0) {
          hunkOldStart = i;
          hunkNewStart = j;
          hunkLines.push(` ${oldLines[i - 1] || ''}`);
        }
      }
      hunkLines.push(`-${oldLines[i]}`);
      i++;
    }

    // Flush hunk if we've accumulated changes and hit context
    if (hunkLines.length > 10 && 
        i < oldLines.length && j < newLines.length && 
        oldLines[i] === newLines[j]) {
      flushHunk();
    }
  }

  flushHunk();

  return diffLines.join('\n');
}
