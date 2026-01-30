# Step 34.5: Command Execution Phase - Implementation Progress

**Status:** Phase 1 Foundation - In Progress
**Started:** 2026-01-28
**Target Completion:** TBD

---

## ✅ COMPLETED

### Phase 1: Foundation (Policy + Types)

#### 1. Types Updated (`packages/core/src/types.ts`)
- [x] Added `'command_proposed'` to EventType union
- [x] Added `'command_skipped'` to EventType union  
- [x] Updated CANONICAL_EVENT_TYPES array with new events
- [x] Added `'command'` to Stage type union
- [x] Created Step 34.5 type definitions:
  - `CommandKind = 'finite' | 'long_running'`
  - `CommandExecutionContext = 'verify' | 'user_run'`
  - `CommandPhaseResult` interface
  - `SingleCommandResult` interface

#### 2. Command Policy Created (`packages/core/src/commandPolicy.ts`)
- [x] Defined `CommandMode = 'off' | 'prompt' | 'auto'`
- [x] Created `CommandPolicyConfig` interface with:
  - mode (default: 'prompt')
  - allowlistPatterns (safe commands: test, build, lint)
  - blocklistPatterns (dangerous: rm -rf, sudo, publish)
  - longRunningPatterns (dev servers, watchers)
  - maxOutputBytesPerCommand (3MB)
  - chunkThrottleMs (250ms)
  - defaultTimeoutMs (10min)
- [x] Implemented `DEFAULT_COMMAND_POLICY` with conservative defaults
- [x] Implemented `classifyCommandKind()` - distinguishes finite vs long-running
- [x] Implemented `isCommandSafe()` - blocklist + allowlist checks
- [x] Implemented `resolveCommandPolicy()` - merges workspace + global settings
- [x] Implemented `serializeCommandPolicy()` - for evidence storage
- [x] Implemented `deserializeCommandPolicy()` - for replay

---

## 🚧 IN PROGRESS

### Phase 1: Foundation (Policy + Types) - Remaining
- [ ] Add Step 34.5 types to behaviorHandlers.ts (add 'run_command' to next_action)
- [ ] Export new types from index.ts

---

## 📋 TODO

### Phase 2: Core Command Execution (`commandPhase.ts`)
- [ ] Create packages/core/src/commandPhase.ts
- [ ] Define `CommandPhaseContext` interface
- [ ] Implement `runCommandPhase()` main function:
  - [ ] Replay safety check (skip if isReplayOrAudit)
  - [ ] Emit stage_changed to 'command'
  - [ ] Policy mode handling (off/prompt/auto)
  - [ ] Command classification (finite/long-running)
  - [ ] Approval gate logic
  - [ ] Sequential command execution
  - [ ] Aggregated result return
- [ ] Implement `executeCommand()` helper:
  - [ ] Emit command_started
  - [ ] Spawn with child_process
  - [ ] Buffer stdout/stderr with size limits
  - [ ] Throttled progress_updated events
  - [ ] Store transcript as evidence
  - [ ] Emit command_completed
- [ ] Implement `loadReplayResult()` for replay mode
- [ ] Implement event emission helpers

### Phase 3: VERIFY Integration
- [ ] Refactor verifyPhase.ts to import and call runCommandPhase()
- [ ] Remove duplicate command execution logic
- [ ] Map CommandPhaseResult → VerifyPhaseResult
- [ ] Maintain verify-specific summary events
- [ ] Update tests

### Phase 4: QUICK_ACTION Integration
- [ ] Enhance intentAnalyzer.ts with command-running patterns
- [ ] Update behaviorHandlers.ts to route run_command actions
- [ ] Enhance commandDiscovery.ts for user-requested commands
- [ ] Wire up command discovery + execution flow

### Phase 5: Extension Integration
- [ ] Wire up command execution in extension.ts or mission executor
- [ ] Handle decision_point_needed for approval
- [ ] Handle user actions (approve/skip/disable)

### Phase 6: UI Components
- [ ] Create CommandCard component for Mission Feed
- [ ] Enhance Logs Tab to display command transcripts
- [ ] Add Stop button for long-running commands
- [ ] Test replay rendering from evidence

### Phase 7: Tests
- [ ] Test prompt mode blocks until approval
- [ ] Test auto mode executes allowlisted commands
- [ ] Test blocklist prevents dangerous commands
- [ ] Test dev server always requires prompt
- [ ] Test output truncation
- [ ] Test replay safety
- [ ] Integration test: VERIFY uses shared execution
- [ ] Integration test: user-initiated "run the project"

---

## 🎯 STOP CONDITIONS

User can:
- [x] ~~N/A yet~~ Say "run tests" and system can classify intent
- [ ] See approval prompt before command execution
- [ ] Command runs after approval
- [ ] Output stored as evidence
- [ ] UI shows command status in Mission Feed
- [ ] Logs Tab shows full transcript
- [ ] VERIFY uses same command execution phase
- [ ] Dev server never auto-runs
- [ ] Replay never re-executes commands

---

## 🔑 KEY ARCHITECTURAL DECISIONS

1. **Policy Architecture:** Created base `commandPolicy.ts` that verifyPolicy will extend
2. **Stage Type:** Added `'command'` as first-class stage (not 'none')
3. **Command Classification:** Finite vs long-running distinction is critical
   - Finite: Can auto-run if allowlisted, has timeout
   - Long-running: ALWAYS require prompt, no timeout, stoppable
4. **Safety:** Blocklist always wins, default mode is 'prompt'
5. **Replay:** isReplayOrAudit boolean prevents re-execution

---

## 📝 NOTES

- Command execution is a PHASE, not a behavior
- It's reusable by VERIFY, QUICK_ACTION, and future SCAFFOLD
- Policy snapshot is stored for deterministic replay
- Transcripts go to evidence, not Mission Feed
- Natural language "run X" → QUICK_ACTION with run_command
- Slash "/run" → CONTINUE_RUN (mission control)

