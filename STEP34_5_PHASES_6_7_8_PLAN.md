# Step 34.5 Phases 6-7-8: Extension + UI + Tests Implementation Plan

**Status:** Planning Complete, Ready to Execute  
**Scope:** Complete end-to-end implementation of command execution  
**Estimated Work:** ~3-4 hours implementation + testing

---

## Phase 6: Extension Integration (CRITICAL PATH)

### 6.1 Enhance BehaviorHandler Result Processing

**Location:** `packages/extension/src/extension.ts` - `handleSubmitPrompt()`

**Current State:**
```typescript
case 'QUICK_ACTION':
  // Creates quick plan, calls handleExecutePlan
```

**Required Changes:**
```typescript
case 'QUICK_ACTION':
  const behaviorResult = await executeBehavior(handlerContext);
  
  if (behaviorResult.next_action === 'run_command') {
    await this.handleRunCommand(behaviorResult.payload, taskId, webview);
  } else if (behaviorResult.next_action === 'propose_diff') {
    await this.handleQuickActionEdit(behaviorResult.payload, taskId, webview);
  }
```

### 6.2 Create handleRunCommand Method

**New Method:**
```typescript
private async handleRunCommand(
  payload: any,
  taskId: string,
  webview: vscode.Webview
): Promise<void> {
  const { command_intent, execution_context } = payload;
  
  // 1. Discover actual commands from workspace
  const commands = await this.discoverCommandsFromIntent(command_intent);
  
  // 2. Resolve command policy from settings
  const commandPolicy = this.resolveCommandPolicyFromSettings();
  
  // 3. Create CommandPhaseContext
  const ctx: CommandPhaseContext = {
    run_id: taskId,
    workspaceRoot,
    eventBus,
    mode: this.currentMode,
    previousStage: this.currentStage,
    commandPolicy,
    commands,
    executionContext: execution_context || 'user_run',
    isReplayOrAudit: false,
    writeEvidence: this.createEvidenceWriter(),
  };
  
  // 4. Call runCommandPhase
  const result = await runCommandPhase(ctx);
  
  // 5. Handle result
  if (result.status === 'success') {
    vscode.window.showInformationMessage(`✓ Commands executed successfully`);
  } else if (result.status === 'failure') {
    this.offerRepairOptions(result);
  }
}
```

### 6.3 Command Discovery Helper

**New Method:**
```typescript
private async discoverCommandsFromIntent(
  commandIntent: CommandIntentResult
): Promise<string[]> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return [];
  
  // If explicit commands detected, use those
  if (commandIntent.inferredCommands && commandIntent.inferredCommands.length > 0) {
    return commandIntent.inferredCommands;
  }
  
  // Otherwise, discover from package.json
  const discovered = await discoverVerifyCommands(workspaceRoot);
  
  // Filter by command intent keywords
  return discovered.commands
    .filter(cmd => {
      const cmdLower = cmd.toLowerCase();
      return commandIntent.detectedKeywords.some(kw => cmdLower.includes(kw));
    })
    .map(cmd => cmd);
}
```

### 6.4 Settings Integration

**Add to extension settings:**
- `ordinex.commandPolicy.mode` (off/prompt/auto, default: prompt)
- `ordinex.commandPolicy.autoApprovePatterns` (string[], default: [])
- `ordinex.commandPolicy.blockPatterns` (string[], default: [])

**Settings Resolution:**
```typescript
private resolveCommandPolicyFromSettings(): CommandPolicyConfig {
  const config = vscode.workspace.getConfiguration('ordinex.commandPolicy');
  
  return resolveCommandPolicy({
    mode: config.get('mode', 'prompt'),
    allowlistPatterns: DEFAULT_COMMAND_POLICY.allowlistPatterns,
    blocklistPatterns: config.get('blockPatterns', DEFAULT_COMMAND_POLICY.blocklistPatterns),
    maxOutputBytesPerCommand: config.get('maxOutputBytes', 5 * 1024 * 1024),
    chunkThrottleMs: 300,
  });
}
```

### 6.5 Evidence Writer Integration

**New Helper:**
```typescript
private createEvidenceWriter() {
  const evidenceDir = path.join(this._context.globalStorageUri.fsPath, 'command-evidence');
  
  return async (type: string, content: string, summary: string): Promise<string> => {
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    
    const evidenceId = this.generateId();
    const evidencePath = path.join(evidenceDir, `${evidenceId}.txt`);
    fs.writeFileSync(evidencePath, content, 'utf-8');
    
    return evidenceId;
  };
}
```

---

## Phase 7: UI Components

### 7.1 CommandCard Component

**Location:** `packages/webview/src/components/CommandCard.ts` (NEW)

**Purpose:** Display command execution status in Mission Feed

**Features:**
- Show command being executed
- Real-time status (queued → running → completed/failed)
- Progress indicator (pulsing dot for running)
- Exit code display
- "View Logs" button (opens Logs tab)
- "Abort" button (for long-running commands)

**HTML Structure:**
```html
<div class="command-card">
  <div class="command-header">
    <span class="command-icon">⚡</span>
    <span class="command-text">npm run test</span>
    <span class="command-status running">Running...</span>
  </div>
  <div class="command-meta">
    <span>Duration: 2.3s</span>
    <span>Exit Code: 0</span>
  </div>
  <div class="command-actions">
    <button class="view-logs-btn">View Logs</button>
    <button class="abort-btn" data-command-id="...">Abort</button>
  </div>
</div>
```

**CSS Classes:**
```css
.command-status.running { color: #0078d4; animation: pulse 1.5s infinite; }
.command-status.success { color: #107c10; }
.command-status.failed { color: #e81123; }
```

### 7.2 Logs Tab Enhancement

**Location:** `packages/webview/src/components/LogsTab.ts` (Enhance Existing)

**New Features:**
- Group logs by command
- Syntax highlighting for stderr (red)
- Timestamp display
- Collapsible command sections
- Search/filter functionality

**Enhanced HTML:**
```html
<div class="logs-container">
  <div class="logs-toolbar">
    <input type="search" placeholder="Filter logs..." class="logs-search" />
    <button class="clear-logs-btn">Clear</button>
  </div>
  
  <div class="logs-groups">
    <div class="log-group">
      <div class="log-group-header" data-collapsed="false">
        <span class="collapse-icon">▼</span>
        <span class="command-name">npm run test</span>
        <span class="log-timestamp">2:34:56 PM</span>
      </div>
      <div class="log-group-content">
        <pre class="log-stdout">PASS src/__tests__/example.test.ts</pre>
        <pre class="log-stderr error">Warning: Deprecated API</pre>
      </div>
    </div>
  </div>
</div>
```

### 7.3 Event Rendering Updates

**Location:** `packages/webview/src/components/MissionFeed.ts`

**Add Command Event Rendering:**
```typescript
case 'command_proposed':
  return this.renderCommandProposedCard(event);
  
case 'command_started':
  return this.renderCommandCard(event, 'running');
  
case 'command_completed':
  return this.renderCommandCard(event, event.payload.exitCode === 0 ? 'success' : 'failed');
  
case 'command_skipped':
  return this.renderCommandSkippedCard(event);
```

---

## Phase 8: Tests

### 8.1 Core Unit Tests

**Location:** `packages/core/src/__tests__/commandPhase.test.ts` (NEW)

**Test Cases:**
```typescript
describe('commandPhase', () => {
  describe('Policy Enforcement', () => {
    it('skips execution when mode is off');
    it('emits command_proposed when mode is prompt');
    it('waits for approval before executing in prompt mode');
    it('executes immediately in auto mode');
    it('blocks dangerous commands regardless of mode');
    it('always prompts for long-running commands');
  });
  
  describe('Command Execution', () => {
    it('executes commands sequentially');
    it('stops on first failure with fail-fast');
    it('captures stdout and stderr separately');
    it('stores full transcript as evidence');
    it('enforces output size cap with truncation');
    it('kills commands that exceed timeout');
  });
  
  describe('Replay Safety', () => {
    it('never spawns processes when isReplayOrAudit is true');
    it('loads transcript from evidence in replay mode');
    it('emits no new events during replay');
  });
  
  describe('Event Emission', () => {
    it('emits stage_changed to command');
    it('emits command_started with metadata');
    it('emits progress_updated (throttled)');
    it('emits command_completed with evidence ref');
  });
});
```

### 8.2 Command Policy Tests

**Location:** `packages/core/src/__tests__/commandPolicy.test.ts` (NEW)

**Test Cases:**
```typescript
describe('commandPolicy', () => {
  describe('classifyCommandKind', () => {
    it('identifies finite commands (test, build, lint)');
    it('identifies long-running commands (dev, watch, serve)');
    it('defaults to finite for unknown commands');
  });
  
  describe('isCommandSafe', () => {
    it('approves allowlisted commands');
    it('blocks blocklisted commands');
    it('blocklist wins over allowlist');
    it('blocks unknown commands by default');
  });
  
  describe('Policy Serialization', () => {
    it('serializes policy to JSON');
    it('deserializes policy from JSON');
    it('round-trip preserves all fields');
  });
});
```

### 8.3 Command Intent Detection Tests

**Location:** `packages/core/src/__tests__/userCommandDetector.test.ts` (NEW)

**Test Cases:**
```typescript
describe('userCommandDetector', () => {
  describe('Direct Command Detection', () => {
    it('detects npm commands with 95% confidence');
    it('detects yarn commands with 95% confidence');
    it('detects pnpm commands with 95% confidence');
    it('infers exact command from prompt');
  });
  
  describe('Natural Language Detection', () => {
    it('detects "run tests" with 85% confidence');
    it('detects "start dev server" with 85% confidence');
    it('detects "build the project" with 85% confidence');
    it('infers likely commands from natural language');
  });
  
  describe('Question Filtering', () => {
    it('rejects "what is npm?" as question');
    it('rejects "how do I run tests?" as question');
    it('rejects prompts ending with ? as questions');
  });
  
  describe('Confidence Scoring', () => {
    it('scores direct commands at 0.95');
    it('scores verb+target patterns at 0.85');
    it('scores partial matches at 0.6');
    it('scores non-command prompts at 0.1');
  });
});
```

### 8.4 Integration Tests

**Location:** `packages/core/src/__tests__/commandExecution.integration.test.ts` (NEW)

**Test Cases:**
```typescript
describe('Command Execution Integration', () => {
  it('user says "run tests" → detects intent → discovers commands → executes');
  it('VERIFY discovers commands → proposes → user approves → executes');
  it('long-running command → always prompts regardless of mode');
  it('dangerous command → blocked even in auto mode');
  it('replay loads evidence without re-executing');
  
  describe('QUICK_ACTION Flow', () => {
    it('routes to run_command when confidence >= 0.7');
    it('routes to propose_diff when confidence < 0.7');
    it('handles command execution failure gracefully');
  });
});
```

### 8.5 VS Code Extension Tests

**Location:** `packages/extension/src/__tests__/commandIntegration.test.ts` (NEW)

**Test Cases:**
```typescript
describe('Extension Command Integration', () => {
  it('handleRunCommand discovers commands correctly');
  it('resolves command policy from settings');
  it('creates evidence writer that stores in correct directory');
  it('sends events to webview during execution');
  it('shows success notification on completion');
  it('offers repair on failure');
});
```

---

## Implementation Order

### Sprint 1: Critical Path (Phase 6)
1. ✅ Add imports to extension.ts
2. ✅ Implement `handleRunCommand` method
3. ✅ Implement `discoverCommandsFromIntent` helper
4. ✅ Implement `resolveCommandPolicyFromSettings`
5. ✅ Implement `createEvidenceWriter`
6. ✅ Wire up QUICK_ACTION behavior routing
7. ✅ Test end-to-end flow

### Sprint 2: UI Components (Phase 7)
1. ✅ Create CommandCard.ts component
2. ✅ Enhance LogsTab.ts with command grouping
3. ✅ Update MissionFeed.ts event rendering
4. ✅ Add CSS for command cards
5. ✅ Wire up "View Logs" and "Abort" buttons
6. ✅ Test UI interactions

### Sprint 3: Tests (Phase 8)
1. ✅ Write commandPhase.test.ts
2. ✅ Write commandPolicy.test.ts
3. ✅ Write userCommandDetector.test.ts
4. ✅ Write integration tests
5. ✅ Write extension tests
6. ✅ Achieve >80% coverage

---

## Success Criteria

✅ **Phase 6 Complete When:**
- User says "run tests" → system detects → discovers → prompts → executes
- Commands execute via shared runCommandPhase()
- Evidence stored correctly
- Events emitted properly
- UI updates in real-time

✅ **Phase 7 Complete When:**
- CommandCard displays in Mission Feed
- Logs Tab shows grouped command output
- "View Logs" button switches tabs
- "Abort" button kills running command
- UI is polished and responsive

✅ **Phase 8 Complete When:**
- All unit tests pass (>80% coverage)
- Integration tests pass
- Extension tests pass
- No regressions in existing functionality

---

## Risk Mitigation

**Risk:** Extension changes break existing flows  
**Mitigation:** Test ANSWER, PLAN, QUICK_ACTION (diff) flows before merging

**Risk:** Command execution hangs on long-running processes  
**Mitigation:** Implement timeout + abort functionality

**Risk:** Evidence directory fills up  
**Mitigation:** Implement evidence cleanup on task completion

**Risk:** TypeScript errors from new imports  
**Mitigation:** Add imports incrementally, compile after each change

---

## Rollout Strategy

**Phase 6:** Deploy to dev, test with sample commands  
**Phase 7:** Deploy to dev, QA UI interactions  
**Phase 8:** Run full test suite, fix failures  
**Final:** Merge to main after all green

---

**Ready to Execute:** ✅  
**Estimated Time:** 3-4 hours  
**Priority:** HIGH (Blocks Step 35 Greenfield)
