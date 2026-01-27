/**
 * Retriever: Context retrieval with scope control and evidence generation
 * Based on 04_INDEXING_RETRIEVAL_SPEC.md
 * 
 * Requirements:
 * - Lexical search via indexer
 * - Enforce max_files and max_lines constraints
 * - Every result must have a reason
 * - Emit retrieval_started/completed/failed events
 * - Produce evidence objects for excerpts
 * - Mode-based retrieval rules (ANSWER/PLAN/MISSION)
 * - Deterministic results
 */

import { v4 as uuidv4 } from 'uuid';
import { Indexer } from './indexer';
import {
  RetrievalRequest,
  RetrievalResponse,
  RetrievalResult,
  RetrievalReason,
  SearchMatch,
} from './types';
import { Event, Evidence, Mode } from '../types';
import { EventBus } from '../eventBus';

/**
 * Default scope limits (configurable)
 */
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_LINES_PER_FILE = 200;
const DEFAULT_MAX_TOTAL_LINES = 400;

export class Retriever {
  private indexer: Indexer;
  private eventBus: EventBus | null;
  private taskId: string;

  constructor(indexer: Indexer, eventBus: EventBus | null = null, taskId: string = 'default') {
    this.indexer = indexer;
    this.eventBus = eventBus;
    this.taskId = taskId;
  }

  /**
   * Retrieve context based on request
   * CRITICAL: Enforces scope limits and emits events
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResponse> {
    const retrievalId = uuidv4();

    // Emit retrieval_started event
    await this.emitEvent('retrieval_started', request.mode, {
      retrieval_id: retrievalId,
      query: request.query,
      mode: request.mode,
      stage: request.stage,
      constraints: request.constraints,
    });

    try {
      // Validate mode-based retrieval rules
      this.validateRetrievalForMode(request);

      // Apply default constraints if not provided
      const constraints = {
        max_files: request.constraints.max_files || DEFAULT_MAX_FILES,
        max_lines: request.constraints.max_lines || DEFAULT_MAX_TOTAL_LINES,
      };

      // Perform lexical search
      const matches = await this.indexer.search(request.query, 200);

      // Convert matches to results with reasons
      const results = await this.processMatches(matches, constraints);

      // Build response summary
      const summary = this.buildSummary(results, request);

      const response: RetrievalResponse = {
        results,
        summary,
      };

      // Calculate token estimate for Systems tab
      const totalCharacters = this.countTotalCharacters(results);
      const tokenEstimate = this.estimateTokens(totalCharacters);

      // Emit retrieval_completed event with token estimate
      await this.emitEvent('retrieval_completed', request.mode, {
        retrieval_id: retrievalId,
        result_count: results.length,
        total_lines: this.countTotalLines(results),
        totalCharacters,
        tokenEstimate,
        results: results.map(r => ({
          file: r.file,
          startLine: r.start_line,
          endLine: r.end_line,
          reason: r.reason,
        })),
        summary,
      });

      return response;
    } catch (error) {
      // Emit retrieval_failed event
      await this.emitEvent('retrieval_failed', request.mode, {
        retrieval_id: retrievalId,
        error: error instanceof Error ? error.message : 'Unknown error',
        reason: this.getFailureReason(error),
      });

      throw error;
    }
  }

  /**
   * Validate retrieval rules based on mode
   */
  private validateRetrievalForMode(request: RetrievalRequest): void {
    switch (request.mode) {
      case 'ANSWER':
        // ANSWER mode: retrieval is OPTIONAL, limited scope
        if (request.constraints.max_files > 3) {
          throw new Error('ANSWER mode cannot retrieve more than 3 files');
        }
        break;

      case 'PLAN':
        // PLAN mode: retrieval is ALLOWED, read-only
        // Strict scope limits apply
        break;

      case 'MISSION':
        // MISSION mode: retrieval is REQUIRED
        // Must precede edits
        break;

      default:
        throw new Error(`Unknown mode: ${request.mode}`);
    }
  }

  /**
   * Process search matches into retrieval results
   * Groups matches by file and enforces scope limits
   */
  private async processMatches(
    matches: SearchMatch[],
    constraints: { max_files: number; max_lines: number }
  ): Promise<RetrievalResult[]> {
    const results: RetrievalResult[] = [];
    const fileGroups = new Map<string, SearchMatch[]>();

    // Group matches by file
    for (const match of matches) {
      if (!fileGroups.has(match.file)) {
        fileGroups.set(match.file, []);
      }
      fileGroups.get(match.file)!.push(match);
    }

    // Sort files by number of matches (most relevant first)
    const sortedFiles = Array.from(fileGroups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, constraints.max_files); // Enforce max_files

    let totalLines = 0;

    // Create results for each file
    for (const [file, fileMatches] of sortedFiles) {
      // Calculate line range that covers all matches
      const lines = fileMatches.map(m => m.line).sort((a, b) => a - b);
      const startLine = lines[0];
      const endLine = Math.min(
        lines[lines.length - 1] + 5, // Include some context
        startLine + DEFAULT_MAX_LINES_PER_FILE
      );

      const lineCount = endLine - startLine + 1;

      // Check if adding this result would exceed total line limit
      if (totalLines + lineCount > constraints.max_lines) {
        break;
      }

      // Read excerpt for evidence
      const excerpt = await this.indexer.readFileLines(file, startLine, endLine);

      results.push({
        file,
        start_line: startLine,
        end_line: endLine,
        reason: 'lexical_match',
        excerpt,
      });

      totalLines += lineCount;
    }

    return results;
  }

  /**
   * Build summary of retrieval results
   */
  private buildSummary(results: RetrievalResult[], request: RetrievalRequest): string {
    if (results.length === 0) {
      return `No results found for query: "${request.query}"`;
    }

    const fileCount = results.length;
    const totalLines = this.countTotalLines(results);
    const reasonCounts = this.countReasons(results);

    return `Retrieved ${fileCount} file(s) with ${totalLines} total lines. ` +
           `Reasons: ${Object.entries(reasonCounts).map(([r, c]) => `${r}(${c})`).join(', ')}`;
  }

  /**
   * Count total lines across all results
   */
  private countTotalLines(results: RetrievalResult[]): number {
    return results.reduce((sum, r) => sum + (r.end_line - r.start_line + 1), 0);
  }

  /**
   * Count total characters across all results (for token estimate)
   */
  private countTotalCharacters(results: RetrievalResult[]): number {
    return results.reduce((sum, r) => sum + (r.excerpt?.length || 0), 0);
  }

  /**
   * Estimate token count from characters
   * Rough estimate: ~4 characters per token (conservative for code)
   */
  private estimateTokens(totalCharacters: number): number {
    return Math.ceil(totalCharacters / 4);
  }

  /**
   * Count results by reason
   */
  private countReasons(results: RetrievalResult[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const result of results) {
      counts[result.reason] = (counts[result.reason] || 0) + 1;
    }
    return counts;
  }

  /**
   * Get failure reason from error
   */
  private getFailureReason(error: unknown): string {
    if (error instanceof Error) {
      if (error.message.includes('permission')) {
        return 'permissions';
      }
      if (error.message.includes('index')) {
        return 'index_missing';
      }
      return 'unknown';
    }
    return 'unknown';
  }

  /**
   * Emit retrieval event
   */
  private async emitEvent(
    type: 'retrieval_started' | 'retrieval_completed' | 'retrieval_failed',
    mode: Mode,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!this.eventBus) {
      return; // No event bus configured
    }

    const event: Event = {
      event_id: uuidv4(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type,
      mode,
      stage: 'retrieve',
      payload,
      evidence_ids: [],
      parent_event_id: null,
    };

    await this.eventBus.publish(event);
  }

  /**
   * Create evidence object from retrieval result
   * Used by consumers to produce Evidence for UI
   */
  createEvidence(result: RetrievalResult, sourceEventId: string): Evidence {
    return {
      evidence_id: uuidv4(),
      type: 'file',
      source_event_id: sourceEventId,
      content_ref: `${result.file}:${result.start_line}-${result.end_line}`,
      summary: `Retrieved from ${result.file} (${result.reason})`,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Request scope expansion (requires user approval)
   * Returns approval_id for tracking
   */
  async requestScopeExpansion(
    currentConstraints: { max_files: number; max_lines: number },
    requestedConstraints: { max_files: number; max_lines: number },
    reason: string
  ): Promise<string> {
    const approvalId = uuidv4();

    // Emit scope_expansion_requested event directly (not a retrieval event)
    if (this.eventBus) {
      const event: Event = {
        event_id: uuidv4(),
        task_id: this.taskId,
        timestamp: new Date().toISOString(),
        type: 'scope_expansion_requested',
        mode: 'PLAN',
        stage: 'retrieve',
        payload: {
          approval_id: approvalId,
          current_constraints: currentConstraints,
          requested_constraints: requestedConstraints,
          reason,
        },
        evidence_ids: [],
        parent_event_id: null,
      };

      await this.eventBus.publish(event);
    }

    return approvalId;
  }
}
