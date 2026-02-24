# Ordinex — Verified Roadmap

> Last verified: 2026-02-24
> Tests: **2,169 passing** (70 core + 5 extension + 2 webview = 77 test files)
> Branch: `step-45-settings-panel-and-fixes`
> Architecture: pnpm monorepo — `core` (pure logic) | `extension` (VS Code + FS) | `webview` (UI)

---

## WHAT'S DONE (Verified Working)

These features have **real implementations with tests** — not stubs.

| Feature | Step | Files | Tests | Lines |
|---------|------|-------|-------|-------|
| Event Sourcing (EventStore, EventBus, StateReducer) | 0-10 | 3 core files | Yes | 500+ |
| Modes (Agent, Plan) + ModeManager | 11-20 | modeManager.ts | Yes | 170+ |
| Intent Router (LLM-first + heuristic fallback) | 33-40 | 7 files in intent/ | Yes | 1200+ |
| Greenfield Detector (offline fallback only) | 35.8 | greenfieldDetector.ts | Yes | 310 |
| LLM Intent Classifier (tool_use + strict schema) | 40+ | intentClassifier.ts | Yes | 115 |
| Scaffold Flow (recipes, design packs, apply) | 35 | 8 files in scaffold/ | Yes | 2000+ |
| Feature Intelligence (extract, generate, apply) | 35.X | featureExtractor/CodeGenerator/Applicator.ts | 44 tests | 600+ |
| Post-Scaffold Pipeline (modular stages) | 35.X/44 | pipelineRunner.ts, 5 stage files, postVerify.ts | 39 tests | 1200+ |
| Quality Gates + Preflight Checks | 43 | qualityGates.ts, preflightChecks.ts | Yes | 500+ |
| Design Packs + OKLCH Engine + Tailwind Config | 35.5 | designPacks.ts, oklchEngine.ts | Yes | 400+ |
| Design System Pipeline (prompt color extraction) | 35.X | stages/designSystem.ts, styleIntentResolver.ts | Yes | 800+ |
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
| Next-Gen Memory System (5-Layer) | P1-3+ | rulesLoader.ts, memoryDocument.ts, sessionCompressor.ts, autoMemoryExtractor.ts, embeddingService.ts + 4 extension services | 150+ tests | 1800+ |
| Solution Capture | V3 | solutionCaptureSubscriber.ts | Yes | 150+ |
| Generated Tools (V6-V8) | V6-V8 | toolRegistryService.ts, generatedToolManager.ts, generatedToolRunner.ts | 37 tests | 600+ |
| Agent Mode Policy (V9) | V9 | modeManager.ts (isEscalation, isDowngrade, 4 enforcement boundaries) | 24 tests | 170+ |
| Shared Card Helpers (R0) | R0 | cardHelpers.ts used by 28 card files | - | 100+ |
| Event Tiering (R1) | R1 | 3-tier system in renderers.ts + MissionFeed.ts | - | - |
| Extension Decomposition (R2) | R2 | 8 handler files in handlers/ + IProvider | - | 1654 (ext) |
| Webview Decomposition (R3) | R3 | 14 CSS + 16 JS modules, index.ts: 246 lines | - | - |
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
| Anthropic Tool Use (A3) | A3 | toolSchemas.ts, agenticLoop.ts (LLM↔tool loop, tool_choice, strict schema) | 67 tests | 800+ |
| Staged Edit Buffer (Task #6) | A3 | stagedEditBuffer.ts, stagedToolProvider.ts, loopSessionState.ts | 52 tests | 500+ |
| LoopPausedCard | A3 | LoopPausedCard.ts (stats, staged files, Continue/Approve/Discard) | - | 150+ |
| Retriever + Indexing Wired (A4) | A4 | missionExecutor.ts, missionHandler.ts (real Indexer+Retriever) | - | - |
| TestRunner + Repair Wired (A5) | A5 | missionExecutor.ts, missionHandler.ts (real TestRunner+RepairOrchestrator) | - | - |
| Streaming All Modes (A6) | A6 | Agent (AgenticLoop streaming), Plan (planGenerator streaming), Mission (missionExecutor streaming), Scaffold (heartbeat streaming) | - | - |
| Plan Refine (A7) | A7 | refinePlan() in planGenerator.ts, ordinex:refinePlan handler in planHandler.ts | - | - |
| Workspace Settings (A7) | A7 | settingsHandler.ts reads/writes vscode.workspace.getConfiguration('ordinex') | - | - |
| Onboarding Flow (A9) | A9 | onboarding.ts (3-slide flow), onboarding.css, extension.ts first-run detection via globalState | - | 580+ |

**Total: 1,845 tests passing across 66 test files (65 core + 1 extension)**

---

## SECTION A: MUST-HAVE FOR WORKING PRODUCT

---

### A1. Backend Server (LLM Proxy + Auth + SSE Streaming)

**Status**: NOT STARTED
**Priority**: CRITICAL

**Current state**:
- 7+ direct Anthropic API call sites, each creating its own `new Anthropic({ apiKey })` client
- API key stored in VS Code SecretStorage (`context.secrets.get('ordinex.apiKey')`)
- No rate limiting, usage tracking, or team/org support
- `@anthropic-ai/sdk` loaded via dynamic import in extension
- No `packages/server/` directory exists

**LLM call sites (all must be refactored)**:

| File | Purpose | Call Type |
|------|---------|-----------|
| `core/src/llmService.ts` | Plan streaming | `client.messages.stream()` |
| `core/src/llmEditTool.ts` | Mission edit diff generation | `client.messages.create()` |
| `core/src/truncationSafeExecutor.ts` | Chunked edit execution | `client.messages.create()` |
| `core/src/intent/intentClassifier.ts` | Intent classification (tool_use) | Via LLMClient |
| `core/src/scaffold/featureExtractor.ts` | Feature extraction | Injected FeatureLLMClient |
| `core/src/scaffold/featureCodeGenerator.ts` | Feature code generation | Injected FeatureLLMClient |
| `core/src/vision/anthropicVisionProvider.ts` | Vision/image analysis | Raw `fetch()` |
| `extension/src/anthropicLLMClient.ts` | Agent mode (AgenticLoop) | `createMessage` / `createMessageStream` |

**What to build**: A1.1 (Backend HTTP Server), A1.2 (Auth), A1.3 (LLM Proxy), A1.4 (Extension Client Refactor), A1.5 (Database)

---

### A2. Multi-Turn Conversation

**Status**: COMPLETE (Feb 12, 2026)

**Implemented**:
- `ConversationHistory` class — stores `{ role, content }[]` per task with sliding window
- Token counting for context window management (`tokenCounter.ts`)
- History passed to AgenticLoop and Plan generation
- 114 tests for conversation history + 44 tests for token counting

---

### A3. Anthropic Tool Use (Function Calling)

**Status**: COMPLETE (Feb 12, 2026; enhanced Feb 23, 2026)

**Implemented**:
- 6 Anthropic tool schemas in `toolSchemas.ts` (read_file, write_file, edit_file, run_command, search_files, list_directory)
- `ToolChoice` type and `strict` support on `ToolSchema` (Feb 23)
- Full AgenticLoop in `agenticLoop.ts` — LLM↔tool execution loop with `tool_choice` forwarding
- `LLMClient` interface with `tool_choice` parameter on both `createMessage` and `createMessageStream`
- `AnthropicLLMClient` adapter forwards `tool_choice` and `strict` to Anthropic SDK
- StagedEditBuffer + StagedToolProvider — in-memory staged edits during AgenticLoop
- LoopSessionState — session tracking, continue/approve/discard lifecycle
- 67 tests (agenticLoop) + 52 tests (integration)

---

### A4. Wire Retriever + Code Indexing

**Status**: COMPLETE (Feb 13, 2026)

**Implemented**:
- `Indexer` instantiated in `missionHandler.ts` with workspace root
- `Retriever` created with `(indexer, eventBus, taskId)` and passed to MissionExecutor
- `missionExecutor.ts:executeRetrievalStep()` calls real `this.retriever.retrieve()`
- Graceful fallback: if retriever unavailable, emits placeholder event with 0 results

**Remaining (nice-to-have)**:
- [ ] File watcher for index updates (currently re-indexes on demand)

---

### A5. Wire DiffManager + Test Runner + Repair Orchestrator

**Status**: COMPLETE (Feb 13, 2026)

**Implemented**:
- All `null` instances in `missionHandler.ts` replaced with real DiffManager, TestRunner, RepairOrchestrator
- Full constructor dependency chain wired
- All events stream in real-time through EventBus → webview

**Remaining (V1 limitation)**:
- [ ] `diffProposalGenerator.ts` still V1 placeholder — replace with `llmEditTool.ts`

---

### A6. Streaming for All Modes

**Status**: COMPLETE

**Implemented**:
- Agent mode: `AgenticLoop` → `onStreamDelta` → `ordinex:missionStreamDelta` (agentHandler.ts)
- Plan mode: `planGenerator.ts` → `streamAnswerWithContext` → `ordinex:planStreamDelta` (planHandler.ts)
- Mission mode: `missionExecutor.onStreamDelta` → `ordinex:missionStreamDelta` (missionHandler.ts)
- Scaffold: Heartbeat-based streaming in `featureCodeGenerator.ts` via `createMessageStream`

---

### A7. Fix Partial Implementations

**Status**: COMPLETE

| Item | Status |
|------|--------|
| **Edit Plan / Refine Plan** | COMPLETE — `ordinex:refinePlan` message handled in `extension.ts:1342`, routed to `handleRefinePlan` in `planHandler.ts:1128`, calls real `refinePlan()` from `planGenerator.ts` |
| **Workspace settings** | COMPLETE — `settingsHandler.ts` reads/writes `vscode.workspace.getConfiguration('ordinex')` for all settings (command policy, autonomy, session persistence, generated tools) |
| **SolutionCapturedCard** | COMPLETE (162 lines, wired in MissionFeed) |
| **GeneratedToolCard** | COMPLETE (143 lines, propose + run cards) |
| **ScaffoldCompleteCard buttons** | COMPLETE (dev_server + open_editor) |
| **Approval flow** | COMPLETE (6 inline types + standalone fallback) |
| **3x duplicated MODEL_MAP** | COMPLETE — consolidated into `modelRegistry.ts` (A10) |

---

### A8. Extension + Webview Tests

**Status**: MINIMAL — biggest quality gap
**Priority**: HIGH

**Current state**:
- Core: 1,821 tests in 65 files
- Extension: 24 tests in 1 file (`fsServices.test.ts`)
- Webview: 0 test files
- 8 handler files with 0 test coverage
- 32+ card components with 0 test coverage

**What to build**:
- [ ] Extension handler tests (mock VS Code API, test message routing)
- [ ] Webview component tests (card rendering, state management)
- [ ] Integration tests (extension ↔ webview message flow)

---

### A9. Onboarding Flow

**Status**: COMPLETE

**Implemented**:
- First-run detection via `globalState.get('ordinex.onboardingCompleted')` in `extension.ts`
- 3-slide overlay: Welcome → Modes → Quick Start with sample prompts
- `onboarding.ts` (206 lines) — slide logic, prompt selection, completion notification
- `onboarding.css` (379 lines) — full styling with animations
- Wiring: extension posts `ordinex:showOnboarding` → `messageHandler.ts` calls `checkOnboarding(true)` → overlay shown
- Completion: `ordinex:onboardingComplete` → extension persists flag to `globalState`
- Sample prompts auto-fill input and set mode

---

### A10. SDK + Model Map Cleanup

**Status**: COMPLETE (Feb 12, 2026)

**Implemented**:
- `modelRegistry.ts` — single source of truth: `resolveModel()`, `didModelFallback()`, FAST/CAPABLE/EDIT_MODEL constants
- `MODEL_CONTEXT_WINDOWS` and `MODEL_MAX_OUTPUT_TOKENS` maps
- `getContextWindow(modelId)` and `getMaxOutputTokens(modelId)` helpers

**Remaining**:
- [ ] Vision provider still uses raw `fetch()` instead of SDK

---

### LLM-First Intent Classification

**Status**: COMPLETE (Feb 23, 2026)

**Implemented**:
- `intentClassifier.ts` — LLM-based classification via Anthropic `tool_use` with `strict: true` and forced `tool_choice: { type: 'tool', name: 'classify_intent' }`
- `intentRouter.ts` rewritten — 5-step LLM-first routing:
  1. `/scaffold` slash override (always wins)
  2. Filesystem quick-reject (`hasPackageJson || fileCount > 10` → AGENT)
  3. LLM classification (PRIMARY path, uses user's selected model)
  4. Heuristic fallback (only for empty/unknown workspaces when offline)
  5. Default → AGENT
- `ToolChoice` type and `strict` field added to `ToolSchema`
- `LLMClient.createMessage` and `createMessageStream` accept `tool_choice` parameter
- `AnthropicLLMClient` forwards `tool_choice` to Anthropic SDK
- `submitPromptHandler.ts` passes `llmClient` + user's `modelId` on `RoutingContext`
- Runtime validation on classifier output (intent enum check, confidence clamping)
- `greenfieldDetector.ts` demoted to offline-only fallback
- 11 new tests in `intentClassifier.test.ts` (mock LLM client, quick-reject, fallback scenarios)

---

## SECTION B: NOT YET IMPLEMENTED (Nice-to-Have)

| Feature | Step | Status |
|---------|------|--------|
| Terminal Integration (VS Code terminal panel) | 42 | NOT STARTED — ProcessManager runs in background only |
| Keyboard Shortcuts | 52 | NOT STARTED — only `ordinex.undo` keybinding exists (Cmd+Shift+Z) |
| Run Export (SHA-256, evidence gating) | 57 | NOT STARTED |
| Replay Mode | 58 | NOT STARTED |
| Audit Trail Viewer | 59 | NOT STARTED |
| Multi-File Diff Viewer | 51 | NOT STARTED |
| Git Integration (branch management, PR draft) | 56 | NOT STARTED |
| Multi-Model Support (OpenAI, Gemini, local) | 57 | NOT STARTED |
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

## SECTION C: KNOWN ISSUES

| # | Issue | Status | Severity | Details |
|---|-------|--------|----------|---------|
| P1-1 | Task persistence sync cleanup | Partial | LOW-MED | `fsTaskPersistenceService.ts` uses `unlinkSync` in async methods |
| P1-3 | Memory context unredacted | **COMPLETE** | MEDIUM | 5-layer memory system: rules, MEMORY.md CRUD, session continuity, auto-memory, semantic retrieval |
| P2-1 | Workspace services cached | **OPEN** | MEDIUM | Lazy singletons never invalidated. No `onDidChangeWorkspaceFolders` listener |
| P2-2 | UI card flicker | Fixed | - | MissionFeed uses incremental `replaceWith()` |
| P2-3 | Sync FS in hot paths | **OPEN** | MEDIUM | 44 instances of sync FS ops in extension/webview |
| P3-1 | `as unknown as IProvider` cast | **OPEN** | LOW | Single instance at `extension.ts`. Internal code only |
| P3-2 | No extension/webview tests | **OPEN** | HIGH | 1 extension test file, 0 webview test files. Biggest gap. See A8. |

---

## SECTION D: IMPLEMENTATION ORDER (Recommended)

### Phase 1: Backend Foundation (Next priority)
```
A1.1 Backend Server Setup
A1.2 Authentication System
A1.5 Database Schema
A1.3 LLM Proxy Endpoints (SSE streaming)
A1.4 Extension Client Refactor (replace direct Anthropic calls)
```

### Phase 2: Quality + Polish
```
A8   Extension + Webview Tests (biggest quality gap)
Fix P1-3 (memory redaction), P2-1 (workspace cache invalidation)
Fix P2-3 (sync FS in hot paths)
```

### Phase 3: Nice-to-Have Features
```
B1-B16 (prioritize based on user feedback)
```

### Already Complete
```
A2   Multi-Turn Conversation ✅
A3   Anthropic Tool Use ✅ (enhanced with tool_choice + strict)
A4   Retriever + Code Indexing ✅
A5   DiffManager + TestRunner + Repair ✅
A6   Streaming for All Modes ✅
A7   Fix Partial Implementations ✅
A9   Onboarding Flow ✅
A10  SDK + Model Map Cleanup ✅
LLM-First Intent Classification ✅
```

---

## APPENDIX: File Inventory

### Core Package (`packages/core/src/`) — ~75 files

| Area | Key Files |
|------|-----------|
| Event sourcing | `eventStore.ts`, `eventBus.ts`, `stateReducer.ts` |
| Modes | `modeManager.ts`, `types.ts` |
| Intent routing | `intent/intentRouter.ts`, `intent/intentClassifier.ts`, `intent/intentSignals.ts`, `intent/greenfieldDetector.ts` |
| LLM | `llmService.ts`, `llmEditTool.ts`, `truncationSafeExecutor.ts`, `modelRegistry.ts`, `tokenCounter.ts` |
| AgenticLoop | `agenticLoop.ts`, `toolSchemas.ts` (with ToolChoice), `conversationHistory.ts`, `stagedEditBuffer.ts`, `stagedToolProvider.ts`, `loopSessionState.ts` |
| Scaffold | `scaffold/pipelineRunner.ts`, `scaffold/pipelineTypes.ts`, `scaffold/stages/` (init, designSystem, featureGeneration, qualityGate, summary), `scaffold/featureExtractor.ts`, `scaffold/featureCodeGenerator.ts`, `scaffold/featureApplicator.ts`, `scaffold/designPacks.ts`, `scaffold/overlayApplier.ts`, `scaffold/debugLog.ts` |
| Intelligence | `intelligence/contextEnricher.ts`, `intelligence/memoryService.ts`, `intelligence/projectMemoryManager.ts`, `intelligence/solutionCaptureSubscriber.ts`, `intelligence/toolRegistryService.ts`, `intelligence/generatedToolManager.ts` |
| Memory System | `memory/rulesLoader.ts`, `memory/memoryDocument.ts`, `memory/sessionCompressor.ts`, `memory/autoMemoryExtractor.ts`, `memory/embeddingService.ts`, `memory/index.ts` |
| Retrieval | `retrieval/retriever.ts`, `retrieval/indexer.ts` |
| Mission | `missionRunner.ts`, `missionExecutor.ts`, `planGenerator.ts` |
| Diff/Test/Repair | `diffManager.ts`, `diffProposalGenerator.ts` (V1 stub), `testRunner.ts`, `repairOrchestrator.ts` |
| Safety | `scopeManager.ts`, `autonomyLoopDetector.ts`, `errorPatterns.ts` |
| Persistence | `taskPersistence.ts`, `crashRecoveryPolicy.ts`, `undoStack.ts`, `undoContentCapture.ts`, `decisionStore.ts` |
| Process | `processManager.ts` |
| Checkpoint | `checkpointManagerV2.ts` |
| Vision | `vision/anthropicVisionProvider.ts` |

### Extension Package (`packages/extension/src/`) — 20 files

| File | Purpose |
|------|---------|
| `extension.ts` | Main entry, message routing, lifecycle, onboarding trigger |
| `handlerContext.ts` | IProvider interface |
| `handlers/submitPromptHandler.ts` | Intent routing entry point (LLM-first) |
| `handlers/agentHandler.ts` | Agent mode (AgenticLoop with streaming) |
| `handlers/planHandler.ts` | Plan mode (streaming + refinePlan) |
| `handlers/missionHandler.ts` | Mission mode (streaming) |
| `handlers/scaffoldHandler.ts` | Scaffold mode + dev server + pipeline logger |
| `handlers/approvalHandler.ts` | Approval resolution |
| `handlers/settingsHandler.ts` | API key + workspace settings |
| `handlers/toolsHandler.ts` | Generated tool handling |
| `anthropicLLMClient.ts` | Wraps Anthropic SDK → LLMClient (with tool_choice) |
| `anthropicTokenCounter.ts` | Wraps SDK countTokens() → TokenCounter |
| `vsCodeToolProvider.ts` | ToolExecutionProvider (6 tools against real workspace) |
| `vscodeWorkspaceWriter.ts` | File writer |
| `vscodeCheckpointManager.ts` | Checkpoint manager |
| `fsMemoryService.ts` | FS impl for memory |
| `fsRulesService.ts` | FS impl for rules (Layer 1) |
| `fsSessionService.ts` | FS impl for session persistence (Layer 4) |
| `fsEnhancedMemoryService.ts` | Enhanced memory with CRUD (Layer 2) |
| `autoMemorySubscriber.ts` | Event-triggered extraction (Layer 3) |
| `wasmEmbeddingService.ts` | WASM embeddings (Layer 5) |
| `fsToolRegistryService.ts` | FS impl for tool registry |
| `fsTaskPersistenceService.ts` | FS impl for crash recovery |
| `fsUndoService.ts` | FS impl for undo |
| `generatedToolRunner.ts` | Tool execution sandbox |

### Webview Package (`packages/webview/src/`) — 60+ files

| Area | Files |
|------|-------|
| Entry | `index.ts` (246 lines), `settingsPanel.ts` |
| Components | 32+ card files in `components/` (MissionFeed.ts, LoopPausedCard.ts, etc.) |
| Scaffold renderers | 7 files in `scaffoldRenderers/` |
| CSS | 14 files in `styles/` (includes onboarding.css) |
| JS modules | 16 files in `webviewJs/` (state, utils, renderers, actions, onboarding, etc.) |
