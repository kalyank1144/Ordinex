# Phase 2 — Authentication & Billing Requirements

> **Status**: NOT STARTED — Document created Feb 15, 2026
> **Purpose**: Track what needs to be built when moving from local BYOK to SaaS model
> **Model**: Similar to Cursor / Windsurf — users pay for subscription, get credits, LLM calls go through backend

---

## Business Model

| Aspect | Details |
|--------|---------|
| **Pricing** | Subscription + credit-based (tiered plans) |
| **LLM Routing** | All LLM calls routed through Ordinex backend (no direct API calls from extension) |
| **API Keys** | Users do NOT provide their own keys. Backend manages all LLM provider keys. |
| **Free Tier** | TBD — limited credits for trial |
| **Paid Tiers** | TBD — monthly credits, priority routing, team features |

---

## What Needs to Be Built

### 1. Backend Server (A1)

| Component | Purpose | Priority |
|-----------|---------|----------|
| **HTTP Server** | Express/Fastify server for API endpoints | CRITICAL |
| **LLM Proxy** | Route all LLM calls through backend, manage provider API keys | CRITICAL |
| **SSE Streaming** | Server-Sent Events for real-time LLM streaming to extension | CRITICAL |
| **Rate Limiting** | Per-user, per-plan rate limits | HIGH |
| **Usage Tracking** | Track tokens, requests, credits consumed per user | HIGH |
| **Database** | PostgreSQL for users, subscriptions, usage, sessions | CRITICAL |

### 2. Authentication System

| Component | Purpose | Priority |
|-----------|---------|----------|
| **Login / Sign Up screen** | Insert into onboarding flow BEFORE welcome screen | CRITICAL |
| **Auth Provider abstraction** | `AuthProvider` interface: `getCredentials()`, `isAuthenticated()`, `signOut()` | CRITICAL |
| **JWT Token management** | Access + refresh tokens, stored in VS Code SecretStorage | CRITICAL |
| **Session persistence** | Keep user logged in across VS Code restarts | HIGH |
| **SSO / SAML** | Enterprise auth (Phase 3) | LOW |

### 3. Billing & Credits

| Component | Purpose | Priority |
|-----------|---------|----------|
| **Stripe integration** | Payment processing, subscription management | CRITICAL |
| **Credit system** | Track credits per user, deduct per LLM call based on model/tokens | CRITICAL |
| **Credit check middleware** | Before each LLM call, verify user has credits | CRITICAL |
| **Usage dashboard** | Show credits remaining, usage history, plan details | HIGH |
| **Plan upgrade flow** | In-extension upgrade prompts when credits run low | HIGH |
| **Billing portal** | Link to Stripe customer portal for plan management | MEDIUM |

### 4. Extension Client Refactor

| Component | Current State | What Changes |
|-----------|--------------|--------------|
| **API calls** | 7 direct Anthropic SDK call sites | Replace with `BackendLLMGateway` that routes through backend |
| **API key storage** | `context.secrets.get('ordinex.apiKey')` | Replace with auth token from backend |
| **LLM client** | `AnthropicLLMClient` wraps SDK directly | `BackendLLMClient` calls backend proxy endpoints |
| **Streaming** | Direct SDK streaming | SSE from backend |
| **Model selection** | User picks model, SDK calls it | Backend decides model routing based on plan tier |

### 5. Onboarding Flow Changes

| Current (Phase 1) | Phase 2 Addition |
|-------------------|------------------|
| Welcome screen → Mode tour → Quick start → Ready | **Login/Sign Up** → Credit check → Welcome → Mode tour → Quick start → Ready |

**Specific changes to onboarding:**
- Add a new slide 0: Login / Sign Up (before current slide 0)
- After auth, check subscription status
- If no subscription → redirect to pricing page
- If active → continue to welcome tour
- If trial expired → show upgrade prompt
- The `checkAndShowOnboarding` in `extension.ts` should also check auth status

### 6. LLM Gateway Abstraction (Step 63)

```typescript
// Interface that works for both phases
interface LLMGateway {
  complete(params: CompletionParams): Promise<CompletionResult>;
  stream(params: CompletionParams): AsyncIterable<StreamChunk>;
}

// Phase 1: Direct SDK calls (current)
class DirectLLMGateway implements LLMGateway { ... }

// Phase 2: Routes through backend
class BackendLLMGateway implements LLMGateway { ... }
```

### 7. Usage Tracking Abstraction (Step 64)

```typescript
interface UsageTracker {
  recordUsage(event: UsageEvent): Promise<void>;
  getUsage(userId: string, period: string): Promise<UsageReport>;
}

// Phase 1: Local log file
class LocalUsageTracker implements UsageTracker { ... }

// Phase 2: Backend API
class BackendUsageTracker implements UsageTracker { ... }
```

---

## Implementation Order (When Phase 2 Starts)

1. **LLM Gateway abstraction** (Step 63) — minimal refactor, enables switching
2. **Backend server setup** — Express/Fastify + PostgreSQL
3. **Auth system** — JWT, login/signup endpoints
4. **Stripe billing** — subscriptions, credits
5. **LLM proxy endpoints** — route calls through backend
6. **Extension client refactor** — swap DirectLLMGateway → BackendLLMGateway
7. **Onboarding update** — add login/signup slide
8. **Usage dashboard** — credits remaining, history

---

## Files That Will Need Changes

| File | Change Type |
|------|------------|
| `packages/extension/src/extension.ts` | Add auth check on activation |
| `packages/extension/src/anthropicLLMClient.ts` | Replace with `BackendLLMClient` |
| `packages/core/src/llmService.ts` | Use LLMGateway interface |
| `packages/core/src/llmEditTool.ts` | Use LLMGateway interface |
| `packages/core/src/truncationSafeExecutor.ts` | Use LLMGateway interface |
| `packages/core/src/intent/llmIntentClassifier.ts` | Use LLMGateway interface |
| `packages/core/src/vision/anthropicVisionProvider.ts` | Use LLMGateway interface |
| `packages/webview/src/webviewJs/onboarding.ts` | Add login/signup slide |
| `packages/extension/src/handlers/settingsHandler.ts` | Show plan/credits instead of API key |
| NEW: `packages/server/` | Entire backend package |

---

## API Key Removal Checklist

When Phase 2 is ready, remove all BYOK (Bring Your Own Key) references:

- [ ] Remove `ordinex.setApiKey` command
- [ ] Remove `ordinex.clearApiKey` command
- [ ] Remove API key input from settings panel
- [ ] Remove `context.secrets.get('ordinex.apiKey')` from all 6 handler files
- [ ] Update settings panel to show account info + credits instead
- [ ] Remove API key validation in `settingsHandler.ts`

---

*This document should be reviewed and updated when Phase 2 development begins.*
