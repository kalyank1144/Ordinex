/**
 * Deterministic Excerpt Selector for MISSION EDIT
 * Based on spec Section 3: DETERMINISTIC EXCERPT SELECTION STRATEGY
 * 
 * Handles:
 * - Selecting files based on retrieval results, open editors, or fallback
 * - Extracting relevant excerpts with imports, exports, keyword matches
 * - Building file_context with line numbers and base_sha
 * - Staying within line/file limits
 */

import { computeBaseSha } from './shaUtils';

/**
 * File context entry as sent to LLM
 */
export interface FileContextEntry {
  path: string;
  content: string;              // Excerpt or full content
  base_sha: string;             // SHA-256 of FULL file, truncated to 12 chars
  line_start: number;           // 1-indexed, inclusive
  line_end: number;             // 1-indexed, inclusive
  is_full_file: boolean;        // true if content is complete file
}

/**
 * Range of lines (1-indexed, inclusive)
 */
interface LineRange {
  start: number;
  end: number;
}

/**
 * File selection result for evidence
 */
export interface FileSelectionEvidence {
  path: string;
  base_sha: string;
  lines_included: number;
  is_full_file: boolean;
  ranges: Array<[number, number]>;
}

/**
 * Edit context selection result
 */
export interface EditContextSelectionResult {
  file_context: FileContextEntry[];
  total_lines: number;
  selection_method: string;
  evidence: {
    files: FileSelectionEvidence[];
    total_lines: number;
    selection_method: string;
  };
}

/**
 * Input source for file selection
 */
export interface FileSelectionSource {
  // Retrieval results (highest priority)
  retrievalResults?: Array<{ path: string; score: number }>;
  // Currently open editors in VS Code
  openEditors?: string[];
  // Fallback anchor files from context
  fallbackFiles?: string[];
}

/**
 * Configuration for excerpt selection
 */
export interface ExcerptSelectionConfig {
  maxFiles: number;               // Default 6
  maxTotalLines: number;          // Default 400
  fullFileThreshold: number;      // Default 150 - include full file if under this
  importSectionMaxLines: number;  // Default 30
  contextLinesAroundMatch: number; // Default 20
  exportContextLines: number;     // Default 5
}

const DEFAULT_CONFIG: ExcerptSelectionConfig = {
  maxFiles: 6,
  maxTotalLines: 400,
  fullFileThreshold: 150,
  importSectionMaxLines: 30,
  contextLinesAroundMatch: 20,
  exportContextLines: 5,
};

/**
 * Select files and build file_context for LLM
 */
export async function selectEditContext(
  sources: FileSelectionSource,
  stepText: string,
  readFile: (path: string) => Promise<string>,
  config: Partial<ExcerptSelectionConfig> = {}
): Promise<EditContextSelectionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const selectedPaths: string[] = [];
  let selectionMethod = 'fallback';

  // FILE SELECTION (priority order)
  // a) Files from retrieval results
  if (sources.retrievalResults && sources.retrievalResults.length > 0) {
    const sorted = [...sources.retrievalResults].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    });
    selectedPaths.push(...sorted.slice(0, cfg.maxFiles).map(r => r.path));
    selectionMethod = 'retrieval';
  }

  // b) Currently open editors
  if (selectedPaths.length < cfg.maxFiles && sources.openEditors) {
    for (const path of sources.openEditors) {
      if (selectedPaths.length >= cfg.maxFiles) break;
      if (!selectedPaths.includes(path)) {
        selectedPaths.push(path);
      }
    }
    if (selectionMethod === 'fallback') {
      selectionMethod = 'open_editors';
    } else {
      selectionMethod += ' + open_editors';
    }
  }

  // c) Fallback anchor files
  if (selectedPaths.length < cfg.maxFiles && sources.fallbackFiles) {
    for (const path of sources.fallbackFiles) {
      if (selectedPaths.length >= cfg.maxFiles) break;
      if (!selectedPaths.includes(path)) {
        selectedPaths.push(path);
      }
    }
    if (selectionMethod === 'fallback') {
      selectionMethod = 'anchor_files';
    }
  }

  // Read files and build context
  const fileContext: FileContextEntry[] = [];
  const evidenceFiles: FileSelectionEvidence[] = [];
  let totalLines = 0;

  // Extract keywords from step text for matching
  const keywords = extractKeywords(stepText);

  for (const path of selectedPaths) {
    if (totalLines >= cfg.maxTotalLines) break;

    try {
      const fullContent = await readFile(path);
      const base_sha = computeBaseSha(fullContent);
      const lines = fullContent.split('\n');
      const fileLineCount = lines.length;

      // Determine if we should include full file or excerpts
      if (fileLineCount <= cfg.fullFileThreshold) {
        // Include FULL file
        const contentWithLineNumbers = addLineNumbers(lines, 1);
        const linesToAdd = Math.min(fileLineCount, cfg.maxTotalLines - totalLines);
        
        fileContext.push({
          path,
          content: contentWithLineNumbers.slice(0, linesToAdd).join('\n'),
          base_sha,
          line_start: 1,
          line_end: linesToAdd,
          is_full_file: linesToAdd === fileLineCount,
        });

        evidenceFiles.push({
          path,
          base_sha,
          lines_included: linesToAdd,
          is_full_file: linesToAdd === fileLineCount,
          ranges: [[1, linesToAdd]],
        });

        totalLines += linesToAdd;
      } else {
        // Extract relevant excerpts
        const ranges = selectExcerptRanges(lines, keywords, cfg);
        const mergedRanges = mergeOverlappingRanges(ranges);
        
        // Limit to available budget
        let excerptLines = 0;
        const limitedRanges: LineRange[] = [];
        
        for (const range of mergedRanges) {
          const rangeLines = range.end - range.start + 1;
          if (totalLines + excerptLines + rangeLines <= cfg.maxTotalLines) {
            limitedRanges.push(range);
            excerptLines += rangeLines;
          }
        }

        if (limitedRanges.length > 0) {
          // Build content from ranges
          const excerptContent = buildExcerptContent(lines, limitedRanges);
          
          fileContext.push({
            path,
            content: excerptContent,
            base_sha,
            line_start: limitedRanges[0].start,
            line_end: limitedRanges[limitedRanges.length - 1].end,
            is_full_file: false,
          });

          evidenceFiles.push({
            path,
            base_sha,
            lines_included: excerptLines,
            is_full_file: false,
            ranges: limitedRanges.map(r => [r.start, r.end] as [number, number]),
          });

          totalLines += excerptLines;
        }
      }
    } catch (error) {
      console.warn(`[ExcerptSelector] Could not read file ${path}:`, error);
    }
  }

  return {
    file_context: fileContext,
    total_lines: totalLines,
    selection_method: selectionMethod,
    evidence: {
      files: evidenceFiles,
      total_lines: totalLines,
      selection_method: selectionMethod,
    },
  };
}

/**
 * Extract keywords from step text for matching
 */
function extractKeywords(stepText: string): string[] {
  // Extract words that are likely to be identifiers
  const words = stepText.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
  
  // Filter out common words
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this',
    'that', 'these', 'those', 'it', 'its', 'if', 'then', 'else', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'only', 'same', 'so', 'than', 'too',
    'very', 'just', 'also', 'now', 'here', 'there', 'new', 'old', 'add',
    'create', 'update', 'delete', 'modify', 'change', 'implement', 'fix',
    'function', 'method', 'class', 'interface', 'type', 'const', 'let',
    'var', 'import', 'export', 'return', 'async', 'await', 'file', 'files',
  ]);

  return words
    .filter(w => !commonWords.has(w.toLowerCase()))
    .filter(w => w.length >= 3);
}

/**
 * Select excerpt ranges for a file based on strategy
 */
function selectExcerptRanges(
  lines: string[],
  keywords: string[],
  config: ExcerptSelectionConfig
): LineRange[] {
  const ranges: LineRange[] = [];
  const fileLineCount = lines.length;

  // 1. IMPORTS SECTION: lines 1 to first_non_import_line (max importSectionMaxLines)
  const importEndLine = findImportSectionEnd(lines);
  if (importEndLine > 0) {
    ranges.push({
      start: 1,
      end: Math.min(importEndLine, config.importSectionMaxLines),
    });
  }

  // 2. EXPORTS SECTION: lines containing "export" keyword (with context)
  for (let i = 0; i < lines.length; i++) {
    if (/\bexport\b/.test(lines[i])) {
      const start = Math.max(1, i + 1 - config.exportContextLines);
      const end = Math.min(fileLineCount, i + 1 + config.exportContextLines);
      ranges.push({ start, end });
    }
  }

  // 3. RELEVANT MATCHES: keyword matches with context
  for (const keyword of keywords) {
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        const start = Math.max(1, i + 1 - config.contextLinesAroundMatch);
        const end = Math.min(fileLineCount, i + 1 + config.contextLinesAroundMatch);
        ranges.push({ start, end });
      }
    }
  }

  // 4. If still under 100 lines, include file start (first 50 lines)
  const totalFromRanges = ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
  if (totalFromRanges < 100 && fileLineCount > 0) {
    ranges.push({
      start: 1,
      end: Math.min(50, fileLineCount),
    });
  }

  return ranges;
}

/**
 * Find the end of the import section
 */
function findImportSectionEnd(lines: string[]): number {
  let lastImportLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check for import statements
    if (
      line.startsWith('import ') ||
      line.startsWith('import{') ||
      line.startsWith('const ') && line.includes('require(') ||
      line.startsWith('let ') && line.includes('require(') ||
      line.startsWith('var ') && line.includes('require(') ||
      line.startsWith('from ') ||
      line.startsWith('require(')
    ) {
      lastImportLine = i + 1;
    }
    
    // Stop searching after significant code starts
    if (
      (line.startsWith('export ') && !line.includes('import')) ||
      line.startsWith('class ') ||
      line.startsWith('function ') ||
      line.startsWith('interface ') ||
      line.startsWith('type ') && !line.startsWith('typeof')
    ) {
      break;
    }
    
    // Don't search too far
    if (i > 100) break;
  }
  
  return lastImportLine;
}

/**
 * Merge overlapping ranges
 */
function mergeOverlappingRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) return [];

  // Sort by start line
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  
  const merged: LineRange[] = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = merged[merged.length - 1];
    
    // Check for overlap (including adjacent ranges)
    if (current.start <= previous.end + 1) {
      // Merge by extending end
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push(current);
    }
  }
  
  return merged;
}

/**
 * Build excerpt content from ranges with line numbers
 */
function buildExcerptContent(lines: string[], ranges: LineRange[]): string {
  const result: string[] = [];
  
  for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
    const range = ranges[rangeIdx];
    
    // Add separator between ranges
    if (rangeIdx > 0) {
      result.push('... (lines omitted) ...');
    }
    
    // Add lines with line numbers
    for (let i = range.start; i <= range.end && i <= lines.length; i++) {
      const lineContent = lines[i - 1] || '';
      const lineNum = String(i).padStart(5, ' ');
      result.push(`${lineNum} | ${lineContent}`);
    }
  }
  
  return result.join('\n');
}

/**
 * Add line numbers to content
 */
function addLineNumbers(lines: string[], startLine: number): string[] {
  return lines.map((line, idx) => {
    const lineNum = String(startLine + idx).padStart(5, ' ');
    return `${lineNum} | ${line}`;
  });
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build base_sha map from file context
 */
export function buildBaseShaMap(fileContext: FileContextEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of fileContext) {
    map.set(entry.path, entry.base_sha);
  }
  return map;
}
