# Command Terminal Execution Fix

## Problem
When running commands like "npm run dev" via the Ordinex UI:
1. User types "run the app" in MISSION mode
2. Command detection works correctly - shows approval card
3. User clicks "Run command(s)" button
4. Events show `command_started`, `command_progress` with "0 lines of output"
5. **No actual command runs in VS Code terminal** - invisible execution

## Root Cause
The `commandPhase.ts` in the core package uses Node's `spawn()` API which runs commands as **background processes**:
- Output is captured in memory buffers
- User cannot see the terminal
- User cannot interact with the process (e.g., ctrl+c)
- No visible feedback

This is suitable for headless/test scenarios but NOT for user-initiated commands in VS Code.

## Solution
Modified `handleResolveDecisionPoint` in `extension.ts` to use VS Code's terminal API:

### Before (Invisible)
```typescript
const result = await runCommandPhase(commandContext); // Uses spawn() internally
```

### After (Visible Terminal)
```typescript
// Create and show VS Code terminal
const terminal = vscode.window.createTerminal({
  name: `Ordinex: ${command.split(' ')[0]}`,
  cwd: workspaceRoot,
});

this.activeTerminals.set(task_id, terminal);

// Show terminal and send command
terminal.show(true); // true = preserve focus
terminal.sendText(command);
```

## Changes Made

### `packages/extension/src/extension.ts`

1. **Added terminal tracking map**:
   ```typescript
   private activeTerminals: Map<string, vscode.Terminal> = new Map();
   ```

2. **Updated `handleResolveDecisionPoint` for command_execution context**:
   - `run_commands` action now:
     - Creates a VS Code terminal with workspace root as cwd
     - Names the terminal "Ordinex: [command_name]"
     - Shows the terminal (preserves focus on webview)
     - Sends the command via `terminal.sendText()`
     - Emits proper events for UI tracking
     - Shows info message to user
   
   - `skip_once` action now:
     - Emits `command_skipped` event with reason
     - Cleans up pending context
   
   - `disable_commands` action now:
     - Emits `command_skipped` event with permanent flag
     - Shows info message about disabled commands

## User Experience After Fix

1. User types "run the app" or "npm run dev"
2. Approval card appears: "Run command(s)? npm run dev"
3. User clicks "Run command(s)"
4. **VS Code terminal panel opens**
5. **Terminal shows "Ordinex: npm"**
6. **Command runs visibly with full output**
7. User can interact (Ctrl+C to stop, scroll, etc.)
8. Info message: "Command started in terminal. Check the 'npm' terminal for output."

## Events Emitted

When "Run command(s)" is clicked:
- `command_started` - with `method: 'vscode_terminal'`
- `command_progress` - with `status: 'running_in_terminal'`
- `command_completed` - with success status and message

## Testing

1. Reset task state (refresh extension)
2. Type "npm run dev" in MISSION mode
3. Verify approval card shows
4. Click "Run command(s)"
5. **Verify VS Code terminal opens and command runs**
6. Verify events show in Mission Feed

## Files Changed

- `packages/extension/src/extension.ts` - Terminal-based command execution
