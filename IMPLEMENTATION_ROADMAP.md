# Ordinex Implementation Roadmap

## Generated: 2026-02-08 | Based on: Ordinex_COMPLETE_MASTER_SPEC.docx

---

## PART 1: STATUS AUDIT — What's Done vs What's Pending

### FULLY IMPLEMENTED (No work needed)

| Step | Component | Status | Key Files | Evidence |
|------|-----------|--------|-----------|----------|
| 40.5 | Intelligence Layer | DONE | `intelligence/codebaseContext.ts` (659 LOC), `sessionContext.ts` (652 LOC), `contextEnricher.ts` | CodebaseContext (18 fields, 14 project types), SessionContext (5 tracking types), ContextEnricher (8 functions), 150+ tests |
| 41 | ProcessManager | DONE | `processManager.ts` (602 LOC) | LongRunningProcess types, ready signals (Vite/Next/CRA/Express), port management, singleton pattern. **NOT yet wired to post-scaffold "Start Dev Server"** |
| 42 | Intent Routing Tests | DONE | `__tests__/intentRoutingHardened.test.ts` (773 LOC), `fixtures/intentRoutingCases.json` | 74 golden test cases, edge case coverage, LLM classifier fallback tests |
| 43 | Scaffold Quality Gates | DONE | `scaffold/preflightChecks.ts` (888 LOC), `scaffold/qualityGates.ts` | 6 checks (directory, monorepo, permissions, disk, git, conflicts), atomic resolution, PreflightCard UI |
| 44 | Post-Scaffold Verification | DONE | `scaffold/postVerify.ts` (689 LOC), `scaffold/postScaffoldOrchestrator.ts` (1325 LOC) | 5-step pipeline, auto-fix with LLM (max 3 attempts), VerificationCard UI |
| 45 | Settings Panel | DONE | `webview/settingsPanel.ts` (607 LOC) | API key (SecretStorage), command policy, autonomy level, session persistence, 3 tab sections |
| 46 | Checkpoint System V2 | DONE | `checkpointManagerV2.ts` (712 LOC), `extension/vscodeCheckpointManager.ts` | createCheckpoint, previewRestore, restoreCheckpoint, pruneOldCheckpoints, CheckpointCreatedCard UI |
| — | Scaffold Intelligence | DONE | `featureExtractor.ts`, `featureCodeGenerator.ts`, `featureApplicator.ts` | LLM extraction + generation + application, truncation retry, scope reduction, 44 tests |
| — | Intent Routing Redesign | DONE | `userCommandDetector.ts`, `intentSignals.ts`, `llmIntentClassifier.ts` | Command phrase patterns, LLM fallback (Haiku 4.5), scaffold guard |
| — | Design Packs + Tailwind | DONE | `designPacks.ts` (770 LOC) | 12 curated packs, generateGlobalsCss, generateTailwindConfig, CSS variable generation |

### PARTIALLY IMPLEMENTED (Need completion/hardening)

| Step | Component | Status | What Exists | What's Missing |
|------|-----------|--------|-------------|----------------|
| 51 | Post-Scaffold Guide | 90% | `NextStepsCard.ts` (568 LOC) with recipe-specific suggestions | Mostly complete — may need polish for feature-aware suggestions |
| 53 | A1 Autonomy Hardening | 60% | `autonomyController.ts` (452 LOC) — budget tracking, iteration limits, state machine | Loop detection (stuck/regressing/oscillating), auto-downgrade from A1→A0, `autonomy_loop_detected` event |
| 54 | Decision Records | 50% | `decisionStore.ts` (285 LOC) — append, refinement, approval tracking | DECISIONS.log writer (human-readable markdown), UI viewer in Logs tab, alternatives_considered field |
| 55 | Scope Expansion | 70% | `scopeManager.ts` (350 LOC), `ScopeExpansionRequestCard` UI | Impact assessment, "Approve for Mission" option, scope editing UI |
| 57 | Run Export | 50% | `runExporter.ts` (150+ LOC) — JSONL + evidence bundling | Checksum (SHA-256), export_version schema compliance, evidence size gating (<1MB embed, else reference), [Export Run] button UI |

### NOT IMPLEMENTED (Full build needed)

| Step | Component | Spec Section | Estimated Effort |
|------|-----------|-------------|-----------------|
| VNext-A | Project Memory + Proven Solutions | Part 2, Sections 2-4 | 3-4 days |
| VNext-B | Generated Tools (Dynamic Tools) | Part 2, Sections 5-6 | 3-4 days |
| VNext-C | Agent Mode Policy | Part 2, Section 10 | 1-2 days |
| 47 | Resume After Crash | Part 5 | 2-3 days |
| 48 | Undo System | Part 5 | 1-2 days |
| 49 | Error Recovery UX | Part 6 | 2-3 days |
| 50 | First-Run Experience | Part 6 | 2-3 days |
| 52 | Keyboard Shortcuts | Part 6 | 1 day |
| 56 | Autonomy Settings UI | Part 7 | 1 day |
| 58 | Replay Mode | Part 8 | 3 days |
| 59 | Audit Trail Viewer | Part 8 | 2 days |
| 60 | Performance Optimization | Part 9 | 2-3 days |
| 61 | Edge Case Hardening | Part 9 | 2-3 days |
| 62 | Dogfooding & Bug Fixes | Part 9 | 5-7 days |
| 63 | LLM Gateway Abstraction | Part 10 | 1-2 days |
| 64 | Usage Tracking | Part 10 | 1 day |
| 65 | Auth Abstraction | Part 10 | 1 day |

---

## ARCHITECTURAL PRINCIPLES

These rules govern ALL implementation steps below. Violations will cause architectural debt that blocks backend migration.

### P1: Core Must Not Write to Disk
The `packages/core/` package defines **types, interfaces, pure logic, and event emission**. It must NEVER perform filesystem writes (`fs.writeFile`, `fs.mkdir`, etc.). All FS side-effects belong in `packages/extension/` behind interfaces defined in core. This keeps core portable for future backend migration (Cloud Run, serverless).

**Pattern:** Core defines `interface FooService { save(data): void }` → Extension implements `class FsFooService implements FooService { ... fs.writeFile ... }` → Extension injects the implementation into core classes via constructor.

### P2: .ordinex/ Subfolder Coexistence
Step 46 (CheckpointManagerV2) already uses `.ordinex/checkpoints/`. New VNext features use sibling subfolders:
- `.ordinex/checkpoints/` — Step 46 (already implemented)
- `.ordinex/memory/` — VNext Project Memory (V2-V5)
- `.ordinex/tools/` — VNext Generated Tools (V6-V8)
- `.ordinex/tasks/` — Step 47 Crash Recovery
- `.ordinex/usage/` — Step 64 Usage Tracking

### P3: Generated Tools Are "Prompt + Best-Effort", NOT a Secure Sandbox
Generated tool execution uses best-effort isolation (env scrubbing, static import scanning, timeouts). This is NOT a security sandbox. The default policy is `ordinex.tools.generated.enabled = "prompt"` — user must approve each execution. The UI must display an explicit warning: *"Tool execution uses best-effort isolation. Review code before approving."*

---

## PART 2: IMPLEMENTATION PLAN — Step by Step

Each step below is self-contained. Complete one before starting the next. Testing is included in each step, not as a separate phase.

---

### PHASE 1: WIRING GAPS + QUICK WINS (3-4 days)

These fix issues where code EXISTS but isn't connected or finished.

---

#### Step W1: Wire ProcessManager to Post-Scaffold "Start Dev Server"
**Priority:** HIGH — Users click "Start Dev Server" in NextStepsCard and nothing happens
**Effort:** 0.5 days
**Files to modify:**
- `packages/extension/src/extension.ts` — Handle `next-step-selected` event for command type
- `packages/core/src/processManager.ts` — Already complete, just needs wiring

**Deliverables:**
1. In extension.ts, add a handler for `next-step-selected` messages from webview
2. When `type === 'command'` and command is a dev server (`npm run dev`, `next dev`, etc.), use `ProcessManager.startProcess()` with the correct cwd (scaffolded project path)
3. Emit `process_started`, `process_ready` events — wire to a ProcessCard in webview
4. When process detects port ready, show "Open in Browser" action in the feed
5. On extension deactivate, call `processManager.stopAll()`

**Test:** Scaffold a project → click "Start Dev Server" → dev server starts → port detected → "Open in Browser" shown

---

#### Step W2: Wire ProcessCard UI Component
**Priority:** HIGH — No UI for running processes
**Effort:** 0.5 days
**Files to create:**
- `packages/webview/src/components/ProcessCard.ts` — New web component

**Deliverables:**
1. ProcessCard shows: process name, status badge (starting/running/ready/stopped/error), port number, last 5 lines of output (expandable)
2. Action buttons: [Open in Browser] (if port detected), [View Logs] (expand output), [Terminate]
3. Register in `packages/webview/src/index.ts`
4. Update MissionFeed to render ProcessCard for `process_started`/`process_ready`/`process_stopped` events

---

#### Step W3: Harden Autonomy Loop Detection (Complete Step 53)
**Priority:** MEDIUM — AutonomyController exists but lacks loop detection
**Effort:** 1 day
**Files to modify:**
- `packages/core/src/autonomyController.ts`

**Deliverables:**
1. Add `LoopDetector` class or methods inside AutonomyController:
   - `isStuck()`: Same diff hash appears twice (hash the proposed diff content)
   - `isRegressing()`: Test pass count decreasing across iterations
   - `isOscillating()`: Alternating between two diff states (ring buffer of last 4 diff hashes)
   - `isScopeCreeping()`: Files touched outside declared scope (integrate with ScopeManager)
2. Check loop conditions before each iteration in `runIteration()`
3. When loop detected: auto-downgrade from A1 to A0 (emit `autonomy_downgraded` with reason)
4. New events: `autonomy_loop_detected`, `autonomy_downgraded`
5. Add event types to `packages/core/src/types.ts` and `packages/webview/src/types.ts`

**Tests:**
- Same diff twice → isStuck = true → downgrade
- Decreasing test pass count → isRegressing = true → downgrade
- Budget exhausted → emits budget_exhausted

---

#### Step W4: Complete Decision Records (Finish Step 54)
**Priority:** LOW
**Effort:** 0.5 days
**Architectural rule:** Core formats the markdown. Extension writes the file. (See Principle P1.)

**Files to modify:**
- `packages/core/src/decisionStore.ts` — Add `formatDECISIONSLog()` (pure function, returns string)
- `packages/extension/src/extension.ts` — Wire `formatDECISIONSLog()` output to FS write

**Deliverables:**
1. Add `formatDECISIONSLog(decisions: DecisionRecord[]): string` method in core — pure function that reads decision records in memory, returns formatted markdown string. **No FS writes in core.**
2. In extension, call `formatDECISIONSLog()` and write the result to `.ordinex/runs/{run_id}/DECISIONS.log`
3. Add `alternatives_considered` field to DecisionRecord type
4. Format: `## Decision: [type] | [timestamp]\n**Choice:** ...\n**Reasoning:** ...\n**Alternatives:** ...\n**Evidence:** ...`

---

#### Step W5: Complete Run Export (Finish Step 57)
**Priority:** LOW
**Effort:** 0.5 days
**Files to modify:**
- `packages/core/src/runExporter.ts`

**Deliverables:**
1. Add SHA-256 checksum computation over the exported bundle
2. Add `export_version: "1.0"` field to export metadata
3. Evidence size gating: embed if <1MB, reference (path only) if larger
4. Add `[Export Run]` button to completed run cards in webview

---

### PHASE 2: VNEXT — PROJECT MEMORY + PROVEN SOLUTIONS (3-4 days)

The spec says to implement VNext features AFTER Step 45 but BEFORE Step 47. This is the most impactful pending work — it makes Ordinex "remember" what works.

**Architecture:** Core defines `MemoryService` interface + `ProjectMemoryManager` (pure logic). Extension implements `FsMemoryService` (FS reads/writes). Step 46's `.ordinex/checkpoints/` already exists — memory uses `.ordinex/memory/` alongside it.

---

#### Step V1: Add VNext Event Types
**Priority:** HIGH — Foundation for all VNext features
**Effort:** 0.5 days
**Files to modify:**
- `packages/core/src/types.ts` — Add to EventType union
- `packages/webview/src/types.ts` — Mirror the additions
- `packages/core/src/stateReducer.ts` — Accept new types without error

**Deliverables:**
Add these event types:
```
memory_facts_updated
solution_captured
generated_tool_proposed
generated_tool_saved
generated_tool_run_started
generated_tool_run_completed
generated_tool_run_failed
```

Add payload interfaces for each (as specified in spec Section 3.2).

**Test:** Emit each new event type → no errors from stateReducer/eventNormalizer → events replay correctly

---

#### Step V2: Implement ProjectMemoryManager (Core Interface + Extension FS Service)
**Priority:** HIGH — Core of the "intelligent memory" system
**Effort:** 1.5 days
**Architectural rule:** Core defines types + pure logic + interface. Extension owns all FS writes. (See Principle P1.)

**Files to create:**
- `packages/core/src/intelligence/memoryService.ts` — Interface + types
- `packages/core/src/intelligence/projectMemoryManager.ts` — Pure logic (retrieval, scoring, event emission)
- `packages/extension/src/fsMemoryService.ts` — FS implementation

**Deliverables:**

1. **`MemoryService` interface** (in core):
   ```typescript
   interface MemoryService {
     loadFacts(): Promise<string>;
     appendFacts(delta: string): Promise<void>;
     saveSolution(solution: Solution): Promise<void>;
     loadSolutions(): Promise<Solution[]>;
     loadSolution(id: string): Promise<Solution | null>;
   }
   ```

2. **`Solution` type** (in core, v1 schema from spec Section 2.2):
   - id, createdAt, signature (kind + keys), problem, fix, filesChanged, patchSummary, tags
   - **evidence** (structured, not just raw logs):
     - `verification: { type: 'tests' | 'build' | 'lint' | 'manual', command: string, passedAt: string, summary: string }`
     - `tests: { passed: number, failed: number, command: string }` (optional)
     - `logs: string[]` (truncated to last 20 lines)
   - The `verification` field is **required** — a solution without verification proof is not "proven"

3. **`ProjectMemoryManager` class** (in core — NO FS imports, NO `require('fs')`):
   - Constructor takes `memoryService: MemoryService` (injected) + `eventBus: EventBus`
   - `appendFacts(delta: string): Promise<string>` — **delegates** to `memoryService.appendFacts()` (FS write happens in extension's `FsMemoryService`, not here), emits `memory_facts_updated`, returns deltaSummary
   - `captureSolution(solution: Solution): Promise<void>` — validates `evidence.verification` is present, then **delegates** to `memoryService.saveSolution()`, emits `solution_captured`
   - `getMemoryContext(query: string): Promise<{ facts: string, solutions: Solution[] }>` — calls `memoryService.loadFacts()` + `memoryService.loadSolutions()`, applies deterministic keyword retrieval
   - Retrieval rules (deterministic, no embeddings):
     - Exact keyword match on signature.keys, tags, filesChanged, problem/fix text
     - Score by shared tokens + recency
     - Return top 3 solutions + top 30 lines of facts

4. **`FsMemoryService` class** (in extension — owns ALL FS operations):
   - Constructor takes `workspaceRoot: string`
   - Resolves `.ordinex/memory/` paths, ensures directory exists on first call
   - Implements `MemoryService`: reads/writes `facts.md`, reads/writes `solutions/<id>.json`

5. **Wiring** (in `extension.ts`):
   - `const memoryService = new FsMemoryService(workspaceRoot);`
   - `const memoryManager = new ProjectMemoryManager(memoryService, eventBus);`

6. Export `MemoryService`, `Solution`, `ProjectMemoryManager` from `packages/core/src/index.ts`

**Tests (core — with mock MemoryService):**
- captureSolution → memoryService.saveSolution called → `solution_captured` emitted
- appendFacts → memoryService.appendFacts called → `memory_facts_updated` emitted
- getMemoryContext with matching query → returns relevant solutions (scored)
- getMemoryContext with no match → returns empty solutions + all facts

---

#### Step V3: Solution Capture Hook
**Priority:** HIGH — Auto-captures "what worked"
**Effort:** 1 day
**Files to modify:**
- `packages/core/src/stateReducer.ts` or new subscriber file

**Deliverables:**
1. Create a solution capture subscriber that watches for success patterns:
   - `diff_applied` followed by `test_completed` (success)
   - `iteration_succeeded`
   - `mission_completed` (with success status)
2. When triggered:
   - Build Solution object:
     - `signature`: from recent `failure_classified` events or error messages (kind=error_text_hash) or "user_request"
     - `problem/fix`: derive from last edit evidence or patch summary
     - `filesChanged`: from diff manager's recorded changes
     - **`evidence.verification`** (required — this is what makes the solution "proven"):
       - `type`: which check confirmed success — `'tests'` (from `test_completed`), `'build'` (from `build_completed`), `'lint'` (from lint pass), or `'manual'` (user confirmed)
       - `command`: the actual command that passed (e.g. `"npm test"`, `"npm run build"`)
       - `passedAt`: ISO timestamp of the verification event
       - `summary`: one-line result (e.g. `"12 tests passed"`, `"build clean, 0 errors"`)
     - `evidence.tests`: { passed, failed, command } if trigger was test_completed
     - `evidence.logs`: last 20 lines of relevant output
   - **Reject capture** if no verification event is available — do NOT store unverified solutions
   - Call `projectMemoryManager.captureSolution(solution)` (delegates to `memoryService.saveSolution()` — core never touches FS directly)
3. Wire into EventBus as a subscriber

**Test:** Run a mission → fix succeeds → solution automatically captured via MemoryService

---

#### Step V4: Memory Context Injection into Prompts
**Priority:** HIGH — Makes the memory actually useful
**Effort:** 0.5 days
**Files to modify:**
- Wherever prompts are built for MISSION/PLAN edit generation (likely `packages/core/src/llmService.ts` or `contextEnricher.ts`)

**Deliverables:**
1. Before building LLM prompts, call `projectMemoryManager.getMemoryContext(currentTaskDescription)`
2. Inject two compact sections into the system prompt:
   - `"Project Facts (from .ordinex/memory/facts.md):\n..."` (top 30 lines)
   - `"Relevant Proven Solutions (top 3):\n- Problem: X → Fix: Y (files: Z)\n..."` (bullet summaries only, NOT full JSON)
3. Keep injected content under 500 tokens total

**Test:** Create facts + solutions → start a mission → verify LLM prompt includes memory context

---

#### Step V5: SolutionCapturedCard UI
**Priority:** MEDIUM
**Effort:** 0.5 days
**Files to create:**
- `packages/webview/src/components/SolutionCapturedCard.ts`

**Deliverables:**
1. Web component rendering `solution_captured` events:
   - Shows: problem (bold), fix description, filesChanged list, evidence (collapsed)
   - Optional: "Add to facts" quick action button
2. Register in webview index.ts
3. Update MissionFeed.tsx to render for `solution_captured` events

---

### PHASE 3: VNEXT — GENERATED TOOLS (3.5-4.5 days)

Dynamic tool generation with approval gates and best-effort isolated execution.

**Architecture:** Core defines `ToolRegistryService` interface + `GeneratedToolManager` (proposal logic, event emission). Extension implements `FsToolRegistryService` (FS reads/writes) + `GeneratedToolRunner` (execution). Default policy: `ordinex.tools.generated.enabled = "prompt"`. See Principle P3.

---

#### Step V6: Generated Tool Proposal + Approval Flow (Core Interface + Extension FS Service)
**Priority:** MEDIUM
**Effort:** 1.5 days
**Architectural rule:** Core defines types + proposal logic + interface. Extension owns FS writes and execution. (See Principles P1, P3.)

**Files to create:**
- `packages/core/src/intelligence/toolRegistryService.ts` — Interface + types
- `packages/core/src/intelligence/generatedToolManager.ts` — Pure logic (proposal, approval, event emission)
- `packages/extension/src/fsToolRegistryService.ts` — FS implementation

**Deliverables:**

1. **`ToolRegistryService` interface** (in core):
   ```typescript
   interface ToolRegistryService {
     saveTool(name: string, code: string, metadata: ToolMetadata): Promise<void>;
     loadRegistry(): Promise<ToolRegistry>;
     getTool(name: string): Promise<ToolEntry | null>;
     deleteTool(name: string): Promise<void>;
   }
   ```

2. **Types** (in core):
   - `ToolProposal`: name, description, code, readme, inputsSchema, outputsSchema, allow (network, commands)
   - `ToolEntry`: name, description, codeHash, inputsSchema, outputsSchema, allow, createdAt
   - `ToolRegistry`: version, tools (ToolEntry[])
   - Registry schema v1 (from spec Section 2.3)

3. **`GeneratedToolManager` class** (in core — NO FS imports, NO `require('fs')`):
   - Constructor takes `registryService: ToolRegistryService` (injected) + `eventBus: EventBus`
   - `proposeTool(tool: ToolProposal): string` — emits `generated_tool_proposed`, returns proposalId
   - `approveTool(proposalId: string): Promise<void>` — **delegates** to `registryService.saveTool()` (the injected interface — FS write happens in extension's `FsToolRegistryService`, not here), emits `generated_tool_saved`
   - `getRegistry(): Promise<ToolRegistry>` — **delegates** to `registryService.loadRegistry()`
   - `getTool(name: string): Promise<ToolEntry | null>` — **delegates** to `registryService.getTool()`

4. **`FsToolRegistryService` class** (in extension — owns ALL FS operations):
   - Constructor takes `workspaceRoot: string`
   - Resolves `.ordinex/tools/generated/` paths, ensures directory exists on first call
   - Implements `ToolRegistryService`: writes `<name>.js` files, reads/writes `registry.json`

5. **Approval pipeline integration:**
   - On `generated_tool_proposed` → emit `approval_requested` with `kind: "generated_tool"`
   - On `approval_resolved` (approved) → call `approveTool()`
   - On `approval_resolved` (rejected) → do nothing, log rejection

6. **Default policy setting:**
   - `ordinex.tools.generated.enabled`: `"prompt"` (default) | `"auto"` | `"disabled"`
   - Default `"prompt"` means user must approve each tool execution. This is NOT optional.

7. **Wiring** (in `extension.ts`):
   - `const toolRegistry = new FsToolRegistryService(workspaceRoot);`
   - `const toolManager = new GeneratedToolManager(toolRegistry, eventBus);`

---

#### Step V7: Best-Effort Isolated Tool Runner
**Priority:** MEDIUM
**Effort:** 1.5 days
**Architectural rule:** This is NOT a secure sandbox. It is best-effort isolation. The setting `ordinex.tools.generated.enabled` defaults to `"prompt"` — user must approve each execution. (See Principle P3.)

**Files to create:**
- `packages/extension/src/generatedToolRunner.ts`

**Deliverables:**
1. `GeneratedToolRunner` class (in extension — this is where execution happens):
   - `runGeneratedTool(toolName: string, args: any): Promise<ToolRunResult>`
   - **Pre-run gate:** Check `ordinex.tools.generated.enabled` setting:
     - `"disabled"` → reject immediately with `generated_tool_run_failed` (reason: "disabled by policy")
     - `"prompt"` (default) → emit `approval_requested` with `kind: "generated_tool_run"`, wait for user approval
     - `"auto"` → proceed without prompt (power users only)
   - Spawns `node <toolfile>` with JSON args via stdin
   - **Best-effort isolation** (NOT a security guarantee):
     - Timeout: 20 seconds (configurable)
     - Max stdout/stderr: 200KB (truncate beyond)
     - cwd: workspace root only
     - Env scrub: strip secrets, API keys, tokens from `process.env` before spawning
   - **Best-effort static scan:** block if code contains `http`, `https`, `net`, `tls`, `fetch`, `child_process` imports
     - This is a heuristic check, NOT a security boundary. Determined attackers can bypass it.
     - If blocked → emit `generated_tool_run_failed` with reason
2. Event emission:
   - `generated_tool_run_started` → execute → `generated_tool_run_completed` or `generated_tool_run_failed`
   - Include: toolName, args, stdout, stderr, exitCode, durationMs
3. `ToolRunResult` type: stdout, stderr, exitCode, durationMs
4. **UX warning** (shown on first tool run and when policy is `"auto"`):
   - *"Generated tool execution uses best-effort isolation (env scrubbing, import scanning, timeouts). This is NOT a secure sandbox. Always review tool code before approving."*
   - Persisted via `ordinex.tools.generated.warningAcknowledged` setting

**Tests:**
- Policy `"prompt"` → approval_requested emitted → user approves → runs
- Policy `"disabled"` → immediately fails with reason
- Run tool with valid code → completes → stdout captured
- Run tool that times out → killed after 20s → failed event
- Run tool with `require('http')` → blocked before execution → failed event with reason

---

#### Step V8: Generated Tool UI Cards
**Priority:** MEDIUM
**Effort:** 1 day
**Files to create:**
- `packages/webview/src/components/GeneratedToolProposalCard.ts`
- `packages/webview/src/components/GeneratedToolRunCard.ts`

**Deliverables:**
1. `GeneratedToolProposalCard`:
   - Shows: tool name, description, code (collapsed by default), allow policy
   - Buttons: [Approve] [Reject] — wired to approval pipeline
   - Status chips: Proposed → Approved → Saved
   - **Warning banner** (always visible): *"Review the code below before approving. Generated tools run with best-effort isolation, not a secure sandbox."*
2. `GeneratedToolRunCard`:
   - Shows: tool name, args, status (running/completed/failed), duration
   - stdout/stderr collapsed by default, expandable
   - If policy is `"auto"`: show amber badge *"Auto-approved — best-effort isolation"*
   - If run was blocked (static scan): show reason in red
3. **Tool Policy indicator** in Settings Panel (Policies tab):
   - Radio: Disabled / Prompt (default) / Auto
   - Description for Auto: *"Tools run without asking. Uses best-effort isolation only — NOT a secure sandbox."*
4. Register both cards in webview index.ts
5. Update MissionFeed rendering for `generated_tool_*` events

---

### PHASE 4: AGENT MODE POLICY + TRUST (2-3 days)

Prevents auto-escalation and enforces execution boundaries.

---

#### Step V9: Agent Mode Policy (VNext Step 10)
**Priority:** HIGH — Safety critical
**Effort:** 1.5 days
**Files to modify:**
- `packages/core/src/types.ts` — Add/confirm `mode_changed` event type
- `packages/core/src/modeManager.ts` (or equivalent) — Add policy enforcement

**Deliverables:**
1. `mode_changed` event payload:
   - fromMode, toMode, reason, userInitiated (boolean), runId
2. Non-negotiable rules enforced:
   - Auto-switch DOWN is allowed (MISSION → PLAN/ANSWER) with event
   - Auto-switch UP is BLOCKED (PLAN/ANSWER → MISSION) — must go through decision_point_needed
3. Enforcement points:
   - Before applying diffs: check mode allows edits
   - Before running generated tools: check mode allows exec
   - Before executing commands: check mode allows command
4. If user asks to "apply the fix" in PLAN mode:
   - Do NOT auto-switch to MISSION
   - Emit `decision_point_needed`: "Switch to MISSION (write-enabled)?" with options
5. Integration with Generated Tools:
   - `generated_tool_proposed`: allowed in any mode
   - `generated_tool_saved`: requires approval (any mode)
   - `generated_tool_run_*`: only in MISSION mode

**Tests:**
- In PLAN mode, attempt diff_apply → blocked
- In MISSION mode, attempt diff_apply → allowed
- Auto-switch from MISSION to ANSWER (question asked) → mode_changed emitted
- Attempt auto-switch from ANSWER to MISSION → blocked, decision_point emitted

---

### PHASE 5: CRASH RECOVERY + UNDO (3-5 days)

Trust & recovery — the #1 differentiator per the spec.

---

#### Step 47: Resume After Crash
**Priority:** HIGH — Long missions lost to crashes = broken trust
**Effort:** 2-3 days
**Architectural rule:** Core defines interface + types. Extension owns FS persistence. (See Principle P1.)

**Files to create:**
- `packages/core/src/taskPersistence.ts` — `TaskPersistenceService` interface + `PersistedTaskState` type (NO FS imports)
- `packages/extension/src/fsTaskPersistenceService.ts` — FS implementation
- `packages/extension/src/crashRecovery.ts` — Detection + resume flow

**Deliverables:**
1. **`PersistedTaskState` type** (in core):
   - task_id, run_id, status ('running' | 'paused' | 'completed' | 'failed'), mode, current_phase
   - completed_steps[], pending_steps[], original_prompt, plan
   - last_checkpoint_id, started_at, last_updated_at, cleanlyExited (boolean)
2. **`TaskPersistenceService` interface** (in core):
   ```typescript
   interface TaskPersistenceService {
     persistTaskState(state: PersistedTaskState): Promise<void>;
     loadActiveTask(): Promise<PersistedTaskState | null>;
     clearTask(taskId: string): Promise<void>;
   }
   ```
3. **`FsTaskPersistenceService` class** (in extension — owns ALL FS operations):
   - Reads/writes `.ordinex/tasks/active/{task_id}.json`
   - Implements `TaskPersistenceService`
4. Update every phase boundary to call `taskPersistence.persistTaskState()` (via injected interface)
5. Crash detection (in extension activate):
   - Check for tasks with status='running' and cleanlyExited=false
   - These indicate a crash mid-execution
6. Resume flow (show in webview):
   - "Interrupted Task Found: [task description]"
   - "Progress: X/Y steps completed"
   - Options: [Resume] [Restore Checkpoint] [Discard]
7. Clean exit handling:
   - On extension deactivate, mark active tasks as `paused`, set `cleanlyExited=true`

**Tests (core — with mock TaskPersistenceService):**
- Start mission → simulate crash (don't call deactivate) → reactivate → resume prompt shown
- Start mission → clean deactivate → reactivate → resume prompt shown with "paused"
- Click [Resume] → mission continues from last checkpoint
- Click [Discard] → task cleared, fresh state

---

#### Step 48: Undo System
**Priority:** MEDIUM — Granular undo beyond full checkpoint restore
**Effort:** 1-2 days
**Files to create:**
- `packages/core/src/undoStack.ts`

**Deliverables:**
1. `UndoableAction` type:
   - type: 'file_edit' | 'file_create' | 'file_delete' | 'command'
   - filePath, beforeContent, afterContent, timestamp, description
2. `UndoStack` class:
   - `push(action: UndoableAction)`: records action
   - `canUndo(): boolean`
   - `peek(): UndoableAction | null`: preview what would be undone
   - `undo(): UndoableAction | null`: reverts last action, returns it
   - `clear()`: empties stack
   - Max depth: 50 actions
3. Integration points:
   - After every file edit via diff_applied → push to undo stack
   - After every file create → push (beforeContent = null)
4. UI: After any file edit, show "Applied: Updated X.tsx [Undo]" — clicking Undo reverts just that file
5. VS Code command: `ordinex.undo` bound to Cmd+Shift+Z

**Tests:**
- Edit file → undo → file content matches original
- Create file → undo → file deleted
- 51 actions pushed → oldest dropped (max 50)
- Empty stack → canUndo() returns false

---

### PHASE 6: USER EXPERIENCE (4-6 days)

Polish that makes Ordinex feel production-ready.

---

#### Step 49: Error Recovery UX
**Priority:** HIGH — Raw errors destroy trust
**Effort:** 2-3 days
**Files to create:**
- `packages/core/src/errorPatterns.ts`
- `packages/webview/src/components/FailureCard.ts`

**Deliverables:**
1. `ErrorPatternMatcher` with 30+ patterns:
   - `Cannot find module` → "Missing import. Run `npm install` or check the import path."
   - `Port already in use` → "Kill the existing process or use a different port."
   - `EACCES permission denied` → "Permission error. Check file permissions."
   - `ENOSPC no space left` → "Disk full. Free up space."
   - `TypeError: X is not a function` → "Type mismatch. Check function signature."
   - `TS2307 Cannot find module` → "TypeScript module not found. Check tsconfig paths."
   - (30+ more patterns covering common Node/React/Next/TS errors)
2. `FailureCard` web component:
   - Shows: error type badge, human-readable message, file:line reference (clickable)
   - Suggested fix text
   - Action buttons: [Try Again] [Try Different Approach] [Restore Checkpoint] [Fix Manually]
3. Wire to `tool_error`, `test_completed` (failure), `iteration_failed` events
4. Pattern matching: pass error output through `ErrorPatternMatcher.match()` → return best match

---

#### Step 50: First-Run Experience
**Priority:** MEDIUM — First impressions matter
**Effort:** 2-3 days
**Files to create:**
- `packages/webview/src/components/OnboardingWizard.ts`
- `packages/extension/src/onboarding.ts`

**Deliverables:**
1. First-run detection: check `ordinex.onboarding.completed` setting
2. Onboarding wizard (5 steps):
   - Step 1: Welcome — "Welcome to Ordinex" with key value props
   - Step 2: API Key — input field with [Test Connection] button (Phase 1 only)
   - Step 3: Quick Tour — explain ANSWER/PLAN/MISSION modes with visual
   - Step 4: Try It — suggest "Create a todo app" as first scaffold
   - Step 5: Done — show suggested next actions, set `onboarding.completed = true`
3. Feature highlights: on first use of new features (first mission, first diff, first checkpoint), show a one-time tooltip

---

#### Step 52: Keyboard Shortcuts
**Priority:** LOW — Power user feature
**Effort:** 0.5 days
**Files to modify:**
- `packages/extension/package.json` — Add keybindings section

**Deliverables:**
Add to package.json contributes.keybindings:
- `Cmd+Shift+O` → `ordinex.focus` (focus sidebar)
- `Cmd+Shift+N` → `ordinex.newChat` (new conversation)
- `Cmd+Shift+P` → `ordinex.createProject` (scaffold)
- `Cmd+Shift+Z` → `ordinex.undo` (undo last action)
- `Cmd+Enter` → `ordinex.submit` (submit input)
- `Escape` → `ordinex.cancel` (cancel current operation)
- `Cmd+Shift+R` → `ordinex.restoreCheckpoint` (restore latest checkpoint)

Register corresponding VS Code commands in extension.ts activate().

---

#### Step 56: Autonomy Settings UI
**Priority:** LOW — Settings panel already exists, just add autonomy section
**Effort:** 0.5 days
**Files to modify:**
- `packages/webview/src/settingsPanel.ts`

**Deliverables:**
1. Add to Policies tab:
   - Autonomy level radio: A0 (always ask) / A1 (autonomous with budget)
   - Budget limits: Max iterations (slider, 1-10, default 3), Max time (slider, 1-20 min, default 10), Max tool calls (slider, 5-100, default 50)
2. Wire settings to `ordinex.autonomy.*` VS Code config
3. AutonomyController reads these settings on initialization

---

### PHASE 7: EXPORT, REPLAY & AUDIT (5-6 days)

Enterprise features for compliance and debugging.

---

#### Step 58: Replay Mode
**Priority:** MEDIUM
**Effort:** 3 days
**Files to create:**
- `packages/core/src/replaySession.ts`
- `packages/webview/src/components/ReplayControls.ts`

**Deliverables:**
1. `ReplaySession` class:
   - `loadExport(jsonPath: string)`: Load exported run, validate schema, verify checksum
   - `isReplay: true` flag — PREVENTS any real execution (no LLM calls, no file writes, no commands)
   - `next()`: Step to next event
   - `seekTo(index: number)`: Jump to specific event
   - `play(delayMs: number)`: Auto-play with configurable speed
   - `pause()`: Pause auto-play
   - `getCurrentIndex()`: Current position
   - `getTotalEvents()`: Total events
2. ReplayControls web component:
   - Transport: [|<] [<] [Play/Pause] [>] [>|]
   - Timeline scrubber (slider)
   - "Replay Mode - No changes will be made" banner
   - Event counter: "Event 15/87"
3. Wire MissionFeed to accept replay events
4. VS Code command: `ordinex.replayRun` — opens file picker for .json export

---

#### Step 59: Audit Trail Viewer
**Priority:** LOW
**Effort:** 2 days
**Files to create:**
- `packages/webview/src/components/AuditTrailView.ts`

**Deliverables:**
1. Comprehensive run view:
   - Timeline of ALL events (filterable by type)
   - Decision records (from DECISIONS.log)
   - Files changed with inline diffs
   - Commands executed with output
   - Checkpoints created
   - Evidence collected
2. Expand/collapse for each section
3. Accessible from completed run cards and Logs tab

---

### PHASE 8: PRE-LAUNCH POLISH (9-13 days)

Hardening for real-world usage.

---

#### Step 60: Performance Optimization
**Priority:** MEDIUM
**Effort:** 2-3 days

**Deliverables:**
1. Lazy loading of webview UI components (don't load all cards upfront)
2. Event batching: batch rapid-fire events into single webview updates (16ms debounce)
3. Debounced file watching for codebase context (500ms)
4. Efficient diff rendering (virtual scrolling for large diffs)
5. Memory profiling: identify and fix any event store memory leaks for long sessions

---

#### Step 61: Edge Case Hardening
**Priority:** MEDIUM
**Effort:** 2-3 days

**Deliverables:**
Handle gracefully:
1. Very large files (>1MB) — skip indexing, warn user
2. Binary files — detect and skip (check for null bytes in first 8KB)
3. Symlinks — resolve before operations
4. Permission errors — catch and show FailureCard
5. Network timeouts — retry with exponential backoff (max 3 retries)
6. Invalid API keys — detect 401, show clear "API key invalid" message
7. Rate limiting (429) — detect, show "Rate limited. Retrying in Xs."

---

#### Step 62: Dogfooding & Bug Fixes
**Priority:** HIGH
**Effort:** 5-7 days

**Deliverables:**
1. Use Ordinex to build features IN Ordinex for 1-2 weeks
2. Track all bugs found (tag P0/P1/P2)
3. Fix all P0 (crash/data loss) and P1 (broken feature) bugs before V1
4. P2 (cosmetic) can wait for V1.1

---

### PHASE 9: BACKEND PREP (3-4 days)

Interface definitions now, implementations later. No backend code yet — just clean abstractions.

---

#### Step 63: LLM Gateway Abstraction
**Priority:** LOW — Prep for Phase 2
**Effort:** 1-2 days
**Files to create:**
- `packages/core/src/gateway/llmGateway.ts`

**Deliverables:**
1. `LLMGateway` interface:
   - `complete(request: LLMRequest): Promise<LLMResponse>`
   - `stream(request: LLMRequest): AsyncIterable<LLMChunk>`
2. `DirectLLMGateway` class (Phase 1): calls Anthropic/OpenAI directly with user's key
3. `BackendLLMGateway` class (stub): placeholder that will route through Cloud Run
4. Swap existing direct SDK calls to use gateway interface where practical

---

#### Step 64: Usage Tracking Abstraction
**Priority:** LOW
**Effort:** 0.5 days
**Architectural rule:** Core defines interface. Extension owns FS storage. (See Principle P1.)

**Files to create:**
- `packages/core/src/gateway/usageTracker.ts` — `UsageTracker` interface + `UsageRecord` / `UsageSummary` types (NO FS imports)
- `packages/extension/src/fsUsageTracker.ts` — FS implementation

**Deliverables:**
1. **`UsageTracker` interface** (in core):
   - `recordUsage(record: UsageRecord): Promise<void>`
   - `getUsage(period: 'day' | 'week' | 'month'): Promise<UsageSummary>`
2. **`FsUsageTracker` class** (in extension — owns FS operations):
   - Implements `UsageTracker`, stores in `.ordinex/usage/YYYY-MM.json`
3. `UsageRecord` type: model, input_tokens, output_tokens, cost_estimate, timestamp

---

#### Step 65: Auth Abstraction
**Priority:** LOW
**Effort:** 0.5 days
**Files to create:**
- `packages/core/src/gateway/authProvider.ts`

**Deliverables:**
1. `AuthProvider` interface:
   - `getCredentials(): Promise<Credentials>`
   - `isAuthenticated(): Promise<boolean>`
   - `signOut(): Promise<void>`
2. `LocalApiKeyAuth`: reads from VS Code SecretStorage (current behavior)
3. `BackendAuth` (stub): will use OAuth flow (Phase 2)

---

## PART 3: TOTAL EFFORT SUMMARY

| Phase | Description | Steps | Est. Days |
|-------|-------------|-------|-----------|
| 1 | Wiring Gaps + Quick Wins | W1-W5 | 3-4 |
| 2 | VNext: Project Memory | V1-V5 | 3-4 |
| 3 | VNext: Generated Tools | V6-V8 | 3.5-4.5 |
| 4 | Agent Mode Policy | V9 | 1.5-2 |
| 5 | Crash Recovery + Undo | 47-48 | 3-5 |
| 6 | User Experience | 49-50, 52, 56 | 5-7 |
| 7 | Export, Replay & Audit | 58-59 | 5-6 |
| 8 | Pre-Launch Polish | 60-62 | 9-13 |
| 9 | Backend Prep | 63-65 | 3-4 |
| **TOTAL** | | | **36.5-50 days (~7-10 weeks)** |

---

## PART 4: V1 DEFINITION — DONE WHEN

Per the spec, V1 is complete when:

- [ ] User can create a project (scaffold works reliably) ✅ DONE
- [ ] System understands codebase context (Intelligence Layer) ✅ DONE
- [ ] User can start dev server (Step 41 wiring) — **NEEDS W1-W2**
- [ ] User can configure settings (Step 45) ✅ DONE
- [ ] User can recover from failures (checkpoint + restore) ✅ DONE
- [ ] User gets guided setup (Step 50 onboarding) — **NEEDS Phase 6**
- [ ] User can export runs (Step 57) — **NEEDS W5**
- [ ] Autonomy is bounded and safe (Step 53) — **NEEDS W3**
- [ ] All P0/P1 bugs fixed (Step 62) — **NEEDS Phase 8**

**Minimum for V1:** Phases 1 + 5 + 6 (partial) + 8 = ~20-30 days
**Full spec completion:** All phases = ~36-49 days

---

## PART 5: RECOMMENDED EXECUTION ORDER

Optimized for fastest path to V1, with VNext features front-loaded after dev server wiring:

```
Phase 1 (W1+W2)  →  Dev server actually works after scaffold (ProcessManager + ProcessCard)
Phase 2 (V1)     →  VNext event types foundation
Phase 2 (V2-V5)  →  Project Memory (core interface + FsMemoryService + capture + injection + UI)
Phase 3 (V6-V8)  →  Generated Tools (core interface + FsToolRegistryService + runner + UI)
Phase 4 (V9)     →  Agent mode policy (safety — enforces tool/diff/command boundaries)
Phase 1 (W3)     →  Autonomy loop detection (hardening)
Phase 5 (47)     →  Crash recovery (trust differentiator)
Phase 5 (48)     →  Granular undo
Phase 6 (49)     →  Error recovery UX (clear failure messages)
Phase 6 (50)     →  Onboarding wizard
Phase 6 (52, 56) →  Keyboard shortcuts + autonomy settings
Phase 7 (58-59)  →  Replay + audit trail
Phase 8 (60-62)  →  Polish + dogfooding
Phase 9 (63-65)  →  Backend abstractions
Phase 1 (W4-W5)  →  Decision log formatting + export polish
```

**Rationale for order change:**
- W1+W2 first: scaffold → dev server is the most visible user-facing gap
- V1 → V2-V5 → V6-V8 → V9: VNext features build on each other (event types → memory → tools → policy)
- W3 moved after V9: autonomy hardening benefits from mode policy being in place first
- W4-W5 last: low-priority polish that doesn't block V1
