# Greenfield Routing Fix - Complete Solution

## Problem Summary

When user enters "Creating a new fitness app with all the features", the system was:
1. **NOT** routing to scaffold flow
2. Instead routing to QUICK_ACTION → Command execution
3. Showing "Command Proposed: npm run dev" 
4. No scaffolding, no files created, just an empty terminal command

## Root Cause Analysis

The issue was in `intentAnalyzer.ts` → `detectScope()` function.

### The Bug

`detectScope()` had its own greenfield detection using **exact phrase matching**:

```typescript
// OLD CODE (BROKEN):
if (ACTION_PATTERNS.greenFieldPhrases.some(p => normalizedPrompt.includes(p))) {
  return { scope: 'large', ... }; // Would route to PLAN behavior
}
```

Where `ACTION_PATTERNS.greenFieldPhrases` contained:
- `'create a new'` - **NOT** `'creating a new'`
- `'new app'` - **NOT** `'new fitness app'`

So for "Creating a new fitness app":
- `"creating a new fitness app".includes("create a new")` → **FALSE** (different verb form)
- `"creating a new fitness app".includes("new app")` → **FALSE** (words not adjacent)

Since greenfield check failed, `detectScope()` returned `scope: 'trivial'` → `behavior: QUICK_ACTION`.

### Meanwhile, `greenfieldDetector.ts` Worked Correctly!

The centralized `detectGreenfieldIntent()` function uses proper regex:

```typescript
/\b(creat(e|ing)|build(ing)?|...)\b.*\b(app|application|...)\b/i
```

This correctly matches "creating...app" and returns `confidence: 0.9`.

But `detectScope()` wasn't using it!

## The Fix

Modified `detectScope()` in `intentAnalyzer.ts` to use the centralized greenfield detector:

```typescript
// NEW CODE (FIXED):
const greenfieldResult = detectGreenfieldIntent(prompt);
if (greenfieldResult.isMatch && greenfieldResult.confidence >= 0.65) {
  reasons.push(`greenfield project detected: ${greenfieldResult.reason}`);
  return {
    scope: 'large',
    confidence: 0.95,
    ...
  };
}
```

## Flow After Fix

1. User enters: "Creating a new fitness app with all the features"
2. `analyzeIntent()` is called
3. Step 5: `detectScope()` calls `detectGreenfieldIntent()`
4. `detectGreenfieldIntent()` returns `{ isMatch: true, confidence: 0.9, reason: "Strong greenfield signal: creation verb + project noun" }`
5. `detectScope()` returns `{ scope: 'large', ... }`
6. `analyzeIntent()` returns `{ behavior: 'PLAN', derived_mode: 'PLAN', ... }`
7. `analyzeIntentWithFlow()` detects `flow_kind: 'scaffold'`
8. `extension.ts` routes to `handleScaffoldFlow()`
9. ScaffoldFlowCoordinator emits proposal with recipe/design pack
10. User sees Scaffold Proposal Card with "Proceed" button

## Files Changed

1. **`packages/core/src/intentAnalyzer.ts`**
   - Modified `detectScope()` to use centralized `detectGreenfieldIntent()` instead of phrase matching

## Test Cases

| Prompt | Before Fix | After Fix |
|--------|-----------|-----------|
| "Creating a new fitness app" | QUICK_ACTION → Command | PLAN → Scaffold |
| "Building a new dashboard" | QUICK_ACTION → Command | PLAN → Scaffold |
| "I want to make a todo app" | QUICK_ACTION → Command | PLAN → Scaffold |
| "Create a new project from scratch" | PLAN (phrase match) | PLAN → Scaffold |

## Architecture Lesson

**Single Source of Truth**: The codebase had greenfield detection in multiple places with inconsistent implementations:
- `greenfieldDetector.ts` - Regex-based, handles verb forms ✓
- `intentAnalyzer.ts` - Phrase matching, missed verb forms ✗
- `userCommandDetector.ts` - Calls greenfieldDetector ✓

This fix ensures `detectScope()` now uses the centralized detector, making greenfield detection consistent throughout the codebase.

## Status

✅ **COMPLETE** - Greenfield routing now works correctly for verb forms like "Creating", "Building", "Making"

---

# Part 2: Scaffold Execution Fix

## Problem (from user feedback)

After the routing fix, the scaffold flow was being triggered correctly, but clicking "Proceed" didn't create any files - it just showed CLI commands in the UI.

## Root Cause

In `extension.ts` → `handleResolveDecisionPoint()`, after scaffold approval (`ready_for_step_35_2`):
1. Selected a recipe ✓
2. Emitted events ✓
3. **Just showed an info message** asking user to open terminal manually ✗

It didn't actually RUN the scaffold command!

## The Fix

Modified the scaffold approval handler to **automatically execute** the scaffold command in VS Code terminal:

```typescript
// BEFORE (broken):
vscode.window.showInformationMessage(
  'Scaffold ready! Open terminal to create project.',
  'Open Terminal'
).then(action => {
  // Only runs if user clicks "Open Terminal"
});

// AFTER (fixed):
// Emit scaffold_apply_started event
await this.emitEvent({ type: 'scaffold_apply_started', ... });

// Create terminal and RUN automatically
const terminal = vscode.window.createTerminal({
  name: `Scaffold: ${recipeName}`,
  cwd: workspaceRoot,
});
terminal.show(true);
terminal.sendText(createCmd); // e.g., "npx create-next-app@latest my-app"

// Emit scaffold_applied event
await this.emitEvent({ type: 'scaffold_applied', ... });
```

## Files Changed

1. **`packages/core/src/intentAnalyzer.ts`** - Fixed `detectScope()` to use centralized greenfield detector
2. **`packages/extension/src/extension.ts`** - Fixed scaffold approval to auto-run command in terminal

## Expected Behavior After Fix

1. User enters: "Create a new fitness app"
2. Greenfield detected → SCAFFOLD flow triggered ✓
3. Scaffold Proposal card shown ✓
4. User clicks "Proceed" ✓
5. **Terminal opens and runs `npx create-next-app@latest my-app` automatically** ✓
6. User follows interactive prompts in terminal to complete setup ✓

## Note on MVP Features

The scaffold uses official framework CLI tools (create-next-app, create-vite, create-expo-app) which:
- Create all the necessary files
- Set up proper project structure
- Install dependencies
- Handle framework-specific configuration

For a "fitness app", after the scaffold creates the base Next.js/Vite/Expo project, the user can continue with additional prompts to add fitness-specific features.
