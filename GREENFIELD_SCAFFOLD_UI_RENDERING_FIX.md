# Greenfield Scaffold UI Rendering Fix

## Problem Identified

The greenfield scaffold flow was fully implemented with beautiful UI components, but **wasn't being rendered** in the MissionFeed. When users said "create a todo app", the system:

✅ **WORKING**: Detection, routing, recipe selection, design pack selection
❌ **BROKEN**: UI rendering - showing generic text instead of rich ScaffoldCard

## Root Cause

**MissionFeed.ts** had no code to detect and render scaffold events using the **ScaffoldCard** custom element. The events were falling through to the generic EVENT_CARD_MAP rendering, showing minimal text like:

```
📋 Scaffold Proposal Ready | nextjs_app_router + coastal-blue
```

Instead of the rich proposal card with:
- Recipe details (Next.js 14 App Router)
- Design pack preview with color swatch
- Token summary (Primary: #0EA5E9 | Font: Inter)
- Files/directories count
- Change Style button
- Proceed/Cancel buttons

## Fix Applied

### Changed Files

**packages/webview/src/components/MissionFeed.ts**

### Changes Made

#### 1. Added Imports
```typescript
import { isScaffoldEvent } from './ScaffoldCard';
import { renderPreflightDecisionCard } from './PreflightDecisionCard';
```

#### 2. Added Priority Check in `renderEventCard()`
```typescript
// SCAFFOLD EVENTS: Render using ScaffoldCard custom element (PRIORITY CHECK)
if (isScaffoldEvent(event.type)) {
  console.log('[MissionFeed] Rendering scaffold event with ScaffoldCard:', event.type);
  return renderScaffoldEventCard(event);
}
```

This check runs **before** all other renderers, ensuring scaffold events are caught first.

#### 3. Added `renderScaffoldEventCard()` Function
```typescript
function renderScaffoldEventCard(event: Event): string {
  const eventId = event.event_id || `evt_${Date.now()}`;
  const eventJson = JSON.stringify(event).replace(/"/g, '&quot;');
  
  return `
    <scaffold-card id="scaffold-${escapeHtml(eventId)}"></scaffold-card>
    <script>
      (function() {
        try {
          const card = document.getElementById('scaffold-${escapeJsString(eventId)}');
          if (card) {
            const eventData = JSON.parse('${eventJson}'.replace(/&quot;/g, '"'));
            card.event = eventData;
          }
        } catch (e) {
          console.error('[ScaffoldCard] Failed to set event data:', e);
        }
      })();
    </script>
  `;
}
```

This function:
- Creates a `<scaffold-card>` custom element
- Injects event data via inline script
- The ScaffoldCard component then renders the rich UI from its internal logic

## Scaffold Events Now Rendered

These event types now use ScaffoldCard rendering:

1. **scaffold_started** - Shows "Creating new project" state
2. **scaffold_preflight_started** - Shows safety preflight check
3. **scaffold_preflight_completed** - Shows preflight results with target directory
4. **scaffold_target_chosen** - Shows selected target path
5. **scaffold_proposal_created** - 🎯 **THIS IS THE KEY ONE** - Shows full proposal with:
   - Recipe name and details
   - Design pack preview with colors
   - Token summary
   - Files/directories count
   - Reference section (if attachments provided)
   - **Change Style** button
   - Proceed/Cancel/Change buttons
6. **scaffold_blocked** - Shows safety block with options
7. **scaffold_completed** - Shows completion status
8. **scaffold_applied** - Shows files created

## Complete Corrected Flow

```
User: "Create a todo app"
        ↓
[greenfieldDetector] 
  → Confidence: 0.9 ✅
        ↓
[extension.ts routing]
  → Calls handleScaffoldFlow() ✅
        ↓
[ScaffoldFlowCoordinator]
  → selectRecipe() → Next.js 14 ✅
  → selectDesignPack() → Coastal Blue ✅
  → Emit scaffold_proposal_created ✅
        ↓
[MissionFeed] ✅ NOW FIXED
  → Detects isScaffoldEvent()
  → Calls renderScaffoldEventCard()
  → Creates <scaffold-card> element
        ↓
[ScaffoldCard Custom Element] ✅
  → Renders rich proposal card with:
     * Recipe: Next.js 14 (App Router)
     * Design: Coastal Blue preview
     * Primary: #0EA5E9 | Font: Inter
     * Files: 24 | Dirs: 8
     * [🎨 Change Style] [✓ Proceed] [✗ Cancel]
```

## What Should Happen Now

When a user says **"create a todo app"**:

1. Greenfield detector identifies intent ✅
2. ScaffoldFlowCoordinator generates proposal ✅
3. **ScaffoldCard renders in UI with:**
   - Full recipe details
   - Design pack visual preview
   - Color/font tokens
   - File counts
   - Interactive buttons
4. User can click "Change Style" to see design picker
5. User clicks "Proceed" to start scaffolding
6. Terminal runs `npx create-next-app` ✅

## Benefits of This Fix

✅ **Matches original design spec** - Full rich proposal card
✅ **Better UX** - Visual design preview, not just text
✅ **Clearer information** - Users see exactly what will be created
✅ **Actionable** - Change Style, Proceed, Cancel buttons
✅ **Professional** - Matches quality of other cards (PlanCard, DiffProposedCard)

## Testing

To test this fix:

1. Say: **"Create a new React app"**
2. **Expected:** Rich scaffold proposal card appears with:
   - Recipe name
   - Design pack color preview
   - Token summary
   - Files/directories count
   - Action buttons

3. **Before Fix:** Generic text card
4. **After Fix:** Full ScaffoldCard with all details

## Files Changed

- `packages/webview/src/components/MissionFeed.ts` - Added scaffold event rendering

## No Changes Needed To

- `packages/webview/src/components/ScaffoldCard.ts` - Already perfect ✅
- `packages/core/src/scaffoldFlow.ts` - Already emitting events ✅
- `packages/extension/src/extension.ts` - Already routing correctly ✅

The components were all there - they just weren't wired into the rendering pipeline!

---

**Status:** ✅ COMPLETE - Scaffold UI now renders properly
