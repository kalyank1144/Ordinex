/**
 * Truncation-Safe Edit Executor
 * 
 * Production-hardened execution that handles:
 * - Layer 0: Target file set determination (bound output)
 * - Layer 1: Truncation detection via API stop_reason
 * - Layer 2: Split-by-file recovery with EditAttemptLedger
 * - Layer 3: Preflight estimation (proactive splitting)
 * - Layer 4: Graceful degradation (never apply partial/corrupt output)
 */

import { EventBus } from './eventBus';
import { Mode } from './types';
import { EditAttemptLedger, FileEditAttempt } from './editAttemptLedger';
import { LLMEditStepInput, LLMEditStepOutput, LLMEditStepResult } from './llmEditTool';
import { LLMConfig } from './llmService';
import { FileContextEntry } from './excerptSelector';
import { safeJsonParse } from './jsonRepair';
import { resolveModel } from './modelRegistry';

/**
 * Truncation detection result
 */
export interface TruncationDetectionResult {
  truncated: boolean;
  reason: 'stop_reason' | 'json_invalid' | 'missing_sentinel' | 'none';
  stopReason?: string;
  partialLength?: number;
  details?: string;
}

/**
 * Single-file edit output (simpler than full output)
 */
export interface SingleFileEditOutput {
  file: string;
  action: 'create' | 'update' | 'delete';
  unified_diff: string;
  new_content?: string;
  base_sha?: string | null;
  complete: boolean;  // Sentinel field
  notes?: string;
}

/**
 * Preflight estimation result
 */
export interface PreflightResult {
  shouldSplit: boolean;
  reason?: string;
  targetFiles: Array<{ path: string; reason: string }>;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

/**
 * Truncation-safe execution result
 */
export interface TruncationSafeResult {
  success: boolean;
  output?: LLMEditStepOutput;
  ledger?: EditAttemptLedger;
  wasSplit: boolean;
  truncationDetected: boolean;
  pausedForDecision: boolean;
  pauseReason?: string;
  error?: {
    type: 'truncation' | 'split_failed' | 'max_retries' | 'llm_error' | 'validation_error';
    message: string;
    details?: Record<string, unknown>;
  };
  duration_ms: number;
}

/**
 * Configuration for truncation-safe execution
 */
export interface TruncationSafeConfig {
  maxFilesBeforeSplit: number;  // Trigger split if > N files
  maxAttemptsPerFile: number;   // Max retries per file
  maxTotalChunks: number;       // Max total LLM calls
  requireCompleteSentinel: boolean;  // Require complete:true in output
}

const DEFAULT_CONFIG: TruncationSafeConfig = {
  maxFilesBeforeSplit: 1,  // Conservative: always split if > 1 file
  maxAttemptsPerFile: 2,
  maxTotalChunks: 10,
  requireCompleteSentinel: true,
};

/**
 * Truncation-Safe Edit Executor
 */
export class TruncationSafeExecutor {
  private readonly taskId: string;
  private readonly eventBus: EventBus;
  private readonly mode: Mode;
  private readonly config: TruncationSafeConfig;

  constructor(
    taskId: string,
    eventBus: EventBus,
    mode: Mode = 'MISSION',
    config: Partial<TruncationSafeConfig> = {}
  ) {
    this.taskId = taskId;
    this.eventBus = eventBus;
    this.mode = mode;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute edit step with truncation safety
   * This is the main entry point
   */
  async execute(
    input: LLMEditStepInput,
    llmConfig: LLMConfig,
    fileContext: FileContextEntry[]
  ): Promise<TruncationSafeResult> {
    const startTime = Date.now();

    // Layer 0: Determine target file set
    const preflight = await this.runPreflight(input, fileContext);

    // Emit preflight event
    await this.emitEvent('preflight_complete', {
      shouldSplit: preflight.shouldSplit,
      reason: preflight.reason,
      targetFileCount: preflight.targetFiles.length,
      estimatedComplexity: preflight.estimatedComplexity,
    });

    // Layer 3: Check if we should pre-split
    if (preflight.shouldSplit && preflight.targetFiles.length > 1) {
      console.log(`[TruncationSafeExecutor] Pre-splitting: ${preflight.reason}`);
      return this.executeSplitByFile(input, llmConfig, fileContext, preflight.targetFiles, startTime);
    }

    // Try single-call execution first
    const result = await this.executeSingleCall(input, llmConfig, fileContext);
    
    if (result.success && !result.truncationDetected) {
      return {
        ...result,
        wasSplit: false,
        pausedForDecision: false,
        duration_ms: Date.now() - startTime,
      };
    }

    // Truncation detected - trigger Layer 2 recovery
    if (result.truncationDetected && preflight.targetFiles.length > 0) {
      console.log('[TruncationSafeExecutor] Truncation detected, triggering split-by-file recovery');
      
      await this.emitEvent('truncation_detected', {
        reason: result.error?.message || 'unknown',
        partialLength: result.error?.details?.partialLength,
        stopReason: result.error?.details?.stopReason,
      });

      return this.executeSplitByFile(input, llmConfig, fileContext, preflight.targetFiles, startTime);
    }

    // No target files to split - fail gracefully
    // IMPORTANT: Preserve the actual error message for debugging
    const actualErrorMessage = result.error?.message || 'Unknown error';
    const pauseReasonWithError = result.truncationDetected 
      ? `Output truncated and unable to split: ${actualErrorMessage}`
      : `LLM edit failed: ${actualErrorMessage}`;
    
    return {
      success: false,
      wasSplit: false,
      truncationDetected: result.truncationDetected,
      pausedForDecision: true,
      pauseReason: pauseReasonWithError,
      error: result.error || {
        type: 'llm_error',
        message: actualErrorMessage,
      },
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Layer 0: Preflight - Determine target file set and estimate complexity
   */
  private async runPreflight(
    input: LLMEditStepInput,
    fileContext: FileContextEntry[]
  ): Promise<PreflightResult> {
    const targetFiles: Array<{ path: string; reason: string }> = [];

    // Extract files from file_context
    for (const file of fileContext) {
      targetFiles.push({
        path: file.path,
        reason: 'In file context',
      });
    }

    // Parse step description for file hints
    const stepText = input.step_text.toLowerCase();
    const filePatterns = [
      /create\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(\S+\.(?:ts|tsx|js|jsx|css|json))/gi,
      /update\s+(?:the\s+)?(\S+\.(?:ts|tsx|js|jsx|css|json))/gi,
      /modify\s+(?:the\s+)?(\S+\.(?:ts|tsx|js|jsx|css|json))/gi,
      /in\s+(\S+\.(?:ts|tsx|js|jsx|css|json))/gi,
    ];

    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(input.step_text)) !== null) {
        const path = match[1];
        if (!targetFiles.some(f => f.path === path)) {
          targetFiles.push({
            path,
            reason: 'Mentioned in step description',
          });
        }
      }
    }

    // Check for component creation patterns
    if (stepText.includes('create') && (stepText.includes('component') || stepText.includes('form'))) {
      // Likely creating new files - extract potential paths
      const componentMatch = /(\w+(?:form|component|page|view|modal|dialog))/gi;
      let match;
      while ((match = componentMatch.exec(input.step_text)) !== null) {
        const componentName = match[1];
        const path = `src/components/${componentName}.tsx`;
        if (!targetFiles.some(f => f.path.includes(componentName))) {
          targetFiles.push({
            path,
            reason: `New component: ${componentName}`,
          });
        }
      }
    }

    // Estimate complexity
    let estimatedComplexity: 'low' | 'medium' | 'high' = 'low';
    
    if (targetFiles.length > 3) {
      estimatedComplexity = 'high';
    } else if (targetFiles.length > 1) {
      estimatedComplexity = 'medium';
    }

    // Calculate total lines in context
    const totalLines = fileContext.reduce((sum, f) => 
      sum + (f.content?.split('\n').length || 0), 0);
    
    if (totalLines > 500) {
      estimatedComplexity = 'high';
    } else if (totalLines > 200) {
      estimatedComplexity = estimatedComplexity === 'low' ? 'medium' : estimatedComplexity;
    }

    // Determine if we should split
    const shouldSplit = 
      targetFiles.length > this.config.maxFilesBeforeSplit ||
      estimatedComplexity === 'high';

    return {
      shouldSplit,
      reason: shouldSplit 
        ? `${targetFiles.length} target files, ${estimatedComplexity} complexity`
        : undefined,
      targetFiles,
      estimatedComplexity,
    };
  }

  /**
   * Execute single LLM call (standard path)
   */
  private async executeSingleCall(
    input: LLMEditStepInput,
    llmConfig: LLMConfig,
    fileContext: FileContextEntry[]
  ): Promise<{
    success: boolean;
    output?: LLMEditStepOutput;
    truncationDetected: boolean;
    error?: TruncationSafeResult['error'];
  }> {
    try {
      // Call LLM with stop_reason tracking
      const { content, stopReason } = await this.callLLMWithStopReason(
        this.buildSystemPrompt(),
        this.buildUserPrompt(input, fileContext),
        llmConfig
      );

      // Layer 1: Truncation detection
      const truncation = this.detectTruncation(content, stopReason);
      
      if (truncation.truncated) {
        console.warn(`[TruncationSafeExecutor] Truncation detected: ${truncation.reason}`);
        return {
          success: false,
          truncationDetected: true,
          error: {
            type: 'truncation',
            message: `Output truncated: ${truncation.reason}`,
            details: {
              stopReason: truncation.stopReason,
              partialLength: truncation.partialLength,
            },
          },
        };
      }

      // Parse output
      const parseResult = this.parseOutput(content);
      
      if (!parseResult.success || !parseResult.output) {
        return {
          success: false,
          truncationDetected: truncation.reason === 'json_invalid',
          error: {
            type: 'validation_error',
            message: parseResult.error || 'Failed to parse output',
          },
        };
      }

      return {
        success: true,
        output: parseResult.output,
        truncationDetected: false,
      };

    } catch (error) {
      return {
        success: false,
        truncationDetected: false,
        error: {
          type: 'llm_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Layer 2: Split-by-file execution
   */
  private async executeSplitByFile(
    input: LLMEditStepInput,
    llmConfig: LLMConfig,
    fileContext: FileContextEntry[],
    targetFiles: Array<{ path: string; reason: string }>,
    startTime: number
  ): Promise<TruncationSafeResult> {
    // Create ledger for tracking
    const ledger = new EditAttemptLedger(input.step_id, targetFiles, {
      maxAttemptsPerFile: this.config.maxAttemptsPerFile,
      maxTotalChunks: this.config.maxTotalChunks,
    });

    await this.emitEvent('edit_split_triggered', {
      reason: 'preflight_or_truncation',
      file_count: targetFiles.length,
    });

    // Process files one at a time
    let nextFile = ledger.getNextFile();
    let chunkIndex = 0;

    while (nextFile) {
      chunkIndex++;
      
      await this.emitEvent('edit_chunk_started', {
        file: nextFile.path,
        chunk_index: chunkIndex,
        total_chunks: targetFiles.length,
      });

      ledger.markInProgress(nextFile.path);

      try {
        // Get file context for this specific file
        const fileCtx = fileContext.find(f => f.path === nextFile!.path);
        
        // Execute single-file edit
        const result = await this.executeSingleFileEdit(
          input,
          llmConfig,
          nextFile.path,
          fileCtx,
          nextFile.reason
        );

        if (result.success && result.output) {
          ledger.markDone(nextFile.path, {
            unified_diff: result.output.unified_diff,
            new_content: result.output.new_content,
            action: result.output.action,
            base_sha: result.output.base_sha,
          });

          await this.emitEvent('edit_chunk_completed', {
            file: nextFile.path,
          });

        } else if (result.noChangesNeeded) {
          ledger.markSkipped(nextFile.path, 'No changes needed');
          
        } else {
          ledger.markFailed(nextFile.path, result.error || 'Unknown error');

          await this.emitEvent('edit_chunk_failed', {
            file: nextFile.path,
            reason: result.error,
          });
        }

      } catch (error) {
        ledger.markFailed(nextFile.path, error instanceof Error ? error.message : String(error));
        
        await this.emitEvent('edit_chunk_failed', {
          file: nextFile.path,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      // Check if we should pause (Layer 4)
      const shouldPause = ledger.shouldPause();
      if (shouldPause.pause) {
        ledger.pause(shouldPause.reason!);

        await this.emitEvent('edit_step_paused', {
          reason: shouldPause.reason,
          progress: ledger.getProgress(),
        });

        return {
          success: false,
          ledger,
          wasSplit: true,
          truncationDetected: true,
          pausedForDecision: true,
          pauseReason: shouldPause.reason,
          duration_ms: Date.now() - startTime,
        };
      }

      nextFile = ledger.getNextFile();
    }

    // Check completion
    if (ledger.isComplete()) {
      ledger.complete();

      // Combine results
      const combinedOutput = this.combineResults(ledger);

      return {
        success: true,
        output: combinedOutput,
        ledger,
        wasSplit: true,
        truncationDetected: false,
        pausedForDecision: false,
        duration_ms: Date.now() - startTime,
      };
    }

    // Some files failed - BUILD DETAILED ERROR MESSAGE
    const failed = ledger.getFailedFiles();
    
    // Create detailed error messages for each failed file
    const failedDetails = failed.map(f => `${f.path}: ${f.lastError || 'Unknown error'}`).join('; ');
    const summaryMsg = `${failed.length} file(s) failed after maximum retries`;
    const fullErrorMsg = `${summaryMsg}: ${failedDetails}`;
    
    ledger.fail(fullErrorMsg);

    console.error('[TruncationSafeExecutor] Some files failed:', failedDetails);

    return {
      success: false,
      ledger,
      wasSplit: true,
      truncationDetected: true,
      pausedForDecision: true,
      pauseReason: fullErrorMsg,  // CRITICAL: Include actual errors in pause reason
      error: {
        type: 'split_failed',
        message: fullErrorMsg,  // User-facing message includes details
        details: {
          failed: failed.map(f => ({ path: f.path, error: f.lastError })),
        },
      },
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Execute single-file edit with focused prompt
   */
  private async executeSingleFileEdit(
    input: LLMEditStepInput,
    llmConfig: LLMConfig,
    filePath: string,
    fileContext: FileContextEntry | undefined,
    reason: string
  ): Promise<{
    success: boolean;
    output?: SingleFileEditOutput;
    noChangesNeeded?: boolean;
    error?: string;
  }> {
    console.log(`[TruncationSafeExecutor] ========================================`);
    console.log(`[TruncationSafeExecutor] Starting single-file edit for: ${filePath}`);
    console.log(`[TruncationSafeExecutor] Reason: ${reason}`);
    console.log(`[TruncationSafeExecutor] File context exists: ${!!fileContext}`);
    
    const systemPrompt = this.buildSingleFileSystemPrompt();
    const userPrompt = this.buildSingleFileUserPrompt(input, filePath, fileContext, reason);

    console.log(`[TruncationSafeExecutor] System prompt length: ${systemPrompt.length}`);
    console.log(`[TruncationSafeExecutor] User prompt length: ${userPrompt.length}`);

    try {
      console.log(`[TruncationSafeExecutor] Calling LLM...`);
      const { content, stopReason } = await this.callLLMWithStopReason(
        systemPrompt,
        userPrompt,
        llmConfig
      );

      console.log(`[TruncationSafeExecutor] LLM responded with ${content.length} chars, stopReason: ${stopReason}`);
      console.log(`[TruncationSafeExecutor] First 500 chars of response: ${content.substring(0, 500)}`);

      // Check truncation
      const truncation = this.detectTruncation(content, stopReason);
      if (truncation.truncated) {
        const errorMsg = `Truncated: ${truncation.reason} (stopReason: ${stopReason}, length: ${content.length})`;
        console.error(`[TruncationSafeExecutor] ❌ ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
        };
      }

      // Parse single-file output
      console.log(`[TruncationSafeExecutor] Parsing JSON response...`);
      const parseResult = safeJsonParse(content);
      if (!parseResult.success || !parseResult.data) {
        const errorMsg = `JSON parse failed: ${parseResult.error || 'Unknown parse error'}`;
        console.error(`[TruncationSafeExecutor] ❌ ${errorMsg}`);
        console.error(`[TruncationSafeExecutor] Raw content that failed to parse: ${content.substring(0, 1000)}`);
        return {
          success: false,
          error: errorMsg,
        };
      }

      const output = parseResult.data as any;
      console.log(`[TruncationSafeExecutor] Parsed output keys: ${Object.keys(output).join(', ')}`);

      // Check sentinel
      if (this.config.requireCompleteSentinel && output.complete !== true) {
        const errorMsg = `Missing complete:true sentinel (got: ${output.complete})`;
        console.error(`[TruncationSafeExecutor] ❌ ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
        };
      }

      // Check for no-changes response
      if (output.no_changes || output.skip) {
        console.log(`[TruncationSafeExecutor] ✓ No changes needed for ${filePath}`);
        return {
          success: true,
          noChangesNeeded: true,
        };
      }

      // Validate required fields
      if (!output.file || !output.action) {
        const errorMsg = `Missing required fields - file: ${!!output.file}, action: ${!!output.action}`;
        console.error(`[TruncationSafeExecutor] ❌ ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
        };
      }

      console.log(`[TruncationSafeExecutor] ✓ Successfully parsed edit for ${filePath}, action: ${output.action}`);
      console.log(`[TruncationSafeExecutor] ========================================`);

      return {
        success: true,
        output: {
          file: output.file,
          action: output.action,
          unified_diff: output.unified_diff || '',
          new_content: output.new_content,
          base_sha: output.base_sha || null,
          complete: true,
          notes: output.notes,
        },
      };

    } catch (error) {
      const errorMsg = error instanceof Error 
        ? `${error.name}: ${error.message}${error.stack ? '\nStack: ' + error.stack.substring(0, 200) : ''}`
        : String(error);
      console.error(`[TruncationSafeExecutor] ❌ EXCEPTION in executeSingleFileEdit for ${filePath}:`);
      console.error(`[TruncationSafeExecutor] ${errorMsg}`);
      console.error(`[TruncationSafeExecutor] ========================================`);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Layer 1: Detect truncation from multiple signals
   */
  private detectTruncation(content: string, stopReason?: string): TruncationDetectionResult {
    // Check stop_reason first (most reliable)
    if (stopReason) {
      const truncatedReasons = ['max_tokens', 'length', 'stop_sequence'];
      const completeReasons = ['end_turn', 'stop', 'end'];
      
      if (truncatedReasons.includes(stopReason.toLowerCase())) {
        return {
          truncated: true,
          reason: 'stop_reason',
          stopReason,
          partialLength: content.length,
          details: `API stopped due to: ${stopReason}`,
        };
      }
    }

    // Check JSON validity
    const parseResult = safeJsonParse(content);
    if (!parseResult.success) {
      return {
        truncated: true,
        reason: 'json_invalid',
        partialLength: content.length,
        details: parseResult.error,
      };
    }

    // Check for complete sentinel
    const parsed = parseResult.data as any;
    if (this.config.requireCompleteSentinel) {
      if (parsed.complete !== true && parsed.final !== true) {
        // Only treat as truncation if JSON is valid but sentinel missing
        // This could also be a schema error, so we're lenient
        console.warn('[TruncationSafeExecutor] Missing complete/final sentinel');
        // Don't mark as truncated - could be LLM not following instructions
      }
    }

    return {
      truncated: false,
      reason: 'none',
    };
  }

  /**
   * Call LLM and capture stop_reason
   */
  private async callLLMWithStopReason(
    systemPrompt: string,
    userPrompt: string,
    config: LLMConfig
  ): Promise<{ content: string; stopReason?: string }> {
    const Anthropic = await this.loadAnthropicSDK();
    
    const client = new Anthropic({
      apiKey: config.apiKey,
    });

    const model = resolveModel(config.model);

    // Retry logic for transient errors
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: config.maxTokens || 16384,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt },
          ],
        });

        // Extract content
        const content = response.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('');

        // Capture stop_reason
        const stopReason = response.stop_reason;

        console.log(`[TruncationSafeExecutor] LLM call succeeded, stop_reason: ${stopReason}`);

        return { content, stopReason };

      } catch (error: any) {
        const isOverloaded = error?.status === 529 || 
                           error?.error?.type === 'overloaded_error';
        const isRateLimited = error?.status === 429;

        if ((isOverloaded || isRateLimited) && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
          console.log(`[TruncationSafeExecutor] Retrying in ${Math.round(delay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw new Error('LLM API call failed after all retries');
  }

  /**
   * Build system prompt for full edit
   */
  private buildSystemPrompt(): string {
    return `You are editing code for a specific task step.

OUTPUT REQUIREMENTS:
Output ONLY valid JSON with these exact fields:
- unified_diff: string (unified diff format for display)
- touched_files: array of {path, action, new_content, base_sha}
- confidence: "low" | "medium" | "high"
- notes: string
- validation_status: "ok" | "stale_context" | "cannot_edit"
- complete: true (REQUIRED - sentinel to confirm output is complete)

For create/update actions, new_content MUST contain the COMPLETE new file content.

CRITICAL: Always include "complete": true at the end of your JSON to confirm the output is not truncated.`;
  }

  /**
   * Build system prompt for single-file edit
   */
  private buildSingleFileSystemPrompt(): string {
    return `You are editing a SINGLE FILE for a specific task step.

OUTPUT REQUIREMENTS:
Output ONLY valid JSON with these exact fields:
{
  "file": "path/to/file.ext",
  "action": "create" | "update" | "delete",
  "unified_diff": "--- old\\n+++ new\\n@@ -1,3 +1,4 @@...",
  "new_content": "COMPLETE file content here",
  "base_sha": "sha256 or null for new files",
  "notes": "what was changed",
  "complete": true
}

If no changes are needed for this file:
{ "file": "path/to/file.ext", "no_changes": true, "complete": true }

CRITICAL RULES:
1. new_content MUST be the COMPLETE file content, not a snippet
2. Always include "complete": true to confirm output is not truncated
3. Focus ONLY on the specified file
4. If the file doesn't exist and needs creation, use action: "create"`;
  }

  /**
   * Build user prompt for full edit
   */
  private buildUserPrompt(input: LLMEditStepInput, fileContext: FileContextEntry[]): string {
    const fileContextStr = fileContext.map(f => {
      return `=== FILE: ${f.path} (base_sha: ${f.base_sha}) ===
${f.content}
=== END FILE ===`;
    }).join('\n\n');

    return `TASK STEP: ${input.step_text}

CONSTRAINTS:
- Maximum files: ${input.constraints.max_files}
- Maximum changed lines: ${input.constraints.max_changed_lines}
- File creation: ${input.constraints.forbid_create ? 'FORBIDDEN' : 'allowed'}
- File deletion: ${input.constraints.forbid_delete ? 'FORBIDDEN' : 'allowed'}

FILE CONTEXT:
${fileContextStr}

Generate the changes. Output ONLY valid JSON with complete:true.`;
  }

  /**
   * Build user prompt for single-file edit
   */
  private buildSingleFileUserPrompt(
    input: LLMEditStepInput,
    filePath: string,
    fileContext: FileContextEntry | undefined,
    reason: string
  ): string {
    const fileInfo = fileContext 
      ? `=== CURRENT FILE CONTENT: ${filePath} (base_sha: ${fileContext.base_sha}) ===
${fileContext.content}
=== END FILE ===`
      : `=== FILE: ${filePath} ===
(This is a NEW FILE to be created)
=== END FILE ===`;

    return `TASK STEP: ${input.step_text}

TARGET FILE: ${filePath}
REASON: ${reason}

${fileInfo}

Generate the changes for THIS FILE ONLY. Output valid JSON with complete:true.
If this file doesn't need changes for the task, return { "file": "${filePath}", "no_changes": true, "complete": true }`;
  }

  /**
   * Parse full output
   */
  private parseOutput(content: string): { success: boolean; output?: LLMEditStepOutput; error?: string } {
    const parseResult = safeJsonParse(content);
    
    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        error: parseResult.error || 'JSON parse failed',
      };
    }

    const parsed = parseResult.data as any;

    // Validate required fields
    if (!parsed.touched_files || !Array.isArray(parsed.touched_files)) {
      return {
        success: false,
        error: 'Missing or invalid touched_files array',
      };
    }

    return {
      success: true,
      output: parsed as LLMEditStepOutput,
    };
  }

  /**
   * Combine results from ledger into LLMEditStepOutput
   */
  private combineResults(ledger: EditAttemptLedger): LLMEditStepOutput {
    const touchedFiles = ledger.getTouchedFiles();
    const combinedDiff = ledger.getCombinedDiff();
    const progress = ledger.getProgress();

    return {
      unified_diff: combinedDiff,
      touched_files: touchedFiles,
      confidence: 'high',
      notes: `Split execution: ${progress.done}/${progress.total} files completed`,
      validation_status: 'ok',
    };
  }

  /**
   * Emit event to event bus
   */
  private async emitEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.eventBus.publish({
      event_id: this.generateId(),
      task_id: this.taskId,
      timestamp: new Date().toISOString(),
      type: type as any,
      mode: this.mode,
      stage: 'edit',
      payload,
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  /**
   * Load Anthropic SDK
   */
  private async loadAnthropicSDK(): Promise<any> {
    try {
      const anthropic = require('@anthropic-ai/sdk');
      return anthropic.default || anthropic;
    } catch {
      throw new Error('Anthropic SDK not installed');
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}

/**
 * Create truncation-safe executor
 */
export function createTruncationSafeExecutor(
  taskId: string,
  eventBus: EventBus,
  mode: Mode = 'MISSION',
  config?: Partial<TruncationSafeConfig>
): TruncationSafeExecutor {
  return new TruncationSafeExecutor(taskId, eventBus, mode, config);
}
