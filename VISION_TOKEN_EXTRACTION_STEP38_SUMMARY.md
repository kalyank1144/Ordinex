# Step 38: Vision + URL Reference Token Extraction

## Overview

Step 38 implements real vision analysis for user-provided image references, replacing the Step 37 stub with a full, replay-safe, enterprise-safe system for extracting design tokens from screenshots and design mockups.

## Key Features

### ✅ Replay-Safe
- Vision analysis is **NEVER re-run** during replay/audit mode
- Tokens are stored as evidence (`.ordinex/evidence/reference_tokens_<id>.json`)
- Replay loads tokens from evidence with checksum verification

### ✅ Enterprise-Safe
- **Default visionMode: 'off'** - no analysis until explicitly enabled
- **Consent gating** - 'prompt' mode asks before analyzing
- **No third-party uploads** until user enables via settings
- Provider keys stored securely (extension handles API keys)

### ✅ No New Behaviors
- Vision is a **preprocessing step**, not a new Step 33 behavior
- Works with existing SCAFFOLD, QUICK_ACTION, PLAN flows
- References are modifiers, not behaviors

## Files Created/Modified

### Core Types (`packages/core/src/types.ts`)
```typescript
// New event types added:
- vision_analysis_started
- vision_analysis_completed
- reference_tokens_extracted
- reference_tokens_used

// New types:
- ReferenceTokens          // Structured style/layout tokens
- VisionAnalyzeResult      // Analysis output
- VisionConfig             // Workspace settings
- VisionMode               // 'off' | 'prompt' | 'on'
- VisionProvider           // 'anthropic' | 'openai' | 'backend-default'
- Event payloads for all vision events
```

### Vision Configuration (`packages/core/src/vision/visionConfig.ts`)
```typescript
// Workspace settings:
ordinex.references.visionMode       // 'off' (default) | 'prompt' | 'on'
ordinex.references.visionProvider   // 'anthropic' (default) | 'openai' | 'backend-default'
ordinex.references.maxImages        // 10 (hard limit)
ordinex.references.maxPixels        // 1024 (resize target)
ordinex.references.maxTotalUploadMB // 15MB
```

### Vision Policy (`packages/core/src/vision/visionPolicy.ts`)
```typescript
// Policy decision flow:
shouldAnalyze(config, refs, runContext) → 'skip' | 'prompt' | 'proceed'

// Rules:
1. No references → skip
2. visionMode === 'off' → skip  
3. isReplay → skip (CRITICAL)
4. visionMode === 'prompt' → emit decision_point_needed
5. visionMode === 'on' → proceed
```

### Evidence Store (`packages/core/src/vision/referenceTokensEvidence.ts`)
```typescript
// Evidence file structure:
{
  version: 'reference_tokens_v1',
  reference_context_id: string,
  checksum: string,           // SHA256 of tokens
  created_at: string,
  tokens: ReferenceTokens
}

// Functions:
writeTokensEvidence(fs, workspaceRoot, refContextId, tokens)
readTokensEvidence(fs, workspaceRoot, refContextId)
tokensEvidenceExists(fs, workspaceRoot, refContextId)
```

### Real Vision Analyzer (`packages/core/src/vision/visionAnalyzer.ts`)
```typescript
// RealVisionAnalyzer orchestrates:
1. Policy check (skip/prompt/proceed)
2. Replay detection (load cached tokens)
3. Image loading via AttachmentLoader
4. URL context building (domain/path only, no fetch)
5. Provider call (VisionProviderClient interface)
6. Token validation
7. Evidence storage
8. Event emission

// Factory:
createRealVisionAnalyzer(config, fs, provider, loader, emitter)
```

### Context Summary (`packages/core/src/vision/referenceContextSummary.ts`)
```typescript
// For LLM context injection:
buildReferenceContextSummary(tokens, mode)  // Full markdown block
buildCompactSummary(tokens)                  // One-line UI display
buildInlineHint(tokens)                      // Minimal prompt hint

// For design pack integration:
buildDesignPackOverrides(tokens, mode, threshold)
getSuggestedDesignPacks(tokens)
```

## ReferenceTokens Structure

```typescript
interface ReferenceTokens {
  source: { images_count: number; urls_count: number };
  style: {
    palette?: { primary?: string; secondary?: string; accent?: string; neutrals?: string[] };
    mood?: string[];              // ["minimal", "modern", "vibrant"]
    typography?: { heading?: string; body?: string };
    density?: 'compact' | 'default' | 'relaxed';
    radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
    shadows?: 'none' | 'subtle' | 'medium' | 'dramatic';
  };
  layout?: { structure?: string[]; components?: string[] };
  uiHints?: { component_system_preference?: 'shadcn' | 'mui' | 'chakra' | 'tailwind-plain' };
  confidence: number;  // 0..1
  warnings?: string[];
}
```

## Event Flow

```
User attaches images → reference_attached
                    → reference_context_built
                    
Scaffold flow starts → vision_analysis_started
                     → [provider call if enabled]
                     → vision_analysis_completed {status: 'complete'|'skipped'|'error'}
                     → reference_tokens_extracted {evidence_ref, palette_summary, moods, confidence}
                     
Tokens used in scaffold → reference_tokens_used {used_in: 'scaffold_proposal', mode, overrides_applied}
```

## Integration Points

### Scaffold Flow
```typescript
// When building scaffold proposal with references:
1. Check policy (shouldAnalyze)
2. If prompt mode, emit decision_point_needed
3. Run vision analysis (or load from cache)
4. Use getSuggestedDesignPacks(tokens) for pack selection
5. Use buildDesignPackOverrides(tokens, mode) for style overrides
6. Emit reference_tokens_used when applying
```

### Quick Action / Plan Context
```typescript
// When references exist and tokens available:
const summary = buildReferenceContextSummary(tokens, mode);
// Insert into context (NOT MissionFeed)
```

## Confidence Thresholds

| Mode | Confidence Threshold | Behavior |
|------|---------------------|----------|
| use_reference | >= 0.6 | Apply full palette, radius, shadows overrides |
| combine | >= 0.7 | Apply accent color only, keep design pack base |
| ignore | any | No overrides applied |

## URL Handling (Step 38 Scope)

- **No HTML fetching** in Step 38
- URLs provide domain/path hints only
- Tokens include `warning: "url_not_fetched"`
- Confidence adjusted lower for URL-only analysis

## Security Guarantees

1. **No base64 in events** - Only summarized tokens in payloads
2. **No OCR text dumps** - Structured extraction only
3. **Evidence checksums** - Integrity verification on read
4. **Replay isolation** - Never call provider in replay mode
5. **Consent gating** - 'prompt' mode requires explicit user action

## Additional Files (Extended Implementation)

### Anthropic Vision Provider (`packages/core/src/vision/anthropicVisionProvider.ts`)
```typescript
// Production-ready Anthropic Claude vision integration
// Uses multimodal API to extract tokens from images

export class AnthropicVisionProvider implements VisionProviderClient {
  async analyze(images, urlContext, schema): Promise<ReferenceTokens>
}

// Features:
// - Structured JSON extraction with schema guidance
// - Markdown code block handling in responses
// - Color validation (#RGB, #RRGGBB formats)
// - Density/radius/shadows validation
// - Graceful fallback on parse errors
```

### UI Card (`packages/webview/src/components/VisionAnalysisCard.ts`)
```typescript
// Renders vision_analysis_started and vision_analysis_completed events
// Shows: spinner during analysis, status icon after completion, duration

renderVisionAnalysisStartedCard(event)  // Shows "Analyzing references..."
renderVisionAnalysisCompletedCard(event) // Shows success/skip/error
```

### Tests (`packages/core/src/__tests__/visionAnalyzer.test.ts`)
```typescript
// Test coverage for:
- Vision policy decisions (skip/prompt/proceed)
- Evidence storage and loading
- Replay safety (no provider calls in replay)
- Token validation (colors, moods, density, radius)
- Confidence thresholds (0.6 for use_reference, 0.7 for combine)
- Checksum validation
```

## Remaining Work (Minor Wiring)

- [ ] Update webview EventType union to include vision events
- [ ] Add MissionFeed routing for vision_analysis_* events
- [ ] Wire scaffoldFlow.ts to call vision analyzer before design pack selection
- [ ] Add 'user_declined' to VisionSkipReason type

## Testing the Implementation

```typescript
import { createRealVisionAnalyzer } from './vision/visionAnalyzer';
import { DEFAULT_VISION_CONFIG } from './vision/visionConfig';

// Create analyzer with mock provider
const analyzer = createRealVisionAnalyzer({
  ...DEFAULT_VISION_CONFIG,
  visionMode: 'on'  // Enable for testing
});

// Analyze references
const result = await analyzer.analyze(referenceContext, {
  runId: 'test-run',
  isReplay: false,
  workspaceRoot: '/path/to/workspace',
  referenceContextId: 'ref-123'
});

// Result contains:
// { status: 'complete', tokens: {...}, tokensEvidenceRef: '...' }
```

## Summary

