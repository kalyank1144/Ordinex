# Command Event Display Fix - Complete

## Issue
Command execution events (`command_proposed`, `command_started`, `command_progress`) were showing as "Unknown event type" in the Mission timeline UI.

## Root Cause
The webview uses an inline JavaScript implementation in `packages/webview/src/index.ts` that generates HTML directly. The `getEventCardConfig` function inside this inline JavaScript did not have entries for the command-related event types.

## Files Changed

### 1. `packages/webview/src/index.ts`
Added command event type configurations to the `getEventCardConfig` function:

```javascript
// Command Execution Events (Step 34.5)
command_proposed: {
  icon: '💻',
  title: 'Command Proposed',
  color: 'var(--vscode-charts-blue)',
  getSummary: (e) => {
    const cmds = e.payload.commands || [];
    if (cmds.length === 0) return 'No commands proposed';
    const first = cmds[0]?.command || cmds[0] || '';
    return cmds.length === 1 ? first : `${cmds.length} commands proposed`;
  }
},
command_started: {
  icon: '▶️',
  title: 'Command Started',
  color: 'var(--vscode-charts-green)',
  getSummary: (e) => {
    const cmd = e.payload.command || '';
    return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd || 'Running command';
  }
},
command_progress: {
  icon: '📄',
  title: 'Command Output',
  color: 'var(--vscode-charts-blue)',
  getSummary: (e) => {
    const output = e.payload.output || e.payload.stdout || e.payload.stderr || '';
    const lines = output.split('\\n').filter(l => l.trim()).length;
    return `${lines} line(s) of output`;
  }
},
command_completed: {
  icon: '✅',
  title: 'Command Completed',
  color: 'var(--vscode-charts-green)',
  getSummary: (e) => {
    const exitCode = e.payload.exit_code;
    const success = exitCode === 0 || e.payload.success;
    return success ? 'Completed successfully' : `Exit code: ${exitCode}`;
  }
},
command_failed: {
  icon: '❌',
  title: 'Command Failed',
  color: 'var(--vscode-charts-red)',
  getSummary: (e) => {
    const error = e.payload.error || e.payload.stderr || '';
    return error.length > 50 ? error.substring(0, 50) + '...' : error || 'Command failed';
  }
}
```

## Event Types Supported
| Event Type | Icon | Title | Description |
|------------|------|-------|-------------|
| `command_proposed` | 💻 | Command Proposed | Shows proposed commands with count |
| `command_started` | ▶️ | Command Started | Shows command being executed |
| `command_progress` | 📄 | Command Output | Shows line count of output |
| `command_completed` | ✅ | Command Completed | Shows exit code or success |
| `command_failed` | ❌ | Command Failed | Shows error message |

## How to Test
1. Reload VS Code extension (Cmd+R in Extension Host)
2. In MISSION mode, run a command like "npm run dev"
3. Verify the timeline shows:
   - "💻 Command Proposed" - blue border
   - "▶️ Command Started" - green border  
   - "📄 Command Output" - blue border (if streaming output)
   - "✅ Command Completed" or "❌ Command Failed" at end

## Note on Architecture
The webview uses inline JavaScript in `packages/webview/src/index.ts` for the UI. While there are separate TypeScript component files in `packages/webview/src/components/`, they are NOT used by the actual rendered webview - they appear to be for future componentization or unused code.

All UI rendering happens via the inline `getEventCardConfig` function and `renderEventCard` function in the inline script block of `getWebviewContent()`.
