# Step 5 Execution Failure Fix

## Problem
Step 5 (edit step) is failing with generic "Error occurred" message instead of showing the actual error details.

## Root Cause Analysis
The error is occurring in the edit step execution, but the detailed error message is not being properly propagated from the TruncationSafeExecutor through MissionExecutor to the UI.

## Most Likely Causes
1. **API Key Issue**: API key not set or invalid (most common)
2. **File Not Found**: src/App.tsx doesn't exist in the workspace
3. **LLM API Error**: Network issue, rate limiting, or API error
4. **Context Selection Error**: Unable to read file contents

## Immediate Diagnosis Steps

### Check VS Code Developer Console
1. In VS Code, open Developer Tools: **Help > Toggle Developer Tools**
2. Look for console errors starting with `[MissionExecutor]` or `[TruncationSafeExecutor]`
3. The actual error message will be logged there

### Check API Key
Run command: **Ordinex: Set API Key** (Cmd+Shift+P)
- Ensure you have a valid Anthropic API key (starts with `sk-ant-`)

### Check File Existence
Verify that `src/App.tsx` exists in your workspace

## Fix Applied

### 1. Enhanced Error Display in failure_detected Events
Updated `missionExecutor.ts` to include full error details in the payload:

```typescript
await this.emitEvent({
  event_id: randomUUID(),
  task_id: this.taskId,
  timestamp: new Date().toISOString(),
  type: 'failure_detected',
  mode: this.mode,
  stage,
  payload: {
    reason: 'step_execution_failed',
    step_id: stepId,
    error: stageResult.error || 'Step execution failed',
    error_details: stageResult.pauseReason || stageResult.error,  // NEW: Add detailed error
    stage,
  },
  evidence_ids: [],
  parent_event_id: null,
});
```

### 2. Better Error Logging
Added console.error with full error details:

```typescript
console.error('[MissionExecutor] Step failed:', {
  stepId,
  stage,
  error: stageResult.error,
  pauseReason: stageResult.pauseReason,
  shouldPause: stageResult.shouldPause
});
```

### 3. Improved pauseReason in TruncationSafeExecutor
Updated to always include the actual error message:

```typescript
const pauseReasonWithError = result.truncationDetected 
  ? `Output truncated and unable to split: ${actualErrorMessage}`
  : `LLM edit failed: ${actualErrorMessage}`;

return {
  success: false,
  wasSplit: false,
  truncationDetected: result.truncationDetected,
  pausedForDecision: true,
  pauseReason: pauseReasonWithError,  // Now includes full error details
  error: result.error || {
    type: 'llm_error',
    message: actualErrorMessage,
  },
  duration_ms: Date.now() - startTime,
};
```

## Testing Steps

1. **Rebuild the extension**:
   ```bash
   cd /Users/kalyankumarchindam/Documents/Ordinex
   pnpm install
   pnpm build
   ```

2. **Reload VS Code**:
   - Press F5 in VS Code to launch Extension Development Host
   - Or press Cmd+R in the Extension Development Host window

3. **Check API Key**:
   - Run command: "Ordinex: Set API Key"
   - Enter your Anthropic API key

4. **Retry the Mission**:
   - The error message should now show the actual cause
   - If it's an API key issue, you'll see "No API key configured" or "Authentication failed"
   - If it's a file issue, you'll see "File not found: src/App.tsx"
   - If it's an LLM error, you'll see the actual API error message

## Expected Error Messages After Fix

- **No API Key**: "No API key configured - Run command 'Ordinex: Set API Key'"
- **Invalid API Key**: "Authentication failed: invalid API key"
- **File Not Found**: "Failed to read file: src/App.tsx - ENOENT: no such file or directory"
- **API Error**: "LLM API error: [actual error from Anthropic]"
- **Network Error**: "LLM API call failed: fetch failed"

## Files Changed
- `packages/core/src/missionExecutor.ts` - Enhanced error propagation
- `packages/core/src/truncationSafeExecutor.ts` - Better error messages

## Next Steps
1. Check the Developer Console for the actual error
2. Rebuild and reload the extension
3. The UI should now show the specific error message instead of generic "Error occurred"
