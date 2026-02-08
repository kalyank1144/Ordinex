# Step 39: Rendered Visual Preview + Style Picker

## Overview
This step adds a real rendered visual preview to the scaffold proposal card, showing users exactly what their project's design will look like before they click "Create Project". Also includes an enhanced style picker with mini previews.

## Files Changed

### 1. `packages/webview/src/components/DesignPreview.ts` (NEW)
**Purpose**: Standalone web component for rendering design pack previews

**Key Features**:
- Pure CSS/HTML rendering (no images, no network)
- Hero section with headline, subtext, and CTA button
- Component samples row (buttons, inputs, cards)
- Typography samples row (H1, H2, body, mono)
- Decorative gradient shapes using design tokens
- Mini preview variant for style picker gallery
- Reference influence badge support (Step 38 integration)
- Style overrides from reference tokens

**Key Methods**:
- `renderHeroSection()` - Hero with gradient background and decorative shapes
- `renderComponentsRow()` - Button, input, card samples
- `renderTypographyRow()` - Font hierarchy preview
- `applyOverrides()` - Merges reference token overrides with pack tokens

### 2. `packages/webview/src/components/ScaffoldCard.ts` (MODIFIED)
**Purpose**: Enhanced scaffold proposal card with visual preview

**Changes**:
- Added `renderVisualPreview()` method for inline preview rendering
- Added `getDesignPackTokens()` method with all 12 pack token definitions
- Added `renderInfluenceBadge()` for Step 38 reference tokens display
- Updated `renderProposalWithActions()` to show full visual preview
- Added CSS styles for influence badge, pack meta, and enhanced picker

**Visual Preview Features**:
- Full preview: Hero + Components + Typography rows
- Compact preview: Mini hero for style picker cards
- Influence badge: Shows confidence % when references present
- Pack name badge and tokens hint display

## Design Pack Tokens Included

| Pack ID | Vibe | Primary Color | Font |
|---------|------|---------------|------|
| minimal-light | minimal | #0f172a | Inter |
| minimal-dark | minimal | #f8fafc | Inter |
| enterprise-blue | enterprise | #1e40af | IBM Plex Sans |
| vibrant-neon | vibrant | #a855f7 | Space Grotesk |
| gradient-ocean | gradient | #0284c7 | Montserrat |
| neo-brutalist | neo | #000000 | DM Sans |
| vibrant-pop | vibrant | #7c3aed | Poppins |
| warm-sand | warm | #92400e | Playfair Display |
| enterprise-slate | enterprise | #334155 | IBM Plex Sans |
| gradient-sunset | gradient | #f97316 | Montserrat |
| glassmorphism | glass | #6366f1 | Inter |
| warm-olive | warm | #3f6212 | Merriweather |

## Visual Preview Structure

```
┌─────────────────────────────────────────────┐
│ [✨ Influenced by references (85%)]         │  ← Optional badge
├─────────────────────────────────────────────┤
│                                   ○ ○       │  ← Decorative shapes
│  Build Something Great              ○       │
│  Modern, fast, beautiful apps.              │
│  [Get Started]                              │
├─────────────────────────────────────────────┤
│  COMPONENTS                                 │
│  [Primary] [Secondary] [Input___] [Card]    │
├─────────────────────────────────────────────┤
│  H1  H2  Body  mono                         │  ← Typography samples
└─────────────────────────────────────────────┘
```

## Style Picker with Mini Previews

When user clicks "Change Style", they see 6 preview cards:

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  [Mini Preview]  │  │  [Mini Preview]  │  │  [Mini Preview]  │
│  Minimal Light   │  │  Minimal Dark    │  │  Enterprise Blue │
│  ⊕ minimal       │  │  ⊕ minimal       │  │  ⊕ enterprise    │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Critical Rules Followed

✅ **NO network fetching** - All rendering is pure CSS/HTML  
✅ **Deterministic** - Same tokens always produce same preview  
✅ **Fast** - Renders instantly (<200ms)  
✅ **UI-only** - Does NOT affect scaffold files until approved  
✅ **Replay-safe** - design_pack_id stored in events for reconstruction  

## Reference Tokens Integration (Step 38)

When `referenceTokensSummary` is present with confidence >= 0.5:
- Shows influence badge with confidence percentage
- Applies style overrides (primary/accent colors, radius)
- Displays mood tags from reference analysis

## Event Payload Enhancements

The `scaffold_decision_requested` event now includes:
```typescript
{
  // ... existing fields
  reference_tokens_summary?: {
    confidence: number;
    moods?: string[];
  };
  style_overrides?: {
    palette?: { primary?: string; accent?: string };
    radius?: 'sm' | 'md' | 'lg';
  };
}
```

## Usage Flow

1. User requests greenfield project
2. Scaffold proposal shows with visual preview
3. User sees real rendered preview (hero, components, typography)
4. Optional: User clicks "Change Style" → sees 6 mini preview cards
5. User selects different style → proposal updates with new preview
6. User clicks "Create Project" → scaffold applies selected design

## Testing

Manual testing steps:
1. Request "create a new React app" 
2. Verify visual preview shows in proposal card
3. Verify hero section, components, typography all visible
4. Click "Change Style" and verify mini previews
5. Select different style, verify preview updates
6. If references attached, verify influence badge appears

## Future Enhancements (V1.5+)

- PNG snapshot export (optional)
- Animation preview
- Mobile/responsive preview toggle
- Custom color picker integration
