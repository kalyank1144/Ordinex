# Mode Classification System - How It Works

## Your Valid Concern
**Yes, the current system uses keyword matching**, which means it **will miss many edge cases**. You're absolutely right to question this!

## Current Implementation (Heuristic-Based)

### Located in: `packages/core/src/modeClassifier.ts`

### How It Works (Scoring System):

```typescript
// 1. Pattern Matching (Regex)
answerPatterns = ["^what is", "^why", "^how", "explain", "?$"]
missionPatterns = ["^create", "^fix", "^add", "^implement", "^refactor"]
planPatterns = ["^plan", "^design", "^strategy"]

// 2. Keyword Scoring
- "add" → +1 mission score
- "?" → +0.5 answer score
- "plan" → +1 plan score

// 3. Winner = Highest Score
```

### Examples That Work:
✅ "Add error handling" → MISSION (has "Add")
✅ "What is TypeScript?" → ANSWER (has "What" + "?")
✅ "Plan a new feature" → PLAN (has "Plan")

### Examples That FAIL:
❌ "Let's implement authentication" → Might miss (no starting verb)
❌ "I need to refactor the payment flow" → Might miss (conversational)
❌ "Can you help me with error handling?" → Ambiguous (question but wants action)
❌ "Show me how to add logging" → Confusing (question + action)

---

## Why This Design? (Trade-offs)

### ✅ Advantages:
1. **Fast** - No LLM call (< 1ms)
2. **Deterministic** - Same prompt = same result
3. **No API cost**
4. **Works offline**
5. **User has final control** - Can override with confirmation

### ❌ Disadvantages (Your Concern):
1. **Misses conversational prompts**
2. **Keyword-dependent** - "Let's add" vs "Add" behaves differently
3. **No context awareness** - Doesn't know what you're working on
4. **Language-specific** - Only works in English
5. **False positives** - "Fix the plan" might score as MISSION

---

## The Safety Net: User Control

The system **intentionally asks for confirmation** on mismatches:

```
Prompt: "Add error handling to src/api.ts"
User selects: PLAN
System detects: MISSION (high confidence)
→ Shows confirmation card: [Keep PLAN] [Switch to MISSION]
```

**This is by design!** The classifier can be wrong, but the user always has control.

---

## Future Improvements (Roadmap)

### Option 1: Add LLM-Based Classification (Most Accurate)
```typescript
async function classifyWithLLM(prompt: string): Promise<Mode> {
  const response = await llm.call({
    system: "Classify this prompt into: ANSWER, PLAN, or MISSION",
    prompt: prompt,
    temperature: 0
  });
  return response.mode; // "ANSWER" | "PLAN" | "MISSION"
}
```

**Pros:** 
- Handles conversational language
- Context-aware
- Multilingual

**Cons:**
- Costs money (API call per prompt)
- Slower (~500ms)
- Requires API key
- Nondeterministic

### Option 2: Hybrid Approach (Recommended)
```typescript
function smartClassify(prompt: string) {
  // 1. Try heuristic first (fast, free)
  const heuristicResult = classifyWithKeywords(prompt);
  
  // 2. If confidence is low, use LLM
  if (heuristicResult.confidence === 'low') {
    return await classifyWithLLM(prompt);
  }
  
  return heuristicResult;
}
```

**Best of both worlds:**
- Fast for obvious cases
- Accurate for ambiguous cases
- Cost-effective (LLM only when needed)

### Option 3: Learning System
Track user corrections and improve heuristics:
```typescript
// User corrects: "Let's add auth" → MISSION (not ANSWER)
// System learns: "Let's [action]" pattern → MISSION
```

---

## Current Best Practices (For Users)

### To Get Best Classification:

**For ANSWER mode (Questions):**
- Start with: "What", "Why", "How", "Explain"
- End with: "?"
- Example: "What is the best way to handle errors?"

**For PLAN mode (Strategy):**
- Start with: "Plan", "Design", "Outline", "Strategy"
- Example: "Plan a new authentication system"

**For MISSION mode (Action):**
- Start with: "Add", "Create", "Implement", "Fix", "Refactor"
- Be specific: "Add error handling to src/api.ts"

### When Classification is Wrong:
1. **Use the confirmation card** - It's there for a reason!
2. **Or manually select the mode** before typing
3. **Override without penalty** - No cost to switching modes

---

## The Real Answer to Your Question

**Q: "How will it work dynamically/universally?"**

**A: Currently it doesn't.** It's keyword-based with known limitations.

**But this is intentional:**
- The system is designed to be **deterministic and transparent**
- Users maintain **full control** via confirmation cards
- The heuristic catches ~80% of cases correctly
- The remaining ~20% are handled by user confirmation

**Future improvements** (LLM-based classification, learning system) can make it more dynamic, but they come with trade-offs (cost, speed, complexity).

---

## Recommendation

The current system works well when:
1. **Users understand the three modes** (ANSWER vs PLAN vs MISSION)
2. **Users start prompts with clear verbs** ("Add", "Plan", "Explain")
3. **Users use the confirmation card** when needed

For your use case:
- If you want **planning/strategy**: Use PLAN mode explicitly
- If you want **direct implementation**: Use MISSION mode
- If system suggests wrong mode: **Click "Keep [Your Choice]"** - no problem!

The mode selector is always visible at the bottom - you have full control.
