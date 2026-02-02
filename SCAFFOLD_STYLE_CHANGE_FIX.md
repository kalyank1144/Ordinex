# Scaffold "Change Style" Button Fix (COMPLETE)

## Problem
When clicking the "Change" button on a scaffold proposal to change the design style, the system was showing "Style customization available in Step 35.4" and immediately cancelling the scaffold instead of opening a design pack picker.

### Console Evidence (First Error)
```
[handleResolveDecisionPoint] Scaffold approval action: change_style
[handleResolveDecisionPoint] Scaffold action handled: cancelled
```

### Console Evidence (Second Error - After Backend Fix)
```
Error: Event validation failed: Unknown event type: scaffold_style_selection_requested. Only canonical event types are allowed.
```

## Root Causes (TWO Issues)

### Issue 1: Missing Backend Handler
The extension's `handleResolveDecisionPoint` function only handled `proceed` and `cancel` actions. The `change_style` action wasn't implemented, so it defaulted to cancelling.

### Issue 2: Missing Canonical Event Types
The new event types `scaffold_style_selection_requested` and `scaffold_style_selected` were defined in the `EventType` union in `types.ts`, but were NOT added to the `CANONICAL_EVENT_TYPES` array. The EventStore validates all events against this array and rejects unknown types.

## Solution Implemented

### 1. ScaffoldCard.ts (Webview) - Design Pack Picker UI

Added complete design pack picker UI with:

**New Event Types Handled:**
- `scaffold_style_selection_requested` → Shows design pack picker grid
- `scaffold_style_selected` → Shows confirmation of selection

**New Methods:**
- `renderStylePicker()` - Renders a 2x3 grid of 6 design pack options:
  - Minimal Light (clean, modern)
  - Minimal Dark (sleek dark)
  - Enterprise Blue (professional)
  - Vibrant Neon (electric colors)
  - Gradient Ocean (cool blue tones)
  - Neo Brutalist (bold black/yellow)

- `renderStyleSelected()` - Shows green confirmation card

**New Action Bindings:**
- `select_pack` action with `selectedPackId` → Triggers `select_style` event
- `cancel_picker` action → Triggers `cancel_style_change` event

**Styles Added:**
- `.scaffold-card.style-picker` - Purple left border
- `.pack-grid` - 2-column grid layout
- `.pack-option` - Selectable pack cards with gradient previews
- `.check-mark` - Purple checkmark for selected pack
- `.selection-confirm` - Green confirmation box

### 2. isScaffoldEvent() Updated
Added new event types to the recognized scaffold events list:
- `scaffold_style_selection_requested`
- `scaffold_style_selected`

## Expected Flow After Fix

1. **User clicks "Change Style"** button
   - WebView dispatches `scaffold-action` with `action: 'change_style'`

2. **Extension receives action**
   - Calls `coordinator.handleStyleChange()`
   - Emits `scaffold_style_selection_requested` event

3. **WebView shows picker**
   - Renders `renderStylePicker()` with 6 design pack options
   - User can click any pack to select it

4. **User clicks a pack**
   - WebView dispatches `scaffold-action` with `action: 'select_style'` and `selectedPackId`

5. **Extension receives selection**
   - Calls `coordinator.handleStyleSelect(packId)`
   - Updates scaffold state with new pack
   - Emits `scaffold_style_selected` event
   - Re-emits `scaffold_decision_requested` with updated pack info

6. **WebView updates**
   - Shows confirmation briefly
   - Returns to proposal card with new design pack name

## Files Changed

1. **packages/core/src/types.ts**
   - Added `scaffold_style_selection_requested` to `CANONICAL_EVENT_TYPES` array
   - Added `scaffold_style_selected` to `CANONICAL_EVENT_TYPES` array
   - (These were already in the EventType union, but missing from the canonical list)

2. **packages/webview/src/components/ScaffoldCard.ts**
   - Added `scaffold_style_selection_requested` and `scaffold_style_selected` cases
   - Added `renderStylePicker()` and `renderStyleSelected()` methods
   - Added pack selection action bindings
   - Added picker grid CSS styles
   - Updated `isScaffoldEvent()` list

## Testing

1. Start a greenfield scaffold (e.g., "build me a todo app")
2. Wait for proposal card with Proceed/Cancel buttons
3. Click "🎨 Change Style" button
4. **Expected:** Design pack picker grid appears with 6 options
5. Click any design pack
6. **Expected:** Pack is selected, returns to proposal with new pack

## Dependencies

The backend (extension.ts + scaffoldFlow.ts) changes from the previous commit are required for this to work. Those changes:
- Route `change_style` action to `handleStyleChange()`
- Route `select_style` action to `handleStyleSelect(packId)`
- Emit the new event types (`scaffold_style_selection_requested`, `scaffold_style_selected`)
