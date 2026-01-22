# PLAN Mode Clarification UI Fix - CRITICAL

## Problem
When PLAN mode detects low prompt clarity:
1. ✅ Prompt is assessed correctly
2. ✅ `clarification_requested` event is emitted
3. ✅ `execution_paused` with reason `awaiting_clarification` is emitted
4. ❌ **NO UI is shown for user to provide clarification**
5. ❌ **User is STUCK - cannot proceed**

## Root Cause
The webview `renderMissionTimeline()` function only DISPLAYS the events but doesn't render an **interactive form** after `clarification_requested` + `execution_paused`.

## Solution Overview
1. **Webview**: Add inline clarification form after detection of paused state
2. **Webview**: Add handler to submit clarification
3. **Extension**: Add message handler for `ordinex:submitClarification`
4. **Extension**: Combine original prompt + clarification and resume plan generation

## Implementation

### Step 1: Add Clarification Form in Webview (packages/webview/src/index.ts)

In the `renderMissionTimeline()` function, AFTER rendering the `execution_paused` event card, add:

```javascript
// INLINE CLARIFICATION FORM: After clarification_requested + execution_paused
if (event.type === 'execution_paused' && event.payload.reason === 'awaiting_clarification') {
  // Find the clarification_requested event to get the question
  const clarReqEvent = events.find(e => e.type === 'clarification_requested');
  if (clarReqEvent) {
    const question = clarReqEvent.payload.clarifying_question || clarReqEvent.payload.question || 'Please provide more details about your request';
    const originalPrompt = clarReqEvent.payload.original_prompt || '';
    const missingInfo = clarReqEvent.payload.missing_info || [];
    
    items.push(\`
      <div style="margin: 16px 0; padding: 16px; background: var(--vscode-inputValidation-warningBackground); border: 2px solid var(--vscode-charts-yellow); border-radius: 6px; animation: fadeIn 0.3s ease-in;">
        <div style="font-weight: 700; font-size: 14px; margin-bottom: 8px; color: var(--vscode-foreground);">💬 Clarification Needed</div>
        <div style="font-size: 12px; margin-bottom: 8px; color: var(--vscode-descriptionForeground);">\${escapeHtml(question)}</div>
        \${missingInfo.length > 0 ? \`
          <div style="font-size: 11px; margin-bottom: 12px; color: var(--vscode-descriptionForeground);">
            <strong>Missing information:</strong> \${missingInfo.join(', ')}
          </div>
        \` : ''}
        <textarea 
          id="clarificationInput" 
          placeholder="Provide clarification here..."
          style="width: 100%; min-height: 80px; padding: 8px; border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: inherit; font-size: 12px; resize: vertical;"
        ></textarea>
        <button 
          onclick="handleSubmitClarification('\${event.task_id}', '\${escapeHtml(originalPrompt).replace(/'/g, "\\'")}')
          style="margin-top: 8px; width: 100%; padding: 10px; background: var(--vscode-charts-green); color: #fff; border: none; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 12px; transition: all 0.2s ease;"
          onmouseover="this.style.background='#28a745'"
          onmouseout="this.style.background='var(--vscode-charts-green)'"
        >
          Submit Clarification →
        </button>
      </div>
    \`);
  }
}
```

### Step 2: Add Handler Function in Webview (packages/webview/src/index.ts)

Add this global function near other handlers like `handleApproval`:

```javascript
// ===== CLARIFICATION HANDLER =====
window.handleSubmitClarification = function(taskId, originalPrompt) {
  console.log('handleSubmitClarification called', { taskId });
  
  const clarInput = document.getElementById('clarificationInput');
  if (!clarInput) {
    console.error('Clarification input not found');
    return;
  }
  
  const clarification = clarInput.value.trim();
  
  if (!clarification) {
    alert('Please provide clarification before submitting');
    return;
  }
  
  // Send to backend
  if (typeof vscode !== 'undefined') {
    vscode.postMessage({
      type: 'ordinex:submitClarification',
      task_id: taskId,
      original_prompt: originalPrompt,
      clarification: clarification
    });
    
    // Disable input to prevent double submission
    clarInput.disabled = true;
    clarInput.style.opacity = '0.5';
    
    console.log('Clarification submitted to backend');
  } else {
    console.log('Demo mode: would submit clarification');
    alert('Extension backend not available');
  }
};
```

### Step 3: Add Message Handler in Extension (packages/extension/src/extension.ts)

In the `handleMessage()` method, add new case:

```typescript
case 'ordinex:submitClarification':
  await this.handleSubmitClarification(message, webview);
  break;
```

### Step 4: Implement Handler Method in Extension (packages/extension/src/extension.ts)

Add this method to the `MissionControlViewProvider` class:

```typescript
private async handleSubmitClarification(message: any, webview: vscode.Webview) {
  const { task_id, original_prompt, clarification } = message;

  if (!task_id || !original_prompt || !clarification) {
    console.error('Missing required fields in submitClarification');
    return;
  }

  try {
    console.log('[handleSubmitClarification] Received clarification for task:', task_id);

    // Emit clarification_received event
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'clarification_received',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: {
        original_prompt: original_prompt,
        clarification: clarification
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    // Send events to webview
    await this.sendEventsToWebview(webview, task_id);

    // Combine prompts using utility function
    const combinedPrompt = combinePromptWithClarification(original_prompt, clarification);
    console.log('[handleSubmitClarification] Combined prompt created');

    // Resume plan generation with combined prompt
    // Get model ID from original intent event
    const events = this.eventStore?.getEventsByTaskId(task_id) || [];
    const intentEvent = events.find((e: Event) => e.type === 'intent_received');
    const modelId = (intentEvent?.payload.model_id as string) || 'claude-3-haiku';

    // Emit execution_resumed
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: task_id,
      timestamp: new Date().toISOString(),
      type: 'execution_resumed',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: {
        reason: 'clarification_received',
        description: 'Resuming plan generation with clarification'
      },
      evidence_ids: [],
      parent_event_id: null,
    });

    await this.sendEventsToWebview(webview, task_id);

    // Now continue with plan generation using combined prompt
    // This is the same flow as handlePlanMode but with combined prompt
    await this.handlePlanMode(combinedPrompt, task_id, modelId, webview);

    console.log('[handleSubmitClarification] Plan generation resumed');

  } catch (error) {
    console.error('Error handling submitClarification:', error);
    vscode.window.showErrorMessage(`Failed to process clarification: ${error}`);
  }
}
```

## Testing Steps

1. Reload extension
2. Select PLAN mode
3. Submit vague prompt: "plan the next features"
4. Wait for clarification request
5. ✅ Verify form appears with question
6. Enter clarification: "Add user authentication with JWT tokens and password reset flow"
7. Click "Submit Clarification →"
8. ✅ Verify events update: `clarification_received`, `execution_resumed`
9. ✅ Verify plan is generated with combined prompt
10. ✅ Verify plan card displays with approve button

## Expected Flow After Fix

```
User submits vague prompt
  ↓
Prompt assessed (clarity: low)
  ↓
clarification_requested event
  ↓
execution_paused (awaiting_clarification)
  ↓
[UI SHOWS FORM] ← THIS WAS MISSING
  ↓
User enters clarification
  ↓
clarification_received event
  ↓
execution_resumed event
  ↓
Combined prompt → Plan generation
  ↓
plan_created event with detailed plan
  ↓
User approves → MISSION mode
```

## Files to Modify

1. `packages/webview/src/index.ts` - Add form rendering + handler
2. `packages/extension/src/extension.ts` - Add message handler + implementation
3. Build: `pnpm run build`
4. Reload: Press F5 or "Developer: Reload Window"
