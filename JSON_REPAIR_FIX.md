# JSON Repair Fix - Mission Execution Reliability

## Problem
During mission execution, the LLM edit step was failing with JSON parsing errors like:
- "Expected double-quoted property name in JSON at position 77"
- This happened frequently during Step 3 (create/edit stage)

## Root Cause
LLMs sometimes return malformed JSON with common issues:
1. **Trailing commas**: `{"key": "value",}`
2. **Single quotes**: `{'key': 'value'}`
3. **Unquoted property names**: `{key: "value"}`
4. **JavaScript comments**: `{"key": "value" // comment }`
5. **Control characters** inside strings (literal newlines, tabs)
6. **Unterminated strings** due to truncation

## Solution
Created a comprehensive `jsonRepair.ts` utility module that:

### 1. Multi-Stage JSON Repair (`safeJsonParse`)
- **Step 1**: Extract JSON from markdown code blocks
- **Step 2**: Extract JSON object/array from surrounding text
- **Step 3**: Try parsing as-is first (fast path)
- **Step 4**: Apply sequential repairs if parsing fails:
  - Remove JavaScript comments (// and /* */)
  - Fix single quotes to double quotes
  - Quote unquoted property names
  - Remove trailing commas
  - Sanitize control characters in strings
  - Repair unterminated strings
- **Step 5**: Re-parse after repairs
- **Step 6**: Fall back to aggressive regex-based repair

### 2. Individual Repair Functions
- `removeJsComments()` - State-machine based comment removal
- `fixSingleQuotes()` - Convert single quotes to double quotes
- `quoteUnquotedKeys()` - Add quotes to unquoted property names
- `removeTrailingCommas()` - Remove commas before ] or }
- `sanitizeControlCharacters()` - Escape control chars in strings
- `repairUnterminatedStrings()` - Close unclosed string literals

## Files Changed

### 1. `packages/core/src/jsonRepair.ts` (NEW)
- Comprehensive JSON repair utility
- Exports `safeJsonParse()` and `parseJsonWithContext()`
- Returns repair log for debugging

### 2. `packages/core/src/llmEditTool.ts`
- Updated `parseOutput()` to use `safeJsonParse()` instead of direct `JSON.parse()`
- Now logs all JSON repairs applied for debugging
- Better error messages with repair context

### 3. `packages/core/src/llmService.ts`
- Updated `extractPatchesFromResponse()` to use `safeJsonParse()`
- Better error handling with repair information

### 4. `packages/core/src/index.ts`
- Exported `safeJsonParse`, `parseJsonWithContext`, and `JsonRepairResult`

## Usage Example

```typescript
import { safeJsonParse } from '@ordinex/core';

const llmResponse = `{
  key: "value",  // unquoted key
  'another': 'test',  // single quotes
  items: [1, 2, 3,]  // trailing comma
}`;

const result = safeJsonParse(llmResponse);
if (result.success) {
  console.log('Parsed:', result.data);
  console.log('Repairs applied:', result.repairs);
} else {
  console.error('Failed:', result.error);
}
```

## Benefits
1. **Robust LLM JSON parsing** - Handles common LLM output issues
2. **Detailed repair logging** - Know what was fixed for debugging
3. **Fast path optimization** - Direct parsing tried first
4. **Graceful degradation** - Multiple repair strategies

## Testing
To verify the fix works:
1. Reload the Ordinex extension
2. Start a Plan mode prompt → Approve → Execute Plan
3. Mission should complete Step 3 (edit stage) without JSON parse errors
4. Check console logs for any "[llmEditTool] JSON repairs applied:" messages
