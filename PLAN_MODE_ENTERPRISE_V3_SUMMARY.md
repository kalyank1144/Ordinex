# PLAN Mode Enterprise-Ready V3 Implementation

## Overview

Upgraded PLAN mode to be enterprise-ready with universal, deterministic, and resumable features. Removed all app-specific domain patterns in favor of universal role-based patterns.

## Key Changes

### 1. Universal Role Patterns (packages/core/src/planEnhancer.ts)

**Removed app-specific domain mappings:**
- ❌ "Authentication & Users" (Auth, Login, User, Account...)
- ❌ "Core Features" (Workout, Exercise, Activity, Task...)
- ❌ "User Settings" (Profile, Settings, Preferences...)

**Added universal role patterns:**
- ✅ `routing` - Route, router, navigation, nav, page, pages
- ✅ `state` - Store, state, context, provider, redux, zustand, recoil, mobx
- ✅ `api` - API, client, service, sdk, fetch, graphql, trpc
- ✅ `model` - Model, schema, entity, dto, types, interface, domain
- ✅ `backend` - Controller, handler, middleware, resolver, endpoint
- ✅ `config` - Config, eslint, tsconfig, vite, webpack, jest, vitest
- ✅ `test` - Test, spec, __tests__, e2e, cypress, playwright
- ✅ `docs` - Readme, docs, documentation, changelog

### 2. Tunable Prompt Assessment Weights

Added configurable weights for prompt clarity scoring:

```typescript
export interface PromptAssessmentWeights {
  filenameMention: number;     // +20
  symbolLikeToken: number;     // +15
  explicitScopeWords: number;  // +10
  lengthOver50: number;        // +10
  actionVerb: number;          // +5
  repoTokenMatch: number;      // +5 (max 15)
  vagueQuestionStems: number;  // -20
  veryShortPrompt: number;     // -15
  vagueWords: number;          // -10
  exploratoryOnly: number;     // -10
}
```

### 3. Option Generation Using Universal Roles

Options are now generated based on:
- **Role matches**: Files matching universal role patterns (routing, state, api, model, etc.)
- **SMALL_REPO rule**: If `files_scanned <= 200` or `(files_scanned <= 800 AND top_dirs.length <= 5)`, allow 1 file as evidence; otherwise require 2+
- **ID format**: `role-{role_name}` (e.g., `role-routing`, `role-api`, `role-state`)

### 4. ClarificationCard UI Enhancements

Added new actions to the clarification card:
- **Skip and suggest ideas**: Generates fallback plan immediately
- **Edit prompt**: Allows user to edit and re-submit prompt
- **Cancel**: Dismisses the card without generating a plan

New message contracts:
- `ordinex:editClarificationPrompt { task_id }`
- `ordinex:cancelClarification { task_id }`

### 5. Monorepo Awareness (Prepared)

Added constants for monorepo detection:
```typescript
const MONOREPO_ROOTS = ['apps', 'packages', 'services', 'libs', 'modules', 'projects'];
```

## Files Changed

1. **packages/core/src/planEnhancer.ts**
   - Replaced app-specific domain mappings with universal role patterns
   - Added `PromptAssessmentWeights` interface and defaults
   - Updated `findAnchorFiles()` to use universal role keywords
   - Updated `assessPromptClarity()` to use role keywords
   - Updated `generateClarificationOptions()` to create role-based options
   - Added `SMALL_REPO` rule for evidence threshold

2. **packages/webview/src/components/ClarificationCard.ts**
   - Added "Edit prompt" button
   - Added "Cancel" button
   - Added CSS styles for new action buttons
   - Added `handleClarificationEdit()` handler
   - Added `handleClarificationCancel()` handler

## Event Sequence (Authoritative)

PLAN mode follows this exact order:

```
intent_received
→ mode_set(PLAN)
→ context_collected { level:"light", ... }
→ prompt_assessed { clarity, clarity_score, intent, reasoning }
→ (clarification_presented + execution_paused) OR skip_to_llm_plan
→ [if clarification] clarification_received
→ tool_start/tool_end { tool:"llm_plan" }
→ plan_created
```

## Rules Enforced

- ✅ PLAN mode NEVER emits `tool_start/tool_end` for `tool="llm_answer"`
- ✅ Vague PLAN prompts show grounded multiple-choice card
- ✅ "Skip" generates a useful plan immediately (no pause)
- ✅ Clarification card has: Select, Skip, Edit prompt, Cancel
- ✅ Deterministic IDs + deterministic ordering
- ✅ Survives VS Code restart (card re-renders from events)
- ✅ Click safety prevents duplicate selections

## Build Status

✅ All packages compile successfully
