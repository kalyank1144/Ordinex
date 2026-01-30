# STEP 35.6 — POST-SCAFFOLD NEXT STEPS PANEL (MOMENTUM UX)

## SUMMARY

Implemented a post-scaffold "What's next?" panel that shows actionable suggestions after scaffold completes successfully. This creates momentum UX by guiding users to their next steps rather than leaving them in limbo.

## FILES CREATED

| File | Purpose |
|------|---------|
| `packages/core/src/scaffold/nextSteps.ts` | Next steps suggestion model with recipe-specific suggestions |
| `packages/core/src/scaffold/nextStepsActionRouter.ts` | Routes selected actions to command/quick_action/plan pipelines |
| `packages/webview/src/components/NextStepsCard.ts` | UI card component for displaying next steps |
| `packages/core/src/__tests__/nextSteps.test.ts` | Comprehensive tests for suggestion model |

## FILES MODIFIED

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Added next_steps event types |
| `packages/core/src/eventNormalizer.ts` | Added handlers for new event types |

## KEY FEATURES

### 1. Event Schema (Replay-Safe)

Three new events added:
```typescript
// When next steps are shown to user
next_steps_shown: {
  scaffold_id: string;
  recipe_id: string;
  design_pack_id?: string;
  suggestions: Array<{
    id: string;
    title: string;
    kind: "command" | "quick_action" | "plan";
    safety: "safe" | "prompt" | "risky";
  }>;
}

// When user selects a step
next_step_selected: {
  scaffold_id: string;
  suggestion_id: string;
  kind: "command" | "quick_action" | "plan";
}

// When user dismisses the panel
next_step_dismissed: {
  scaffold_id: string;
  reason?: string;
}
```

### 2. Suggestion Model

Recipe-specific suggestions with deterministic ordering (4-6 items max):

**Next.js App Router:**
- 🚀 Start Dev Server (`npm run dev`)
- 🔐 Add Authentication (Plan)
- 📄 Create New Page (Quick Action)
- 🔍 Run Lint
- 📦 Run Build

**Vite React:**
- 🚀 Start Dev Server (`npm run dev`)
- 📄 Create Component (Quick Action)
- ☁️ Add Deploy Config (Plan)
- 🔍 Run Lint
- 📦 Run Build

**Expo:**
- 🚀 Start Expo Server (`npm run start`)
- 📄 Create Screen (Quick Action)
- 🔐 Add Authentication (Plan)
- 🔍 Run Lint

### 3. Safety Levels

```typescript
type SafetyLevel = 'safe' | 'prompt' | 'risky';

// safe: Can auto-run (lint, tests, build)
// prompt: Always requires user approval (dev server, long-running)
// risky: Requires explicit confirmation + extra warnings
```

### 4. Action Routing

Actions route to the correct execution pipelines:

| Kind | Routes To | Approval Required |
|------|-----------|-------------------|
| `command` | Step 34.5 command execution | If longRunning or safety=prompt |
| `quick_action` | Step 33 QUICK_ACTION | Yes (diff approval) |
| `plan` | Step 33 PLAN mode | Yes (plan + diff approval) |

### 5. Dev Server Command Discovery

Deterministic package.json script detection:
```typescript
// Priority: dev > start
// Handles: npm, pnpm, yarn
// Detects: Expo (expo start)

detectDevServerCommand(packageJson, 'npm')
// → { scriptName: 'dev', command: 'npm run dev', ambiguous: false }
```

### 6. UI Component (NextStepsCard)

Clean visual design:
- ✅ Success header with recipe context
- Primary button: Start Dev Server (🚀)
- Feature grid: Add Auth, Create Page, Add DB
- Quick links: Lint, Build, Tests
- Dismiss button with event capture

## WHEN NEXT STEPS ARE SHOWN

```
scaffold_completed(success)
        │
        ├──→ verify OFF → Show next_steps_shown immediately
        │
        └──→ verify ON
                │
                ├──→ verify_completed(pass) → Show next_steps_shown
                │
                └──→ verify_completed(fail) → Do NOT show (wait for resolution)
```

## SAFETY GUARANTEES

1. **Long-running commands always prompt** - Even if command policy is set to "auto", start_dev_server ALWAYS shows a decision point
2. **No auto-run of dev servers** - User must explicitly click "Run" to start
3. **Plan actions gate everything** - add_auth/add_database go through full plan approval
4. **Quick actions produce diffs** - create_page shows diff before applying
5. **Events capture all decisions** - Full replay support

## INTEGRATION WITH EXISTING STEPS

| Step | Integration Point |
|------|-------------------|
| Step 33 | QUICK_ACTION and PLAN behaviors handle routed actions |
| Step 34 | Verify phase determines when to show next steps |
| Step 34.5 | Command execution handles run_lint/run_tests/start_dev_server |
| Step 35.1-5 | Scaffold flow emits next_steps_shown after success |

## EXAMPLE FLOW

```
User: "Create a Next.js app called my-portfolio"

1. Scaffold flow completes
2. scaffold_completed(success) emitted
3. verify phase runs (optional)
4. next_steps_shown emitted with:
   - Start Dev Server (command, prompt)
   - Add Auth (plan, prompt)
   - Create Page (quick_action, prompt)
   - Run Lint (command, safe)
   - Run Build (command, safe)

5. User clicks "Start Dev Server"
6. next_step_selected emitted
7. Decision point shown: "Run / Cancel"
8. User clicks "Run"
9. Command executes via Step 34.5
10. Logs appear in Logs tab (not Mission feed)
```

## STOP CONDITION VERIFICATION

✅ After scaffold + verify pass, user sees NextStepsCard
✅ Clicking Start Dev Server triggers prompt + runs via command phase
✅ Clicking Create Page triggers QUICK_ACTION diff proposal + approval
✅ Clicking Add Auth triggers PLAN flow (unless already wired)
✅ No noisy logs in mission feed; logs tab shows command transcript

## TESTS

Tests cover:
1. `getNextStepsForRecipe` returns correct ordered suggestions for each recipe
2. `next_steps_shown` emitted only on success path
3. `start_dev_server` always prompts user (even if policy auto)
4. `detectDevServerCommand` handles npm/pnpm/yarn correctly
5. Payload builders create replay-safe event data
