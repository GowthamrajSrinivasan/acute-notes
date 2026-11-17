# Stage 4f — limited pilot gate exception

Date: 2026-11-16 (amended 2026-11-17) · Status: **APPROVED 2026-11-17 — limited pilot, strict recall deferred to Phase 2**, after an independent review (APPROVE WITH CONDITIONS; plan §16). Committed defaults stay off; the pilot is switched on per pilot machine only (§6).
Context: intelligent-update-engine-plan §12.33 (unseen5 recording; strict-recall gate FAILED), §16.2 (unseen5 diagnosis), §14 (Phase 1 close-out decision), §15 (integration evidence), §16 (review and decision). Pilot notes: `stage4f-pilot-notes-2026-11-17.md`.

## 1. What is asked

A **limited Phase 1 pilot exception** to the Stage 4f semantic gate: allow the AI consistency check to be switched on for opted-in pilot users, review-only, while strict recall stays below the original 85% gate. It does not ask for the gate to change for general release: **strict recall ≥ 85% remains the release gate** (Phase 2).

## 2. Evidence (unseen5, recorded 2026-11-15, development evidence since 2026-11-16)

Figures recomputed independently on 2026-11-17 from the recorded files through the current app code; all match.

| Measure | Original gate | Pilot threshold | unseen5 result | Meets pilot? |
|---|---|---|---|---|
| Recall (conflict, likely or possible shown) | — | ≥ 85% | **90.0%** (36/40); 87.5% (35/40) within one day's budget (y24 waits) | Yes |
| Strict recall (conflict or likely) | ≥ 85% | disclosed limitation, no threshold | **77.5%** (31/40) | Not required (disclosed) |
| Precision of conflict/likely calls | — | ≥ 90% | **100%** (31/31); **93.9%** (31/33) counting the two ambiguous pairs y20/y45 as wrong | Yes |
| Compatible pairs shown as conflict/likely ("context false positives" in this proposal) | — | ≤ 10% | **0%** (0/45; also 0/45 shown as "possible") | Yes |

**Definition:** "context false positives" here means compatible pairs (all 45) shown as conflict or likely. The original gate and the frozen scorer use the context-category pairs only (0/10 on unseen5). Both are 0%. **The pilot thresholds were set after the unseen5 results were known**; they are a pilot bar, not a pre-registered gate.

What the 9 strict-recall misses are (§16.2): **4 model misses**, not shown at all — y31, y61, y86 read as an exception, subgroup or narrower scope; y12 a numeric-cap misread ("28 max" read as within "cap 30"). **5 guard downgrades** — y05, y24, y49, y65, y83: the AI answered "contradicts", and the date-context guard held them at "possible". They are **shown** to the user, labelled "AI reads a conflict, held back for you to judge". The guard fix is Phase 2, never tuned on unseen5.

Live-path evidence (§15): the discovery the canvas uses follows the evaluated screen route. With the rules alone the live canvas would have surfaced 3/40 contradictions; with the integrated route it matches the pipeline's 36/40 on the recorded answers (offline, `liveDiscovery.probe.test.ts`). One live call through the integrated app path (2026-11-16): 1 request, 1,055 tokens, ≤ $0.0002, both pairs answered and recorded review-only.

**Caveats:**
- unseen5 is now development evidence (it informed the diagnosis), not a fresh generalisation measure.
- Only one model (gpt-oss-120b) was measured.
- **Scope:** only accepted change sets are checked. Manual edits, the content already on a canvas at opt-in time, and pairs between two older cards are never queued.
- Real canvases add retrieval limits (top-20 cards per claim) and the 10-pairs-per-press budget, neither measured on real notes.

## 3. Conditions of the exception (built and tested, §15–16)

1. **Mandatory review** — the AI's reading is evidence on a record; it never confirms, dismisses or closes one. A rule-found record the AI reads as compatible stays listed ("your call"). Confirmed, deferred and dismissed records keep their status whatever the AI says (tested).
2. **No automated editing** — the check never writes a card; fixes go only through the normal review, by the user.
3. **Explicit opt-in** — off for every device until the user ticks "Use AI to check possible conflicts"; each check is started by hand ("Check with AI", ≤ 10 pairs).
4. **Misses disclosed** — the opt-in text says "It can miss conflicts"; the pilot notes state strict recall 77.5% (87.5% within the day's budget for all shown), the miss classes, the scope limits and the single measured model.
5. **Observable states** — per pair: not checked yet (with why it waits), checked and shown, checked and read as compatible, failed, gave up. Also: today's budget; the backlog (pairs, checks, days, oldest age); pairs dropped because the queue was full (200); and the pilot feedback counts. "Not yet checked" is never presented as "checked compatible".
6. **Easy off switch** — the device switch (one click, immediate). The operator switches are `CONSISTENCY_AI_CHECK` (server; the route answers 404, and a check asks first, so an off server costs no budget) and `NEXT_PUBLIC_CONSISTENCY_AI_CHECK` (UI, rebuild). Both are off by default everywhere, and the route also refuses on a public deployment (`ACUTE_HTTP_EXPOSURE=public`).
7. **Bounded spend** — one direct request per check (no retries, no fallback), a 2,800-token per-call reservation, 90,000 tokens / 50 checks per device per day. The server additionally caps output at 1,300 tokens and the prompt at 8,000 characters.

## 4. Bounded rollout

- **Who:** named pilot users only, on local or desktop builds, with gpt-oss-120b as the primary API-key chat-completions connection (recorded per user). The panel warns when another model is used, and other models are outside the pilot.
- **How long:** until Phase 2's guard fix is measured on a fresh sealed set (unseen6), or 4 weeks, whichever comes first.
- **Stop conditions:**
  - any automated write or status change by the AI (none possible by construction; it would be a bug);
  - AI false positives above 10%: dismissed "likely" records / decided "likely" records, over at least 10 decided;
  - any request without a cap or with more than one provider request.
- **Feedback:** each pilot user reports the panel's "Pilot feedback" line weekly (AI "likely" and "possible" records: confirmed / dismissed / open). The figures stay on the device until the user reports them.

## 5. Decision

**Approved (product owner, 2026-11-17), on the independent review's APPROVE WITH CONDITIONS.** Strict recall is deferred to Phase 2 and stays the release gate. Must-fix items D1, D2 and D4 are done, and D5 is disclosed (plan §16.1). Milestone reached: **"Phase 1 limited pilot ready"**.

## 6. Switching it on (pilot machines only)

The committed `.env.development` and `.env.production` keep both switches `off`. On a pilot user's machine, add to the git-ignored `.env.development.local` (or set in the shell):

```
CONSISTENCY_AI_CHECK=on
NEXT_PUBLIC_CONSISTENCY_AI_CHECK=on
```

Then restart the dev server, make gpt-oss-120b (for example AICredits `openai/gpt-oss-120b`) the primary connection, open the Consistency chip, and tick the opt-in. Never set these on App Hosting or with `ACUTE_HTTP_EXPOSURE=public`; the route refuses there anyway.
