# Ordinex Scaffold System — Improvement Plan

> **Version:** 2.0  
> **Date:** February 18, 2026  
> **Status:** Planning  
> **Goal:** Transform the Ordinex scaffold from a basic CLI wrapper into a best-in-class AI app builder that generates production-quality, beautifully designed applications — where every generated app is **unique to the user's prompt**, never a static template.

---

## Table of Contents

0. [Feedback-Integrated Execution Spec (Authoritative)](#0-feedback-integrated-execution-spec-authoritative)
1. [Current State Audit](#1-current-state-audit)
2. [Competitive Landscape](#2-competitive-landscape)
3. [The Core Problem — Why Static Previews Kill Trust](#3-the-core-problem--why-static-previews-kill-trust)
4. [Design Pack System — Complete Redesign](#4-design-pack-system--complete-redesign)
5. [The New Flow — Contextual Intelligence Architecture](#5-the-new-flow--contextual-intelligence-architecture)
6. [Improvement Plan — Phases](#6-improvement-plan--phases)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Architecture Decisions](#8-architecture-decisions)
9. [Success Metrics](#9-success-metrics)

---

## 0. Feedback-Integrated Execution Spec (Authoritative)

This section incorporates your feedback as the authoritative execution plan for scaffold redesign.  
If any older section conflicts with this section, this section wins.

### Goal

Transform Ordinex scaffold from "CLI wrapper + palette" into a premium AI app builder:

`Blueprint -> Style Intent -> Scaffold (CLI) -> Overlay (premium shell) -> Multi-pass generate -> Quality gates -> AutoFix -> Git commits -> Auto preview -> Doctor card -> Persist memory`

Output must be:
- unique to the prompt (no template feel),
- production-quality by default,
- responsive by default,
- accessible by default.

### Non-Negotiables

- No static mock preview. Use prompt-specific App Blueprint Card only.
- All writes happen in staging workspace until validation passes.
- Mandatory Quality Gate Pipeline after each stage.
- Commit-per-step after each stage that passes gates.
- Persist `.ordinex/context.json` from the beginning, update every stage.
- Multi-pass generation is Phase 1 for apps with `>= 5` pages.
- UI should show stage progress, not time estimates.

### What Already Exists vs What Is New

Status based on current codebase scan:

| Capability | Status | Notes |
|---|---|---|
| Greenfield detection | Exists | `greenfieldDetector` flow already present |
| Scaffold orchestration | Exists | `scaffoldFlow.ts`, `postScaffoldOrchestrator.ts`, `scaffoldHandler.ts` |
| Quality gates baseline | Exists | `packages/core/src/scaffold/qualityGates.ts` exists and should be expanded |
| Vision/reference ingestion | Exists | `visionAnalyzer.ts`, reference processing paths exist |
| Process manager/dev execution | Exists | `processManager.ts` present |
| Design pack selection | Exists | `designPackSelector.ts`, now fallback-only target |
| Session memory persistence | Exists | `.ordinex/session-context.json` in intelligence layer |
| New project memory contract | New | add `.ordinex/context.json` v2 contract (below) |
| Staging + atomic publish | Partially exists | existing manifest/checkpoint apply paths; needs strict staging-first contract |
| App blueprint extraction/schema gate | New | add extractor + schema validator + archetype fallback |
| Deterministic autofix module | New | introduce cheap non-LLM fix pass before LLM repair |
| Commit-per-step scaffold pipeline | New | formal stage commits and rollback hooks |
| Doctor card | New/Expand | add final diagnostics card + action buttons |

### Architecture Overview

#### High-level Pipeline

1. Detect greenfield intent.
2. Extract `AppBlueprint` (LLM structured JSON).
3. Validate blueprint schema (strict).
4. If vague/low confidence/schema fail -> archetype fallback + clarifying questions.
5. Render App Blueprint Card (pages/components/models + style intent inputs + recipe defaults).
6. On Generate:
   - create staging workspace,
   - run CLI scaffold into staging,
   - apply Ordinex overlay shell,
   - initialize shadcn + install pinned base components,
   - apply style tokens + shadcn vars mapping with WCAG enforcement,
   - run multi-pass generation,
   - run quality gates after each stage,
   - deterministic autofix first, then bounded LLM repair if needed,
   - commit passing stage.
7. Atomic publish to final target.
8. Auto-start dev server, open VS Code Simple Browser.
9. Show Doctor Card with pass/fail + actions.
10. Persist `.ordinex/context.json` updates throughout.

### Required Modules / Files

#### New Core Modules

- `appBlueprintExtractor.ts`
- `blueprintSchema.ts` (JSON schema + validator)
- `styleIntentResolver.ts`
- `paletteGenerator.ts` (deterministic from hex)
- `tokenValidator.ts` (WCAG AA checks + corrective adjustments)
- `designPackToShadcn.ts` (hex to HSL variable mapping)
- `stagingWorkspace.ts` (temp workspace + atomic publish)
- `overlayApplier.ts` (premium shell overlay)
- `ordinexVersions.ts` (pinned versions config loader)
- `deterministicAutofix.ts` (AST/deps/basic JSX fixes)
- `gitCommitter.ts` (stage commits with blueprint context)
- `multiPassGenerator.ts` (layout/routes/components/pages/polish orchestration)
- `doctorCard.ts` (webview rendering model + payload contract)

#### Existing Modules to Update

- `postScaffoldOrchestrator.ts` -> adopt stage contracts, gates, commit flow
- `scaffoldRenderers/proposal.ts` -> Blueprint Card; remove static visual preview
- `greenfieldDetector.ts` -> route into blueprint-first flow
- `scaffoldHandler.ts` -> staging + publish + process manager wiring
- `designPackSelector.ts` -> fallback-only role
- `qualityGates.ts` -> strict per-stage order and reporting contract

### Data Contracts (Strict)

#### AppBlueprint (must validate)

If blueprint is invalid/malformed, do not generate. Route to clarification/archetype flow.

Extractor output contract (required):

```ts
interface BlueprintExtractionResult {
  blueprint: AppBlueprint;
  confidence: number; // 0..1
  missing_fields: string[];
}
```

Confidence policy (required):
- `confidence >= 0.75` -> allow generate without additional confirmation
- `0.4 <= confidence < 0.75` -> require explicit user confirmation on Blueprint Card
- `confidence < 0.4` -> archetype picker required before generation

```ts
type AppType =
  | "dashboard_saas" | "ecommerce" | "blog_portfolio"
  | "social_community" | "landing_page" | "admin_panel"
  | "mobile_app" | "documentation" | "marketplace" | "custom";

interface AppBlueprint {
  app_type: AppType;
  app_name: string;
  primary_layout: "sidebar" | "header_only" | "full_width" | "centered" | "split";
  pages: Array<{
    name: string;
    path: string;
    description: string;
    key_components: string[];
    layout: "sidebar" | "full_width" | "centered";
    is_auth_required: boolean;
  }>;
  data_models: Array<{ name: string; fields: string[] }>;
  shadcn_components: string[];
  features: Array<{ name: string; description: string; complexity: "low" | "medium" | "high" }>;
}
```

Rule: `AppBlueprint` contains intent/scope only. Timing fields are not allowed in blueprint contracts.
Timing belongs to stage telemetry in `.ordinex/context.json` history entries.

Valid blueprint example (must satisfy strict schema):

```json
{
  "app_type": "dashboard_saas",
  "app_name": "Project Ops",
  "primary_layout": "sidebar",
  "pages": [
    {
      "name": "Dashboard",
      "path": "/",
      "description": "KPIs, activity, quick actions",
      "key_components": ["StatsCards", "ActivityFeed", "QuickActions"],
      "layout": "sidebar",
      "is_auth_required": true
    },
    {
      "name": "Projects",
      "path": "/projects",
      "description": "Project list and filters",
      "key_components": ["DataTable", "Filters", "CreateDialog"],
      "layout": "sidebar",
      "is_auth_required": true
    }
  ],
  "data_models": [
    { "name": "Project", "fields": ["id", "name", "status", "ownerId", "createdAt"] },
    { "name": "Task", "fields": ["id", "projectId", "title", "state", "assigneeId"] }
  ],
  "shadcn_components": ["card", "button", "table", "dialog", "sheet", "toast"],
  "features": [
    { "name": "Authentication", "description": "Email/password login", "complexity": "medium" },
    { "name": "Project CRUD", "description": "Create/edit/archive projects", "complexity": "high" }
  ]
}
```

#### Archetype fallback rule

When prompt is vague, blueprint confidence low, or schema validation fails:
- show archetype picker: Dashboard / E-commerce / Blog / Landing / Admin / Custom
- generate blueprint skeleton from archetype
- ask 1-2 clarifying questions
- proceed only after user confirms blueprint

#### `.ordinex/context.json` (project memory contract)

Create early and update after every stage.

```json
{
  "version": "2",
  "created_at": "...",
  "stack": {
    "recipe": "nextjs_app_router",
    "frameworkVersion": "15.x",
    "ui": "shadcn",
    "styling": "tailwind",
    "backend": "none|supabase|custom"
  },
  "blueprint": {},
  "style": {
    "input": { "mode": "nl|vibe|hex|image|url", "value": "..." },
    "tokens": {},
    "shadcnCssVars": {}
  },
  "inventory": {
    "routes": [],
    "components": [],
    "dataModels": []
  },
  "doctor": {
    "tsc": "unknown|pass|fail",
    "eslint": "unknown|pass|fail",
    "build": "unknown|pass|fail",
    "devServer": { "status": "unknown|running|fail", "url": "" }
  },
  "history": [
    {
      "stage": "cli_scaffold",
      "commit": "hash",
      "result": "pass|fail",
      "telemetry": {
        "duration_ms": 48213,
        "files_created": 17,
        "files_modified": 4
      }
    }
  ]
}
```

Note: current intelligence memory uses `.ordinex/session-context.json`; this proposal adds project-scaffold memory `.ordinex/context.json` without removing existing session memory.

Canonical stage enum (used by history, gates, and commit checkpoints):

```ts
type ScaffoldStage =
  | "blueprint"
  | "preflight"
  | "cli_scaffold"
  | "overlay"
  | "shadcn_init"
  | "tokens"
  | "gen_layout"
  | "gen_routes"
  | "gen_components"
  | "gen_pages"
  | "gen_polish"
  | "pre_publish"
  | "publish"
  | "dev_smoke";
```

### Staging + Atomic Publish (Must)

Rule: never write directly to user target directory before validation passes.

Implementation contract:
- staging root: `~/.ordinex/staging/<runId>/`
- scaffold + generation writes only to staging
- publish only after final gate passes
- publish modes (explicit split):
  - **Mode A: New target (target has no git repo)**
    - staging may contain canonical `.git`
    - move/copy staging -> target (preserve `.git` exactly)
  - **Mode B: Existing repo target (target already has `.git`)**
    - do not publish by directory swap
    - do not replace target `.git`
    - use git worktree publish flow:
      - `git worktree add ~/.ordinex/staging/<runId> ordinex/scaffold/<runId>`
      - scaffold/generate/commit inside that worktree
      - publish via git merge (FF preferred, merge commit fallback)
      - no directory rename-swap for existing repos
- directory swap algorithm (Mode A only, or non-git targets):
  - if target exists and non-git swap is required:
    - create `target.__backup__`
    - create `target.__new__`
    - copy staging -> `target.__new__`
    - rename `target` -> `target.__backup__`
    - rename `target.__new__` -> `target`
    - if success: delete `target.__backup__`
    - if failure: restore backup and keep staging
- reliability notes:
  - never delete original target until replacement is confirmed
  - include fallback behavior for cross-device moves, external drives, symlink workspaces, and file watcher lock contention
- on publish failure:
  - do not corrupt target
  - keep staging for debugging
  - emit error details in Doctor Card

### Version Pinning Strategy (Must)

Add bundled config `ordinex-versions.json`:

```json
{
  "web": {
    "nextMajor": 15,
    "shadcn": "2.1.0",
    "tailwind": "4.0.0",
    "typescript": "5.7.0"
  }
}
```

Rules:
- detect framework major from scaffold output
- choose matching overlay package (e.g., `overlay-next15`)
- if unsupported major: warn + fallback strategy (`supported` or `experimental`)

Overlay packaging policy:
- overlay is version-matched package content, not inline LLM-generated architecture
- ship deterministic overlay bundles such as:
  - `overlay-next15/`
  - `overlay-next14/`
  - `overlay-vite/`
  - `overlay-expo/`
- LLM may fill product-specific content, but must not replace deterministic overlay architecture layer

### Style Intent System (Must)

Inputs:
- natural language style text
- vibe quick buttons
- hex color (deterministic palette)
- reference image
- reference URL

Output:
- semantic `DesignTokens`
- deterministic WCAG AA validation and correction
- shadcn CSS var mapping (HSL)

WCAG enforcement in `tokenValidator.ts` for at least:
- `foreground/background`
- `primary_foreground/primary`
- `secondary_foreground/secondary`
- `muted_foreground/muted`
- `destructive_foreground/destructive`

If failing, adjust foregrounds automatically until pass.

### Multi-pass Generation (Must in Phase 1 for `>= 5` pages)

Passes:
1. Layout pass (`app/layout.tsx`, responsive shell behavior)
2. Routes pass (all blueprint pages + route groups)
3. Components pass (reusable shadcn-first primitives)
4. Pages pass (assemble pages from components + empty states/toasts)
5. Polish pass (`loading.tsx`, `error.tsx`, responsive + accessibility checks)

For simple apps (`<= 3` pages), single-pass is allowed, but quality gates remain mandatory.

Manifest write contract (required):
- each pass produces a manifest before apply
- manifest declares explicit create/modify operations with verification metadata
- apply manifest atomically per pass (no direct ad hoc file writes)

Example:

```json
{
  "create": [
    { "path": "app/dashboard/page.tsx", "newSha256": "..." },
    { "path": "components/sidebar.tsx", "newSha256": "..." }
  ],
  "modify": [
    { "path": "app/layout.tsx", "baseSha256": "...", "newSha256": "..." }
  ]
}
```

### Quality Gate Pipeline (Mandatory after each stage)

Required gate points:
- after CLI scaffold
- after overlay + shadcn init
- after tokens application
- after each generation pass
- before publish
- after dev server start (smoke)

Gate order:
1. deterministic autofix (cheap)
2. `tsc --noEmit`
3. `eslint`
4. `npm run build` (or recipe-equivalent)
5. deterministic autofix retry (if needed)
6. bounded LLM repair (max 2)
7. fail safely -> Doctor Card + manual actions

Recipe gate command mapping (required):

```ts
interface RecipeGateCommands {
  tsc: string;    // e.g. "npm run typecheck" or "tsc --noEmit"
  eslint: string; // e.g. "npm run lint"
  build: string;  // e.g. "npm run build"
  dev: string;    // e.g. "npm run dev"
}
```

Resolution rules:
- read commands from recipe registry first
- if missing, detect from `package.json` scripts and select best available fallback
- if fallback used, report chosen commands in Doctor Card diagnostics

### Deterministic AutoFix (Must)

Non-LLM fixes first:
- normalize shadcn import paths
- detect/install missing deps
- fix trivial JSX syntax defects
- ensure alias alignment with `tsconfig` paths

LLM repair should run only after deterministic pass fails.

### Git Commit-per-step (Must)

Commit only when a stage passes all gates.

Minimum commit sequence:
- `ordinex: scaffold base (recipe=..., next=...)`
- `ordinex: apply overlay (shell, tokens base)`
- `ordinex: init shadcn (components=...)`
- `ordinex: apply style tokens (mode=...)`
- `ordinex: generate layout (layout=...)`
- `ordinex: generate routes (count=...)`
- `ordinex: generate components (count=...)`
- `ordinex: generate pages (count=...)`
- `ordinex: polish (loading/error/responsive)`
- `ordinex: autofix (tsc/eslint/build passing)`

Commit metadata should include blueprint context: `app_type`, `layout`, `page_count`.

If git repo does not exist:
- initialize git in staging,
- publish with `.git` preserved exactly.

Git publish policy (single policy, mandatory):
- new target mode: staging workspace contains canonical git history and publish preserves staging `.git` exactly
- existing repo mode: canonical history stays in target repo and staging is a git worktree branch, not an independent `.git` replacement
- never re-init git during publish
- never overwrite existing git history
- when target already contains git history:
  - always publish scaffold result as branch `ordinex/scaffold/<runId>`
  - merge target is current checked-out branch (or `main` when detached)
  - try fast-forward first from `ordinex/scaffold/<runId>` -> target branch
  - if fast-forward is not possible, perform merge commit (no rebase)
  - merge commit message must include blueprint context:
    - `ordinex: merge scaffold <runId> (app_type=..., pages=..., layout=...)`
  - if working tree is dirty:
    - do not auto-merge
    - keep branch intact and show Doctor action: `Commit or Stash changes, then Merge`
  - if merge conflicts occur:
    - abort merge attempt
    - keep `ordinex/scaffold/<runId>` branch intact
    - show Doctor actions: `Resolve conflicts` and `Open conflict files`

### UI Requirements (Blueprint + Doctor + Timeline)

Blueprint/proposal UI:
- remove `renderVisualPreview()`
- show Blueprint Card with:
  - pages + descriptions
  - components/models summary
  - style intent inputs (NL/vibe/hex/image/url)
  - `Generate App` primary action
  - optional `Edit/Confirm Blueprint`

Doctor Card (final):
- statuses:
  - Typecheck
  - ESLint
  - Build
  - Dev server + URL
- actions:
  - Fix automatically
  - Fix and resume scaffold
  - Open logs
  - Rollback to last good commit
  - Commit or Stash changes, then Merge (when target tree is dirty)
  - Resolve conflicts (when merge conflicts occur)
  - Open conflict files (when merge conflicts occur)
- persist Doctor results into `.ordinex/context.json`

Recovery mode:
- if scaffold fails at any stage, recovery action resumes from last valid committed stage
- recovery must preserve staging evidence and logs for deterministic continuation

Timeline behavior:
- scaffold events render in same timeline style as mission mode
- noisy events grouped into aggregate progress
- keep drill-down logs accessible

### Live Preview Requirements

- auto-run dev server after publish
- detect ready URL using layered strategy:
  1. regex scan for `http://localhost:<port>` in process output
  2. framework-specific ready patterns (Next/Vite/Expo)
  3. active probe `http://localhost:3000..3010` until 200/timeout
- always persist chosen URL to `.ordinex/context.json` at `doctor.devServer.url`
- open in VS Code Simple Browser (side panel)
- if server fails, show Doctor fail state with `Fix automatically`

### Acceptance Criteria

#### Trust & Uniqueness
- two different prompts produce different blueprints and page structures
- no static mock UI shown

#### Reliability
- no partial writes to target on failure
- each stage either commits cleanly or stops safely

#### Quality
- shadcn components used for React recipes
- responsive mobile behavior for shell/data-heavy screens
- key `loading.tsx` + `error.tsx` added
- core WCAG token checks passing

#### DX
- `.ordinex/context.json` created and updated
- Doctor Card visible with clear pass/fail
- auto preview opens when dev server is running

### Implementation Order (Execution Sequence)

1. Staging + atomic publish framework
2. Blueprint extraction + schema validation + archetype fallback
3. Style intent resolver + token validation + shadcn mapping
4. Overlay applier + pinned version integration
5. Quality gates + deterministic autofix
6. Git commit-per-step
7. Multi-pass generator
8. Doctor card + preview auto-start
9. Timeline polish

---

## 1. Current State Audit

### What Works Today

The scaffold system has a solid **event-driven architecture** with 6 phases:

| Phase | Implementation | Files |
|-------|---------------|-------|
| **Intent Detection** | Regex-based greenfield detection | `greenfieldDetector.ts` |
| **Proposal** | Deterministic recipe + design pack selection | `recipeSelector.ts`, `designPackSelector.ts` |
| **Preflight** | 6 safety checks (dir, permissions, disk, git, conflicts) | `preflightChecks.ts` |
| **Execution** | Official CLI tools in VS Code terminal | `scaffoldHandler.ts` |
| **Post-Scaffold** | Design pack CSS injection + LLM features + verification | `postScaffoldOrchestrator.ts` |
| **Next Steps** | Actionable buttons (Dev Server, Add Auth, etc.) | `nextSteps.ts`, `nextStepsActionRouter.ts` |

**Recipes:** Next.js 14 App Router, Vite + React, Expo (React Native)

**Design Packs:** 12 curated packs across 7 vibes (minimal, enterprise, vibrant, warm, neo, glass, gradient)

**LLM Capabilities Already Built:**
- Feature extraction from prompts (`featureExtractor.ts`)
- Component/page code generation (`featureCodeGenerator.ts`)
- Vision analysis for reference images (`visionAnalyzer.ts`)
- Auto-fix with up to 3 LLM retry attempts (`postScaffoldOrchestrator.ts`)

**UI Components:**
- `<scaffold-card>` — Custom web component with Shadow DOM for proposals
- `ScaffoldProgressCard` — Aggregates 15+ build events into single updating card
- `ScaffoldCompleteCard` — Shows project ready summary with next steps
- Design preview with live token rendering

### What's Broken or Weak

| Problem | Impact | Root Cause |
|---------|--------|------------|
| **Generic output** | Users get a standard `create-next-app` starter, not a real app | CLI generates boilerplate; design pack only changes CSS variables |
| **No component library** | Raw HTML/Tailwind without proper UI components | No shadcn/ui or similar integration |
| **Limited design options** | 12 fixed color palettes feel restrictive | No custom colors, no AI generation, no brand input |
| **Static design preview** | Shows tiny color swatches, not realistic app UI | Preview renders basic shapes, not real components |
| **Surface-level features** | LLM feature gen creates basic components, not real pages | Single-pass generation without component composition |
| **No live preview** | Dev server isn't auto-started; no immediate visual feedback | User must manually run `npm run dev` |
| **3 recipes only** | Missing SvelteKit, Nuxt, Remix, Astro, T3 Stack | Limited recipe registry |
| **Post-scaffold gap** | Project is still barebones after scaffold completes | No automatic multi-page structure from prompt |

---

## 2. Competitive Landscape

### How Modern AI App Builders Work

| Tool | Approach | Strength | Weakness |
|------|----------|----------|----------|
| **v0.dev** (Vercel) | Component-first with shadcn/ui registry | Highest UI quality, Figma integration, design system support | Frontend-only, no backend |
| **Bolt.new** (StackBlitz) | Full Node.js in browser, instant preview | Full-stack, 7+ frameworks, Supabase integration | Overwhelming for beginners |
| **Lovable** | Design-first MVP generation | Fastest builds (~12 min), native Supabase, GitHub sync | Requires iteration for UI polish |
| **Cursor** (Anysphere) | IDE-native with full codebase context | Deep code understanding, multi-file edits | Not focused on greenfield |

### Key Insights from Competitors

**v0's Secret: shadcn/ui + Registry System**
- Every generated component uses shadcn/ui — accessible, responsive, beautifully designed
- "Registry" specification passes design system context to AI models
- Iterative component building (small pieces first, then compose)
- Teams report **3x faster** design-to-implementation with this approach

**Bolt's Secret: Instant Feedback**
- Full Node.js running in the browser — no "install dependencies" step
- Changes are immediately visible in the preview
- One-click deployment removes friction

**Lovable's Secret: End-to-End Automation**
- Generates full-stack apps with database, auth, and deployment in minutes
- Visual editor for non-technical users
- GitHub sync keeps developers happy

### Where Ordinex Can Win

Ordinex has a unique advantage: **it runs inside the user's actual IDE**. This means:
- Full filesystem access (not sandboxed like Bolt/Lovable)
- Access to existing projects and codebases
- Native VS Code terminal, debugger, and extensions
- Git integration for version control
- Can modify existing projects, not just create new ones

The strategy: **Combine v0's UI quality + Bolt's instant preview + IDE-native superpowers**.

---

## 3. The Core Problem — Why Static Previews Kill Trust

### The Fundamental Flaw

This is the single most important insight for the entire scaffold redesign:

> **If every app a user generates shows the same preview — same layout, same "Build Something Great" mockup, same color swatches — users conclude the tool is just a template picker, not an AI builder.**

This is true even if the GENERATED app is unique. The preview is the first impression. If the preview looks like a template, the user assumes the output will be a template.

### What Users Actually Think

#### First-Time Non-Technical User
> "I asked it to build a project management tool and it showed me the same 'Build Something Great' card I saw when I asked for an e-commerce store. Same layout, same sections. It's just picking from templates."

The user's mental model becomes: "This tool has 12 templates. It generates one of 12 things." Even if the actual generated app is completely different, the damage is done at preview time.

#### Repeat Technical User  
> "I've used this 5 times now. Every time I see the same hero section with circles in the background, the same 'Components' row with Primary/Secondary buttons, the same H1/H2/Body typography strip. I know the output is different, but this preview gives me zero confidence that the AI understood what I asked for."

The preview creates a **trust gap** — the user sees a generic mockup and has no evidence the AI understood their specific request.

#### At Scale (1000+ Users)
> "Everyone's apps look the same. The layouts are identical. The only difference is the color scheme. There are 12 color options and my competitor picked the same one."

This is the death of differentiation. If your tool generates the same visual DNA for every app, it becomes a commodity.

### The Industry Evidence

Here's the critical discovery from research: **None of the leading AI app builders show a static preview before generation.**

| Tool | What They Show Before Generation | What They Show After |
|------|----------------------------------|---------------------|
| **v0.dev** | Nothing. Just "Generating..." | The REAL generated component running live |
| **Bolt.new** | Nothing. Streams code directly | The REAL app running in WebContainers |
| **Lovable** | Nothing. Shows generation progress | The REAL app in a live preview |
| **Google Stitch** | Nothing. Shows "Designing..." | The REAL generated UI |

**Every leader skips the preview step entirely.** They generate first, preview second. The preview IS the real output.

Why? Because showing a static mockup before generation sets wrong expectations and undermines the perception of intelligence.

### The Paradigm Shift

**Old thinking:** "We need to show users what the app will look like before we build it."  
**New thinking:** "We need to show users that we UNDERSTOOD what they asked for, then build it fast enough that the real app IS the preview."

This means:
1. **Kill the static design preview mockup entirely** — no more "Build Something Great" with color circles
2. **Replace it with an App Blueprint** — a contextual, prompt-specific plan showing what will be built
3. **Make the real app the preview** — auto-start dev server, show the actual running app
4. **Make style input conversational, not a picker** — "describe your style" replaces "pick from 12 swatches"

---

## 4. Design Pack System — Complete Redesign

### Why "Design Packs" as a Concept Must Evolve

The current system shows 12 hardcoded design packs as colored gradient cards in a picker grid. The user picks one, and the system applies those CSS variables to a `create-next-app` starter.

**Problems from every perspective:**

| Perspective | Problem |
|-------------|---------|
| **Non-technical user** | "I see 12 options. None match my brand. If this is all it can do, it's limited." |
| **Technical user** | "I have an existing Tailwind config. I want to import it, not pick from presets." |
| **Senior architect** | "12 hardcoded packs in a 770-line TypeScript file. Every new vibe = code change. This doesn't scale." |
| **Senior developer** | "The preview shows abstract shapes. I need to see real components in context." |
| **Product thinker** | "Every app gets 1 of 12 palettes. At scale, this means massive visual duplication." |

### The New Model: Style Intent

Replace "Design Packs" with **Style Intent** — a system where the user expresses what they want, and the AI generates a unique token set.

#### How Style Intent Works

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  How should your app look?                                   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ "Dark and modern with purple accents, like Linear"     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Or pick a starting point:                                   │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ ○ Clean  │ │ ○ Bold   │ │ ○ Warm   │ │ ○ Dark   │       │
│  │  & Light │ │  & Vivid │ │  & Soft  │ │  & Sharp │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                              │
│  Or paste a primary color: [ #_______ ]                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Three input paths, all leading to AI-generated tokens:**

1. **Natural Language** (primary path): User describes their style. LLM generates a complete token set. Every description produces a unique palette. "Dark with purple" ≠ "Dark with blue" ≠ "Dark with neon green."

2. **Vibe Categories** (quick start): Four broad vibes, not 12 specific palettes. Each vibe is a STARTING POINT that the LLM customizes based on the app type. A "Clean & Light" dashboard gets different tokens than a "Clean & Light" e-commerce store.

3. **Primary Color** (precision): User pastes one hex color. System generates the full palette algorithmically using color theory (no LLM needed). The palette adapts based on whether the color is light or dark, warm or cool.

#### Why This Is Different From "12 Packs"

| Aspect | Old (12 Packs) | New (Style Intent) |
|--------|----------------|-------------------|
| **Options** | 12 fixed | Infinite (LLM-generated) |
| **Same app type, same style?** | Yes — identical tokens | No — LLM contextualizes per app type |
| **User perception** | "Template picker" | "AI understands my style" |
| **Scaling** | 1000 users = ~83 per pack | 1000 users = 1000 unique palettes |
| **Adding new styles** | Code change required | User just describes it |
| **Brand colors** | Not supported | Paste hex or describe |
| **Reference-based** | Hidden feature | First-class input path |

#### AI Token Generation — Technical Details

**System Prompt for Token Generation:**
```
You are a design system architect. Generate a complete design token set for a 
web application based on the user's style description and app context.

App type: ${appType} (e.g., "project management dashboard")
Style intent: ${userStyleDescription} (e.g., "dark and modern with purple accents")

Return a JSON object with these EXACT fields:
{
  "colors": {
    "primary": "#hex",        // Main brand/action color
    "secondary": "#hex",      // Supporting color
    "accent": "#hex",         // Highlight/CTA
    "background": "#hex",     // Page background
    "foreground": "#hex",     // Primary text
    "muted": "#hex",          // Muted/subtle backgrounds
    "border": "#hex",         // Border color
    "destructive": "#hex",    // Error/danger
    "card": "#hex",           // Card/surface backgrounds
    "ring": "#hex",           // Focus ring
    // Auto-generated foreground variants for each background:
    "primary_foreground": "#hex",
    "secondary_foreground": "#hex",
    "accent_foreground": "#hex",
    "muted_foreground": "#hex",
    "destructive_foreground": "#hex",
    "card_foreground": "#hex"
  },
  "fonts": {
    "heading": "Google Font Name",
    "body": "Google Font Name"
  },
  "radius": "sm" | "md" | "lg",
  "density": "compact" | "default" | "relaxed",
  "shadow": "none" | "subtle" | "medium" | "dramatic"
}

RULES:
- All colors MUST meet WCAG AA contrast requirements
- For dark themes: background should be dark, foreground light
- For light themes: background should be light, foreground dark  
- The palette should feel cohesive and intentional
- Choose fonts that match the vibe (Inter for clean, Playfair for warm, etc.)
- Adapt the style to the APP TYPE — a dashboard needs a different feel than a landing page
```

**Key innovation:** The same style intent ("dark modern") produces DIFFERENT tokens for different app types:
- Dashboard → more muted, professional dark palette
- Landing page → more dramatic contrast, bolder accents
- Blog → warmer dark, better reading typography

This means even if two users type the same style description, their apps will have different visual DNA because the app type contextualizes the generation.

#### Primary Color → Full Palette (No LLM Needed)

For users who just want to pick a color, use algorithmic palette generation:

```
Input: #8b5cf6 (purple)

Step 1: Detect luminance → Dark primary (luminance < 0.5)
Step 2: Generate background → Light mode: #faf5ff, Dark mode: #0c0a1a
Step 3: Generate secondary → Analogous hue shift (+30°): #6366f1 (blue-purple)
Step 4: Generate accent → Complementary: #f59e0b (amber)
Step 5: Generate muted → Desaturate primary 80%: #ede9fe
Step 6: Generate border → Light: #e4e0f7, Dark: #2e1065
Step 7: Generate foreground colors → Ensure WCAG AA on each background
```

This is instant (no LLM call), produces a cohesive palette, and every primary color gives a unique result.

#### Keeping Curated Packs as Fallback

The 12 existing design packs are NOT deleted. They become:
1. **Fallback** when LLM is unavailable (offline, rate-limited)
2. **Seed data** for vibe categories (the "Clean & Light" vibe uses Minimal Light tokens as a starting point before LLM customization)
3. **Test fixtures** for unit/integration tests

### What Replaces the Design Preview

The current `renderVisualPreview()` function generates a static HTML mockup showing "Build Something Great" with color swatches. This is replaced by the **App Blueprint Preview** — described in detail in Section 5 below.

---

## 5. The New Flow — Contextual Intelligence Architecture

### Old Flow vs. New Flow

```
OLD FLOW (Template Feeling):
─────────────────────────────
1. User types "Build a project management app"
2. System detects greenfield intent
3. Show proposal card with:
   - Static "Build Something Great" preview (SAME for every app)
   - 12 color pack picker (SAME for every app)
   - Recipe/files/dirs grid
4. User picks a color pack
5. CLI creates starter project
6. Design pack CSS variables injected
7. LLM generates 1-2 basic features
8. Done → user must manually run dev server


NEW FLOW (Contextual Intelligence):
────────────────────────────────────
1. User types "Build a project management app"
2. LLM analyzes prompt → extracts App Blueprint:
   - App type: "Dashboard/SaaS"
   - Pages: Dashboard, Projects, Project Detail, Settings, Auth
   - Components: Sidebar, Data Table, Stats Cards, Forms
   - Data models: Project, Task, User
3. Show App Blueprint Card:
   - UNIQUE page structure extracted from THIS prompt
   - Style Intent input (describe / pick vibe / paste color)
   - Framework auto-detected
   - Estimated generation scope
4. User optionally describes style, clicks "Generate"
5. CLI + shadcn/ui auto-setup
6. LLM generates EACH page with real components (multi-pass)
7. Dev server auto-starts
8. Real app preview opens in VS Code side panel
9. User sees THEIR actual app — not a mockup
```

### The App Blueprint Card (Replaces Static Preview)

This is the centerpiece of the new experience. Instead of showing a generic mockup that looks the same for every app, show a **contextual blueprint** that proves the AI understood the prompt.

```
┌─ App Blueprint ──────────────────────────────────────────────────┐
│                                                                  │
│  📊 Project Management App                    Next.js + shadcn   │
│  ─────────────────────────────────────────────────────────────   │
│                                                                  │
│  PAGES TO GENERATE                                               │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  📊 Dashboard ─── Stats overview, recent activity,      │     │
│  │                   quick actions                          │     │
│  │  📁 Projects ──── Filterable project list, search,      │     │
│  │                   create new                             │     │
│  │  📋 Project ───── Task board, timeline, team members    │     │
│  │  ⚙️ Settings ──── Profile, preferences, team settings   │     │
│  │  🔐 Auth ──────── Login, register, forgot password      │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  COMPONENTS: 14 shadcn/ui components (Card, Table, Dialog...)    │
│  DATA MODELS: Project, Task, User, Activity                     │
│                                                                  │
│  ── Style ───────────────────────────────────────────────────    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Describe your style (optional):                          │    │
│  │ "dark modern, like Linear"                               │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Quick vibes: [Clean] [Bold] [Warm] [Dark]    Color: [#___]     │
│                                                                  │
│  ─────────────────────────────────────────────────────────────   │
│  5 pages · 14 components · ~45 files                             │
│                                                                  │
│  [ ✨ Generate App ]                        [ Cancel ]           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Why this works:**
- Every prompt produces a DIFFERENT blueprint (different pages, components, data models)
- The user sees evidence the AI understood THEIR specific request
- Style is an OPTIONAL input, not a mandatory pick from 12 options
- The scope summary (pages, components, files) sets accurate expectations without time promises
- Once generation starts, stage-based progress communicates momentum (for example: `tokens`, `gen_routes`, `build gate`)
- No static mockup = no template feeling

### How Blueprint Extraction Works

**Step 1: Intent Analysis (LLM Call)**

When the user types "Build a project management app with team collaboration," the LLM extracts:

```json
{
  "app_type": "dashboard_saas",
  "app_name": "Project Management App",
  "pages": [
    {
      "name": "Dashboard",
      "path": "/",
      "description": "Overview with project stats, recent activity, and quick actions",
      "key_components": ["StatsCards", "ActivityFeed", "QuickActions"],
      "layout": "sidebar"
    },
    {
      "name": "Projects",
      "path": "/projects",
      "description": "Filterable list of all projects with search and create",
      "key_components": ["DataTable", "SearchBar", "CreateDialog"],
      "layout": "sidebar"
    },
    {
      "name": "Project Detail",
      "path": "/projects/[id]",
      "description": "Individual project with task board, timeline, and team",
      "key_components": ["Tabs", "TaskBoard", "Timeline", "TeamAvatars"],
      "layout": "sidebar"
    },
    {
      "name": "Settings",
      "path": "/settings",
      "description": "User profile, app preferences, and team management",
      "key_components": ["Form", "Tabs", "AvatarUpload"],
      "layout": "sidebar"
    },
    {
      "name": "Login",
      "path": "/login",
      "description": "Authentication with email/password and social login",
      "key_components": ["LoginForm", "SocialButtons"],
      "layout": "centered"
    }
  ],
  "data_models": [
    { "name": "Project", "fields": ["id", "name", "status", "ownerId", "createdAt"] },
    { "name": "Task", "fields": ["id", "projectId", "title", "state", "assigneeId"] },
    { "name": "User", "fields": ["id", "name", "email", "role"] },
    { "name": "Activity", "fields": ["id", "actorId", "targetType", "targetId", "createdAt"] },
    { "name": "Team", "fields": ["id", "name", "plan", "createdAt"] }
  ],
  "shadcn_components": [
    "Button", "Card", "Input", "Label", "Dialog", "DropdownMenu",
    "Table", "Badge", "Avatar", "Tabs", "Sheet", "Separator",
    "NavigationMenu", "Toast"
  ],
  "scope_files": 45,
  "primary_layout": "sidebar_with_header"
}
```

This extraction takes ~2-3 seconds and is UNIQUE for every prompt. A user asking for "an e-commerce store" gets:
- Pages: Home, Products, Product Detail, Cart, Checkout, Orders, Account
- Components: ProductCard, CartDrawer, CheckoutForm, OrderSummary
- Data models: Product, Category, CartItem, Order, User
- Layout: full-width with header

**Completely different from the project management blueprint.**

**Step 2: Style Token Generation (Optional LLM Call)**

If the user described a style, a parallel LLM call generates tokens. If they picked a vibe category or pasted a color, the system uses algorithmic generation (no LLM needed). If they skipped style entirely, the system uses smart defaults based on app type:

| App Type | Default Style |
|----------|--------------|
| Dashboard/SaaS | Clean, professional, sidebar layout, subtle colors |
| E-commerce | Modern, product-focused, vibrant accents |
| Blog/Portfolio | Warm, readable, generous whitespace |
| Social/Community | Friendly, rounded, colorful |
| Landing Page | Bold, high-contrast, dramatic hero |
| Admin Panel | Dense, professional, data-heavy |

### Live Preview Architecture

After generation completes, instead of showing another static card, the system auto-starts the dev server and opens the real app:

```
Generation Complete Flow:
─────────────────────────
1. All files generated → emit "scaffold_generation_complete"
2. Auto-run: npm install (if needed, via ProcessManager)
3. Auto-run: npm run dev (via ProcessManager)
4. Detect ready signal (e.g., "ready on http://localhost:3000")
5. Open VS Code Simple Browser in side panel → load localhost:3000
6. User sees the REAL generated app — not a mockup

Timeline shows:
┌─────────────────────────────────────────────┐
│ ✅ App Generated                            │
│ 5 pages · 14 components · 47 files created  │
│                                             │
│ 🌐 Preview: http://localhost:3000           │
│ [Open Preview]  [Open in Browser]           │
│                                             │
│ Files: +47 new                              │
│ [Review Changes]  [Undo All]                │
└─────────────────────────────────────────────┘
```

### Why This Beats Every Competitor

| Capability | v0.dev | Bolt.new | Lovable | **Ordinex (New)** |
|-----------|--------|----------|---------|-------------------|
| Contextual blueprint before generation | No | No | No | **Yes** |
| User sees planned structure before building | No | No | No | **Yes** |
| AI-generated style tokens from description | Partial (design mode) | No | No | **Yes** |
| Live preview in IDE | N/A (web-only) | Yes (browser) | Yes (browser) | **Yes (VS Code panel)** |
| Full filesystem access | No (sandboxed) | No (WebContainers) | No (cloud) | **Yes (native)** |
| Git integration | Manual | One-click | One-click | **Automatic** |
| Existing project modification | Limited | No | No | **Yes (Mission mode)** |
| Component library (shadcn) | Yes | Sometimes | Sometimes | **Yes (always)** |

Ordinex uniquely offers **blueprint → generation → live preview** as a seamless pipeline inside the IDE. No competitor shows you what they plan to build before building it.

---

## 6. Improvement Plan — Phases

### Phase 1: Production-Quality Output (P0 — Highest Priority)

The single biggest impact change: make the generated app look like it was designed by a professional.

#### 1A. shadcn/ui Auto-Integration

**What:** After `create-next-app` completes, automatically:
1. Run `npx shadcn@latest init --defaults --force`
2. Install core components: Button, Card, Input, Label, Dialog, Dropdown Menu, Navigation Menu, Avatar, Badge, Separator, Sheet, Tabs, Toast
3. Configure shadcn theme with the selected design pack's colors

**Why:** shadcn/ui is the de facto standard for production React UIs. It provides:
- Accessible components (WAI-ARIA compliant)
- Beautiful default styling
- Tailwind-native (no CSS-in-JS)
- Copy-paste ownership (no dependency lock-in)

**Files to modify:**
- `postScaffoldOrchestrator.ts` — Add shadcn init step after CLI completes
- `recipes/nextjsAppRouter.ts` — Update recipe plan to include shadcn commands
- New: `shadcnIntegrator.ts` — Handle shadcn init, component install, theme config

**Effort:** Medium (1-2 days)

#### 1B. LLM-Powered Multi-Page App Generation

**What:** After scaffold + shadcn setup, use Claude Sonnet to generate a real multi-page app based on the user's prompt:

Example: User says "Create a project management app"

Instead of a generic landing page, generate:
- `app/layout.tsx` — Root layout with sidebar navigation using shadcn Sheet/Navigation
- `app/page.tsx` — Dashboard with stats cards, recent activity
- `app/(auth)/login/page.tsx` — Login form with shadcn Input/Button
- `app/(auth)/register/page.tsx` — Registration form
- `app/projects/page.tsx` — Project list with shadcn Card/Badge
- `app/projects/[id]/page.tsx` — Project detail with shadcn Tabs
- `app/settings/page.tsx` — Settings page with shadcn Form
- `components/sidebar.tsx` — Sidebar navigation component
- `components/header.tsx` — Top header with user avatar

**How:**
1. Extract app structure requirements using LLM (pages, components, data models)
2. Generate a component tree plan
3. Generate each component individually (using shadcn component API as context)
4. Wire into Next.js App Router with proper routing
5. Verify + auto-fix

**System Prompt Enhancement:**
Provide the LLM with:
- shadcn/ui component API documentation (Button props, Card structure, etc.)
- Design pack tokens (so generated code uses the right CSS variables)
- Framework conventions (Next.js App Router file structure, server/client components)
- Example patterns (how to build a sidebar layout, how to build a data table)

**Files to modify:**
- `featureCodeGenerator.ts` — Upgrade generation prompts to use shadcn components
- `postScaffoldOrchestrator.ts` — Orchestrate multi-page generation
- New: `appStructureGenerator.ts` — Extract and plan app structure from prompts
- New: `componentGenerator.ts` — Generate individual components with shadcn

**Effort:** High (3-5 days)

#### 1C. Design Pack → shadcn Theme Mapping

**What:** Map each design pack's tokens directly to shadcn's CSS variable system:

```css
/* shadcn expects these CSS variables */
--background: 0 0% 100%;
--foreground: 222.2 84% 4.9%;
--primary: 222.2 47.4% 11.2%;
--primary-foreground: 210 40% 98%;
/* etc. */
```

Currently, design packs generate `--primary: #1e40af` (hex). shadcn uses HSL format `--primary: 222.2 47.4% 11.2%`. We need a converter.

**Files to modify:**
- `designPacks.ts` — Add HSL variants or converter utility
- New: `designPackToShadcn.ts` — Convert design pack tokens to shadcn CSS variable format
- `postScaffoldOrchestrator.ts` — Use converter when generating globals.css

**Effort:** Low (half day)

---

### Phase 2: Style Intent System + App Blueprint (P0-P1)

#### 2A. App Blueprint Extraction

**What:** When a greenfield prompt is detected, use the LLM to extract a structured App Blueprint before showing the proposal card.

**How:**
1. After `greenfieldDetector.ts` identifies a greenfield intent, make one LLM call with structured output
2. The LLM returns a JSON blueprint: app type, pages, components, data models, layout type
3. The blueprint is rendered in the new **App Blueprint Card** (replaces the old static proposal)
4. The blueprint is stored in the scaffold event payload for downstream use by the generation phase

**Files to modify:**
- New: `appBlueprintExtractor.ts` — LLM-based blueprint extraction from user prompt
- `scaffoldFlow.ts` — Insert blueprint extraction step between detection and proposal
- `scaffoldRenderers/proposal.ts` — Complete rewrite to render App Blueprint Card
- `scaffoldRenderers/styles.ts` — New styles for blueprint layout

**Effort:** Medium (2 days)

#### 2B. AI-Generated Design Tokens (Style Intent)

**What:** Replace the 12-pack picker with the Style Intent system. Three input paths:
1. Natural language description → LLM generates tokens (contextual per app type)
2. Vibe category (4 broad vibes) → LLM customizes per app type
3. Primary color hex → algorithmic palette generation (no LLM)

**Files to modify:**
- New: `styleIntentResolver.ts` — Routes style input to LLM or algorithmic generator
- New: `paletteGenerator.ts` — Color theory-based palette from single hex color
- `designPacks.ts` — Refactor: existing packs become fallbacks + vibe seeds
- `designPackSelector.ts` — Replace deterministic selection with Style Intent resolution
- Webview: Style input UI in the App Blueprint Card

**Effort:** Medium (2-3 days)

#### 2C. Remove Static Preview, Replace with Blueprint

**What:** Delete `renderVisualPreview()` and the "Build Something Great" mockup entirely. The App Blueprint Card (showing pages, components, data models) IS the preview.

**Why no visual preview at all?**
- Any static mockup will feel like a template at scale
- The blueprint communicates understanding without visual commitments
- The REAL app (auto-started dev server) becomes the visual preview
- This is exactly how v0, Bolt, and Lovable work — no pre-generation mockup

**Files to modify:**
- `scaffoldRenderers/proposal.ts` — Remove `renderVisualPreview()`, `renderInfluenceBadge()`
- `scaffoldRenderers/proposal.ts` — Remove `renderStylePicker()` (replaced by Style Intent inline)
- `scaffoldRenderers/styles.ts` — Remove preview-specific styles, add blueprint styles

**Effort:** Low (1 day — mostly deletion + blueprint card styling)

#### 2D. Reference Import (Leverage Existing Code)

**What:** Surface the existing vision analysis and URL reference capabilities more prominently in the Style Intent UI. These already exist but are hidden.

We already have:
- `visionAnalyzer.ts` — Extracts design tokens from images
- `referenceContextBuilder.ts` — Processes URLs and images
- `designPackSelector.ts` — Supports `style_overrides` from references

**What's missing:** The UI doesn't surface these. In the App Blueprint Card, add:
- "Upload a screenshot for style reference" (triggers existing vision pipeline)
- "Paste a URL for inspiration" (triggers existing URL extraction)
- Show extracted style summary: "Extracted: Dark theme, blue accents, sans-serif typography"

**Effort:** Low-Medium (1 day — mostly UI wiring to existing backend)

---

### Phase 3: Richer Scaffold Capabilities (P1)

#### 3A. Auto-Start Dev Server

**What:** After scaffold completes, automatically run `npm run dev` and show the preview URL.

**Flow:**
1. Scaffold completes → emit `scaffold_final_complete`
2. Auto-run `npm run dev` via ProcessManager (already built)
3. Detect ready signal (ProcessManager already handles this)
4. Show preview URL in completion card
5. Optionally open browser preview panel (Side by Side)

**Files to modify:**
- `postScaffoldOrchestrator.ts` — Add auto-start step
- `scaffoldHandler.ts` — Wire up ProcessManager for auto-start
- Webview: Completion card shows preview URL when ready

**Effort:** Low (half day — infrastructure already exists)

#### 3B. Expand Recipe Registry

Add support for popular frameworks:

| Recipe | CLI Command | Component Library |
|--------|-------------|-------------------|
| **SvelteKit** | `npm create svelte@latest` | skeleton-ui |
| **Nuxt 3** | `npx nuxi@latest init` | nuxt-ui |
| **Remix** | `npx create-remix@latest` | shadcn/ui (Remix port) |
| **Astro** | `npm create astro@latest` | astro-ui |
| **T3 Stack** | `npm create t3-app@latest` | shadcn/ui + tRPC + Prisma |

**Files to modify:**
- `recipeRegistry.ts` — Add new recipe definitions
- `recipeSelector.ts` — Update detection rules
- New: `recipes/sveltekit.ts`, `recipes/nuxt3.ts`, etc.

**Effort:** Medium (2-3 days for 5 recipes)

#### 3C. Timeline-Consistent Scaffold Cards

**What:** Replace the monolithic `<scaffold-card>` with standard timeline cards matching the rest of the Ordinex UI (mission mode streaming blocks).

**Why:** The scaffold UI currently uses a separate custom element with Shadow DOM, which creates a visual disconnect from the rest of the timeline. Scaffold events should flow naturally in the timeline like mission events do.

**Files to modify:**
- `renderers.ts` — Add scaffold event rendering inline
- `ScaffoldProgressCard.ts` — Simplify to match timeline card style
- `ScaffoldCompleteCard.ts` — Simplify to match timeline card style

**Effort:** Medium (2 days)

---

### Phase 4: Advanced Capabilities (P2-P3)

#### 4A. Multi-Pass Generation Architecture

Inspired by v0's iterative approach:

```
User Prompt
    │
    ▼
┌─────────────────────┐
│ 1. EXTRACT           │  LLM extracts: app type, pages, components, data models
│    Requirements      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 2. PLAN              │  Generate component tree + file structure
│    Architecture      │  User reviews & approves (like Plan mode)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 3. GENERATE          │  Generate each component individually
│    Components        │  (shadcn/ui API in context)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 4. COMPOSE           │  Wire components into pages
│    Pages             │  Set up routing, layouts, navigation
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 5. POLISH            │  Add loading states, error boundaries
│    & Verify          │  responsive tweaks, dark mode
└─────────────────────┘
```

**Why Multi-Pass?**
- Single-pass generation (current approach) overwhelms the LLM with too much context
- Breaking into smaller pieces produces higher-quality output per component
- Each pass can be verified independently
- User can review the plan before generation starts

**Effort:** High (5-7 days)

#### 4B. Template Marketplace

Curated starter templates that combine recipe + design pack + app structure:

| Template | Recipe | Design | Features |
|----------|--------|--------|----------|
| **SaaS Dashboard** | Next.js + shadcn | Enterprise Blue | Auth, Dashboard, Settings, Billing, User Management |
| **E-commerce Store** | Next.js + shadcn | Minimal Light | Product Grid, Cart, Checkout, Order History |
| **Blog/Portfolio** | Astro | Warm Sand | Blog Posts, Portfolio Grid, About, Contact |
| **Admin Panel** | Next.js + shadcn | Enterprise Slate | Data Tables, CRUD, Charts, User Roles |
| **Mobile App** | Expo | Vibrant Pop | Tab Navigation, Home Feed, Profile, Settings |
| **Landing Page** | Next.js + shadcn | Gradient Sunset | Hero, Features, Pricing, Testimonials, Footer |

Each template is a JSON definition containing:
- Recipe ID + design pack ID
- Pre-defined page structure
- LLM generation prompt template
- Component list
- Estimated generation time

**Effort:** Medium (2-3 days for 6 templates)

#### 4C. Database/Backend Auto-Configuration

For full-stack prompts:

1. Auto-configure **Prisma** with SQLite (zero-config database)
2. Generate data models from user's requirements
3. Wire up Next.js API routes with proper CRUD operations
4. Add **NextAuth.js** for authentication (if auth features requested)
5. Generate seed data for development

**Effort:** High (3-5 days)

#### 4D. Incremental Feature Addition (Post-Scaffold)

After scaffold completes, the agent should be able to add features iteratively:

- "Add authentication" → Generates auth pages, middleware, providers using the project's existing design system
- "Add a pricing page" → Generates a responsive pricing component using shadcn/ui with the project's colors
- "Add dark mode toggle" → Adds theme provider and toggle component
- "Add a blog section" → Generates blog list, post detail, MDX configuration

This leverages the existing `nextStepsActionRouter.ts` but with much richer LLM generation that understands the project's design tokens, component library, and routing structure.

**Effort:** Medium (2-3 days)

---

## 7. Implementation Roadmap

### Sprint 1 (Week 1): "The AI Understands Me"

**Goal:** Replace the static template experience with contextual intelligence.

| Day | Task | Priority | Depends On |
|-----|------|----------|------------|
| 1 | 2A: App Blueprint Extractor (LLM structured output) | P0 | — |
| 1-2 | 2C: Remove static preview, build App Blueprint Card UI | P0 | 2A |
| 2 | 1C: Design Pack → shadcn HSL converter utility | P0 | — |
| 2-3 | 2B: Style Intent system (natural language + vibe picker + hex color) | P0 | — |
| 3-4 | 1A: shadcn/ui auto-integration after scaffold | P0 | 1C |
| 4-5 | 3A: Auto-start dev server + open preview in VS Code | P0 | — |

**Outcome:** User types a prompt → sees a unique blueprint → describes their style → app generates with shadcn/ui → dev server auto-starts → real app appears in IDE.

### Sprint 2 (Week 2): "Production Quality Output"

**Goal:** The generated app looks like it was designed by a professional.

| Day | Task | Priority | Depends On |
|-----|------|----------|------------|
| 1-3 | 1B: LLM multi-page generation (layout + 5 pages with shadcn) | P0 | 1A, 2A |
| 3-4 | 2D: Reference import UI (screenshot + URL) | P1 | 2B |
| 4-5 | 3C: Timeline-consistent scaffold cards | P1 | — |
| 5 | Integration testing + polish | — | All above |

**Outcome:** Generated apps have 5+ real pages with shadcn/ui components, proper layouts, and professional styling.

### Sprint 3 (Week 3): "Depth and Polish"

**Goal:** Multi-pass generation for higher quality, plus template marketplace.

| Day | Task | Priority | Depends On |
|-----|------|----------|------------|
| 1-3 | 4A: Multi-pass generation architecture | P1 | 1B |
| 3-4 | 4B: Template marketplace (4 templates: SaaS, E-commerce, Blog, Admin) | P1 | 2A |
| 5 | Smart defaults: app-type → style adaptation | P1 | 2B |

**Outcome:** Generated apps have verified, high-quality components. Users can quick-start from templates.

### Sprint 4 (Week 4): "Expansion"

**Goal:** More frameworks, full-stack capabilities.

| Day | Task | Priority | Depends On |
|-----|------|----------|------------|
| 1-3 | 3B: Expand recipe registry (SvelteKit, Nuxt, T3 Stack) | P1 | — |
| 3-5 | 4C: Database/backend auto-configuration (Prisma + NextAuth) | P2 | 1B |
| 5 | 4D: Post-scaffold incremental feature addition | P2 | 1B |

**Outcome:** Support for 6+ frameworks with optional full-stack capabilities.

---

## 8. Architecture Decisions

### Decision 1: No Static Preview Before Generation

**Choice:** Remove all static design mockups. The App Blueprint (text/structure) replaces visual previews. The real app (auto-started dev server) is the only visual preview.

**Rationale:**
- Static mockups create a "template" perception that undermines AI intelligence
- Every competitor (v0, Bolt, Lovable) skips pre-generation visual previews
- The App Blueprint communicates understanding without visual commitment
- The real app, running in VS Code's side panel, is infinitely more impressive than any mockup

**Alternative Considered:** LLM-generated per-prompt visual preview (dynamic mockup).
**Rejected Because:** Adds 3-5 seconds of latency, may not match final output (setting wrong expectations), and still feels like a mockup rather than the real thing. Better to invest that LLM call into actual generation quality.

### Decision 2: Style Intent Over Design Packs

**Choice:** Replace the 12-pack picker with Style Intent (natural language + vibe categories + hex color input). LLM generates tokens contextually per app type.

**Rationale:**
- Removes the "only 12 options" ceiling that makes users feel limited
- Natural language is the most intuitive input for any user
- Contextual generation means same style description + different app type = different tokens
- At scale, 1000 users get 1000 unique palettes instead of ~83 per pack

**Fallback:** Curated packs remain as fallback when LLM is unavailable. They also serve as seed data for vibe categories and test fixtures.

### Decision 3: shadcn/ui as Default Component Library

**Choice:** Make shadcn/ui the default for all React-based recipes (Next.js, Vite, Remix).

**Rationale:**
- Industry standard (v0.dev, most modern React apps use it)
- Tailwind-native (aligns with our design token system)
- Copy-paste model (no vendor lock-in for users)
- Excellent accessibility built-in
- Extensive component library (40+ components)
- CSS variables map directly to our design token system

**Alternative Considered:** Generating raw HTML/Tailwind (current approach).
**Rejected Because:** Users expect component-library-quality output. Raw Tailwind is perceived as "not designed."

### Decision 4: App Blueprint as Intermediate Representation

**Choice:** Extract a structured App Blueprint (JSON) from the user's prompt before generation. This blueprint drives both the proposal UI and the generation pipeline.

**Rationale:**
- Proves the AI understood the specific prompt (not a template)
- Gives the user a chance to review/modify the plan before generation
- The same blueprint drives code generation (pages, components, data models)
- Enables scope estimation (file count, generation time)
- Can be stored in events for session replay

**Inspired By:** Google Stitch's "blueprint review" step, AsciiKit's pattern-based wireframing, A2UI's structured component schemas.

### Decision 5: Multi-Pass Generation for Complex Apps

**Choice:** Implement multi-pass generation for apps with 5+ pages.

**Rationale:**
- Single-pass overwhelms the LLM context window and produces lower-quality output
- Multi-pass allows: (1) layout first, (2) components individually, (3) page composition, (4) polish
- Each pass can be verified independently (catch errors early)
- Component-level generation matches how real apps are actually built

**For Simple Apps:** Single-pass remains fine (1-3 pages).

### Decision 6: CLI-First Scaffold + Enhancement

**Choice:** Continue using official CLIs (`create-next-app`, etc.) for initial project creation, then enhance with shadcn + generated pages.

**Rationale:**
- Official CLIs are always up-to-date with latest framework versions
- Include proper configs, TypeScript, ESLint, etc.
- Community-standard project structure
- We enhance afterwards (shadcn init, design tokens, multi-page generation)

**Alternative Considered:** Custom file generation from templates.
**Rejected Because:** Templates go stale; CLI tools are maintained by framework teams.

### Decision 7: Live Preview via VS Code Simple Browser

**Choice:** Auto-start dev server and open the real app in VS Code's Simple Browser panel (side by side with code).

**Rationale:**
- Shows the REAL app, not a mockup
- Users can see code and preview simultaneously
- Hot reload means edits via Mission mode are instantly visible
- No external browser dependency
- ProcessManager already handles dev server lifecycle

**Alternative Considered:** Screenshot capture and display in timeline card.
**Rejected Because:** Static screenshots don't convey interactivity. The real running app is far more impressive.

---

## 9. Success Metrics

### Quality Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| **Output "looks designed"** | 2/10 | 8/10 | User survey, A/B testing |
| **Pages generated per scaffold** | 1 (landing) | 5-8 (real app) | Count generated route files |
| **Component library usage** | 0% | 100% (React recipes) | Check for shadcn imports |
| **Design uniqueness** | 12 fixed palettes | Infinite (AI-generated) | Count distinct token sets across users |
| **Time to first preview** | Manual (never auto) | Auto (<60s after generation) | Measure time to dev server ready |
| **Blueprint accuracy** | N/A (no blueprint) | >85% match to prompt intent | User rates "did the AI understand what I asked for?" |

### User Experience Metrics

| Metric | Current | Target | Notes |
|--------|---------|--------|-------|
| **"I'd use this for a real project"** | ~20% | >70% | The key signal of production quality |
| **"The design matches what I wanted"** | ~30% | >80% | Style Intent should dramatically improve this |
| **"I need to redo significant parts"** | ~80% | <30% | Multi-page generation + shadcn should reduce rework |
| **"The AI understood my request"** | ~40% | >90% | App Blueprint should prove understanding |
| **"Every app feels unique"** | ~10% | >80% | Style Intent + contextual generation |
| **"The preview impressed me"** | ~20% | >85% | Real app preview vs. static mockup |

### Technical Metrics

| Metric | Current | Target |
|--------|---------|--------|
| **Verification pass rate** | ~60% | >90% |
| **Build success rate (npm run build)** | ~70% | >95% |
| **Auto-fix success rate** | ~40% | >70% |
| **Framework support** | 3 | 6+ |
| **Blueprint extraction success rate** | N/A | >95% |
| **Style token WCAG AA compliance** | ~80% | 100% |
| **Dev server auto-start success rate** | 0% (manual) | >90% |

### Anti-Metrics (Things We Want to AVOID)

| Anti-Metric | Description | Threshold |
|-------------|-------------|-----------|
| **Template sameness** | Users report "all apps look the same" | <5% of feedback |
| **Style frustration** | Users can't get the style they want | <10% of sessions |
| **Blueprint confusion** | Users don't understand the blueprint card | <15% of users |
| **Preview latency** | Time from "Generate" click to seeing real app | <90 seconds |

---

## Appendix: Design Pack Token Reference

### Current Token Structure
```typescript
interface DesignTokens {
  colors: {
    primary: string;           // Main brand color (#hex)
    secondary: string;         // Secondary/accent
    accent: string;            // Highlight/CTA
    background: string;        // Page background
    foreground: string;        // Primary text
    muted: string;             // Muted backgrounds
    border: string;            // Border color
    primary_foreground?: string;
    secondary_foreground?: string;
    accent_foreground?: string;
    muted_foreground?: string;
  };
  fonts: {
    heading: string;           // Google Font name
    body: string;
  };
  radius: 'sm' | 'md' | 'lg';
  density: 'compact' | 'default' | 'relaxed';
  shadow: 'none' | 'subtle' | 'medium' | 'dramatic';
}
```

### Proposed Enhanced Token Structure
```typescript
interface EnhancedDesignTokens extends DesignTokens {
  colors: DesignTokens['colors'] & {
    // Additional semantic colors for richer UIs
    destructive: string;         // Error/delete actions
    destructive_foreground: string;
    success: string;             // Success states
    warning: string;             // Warning states
    info: string;                // Info states
    card: string;                // Card backgrounds
    card_foreground: string;
    popover: string;             // Popover/dropdown backgrounds
    popover_foreground: string;
    ring: string;                // Focus ring color
  };
  // HSL variants for shadcn compatibility
  hsl: Record<string, string>;
  // Dark mode variant
  darkMode?: Partial<EnhancedDesignTokens['colors']>;
  // Animation preferences
  animation: 'none' | 'subtle' | 'playful';
}
```

### shadcn CSS Variable Mapping
```css
/* Design Pack Token → shadcn CSS Variable */
--background: {hsl(background)};
--foreground: {hsl(foreground)};
--card: {hsl(card)};
--card-foreground: {hsl(card_foreground)};
--popover: {hsl(popover)};
--popover-foreground: {hsl(popover_foreground)};
--primary: {hsl(primary)};
--primary-foreground: {hsl(primary_foreground)};
--secondary: {hsl(secondary)};
--secondary-foreground: {hsl(secondary_foreground)};
--muted: {hsl(muted)};
--muted-foreground: {hsl(muted_foreground)};
--accent: {hsl(accent)};
--accent-foreground: {hsl(accent_foreground)};
--destructive: {hsl(destructive)};
--destructive-foreground: {hsl(destructive_foreground)};
--border: {hsl(border)};
--input: {hsl(border)};
--ring: {hsl(ring)};
--radius: {radius_to_rem(radius)};
```

---

## Appendix B: App Blueprint Schema

The structured output schema for App Blueprint extraction:

```typescript
interface AppBlueprint {
  app_type: 
    | 'dashboard_saas' 
    | 'ecommerce' 
    | 'blog_portfolio' 
    | 'social_community' 
    | 'landing_page' 
    | 'admin_panel' 
    | 'mobile_app'
    | 'documentation'
    | 'marketplace'
    | 'custom';

  app_name: string;

  primary_layout: 'sidebar' | 'header_only' | 'full_width' | 'centered' | 'split';

  pages: Array<{
    name: string;
    path: string;           // e.g., "/projects/[id]"
    description: string;    // What this page does (shown in blueprint card)
    key_components: string[];
    layout: 'sidebar' | 'full_width' | 'centered';
    is_auth_required: boolean;
  }>;

  data_models: Array<{
    name: string;           // e.g., "Project"
    fields: string[];       // e.g., ["name", "description", "status", "created_at"]
  }>;

  shadcn_components: string[];   // Which shadcn components to install

  features: Array<{
    name: string;           // e.g., "Authentication"
    description: string;
    complexity: 'low' | 'medium' | 'high';
  }>;

  scope_files: number;
}
```

---

## Appendix C: Style Intent Resolution Flow

```
User Input
    │
    ├─ Natural Language ("dark modern with purple") ─────┐
    │                                                     │
    ├─ Vibe Category ("Bold & Vivid") ──────────────────┐│
    │                                                    ││
    ├─ Hex Color ("#8b5cf6") ───────── paletteGenerator  ││
    │                                  (no LLM needed)   ││
    │                                       │            ││
    ├─ Reference Image ── visionAnalyzer ───┤            ││
    │                                       │            ││
    ├─ Reference URL ── referenceBuilder ───┘            ││
    │                                                    ││
    │  ┌─────────────────────────────────────────────┐   ││
    │  │         styleIntentResolver.ts               │   ││
    │  │                                             │   ││
    │  │  Combines:                                  │   ││
    │  │  - User's style input (any path above)     │◄──┘│
    │  │  - App type from Blueprint                 │◄───┘
    │  │  - App-type default style preferences      │
    │  │                                             │
    │  │  Routes to:                                 │
    │  │  - LLM token generation (NL + vibe)        │
    │  │  - Algorithmic generation (hex color)       │
    │  │  - Fallback curated pack (offline)          │
    │  └──────────────┬──────────────────────────────┘
    │                 │
    │                 ▼
    │         DesignTokens (unique per request)
    │                 │
    │                 ▼
    │         shadcn CSS variables (HSL format)
    │                 │
    │                 ▼
    │         globals.css / tailwind.config.ts
    │
    ▼
  Generation with tokens applied
```

---

## Appendix D: Competitive Research Summary

### v0.dev (Vercel) — Feb 2026
- Now uses **Vercel Sandbox** (lightweight VM) for production-parity previews
- Full editor + preview in one interface
- **Design Mode**: real-time visual tweaks without token usage
- Registry specification for design system context
- No pre-generation preview — generates first, shows live result

### Bolt.new (StackBlitz) — Feb 2026  
- **WebContainers** technology runs full Node.js in browser
- 7+ framework support (React, Next, Vue, Svelte, Angular, etc.)
- Supabase integration for instant backend
- Live preview updates as code streams
- No pre-generation preview — streams code directly to preview

### Lovable — Feb 2026
- Design-first MVP generation
- Native Supabase + GitHub sync
- Visual editor for non-technical users
- ~12 minute full app generation
- No pre-generation preview — shows progress then live result

### Google Stitch — Feb 2026
- Built on **Gemini 2.5 Pro/Flash** (now Gemini 3)
- Text-to-UI and image-to-UI conversion
- Generates multiple design variants for exploration
- Produces HTML/CSS + Figma export
- Progressive: prompt → design → code

### Google A2UI Protocol — 2025
- Declarative JSON protocol for agent-generated UI
- Client sends component schema, agent generates constrained JSON
- Framework-agnostic (React, Flutter, Angular)
- Streaming JSONL format for progressive rendering
- Used in production: Opal, Gemini Enterprise

### AsciiKit
- 79 ASCII wireframe patterns organized by interface type
- Pattern-based approach: AI selects layouts from a library
- Token-efficient text format works with any LLM
- Bridges gap between vague descriptions and visual prototypes

### json-render (Vercel Labs)
- Component catalog pattern for guardrailed AI generation
- Define allowed components + props → AI generates constrained JSON
- Supports React + React Native rendering
- App-type-specific catalogs enable contextual generation

---

*This document will be updated as implementation progresses. Each phase completion should be reflected here with actual results vs. targets.*
