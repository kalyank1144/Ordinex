# Greenfield Flow Fix Summary

## Problem Identified

Looking at the screenshot, the current greenfield scaffolding flow stops after:
1. User enters "create new todo app" intent
2. Recipe is selected (Next.js App Router)
3. Design pack is selected (Gradient Sunset)
4. Terminal runs `npx create-next-app@latest my-app`

**THE GAP:** After the CLI command runs, nothing happens. The design pack is never applied to the project, and the NextStepsCard (which should show "What's next?") is never displayed.

## Root Cause

In `packages/extension/src/extension.ts`, the `handleResolveDecisionPoint` function:
```typescript
terminal.sendText(createCmd);  // ← Fire and forget! Flow ends here.
```

The code just sends the command to the terminal and doesn't:
1. Poll for project completion (wait for package.json to exist)
2. Apply the selected design pack tokens to globals.css
3. Emit `next_steps_shown` event to trigger NextStepsCard UI

## Solution Implemented

### 1. Created `postScaffoldOrchestrator.ts`

**Path:** `packages/core/src/scaffold/postScaffoldOrchestrator.ts`

This module handles the complete post-scaffold flow:
- **Polls** for project completion (checks for package.json every 2 seconds, up to 3 minutes)
- **Applies design pack** by modifying globals.css with the selected tokens
- **Emits events** for UI updates:
  - `scaffold_progress` - Progress status updates
  - `design_pack_applied` - When design tokens are applied
  - `next_steps_shown` - Triggers NextStepsCard with suggestions

### 2. Updated Core Exports

**Path:** `packages/core/src/index.ts`

Added exports for:
- `startPostScaffoldOrchestration` - Main orchestrator function
- `PostScaffoldContext` / `PostScaffoldResult` types
- Design pack utilities (`getDesignPackById`, `DESIGN_PACKS`, etc.)
- Next steps utilities (`getNextStepsForRecipe`, etc.)

## Remaining Wiring Needed

In `packages/extension/src/extension.ts`, after `terminal.sendText(createCmd)`, add:

```typescript
import { startPostScaffoldOrchestration } from '@ordinex/core';

// After terminal.sendText(createCmd):
terminal.sendText(createCmd);

// START POST-SCAFFOLD ORCHESTRATION (async, non-blocking)
const postScaffoldCtx: PostScaffoldContext = {
  taskId: taskId,
  scaffoldId: scaffoldId,
  targetDirectory: scaffoldWorkspaceRoot,
  appName: 'my-app', // Extracted from createCmd
  recipeId: recipeSelection.recipe_id as RecipeId,
  designPackId: designPackId || 'minimal-light',
  eventBus: eventBus,
  mode: currentMode,
};

// Fire and forget - orchestrator handles polling and event emission
startPostScaffoldOrchestration(postScaffoldCtx).then((result) => {
  console.log('[handleResolveDecisionPoint] Post-scaffold complete:', result);
}).catch((error) => {
  console.error('[handleResolveDecisionPoint] Post-scaffold error:', error);
});
```

## Expected Flow After Fix

1. User: "create new todo app"
2. System: Shows recipe picker (Next.js, Vite, Expo)
3. User: Selects Next.js
4. System: Shows design pack picker
5. User: Selects "Gradient Sunset"
6. System: Runs `npx create-next-app@latest my-app` in terminal
7. **NEW:** System polls for project completion
8. **NEW:** System applies Gradient Sunset tokens to `my-app/app/globals.css`
9. **NEW:** System emits `next_steps_shown` event
10. **NEW:** NextStepsCard appears with:
    - 🚀 Start dev server
    - Add features (auth, database, etc.)
    - Run lint/tests

## Files Changed

1. **Created:** `packages/core/src/scaffold/postScaffoldOrchestrator.ts`
   - Complete post-scaffold orchestration logic

2. **Modified:** `packages/core/src/index.ts`
   - Added exports for new module and related utilities

3. **To Wire:** `packages/extension/src/extension.ts`
   - Add call to `startPostScaffoldOrchestration` after terminal.sendText

## Testing

After wiring:
1. Create new greenfield project
2. Select recipe and design pack
3. Wait for CLI to complete
4. Verify:
   - globals.css has design pack tokens
   - NextStepsCard appears in Mission Feed
   - Can click "Start dev server" to continue

## Why Design Pack Selection Matters Now

Previously the design pack selection was cosmetic - it showed in UI but wasn't applied.
With this fix, selecting "Gradient Sunset" will:
- Set `--primary: #f97316` (orange)
- Set `--font-heading: "Montserrat"` 
- Apply warm gradient colors throughout the app
- Make the scaffolded project visually distinct from default Next.js
