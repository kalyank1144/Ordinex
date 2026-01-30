# Step 33 Integration Guide - Wiring Intent Analyzer into Extension

## Current Status: ❌ NOT INTEGRATED

Your extension.ts currently uses the **OLD flow**:
- `classifyPrompt()` - Simple heuristic classifier
- Direct mode branching (`if userSelectedMode === 'ANSWER'`)
- No behavior-first intelligence

## Integration Overview

### What Changes

**File**: `packages/extension/src/extension.ts`
**Function**: `handleSubmitPrompt()` (lines ~158-220)

### Required Imports (Add to top of extension.ts)

```typescript
import {
  // Step 33: Intent Analysis & Behavior Handlers
  analyzeIntent,
  executeBehavior,
  detectActiveRun,
  IntentAnalysisContext,
  IntentAnalysis,
  BehaviorHandlerResult,
  processClarificationResponse,
  processContinueRunResponse,
  // ... existing imports ...
} from 'core';
```

---

## Phase 1: Replace handleSubmitPrompt Logic

### BEFORE (Current Code - Lines 158-220)

```typescript
private async handleSubmitPrompt(message: any, webview: vscode.Webview) {
  const { text, userSelectedMode, modelId } = message;
  
  // ... validation ...
  
  // OLD: Use classifyPrompt
  const classification = classifyPrompt(text);
  const requiresConfirmation = shouldRequireConfirmation(
    userSelectedMode,
    classification.suggestedMode,
    classification.confidence
  );
  
  // OLD: Direct mode branching
  if (userSelectedMode === 'ANSWER') {
    await this.handleAnswerMode(...);
  } else if (userSelectedMode === 'PLAN') {
    await this.handlePlanMode(...);
  } else if (userSelectedMode === 'MISSION') {
    // generate template plan
  }
}
```

### AFTER (New Step 33 Flow)

```typescript
private async handleSubmitPrompt(message: any, webview: vscode.Webview) {
  const { text, userSelectedMode, modelId } = message;
  
  // ... validation ...
  
  // NEW: Build analysis context
  const events = this.eventStore?.getEventsByTaskId(taskId) || [];
  const analysisContext: IntentAnalysisContext = {
    clarificationAttempts: 0,
    lastOpenEditor: vscode.window.activeTextEditor?.document.fileName,
    activeRun: detectActiveRun(events),
    lastAppliedDiff: this.getLastAppliedDiff(events),
  };
  
  // NEW: Analyze intent (behavior-first)
  const analysis: IntentAnalysis = analyzeIntent(text, analysisContext);
  
  console.log('[Step33] Intent Analysis:', {
    behavior: analysis.behavior,
    derived_mode: analysis.derived_mode,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning
  });
  
  // NEW: Execute behavior handler
  const eventBus = new EventBus(this.eventStore!);
  const result: BehaviorHandlerResult = await executeBehavior({
    taskId,
    prompt: text,
    intentAnalysis: analysis,
    eventBus,
    analysisContext,
  });
  
  // NEW: Handle behavior result
  await this.handleBehaviorResult(result, text, taskId, modelId, webview);
}
```

---

## Phase 2: Add Behavior Result Handler

### New Function: handleBehaviorResult()

```typescript
/**
 * Handle the result from behavior execution
 */
private async handleBehaviorResult(
  result: BehaviorHandlerResult,
  prompt: string,
  taskId: string,
  modelId: string,
  webview: vscode.Webview
): Promise<void> {
  console.log('[Step33] Handling behavior result:', result.next_action);
  
  switch (result.next_action) {
    case 'stream_response':
      // ANSWER behavior → Stream LLM response
      await this.handleAnswerMode(prompt, taskId, modelId, webview);
      break;
      
    case 'show_clarification':
      // CLARIFY behavior → Show question UI
      await this.handleClarification(result, taskId, webview);
      break;
      
    case 'propose_diff':
      // QUICK_ACTION behavior → Generate diff
      await this.handleQuickAction(result, taskId, modelId, webview);
      break;
      
    case 'generate_plan':
      // PLAN behavior → Generate structured plan
      await this.handlePlanMode(prompt, taskId, modelId, webview);
      break;
      
    case 'show_run_status':
      // CONTINUE_RUN behavior → Show pause/resume UI
      await this.handleContinueRun(result, taskId, webview);
      break;
      
    case 'complete':
      // Handler finished (e.g., user override processed)
      await this.sendEventsToWebview(webview, taskId);
      break;
      
    default:
      console.error('[Step33] Unknown next_action:', result.next_action);
  }
}
```

---

## Phase 3: Add New Behavior Handlers

### 1. Handle Clarification

```typescript
private async handleClarification(
  result: BehaviorHandlerResult,
  taskId: string,
  webview: vscode.Webview
): Promise<void> {
  console.log('[Step33] CLARIFY: Showing clarification UI');
  
  // The clarification_requested event was already emitted by behaviorHandlers
  // Just send to webview
  await this.sendEventsToWebview(webview, taskId);
  
  // Webview will show ClarificationCard with options
  // User selection will trigger handleClarificationResponse
}
```

### 2. Handle Quick Action

```typescript
private async handleQuickAction(
  result: BehaviorHandlerResult,
  taskId: string,
  modelId: string,
  webview: vscode.Webview
): Promise<void> {
  console.log('[Step33] QUICK_ACTION: Generating minimal diff');
  
  // QUICK_ACTION is like MISSION but:
  // - No full plan generation
  // - Minimal context retrieval
  // - Single diff proposal
  
  // Get target files from payload
  const targetFiles = result.payload?.target_files as string[] || [];
  const scope = result.payload?.scope as string || 'small';
  
  // Generate a quick diff using existing proposeDiff logic
  await this.handleProposeDiff({ taskId, quickAction: true, targetFiles, scope }, webview);
}
```

### 3. Handle Continue Run

```typescript
private async handleContinueRun(
  result: BehaviorHandlerResult,
  taskId: string,
  webview: vscode.Webview
): Promise<void> {
  console.log('[Step33] CONTINUE_RUN: Showing run status UI');
  
  // The decision_point_needed event was already emitted by behaviorHandlers
  // Send to webview
  await this.sendEventsToWebview(webview, taskId);
  
  // Webview will show pause/resume/abort buttons
  // User action will trigger handleContinueRunAction
}
```

---

## Phase 4: Add Message Handlers

### Handle Clarification Response

```typescript
case 'ordinex:clarificationResponse':
  await this.handleClarificationResponse(message, webview);
  break;
```

```typescript
private async handleClarificationResponse(message: any, webview: vscode.Webview) {
  const { task_id, action, value } = message;
  
  if (!task_id) return;
  
  // Get original context
  const events = this.eventStore?.getEventsByTaskId(task_id) || [];
  const context: IntentAnalysisContext = {
    clarificationAttempts: 1, // Increment
    lastOpenEditor: vscode.window.activeTextEditor?.document.fileName,
  };
  
  // Get original prompt
  const intentEvent = events.find(e => e.type === 'intent_received');
  const originalPrompt = intentEvent?.payload.prompt as string || '';
  
  // Process clarification response
  const eventBus = new EventBus(this.eventStore!);
  const newAnalysis = await processClarificationResponse(
    originalPrompt,
    { action, value },
    context,
    eventBus,
    task_id
  );
  
  // Re-execute with new analysis
  const result = await executeBehavior({
    taskId: task_id,
    prompt: originalPrompt,
    intentAnalysis: newAnalysis,
    eventBus,
    analysisContext: context,
  });
  
  await this.handleBehaviorResult(result, originalPrompt, task_id, 'sonnet-4.5', webview);
}
```

### Handle Continue Run Action

```typescript
case 'ordinex:continueRunAction':
  await this.handleContinueRunAction(message, webview);
  break;
```

```typescript
private async handleContinueRunAction(message: any, webview: vscode.Webview) {
  const { task_id, action } = message; // action: 'resume' | 'pause' | 'abort' | 'propose_fix'
  
  if (!task_id || !action) return;
  
  const events = this.eventStore?.getEventsByTaskId(task_id) || [];
  const activeRun = detectActiveRun(events);
  
  if (!activeRun) {
    console.error('No active run found');
    return;
  }
  
  const eventBus = new EventBus(this.eventStore!);
  const result = await processContinueRunResponse(
    action,
    activeRun,
    eventBus,
    task_id
  );
  
  if (action === 'propose_fix') {
    // Handle quick fix proposal
    await this.handleQuickAction(result, task_id, 'sonnet-4.5', webview);
  } else {
    // Send updated events
    await this.sendEventsToWebview(webview, task_id);
  }
}
```

---

## Phase 5: Helper Functions

### Get Last Applied Diff

```typescript
private getLastAppliedDiff(events: Event[]): { files: string[]; timestamp: string } | undefined {
  const diffAppliedEvents = events
    .filter(e => e.type === 'diff_applied')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  if (diffAppliedEvents.length === 0) return undefined;
  
  const lastDiff = diffAppliedEvents[0];
  return {
    files: lastDiff.payload.files_changed as string[] || [],
    timestamp: lastDiff.timestamp,
  };
}
```

---

## Testing After Integration

### Test 1: ANSWER Behavior
```
Prompt: "What is TypeScript?"
Expected: behavior='ANSWER', streams explanation
```

### Test 2: QUICK_ACTION Behavior
```
Prompt: "Fix typo in src/index.ts"
Expected: behavior='QUICK_ACTION', single diff proposal
```

### Test 3: CLARIFY Behavior
```
Prompt: "Fix this"
Expected: behavior='CLARIFY', shows file selection UI
```

### Test 4: PLAN Behavior
```
Prompt: "Create a new React app from scratch"
Expected: behavior='PLAN', generates structured plan
```

### Test 5: User Override
```
Prompt: "/do fix the bug"
Expected: behavior='QUICK_ACTION', bypasses analysis
```

---

## Migration Strategy

### Option A: Gradual Migration (Recommended)
1. Keep existing flow as fallback
2. Add Step 33 behind feature flag
3. Test with specific prompts
4. Gradually enable for all prompts

### Option B: Full Replacement
1. Replace all classifyPrompt usage
2. Remove requiresConfirmation checks
3. Test extensively
4. Deploy

---

## Rollback Plan

If Step 33 causes issues:
1. Comment out Step 33 imports
2. Restore old `classifyPrompt` logic
3. File changes are additive, easy to revert

---

## Benefits After Integration

✅ **Smarter Intent Recognition**
- Detects trivial fixes vs. large features
- Resolves ambiguous references ("this", "it")
- Handles active mission interruptions

✅ **Better UX**
- Quick fixes don't need full plans
- Asks for clarification when needed
- Supports user override commands

✅ **Maintainable**
- Behavior-first architecture
- Deterministic heuristics (no LLM for routing)
- Event-compatible (no breaking changes)

---

## Next Steps

1. **Review this guide** - Understand the changes
2. **Backup extension.ts** - Copy current version
3. **Apply Phase 1** - Replace handleSubmitPrompt
4. **Test incrementally** - One behavior at a time
5. **Use testing guide** - `STEP33_TESTING_GUIDE.md` has 50+ test cases

**Estimated Time**: 2-3 hours for full integration + testing
