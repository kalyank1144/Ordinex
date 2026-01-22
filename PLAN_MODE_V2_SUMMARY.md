# PLAN Mode "Ground → Ask → Plan" v2 Implementation Summary

## Overview

Implemented a deterministic, non-blocking, persistent PLAN mode pipeline that:
1. **Grounds** prompts with lightweight repo context (<3s)
2. **Asks** grounded multiple-choice clarifications with real file evidence
3. **Plans** with focused LLM generation using selected context

## Files Changed

### Core Package
- **packages/core/src/planEnhancer.ts** (NEW) - Main pipeline implementation
  - `collectLightContext()` - <3s context collection with budget enforcement
  - `assessPromptClarity()` - Deterministic heuristic scoring (no LLM)
  - `generateClarificationOptions()` - Grounded options from anchor files
  - `shouldShowClarification()` - Decision logic based on clarity
  - `buildEnrichedPrompt()` - Template for focused plan generation
  - `buildFallbackPrompt()` - Template for skip/fallback scenario

- **packages/core/src/types.ts** - Added `clarification_presented` event type

- **packages/core/src/index.ts** - Exported new functions

- **packages/extension/src/extension.ts** - Updated PLAN mode message handlers
  - Added `ordinex:selectClarificationOption` handler
  - Added `ordinex:skipClarification` handler

### Webview Package
- **packages/webview/src/components/ClarificationCard.ts** (NEW)
  - Renders grounded multiple-choice card
  - State machine: idle → selecting → processing → complete
  - Click-safety prevents spam/duplicate selections

- **packages/webview/src/components/MissionFeed.ts** - Added card rendering
  - Import for `renderClarificationCard`
  - `clarification_presented` event config
  - Specialized rendering for clarification events

- **packages/webview/src/types.ts** - Added `clarification_presented` event type

- **packages/webview/src/index.ts** - Added CSS styles and JS handlers
  - Clarification card CSS styles
  - `handleClarificationSelect()` handler
  - `handleClarificationSkip()` handler

## Event Sequence (PLAN Mode)

```
intent_received
→ mode_set(PLAN)
→ context_collected { level:"light", stack, top_dirs, anchor_files, todo_count, ... }
→ prompt_assessed { clarity, clarity_score, intent, reasoning }
→ [if low/medium clarity] clarification_presented { options[], fallback_option_id }
→ [if low/medium clarity] execution_paused { reason:"awaiting_selection" }
→ [user selects] clarification_received { option_id, title }
→ tool_start { tool:"llm_plan" }
→ tool_end { tool:"llm_plan" }
→ plan_created
```

## Key Features Implemented

### ✅ Light Context Collection (<3s Budget)
```typescript
const CONTEXT_TIMEOUT_MS = 3000;
const TODO_SCAN_TIMEOUT_MS = 2000;
```
- Reads package.json for stack detection
- Scans file tree (depth=3, excludes node_modules/dist/etc.)
- Finds anchor files matching domain keywords
- Counts TODO/FIXME markers (with timeout)
- Sorts all arrays lexicographically for determinism

### ✅ Heuristic Prompt Assessment (No LLM)
```typescript
// Score starts at 50, adds/subtracts based on:
+20 if mentions file pattern (*.ts, *.tsx, etc.)
+15 if contains symbol name (PascalCase/camelCase ≥6 chars)
+10 if explicit scope words ("only", "just", "specifically")
+10 if prompt length > 50 chars
+5  if contains action verbs
-20 if vague question stems ("what should", "any ideas")
-15 if prompt length < 15 chars
-10 if vague words ("improve", "better", "something")
```

### ✅ Deterministic Option Generation
- Domain mappings: Authentication, Core Features, Settings, Navigation, State Management, Services
- Evidence from actual anchor files found in project
- Stable IDs: `{type}-{slug}` format (e.g., `area-authentication-users`)
- Ordering: AREA (alphabetical) → TODO → FALLBACK → GENERIC fillers
- Always 3-6 options

### ✅ Clarification Card UI
- Dynamic header: "Based on your project structure • X relevant files found"
- Options show title, description, and file evidence
- Skip link always available
- State machine prevents duplicate clicks
- Processing state shows spinner

### ✅ Persistence/Resume
- `clarification_presented` event contains all options
- On reload, card re-renders from stored event payload
- No re-running context collection or assessment

### ✅ Never Emits tool_start tool="llm_answer" in PLAN Mode
- PLAN mode always uses `tool="llm_plan"`
- ANSWER mode uses `tool="llm_answer"`

## Message Contracts

### Extension → Webview
- `ordinex:clarificationPresented` - Not needed (events already have this)
- `ordinex:eventsUpdate` - Contains all events including clarification_presented

### Webview → Extension
- `ordinex:selectClarificationOption { task_id, option_id }`
- `ordinex:skipClarification { task_id }`

## Manual Acceptance Tests

### LOW Clarity (Must Show Card)
- "plan features"
- "what should we build next?"
- "improve the app"

### MEDIUM Clarity (Depends on Context)
- "improve auth"
- "add features to workouts"

### HIGH Clarity (Skip Card)
- "Refactor WorkoutList.tsx to use React Query"
- "Add JWT auth to AuthContext.tsx"
- "Fix TypeScript error in src/components/Profile.tsx"

## Debug Logging

All logs prefixed with `[Ordinex:PlanEnhancement]`:
- Context collection results + duration
- Prompt assessment score + reasoning breakdown
- Generated options (ids, titles, evidence counts)
- Selection received (option_id)
- Warnings (minimal context, TODO scan timeout)

## Architecture Decisions

1. **Heuristic-only assessment** - No LLM call for clarity judgment (fast, deterministic)
2. **Budget-constrained collection** - Hard 3s limit prevents slow repos from blocking
3. **Evidence-grounded options** - Options linked to real files (not generic suggestions)
4. **State machine for clicks** - Prevents duplicate selections on slow network
5. **Event-sourced resume** - All state in events, survives reload
