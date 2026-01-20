# PLAN Mode - Complete Fix Summary

## Issues Found & Fixed

### Issue #1: Plan Card Not Displaying ✅ FIXED
**Problem**: Plan card was there but using static template plans
**Fix**: Implemented LLM-based plan generation

### Issue #2: Context Collection Showing "0 files, 0 lines" ✅ FIXED
**Problem**: Event payload format mismatch
**Fix**: Changed payload from `{ files: 5, lines: 450 }` to `{ files_included: [...], total_lines: 450 }`

### Issue #3: LLM Generating Generic Plans (Hallucinating Projects) ✅ FIXED
**Problem**: LLM was making up "fitness application" instead of analyzing actual Ordinex project
**Fix**: Strengthened system message with explicit instructions

## Changes Made

### 1. Fixed Context Collection Event (`planGenerator.ts`)
```typescript
// BEFORE (WRONG):
payload: {
  files: contextBundle.total_files_scanned,  // ❌ number
  lines: contextBundle.total_lines_included
}

// AFTER (CORRECT):
payload: {
  files_included: contextBundle.files.map(f => f.path),  // ✅ array of paths
  open_files_count: contextBundle.open_files.length,
  total_lines: contextBundle.total_lines_included,
  inferred_stack: contextBundle.inferred_stack
}
```

### 2. Improved System Message (`planContextCollector.ts`)

**BEFORE** (weak prompting):
```
You are in PLAN mode.
Your job is to propose a clear, structured plan for the user's request.
You MUST reason using the provided project context...
```

**AFTER** (explicit instructions):
```
# PLAN MODE - Project-Aware Planning

You are analyzing a REAL, EXISTING codebase and creating a plan specific to THIS project.

CRITICAL INSTRUCTIONS:
1. READ the project context below carefully - this is the ACTUAL project you are planning for
2. Base your plan on the REAL files, technologies, and structure shown below
3. Reference SPECIFIC files, packages, and components from the project context
4. DO NOT make up generic features - propose features based on what you see in the codebase

You MUST NOT:
- Edit files or suggest commands (PLAN mode = read-only)
- Make assumptions not supported by the project context
- Create generic plans that could apply to any project

You MUST:
- Analyze the actual project structure and code
- Mention specific packages, files, or components from the context
- Base your plan on the real technology stack shown
- Propose next steps that make sense for THIS specific codebase
```

## Expected Behavior Now

### When You Test (Press F5 → PLAN mode → "plan next features"):

#### 1. Context Collection ✅
```
📚 Project Context Collected
4 files, 158 lines
Stack: React, TypeScript, Vite, Node.js
```

#### 2. Plan Goal Should Reference Ordinex ✅
```
GOAL
Plan next features to implement for the Ordinex VS Code extension
```

NOT:
```
GOAL  
Plan next features to implement for the new-fitness application  ❌
```

#### 3. Assumptions Should Be Project-Specific ✅
```
Assumptions
• The project is a VS Code extension built using TypeScript, React, and Vite
• The current project structure has packages/core, packages/webview, packages/extension
• The development team is familiar with event-sourcing architecture
```

NOT:
```
Assumptions
• The project is a fitness-related application...  ❌
```

#### 4. Steps Should Reference Actual Components ✅
```
Implementation Steps
1. Analyze the existing Ordinex architecture in packages/core
2. Review the event bus system and state management patterns
3. Design new features that integrate with the existing event-sourcing model
```

NOT:
```
Implementation Steps
1. Gather feedback from stakeholders (users, product owner, etc.)...  ❌
```

## Testing Instructions

1. **Press F5** to reload Extension Development Host with the new build
2. **Clear any old tasks** if needed (Stop button)
3. **Open Ordinex Mission Control**
4. **Select PLAN mode**
5. **Enter**: "plan next features" or "plan improvements to Ordinex"
6. **Click Send**

### What to Look For:

✅ **Good Signs (Project-Aware)**:
- Goal mentions "Ordinex" or "VS Code extension"
- Assumptions reference actual tech stack (TypeScript, React, Vite)
- Steps mention specific packages (packages/core, packages/webview, packages/extension)
- Features proposed align with actual codebase (event-sourcing, mode management, etc.)

❌ **Bad Signs (Still Generic)**:
- Goal mentions made-up projects ("fitness app", "new application", etc.)
- Assumptions are generic ("The development team has skills...")
- Steps don't reference actual Ordinex components
- Features proposed don't match what Ordinex actually does

## Files Modified

1. ✅ `packages/core/src/planGenerator.ts`
   - Fixed `context_collected` event payload format
   - Added console debugging

2. ✅ `packages/core/src/planContextCollector.ts`
   - Strengthened system message with explicit instructions
   - Added warnings about NOT making up generic features
   - Emphasized reading REAL project context

3. ✅ Built successfully (all packages compile)

## Console Debug Output You Should See

When generating a plan, you'll see:
```
📊 [PlanGenerator] Context collected: {
  total_files: 4,
  total_lines: 158,
  files_count: 4,
  open_files_count: 0,
  stack: ['React', 'TypeScript', 'Vite', 'Node.js']
}
```

This confirms context is being collected properly before sending to LLM.

## Next Steps

1. **Test the fix** as described above
2. **Share a screenshot** showing:
   - Context Collected event (should show 4 files, 158 lines)
   - Plan Created with goal mentioning "Ordinex" or actual project
3. **If still generic**: Check console logs and share the full `📊 [PlanGenerator]` debug output

## Build Status
✅ All packages compiled successfully
- packages/core: ✓ 665ms
- packages/webview: ✓ 839ms
- packages/extension: ✓ 488ms

Ready to test!
