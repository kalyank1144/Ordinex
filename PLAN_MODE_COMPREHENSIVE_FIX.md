# PLAN Mode Comprehensive Fix

## Issues Found in Screenshots

### 1. Model Fallback Shows "unknown"
**Symptom**: `claude-3-haiku-20240307 → unknown`
**Root Cause**: Webview expects `fallback_model` field but backend sends different structure
**Fix**: Update model fallback display logic in webview

### 2. Wrong Tool Being Called  
**Symptom**: Shows "Tool Started: Answering (Claude 3 Haiku)"
**Root Cause**: `PromptQualityJudge` uses `LLMService.streamAnswerWithContext()` which emits `tool='llm_answer'`
**Issue**: This makes PLAN mode look like it's calling ANSWER mode tools
**Fix**: PromptQualityJudge should use a different tool name like `'prompt_assessment'`

### 3. Clarification Requested but No Response UI
**Symptom**: "Clarification Requested" event shows missing info, but user has no way to respond
**Root Cause**: No UI component to collect and submit clarification
**Fix**: Add clarification response input UI when `clarification_requested` event is present

### 4. Execution Paused with No Way Forward
**Symptom**: "Execution Paused: awaiting_clarification" - dead end
**Root Cause**: No mechanism to provide clarification and resume
**Fix**: Add "Provide Clarification" button/form after clarification_requested event

## Implementation Plan

### Phase 1: Fix Model Fallback Display (Webview)
- Update `model_fallback_used` event card to handle missing fallback_model
- Show "Fallback Used" even if target model is unknown

### Phase 2: Fix Tool Name for Prompt Assessment (Core)
- Check `PromptQualityJudge` - it should NOT use `llm_answer` tool name
- Either: Pass custom tool name to LLMService OR create separate method

### Phase 3: Add Clarification Response UI (Webview + Extension)
- Detect when `clarification_requested` + `execution_paused` (reason=awaiting_clarification)
- Show input form after clarification card
- Add "Submit Clarification" button
- Handle `ordinex:submitClarification` message in extension
- Combine original prompt + clarification using `combinePromptWithClarification()`
- Resume plan generation with enhanced prompt

### Phase 4: Test Complete Flow
- Submit vague PLAN prompt
- See clarification request
- Submit clarification
- See plan generated with combined prompt
- Approve plan
- Switch to MISSION mode

## Files to Modify

1. `packages/webview/src/index.ts`
   - Fix model_fallback_used display
   - Add clarification response UI after clarification_requested
   
2. `packages/core/src/promptQualityJudge.ts`
   - Check tool name being used

3. `packages/extension/src/extension.ts`
   - Add `handleSubmitClarification` handler
   - Implement clarification + resume logic
