# Post-Scaffold UX Fixes

## Part A: Project Summary reflects real health state

### Problem
Project Summary shows "All checks passed" and "Start Dev Server" even when Doctor Card shows tsc/build/eslint failures. The app isn't ready but we present it as if it is.

### Solution
Single file change in `ScaffoldCompleteCard.ts`. Check `doctorStatus` (already in the payload) to decide which state to show.

### Mockup: Healthy state (no changes needed)

```
┌─────────────────────────────────────────────────────┐
│ 🚀 Project Summary                                  │
│    TaskFlow Pro  ┌─────────────────┐                │
│                  │ Dashboard Saas  │                │
│                                                     │
│  A Next.js todo application has been scaffolded...  │
│                                                     │
│  🎨 minimal-light  📄 14 pages  🧩 34 components    │
│  ✅ All checks passed                               │
│                                                     │
│  WHAT WE BUILT                                      │
│  ✔ Project scaffolding with Next.js App Router      │
│  ✔ TypeScript configuration                         │
│  ...                                                │
│                                                     │
│  ┌───────────────────┐  ┌──────────────────┐        │
│  │ ▶ Start Dev Server│  │ Open in Editor   │        │
│  └───────────────────┘  └──────────────────┘        │
│                                                     │
│  WHAT YOU CAN ADD NEXT                              │
│  + Task Management  + Multi-View Interface  ...     │
└─────────────────────────────────────────────────────┘
```

### Mockup: Errors found (new state)

```
┌─────────────────────────────────────────────────────┐
│ ⚠️ Project Created — needs fixes                    │
│    TaskFlow Pro  ┌─────────────────┐                │
│                  │ Dashboard Saas  │                │
│                                                     │
│  A Next.js todo application has been scaffolded...  │
│                                                     │
│  🎨 minimal-light  📄 14 pages  🧩 34 components    │
│  ❌ Build errors found                               │
│                                                     │
│  WHAT WE BUILT                                      │
│  ✔ Project scaffolding with Next.js App Router      │
│  ✔ TypeScript configuration                         │
│  ...                                                │
│                                                     │
│  ⚠️ Build errors were detected. Fix them before     │
│  starting development.                              │
│                                                     │
│  ┌───────────────────┐  ┌──────────────────┐        │
│  │ 🔧 Fix automatically│  │ Open logs      │        │
│  └───────────────────┘  └──────────────────┘        │
└─────────────────────────────────────────────────────┘
```

Key differences:
- Header: "Project Created — needs fixes" instead of "Project Summary"
- Border: yellow/orange instead of green
- Badge: "Build errors found" instead of "All checks passed"
- Warning message explaining the state
- Primary action: "Fix automatically" instead of "Start Dev Server"
- NO "What you can add next" suggestions — app needs to be fixed first

### Files to change
- `packages/webview/src/components/ScaffoldCompleteCard.ts` — `buildCompleteCardHtml()`, `buildVerifyBadge()`, action buttons

---

## Part B: Simplify "Fix automatically" prompt

### Problem
Current implementation creates a StructuredPlan with complex step descriptions. The agent can just run tsc/build itself to discover all errors.

### Solution
Simplify the step description to a clean prompt. The agent runs the commands, sees the errors, fixes them. No need to pass error output from the Doctor Card.

### Prompt (what the agent receives)

```
You are fixing a freshly scaffolded Next.js + TypeScript project that has build errors.

1. Run `npx tsc --noEmit --skipLibCheck` to see all TypeScript errors
2. Fix every error you find
3. Run `npm run build` to verify
4. Keep fixing until both commands pass with zero errors

Do not ask questions. Just fix everything.
```

### Files to change
- `packages/extension/src/extension.ts` — `handleDoctorAction()`, simplify the fixPlan step description

---

## Part C: Unified Changes Card (Cursor-style)

### Problem
Currently only the LAST `diff_applied` renders. On follow-up, the old card vanishes. User wants:
- All changes visible across iterations
- Previous iteration collapsed, latest expanded
- Undo / Keep All options
- Changes clear on git commit

### Design Decision: Single Unified Card vs Stacked Cards

**Stacked cards** (what I originally proposed) creates visual clutter — 5 follow-ups = 5 cards stacked.

**Better approach: Single "Changes" card that accumulates across iterations.**

This is what Cursor does:
- One card at the bottom that represents "all uncommitted agent changes"
- Card updates in-place when new changes arrive
- Previous iteration's files merge into the card with a section divider
- You can expand/collapse individual iteration sections within the ONE card

### Architecture

```
┌─ UncommittedChangesCard ───────────────────────────┐
│                                                     │
│  Iteration sections (most recent first):            │
│  ┌─ Latest iteration (expanded) ──────────────────┐ │
│  │  Files changed in this round                    │ │
│  └─────────────────────────────────────────────────┘ │
│  ┌─ Previous iteration (collapsed) ───────────────┐ │
│  │  ▶ 3 files changed  +445                       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  Global actions: Undo All | Keep All | Review       │
└─────────────────────────────────────────────────────┘
```

### Mockup: First fix iteration (single section, expanded)

```
┌─────────────────────────────────────────────────────┐
│  📝 3 files changed  +445                           │
│                                          Undo ↩  Review ↗│
│  ─────────────────────────────────────────────────  │
│                                                     │
│  TS  next.config.ts                         +10  ●  │
│  TS  progress.tsx                           +23  ●  │
│  TS  page.tsx                              +412  ●  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Mockup: After follow-up fix (two sections — latest expanded, previous collapsed)

```
┌─────────────────────────────────────────────────────┐
│  📝 9 files changed  +687  -23                      │
│                                    Undo All | Keep All│
│  ─────────────────────────────────────────────────  │
│                                                     │
│  ── Follow-up fix (latest) ──────────────────────── │
│                                                     │
│  TS  TaskDetailCard.tsx                     +45  ●  │
│  TS  analytics/page.tsx                    +112  ●  │
│  TS  next.config.ts                          +3  ●  │
│                                                     │
│  ── Initial fix ─────────────────── ▶ 3 files +445 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Note: "Initial fix" section is collapsed into a single line. Clicking the ▶ expands it to show the file list.

### Mockup: After "Keep All" clicked

```
┌─────────────────────────────────────────────────────┐
│  ✅ 9 files changed  +687  -23            Kept      │
│  ─────────────────────────────────────────────────  │
│  TS  next.config.ts  TS  progress.tsx               │
│  TS  page.tsx  TS  TaskDetailCard.tsx  ...           │
└─────────────────────────────────────────────────────┘
```

Card minimizes to a compact "accepted" state. No more Undo option. Informational only.

### Mockup: After git commit

The card disappears entirely. The undo stack is cleared.

### Implementation Details

**How data flows:**

1. Agent makes changes → `diff_applied` event with `files_changed[]` and `diff_id`
2. Webview renderer collects ALL `diff_applied` events into an array (not just last)
3. Renders ONE card with sections per diff event (iteration)
4. Latest section expanded, previous collapsed
5. Header shows cumulative stats across all iterations
6. "Undo All" reverts the most recent iteration (pops from undo stack)
7. "Keep All" marks all as accepted (removes undo capability, collapses card)

**Key change in renderers.ts:**

Currently (line 1601-1605):
```javascript
// OVERWRITES previous — only keeps last
if (event.type === 'diff_applied') {
  deferredDiffApplied = event;
  continue;
}
```

Change to:
```javascript
// COLLECT ALL diff events
if (event.type === 'diff_applied') {
  allDiffApplied.push(event);
  continue;
}
```

Then replace the single-card renderer (lines 1759-1805) with:
```javascript
if (allDiffApplied.length > 0) {
  items.push(renderUnifiedChangesCard(allDiffApplied, undoState));
}
```

**New `renderUnifiedChangesCard()` function:**
- Receives array of diff_applied events
- Computes cumulative stats (total files, total additions, total deletions)
- Renders sections per event, most recent first
- Latest section: expanded with file list
- Previous sections: collapsed one-liner with expand toggle
- Header: cumulative stats + "Undo All" / "Keep All" buttons

**Expand/collapse within the card:**
- Each section has a clickable header
- `onclick="toggleDiffSection(index)"` toggles the file list visibility
- CSS transition for smooth expand/collapse

**"Undo All" behavior:**
- Calls existing `handleUndoAction` for the most recent diff group
- After undo, that section is removed from the card
- Card re-renders with remaining sections
- If only one section left, it shows expanded

**"Keep All" behavior:**
- Sends message to extension: `{ type: 'keep_all_changes' }`
- Extension clears the undo stack for those groups
- Card re-renders in compact "kept" state (no undo buttons)
- Card stays as informational reference

**Git commit clearing:**
- Add a file system watcher or periodic check for `.git/refs/heads/` changes
- When a new commit is detected in the project directory, emit `changes_committed`
- Card disappears from the timeline
- Undo stack is cleared

Alternative (simpler): No automatic detection. Instead, when the user does their next prompt or action, check if the previously changed files have been committed (via `git status`). If so, auto-clear.

### Files to change
- `packages/webview/src/webviewJs/renderers.ts` — collect all diff events, new render function
- `packages/webview/src/webviewJs/actions.ts` — add `toggleDiffSection`, `handleKeepAll` handlers
- `packages/webview/src/styles/timeline.css` — CSS for collapsed/expanded sections
- `packages/extension/src/extension.ts` — handle `keep_all_changes` message, git commit detection

---

## Implementation Order

1. **Part A** — Project Summary health state (1 file, quick win)
2. **Part B** — Simplify fix prompt (1 file, quick win)
3. **Part C** — Unified Changes Card
   - C1: Collect all diff events + render unified card with sections
   - C2: Expand/collapse sections + toggle handler
   - C3: Undo All / Keep All actions
   - C4: Git commit clearing
