# Step 37 — Reference-Based Enhancements (Complete)

## Summary

Step 37 adds the foundational plumbing for user-provided references (images + URLs) to influence design, layout, and style decisions in greenfield scaffolds and follow-up edits. This step focuses on **structure, types, and event flow** — no Vision API reasoning is required yet.

## Key Design Decisions

1. **References are MODIFIERS, not a new behavior** — They influence SCAFFOLD/QUICK_ACTION/PLAN but don't change the behavior classification
2. **No auto-apply** — All reference influence goes through existing approval gates
3. **Replay-safe events** — New events store only IDs and intent, no analysis data yet
4. **Vision stub ready** — Clean interface for plugging in Vision API later with zero refactor

## Files Modified

### packages/core/src/types.ts
- Added `ReferenceAttachment` type (image | url)
- Added `ReferenceIntent` type (visual_style | layout | branding | unknown)
- Added `ReferenceContext` interface
- Added `StyleSourceMode` type (use_reference | ignore_reference | combine_with_design_pack)
- Added event payload types: `ReferenceAttachedPayload`, `ReferenceContextBuiltPayload`, `ReferenceUsedPayload`
- Added `VisionTokens` and `VisionAnalyzer` interfaces (stub)
- Added modifier fields to `IntentAnalysis`: `has_references`, `reference_intent`, `reference_mode`
- Updated `ScaffoldProposalCreatedPayload` with `reference_context` and `reference_mode`
- Added event types: `reference_attached`, `reference_context_built`, `reference_used`

### packages/core/src/referenceContextBuilder.ts (NEW)
- `MAX_IMAGES = 10` — Enforced limit for user uploads
- `DEFAULT_STYLE_SOURCE_MODE = 'combine_with_design_pack'`
- `REFERENCE_INFLUENCE_PATTERNS` — Regex patterns for phrases like "like this", "use this design"
- `buildReferenceContext()` — Converts attachments to normalized ReferenceContext
- `detectReferenceIntent()` — Classifies intent from prompt text
- `hasReferenceInfluenceIntent()` — Checks if prompt implies reference influence
- `extractUrlsFromPrompt()` — Extracts URLs from user text
- `buildReferenceAttachedPayload()` / `buildReferenceContextBuiltPayload()` — Event payload builders

### packages/core/src/vision/visionAnalyzer.ts (NEW)
- Stub `VisionAnalyzer` class
- `analyze()` returns `{ status: 'pending', reason: 'vision_not_enabled' }`
- Creates clean integration point for future Vision API

### packages/core/src/intentAnalyzer.ts
- Added import for `referenceContextBuilder`
- Extended `IntentAnalysisContext` with `attachments` and `userReferenceMode` fields
- Added `analyzeReferenceModifiers()` function
- Updated `analyzeIntentWithFlow()` to detect and set reference modifier fields
- Modifier fields flow downstream without changing behavior classification

### packages/core/src/scaffoldFlow.ts
- Added imports for reference types and builders
- Extended `ScaffoldFlowState` with `referenceContext` and `styleSourceMode`
- Updated `startScaffoldFlow()` to accept attachments and build reference context
- Added `emitReferenceAttached()` — Emits when scaffold starts with references
- Added `emitReferenceContextBuilt()` — Emits after building context
- Added `emitReferenceUsed()` — Emits when user proceeds with references
- Updated `emitScaffoldProposalCreated()` to include `reference_context` in payload

### packages/webview/src/components/ScaffoldCard.ts
- Added `renderReferenceSection()` — Thumbnail strip for images, URL list with favicons
- Added `renderStyleSourcePicker()` — Radio buttons for style source mode
- Renders "Design will be influenced by provided references" message
- Style picker options: Use reference, Ignore reference, Combine with design pack

### packages/extension/src/attachmentEvidenceStore.ts
- Updated `MAX_FILES = 10` (was 5)

## Event Flow

```
User uploads images/URLs + prompt
        ↓
scaffold_started
        ↓
reference_attached { ref_ids, types }
        ↓
reference_context_built { intent, ref_count }
        ↓
scaffold_proposal_created { ..., reference_context, reference_mode }
        ↓
decision_point_needed (UI shows thumbnail strip + style picker)
        ↓
[User clicks Proceed]
        ↓
reference_used { scope: 'scaffold', mode: 'combined' | 'exclusive' }
        ↓
scaffold_completed
```

## Safety Guarantees

1. **References never override file system safety** — All writes go through approval gates
2. **References never override command policy** — Terminal commands still gated
3. **No auto-apply** — User must explicitly approve scaffold
4. **Replay-safe** — Events contain only IDs and metadata, no analysis blobs

## UI Elements

### Thumbnail Strip
- Shows up to 10 images as 48x48 thumbnails
- Border + hover effect for visual feedback
- Overflow handled gracefully

### URL List
- Shows domain name + favicon
- Opens in browser on click
- Max 5 URLs displayed, "+N more" for overflow

### Style Source Picker
- **Use reference** — Reference takes priority
- **Ignore reference** — Fall back to design pack only
- **Combine with design pack** — Blend both (default)

## Acceptance Criteria Status

| Criteria | Status |
|----------|--------|
| User can upload up to 10 images | ✅ |
| URLs are stored and displayed | ✅ |
| Intent analyzer routes reference usage correctly | ✅ |
| Scaffold proposal visually reflects references | ✅ |
| Events replay cleanly | ✅ |
| No Vision API required yet | ✅ |
| No behavior regressions | ✅ |

## Next Steps

Step 38 will add actual Vision API integration:
1. Call Vision API on images
2. Extract design tokens (colors, typography, layout patterns)
3. Feed tokens to scaffold recipe customization
4. Store analysis results in evidence (not events)

## Build Status

```
✅ pnpm run build — All packages compile successfully
```
