# Stage 4f — limited pilot gate exception (proposal for the reviewer)

Date: 2026-11-16 · Status: **PROPOSAL — not approved.** Stage 4f stays off until the reviewer decides.
Context: intelligent-update-engine-plan §12.34 (unseen5 gate FAILED on strict recall), §14 (Phase 1 close-out decision), §15 (integration evidence).

## 1. What is asked

A **limited Phase 1 pilot exception** to the Stage 4f semantic gate: allow the AI consistency check to be switched on for opted-in pilot users, review-only, while strict recall stays below the original 85% gate. It does not ask for the gate to change for general release.

## 2. Evidence (unseen5, recorded 2026-11-15, development evidence since 2026-11-16)

| Measure | Original gate | Proposed pilot threshold | unseen5 result | Meets pilot? |
|---|---|---|---|---|
| Recall (conflict, likely or possible shown) | — | ≥ 85% | **90.0%** (36/40) | Yes |
| Strict recall (conflict or likely) | ≥ 85% | disclosed limitation, no threshold | **77.5%** (31/40) | Not required (disclosed) |
| Precision of conflict/likely calls | — | ≥ 90% | **100%** (31/31); **93.9%** (31/33) counting the two ambiguous pairs y20/y45 as wrong | Yes |
| Context false positives (compatible pairs shown as conflict/likely) | — | ≤ 10% | **0%** (0/45) | Yes |

What the 9 strict-recall misses are (unseen5 diagnosis, §12.34): 4 the model read as an exception or subgroup (y12, y31, y61, y86); 5 the time-overlap guard held back to "possible" (y05, y24, y49, y65, y83). All 5 guard downgrades are **still shown** to the user as "possible"; only the 4 model misses are unshown. The guard fix is Phase 2 (deferred), never tuned on unseen5.

Live-path evidence (§15): the discovery the canvas uses now follows the evaluated screen route. With the rules alone the live canvas would have surfaced 3/40 contradictions; with the integrated route it matches the pipeline's 36/40 on the recorded answers (offline, `liveDiscovery.probe.test.ts`). One live call through the integrated app path (2026-11-16): 1 request, 1,055 tokens, ≤ $0.0002, both pairs answered and recorded review-only.

**Caveats the reviewer should weigh:** unseen5 is now development evidence (it informed the diagnosis), not a fresh generalisation measure; real canvases add retrieval limits (top-20 cards per claim) and the 10-pairs-per-press budget, neither measured on real notes; one model (gpt-oss-120b) was measured — other connections are unmeasured.

## 3. Conditions of the exception (all already built and tested, §15)

1. **Mandatory review** — the AI's reading is evidence on a record; it never confirms, dismisses or closes one. A rule-found record the AI reads as compatible stays listed ("your call").
2. **No automated editing** — the check never writes a card; fixes go only through the normal review, by the user.
3. **Explicit opt-in** — off for every device until the user ticks "Use AI to check possible conflicts"; each check is started by hand ("Check with AI", ≤ 10 pairs).
4. **Misses disclosed** — the opt-in text says "It can miss conflicts"; the pilot notes must state strict recall 77.5% and what kinds are missed (exceptions/subgroups; time overlaps shown only as possible).
5. **Observable states** — the panel shows per pair: not checked yet (with why it waits), checked and shown, checked and read as compatible, failed, gave up; today's budget; the backlog (pairs, checks, days, oldest age). "Not yet checked" is never presented as "checked compatible".
6. **Easy off switch** — the device switch (one click, immediate); the operator switches `CONSISTENCY_AI_CHECK` (server, route answers 404) and `NEXT_PUBLIC_CONSISTENCY_AI_CHECK` (UI). Default off everywhere.
7. **Bounded spend** — one direct request per check (no retries, no fallback), 2,800-token per-call ceiling, 90,000 tokens / 50 checks per device per day.

## 4. Bounded rollout (proposal)

- Who: named pilot users only, on API-key chat-completions connections (gpt-oss-120b recommended — the measured model).
- How long: until Phase 2's guard fix is measured on a fresh sealed set (unseen6), or 4 weeks, whichever first.
- Stop conditions: any automated write or status change by the AI (none possible by construction — would be a bug); a confirmed context false-positive rate above 10% in pilot feedback; any request without a cap or with more than one provider request.
- Feedback: pilot users' confirm/dismiss decisions on AI-raised records are the pilot's precision signal (read locally, shared only by the user).

## 5. Decision requested

Approve / reject / amend: the limited pilot exception under §3–4. Approval would reach milestone **"Phase 1 limited pilot ready"**; without it, Phase 1 closes at **"Phase 1 engineering complete"** with the check shipped off.
