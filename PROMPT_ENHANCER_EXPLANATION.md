# Prompt Enhancer: Expected vs Implemented

## 🎯 What SHOULD Happen (Your Expectation)

**Silent, Internal Prompt Enhancement:**
```
User submits vague prompt
  ↓
System assesses quality internally
  ↓
System AUTOMATICALLY enhances/rewrites prompt
  ↓
Enhanced prompt → LLM (no user sees this)
  ↓
Plan generated with good quality
  ↓
User sees final plan (no awareness of enhancement)
```

**Key Points:**
- ✅ Prompt enhancement happens SILENTLY in the background
- ✅ User NEVER sees "clarification needed" or pauses
- ✅ System intelligently rewrites vague prompts into structured ones
- ✅ User only sees the end result (a good plan)
- ✅ NO UI interaction required from user

---

## ❌ What IS Happening (Current Behavior)

**Interactive Clarification Flow:**
```
User submits vague prompt ("plan the next features")
  ↓
System assesses: clarity = LOW
  ↓
System emits: clarification_requested event
  ↓
System emits: execution_paused (awaiting_clarification)
  ↓
UI SHOWS: "Clarification Requested" card
UI SHOWS: "Execution Paused" card
  ↓
[BLOCKED] - No form to provide clarification
  ↓
User is stuck, cannot proceed
```

**What the User Sees:**
```
┌─────────────────────────────────────────┐
│ Clarification Requested                 │
│ Missing: specific features or           │
│ functionalities the user wants to       │
│ implement, constraints or priorities... │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ Execution Paused                        │
│ awaiting_clarification                  │
└─────────────────────────────────────────┘
```

**Problems:**
- ❌ User sees internal clarification logic exposed in UI
- ❌ Execution stops and waits for user input
- ❌ No form exists to provide clarification (UI incomplete)
- ❌ Breaks the "silent enhancement" expectation

---

## 🛠️ What WAS Implemented (The Approach)

### Architecture Components

**1. PromptQualityJudge** (`packages/core/src/promptQualityJudge.ts`):
- Uses cheap LLM (Haiku) to assess prompt quality
- Returns assessment with 3 clarity levels:
  - **HIGH**: Specific, clear goal → Proceed as-is
  - **MEDIUM**: Has intent but vague → **AUTO-REWRITE with structure**
  - **LOW**: Too vague/open-ended → **ASK USER for clarification**

**2. Extension Handler** (`packages/extension/src/extension.ts` - `handlePlanMode()`):
```typescript
// Assess prompt quality
const assessment = await judge.assessPrompt(userPrompt, context);

if (assessment.clarity === 'low') {
  // LOW CLARITY: Ask clarification question and PAUSE
  await this.emitEvent({
    type: 'clarification_requested',
    payload: {
      clarifying_question: assessment.clarifying_question,
      missing_info: assessment.missing_info,
      original_prompt: userPrompt
    }
  });
  
  await this.emitEvent({
    type: 'execution_paused',
    payload: {
      reason: 'awaiting_clarification'
    }
  });
  
  // STOPS HERE - waits for user to provide clarification via UI
  return;
  
} else if (assessment.clarity === 'medium') {
  // MEDIUM CLARITY: Rewrite prompt with structure (AUTOMATIC)
  userPrompt = assessment.safe_rewrite;
  // Continue to plan generation with enhanced prompt
  
} else {
  // HIGH CLARITY: Proceed as-is
  // Continue to plan generation with original prompt
}

// Generate plan with (possibly enhanced) prompt
const plan = await generateLLMPlan(userPrompt, ...);
```

**3. What Happens for Each Clarity Level:**

| Clarity | Behavior | User Experience | Is This Silent? |
|---------|----------|-----------------|-----------------|
| **HIGH** | Proceed with original prompt | User sees plan immediately | ✅ YES |
| **MEDIUM** | Auto-rewrite with structure, then generate plan | User sees plan (enhanced internally) | ✅ YES |
| **LOW** | Emit events, pause execution, wait for user | User sees "Clarification Requested" + stuck | ❌ NO |

---

## 🔍 The Architectural Mismatch

### Your Expectation: "Prompt Enhancer"
A **prompt enhancer** implies:
- Takes poor input → produces better input
- Operates silently, like a pre-processor
- User never knows it happened
- Similar to spell-check or grammar correction

### What Was Implemented: "Prompt Quality Gate with Interactive Fallback"
A **quality gate** implies:
- Assess quality threshold
- If MEDIUM: Auto-fix (this matches your expectation) ✅
- If LOW: Cannot auto-fix → ask human for help ❌
- Similar to a code review that blocks PRs

### The Problem:
**LOW clarity prompts trigger an interactive flow that was never meant to be shown to users.**

The LOW clarity case was designed as:
> "This prompt is SO vague that even an LLM can't make it better automatically. We MUST ask the user what they want."

But your expectation was:
> "ALL prompts should be enhanced silently, no matter how vague."

---

## ✅ The Correct Solution (Two Options)

### **Option 1: Remove LOW Clarity Interactive Flow (Recommended)**

**Make ALL prompt enhancements automatic and silent:**

```typescript
if (assessment.clarity === 'low') {
  // LOW CLARITY: Try best-effort enhancement instead of asking user
  console.log('⚠️ Low clarity - applying best-effort enhancement');
  
  // Use the safe_rewrite from judge (it should provide one for low clarity too)
  userPrompt = assessment.safe_rewrite || 
    `${userPrompt}\n\nPlease analyze the codebase and provide a detailed, project-specific implementation plan with concrete steps, file references, and risk assessment.`;
  
  // Continue to plan generation (NO PAUSE, NO EVENTS)
}
```

**Changes needed:**
1. ✅ Remove `clarification_requested` event emission
2. ✅ Remove `execution_paused` event emission  
3. ✅ Use `safe_rewrite` for LOW clarity (just like MEDIUM)
4. ✅ Let LLM do its best with enhanced prompt
5. ✅ If plan is still generic, user can reject and refine

**Pros:**
- ✅ Fully automatic, no user interaction
- ✅ Matches your "silent enhancer" expectation
- ✅ Simpler implementation (no clarification UI needed)
- ✅ Faster user experience

**Cons:**
- ⚠️ Very vague prompts may still produce generic plans
- ⚠️ But user can always reject plan and refine prompt

---

### **Option 2: Fix the UI for LOW Clarity (Not Recommended)**

**Keep the interactive flow but make it work:**

This is what `PLAN_MODE_CLARIFICATION_UI_FIX.md` describes:
- Add clarification form in webview
- Add submit handler
- Resume plan generation after user provides clarification

**Pros:**
- ✅ Ensures high-quality plans even for very vague prompts
- ✅ Educational for users (teaches them what info is needed)

**Cons:**
- ❌ Adds friction to user experience
- ❌ Requires complex UI implementation
- ❌ Doesn't match your "silent enhancer" expectation
- ❌ Makes PLAN mode feel like a Q&A instead of an assistant

---

## 📋 Recommended Fix: Option 1

**Change `handlePlanMode()` in `extension.ts`:**

```typescript
// Assess prompt quality
const assessment = await judge.assessPrompt(userPrompt, assessmentContext);

// Emit assessment event (for logging)
await this.emitEvent({
  event_id: this.generateId(),
  task_id: taskId,
  timestamp: new Date().toISOString(),
  type: 'prompt_assessed',
  mode: this.currentMode,
  stage: 'none',
  payload: {
    clarity: assessment.clarity,
    detected_intent: assessment.detected_intent,
    was_rewritten: assessment.clarity !== 'high'
  },
  evidence_ids: [],
  parent_event_id: null
});

// Apply enhancement for MEDIUM and LOW clarity
if (assessment.clarity === 'low' || assessment.clarity === 'medium') {
  console.log(`📝 ${assessment.clarity} clarity - applying automatic enhancement`);
  
  // Use safe_rewrite or generate fallback
  userPrompt = assessment.safe_rewrite || 
    `${userPrompt}\n\nPlease provide a detailed, project-specific plan with:\n- Concrete file paths and components\n- Step-by-step implementation approach\n- Risk assessment and tradeoffs\n- Evidence of analysis grounded in the actual codebase`;
  
  console.log('[PLAN] Enhanced prompt:', userPrompt);
}

// Continue with plan generation (high, medium, and low all proceed automatically)
console.log('🚀 [handlePlanMode] Generating plan...');
```

**Key changes:**
1. Remove LOW clarity special case (no pause, no clarification events)
2. Treat LOW same as MEDIUM (auto-enhance and continue)
3. Remove `clarification_requested` and `execution_paused` events
4. Keep `prompt_assessed` event for transparency (optional)

---

## Summary Table

| Aspect | Expected | Implemented | Should Be |
|--------|----------|-------------|-----------|
| **Enhancement** | Silent/Automatic | Mixed (auto for MEDIUM, interactive for LOW) | Automatic for ALL |
| **User Awareness** | None | High (shows events) | None |
| **Execution** | Continuous | Pauses on LOW | Continuous |
| **UI Interaction** | Zero | Required (but missing form) | Zero |
| **Approach** | Pre-processor | Quality gate with fallback | Pre-processor |

---

## Next Steps

**Choose your path:**

1. **Path A (Recommended)**: Remove interactive clarification flow
   - Modify `handlePlanMode()` to auto-enhance ALL prompts
   - Remove `clarification_requested` events
   - Remove `execution_paused` events
   - Test with vague prompts

2. **Path B (Not Recommended)**: Complete the interactive UI
   - Implement clarification form in webview
   - Add submit handler and resume logic
   - But this still breaks your "silent" expectation

**Which path do you want to take?**
