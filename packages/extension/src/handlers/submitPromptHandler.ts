/**
 * Submit Prompt Handler — Main entry point for all user submissions.
 *
 * Simplified routing:
 *   1. Workspace-aware scaffold detection (is this a greenfield request?)
 *   2. Route to user's selected mode: Agent (default) or Plan
 *
 * No more: QUICK_ACTION, RUN_COMMAND, CLARIFY, CONTINUE_RUN, LLM classification,
 * edit-scale detection, or auto-mode-switching.
 */

import type { IProvider } from '../handlerContext';
import type { EnrichedInput, Mode } from 'core';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  routeIntent,
  enrichUserInput,
  buildFollowUpContext,
  EventBus,
  resolveModel,
} from 'core';
import type { IntentRoutingResult, WorkspaceState, RoutingContext } from 'core';
import { BackendLLMClient } from '../backendLLMClient';

import { handleAgentMode } from './agentHandler';
import { handlePlanMode } from './planHandler';
import { handleScaffoldFlow } from './scaffoldHandler';
import { fileExists } from '../utils/fsAsync';

// ---------------------------------------------------------------------------
// resolveActiveProjectRoot — find the workspace folder that contains the project
// ---------------------------------------------------------------------------

async function resolveActiveProjectRoot(ctx: IProvider): Promise<string | undefined> {
  if (ctx.scaffoldProjectPath) {
    if (await fileExists(path.join(ctx.scaffoldProjectPath, 'package.json'))) {
      return ctx.scaffoldProjectPath;
    }
    console.log('[resolveActiveProjectRoot] Stale scaffoldProjectPath cleared:', ctx.scaffoldProjectPath);
    ctx.scaffoldProjectPath = null;
  }

  if (ctx.selectedWorkspaceRoot) return ctx.selectedWorkspaceRoot;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;

  for (const folder of folders) {
    const p = folder.uri.fsPath;
    if (await fileExists(path.join(p, 'package.json'))) return p;
  }

  // Scaffold creates projects at <workspace>/<app-name>/. After reload,
  // the workspace folder is the parent. Check immediate subdirectories.
  const root = folders[0].uri.fsPath;
  try {
    const entries = await fs.promises.readdir(root);
    const visible = entries.filter(e => !e.startsWith('.'));
    for (const entry of visible) {
      const entryPath = path.join(root, entry);
      try {
        const stat = await fs.promises.stat(entryPath);
        if (stat.isDirectory() &&
            (await fileExists(path.join(entryPath, 'package.json')))) {
          return entryPath;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return root;
}

// ---------------------------------------------------------------------------
// getWorkspaceState — checks ALL workspace folders for project indicators
// ---------------------------------------------------------------------------

async function getWorkspaceState(primaryRoot: string | undefined): Promise<WorkspaceState | undefined> {
  if (!primaryRoot) return undefined;
  try {
    const entries = await fs.promises.readdir(primaryRoot);
    const visible = entries.filter(e => !e.startsWith('.'));
    let hasPackageJson = await fileExists(path.join(primaryRoot, 'package.json'));
    let hasGitRepo = await fileExists(path.join(primaryRoot, '.git'));
    let fileCount = visible.length;

    // Scaffold creates projects at <workspace>/<app-name>/. After reload the
    // workspace root is the PARENT, not the project. Scan immediate
    // subdirectories so the quick-reject fires for existing projects.
    if (!hasPackageJson) {
      for (const entry of visible) {
        try {
          const entryPath = path.join(primaryRoot, entry);
          const stat = await fs.promises.stat(entryPath);
          if (stat.isDirectory() &&
              (await fileExists(path.join(entryPath, 'package.json')))) {
            hasPackageJson = true;
            fileCount = Math.max(fileCount, 11);
            break;
          }
        } catch { /* skip unreadable entries */ }
      }
    }

    if (!hasPackageJson) {
      const folders = vscode.workspace.workspaceFolders || [];
      for (const folder of folders) {
        const fp = folder.uri.fsPath;
        if (fp === primaryRoot) continue;
        if (await fileExists(path.join(fp, 'package.json'))) {
          hasPackageJson = true;
          break;
        }
      }
    }

    return { fileCount, hasPackageJson, hasGitRepo };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// handleSubmitPrompt
// ---------------------------------------------------------------------------

export async function handleSubmitPrompt(
  ctx: IProvider,
  msg: any,
  webview: vscode.Webview,
): Promise<void> {
  console.log('=== handleSubmitPrompt START ===');
  const { text, userSelectedMode, modelId, attachments } = msg;
  console.log('Params:', { text, userSelectedMode, modelId, attachmentCount: attachments?.length || 0 });

  if (!text || !userSelectedMode) {
    console.error('Missing required fields in submitPrompt');
    return;
  }

  // Create task_id if not active
  if (!ctx.currentTaskId) {
    ctx.currentTaskId = ctx.generateId();
    ctx.currentStage = 'none';
    await ctx.setModeWithEvent(userSelectedMode, ctx.currentTaskId, {
      reason: 'User selected mode for new task',
      user_initiated: true,
    });
  } else if (ctx.currentMode !== userSelectedMode) {
    await ctx.setModeWithEvent(userSelectedMode, ctx.currentTaskId, {
      reason: 'User switched mode on follow-up turn',
      user_initiated: true,
    });
  }

  const taskId = ctx.currentTaskId;
  ctx.setGlobalCurrentTaskId(taskId);

  const attachmentEvidenceIds: string[] = (attachments || [])
    .filter((a: any) => a.evidence_id)
    .map((a: any) => a.evidence_id);

  try {
    // 1. Emit intent_received event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'intent_received',
      mode: userSelectedMode,
      stage: ctx.currentStage,
      payload: {
        prompt: text,
        model_id: modelId || 'sonnet-4.5',
        user_selected_mode: userSelectedMode,
        attachments: attachments || [],
      },
      evidence_ids: attachmentEvidenceIds,
      parent_event_id: null,
    });
    await ctx.sendEventsToWebview(webview, taskId);
    await ctx.updateTaskPersistence(taskId, { mode: userSelectedMode, stage: ctx.currentStage });

    // 2. Enrich user input with intelligence layer
    const workspaceRoot = (await resolveActiveProjectRoot(ctx)) || '';
    const openFilePaths = vscode.workspace.textDocuments
      .filter(doc => doc.uri.scheme === 'file')
      .map(doc => doc.uri.fsPath);

    let enrichedInput: EnrichedInput | null = null;
    let effectivePrompt = text;

    if (workspaceRoot) {
      try {
        const editorContext = ctx.buildEditorContext();
        enrichedInput = await enrichUserInput(text, {
          workspaceRoot,
          openFiles: openFilePaths,
          editorContext,
          projectMemoryManager: ctx.getProjectMemoryManager() || undefined,
        });
        effectivePrompt = enrichedInput.enrichedPrompt;
        console.log('[Enrichment] Complete:', {
          outOfScope: enrichedInput.outOfScope,
          resolvedCount: enrichedInput.metadata.resolvedCount,
          durationMs: enrichedInput.metadata.enrichmentDurationMs,
        });
      } catch (enrichErr) {
        console.warn('[Enrichment] Failed, using raw input:', enrichErr);
      }
    }

    // 2a. Handle out-of-scope requests
    if (enrichedInput?.outOfScope) {
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'stream_complete',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          response: enrichedInput.outOfScopeResponse || 'I focus on coding tasks. Is there code I can help you with?',
          out_of_scope: true,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.sendEventsToWebview(webview, taskId);
      ctx.currentTaskId = null;
      return;
    }

    // 3. Workspace-aware scaffold detection
    const wsState = await getWorkspaceState(workspaceRoot || undefined);
    const isEmptyWorkspace = wsState && !wsState.hasPackageJson && wsState.fileCount <= 3;
    console.log('[Router] Workspace state:', {
      workspaceRoot,
      scaffoldProjectPath: ctx.scaffoldProjectPath,
      selectedWorkspaceRoot: ctx.selectedWorkspaceRoot,
      folderCount: vscode.workspace.workspaceFolders?.length || 0,
      wsState,
      isEmptyWorkspace,
    });

    // Build routing context — LLM-first architecture
    const routingCtx: RoutingContext = { workspace: wsState };
    const resolvedModel = resolveModel(modelId || 'sonnet-4.5');
    routingCtx.llmClient = new BackendLLMClient(ctx.getBackendClient(), resolvedModel);
    routingCtx.modelId = resolvedModel;

    const routingResult: IntentRoutingResult = await routeIntent(text, routingCtx);

    console.log('[Router] Result:', {
      intent: routingResult.intent,
      source: routingResult.source,
      confidence: routingResult.confidence,
      reasoning: routingResult.reasoning,
    });

    // Emit routing event
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'mode_set',
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: {
        intent: routingResult.intent,
        user_selected_mode: userSelectedMode,
        confidence: routingResult.confidence,
        reasoning: routingResult.reasoning,
        routing_source: routingResult.source,
        workspace_state: wsState,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    await ctx.sendEventsToWebview(webview, taskId);

    // 4. Route to handler

    // SCAFFOLD — route to scaffold flow
    if (routingResult.intent === 'SCAFFOLD') {
      console.log('[Router] Routing to SCAFFOLD flow');
      await handleScaffoldFlow(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview, attachments || []);
      return;
    }

    // Route based on user's selected mode: Agent (default) or Plan
    if (userSelectedMode === 'PLAN') {
      console.log('>>> MODE: PLAN <<<');
      await handlePlanMode(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview);
    } else {
      console.log('>>> MODE: AGENT <<<');
      await handleAgentMode(ctx, effectivePrompt, taskId, modelId || 'sonnet-4.5', webview);
    }

    console.log('[Router] Routing complete');

  } catch (error) {
    console.error('Error handling submitPrompt:', error);
    vscode.window.showErrorMessage(`Ordinex: ${error}`);
  }
}
