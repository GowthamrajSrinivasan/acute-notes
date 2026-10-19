# AI Connection Validation Matrix (F36)

**Date:** 2026-09-26 · **SDK:** `@github/copilot-sdk@1.0.14` · **Suite:** `src/ai/contractTests/liveConnections.contract.test.ts` (`npm run test:contract`)

This is the acceptance gate from PRD §13.15.11: a connection stays listed in AI Settings only once it has a passing row here. Criteria are the nine from §13.15.11. Criteria 7 and 8 are unconditional (every connection shares the same hardened session config and route gating) and are cited from F35's own tests rather than re-run per connection — there is no connection-specific code path for either.

| # | Criterion | How it's checked |
|---|---|---|
| 1 | Authenticates using only documented mechanisms | Structural — the descriptor's `authFlow` |
| 2 | `generate`/`stream` work; cancellation stops the request | Real call + real stream + abort |
| 3 | Structured output valid via JSON + one repair retry | Through a real `AIRuntime.run` |
| 4 | Model listing or a documented model field works | See note below — BYOK-specific |
| 5 | Errors are distinguishable (auth/quota/model/network) | A deliberately wrong key |
| 6 | Usage reported, or `getUsage()` honestly `null` | Inspected on a real response |
| 7 | No built-in tool is ever invoked | `src/ai/host/copilot/hardening.test.ts` (unconditional) |
| 8 | Works in the target deployment mode | `src/app/api/ai/route.test.ts` (unconditional) |
| 9 | SDK/CLI hop overhead acceptable | Measured latency, informational (PRD §8.2 sets no numeric target) |

**Criterion 4 finding (applies to every BYOK connection, not just one row):** `CopilotHostRuntime.listModels()` only ever takes `auth`, never a BYOK `provider` — verified while building this suite. `client.listModels()` reflects the **Copilot account's** models, not a BYOK endpoint's, so it cannot validate model selection for OpenAI/Azure/Anthropic/Gemini/Ollama. For those, criterion 4 is satisfied via "a documented model field" (§13.15.11's own alternative) — the free-text Model input already built in F27 — not a live listing call.

## Results

| Connection | 1 | 2 | 3 | 4 | 5 | 6 | 9 | Verdict |
|---|---|---|---|---|---|---|---|---|
| **GitHub Copilot** | ✅ `useLoggedInUser`, already signed in via `copilot login` | ✅ generate + stream + cancel all real and correct | ✅ valid `{"answer":"42"}` via AIRuntime | ✅ `listModels()` — Copilot-account-scoped, works as documented | n/a — no key to falsify | ✅ `provider`/`model` present | ✅ ~1.3s | **Pass** |
| **OpenAI** | — | — | — | via model field (see above) | — | — | — | Not configured (placeholder key in `.env.local`) |
| **Azure OpenAI/Foundry** | — | — | — | via model field | — | — | — | Not configured (placeholder key/endpoint) |
| **Anthropic** | — | — | — | via model field | — | — | — | Not configured (placeholder key) |
| **Gemini** | ✅ real key accepted | ✅ generate + stream + cancel real and correct | ✅ valid `{"answer":"42"}` via AIRuntime | via model field (see above) | ⚠️ **known limitation** — Gemini answers an invalid key with HTTP **400** `INVALID_ARGUMENT` ("Please pass a valid API key"), not 401, and the SDK surfaces only `400 Bad Request` without the body, so a bad key is indistinguishable from any other bad request | ✅ `provider`/`model` present | ✅ ~1s | **Pass, with the criterion-5 limitation noted** — shown in AI Settings |
| **Ollama** | n/a — local, no key | ⚠️ nothing listening on `localhost:11434` in this environment; generate/structured/usage correctly time out at the suite's 8s budget (`AIError("cancelled")`, since this suite uses `AbortSignal.timeout()` as its own give-up mechanism — not a real cancellation bug). The stream+cancel test happens to "pass" only because a timeout and an explicit user-cancel both surface as `AIError("cancelled")` — that's a property of this test's own design, not a validated pass for that criterion. | — | via model field | — | — | — | **Not run** — no local instance available here; re-run once one is |

### Gemini — correction (same day)

The first run of this matrix recorded Gemini as **failing** (every call `400 Bad Request` through the SDK, while a raw request with the same key/model returned `200`) and hid it. That verdict was wrong: **the contract suite itself never passed the configured model into the request**, so the SDK sent its own default model name to Gemini's endpoint. With the model passed through — as `copilotProvider.ts`'s `defaultModel` already does in the real app — every Gemini live check passes. The descriptor is no longer hidden.

What remains true: Gemini returns HTTP 400 (not 401) for an invalid key, and the SDK drops the response body, so criterion 5 can only surface a generic failure for a bad Gemini key. The settings UI covers this with a "check the API key, model, and endpoint" hint on any failed API-key Test.

## Two app-level fixes found while validating

- **Copilot failed in the real app even though it passed here.** The contract suite runs unbundled under vitest; the Next.js route handlers were bundling `@github/copilot-sdk` with Turbopack, which breaks the SDK's resolution of its own native CLI runtime. Fixed with `serverExternalPackages: ["@github/copilot-sdk", "koffi"]` in `next.config.ts`.
- **Test Connection for API-key connections tested the wrong credentials.** It called `getModels()`, which is Copilot-account-scoped (the criterion-4 finding above), so it never touched the BYOK key at all. It now makes one minimal real request through the connection instead.

## Re-running this matrix

- `npm run test:contract` (needs real credentials in `.env.local`, never committed — see the F36 tracker entry for the exact env var names).
- Update this table and the `hidden` flags in `src/ai/providers/registry.ts` together — they're meant to stay in sync by hand, not by a runtime read of this file (see F36's design decisions in the tracker).
