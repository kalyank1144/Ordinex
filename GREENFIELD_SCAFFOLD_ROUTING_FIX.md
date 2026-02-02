# Greenfield Scaffold Routing Fix

## Problem
When users submitted prompts like "create a new fitness app with React", the system was routing to standard PLAN mode instead of the SCAFFOLD flow. This happened even though `analyzeIntentWithFlow()` was correctly detecting `flow_kind: 'scaffold'`.

## Root Cause
The extension.ts was using `analyzeIntent()` which does NOT return `flow_kind`. The `analyzeIntentWithFlow()` function that includes flow detection was available but NOT being used.

## Solution

### 1. Updated imports in extension.ts
```typescript
// Added to imports from 'core'
analyzeIntentWithFlow,
ScaffoldFlowCoordinator,
isGreenfieldRequest,
```

### 2. Changed intent analysis call
```typescript
// Before:
let analysis = analyzeIntent(text, analysisContext);

// After:
let analysisWithFlow = analyzeIntentWithFlow(text, analysisContext);
let analysis = analysisWithFlow;
```

### 3. Added scaffold flow routing in PLAN behavior
```typescript
case 'PLAN':
  // STEP 35: Check if this is a greenfield scaffold request
  if (analysisWithFlow.flow_kind === 'scaffold') {
    console.log('[Step35] 🏗️ SCAFFOLD flow detected! Routing to scaffold handler...');
    await this.handleScaffoldFlow(text, taskId, modelId, webview, attachments);
  } else {
    console.log('[Step35] Standard PLAN flow');
    await this.handlePlanMode(text, taskId, modelId, webview);
  }
  break;
```

### 4. Implemented `handleScaffoldFlow()` method
New method that:
- Creates EventBus
- Creates ScaffoldFlowCoordinator
- Converts attachments to AttachmentInput format
- Calls `coordinator.startScaffoldFlow()`
- Sends events to webview for UI rendering

## Additional Fix
Fixed VisionAnalysisCard.ts which had a `lit-html` import that wasn't available. Replaced with a local `html` template function that returns strings like other webview components.

## Files Changed
1. `packages/extension/src/extension.ts` - Main routing fix
2. `packages/webview/src/components/VisionAnalysisCard.ts` - Build fix (removed lit-html)
3. `packages/webview/src/types.ts` - Added scaffold event types to EventType union
4. `packages/webview/src/components/MissionFeed.ts` - Added scaffold event configs to EVENT_CARD_MAP

## Event Types Added
- `scaffold_started` - 🏗️ Shows when scaffold flow begins
- `scaffold_proposal_created` - 📋 Shows when proposal is ready
- `scaffold_decision_resolved` - ✓ Shows user's decision
- `scaffold_applied` - ✅ Shows scaffold completion
- `scaffold_cancelled` - ⛔ Shows cancellation

## Testing
1. Type "create a new fitness app with React and TypeScript"
2. Console should show:
   - `[Step35] Flow kind: scaffold`
   - `[Step35] Is greenfield request: true`
   - `[Step35] 🏗️ SCAFFOLD flow detected!`
3. UI should show scaffold_started and scaffold_proposal_created events
4. User sees Proceed/Cancel decision point

## Build Status
✅ Build passes successfully

## Final Fix: Webview Event Display
The webview uses INLINE JavaScript in `packages/webview/src/index.ts`. Added scaffold and vision events to the `eventCardMap`:

### Scaffold Events Added
- `scaffold_started` - 🏗️ Scaffold Started (purple)
- `scaffold_proposal_created` - 📋 Scaffold Proposal Ready (green)
- `scaffold_approved` - ✅ Scaffold Approved (green)
- `scaffold_cancelled` - ❌ Scaffold Cancelled (red)
- `scaffold_applied` - 🎉 Scaffold Applied (green)
- `scaffold_failed` - ❌ Scaffold Failed (red)

### Vision Events Added
- `vision_analysis_started` - 👁️ Analyzing References (blue)
- `vision_analysis_completed` - ✅ Reference Analysis Complete (green)
- `reference_tokens_extracted` - 🎨 Style Tokens Extracted (purple)
- `reference_tokens_used` - ✨ Tokens Applied (green)

## Status: COMPLETE
