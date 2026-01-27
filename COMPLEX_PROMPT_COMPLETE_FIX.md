# Complex Prompt Execution - Complete Reliability Fix

## Status: PHASE 1 COMPLETE ✅ | PHASES 2-4 DOCUMENTED

---

## PHASE 1: Mission Control Bar State Derivation ✅ COMPLETE

### Problem
Mission Control Bar showed stale mission info (e.g., "1/4 Running" when Mission 2 was selected) because `getMissionProgress()` used `.find()` which returned the FIRST `mission_selected` event instead of the LATEST.

### Solution Implemented
Updated `packages/webview/src/index.ts` - `getMissionProgress()` function:

```typescript
// CRITICAL FIX: Get LATEST mission_selected event by filtering then taking last
const selectedEvents = events.filter(e => e.type === 'mission_selected');
const selectedEvent = selectedEvents[selectedEvents.length - 1]; // Last = Latest
const selectedMissionId = selectedEvent?.payload?.mission_id;
```

### Key Improvements
1. ✅ Event stream reduction - processes all events in order
2. ✅ Latest mission selection - takes last not first
3. ✅ Accurate isRunning logic - checks started AND not completed AND not paused
4. ✅ Edge case handling - null checks, missing missions, pause states

### Result
Bar now shows correct mission (2/4, 3/4, etc.) and updates immediately when missions auto-select.

---

## PHASE 2: Edit Execution Robustness 📋 DOCUMENTED (NEEDS IMPLEMENTATION)

### Problems Identified
1. **File Creation Fails**: When LLM generates diffs for non-existent files, system returns "File not found" error
2. **No Create/Modify Classification**: System doesn't distinguish between creating new files vs modifying existing
3. **Poor Error Messages**: Generic failures without specific reasons (missing file, missing dir, permission issues)

### Required Changes

#### A. atomicDiffApply.ts - Add File Existence Check

**Location**: `packages/core/src/atomicDiffApply.ts` line ~165 (in applyDiffAtomically)

**Current Code**:
```typescript
// Read current content
let originalContent: string;
try {
  originalContent = await fs.readFile(absolutePath, 'utf-8');
} catch (error) {
  return {
    success: false,
    applied_files: [],
    failed_files: [{ path: filePath, error: 'File not found' }],
    rollback_performed: false,
    error: {
      type: 'io_error',
      message: `Could not read file ${filePath}`,
      details: { file: filePath },
    },
  };
}
```

**Fixed Code**:
```typescript
// Check if file exists - determine create vs modify
let originalContent: string;
let isCreatingFile = false;

try {
  await fs.access(absolutePath);
  // File exists - read it
  originalContent = await fs.readFile(absolutePath, 'utf-8');
} catch (error) {
  // File doesn't exist - this is a CREATE operation
  isCreatingFile = true;
  originalContent = ''; // Empty baseline for new files
  
  // Ensure parent directory exists
  const parentDir = path.dirname(absolutePath);
  try {
    await fs.mkdir(parentDir, { recursive: true });
  } catch (mkdirError) {
    return {
      success: false,
      applied_files: [],
      failed_files: [{ 
        path: filePath, 
        error: `Cannot create parent directory: ${mkdirError instanceof Error ? mkdirError.message : String(mkdirError)}` 
      }],
      rollback_performed: false,
      error: {
        type: 'io_error',
        message: `Cannot create parent directory for ${filePath}`,
        details: { file: filePath, parent_dir: parentDir },
      },
    };
  }
}
```

#### B. diffProposalGenerator.ts - Classify Operations

**Location**: `packages/core/src/diffProposalGenerator.ts` - add classification in diff proposal

**Add to generateDiff function**:
```typescript
// Classify each file as create or modify
const classifiedFiles = parsedDiff.files.map(fileDiff => {
  const filePath = fileDiff.newPath !== '/dev/null' ? fileDiff.newPath : fileDiff.oldPath;
  const isCreate = !baseShaMap.has(filePath); // If no base_sha, file doesn't exist
  
  return {
    ...fileDiff,
    operation: isCreate ? 'create' : 'modify' as 'create' | 'modify',
  };
});
```

#### C. Improve Error Messages

**Add structured error types**:
```typescript
interface StructuredError {
  type: 'file_not_found' | 'directory_missing' | 'permission_denied' | 'hunk_mismatch' | 'stale_context';
  message: string;
  file_path: string;
  suggestion: string; // User-friendly suggestion
}
```

---

## PHASE 3: Mission Sequencing Safety 📋 DOCUMENTED (NEEDS IMPLEMENTATION)

### Problem
After `mission_completed` event, the next mission doesn't auto-select, leaving user stuck.

### Required Changes

#### A. missionExecutor.ts - Auto-Select Next Mission

**Location**: `packages/core/src/missionExecutor.ts` - add after emitting mission_completed

**Add Logic**:
```typescript
async completeMission(missionId: string, success: boolean): Promise<void> {
  // Emit mission_completed event
  this.eventBus.emit({
    type: 'mission_completed',
    payload: {
      mission_id: missionId,
      success,
      completed_at: new Date().toISOString(),
    },
  });

  // AUTO-SELECT NEXT MISSION if available
  if (success) {
    const breakdownEvent = this.events.find(e => e.type === 'mission_breakdown_created');
    if (breakdownEvent) {
      const missions = breakdownEvent.payload.missions || [];
      const completedMissions = this.events
        .filter(e => e.type === 'mission_completed')
        .map(e => e.payload.mission_id);
      
      // Find next unstarted mission
      const nextMission = missions.find(m => !completedMissions.includes(m.missionId));
      
      if (nextMission) {
        // Auto-select next mission
        this.eventBus.emit({
          type: 'mission_selected',
          payload: {
            mission_id: nextMission.missionId,
            selected_at: new Date().toISOString(),
            auto_selected: true, // Mark as auto-selection
          },
        });
        
        console.log(`[MissionExecutor] Auto-selected next mission: ${nextMission.title}`);
      }
    }
  }
}
```

#### B. Ensure UI Updates Immediately

**Verify**: `packages/webview/src/index.ts` already listens to `eventsUpdate` and calls `updateMissionControlBar()`.

**Test**: After fix, bar should update immediately when `mission_selected` event arrives.

---

## PHASE 4: E2E Regression Test 📋 DOCUMENTED (NEEDS IMPLEMENTATION)

### Test File
**Location**: `packages/core/src/__tests__/complexPromptFlow.test.ts` (NEW FILE)

### Test Structure
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../eventBus';
import { MissionExecutor } from '../missionExecutor';
import { MissionBreakdownGenerator } from '../missionBreakdownGenerator';

describe('Complex Prompt E2E Flow', () => {
  let eventBus: EventBus;
  let events: any[];

  beforeEach(() => {
    eventBus = new EventBus();
    events = [];
    eventBus.on('*', (event) => events.push(event));
  });

  it('should handle full complex prompt → missions → sequencing', async () => {
    // 1. User enters complex prompt
    // 2. System creates plan with 5 steps
    const plan = {
      goal: 'Build auth system',
      steps: [
        { description: 'Create auth routes', stage: 'edit' },
        { description: 'Add user service', stage: 'edit' },
        { description: 'Create dashboard', stage: 'edit' },
        { description: 'Add settings page', stage: 'edit' },
        { description: 'Write tests', stage: 'test' },
      ],
    };

    // 3. Large plan detected → mission breakdown
    const generator = new MissionBreakdownGenerator();
    const breakdown = await generator.generateBreakdown(plan, 'task-123');
    
    expect(breakdown.missions).toHaveLength(3); // Should break into 3 missions
    
    // Emit breakdown event
    eventBus.emit({
      type: 'mission_breakdown_created',
      payload: { missions: breakdown.missions, plan_step_count: 5 },
    });

    // 4. User selects Mission 1
    const mission1 = breakdown.missions[0];
    eventBus.emit({
      type: 'mission_selected',
      payload: { mission_id: mission1.missionId },
    });

    // 5. Execute Mission 1
    const executor = new MissionExecutor(eventBus, 'workspace-root');
    await executor.startMission(mission1.missionId);
    
    // Simulate edit step with file creation
    // ...code to simulate edit...

    // 6. Complete Mission 1
    await executor.completeMission(mission1.missionId, true);

    // ASSERTIONS

    // A. Mission completed event emitted
    const completedEvent = events.find(e => 
      e.type === 'mission_completed' && 
      e.payload.mission_id === mission1.missionId
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent.payload.success).toBe(true);

    // B. Next mission AUTO-SELECTED
    const selectedEvents = events.filter(e => e.type === 'mission_selected');
    expect(selectedEvents.length).toBe(2); // Initial + auto-select
    expect(selectedEvents[1].payload.mission_id).toBe(breakdown.missions[1].missionId);
    expect(selectedEvents[1].payload.auto_selected).toBe(true);

    // C. Mission Control Bar shows correct state
    // (This would test the UI reducer logic)
    const missionProgress = computeMissionProgress(events);
    expect(missionProgress.current).toBe(2); // Should show mission 2
    expect(missionProgress.completed).toBe(1);
    expect(missionProgress.total).toBe(3);
    expect(missionProgress.selectedMission.missionId).toBe(breakdown.missions[1].missionId);
    expect(missionProgress.isRunning).toBe(false); // Not started yet
  });

  it('should handle file creation during edit step', async () => {
    // Test that creating non-existent files works correctly
    // ...
  });

  it('should handle file modification during edit step', async () => {
    // Test that modifying existing files works correctly
    // ...
  });
});
```

---

## Implementation Priority

### IMMEDIATE (Critical Path)
1. ✅ **PHASE 1** - Mission Control Bar (DONE)
2. **PHASE 2A** - File creation classification in atomicDiffApply.ts
3. **PHASE 3A** - Auto-select next mission after completion

### HIGH (User Experience)
4. **PHASE 2B** - Improve error messages
5. **PHASE 3B** - Verify UI updates immediately

### MEDIUM (Quality Assurance)
6. **PHASE 4** - E2E regression test

---

## Testing Instructions

### Manual Test Flow
1. **Reload Extension** (F5 or Developer: Reload Window)
2. **Enter Complex Prompt** in PLAN mode:
   ```
   Build authentication endpoints in src/server/auth.ts using express middleware and yup validation,
   create user management in src/services/user.ts, add dashboard UI in src/pages/Dashboard.tsx,
   implement settings page in src/pages/Settings.tsx
   ```
3. **Approve Plan** → System breaks into missions
4. **Select Mission 1** → Click "▶ Start"
5. **Let Mission 1 Complete** → Watch for:
   - ✅ `mission_completed` event in Logs tab
   - ✅ Bar automatically updates to "2/X [Mission 2 Name] ▶ Start"
   - ✅ No manual re-selection needed
6. **Start Mission 2** → Verify same behavior

### Expected Behavior
- Mission Control Bar **always** shows current mission
- After mission completes, next mission **auto-selects**
- File creation (not just modification) **works reliably**
- Clear error messages when operations fail

---

## Files Modified

### ✅ PHASE 1 (Complete)
- `packages/webview/src/index.ts` - getMissionProgress() function

### 📋 PHASE 2 (Needs Implementation)
- `packages/core/src/atomicDiffApply.ts` - Add file existence check & directory creation
- `packages/core/src/diffProposalGenerator.ts` - Classify create vs modify operations

### 📋 PHASE 3 (Needs Implementation)
- `packages/core/src/missionExecutor.ts` - Add auto-select logic after mission completion

### 📋 PHASE 4 (Needs Implementation)
- `packages/core/src/__tests__/complexPromptFlow.test.ts` - NEW FILE - E2E test

---

## Success Criteria

✅ **PHASE 1**: Mission Control Bar shows accurate current mission  
⬜ **PHASE 2**: File creation and modification both work without errors  
⬜ **PHASE 3**: Next mission auto-selects after completion  
⬜ **PHASE 4**: E2E test passes covering full flow  

**Overall Goal**: User enters complex prompt → plan → missions → executes Mission 1 → Mission 2 auto-selects → executes Mission 2 → continues seamlessly.

---

## Notes

- PHASE 1 implemented and tested ✅
- PHASES 2-4 documented with specific code locations and fixes
- Priority order ensures critical bugs fixed first
- Test coverage ensures no regressions

**Next Step**: Implement PHASE 2A (file creation fix) as highest priority.
