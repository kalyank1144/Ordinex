# Step 33: Mode Behavior Refinement — Testing Guide

## Quick Test Setup

```typescript
import { analyzeIntent, IntentAnalysisContext } from '@ordinex/core';

// Test helper function
function testPrompt(prompt: string, context?: Partial<IntentAnalysisContext>) {
  const result = analyzeIntent(prompt, {
    clarificationAttempts: 0,
    ...context
  });
  console.log(`Prompt: "${prompt}"`);
  console.log(`  Behavior: ${result.behavior}`);
  console.log(`  Mode: ${result.derived_mode}`);
  console.log(`  Confidence: ${result.confidence}`);
  console.log(`  Reasoning: ${result.reasoning}`);
  console.log('---');
  return result;
}
```

---

## Test Suite 1: ANSWER Behavior (Pure Questions)

### Expected: `behavior: 'ANSWER'`, `derived_mode: 'ANSWER'`

| # | Test Prompt | Expected Behavior | Expected Mode |
|---|-------------|-------------------|---------------|
| 1 | "What is TypeScript?" | ANSWER | ANSWER |
| 2 | "What is dependency injection?" | ANSWER | ANSWER |
| 3 | "Explain how closures work in JavaScript" | ANSWER | ANSWER |
| 4 | "Why is immutability important?" | ANSWER | ANSWER |
| 5 | "How does React's virtual DOM work?" | ANSWER | ANSWER |
| 6 | "What's the difference between let and const?" | ANSWER | ANSWER |
| 7 | "Tell me about the event bus architecture" | ANSWER | ANSWER |
| 8 | "Describe the singleton pattern" | ANSWER | ANSWER |
| 9 | "Is it better to use classes or functions?" | ANSWER | ANSWER |
| 10 | "When should I use async/await?" | ANSWER | ANSWER |

### How It Should Work:
- No code changes happen
- No tools are invoked
- LLM streams an explanation directly
- No approval gates required

---

## Test Suite 2: QUICK_ACTION Behavior (Small Changes)

### Expected: `behavior: 'QUICK_ACTION'`, `derived_mode: 'MISSION'`

| # | Test Prompt | Expected Behavior | Expected Scope |
|---|-------------|-------------------|----------------|
| 1 | "Fix typo in src/index.ts" | QUICK_ACTION | trivial |
| 2 | "Add a comment to line 10 in utils.ts" | QUICK_ACTION | trivial/small |
| 3 | "Rename the function handleClick to onClick" | QUICK_ACTION | small |
| 4 | "Add import for React at the top of App.tsx" | QUICK_ACTION | trivial |
| 5 | "Remove the unused variable x" | QUICK_ACTION | trivial |
| 6 | "Fix the spelling error in the README" | QUICK_ACTION | trivial |
| 7 | "Update the version number to 1.2.0" | QUICK_ACTION | small |
| 8 | "Change the color from blue to red" | QUICK_ACTION | small |
| 9 | "Add a console.log for debugging" | QUICK_ACTION | trivial |
| 10 | "Fix the missing semicolon in parser.ts" | QUICK_ACTION | trivial |

### How It Should Work:
1. Mode set to MISSION (edit stage)
2. Retrieve minimal file context
3. Generate a diff proposal
4. **Always gated** — user must approve the diff
5. After approval → Apply → Done

---

## Test Suite 3: PLAN Behavior (Large Work)

### Expected: `behavior: 'PLAN'`, `derived_mode: 'PLAN'`

| # | Test Prompt | Expected Behavior | Expected Scope |
|---|-------------|-------------------|----------------|
| 1 | "Create a new React application from scratch" | PLAN | large |
| 2 | "Build an authentication system with login and signup" | PLAN | large |
| 3 | "Refactor the entire user module" | PLAN | medium/large |
| 4 | "Migrate the database from MySQL to PostgreSQL" | PLAN | large |
| 5 | "Implement a payment gateway integration" | PLAN | large |
| 6 | "Create an API endpoint and frontend component" | PLAN | medium |
| 7 | "Set up the project with Docker, CI/CD, and monitoring" | PLAN | large |
| 8 | "Redesign the architecture to use microservices" | PLAN | large |
| 9 | "Build a complete CRUD system for products" | PLAN | medium |
| 10 | "Integrate Stripe payments with the checkout flow" | PLAN | large |

### How It Should Work:
1. Mode set to PLAN
2. Collect context (file structure, dependencies)
3. Generate structured plan with steps
4. User reviews and approves plan
5. After approval → Transitions to MISSION mode for execution

---

## Test Suite 4: CLARIFY Behavior (Ambiguous Prompts)

### Expected: `behavior: 'CLARIFY'`, `derived_mode: 'ANSWER'`

| # | Test Prompt | Expected Behavior | Clarification Reason |
|---|-------------|-------------------|---------------------|
| 1 | "Fix this" | CLARIFY | Ambiguous reference ("this") |
| 2 | "Update it" | CLARIFY | Ambiguous reference ("it") |
| 3 | "Improve the code" | CLARIFY | Vague scope, no file specified |
| 4 | "Make it better" | CLARIFY | Vague scope + ambiguous reference |
| 5 | "Change the function" | CLARIFY | Which function? |
| 6 | "Fix the bug" | CLARIFY | Which bug? What file? |
| 7 | "Optimize this" | CLARIFY | Ambiguous reference |
| 8 | "Refactor that" | CLARIFY | Ambiguous reference |

### How It Should Work:
1. Recognize missing information
2. Show clarification UI with options:
   - "Currently open file" (if available)
   - "Specify file path"
   - "Cancel"
3. Wait for user to select option
4. Re-run intent analysis with new context

### Clarification Response Actions:
```typescript
// After user selects "Specify file path" and provides "src/utils.ts"
const response = { action: 'provide_file', value: 'src/utils.ts' };
const newAnalysis = await processClarificationResponse(
  originalPrompt, response, context, eventBus, taskId
);
// Now newAnalysis will be QUICK_ACTION or PLAN
```

---

## Test Suite 5: CLARIFY → Resolved (With Context)

### Expected: When context is provided, CLARIFY resolves to another behavior

| # | Test Prompt | Context | Expected Behavior |
|---|-------------|---------|-------------------|
| 1 | "Fix this" | `lastOpenEditor: 'src/index.ts'` | QUICK_ACTION |
| 2 | "Update it" | `lastAppliedDiff: { files: ['App.tsx'] }` | QUICK_ACTION |
| 3 | "Improve this function" | `lastOpenEditor: 'utils.ts'` | QUICK_ACTION |

### Test Code:
```typescript
// Without context → CLARIFY
const result1 = analyzeIntent('Fix this', { clarificationAttempts: 0 });
console.log(result1.behavior); // 'CLARIFY'

// With context → QUICK_ACTION
const result2 = analyzeIntent('Fix this', { 
  clarificationAttempts: 0,
  lastOpenEditor: 'src/index.ts'
});
console.log(result2.behavior); // 'QUICK_ACTION'
console.log(result2.referenced_files); // ['src/index.ts']
```

---

## Test Suite 6: User Override Commands

### Expected: Override commands bypass intent analysis

| # | Test Prompt | Forced Behavior | Reason |
|---|-------------|-----------------|--------|
| 1 | "/chat What is TypeScript?" | ANSWER | /chat override |
| 2 | "/ask How does X work?" | ANSWER | /ask override |
| 3 | "/do Fix the typo" | QUICK_ACTION | /do override |
| 4 | "/edit Add a comment" | QUICK_ACTION | /edit override |
| 5 | "/plan Create new app" | PLAN | /plan override |
| 6 | "/mission Build feature" | PLAN | /mission override |
| 7 | "/run resume" | CONTINUE_RUN | /run override |

### How It Should Work:
- Confidence = 1.0 (100%)
- `user_override` field set to the command used
- Bypasses all heuristic analysis

---

## Test Suite 7: CONTINUE_RUN Behavior (Active Mission)

### Expected: `behavior: 'CONTINUE_RUN'`, `derived_mode: 'MISSION'`

| # | Context | Test Prompt | Expected Behavior |
|---|---------|-------------|-------------------|
| 1 | Active running mission | "continue" | CONTINUE_RUN |
| 2 | Active running mission | "What's happening?" | CONTINUE_RUN |
| 3 | Paused mission | "resume" | CONTINUE_RUN |
| 4 | Paused mission | "abort" | CONTINUE_RUN |

### Test Code:
```typescript
const contextWithActiveRun: IntentAnalysisContext = {
  clarificationAttempts: 0,
  activeRun: {
    task_id: 'task_123',
    mission_id: 'mission_456',
    stage: 'edit',
    status: 'running',
    started_at: new Date().toISOString(),
    last_event_at: new Date().toISOString(),
  }
};

const result = analyzeIntent('continue working', contextWithActiveRun);
console.log(result.behavior); // 'CONTINUE_RUN'
console.log(result.context_source.previous_task_id); // 'task_123'
```

### How It Should Work:
1. Detect active/paused mission
2. Show current status
3. Offer options: Resume, Pause, Abort, Propose fix
4. **Never restart plan automatically**

---

## Test Suite 8: Scope Detection

### Trivial Scope Triggers:
- "fix typo", "fix spelling", "rename", "add import", "remove unused"

### Small Scope Triggers:
- "add", "fix", "update", "change", "modify" (single file)

### Medium Scope Triggers:
- Multiple files referenced (4-10)
- Some cross-file dependencies

### Large Scope Triggers:
- "refactor", "migrate", "rewrite", "restructure"
- "implement", "create", "build", "develop"
- Greenfield: "new project", "from scratch", "new app"
- System dependencies: "database", "api", "auth", "payment"

---

## Test Suite 9: Reference Resolution Priority

### Priority Stack (in order):
1. `last_applied_diff` — Files from most recent diff
2. `last_open_editor` — Currently open file in VS Code
3. `last_artifact_proposed` — Last proposed plan/diff/checkpoint
4. If none → CLARIFY

```typescript
// Test priority: last_applied_diff wins over last_open_editor
const context = {
  clarificationAttempts: 0,
  lastAppliedDiff: { files: ['src/priority1.ts'], timestamp: '' },
  lastOpenEditor: 'src/priority2.ts',
};
const result = analyzeIntent('Fix this', context);
console.log(result.referenced_files); // ['src/priority1.ts']
```

---

## Test Suite 10: Max Clarification Attempts

### Expected: After 2 clarification attempts, system makes a decision

```typescript
// 0 attempts → CLARIFY
const result1 = analyzeIntent('Fix this', { clarificationAttempts: 0 });
console.log(result1.behavior); // 'CLARIFY'

// 1 attempt → still CLARIFY
const result2 = analyzeIntent('Fix this', { clarificationAttempts: 1 });
console.log(result2.behavior); // 'CLARIFY'

// 2 attempts → NO MORE CLARIFY (makes decision)
const result3 = analyzeIntent('Fix this', { clarificationAttempts: 2 });
console.log(result3.behavior); // 'QUICK_ACTION' or 'ANSWER' (not 'CLARIFY')
```

---

## Behavior Flow Summary

```
User types message
       ↓
┌─────────────────────────┐
│  analyzeIntent(prompt)  │
└───────────┬─────────────┘
            ↓
  ┌─────────────────────────────────────────────────────┐
  │ Step 0: User override? (/chat, /do, /plan, /run)    │
  │   YES → Use forced behavior, skip analysis          │
  └───────────┬─────────────────────────────────────────┘
              ↓
  ┌─────────────────────────────────────────────────────┐
  │ Step 1: Active run?                                  │
  │   YES → CONTINUE_RUN                                 │
  └───────────┬─────────────────────────────────────────┘
              ↓
  ┌─────────────────────────────────────────────────────┐
  │ Step 2: Pure question?                               │
  │   YES → ANSWER                                       │
  └───────────┬─────────────────────────────────────────┘
              ↓
  ┌─────────────────────────────────────────────────────┐
  │ Step 3: Missing info? (and attempts < 2)             │
  │   YES → CLARIFY                                      │
  └───────────┬─────────────────────────────────────────┘
              ↓
  ┌─────────────────────────────────────────────────────┐
  │ Step 4: Scope detection                              │
  │   trivial/small → QUICK_ACTION                       │
  │   medium/large  → PLAN                               │
  └─────────────────────────────────────────────────────┘
```

---

## Running Unit Tests

```bash
cd /Users/kalyankumarchindam/Documents/Ordinex
pnpm test -- --testPathPattern=intentAnalyzer
```

Expected: ~55 tests passing for:
- User override commands
- Active run detection
- Pure question detection
- CLARIFY behavior
- Scope detection
- Reference resolution
- Derived mode mapping
- Configuration validation

---

## Manual Testing in Extension

1. Open VS Code Extension Host (`F5`)
2. Type prompts in the chat input
3. Observe behavior in console logs
4. Verify correct mode/behavior selection

### Expected Console Output:
```
[IntentAnalyzer] Prompt: "What is TypeScript?"
[IntentAnalyzer] Behavior: ANSWER
[IntentAnalyzer] Mode: ANSWER
[IntentAnalyzer] Confidence: 0.85
[IntentAnalyzer] Reasoning: Detected as pure question/explanation request
```
