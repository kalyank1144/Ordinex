# PLAN Mode Context Collection Bug - FIXED

## Issue Identified
When testing PLAN mode, the context collection was showing **"0 files, 0 lines"** in the UI, causing the LLM to generate generic plans without any project-specific knowledge.

## Root Cause
The `context_collected` event payload format was **mismatched** between what was emitted and what the UI expected.

### What Was Sent (WRONG):
```typescript
// In planGenerator.ts
payload: {
  files: contextBundle.total_files_scanned,  // ❌ NUMBER
  lines: contextBundle.total_lines_included, // ❌ NUMBER  
  stack: contextBundle.inferred_stack
}
```

### What UI Expected (ANSWER mode format):
```typescript
// Expected by MissionFeed.ts / Context Collected Card
payload: {
  files_included: string[],      // ✅ Array of file paths
  open_files_count: number,
  total_lines: number,
  inferred_stack: string[]
}
```

### Why It Showed "0 files":
The UI was checking `payload.files_included.length` but receiving `payload.files` (a number), so it showed 0.

## Fix Applied

Updated `packages/core/src/planGenerator.ts` line ~91:

```typescript
// NEW - Matches ANSWER mode format
await eventBus.publish({
  event_id: generateId(),
  task_id: taskId,
  timestamp: new Date().toISOString(),
  type: 'context_collected',
  mode: 'PLAN',
  stage: 'none',
  payload: {
    files_included: contextBundle.files.map(f => f.path),  // ✅ Array of paths
    open_files_count: contextBundle.open_files.length,
    total_lines: contextBundle.total_lines_included,       // ✅ Proper key
    inferred_stack: contextBundle.inferred_stack,
    total_files_scanned: contextBundle.total_files_scanned
  },
  evidence_ids: [],
  parent_event_id: null
});
```

## Added Debug Logging

Added console logging before the event emission:

```typescript
console.log('📊 [PlanGenerator] Context collected:', {
  total_files: contextBundle.total_files_scanned,
  total_lines: contextBundle.total_lines_included,
  files_count: contextBundle.files.length,
  open_files_count: contextBundle.open_files.length,
  stack: contextBundle.inferred_stack
});
```

## Expected Behavior After Fix

When you test PLAN mode now, you should see:

### In Console:
```
📊 [PlanGenerator] Context collected: {
  total_files: 5,
  total_lines: 450,
  files_count: 5,
  open_files_count: 1,
  stack: ['TypeScript', 'Node.js', 'React', ...]
}
```

### In UI Timeline:
```
📚 Context Collected
5 files, 450 lines
Stack: TypeScript, Node.js, React, Vite
```

### In Generated Plan:
- Goal will reference "Ordinex" or your actual project
- Steps will mention specific files/packages (e.g., "packages/core", "packages/webview")
- Assumptions will be based on actual tech stack
- Risks will consider actual project structure

## Testing Instructions

1. **Press F5** to reload Extension Development Host
2. **Open Ordinex Mission Control**
3. **Select PLAN mode**
4. **Enter prompt**: "plan next features for Ordinex"
5. **Verify**:
   - ✅ Context Collected shows: "X files, Y lines" (NOT "0 files, 0 lines")
   - ✅ Tech stack displays (TypeScript, Node.js, etc.)
   - ✅ Plan references actual Ordinex components
   - ✅ Console shows debug log with context details

## Files Modified

1. **packages/core/src/planGenerator.ts**
   - Fixed `context_collected` event payload format
   - Added debug console logging
   - Now matches ANSWER mode format

## Build Status
✅ All packages compiled successfully
- packages/core: ✓ 614ms
- packages/webview: ✓ 774ms
- packages/extension: ✓ 424ms

## Next Steps

1. Test the fix (F5 → PLAN mode → verify context shows correctly)
2. If working, the debug logs in `MissionFeed.ts` and `PlanCard.ts` can be removed
3. Share a screenshot showing proper context collection
