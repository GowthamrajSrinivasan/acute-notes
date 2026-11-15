# OpenUI Notes — live run, 2026-11-13

Approved by the user in chat (2026-11-13): "go ahead with all the open steps" — the live Generate-from-source run,
Pin to canvas in the browser, and the Phase 1 cost benchmark. Part of [openui-integration-plan.md](./openui-integration-plan.md).

- **Spec:** `e2e/ai/openuiNotes.spec.ts` (refuses without `OPENUI_NOTES_APPROVED_BY`; spending cap `RUN_CAP_USD`).
- **Model:** OpenRouter `google/gemini-2.5-flash` (the chat-import benchmark model), Visualize in **distil** mode.
- **Sources:** golden cases kn-01 (1,095 chars) and kn-02 (8,133 chars).
- **Raw evidence:** `test-results/openui-notes-2026-11-13/` (`report.json`, the replies of both paths, screenshots). The
  failed attempts are in `-run1` … `-run4`.
- **Cost:** OpenRouter usage went from $8.4583 to $8.5674, so about **$0.11 billed for all five attempts**. The balance can
  lag by minutes.

## Result: all three steps work live

| Step | kn-01 | kn-02 |
|---|---|---|
| A. Visualize (distil), accepted | 6 calls, 2 cited cards | 34 calls, 34 cited cards |
| B. Generate from source (OpenUI), streamed | 1 call, 5 IdeaCards, all pinnable, cards appeared one by one (0→5) | 1 call, 14 IdeaCards, all pinnable, streamed 0→14 |
| C. Pin to canvas | 1 new card: source v1, cites u1–u2, `excludeFromReconciliation`, distil; one undo removes it | same, cites 7 units |

## Phase 1 benchmark (A vs B, kn-02)

Path A's tokens are provider-reported. Path B is streamed, and the runtime records no usage for streams (`runtime.ts`). B's
tokens are therefore **estimated** from its characters, at the chars-per-token ratio path A measured on the same run
(input ≈2.1, output ≈3.5).

| | Today (distil Visualize) | OpenUI Lang |
|---|---|---|
| Calls | 34 (outline 1, plan 15, meaning check 17, revisions 1) | 1 |
| Input tokens | 113,155 | ≈7,000 |
| Output tokens | 13,225 | ≈1,900 |
| Cost (list price, $0.30/$2.50 per M) | $0.067 | ≈$0.0069 |
| Model time (sum of calls) | ≈178 s | 10.8 s |
| Cards | 34 | 14 |
| Cost per card | ≈$0.0020 | ≈$0.0005 |
| Output tokens per card | ≈389 (plan calls: 11,841 / 34 ≈ 348) | ≈137 |

**Read this carefully — it is not the same work:**
- Path A also lays the canvas out (frames, sections) and runs the fidelity model check on every card (`check_card_meaning`:
  17 calls, about a quarter of A's cost). Path B does neither: its cards are **not checked against the source** by the
  meaning checker.
- B makes fewer, coarser cards: 14 against 34, though B's 14 cite 62 units.
- B's tokens are estimates.

What the numbers do support: emitting cards as OpenUI Lang in one call is roughly **10× cheaper and 16× faster** than
today's distil pipeline for a reading view of the same source, and its output is about **60% fewer tokens per card**.
That is the Phase 1 hypothesis ("Lang streams fewer tokens than JSON"). What they don't support: replacing Visualize. The
cards would need the meaning check and a layout to be comparable. A fair like-for-like A/B would run
`check_card_meaning` on B's cards too: one more approved run of about $0.02.

## Found and fixed during the run

1. **The model wrote named arguments** (`IdeaCard(title="…", body="…")`). Every value landed in the wrong slot, no card had
   a root, and nothing rendered.
   - Fixed in two places. `ai/openui/positional.ts` rewrites named-argument calls into positional ones by the library's
     prop order; the actual reply is a test fixture. The prompt now says arguments are positional, with an example.
   - After the prompt change the model wrote 0 named arguments; the rewrite stays as a safety net.
2. **Generated cards vanished when the view remounted.** Another session's edits hot-reloaded the canvas mid-run. Generated
   cards now live in a per-canvas store (`components/openui/notes/generationStore.ts`), so they also survive closing and
   reopening Notes.
3. **Spec bugs** (not app bugs) that cost three attempts:
   - A `textContent()` on an absent alert waited out the 15-minute test timeout.
   - React drops `aria-busy={false}`; the view now sets an explicit `data-status`.

## Step 1: source fidelity, offline ($0, 2026-11-13)

`evaluation/knowledge-notes/experiments/openui-2026-11-13/openuiFidelity.test.ts` (report: `report.json` beside it).
- **Inputs.** The live OpenUI replies, saved verbatim, against the same model's distil Visualize recording of the same
  sources (`recordings/2026-10-20-distil-gemini-flash-od5b`).
- **Scoring.** Both paths are scored by the golden evaluator (the cases' reviewed assertions) and by the pipeline's own
  deterministic checks (`inspectSection`). **No model check on either side.**
- **Caveat on A.** A is a 3-week-older recording made with the prompts of that time; B is from today.

| | kn-01 distil | kn-01 OpenUI | kn-02 distil | kn-02 OpenUI |
|---|---|---|---|---|
| Cards | 4 | 5 | 60 | 14 |
| Gate 1 (knowledge): critical assertions failed | 0 | 3 | 9 | 7 |
| Source units represented | 9/9 | 5/9 | 55/64 | 31/64 |
| Units Needs review | 0 | 4 | 8 | 33 |
| Cards Needs review | 0 | 3 | 1 | 12 of 14 |
| Protected details missing (numbers, ids, paths) | 0 | 4 | 0 | 48 |

**What OpenUI loses is specifics and qualifications.** The flags show it directly:
- "300 seconds", "60 seconds", "1,000", `max-age`, `story/417` and the example key `7f3c-91ab` are missing.
- Conditions are dropped: "only when the request has already completed", "a reused key with a different amount is
  rejected", "only while the origin is returning errors".
- On kn-01, 3 of 5 cards would be Needs review. On kn-02, 12 of 14 would.

The prose reads well, which makes the loss easy to miss.

**What it gets right:** OpenUI covers the main ideas, and on kn-02 it passed four assertions distil failed (takeaway,
purge-eventual, cites). Distil's advantage comes from the work it pays for: protected items in the prompt, one retry with
the missing details, and "From the source" restoration.

**Conclusions:**
1. The ~10× cost advantage measured above is largely the cost of fidelity work OpenUI skips. It's not a free win.
2. The paid model check isn't needed to decide: the free deterministic checks already find the problem, mechanically,
   with evidence. Run them on generated cards in the view at no cost.
3. The cheap fix to try next is in the prompt: give OpenUI the same protected items (`protectedItemsOf`) and conditions
   distil is given. Then re-measure with one ~$0.01 live run, scored by this same experiment.

## Steps 1–2 built (offline, $0, 2026-11-13)

- **Free check in the Notes view.** New `src/ai/openui/notesCheck.ts` (`checkGeneratedCards`, the pipeline's `inspectSection`
  on the generated cards) runs as soon as a generation finishes.
  - The section shows a summary: "N of M cards need review · K of U passages covered · D exact details missing".
  - It says plainly that a card passing the rules isn't proven correct.
  - Each flagged card shows its reasons, and its pin button reads **Pin (needs review)**.
  - Pinning carries the review onto the card (`knowledge.cards[…].review`), so a flagged card lands in the existing review
    queue.
  - On the live kn-02 reply it reproduces the experiment exactly: 12 of 14 cards, 48 details (`notesCheck.test.ts`).
- **Prompt with what must be kept.** `annotateUnits` (`protectedItemsOf` exact tier, `criticalReasonsOf`) marks each unit
  line `⟨condition⟩` and/or `⟨keep exactly: "300 seconds", …⟩`. The rules mirror distil's `DISTIL_RULE` (conditions on the
  same card, details character for character, every non-filler unit cited). On kn-02, 27 of 64 units carry details to
  keep and 22 carry conditions.
- **Not yet measured:** whether the prompt closes the gap. That needs one live run (~$0.01, `e2e/ai/openuiNotes.spec.ts`,
  which now records the check's summary), scored by the experiment above.

## Step 3: live re-measure with the new prompt (2026-11-13, approved)

`e2e/ai/openuiNotes.spec.ts`, gemini-2.5-flash, the same sources. Pin and undo passed on both cases. The new replies are
saved as `*.openui-v2.txt` and scored by the same experiment.

| | distil (Oct rec.) | OpenUI v1 | OpenUI v2 |
|---|---|---|---|
| kn-01 cards | 4 | 5 | 9 |
| kn-01 passages represented | 9/9 | 5/9 | 8/9 |
| kn-01 exact details missing | 0 | 4 | 0 |
| kn-01 critical assertions failed | 0 | 3 | 3 |
| kn-02 cards | 60 | 14 | 48 |
| kn-02 cards Needs review (rule check) | 1 | 12 | 16 (33%) |
| kn-02 passages represented | 55/64 | 31/64 | 43/64 |
| kn-02 exact details missing | 0 | 48 | 16 |
| kn-02 critical assertions failed | 9 | 7 | 7 |
| OpenUI call cost (est.) | — | $0.007 | $0.012 |

**Read:**
- The prompt fixed coverage and exact details.
- It didn't fix **conditions staying with their claim**. "Keys expire after 24 hours" and "a reused key with a different
  amount is rejected" still land on separate cards, so kn-01 still fails 3 critical assertions that distil passes.
- **The rule check underestimates.** It flags 1 kn-01 card where the golden assertions find 3 critical failures. That's
  why the view says a card that passes "isn't proven correct". Pinning stays review-gated, not trusted.
- Still roughly 5× cheaper than distil Visualize ($0.012 vs $0.067 on kn-02), with no layout.

**Next options:**
1. A cheap targeted fix: an annotation pairing each `⟨condition⟩` unit with the claim it limits, so the model writes them
   on one card. Re-measure with ~$0.01.
2. The ~$0.02 model meaning check on flagged and conditional cards only.

## Step 4: meaning-check diagnosis (prepared; the run was blocked by the permission system)

Approved by the user (≤ $0.02, on the saved outputs). Built as
`src/ai/contractTests/openuiMeaningDiag.contract.test.ts`, contract suite only. It refuses without
`OPENUI_MEANING_APPROVED_BY`, caps the spend, and writes `experiments/openui-2026-11-13/meaning-check-2026-11-13.json`.
The run itself was denied by Claude Code's permission system in this session, so it is **not run**.

**Design.** 24 v2 cards, hand-labelled against the source. The labels are provisional: 7 problems, 17 clean. They cover
all four failure kinds the user asked about (condition separated, caveat missing, fact missing, unsupported wording) and
include rule false positives and false negatives. Two variants:
- **A, as shipped:** the card against its cited units only.
- **B:** adds the section's other condition-bearing units as CONTEXT, plus one rule.

**Structural finding before any model call.** The shipped check judges a card only against the units it cites. A
condition living in an *uncited* unit is invisible to it. kn-01's g2 states "the server returns the stored result"
unconditionally, and against u2 alone that's true. So variant A can't catch category 1 by construction; B tests whether
giving context does.

**The rules against the labels** (computed offline): of the 6 cards they flag, 2 are real problems and 4 are false
alarms (the card keeps the caveat in other words). They miss 5 of the 7 problems.

On kn-02, 9 of the 16 rule-flagged v2 cards are flagged only because the model **omitted the citation**. That's a
citation-format failure, not a meaning failure; a prompt or format fix should address it separately.

To run: `OPENUI_MEANING_APPROVED_BY="<name>" ACUTE_TEST_OPENROUTER_MODEL=google/gemini-2.5-flash npx vitest run --config vitest.contract.config.ts src/ai/contractTests/openuiMeaningDiag.contract.test.ts`

### Step 4 result (run once in the terminal, user-approved, 2026-11-13)

- **Cost.** $0.0054 measured (A $0.0024, B $0.0029), with pre-call estimates of $0.0052 and $0.0064 and a cap of $0.02.
  Nothing was rerun.
- **Model.** gemini-2.5-flash, temperature 0.
- **Report.** `evaluation/knowledge-notes/experiments/openui-2026-11-13/meaning-check-2026-11-13.json`.
- **Labels are provisional and hand-made, not independently validated.**

| | Rules | A: cited only | B: plus section conditions |
|---|---|---|---|
| TP / FN / FP / TN (problem = 7, clean = 17) | 2 / 5 / 4 / 13 | 0 / 7 / 0 / 17 | 0 / 7 / 0 / 17 |
| Omission (caveat or fact missing), of 4 | 2 | 0 | 0 |
| Separated condition, of 3 | 1 | 0 | 0 |
| Unsupported assertion, of 2 | 0 | 0 | 0 |
| Distortion | none in sample | — | — |
| Tokens in / out | — | 4,082 / 479 | 5,788 / 479 |
| Latency | — | 5.1 s | 36.3 s |
| Unparsed or missing answers | — | 0 | 0 |

**Every card was judged "supported" in both variants.** Adding the section's conditions changed no verdict, and flagged
no valid card either.

What this indicates (one run, n = 24, provisional labels):
- The remaining critical failures are **not** explained by the check lacking condition context. With the condition in
  view, it still accepts the card.
- The check's question ("would a reader come away believing something the source does not say", and "leaving out a
  detail is fine") detects distortions, not omissions or separated conditions.
- The other explanation is that the labels are too strict. The golden dataset's reviewed critical assertions support the
  main ones, but the 24-card labels haven't been reviewed.

**Not changed (deferred by the user):** the generation prompt and the review gates.

**Next design question, for the user to decide:**
- Detection needs **claim-condition linkage**: which claim each condition limits.
- Validation then checks that the card stating the claim carries its limit. That's structural, on citations, not a model
  judgment.
- Track citation completeness as a separate metric (provenance), apart from semantic defects.
