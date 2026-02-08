# Post-Scaffold Orchestration Fix

## Problem

When creating a new greenfield project (e.g., "create new todo app"), the flow was:

1. ✅ User enters intent
2. ✅ Design pack selection displayed
3. ✅ Scaffold proposal approved
4. ✅ Terminal runs `npx create-next-app` 
5. ❌ **FLOW STOPS HERE** - After scaffolding, nothing else happens

The design pack was selected but never applied. No "next steps" were shown to implement MVP features.

## Root Cause

The `postScaffoldOrchestrator.ts` module was created to handle post-scaffold operations, but had TypeScript type incompatibilities:

1. **EventBus Type Mismatch**: The orchestrator used Node.js `EventEmitter.emit('event', data)` pattern, but Ordinex's `EventBus` uses `publish(event: Event)` method.

## Solution

### 1. Fixed EventPublisher Interface

Changed from Node.js EventEmitter to a simple interface compatible with Ordinex EventBus:

```typescript
// Before (incompatible with Ordinex EventBus)
import { EventEmitter } from 'events';
interface PostScaffoldContext {
  eventBus: EventEmitter;
}

// After (compatible with Ordinex EventBus)
interface EventPublisher {
  publish(event: Event): void | Promise<void>;
}
interface PostScaffoldContext {
  eventBus: EventPublisher;
}
```

### 2. Changed All emit() Calls to publish()

```typescript
// Before
ctx.eventBus.emit('event', event);

// After
ctx.eventBus.publish(event);
```

## What Post-Scaffold Orchestration Does

After `terminal.sendText(createCmd)` runs the scaffold command, the orchestrator:

1. **Polls for Project Completion** - Waits for `package.json` to appear (up to 3 minutes)
2. **Applies Design Pack** - Modifies CSS files with design tokens (colors, fonts)
3. **Emits Next Steps** - Shows UI with actionable next steps for MVP implementation

### Events Emitted

| Event Type | Purpose |
|------------|---------|
| `scaffold_progress` | Shows "Creating Project..." status |
| `design_pack_applied` | Confirms CSS modifications |
| `next_steps_shown` | Triggers NextStepsCard in UI |
| `scaffold_final_complete` | Marks orchestration complete |

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/scaffold/postScaffoldOrchestrator.ts` | Fixed EventPublisher interface, changed emit→publish |
| `packages/core/src/types.ts` | Added `scaffold_progress`, `design_pack_applied`, `scaffold_final_complete` to EventType and CANONICAL_EVENT_TYPES |

## Expected Flow After Fix

1. User enters "create new todo app"
2. Design pack selection displayed  
3. Scaffold proposal approved
4. Terminal runs `npx create-next-app`
5. **NEW**: Orchestrator polls for package.json
6. **NEW**: Design pack applied to globals.css
7. **NEW**: Next Steps card shown with MVP features

## Testing

1. Enter greenfield intent: "create new todo app"
2. Select a design style  
3. Approve scaffold proposal
4. Complete terminal prompts
5. Verify:
   - Design pack CSS is applied to project
   - NextStepsCard appears with implementation options

## Summary

Fixed TypeScript type mismatch that prevented the post-scaffold orchestrator from emitting events. The Ordinex EventBus uses `publish(event)` not `emit('event', data)`, so the interface and all calls were updated accordingly.
