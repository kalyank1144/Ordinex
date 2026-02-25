# Ordinex — Next-Generation Memory System Design

> Created: 2026-02-23
> Status: APPROVED — Ready for implementation
> Architecture: 5 layers, no backend required

---

## Overview

A 5-layer persistent memory system that combines the best of Claude Code (auto-memory, session continuity), OpenCode (ID-based CRUD, dual scope), and Ordinex's unique EventStore advantage (event-triggered extraction instead of timer-based).

**Key differentiators over every existing tool:**
- Event-triggered auto-learning (not timer-based like Claude Code)
- Extractive session compression (no LLM call, uses EventStore structured data)
- Local embedding retrieval (no backend/API cost, WASM-based)
- Event-driven solution capture (already implemented, extended here)

---

## Layer 1: Rules System

**Priority:** First — fastest, highest visibility
**LLM cost:** Zero
**Dependencies:** None

### What it does

Persistent instructions that are always injected into LLM context at session start. Version-controllable, team-shareable.

### Storage layout

```
~/.ordinex/rules.md                          # Global user preferences (all projects)
<workspace>/.ordinex/rules/*.md              # Project-level rules (version-controlled)
```

### Rule file format

```markdown
# Rule: prefer-async-await
<!-- scope: **/*.ts -->

Always use async/await instead of .then() chains.
Prefer try/catch over .catch() for error handling.
```

- File name = rule identifier
- Optional `<!-- scope: glob -->` HTML comment for file-pattern activation
- Rules without scope are always active
- Content is plain markdown, injected verbatim into system prompt

### Precedence (most specific wins)

1. Project rules (`.ordinex/rules/*.md`) — highest
2. Global rules (`~/.ordinex/rules.md`) — lowest

### Implementation

**Core package (`packages/core/src/memory/`):**
- `rulesLoader.ts` — `loadRules(workspaceRoot: string): Promise<Rule[]>`
  - Scans `.ordinex/rules/*.md` in workspace
  - Reads `~/.ordinex/rules.md` for global rules
  - Parses scope comments, returns structured `Rule[]`
- `Rule` type: `{ id: string; scope?: string; content: string; source: 'project' | 'global' }`
- `buildRulesContext(rules: Rule[], activeFile?: string): string`
  - Filters rules by scope (glob match against activeFile)
  - Concatenates into a single context block
  - Prepended to system prompt

**Extension package:**
- `FsRulesService` — reads rules from filesystem
- Wired into `submitPromptHandler.ts` — loads rules and prepends to system prompt

**Tests:**
- Rule loading (project + global)
- Scope filtering (glob matching)
- Precedence resolution
- Missing directories (graceful)
- Empty rules (no-op)

---

## Layer 2: Enhanced MEMORY.md with ID-Based CRUD

**Priority:** Second — builds on existing infrastructure
**LLM cost:** Zero
**Dependencies:** None

### What it does

Upgrades the current append-only `facts.md` to a structured `MEMORY.md` with:
- ID-tagged facts for safe update/delete
- Structured sections (Architecture, Stack, Conventions, Patterns)
- Importance scoring (frequently-referenced facts float to top, stale facts decay)

### Storage layout

```
<workspace>/.ordinex/memory/
  MEMORY.md           # Structured project memory (replaces facts.md)
  solutions/          # Proven solutions (unchanged from current)
    index.json
    <id>.json
```

### MEMORY.md format

```markdown
# Project Memory

## Architecture
- [id:a1b2] This is a pnpm monorepo with core, extension, and webview packages
- [id:c3d4] Event-sourced architecture — all state changes are immutable events

## Stack
- [id:e5f6] TypeScript + Node.js, VS Code extension API
- [id:g7h8] Anthropic Claude API for LLM calls

## Conventions
- [id:i9j0] Use vitest for testing, not jest
- [id:k1l2] All core logic must be pure (no FS imports)

## Patterns
- [id:m3n4] Handler functions take IProvider as first param (not this)
```

### ID generation

Deterministic short-hash: first 4 chars of `sha256(content)`. Collision-safe for <10K facts.

### MemoryService interface changes

```typescript
interface MemoryService {
  // Existing
  readFacts(): Promise<string>;
  appendFacts(lines: string): Promise<number>;
  saveSolution(solution: Solution): Promise<void>;
  loadSolutions(): Promise<Solution[]>;
  loadSolution(id: string): Promise<Solution | null>;

  // New — Layer 2
  readMemory(): Promise<MemoryDocument>;
  addFact(section: MemorySection, content: string): Promise<string>;       // returns ID
  updateFact(id: string, newContent: string): Promise<boolean>;
  removeFact(id: string): Promise<boolean>;
  listFacts(section?: MemorySection): Promise<MemoryFact[]>;
}

type MemorySection = 'architecture' | 'stack' | 'conventions' | 'patterns' | 'general';

interface MemoryFact {
  id: string;
  section: MemorySection;
  content: string;
  createdAt: string;
  lastReferencedAt?: string;
  referenceCount: number;
}

interface MemoryDocument {
  facts: MemoryFact[];
  raw: string;  // Full MEMORY.md content
}
```

### Importance scoring

- Each fact tracks `referenceCount` and `lastReferencedAt`
- When a fact is matched during retrieval, its `referenceCount` increments
- Facts with high reference count appear first within their section
- Facts not referenced in 30+ days get a staleness indicator

### Migration

- Existing `facts.md` content is auto-migrated to `MEMORY.md` under `## General` section
- Each existing line gets an auto-generated ID
- `facts.md` is kept as backup, not deleted

### Context injection

- First 200 lines of `MEMORY.md` are auto-loaded into enriched prompt (like Claude Code)
- Replaces the current tail-30-lines truncation

**Tests:**
- CRUD operations (add, update, remove, list)
- ID generation and collision handling
- Section-based organization
- Migration from facts.md
- Importance scoring and ordering
- Context injection (200-line cap)

---

## Layer 4: Session Continuity (Extractive)

**Priority:** Third — no LLM call needed
**LLM cost:** Zero
**Dependencies:** EventStore

### What it does

At session/task end, extracts structured data from EventStore into a session summary file. On next session start, auto-loads the last 1-2 session summaries.

### Storage layout

```
<workspace>/.ordinex/memory/sessions/
  <task-id>.md        # One file per task/session
```

### Session file format

```markdown
# Session: task_m1abc2
> Date: 2026-02-23T14:30:00Z
> Duration: 12 minutes
> Mode: AGENT

## Files Modified
- src/index.ts (added 15 lines, removed 3 lines)
- src/utils/helper.ts (added 8 lines)

## Commands Run
- pnpm -r test (exit: 0)
- pnpm -r build (exit: 0)

## Decisions Made
- Approved plan to refactor auth middleware
- Rejected scope expansion to include database migration

## Errors Fixed
- TypeError in parseConfig: added null check for optional field
- Build failure: missing import for EventBus

## Status
- Completed successfully
- All tests passing
```

### Extraction logic (no LLM)

Data source is the `EventStore.getEventsByTaskId(taskId)`. Extract from event types:

| Data | Source Event Type | Payload Fields |
|------|-------------------|----------------|
| Files modified | `diff_applied` | `files_changed`, `additions`, `deletions` |
| Commands run | `tool_start` where tool="run_command" | `command`, `exit_code` |
| Decisions | `approval_resolved` | `decision`, `approval_type` |
| Errors fixed | `failure_classified` → `diff_applied` | `failureSignature`, `summary` |
| Duration | First and last event timestamps | `timestamp` |
| Mode | Any event | `mode` |
| Status | `mission_completed` or `loop_completed` | `success` |

### Auto-load on session start

- On new task, load the most recent 2 session files from `.ordinex/memory/sessions/`
- Inject as context: `## Recent Sessions\n<session summaries>`
- Include staleness header: `> Note: These are summaries from previous sessions. They may be outdated.`
- Only load sessions from the last 7 days

### Implementation

**Core package:**
- `sessionCompressor.ts` — `compressSession(events: Event[]): SessionSummary`
  - Pure function, no side effects
  - Extracts structured data from event array
  - Returns `SessionSummary` object
- `sessionSerializer.ts` — `serializeSession(summary: SessionSummary): string`
  - Converts to markdown format

**Extension package:**
- `FsSessionService` — writes/reads session files
- Wired into task lifecycle: compress on task end, load on task start

**Tests:**
- Extraction from various event patterns
- Empty event lists (graceful)
- Markdown serialization
- Auto-load with staleness filtering
- Session file size limits

---

## Layer 3: Auto Memory (Event-Triggered)

**Priority:** Fourth — most complex, needs LLM calls
**LLM cost:** 1 LLM call per trigger event (small prompt, ~500 tokens)
**Dependencies:** EventStore, Layer 2 (MEMORY.md CRUD)

### What it does

Automatically extracts learnings from meaningful events and writes them to MEMORY.md. Uses the EventStore (not a timer) to trigger extraction at precise moments.

### Trigger events

| Trigger Event | What to Extract | MEMORY.md Section |
|---------------|-----------------|-------------------|
| `plan_approved` | Architectural decisions, design choices | `architecture` |
| `failure_classified` + `diff_applied` | Debugging insights, error patterns | `patterns` |
| `mission_completed` (success) | What was built and why, conventions discovered | `conventions` |
| `scaffold_completed` | Project setup choices, stack decisions | `stack` |

### Extraction flow

```
Event fires → Check if trigger pattern matches →
  Gather context (last 5-10 related events) →
  LLM call: "Extract 1-3 key learnings from this sequence" →
  Deduplicate against existing MEMORY.md facts →
  Write new facts via Layer 2 CRUD (addFact)
```

### LLM prompt for extraction

```
You are extracting project learnings from a coding session.

Given these events:
<events>

Extract 1-3 key facts worth remembering for future sessions.
Each fact should be:
- A single line (max 120 chars)
- Actionable or informational (not a narrative)
- Not duplicating existing facts

Existing facts:
<existing_memory>

Return JSON: { "facts": [{ "section": "architecture|stack|conventions|patterns", "content": "..." }] }
```

### Deduplication

Before writing, check each extracted fact against existing MEMORY.md:
- Exact match → skip
- Token overlap > 70% with existing fact → skip (likely duplicate)
- Layer 5 (when implemented): cosine similarity > 0.85 → skip

### Rate limiting

- Max 1 extraction per trigger type per task (prevent spam)
- Max 5 new facts per task total
- Skip extraction if MEMORY.md already has 500+ facts (needs pruning first)

### Implementation

**Core package:**
- `autoMemoryExtractor.ts`
  - `shouldExtract(event: Event, recentEvents: Event[]): TriggerMatch | null`
  - `buildExtractionPrompt(trigger: TriggerMatch, existingFacts: MemoryFact[]): string`
  - `parseExtractionResult(llmResponse: string): NewFact[]`
  - `deduplicateFacts(newFacts: NewFact[], existing: MemoryFact[]): NewFact[]`
- `AutoMemorySubscriber` — subscribes to EventBus, orchestrates extraction

**Extension package:**
- Wired into `extension.ts` event handling (alongside existing solution capture)
- Uses same `LLMClient` as agent mode (user's selected model)

**Tests:**
- Trigger pattern matching
- Prompt construction
- Result parsing
- Deduplication logic (exact, token overlap)
- Rate limiting
- Graceful LLM failure handling

---

## Layer 5: Local Semantic Retrieval (WASM Embeddings)

**Priority:** Fifth — most technically complex
**LLM cost:** Zero (local inference)
**Dependencies:** Layer 2 (MEMORY.md)

### What it does

Replaces keyword tokenization with semantic similarity for solution/fact retrieval. Uses `@huggingface/transformers` (WASM-based, no native binaries) with `all-MiniLM-L6-v2` model (~25MB).

### Why WASM over native ONNX

- `onnxruntime-node` requires platform-specific native binaries (~50-100MB per platform)
- `@huggingface/transformers` uses WebAssembly — works on every platform, no native deps
- Same model quality, slightly slower (~50ms vs ~10ms) but sufficient for <1K facts
- No cross-compilation or platform-specific builds needed for VS Code extension

### Storage layout

```
<workspace>/.ordinex/memory/
  MEMORY.md              # Facts (Layer 2)
  embeddings.json         # Embedding sidecar
  solutions/              # Solutions (existing)
```

### Embedding sidecar format

```json
{
  "model": "all-MiniLM-L6-v2",
  "dimension": 384,
  "entries": {
    "a1b2": { "vector": [0.012, -0.034, ...], "updatedAt": "2026-02-23T..." },
    "c3d4": { "vector": [0.056, 0.012, ...], "updatedAt": "2026-02-23T..." }
  }
}
```

### Embedding lifecycle

- **On fact add/update (Layer 2):** Compute embedding, store in sidecar
- **On fact remove:** Remove from sidecar
- **On query:** Embed the query, compute cosine similarity against all entries, return top-K
- **Lazy loading:** Model loaded on first retrieval query, cached in memory

### Retrieval upgrade

Current `queryRelevantSolutions` in `ProjectMemoryManager`:
```
tokenize(input) → count shared tokens → score = shared * 2 + recency
```

New:
```
embed(input) → cosine_similarity(input_vec, fact_vec) → score = similarity * 0.7 + recency * 0.3
```

Falls back to token overlap if embedding model fails to load.

### Implementation

**Core package:**
- `embeddingService.ts` — interface
  ```typescript
  interface EmbeddingService {
    embed(text: string): Promise<Float32Array>;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    cosineSimilarity(a: Float32Array, b: Float32Array): number;
  }
  ```
- `embeddingRetriever.ts` — semantic retrieval using EmbeddingService
  ```typescript
  querySemanticFacts(query: string, facts: MemoryFact[], topK: number): Promise<ScoredFact[]>
  querySemanticSolutions(query: string, solutions: Solution[], topK: number): Promise<ScoredSolution[]>
  ```

**Extension package:**
- `wasmEmbeddingService.ts` — implements EmbeddingService using `@huggingface/transformers`
- Model auto-downloaded on first use, cached in `~/.ordinex/models/`
- Sidecar read/write in `FsMemoryService`

**Fallback:**
- If WASM runtime fails (rare), falls back to keyword tokenization (current behavior)
- If model download fails, uses BM25 (pure TypeScript, no model needed) as intermediate

**Tests:**
- Cosine similarity calculation
- Embedding sidecar CRUD
- Semantic retrieval vs keyword retrieval comparison
- Fallback behavior
- Model loading/caching

---

## Integration Points

### System prompt injection order

```
1. Rules (Layer 1) — always first
2. MEMORY.md first 200 lines (Layer 2) — project knowledge
3. Recent session summaries (Layer 4) — continuity
4. Editor context + resolved references (existing)
5. User prompt
```

### Event flow for Auto Memory (Layer 3)

```
User prompt → Agent/Plan mode → Events generated →
  EventBus → [existing] Solution Capture Subscriber
           → [new] Auto Memory Subscriber → LLM extraction → MEMORY.md CRUD
           → [new] Embedding update (Layer 5)
```

### Task lifecycle integration (Layer 4)

```
Task start → Load last 2 session summaries → Inject into context
Task end   → Compress EventStore → Write session file
```

---

## Migration Plan

1. **Backward compatible:** Existing `facts.md` auto-migrated to `MEMORY.md`
2. **No breaking changes:** `MemoryService` interface extended (not modified)
3. **Graceful degradation:** Each layer works independently; failure in one doesn't affect others
4. **Feature flags:** Auto Memory (Layer 3) can be disabled via workspace setting

---

## File Inventory (New Files)

### Core package (`packages/core/src/memory/`)
| File | Layer | Purpose |
|------|-------|---------|
| `rulesLoader.ts` | 1 | Load and filter rules by scope |
| `memoryDocument.ts` | 2 | MEMORY.md parser, ID-based CRUD types |
| `sessionCompressor.ts` | 4 | Extract session summary from events |
| `sessionSerializer.ts` | 4 | Serialize/deserialize session markdown |
| `autoMemoryExtractor.ts` | 3 | Event-triggered learning extraction |
| `embeddingService.ts` | 5 | Embedding interface + cosine similarity |
| `embeddingRetriever.ts` | 5 | Semantic retrieval logic |

### Extension package (`packages/extension/src/`)
| File | Layer | Purpose |
|------|-------|---------|
| `fsRulesService.ts` | 1 | Read rules from filesystem |
| `fsSessionService.ts` | 4 | Read/write session files |
| `wasmEmbeddingService.ts` | 5 | WASM-based embedding implementation |

### Test files (`packages/core/src/__tests__/`)
| File | Layers | Tests |
|------|--------|-------|
| `rulesLoader.test.ts` | 1 | ~15 tests |
| `memoryDocument.test.ts` | 2 | ~20 tests |
| `sessionCompressor.test.ts` | 4 | ~15 tests |
| `autoMemoryExtractor.test.ts` | 3 | ~20 tests |
| `embeddingRetriever.test.ts` | 5 | ~15 tests |

**Estimated total: ~85 new tests across 5 test files**

---

## Implementation Order

```
Layer 1: Rules System ─────────────── Fastest, highest visibility
    ↓
Layer 2: Enhanced MEMORY.md ───────── ID-based CRUD, structured sections
    ↓
Layer 4: Session Continuity ───────── Extractive compression (no LLM)
    ↓
Layer 3: Auto Memory ──────────────── Event-triggered extraction (LLM)
    ↓
Layer 5: Local Embeddings ─────────── WASM runtime, cosine similarity
```
