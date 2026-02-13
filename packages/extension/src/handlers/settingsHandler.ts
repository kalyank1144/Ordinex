/**
 * Settings Handler — extracted from MissionControlViewProvider (Step 45).
 *
 * All functions take `ctx: IProvider` as first parameter instead of using `this`.
 */

import type { IProvider } from '../handlerContext';
import * as vscode from 'vscode';
import * as path from 'path';
import { getSettingsPanelContent } from 'webview';

// ---------------------------------------------------------------------------
// openSettingsPanel
// ---------------------------------------------------------------------------

export async function openSettingsPanel(ctx: IProvider): Promise<void> {
  // If panel already exists, reveal it
  if (ctx.settingsPanel) {
    ctx.settingsPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  ctx.settingsPanel = vscode.window.createWebviewPanel(
    'ordinexSettings',
    'Ordinex Settings',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  ctx.settingsPanel.webview.html = getSettingsPanelContent();

  // Handle messages from settings panel
  ctx.settingsPanel.webview.onDidReceiveMessage(
    async (message) => {
      await handleSettingsMessage(ctx, message, ctx.settingsPanel!.webview);
    }
  );

  // Clean up on dispose
  ctx.settingsPanel.onDidDispose(() => {
    ctx.settingsPanel = null;
  });
}

// ---------------------------------------------------------------------------
// handleSettingsMessage
// ---------------------------------------------------------------------------

export async function handleSettingsMessage(
  ctx: IProvider,
  message: any,
  webview: vscode.Webview,
): Promise<void> {
  switch (message.type) {
    case 'ordinex:settings:getAll':
      await sendCurrentSettings(ctx, webview);
      break;

    case 'ordinex:settings:saveApiKey': {
      try {
        const key = message.apiKey?.trim();
        if (!key || !key.startsWith('sk-ant-')) {
          webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'API Key', success: false, error: 'Invalid key format' });
          return;
        }
        await ctx._context.secrets.store('ordinex.apiKey', key);
        emitSettingsChangedEvent(ctx, 'apiKey', 'updated');
        webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'API Key', success: true });
      } catch (err: any) {
        webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'API Key', success: false, error: err.message });
      }
      break;
    }

    case 'ordinex:settings:clearApiKey': {
      try {
        await ctx._context.secrets.delete('ordinex.apiKey');
        emitSettingsChangedEvent(ctx, 'apiKey', 'cleared');
        await sendCurrentSettings(ctx, webview);
      } catch (err: any) {
        webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'API Key', success: false, error: err.message });
      }
      break;
    }

    case 'ordinex:settings:setCommandPolicy': {
      const mode = message.mode;
      if (['off', 'prompt', 'auto'].includes(mode)) {
        await vscode.workspace.getConfiguration('ordinex.commandPolicy').update('mode', mode, vscode.ConfigurationTarget.Global);
        emitSettingsChangedEvent(ctx, 'commandPolicy', mode);
        webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'Command Policy', success: true });
      }
      break;
    }

    case 'ordinex:settings:setAutonomyLevel': {
      const level = message.level;
      if (['conservative', 'balanced', 'aggressive'].includes(level)) {
        await vscode.workspace.getConfiguration('ordinex.autonomy').update('level', level, vscode.ConfigurationTarget.Global);
        emitSettingsChangedEvent(ctx, 'autonomyLevel', level);
        webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'Autonomy Level', success: true });
      }
      break;
    }

    case 'ordinex:settings:setSessionPersistence': {
      const enabled = message.enabled ? 'on' : 'off';
      await vscode.workspace.getConfiguration('ordinex.intelligence').update('sessionPersistence', enabled, vscode.ConfigurationTarget.Global);
      emitSettingsChangedEvent(ctx, 'sessionPersistence', enabled);
      webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'Session Persistence', success: true });
      break;
    }

    case 'ordinex:settings:setGeneratedToolPolicy': {
      const toolPolicy = message.policy;
      if (['disabled', 'prompt', 'auto'].includes(toolPolicy)) {
        await vscode.workspace.getConfiguration('ordinex.generatedTools').update('policy', toolPolicy, vscode.ConfigurationTarget.Global);
        emitSettingsChangedEvent(ctx, 'generatedToolPolicy', toolPolicy);
        webview.postMessage({ type: 'ordinex:settings:saveResult', setting: 'Generated Tool Policy', success: true });
      }
      break;
    }

    default:
      console.log('[Settings] Unknown message type:', message.type);
  }
}

// ---------------------------------------------------------------------------
// sendCurrentSettings
// ---------------------------------------------------------------------------

export async function sendCurrentSettings(
  ctx: IProvider,
  webview: vscode.Webview,
): Promise<void> {
  // API key status (never send full key)
  let apiKeyConfigured = false;
  let apiKeyPreview = '';
  try {
    const storedKey = await ctx._context.secrets.get('ordinex.apiKey');
    if (storedKey) {
      apiKeyConfigured = true;
      apiKeyPreview = 'sk-ant-...' + storedKey.slice(-4);
    }
  } catch { /* ignore */ }

  // Policies from configuration
  const config = vscode.workspace.getConfiguration('ordinex');
  const commandPolicy = config.get<string>('commandPolicy.mode', 'prompt');
  const autonomyLevel = config.get<string>('autonomy.level', 'conservative');
  const sessionPersistence = config.get<string>('intelligence.sessionPersistence', 'off') === 'on';
  const generatedToolPolicy = config.get<string>('generatedTools.policy', 'prompt');

  // Account info
  const extensionVersion = ctx._context.extension?.packageJSON?.version || '0.0.0';
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '\u2014';
  const eventStorePath = ctx.eventStore
    ? path.join(ctx._context.globalStorageUri.fsPath, 'events.jsonl')
    : '\u2014';

  let eventsCount = 0;
  if (ctx.eventStore) {
    try {
      const events = ctx.eventStore.getAllEvents();
      eventsCount = events.length;
    } catch { /* ignore */ }
  }

  webview.postMessage({
    type: 'ordinex:settings:update',
    apiKeyConfigured,
    apiKeyPreview,
    commandPolicy,
    autonomyLevel,
    sessionPersistence,
    generatedToolPolicy,
    extensionVersion,
    workspacePath,
    eventStorePath,
    eventsCount,
  });
}

// ---------------------------------------------------------------------------
// emitSettingsChangedEvent
// ---------------------------------------------------------------------------

export function emitSettingsChangedEvent(
  ctx: IProvider,
  setting: string,
  value: string,
): void {
  if (!ctx.eventStore) return;
  try {
    ctx.eventStore.append({
      event_id: ctx.generateId(),
      type: 'settings_changed',
      task_id: ctx.currentTaskId || 'settings',
      timestamp: new Date().toISOString(),
      mode: ctx.currentMode,
      stage: ctx.currentStage,
      payload: { setting, value },
      evidence_ids: [],
      parent_event_id: null,
    });
  } catch (err) {
    console.error('[Settings] Failed to emit settings_changed event:', err);
  }
}
