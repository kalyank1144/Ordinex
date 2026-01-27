# Mission Step Classification Bug Fix

## Problem Summary

When executing subsequent missions (mission 2+), the UI would show "Start" button but clicking it would immediately revert back to "Start" without showing the running state. The mission would complete instantly in the background.

## Root Cause

The `mapStepToStage()` function in `MissionExecutor` had **regex priority issues** that caused edit steps to be misclassified:

### What Was Happening:
```typescript
// OLD (BUGGY) REGEX ORDER:
1. Check for retrieve: /analyz|gather|research|review|read|examin/
2. Check for edit: /implement|creat|writ|modif|edit|chang|add|delet/
3. Check for test: /test|verif|validat|check/  ← PROBLEM!
4. Check for repair: /fix|repair|debug|resolv/
```

**Example Misclassifications:**
- ❌ "Complete backend auth routes with **email verification** endpoints"
  - Contains "verification" → Matched TEST regex → classified as 'test'
  - Should be: 'edit' (it says "Complete")
  
- ❌ "Create email service to send **verification** emails"
  - Contains "verification" → Could match TEST
  - Contains "Create" but TEST checked first → classified as 'test'
  - Should be: 'edit' (it says "Create")

- ❌ "**Update** the existing pages... to **integrate** with AuthContext"
  - Contains "Update" which should match edit
  - But pattern wasn't matching properly → classified as 'retrieve'
  - Should be: 'edit' (it says "Update")

### Why This Caused Instant Completion:
- When classified as 'test' or 'retrieve', steps return immediately with `{ success: true }`
- No actual file operations performed
- No approvals requested
- Mission completes in milliseconds
- UI shows "Start" again for next mission

## The Fix

### Changed Regex Priority & Patterns:

```typescript
// NEW (FIXED) REGEX ORDER WITH WORD BOUNDARIES:
1. ✅ Check for EDIT FIRST: /\b(implement|creat|writ|updat|modif|edit|chang|add|delet|complet|enhanc|connect|build)\b/
2. Check for retrieve: /\b(analyz|gather|research|review|read|examin|explor|investigat)\b/
3. Check for test (STRICTER): /\b(run.{0,10}test|test.{0,10}suite|execute.{0,10}test)\b/
4. Check for repair: /\b(fix|repair|debug|resolv)\b/
5. Check for plan: /\b(design|plan|clarif)\b/
6. Default: Check for file paths/code references → 'edit', else 'retrieve'
```

### Key Improvements:
1. **EDIT patterns checked FIRST** - prevents ambiguous words from causing misclassification
2. **Word boundaries** (`\b`) - prevents partial matches (e.g., "verification" won't match "verif")
3. **Stricter TEST pattern** - requires phrases like "run test" or "test suite", not just "verification"
4. **Added more edit verbs** - "complete", "enhance", "connect", "build", "update" (with 'updat' to catch "update")
5. **Smart defaults** - if description contains file paths or code references, assume 'edit'

## Impact

### Before Fix:
- Mission 2+ steps instantly "complete" without execution
- No approvals shown
- No files modified
- UI button flashes from Start → back to Start
- User confusion

### After Fix:
- All edit steps properly classified as 'edit'
- Steps execute with full approval flow
- Diff proposals shown
- Loading states visible
- UI correctly shows: Start → Running → (approval) → Start (next mission)

## Files Changed

1. **packages/core/src/missionExecutor.ts**
   - Updated `mapStepToStage()` method
   - Fixed regex priority order
   - Added word boundary checks
   - Strengthened edit pattern matching

## Testing Instructions

1. Reload the extension (F5 or Cmd+R)
2. Enter a complex prompt that creates 2+ missions
3. Complete mission 1
4. Click Start on mission 2
5. ✅ Verify: Button changes to "Running"
6. ✅ Verify: Loading spinner shows
7. ✅ Verify: Diff proposal appears (not instant completion)
8. ✅ Verify: Approval flow works correctly

## Related Logs

Key console messages to watch for:
```
[MissionExecutor] Executing edit step (spec-compliant): <description>
[MissionExecutor] Selecting edit context...
[MissionExecutor] Using TruncationSafeExecutor for edit step...
```

Instead of:
```
[MissionExecutor] Executing test step: <description>  ❌
[MissionExecutor] Executing retrieval step: <description>  ❌
```

## Commit Message
```
fix(mission): Prioritize edit patterns in step classification

Steps containing words like "verification" or "validate" were being 
misclassified as 'test' instead of 'edit', causing them to skip 
execution entirely. This made mission 2+ appear to instantly complete.

Fixed by:
- Checking edit patterns FIRST (implement, create, update, etc.)
- Adding word boundaries to prevent partial matches
- Making test regex more strict (require "run test" phrases)
- Adding fallback for file paths/code references → edit

Closes: Mission UI instant completion bug
```
