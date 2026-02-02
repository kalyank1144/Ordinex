# Scaffold Completed Event Type Fix

## Issue
When clicking "Proceed" on a scaffold flow (greenfield project creation), the UI showed:
- "Unknown event type: scaffold_completed" 
- Event displayed as raw pinned fallback instead of proper card

## Root Cause
The `scaffold_completed` event type was:
1. **Missing from webview EventType union** in `packages/webview/src/types.ts`
2. **Missing from EVENT_CARD_MAP** in `packages/webview/src/components/MissionFeed.ts`

The ScaffoldFlowCoordinator correctly emits `scaffold_completed` events, but the webview couldn't render them properly.

## Fix

### 1. Added to EventType union (`packages/webview/src/types.ts`)
```typescript
// Step 35: Scaffold Flow Events
| 'scaffold_started'
| 'scaffold_proposal_created'
| 'scaffold_decision_resolved'
| 'scaffold_applied'
| 'scaffold_cancelled'
| 'scaffold_completed';  // ← ADDED
```

### 2. Added to EVENT_CARD_MAP (`packages/webview/src/components/MissionFeed.ts`)
```typescript
scaffold_completed: {
  icon: '🎉',
  title: 'Scaffold Completed',
  color: 'var(--vscode-charts-green)',
  getSummary: (e) => {
    const recipe = e.payload.recipe_id as string || 'unknown';
    const status = e.payload.status as string || 'completed';
    if (status === 'ready_for_step_35_2') {
      return `${recipe} scaffold ready for file creation`;
    }
    return `${recipe} scaffold completed successfully`;
  }
}
```

## Files Changed
1. `packages/webview/src/types.ts` - Added `scaffold_completed` to EventType union
2. `packages/webview/src/components/MissionFeed.ts` - Added card config for `scaffold_completed`

## Event Flow
```
User: "Create a Next.js app"
  ↓
intent_received → mode_set (PLAN, scaffold flow_kind)
  ↓
scaffold_started
  ↓
scaffold_proposal_created (with decision_point_needed)
  ↓
User clicks "Proceed"
  ↓
scaffold_decision_resolved
  ↓
scaffold_completed  ← NOW RENDERS PROPERLY!
```

## Verification
Build passes without errors. The `scaffold_completed` event now renders as a proper green card with 🎉 icon.

## Status
✅ Complete - Ready for testing
