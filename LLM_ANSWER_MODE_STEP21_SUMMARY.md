# Step 21: LLM Integration for ANSWER Mode - Implementation Summary

**Date**: 2026-01-19
**Status**: ✅ COMPLETE

## Overview

Implemented real LLM integration for ANSWER mode using Anthropic Claude API with streaming support. Users can now ask questions and receive AI-powered answers with token-by-token streaming, proper event emission, and evidence persistence.

## Implementation Details

### 1. Core LLM Service (`packages/core/src/llmService.ts`)

Created a new `LLMService` class that:
- Integrates with Anthropic Claude API (@anthropic-ai/sdk v0.32.1)
- Supports streaming responses with real-time delta callbacks
- Emits canonical events: `tool_start`, `tool_end`, `model_fallback_used`
- Handles model mapping and fallback (all non-Sonnet models fallback to `claude-3-5-sonnet-20241022`)
- Dynamically loads Anthropic SDK to avoid bundling issues

**Key Features:**
```typescript
export class LLMService {
  async streamAnswer(
    userQuestion: string,
    config: LLMConfig,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMResponse>
}
```

- Uses `for await` loop to process streaming events
- Captures usage statistics (input/output tokens)
- Error handling with proper event emission

### 2. API Key Management

Added VS Code commands for secure API key storage:

**Commands:**
- `ordinex.setApiKey` - Prompts user for Anthropic API key, validates format, stores in SecretStorage
- `ordinex.clearApiKey` - Clears stored API key with confirmation

**Security:**
- API keys stored in VS Code's SecretStorage (encrypted, never in files)
- Format validation (must start with `sk-ant-`)
- Never logged or exposed in evidence

### 3. Extension Integration (`packages/extension/src/extension.ts`)

Added `handleAnswerMode` method that:

1. **Retrieves API key** from SecretStorage
2. **Validates key presence** - prompts user to set if missing
3. **Initializes LLMService** with EventBus integration
4. **Streams response** with real-time updates to webview
5. **Persists evidence** - saves full answer to evidence file
6. **Error handling** - emits `failure_detected` events on errors

**Streaming Flow:**
```typescript
Extension                 Webview
    |                        |
    |--ordinex:streamDelta-->|  (incremental text)
    |--ordinex:streamDelta-->|
    |--ordinex:streamDelta-->|
    |--ordinex:streamComplete|  (done signal)
```

### 4. Event Sequence for ANSWER Mode

When user submits a question in ANSWER mode:

1. `intent_received` - User question captured
2. `mode_set` - Mode set to ANSWER
3. `model_fallback_used` - (if non-Sonnet model selected)
4. `tool_start` - LLM call initiated with model info
5. `tool_end` - LLM call completed with usage stats
6. OR `failure_detected` - If error occurs

### 5. Evidence Storage

- Assistant responses saved to `.Ordinex/evidence/{evidence_id}.txt`
- Full response content preserved
- Evidence referenced in events via `evidence_ids`
- Viewable through Evidence Viewer in UI

## Files Modified

### Created:
- `packages/core/src/llmService.ts` - LLM service implementation

### Modified:
- `packages/core/package.json` - Added @anthropic-ai/sdk dependency
- `packages/core/src/index.ts` - Exported LLMService
- `packages/extension/src/extension.ts` - Added handleAnswerMode method
- `packages/extension/package.json` - Added API key commands

## Testing Instructions

### 1. Set up API Key:
```
1. Open Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
2. Run: "Ordinex: Set API Key"
3. Enter your Anthropic API key (sk-ant-...)
```

### 2. Ask a Question:
```
1. Open Ordinex Mission Control panel
2. Select ANSWER mode
3. Type a question: "What is event sourcing?"
4. Click Send
5. Watch the streaming response appear in real-time
```

### 3. Verify Events:
```
1. Switch to Logs tab
2. Verify event sequence:
   - intent_received
   - mode_set
   - tool_start (tool="llm_answer")
   - tool_end (status="success")
```

### 4. Check Evidence:
```
1. Tool_end event shows evidence_ids
2. Evidence contains full assistant response
3. Can be viewed via Evidence Viewer
```

## Constraints & Design Decisions

### V1 Limitations (By Design):
1. **Single Provider**: Only Anthropic (Claude) supported
2. **ANSWER Mode Only**: No LLM in PLAN/MISSION modes yet
3. **No Tool Use**: LLM cannot execute tools or make diffs
4. **No Retrieval**: No context injection (pure Q&A)
5. **No Multi-Turn**: Each question is independent
6. **Local API Key Only**: No subscription service, no proxy

### Model Fallback Strategy:
- User-selected models mapped to Anthropic equivalents
- Unsupported models fallback to `claude-3-5-sonnet-20241022`
- `model_fallback_used` event emitted when fallback occurs

### Error Handling:
- Missing API key → Helpful error + prompt to set
- API errors → `failure_detected` event with error details
- Network failures → Graceful degradation with error event

## Future Enhancements (V2+)

Not implemented in Step 21 (per spec):

1. **Multi-Provider Support**: OpenAI, Google, local models
2. **Context Injection**: Pass retrieved code to LLM
3. **Tool Use**: Allow LLM to propose diffs, run commands
4. **Chain-of-Thought**: Expose reasoning process
5. **Multi-Turn Conversations**: Session management
6. **Subscription Service**: Managed API keys, usage tracking
7. **Streaming UI Cards**: Dedicated answer card component

## Compliance

✅ **Spec Compliance:**
- Follows 05_TECHNICAL_IMPLEMENTATION_SPEC.md
- Uses canonical event types only
- Deterministic event emission
- Evidence-backed responses
- SecretStorage for API keys (not in files)

✅ **Architecture Compliance:**
- Event-sourced design
- No state mutations outside event stream
- Proper evidence persistence
- Clean separation: Core → Extension → Webview

## Next Steps

**For Users:**
1. Set API key: `Ordinex: Set API Key`
2. Try ANSWER mode with real questions
3. Verify streaming works
4. Check evidence is stored

**For Developers:**
1. Monitor for API errors in console
2. Validate event sequences in EventStore
3. Test model fallback scenarios
4. Verify evidence file creation

**Future Work:**
- Step 22+: Context-aware ANSWER mode (with retrieval)
- Step 23+: Multi-provider support
- Step 24+: Tool use in ANSWER mode

---

## Summary

Step 21 successfully implements a production-ready LLM integration for ANSWER mode:
- ✅ Real Anthropic Claude API integration
- ✅ Streaming token-by-token output
- ✅ Secure API key management
- ✅ Full event/evidence persistence
- ✅ Error handling and user guidance
- ✅ Clean, deterministic architecture

Users can now ask questions and get real AI-powered answers with proper audit trails through the event log.
