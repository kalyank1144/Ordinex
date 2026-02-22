# Ordinex Implementation Status

## Intelligence Layer Redesign — COMPLETE

### Phase 1: Workspace-Aware Scaffold Detection ✅
- Rewrote `intentRouter.ts` — only two intents: `SCAFFOLD | AGENT`
- Workspace quick reject: `hasPackageJson || fileCount > 10` → AGENT (regex never runs)
- Subdirectory scanning: detects projects at `<workspace>/<app-name>/` after reload
- Deleted `llmIntentClassifier.ts` (241 lines) and `userCommandDetector.ts` (323 lines)
- Files: `intentRouter.ts`, `intentSignals.ts`, `submitPromptHandler.ts`

### Phase 2: Two Modes Only (Agent + Plan) ✅
- Created `agentHandler.ts` wrapping AgenticLoop directly with tools
- Deleted `answerHandler.ts` — Agent mode with system prompt handles questions naturally
- Removed `handleQuickAction`, `handleClarify`, `handleContinueRun`
- Files: `agentHandler.ts`, `submitPromptHandler.ts`

### Phase 2b: User-Controlled Mode ✅
- No auto-switching. Mode = what user selected in UI dropdown
- Only system transition: user clicks "Implement" on plan card
- Files: `submitPromptHandler.ts`, `planHandler.ts`

### Phase 3: Dynamic Context Management ✅
- `ConversationHistory.maybeCompact()` — dual-mode summarization
- Threshold: `modelContextWindow * 0.75` (75% of real window)
- Extractive summary: file paths, commands, decisions, errors
- LLM summary after 3+ compactions
- `ContextBudgetManager` — dynamic system prompt budget
- Files: `conversationHistory.ts`, `contextBudgetManager.ts`, `agentHandler.ts`

### Phase 4: Activity Context ✅
- `buildRecentActivityContext(events)` — summarizes recent events for system prompt
- Integrated into `agentHandler.ts` as a context layer
- Files: `activityContext.ts`, `agentHandler.ts`

### Phase 5: Cleanup & Exports ✅
- Updated `index.ts` exports
- Updated types (`RoutedIntent`, `WorkspaceState`, etc.)
- Files: `index.ts`, `types.ts`

## Root Cause Fixes — COMPLETE

### Agent Loop Terminal Events ✅
- Added `loop_failed` to event type system
- `MissionExecutor` emits `loop_failed` in catch blocks (guaranteed terminal event)
- `missionHandler.ts` emits `failure_detected` in catch blocks
- `messageHandler.ts` closes streaming state on `loop_failed` / `failure_detected`
- `renderers.ts` renders `loop_failed` card
- Files: `types.ts`, `missionExecutor.ts`, `missionHandler.ts`, `messageHandler.ts`, `renderers.ts`

### Agent Loop Continuation on Truncation ✅
- `AgenticLoop` handles `stop_reason: 'max_tokens'` by injecting continuation prompt
- Loop continues instead of dying — model-agnostic, works for any provider
- `maxTokens` resolved from `llmClient.capabilities?.maxOutputTokens` (not hardcoded)
- Files: `agenticLoop.ts`, `agentHandler.ts`

### Webview Streaming State ✅
- Force-close stale streaming on new `intent_received` (fallback safety net)
- Primary fix: terminal events from AgenticLoop guarantee natural close
- Files: `messageHandler.ts`

### Try/Finally in Doctor Action ✅
- `handleDoctorAction` wraps `handleExecutePlan` in try/finally
- `isMissionExecuting` always resets even on exceptions
- Files: `extension.ts`

### Dynamic Budget for LLM Repair ✅
- `qualityGate.ts` uses dynamic budget instead of static file caps
- Truncation detection: checks `stop_reason === 'max_tokens'`
- Files: `qualityGate.ts`

## Scaffold Fixes — COMPLETE

### Blueprint App Type Correction ✅
- `correctAppTypeForRecipe()` fixes "Mobile App" label for web projects
- Applied in `pipelineRunner.ts` after blueprint extraction
- Files: `appBlueprintExtractor.ts`, `pipelineRunner.ts`

### Design Tokens (OKLCH/HSL) ✅
- Fixed HSL→OKLCH mismatch in 6 files
- Added `[DESIGN_TOKEN_TRACE]` logging
- Files: `designPackToShadcn.ts`, `designSystem.ts`, `overlayApplier.ts`

### Feature Generation ✅
- Multi-pass token limit: 16K → 32K with 64K retry
- Truncation detection in multi-pass generator
- Dynamic home page based on blueprint pages
- Files: `featureCodeGenerator.ts`, `multiPassGenerator.ts`, `overlayApplier.ts`

## Remaining Work — IN PROGRESS

### Old Design Pack System Cleanup 🔄
- `designPackSelector.ts` (656 lines) still exists, imported by `scaffoldFlow.ts`
- Dead functions in `designPacks.ts`: `getEnterpriseSubset`, `getMobileSubset`, `getPacksByVibe`
- `generateCssVariables`, `generateGlobalsCss`, `isValidDesignPackId` potentially dead
- These are superseded by `styleIntentResolver.ts` + `oklchEngine.ts` + `designPackToShadcn.ts`
- Action: Replace usage in `scaffoldFlow.ts` with lightweight alternative, delete dead code 