# Step 35.7: Non-Empty Directory + Monorepo Targeting

## Summary

Implemented enterprise-safe scaffold preflight detection that prevents data loss when scaffolding into non-empty directories or monorepos. All decisions are event-driven for replay/audit safety.

## Files Changed

### New Files
1. **packages/core/src/scaffold/preflightDetection.ts** - Core detection logic
   - `TargetDirInspection` interface with 16+ signals
   - `inspectTargetDirectory()` - Deterministic directory analysis
   - `getPreflightRecommendation()` - Decision recommendation engine
   - `buildPreflightDecisionPayload()` - UI-ready decision options
   - `suggestMonorepoPaths()` - Intelligent monorepo placement
   - `validateDestructiveConfirmation()` - Typed confirmation validation
   - `isPathWithinTarget()` - Path traversal protection
   - `wouldOverwriteFile()` - Overwrite detection

2. **packages/core/src/scaffold/preflightOrchestrator.ts** - Decision orchestration
   - `PreflightOrchestrator` class - Event-driven orchestration
   - `validateFileWrite()` - File write safety guard
   - `validateAllFileWrites()` - Batch validation
   - `derivePreflightStateFromEvents()` - Replay-safe state derivation

3. **packages/webview/src/components/PreflightDecisionCard.ts** - UI components
   - `renderPreflightDecisionCard()` - Decision card rendering
   - `renderTypedConfirmModal()` - Destructive action confirmation modal
   - `initTypedConfirmModal()` - Modal interaction handlers

4. **packages/core/src/__tests__/preflightDetection.test.ts** - Test suite
   - Directory inspection tests
   - Monorepo detection tests
   - Recommendation logic tests
   - Destructive confirmation tests
   - Path traversal protection tests

### Modified Files
1. **packages/core/src/eventNormalizer.ts** - Added Step 35.6 and 35.7 events
2. **packages/core/src/types.ts** - Added new event types (previous step)

## Key Features

### A. Directory Detection (Deterministic)
```typescript
interface TargetDirInspection {
  absPath: string;
  exists: boolean;
  entriesCount: number;
  isEmpty: boolean;
  
  // Project signals
  hasPackageJson: boolean;
  hasNodeModules: boolean;
  hasGit: boolean;
  hasSrcDir: boolean;
  hasAppDir: boolean;
  hasNextConfig: boolean;
  hasViteConfig: boolean;
  hasExpoAppJson: boolean;
  isProjectLike: boolean;
  
  // Monorepo signals
  isMonorepo: boolean;
  monorepoType?: 'pnpm' | 'yarn' | 'lerna' | 'nx' | 'turbo' | 'unknown';
  hasAppsDir: boolean;
  hasPackagesDir: boolean;
  workspaceFile?: string;
  detectedPackageManager?: 'npm' | 'yarn' | 'pnpm';
}
```

### B. Decision Events (Replay-Safe)
- `scaffold_preflight_completed` - Inspection results
- `scaffold_preflight_decision_needed` - User decision required
- `scaffold_preflight_decision_taken` - User's choice recorded
- `scaffold_write_blocked` - Safety block triggered

### C. UX Options
1. **Create in new subfolder** (recommended default)
2. **Choose monorepo location** (for monorepos)
3. **Replace existing** (requires typed confirmation: `DELETE_AND_REPLACE`)
4. **Choose different directory**
5. **Abort**
6. **Enhance existing** (disabled - Step 36)

### D. Safety Guarantees
- Path traversal prevention via `isPathWithinTarget()`
- Overwrite detection via `wouldOverwriteFile()`
- Destructive confirmation requires exact text match
- All decisions recorded as events for audit

### E. Monorepo Support
Detects: pnpm, yarn workspaces, lerna, nx, turbo

Suggests placement:
- `/apps/<name>` if apps/ exists
- `/packages/<name>` if packages/ exists
- Root subfolder as fallback

Auto-detects package manager:
- pnpm-lock.yaml → pnpm
- yarn.lock → yarn
- Default → npm

## Event Payloads

### scaffold_preflight_decision_needed
```typescript
{
  target_directory: string;
  problem: 'NON_EMPTY_DIR' | 'EXISTING_PROJECT' | 'MONOREPO_AMBIGUOUS';
  summary: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    dangerous?: boolean;
    requires_typed_confirm?: boolean;
    default?: boolean;
    data?: Record<string, unknown>;
  }>;
}
```

### scaffold_preflight_decision_taken
```typescript
{
  option_id: string;
  selected_path?: string;
  typed_confirm_text?: string;
}
```

## Integration Points

1. **scaffoldFlow.ts** - Call `inspectTargetDirectory()` before proposal
2. **scaffoldApplyExecutor.ts** - Use `validateFileWrite()` before each write
3. **ScaffoldCard.ts** - Render preflight decision UI
4. **MissionFeed.ts** - Map new event types to cards

## Stop Condition Verification

✅ Non-empty folder never overwrites silently
✅ Monorepo users can place app with 1 click
✅ Destructive replace requires `DELETE_AND_REPLACE` confirmation
✅ All decisions recorded as events for replay/audit

## Non-Goals (Deferred)
- Full "enhance existing project" (Step 36+)
- Advanced repo refactors
- LLM-based guessing

## Testing
Run: `cd packages/core && pnpm test preflightDetection`

Tests cover:
- Empty/non-empty directory detection
- Next.js, Vite, Expo project detection
- pnpm, yarn, lerna, nx, turbo monorepo detection
- Recommendation logic for all scenarios
- Destructive confirmation validation
- Path traversal protection
