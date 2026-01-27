# Mission Feed Error Display Fix

## Problem

When mission execution failed, the UI showed a generic "Error occurred" message instead of displaying the actual error details that would help with debugging.

Additionally, truncation-safe execution events had field name mismatches between what the backend emitted and what the UI expected.

## Root Cause Analysis

1. **`failure_detected` card** - The `getSummary` function only looked at `payload.error`, but errors could be in:
   - `payload.error` - primary error message
   - `payload.reason` - failure reason category
   - `payload.details.message` - nested error details
   - `payload.kind` - error classification

2. **Truncation-safe event field mismatches**:
   - `preflight_complete`: UI expected `split_needed`, backend sent `shouldSplit`
   - `edit_split_triggered`: UI expected `files` array, backend sent `file_count`
   - `truncation_detected`: UI expected `recovered`, backend sent different fields

3. **Unknown event fallback** - The generic "❓ Unknown event type" was not professional and didn't extract useful info from the event payload.

## Solution

### Fix 1: Enhanced `failure_detected` Card

Updated to extract error messages from multiple payload locations:

```typescript
failure_detected: {
  getSummary: (e) => {
    const error = e.payload.error as string | undefined;
    const reason = e.payload.reason as string | undefined;
    const details = e.payload.details as Record<string, unknown> | undefined;
    const detailsMessage = details?.message as string | undefined;
    const kind = e.payload.kind as string | undefined;
    
    const parts: string[] = [];
    
    // Add reason as prefix if meaningful
    if (reason && reason !== 'step_execution_exception' && reason !== 'step_execution_failed') {
      parts.push(reason.replace(/_/g, ' '));
    }
    
    // Add actual error message (with truncation for long messages)
    if (error) {
      const truncatedError = error.length > 100 ? error.substring(0, 100) + '...' : error;
      parts.push(truncatedError);
    } else if (detailsMessage) {
      const truncated = detailsMessage.length > 100 ? detailsMessage.substring(0, 100) + '...' : detailsMessage;
      parts.push(truncated);
    } else if (kind) {
      parts.push(kind.replace(/_/g, ' '));
    }
    
    return parts.length > 0 ? parts.join(': ') : 'Error occurred';
  }
}
```

### Fix 2: Truncation-Safe Event Field Compatibility

Updated event handlers to support both old and new field names:

```typescript
preflight_complete: {
  getSummary: (e) => {
    // Support both field names
    const splitNeeded = (e.payload.shouldSplit ?? e.payload.split_needed) as boolean;
    const targetCount = e.payload.targetFileCount as number || 0;
    return splitNeeded ? `Split mode: ${targetCount} file(s)` : 'Single-call mode';
  }
}

edit_split_triggered: {
  getSummary: (e) => {
    // Support both field names
    const fileCount = e.payload.file_count as number;
    const files = (e.payload.files as string[]) || [];
    const count = fileCount ?? files.length;
    return `Processing ${count} file(s) separately`;
  }
}

truncation_detected: {
  getSummary: (e) => {
    const reason = e.payload.reason as string || '';
    const stopReason = e.payload.stopReason as string || '';
    if (stopReason) {
      return `Output truncated (${stopReason})`;
    }
    return reason ? `Truncated: ${reason}` : 'Output truncated (will retry with split)';
  }
}
```

### Fix 3: Professional Unknown Event Fallback

Added helper functions for graceful handling of unmapped events:

```typescript
function humanizeEventType(eventType: string): string {
  return eventType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractFallbackSummary(event: Event): string {
  const payload = event.payload || {};
  
  // Try common field names in order
  const candidates = [
    payload.summary, payload.message, payload.description,
    payload.reason, payload.error, payload.status,
    payload.result, payload.file, payload.path,
  ];
  
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const trimmed = candidate.trim();
      return trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
    }
  }
  
  // Check arrays and numbers
  if (Array.isArray(payload.files) && payload.files.length > 0) {
    return `${payload.files.length} file(s)`;
  }
  if (typeof payload.duration_ms === 'number') {
    return `Duration: ${Math.round(payload.duration_ms)}ms`;
  }
  
  return event.stage !== 'none' ? `Stage: ${event.stage}` : 'Event processed';
}
```

## Files Changed

1. **packages/webview/src/components/MissionFeed.ts**
   - Enhanced `failure_detected` event handler
   - Fixed truncation-safe event field name mappings
   - Added `humanizeEventType()` and `extractFallbackSummary()` helper functions
   - Improved unknown event fallback rendering with professional styling

## Testing

- Build: ✅ Passed
- All event types now properly display meaningful summaries
- Unknown events display professionally with extracted payload info

## Result

Users will now see actual error messages when missions fail, making debugging significantly easier. The UI gracefully handles both old and new payload field names for truncation-safe execution events.
