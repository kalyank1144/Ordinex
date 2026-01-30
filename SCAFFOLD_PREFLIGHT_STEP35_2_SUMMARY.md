# Step 35.2 — Scaffold Safety Preflight

## Summary

Step 35.2 adds a **Safety Preflight** phase to the greenfield scaffold flow. Before any files are created, the system:
1. Determines a deterministic target directory for the new project
2. Detects non-empty directories and blocks by default
3. Detects monorepos and proposes appropriate subfolders (apps/ or packages/)
4. Emits replay-safe events for all decisions

**No actual scaffolding is executed yet** — this step only performs safety checks and records decisions as events.

---

## Files Changed

### New Files
| File | Purpose |
|------|---------|
| `packages/core/src/scaffoldPreflight.ts` | Core preflight logic: monorepo detection, directory checks, target resolution |
| `packages/core/src/__tests__/scaffoldPreflight.test.ts` | Comprehensive tests for preflight logic |
| `SCAFFOLD_PREFLIGHT_STEP35_2_SUMMARY.md` | This summary document |

### Modified Files
| File | Changes |
|------|---------|
| `packages/core/src/types.ts` | Added new event types and payload schemas for preflight |
| `packages/core/src/eventNormalizer.ts` | Added mappings for preflight events to primitive types |
| `packages/webview/src/components/ScaffoldCard.ts` | Added rendering for preflight events |

---

## New Events (V1 Payloads)

### scaffold_preflight_started
```typescript
{
  scaffold_id: string;
  workspace_root: string;
  created_at_iso: string;
}
```

### scaffold_target_chosen
```typescript
{
  scaffold_id: string;
  target_directory: string;      // Absolute path
  reason: 'default' | 'monorepo_choice' | 'user_selected' | 'workspace_root';
  app_name?: string;
}
```

### scaffold_preflight_completed
```typescript
{
  scaffold_id: string;
  target_directory: string;
  is_empty_dir: boolean;
  has_package_json: boolean;
  detected_monorepo: boolean;
  monorepo_type?: 'pnpm' | 'turbo' | 'nx' | 'lerna' | 'yarn_workspaces' | 'unknown';
  recommended_locations?: Array<{ label: string; path: string; recommended: boolean }>;
  conflicts?: Array<{ type: PreflightConflictType; message: string }>;
}
```

### scaffold_blocked
```typescript
{
  scaffold_id: string;
  target_directory: string;
  reason: 'non_empty_dir' | 'monorepo_ambiguous' | 'user_cancelled';
  message: string;
}
```

---

## Key Features

### 1. App Name Extraction
Simple regex-based extraction from user prompt:
- "Create an app **called my-app**" → `my-app`
- "Build a project **named dashboard**" → `dashboard`
- Falls back to `my-app` if not detected

### 2. Monorepo Detection
Detects monorepo patterns by checking for:
- `pnpm-workspace.yaml` → pnpm
- `turbo.json` → turbo
- `nx.json` → nx
- `lerna.json` → lerna
- `package.json` with `workspaces` field → yarn_workspaces
- `apps/` or `packages/` folders → unknown

### 3. Target Directory Resolution

**Non-monorepo:**
```
<workspace_root>/<app_name>
```

**Monorepo (apps/ exists):**
```
<workspace_root>/apps/<app_name>  ← recommended
<workspace_root>/packages/<app_name>
<workspace_root>/<app_name>  ← not recommended
```

**Monorepo (only packages/ exists):**
```
<workspace_root>/packages/<app_name>  ← recommended
```

### 4. Directory Safety Checks

**Harmless files** (ignored when checking "empty"):
- `.gitignore`, `.gitattributes`, `.gitkeep`, `.git`
- `README.md`, `LICENSE`
- `.DS_Store`, `Thumbs.db`
- `.editorconfig`

**Conflict detection:**
- `NON_EMPTY_DIR`: Directory has significant files
- `EXISTING_PACKAGE_JSON`: Directory has package.json
- `MONOREPO_AMBIGUOUS`: Both apps/ and packages/ exist

### 5. Decision Points

When conflicts are detected, the system emits `decision_point_needed` with options:

**For non-empty directory:**
1. "Choose Different Folder" (primary)
2. "Create in \<app_name>-new"
3. "Cancel"

**For ambiguous monorepo:**
1. "apps/\<app_name>" (recommended if apps/ exists)
2. "packages/\<app_name>"
3. "Cancel"

---

## UI Rendering

The `ScaffoldCard` component now renders:

| Event Type | Display |
|------------|---------|
| `scaffold_preflight_started` | "Safety Preflight - Checking" with spinner |
| `scaffold_preflight_completed` | Preflight results with target dir, safety badge |
| `scaffold_target_chosen` | Selected target path with reason |
| `scaffold_blocked` | Warning with block reason and help text |

### Safety Badge States:
- ✅ **Safe** - Directory is empty/safe to create
- ⚠️ **Needs Attention** - Conflicts detected, user action required

---

## Replay Safety

All preflight decisions are recorded as events:
1. `scaffold_preflight_started` - marks preflight begin
2. `scaffold_target_chosen` - records chosen target (even if auto-selected)
3. `scaffold_preflight_completed` - records all findings
4. `scaffold_blocked` - if user cancels or conflict prevents progress

On replay, `derivePreflightState()` reconstructs state from events without re-running filesystem checks.

---

## Integration Points

### With scaffoldFlow.ts (Step 35.1)
The `ScaffoldPreflightCoordinator` integrates via:
```typescript
const coordinator = new ScaffoldPreflightCoordinator(eventBus, fsAdapter);
const result = await coordinator.runPreflight(scaffoldId, runId, workspaceRoot, userPrompt);
```

### With Workspace Resolver (Step 32)
Target directory uses the resolved workspace root from Step 32's workspace targeting.

### With Decision System (Step 28)
When `needsDecision === true`, the system emits `decision_point_needed` via the existing decision infrastructure.

---

## Critical Rules Enforced

✅ Never delete/overwrite existing files  
✅ No terminal commands executed  
✅ At most 1 decision point for directory selection  
✅ All results recorded as events (replay-safe)  
✅ No destructive "Replace Everything" option (reserved for future step)  

---

## Test Coverage

The test suite covers:
1. App name extraction patterns
2. Monorepo detection for each marker type
3. Directory state classification (empty vs non-empty)
4. Target resolution rules
5. Decision option building
6. State derivation from events

Run tests with:
```bash
cd packages/core && pnpm test scaffoldPreflight
```

---

## Next Steps (NOT Implemented)

Per spec, these are **explicitly NOT implemented** in Step 35.2:
- Recipe/template generation
- Design packs
- Preview images
- Actual file creation/apply
- Verify/repair integration
- Destructive overwrite mode

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   User Prompt                                │
│         "Create a new React app called dashboard"           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              extractAppName(prompt)                          │
│                    → "dashboard"                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              detectMonorepoType(workspaceRoot)               │
│              detectMonorepoCandidateFolders()                │
│                    → pnpm, { hasApps: true }                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│         resolveScaffoldTargetDirectory()                     │
│              → /workspace/apps/dashboard                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              checkDirectoryState(targetDir)                  │
│                    → { isEmpty: true }                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EVENTS EMITTED                            │
│  ├─ scaffold_preflight_started                               │
│  ├─ scaffold_target_chosen                                   │
│  └─ scaffold_preflight_completed                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              ScaffoldCard UI Rendering                       │
│     Target: /workspace/apps/dashboard                        │
│     Status: ✅ Safe to create                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Definition of Done ✅

1. ✅ Deterministic target directory (absolute path) under workspace root
2. ✅ "Directory not empty" detection with decision_point_needed
3. ✅ Monorepo detection with recommended app path proposal
4. ✅ Scaffold proposal card shows target directory + "Safe to create" status
5. ✅ No project scaffolding executed - only preflight + events
