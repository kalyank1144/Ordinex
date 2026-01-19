import * as vscode from 'vscode';
import { getWebviewContent } from 'webview';

class MissionControlViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ordinex.missionControl';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Set up message passing scaffolding
    webviewView.webview.onDidReceiveMessage(
      message => {
        // Placeholder for future message handling
        console.log('Message from webview:', message);
      }
    );
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Use the Mission Control UI from the webview package
    return getWebviewContent();
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Ordinex extension activated');

  // Register the WebviewViewProvider for the Activity Bar view
  const provider = new MissionControlViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MissionControlViewProvider.viewType,
      provider
    )
  );

  // Keep the existing command for backward compatibility
  const disposable = vscode.commands.registerCommand('ordinex.openPanel', () => {
    const panel = vscode.window.createWebviewPanel(
      'ordinexPanel',
      'Ordinex',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = getWebviewContent();
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  console.log('Ordinex extension deactivated');
}
