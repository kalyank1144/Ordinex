/**
 * Tools / Process / Recovery Handler — extracted from MissionControlViewProvider.
 *
 * Covers:
 *  - handleGeneratedToolRun   (V7: generated tool execution with approval, static scan, run)
 *  - handleProcessAction      (process card actions: terminate, open_browser)
 *  - handleRecoveryAction     (Step 49: execute recovery command from FailureCard)
 *  - handleOpenFile           (open file from FailureCard with workspace root guard)
 *  - handleUploadAttachment   (store attachment evidence)
 *
 * All functions take `ctx: IProvider` as first parameter instead of using `this`.
 */

import type { IProvider } from '../handlerContext';
import * as vscode from 'vscode';
import * as path from 'path';
import { getProcessManager, isSafeRecoveryCommand } from 'core';
import { runGeneratedTool, scanForBlockedPatterns } from '../generatedToolRunner';
import {
  storeAttachment,
  validateAttachment,
} from '../attachmentEvidenceStore';
import type { AttachmentData, AttachmentStoreResult } from '../attachmentEvidenceStore';

// ---------------------------------------------------------------------------
// handleGeneratedToolRun
// ---------------------------------------------------------------------------

/**
 * V7: Generated tool execution with approval, static scan, and run.
 * Enforces MISSION mode, checks policy, scans code, then runs the tool.
 */
export async function handleGeneratedToolRun(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { tool_name, input_json } = message;
  const taskId = ctx.currentTaskId || 'tool_run';

  // V9: Enforce MISSION mode for generated tool execution
  if (!await ctx.enforceMissionMode('generated_tool_run', taskId)) {
    await ctx.sendEventsToWebview(webview, taskId);
    return;
  }

  const gtm = ctx.getGeneratedToolManager();
  if (!gtm) {
    console.error('[V7] GeneratedToolManager not available');
    return;
  }

  const policy = ctx.getGeneratedToolPolicy();
  if (policy === 'disabled') {
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'generated_tool_run_failed',
      mode: ctx.currentMode,
      stage: 'edit',
      payload: {
        tool_name,
        failure_type: 'policy',
        reason: 'Generated tool execution is disabled',
        policy_used: 'disabled',
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    await ctx.sendEventsToWebview(webview, taskId);
    return;
  }

  // Load tool code and check static scan
  const code = await gtm.getToolCode(tool_name);
  if (!code) {
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'generated_tool_run_failed',
      mode: ctx.currentMode,
      stage: 'edit',
      payload: {
        tool_name,
        failure_type: 'error',
        reason: `Tool "${tool_name}" not found in registry`,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    await ctx.sendEventsToWebview(webview, taskId);
    return;
  }

  const blockReason = scanForBlockedPatterns(code);
  if (blockReason) {
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'generated_tool_run_failed',
      mode: ctx.currentMode,
      stage: 'edit',
      payload: {
        tool_name,
        failure_type: 'blocked',
        reason: `Static scan blocked: ${blockReason}`,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    await ctx.sendEventsToWebview(webview, taskId);
    return;
  }

  // Emit run_started
  await ctx.emitEvent({
    event_id: ctx.generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'generated_tool_run_started',
    mode: ctx.currentMode,
    stage: 'edit',
    payload: {
      tool_name,
      args_summary: (input_json || '').substring(0, 100),
      policy_used: policy,
      approved_by_user: policy === 'prompt',
    },
    evidence_ids: [],
    parent_event_id: null,
  });
  await ctx.sendEventsToWebview(webview, taskId);

  // Run the tool
  const workspaceRoot = ctx.getWorkspaceRoot() || '.';
  const toolsRoot = path.join(workspaceRoot, '.ordinex', 'tools', 'generated');
  const codePath = path.join(toolsRoot, `${tool_name}.js`);

  const result = await runGeneratedTool({
    tool_name,
    code_path: codePath,
    cwd: workspaceRoot,
    input_json: input_json || '{}',
  });

  if (result.success) {
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'generated_tool_run_completed',
      mode: ctx.currentMode,
      stage: 'edit',
      payload: {
        tool_name,
        exit_code: result.result.exit_code,
        duration_ms: result.result.duration_ms,
        stdout_preview: result.result.stdout.substring(0, 500),
        stderr_preview: result.result.stderr.substring(0, 500),
      },
      evidence_ids: [],
      parent_event_id: null,
    });
  } else {
    await ctx.emitEvent({
      event_id: ctx.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'generated_tool_run_failed',
      mode: ctx.currentMode,
      stage: 'edit',
      payload: {
        tool_name,
        failure_type: result.failure_type,
        reason: result.reason,
      },
      evidence_ids: [],
      parent_event_id: null,
    });
  }

  await ctx.sendEventsToWebview(webview, taskId);
}

// ---------------------------------------------------------------------------
// handleProcessAction
// ---------------------------------------------------------------------------

/**
 * Handle process card actions: terminate a running process or open browser.
 */
export async function handleProcessAction(
  ctx: IProvider,
  message: any,
): Promise<void> {
  const { action, process_id, port } = message;
  const pm = getProcessManager();

  switch (action) {
    case 'terminate': {
      console.log(`[Ordinex:Process] Terminating process: ${process_id}`);
      try {
        await pm.stopProcess(process_id, 'user_terminated');
      } catch (err: any) {
        console.error(`[Ordinex:Process] Failed to terminate: ${err.message}`);
        vscode.window.showWarningMessage(`Failed to terminate process: ${err.message}`);
      }
      break;
    }

    case 'open_browser': {
      if (port) {
        const url = `http://localhost:${port}`;
        console.log(`[Ordinex:Process] Opening browser: ${url}`);
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
      break;
    }

    default:
      console.log(`[Ordinex:Process] Unknown action: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// handleRecoveryAction
// ---------------------------------------------------------------------------

/**
 * Handle recovery actions dispatched from FailureCard.
 * Routes by action type: retry, alternative, checkpoint, command, manual.
 * V9: Mode-gated for actions that write to disk (retry, command).
 * Concern #4: Command actions must pass isSafeRecoveryCommand() allowlist.
 */
export async function handleRecoveryAction(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { action_id, event_id, command } = message;
  const taskId = ctx.currentTaskId || 'unknown';
  console.log(`[Step49] Recovery action: ${action_id} for event ${event_id}`);

  switch (action_id) {
    case 'retry':
    case 'retry_split': {
      // V9: Retry writes to disk — requires MISSION mode
      if (!await ctx.enforceMissionMode('recovery_retry', taskId)) {
        await ctx.sendEventsToWebview(webview, taskId);
        return;
      }
      // Emit decision so the autonomy controller / self-correction loop can pick it up
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'recovery_action_taken',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          source_event_id: event_id,
          action: action_id === 'retry_split' ? 'RETRY_SPLIT' : 'RETRY_SAME',
          user_initiated: true,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.sendEventsToWebview(webview, taskId);
      break;
    }

    case 'alternative': {
      if (!await ctx.enforceMissionMode('recovery_alternative', taskId)) {
        await ctx.sendEventsToWebview(webview, taskId);
        return;
      }
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'recovery_action_taken',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          source_event_id: event_id,
          action: 'REGENERATE_PATCH',
          user_initiated: true,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.sendEventsToWebview(webview, taskId);
      break;
    }

    case 'restore_checkpoint': {
      // Checkpoint restore is handled via existing checkpoint flow
      await ctx.emitEvent({
        event_id: ctx.generateId(),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        type: 'recovery_action_taken',
        mode: ctx.currentMode,
        stage: ctx.currentStage,
        payload: {
          source_event_id: event_id,
          action: 'RESTORE_CHECKPOINT',
          user_initiated: true,
        },
        evidence_ids: [],
        parent_event_id: null,
      });
      await ctx.sendEventsToWebview(webview, taskId);
      break;
    }

    case 'run_command': {
      // Concern #4: Command must pass allowlist
      if (!command || !isSafeRecoveryCommand(command)) {
        vscode.window.showWarningMessage(`Ordinex: Command not in recovery allowlist: "${command || '(empty)'}"`);
        return;
      }
      // V9: Running a command requires MISSION mode
      if (!await ctx.enforceMissionMode('recovery_command', taskId)) {
        await ctx.sendEventsToWebview(webview, taskId);
        return;
      }
      // Execute the safe command via terminal
      const terminal = vscode.window.createTerminal({
        name: `Ordinex: ${command}`,
        cwd: ctx.selectedWorkspaceRoot || undefined,
      });
      terminal.show(false);
      terminal.sendText(command);
      break;
    }

    case 'fix_manually': {
      // No-op action — user handles it. Just acknowledge.
      vscode.window.showInformationMessage('Ordinex: Please fix the issue manually and retry.');
      break;
    }

    default:
      console.log(`[Step49] Unknown recovery action: ${action_id}`);
  }
}

// ---------------------------------------------------------------------------
// handleOpenFile
// ---------------------------------------------------------------------------

/**
 * Handle open_file requests from FailureCard.
 * Guard: file must be inside workspace root (Concern: path traversal).
 */
export async function handleOpenFile(
  ctx: IProvider,
  message: any,
): Promise<void> {
  const { file_path } = message;
  if (!file_path) return;

  // Guard: resolve against workspace root and check containment
  const workspaceRoot = ctx.selectedWorkspaceRoot
    || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('Ordinex: No workspace open');
    return;
  }

  const resolved = path.resolve(workspaceRoot, file_path);
  if (!resolved.startsWith(workspaceRoot)) {
    vscode.window.showWarningMessage('Ordinex: Cannot open files outside workspace');
    return;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (err: any) {
    console.error(`[Step49] Failed to open file: ${err.message}`);
    vscode.window.showWarningMessage(`Ordinex: Could not open file: ${file_path}`);
  }
}

// ---------------------------------------------------------------------------
// handleUploadAttachment
// ---------------------------------------------------------------------------

/**
 * Step 37: Handle attachment upload from webview.
 *
 * Receives base64-encoded attachment data from webview,
 * validates, stores to evidence directory, and returns evidence_id.
 */
export async function handleUploadAttachment(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  const { id, name, mimeType, data } = message;
  const LOG_PREFIX = '[Ordinex:AttachmentUpload]';

  console.log(`${LOG_PREFIX} Upload request received: ${name} (${mimeType})`);

  // Validate required fields
  if (!id || !name || !mimeType || !data) {
    console.error(`${LOG_PREFIX} Missing required fields in uploadAttachment`);
    webview.postMessage({
      type: 'ordinex:uploadResult',
      id,
      success: false,
      error: 'Missing required fields: id, name, mimeType, or data',
    });
    return;
  }

  try {
    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }

    // Build attachment data object
    const attachmentData: AttachmentData = {
      id,
      name,
      mimeType,
      data,
    };

    // Validate attachment (size, MIME type)
    const validation = validateAttachment(attachmentData);
    if (!validation.valid) {
      console.error(`${LOG_PREFIX} Validation failed: ${validation.error}`);
      webview.postMessage({
        type: 'ordinex:uploadResult',
        id,
        success: false,
        error: validation.error,
      });
      return;
    }

    // Store attachment to evidence directory
    const result: AttachmentStoreResult = await storeAttachment(workspaceRoot, attachmentData);

    if (result.success) {
      console.log(`${LOG_PREFIX} Upload successful: ${result.evidenceId} (deduplicated: ${result.deduplicated})`);

      webview.postMessage({
        type: 'ordinex:uploadResult',
        id,
        success: true,
        evidenceId: result.evidenceId,
        evidencePath: result.evidencePath,
        deduplicated: result.deduplicated,
      });
    } else {
      console.error(`${LOG_PREFIX} Storage failed: ${result.error}`);
      webview.postMessage({
        type: 'ordinex:uploadResult',
        id,
        success: false,
        error: result.error,
      });
    }

  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error);
    webview.postMessage({
      type: 'ordinex:uploadResult',
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
