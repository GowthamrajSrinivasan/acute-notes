# Intelligent update engine — Phase 1 close-out report

Date: 2026-11-16/17 · Plan: `.ai/docs/intelligent-update-engine-plan.md` §14 (decision, backlog), §15 (this work).
Milestone reached: **Phase 1 engineering complete** (integrated, flag off, tests pass, committed).
Milestone pending: **Phase 1 limited pilot ready** — needs the reviewer's decision on `stage4f-pilot-gate-proposal-2026-11-16.md`.

## 1. What Phase 1 delivers for day-to-day use

- Stages 1–3: content placement, routing, update review (built earlier).
- Stage 4a–4e: commit journal, live index, rules-only consistency panel — on by default, no AI.
- **Stage 4f AI consistency check — integrated, OFF by default**, opt-in, manual, review-only (this close-out).

## 2. The integration (approved scope: direct HTTP behind a default-off flag)

| Piece | File | What it does |
|---|---|---|
| Host direct call | `src/ai/host/judge/directJudge.ts` | Exactly one POST to `<baseUrl>/chat/completions`; `max_tokens`, temperature 0, `reasoning_effort: low`; redirects refused; no retry/fallback; fixed-text errors. Only chat-completions BYOK connections qualify. Never the Copilot SDK. |
| Route | `src/app/api/ai/judge/route.ts` | 404 unless `CONSISTENCY_AI_CHECK=on` (server-enforced) and the AI feature is on; body schema caps tokens (≤ 1,300), effort, timeout (≤ 90 s), prompt size. |
| Client transport | `src/ai/consistency/directJudgeTransport.ts` | One POST to `/api/ai/judge`; declares a real cap and one attempt. |
| Connection | `src/ai/connections.ts` `getDirectJudgeConnection`, `registry.ts` `chatCompletions` | The primary connection as a direct endpoint (never the fallback); six chat-completions connections share one BYOK builder. |
| Discovery + run | `src/ai/consistency/aiCheck.ts` | Opted in: each commit's claims × relevant cards → screen-forwarded pairs queued locally (identical statements skipped). "Check with AI": one `runJudgeCheck` call (≤ 10 pairs) → readings combined → `ConsistencyStore.recordAI`. Status and backlog. |
| Store | `src/ai/consistency/store.ts` | `ai` evidence on records; `recordAI` never changes a status; AI-raised near-misses re-checked by the screen's route. |
| UI | `src/components/consistency/ConsistencyPanel.tsx`, `consistencyRunner.ts` | "AI check (pilot)" section (only when the build offers it): opt-in switch, Check with AI, per-pair states, budget, backlog; labels "AI: likely conflict (your call)". |
| Switches | `src/config/features.ts`, `.env.development`, `.env.production` | `CONSISTENCY_AI_CHECK`, `NEXT_PUBLIC_CONSISTENCY_AI_CHECK` — both `off`. |

**Found during integration:** the live canvas's existing candidate source (rules only) would have surfaced **3 of 40** unseen5 contradictions; the evaluated pipeline's screen route reaches **36 of 40**. The integration therefore discovers through the screen when opted in (flag-off behaviour unchanged). The in-app test also found two defects, both fixed: the opt-in checkbox sprang back (async state), and identical statements on two elements (a frame title and its block) were queued as pairs.

## 3. Verification

| Check | Result |
|---|---|
| Unit suite (`npx vitest run`) | **371 files, 3,861 tests passed**, 0 failed (7 expected-fail, 17 skipped, 4 todo — unchanged) |
| Typecheck, lint (changed files) | clean |
| New mocked tests | host direct call (one request, no retry on 429/5xx, refusals), route (404 off by default for every non-"on" value, 400 on bad bodies, no key in errors), transport, AI-check flow (one call, review-only, no re-send, failures, budget exhausted, no cap / may-retry → nothing sent), status separation, backlog arithmetic, default-off (no queueing, no request, no connection lookup) |
| Default-off on a running server | `POST /api/ai/judge` → the route's own 404 "Not Found" (not the framework's page) |
| Flags-on server | malformed body → 400 from the route |
| In-app browser test (`e2e/local/aiCheck.local.spec.ts`, flags-on server, model calls answered in the browser) | **passed**: opt-in, near-miss queued, button disabled without a connection, one judge request with cap 760 / effort low / the primary's model, reading shown as evidence, user buttons decide, off switch |
| **One live call** (approved "if needed"), `aiCheckIntegration.contract.test.ts` under the execution envelope (1 request / 3,000 tokens / $0.01) | 1 route call, 1 provider request, **1,055 tokens, ≤ $0.00018**; both pairs answered (backups: contradicts → "likely"; refund window: unclear → "possible"); both records `possible`; budget settled to actual use; no key in the files. Pinned by `phase1Integration.test.ts`; never rerun. |

## 4. Backlog and budget on the real 90,000-token day

Per call (unseen5, 8 full 10-pair calls, direct path): reserved 2,365–2,441 tokens; used 1,739–2,152, mean 1,920.

| | Typical (settles at 1,920, reserves ~2,450) | Worst case (keeps the 2,800 reservation) |
|---|---|---|
| Checks per device per day | **46** (token cap binds before the 50-check cap) | **32** |
| Pairs per day | ~460 | 320 |
| 100 pending pairs (10 checks) | today | today |
| 1,000 pending pairs (100 checks) | 3 days | 4 days |

The panel reports these **separately**: pending pairs, checks needed, days (typical / at most), and the oldest pending pair's age — and keeps "not checked yet" apart from "checked, read as compatible". Each check is one manual press, so days assume the user presses; nothing runs on its own.

## 5. Pilot criteria

See the proposal: recall ≥ 85% (90%), precision ≥ 90% (100%; 93.9% conservative), context false positives ≤ 10% (0%); strict recall 77.5% disclosed; mandatory review; no automated editing; explicit opt-in; misses disclosed; observable states; easy off switch. All conditions are built; activation needs the reviewer.

## 6. What is not done (by decision)

- Not activated; no paid calls beyond the one approved verification call.
- Phase 2: time-overlap guard, semantic tuning, y20/y45 ambiguity, unseen6.
- Pending backlog: plan §14 (28 items) plus the new ones in §15.4.

## 7. How to pilot (when approved)

1. Set `CONSISTENCY_AI_CHECK=on` and `NEXT_PUBLIC_CONSISTENCY_AI_CHECK=on` (`.env.local` or the shell) and restart/rebuild.
2. Make an API-key chat-completions connection primary (AICredits with `openai/gpt-oss-120b` is the measured setup).
3. Consistency chip → "AI check (pilot)" → tick the opt-in → work as usual → press "Check with AI" when pairs are waiting.
4. Off: untick (device), or set either switch to `off`.
