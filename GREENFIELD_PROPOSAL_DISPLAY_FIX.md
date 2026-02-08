# Greenfield Proposal Display Fix

## Problem

When user entered "Creating a new fitness app with all the features", the scaffold proposal card showed:
- Recipe: TBD
- Design Pack: TBD
- Files: 0
- Directories: 0

This was because the `scaffoldFlow.ts` was emitting placeholder values instead of calling the actual `selectRecipe()` and `selectDesignPack()` functions that were already implemented.

## Root Cause

In `packages/core/src/scaffoldFlow.ts`, the `emitScaffoldProposalCreated()` method was using hardcoded "TBD" placeholders:

```typescript
// BEFORE:
const payload = {
  recipe: 'TBD',
  design_pack: 'TBD', 
  files_count: 0,
  directories_count: 0,
  ...
};
```

## Fix Applied

Modified `scaffoldFlow.ts` to:

1. **Call `selectRecipe()`** (Step 35.3) - Deterministically selects Next.js/Vite/Expo based on user prompt keywords
2. **Call `selectDesignPack()`** (Step 35.5) - Deterministically selects one of 12 design packs based on workspace/app name hash

### Now emits:
```typescript
{
  recipe: 'Next.js 14 (App Router)',
  recipe_id: 'nextjs_app_router',
  design_pack: 'Vibrant Neon',
  design_pack_id: 'vibrant-neon',
  design_tokens_summary: '#a855f7 | Space Grotesk',
  files_count: 24,
  directories_count: 8,
  ...
}
```

## Files Changed

1. **`packages/core/src/scaffoldFlow.ts`**
   - Added imports for `selectRecipe`, `selectDesignPack`, `detectDomainHint`, `formatTokensSummary`
   - Added `extractAppNameFromPrompt()` helper method
   - Updated `emitScaffoldProposalCreated()` to call real selectors

## Expected Result

After this fix, when user enters "Creating a new fitness app", the Scaffold Proposal Card will show:

```
┌────────────────────────────────────────┐
│ 📋 Scaffold Proposal                   │
│                                        │
│ Summary: Create a new Next.js 14       │
│ (App Router) project with Vibrant      │
│ Neon design.                           │
│                                        │
│ Recipe: Next.js 14 (App Router)        │
│ Design Pack: Vibrant Neon              │
│ Files: 24                              │
│ Directories: 8                         │
│                                        │
│ 🎨 Primary: #a855f7 | Font: Space Grotesk │
│                                        │
│ [Proceed]  [Cancel]  [Change Style]    │
└────────────────────────────────────────┘
```

## Remaining Work (Phase 2)

The scaffold_proposal_created event now has real values, but actual file creation still needs to be wired:

1. When user clicks "Proceed" on the proposal card
2. `extension.ts` → `handleResolveDecisionPoint()` should call `applyScaffoldPlan()`
3. This will actually create the 24 files on disk

**Status**: Phase 1 Complete ✅ (Proposal Display Fixed)
**Next**: Phase 2 (Wire `applyScaffoldPlan()` after Proceed click)
