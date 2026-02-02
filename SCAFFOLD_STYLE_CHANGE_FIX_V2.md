# Scaffold Style Change Fix V2

## Problem
When clicking the "Cancel" button on a scaffold proposal card, instead of allowing the user to cancel the scaffold, it was showing "Style customization available in Step 35.4" and treating the action as a cancellation with that reason.

## Root Cause
In `scaffoldFlow.ts`, the `handleUserAction()` function accepted `'change_style'` as a valid action type:
```typescript
async handleUserAction(action: 'proceed' | 'cancel' | 'change_style')
```

The switch statement had a `case 'change_style':` that incorrectly cancelled the scaffold with the message "Style customization available in Step 35.4":
```typescript
case 'change_style':
  // In 35.1, change_style is disabled - treat as cancel with message
  completionStatus = 'cancelled';
  reason = 'Style customization available in Step 35.4';
  break;
```

This was a legacy placeholder from when the style change feature wasn't implemented. However, the style change feature is now fully implemented via the `handleStyleChange()` method, which:
1. Sets `stylePickerActive = true`
2. Emits `scaffold_style_selection_requested` event with available design packs
3. Returns without completing the flow (keeps it in `awaiting_decision` state)

The extension was supposed to intercept `change_style` action and call `handleStyleChange()` directly, but somehow the old `handleUserAction()` code path was being triggered.

## Solution
1. **Removed `'change_style'` from `handleUserAction()` signature**:
   ```typescript
   async handleUserAction(action: 'proceed' | 'cancel'): Promise<ScaffoldFlowState>
   ```

2. **Removed the dead `case 'change_style':` from the switch statement** since it should never be reached.

3. **Enabled the "Change" button** (renamed from "Change Style") by setting `disabled: false` in `buildScaffoldDecisionOptions()`.

## Flow After Fix
1. User sees scaffold proposal card with "Proceed", "Cancel", and "Change" buttons
2. When user clicks "Change":
   - Webview sends `change_style` action to extension
   - Extension intercepts it and calls `handleStyleChange()` directly
   - `handleStyleChange()` emits `scaffold_style_selection_requested` event
   - Webview shows design pack picker (style selection card)
3. When user selects a pack:
   - Webview sends `select_style` action with `selected_pack_id` in scaffold_context
   - Extension calls `handleStyleSelect(packId)`
   - Flow re-emits `scaffold_proposal_created` with new pack and `scaffold_decision_requested`
   - User returns to decision state with updated proposal

## Files Changed
- `packages/core/src/scaffoldFlow.ts`:
  - Changed `handleUserAction` signature from `'proceed' | 'cancel' | 'change_style'` to `'proceed' | 'cancel'`
  - Removed dead `case 'change_style':` from switch statement
  - Enabled "Change" button (disabled: false)

## Build Status
✅ All packages compile successfully
