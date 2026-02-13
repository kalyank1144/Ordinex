# Ordinex — Verified Roadmap

> Last verified: 2026-02-13 (full codebase audit with 8 parallel agents)
> Tests: **1,812 passing** (53 files, all in `packages/core/`)
> Branch: `step-45-settings-panel-and-fixes`
> Architecture: pnpm monorepo — `core` (pure logic) | `extension` (VS Code + FS) | `webview` (UI)

---

## WHAT'S DONE (Verified Working)

These features have **real implementations with tests** — not stubs.

| Feature | Step | Files | Tests | Lines |
|---------|------|-------|-------|-------|
| Event Sourcing (EventStore, EventBus, StateReducer) | 0-10 | 3 core files | Yes | 500+ |
| Modes (ANSWER, PLAN, MISSION) + ModeManager | 11-20 | modeManager.ts | Yes | 170+ |
| Intent Router (heuristic + LLM fallback) | 33-40 | 6 files in intent/ | Yes | 1000+ |
| Greenfield Detector | 35.8 | greenfieldDetector.ts | Yes | 200+ |
| User Command Detector | 34 | userCommandDetector.ts | Yes | 200+ |
| LLM Intent Classifier (Haiku 4.5 fallback) | 40 | llmIntentClassifier.ts | Yes | 150+ |
| Scaffold Flow (recipes, design packs, apply) | 35 | 8 files in scaffold/ | Yes | 2000+ |
| Feature Intelligence (extract, generate, apply) | 35.X | featureExtractor/CodeGenerator/Applicator.ts | 44 tests | 600+ |
| Post-Scaffold Orchestrator + Verification | 35.X/44 | postScaffoldOrchestrator.ts, postVerify.ts | 39 tests | 800+ |
| Quality Gates + Preflight Checks | 43 | qualityGates.ts, preflightChecks.ts | Yes | 500+ |
| Design Packs + Tailwind Config | 35.5 | designPacks.ts | Yes | 400+ |
| Vision Provider | 36 | anthropicVisionProvider.ts | - | 230+ |
| Context Enricher + Session Manager | 40.5 | contextEnricher.ts, sessionContext.ts | Yes | 800+ |
| ProcessManager + Dev Server Wiring | 41/S3 | processManager.ts, scaffoldHandler.ts | Yes | 400+ |
| Settings Panel | 45 | settingsHandler.ts, settingsPanel.ts | - | 500+ |
| CheckpointManagerV2 | 46 | checkpointManagerV2.ts | Yes | 300+ |
| Resume After Crash | 47 | taskPersistence.ts, crashRecoveryPolicy.ts, fsTaskPersistenceService.ts | 36 tests | 320 |
| Undo System | 48 | undoStack.ts, undoContentCapture.ts, fsUndoService.ts | 34 tests | 300 |
| Error Recovery UX | 49 | errorPatterns.ts (30+ patterns), FailureCard.ts | 48 tests | 1080 |
| Autonomy Loop Detection | W3/53 | autonomyLoopDetector.ts (4 detectors) | 29 tests | 221 |
| Decision Records | 54 | decisionStore.ts | Yes | 284 |
| Scope Manager + Impact Assessment | 55 | scopeManager.ts | Yes | 349 |
| Project Memory (V2-V5) | V2-V5 | memoryService.ts, projectMemoryManager.ts, fsMemoryService.ts | 29 tests | 400+ |
| Solution Capture | V3 | solutionCaptureSubscriber.ts | Yes | 150+ |
| Generated Tools (V6-V8) | V6-V8 | toolRegistryService.ts, generatedToolManager.ts, generatedToolRunner.ts | 37 tests | 600+ |
| Agent Mode Policy (V9) | V9 | modeManager.ts (isEscalation, isDowngrade, 4 enforcement boundaries) | 24 tests | 170+ |
| Shared Card Helpers (R0) | R0 | cardHelpers.ts used by 28 card files | - | 100+ |
| Event Tiering (R1) | R1 | 3-tier system in renderers.ts + MissionFeed.ts | - | - |
| Extension Decomposition (R2) | R2 | 8 handler files in handlers/ + IProvider | - | 1654 (ext) |
| Webview Decomposition (R3) | R3 | 13 CSS + 15 JS modules, index.ts: 246 lines | - | - |
| ScaffoldCard Decomposition (R4) | R4 | 7 files in scaffoldRenderers/, ScaffoldCard: 326 lines | - | 1716 |
| User Chat Bubble (I1) | I1 | intent_received as chat bubble | - | - |
| AI Response Bubble (I2) | I2 | plan_created, streaming in assistant bubble | - | - |
| Inline Approval (I3) | I3 | 6 inline types, DiffProposedCard + PlanCard inline buttons | - | - |
| Scaffold Progress Card (S1) | S1 | ScaffoldProgressCard.ts (4-stage checklist) | - | 200+ |
| Scaffold Complete Card (S2) | S2 | ScaffoldCompleteCard.ts (badges + action buttons) | - | 300+ |
| Dev Server ProcessCard Flow (S3) | S3 | scaffoldHandler.ts handleNextStepSelected | - | - |
| SolutionCapturedCard | V5 | SolutionCapturedCard.ts (full card, not placeholder) | - | 162 |
| GeneratedToolCard | V8 | GeneratedToolCard.ts (propose + run cards) | - | 143 |
| ProcessCard | W2 | ProcessCard.ts (status badge, output, actions) | - | 200+ |
| CrashRecoveryCard | 47 | CrashRecoveryCard.ts | - | 100+ |
| FailureCard | 49 | FailureCard.ts (9 categories, recovery buttons) | - | 390 |
| Model Registry (A10) | A10 | modelRegistry.ts (resolveModel, context windows, output limits) | Yes | 200+ |
| Multi-Turn Conversation (A2) | A2 | conversationHistory.ts (sliding window, serialize, token estimation) | 114 tests | 400+ |
| Token Counting (Task #5) | A2 | tokenCounter.ts (TokenCounter interface, improved estimator, validation) | 44 tests | 350+ |
| Anthropic Tool Use (A3) | A3 | toolSchemas.ts, agenticLoop.ts (LLM↔tool loop, max iterations, token budget) | 67 tests | 800+ |
| Staged Edit Buffer (Task #6) | A3 | stagedEditBuffer.ts, stagedToolProvider.ts, loopSessionState.ts | 52 tests | 500+ |
| LoopPausedCard | A3 | LoopPausedCard.ts (stats, staged files, Continue/Approve/Discard) | - | 150+ |
| Retriever + Indexing Wired (A4) | A4 | missionExecutor.ts, missionHandler.ts (real Indexer+Retriever) | - | - |
| TestRunner + Repair Wired (A5) | A5 | missionExecutor.ts, missionHandler.ts (real TestRunner+RepairOrchestrator) | - | - |

**Total: 1,812 tests passing across 53 test files (all in core)**

---

## SECTION A: MUST-HAVE FOR WORKING PRODUCT

These are **blockers** — without them, the extension cannot function as a real coding assistant.

---

### A1. Backend Server (LLM Proxy + Auth + SSE Streaming)

**Status**: NOT STARTED
**Priority**: CRITICAL

**Current state (verified)**:
- 7 direct Anthropic API call sites, each creating its own `new Anthropic({ apiKey })` client
- API key stored in VS Code SecretStorage (`context.secrets.get('ordinex.apiKey')`)
- No rate limiting, usage tracking, or team/org support
- `@anthropic-ai/sdk@^0.32.1` loaded via `require()` in core
- No `packages/server/` directory exists
- No unified `apiClient.ts`

**LLM call sites (all must be refactored)**:

| File | Purpose | Call Type |
|------|---------|-----------|
| `core/src/llmService.ts` | ANSWER mode streaming | `client.messages.stream()` |
| `core/src/llmEditTool.ts` | Mission edit diff generation | `client.messages.create()` |
| `core/src/truncationSafeExecutor.ts` | Chunked edit execution | `client.messages.create()` |
| `core/src/intent/llmIntentClassifier.ts` | Intent classification | Via LLMService |
| `core/src/scaffold/featureExtractor.ts` | Feature extraction | Injected FeatureLLMClient |
| `core/src/scaffold/featureCodeGenerator.ts` | Feature code generation | Injected FeatureLLMClient |
| `core/src/scaffold/postScaffoldOrchestrator.ts` | Auto-fix after verify | Injected client |
| `core/src/vision/anthropicVisionProvider.ts` | Vision/image analysis | Raw `fetch()` |

**API key read locations** (6 handlers):
- `answerHandler.ts:47`, `planHandler.ts:283,924`, `missionHandler.ts:168`
- `submitPromptHandler.ts:266`, `scaffoldHandler.ts:470`, `approvalHandler.ts:649`

**What to build**: A1.1 (Backend HTTP Server), A1.2 (Auth), A1.3 (LLM Proxy), A1.4 (Extension Client Refactor), A1.5 (Database)

---

### A2. Multi-Turn Conversation

**Status**: COMPLETE (Feb 12, 2026)
**Priority**: CRITICAL

**Current state (verified)**:
- Every LLM call sends `messages: [{ role: 'user', content: userQuestion }]` — single-shot, no history
- No `ConversationHistory` class exists anywhere
- `SessionContextManager` tracks topics/file mentions but does NOT store message history for API calls
- User cannot have a back-and-forth conversation

**What to build**:
- [ ] `ConversationHistory` class — stores `{ role, content }[]` per task
- [ ] Sliding window or summarization for context limits
- [ ] Pass history to all LLM calls
- [ ] Token counting for context window management
- [ ] Conversation persistence + clear command

---

### A3. Anthropic Tool Use (Function Calling)

**Status**: COMPLETE (Feb 12, 2026)
**Priority**: HIGH

**Implemented**:
- 6 Anthropic tool schemas in `toolSchemas.ts` (read_file, write_file, edit_file, run_command, search_files, list_directory)
- Full AgenticLoop in `agenticLoop.ts` — LLM↔tool execution loop (max iterations, token budget, event emission, error handling)
- `ToolExecutionProvider` interface (extension implements with real FS/commands via VSCodeToolProvider)
- `LLMClient` interface (matches Anthropic SDK messages.create subset, implemented by AnthropicLLMClient adapter)
- StagedEditBuffer + StagedToolProvider — in-memory staged edits during AgenticLoop (Task #6)
- LoopSessionState — session tracking, continue/approve/discard lifecycle
- LoopPausedCard — webview component for staged edit review
- 67 tests (agenticLoop + vsCodeToolProvider) + 52 tests (agenticLoopIntegration)

---

### A4. Wire Retriever + Code Indexing

**Status**: COMPLETE (Feb 13, 2026)

**Implemented**:
- `Indexer` instantiated in `missionHandler.ts` with workspace root
- `Retriever` created with `(indexer, eventBus, taskId)` and passed to MissionExecutor (replaces `null`)
- `missionExecutor.ts:executeRetrievalStep()` now calls real `this.retriever.retrieve()` with scope limits
- Results stored in `this.retrievalResults` for context injection into subsequent LLM calls
- Graceful fallback: if retriever unavailable, emits placeholder event with 0 results
- Events stream in real-time through EventBus → webview

**Remaining (nice-to-have)**:
- [ ] File watcher for index updates (currently re-indexes on demand)
- [ ] Wire into `contextEnricher.ts` for auto-include in ANSWER mode

---

### A5. Wire DiffManager + Test Runner + Repair Orchestrator

**Status**: COMPLETE (Feb 13, 2026)

**Implemented**:
- All 4x `null` in `missionHandler.ts` replaced with real instances:
  - `DiffManager(taskId, eventBus, approvalManager, checkpointManager, evidenceStore, workspaceRoot)`
  - `TestRunner(taskId, eventBus, approvalManager, testEvidenceStore, workspaceRoot)`
  - `RepairOrchestrator(taskId, eventBus, autonomyController, testRunner, diffManager, approvalManager)`
- `executeTestStep()` now calls real `TestRunner.runTests()`, emits `test_completed` events with stdout/stderr preview, feeds failures to `RepairOrchestrator.captureTestFailure()`
- `executeRepairStep()` now calls real `RepairOrchestrator.startRepair()` which runs bounded A1 repair loop (diagnose→propose→approve→apply→retest)
- `repairOrchestrator` stored on `ctx` for Stop button access
- Full constructor dependency chain: Indexer→Retriever, EventBus+ApprovalManager→DiffManager+TestRunner, TestRunner+DiffManager+AutonomyController→RepairOrchestrator
- All events stream in real-time through EventBus → webview

**Remaining (V1 limitation)**:
- [ ] `diffProposalGenerator.ts` still V1 placeholder (creates markdown docs, not LLM-powered code diffs) — replace with `llmEditTool.ts`

---

### A6. Streaming for All Modes

**Status**: PARTIAL — ANSWER only

**Current state (verified)**:
- ANSWER mode: `client.messages.stream()` → `stream_delta` events → webview (WORKING)
- PLAN mode: `client.messages.create()` — blocks until full response (NO streaming)
- MISSION mode: `client.messages.create()` — blocks (NO streaming)
- Edit generation: `client.messages.create()` — blocks (NO streaming)

**What to build**:
- [ ] SSE streaming from backend (A1.3) for all calls
- [ ] PLAN mode streaming (real-time plan generation)
- [ ] MISSION mode streaming (real-time reasoning)
- [ ] Edit generation streaming (diff construction)

---

### A7. Fix Partial Implementations (Bugs + Gaps)

**Status**: PARTIAL

| Item | Verified Status | What's Needed |
|------|----------------|---------------|
| **Edit Plan button** | NOT IMPLEMENTED — `actions.ts:426` shows `alert('Plan editing will be available in a future version')` | Wire handler in extension for `ordinex:refinePlan` message |
| **Plan Refine button** | UI works (textarea) but NO backend handler | Implement `ordinex:refinePlan` handler in extension |
| **Workspace settings** | Settings UI works, but `submitPromptHandler.ts:473` passes `{}` | Replace `{}` with actual `workspace.getConfiguration('ordinex')` |
| **SolutionCapturedCard** | FULLY IMPLEMENTED (162 lines, wired in MissionFeed) | Done |
| **GeneratedToolCard** | FULLY IMPLEMENTED (143 lines, propose + run cards) | Done |
| **ScaffoldCompleteCard buttons** | FULLY WORKING (dev_server + open_editor) | Done |
| **Approval flow** | FULLY WORKING (6 inline types + standalone fallback) | Done |
| **3x duplicated MODEL_MAP** | FIXED — consolidated into `modelRegistry.ts` (A10) | Done |

---

### A8. Extension + Webview Tests

**Status**: NOT STARTED
**Priority**: HIGH

**Current state (verified)**:
- Core: 1,516 tests in 47 files
- Extension: `echo 'No tests yet'` (0 test files in `packages/extension/`)
- Webview: no test script defined (0 test files in `packages/webview/`)
- 8 handler files with 0 test coverage
- 31 card components with 0 test coverage

**What to build**:
- [ ] Extension handler tests (mock VS Code API, test message routing)
- [ ] Webview component tests (card rendering, state management)
- [ ] Integration tests (extension ↔ webview message flow)
- [ ] Vitest config for extension + webview packages

---

### A9. Onboarding Flow (Step 50)

**Status**: NOT STARTED

**Verified**: No onboarding, welcome, or first-run files exist anywhere in the codebase.

**What to build**:
- [ ] First-run detection (check if API key / auth token exists)
- [ ] Welcome screen in webview
- [ ] API key / login setup wizard
- [ ] Sample prompt suggestions

---

### A10. SDK + Model Map Cleanup

**Status**: COMPLETE (Feb 12, 2026)

**Implemented**:
- `modelRegistry.ts` — single source of truth: `resolveModel()`, `didModelFallback()`, FAST/CAPABLE/EDIT_MODEL constants
- `MODEL_CONTEXT_WINDOWS` and `MODEL_MAX_OUTPUT_TOKENS` maps (Task #5)
- `getContextWindow(modelId)` and `getMaxOutputTokens(modelId)` helpers
- 3 duplicated MODEL_MAPs removed from `llmService.ts`, `llmEditTool.ts`, `truncationSafeExecutor.ts`
- Model IDs updated to latest: `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `claude-sonnet-4-20250514`

**Remaining**:
- [ ] Vision provider still uses raw `fetch()` instead of SDK

---

## SECTION B: NOT YET IMPLEMENTED (Nice-to-Have)

Verified: **no code exists** for any of these.

| Feature | Step | Status |
|---------|------|--------|
| Terminal Integration (VS Code terminal panel) | 42 | NOT STARTED — ProcessManager runs in background only |
| Keyboard Shortcuts | 52 | NOT STARTED — only `ordinex.undo` keybinding exists (Cmd+Shift+Z) |
| Run Export (SHA-256, evidence gating) | 57 | NOT STARTED — no export files found |
| Replay Mode | 58 | NOT STARTED |
| Audit Trail Viewer | 59 | NOT STARTED |
| Multi-File Diff Viewer | 51 | NOT STARTED |
| Git Integration (branch management, PR draft) | 56 | NOT STARTED |
| Multi-Model Support | 57 | NOT STARTED |
| Semantic Code Search | 58 | NOT STARTED |
| Test Generation | 59 | NOT STARTED |
| Documentation Generation | 60 | NOT STARTED |
| Performance Profiling | 61 | NOT STARTED |
| Deployment Pipeline | 62 | NOT STARTED |
| Team Collaboration | 63 | NOT STARTED |
| Plugin System | 64 | NOT STARTED |
| Analytics Dashboard | 65 | NOT STARTED |
| Vision Improvements (multi-image) | - | NOT STARTED |

---

## SECTION C: KNOWN ISSUES (Verified Feedback)

| # | Issue | Present? | Severity | Details |
|---|-------|----------|----------|---------|
| P1-1 | Task persistence sync cleanup | Partial | LOW-MED | `fsTaskPersistenceService.ts` uses `unlinkSync` in async methods. Goes through service (not bypass). |
| P1-2 | ANSWER evidence orphaned | Unclear | N/A | ANSWER mode is stateless by design — evidence only for MISSION/SCAFFOLD. May be intentional. |
| P1-3 | Memory context unredacted | **YES** | MEDIUM | `contextEnricher.ts:644,650` injects raw facts/solutions without `redactSecrets()`. Editor context IS redacted (line 616). |
| P2-1 | Workspace services cached | **YES** | MEDIUM | Lazy singletons (`_memoryService`, `_toolRegistryService`) never invalidated. No `onDidChangeWorkspaceFolders` listener. |
| P2-2 | UI card flicker | Fixed | - | MissionFeed uses incremental `replaceWith()` for process/scaffold cards. |
| P2-3 | Sync FS in hot paths | **YES** | MEDIUM | 44 instances of sync FS ops in extension/webview. Most in init/cleanup, some in answer/attachment handlers. |
| P3-1 | `as unknown as IProvider` cast | **YES** | LOW | Single instance at `extension.ts:883`. Internal code only. |
| P3-2 | No extension/webview tests | **YES** | HIGH | 0 test files in extension/ and webview/. Biggest gap. |

---

## SECTION D: IMPLEMENTATION ORDER (Recommended)

### Phase 1: Backend Foundation (Week 1-2)
```
A1.1 Backend Server Setup
A1.2 Authentication System
A1.5 Database Schema
A1.3 LLM Proxy Endpoints (non-streaming first)
A1.4 Extension Client Refactor
A10  SDK + Model Map Cleanup ✅ DONE (Feb 12, 2026)
```

### Phase 2: Core Intelligence (Week 3-4)
```
A2   Multi-Turn Conversation ✅ DONE (Feb 12, 2026)
A3   Anthropic Tool Use ✅ DONE (Feb 12, 2026)
A6   Streaming for All Modes (SSE from backend)
```

### Phase 3: Wire Missing Pieces (Week 5)
```
A4   Retriever + Code Indexing ✅ DONE (Feb 13, 2026)
A5   DiffManager + TestRunner + Repair ✅ DONE (Feb 13, 2026)
A7   Fix Partial Implementations (Edit Plan, workspace settings)
```

### Phase 4: Polish + Quality (Week 6)
```
A8   Extension + Webview Tests
A9   Onboarding Flow
Fix P1-3 (memory redaction), P2-1 (workspace invalidation)
```

### Phase 5+: Nice-to-Have Features
```
B1-B16 (prioritize based on user feedback)
```

---

## APPENDIX: File Inventory

### Core Package (`packages/core/src/`) — ~70 files

| Area | Key Files |
|------|-----------|
| Event sourcing | `eventStore.ts`, `eventBus.ts`, `stateReducer.ts` |
| Modes | `modeManager.ts`, `types.ts` |
| Intent routing | `intent/intentRouter.ts`, `intent/intentSignals.ts`, `intent/greenfieldDetector.ts`, `intent/llmIntentClassifier.ts`, `userCommandDetector.ts` |
| LLM | `llmService.ts` (782 lines), `llmEditTool.ts` (1018 lines), `truncationSafeExecutor.ts` (932 lines), `modelRegistry.ts`, `tokenCounter.ts` |
| AgenticLoop | `agenticLoop.ts`, `toolSchemas.ts`, `conversationHistory.ts`, `stagedEditBuffer.ts`, `stagedToolProvider.ts`, `loopSessionState.ts` |
| Scaffold | `scaffold/recipeSelector.ts`, `scaffold/recipeRegistry.ts`, `scaffold/scaffoldApplyExecutor.ts`, `scaffold/designPacks.ts`, `scaffold/postScaffoldOrchestrator.ts`, `scaffold/featureExtractor.ts`, `scaffold/featureCodeGenerator.ts`, `scaffold/featureApplicator.ts`, `scaffold/qualityGates.ts`, `scaffold/preflightChecks.ts`, `scaffold/postVerify.ts`, `scaffold/nextSteps.ts` |
| Intelligence | `intelligence/contextEnricher.ts`, `intelligence/memoryService.ts`, `intelligence/projectMemoryManager.ts`, `intelligence/solutionCaptureSubscriber.ts`, `intelligence/toolRegistryService.ts`, `intelligence/generatedToolManager.ts` |
| Retrieval | `retrieval/retriever.ts` (347 lines), `retrieval/indexer.ts` (321 lines) |
| Mission | `missionRunner.ts`, `missionExecutor.ts` (1784 lines), `planGenerator.ts` |
| Diff/Test/Repair | `diffManager.ts`, `diffProposalGenerator.ts` (STUB), `testRunner.ts` (395 lines), `repairOrchestrator.ts` (400+ lines) |
| Safety | `scopeManager.ts` (349 lines), `autonomyLoopDetector.ts` (221 lines), `errorPatterns.ts` (694 lines) |
| Persistence | `taskPersistence.ts`, `crashRecoveryPolicy.ts`, `undoStack.ts`, `undoContentCapture.ts`, `decisionStore.ts` |
| Process | `processManager.ts` |
| Checkpoint | `checkpointManagerV2.ts` |
| Vision | `vision/anthropicVisionProvider.ts` |
| Exports | `index.ts` (1,008 lines, ~60 modules) |

### Extension Package (`packages/extension/src/`) — 16 files

| File | Lines | Purpose |
|------|-------|---------|
| `extension.ts` | 1,654 | Main entry, message routing, lifecycle |
| `handlerContext.ts` | ~60 | IProvider interface |
| `handlers/submitPromptHandler.ts` | ~500 | Intent routing entry point |
| `handlers/answerHandler.ts` | ~300 | ANSWER mode streaming |
| `handlers/planHandler.ts` | ~950 | PLAN mode |
| `handlers/missionHandler.ts` | ~350 | MISSION mode |
| `handlers/scaffoldHandler.ts` | ~1000 | SCAFFOLD mode + dev server |
| `handlers/approvalHandler.ts` | ~700 | Approval resolution |
| `handlers/settingsHandler.ts` | ~200 | API key + settings |
| `handlers/toolsHandler.ts` | ~150 | Generated tool handling |
| `fsMemoryService.ts` | ~150 | FS impl for memory |
| `fsToolRegistryService.ts` | ~100 | FS impl for tool registry |
| `fsTaskPersistenceService.ts` | 122 | FS impl for crash recovery |
| `fsUndoService.ts` | 71 | FS impl for undo |
| `generatedToolRunner.ts` | 295 | Tool execution sandbox |
| `anthropicLLMClient.ts` | ~50 | Wraps Anthropic SDK → LLMClient interface for AgenticLoop |
| `anthropicTokenCounter.ts` | ~50 | Wraps SDK countTokens() → TokenCounter interface |
| `vsCodeToolProvider.ts` | ~200 | Implements ToolExecutionProvider (6 tools against real workspace) |
| `vscodeWorkspaceWriter.ts` | ~100 | File writer |
| `vscodeCheckpointManager.ts` | ~100 | Checkpoint manager |

### Webview Package (`packages/webview/src/`) — 60+ files

| Area | Files |
|------|-------|
| Entry | `index.ts` (246 lines), `settingsPanel.ts` |
| Components | 32 card files in `components/` (MissionFeed.ts is 1,600+ lines, LoopPausedCard.ts) |
| Scaffold renderers | 7 files in `scaffoldRenderers/` (1,716 lines total) |
| CSS | 13 files in `styles/` |
| JS modules | 15 files in `webviewJs/` (state, utils, renderers, actions, etc.) |
