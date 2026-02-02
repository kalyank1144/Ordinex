# Greenfield Routing Fix V2

## Problem
When user entered "Creating a new fitness app", the system incorrectly routed to QUICK_ACTION (edit mode) instead of scaffold flow because:

1. The greenfield detector regex `/\bcreate\b/` didn't match "Creating" (verb conjugation)
2. The intent analyzer wasn't calling the centralized greenfield detector for behavior selection

## Root Cause
The STRONG_PATTERNS regex in `greenfieldDetector.ts` used:
```regex
/\b(create|build|make|start|...)\b/i
```

This pattern uses word boundaries (`\b`) which require exact matches. "Creating" ≠ "create".

## Solution

### 1. Fixed Greenfield Detector Regex (`packages/core/src/intent/greenfieldDetector.ts`)
Updated STRONG_PATTERNS to handle verb conjugations:
```javascript
// Before:
/\b(create|build|make|start|scaffold|setup|...)\b/i

// After:
/\b(creat(e|ing)|build(ing)?|mak(e|ing)|start(ing)?|scaffold(ing)?|...)\b/i
```

Now matches:
- "create" / "creating"
- "build" / "building"
- "make" / "making"
- "start" / "starting"
- etc.

### 2. Updated Intent Analyzer (`packages/core/src/intentAnalyzer.ts`)
- Added import: `import { detectGreenfieldIntent } from './intent/greenfieldDetector'`
- Updated `isGreenfieldRequest()` to use centralized detector:
```javascript
export function isGreenfieldRequest(prompt: string): boolean {
  // Use centralized greenfield detector (single source of truth)
  const detection = detectGreenfieldIntent(prompt);
  
  // If high confidence, definitely greenfield
  if (detection.isMatch && detection.confidence >= 0.65) {
    return true;
  }
  
  // Fallback: check legacy GREENFIELD_PATTERNS
  const normalizedPrompt = prompt.toLowerCase();
  return GREENFIELD_PATTERNS.some(pattern => normalizedPrompt.includes(pattern));
}
```

## Test Cases Now Working
| Input | Expected | Now |
|-------|----------|-----|
| "Creating a new fitness app" | scaffold | ✅ scaffold |
| "create new app" | scaffold | ✅ scaffold |
| "Building a dashboard" | scaffold | ✅ scaffold |
| "Making a todo app" | scaffold | ✅ scaffold |
| "fix the button" | edit | ✅ edit |
| "run the app" | command | ✅ command |

## Files Changed
1. `packages/core/src/intent/greenfieldDetector.ts` - Fixed regex for verb conjugations
2. `packages/core/src/intentAnalyzer.ts` - Import and use centralized detector

## Build Status
✅ All packages compile successfully
