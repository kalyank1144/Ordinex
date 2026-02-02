# Greenfield Scaffold UX - Final Implementation Plan

**Date:** January 31, 2026  
**Status:** APPROVED - Ready for Implementation  
**Goal:** Fix scaffold UX to show rich proposal card (recipe + design pack + preview + counts) with single approval flow, no generic decision cards

---

## 🎯 PROBLEM STATEMENT

**Current Bug:**
- User sees TWO cards: small "Scaffold Proposal Ready" + generic yellow decision card
- Missing: clarifications, rich proposal details, design pack preview, file counts
- Root cause: scaffold uses generic `decision_point_needed`, UI doesn't route to ScaffoldCard

**Expected UX:**
- ONE rich ScaffoldProposalCard showing full details
- Clarifications (max 2) → Preflight → Rich Proposal → Apply → Verify → Next Steps
- NO generic yellow decision card for scaffold approval

---

## ✅ LOCKED-IN DECISIONS

### Decision 1: Event Schema (Option 1 - New Events)
Create scaffold-specific decision events, NOT generic `decision_point_needed`:
```typescript
- scaffold_clarification_needed
- scaffold_clarification_answered
- scaffold_decision_requested    // REPLACES decision_point_needed
- scaffold_decision_resolved
- scaffold_next_steps_ready
```

### Decision 2: Clarifications (NEW scaffold events, max 2)
- Platform: Web / Mobile / Both
- Auth: Yes / No / Skip
- Use dedicated scaffold_clarification_needed events

### Decision 3: Preview Images (Option C - CSS Gradients V1)
- Ship V1 with CSS gradients only (no asset pipeline assumptions)
- Design pack preview uses gradient backgrounds with pack initial
- Real images can be added later once webview asset bundling is confirmed

### Decision 4: Auto-Verify After Scaffold (AUTO-RUN finite only)
- After scaffold_applied success → AUTO-TRIGGER verify phase (Step 34/34.5)
- Run ONLY finite commands: install, lint, build, test
- NEVER auto-run dev server (prompt-gated in next steps)
- Bounded repair if verify fails

### Decision 5: Next Steps Routing (Real wiring)
```typescript
Start Dev Server   → commandPhase (Step 34.5) prompt-gated
Add Authentication → PLAN mode
Create New Page    → QUICK_ACTION
Connect Database   → PLAN mode
```

---

## 📋 IMPLEMENTATION PHASES (STRICT ORDER)

### Phase A: Event Type Definitions
**File:** `packages/core/src/types.ts`

**Add 5 new event types:**
```typescript
export type OrdinexEvent =
  | { type: 'scaffold_clarification_needed'; payload: { ... } }
  | { type: 'scaffold_clarification_answered'; payload: { ... } }
  | { type: 'scaffold_decision_requested'; payload: { ... } }
  | { type: 'scaffold_decision_resolved'; payload: { ... } }
  | { type: 'scaffold_next_steps_ready'; payload: { ... } }
  | ... // existing types
```

**Update canonical event type arrays** for validation

---

### Phase B: scaffoldFlow Backend Wiring
**File:** `packages/core/src/scaffoldFlow.ts`

**Event Sequence:**
1. `scaffold_started` - User prompt, target directory
2. (0-2x) `scaffold_clarification_needed` → wait for `scaffold_clarification_answered`
   - Platform clarification (web/mobile/both)
   - Auth clarification (yes/no/skip)
3. `scaffold_preflight_completed` - Target dir, empty/non-empty, monorepo detection
4. `scaffold_proposal_created` - FULL payload:
   ```typescript
   {
     proposal_id: string
     recipe_id: string
     recipe_label: string
     component_system: string
     design_pack_id: string
     design_pack_label: string
     preview_gradient: string  // CSS gradient for V1
     file_count: number
     dir_count: number
     commands_to_run: string[]
     summary: string
   }
   ```
5. `scaffold_decision_requested` - Options: [proceed, cancel, change_style]
6. On Proceed:
   - `scaffold_applied` - Files created
   - AUTO-TRIGGER verify phase (Step 34/34.5)
   - `verify_started` → `verify_completed`
   - Bounded repair if needed
   - `scaffold_completed` + `scaffold_next_steps_ready`

**CRITICAL:** Remove any `decision_point_needed` emission for scaffold approval

---

### Phase C: Webview UI Rendering
**Files:** 
- `packages/webview/src/components/ScaffoldCard.ts`
- `packages/webview/src/index.ts`

**ScaffoldCard Changes:**

1. **Add action buttons to `renderProposal()` method:**
```typescript
<div class="scaffold-actions">
  <button class="scaffold-btn-proceed" onclick="handleScaffoldDecision('proceed')">
    ✅ Proceed
  </button>
  <button class="scaffold-btn-cancel" onclick="handleScaffoldDecision('cancel')">
    Cancel
  </button>
</div>
```

2. **Update preview section with gradient:**
```typescript
<div class="design-pack-preview">
  <div class="preview-gradient" style="background: ${payload.preview_gradient}">
    <span class="pack-initial">${designPack.charAt(0)}</span>
  </div>
  <button class="change-style-btn">🎨 Change Style</button>
</div>
```

3. **Add clarification card renderer:**
```typescript
renderClarification(payload) {
  // Render platform/auth choices as buttons
}
```

**index.ts Changes:**

1. **Route scaffold_decision_requested to ScaffoldCard** (NOT generic DecisionPointCard)
2. **Disable generic DecisionPointCard for scaffold** (check event type/kind)
3. **Add scaffold_next_steps_ready renderer**

---

### Phase D: Next Steps Routing
**File:** `packages/webview/src/components/NextStepsCard.ts` (use existing)

**Wire action buttons:**
```typescript
Start Dev Server:
  → vscode.postMessage({ 
      type: 'ordinex:startCommand', 
      command: 'dev', 
      promptGated: true 
    })

Add Authentication:
  → vscode.postMessage({ 
      type: 'ordinex:startPlan', 
      prompt: 'Add auth to project' 
    })

Create New Page:
  → vscode.postMessage({ 
      type: 'ordinex:quickAction', 
      action: 'create_page' 
    })

Connect Database:
  → vscode.postMessage({ 
      type: 'ordinex:startPlan', 
      prompt: 'Connect database' 
    })
```

---

### Phase E: Regression Test
**File:** `packages/core/src/__tests__/scaffoldFlow.test.ts`

**Test Case:**
```typescript
test('scaffold flow shows rich proposal, not generic decision card', async () => {
  const result = await orchestrator.handleGreenfieldScaffold({
    prompt: 'Create a new fitness app',
    workspaceRoot: '/test/workspace'
  });

  // Assert events emitted in correct order
  expect(result.events).toContainEventType('scaffold_started');
  expect(result.events).toContainEventType('scaffold_preflight_completed');
  expect(result.events).toContainEventType('scaffold_proposal_created');
  expect(result.events).toContainEventType('scaffold_decision_requested');
  
  // Assert NO generic decision_point_needed for scaffold
  expect(result.events).not.toContainEventType('decision_point_needed');
  
  // Assert proposal payload is rich
  const proposal = result.events.find(e => e.type === 'scaffold_proposal_created');
  expect(proposal.payload).toHaveProperty('recipe_id');
  expect(proposal.payload).toHaveProperty('design_pack_id');
  expect(proposal.payload).toHaveProperty('file_count');
  expect(proposal.payload).toHaveProperty('commands_to_run');
});
```

---

## 🎯 STOP CONDITIONS (Success Criteria)

User sees this exact flow:
1. ✅ `scaffold_started` card
2. ✅ (0-2) Clarification cards with buttons (platform, auth)
3. ✅ `scaffold_preflight_completed` card (dir, empty/non-empty, monorepo)
4. ✅ **ONE RICH ScaffoldProposalCard** with:
   - Recipe/framework name
   - Component system
   - Design pack with CSS gradient preview
   - File/dir counts
   - Commands to run list
   - Footer buttons: ✅ Proceed (green), Cancel (gray), 🎨 Change Style
5. ✅ `scaffold_applied` → auto-verify (finite commands) → bounded repair
6. ✅ `scaffold_completed` + NextStepsCard with real action routing
7. ❌ NO generic yellow decision card for scaffold approval
8. ✅ Dev server NEVER auto-runs (prompt-gated button in next steps)

---

## 📦 FILES TO MODIFY (8 files)

1. `packages/core/src/types.ts` - Add 5 event types
2. `packages/core/src/scaffoldFlow.ts` - Wire event sequence + auto-verify
3. `packages/webview/src/components/ScaffoldCard.ts` - Add buttons + clarification renderer
4. `packages/webview/src/components/NextStepsCard.ts` - Wire action routing
5. `packages/webview/src/index.ts` - Route scaffold events to ScaffoldCard
6. `packages/webview/src/types.ts` - Add event type definitions
7. `packages/core/src/__tests__/scaffoldFlow.test.ts` - Add regression test
8. `packages/core/src/eventNormalizer.ts` - Add new event types to normalizer

---

## ⚠️ CRITICAL CONSTRAINTS

1. **NO BREAKING CHANGES** - Keep existing events intact (event replay compatibility)
2. **CSS GRADIENTS ONLY** - No asset pipeline assumptions for V1
3. **NEVER AUTO-RUN DEV SERVER** - Always prompt-gated
4. **REMOVE decision_point_needed FOR SCAFFOLD** - Use scaffold_decision_requested
5. **MAX 2 CLARIFICATIONS** - Platform + Auth only
6. **AUTO-VERIFY FINITE COMMANDS** - install/lint/build/test, NOT serve/dev/watch

---

## 📊 ESTIMATED TIMELINE

- Phase A (Event types): 20 minutes
- Phase B (scaffoldFlow): 60 minutes
- Phase C (Webview UI): 45 minutes
- Phase D (Next steps): 30 minutes
- Phase E (Tests): 25 minutes
- **Total: ~3 hours**

---

## ✅ APPROVAL STATUS

- [x] All 5 decisions locked in
- [x] Stop conditions defined
- [x] Implementation order confirmed
- [x] File list identified
- [x] Constraints documented
- [x] Plan approved by user
- [ ] **READY FOR IMPLEMENTATION** ← Toggle to Act mode to proceed

---

**Next Step:** Execute Phase A (Event type definitions)
