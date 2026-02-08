# STEP 37: Reference-Based Enhancements - Implementation Summary

## PURPOSE
Enable Ordinex to understand user-provided references (images + URLs) and use them to influence design, layout, and style decisions for greenfield scaffolds and follow-up edits — without breaking determinism or safety.

**This step does NOT require full Vision API reasoning yet.**
It focuses on plumbing, structure, and event flow so Vision can be plugged in cleanly later.

## WHAT WAS IMPLEMENTED

### 1. Type System Extensions (`packages/core/src/types.ts`)

Added new types for the reference-based enhancement system:

```typescript
// Reference Attachment (discriminated union)
type ReferenceAttachment =
  | { type: 'image'; id: string; path: string; mime: string }
  | { type: 'url'; id: string; url: string };

// Reference Intent Classification
type ReferenceIntent = 'visual_style' | 'layout' | 'branding' | 'unknown';

// Reference Context Bundle
interface ReferenceContext {
  images: ReferenceAttachment[];
  urls: ReferenceAttachment[];
  source: 'user_upload';
  intent: ReferenceIntent;
}

// Style Source Mode (UI picker)
type StyleSourceMode = 'use_reference' | 'ignore_reference' | 'combine_with_design_pack';

// Vision Analyzer Interface (stub)
interface VisionAnalyzer {
  analyze(refs: ReferenceContext): Promise<VisionTokens>;
}
```

### 2. New Event Types

Added three new replay-safe events:

| Event Type | Payload | Purpose |
|------------|---------|---------|
| `reference_attached` | `{ ref_ids: string[], types: ('image'|'url')[] }` | Track when references are attached |
| `reference_context_built` | `{ intent: ReferenceIntent, ref_count: number }` | Track context normalization |
| `reference_used` | `{ scope: 'scaffold'|'quick_action'|'plan', mode: 'combined'|'exclusive' }` | Track reference usage |

### 3. Webview Attachment Limit Update (`packages/webview/src/index.ts`)

Increased MAX_FILES from 5 to 10 to support reference-based enhancements:

```javascript
const ATTACHMENT_CONFIG = {
  MAX_FILES: 10, // Step 37: Increased from 5
  MAX_SIZE_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    // ...
  ]
};
```

### 4. Reference Context Builder (`packages/core/src/referenceContextBuilder.ts`)

New module with the following capabilities:

- **Attachment Classification**: Classifies attachments as `image` or `url` references
- **URL Extraction**: Extracts URLs from prompt text
- **Intent Detection**: Detects reference intent from prompt patterns
  - `visual_style`: "like this", "similar to this", "use this design", etc.
  - `layout`: "this layout", "same layout", "structure like", etc.
  - `branding`: "branding", "logo", "color scheme", etc.
  - `unknown`: Default when no patterns match
- **Context Building**: Builds normalized `ReferenceContext` from inputs
- **Event Payload Builders**: Creates payloads for reference events
- **Style Source Resolution**: Resolves final style mode based on user preference
- **Safety Validation**: Validates reference context constraints
- **Clarification Detection**: Detects when clarification is needed

Key Functions:
```typescript
// Main entry point
buildReferenceContext(attachments, promptText): ReferenceContext | null

// Intent detection
detectReferenceIntent(promptText): ReferenceIntent
hasReferenceInfluenceIntent(promptText): boolean

// Event payloads
buildReferenceAttachedPayload(context): ReferenceAttachedPayload
buildReferenceContextBuiltPayload(context): ReferenceContextBuiltPayload

// Style resolution
resolveStyleSourceMode(userPreference, hasReferences, hasDesignPack): StyleSourceMode

// Safety
validateReferenceContext(context): { valid: boolean; errors: string[] }
needsClarification(context, promptText): { needsClarification: boolean; reason?: string }
```

### 5. Vision Analyzer Stub (`packages/core/src/vision/visionAnalyzer.ts`)

NO-OP interface for future Vision API integration:

```typescript
class StubVisionAnalyzer implements VisionAnalyzer {
  async analyze(refs: ReferenceContext): Promise<VisionTokens> {
    return {
      status: 'pending',
      reason: 'vision_not_enabled',
    };
  }
}

// Default instance
export const visionAnalyzer: VisionAnalyzer = new StubVisionAnalyzer();
```

This guarantees zero refactor when Vision API is added in a future step.

## FILES CHANGED

| File | Change Type |
|------|-------------|
| `packages/core/src/types.ts` | Modified - Added reference types and events |
| `packages/webview/src/index.ts` | Modified - Increased MAX_FILES to 10 |
| `packages/core/src/referenceContextBuilder.ts` | Created - Reference context builder |
| `packages/core/src/vision/visionAnalyzer.ts` | Created - Vision analyzer stub |

## WHAT THIS STEP DOES NOT DO

❌ Auto-redesign the whole app  
❌ Bypass approval gates  
❌ Auto-apply diffs  
❌ Require Vision API implementation  
❌ Invent UI based on guesses  

## WHAT THIS STEP ENABLES

✅ User can upload up to 10 images  
✅ URLs are stored and can be displayed  
✅ Intent detection patterns identify reference usage intent  
✅ ReferenceContext can be attached to proposals  
✅ Events are replay-safe (no analysis data yet)  
✅ System is ready for Vision API in next step  

## SAFETY GUARDRAILS

References NEVER override:
- File system safety
- Command policy
- Approval gates

If references contradict user text → ask ONE clarification
After 1 clarification → proceed conservatively

## PHASE 2: UI Enhancement Complete

### ScaffoldCard.ts Enhancements

Added reference display UI to the scaffold proposal:

1. **Reference Section** (`renderReferenceSection`)
   - Thumbnail strip for uploaded images (up to 10)
   - URL list with domain display
   - Reference intent badge (Visual Style, Layout, Branding, Design Reference)
   - Reference notice: "Design will be influenced by provided references"

2. **Style Source Picker**
   - Three options: "Reference", "Ignore", "Combined"
   - Default: "Combined" (combine_with_design_pack)
   - Visual active state with pink highlight (#e879f9)

3. **Event Actions**
   - `change_style_source` action dispatched on picker selection
   - Includes scaffoldId, eventId, and styleSourceMode

4. **CSS Styles**
   - `.reference-section` - Container with pink accent border
   - `.thumbnail-strip` - Horizontal scroll for image previews
   - `.url-list` - Flex wrap for URL badges
   - `.style-source-picker` - Button group for mode selection
   - `.reference-notice` - Subtle info banner

## NEXT STEPS (For Future Implementation)

1. **Wire Context**: Connect reference context to scaffoldFlow.ts (emit events)
2. **Intent Analyzer Update**: Integrate reference detection into behavior selection
3. **Vision API**: Replace StubVisionAnalyzer with real implementation
4. **Unit Tests**: Add comprehensive tests for reference detection

## ARCHITECTURE NOTES

The implementation follows the correct order:
1. Attachments ✅ (existing)
2. Reference plumbing ✅ (this step)
3. Event + UX alignment ⏳ (partial - events done, UX deferred)
4. Vision reasoning 🔜 (next step)

This avoids:
- Brittle multimodal logic
- Irreproducible runs
- Replay corruption
