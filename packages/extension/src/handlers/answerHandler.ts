/**
 * Answer Handler — extracted from MissionControlViewProvider.
 *
 * Handles ANSWER mode: streams an LLM response enriched with project context.
 * All functions take `ctx: IProvider` as first parameter instead of using `this`.
 */

import type { IProvider } from '../handlerContext';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  collectAnswerContext,
  buildAnswerModeSystemMessage,
  LLMService,
  EventBus,
} from 'core';

// ---------------------------------------------------------------------------
// handleAnswerMode
// ---------------------------------------------------------------------------

/**
 * Handle ANSWER mode: Stream LLM response with project context.
 *
 * 1. Retrieves the API key from SecretStorage.
 * 2. Collects project context (open files, tree, inferred stack).
 * 3. Builds a system prompt with that context.
 * 4. Streams the LLM response back to the webview.
 * 5. Persists the answer as evidence on disk.
 */
export async function handleAnswerMode(
  ctx: IProvider,
  userQuestion: string,
  taskId: string,
  modelId: string,
  webview: vscode.Webview,
): Promise<void> {
  console.log('=== ANSWER MODE START ===');
  console.log('Question:', userQuestion);
  console.log('Task ID:', taskId);
  console.log('Model ID:', modelId);

  try {
    // 1. Get API key from SecretStorage
    console.log('Step 1: Getting API key from SecretStorage...');
    const apiKey = await ctx._context.secrets.get('ordinex.apiKey');
    console.log('API key retrieved:', apiKey ? `YES (length: ${apiKey.length})` : 'NO');

    if (!apiKey) {
      // No API key - emit failure and prompt user to set it
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'failure_detected',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          error: 'No API key configured',
          suggestion: 'Run command "Ordinex: Set API Key" to configure your Anthropic API key',
        },
        evidence_ids: [],
        parent_event_id: null,
      });

      await ctx.sendEventsToWebview(webview, taskId);

      vscode.window.showErrorMessage(
        'Ordinex API key not found. Please run "Ordinex: Set API Key" command.',
        'Set API Key'
      ).then(action => {
        if (action === 'Set API Key') {
          vscode.commands.executeCommand('ordinex.setApiKey');
        }
      });

      return;
    }

    // 2. Collect project context for ANSWER mode
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // Get open files from VS Code
    const openFiles = vscode.workspace.textDocuments
      .filter(doc => doc.uri.scheme === 'file')
      .map(doc => ({
        path: vscode.workspace.asRelativePath(doc.uri),
        content: doc.getText()
      }));

    console.log('Step 2: Collecting project context...');
    const contextBundle = await collectAnswerContext({
      workspaceRoot,
      openFiles,
      maxFileLines: 200,
      maxTreeDepth: 2
    });
    console.log('Context collected:', {
      filesCount: contextBundle.files.length,
      openFilesCount: contextBundle.open_files.length,
      inferredStack: contextBundle.inferred_stack
    });

    // Emit context_collected event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'context_collected',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        files_included: contextBundle.files.map(f => f.path),
        open_files_count: contextBundle.open_files.length,
        total_lines: contextBundle.files.reduce((sum, f) => sum + f.excerpt.split('\n').length, 0),
        inferred_stack: contextBundle.inferred_stack,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Send to webview immediately so UI updates
    await ctx.sendEventsToWebview(webview, taskId);

    // Build system message with context
    const systemContext = buildAnswerModeSystemMessage(contextBundle);
    console.log('System context length:', systemContext.length);

    // 3. Initialize event bus and LLM service
    if (!ctx.eventStore) {
      throw new Error('EventStore not initialized');
    }

    const eventBus = new EventBus(ctx.eventStore);
    const llmService = new LLMService(taskId, eventBus, ctx.currentMode, ctx.currentStage);

    // Subscribe to events from LLMService to send them to webview in real-time
    // Skip stream events - they're handled separately via streamDelta messages
    eventBus.subscribe(async (event) => {
      // Don't send eventsUpdate for stream events - they're handled separately via streamDelta messages
      if (event.type === 'stream_delta' || event.type === 'stream_complete') {
        return;
      }

      // For all other events (including tool_start, tool_end), send full update immediately
      await ctx.sendEventsToWebview(webview, taskId);
    });

    // 4. Stream LLM response with project context
    let fullAnswer = '';

    const response = await llmService.streamAnswerWithContext(
      userQuestion,
      systemContext,
      {
        apiKey,
        model: modelId,
        maxTokens: 4096,
      },
      (chunk) => {
        if (!chunk.done) {
          fullAnswer += chunk.delta;

          // Send streaming delta to webview
          webview.postMessage({
            type: 'ordinex:streamDelta',
            task_id: taskId,
            delta: chunk.delta,
          });
        } else {
          // Send completion signal
          webview.postMessage({
            type: 'ordinex:streamComplete',
            task_id: taskId,
          });
        }
      }
    );

    // 4. Create evidence for the assistant answer
    const evidenceDir = path.join(ctx._context.globalStorageUri.fsPath, 'evidence');

    // Ensure evidence directory exists
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    const evidenceId = ctx.generateId();
    const evidenceFilePath = path.join(evidenceDir, `${evidenceId}.txt`);

    // Write answer to evidence file
    fs.writeFileSync(evidenceFilePath, response.content, 'utf-8');

    // 5. Update the last tool_end event to include evidence_ids
    // (The LLMService already emitted tool_end, but we need to add evidence to it)
    // For now, we'll just emit a new event with the evidence
    // In production, we'd update the existing tool_end event

    await ctx.sendEventsToWebview(webview, taskId);

    console.log('ANSWER mode completed successfully');

  } catch (error) {
    console.error('Error in ANSWER mode:', error);

    // Emit failure_detected event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'failure_detected',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);

    vscode.window.showErrorMessage(`ANSWER mode failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
