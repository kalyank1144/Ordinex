# Step 36 — Enhance Existing Project Flow (V1) - COMPLETE

## Overview

Step 36 implements the **non-greenfield workflow** for Ordinex. When a workspace already contains an existing project, Ordinex safely enhances it instead of scaffolding or overwriting.

## Core Principles (Enforced)

1. **NEVER overwrite or delete** an existing project by default
2. **All code changes** are diff-gated + approval-gated
3. **Reuse VERIFY + REPAIR** (no new validation loops)
4. **Deterministic context selection** (no random files)
5. **Max 2 clarification questions**
6. **Replay/Audit must not re-execute commands**

---

## Files Changed

### Core Package

| File | Description |
|------|-------------|
| `packages/core/src/projectSnapshot.ts` | **NEW** - Fast, deterministic project analysis |
| `packages/core/src/enhanceContextBuilder.ts` | **NEW** - Targeted file selection with reference resolution |
| `packages/core/src/enhanceFlow.ts` | **NEW** - Main orchestrator for enhance flow |
| `packages/core/src/__tests__/enhanceFlow.test.ts` | **NEW** - Comprehensive test suite |

### Webview Package

| File | Description |
|------|-------------|
| `packages/webview/src/components/EnhanceProposalCard.ts` | **NEW** - UI card for enhance proposals |

---

## Deliverables

### 36.1 Intent Detection (Routing) ✅

Enhanced intent routing to detect "Enhance Existing Project" when:
- Target directory is non-empty
- Project markers exist (package.json, src/, app/, etc.)
- User intent ≠ "create new project"

**Functions:**
- `shouldUseEnhanceFlow()` - Checks if enhance flow applies
- `determineFlowKind()` - Routes to 'standard', 'scaffold', or 'enhance'

**Uses existing Intent Analyzer behaviors:**
- `QUICK_ACTION` - trivial/small changes
- `PLAN` - medium/large changes
- `CLARIFY` - incomplete requests
- `CONTINUE_RUN` - active run detected
- `ANSWER` - question mode

### 36.2 Project Snapshot (NO LLM) ✅

**File:** `packages/core/src/projectSnapshot.ts`

**Function:** `buildProjectSnapshot(workspaceRoot): ProjectSnapshot`

Collects (fast + deterministic):
- **Package manager** (pnpm/yarn/npm via lockfiles)
- **Framework** (Next.js App Router, Pages Router, Vite, Expo, etc.)
- **Language** (TypeScript/JavaScript)
- **Scripts**: lint / test / build availability
- **Key directories** (top level only)
- **Key entry files** (heuristics by framework)
- **Patterns** (tRPC, Prisma, Tailwind, etc.)
- **Tooling** (ESLint, Prettier)
- **Monorepo detection**

**Supported Frameworks:**
- Next.js (App Router / Pages Router)
- Vite + React / Vue
- Create React App
- Expo
- Express
- NestJS
- Astro
- Remix
- Nuxt
- Angular
- Svelte

**Events emitted:**
- `project_snapshot_started`
- `project_snapshot_completed`

### 36.3 Context Builder (Targeted) ✅

**File:** `packages/core/src/enhanceContextBuilder.ts`

**Function:** `buildEnhanceContext(options): EnhanceContextResult`

**Inputs:**
- User request
- ProjectSnapshot
- Recent run metadata (last diff / artifact / editor)

**Output:**
- `filesToRead` (5–15 max)
- `optionalGlobs`
- `recommendedVerifyCommands`
- `referenceResolved` flag
- `referenceSource` tracking

**Resolution priority for "this / it":**
1. `last_applied_diff` files
2. `last_artifact_proposed` files
3. `active_editor` file
4. `CLARIFY` (ask user)

**Events emitted:**
- `context_build_started`
- `context_build_completed` (stores file list as evidence)

### 36.4 PLAN (Only If Needed) ✅

When Intent Analyzer says medium/large:
- Runs existing PLAN pipeline
- Injects snapshot info via `buildEnhanceSystemPromptAddition()`:
  - Framework
  - TypeScript/ESLint presence
  - Existing patterns (App Router, tRPC)

When small change:
- Skip PLAN → `QUICK_ACTION`

### 36.5 Execution (Reuse Existing) ✅

Execution **reuses existing mechanics**:
- `diff_proposed` → `approval_requested` → `diff_applied`
- Auto-trigger VERIFY (Step 34)
- Uses discovered scripts from snapshot
- Obeys verify policy (prompt default)

**Repair Loop:**
- Bounded to max 2 attempts
- Approval-gated diffs
- Re-verify after each fix

**If still failing:**
- `decision_point_needed` with options:
  - Try another fix
  - Open logs
  - Stop and fix manually
  - Create PLAN (explicit user choice)

### 36.6 UX — Enhance Proposal Card ✅

**File:** `packages/webview/src/components/EnhanceProposalCard.ts`

**Displays:**
- Detected stack (e.g., "Next.js (App Router) | TypeScript | pnpm")
- Files to read count + expandable list
- Verify commands to run
- Key reassurances:
  - "No files will be overwritten without approval"
  - "Only N relevant files will be read"
  - "All changes require your approval"

**Buttons:**
- Continue
- Change Focus (pick file/area)
- Cancel

### 36.7 Tests (Minimum) ✅

**File:** `packages/core/src/__tests__/enhanceFlow.test.ts`

Tests cover:
- **Snapshot detection** - Next.js, Vite, Expo fixtures
- **Context resolution** - "this/it" reference priority
- **QUICK_ACTION enhancement** - scope analysis
- **Verify failure → bounded repair** - attempt tracking
- **Replay safety** - command execution prevention
- **File selection limits** - 5-15 max enforcement

---

## Event Types Added

| Event | Description |
|-------|-------------|
| `project_snapshot_started` | Snapshot collection begins |
| `project_snapshot_completed` | Snapshot ready with all metadata |
| `context_build_started` | Context selection begins |
| `context_build_completed` | Files selected, stored as evidence |
| `enhance_flow_started` | Enhance flow orchestration begins |
| `enhance_proposal_ready` | Proposal card data ready for UI |
| `enhance_flow_failed` | Error during enhance flow |

---

## Architecture Flow

```
User Request in Existing Project
          │
          ▼
   ┌──────────────────┐
   │ buildProjectSnapshot │
   │ (fast, no LLM)   │
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Intent Analyzer  │
   │ (reuse Step 33)  │
   └──────────────────┘
          │
    ┌─────┴─────┐
    │           │
QUICK_ACTION   PLAN
(small)     (medium/large)
    │           │
    ▼           ▼
┌──────────────────┐
│ buildEnhanceContext │
│ (targeted files) │
└──────────────────┘
          │
          ▼
┌──────────────────┐
│ EnhanceProposalCard │ (if PLAN)
│ Continue/Cancel  │
└──────────────────┘
          │
          ▼
┌──────────────────┐
│ Existing Execution │
│ diff → approve → │
│ apply → verify   │
└──────────────────┘
          │
      ┌───┴───┐
  PASS│       │FAIL
      ▼       ▼
   Done   ┌─────────────────┐
          │ Bounded REPAIR  │
          │ (max 2 attempts)│
          └─────────────────┘
                  │
              ┌───┴───┐
          PASS│       │FAIL
              ▼       ▼
           Done   Decision Point
                  (user choice)
```

---

## Safety Guarantees

1. **No Project Overwrite**
   - Snapshot is read-only
   - All changes via diff pipeline
   - User approval required

2. **Deterministic Context**
   - Files selected by rules, not randomly
   - Capped at 15 files max
   - Priority stack for reference resolution

3. **Bounded Operations**
   - Max 2 repair attempts
   - Max 2 clarification questions
   - Decision point for user control

4. **Replay Safety**
   - Events marked with `replay_safe`
   - Snapshot stored as evidence
   - Commands not re-executed on replay

---

## Stop Condition ✅

User can enhance an existing repo and:
- ✅ Only relevant files are touched
- ✅ Diffs are minimal and approved
- ✅ Verify + repair runs safely
- ✅ No project-wide overwrite ever occurs
- ✅ Replay shows results without re-execution

---

## Usage Example

```typescript
import { runEnhanceFlow, shouldUseEnhanceFlow } from '@ordinex/core';

// Check if enhance flow applies
const useEnhance = await shouldUseEnhanceFlow(workspaceRoot, userPrompt);

if (useEnhance) {
  const result = await runEnhanceFlow({
    userPrompt: "add a loading spinner to the button component",
    workspaceRoot: "/path/to/nextjs-app",
    recentRunMetadata: {
      activeEditorFile: "src/components/Button.tsx"
    },
    eventBus,
    runId
  });

  if (result.showProposalCard) {
    // Show EnhanceProposalCard in UI
  } else if (result.proceedDirectly) {
    // Small change - proceed to execution
  }
}
```

---

## Next Steps

- Integrate with main mode router
- Wire EnhanceProposalCard to MissionFeed
- Add keyboard shortcuts for quick actions
- Performance optimization for large repos
