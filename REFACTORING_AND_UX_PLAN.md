# Ordinex Refactoring & UX Overhaul Plan

## Generated: 2026-02-08 | Status: APPROVED — Implementing

### Senior Dev Feedback (Incorporated)
1. **R1 first, before big file splits** — Mission Feed layering is the fastest 10× UX win. Don't wait for R2/R3.
2. **extension.ts → "thin orchestrator", not "tiny file"** — Provider still coordinates webview lifecycle + routing. Target realistic slim-down, not arbitrary line count.
3. **"View details (N events)" is NON-OPTIONAL in R1** — Auditability links are the key that prevents pushback from trust-first users. Must ship with tiering.
4. **Fix UX presentation first, then generator quality** — S1/S2 progress/complete cards make scaffold feel professional even before template upgrades.
5. **No framework migration** — Confirmed correct. Split into modules + shared helpers + CSS files.
6. **Week 1 = R0 + R1 + I1 exactly** — This unblocks everything else and makes the UI feel like a product.

---

## Executive Summary

Ordinex has strong **engineering foundations** (event sourcing, mode policy, crash recovery, undo, error patterns — Steps 0-49 complete, 1097 tests passing). But the **user experience** treats the product like an internal debugging tool rather than a polished AI coding assistant.

**The core problem**: Every internal event is rendered with equal weight in the Mission tab. Users see `prompt_assessed`, `stage_changed`, `retrieval_started`, `mode_set` alongside the things they actually care about (`plan_created`, `diff_proposed`, `failure_detected`). This makes Ordinex feel like a log viewer, not a product.

**The structural problem**: Three "god files" (extension.ts at 6,488 lines, index.ts at 6,315 lines, ScaffoldCard.ts at 2,445 lines) block fast iteration. You can't polish interaction design when every change requires navigating a 6K-line file.

**The strategic recommendation**: Stop adding features. Fix the presentation layer and break the monoliths. Then resume the roadmap.

---

## Part 1: What Competitors Do (And We Don't)

### Research Summary: Cursor, Windsurf, Copilot, Claude Code, Aider, Cline

| Principle | What They All Do | What Ordinex Does |
|-----------|-----------------|-------------------|
| **Progressive disclosure** | Tool calls shown as collapsed one-liners ("Read 3 files..."). Expand on click. | Every event gets a full card — `retrieval_started`, `context_collected`, `stage_changed` all at equal weight |
| **Hide the plumbing** | Context retrieval, semantic search, prompt construction are invisible | `prompt_assessed`, `retrieval_started/completed`, `mode_set` all render as visible cards |
| **Diffs are the star** | Diffs get the richest UI — accept/reject per line/hunk/file. The primary interaction point | `diff_proposed` and `diff_applied` exist but compete for attention with 141 other event types |
| **Group related events** | "Edited 3 files" as one card, not 3 separate `file_read` + `edit_applied` events | Each event is its own card. A scaffold shows 20+ individual events sequentially |
| **Plan before execute** | Editable plan shown as a clear checkpoint before autonomous execution | Plan exists but drowns in surrounding noise events |
| **Errors drive iteration** | Errors framed as "agent is iterating", with recovery buttons | `FailureCard` exists (good!) but appears alongside `iteration_failed`, `repair_attempted`, `tool_end` errors |
| **Approval at boundaries** | Ask once at meaningful boundaries (before commands, before file writes) | Good — `ApprovalCard` exists. But surrounded by noise |
| **User message bubble** | User's input is visually distinct (chat bubble, different background) | `intent_received` renders as just another event card with an icon |

### Key Insight

> **Events aren't wrong — the presentation is wrong.**
>
> The event-sourced architecture is a strength. Cursor and Windsurf don't have this level of auditability.
> But auditability belongs in a "System/Logs" view. The Mission tab should be a **curated narrative**
> of what matters to the user.

---

## Part 2: Code Analysis — The God Files Problem

### File Size Inventory

| File | Lines | Size | Concern Count |
|------|-------|------|---------------|
| `extension.ts` | 6,488 | ~191 KB | 28 properties, 54 methods, 46 message types, 8 lazy services |
| `webview/index.ts` | 6,315 | ~230 KB | CSS (1,480 lines) + state + rendering + handlers + demo mode |
| `ScaffoldCard.ts` | 2,445 | ~90 KB | 32 scaffold event types, 35 render methods, 908 lines CSS |
| `MissionFeed.ts` | 1,930 | — | 141 event types in EVENT_CARD_MAP, hub renderer |

### extension.ts — The Monolith

**What's mixed together** (all in one class, `MissionControlViewProvider`):
- Webview lifecycle management
- Message routing (46-case switch statement)
- 28 async business logic handlers (longest: `handleSubmitPrompt` at ~600 lines)
- Service initialization (8 lazy getters)
- Mode enforcement (V9 policy)
- Undo system (capture, sync, execute)
- Crash recovery (detect, handle)
- Task persistence
- Settings panel management
- File operations (attachments, undo writes)
- Process control
- Event emission + solution capture hooks

**Impact**: Adding any new feature means editing a 6,488-line file. Testing any handler means mocking the entire class. IDE indexing is slow.

### webview/index.ts — The Template Monolith

**What's mixed together**:
- 1,480 lines of inline CSS (16 sections)
- Global state object with 11 properties
- 40+ global `window.*` handler functions
- Tab rendering (Mission, Systems, Logs)
- Approval workflows
- Attachment upload logic
- Evidence caching
- Demo mode simulation
- ScaffoldCard dynamic loading

**Impact**: Any CSS change requires finding the right section in a 6K-line file. No CSS extraction, no theming system, no component isolation.

### ScaffoldCard.ts — The State Machine That Isn't

**What's mixed together**:
- 32 event types dispatched via ad-hoc switch (no state machine, no transition validation)
- 35 render methods (each returning HTML template strings)
- 908 lines of scoped CSS
- 14 hardcoded design pack token sets
- Action binding logic
- Utility functions (duplicated from other files)

**Impact**: A scaffold flow shows 20+ sequential events to the user. There's no summarization, no grouping, no "here's what happened" collapsed view after completion.

### Duplicated Utilities Across Cards

| Utility | Duplicated In |
|---------|--------------|
| `escapeHtml()` | ~15 card files |
| `formatTimestamp()` | ~10 card files |
| `formatDuration()` | 2-3 card files |

No shared utility module exists.

---

## Part 3: MissionFeed Deep Dive — 141 Events, Zero Layering

### Event Classification

Out of **141 event types** in EVENT_CARD_MAP:

#### Tier 1: User-Critical (should be prominent) — ~25 events
These are the events users need to see, interact with, and make decisions about:

| Event | Why It Matters |
|-------|---------------|
| `intent_received` | **User's own message** — should be a chat bubble, not an event card |
| `plan_created` | User needs to review/approve the plan |
| `plan_revised` | Plan was updated based on feedback |
| `approval_requested` | **Decision point** — user must act |
| `diff_proposed` | Code changes to review |
| `diff_applied` | Changes were made (with undo option) |
| `test_completed` | Did it work? |
| `failure_detected` | Something went wrong — recovery options |
| `decision_point_needed` | User input required |
| `clarification_presented` | User must choose |
| `mission_started` | Mission is beginning |
| `mission_completed` | Mission is done |
| `scaffold_proposal_created` | Project proposal to review |
| `scaffold_completed` | Project created |
| `process_started` / `process_ready` | Dev server running |
| `execution_paused` | Waiting for user |
| `generated_tool_proposed` | Tool needs approval |
| `task_interrupted` | Crash recovery needed |
| `scope_expansion_requested` | Scope change needs approval |
| `next_steps_shown` | What to do next |
| `autonomy_loop_detected` | Agent is stuck, needs help |

#### Tier 2: Progress Indicators (should be collapsed/grouped) — ~30 events
These show progress but don't need individual cards:

| Event | Better Presentation |
|-------|-------------------|
| `step_started` / `step_completed` | Progress bar or step indicator |
| `iteration_started` / `iteration_succeeded` / `iteration_failed` | Collapse into "Attempt 2/3: fixing..." |
| `scaffold_apply_started` / `scaffold_applied` | Part of scaffold progress |
| `feature_extraction_*` / `feature_code_*` | Collapse into "Analyzing features..." |
| `scaffold_verify_*` | Collapse into "Verifying project..." |
| `repair_attempt_started` / `repair_attempt_completed` | Part of error recovery flow |
| `command_started` / `command_completed` | Collapse into "Running npm install..." |
| `tool_start` / `tool_end` | Collapse into "Reading files..." or "Editing code..." |

#### Tier 3: System Internals (should be in Logs tab only) — ~85+ events
These are plumbing. A user never needs to see them in the Mission tab:

- `mode_set`, `mode_changed`, `mode_violation`
- `stage_changed`, `stage_timeout`
- `prompt_assessed`, `prompt_rewritten`
- `retrieval_started`, `retrieval_completed`, `retrieval_failed`
- `context_collected`, `context_snapshot_created`
- `stale_context_detected`
- `memory_facts_updated`
- `solution_captured`
- `run_scope_initialized`, `repair_policy_snapshot`
- `budget_exhausted`, `model_fallback_used`
- `plan_deviation_detected`, `plan_large_detected`
- `reference_attached`, `reference_context_built`, `reference_used`
- `reference_tokens_extracted`, `reference_tokens_used`
- `vision_analysis_started`, `vision_analysis_completed`
- `checkpoint_created`, `checkpoint_restored`
- `edit_split_triggered`, `edit_chunk_*`, `truncation_detected`
- `autonomy_started`, `autonomy_completed`, `autonomy_halted`
- `autonomy_downgraded`
- `generated_tool_saved`, `generated_tool_run_started`, `generated_tool_run_completed`
- `undo_performed`
- `task_recovery_started`, `task_discarded`
- `mission_breakdown_created`, `mission_selected`
- `scaffold_preflight_*`, `scaffold_target_chosen`, `scaffold_decision_*`
- `scaffold_style_*`, `scaffold_progress`, `design_pack_applied`
- `scaffold_quality_gates_*`, `scaffold_checkpoint_*`, `scaffold_autofix_*`
- `scaffold_final_complete`
- `next_step_selected`, `next_step_dismissed`
- `settings_changed`
- All `stream_delta`, `stream_complete`

---

## Part 4: The Refactoring Plan

### Phase R0: Shared Utilities (0.5 days)

**Goal**: Eliminate code duplication before any larger refactoring.

#### R0.1: Create `packages/webview/src/utils/cardHelpers.ts`
Extract from all 15+ card files:
```typescript
export function escapeHtml(text: string): string;
export function formatTimestamp(isoString: string): string;
export function formatDuration(ms: number): string;
export function truncateText(text: string, maxLen: number): string;
export function statusBadge(label: string, color: string): string;
export function actionButton(label: string, onclick: string, variant?: 'primary' | 'secondary' | 'danger'): string;
export function collapsibleSection(title: string, content: string, startOpen?: boolean): string;
```

#### R0.2: Update all card files to import from `cardHelpers.ts`
Remove duplicate implementations. This is mechanical but important — reduces total webview code by ~500 lines.

---

### Phase R1: Mission Feed "Work Surface" Layering (1.5-2 days)

**Goal**: The Mission tab shows only what matters. Everything else goes to Logs.

This is the single highest-impact change. It transforms the user experience from "log viewer" to "product."

#### R1.1: Create Event Tier System in MissionFeed.ts

Add a tier classification:
```typescript
const EVENT_TIERS: Record<string, 'user' | 'progress' | 'system'> = {
  // Tier 1: User-critical — always show as full cards
  'intent_received': 'user',
  'plan_created': 'user',
  'approval_requested': 'user',
  'diff_proposed': 'user',
  'diff_applied': 'user',
  'test_completed': 'user',
  'failure_detected': 'user',
  'decision_point_needed': 'user',
  'clarification_presented': 'user',
  'mission_started': 'user',
  'mission_completed': 'user',
  'scaffold_proposal_created': 'user',
  'scaffold_completed': 'user',
  'process_started': 'user',
  'process_ready': 'user',
  'execution_paused': 'user',
  'generated_tool_proposed': 'user',
  'task_interrupted': 'user',
  'scope_expansion_requested': 'user',
  'next_steps_shown': 'user',
  'autonomy_loop_detected': 'user',

  // Tier 2: Progress — collapse into parent or show as compact indicators
  'step_started': 'progress',
  'step_completed': 'progress',
  'iteration_started': 'progress',
  'iteration_succeeded': 'progress',
  'iteration_failed': 'progress',
  'scaffold_apply_started': 'progress',
  'scaffold_applied': 'progress',
  'feature_extraction_started': 'progress',
  'feature_extraction_completed': 'progress',
  'feature_code_generating': 'progress',
  'feature_code_applied': 'progress',
  'command_started': 'progress',
  'command_completed': 'progress',
  'tool_start': 'progress',
  'tool_end': 'progress',
  'repair_attempt_started': 'progress',
  'repair_attempt_completed': 'progress',
  'scaffold_verify_started': 'progress',
  'scaffold_verify_step_completed': 'progress',
  'scaffold_verify_completed': 'progress',

  // Tier 3: System — Logs tab only (never in Mission)
  // Everything else defaults to 'system'
};
```

#### R1.2: Render Logic Change

In `renderTimeline()`, filter by tier:
```
if tier === 'user'     → Render full card (current behavior)
if tier === 'progress' → Render compact one-liner OR group with parent
if tier === 'system'   → Skip entirely (available in Logs tab)
```

#### R1.3: User Message Bubble

Convert `intent_received` from an event card into a **user chat bubble**:
- Right-aligned (or left-aligned with user avatar/icon)
- Different background color (`var(--vscode-textBlockQuote-background)`)
- Shows the user's actual prompt text prominently
- No "Intent Received" header, no icon badge

#### R1.4: Progress Grouping

Group consecutive Tier 2 events into collapsible sections:
```
▸ Setting up project... (5 steps)     ← collapsed by default
  ├─ Analyzing features (3 detected)
  ├─ Generating components
  ├─ Applying design pack
  ├─ Running verification (15/15 passed)
  └─ Installing dependencies
```

#### R1.5: "View Details (N events)" Link — **NON-OPTIONAL** (Auditability Gate)

On each Tier 1 card, add a subtle link:
```
[View details (12 events)] → Opens Logs tab filtered to that time range
```

This preserves full auditability while keeping Mission clean. **Must ship with R1 tiering** — this is the key that prevents pushback from trust-first users who need to see what the agent is doing under the hood.

---

### Phase R2: Extension.ts Decomposition (2-3 days)

**Goal**: Break the 6,488-line monolith into focused modules.

#### R2.1: Extract Message Handlers

Create `packages/extension/src/handlers/` directory:

| File | Methods Extracted | Est. Lines |
|------|------------------|-----------|
| `answerHandler.ts` | `handleSubmitPrompt()`, `handleAnswerMode()` | ~700 |
| `planHandler.ts` | `handlePlanMode()`, `generateAndEmitPlan()`, `handleRefinePlan()`, `handleRequestPlanApproval()`, `handleResolvePlanApproval()` | ~500 |
| `missionHandler.ts` | `handleExecutePlan()`, `handleSelectMission()`, `handleStartSelectedMission()`, `handleMissionCompletionSequencing()`, `handleCancelMission()` | ~600 |
| `scaffoldHandler.ts` | `handleScaffoldFlow()`, `handlePreflightResolution()`, `handlePreflightProceed()`, `handleVerificationRetry/Restore/Continue()`, `handleNextStepSelected()`, `triggerPostScaffoldVerification()` | ~600 |
| `approvalHandler.ts` | `handleResolveApproval()`, `handleResolveDecisionPoint()`, `handleSelectClarificationOption()`, `handleSkipClarification()` | ~400 |
| `toolsHandler.ts` | `handleGeneratedToolRun()`, `handleProcessAction()`, `handleRecoveryAction()`, `handleOpenFile()` | ~300 |
| `settingsHandler.ts` | `openSettingsPanel()`, `handleSettingsMessage()`, `sendCurrentSettings()`, `emitSettingsChangedEvent()` | ~200 |

#### R2.2: Extract Services

Create `packages/extension/src/services/` directory:

| File | Extracted From | Est. Lines |
|------|---------------|-----------|
| `undoService.ts` | `captureForUndo()`, `syncUndoStateToWebview()`, `handleUndoAction()`, undo-related properties | ~200 |
| `crashRecoveryService.ts` | `checkForInterruptedTasks()`, `handleCrashRecovery()`, task persistence properties | ~200 |
| `modeService.ts` | `setModeWithEvent()`, `enforceMissionMode()`, mode properties | ~100 |
| `eventService.ts` | `emitEvent()`, `sendEventsToWebview()`, `checkSolutionCapture()` | ~150 |
| `serviceRegistry.ts` | All 8 lazy getter methods, service properties | ~200 |

#### R2.3: Slim extension.ts

After extraction, `extension.ts` becomes:
- Class declaration + properties (~50 lines)
- Constructor (~30 lines)
- `resolveWebviewView()` (~30 lines)
- `handleMessage()` — thin router dispatching to handler modules (~80 lines)
- `activate()` / `deactivate()` (~100 lines)
- **Total: ~500-700 lines** (down from 6,488) — "thin orchestrator" that still owns webview lifecycle + routing

#### R2.4: Handler Interface Pattern

Each handler receives a context object instead of `this`:
```typescript
interface HandlerContext {
  eventService: EventService;
  modeService: ModeService;
  serviceRegistry: ServiceRegistry;
  webview: vscode.Webview;
  state: ExtensionState; // currentMode, currentStage, isProcessing, etc.
}
```

This makes handlers independently testable without mocking the entire class.

---

### Phase R3: Webview Index.ts Decomposition (1.5-2 days)

**Goal**: Break the 6,315-line template into focused modules.

#### R3.1: Extract CSS

Create `packages/webview/src/styles/`:

| File | Content | Est. Lines |
|------|---------|-----------|
| `base.css` | Reset, layout, scrollbar, typography | ~200 |
| `header.css` | Header bar, tab bar | ~150 |
| `timeline.css` | Mission tab timeline, event cards | ~300 |
| `composer.css` | Input bar, attachment previews | ~200 |
| `systems.css` | Systems tab | ~150 |
| `logs.css` | Logs tab, filtering | ~100 |
| `modals.css` | Evidence viewer, approval overlays | ~150 |
| `cards.css` | Shared card styles (borders, badges, buttons) | ~200 |

Load via `<link>` tags in the webview HTML (VS Code supports this for webview local resources).

**Impact**: Removes ~1,480 lines from index.ts immediately.

#### R3.2: Extract State Management

Create `packages/webview/src/state/webviewState.ts`:
```typescript
export interface WebviewState {
  activeTab: 'mission' | 'systems' | 'logs';
  taskStatus: string;
  currentStage: string;
  currentMode: string;
  events: Event[];
  evidence: Record<string, any>;
  pendingAttachments: Attachment[];
  scopeSummary: ScopeSummary | null;
  latestCheckpoint: Checkpoint | null;
}
```

#### R3.3: Extract Message Handlers

Create `packages/webview/src/handlers/`:

| File | Content | Est. Lines |
|------|---------|-----------|
| `approvalHandlers.ts` | Approval resolution, decision point handlers | ~150 |
| `attachmentHandlers.ts` | Upload, validation, deduplication | ~100 |
| `navigationHandlers.ts` | Tab switching, evidence viewing, file opening | ~100 |
| `scaffoldHandlers.ts` | Scaffold action forwarding | ~50 |

#### R3.4: Extract Tab Renderers

Create `packages/webview/src/tabs/`:

| File | Content | Est. Lines |
|------|---------|-----------|
| `missionTab.ts` | Mission timeline rendering (delegates to MissionFeed) | ~200 |
| `systemsTab.ts` | Systems view model + rendering | ~300 |
| `logsTab.ts` | Log filtering + rendering | ~200 |

#### R3.5: Slim index.ts

After extraction:
- HTML shell generation (~100 lines)
- CSS `<link>` tags (~20 lines)
- Module imports + wiring (~50 lines)
- `getWebviewContent()` assembly (~50 lines)
- **Total: ~250-300 lines** (down from 6,315)

---

### Phase R4: ScaffoldCard Decomposition (1 day)

**Goal**: Break the 2,445-line monolith into focused renderers.

#### R4.1: Extract CSS
Move 908 lines of scoped CSS to `packages/webview/src/styles/scaffold-card.css`.

#### R4.2: Extract Render Groups

| File | Renders | Est. Lines |
|------|---------|-----------|
| `ScaffoldCard.ts` | Dispatcher + connectedCallback + bindActions | ~200 |
| `scaffoldRenderers/proposal.ts` | renderProposal, renderProposalWithActions, renderStylePicker, renderVisualPreview | ~400 |
| `scaffoldRenderers/execution.ts` | renderApplyStarted, renderApplied, renderDecisionResolved, renderCompleted | ~200 |
| `scaffoldRenderers/verification.ts` | renderStatusCard (verify, quality, autofix variants) | ~150 |
| `scaffoldRenderers/postScaffold.ts` | renderProgress, renderDesignPackApplied, renderFinalComplete, renderNextStepsShown | ~200 |
| `scaffoldRenderers/preflightRender.ts` | renderPreflightStarted, renderPreflightCompleted, renderBlocked | ~150 |

#### R4.3: Extract Design Pack Tokens
Move `getDesignPackTokens()` to import from `packages/core/src/designPacks.ts` (already has this data).

---

## Part 5: Scaffold UX — "Professional Flow" Polish

### Current Problem

A scaffold operation shows **20+ sequential event cards** to the user. Each is equal weight. The flow feels like watching a CI log scroll, not like a product creating your project.

### Target Experience

```
┌─────────────────────────────────────────────┐
│ 👤 "Create a React todo app with dark mode" │  ← User bubble
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 📋 Project Proposal                         │
│                                             │
│ React + TypeScript + Tailwind               │
│ 45 files | 3 pages | 5 features detected    │
│                                             │
│ ┌─ Design Pack ──────────────────────────┐  │
│ │ [Minimal Light] [Minimal Dark] [Neon]  │  │
│ └────────────────────────────────────────┘  │
│                                             │
│ [Preview] [Proceed] [Cancel]                │
└─────────────────────────────────────────────┘

          ↓ User clicks [Proceed]

┌─────────────────────────────────────────────┐
│ ⏳ Creating project...                      │
│ ████████████░░░░░░░░ 60%                    │
│                                             │
│ ✅ Files created (45)                       │
│ ✅ Design pack applied                      │
│ ✅ Features generated (5)                   │
│ ⏳ Running verification...                  │
│                                             │
│ ▸ View details (14 events)                  │
└─────────────────────────────────────────────┘

          ↓ Verification completes

┌─────────────────────────────────────────────┐
│ ✅ MyTodoApp is ready!                      │
│                                             │
│ Verification: 15/15 checks passed           │
│                                             │
│ [▶ Start Dev Server]  [Open in Editor]      │
│                                             │
│ ▸ View details (22 events)                  │
└─────────────────────────────────────────────┘

          ↓ User clicks [Start Dev Server]

┌─────────────────────────────────────────────┐
│ 🟢 Dev Server Running                      │
│ localhost:3000 | npm run dev                │
│                                             │
│ ▸ Last 3 lines of output...                │
│                                             │
│ [Open in Browser]  [Terminate]              │
└─────────────────────────────────────────────┘
```

**Total cards shown: 5** (instead of current 20+)

### Implementation

#### S1: Scaffold Progress Card (replaces 15+ individual events)

Create `packages/webview/src/components/ScaffoldProgressCard.ts`:
- Single card that **updates in-place** as scaffold progresses
- Shows a checklist of stages (create files, apply design, generate features, verify)
- Each stage gets a ✅/⏳/❌ status
- Progress bar (percentage based on completed stages)
- Collapses to summary when scaffold completes
- "View details (N events)" expander for full audit

#### S2: Scaffold Completion Card (replaces final_complete + next_steps_shown)

Create `packages/webview/src/components/ScaffoldCompleteCard.ts`:
- Clean "Project Ready" summary
- Verification results (pass/fail count)
- Prominent action buttons: Start Dev Server, Open in Editor
- If verification failed: show FailureCard-style recovery

#### S3: Wire "Start Dev Server" → Process → "Open in Browser"

This flow already works (W1+W2 implemented). But currently it shows as separate events. Change:
- Clicking [Start Dev Server] should show a ProcessCard directly
- ProcessCard updates in-place (status: starting → running → ready)
- When port detected, [Open in Browser] appears on the same card

---

## Part 6: Interaction Quality Improvements

### I1: User Message as Chat Bubble

`intent_received` should render as a user message bubble, not an event card:

```html
<div class="user-bubble">
  <div class="user-bubble-content">
    Create a React todo app with dark mode and authentication
  </div>
  <div class="user-bubble-meta">just now</div>
</div>
```

Styled with:
- Distinct background (`var(--vscode-textBlockQuote-background)`)
- Rounded corners, left-aligned with slight indent
- User icon or avatar placeholder
- No "Intent Received" header, no emoji icon

### I2: AI Response as Assistant Bubble

When the system produces a plan or answer, wrap it in an assistant bubble:
- Left-aligned, different background from user
- Shows the AI's "thinking" in a collapsible section
- The plan/answer is the primary content

### I3: Approval Cards — Reduce Friction

Current: Full card with type badge, risk level, details.
Better: Inline action buttons directly in the card that triggered the approval:
- Plan card shows [Approve Plan] [Refine] [Cancel] directly
- Diff card shows [Accept] [Reject] [Edit] directly
- No separate "Approval Requested" card needed

### I4: Error Flow — Iteration, Not Alarm

When `failure_detected` fires:
- Show the FailureCard (already good)
- But hide the intermediate `iteration_failed`, `repair_attempted`, `repair_attempt_started` events
- Instead, show a compact "Attempting fix... (attempt 2/3)" indicator
- Only show full failure if all retries exhausted

### I5: Test Results — Inline in Context

When `test_completed` fires:
- If all pass: compact green banner "All 12 tests passed"
- If failures: expand into TestResultCard with failing test details
- Don't show `test_started` as a separate card — merge into result

---

## Part 7: Priority Execution Order

### What to Do First (Week 1)

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| **P0** | **R0: Shared Utilities** | 0.5 days | Foundation for all card work |
| **P0** | **R1: Mission Feed Layering** | 1.5-2 days | **10x UX improvement** — the single biggest win |
| **P0** | **I1: User Chat Bubble** | 0.5 days | Instant "this is a product" feel |

### Week 2

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| **P1** | **R2: Extension.ts Decomposition** | 2-3 days | Unblocks fast iteration |
| **P1** | **S1+S2: Scaffold Progress/Complete Cards** | 1 day | Clean scaffold flow |

### Week 3

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| **P2** | **R3: Webview Index.ts Decomposition** | 1.5-2 days | CSS extraction, clean code |
| **P2** | **R4: ScaffoldCard Decomposition** | 1 day | Maintainable scaffold |
| **P2** | **I2-I5: Interaction improvements** | 1-2 days | Polish |

### Week 4+

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| **P3** | **Step 50: Onboarding Wizard** | 2-3 days | First-run experience |
| **P3** | **Step 52: Keyboard Shortcuts** | 0.5 days | Power users |
| **P3** | **Fix 25 failing tests** | 1 day | Clean test suite |
| **P3** | **Resume roadmap (Steps 58+)** | Per roadmap | New features |

---

## Part 8: What NOT to Do

1. **Don't migrate to React/Vue/Svelte** — Template strings work fine for this use case. The problem is organization, not framework. A framework migration is a 2-week project that doesn't ship user value.

2. **Don't delete events from the EventStore** — The event-sourced architecture is a strength. Just change what's *visible* in the Mission tab. All events remain in the Logs tab.

3. **Don't rewrite ScaffoldCard from scratch** — Decompose it. The render methods are correct. They just need to be in separate files and orchestrated by a progress card.

4. **Don't add more features before R1** — Every new feature added to the current Mission Feed makes the noise problem worse. The next card you add should be the progress grouping, not a new event type.

5. **Don't over-abstract** — The handler extraction (R2) should use simple function modules, not a complex plugin/middleware architecture. Keep it boring.

---

## Part 9: Success Criteria

After this refactoring is complete:

| Metric | Before | After |
|--------|--------|-------|
| Events visible in Mission tab (typical scaffold) | 20+ | 4-5 |
| Events visible in Mission tab (typical mission) | 30-40 | 8-12 |
| `extension.ts` line count | 6,488 | ~500-700 (thin orchestrator) |
| `webview/index.ts` line count | 6,315 | ~250-300 |
| `ScaffoldCard.ts` line count | 2,445 | ~200 (dispatcher only) |
| `MissionFeed.ts` has tier system | No | Yes |
| User message looks like chat bubble | No | Yes |
| Scaffold shows progress card | No | Yes |
| Shared utility module exists | No | Yes |
| Handlers independently testable | No | Yes |

---

## Part 10: Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Breaking existing event handling during R1 | Medium | Tier 3 events still render in Logs tab — nothing is deleted, just filtered from Mission |
| Handler extraction (R2) introduces state bugs | Medium | Extract one handler at a time. Run full test suite after each. Keep `this` references working via context object. |
| CSS extraction (R3) breaks styling | Low | CSS is already well-organized with section comments. Extract section by section. Visual regression check after each. |
| ScaffoldCard refactor breaks scaffold flow | Low | Render methods are pure functions (payload → HTML). Moving them to separate files is mechanical. |
| Scope creep — "while we're refactoring, let's also..." | High | **Strict rule**: Each phase is a separate PR. No feature additions during refactoring. |

---

## Appendix A: Card Classification Reference

### User-Facing Cards (18 — keep in Mission tab)
1. ApprovalCard
2. ClarificationCard
3. CrashRecoveryCard
4. DesignPreview
5. DiffAppliedCard
6. DiffProposedCard
7. FailureCard
8. GeneratedToolCard
9. MissionBreakdownCard
10. NextStepsCard
11. PlanCard
12. PreflightCard
13. PreflightDecisionCard
14. ProcessCard
15. ScaffoldCard (→ ScaffoldProgressCard + ScaffoldCompleteCard)
16. ScopeExpansionRequestCard
17. TestResultCard
18. VerificationCard / VerifyCard

### Debug/Internal Cards (8 — move to Logs tab only)
1. AnswerCard (context_collected display)
2. CheckpointCreatedCard
3. EvidenceList
4. EvidenceViewer
5. ReferenceTokensCard
6. ScopeSummary
7. SolutionCapturedCard
8. VisionAnalysisCard

---

## Appendix B: Competitor UX Sources

- Cursor AI: Agent-centric layout, collapsed tool calls, floating diff review bar, parallel agents
- Windsurf/Cascade: Todo list progress, Write/Chat mode toggle, named checkpoints
- GitHub Copilot: Transparent tool display, per-tool auto-approve, editor overlays
- Claude Code CLI: Collapsed one-liners, Alt+T thinking toggle, subagent parallelism
- Aider: Terminal-first, auto-git-commit per change, search/replace diff format
- Cline: Plan/Act modes, workspace snapshots, cost tracking, Problems panel integration

Key universal pattern: **Progressive disclosure** — collapse by default, expand on click. Show the narrative, not the log.
