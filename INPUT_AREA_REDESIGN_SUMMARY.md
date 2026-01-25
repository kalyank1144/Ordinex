# Input Area Redesign Summary

## Overview
Redesigned the composer input area to have a more modern, ChatGPT-style layout with the send/stop button inside the input field.

## Changes Made

### Layout Structure

**Before:**
```
┌─────────────────────────────────────────────────────────────┐
│ Mode: [ANSWER ▼]   Model: [Claude 3 Haiku ▼]               │
├─────────────────────────────────────────────────────────────┤
│ Enter your prompt...                                        │
├─────────────────────────────────────────────────────────────┤
│ [Send]  [Stop]  [Clear]                                    │
└─────────────────────────────────────────────────────────────┘
```

**After:**
```
┌─────────────────────────────────────────────────────────────┐
│ Mode: [ANSWER ▼]   Model: [Claude 3 Haiku ▼]      [📎]     │
├─────────────────────────────────────────────────────────────┤
│ ╭──────────────────────────────────────────────────────╮    │
│ │ Enter your prompt...                           (▶)  │    │
│ ╰──────────────────────────────────────────────────────╯    │
└─────────────────────────────────────────────────────────────┘
```

### Features

1. **Combined Send/Stop Button**
   - Circular button inside input field
   - Shows ▶ (play) when ready to send
   - Shows ■ (stop) when running with pulsing red animation
   - Disabled when textarea is empty

2. **Attach Button**
   - Paperclip icon (📎) positioned at top-right of controls
   - Placeholder for future file attachment feature
   - Subtle hover effect

3. **Rounded Input Wrapper**
   - Modern rounded border (12px radius)
   - Focus state with highlight border
   - Textarea and button side by side

### CSS Classes Added

- `.composer-controls-spacer` - Flex spacer to push attach button right
- `.attach-btn` - Attach button styling
- `.composer-input-wrapper` - Rounded container for input area
- `.send-stop-btn` - Base circular button styling
- `.send-stop-btn.send` - Send state (blue)
- `.send-stop-btn.stop` - Stop state (red with pulse animation)

### JavaScript Functions Added

- `updateSendStopButton()` - Syncs button state with task status
- Click handler for combined button (delegates to send or stop)
- Attach button placeholder handler

### Backward Compatibility

- Original `sendBtn`, `stopBtn`, `clearBtn` elements still exist (hidden)
- All existing message handlers and click logic preserved
- New button delegates to old sendBtn for actual submission

## Files Modified

- `packages/webview/src/index.ts`
  - Added CSS for new input layout
  - Updated HTML structure
  - Added JavaScript for button state management

## Visual Details

### Send Button (Ready State)
- Blue circular button
- ▶ icon
- Hover: slight scale increase
- Disabled: 50% opacity when textarea empty

### Stop Button (Running State)
- Red circular button
- ■ (square/stop) icon
- Pulsing glow animation
- Always enabled when running

### Animation
```css
@keyframes stopPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(220, 53, 69, 0); }
}
```
