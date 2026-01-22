# Mission Execution Event Rendering Debug

## Issue
When clicking "Execute Plan", the mission execution starts but events (`mission_started`, `step_started`) show as "Unknown event type" in the UI instead of rendering properly with their configured icons and titles.

## Investigation Summary

### What I Found

1. **Event Types ARE Correctly Defined**
   - Both `mission_started` and `step_started` are defined in `packages/core/src/types.ts`
   - They are also defined in `packages/webview/src/types.ts`
   - They have proper configurations in `EVENT_CARD_MAP` in `packages/webview/src/components/MissionFeed.ts`

2. **MissionExecutor IS Emitting Events**
   - `packages/core/src/missionExecutor.ts` correctly emits `mission_started` and `step_started` events
   - Events are being persisted through EventBus → EventStore
   - Events ARE reaching the webview (as shown in screenshots)

3. **Suspected Issue**
   - The webview might be using a **cached/stale bundle** that doesn't have the event card configurations
   - OR there's a runtime type mismatch where the event.type string doesn't match the EventType literal

## Changes Made

### 1. Added Diagnostic Logging
Added console logs in `packages/webview/src/components/MissionFeed.ts` → `renderEventCard()`:

```typescript
console.log('[MissionFeed] renderEventCard called for type:', event.type);
console.log('[MissionFeed] EVENT_CARD_MAP has config:', event.type in EVENT_CARD_MAP);
console.log('[MissionFeed] Config value:', EVENT_CARD_MAP[event.type]);
```

This will help us see:
- What event type is actually being received
- Whether EVENT_CARD_MAP lookup is succeeding
- What the actual config value is

### 2. Rebuilt Packages
Ran `pnpm build` to compile all changes into the extension bundle.

## Next Steps - TESTING REQUIRED

### How to Test:

1. **Reload the VS Code Extension**
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Developer: Reload Window"
   - This ensures the newly built extension code is loaded

2. **Open Developer Console**
   - Press `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows/Linux)
   - Or use menu: Help → Toggle Developer Tools
   - Switch to the "Console" tab

3. **Test the Execution Flow**
   - Select PLAN mode
   - Enter a prompt
   - Approve the plan
   - Click "Execute Plan" button
   - Watch the console for diagnostic logs

4. **Check Console Output**
   Look for lines like:
   ```
   [MissionFeed] renderEventCard called for type: mission_started
   [MissionFeed] EVENT_CARD_MAP has config: true
   [MissionFeed] Config value: { icon: '🚀', title: 'Mission Started', ... }
   ```

### Expected Outcomes:

**If logs show `has config: true` and config exists:**
- Issue is likely webview cache/bundle not updating
- Solution: Hard refresh or clear extension cache

**If logs show `has config: false` or undefined:**
- Issue is type mismatch at runtime
- Event.type string doesn't match EventType literal
- Will need to add runtime type coercion/validation

**If logs don't appear at all:**
- renderEventCard is not being called
- Issue is earlier in the event flow
- Need to check event passing from extension to webview

## Files Modified

1. `packages/webview/src/components/MissionFeed.ts` - Added diagnostic logging
2. All packages rebuilt via `pnpm build`

## What's Already Working

✅ Event types defined correctly in both packages
✅ MissionExecutor emitting events  
✅ Events persisted to EventStore
✅ Events sent to webview (UI updates with "Unknown event type")
✅ EVENT_CARD_MAP has configurations for these events
✅ Other event types (intent_received, mode_set, etc.) render fine

## What's NOT Working

❌ `mission_started` and `step_started` don't match their EVENT_CARD_MAP configs
❌ These events fall through to the "Unknown event type" fallback renderer

## Possible Root Causes (In Order of Likelihood)

1. **Stale Bundle Cache** - VS Code webview using old JavaScript bundle
2. **Type String Mismatch** - Event.type at runtime doesn't exactly match 'mission_started' 
3. **Build/Import Issue** - EVENT_CARD_MAP not properly exported/imported
4. **Runtime Module Loading** - Webview not loading updated MissionFeed module

---

**Action Required:** Please reload the VS Code extension window and test with Developer Console open to see the diagnostic logs. Report back what you see in the console when you click "Execute Plan".
