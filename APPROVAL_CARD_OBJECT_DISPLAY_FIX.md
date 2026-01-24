# Mission Execution Approval Bugs - FIXED

## Issues Found and Fixed

### Issue 1: [object Object] Display in Files
When mission execution displayed an approval card, file names were showing as "[object Object]" instead of actual file paths like "package.json".

**Root Cause:** `files_changed` is an array of objects `[{path: 'file.ts'}]`, not strings. The code was calling `.join()` directly on objects.

**Fix:** Added `.map()` to extract `.path` property before joining:
```javascript
const fileList = details.files_changed.map(f => {
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object' && f.path) return f.path;
  return '[unknown]';
}).join(', ');
```

### Issue 2: "Approval Resolved: ✗ Denied" When User Clicked "Approve"
When user clicked the "Approve" button, the timeline showed "✗ Denied" instead of "✓ Approved".

**Root Cause:** The `approvalManager.resolveApproval()` function was emitting an event with only `decision: 'approved'` string but **NOT** the `approved: boolean` field that the webview UI expects.

The webview checks `e.payload.approved` (a boolean) but the payload only had `decision: 'approved'` (a string).

**Fix:** Added `approved: decision === 'approved'` to the event payload in `packages/core/src/approvalManager.ts`:
```javascript
payload: {
  approval_id: approvalId,
  decision,
  approved: decision === 'approved', // Add boolean for UI compatibility
  scope,
  modified_details: modifiedDetails,
},
```

### Issue 3: "diff_applied: Unknown event type"
The webview timeline was showing "Unknown event type" for `diff_applied` events.

**Root Cause:** The `getEventCardConfig()` function in `index.ts` was missing the `diff_applied` event type configuration.

**Fix:** Added `diff_applied` to the event card config:
```javascript
diff_applied: {
  icon: '✅',
  title: 'Diff Applied',
  color: 'var(--vscode-charts-green)',
  getSummary: (e) => {
    const files = e.payload.files_changed || [];
    const success = e.payload.success !== false;
    return `${success ? '✓' : '✗'} ${files.length} file(s) modified`;
  }
},
```

## Files Changed
1. `packages/webview/src/index.ts`
   - Fixed `renderApprovalCard()` to properly extract file paths from objects
   - Added `diff_applied` event type to `getEventCardConfig()`

2. `packages/core/src/approvalManager.ts`
   - Added `approved: decision === 'approved'` boolean to `approval_resolved` event payload

## Build Status
✅ `pnpm run build` - SUCCESS (all 3 packages compiled)

## Testing
1. Reload extension in VS Code (Cmd+Shift+P → "Developer: Reload Window")
2. Run a MISSION mode prompt that generates file edits
3. When approval card appears:
   - ✅ File names should show correctly (e.g., "package.json")
   - ✅ Click "Approve" should show "✓ Approved" in timeline
   - ✅ "diff_applied" events should show with checkmark icon
