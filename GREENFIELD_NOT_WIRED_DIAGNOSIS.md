# Greenfield Flow NOT Wired - Root Cause Analysis

## The Critical Problem

**MissionFeed.ts is NOT being used by the webview!**

### Architecture Issue

```
packages/webview/src/
├── index.ts                    ← Exports getWebviewContent()
│   └── Returns 2500+ line HTML string with INLINE JavaScript
│       └── Has its own renderEventCard() function
│       └── NO imports, NO module usage
│
└── components/
    └── MissionFeed.ts          ← Has proper scaffold detection
        └── isScaffoldEvent()   ✅ Works correctly
        └── renderEventCard()   ✅ Has scaffold priority check
        └── BUT NEVER EXECUTED! ❌ Dead code!
```

### The Disconnect

**In `index.ts` (what actually runs):**
```javascript
// Around line 1500+ in the inline <script>
function renderEventCard(event) {
  // Special handling for clarification_presented
  if (event.type === 'clarification_presented') {
    return renderClarificationCard(event);
  }
  
  // NO SCAFFOLD EVENT HANDLING! ❌
  
  // Falls through to generic event card config
  const config = getEventCardConfig(event.type);
  // ...
}
```

**In `MissionFeed.ts` (never runs):**
```typescript
export function renderEventCard(event: Event, taskId?: string): string {
  // SCAFFOLD EVENTS: Render using ScaffoldCard custom element (PRIORITY CHECK)
  if (isScaffoldEvent(event.type)) {  ✅ This exists!
    console.log('[MissionFeed] Rendering scaffold event with ScaffoldCard:', event.type);
    return renderScaffoldEventCard(event);  ✅ This exists!
  }
  // ...
}
```

## Why This Happened

The webview was originally built as a monolithic HTML file for rapid prototyping. Over time:
1. Components like MissionFeed.ts were extracted to separate modules
2. BUT the inline JavaScript in index.ts was never updated to import them
3. The TypeScript modules exist but are **never bundled or imported**

## The Fix Options

### Option 1: Add Scaffold Handling to Inline JavaScript (Quick Fix)
Add scaffold event detection directly in index.ts inline script:

```javascript
// In renderEventCard() function in index.ts
function renderEventCard(event) {
  // ADD THIS at the top:
  // SCAFFOLD EVENTS: Check scaffold event types
  const scaffoldEventTypes = [
    'scaffold_started',
    'scaffold_proposal_created',
    'scaffold_decision_resolved',
    'scaffold_applied',
    'scaffold_completed',
    'scaffold_cancelled'
  ];
  
  if (scaffoldEventTypes.includes(event.type)) {
    return renderScaffoldEventCard(event);  // Call existing function
  }
  
  // ... rest of existing code
}
```

Then ensure `renderScaffoldEventCard()` exists in inline JavaScript.

### Option 2: Proper Module System (Architectural Fix)
- Set up webpack/rollup to bundle TypeScript modules
- Import MissionFeed.ts functions properly
- Remove duplicate inline code
- **This is the right long-term fix but requires build tooling**

## Current State

❌ **Scaffold events emit properly from extension**
❌ **ScaffoldCard web component exists**  
❌ **MissionFeed.ts has proper routing**
❌ **BUT webview inline JS doesn't know about any of this!**

## Immediate Action Needed

We need to either:
1. **Quick fix:** Add scaffold event detection to inline JavaScript in index.ts
2. **Proper fix:** Set up module bundling and remove duplicate code

The walkthrough I provided was correct about how it SHOULD work, but the wiring between MissionFeed.ts and index.ts doesn't exist.

**My apologies for claiming it was 100% wired without verifying the connection between the TypeScript modules and the actual running code.**
