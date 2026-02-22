/**
 * Agent Handler — The unified handler for Agent mode.
 *
 * Wraps the AgenticLoop directly. The LLM decides what tools to use
 * based on the system prompt and available tools. No pre-classification,
 * no regex routing, no separate command detection.
 */

import type { IProvider } from '../handlerContext';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  AgenticLoop,
  EventBus,
  buildFollowUpContext,
  ContextBudgetManager,
  getContextWindow,
  buildRecentActivityContext,
} from 'core';
import type { ContextLayer } from 'core';
import { AnthropicLLMClient } from '../anthropicLLMClient';
import { VSCodeToolProvider } from '../vsCodeToolProvider';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildAgentSystemPrompt(
  scaffoldContext: string | null,
): string {
  let prompt = `You are Ordinex, an AI coding assistant running in Agent mode inside VS Code.

You have tools: read_file, write_file, edit_file, run_command, search_files, list_directory. Fulfill requests directly.

Guidelines:
- If the user asks a question, answer it. Read files if needed for accuracy.
- If they need code changes, make them directly.
- If they ask to run a command, use the run_command tool.
- If their request would benefit from a structured plan first, suggest they switch to Plan mode — but otherwise just act.
- Be concise and precise. Prefer reading relevant code before making changes.
- When editing files, preserve existing style and conventions.`;

  if (scaffoldContext) {
    prompt += `\n\n${scaffoldContext}`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// handleAgentMode
// ---------------------------------------------------------------------------

export async function handleAgentMode(
  ctx: IProvider,
  userPrompt: string,
  taskId: string,
  modelId: string,
  webview: vscode.Webview,
): Promise<void> {
  console.log('=== AGENT MODE START ===');

  let webviewUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    // 1. Get API key
    const apiKey = await ctx._context.secrets.get('ordinex.apiKey');
    if (!apiKey) {
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
        'Set API Key',
      ).then(action => {
        if (action === 'Set API Key') {
          vscode.commands.executeCommand('ordinex.setApiKey');
        }
      });
      return;
    }

    // 2. Resolve workspace root (check scaffoldProjectPath, selectedWorkspaceRoot,
    //    workspace folders, and immediate subdirectories for package.json)
    let workspaceRoot = ctx.scaffoldProjectPath
      || ctx.selectedWorkspaceRoot
      || undefined;

    if (!workspaceRoot) {
      const folders = vscode.workspace.workspaceFolders;
      if (folders) {
        for (const folder of folders) {
          if (fs.existsSync(path.join(folder.uri.fsPath, 'package.json'))) {
            workspaceRoot = folder.uri.fsPath;
            break;
          }
        }
        if (!workspaceRoot && folders.length > 0) {
          const root = folders[0].uri.fsPath;
          try {
            for (const entry of fs.readdirSync(root).filter(e => !e.startsWith('.'))) {
              const ep = path.join(root, entry);
              if (fs.statSync(ep).isDirectory() && fs.existsSync(path.join(ep, 'package.json'))) {
                workspaceRoot = ep;
                break;
              }
            }
          } catch { /* skip */ }
          if (!workspaceRoot) workspaceRoot = root;
        }
      }
    }

    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // 3. Build conversation history + auto-compact if needed
    const history = ctx.getConversationHistory(taskId);
    history.addUserMessage(userPrompt);

    const modelWindow = getContextWindow(modelId) || 200_000;
    const compactionResult = await history.maybeCompact({
      modelContextWindow: modelWindow,
      llmClient: history.compactionCount >= 3
        ? new AnthropicLLMClient(apiKey) as any
        : undefined,
    });

    if (compactionResult.compacted) {
      console.log(`[Context] Compacted: ${compactionResult.tokensSaved} tokens saved (compaction #${compactionResult.compactionCount})`);
      webview.postMessage({ type: 'ordinex:contextCompacting' });
    }

    if (history.compactionCount >= 3) {
      webview.postMessage({ type: 'ordinex:suggestNewSession' });
    }

    // Send initial context usage to ring indicator
    const historyTokens = history.estimateTokens();
    webview.postMessage({
      type: 'ordinex:contextUsage',
      used: historyTokens,
      total: modelWindow,
      percentage: (historyTokens / modelWindow) * 100,
    });

    console.log(`[Agent] Conversation history: ${history.length} messages, ~${historyTokens} tokens`);

    // 4. Build system prompt with dynamic context budget
    const contextLayers: ContextLayer[] = [];

    // Priority 1: Base system prompt
    const basePrompt = buildAgentSystemPrompt(null);
    contextLayers.push({ label: 'system_base', content: basePrompt, priority: 1 });

    // Priority 2: Scaffold session context
    if (ctx.scaffoldSession) {
      const sessionCtx = buildFollowUpContext(ctx.scaffoldSession);
      contextLayers.push({ label: 'scaffold_session', content: sessionCtx, priority: 2 });
    } else if (ctx.scaffoldProjectPath) {
      contextLayers.push({
        label: 'scaffold_session',
        content: `[Context: Working on scaffolded project at "${ctx.scaffoldProjectPath}"]`,
        priority: 2,
      });
    }

    // Priority 3: Activity context from events
    if (ctx.eventStore) {
      const events = ctx.eventStore.getEventsByTaskId(taskId) || [];
      if (events.length > 0) {
        const activityCtx = buildRecentActivityContext(events);
        contextLayers.push({ label: 'activity_context', content: activityCtx, priority: 3 });
      }
    }

    const budgetManager = new ContextBudgetManager();
    const budgetResult = budgetManager.build(contextLayers, history, modelWindow);
    const systemPrompt = budgetResult.systemPrompt;

    if (budgetResult.layersDropped.length > 0) {
      console.log(`[ContextBudget] Dropped layers: ${budgetResult.layersDropped.join(', ')}`);
    }

    // 5. Create LLM client and tool provider
    if (!ctx.eventStore) {
      throw new Error('EventStore not initialized');
    }

    const eventBus = new EventBus(ctx.eventStore);
    const llmClient = new AnthropicLLMClient(apiKey, modelId);
    const toolProvider = new VSCodeToolProvider(workspaceRoot);
    toolProvider.setWebview(webview);

    // Debounced event forwarding (matches missionHandler pattern)
    const IMMEDIATE_EVENTS = new Set([
      'loop_paused', 'loop_completed', 'loop_failed',
      'failure_detected', 'approval_requested', 'approval_resolved',
    ]);
    const WEBVIEW_DEBOUNCE_MS = 150;

    const FILE_TOOLS = ['read_file', 'write_file', 'edit_file', 'search_files', 'list_directory', 'run_command'];

    eventBus.subscribe(async (event) => {
      // Skip raw stream events — narration goes through onStreamDelta callback
      if (event.type === 'stream_delta' || event.type === 'stream_complete') return;

      // Forward tool events as inline tool activity cards (mission UI)
      if ((event.type === 'tool_start' || event.type === 'tool_end') && event.payload?.tool) {
        const tool = event.payload.tool as string;
        if (FILE_TOOLS.includes(tool)) {
          webview.postMessage({
            type: 'ordinex:missionToolActivity',
            tool,
            event_type: event.type,
            tool_call_id: (event.payload as Record<string, unknown>)?.tool_use_id as string || event.parent_event_id || null,
            input: event.payload.input || {},
            success: event.type === 'tool_end' ? event.payload.status === 'success' : undefined,
            error: event.type === 'tool_end' ? (event.payload.error || undefined) : undefined,
          });
        }
      }

      // Immediate vs debounced event forwarding
      if (IMMEDIATE_EVENTS.has(event.type)) {
        if (webviewUpdateTimer) { clearTimeout(webviewUpdateTimer); webviewUpdateTimer = null; }
        await ctx.sendEventsToWebview(webview, taskId);
      } else {
        if (webviewUpdateTimer) { clearTimeout(webviewUpdateTimer); }
        webviewUpdateTimer = setTimeout(async () => {
          webviewUpdateTimer = null;
          await ctx.sendEventsToWebview(webview, taskId);
        }, WEBVIEW_DEBOUNCE_MS);
      }
    });

    // 6. Run the AgenticLoop — uses mission streaming path for execution UI
    const loop = new AgenticLoop(eventBus, taskId, 'MISSION');

    const result = await loop.run({
      llmClient,
      toolProvider,
      history,
      systemPrompt,
      model: modelId,
      onStreamDelta: (delta) => {
        webview.postMessage({
          type: 'ordinex:missionStreamDelta',
          task_id: taskId,
          delta,
          step_id: 'agent',
          iteration: 1,
        });
      },
      tokenCounter: ctx.getTokenCounter() ?? undefined,
    });

    // 7. Store response in history for follow-ups
    if (result.finalText) {
      history.addAssistantMessage(result.finalText);
    }

    // 8. Update context ring with post-loop usage
    const postLoopTokens = history.estimateTokens();
    webview.postMessage({
      type: 'ordinex:contextUsage',
      used: postLoopTokens,
      total: modelWindow,
      percentage: (postLoopTokens / modelWindow) * 100,
    });

    // 9. Flush any pending debounced event update
    if (webviewUpdateTimer) { clearTimeout(webviewUpdateTimer); webviewUpdateTimer = null; }

    // 10. Send mission stream completion — single source of truth for UI
    webview.postMessage({
      type: 'ordinex:missionStreamComplete',
      task_id: taskId,
    });

    // 11. Emit loop_completed event for diagnostics/logging
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'loop_completed',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        response: result.finalText,
        iterations: result.iterations,
        totalTokens: result.totalTokens,
        stopReason: result.stopReason,
        toolCallCount: result.toolCalls.length,
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await ctx.sendEventsToWebview(webview, taskId);
    console.log(`[Agent] Complete. ${result.iterations} iterations, ${result.toolCalls.length} tool calls`);

  } catch (error) {
    console.error('Error in Agent mode:', error);

    // Flush pending debounce timer
    if (webviewUpdateTimer) { clearTimeout(webviewUpdateTimer); webviewUpdateTimer = null; }

    // Mark streaming as complete so UI doesn't stay stuck on "Live"
    webview.postMessage({
      type: 'ordinex:missionStreamComplete',
      task_id: taskId,
    });

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
    vscode.window.showErrorMessage(
      `Agent mode failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
