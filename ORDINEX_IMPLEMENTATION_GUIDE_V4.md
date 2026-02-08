# ORDINEX
## Next-Generation AI Coding Platform - VS Code Extension

## COMPLETE IMPLEMENTATION GUIDE
**From Step 40.5 (Intelligence Layer) Through V1 Production**

**Version 4.0 FINAL | February 5, 2026 | LOCKED**

> This document is the single source of truth for implementation.
> Give this to your agent. Implement step by step.

---

## PART 1: WHAT IS ORDINEX

### 1.1 Product Vision

Ordinex is a next-generation AI coding platform delivered as a VS Code extension. It is NOT a clone of Cursor, Windsurf, or Copilot. Ordinex is building AHEAD of those tools -- towards where AI-assisted development is shifting: intelligent, autonomous, trustworthy agents that understand your codebase deeply and execute with safety guarantees.

The name 'Ordinex' conveys order, precision, and systematic intelligence -- a different lane from 'breezy flow' tools. Structured intelligence is the differentiator.

### 1.2 What Makes Ordinex Different

| Differentiator | What It Means | Competitors |
|---|---|---|
| Event-Sourced Architecture | Every action is an immutable event. Full audit trail, replay, export. | None have this |
| Checkpoint + Restore | One-click restore to any point. Your #1 trust feature. | Cursor/Windsurf lack this |
| Bounded Autonomy (A0/A1) | Agent can iterate with budgets, loop detection, auto-downgrade. | Others: unlimited or none |
| Intelligence Layer | Context enricher that understands your codebase before routing. | Cursor has implicit; yours is explicit |
| Beat-Based Timeline | Organized narrative UI with verbosity modes. | Others use linear logs |
| Multi-Model Support | 9+ models, user can bring own key or subscribe. | Most lock to 1-2 models |
| Decision Records | DECISIONS.log explains WHY the agent chose what it chose. | Black box in competitors |
| Run Export + Replay | Export any run, replay it read-only, share with team. | Enterprise-grade auditability |

### 1.3 Business Model Phases

| Phase | What | Revenue | Timeline |
|---|---|---|---|
| Phase 1 (NOW) | VS Code Extension -- Standalone. User provides own API keys. All logic runs locally. Focus: Make it work end-to-end, prove the product. | None (free/BYOK) | Current |
| Phase 2 (LATER) | Web UI + Backend. Backend handles LLM routing, billing, usage tracking. Web dashboard for analytics, settings, team management. | Subscription + tokens | After V1 |
| Phase 3 (FUTURE) | Enterprise. SSO/SAML, team roles, audit compliance, self-hosted option. | Enterprise contracts | After traction |

### 1.4 What This Means for Implementation

**CRITICAL:** Design abstractions now that work for both phases. Every service should have an interface that works locally now but can route through a backend later.

| Concern | Phase 1 (Now) | Phase 2 (Later) |
|---|---|---|
| API Keys | User provides in settings | Backend manages |
| Billing | None | Subscription/tokens |
| User Auth | None (local only) | Login + accounts |
| Settings Storage | Local (.ordinex/) | Cloud sync |
| Analytics | None | Backend dashboards |
| LLM Calls | Direct API calls via LLMGateway interface | Routed through backend via same interface |
| Usage Tracking | Local log files | Backend reporting |

### 1.5 Current State: Step 40 Complete

The extension has been built through 40 implementation steps. The core scaffold flow, intent routing, mode system (ANSWER/PLAN/MISSION/SCAFFOLD), event bus, approval gates, and basic UI are functional. Steps 41-65 take this to production-ready V1.

**What already works:**
- Event-sourced architecture with EventBus
- Intent routing with pattern matching + LLM fallback
- 4 modes: ANSWER, PLAN, MISSION, SCAFFOLD
- Scaffold flow with recipe selection and file generation
- Approval gates for user confirmation
- Beat-based timeline UI (basic)
- Multi-model support (9+ models)
- Webview sidebar panel

**What's missing (this document covers all of it):**
- Intelligence Layer -- the system doesn't deeply understand the codebase
- Dev server lifecycle -- post-scaffold experience is broken
- Checkpoint/Restore -- the #1 differentiator isn't built yet
- Settings panel -- users must edit files manually
- Error recovery UX -- failures show raw errors
- Autonomy hardening -- A1 loops can get stuck
- Export/Replay -- enterprise features not built
- Backend abstractions -- not designed for Phase 2 yet

---

## PART 2: COMPLETE STEP INVENTORY

| Phase | Steps | Focus | Time Estimate |
|---|---|---|---|
| INTELLIGENCE LAYER | 40.5 | Context Enricher -- IMPLEMENT FIRST | 4-5 days |
| A: Core Completion | 41-45 | Make existing features bulletproof | 10-14 days |
| B: Trust & Recovery | 46-48 | Checkpoint, restore, resume (DIFFERENTIATOR) | 6-9 days |
| C: User Experience | 49-52 | Settings, error UX, onboarding | 6-9 days |
| D: Autonomy | 53-56 | A1 hardening, decision records, scope control | 8-11 days |
| E: Export & Audit | 57-59 | Run export, replay, audit trail | 7-8 days |
| F: Pre-Launch Polish | 60-62 | Performance, edge cases, dogfooding | 9-13 days |
| G: Backend Prep | 63-65 | Abstractions for Phase 2 (minimal now) | 3-4 days |

**TOTAL: 53-73 days (~11-15 weeks) including Intelligence Layer**

---

## PART 3: INTELLIGENCE LAYER -- STEP 40.5

**IMPLEMENT THIS FIRST -- BEFORE STEPS 41-65**

### 3.1 Why This Comes First

If you wait until after Steps 41-65, you will have built 25+ features on top of 'dumb' routing. Every feature will assume the current prompt handling. Adding intelligence later means touching EVERYTHING. Doing it now establishes the foundation that all future features build on top of.

### 3.2 The Core Problem

Current system:
```
User Input -> Pattern Matching -> Deterministic Route -> Execute
```

What it should feel like:
```
User Input -> UNDERSTANDS Intent -> Clarifies if Needed -> Knows Codebase -> Smart Response
```

The difference is contextual intelligence. The system should feel like it 'gets' what you mean, even when you're vague.

### 3.3 What the Intelligence Layer IS

It is a SINGLE preprocessing component that sits between user input and your existing routing. Your router, modes, and execution stay exactly the same.

```
CURRENT:  User Input -> Intent Router -> Execute
PROPOSED: User Input -> Context Enricher -> Intent Router -> Execute
```

### 3.4 Files to Create

| File | Purpose | New/Modified |
|---|---|---|
| `packages/core/src/intelligence/contextEnricher.ts` | Main enricher -- orchestrates all context gathering and builds EnrichedInput | NEW |
| `packages/core/src/intelligence/codebaseContext.ts` | Detects project type, structure, patterns, dependencies (NO LLM needed -- file system only) | NEW |
| `packages/core/src/intelligence/sessionContext.ts` | Tracks conversation history within session: recent topics, files, decisions | NEW |
| `routeUserInput` (entry point) | Call enricher first, receive EnrichedInput instead of raw string | MODIFIED (1 function) |

This is 3 new files and 1 modified function. Minimal risk, maximum impact.

### 3.5 Deliverable A: Codebase Context (codebaseContext.ts)

Gathers project information WITHOUT any LLM calls. Pure file system checks -- fast and deterministic.

**CodebaseContext Interface:**
```typescript
interface CodebaseContext {
  projectType: 'nextjs' | 'react' | 'express' | 'vite' | 'unknown';
  hasTypeScript: boolean;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  openFiles: string[];              // Currently open in editor
  recentlyModified: string[];       // Last 5 files changed
  hasAuth: boolean;                 // Detected auth setup
  hasDatabase: boolean;             // Detected DB setup
  componentLibrary?: string;        // shadcn, mui, chakra, etc.
  srcStructure: 'flat' | 'feature-based' | 'layer-based';
}
```

Detection logic: Check for `tsconfig.json` (TypeScript), `pnpm-lock.yaml`/`yarn.lock`/`package-lock.json` (package manager), `next.config.*` (Next.js), `vite.config.*` (Vite), `@supabase/supabase-js` or `prisma` in package.json (database), `next-auth` or `@auth/*` (auth).

### 3.6 Deliverable B: Session Context (sessionContext.ts)

Tracks what has been discussed within the current VS Code session. This is what enables 'fix that thing' to resolve to the correct file.

**SessionContext Interface:**
```typescript
interface SessionContext {
  recentTopics: string[];           // ['authentication', 'button styling']
  recentFiles: string[];            // Files we've touched or mentioned
  recentDecisions: string[];        // Choices user made
  pendingClarifications: string[];  // Asked but unanswered
}
```

Implementation: Update session context after every user message and agent action. Store in memory only (not persisted across sessions for V1).

### 3.7 Deliverable C: Context Enricher (contextEnricher.ts)

The main orchestrator that combines codebase + session context, resolves references, detects out-of-scope requests, and decides if clarification is needed.

**EnrichedInput Interface:**
```typescript
interface EnrichedInput {
  originalInput: string;
  codebaseContext: CodebaseContext;
  sessionContext: SessionContext;
  resolvedReferences: Record<string, string>;  // 'the button' -> 'Button.tsx'
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
  outOfScope: boolean;
  outOfScopeResponse?: string;
  enrichedPrompt: string;           // Enhanced prompt with context injected
}
```

**Key Functions:**
- `enrichUserInput(input, workspaceRoot, session)`: Main entry point
- `shouldClarify(input, codebaseContext, session)`: Decides if clarification is needed
- `isOutOfScope(input)`: Pattern matching for non-code requests
- `resolveReferences(input, session)`: Maps vague references to specific files
- `buildEnrichedPrompt(input, context, refs)`: Injects context into the prompt

### 3.8 Deliverable D: Router Integration

Modify `routeUserInput` to call the enricher first:

```typescript
// BEFORE:
async function routeUserInput(text: string, ...): Promise<void> {
  const greenfieldResult = detectGreenfieldIntent(text);
}

// AFTER:
async function routeUserInput(input: EnrichedInput, ...): Promise<void> {
  if (input.outOfScope) { await respondOutOfScope(input.outOfScopeResponse); return; }
  if (input.clarificationNeeded) { await askClarification(input.clarificationQuestion); return; }
  const greenfieldResult = detectGreenfieldIntent(input.enrichedPrompt);
  // ... rest stays the same
}
```

### 3.9 Before vs After Examples

| Scenario | Before (Current) | After (With Intelligence Layer) |
|---|---|---|
| 'Fix the button' | Routes to QUICK_ACTION but doesn't know WHICH button. LLM guesses, often wrong. | Session knows we discussed Button.tsx 2 messages ago. Enriched prompt includes resolved reference. |
| 'What's the weather?' | Routes to ANSWER, asks LLM. LLM tries to answer (wrong). | outOfScope = true. Responds: 'I focus on your codebase. Is there code I can help with?' |
| 'Add authentication' | Routes to PLAN. LLM generates generic auth plan. | Codebase context: Next.js + shadcn. Enriched prompt: 'Add authentication to this Next.js project using shadcn components'. |
| 'Create a new page' | Might wrongly route to SCAFFOLD (new project). | Codebase context: Next.js project exists. Routes to QUICK_ACTION. Creates page in app/ directory. |

### 3.10 What NOT To Build Now

- Full project indexing/embeddings -- that's V1.1+
- Long-term memory across sessions -- that's V1.2+
- Proactive suggestions -- that's V1.2+
- Learning user preferences -- that's V2+

---

## PART 4: PHASE A -- CORE COMPLETION (Steps 41-45)

### Step 41: Dev Server Lifecycle + Long-Running Command UX

**Goal:** Handle background processes (dev servers, watch modes) that run indefinitely, with proper start/stop/stream capabilities.

**Why Critical:** After scaffold, users expect 'Start Dev Server' to work.

**Deliverables:**
- **A) LongRunningProcess types:** Interface with id, command, args, cwd, status (starting/running/ready/stopped/error), pid, port, timestamps
- **B) Events:** process_started, process_ready, process_output, process_stopped, process_error
- **C) ProcessManager service:** startProcess(), stopProcess(), stopAll(), getProcess(), getActiveProcesses(), onOutput()
- **D) ProcessCard UI component:** Shows process status, port, 'Open in Browser', 'View Logs', 'Terminate'
- **E) Extension lifecycle:** In deactivate(), stop all running processes gracefully
- **F) Port conflict handling:** Check if port is in use, show decision card

### Step 42: Intent Routing Test Suite + Hardening

**Goal:** Ensure the intent routing system is bulletproof with comprehensive test coverage (50+ cases).

**Deliverables:**
- **A) Test suite (50+ cases):** 20 GREENFIELD, 10 COMMAND, 8 QUICK_ACTION, 6 ANSWER, 6 PLAN
- **B) Edge case tests:** Ambiguous inputs that previously broke routing
- **C) LLM classifier fallback tests:** Verify ambiguous inputs trigger the LLM classifier

### Step 43: Scaffold Quality Gates

**Goal:** Handle edge cases that break scaffold: non-empty directories, monorepos, disk space, permissions.

**Deliverables:**
- **A) Preflight checks system:** PreflightResult with canProceed, checks[], blockers[], warnings[]
- **B) Non-empty directory handling**
- **C) Monorepo detection**
- **D) Disk space check**
- **E) Atomic apply with rollback**
- **F) PreflightCard UI**

### Step 44: Scaffold Post-Verification

**Goal:** After scaffold files are created, verify the project actually works.

**Deliverables:**
- **A) Post-verification pipeline:** verify package.json -> npm install -> lint -> typecheck -> build
- **B) VerificationCard UI**
- **C) Graceful degradation**

### Step 45: Settings Panel (Phase 1)

**Goal:** Let users configure Ordinex without editing files manually.

**Deliverables:**
- **A) Settings schema (OrdinexSettings)**
- **B) SettingsService interface:** get(), set(), getAll(), reset(), onChange()
- **C) Settings Panel UI:** Tab-based: [API Keys] [Models] [Policies] [UI] [Scaffold]
- **D) VS Code command:** ordinex.openSettings

---

## PART 5: PHASE B -- TRUST & RECOVERY (Steps 46-48)

**THIS IS YOUR #1 DIFFERENTIATOR.**

### Step 46: Checkpoint System

**Goal:** Create snapshots before risky operations that can be restored.

**Deliverables:**
- **A) Checkpoint types:** id, created_at, run_id, reason, snapshot (files, git state, open editors)
- **B) CheckpointManager:** createCheckpoint(), restoreCheckpoint(), previewRestore(), listCheckpoints()
- **C) Storage:** `.ordinex/checkpoints/` with index.json and per-checkpoint directories
- **D) Events:** checkpoint_created, checkpoint_restore_started, checkpoint_restored, checkpoint_deleted
- **E) Auto-checkpoint triggers:** Before scaffold, before mission, before any file edit
- **F) Restore UI:** One-click restore after failures

### Step 47: Resume After Crash

**Goal:** If VS Code crashes mid-mission, offer to resume.

**Deliverables:**
- **A) Task persistence:** `.ordinex/tasks/active/{task_id}.json`
- **B) Crash detection:** On activation, detect tasks with status 'running'
- **C) Resume flow:** [Resume] [Restore Checkpoint] [Discard]
- **D) Clean exit handling:** Mark active tasks as 'paused'

### Step 48: Undo System

**Goal:** Granular undo for individual actions.

**Deliverables:**
- **A) UndoStack:** Push/pop of UndoableAction with before/after content
- **B) UI:** After any edit: 'Applied: Updated Button.tsx [Undo]'
- **C) Keyboard shortcut:** Cmd+Shift+Z

---

## PART 6: PHASE C -- USER EXPERIENCE (Steps 49-52)

### Step 49: Error Recovery UX

**Deliverables:**
- **A) FailureCard component**
- **B) Error pattern suggestions** (30+ patterns)

### Step 50: First-Run Experience

**Deliverables:**
- **A) First-run detection**
- **B) Setup wizard:** Welcome -> API Key -> Tour -> Try task -> Done
- **C) Feature highlights**

### Step 51: Post-Scaffold Guide

**Deliverables:**
- **A) Recipe-specific suggestions**

### Step 52: Keyboard Shortcuts

**Deliverables:**
- Core shortcuts: Cmd+Shift+O (Focus), Cmd+Shift+N (New chat), etc.

---

## PART 7: PHASE D -- AUTONOMY (Steps 53-56)

### Step 53: A1 Autonomy Loop Hardening

**Deliverables:**
- **A) Autonomy budget:** max_iterations, max_time_ms, max_tool_calls, max_tokens_spent
- **B) Loop detection:** isStuck, isRegressing, isScopeCreeping, isOscillating
- **C) Auto-downgrade:** A1 -> A0 when loop detected
- **D) Events:** autonomy_budget_warning, autonomy_loop_detected, autonomy_downgraded

### Step 54: Decision Records (DECISIONS.log)

**Deliverables:**
- **A) DecisionRecord structure**
- **B) DECISIONS.log writer**
- **C) UI:** Decision log viewer

### Step 55: Scope Expansion Workflow

**Deliverables:**
- **A) ScopeExpansionRequest**
- **B) ScopeExpansionCard**

### Step 56: Autonomy Settings UI

**Deliverables:**
- Settings: Autonomy level (A0/A1), budget limits

---

## PART 8: PHASE E -- EXPORT & AUDIT (Steps 57-59)

### Step 57: Run Export

**Deliverables:**
- **A) RunExport schema**
- **B) Export flow**
- **C) UI:** [Export Run] button

### Step 58: Replay Mode

**Deliverables:**
- **A) Replay loader**
- **B) Replay player:** next(), seekTo(), play()
- **C) UI:** Playback controls, 'Replay Mode - No changes will be made' banner

### Step 59: Audit Trail Viewer

**Deliverables:**
- Comprehensive view: Timeline, decision records, diffs, commands, checkpoints

---

## PART 9: PHASE F -- PRE-LAUNCH POLISH (Steps 60-62)

### Step 60: Performance Optimization

- Lazy loading, event batching, debounced file watching, memory profiling

### Step 61: Edge Case Hardening

- Large files, binary files, symlinks, permission errors, network timeouts, rate limiting

### Step 62: Dogfooding & Bug Fixes

- Internal usage, bug tracker, fix all P0/P1 bugs

---

## PART 10: PHASE G -- BACKEND PREP (Steps 63-65)

### Step 63: LLM Gateway Abstraction

- LLMGateway interface: complete() and stream(). Phase 1: DirectLLMGateway. Phase 2: BackendLLMGateway.

### Step 64: Usage Tracking Abstraction

- UsageTracker interface: recordUsage() and getUsage(). Phase 1: local. Phase 2: backend.

### Step 65: Auth Abstraction

- AuthProvider interface: getCredentials(), isAuthenticated(), signOut(). Phase 1: LocalApiKeyAuth. Phase 2: BackendAuth.

---

## PART 11: IMPLEMENTATION ORDER & TIMELINE

### 11.1 Recommended Critical Path

| Priority | Step | What | Why First |
|---|---|---|---|
| 1 | 40.5 | Intelligence Layer (Context Enricher) | Foundation for everything else |
| 2 | 41 | Dev Server Lifecycle | Unblocks post-scaffold experience |
| 3 | 46 | Checkpoint System | YOUR #1 DIFFERENTIATOR |
| 4 | 43 | Scaffold Quality Gates | Prevents failures that destroy trust |
| 5 | 45 | Settings Panel | Users need to configure the tool |
| 6 | 50 | First-Run Experience | New user success rate |
| 7 | 42 | Intent Routing Tests | Prevents wrong routing |
| 8 | 44 | Scaffold Post-Verify | Confirms scaffold actually works |
| 9 | 53 | A1 Loop Hardening | Autonomy trust and safety |
| 10 | 47 | Resume After Crash | Prevents lost progress |
| 11 | 48 | Undo System | Granular control |
| 12 | 49 | Error Recovery UX | Better failure experience |
| 13 | 51 | Post-Scaffold Guide | User guidance |
| 14 | 52 | Keyboard Shortcuts | Power user productivity |
| 15 | 54 | Decision Records | Audit trail |
| 16 | 55 | Scope Expansion | Safety boundary |
| 17 | 56 | Autonomy Settings | User control |
| 18 | 57 | Run Export | Enterprise requirement |
| 19 | 58 | Replay Mode | Auditability |
| 20 | 59 | Audit Trail Viewer | Complete transparency |
| 21 | 60 | Performance | Speed in large repos |
| 22 | 61 | Edge Cases | Production hardening |
| 23 | 62 | Dogfooding | Real-world testing |
| 24 | 63-65 | Backend Abstractions | Phase 2 readiness |

### 11.2 V1 Definition -- Done When:

- User can create a project (scaffold works reliably with quality gates)
- System understands codebase context (Intelligence Layer)
- User can start dev server (Step 41)
- User can configure settings (Step 45)
- User can recover from failures (Step 46 checkpoint + restore)
- User gets guided setup (Step 50 onboarding)
- User can export runs (Step 57)
- Autonomy is bounded and safe (Step 53)
- All P0/P1 bugs fixed (Step 62 dogfooding)

---

## PART 12: FILE & DIRECTORY REFERENCE

### 12.1 .ordinex/ Directory Structure

```
.ordinex/
├── settings.json              # User settings (Step 45)
├── usage/                     # Usage tracking (Step 64)
├── checkpoints/               # Checkpoint storage (Step 46)
│   ├── index.json
│   └── {checkpoint_id}/
│       ├── metadata.json
│       ├── files/
│       └── git_state.json
├── runs/                      # Run data (Step 57)
│   └── {run_id}/
│       ├── events.json
│       ├── evidence/
│       └── DECISIONS.log
├── tasks/                     # Active task state (Step 47)
│   └── active/
└── exports/                   # Exported runs (Step 57)
```

### 12.2 Complete Event Types

| Category | Events |
|---|---|
| Core | intent_received, mode_set, task_started, task_completed |
| Scaffold | scaffold_started, scaffold_proposal_created, scaffold_style_selected, scaffold_applying, scaffold_applied, scaffold_completed |
| Verification | verify_started, verify_completed, command_started, command_completed |
| Process | process_started, process_ready, process_output, process_stopped, process_error |
| Checkpoint | checkpoint_created, checkpoint_restore_started, checkpoint_restored, checkpoint_deleted |
| Autonomy | autonomy_budget_warning, autonomy_loop_detected, autonomy_downgraded |
| Vision | vision_analysis_started, vision_analysis_completed, reference_tokens_extracted |
| Intelligence | context_enriched, clarification_asked, out_of_scope_detected, reference_resolved |

---

## DOCUMENT SIGN-OFF

| Item | Details |
|---|---|
| Document Status | LOCKED -- Requirements Frozen |
| Version | 4.0 Final |
| Date Locked | February 5, 2026 |
| Current State | Step 40 complete, ready for Step 40.5 |
| Next Action | Implement Step 40.5 (Intelligence Layer) |
| Total Steps Remaining | 25 steps (40.5 through 65) |

**IMPORTANT: Start with Step 40.5 (Intelligence Layer). All subsequent features benefit from it. Do NOT skip it.**
