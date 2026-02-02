# Scaffold Decision Point Fix

## Date: January 31, 2026

## Problem
When clicking "Change Style" or "Proceed" buttons on the Scaffold Proposal card, the console showed:
```
[Extension Host] Decision point event not found
```

The buttons were not working because the extension couldn't find the decision event.

## Root Cause
The extension's `handleResolveDecisionPoint` function was only looking for `decision_point_needed` events:

```typescript
const decisionEvent = events.find(
  (e: Event) => e.type === 'decision_point_needed' && e.event_id === decision_event_id
);
```

However, the scaffold flow emits `scaffold_decision_requested` events (not `decision_point_needed`), so the event lookup always failed.

## Solution
Updated `handleResolveDecisionPoint` in `packages/extension/src/extension.ts` to:

1. **Look for both event types**: First check for `decision_point_needed`, then check for `scaffold_decision_requested`

2. **Fallback to scaffold_id lookup**: If the event ID doesn't match, use the `scaffold_context.scaffold_id` from the message to find the event

3. **Infer decision type**: If `decision_type` is not set but the event type is `scaffold_decision_requested`, automatically set `decisionType = 'scaffold_approval'`

### Key Code Changes

```typescript
// Look for decision_point_needed OR scaffold_decision_requested events
let decisionEvent = events.find(
  (e: Event) => e.type === 'decision_point_needed' && e.event_id === decision_event_id
);

// Also check for scaffold_decision_requested (Step 35)
if (!decisionEvent) {
  decisionEvent = events.find(
    (e: Event) => e.type === 'scaffold_decision_requested' && e.event_id === decision_event_id
  );
}

// Extract scaffold context from message if present (sent by ScaffoldCard component)
const scaffoldContext = message.scaffold_context;

// If no event found by ID but we have scaffold context, find by scaffold_id
if (!decisionEvent && scaffoldContext?.scaffold_id) {
  decisionEvent = events.find(
    (e: Event) => e.type === 'scaffold_decision_requested' && 
                  e.payload?.scaffold_id === scaffoldContext.scaffold_id
  );
}

// ...

// Infer decision type from event type if not explicitly set
if (!decisionType && decisionEvent.type === 'scaffold_decision_requested') {
  decisionType = 'scaffold_approval';
}
```

## Files Changed
- `packages/extension/src/extension.ts` - Updated `handleResolveDecisionPoint` function

## Testing
1. Reload the extension
2. Enter "Create a new todo app" in MISSION mode
3. Wait for Scaffold Proposal card to appear
4. Click "Change Style" - should show info message
5. Click "Proceed" - should start scaffold process in terminal

## Result
The "Change Style" and "Proceed" buttons now work correctly, triggering the scaffold flow as intended.
