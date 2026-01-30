# Command Task Cleanup Fix

## Problem

After running a command (e.g., "npm run dev"):
1. Events flow correctly: `command_started` → `command_progress` → `command_completed`
2. But follow-up prompts incorrectly show "Active Run Detected" because:
   - `detectActiveRun()` didn't treat `command_completed` as a terminal event
   - Old `decision_point_needed` events were still considered "unhandled"
   - `currentTaskId` wasn't cleared after command completion

## Root Cause

The `detectActiveRun()` function in `intentAnalyzer.ts` only checked for these terminal events:
- `final`
- `mission_completed`
- `mission_cancelled`

Command-only tasks never emit these events - they emit `command_completed` instead.

## Fixes Applied

### 1. Updated `detectActiveRun()` in `intentAnalyzer.ts`

Added `command_completed` and `command_skipped` to the terminal events list:

```typescript
const terminalEvents = events.filter(e =>
  ['final', 'mission_completed', 'mission_cancelled', 'command_completed', 'command_skipped'].includes(e.type)
);
```

### 2. Clear `currentTaskId` in `extension.ts`

After command runs or skips, we now clear the task state:

**For `run_commands` action:**
```typescript
// CRITICAL FIX: Clear currentTaskId so next prompt starts a fresh task
console.log(`[handleResolveDecisionPoint] ✓ Command task completed, clearing currentTaskId`);
this.currentTaskId = null;
this.currentStage = 'none';
```

**For `skip_once` action:**
```typescript
// CRITICAL FIX: Clear currentTaskId so next prompt starts a fresh task
console.log(`[handleResolveDecisionPoint] ✓ Command skipped, clearing currentTaskId`);
this.currentTaskId = null;
this.currentStage = 'none';
```

## Testing

After this fix:
1. Type "run the app" or "npm run dev"
2. Approval card appears with "Run command(s)" button
3. Click "Run command(s)"
4. Command runs in VS Code terminal
5. Type a follow-up prompt (e.g., "now add a button")
6. ✓ NEW task starts fresh (no "Active Run Detected" message)

## Files Changed

1. `packages/core/src/intentAnalyzer.ts` - Added `command_completed` and `command_skipped` to terminal events
2. `packages/extension/src/extension.ts` - Clear `currentTaskId` after command completes or skips

## Summary

Command-only tasks are now properly cleaned up after completion, allowing follow-up prompts to start fresh tasks without the system incorrectly detecting an "active run".
