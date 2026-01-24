# Mission Breakdown UI Enhancement - Step 26 Completion

## Summary

Implemented comprehensive UI enhancements for the Mission Breakdown (Anti-Failure Guard) system in the webview. This adds interactive cards for large plan detection and mission selection flow.

## Changes Made

### packages/webview/src/index.ts

#### 1. Added `renderLargePlanDetectedCard()` function
Renders an explanation card when `plan_large_detected` event is received:
- Shows warning banner with reasons why the plan is too large
- Displays metrics (step count, domains)
- Explains why mission breakdown is necessary
- Shows "Generating mission breakdown..." indicator

#### 2. Added `renderMissionBreakdownCard()` function
Renders an interactive mission selection card when `mission_breakdown_created` event is received:
- Displays all generated missions in a scrollable list
- Each mission shows:
  - Title and icon
  - Size badge (S/M/L with color coding)
  - Risk badge (low/med/high with color coding)
  - Intent description
  - Included steps summary
  - "Select This Mission" button
- First mission marked as "⭐ Recommended: Foundation for other missions"
- Selected mission shows checkmark instead of button
- Footer reminder about one-at-a-time execution

#### 3. Added `renderStartMissionButton()` function
Renders the "Start Mission" CTA after mission selection:
- Shows selected mission title
- Green "🚀 Start Mission: [title]" button
- Info text about steps count and queued missions

#### 4. Added Mission Selection Handlers
```javascript
window.handleSelectMission(taskId, missionId)
window.handleStartMission(taskId, missionId)
```
- Send messages to extension backend:
  - `ordinex:selectMission` - When user selects a mission
  - `ordinex:startMission` - When user clicks Start Mission button
- Demo mode fallbacks for standalone testing

#### 5. Updated Timeline Rendering
- After `mission_selected` event, shows Start Mission button
- Checks if mission has already started to avoid duplicate buttons

## Event Cards Supported

| Event Type | Renderer |
|------------|----------|
| `plan_large_detected` | `renderLargePlanDetectedCard()` - Explanation card |
| `mission_breakdown_created` | `renderMissionBreakdownCard()` - Interactive selection |
| `mission_selected` | Event card + Start Mission button |

## UI Flow

```
User creates large plan (16+ steps)
    ↓
[plan_large_detected event]
    ↓
⚠️ Large Plan Detected Card (explanation)
    ↓
[mission_breakdown_created event]
    ↓
🎯 Mission Breakdown Card (interactive)
    ↓
User clicks "Select This Mission" on one mission
    ↓
[mission_selected event]
    ↓
✅ Mission Selected confirmation + 🚀 Start Mission button
    ↓
User clicks "Start Mission"
    ↓
[ordinex:startMission message to backend]
```

## Message Types Added

### From Webview to Extension
- `ordinex:selectMission` - User selected a mission
  - `task_id: string`
  - `mission_id: string`
- `ordinex:startMission` - User clicked Start Mission
  - `task_id: string`
  - `mission_id: string`

## Design Decisions

1. **One Mission at a Time**: UI enforces single selection; other missions show as unselectable once one is selected
2. **Visual Hierarchy**: Size and Risk badges use color coding (green/yellow/orange/red) for quick scanning
3. **Recommended Mission**: First mission (usually foundation) gets special highlighting
4. **Scrollable List**: Max height 400px with overflow scroll for long mission lists
5. **Confirmation Before Start**: Selection and execution are separate clicks to prevent accidents

## Integration Notes

Extension backend needs to handle:
1. `ordinex:selectMission` → emit `mission_selected` event
2. `ordinex:startMission` → start mission execution pipeline

## Files Changed

1. `packages/webview/src/index.ts` - Added mission breakdown UI rendering and handlers
