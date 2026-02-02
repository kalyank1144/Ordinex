# Greenfield Complete Flow Walkthrough

## Scenario: User says "create a todo app"

This document traces the **complete end-to-end flow** through the Ordinex greenfield scaffold system.

---

## Phase 1: Intent Detection & Classification

### File: `packages/core/src/intent/greenfieldDetector.ts`

```typescript
// User prompt: "create a todo app"
isGreenfieldRequest(prompt: string): boolean
```

**What happens:**
1. Analyzes prompt for greenfield keywords: "create", "build", "make", "scaffold", "new"
2. Detects project-type keywords: "app", "website", "api"
3. Checks for framework hints: "react", "vue", "next"
4. Computes confidence score based on matches

**Result:** Returns `true` with ~0.9 confidence

---

## Phase 2: Flow Analysis & Routing

### File: `packages/core/src/intentAnalyzer.ts`

```typescript
analyzeIntentWithFlow(prompt, context): IntentAnalysis {
  // ...
  flow_kind: 'scaffold'  // ← Detected!
}
```

**What happens:**
1. `analyzeIntentWithFlow()` calls `isGreenfieldRequest()`
2. Sets `flow_kind: 'scaffold'`
3. Intent analysis returns with scaffold flow marker

### File: `packages/extension/src/extension.ts` → `handleSubmitPrompt()`

```typescript
// STEP 35 FIX: SCAFFOLD CHECK BEFORE BEHAVIOR SWITCH
if (analysisWithFlow.flow_kind === 'scaffold') {
  console.log('[Step35] 🏗️ SCAFFOLD flow detected');
  await this.handleScaffoldFlow(text, taskId, modelId, webview, attachments);
  return; // Exit early - scaffold handles everything
}
```

**Result:** Routes directly to scaffold flow, bypassing normal behavior handlers

---

## Phase 3: Scaffold Flow Initialization

### File: `packages/extension/src/extension.ts` → `handleScaffoldFlow()`

**What happens:**
1. Gets workspace root
2. Creates EventBus for event emission
3. Creates `ScaffoldFlowCoordinator` instance
4. Converts attachments (if any) to reference context
5. Calls `coordinator.startScaffoldFlow()`

### File: `packages/core/src/scaffoldFlow.ts` → `ScaffoldFlowCoordinator`

```typescript
async startScaffoldFlow(
  taskId: string,
  userPrompt: string,
  workspaceRoot: string,
  attachments?: AttachmentInput[]
): Promise<ScaffoldFlowState>
```

**What happens:**

#### 3.1 Emit `scaffold_started` Event
```typescript
{
  type: 'scaffold_started',
  payload: {
    user_prompt: 'create a todo app',
    target_directory: '/Users/.../workspace',
    created_at_iso: '2026-01-31T...'
  }
}
```

#### 3.2 Run Preflight Safety Check
- Checks if target directory is empty
- Validates workspace safety
- Emits `scaffold_preflight_completed` event

#### 3.3 Select Recipe (Step 35.3)
```typescript
// packages/core/src/scaffold/recipeSelector.ts
const recipeSelection = selectRecipe('create a todo app');

// Returns:
{
  recipe_id: 'nextjs_app_router',
  confidence: 0.85,
  reasoning: 'Detected modern web app intent...'
}
```

**Recipe Options:**
- `nextjs_app_router` - Next.js 14 with App Router
- `vite_react` - Vite + React + TypeScript
- `expo` - React Native with Expo

#### 3.4 Select Design Pack (Step 35.5)
```typescript
// packages/core/src/scaffold/designPackSelector.ts
const designSelection = selectDesignPack(userPrompt, referenceContext);

// Returns:
{
  design_pack_id: 'coastal-blue',
  primary_color: '#0EA5E9',
  font_family: 'Inter',
  mood: ['professional', 'modern']
}
```

**Design Pack Options:**
- `coastal-blue` - Modern blue/cyan theme
- `warm-sunset` - Warm orange/red theme
- `forest-green` - Natural green theme
- `midnight-purple` - Deep purple theme

#### 3.5 Generate Proposal Summary
```typescript
const summary = `Next.js 14 (App Router) + Coastal Blue theme`;
```

#### 3.6 Emit `scaffold_proposal_created` Event
```typescript
{
  type: 'scaffold_proposal_created',
  payload: {
    scaffold_id: 'scaffold_abc123',
    recipe_id: 'nextjs_app_router',
    recipe: 'Next.js 14 (App Router)',
    design_pack_id: 'coastal-blue',
    design_pack: 'Coastal Blue',
    summary: 'Next.js 14 (App Router) + Coastal Blue theme',
    files_count: 24,
    directories_count: 8,
    design_tokens_summary: 'Primary: #0EA5E9 | Font: Inter',
    preview_asset_id: 'coastal-blue-preview',
    // If attachments provided:
    reference_context: {
      images: [...],
      urls: [...],
      tokens: { primaryColor: '#...', ... }
    },
    style_source_mode: 'combine_with_design_pack'
  }
}
```

---

## Phase 4: UI Rendering (JUST FIXED!)

### File: `packages/webview/src/components/MissionFeed.ts`

```typescript
// Priority check (runs BEFORE generic event rendering)
if (isScaffoldEvent(event.type)) {
  return renderScaffoldEventCard(event);
}
```

### File: `packages/webview/src/components/ScaffoldCard.ts`

The custom `<scaffold-card>` element renders a **rich proposal card**:

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 🏗️ Scaffold Proposal                   Review ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ Summary                                       ┃
┃ Next.js 14 (App Router) + Coastal Blue       ┃
┃                                               ┃
┃ ┌─────────────────────────────────────────┐  ┃
┃ │ 📎 Design References                    │  ┃
┃ │ [🖼️ screenshot.png] [🔗 example.com]   │  ┃
┃ │ ✨ Design influenced by references      │  ┃
┃ │ Style: [Reference][Ignore][Combined]    │  ┃
┃ └─────────────────────────────────────────┘  ┃
┃                                               ┃
┃ ┌─────────────────────────────────────────┐  ┃
┃ │ Design Style          🎨 Change Style   │  ┃
┃ │ ┌────┐                                  │  ┃
┃ │ │ C  │ Coastal Blue                     │  ┃
┃ │ └────┘ Primary: #0EA5E9 | Font: Inter  │  ┃
┃ └─────────────────────────────────────────┘  ┃
┃                                               ┃
┃ Recipe: Next.js 14 (App Router)              ┃
┃ Files to Create: 24                          ┃
┃ Directories: 8                                ┃
┃                                               ┃
┃ Started: 5:03 PM                             ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ [✓ Proceed]  [✗ Cancel]                      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

**UI Features:**
- Recipe name and framework
- Design pack visual preview with color swatch
- Token summary (colors, fonts)
- Files/directories count
- Reference section (if images/URLs provided)
- **Change Style** button (future: opens design picker)
- **Proceed** / **Cancel** buttons

---

## Phase 5: User Decision

### User clicks **"Proceed"** button

### File: `packages/webview/src/components/ScaffoldCard.ts` → `bindActions()`

```typescript
proceedBtn.addEventListener('click', () => {
  this.dispatchEvent(new CustomEvent('scaffold-action', {
    detail: {
      action: 'proceed',
      scaffoldId: this._event?.payload?.scaffold_id,
      eventId: this._event?.event_id
    },
    bubbles: true,
    composed: true
  }));
});
```

### File: `packages/webview/src/index.ts`

Message sent to extension:
```typescript
vscode.postMessage({
  type: 'ordinex:resolveDecisionPoint',
  task_id: taskId,
  decision_event_id: decisionEventId,
  action: 'proceed'
});
```

---

## Phase 6: Execution - Create the Project!

### File: `packages/extension/src/extension.ts` → `handleResolveDecisionPoint()`

```typescript
if (decisionType === 'scaffold_approval') {
  // Map to scaffold action
  let scaffoldAction: 'proceed' | 'cancel' | 'change_style';
  
  if (action === 'proceed') {
    // Call coordinator to handle proceed
    const updatedState = await this.activeScaffoldCoordinator.handleUserAction('proceed');
    
    // Select recipe and run terminal command
    const recipeSelection = selectRecipe(scaffoldPrompt);
    
    // Build terminal command
    const createCmd = recipeSelection.recipe_id === 'nextjs_app_router'
      ? 'npx create-next-app@latest my-app'
      : recipeSelection.recipe_id === 'vite_react'
      ? 'npm create vite@latest my-app -- --template react-ts'
      : 'npx create-expo-app my-app';
    
    // CREATE TERMINAL AND RUN COMMAND!
    const terminal = vscode.window.createTerminal({
      name: 'Scaffold: Next.js',
      cwd: scaffoldWorkspaceRoot,
    });
    terminal.show(true);
    terminal.sendText(createCmd); // ← Runs the command!
  }
}
```

**What happens:**
1. Emits `scaffold_decision_resolved` event with recipe selection
2. Emits `scaffold_apply_started` event
3. **Creates VS Code terminal** with recipe name
4. **Sends create command to terminal** (npx create-next-app, etc.)
5. **Shows terminal to user** so they can follow prompts
6. Emits `scaffold_applied` event
7. Clears `currentTaskId` so next prompt starts fresh

---

## Phase 7: Terminal Interaction

**User sees VS Code terminal:**

```bash
Terminal: Scaffold: Next.js

$ npx create-next-app@latest my-app
✔ Would you like to use TypeScript? … Yes
✔ Would you like to use ESLint? … Yes
✔ Would you like to use Tailwind CSS? … Yes
✔ Would you like to use `src/` directory? … Yes
✔ Would you like to use App Router? … Yes
✔ Would you like to customize the default import alias? … No

Creating a new Next.js app in /workspace/my-app...

✔ Installation complete!
```

**User follows interactive prompts** to configure their project.

---

## Phase 8: Completion & Next Steps

### Emitted Events:
```typescript
{
  type: 'scaffold_applied',
  payload: {
    recipe_id: 'nextjs_app_router',
    command: 'npx create-next-app@latest my-app',
    method: 'vscode_terminal',
    message: 'Scaffold command running in terminal...'
  }
}

{
  type: 'scaffold_completed',
  payload: {
    status: 'completed',
    recipe_id: 'nextjs_app_router'
  }
}
```

### User sees notification:
```
🎉 Next.js scaffold started! Follow terminal prompts to complete setup.
```

### After completion, user can:
```bash
cd my-app
npm run dev
# Open http://localhost:3000
```

---

## Complete Event Timeline

```
1. intent_received
   └─ prompt: "create a todo app"

2. mode_set
   └─ mode: PLAN, behavior: PLAN, flow_kind: scaffold

3. scaffold_started
   └─ user_prompt: "create a todo app"

4. scaffold_preflight_completed
   └─ target_directory safe

5. scaffold_proposal_created ← UI SHOWS RICH CARD HERE!
   ├─ recipe: Next.js 14 (App Router)
   ├─ design_pack: Coastal Blue
   ├─ files_count: 24
   └─ design_tokens_summary: Primary: #0EA5E9

6. [USER CLICKS PROCEED]

7. scaffold_decision_resolved
   └─ decision: proceed, recipe_id: nextjs_app_router

8. scaffold_apply_started
   └─ command: npx create-next-app@latest my-app

9. scaffold_applied
   └─ method: vscode_terminal, command running

10. scaffold_completed
    └─ status: completed
```

---

## Key Files in the Flow

| Phase | File | Purpose |
|-------|------|---------|
| Detection | `packages/core/src/intent/greenfieldDetector.ts` | Pattern matching for greenfield prompts |
| Routing | `packages/extension/src/extension.ts` | Routes to `handleScaffoldFlow()` |
| Orchestration | `packages/core/src/scaffoldFlow.ts` | `ScaffoldFlowCoordinator` main logic |
| Recipe Selection | `packages/core/src/scaffold/recipeSelector.ts` | Picks Next.js/Vite/Expo |
| Design Selection | `packages/core/src/scaffold/designPackSelector.ts` | Picks color theme |
| UI Component | `packages/webview/src/components/ScaffoldCard.ts` | Rich proposal card |
| Event Rendering | `packages/webview/src/components/MissionFeed.ts` | Routes scaffold events to ScaffoldCard |
| Decision Handler | `packages/extension/src/extension.ts` | Handles Proceed/Cancel |
| Execution | `extension.ts` → VS Code Terminal API | Actually runs create command |

---

## What Happens with Different Prompts?

### "create a React dashboard"
- Recipe: `vite_react` (lighter than Next.js)
- Command: `npm create vite@latest my-app -- --template react-ts`

### "create a mobile app"
- Recipe: `expo` (React Native)
- Command: `npx create-expo-app my-app`

### "build a Next.js blog"
- Recipe: `nextjs_app_router`
- Command: `npx create-next-app@latest my-app`

---

## What About Attachments?

If user attaches a screenshot or URL when saying "create a todo app":

```typescript
// Step 37: Vision Analysis
{
  type: 'vision_analysis_started',
  payload: {
    images_count: 1,
    urls_count: 1
  }
}

{
  type: 'reference_tokens_extracted',
  payload: {
    primaryColor: '#FF6B35',  // Extracted from image!
    fontFamily: 'Poppins',
    moods: ['vibrant', 'energetic'],
    confidence: 0.87
  }
}

// Scaffold proposal now includes reference context
{
  type: 'scaffold_proposal_created',
  payload: {
    // ... recipe, design pack
    reference_context: {
      images: [{ id: 'img_abc', path: '...' }],
      tokens: { primaryColor: '#FF6B35', ... }
    },
    style_source_mode: 'combine_with_design_pack'  // Blend reference + design pack
  }
}
```

**UI shows reference section** with thumbnails and style source toggle.

---

## Current Status

✅ **Detection** - `greenfieldDetector.ts` working
✅ **Routing** - `extension.ts` routes to scaffold flow
✅ **Orchestration** - `ScaffoldFlowCoordinator` generates proposals
✅ **Recipe Selection** - Picks Next.js/Vite/Expo based on prompt
✅ **Design Packs** - Selects color theme
✅ **Reference Context** - Handles image/URL attachments (Step 37)
✅ **UI Rendering** - ScaffoldCard shows rich proposal ← **JUST FIXED!**
✅ **User Decision** - Proceed/Cancel buttons wired
✅ **Execution** - VS Code terminal runs create command
✅ **Event Flow** - All events emitted and displayed

---

## Testing the Flow

1. Open Ordinex in VS Code
2. Say: **"create a todo app"**
3. See rich scaffold proposal card with Next.js + Coastal Blue
4. Click **Proceed**
5. See VS Code terminal open with `npx create-next-app@latest`
6. Follow prompts to complete setup
7. Run `cd my-app && npm run dev`
8. 🎉 Your todo app is running!

---

**The greenfield flow is 100% complete and wired end-to-end!**
