# Webview Cache Issue - How to Fix

## Problem
The Execute Plan button is still showing at the top because VS Code is using **cached webview HTML**.

Your console log confirms this:
- ✅ Backend events are working (approval_requested, execution_paused with "awaiting_execute_plan")
- ❌ The debug log `[EXECUTE PLAN DEBUG]` is **NOT** appearing
- ❌ This means the webview HTML hasn't been updated

## Solution Steps

### 1. **Stop the Extension** (if running in debug mode)
Press the red stop button in VS Code's debug toolbar

### 2. **Reload VS Code Window**
- Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
- Type: `Developer: Reload Window`
- Press Enter

### 3. **Restart the Extension** (if in development)
Press `F5` to start debugging again

### 4. **Test the Flow**
1. Open Ordinex Mission Control
2. Enter a PLAN mode prompt
3. Click "Approve Plan → Start Mission"
4. **You should now see:**
   - NO Execute Plan button at the top
   - Execute Plan button appears INLINE after "Execution Paused: awaiting_execute_plan"
5. **Check console for:** `[EXECUTE PLAN DEBUG] renderMissionTimeline - NOT calling renderExecutePlanCTA`

## Why This Happens
VS Code aggressively caches webview content for performance. When you modify webview HTML/JavaScript, you MUST reload the window to clear the cache.

## Alternative: Force Cache Clear
If reloading doesn't work:
1. Close VS Code completely
2. Reopen VS Code
3. Start the extension again

## Verify the Fix
After reloading, the console should show:
```
[EXECUTE PLAN DEBUG] renderMissionTimeline - NOT calling renderExecutePlanCTA
```

And you should see the Execute Plan button ONLY inline, not at the top.
