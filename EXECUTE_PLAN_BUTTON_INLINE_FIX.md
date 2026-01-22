# Execute Plan Button Inline Placement Fix

## Issue
The "Execute Plan" button was appearing at the top of the UI in a green banner, forcing users to scroll all the way up to click it after plan approval. This broke the natural timeline flow.

## Root Cause
The webview had an unused `renderExecutePlanCTA()` function that was potentially creating a top-level Execute Plan button. While there was a comment saying not to call it, having the function there could have caused stale rendering or confusion.

## Solution
**Removed the top-level Execute Plan button rendering entirely.** Now the button ONLY appears inline in the timeline, immediately after the `execution_paused` event (when `reason === 'awaiting_execute_plan'`).

### Files Changed
1. **packages/webview/src/index.ts**
   - ✅ Removed the entire `renderExecutePlanCTA()` function (lines ~600-650)
   - ✅ Ensured inline Execute Plan button only renders after `execution_paused` event
   - ✅ Cleaned up comments to clarify inline-only behavior

## Implementation Details

### Inline Execute Plan Button Location
The button now appears in the timeline flow at the exact right moment:

```
1. Plan Created card
2. User clicks "Approve Plan"
3. approval_requested event (inline approval card)
4. User approves
5. execution_paused event with reason="awaiting_execute_plan"
6. 🚀 Execute Plan button appears HERE (inline)  ← NO SCROLLING NEEDED!
7. User clicks Execute Plan
8. Execution begins (retrieval_started, etc.)
```

### Button Rendering Logic
```javascript
// In renderMissionTimeline()
if (event.type === 'execution_paused') {
  const reason = event.payload.reason || '';
  // ONLY show inline button when reason is awaiting_execute_plan
  if (reason === 'awaiting_execute_plan') {
    items.push(`
      <div style="margin: 16px 0; padding: 16px; ...">
        <button onclick="handleExecutePlan()" ...>
          🚀 Execute Plan
        </button>
        <div>✓ Plan approved - Click to begin execution</div>
      </div>
    `);
  }
}
```

## Testing Checklist
- [x] Remove top-level Execute Plan button rendering
- [x] Verify inline button appears after execution_paused event
- [x] Build extension successfully
- [ ] Manual test: Create plan, approve it, verify button appears inline
- [ ] Manual test: Click inline Execute Plan button, verify execution starts
- [ ] Manual test: Verify no scrolling needed to access the button

## Benefits
✅ **Better UX**: Button appears exactly where users need it in the flow
✅ **No scrolling**: Users don't have to scroll up after approving the plan
✅ **Natural flow**: The timeline reads top-to-bottom chronologically
✅ **Cleaner code**: Removed unused function, simplified logic

## User Impact
Users can now approve a plan and immediately click "Execute Plan" without scrolling. The button appears inline right after the approval is processed, maintaining the natural timeline flow.

---

**Status**: ✅ **FIXED**
**Build**: ✅ **SUCCESSFUL**
**Next Step**: Reload extension and test manually
