# Greenfield Scaffold Flow - End-to-End Wiring Fix

## Problem

When users clicked "Proceed" on the scaffold approval card, the system only showed:
> "Scaffold approved! Project creation coming in Step 35.4."

This was a placeholder message that didn't actually do anything useful.

## Solution

Wired up the complete scaffold flow so that when users approve a scaffold:

1. **Recipe Selection**: The system now calls `selectRecipe()` to determine the appropriate framework (Next.js, Vite+React, or Expo) based on the user's prompt
2. **scaffold_completed Event**: Emits a proper `scaffold_completed` event with:
   - `recipe_id`: The detected recipe (e.g., 'nextjs_app_router')
   - `status`: 'success'
   - `next_steps`: Array of CLI commands to create the project
3. **User Feedback**: Shows a helpful VS Code info message with the selected framework name
4. **Terminal Integration**: Opens VS Code terminal with the appropriate create command pre-filled

## Changes Made

### 1. packages/core/src/index.ts
Added exports for scaffold recipe/apply modules:
```typescript
// Step 35.3: Recipe Selection
export { selectRecipe, ... } from './scaffold/recipeSelector';

// Step 35.3: Recipe Registry  
export { buildRecipePlan, ... } from './scaffold/recipeRegistry';

// Step 35.4: Scaffold Apply
export { applyScaffoldPlan } from './scaffold/scaffoldApplyExecutor';

// Step 35.3: Recipe Types
export type { RecipeId, RecipeContext, ... } from './scaffold/recipeTypes';
```

### 2. packages/extension/src/extension.ts
Updated scaffold approval handler to:
- Import `selectRecipe` from core
- Call `selectRecipe(userPrompt)` to detect framework
- Emit `scaffold_completed` event with proper payload
- Show user-friendly success message
- Offer "Open Terminal" action with pre-filled create command

## User Experience Flow

1. User types: "create a new todo app with React"
2. System detects greenfield request → shows scaffold proposal card
3. User clicks "Proceed"
4. System:
   - Selects recipe based on prompt (e.g., vite_react for simple React)
   - Emits `scaffold_completed` event
   - Shows: "🎉 Vite + React scaffold ready! Open terminal to create project."
   - If user clicks "Open Terminal": opens terminal with `npm create vite@latest my-app -- --template react-ts`

## Recipe Mapping

| User Intent | Recipe ID | Create Command |
|-------------|-----------|----------------|
| "Next.js", "SSR", "full-stack" | `nextjs_app_router` | `npx create-next-app@latest my-app` |
| "React", "SPA", "simple" | `vite_react` | `npm create vite@latest my-app -- --template react-ts` |
| "mobile", "iOS", "Android" | `expo` | `npx create-expo-app my-app` |

## Files Changed

1. `packages/core/src/index.ts` - Added scaffold module exports
2. `packages/extension/src/extension.ts` - Updated scaffold approval handler

## Build Status

✅ All packages build successfully
