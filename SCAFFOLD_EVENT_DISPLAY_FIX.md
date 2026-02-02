# Scaffold Event Display Fix

## Problem

After clicking "Proceed" on a scaffold proposal, the following events were appearing as "Unknown event type" in the Mission Control UI:

1. `scaffold_progress` - Shows progress during project creation
2. `design_pack_applied` - Shows when design styling is applied
3. `next_steps_shown` - Shows recommended next steps for the user
4. `scaffold_final_complete` - Shows final completion status

These events were being emitted by the backend (PostScaffoldOrchestrator) but the webview's ScaffoldCard component didn't have renderers for them.

## Root Cause

The `isScaffoldEvent()` function and the ScaffoldCard `render()` switch statement didn't include the post-scaffold orchestration event types:
- `scaffold_progress`
- `design_pack_applied`
- `next_steps_shown`
- `scaffold_final_complete`

## Solution

### 1. Added Render Methods in ScaffoldCard.ts

Added four new render methods to handle the missing event types:

```typescript
// renderProgress() - Shows progress bar and message during project creation
private renderProgress(payload: Record<string, any>): string {
  const phase = payload.phase || '';
  const message = payload.message || 'Creating project...';
  const progress = payload.progress || 0;
  // Returns styled progress card with optional progress bar
}

// renderDesignPackApplied() - Shows which design pack was applied
private renderDesignPackApplied(payload: Record<string, any>): string {
  const designPack = payload.design_pack || 'Custom';
  const modifiedFiles = payload.modified_files || [];
  // Returns styled card showing design styling was applied
}

// renderNextStepsShown() - Shows recommended actions for the user
private renderNextStepsShown(payload: Record<string, any>): string {
  const steps = payload.steps || [];
  const projectPath = payload.project_path || '';
  // Returns numbered list of next steps
}

// renderFinalComplete() - Shows final completion status
private renderFinalComplete(payload: Record<string, any>): string {
  const success = payload.success !== false;
  const projectPath = payload.project_path || '';
  // Returns celebratory completion card with hints
}
```

### 2. Updated Event Type Switch Statement

Added cases for the new event types in the `render()` method:

```typescript
case 'scaffold_progress':
  body = this.renderProgress(payload);
  break;
case 'design_pack_applied':
  body = this.renderDesignPackApplied(payload);
  break;
case 'next_steps_shown':
  body = this.renderNextStepsShown(payload);
  break;
case 'scaffold_final_complete':
  body = this.renderFinalComplete(payload);
  break;
```

### 3. Updated isScaffoldEvent() Function

Added the new event types to the list of recognized scaffold events:

```typescript
export function isScaffoldEvent(eventType: string): boolean {
  return [
    'scaffold_started',
    'scaffold_preflight_started',
    // ... existing events ...
    'scaffold_style_selected',
    // Post-scaffold orchestration events
    'scaffold_progress',
    'design_pack_applied',
    'next_steps_shown',
    'scaffold_final_complete'
  ].includes(eventType);
}
```

### 4. Added CSS Styles

Added comprehensive CSS styles for the new card types:

- `.progress-section` - Progress bar container and message
- `.design-applied-section` - Design pack application card
- `.next-steps-section` - Numbered list of next steps
- `.final-complete-section` - Celebratory completion card

## Files Changed

1. `packages/webview/src/components/ScaffoldCard.ts`:
   - Added `renderProgress()` method
   - Added `renderDesignPackApplied()` method
   - Added `renderNextStepsShown()` method
   - Added `renderFinalComplete()` method
   - Updated render() switch statement
   - Updated `isScaffoldEvent()` to include new event types
   - Added CSS styles for new components

## Testing

After reload, the scaffold flow should now display:

1. ✅ **Scaffold Progress** - "Creating project..." with progress indicator
2. ✅ **Design Pack Applied** - Shows which design pack styling was applied
3. ✅ **Next Steps** - Shows numbered list of recommended actions
4. ✅ **Project Ready** - Shows celebratory completion with hints

## Event Flow

```
User clicks Proceed
  → scaffold_decision_resolved
  → scaffold_apply_started
  → scaffold_progress (one or more)
  → scaffold_applied
  → design_pack_applied
  → next_steps_shown
  → scaffold_final_complete
```

All events now render properly instead of showing "Unknown event type".
