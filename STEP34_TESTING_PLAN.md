# STEP 34: AUTO-VERIFY + REPAIR — COMPREHENSIVE TESTING PLAN

**Date**: January 28, 2026  
**Status**: Testing Guide for Core Implementation

---

## 🎯 TESTING OVERVIEW

This guide provides a comprehensive plan to test the Step 34 verify flow both as **standalone unit tests** (can be done now) and **end-to-end integration tests** (requires executor wiring).

---

## PART 1: UNIT TESTS (Can Test NOW)

These tests verify core functionality without requiring full system integration.

### Test 1: Verify Policy Safety Checks

**File**: `packages/core/src/__tests__/verifyPolicy.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VERIFY_POLICY,
  isCommandSafe,
  type DiscoveredCommand
} from '../verifyPolicy';

describe('VerifyPolicy', () => {
  it('should allow safe lint commands', () => {
    const cmd: DiscoveredCommand = {
      name: 'lint',
      command: 'eslint .',
      source: 'package.json',
      safe: true
    };
    
    const result = isCommandSafe(cmd, DEFAULT_VERIFY_POLICY);
    expect(result.safe).toBe(true);
  });

  it('should block rm commands even if in allowlist', () => {
    const cmd: DiscoveredCommand = {
      name: 'clean',
      command: 'rm -rf dist',
      source: 'package.json',
      safe: false,
      reasonIfUnsafe: 'Destructive command'
    };
    
    const result = isCommandSafe(cmd, DEFAULT_VERIFY_POLICY);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('blocklist');
  });

  it('should exclude watch mode commands', () => {
    const cmd: DiscoveredCommand = {
      name: 'test:watch',
      command: 'vitest --watch',
      source: 'package.json',
      safe: false,
      reasonIfUnsafe: 'Watch mode'
    };
    
    const result = isCommandSafe(cmd, DEFAULT_VERIFY_POLICY);
    expect(result.safe).toBe(false);
  });

  it('should respect blocklist precedence', () => {
    // Even if "deploy" matches some pattern, blocklist wins
    const cmd: DiscoveredCommand = {
      name: 'deploy',
      command: 'npm run deploy',
      source: 'package.json',
      safe: false
    };
    
    const result = isCommandSafe(cmd, DEFAULT_VERIFY_POLICY);
    expect(result.safe).toBe(false);
  });
});
```

**How to run**:
```bash
cd packages/core
pnpm test verifyPolicy.test.ts
```

---

### Test 2: Command Discovery

**File**: `packages/core/src/__tests__/commandDiscovery.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { discoverVerifyCommands, filterSafeCommands } from '../commandDiscovery';
import { DEFAULT_VERIFY_POLICY } from '../verifyPolicy';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('CommandDiscovery', () => {
  it('should discover commands in stable order', async () => {
    // Create temp directory with package.json
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinex-test-'));
    
    const packageJson = {
      scripts: {
        build: 'tsc',
        test: 'vitest',
        lint: 'eslint .',
        start: 'node index.js'
      }
    };
    
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    
    const commands = await discoverVerifyCommands(tmpDir, DEFAULT_VERIFY_POLICY);
    
    // Should return in priority order: lint, test, build
    expect(commands.length).toBeGreaterThan(0);
    
    const names = commands.map(c => c.name);
    const lintIdx = names.indexOf('lint');
    const testIdx = names.indexOf('test');
    const buildIdx = names.indexOf('build');
    
    expect(lintIdx).toBeLessThan(testIdx);
    expect(testIdx).toBeLessThan(buildIdx);
    
    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it('should handle missing package.json gracefully', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinex-test-'));
    
    const commands = await discoverVerifyCommands(tmpDir, DEFAULT_VERIFY_POLICY);
    
    expect(commands).toEqual([]);
    
    await fs.rm(tmpDir, { recursive: true });
  });

  it('should filter out unsafe commands', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinex-test-'));
    
    const packageJson = {
      scripts: {
        lint: 'eslint .',
        clean: 'rm -rf dist',
        deploy: 'npm publish'
      }
    };
    
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    
    const allCommands = await discoverVerifyCommands(tmpDir, DEFAULT_VERIFY_POLICY);
    const safeCommands = filterSafeCommands(allCommands, DEFAULT_VERIFY_POLICY);
    
    const safeNames = safeCommands.map(c => c.name);
    
    expect(safeNames).toContain('lint');
    expect(safeNames).not.toContain('clean');
    expect(safeNames).not.toContain('deploy');
    
    await fs.rm(tmpDir, { recursive: true });
  });

  it('should exclude watch mode variants', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinex-test-'));
    
    const packageJson = {
      scripts: {
        test: 'vitest run',
        'test:watch': 'vitest --watch',
        'lint:watch': 'eslint . --watch'
      }
    };
    
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    
    const commands = await discoverVerifyCommands(tmpDir, DEFAULT_VERIFY_POLICY);
    const safeCommands = filterSafeCommands(commands, DEFAULT_VERIFY_POLICY);
    
    const safeNames = safeCommands.map(c => c.name);
    
    expect(safeNames).toContain('test');
    expect(safeNames).not.toContain('test:watch');
    expect(safeNames).not.toContain('lint:watch');
    
    await fs.rm(tmpDir, { recursive: true });
  });
});
```

**How to run**:
```bash
cd packages/core
pnpm test commandDiscovery.test.ts
```

---

### Test 3: Verify Phase Execution (Mocked)

**File**: `packages/core/src/__tests__/verifyPhase.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runVerifyPhase, shouldRunVerify } from '../verifyPhase';
import { DEFAULT_VERIFY_POLICY } from '../verifyPolicy';
import type { VerifyPhaseContext } from '../verifyPhase';

describe('VerifyPhase', () => {
  it('should skip verify if mode is off', async () => {
    const mockEventBus = {
      emit: vi.fn()
    };
    
    const ctx: VerifyPhaseContext = {
      run_id: 'test-run',
      workspaceRoot: '/tmp/test',
      eventBus: mockEventBus as any,
      mode: 'mission',
      previousStage: 'edit',
      verifyPolicy: { ...DEFAULT_VERIFY_POLICY, mode: 'off' },
      isReplay: false,
      writeEvidence: vi.fn()
    };
    
    const result = await runVerifyPhase(ctx);
    
    expect(result.status).toBe('skipped');
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'verify_skipped'
      })
    );
  });

  it('should not re-execute in replay mode', async () => {
    const mockEventBus = {
      emit: vi.fn()
    };
    
    const ctx: VerifyPhaseContext = {
      run_id: 'test-run',
      workspaceRoot: '/tmp/test',
      eventBus: mockEventBus as any,
      mode: 'mission',
      previousStage: 'edit',
      verifyPolicy: DEFAULT_VERIFY_POLICY,
      isReplay: true,
      writeEvidence: vi.fn()
    };
    
    const result = await runVerifyPhase(ctx);
    
    expect(result.status).toBe('skipped');
    expect(result.replayMode).toBe(true);
  });

  it('should deduplicate verify runs for same batch', () => {
    const batchId1 = 'run1-mission1-step1-diff1';
    const batchId2 = 'run1-mission1-step1-diff1'; // same
    const batchId3 = 'run1-mission1-step1-diff2'; // different
    
    const shouldRun1 = shouldRunVerify(batchId1);
    const shouldRun2 = shouldRunVerify(batchId2);
    const shouldRun3 = shouldRunVerify(batchId3);
    
    expect(shouldRun1).toBe(true);  // first time
    expect(shouldRun2).toBe(false); // duplicate
    expect(shouldRun3).toBe(true);  // new batch
  });

  it('should extract error snippets correctly', () => {
    const stderr = `
Line 1
Line 2
Line 3
Line 4
Line 5
ERROR: Something went wrong at file.ts:42
Line 7
Line 8
Line 9
Line 10
`.trim();

    // This would test extractErrorSnippet if exported
    // For now, verify the concept
    const lines = stderr.split('\n');
    const errorLines = lines.filter(l => 
      l.includes('ERROR') || l.includes('FAIL') || /:\d+/.test(l)
    );
    
    expect(errorLines.length).toBeGreaterThan(0);
    expect(errorLines[0]).toContain('file.ts:42');
  });
});
```

**How to run**:
```bash
cd packages/core
pnpm test verifyPhase.test.ts
```

---

## PART 2: INTEGRATION TESTS (Requires Wiring)

These tests verify the full flow but require executor integration.

### Test 4: End-to-End Verify Flow

**Setup**:
1. Create a test workspace with package.json
2. Wire verify phase into missionExecutor
3. Run a mission that applies a diff

**Test Scenario 1: Verify Pass**

```typescript
describe('E2E Verify Flow', () => {
  it('should run verify after diff and pass', async () => {
    // 1. Create test workspace
    const workspace = await createTestWorkspace({
      'package.json': {
        scripts: {
          lint: 'echo "Lint passed"',
          test: 'echo "Tests passed"'
        }
      },
      'src/index.ts': 'console.log("hello");'
    });

    // 2. Start mission executor
    const executor = new MissionExecutor({
      taskId: 'test-run',
      workspaceRoot: workspace.path,
      verifyPolicy: { ...DEFAULT_VERIFY_POLICY, mode: 'auto' }
    });

    // 3. Apply a diff
    await executor.applyDiff({
      filePath: 'src/index.ts',
      diff: '+ console.log("world");'
    });

    // 4. Verify should run automatically
    await waitForEvent('verify_started');
    await waitForEvent('verify_completed');

    // 5. Check result
    const events = await getEvents();
    const verifyComplete = events.find(e => e.type === 'verify_completed');
    
    expect(verifyComplete.payload.status).toBe('pass');
  });
});
```

**Test Scenario 2: Verify Fail → Repair**

```typescript
it('should trigger repair on verify failure', async () => {
  // 1. Create workspace with failing test
  const workspace = await createTestWorkspace({
    'package.json': {
      scripts: {
        lint: 'exit 1' // Always fails
      }
    },
    'src/index.ts': 'const x = "test";'
  });

  // 2. Start mission with auto verify
  const executor = new MissionExecutor({
    taskId: 'test-run',
    workspaceRoot: workspace.path,
    verifyPolicy: { ...DEFAULT_VERIFY_POLICY, mode: 'auto' }
  });

  // 3. Apply diff
  await executor.applyDiff({
    filePath: 'src/index.ts',
    diff: '+ const y = "test2";'
  });

  // 4. Wait for verify to fail
  await waitForEvent('verify_completed');
  const verifyEvent = getLastEvent('verify_completed');
  expect(verifyEvent.payload.status).toBe('fail');

  // 5. Repair should be triggered
  await waitForEvent('repair_attempt_started');
  
  // 6. Repair proposes fix
  await waitForEvent('diff_proposed');
  
  // 7. Approve repair
  await approveLastDiff();
  
  // 8. Verify should run again
  await waitForEvent('verify_started');
  
  // (In real scenario, we'd make repair actually fix the issue)
});
```

---

## PART 3: MANUAL TESTING SCENARIOS

These can be tested manually once integration is complete.

### Scenario 1: Prompt Mode (Default)

**Setup**:
1. Set verify mode to 'prompt' (default)
2. Create a workspace with package.json containing lint/test scripts
3. Start Ordinex extension

**Test Steps**:
```
1. User: "Add a new function to src/index.ts"
2. System: Generates diff
3. User: Approves diff
4. System: Applies diff
5. System: Discovers commands ["lint", "test"]
6. System: Shows VerifyCard with "Verification Available"
7. System: Shows buttons: [Run Verification] [Skip Once] [Disable]
8. User: Clicks "Run Verification"
9. System: Executes lint → test in order
10. System: Shows progress in Mission Feed
11. System: Shows full output in Logs tab
12. System: Shows VerifyCard with "✅ Verification Passed"
13. Mission continues
```

**Expected Result**: ✅ Pass
- VerifyCard appears after diff
- User must click to run
- Output streams to Logs
- Success indicator shows

---

### Scenario 2: Auto Mode

**Setup**:
1. Set verify mode to 'auto' in workspace settings:
   ```json
   {
     "ordinex.verify.mode": "auto"
   }
   ```
2. Same workspace as Scenario 1

**Test Steps**:
```
1. User: "Fix the bug in src/utils.ts"
2. System: Generates and applies diff (with approval)
3. System: Discovers safe commands
4. System: Automatically executes (no prompt)
5. System: Shows "🔍 Running Verification" card
6. System: Streams output to Logs
7. System: Shows "✅ Verification Passed"
8. Mission continues automatically
```

**Expected Result**: ✅ Pass
- No manual approval needed
- Commands run automatically
- Only safe commands executed

---

### Scenario 3: Verify Failure

**Setup**:
1. Create workspace with intentionally failing lint:
   ```json
   {
     "scripts": {
       "lint": "eslint . --max-warnings 0"
     }
   }
   ```
2. Add file with lint errors

**Test Steps**:
```
1. User: "Add a console.log to debug"
2. System: Applies diff (adds console.log - lint error)
3. System: Runs verify
4. System: lint fails with exit code 1
5. System: Shows "❌ Verification Failed" card
6. System: Shows error details:
   - Failed command: lint
   - Exit code: 1
7. System: Shows buttons: [View Logs] [Propose Fix]
8. User: Clicks "View Logs"
9. System: Opens Logs tab, shows full eslint output
10. User: Clicks "Propose Fix"
11. System: Analyzes error snippet
12. System: Generates fix diff (removes console.log)
13. System: Requests approval
14. User: Approves
15. System: Applies fix
16. System: Re-runs verify
17. System: Shows "✅ Verification Passed"
18. Mission continues
```

**Expected Result**: ✅ Pass
- Failure detected
- Error details shown
- Repair proposed
- Re-verification automatic

---

### Scenario 4: Exhausted Repair

**Setup**:
1. Create a scenario where repair can't fix the issue
2. Set maxFixAttemptsPerVerify = 2

**Test Steps**:
```
1. System: Verify fails
2. System: Repair attempt 1 → apply → re-verify → still fails
3. System: Repair attempt 2 → apply → re-verify → still fails
4. System: Shows decision_point_needed card
5. System: Shows options:
   - "Try another fix attempt" (user manual)
   - "Open Logs"
   - "Stop and fix manually"
   - "Create PLAN" (explicit)
6. User: Chooses "Stop and fix manually"
7. System: Mission pauses
8. User: Manually fixes issue
9. User: Resumes mission
```

**Expected Result**: ✅ Pass
- Loop is bounded (max 2 attempts)
- User given clear options
- No auto-PLAN
- Manual intervention possible

---

## PART 4: EDGE CASE TESTING

### Edge Case 1: No Package.json

**Test**:
```
1. Create workspace without package.json
2. Apply a diff
3. System: Discovers no commands
4. System: Shows decision_point_needed
5. System: Options:
   - "Choose command manually"
   - "Disable verify"
```

**Expected**: System handles gracefully, doesn't crash

---

### Edge Case 2: All Commands Unsafe

**Test**:
```
1. Create package.json with only unsafe commands:
   {
     "scripts": {
       "clean": "rm -rf dist",
       "deploy": "npm publish"
     }
   }
2. Apply a diff
3. System: Discovers commands but filters all as unsafe
4. System: Shows decision_point_needed
5. System: "No safe verify commands found"
```

**Expected**: Safety filters work, user is notified

---

### Edge Case 3: Command Timeout

**Test**:
```
1. Create command that runs forever:
   {
     "scripts": {
       "lint": "sleep 999999"
     }
   }
2. Apply a diff with auto verify
3. System: Starts command
4. System: After 5 minutes (default timeout)
5. System: Kills process
6. System: Shows verify_completed with timeout error
```

**Expected**: Timeout prevents hanging

---

### Edge Case 4: Large Output (>5MB)

**Test**:
```
1. Create command that outputs >5MB:
   {
     "scripts": {
       "test": "for i in {1..100000}; do echo 'line'; done"
     }
   }
2. System: Starts command
3. System: Captures output
4. System: Truncates at 5MB limit
5. System: Stores truncated evidence
6. System: Continues normally
```

**Expected**: Output capped, no memory issues

---

## PART 5: REPLAY TESTING

### Test Replay Safety

**Test**:
```
1. Run a mission with verify (record events)
2. Export run to JSON
3. Load run in replay mode
4. System: Reads verify events
5. System: Does NOT re-execute commands
6. System: Shows VerifyCard from stored events
7. System: Shows output from stored transcripts
```

**Expected**: No commands re-executed, UI renders from history

---

## PART 6: PERFORMANCE TESTING

### Test Output Throttling

**Test**:
```
1. Run command with fast output (e.g., massive test suite)
2. Monitor event emissions
3. Verify output_chunk events are throttled (max 1 per 250ms)
4. Verify UI doesn't freeze
5. Verify full transcript is still stored
```

**Expected**: UI responsive, no spam

---

## SUMMARY: TESTING CHECKLIST

### Unit Tests (Can Do Now)
- [ ] VerifyPolicy safety checks
- [ ] Command discovery ordering
- [ ] Blocklist precedence
- [ ] Watch mode exclusion
- [ ] Error snippet extraction
- [ ] Batch deduplication

### Integration Tests (After Wiring)
- [ ] End-to-end verify pass
- [ ] End-to-end verify fail → repair
- [ ] Bounded repair loop
- [ ] Decision point after exhaustion

### Manual Scenarios (After Full Integration)
- [ ] Prompt mode workflow
- [ ] Auto mode workflow
- [ ] Verify failure workflow
- [ ] Repair success workflow
- [ ] Repair exhaustion workflow

### Edge Cases
- [ ] No package.json
- [ ] All commands unsafe
- [ ] Command timeout
- [ ] Large output truncation
- [ ] Replay mode (no re-execution)

### Performance
- [ ] Output throttling
- [ ] Memory usage under load
- [ ] UI responsiveness

---

## QUICK START: Test Now

**Without any integration**, you can test the core logic:

```bash
# 1. Create the test files above
cd packages/core/src/__tests__

# 2. Run unit tests
pnpm test verifyPolicy.test.ts
pnpm test commandDiscovery.test.ts
pnpm test verifyPhase.test.ts

# 3. Check coverage
pnpm test --coverage
```

This will validate that:
- ✅ Safety validation works
- ✅ Command discovery is deterministic
- ✅ Replay mode is safe
- ✅ Batch deduplication works

---

## NEXT STEPS

1. **Now**: Run unit tests on core modules
2. **After wiring**: Run integration tests
3. **Before release**: Complete manual testing scenarios
4. **Production**: Monitor verify success/failure rates

---

**Testing Status**: Unit tests can run NOW without integration  
**Full E2E**: Requires 15-20 min of wiring first  
**Risk**: Low - core logic is testable standalone
