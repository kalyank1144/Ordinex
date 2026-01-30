# Command Event Display Fix Summary

## Issue
When running "run the app" command intent:
1. **`command_proposed`** and **`command_started`** events showed "Unknown event type"
2. **`progress_updated`** was being emitted but is NOT a canonical EventType (only a PrimitiveEventType)
3. Error: `Event validation failed: Unknown event type: progress_updated`

## Root Cause
The `commandPhase.ts` was emitting `progress_updated` directly in `emitEvent()`, but:
- `progress_updated` is a **PrimitiveEventType** used by the normalizer for read-time UI mapping
- It is NOT a **canonical EventType** that can be stored in the event store
- The EventStore validates that only canonical types can be stored

## Changes Made

### 1. Added `command_progress` as Canonical Event Type
**File: `packages/core/src/types.ts`**
- Added `'command_progress'` to the `EventType` union
- Added `'command_progress'` to the `CANONICAL_EVENT_TYPES` array

### 2. Fixed commandPhase.ts to Use Valid Event Type
**File: `packages/core/src/commandPhase.ts`**
- Changed `emitEvent(ctx, 'progress_updated', ...)` to `emitEvent(ctx, 'command_progress', ...)`

### 3. Added `command_progress` to Webview Types
**File: `packages/webview/src/types.ts`**
- Added `'command_progress'` to the webview's EventType union

### 4. Added `command_progress` to MissionFeed
**File: `packages/webview/src/components/MissionFeed.ts`**
- Added `command_progress` entry to EVENT_CARD_MAP with icon, title, color, and summary function

### 5. Added `command_progress` to Event Normalizer
**File: `packages/core/src/eventNormalizer.ts`**
- Added mapping for `command_progress` → `progress_updated` primitive type

## Event Type Architecture Clarification

```
CANONICAL EventType (stored in EventStore):
  - 'command_started'
  - 'command_completed'
  - 'command_proposed'
  - 'command_skipped'
  - 'command_progress'  ← NEW (for throttled progress during execution)

PRIMITIVE EventType (read-time normalization only):
  - 'progress_updated'  ← Used by normalizer to map various progress events
  - 'tool_started'
  - 'tool_completed'
  - etc.
```

The normalizer maps canonical types to primitives at READ TIME for UI rendering.
Only canonical types can be emitted/stored.

## Testing
After this fix:
1. Reload the extension (F5)
2. Type "run the app" in MISSION mode
3. Events should display with proper icons and titles:
   - `command_proposed` → "📋 Command Proposed"
   - `command_started` → "▶️ Command Started"
   - `command_progress` → "⏳ Command Progress"
   - `command_completed` → "✅ Command Completed"

4. No more "Unknown event type: progress_updated" errors

## Files Changed
- `packages/core/src/types.ts`
- `packages/core/src/commandPhase.ts`
- `packages/webview/src/types.ts`
- `packages/webview/src/components/MissionFeed.ts`
- `packages/core/src/eventNormalizer.ts`
