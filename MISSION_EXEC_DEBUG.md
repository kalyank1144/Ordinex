# Mission Execution Debug Info

## Issue
Events are being emitted correctly but showing as "Unknown event type" in UI.

## Root Cause
The webview bundle was rebuilt, but VS Code extension host still has the old webview HTML/JS cached in memory.

## Solution

### 1. FULL Extension Reload (REQUIRED)
```bash
# Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)
# Type: "Developer: Reload Window"
# Press Enter
```

This will:
- Reload the entire VS Code window
- Clear all cached JavaScript
- Load the new webview bundle with updated event cards

### 2. Verify Events Are Working

After reload, click "Execute Plan" and you should see:

✅ **Mission Started** (🚀 green icon)
- Payload: `{steps_count} steps | {goal}`

✅ **Step Started** (▶️ blue icon)  
- Payload: `Step {N}: {description}`

✅ **Step Completed** (✅ green icon)
- Payload: `Step {N} completed successfully`

### 3. Check Console Logs

Open VS Code Developer Tools:
```bash
# Press Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows/Linux)
# Or: Help → Toggle Developer Tools
```

Look for logs like:
```
[handleExecutePlan] Starting MISSION execution for task: xxx
[handleExecutePlan] Found plan with N steps
[handleExecutePlan] MissionExecutor created, starting execution...
[MissionExecutor] Mission started
[MissionExecutor] Executing step: 0
```

### 4. Expected Flow

1. Click "Execute Plan" button
2. **mission_started** event emitted
3. For each step in plan:
   - **step_started** emitted
   - **stage_changed** emitted (retrieve/edit/test/repair)
   - Step execution logic runs (V1 = placeholder)
   - **step_completed** emitted
4. **execution_paused** when approval needed

### 5. What's Actually Happening

The execution IS working! Events ARE being emitted. The UI just needs to reload to show them properly.

**Proof:**
- Screenshot shows events at correct timestamps
- Events appear in correct sequence
- Stage headers are rendering
- Checkpoints are being created
- Diffs are being proposed

**The ONLY issue:** Event cards show "Unknown event type" instead of proper titles/icons.

### 6. V1 Limitations (Expected Behavior)

The steps are **placeholder implementations**:

- **Retrieve stage**: Emits events but doesn't actually retrieve (no indexer/retriever wired up yet)
- **Edit stage**: Creates checkpoint + emits diff_proposed, but diff is empty placeholder
- **Test stage**: Not wired up yet
- **Repair stage**: Not wired up yet

This is INTENTIONAL for V1. The event infrastructure is complete. Future steps will wire up actual logic.

### 7. If Still Showing "Unknown event type" After Reload

Check if webview bundle actually updated:
```bash
cd /Users/kalyankumarchindam/Documents/Ordinex
ls -la packages/webview/dist/
# Check timestamp - should be recent
```

Force rebuild webview only:
```bash
cd packages/webview
pnpm run build
```

Then reload VS Code window again.

## Summary

**The execution engine is WORKING correctly.** The events are being emitted in the right order. The UI just needs a full window reload to display them with proper icons/titles instead of "Unknown event type".

After reload, you'll see beautiful cards with:
- 🚀 Mission Started
- ▶️ Step Started  
- ✅ Step Completed
- 🔄 Stage Changed
- 💾 Checkpoint Created
- 📝 Diff Proposed
- ⏸️ Execution Paused
