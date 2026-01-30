# Command Event Display Fix

## Problem

When running a command intent like "run the app", the UI was showing:
- `command_proposed` → "Unknown event type"
- `command_started` → "Unknown event type"

The "Run command(s)?" decision card was rendering correctly, but the underlying events were not mapped properly, causing them to display as unknown events in the Mission Feed.

## Root Cause

Step 34.5 (Command Execution Phase) introduced new event types that were:
1. Added to `packages/core/src/types.ts` (canonical EventType)
2. **Missing from** `packages/webview/src/types.ts` (webview mirror types)
3. **Missing from** `packages/core/src/eventNormalizer.ts` NORMALIZATION_MAP
4. **Missing from** `packages/webview/src/components/MissionFeed.ts` EVENT_CARD_MAP

The 'command' stage was also missing from webview's Stage type and STAGE_CONFIG.

## Files Changed

### 1. `packages/webview/src/types.ts`
- Added 'command' to Stage type
- Added Step 34 event types: `verify_started`, `verify_completed`, `verify_proposed`, `verify_skipped`, `command_started`, `command_completed`
- Added Step 34.5 event types: `command_proposed`, `command_skipped`

### 2. `packages/core/src/eventNormalizer.ts`
- Added `command_proposed` mapping → `decision_point_needed` (kind: 'command_approval')
- Added `command_skipped` mapping → `progress_updated` (kind: 'command_skipped')
- Changed `command_started` kind from 'verify_command' to 'command'
- Changed `command_completed` kind from 'verify_command' to 'command'

### 3. `packages/webview/src/components/MissionFeed.ts`
- Added EVENT_CARD_MAP entries for all Step 34/34.5 events:
  - `verify_started`, `verify_completed`, `verify_proposed`, `verify_skipped`
  - `command_started`, `command_completed`
  - `command_proposed`, `command_skipped`
- Added 'command' stage to STAGE_CONFIG

## New Event Cards

| Event | Icon | Title | Summary |
|-------|------|-------|---------|
| `verify_started` | 🔍 | Verify Started | "Running N verification command(s)" |
| `verify_completed` | ✅ | Verify Completed | "Verification passed/failed" |
| `verify_proposed` | 🔍 | Verify Proposed | "Proposed N verification command(s)" |
| `verify_skipped` | ⏭️ | Verify Skipped | Reason |
| `command_started` | ▶️ | Command Started | "[index/total] command..." |
| `command_completed` | ✅ | Command Completed | "✓/✗ cmd (Ns) → exit N" |
| `command_proposed` | 📋 | Command Proposed | "N command(s) proposed (context)" |
| `command_skipped` | ⏭️ | Command Skipped | Reason |

## Verification

Build passes successfully with no TypeScript errors.

## Expected Behavior After Fix

When a user types "run the app":
1. `stage_changed` → Shows "Command" stage header
2. `command_proposed` → Shows "📋 Command Proposed: 1 command(s) proposed"
3. `decision_point_needed` → Shows "Run command(s)?" decision card with buttons
4. After user clicks "Run command(s)":
   - `command_started` → Shows "▶️ Command Started: npm run dev"
   - `command_completed` → Shows "✅ Command Completed: ✓ npm run dev (2s) → exit 0"
