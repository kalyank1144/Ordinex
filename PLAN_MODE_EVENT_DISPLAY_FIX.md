# PLAN Mode Event Display Fix

## Issue
PLAN mode was working correctly in the backend (emitting events like `prompt_assessed`, `clarification_requested`, etc.), but these events were showing as "Unknown event type" in the UI because the webview didn't have display configurations for them.

## Root Cause
The `getEventCardConfig()` function in `packages/webview/src/index.ts` was missing mappings for several PLAN mode event types:
- `model_fallback_used`
- `prompt_assessed`
- `clarification_requested`
- `clarification_received`

## Solution
Added event card configurations for all missing PLAN mode event types in the webview's `getEventCardConfig()` function.

### Added Event Types

#### 1. `model_fallback_used`
- **Icon**: 🔄
- **Title**: Model Fallback
- **Color**: Orange
- **Summary**: Shows requested model → fallback model

#### 2. `prompt_assessed`
- **Icon**: 🔍
- **Title**: Prompt Assessed
- **Color**: Blue
- **Summary**: Shows clarity level and detected intent

#### 3. `clarification_requested`
- **Icon**: ❓
- **Title**: Clarification Requested
- **Color**: Yellow
- **Summary**: Shows number of questions or missing information
- Displays when prompt quality is low and more details are needed

#### 4. `clarification_received`
- **Icon**: ✅
- **Title**: Clarification Received
- **Color**: Green
- **Summary**: Shows user-provided clarification

## Files Changed
- `packages/webview/src/index.ts` - Added event type configurations

## Testing
1. Reload the extension in VS Code (Developer: Reload Window)
2. Open Ordinex Mission Control
3. Select PLAN mode
4. Submit a vague prompt (e.g., "plan the next features")
5. Verify events are displayed correctly:
   - Model Fallback (if using a fallback model)
   - Prompt Assessed (showing clarity: low, intent: mission)
   - Clarification Requested (showing missing info)
   - Execution Paused (waiting for clarification)

## Result
✅ PLAN mode events now display correctly in the UI
✅ Users can see when clarification is requested
✅ Prompt assessment results are visible
✅ Model fallback information is shown when applicable

## Next Steps
None - PLAN mode is now fully functional with proper event display. Users can:
1. Submit planning requests
2. See prompt quality assessment
3. Receive clarification requests for vague prompts
4. View generated plans with approval workflow
