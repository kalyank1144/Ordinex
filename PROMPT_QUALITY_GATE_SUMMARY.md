# Prompt Quality Gate Implementation Summary

**Date**: 2026-01-21  
**Objective**: Add dynamic "Prompt Quality Gate" before PLAN generation to prevent vague prompts from producing generic plans.

## ✅ Implementation Complete

### Core Components

#### 1. New Event Types Added to `types.ts`
- `prompt_assessed` - Records prompt clarity assessment
- `prompt_rewritten` - Records prompt rewriting for medium clarity
- `clarification_requested` - Requests user clarification for low clarity
- `clarification_received` - Records user's clarification response

#### 2. PromptQualityJudge Module (`packages/core/src/promptQualityJudge.ts`)
**Purpose**: Assess prompt clarity and provide structured guidance before plan generation

**Features**:
- Uses cheap LLM model (claude-3-haiku) for cost-effective assessment
- Takes lightweight context (tech stack, top-level files, open files only)
- Returns strict JSON with clarity level and guidance
- Falls back gracefully if assessment fails

**Assessment Output**:
```typescript
{
  clarity: 'high' | 'medium' | 'low',
  detected_intent: 'answer' | 'plan' | 'mission',
  missing_info: string[],
  safe_rewrite: string,      // For medium clarity
  clarifying_question: string // For low clarity
}
```

**Rules for safe_rewrite (Medium Clarity)**:
- ✅ Never invents specific features or requirements
- ✅ Adds structure by asking the LLM to present options
- ✅ Requests effort estimates and tradeoffs
- ✅ Asks for repo-grounded recommendations
- ❌ Does NOT fabricate implementation details

#### 3. Integration into PLAN Mode Flow (`extension.ts`)

**New Flow**:
```
1. intent_received
2. mode_set(PLAN)
3. prompt_assessed (NEW) 👈 Quality Gate
4. Branch based on clarity:
   
   HIGH CLARITY → proceed as-is
   ├─> context_collected
   ├─> llm_plan
   └─> plan_created
   
   MEDIUM CLARITY → rewrite prompt
   ├─> prompt_rewritten (NEW) 👈
   ├─> context_collected
   ├─> llm_plan  (uses rewritten prompt)
   └─> plan_created
   
   LOW CLARITY → ask clarification
   ├─> clarification_requested (NEW) 👈
   └─> execution_paused(awaiting_clarification) 🛑
       (waits for user to provide clarification)
```

**Clarity Detection Criteria**:

| Clarity | Criteria | Example |
|---------|----------|---------|
| **High** | Mentions specific files, components, or features from project | "Add error handling to UserService.ts and display in LoginForm.tsx" |
| **Medium** | Clear intent but lacks specificity; could benefit from structure | "Improve error handling" or "Add authentication" |
| **Low** | Too vague or open-ended; unclear goal | "What features can we add?" or "Make it better" |

#### 4. Helper Functions

**`combinePromptWithClarification()`**:
- Combines original prompt + clarification answer
- Used when user provides clarification for low-clarity prompts
- Format:
  ```
  # Original Request
  <original>
  
  # Clarification Provided
  <answer>
  
  Based on the original request and the clarification above, generate a detailed implementation plan.
  ```

**`inferStack()`** in extension.ts:
- Lightweight stack detection from file names/extensions
- Used for assessment context (no file content needed)
- Detects: Node.js, TypeScript, React, Vue, Angular, Python, Java, Go, Rust, etc.

## 📊 Event Flow Examples

### Example 1: High Clarity (Proceed as-is)
```
User: "Add input validation to loginForm.tsx with proper error messages"

Events:
1. intent_received
2. mode_set(PLAN)
3. prompt_assessed { clarity: 'high' }
4. context_collected
5. plan_created ✅
```

### Example 2: Medium Clarity (Rewrite)
```
User: "Improve error handling"

Events:
1. intent_received
2. mode_set(PLAN)
3. prompt_assessed { clarity: 'medium' }
4. prompt_rewritten {
     original: "Improve error handling",
     rewritten: "Analyze current error handling in the codebase and propose 
                 2-3 improvement options with effort estimates and tradeoffs.
                 Ground recommendations in specific files found in the project."
   }
5. context_collected
6. plan_created (uses rewritten prompt) ✅
```

### Example 3: Low Clarity (Request Clarification)
```
User: "What features can we add?"

Events:
1. intent_received
2. mode_set(PLAN)
3. prompt_assessed { clarity: 'low' }
4. clarification_requested {
     question: "What problem are you trying to solve, or what user need 
                are you addressing with these new features?"
   }
5. execution_paused { reason: 'awaiting_clarification' } 🛑

(User provides clarification...)

6. clarification_received
7. context_collected
8. plan_created (uses combined prompt) ✅
```

## 🎯 Benefits

### 1. **Prevents Generic Plans**
- Vague prompts → structured requests with options framing
- Forces grounding in actual project files
- No more "analyze requirements" → "implement solution" → "test"

### 2. **Deterministic & Auditable**
- All prompt transformations logged as events
- No hidden rewrites
- Full transparency in event stream

### 3. **Cost-Effective**
- Uses cheap model (Haiku) for assessment
- Only one extra LLM call before plan generation
- Fallback to medium clarity if assessment fails

### 4. **User-Friendly**
- Clear clarity reasons in events
- Focused clarification questions (not a barrage)
- Helpful prompt refinements visible in UI

## 🚧 Still To Do

### 1. UI Components (Next Priority)

Need to create these components in `packages/webview/src/components/`:

#### A. **PromptRefinedCard.ts**
Display when `prompt_rewritten` event occurs:
```typescript
- Show collapsible card in Mission tab
- Display:
  - "Prompt Refined" header
  - Original prompt (collapsed by default)
  - Rewritten prompt (expanded)
  - Why it was rewritten (missing_info)
```

#### B. **ClarificationCard.ts**
Display when `clarification_requested` event occurs:
```typescript
- Show prominent card in Mission tab
- Display:
  - "Clarification Needed" header  
  - The clarifying question
  - Text input for user answer
  - "Submit" button
  - Disable other actions until answered
```

#### C. Update **PlanCard.ts**
- Show clarity level badge (high/medium/low)
- Link to related prompt_assessed event

### 2. Clarification Response Handler

Add to `extension.ts`:
```typescript
case 'ordinex:submitClarification':
  await this.handleSubmitClarification(message, webview);
  break;
```

Implementation:
```typescript
private async handleSubmitClarification(message: any, webview: vscode.Webview) {
  const { task_id, clarification_text } = message;
  
  // Get original prompt from events
  const events = this.eventStore.getEventsByTaskId(task_id);
  const clarificationEvent = events.find(e => 
    e.type === 'clarification_requested' &&
    events.some(pe => pe.type === 'execution_paused' && 
                     pe.payload.reason === 'awaiting_clarification')
  );
  
  const originalPrompt = clarificationEvent.payload.original_prompt;
  
  // Combine prompts
  const combinedPrompt = combinePromptWithClarification(
    originalPrompt,
    clarification_text
  );
  
  // Emit clarification_received
  await this.emitEvent({
    type: 'clarification_received',
    payload: {
      original_prompt: originalPrompt,
      clarification_answer: clarification_text,
      combined_prompt: combinedPrompt
    }
  });
  
  // Resume PLAN mode with combined prompt
  await this.handlePlanMode(combinedPrompt, task_id, modelId, webview);
}
```

### 3. Testing

Manual test scenarios:
- [ ] Test with high-clarity prompt (specific file mentions)
- [ ] Test with medium-clarity prompt (vague but intentional)
- [ ] Test with low-clarity prompt (exploratory question)
- [ ] Test clarification flow end-to-end
- [ ] Test with LLM assessment failure (should fallback gracefully)
- [ ] Verify all events appear in Logs tab
- [ ] Verify no duplicate prompts assessments on retry

### 4. Edge Cases to Handle

- [ ] User submits another prompt while waiting for clarification
  - Solution: Cancel pending clarification, start new assessment
- [ ] User provides unclear clarification answer
  - Solution: Could re-assess combined prompt, but V1 just proceeds
- [ ] Assessment detects wrong intent (e.g., classifies as "answer" not "plan")
  - Solution: Log it in payload but stay in PLAN mode (human chose the mode)

## 📝 Files Changed

### New Files
- `packages/core/src/promptQualityJudge.ts` (new module)

### Modified Files
- `packages/core/src/types.ts` (added 4 new event types)
- `packages/core/src/index.ts` (exported PromptQualityJudge)
- `packages/extension/src/extension.ts` (integrated into PLAN mode)

## ✅ Quality Checklist

- [x] New event types added to canonical list
- [x] PromptQualityJudge module created
- [x] Integration into PLAN flow complete
- [x] High clarity: proceeds as-is
- [x] Medium clarity: rewrites safely
- [x] Low clarity: requests clarification + pauses
- [x] All events emitted properly
- [x] Fallback on assessment failure
- [x] No invented requirements in rewrites
- [ ] UI components for prompt refinement
- [ ] UI components for clarification
- [ ] Clarification response handler
- [ ] End-to-end testing

## 🎉 Ready for Testing

The backend logic is complete and ready for testing. The Prompt Quality Gate is now active in PLAN mode. Next steps:
1. Build UI components for refined prompts and clarification
2. Add clarification response handler
3. Test end-to-end with various prompt types

## 🚀 How to Test Now

Even without UI components, you can test the backend logic:

1. Start extension in debug mode
2. Submit a PLAN request with vague prompt
3. Check VS Code Output panel → Ordinex logs
4. Check event store JSON - look for:
   - `prompt_assessed` events
   - `prompt_rewritten` events (medium clarity)
   - `clarification_requested` events (low clarity)
   - `execution_paused` events
5. Verify clarity detection works correctly
6. Verify plan generation uses rewritten prompt

---

**Status**: Core implementation COMPLETE ✅  
**Next**: UI components + clarification handler 🚧
