# Multi-Mission Flow - Complete Test Plan

**Date:** January 26, 2026  
**Status:** ✅ Ready for Testing

## Overview

This document provides a comprehensive test plan for the **entire complex prompt → multi-mission flow**, ensuring all components work together correctly.

## Complete Flow Diagram

```
User Input (Complex Prompt)
  ↓
[PLAN Mode] Intent Assessment
  ↓
[PLAN Mode] Context Collection (Light)
  ↓
[PLAN Mode] Plan Generation
  ↓
[UI] Plan Card Displayed
  ↓
User: "Approve Plan"
  ↓
[PLAN Mode] Large Plan Detection
  ↓
[PLAN Mode] Mission Breakdown Generation
  ↓
[UI] Mission Breakdown Card Displayed (3 missions)
  ↓
User: Select Mission 1
  ↓
[UI] Mission Control Bar Shows: "🚀 1/3 ▶ Start"
  ↓
User: Click "Start"
  ↓
[MISSION Mode] Mission 1 Execution Begins
  ↓
[UI] MCB Updates: "🔄 1/3 ⏳ Running..." (spinning icon)
  ↓
[MISSION Mode] Mission 1 Steps Execute
  ↓
[MISSION Mode] Mission 1 Completes
  ↓
[UI] MCB Updates: "🚀 2/3 ▶ Start" (Mission 2 auto-selected)
  ↓
User: Click "Start" on Mission 2
  ↓
[MISSION Mode] Mission 2 Execution Begins
  ↓
[UI] MCB Updates: "🔄 2/3 ⏳ Running..." (spinning icon) ← FIXED!
  ↓
[MISSION Mode] Mission 2 Completes
  ↓
... Repeat for Mission 3 ...
  ↓
[UI] MCB Shows: "🎉 3/3 ✓ Done" (All missions complete)
```

## Test Scenarios

### Scenario 1: Happy Path (3 Missions)

**Setup:**
```
Complex Prompt: "Build authentication endpoints in src/server/auth.ts using express 
middleware and yup validation, create user management in src/services/user.ts, 
add dashboard UI in src/pages/Dashboard.tsx, implement settings page in 
src/pages/Settings.tsx"
```

**Expected Behavior:**

| Step | Action | Expected UI State | Backend Event |
|------|--------|------------------|---------------|
| 1 | Submit prompt | Status: Running | `intent_received` |
| 2 | - | Plan Card shown | `plan_created` |
| 3 | Click "Approve Plan" | Approval requested | `approval_requested` |
| 4 | - | Large plan detected | `plan_large_detected` |
| 5 | - | Mission breakdown shown (3 missions) | `mission_breakdown_created` |
| 6 | Click "Select" on Mission 1 | Mission 1 highlighted | `mission_selected` |
| 7 | - | **MCB visible: "🚀 1/3 ▶ Start"** | - |
| 8 | Click "▶ Start" in MCB | **MCB updates: "🔄 1/3 ⏳ Running..."** | `mission_started` |
| 9 | - | Steps execute (Step 1, Step 2...) | `step_started`, `step_completed` |
| 10 | - | Mission 1 completes | `mission_completed` |
| 11 | - | **MCB updates: "🚀 2/3 ▶ Start"** (Mission 2 auto-selected) | `execution_paused`, `mission_selected` |
| 12 | Click "▶ Start" for Mission 2 | **MCB updates: "🔄 2/3 ⏳ Running..."** ✅ | `mission_started` |
| 13 | - | Mission 2 executes and completes | ... |
| 14 | Click "▶ Start" for Mission 3 | **MCB updates: "🔄 3/3 ⏳ Running..."** ✅ | `mission_started` |
| 15 | - | Mission 3 completes | `mission_completed` |
| 16 | - | **MCB shows: "🎉 3/3 ✓ Done"** | - |

### Scenario 2: Mission with Errors

**Expected Behavior:**

| Step | Event | UI State |
|------|-------|----------|
| Mission 2 starts | `mission_started` | MCB: "🔄 2/3 ⏳ Running..." |
| Edit fails | `step_failed` | Error card shown in timeline |
| Self-correction attempts | `repair_attempt_started` | Timeline shows repair |
| Max retries reached | `failure_detected` | Mission paused |
| User provides feedback | User input | - |
| Mission resumes | `execution_resumed` | MCB still shows Mission 2 |
| Mission completes | `mission_completed` | MCB: "🚀 3/3 ▶ Start" |

### Scenario 3: User Cancels Mid-Mission

**Expected Behavior:**

| Step | Action | UI State |
|------|--------|----------|
| Mission 2 running | - | MCB: "🔄 2/3 ⏳ Running..." |
| User clicks Stop | Click composer stop button | Status: Paused |
| - | - | MCB: "⏸️ 2/3 Paused" |
| User can restart | Click "Start" again | MCB: "🔄 2/3 ⏳ Running..." |

## Critical UI Elements to Verify

### Mission Control Bar States

#### ✅ State 1: Mission Selected (Not Started)
```
Icon: 🚀 (static, no animation)
Count: "1/3"
Name: "Foundation & Setup"
Progress: 0% (empty bar)
Button: "▶ Start" (green, enabled)
```

#### ✅ State 2: Mission Running (THIS WAS THE BUG!)
```
Icon: 🔄 (spinning animation) ← Must spin!
Count: "1/3"  
Name: "Foundation & Setup"
Progress: 0-50% (blue, filling)
Button: "⏳ Running..." (gray, disabled)
Border: Blue pulsing animation
```

#### ✅ State 3: Mission Complete, Next Ready
```
Icon: 🚀 (static)
Count: "2/3"
Name: "Implement UI Features" (next mission)
Progress: 33% (one mission done)
Button: "▶ Start" (green, enabled)
```

#### ✅ State 4: All Missions Complete
```
Icon: 🎉 (static)
Count: "3/3"
Name: "All Complete!"
Progress: 100% (full green bar)
Button: "✓ Done" (transparent, disabled)
Background: Green gradient
```

## Mission Control Bar Logic Tests

### Test 1: `isPaused` Detection
```javascript
// Events: [mission_completed(M1), execution_paused, mission_selected(M2), mission_started(M2)]
// Expected: isPaused = false (pause was BEFORE M2 start)

const events = [
  { type: 'mission_completed', payload: { mission_id: 'M1' } },
  { type: 'execution_paused', payload: { reason: 'awaiting_mission_start' } },
  { type: 'mission_selected', payload: { mission_id: 'M2' } },
  { type: 'mission_started', payload: { mission_id: 'M2' } }, // ← START INDEX
  { type: 'step_started', payload: { step_index: 0 } }
];

Result: 
✓ lastMissionStarted found at index 3
✓ eventsAfterStart = [step_started] (index 4+)
✓ No pause events in eventsAfterStart
✓ isPaused = false
✓ isRunning = true ✅
```

### Test 2: True Pause During Mission
```javascript
// Events: [mission_started(M2), step_started, execution_paused, ...]
// Expected: isPaused = true (pause AFTER M2 start)

const events = [
  { type: 'mission_started', payload: { mission_id: 'M2' } }, // ← START INDEX
  { type: 'step_started', payload: { step_index: 0 } },
  { type: 'execution_paused', payload: { reason: 'awaiting_approval' } }, // AFTER start
];

Result:
✓ lastMissionStarted found at index 0
✓ eventsAfterStart = [step_started, execution_paused] (index 1+)
✓ lastPauseAfterStart found
✓ No resume events after pause
✓ isPaused = true ✅
✓ isRunning = false ✅
```

### Test 3: Multiple Mission Starts (Edge Case)
```javascript
// Events: Mission 2 starts, fails, user retries → starts again
// Expected: Use LATEST mission_started event

const events = [
  { type: 'mission_started', payload: { mission_id: 'M2' } }, // First attempt
  { type: 'step_failed', payload: {} },
  { type: 'mission_paused', payload: {} },
  { type: 'mission_started', payload: { mission_id: 'M2' } }, // ← Retry (LATEST)
  { type: 'step_started', payload: {} }
];

Result:
✓ missionStartedEvents has 2 entries
✓ lastMissionStarted = events[3] (second start) ✅
✓ eventsAfterStart = [step_started] (from index 4)
✓ No pause after latest start
✓ isPaused = false ✅
✓ isRunning = true ✅
```

## Files Modified Summary

### **packages/webview/src/index.ts**
- **Function:** `getMissionProgress()`
- **Change:** Fixed `isPaused` logic to only check pause events AFTER mission started
- **Lines:** ~1880-1920
- **Impact:** ✅ UI now correctly shows "Running" state when mission executes

## Build & Deployment

```bash
# Build all packages
pnpm run build

# Expected Output
✅ packages/core: Compiled successfully
✅ packages/webview: Compiled successfully  
✅ packages/extension: Compiled successfully
```

## Testing Checklist

### Pre-Test Setup
- [ ] Build completed successfully (`pnpm run build`)
- [ ] No TypeScript errors
- [ ] Extension reloaded in VS Code (F5)

### Test: Complex Prompt Flow
- [ ] **Step 1:** Submit complex prompt (5+ tasks)
- [ ] **Step 2:** Verify plan generation shows detailed card
- [ ] **Step 3:** Click "Approve Plan"
- [ ] **Step 4:** Verify "Large Plan Detected" explanation shows
- [ ] **Step 5:** Verify mission breakdown card displays (3 missions)
- [ ] **Step 6:** Verify Mission Control Bar appears at bottom

### Test: Mission 1 Execution
- [ ] **Step 7:** Click "Select This Mission" on Mission 1
- [ ] **Step 8:** Verify Mission 1 card shows "✅ Selected"
- [ ] **Step 9:** Verify MCB shows "🚀 1/3 [Mission Name] ▶ Start"
- [ ] **Step 10:** Click "▶ Start" button in MCB
- [ ] **Step 11:** ✅ **CRITICAL:** Verify MCB icon changes to 🔄 (spinning)
- [ ] **Step 12:** ✅ **CRITICAL:** Verify MCB button shows "⏳ Running..." (disabled)
- [ ] **Step 13:** ✅ **CRITICAL:** Verify MCB border pulses blue
- [ ] **Step 14:** Wait for Mission 1 to complete
- [ ] **Step 15:** Verify Mission 1 shows completion in timeline

### Test: Mission 2 Execution (THE FIX!)
- [ ] **Step 16:** Verify Mission 2 auto-selected
- [ ] **Step 17:** Verify MCB updates to "🚀 2/3 [Mission 2 Name] ▶ Start"
- [ ] **Step 18:** Click "▶ Start" button in MCB
- [ ] **Step 19:** ✅ **CRITICAL FIX:** Verify MCB icon changes to 🔄 (spinning) - NOT stuck on 🚀!
- [ ] **Step 20:** ✅ **CRITICAL FIX:** Verify MCB button shows "⏳ Running..." - NOT still "▶ Start"!
- [ ] **Step 21:** ✅ **CRITICAL FIX:** Verify MCB border pulses blue - visual feedback!
- [ ] **Step 22:** Verify timeline shows "Step Started" events
- [ ] **Step 23:** Wait for Mission 2 to complete

### Test: Mission 3 & Completion
- [ ] **Step 24:** Verify Mission 3 auto-selected
- [ ] **Step 25:** Click "▶ Start" on Mission 3
- [ ] **Step 26:** Verify running state updates correctly
- [ ] **Step 27:** Wait for Mission 3 to complete
- [ ] **Step 28:** Verify MCB shows "🎉 3/3 All Complete! ✓ Done"
- [ ] **Step 29:** Verify progress bar is 100% green

### Test: Edge Cases
- [ ] **Rapid clicks:** Click Start button multiple times rapidly → should ignore duplicates
- [ ] **Page reload:** Reload webview mid-mission → state should persist
- [ ] **Tab switching:** Switch between Mission/Systems/Logs tabs → no state loss

## Known Issues (Fixed)

### ❌ Before Fix
```
Problem: Mission 2 starts executing, but UI doesn't update
- Icon: 🚀 (static) ❌
- Button: "▶ Start" (still enabled) ❌  
- No visual feedback ❌
- User confused: "Is it running?" ❌
```

### ✅ After Fix
```
Solution: Fixed isPaused logic to check events AFTER mission start
- Icon: 🔄 (spinning) ✅
- Button: "⏳ Running..." (disabled) ✅
- Border: Blue pulsing animation ✅
- Clear visual feedback ✅
```

## Debugging Tips

### If UI Doesn't Update When Mission Starts:

1. **Check Browser Console:**
   ```
   [MCB] getMissionProgress called
   [MCB] Selected mission: <mission_id>
   [MCB] hasMissionStarted: true
   [MCB] isPaused: false  ← Should be false!
   [MCB] isRunning: true  ← Should be true!
   ```

2. **Check Logs Tab:**
   - Filter by Type: `mission_started`
   - Verify event has correct `mission_id` in payload
   - Verify timestamp is AFTER `execution_paused` from previous mission

3. **Check Event Sequence:**
   ```
   execution_paused (reason: awaiting_mission_start) ← From Mission 1
   mission_selected (mission_id: M2)
   mission_started (mission_id: M2) ← Must have M2 in payload!
   step_started
   ```

### If Mission Starts Multiple Times:

**Root Cause:** Duplicate click handling issue

**Check:** `packages/extension/src/extension.ts`
```typescript
// Look for duplicate detection in ordinex:startMission handler
const pendingMissionStarts = new Set();
if (pendingMissionStarts.has(missionId)) {
  console.log('Duplicate mission start ignored');
  return;
}
```

## Success Criteria

### ✅ Complete Flow Works
- [ ] Complex prompt → Plan → Breakdown → Multi-mission execution
- [ ] Each mission can be started individually
- [ ] UI updates immediately when mission starts
- [ ] Progress bar reflects actual progress
- [ ] All missions can be completed sequentially

### ✅ Mission Control Bar
- [ ] Appears after mission breakdown
- [ ] Shows correct count (e.g., "2/3")
- [ ] Shows correct mission name
- [ ] Updates icon based on state (🚀 → 🔄 → 🚀 → 🎉)
- [ ] Spinning animation works during execution
- [ ] Button states correct (Start → Running → Done)
- [ ] Progress bar fills correctly (0% → 33% → 66% → 100%)

### ✅ Event Flow Integrity
- [ ] No duplicate `mission_started` events
- [ ] No orphaned pause events affecting wrong missions
- [ ] Proper temporal ordering maintained
- [ ] Each mission tracked independently

## Performance Metrics

**Expected Timing:**
- Plan generation: 2-5 seconds
- Mission breakdown: 1-2 seconds
- Mission start: <100ms (UI update instant)
- Each mission execution: 30-120 seconds (depends on complexity)

## Rollback Plan (If Issues Found)

If testing reveals new issues:

1. **Revert webview changes:**
   ```bash
   git checkout packages/webview/src/index.ts
   pnpm run build
   ```

2. **Check previous working commit:**
   ```bash
   git log --oneline packages/webview/src/index.ts
   git checkout <hash> packages/webview/src/index.ts
   ```

## Related Documentation

- `MISSION_CONTROL_BAR_UI_FIX.md` - This fix details
- `DUPLICATE_MISSION_START_FIX.md` - Prevents duplicate starts
- `MANUAL_MISSION_START_FIX.md` - User must click Start manually
- `MISSION_BREAKDOWN_STEP26_SUMMARY.md` - Mission breakdown implementation
- `MISSION_EXECUTION_HARNESS_STEP27_SUMMARY.md` - Mission runner architecture

## Next Steps After Testing

1. ✅ **Verify all test scenarios pass**
2. ✅ **Check edge cases don't break**
3. ✅ **Document any remaining issues**
4. 🚀 **Ready for production use**

---

**Status:** Fix implemented and built. Ready for user testing.  
**Primary Fix:** Mission Control Bar now correctly shows "Running" state when mission starts.  
**Impact:** Eliminates user confusion about whether mission is executing.
