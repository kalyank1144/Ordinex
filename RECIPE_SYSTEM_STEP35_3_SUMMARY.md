# Step 35.3 — Recipe System V1 (Next/Vite/Expo)

## Summary

Step 35.3 implements a **deterministic recipe system** for scaffold proposals. Given a user prompt like "Create a fitness tracking web app", the system:

1. **Selects a recipe** using keyword matching (no LLM)
2. **Generates a file plan** with all files/dirs to create
3. **Generates a command plan** with install/build/lint/dev commands
4. **Produces a proposal** (no files written yet)

---

## Files Created

| File | Purpose |
|------|---------|
| `packages/core/src/scaffold/recipeTypes.ts` | Type definitions for recipes, file plans, commands |
| `packages/core/src/scaffold/recipeSelector.ts` | Deterministic recipe selection logic |
| `packages/core/src/scaffold/recipeRegistry.ts` | Recipe registry and helpers |
| `packages/core/src/scaffold/recipes/nextjsAppRouter.ts` | Next.js 14 App Router recipe |
| `packages/core/src/scaffold/recipes/viteReact.ts` | Vite + React SPA recipe |
| `packages/core/src/scaffold/recipes/expo.ts` | Expo (React Native) recipe |

---

## Supported Recipes

| Recipe ID | Name | Use Case |
|-----------|------|----------|
| `nextjs_app_router` | Next.js (App Router) | Full-stack web apps with SSR |
| `vite_react` | Vite + React | Lightweight SPAs, no SSR |
| `expo` | Expo (React Native) | Mobile apps (iOS/Android) |

---

## Deterministic Selection Rules

```
1. Explicit mention → use that recipe
   - "nextjs", "next.js", "app router", "ssr" → nextjs_app_router
   - "vite", "spa", "no ssr" → vite_react
   - "expo", "react native", "mobile", "ios", "android" → expo

2. Platform-based
   - Mobile indicators → expo

3. Preference-based
   - "simple web" + "no ssr" → vite_react

4. Default
   - Web indicators or unknown → nextjs_app_router
```

---

## Package Manager Detection

```
pnpm-lock.yaml or pnpm-workspace.yaml → pnpm
yarn.lock → yarn
package-lock.json or default → npm
```

---

## File Counts per Recipe

| Recipe | Files | Directories |
|--------|-------|-------------|
| Next.js App Router | ~10 | 2 |
| Vite + React | ~14 | 2 |
| Expo | ~7 | 1 |

---

## Command Plan Structure

Commands have a `when` field:
- `post_apply`: Run automatically after files created (install, lint, build)
- `user_explicit`: User must trigger manually (dev server)

Example Next.js commands:
```
- Install dependencies (pnpm install) → post_apply
- Run linter (pnpm run lint) → post_apply  
- Build project (pnpm run build) → post_apply
- Start dev server (pnpm run dev) → user_explicit
```

---

## Usage Example

```typescript
import { selectRecipe, detectPackageManager } from './scaffold/recipeSelector';
import { buildRecipePlan, buildFileTreePreview } from './scaffold/recipeRegistry';

// 1. Select recipe
const selection = selectRecipe("Create a fitness tracking web app");
// → { recipe_id: 'nextjs_app_router', reason: 'default_web', ... }

// 2. Detect package manager
const pm = detectPackageManager(['pnpm-lock.yaml', 'package.json']);
// → 'pnpm'

// 3. Build recipe plan
const plan = buildRecipePlan({
  scaffold_id: 'scaffold-123',
  workspace_root: '/workspace',
  target_directory: '/workspace/fitness-app',
  app_name: 'fitness-app',
  user_prompt: 'Create a fitness tracking web app',
  package_manager: pm,
});

// 4. Get preview
const preview = buildFileTreePreview(plan.files);
```

---

## Critical Rules Followed

✅ No files written in 35.3 (proposal only)  
✅ No terminal commands executed  
✅ Recipe selection is fully deterministic (no LLM)  
✅ Max 2 clarification questions (use decision points instead)  
✅ Replay-safe (proposal derivable from stored event payload)  

---

## Not Implemented (Deferred)

Per spec, these items are **explicitly NOT done in 35.3**:
- Applying scaffold to disk (35.4)
- Design packs or preview images (35.5)
- Reference screenshot/URL extraction (later)
- New event types in types.ts (foundation complete, integration in 35.4)

---

## Stop Condition Met

For prompt: "Create a fitness tracking web app"
- ✅ Preflight passes (from 35.2)
- ✅ Recipe selected deterministically (Next.js as default_web)
- ✅ File plan generated (~10 files, 2 dirs)
- ✅ Command plan generated (install, lint, build, dev)
- ✅ No file writes, no terminal execution

---

## Next Steps (35.4)

Step 35.4 will:
1. Apply the scaffold to disk (create files/dirs)
2. Run post_apply commands (install, lint, build)
3. Emit `scaffold_applied` and `scaffold_completed` events
