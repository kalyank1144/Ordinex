# MISSION Execution UI Fix - step_failed Event Support

## Problem
After implementing the reliability fixes, the webview didn't recognize the new `step_failed` event type, causing:
1. **"Unknown event type" error** in UI
2. **TypeScript compilation errors** in webview

## Root Cause
The `step_failed` event type was added to `packages/core/src/types.ts` but not to:
- `packages/webview/src/types.ts` (webview's copy of event types)
- `packages/webview/src/components/MissionFeed.ts` (event rendering config)

## Solution

### **File 1: packages/webview/src/types.ts**
Added `step_failed` to EventType union:

```typescript
export type EventType =
  // Core Lifecycle
  | 'intent_received'
  | 'mode_set'
  | 'plan_created'
  | 'plan_revised'
  | 'mission_breakdown_created'
  | 'mission_selected'
  | 'mission_started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'  // ← ADDED
  | 'stage_changed'
  | 'final'
  // ... rest of types
```

### **File 2: packages/webview/src/components/MissionFeed.ts**
Added rendering configuration for `step_failed`:

```typescript
step_failed: {
  icon: '❌',
  title: 'Step Failed',
  color: 'var(--vscode-charts-red)',
  getSummary: (e) => {
    const stepIndex = e.payload.step_index as number;
    const reason = e.payload.reason as string || 'unknown';
    const error = e.payload.error as string || '';
    return `Step ${stepIndex + 1} failed: ${reason}${error ? ' - ' + error.substring(0, 50) : ''}`;
  }
},
```

## Files Modified
- `packages/webview/src/types.ts` (1 line added)
- `packages/webview/src/components/MissionFeed.ts` (13 lines added)

## Build Status
```bash
$ pnpm run build
✅ packages/core build: Done in 1s
✅ packages/webview build: Done in 605ms  
✅ packages/extension build: Done in 477ms
```

## UI Display
The `step_failed` event now renders as:
- **Icon:** ❌ (red X)
- **Title:** "Step Failed"
- **Summary:** "Step N failed: {reason} - {error preview}"
- **Color:** Red (var(--vscode-charts-red))

## Testing
1. **Reload VS Code extension** 
2. **Run a MISSION** that triggers an edit step
3. **Verify timeline** now shows clear "Step Failed" cards instead of "Unknown event type"
4. **Check error details** are displayed correctly in the summary

## Related Files
This fix complements the main reliability fixes in:
- `MISSION_EXEC_RELIABILITY_FIX.md` - Core backend fixes (Phases 1-5)
- This document - UI support for new event types
