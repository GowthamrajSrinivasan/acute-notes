# Chat-share import — live runs, 2026-10-09

Spec: `e2e/ai/chatShare.spec.ts` (three real ChatGPT share links: chat → branch → branch of branch). OpenRouter, Jev
(`typesafe/jev-1.13`) as the typed decision model, `google/gemini-2.5-flash` as the chat model (also tried
`openai/gpt-oss-120b`). Per-call evidence is written by `STATS_FILE=<path>` (one JSON line per call, plus live
start/end lines). Cost: about $0.45 per full run (about $2.12 spent in total, including failed attempts).

## Results

| Run | Model | Outcome |
|---|---|---|
| gpt-oss-120b, several | slow reasoning model | First chat: one run reached >500 changes → refused (fixed by section parts); others slow (outline 53 s, a section call 504 after ~2 min), not finished in 7–15 min. Then the key ran out of credit (402). |
| A (funded) | gemini-2.5-flash | Steps 1–3 pass. Only the soft check "Jev answered ≥ 1 merge question" failed (0 answers). |
| 1 | gemini-2.5-flash | **Hung in step 1's visualize (no review in 15 min, no log output)**. No per-call evidence was being written yet, so the cause is unknown. |
| 2 | gemini-2.5-flash | Steps 1–3 pass (Jev 0 merge answers). |
| 3 | gemini-2.5-flash | Steps 1–3 complete (stopped by the user after the merge review); live timings below. |

## Large result (the 500-change limit)

First chat (24k characters): 21 sections, 317–343 objects, 195–256 connections (more than 500 changes in all), split into section parts, reviewed and accepted; 20 frames on the canvas.

## Merge of all three links into the first chat's notes (run 3)

- 135 model calls in 266 s for steps 2 and 3 together, 0 failures. Calls: 8 Jev decisions (all in the first chat, avg 0.9 s), 2 outlines (avg 19 s, max 24 s), 76 section plans (avg 10 s, **max 64 s**), 48 section analyses (avg 6 s), **1 `assign_to_topics` (22.5 s)**.
- `assign_to_topics` in run 2: prompt 85,607 characters, reply 16,508 characters. The task's limit is 120 s; with Gemini it took 22.5 s, so a timeout there is plausible only for a slow model (the earlier "took too long" merge ran on gpt-oss-120b; its assignment call was not captured, so that is **not proven**).
- Merge outcome (run 2): added to 17 existing topics; 754 passages already in the notes left out (38 under another topic); one "Needs your call" box ("MVP build time"); review +25 new, ~20 updated, 19 links changed; nothing removed. Run 3: 9 topics, 758 left out, +34 new, ~24 updated.
- Jev answered **0** questions in the merge in every run: the part count is over `ASSIGN_MAX_PARTS` (30), so the chat prompt carries every part.

## Cost finding

About 130 calls (74–76 section plans + 48–54 analysis cards) produced about 25–34 new objects and 20–24 updates. A grown section is regenerated whole, with its analysis cards. See the efficiency note sent to the topic-merge session.

## Still open

- The hang (run 1, and the gpt-oss runs): per-call logging now exists (`STATS_FILE`, live start/end/failed lines); it needs one occurrence to read.
- The merge assignment at scale on a slow model: batching is the topic-merge session's to do.

## Cost baseline ("before") — measured with `scripts/ai-stats-summary.mjs`

`node scripts/ai-stats-summary.mjs <stats.jsonl>`: per-stage calls, failures, estimated tokens (characters / 4) and cost
(gemini-2.5-flash list prices, $0.30 / $2.50 per million in / out). Judge a change by tokens and cost, not call count.

Run 2 (all three links; first chat → notes, then merge of all three):

| Stage | Calls | Tokens in | Tokens out | Est. cost |
|---|---|---|---|---|
| first chat · Jev decisions | 8 | 3.1k | 0.4k | $0.002 |
| first chat · outline | 1 | 7.2k | 2.7k | $0.009 |
| first chat · section plans | 32 | 60.2k | 22.0k | $0.073 |
| first chat · analysis cards | 29 | 21.6k | 12.1k | $0.037 |
| merge · assignment | 1 | 21.4k | 4.1k | $0.017 |
| merge · outline (new topics) | 1 | 10.2k | 2.6k | $0.010 |
| merge · section plans | 74 | 148.5k | 80.8k | $0.247 |
| merge · analysis cards | 54 | 48.9k | 25.4k | $0.078 |
| **Total** | **200** | **321k** | **150k** | **$0.471** (billed about $0.45) |

Merge alone: 130 calls, 229k in, 113k out, $0.352, for a review of +25 new / ~20 updated / 19 links changed
(run 3: 81 calls, 138k in, 99k out, $0.29 for +34 new / ~24 updated, over a partial capture). The "after" figure is one
instrumented live run once the merge changes are ready (owned by the topic-merge session); not run yet, by decision.

## "After" run — 2026-10-09 (topic-merge changes: assignment batching, appended-section mode)

Same workload, same model (gemini-2.5-flash), Jev on. One run, billed from the OpenRouter `/credits` delta (start 2.1246 →
end 2.8830; 2.9168 shortly after, so about $0.03 of unrelated usage may sit in the window).

| | Before (run 2) | After |
|---|---|---|
| Billed, whole run | about $0.45 (estimate $0.47) | **$0.758** |
| Billed, first chat | about $0.10 (estimate) | $0.144 |
| Billed, merge step | about $0.35 (estimate) | **$0.615** |
| Model calls (all) | 200 | 432 (237 of them Jev decisions in the merge) |
| Merge: plans / analysis / outline | 74 / 54 / 1 | 81 / 50 / 1 |
| Merge: assignment | 1 chat call, 21k tokens in | 12 Jev batches = **237 decide calls, about 1.84M tokens in** (about 31k characters each, 11 s average) |
| Merge result | 17 topics extended, +25 new, ~20 updated | 36 topics extended, **125 new topics**, +66 new, ~2 updated; 676 passages left out |

Merge counters (`diagnostics.calls`): `plans` = appended 0, regenerated 0, piece 7, **new 74**; `sectionsReused` 0;
`partsSkippedBeforeAI` 128; `choicesOpened` 0.

Findings:
- **The cost target (at least 40% lower) was not met: about 68% higher.** The merge step got more expensive, not cheaper.
- **The savings never fired.** Every merge section plan was a new-topic or piece plan; appended mode had nothing to act on. Jev's typed assignment filed far more parts as new topics (125 new vs a handful with the chat model), so the work moved to the expensive first-run path.
- **The workload is no longer comparable**: different filing decisions (+66 new / ~2 updated against +25 / ~20), so this is a change in behaviour, not only in cost. Whether Jev's filing is better or worse is a quality question the numbers don't answer.
- **Jev's calls are many and large**: 237 calls, about 7.8k tokens each, 1.84M tokens in all (billed at Jev's much lower input price, but a large call volume and call-seconds: 2,720 for the decide calls).
- Hard checks passed: the source went to version 2, nothing removed, the first chat's opening kept once, the last branch's own turn arrived. Only the soft check "the chat task `assign_to_topics` was called" failed, because Jev answers through the decision path now (the spec's expectation is out of date).

## Offline replay of the three-chat merge's assignment (2026-10-10, no model calls)

Rebuilt from the real shares (free fetch): the notes = chat 1 as Visualize composed it (24,075 characters); the incoming
text = all three chats with branch-skip (100,408 characters); the merge's own functions (`analysisUnits`, `composeMerged`,
`assignToTopicsDecision.buildRequest`). It reproduces the live run: **237 typed requests, about 1,831k tokens in
(measured live: 237 calls, about 1,842k)**, so its numbers can be trusted.

- 95 topics (text median 123 characters, 23.7k in all). 365 incoming parts: 128 left out as repeats before any model call,
  **237 to assign**; their median is 121 characters, 128 are under 150 characters, 184 under 400.
- **77% of the Jev input is the topic list repeated**: every part is its own request with `state.topics` (5.6M of 7.3M
  characters).
- Word coverage of each part by its best-matching topic: 15 at 0.8 or more, 26 at 0.6–0.8, 31 at 0.4–0.6, **117 at 0.2–0.4, 48
  below 0.2**. Most of the incoming content is about things the notes (chat 1) don't cover (block runtime, encapsulation,
  tests, forking, UX, roadmap), so a high new-topic count is plausible. **But the unit of decision is a leaf heading**
  ("Phase 4", "Long term", "4. Interaction tests"), and a leaf's own parent heading (104 parents for the 237 parts, 52 of them
  single) is not used.
- **What can't be established:** Jev's actual per-part answers were not recorded, so which of the 125 "new" are missed
  matches is unknown. Recording them is cheap (see the follow-up).
- Shared-topics request shapes (one request holding several parts, topic list sent once): 237 requests 1,827k tokens →
  5 parts per request 707k, 10 per request 564k, **20 per request 493k (−73%)**. Whether the decision API accepts that many
  questions in one request is not known (live check).
- Saved output: `merge-replay-2026-10-10.txt` (per-part best coverage list).

## Jev-only replay of the assignment questions (2026-10-10, approved, cap $0.08, no chat model)

Same 95 topics and 237 parts as the offline replay; Jev `typesafe/jev-1.13` called directly through the app's own wire code.
**Billed: about $0.035** (account usage 2.9168 → 2.9519 once the balance settled; an immediate read showed only $0.0033 because
the OpenRouter credits balance lags by minutes — see the correction below), for about 0.76M input tokens: Jev costs
**about $0.042 per million input tokens**. Answers are saved (`jev-replay-answers-2026-10-10.json`,
per part: parent and leaf heading, chosen topic, confidence, new or existing, nothing-new probability, local overlap).

- **Tokens per request (actual):** the production per-part request is about 30.6k characters = **about 10.1k input tokens
  (3 characters per token)**, so the 237 live requests were about 2.4M tokens (not 1.8M).
- **Batching works up to 20 parts / 60 questions in one request**: 5 parts 18.9k tokens, 10 parts 29.4k, 20 parts 50.6k, all
  60 questions answered. All 237 parts took 12 requests and **734k input tokens (−69%)**.
- **But batched answers are not equivalent to the per-part ones**: on 10 sampled parts only **4 chose the same topic** (the
  other six chose a different topic, or "new" for one).
- **Confidence is low in the batched shape**: the topic answer's confidence was below 0.5 for **168 of 237 parts** (median
  0.38, max 0.87). Production ignores an answer below 0.5 (`ASSIGN_MIN_CONFIDENCE`) and keeps the local answer, which files
  **212 of 237 parts as new topics**. So, in this shape, most parts would end up new because Jev was unsure, not because Jev said new.
  Jev itself said "new" for only 7 parts (1 of them with confidence ≥ 0.5) and filed 230 into existing topics.
- **Length and parents:** no pattern by length (Jev "new": 2 of 73 under 60 characters, 0 of 53 at 400+). The 52 parents with
  two or more parts: no mixed new/existing answers (but "new" was rare).
- **Not measured:** the confidence distribution of the **per-part (production) shape**, which is what ran live and gave "125
  new topics". If it is also low, part of that 125 is the local fallback, not Jev's decision.

## CORRECTION (2026-10-10): the credits balance lags, and Jev is not cheap enough to ignore

- The OpenRouter `/credits` usage is **not live: it lags by a few minutes**. My reading of $0.0033 right after the batched
  replay was wrong; the settled figure was $0.0351, which equals the estimate at **Jev's $0.042 per million input tokens**
  (0.76M tokens). So the earlier statement "Jev costs about $0.0045 per million; the live merge's 237 Jev requests were
  about $0.01; Jev is not the cost lever" is **wrong**. At $0.042/M, the live merge's 237 requests (about 10.1k tokens each,
  about 2.4M tokens) cost **about $0.10 of the $0.615 merge bill**. The topic-merge session's estimate (about $0.20) was too
  high, but Jev's repeated topic list is a real, measurable part of the cost: batching (−69% tokens) would save about $0.07,
  if the answers could be trusted (they differ, see above).
- The same lag affected the cap checks of the per-part replay (below), which therefore ran past its $0.02 cap.

## Per-part Jev replay (2026-10-10, approved, cap $0.02) — INVALID, and over its cap

- The harness looked up `p1_topic` for every request, but production numbers the parts `p1…p20` within each batch of 20, so
  70 of the 74 answers were read from the wrong key and recorded as "no answer". **None of its results can be used**
  (confidence, new/existing counts and the comparison with the batched replay are artefacts).
- **Spend: about $0.0315** (account usage 2.9519 → 2.9833 once settled; 74 requests, 749k input tokens at $0.042/M), against a
  cap of $0.02. The cap check read the lagging balance and used a wrong per-token price, so it did not stop in time.
- To redo it at the cap: at $0.042/M a per-part request costs about $0.00042, so $0.02 buys about 45 requests (a sample of the
  237 parts), not all of them; all 237 would cost about $0.10.

## Per-part Jev replay, 32-part sample (2026-10-10, approved, cap $0.02, no chat model) — valid

Fixed harness: the exact production per-part requests (batches of 20, answers read as `p{n+1}_topic` within each batch), a stratified
sample (4 length bins × likely-existing / likely-new by local word coverage, spread over different parents) of **32 parts** (fewer
than 40: some strata were small), and a hard ceiling enforced from a token estimate at Jev's price ($0.042 per million input
tokens), not from the lagging balance. **Spend: $0.0137** estimated; the settled balance moved by $0.01365 (2.9833 → 2.9970).
Each request was about **10,158 input tokens** (about $0.00043). Answers saved in `jev-sample-answers-2026-10-10.json`.

| | Result (32 parts) |
|---|---|
| Topic answered | 32 of 32 |
| Confidence | median **0.56**, min 0.12, max 0.89; **21 of 32 at 0.5 or more** (production accepts), **11 below** (production keeps the local answer) |
| Jev's own answers, any confidence | **new 3**, existing 29 |
| Production path | jev-existing 19, **jev-new 2**, **fallback-new 9**, fallback-existing 2 |
| By length | under 60 characters: median 0.44, 4 of 10 accepted; 60–150: median 0.71, 9 of 10; 150–400: 0.54, 4 of 6; 400+: 0.65, 4 of 6 |
| Of the 11 fallbacks | 6 are under 60 characters (e.g. "Apps", "1. Data", "Free") |
| Agreement with the batched replay | same topic on 20 of 32 (62%) |

What it shows (diagnostic, not a verdict; the sample is stratified, not random):
- **Jev itself rarely says "new"** (3 of 32, 1 below 0.5), even in the stratum where local word overlap is low (3 of 20).
- **Most "new" outcomes in production come from the low-confidence fallback**: 9 of the 11 new outcomes here are fallback, 2 are
  Jev's. The fallback is driven mostly by tiny fragments (under 60 characters) and by a few mid-sized parts Jev was unsure about.
- The fallback ("new unless the same heading or 60% of the words match") files unsure parts as new topics, so the live "125 new
  topics" probably includes many parts Jev would have put in an existing topic with moderate confidence.
- Whether Jev's existing-topic choices are *semantically right* is not established (confident ones look sensible, e.g.
  "Branch · AI App Builder Ecosystem" → "AI App Builder Ecosystem", "Glassmorphism Theme" → "Presentation blocks"). That needs
  reviewing the proposed matches against the canvas.

## Recommendations for the topic-merge session (from the chat-import session and its user, 2026-10-10)

Evidence above; no production change was made by the diagnostic session, no further live runs are authorised, and the next
benchmark waits for a specific, testable change to the assignment strategy with an estimated cost below the approved cap.

**Order of work** (fix the assignment unit before optimising the prompt):
1. **Parent-aware assignment.** Compare deciding a child fragment on its own against deciding it with its parent heading and
   relevant content. Do not blindly force every child into its parent's topic (a child can be genuinely different).
2. **Low-confidence outcomes.** A topic confidence below 0.5 (`ASSIGN_MIN_CONFIDENCE`) must not automatically mean "create a new
   topic": in the 32-part sample 9 of the 11 "new" outcomes were this fallback, mostly for fragments under 60 characters. Keep
   the uncertainty: use a contextual local match, a review choice, or a validated fallback.
3. **Candidate-topic shortlists.** Test whether a shortlist of the closest existing topics keeps agreement with the per-part
   answers and the assignment quality, before adopting it to shrink the prompt. Judge on confidence and agreement, not tokens.
4. **Repeated context.** Only once assignment behaviour is stable, reduce the repeated topic list (77% of Jev input; Jev is
   about $0.042 per million input tokens, so about $0.10 of the $0.615 merge). Keep the per-part decisions as the reference until
   batching is shown to preserve the answers (it agreed on 20 of 32 topics only).

**Design principle: a failed classification is not a new concept.** The assignment should have three outcomes, not two:
- *Existing topic*: a sufficiently supported match;
- *New topic*: evidence supports a genuinely distinct concept;
- *Uncertain*: not enough context to decide safely (typical for tiny fragments such as "Apps", "1. Data", "Free").
The third outcome stops uncertainty from silently becoming permanent canvas clutter (e.g. keep the fragment with its parent or
show it for review, instead of creating a topic).

## Zero-cost yardstick for assignment changes (added 2026-10-10)

`src/ai/merge/__fixtures__/jevSampleAnswers.json` holds Jev's 32 recorded per-part answers (topic, confidence, relation and
nothing-new probabilities, and what production did with each). `src/ai/merge/assignRealAnswers.test.ts` reads them through
today's `assignToTopicsDecision.interpret` and `validateAssignment` with no model call:
- *evidence* tests (do not change): 3 raw "new" answers, 11 "new" outcomes of which 9 are the low-confidence fallback, 21 answers
  at 0.5 or more, 6 of the 11 fallbacks under 60 characters;
- *characterisation* tests of today's behaviour: only answers at 0.5 or more are used, the rest go to the local answer which files
  9 of 11 as new topics. When the policy changes on purpose (an "uncertain" outcome kept with its parent, parent-aware context,
  a shortlist), update those expected numbers deliberately: the new numbers are the measured effect on real answers, for free.
A live Jev-only replay on the same 32 parts (about $0.015) is only needed to see how new context changes confidence.

## Implemented by the topic-merge session (2026-10-10, no model calls)

Recommendations 1 and 2 and the three-outcome design; 3 and 4 not started (they need the assignment to be stable first, as asked).

- **Three outcomes.** A typed topic answer below 0.5 (`ASSIGN_MIN_CONFIDENCE`) is now `unsure` (`assign.ts`, `UNSURE`), never left
  to the local "new unless it matches" answer. The chat task may answer `"unsure"` too ("never answer new just because you can't
  tell"). `validateAssignment` returns the unsure parts.
- **Kept with the section around it** (`merge/unsure.ts`, `settleUnsure`), first rule that applies, in document order: (1) where its
  parent part went (an existing topic, or into the parent's new topic); (2) where most of its confidently placed siblings went;
  (3) the local match, only when it found an existing topic; (4) into the new topic a sibling became, so a run of fragments
  under one heading is one topic, not one each; (5) else a topic of its own. A part joining another's new topic is written into
  that topic under its own bold label (`compose.ts`, `attach`). The review says how many passages AI couldn't place and how they
  were kept ("Check them in the review"); `report.unsure`, `report.keptWith`.
- **Parent-aware assignment.** Every part is asked with the headings it sits under in its own document: Jev's state carries
  `new_content_under`, the chat prompt `[p2] (under “Pricing tiers”)`. Context only: a child is still decided on its own content,
  never forced into its parent's topic.
- **Per-part answers recorded** (`__acuteDev.lastMerge().decisions`: the model's answer — a topic label, `new`, `unsure` or `local` —
  where the part was filed, and how an unsure one was settled), so the next run's filing can be judged part by part.
- **The recorded 32 answers** (`assignRealAnswers.test.ts`, updated deliberately): 21 placed, **11 unsure** (was: left to the local
  answer); settled: 2 by the local match, 9 alone. Every sampled part has a different parent, so this sample **cannot show rules
  1, 2 and 4** (the grouping); a sample of whole sibling groups would.
- **Not measured:** whether the parent context raises Jev's confidence (a Jev-only replay of the same 32 parts, about $0.015) and
  how many of the live run's 125 new topics become fewer, grouped topics (the full benchmark).

Also fixed on 2026-10-10 (from the "after" run's counters; see `chat-share-import-plan.md` §5 "Cost"): the update re-outlined the
whole notes when a topic grew past 12,000 characters, re-generated sections stored without a frame (more than 20), and capped an
update's plan at 60 objects. Those three caused the 30 chat-1 sections regenerated in the "after" run.

### Jev-only replay WITH the heading context (2026-10-10, approved, cap $0.02, OpenRouter `typesafe/jev-1.13`)

The same 32 sampled parts, sent as production now builds them (`buildRequest`, one part per request, `new_content_under` set for the
13 that have a parent heading). 31 answered; OpenRouter rate-limited the 32nd. Estimated $0.013 (about 316k input tokens). Log:
`jev-sample-context-2026-10-10.log`.

| | Recorded without context | With context |
|---|---|---|
| Topic confidence 0.5 or more (31 parts) | 20 | **20** |
| Median confidence (31) | 0.56 | 0.59 |
| Parts with a parent heading (13): at 0.5 or more / median | 8 / 0.57 | **8 / 0.50** |
| Same topic as the recorded answer | | 21 of 31 |

- **The heading context does not raise Jev's confidence**, overall or for the fragments it was meant for. It stays in the request
  (no harm seen; a few short parts moved to a more fitting topic, e.g. "… › Free" new → t53), but it is not the lever.
- **Jev's per-part answers vary a lot between runs** of the same request shape: 10 of 31 changed topic, and confidences moved by up
  to 0.5 (0.83 → 0.31). Small differences on 32 parts are within that noise; no filing rule should rest on one answer being stable.
- So the "unsure" outcome and keeping fragments with their section (rules 1–5) do the work, not the context.

## "After" run 2 — 2026-10-10 (topic-merge session; the 2026-10-10 fixes and the "unsure" outcome) — FAILED, over the cap

Same workload and models (gemini-2.5-flash, Jev on OpenRouter). Evidence: `stats-after2-2026-10-10.jsonl`.

- **Billed $0.899** (usage 3.0102 → 3.9093, read 14 minutes after the end): first chat $0.173, merge about $0.73. **Over the $0.45 cap**,
  and the merge **failed at the end** ("Something went wrong. Nothing was changed."): its change set was invalid — two "More from this
  section" pages got the same id. Cause: the 2026-10-10 overflow fix keys those pages by section, and an outlined section's key (its
  units joined) is hundreds of characters; the id was cut at 200 characters, which cut off the page number. **Fixed** (a long key is
  shortened with a hash; `visual-plan/foldOverflow.test.ts`). The run's model calls were all made before that point, so its counts hold.
- **The update fixes worked:** the first chat's sections were no longer generated as new — plans: **appended 8, regenerated 4**, piece 2,
  new 72 (run 1: appended 0, regenerated 0, new 74). 
- **But the merge still generated 72 new-section plans and 51 analysis calls**, because it still made many new topics. Per-part decisions
  (236): existing topic 104, Jev "new" 14, local 10, **unsure 108** — of those, kept with their parent 54, with siblings 6, local match
  1, **alone 47**. The 47 "alone" are top-level parts (an assistant answer's own `#`/`##` headings sit at the top level of the
  composed chat, so they have no parent or siblings to join).
- **Assignment calls did not change:** 237 decide calls, about 1.85M input tokens (one request per part, every topic in each).
- **Cost split not established:** the summary tool prices every row at Gemini's rates (decide $0.73 is wrong for Jev). Estimated
  plans + analysis + outline ≈ $0.37 and Jev at $0.042/M ≈ $0.08–0.10 leave about $0.25 of the billed merge unexplained (Gemini 2.5 Flash
  reasoning tokens are billed as output but not in the reply characters the tool counts — likely, not verified).

Not re-run, by decision of the user's cap. What would change the cost next: (a) top-level unsure parts kept with the part before them
in their own answer (they are that answer's continuation), (b) the shared topic list per batch (−69% Jev tokens, but answers differ),
(c) provider-reported usage per call in the evidence, so the bill can be split.

## Import layout experiment (2026-10-10, offline, no model calls)

The merge's units are two levels: a top-level section's own text, plus each direct subsection whole (`reconcile/units.ts`). So the
Markdown layout the import produces decides how fine the topics and parts are. The current layout (bold "You:" / "Assistant:"
labels, the assistant's own headings at the top level) makes every heading a separate part, including fragments such as "Free",
"Pro", "Phase 4". Measured on the real three chats (`compose-layout-experiment-2026-10-10.txt`):

| Layout | Topics (chat 1) | Parts to assign | Parts under 150 chars | Parts with no parent | Jev requests / input tokens / cost at $0.042 per M |
|---|---|---|---|---|---|
| A. current | 95 (15 tiny, 2 turn-label) | 237 | 128 | 88 top level | 237 / 2,451k / **$0.103** |
| B. each question a heading, answers under it | 3 | 9 | 0 | 0 | 9 / 56k / $0.002 |
| C. questions quoted, no labels | 94 | 231 | 124 | 88 | 231 / 2,376k / $0.100 |
| **D. C + the assistant's headings one level down, under the chat title** | **34 (0 tiny)** | **116** | **16** | **2** | **116 / 886k / $0.037** |

- Layout A reproduces the live merge (237 requests, about 2.4M tokens), so the measurements are trustworthy.
- **D** keeps each major section of an answer whole as one unit (its fragments are inside it, not separate parts), removes the
  turn-label topics, halves the parts and cuts Jev input by 64%, with no model change. Fragments no longer need to be placed on
  their own: the weakest-confidence case (tiny fragments) mostly disappears.
- **B** collapses to answer-sized topics: far fewer calls, but it organises the notes by conversation turn, which the plan's
  decision D1 rules out, and a whole answer becomes one topic.
- Unknown before a live run: the effect of larger units on section plans (fewer, larger sections), on the model's confidence, and
  on conflict detection (a part with more than 40 statements goes to the chat model's round two).

## Layout D applied (2026-10-10, local only, no live calls)

`src/ai/import/chatShare/compose.ts` now produces layout D by default: the user's turns as block quotes (never headings, no
"You:" / "Assistant:" labels), the assistant's turns unchanged except that their own headings go one level down (code fences
left alone, level 6 is the floor), under the chat's `#` title with its date and source line. Every kept turn, its order and its
headings are preserved; branch-shared turns stay out as before.

Re-measured with the real function on the three real chats: **34 topics (was 95), 116 parts to assign (was 237), 116 Jev requests,
about 887k input tokens (about $0.037; was about 2,451k, $0.103)**; part size median 457 characters (max 5,089), 16 parts under
150 characters (was 128); 715 passages already in the notes left out (was 676). These are offline estimates, not live savings.

Tests: `chatShare/compose.test.ts` (layout, order, provenance and branch-shared turns, code fences, real parser and unit keys,
and the large-section path: a part within 40 statements gets round-two questions, one over 40 makes `interpret` return null so the
chat task answers). The e2e AI spec reads the new quote format. Unit suite: 2007 pass; the two failing `provenanceGuard` tests come
from another session's `testUtils/repoMapWorld.ts`, not from this change. Not decided by this change: the topic-merge session's
adjacency rule for any top-level part still standing alone; the shortlist (recall to be re-measured on the 34-topic layout).

## Shortlist recall, offline (2026-10-10, no model calls)

How often does a shortlist of the k closest topics, by word matching alone, contain the right topic? Three scorers over topic
label + text: word coverage (what `assignLocally` uses), BM25, TF-IDF cosine; plus BM25 with the part's heading path as context.
Saved output: `shortlist-recall-2026-10-10.txt`.

**Previous layout (95 topics), labels = Jev's confident answers (78 parts; confidence 0.5 or more):**

| Scorer | in top 3 | top 5 | top 8 | top 12 | top 20 | median rank |
|---|---|---|---|---|---|---|
| word coverage | 26% | 32% | 42% | 50% | 54% | 14 |
| BM25 | 35% | 42% | 50% | 54% | 63% | 10 |
| TF-IDF | 29% | 41% | 53% | 60% | 64% | 8 |
| BM25 + heading path | 29% | 44% | 55% | 60% | 71% | 6 |

A shortlist of 8 by shared words would miss **45–58%** of the topics Jev chose with confidence, and 20 would still miss 29–46%. Caveats:
the labels are Jev's own choices (noisy, mostly on tiny fragments), so this measures agreement with Jev, not truth. Still, **a
plain word-overlap shortlist of 8 is not safe on that layout**: "a part whose topic isn't in the list is filed as new" would then
affect about half of the parts. This supports the plan's rule to widen to the full list (or mark unsure), never to guess.

**Layout D (34 topics):** only 9 parts could be labelled without Jev (parts that partly repeat one topic's exact passages, the
query being only their new text): recall 100% at 3 for every scorer. Far too few, and the easy kind (a part that repeats a topic's
wording is lexically close to it), so it says **nothing reliable about layout D**.

What follows: (1) with 34 topics the full list is already cheap (887k tokens, about $0.037 for all parts), so a shortlist matters
less on layout D; (2) the right test for layout D is Jev's own answers on its 116 parts (a Jev-only replay, estimated about $0.037:
needs approval), which gives both the confidence distribution (does D reduce unsure answers?) and labels for recall; (3) embeddings
remain an option for larger canvases, to be judged on recall against such labels.

## Known test-environment failures (tracked, not caused by layout D)

`src/domain/provenanceGuard.test.ts` (2 tests) fails because `src/testUtils/repoMapWorld.ts`, added by another session, is not in
the guard's reviewed-file list. Owner: the session that added that file. Everything else in the unit suite passes (2007).

## Jev-only replay on layout D (2026-10-10, approved, hard stop $0.04, no chat model) — valid

Layout D, the exact current production per-part request (with the parent-heading context), 116 of 116 parts, run one after the
other with the cost checked before every request. **Estimated spend $0.0335** (798,710 input tokens at $0.042 per million; 6,885 per
request, against 10,158 on the old layout). Answers: `jev-layoutd-answers-2026-10-10.json`.

| | Layout D (116 parts) | Old layout, 32-part sample |
|---|---|---|
| Topic confidence | median 0.60; 70 of 116 at 0.5 or more (60%) | median 0.56; 21 of 32 (66%) |
| Jev's raw answers | new 3, existing 113 | new 3, existing 29 |
| Outcome with the 0.5 rule | existing 70, new 0, **unsure 46** | existing 19, new 2, fallback 11 |
| Parts under 150 characters | **median confidence 0.96**, 13 of 16 existing | median 0.44 (4 of 10 accepted) |
| 150–400 characters | median 0.77, 19 of 27 existing | — |
| 400–1,500 characters (67 parts) | **median 0.51, 33 unsure** | — |
| 1,500+ characters (6 parts) | median 0.53, 4 existing | — |

- **Layout D solved the fragment problem** (small parts now decided in context, with high confidence) and cut Jev input by about
  **67%** (measured tokens: 799k against about 2.4M). Per-request tokens fell because there are 34 topics, not 95.
- **But the uncertainty moved to the mid-sized parts**: 46 of 116 are unsure, 33 of them between 400 and 1,500 characters. A larger
  unit often spans more than one subject, so one topic answer is less sure. These go to the "unsure" placement rules (parent, then
  siblings, then word match), whose results on this layout have not been seen; many parts here sit under the chat title, whose own
  unit is not a part, so rule 1 has no parent to follow and rules 2–3 decide most of them.
- **No contradiction was flagged by Jev**: the highest `contradicts` probability over all 116 parts is 0.21 (threshold 0.5). The
  baseline merge (chat model) opened a "Needs your call" for "MVP build time"; in the later runs with Jev (old layout) none was
  opened either. The chat-3 passage "25–40 focused development days for a convincing MVP, not 7–10 days" sits in a 1,446-character
  part (the chat's own text) scored 0.00. Whether that is a true contradiction with the notes is not established here, but
  **a part-sized relation question may dilute a single contradictory statement**; this needs a targeted check (the statement-level
  round two, which the code only runs for parts the first question flags).
- Parts over 40 sentences: none, so the chat-task round-two fallback for large parts was not exercised by this workload.
- **Lexical shortlist recall on this layout** (against Jev's 70 confident answers): word coverage top 3 59%, top 5 74%, **top 8 83%,
  top 12 90%** (median rank 3); BM25 with heading path: top 8 81%, top 12 90%. So a lexical shortlist still misses 10–19%; with the
  full list costing about $0.03 for the whole merge, a shortlist is not needed on this layout.

## Targeted contradiction check: "MVP build time" (2026-10-10, approved, ceiling $0.005, Jev only)

**Spend: about $0.0002** (4,648 input tokens). Log: `jev-contradiction-2026-10-10.log`.

First finding, before any model call: **the notes at merge time (chat 1) contain no build-time statement at all** (the only day or
week mentions there are unrelated). So the real chats give nothing for "25–40 focused development days for a convincing MVP, not
7–10 days" to contradict. The baseline's "MVP build time" choice appeared in **one of three** funded runs (run 2, chat model) and not
in the others, so it was likely a chat-model artefact, not a real contradiction Jev missed. A real-notes check could only be a
negative control, so a topic stating "7–10 days" was **planted** to test detection (a diagnostic setup, not the real notes).

The statement sits in the chat's own text unit ("Branch · AI App Builder Ecosystem (2026-10-08)", 1,471 characters, 9 sentences).

| Test | Jev's relation answer |
|---|---|
| Planted topic "7–10 days" vs the **whole real part** | contradicts, **P 1.00** (topic confidence 1.00) |
| Planted topic vs the statement's sentence **alone** | contradicts, P 1.00 |
| Control: a consistent topic ("25–40 days") vs the whole part | adds P 0.83, **contradicts P 0.00** |
| Round two forced on the planted case (statement level, 8 statements) | statement 3 → the topic's statement, confidence 0.88; statement 4 → the same, 0.46 |

- **No dilution at this part size**: the part-level question gave the same probability as the sentence alone (1.00), and the
  control gave no false alarm. So the 0 contradictions in the 116-part replay is consistent with there being none in the data.
- Production reads that round two as `null` (handed to the chat task): two statements pointed at the same topic statement and one
  pick was below 0.6 confidence. This is the designed conservative path (never a partial set), at the cost of one chat call.
- Limits: one planted pair with a short, unambiguous topic; real topics are longer and noisier, so this is a check that detection
  works, not a measure of recall.

## Placement review of the 46 unsure parts on layout D (2026-10-10, offline, no model calls)

Today's `settleUnsure` (`src/ai/merge/unsure.ts`) was run on the saved layout D answers (the 70 confident answers as the assignment, the 46
answers below 0.5 as unsure; full list in `placement-layoutd-2026-10-10.txt`).

- **All 46 settle by rule 1, "with its parent", into the same topic: "AI App Builder Ecosystem (2026-10-08)"**, the chat's own title text.
  On layout D every answer section sits under the chat's `#` title, and the title's own text is a part. Its topic answer was
  "AI App Builder Ecosystem", so every unsure section follows it. Nothing is lost, but **40% of the new content (46 sections, many of
  400–3,300 characters) is filed under one topic about the chat's opening**, which is the catch-all that already caused the
  regenerate-everything bug (a topic grown past 12,000 characters). 0 parts stood alone, 0 grouped.
- **Only 2 of the 46 agree with Jev's own, low-confidence, first choice** (e.g. "The MVP I'd actually build" went to the chat-title
  topic; Jev preferred "The really interesting architecture" at 0.29). Jev's first choice was between 0.16 and 0.49, so it is weak,
  but it is a topical signal that the parent rule ignores.
- Why: the parent and sibling rules assume the parent is a *topical section* whose children share its subject (a "Pricing" section with
  "Free" and "Pro"). A document title is not: its children are unrelated sections, so "follow the parent", and likewise "follow most
  siblings", is meaningless there. (This does not affect the fragment case the rules were written for.)

Suggested corrections (the topic-merge session's code; not changed here): (1) never use the document's root unit (the chat title) as
a "parent" or as a "sibling group": treat parts directly under it as top-level; (2) for a mid-sized unsure part use Jev's own first
choice when it is above a floor, else refine at subsection level as planned, else leave it visibly **unplaced for review** (never a
catch-all); (3) keep parent and sibling rules for small fragments under a real section.

## Acceptance gate for placement (added 2026-10-10)

`src/ai/merge/placementGate.test.ts` + `__fixtures__/layoutDPlacement.json` encode the gate on the real layout D merge, offline (no
network, no model; the fixture holds headings, sizes, confidences and local answers, no chat text). Run it with
`npx vitest run src/ai/merge/placementGate.test.ts`.

| Gate | Test | Today |
|---|---|---|
| Root-title handling: no unsure section placed in the topic of the chat title it sits under | `it.fails` | **fails as expected** (all 46 do) |
| No oversized catch-all: no topic grown past `MAX_UNIT_CHARS` (12,000) by uncertain placement | `it.fails` | **fails as expected** |
| Nothing silently dropped: every unsure part is settled, named or joined; confident answers untouched | `it` | holds |
| Unresolved parts reviewable (an "unplaced" outcome) | `it.todo` | API not decided |
| Small fragments keep a real parent ("Free" / "Pro" under "Pricing") | `it` | holds |
| Existing dedup, provenance and conflict tests | the rest of the suite | holds |

When the placement rules are corrected, the two `it.fails` tests will start passing and vitest will report them as "expected to
fail": change them to `it`. The 12,000-character limit is the existing unit limit that triggers splitting, not a number chosen to
reduce the unsure count; any confidence floor for using Jev's first choice must be justified with evidence, not tuned to this gate.

## Placement of unsure parts: the topic-merge session's answer (2026-10-10, offline, no model calls)

No live call, no benchmark, nothing committed.

**What changed**

- `src/ai/merge/unsure.ts`: a **document root** is a top-level heading with at least 5 sections directly under it (`documentRoots`, whether or
  not the heading is itself a part). Its children have no parent and no siblings for rules 1, 2 and 4, and it is not a neighbour for the new
  rule 5. The rules are unchanged for fragments under a genuine section ("Pricing > Free/Pro" still follows Pricing). New outcome
  **`unplaced`** replaces `alone` (rule 6): the part is kept whole as a section of its own at the end of the notes, filed under no topic.
  `Settled` gains `unplaced` (the parts that are in an unplaced section, including ones that joined it).
- Rule 5, the **top-level adjacency rule** (my reading of it, since the plan text is not in the repo): a top-level part of at most 150
  characters (`FRAGMENT_CHARS`, the "tiny" cut used in this document) follows the top-level part just above it when that one is placed and is
  not a root. In a flat document "Pricing", "Free", "Pro" are neighbours, not parent and children. Mid-sized parts never use it.
- `src/ai/merge/refine.ts` (new): `subsectionParts` splits a part at its direct subsections (its own text, then each subsection whole).
  `merge.ts` asks the same typed question again for those pieces, once, for every part left unplaced that has subsections. A piece answered
  with confidence (existing topic, or "new") is placed or filed as before (with its conflicts and "nothing new"); the pieces still unsure stay
  together as one unplaced section (named for the first, the others under their own labels). If no piece is answered, the part stays whole and
  unplaced. A heading-only own text is dropped (its subsections keep their own headings).
- `compose.ts`: `ComposeInput.unplaced`; `MergeReport.unplaced` and `.refined`. Unplaced parts are **not** counted in `newTopics`.
  `report.unsure` now means only parts a rule kept (with the section around them / the part before them).
- Review (`merge.ts`): "Merged: …, N passages left unplaced."; "AI couldn't place N passages in your topics (first six names, and N more).
  They are kept in full under their own heading at the end of your notes, not filed under any topic: …"; a refined notice; diagnostics
  `decisions[].filed` is "unplaced" and `settled` is `refined | unplaced | adjacent | …`. Fixed on the way: a merge that only added unplaced
  sections would have said "Everything in this content is already in your notes."
- The ask-the-model code in `merge.ts` is one local function (`ask`) used by both rounds; batching and per-part answers are unchanged. No
  shortlists, no batched topic lists, no caching.

**Confidence floor for Jev's first choice: none (skipped).** There is no ground truth for the 46, so a floor can only be justified against an
independent signal. The only one in the saved answers is the local match (`assignLocally`). In the 46 unsure parts it exists for **0** (the 3
raw "new" answers aside); it appears only at confidence 0.6 and above (1 of 21 between 0.6 and 0.8, 13 of 37 at 0.8 and above, agreeing 12 of 13
there). So the data shows agreement with an independent check only at 0.8+, and nothing at all below 0.5; any floor between 0.16 and 0.49
would be tuned to the count. The 0.5 cut itself stays as it is. Revisit only with labelled data (for example the user's own corrections in the
review).

**Gate results (offline):** `placementGate.test.ts` 6 tests pass: the two former `it.fails` are now `it` and pass; the `it.todo` is a real test
(46 parts unplaced, named in the review: "Merged: 46 passages left unplaced." and "AI couldn't place 46 passages … and 40 more … at the end of
your notes"); the fragment case holds. Two edits to the gate file besides `it.fails` → `it`: its header comment, and "became a new topic
without being named" now accepts `unplaced`.

**Tests:** `npx vitest run`: 2,028 pass, 2 fail (the `provenanceGuard` pair from `testUtils/repoMapWorld.ts`, not mine), 4 todo (not mine); was
2,007 + 2 failing. New: `unsure.test.ts` (roots, root not parent / sibling group / neighbour, a short title keeps the old rule, rule 5),
`mergeUnplaced.test.ts` (6: title is no topic; mid-sized part ends unplaced and is named; refinement places a subsection; unsure subsections
stay together; all subsections sure; `subsectionParts`), every merge test checks that each body sentence is in the merged text. `tsc --noEmit`
and `eslint src/ai/merge`: clean. `assignRealAnswers.test.ts`: the 9 parts that "stand alone" are now "unplaced" (same count, same
assignment, still 2 by the local match); the test now gives each part its recorded length instead of one character, because rule 5 reads
length (with one-character parts three top-level parts of 237, 522 and 639 characters would have wrongly counted as fragments).

**The 46 parts, by rule, on the recorded answers:** parent 0, siblings 0, grouped 0, local 0, adjacent 0 (was: parent 46). **Unplaced 46.**
Largest topic growth caused by uncertain placement: **0 characters** (was 46 sections, 40% of the new content, in one topic). What
refinement does to these 46 can **not** be known offline: the fixture has no subsection structure or text. The 46 are in the worst case all
unplaced; refinement can only lower that.

**Not decided / risks**

1. **Cost of unplaced sections.** Each unplaced part is a new section, so the update runs one plan call for it, where the old catch-all was one
   regenerated topic. Up to 46 extra section calls on this workload (fewer after refinement). It is the price of "no catch-all, nothing
   silently filed"; the alternative (one "Needs placing" section) is a catch-all again and was ruled out. A cheaper option for the chat
   session / user to decide: render unplaced sections as plain text cards with no model plan.
2. **Root threshold (5)** is structural and mirrors the gate: a genuine topical section with 5 or more fragment children loses rules 1 and 2
   (those fragments go local, adjacent or unplaced: visible, never wrong). A size test would need real text in the gate's fixture.
3. Rule 5's reading (follow the part above) is mine; the 150-character cut is not tuned to this data.
4. Layout D yield of refinement depends on how many of the 46 mid-sized parts have `###` subsections: unknown until a live run.

**Proposed benchmark (needs the user's go-ahead):** Jev only, the 46 unsure parts' subsection pieces: at most one request per piece, about
$0.014 estimated (input about 330k tokens at $0.042 per million), hard stop $0.02 with the cost checked before every request from a token
estimate (not the credits balance), no chat model. It measures: pieces answered with confidence, parts placed by refinement, parts still
unplaced, and, for pieces Jev places in a topic that a part-level answer also named, agreement. No other model calls. Risk: low (cost capped,
nothing written to any notes); the result is only as good as Jev's confidence, which is the thing under test.

## Jev-only replay of the subsection refinement (2026-10-10, approved, hard stop $0.02, no chat model)

The production refinement (`refine.ts`: an unplaced part split at its direct subsections, each piece asked again with its heading
path as context) on the layout D merge's 46 unplaced parts. Stopped by its own cost check at **an estimated $0.0199** (473,679 input
tokens) after **70 of 109 pieces**; asking all 109 would have cost an estimated **$0.0345**, more than the $0.014 proposed. Full
log and answers: `jev-refinement-2026-10-10.log`, `jev-refinement-answers-2026-10-10.json`.

- Of the 46 unplaced parts, **23 have no subsections** (they cannot be refined and stay unplaced whole). The other 23 split into
  109 pieces; 14 of those parts (70 pieces) were asked before the stop; 9 were not.
- Per original part (14 asked): **1 fully placed, 10 partly placed, 3 still unplaced.**
- Pieces: **25 of 70 placed (36%)** (confidence 0.5 or more); median confidence **0.38**; raw "new" 13.
- **The pieces are tiny**: 50 of 70 are under 150 characters (17 of those placed, median confidence 0.39), 15 are 150–400 (5 placed),
  5 are 400+ (3 placed, median 0.51). Several are 7–15 characters (a single list item).

Reading the piece-to-topic table (a manual review, not a measure of correctness):
- Some placements are plausible ("Days 26–29" → "Now imagine a marketplace").
- **Some are arbitrary**: "1. Schema tests" and "2. Unit tests" went to "Where today's AI still struggles" (confidence 0.6); the notes (chat 1)
  contain nothing about testing, so this is new subject matter forced into an existing topic.
- **Refinement scatters coherent lists**: the one-word bullets under "…the Roblox analogy becomes REALLY powerful" (9–15 characters
  each) were sent to five different topics, some at 0.85–0.93 on a single shared word ("Fork"). A list that belongs together is
  split across unrelated topics.
- Jev prefers an existing topic even for genuinely new subjects (113 of 116 raw answers on the whole layout were "existing"), so an
  unsure answer is often "nothing here fits well", which the code today reads as "unsure", not "new". The probability Jev gives to
  "new" was not recorded in these replays; it is the missing signal.

Conclusions: refinement as built **recovers little and can mis-file**: it should not be enabled by default. If kept: only pieces of
a minimum size (not 7–15 character list items), keep sibling pieces that are small together with their group, and require
agreement among siblings before placing any. Unplaced content as plain cards (decided by the user, 2026-10-10) is the right default
for the rest.

## Jev's probability for "new" on the unsure layout D parts (2026-10-10, approved, hard stop $0.016, Jev only)

None of the earlier saved answers recorded the probability map, so this replay (46 unsure parts and 6 confident controls, the exact
production request) recorded the whole distribution. **Estimated spend $0.0150** (357,668 input tokens). Saved in the repo as
`.ai/docs/decision-spike/data/jev-pnew-layoutd-2026-10-10.json` (per part: top 4 probabilities with labels, P(new), confidence,
entropy, local word coverage) so the topic-merge session can read it without a model call.

| | P(new) | Notes |
|---|---|---|
| 6 confident controls | median **0.000**, max 0.04 | confidence 0.49–0.99 |
| 46 unsure parts | median **0.03**, max 0.39; at 0.2 or more on 5, at 0.3 or more on 3, at 0.5 or more on **0** | Jev's top choice was "new" on only 4 |
| 46 unsure parts, spread | entropy median 2.48 bits; top choice median 0.36 | mass is split among several existing topics |

- **Unsure mostly means "torn between existing topics", not "nothing fits".** Typical rows: "But there is one gigantic difference…"
  0.45 against "The really interesting architecture" 0.41. A mid-sized answer section often spans several subjects, so one topic answer
  is ill-posed for it; "new" gets almost nothing.
- **P(new) does carry a ranking signal.** A manual read of the part headings against the notes (chat 1 has no skins, themes, testing,
  timeline or roadmap content): the eight highest P(new) parts (0.13–0.39) are all subjects the notes do not cover ("35 days", "skins
  should be universal", "don't make themes just colors", the "Restyle" button, "Realistic timeline for you", "buy a skin", "testing",
  "the 35-day roadmap"). The next ones (0.09–0.11, about the UI problem, the MVP scope, examples) are mostly new too. The parts with
  P(new) at or below 0.03 are mostly about the Roblox analogy, the moat and the architecture, which chat 1 does cover.
- **It misses some**: "The MVP I'd actually build" (0.02) and "6. Then I discover Themes" (0.08) are new subjects with a low P(new).
  The signal is a ranking, not a classifier.
- Limits: 46 unsure parts, labels from reading headings (not a validated ground truth), one workload, one run (Jev's answers vary
  between runs). Any rule based on it is a hypothesis to test, not a result.

Hypothesis for the topic-merge session (a candidate, not a recommendation to ship): an unsure part with P(new) at or above about 0.15
and a top-choice confidence below 0.5 could become a new topic (it would add about 8–10 sections here), every other unsure part
stays a plain card. The 0.15 comes from this one data set; choose it by evidence (re-run on other content), not by the count.

## Unplaced content as plain cards; refinement off; new versus uncertain (topic-merge session, 2026-10-10, offline, no model calls)

No live call, nothing committed, `chatShare/*` untouched.

**1. Plain cards (the user's decision), implemented**

- A part no rule places is shown as **one standalone card with its text verbatim and no model call**: no outline, no plan, no analysis
  call, no catch-all topic. `reconcile/plainCards.ts` (new) builds one section per unplaced part holding one card (a text card, or a page
  card over 2,000 characters with the heading as its title) in the same keyed, framed shape a generated section has, so a later update
  recognises it and keeps it. `compose.ts` returns the unplaced sections' text; `merge.ts` passes it as `UpdateOptions.plainUnits`;
  `update.ts` skips the model for those units on both paths. On outlined sources `plainRuns` groups a section that has bold-line titles
  inside (the parser reads those as several units) back into one card; on user-forced templates it is one card per unit, so a part with
  inner titles is several cards there. A card is a rendering state: the part's assignment stays null and the review names it ("AI couldn't
  place N passages … each as a plain card … not analysed by AI, not filed under any topic"; "Merged: …, N passages left unplaced.").
- `settleUnsure` no longer groups a fragment into an unplaced sibling (one card per unplaced part, never a pile).
- **Cost effect (estimate):** each unplaced part used to be a new section, i.e. one section plan call (about $0.0035 observed). Avoided on
  this workload: up to 46 calls, about **$0.16** (46 × $0.0035), plus the outline call that would have covered them. A plain card costs
  nothing to generate; it still costs canvas space (up to 46 frames) and attention in the review. Expected merge cost: the assignment
  about $0.037 (Jev) plus plans only for grown topics and confident new topics.
- Limit: a plain card is matched to its section by exact text. A section that grows past 12,000 characters is split by the unit limit and
  would be planned normally (a safe fallback, not a loss).

**2. Subsection refinement: off by default**

`MergeInput.refineSubsections` (default false) gates it. The saved replay (25 of 70 pieces placed, median confidence 0.38, 50 of 70 pieces
under 150 characters, scattered lists, new subjects filed under unrelated topics) does not justify enabling it, and I do **not** propose
retaining it with thresholds: the saved answers contain no labels that could justify a minimum size or a sibling-agreement rule (a
threshold chosen from them would be tuned to the replay, the same judgment as for the confidence floor), and 23 of the 46 unplaced parts
have no subsections anyway. The code stays for a later experiment; with the flag off the part stays whole and unplaced. Tests:
`mergeUnplaced.test.ts` (default: one assignment call; flag on: the earlier refinement tests).

**3. New versus uncertain: what the saved data can say (offline)**

- *Where the data is.* The earlier fixtures (`layoutDPlacement.json`, `jevSampleAnswers.json`) hold only the top choice and its
  confidence, so P("new") **cannot** be recovered from them for the 116 original parts (the replay files the evidence doc names,
  `jev-layoutd-answers…` and `jev-refinement-answers…`, are not in the repository). The probability map exists only for the 46 unsure parts
  and 6 controls, in `.ai/docs/decision-spike/data/jev-pnew-layoutd-2026-10-10.json`. It is analysed here and pinned by
  `src/ai/merge/pnewEvidence.test.ts` (5 tests, offline).
- *What it shows (46 unsure parts, 6 controls, one run).* P(new): median 0.03, max 0.39, 3 parts at 0.3 or more, **0 at 0.5 or more**;
  "new" is Jev's top choice on 4. Entropy median 2.48 bits. Unsure mostly means **torn between several existing topics**, not "nothing
  fits". The 0.5 confidence cut sits inside the run-to-run noise: re-asked, **6 of the 46 reached 0.5 or more** (0.50-0.58) and **1 of 6
  controls fell below 0.5** (0.49).
- *Manual review, by headings only* (I could not read the part texts; the notes' topics are the 34 headings in the fixture; one reviewer,
  so not independent of the other session's read). 11 unsure parts are on subjects no topic heading covers (35 days, skins, themes, the
  "Restyle" button, timeline, "buy a skin", testing, the 35-day roadmap, MVP scope): P(new) 0.39 0.33 0.30 0.24 0.23 0.18 0.15 0.13 0.10
  0.08 and **0.02**. 7 are on subjects that are covered (the Roblox analogy, the moat, the Block Contract, composition, architecture):
  P(new) **0.00-0.06**. So P(new) ranks well here: 10 of the 11 new subjects are at 0.08 or more, all 7 covered ones at 0.06 or less; one
  new subject ("The MVP I'd actually build") is missed at 0.02. It is a **ranking, not a classifier**, on 18 labelled parts.
- *Other signals.* Word coverage (the local match's score) does **not** separate them: Spearman -0.30 with P(new), and a new subject
  ("35 days", 0.17) and a covered one ("The real competitive moat", 0.21) look alike. Confidence relates weakly (-0.18), entropy weakly
  (+0.26).
- **Examples.** New, high P(new): "35 days" 0.39, "skins should be universal" 0.33, "don't make themes just colors" 0.30. Covered, low:
  "the Roblox analogy even stronger" 0.01, "The real competitive moat" 0.06. A miss: "The MVP I'd actually build" 0.02 (torn between
  architecture and Roblox).
- **No threshold is chosen or shipped.** The three outcomes stay: existing (confident, as now), **uncertain, shown as a plain card (the
  default for everything not confident)**, and new only once a rule is validated. A low P(new) never turns into an existing-topic
  assignment: nothing uses Jev's low-confidence first choice (no floor, see the earlier section), and an unsure part becomes a card.

**Proposed follow-up (needs your go-ahead; nothing was run).** 18 manual labels are too few to set a "new" rule, and the P(new) map exists
only for the unsure parts. For the other 70 confident parts of the 116 no distribution was saved. Recording all 116 would cost about
$0.034 (the earlier 116-part replay cost $0.0335), more than the $0.01 asked, so I do not propose it. Instead, **a different workload**:
another real chat, about 30 unsure parts, Jev only, the exact production request, the full distribution recorded, token estimate checked
before every request (not the credits balance), hard stop $0.02 (about $0.01 expected). Labels come from reading the part text, not
headings. It tests the one hypothesis worth testing (P(new) at about 0.15 or more with confidence below 0.5 means a new topic) and
reports, per candidate threshold, how many covered subjects would wrongly become new. The rule is fixed beforehand: ship nothing unless
both groups separate on the new data as they do here. Risk: low (capped, Jev only, nothing written to any notes); the weak point is the
labels.

**Tests and counts.** `npx vitest run`: 2,036 pass, 2 fail (`provenanceGuard`, only `testUtils/repoMapWorld.ts`; pre-existing, not a
regression), 4 todo (pre-existing); was 2,028 + 2 + 4. `tsc --noEmit` and `eslint src/ai/merge src/ai/reconcile`: clean. New or changed
tests: `mergeUnplaced.test.ts` (9: plain cards on a user-forced template and on an outlined source, zero outline / plan / analysis calls
for unplaced text, one card per part with inner titles, refinement off by default and on), `unsure.test.ts` (an unplaced fragment is no
group), `pnewEvidence.test.ts` (5). `placementGate.test.ts` and `assignRealAnswers.test.ts` did not need changes this round and pass.

**Process note.** I ran `taskkill /IM node.exe` once to stop a runaway script of mine. That ended every node process on the machine,
including any of another session's (a dev server or watcher may need restarting).

## Data files (added 2026-10-10)

All saved answers and experiment outputs referred to above are in `.ai/docs/decision-spike/data/`: `jev-sample-answers` (32 per-part,
old layout), `jev-replay-answers` (237 batched), `jev-layoutd-answers` (116, layout D), `jev-refinement-answers`, `jev-pnew-layoutd`
(full distributions), the contradiction check log, the layout and shortlist-recall outputs, and the placement review. Headings and
numbers only, no chat text beyond heading titles.

## Benchmark cost estimate, from today's behaviour (2026-10-10; an estimate, not a measurement)

Workload as in the baseline: chat 1 as notes, then all three chats merged; Gemini 2.5 Flash plus Jev (typesafe/jev-1.13).
Baseline: about $0.45 billed (estimate $0.47); merge about $0.35; billed Gemini cost runs about 1.5 times the visible-token estimate
(hidden reasoning tokens, not yet measured).

| Part | Basis | Estimate (billed USD) |
|---|---|---|
| First chat (outline, section plans, analysis cards) | $0.10 to $0.144 in earlier runs; layout D changes its granularity, direction unknown | 0.10 to 0.17 |
| Jev assignment, 116 per-part requests | measured, 799k tokens at $0.042 per million | 0.034 |
| Merge section plans for grown topics (appended or regenerated) | about 8 appended + 4 regenerated seen in the last run; layout D has 70 confident parts over up to about 30 topics, so assume 12 to 30 calls at about $0.005 billed | 0.06 to 0.15 |
| Merge outline for any new topics | one call, $0.02 to $0.03 | 0.02 to 0.03 |
| Plan calls for the 46 unplaced parts | plain cards, no model call (was about $0.16) | 0 |
| **Total** | | **about 0.22 to 0.39, central about 0.30** |

- The central estimate is **about 35% below the $0.47 baseline**; the 40% target ($0.28) is inside the range, not the middle of it.
- The widest uncertainties: reasoning-token billing, how many topics the 70 confident parts grow, and whether layout D makes the
  first chat cheaper or dearer.
- Two earlier runs billed $0.76 and $0.90, but they were on the old layout, with 72 new-topic plan calls, a regenerate-everything
  bug and (the second) a change-set failure; none of those apply any more.
- Suggested hard cap: **$0.50** for one run (the spec stops it at the provider-reported cost, so a run that hits the cap is wasted:
  a higher cap is safer than a tight one). Expected to finish under $0.40.
- Success criteria, as agreed: correctness first (nothing lost, duplicates handled, conflicts and provenance kept, unplaced parts
  visible, no catch-all), then billed cost against $0.47; a lower bill alone is not enough. The planted contradiction check validates
  one narrow behaviour, not contradiction recall.

## Benchmark run of 2026-10-10 (layout D, plain cards, placement fixes) — INCOMPLETE, stopped by the harness cap

Authorized by the user: one run, Gemini 2.5 Flash plus Jev, hard cap $0.50. Evidence: `data/benchmark-2026-10-10-incomplete.stats.jsonl`
(per call: tokens as reported by the host, cost, timing; all 233 finished calls carried provider-reported usage).

**It did not complete.** The harness refuses any AI call that would push projected spend (finished calls plus in-flight predictions) past
the cap. At provider-reported cost $0.461 with 6 calls in flight it refused **97 calls (60 merge section plans, 37 analysis cards)** and
the merge finished with those sections left to their own structure. The proxy over-states the bill: provider-reported tokens at list
prices came to $0.488, the billed delta was **$0.3837** (ratio 0.786), so the cap tripped when about $0.36 had been billed. The spec
now scales its estimate by 0.8 (`COST_SCALE`), as measured here.

| | First chat | Merge (incomplete) | Whole run |
|---|---|---|---|
| Billed (credits delta) | **$0.108** (was $0.144 on the old layout) | $0.275 | **$0.384** |
| Calls | 66, 21 sections, 344 objects | 264 (97 refused) | |

- **Projected full run: about $0.66 billed-equivalent** (the 97 refused calls at the observed $0.0046 reported per plan call and $0.0021 per
  analysis card, scaled by 0.786), **above the $0.47 baseline, not below it.** The target (at least 40% lower) was not met.
- **Why: the merge still generated everything as new sections.** `diagnostics.calls.plans`: appended **0**, regenerated **0**, piece 6, **new 104**;
  `sectionsReused` 0, `sectionsRegenerated` 70. The reuse that worked in the previous run's first chat (8 appended + 4 regenerated, on the old
  layout) did not happen on layout D. 110 plan calls and 37 analysis cards at about $0.0036 billed each cancel the Jev saving.
- **What worked:** Jev assignment (6 batches of up to 20, 107 parts, $0.034, answered by Jev), 21 parts left out as repeats before any call, 9 "AI found
  nothing new in them" parts left out and named, 43 passages unplaced and named (plain cards, no plan call), 18 existing topics extended, no catch-all,
  `choicesOpened` 0, no failures other than the 97 refused calls.
- **Correctness check that failed:** the review reads "15 sections · +232 new · **−4 removed** · ~55 updated · 169 links changed" and lists many
  **"Page: More from this section"** pages. A merge must not remove. The −4 and the repeated overflow pages are unexplained; the refused calls may
  contribute (sections left to their own structure), but "More from this section" pages were supposed to be fixed. The spec's other hard checks
  (next version recorded, the first chat's opening kept once, the last branch's own turn present) did pass.
- Uncovered by this run (incomplete): quality of the final canvas, duplicate handling beyond the counts above, conflicts (none opened).
- Spend of this run: $0.384 billed. Total benchmark-related spend so far is above the original $2.12 budget; no further runs without approval.

## Layout D merge: why nothing was reused, the overflow pages, the removals (topic-merge session, 2026-10-10, offline, no model calls)

No live call, nothing committed, `chatShare/*` and `e2e/ai/chatShare.spec.ts` untouched. Everything below is from a **mock-model reproduction
built only from saved data**: the first chat's 34 topics (`layoutDPlacement.json`), Jev's saved answers for the 116 parts
(`data/jev-layoutd-answers-2026-10-10.json`: heading, size, topic, confidence) and the call log
(`data/benchmark-2026-10-10-incomplete.stats.jsonl`, both paths verified). The chats' text is not in the repository, so section bodies are
distinct filler of the recorded length (`src/ai/merge/__fixtures__/layoutDWorld.ts`). Mock call counts are not billed costs.

**The reproduction matches the live first import**: an outlined AI-tier source of 21 sections, **20 frames, 344 objects** (the live run's
numbers) when a mock plan draws one node per 95 characters (283 content nodes against the plan's 300-node limit).

**1. What each counter measures (they are not equivalent)**

| Counter | Measures |
|---|---|
| `plans.appended / regenerated / piece / new` | `generate_visual_plan` **calls**, by request kind: only appended paragraphs; the section with its current drawing; one piece of a large section; no earlier drawing (a new section, **and every analysis-check retry, which asks the whole section again**) |
| `sectionsRegenerated` (= `reanalyzedUnits`) | section **keys** the update rebuilt: with a whole new outline, every section of that outline; otherwise the grown sections plus the new ones. It counted plain cards too (fixed: they are `plainCards` now) |
| `sectionsReused` | sections kept with their earlier objects, no call |
| `analysisCalls` | `generate_section_analysis` calls (the analysis-card patch for a section lacking a takeaway) |
| review "15 sections · +232 new · −4 removed · ~55 updated" | frames in the change set; created blocks, shapes and pages; **removals of objects that are not connectors** (`ChangeSetReview.describeReconciliation`); updated objects |

The live "appended 0, regenerated 0, piece 6, new 104, reused 0, regenerated 70" is one event seen through different counters: **the update
threw the first import's sections away and outlined the whole merged text again** (one `outline_document` call in the merge's log, which an
append never makes): 70 sections in the new outline (`sectionsRegenerated` 70), each asked as a new section, plus 34 retries by the analysis check
(104 `new`) and 6 pieces = 110 plan calls started, plus 37 analysis-card patches started. The merge's log has 264 starts
(116 assignment, 1 outline, 110 plan, 37 analysis); 97 of them (60 plans + 37 analysis cards) were refused by the cap, so 167 finished.

**2. Confirmed cause of the missing reuse**

*Reproduced first, then fixed.* With the saved answers and no other change, the merge makes **1 outline call, 64 plan calls (new 37, piece 27),
0 reused, 43 sections regenerated** (appended 0): the live pattern. Cause, in order:

1. Jev put the last chat's "My honest score" (5,109 characters, confidence 0.58) into topic t1, **the chat title's own text** (the part has an
   inner title, "Competitive feature matrix": 3,315 characters in the earlier sample).
2. The merge writes a part's inner headings as bold lines (`**Title**`) so the topic's structure stays as it is. But the parser reads a bold-only
   line as a heading one level below the heading above it (`content/structure.ts`), and the title's own text sits **above the sibling sections**: the
   bold line became a level-2 heading and **every following `###` section nested under it**.
3. Every topic key below the title changed (`Chat › X` became `Chat › Competitive feature matrix › X`), so the first import's sections had no
   units any more (`sections.every(units.length > 0)` false in `updateOutlined`) and the update re-outlined the whole document.

*Fix:* a part filed into a section's own text above its subsections writes such a line in italics (`compose.ts`, `titleLikeAsItalic`); any
other topic keeps `**Title**`. Result on the same data: **0 outline calls, 17 appended plan calls (new 0, piece 0), 4 sections reused, 0 analysis
calls**; all 34 unit keys of the notes survive in the merged text. Control: the same data with the fix switched off reproduces the failure again.

*A second reuse failure, found on a second import* (the same three chats merged again into the accepted result: should be 0 calls): the second
merge again made an outline call and 12 plan calls, then proposed removals. Two causes, both in how a stored plan is read back:
(a) a stored plan that a merge made has more than 300 content nodes (the old nodes, restored by the append-only guard, beside the new ones),
and `validateVisualPlan(previous.plan)` **folded its tail into "More from this section" pages again**, so 10 sections lost their nodes and were
regenerated; (b) the merge's new sections (46 cards) each have a frame, the stored plan has 67 groups, and the same read **dropped every group
past `MAX_GROUPS` (20)**, so 47 section titles looked removed. Fix: a previous version's plan is read as stored
(`validateVisualPlan(plan, { stored: true })`: no folding, no group limit; the limits applied when it was made); and in a merge the nodes already
there are kept and counted first, so only nodes added on top fold (`foldOverflow(..., existing)`). After it: the second import makes **no plan,
analysis or outline call and proposes no creation or removal**.

**3. Overflow pages and the four removals**

*Overflow pages (reproduced).* There are three separate causes. The plan's overall limit is `MAX_SECTIONED_PLAN_NODES` = 300 content nodes and
the first import already drew 283 of them, so any growth overflows by design ("nothing past a cap is lost").
1. **The plain cards of unplaced parts were folded** (46 of the 58 pages in the reproduction): a card is one node, counted against the 300, so
   past the limit it became a page titled "More from this section" that had lost its own heading. Fixed: plain cards (and their titles) carry
   `origin: "plain"` and are never counted or folded. The merge now shows **46 frames, one card each, with heading and text**.
2. **Duplicates in pages**: the previous plan's nodes were candidates for folding and the append-only guard restored them, so a page repeated
   old nodes next to the originals. Fixed with the existing-nodes rule above (only added nodes fold).
3. **Appended paragraphs past the limit** (12 pages remain in the reproduction, one per grown section that no longer fits): the limit working as
   designed. **I did not raise or reshape it.** With roomier nodes (300 characters each) the same merge has 0 such pages; at the first import's
   density it cannot avoid some. Raising `MAX_SECTIONED_PLAN_NODES` needs evidence about canvas readability that this session does not have.

*The four removals — not reproduced in the first merge.* In every offline variant of the first merge (complete run; the buggy re-outline path;
with refused calls) the change set has **0 removals**: the append-only guard restores every previous node that a regenerated section drops, and
the previous objects are all unchanged. What the reproduction **did** produce is removal of section titles on a **second** merge (47 titles
past the frame limit, cause (b) above), fixed. A `remove` is proposed in only three ways: a canvas object whose key has no node in the new plan;
the same key coming back as another kind of object (a replacement: remove plus add, not loss); a duplicate object with one key. For the live
run's four I can say only that they are not content loss we can show (the first merge here has none), and that the live run took the
re-outline path, which the sim cannot reproduce exactly (real nodes of several kinds, real links, real retries). **Not established.** To settle
it the next run records `diagnostics.removals` (each removed key and whether the same key returns as another kind of object, new in
`MergeDiagnostics`); a removal with `replacedBy: true` is a replacement, anything else is a loss to investigate.

**4. Interrupted runs (the 97 refused calls)**

Before the fix, a merge that went through `visualizeOutlined` (new sections, or a whole new outline) accepted a refused call as "this section is
left to its own structure" with a warning, so the review presented a finished merge in which 60 plans and 37 analysis cards were never made.
The append path (grown sections) already failed whole. Now **a merge is all or nothing**: a refused or failed section makes the update throw
("N of the new sections couldn't be analysed (…), so nothing was changed. Run the merge again.") and nothing is proposed, so there is nothing
to remove. A cancelled merge ends with an abort. (The first Visualize still accepts a structure-only section with a warning, as before.)

**5. Changes and tests**

Code: `merge/compose.ts` (`titleLikeAsItalic`, own-text units), `reconcile/update.ts` (stored plan read as stored, existing nodes kept,
all-or-nothing merge, `plainCards` and `removals` in the result), `visual-plan/validate.ts` and `repair.ts` (`stored`, `existing`,
`origin: "plain"`), `visual-plan/schema.ts` and `types.ts` (`origin` may be "plain"), `reconcile/plainCards.ts` (marks its nodes),
`merge/merge.ts` (diagnostics `plainCards`, `removals`), `testUtils/reconcileHarness.ts` (`acceptUpdate` also stamps created pages).
Tests, each shown **failing without its fix** and passing with it:
`merge/layoutDReuse.test.ts` (9: the first import's shape; reuse; keys kept; plain cards; limits; no removal; second import; refused; cancelled),
`merge/compose.test.ts` (2), `merge/mergeUnplaced.test.ts` (+1: a refused new section rejects the merge),
`visual-plan/foldOverflow.test.ts` (+4), `visual-plan/validate.test.ts` (+2).
With the three fixes switched off together, 5 of the 8 reproduction tests fail (reuse, keys, plain cards, limits, refusal).

**Results.** `npx vitest run`: **2,054 pass, 2 fail, 4 todo** (before this work 2,036 + 2 + 4). The 2 failures are the known `provenanceGuard` pair;
the only offender is still `testUtils/repoMapWorld.ts` (another session; not a regression; I first added a third offender in `merge.ts`, caught it,
and moved the code). `tsc --noEmit` and `eslint src`: clean.

**6. Expected calls and cost for the same three-chat workload (an estimate, not a measurement)**

| | Live (incomplete) | After the fixes (reproduction) |
|---|---|---|
| Jev assignment | 116 requests, $0.034 | 6 batches, 116 requests, about the same: $0.031-0.034 |
| Sections reused or untouched | 0 | 4 of 21 untouched; 17 grown |
| Sections appended (only the new paragraphs asked) | 0 | **17** plan calls (12-23 depending on how the real outline groups the 23 grown topics) |
| Sections regenerated whole | 70 (new outline) | 0 |
| Genuinely new topics | 104 plan calls "new" | 0 (every confident answer went to an existing topic; Jev's raw "new" parts are unsure, so cards) |
| Plain cards (unplaced parts) | 43 parts, still planned as sections | **46 cards, 0 calls** |
| Outline calls | 1 | 0 |
| Analysis-card calls | 37 (+37 refused) | **0** (the append path has no analysis check; a regenerated section would) |

Cost, from the measured per-call figures: a plan call about $0.0046 provider-reported, **$0.0036 billed** (ratio 0.786); the first chat $0.108
measured; Jev $0.034. **Central: first chat 0.108 + Jev 0.034 + 17 × 0.0036 (0.061) = about $0.20; range about $0.18-0.24, against the $0.47
baseline (-49 % to -62 %).** Assumptions and uncertainty: (1) the 17 is the mock's grouping; real outline sections group the topics differently
(12-23). (2) An appended call is cheaper than a whole-section call (it sends only the new paragraphs and the current drawing) — unmeasured; if it
costs about 1.5x a plan call, the run is about $0.24-0.28. (3) If the live model's reply to an appended request is rejected and the update
falls back to regenerating the whole section, a call costs a whole-section price and may bring an analysis patch: worst case 23 x ($0.0036 +
$0.0017) = $0.12, run about $0.27-0.31 (-34 % to -43 %). (4) Hidden-reasoning cost is inside the 0.786 ratio, measured on one run. (5) Merges now
fail whole when a call is refused, so a capped run stops with nothing proposed instead of a degraded result: a cap of $0.50 is far above this estimate.
The 40 % target ($0.28) is inside the range but near its top only in the worst case. Remaining risk: the reproduction cannot show real node
kinds, links, or the real model's refusals to follow the append format.

**Not done / for the user.** No live run: it needs your go-ahead (suggested: the same workload, cap $0.50, with `diagnostics.removals` and
`calls.plainCards` read at the end). Open: the 12 overflow pages are the 300-node limit at work; whether that limit should be revisited for
merges is a product decision. The whole-outline path (a real structural change) still sends plain-card text to the model; the user-forced
templates show a part with inner titles as several cards.

## Benchmark run of 2026-10-10 (run 3, after the reuse fixes) — COMPLETE, cost target MISSED

Setup: Gemini 2.5 Flash + Jev, the three share links, cap $0.50, COST_SCALE 0.8, one run, no retries. Data: `data/benchmark-2026-10-10-run3-complete.stats.jsonl`. The run completed (no cap hit; 219 calls, 0 failed).

**Correctness:** `diagnostics.removals` is empty; the review shows "+104 new · ~4 updated · 2 links changed", no "removed". Merge: 18 existing topics extended, 43 plain cards (0 calls), 45 left unplaced in the toast, 645 passages left out as repeats, 9 parts "nothing new". Hard checks passed.

**Cost (billed, /credits delta):** at the end of the run $0.4289 (first chat $0.1093, merge $0.3196); the settled balance afterwards (about 10 min later) shows $0.4616 since the start (includes the preflight call). Baseline $0.45 billed / $0.47 estimated; target under $0.28. **Target missed; no reduction.** Provider-reported tokens at list price: $0.464.

**Merge calls:** 116 Jev decisions ($0.034), 27 plan calls ($0.209; diagnostics: appended 10, piece 3, new 10, regenerated 0, sectionsReused 9), 9 analysis cards ($0.023), **1 outline call** ($0.005; the offline fix predicted 0), so the merge still re-outlined (21 sections regenerated) and `frames after merge` went 20 → 63. The offline estimate (17 plan calls, no outline, about $0.20) did not hold: merge plan calls cost $0.209 alone, because each carried far more output (69.5k out tokens, 2.6k per call) than the $0.0036 assumed.

## Run 3 follow-up: the surviving outline call and the size of the plan replies (topic-merge session, 2026-10-10, offline, no model calls)

No live call, nothing committed, `chatShare/*` and `e2e/ai/chatShare.spec.ts` untouched. Evidence: `data/benchmark-2026-10-10-run3-complete.stats.jsonl`
(219 calls, per call tokens as reported by the host; its `costUsd` already includes the 0.8 scale), plus the same mock reproduction as before
(`layoutDReuse.test.ts`). Estimates are labelled; nothing here is a billed cost.

### A. The surviving outline call

**Root cause (reproduced offline).** The merge outlined once because some of the **notes' own sections looked new**.

1. The first import fills the plan's 300-node limit (live run 3: 343 objects; the reproduction at 78 characters per node draws 325 objects and the
   same shape: "More from this section" pages `page#0…#4` in the stored plan). Nodes past the limit are folded into overflow pages whose
   stable keys are positional (`page#N`) and **name no section**.
2. The last section has no frame (the first import has 21 sections and only 20 frames, `MAX_GROUPS`), so for it the plan has neither a frame
   nor any keyed node: nothing in the stored plan says that section exists.
3. `updateOutlined` takes a unit no stored section covers for **new content** (`added`), and sends the added units through
   `visualizeOutlined`: **one outline call, a plan call per resulting section, and an analysis check (the 9 analysis cards)**.

*Evidence from the saved log.* (a) the merge's plan calls come in two groups, 15 before the single outline call and 12 after it
(`merge` steps in order); (b) `diagnostics.calls.plans` is appended 10, piece 3, new 10, with **9 analysis calls**, and analysis checks exist only
in `visualizeOutlined`; (c) `sectionsRegenerated` (21) ends with the notes' **last topics** ("The Roblox-like flywheel" … "Roblox for software."),
some joined by the outline into sections the first import never had ("And then something even more powerful happens ⨁ And this creates a
potentially massive moat": two topics that are not adjacent in the notes), i.e. the outline regrouped notes topics that had no section.

*Why the earlier offline reproduction did not show it.* I had calibrated the mock to 95 characters per node (283 content nodes, under the 300
limit), so the first import folded nothing and every section kept keyed nodes. At 78 characters per node (over the limit) the same merge makes
**1 outline call and 3 new plan calls** (REUSE test fails with "expected 1 to be 0"). The live first import was past the limit, as its 343 objects
and "Regenerate 5 sections" show.

*The frames, 20 → 63.* **63 − 20 = 43 = `calls.plainCards`**: the frame increase is the 43 plain cards, one frame each, required by the plain-card
decision (not caused by the outline call). The 9 generated sections did not add frames in the live review (all 43 sections in the review are
cards). *Unexplained:* 45 parts were unplaced but 43 became cards; "And there's a fascinating endgame" and "And now the really interesting
part" went to the model instead (both are in `sectionsRegenerated`). I could not reproduce a plain-card text mismatch offline; the next run
should log the unplaced texts that did not match (a `plainMissed` diagnostic is proposed, not made).

**Is the outline needed?** No. The units were in the previous text; they only had lost their place in the plan. The outline regrouped existing
notes topics and re-analysed them as new sections.

**Change made (smallest I found).** In a merge (`appendOnly`), a unit that the previous text had but no section of its plan holds becomes a
section of its own (`updateOutlined`, "orphans"). Grown ones are planned again from their whole text (one plan call, as the section would have cost
anyway); unchanged ones are left alone; **no outline call and no analysis check**. It also works for plans already stored by run 3.
*Test* (`layoutDReuse.test.ts`, "DENSE FIRST IMPORT"): first import past the limit (its plan holds "More from this section"), then the merge: 0 outline
calls, 0 analysis calls, no removals, every sentence of the notes kept. It fails without the change ("expected 1 to be 0") and passes with it.
*Effect (estimate, list prices):* removes the outline ($0.0049) and the 9 analysis cards ($0.0226) of run 3, about **$0.027**; and the
sections no longer get the analysis block in their replies (see B), perhaps another $0.01-0.02. About **$0.04 of $0.27 list** for the merge.

### B. Why a plan call returns about 2.6k tokens

**Measured (run 3, from the JSONL; list prices $0.30 in / $2.50 out per million, the benchmark's `PRICE`):**

| Calls | n | input tokens | output tokens | list cost | output share |
|---|---|---|---|---|---|
| first chat, plans | 30 | 108,377 | 36,916 (1.23k avg) | $0.125 | 74 % |
| **merge, plans** | 27 | 119,432 | **69,460 (2.57k avg)** | **$0.2095** | **83 %** |
| &nbsp;&nbsp;before the outline call (grown sections: appended 10, piece 3, …) | 15 | 72,858 | 43,428 (2.9k) | $0.130 | |
| &nbsp;&nbsp;after it (sections the outline made) | 12 | 46,574 | 26,032 (2.2k) | $0.079 | |
| merge, analysis cards | 9 | 27,456 | 5,757 | $0.0226 | |
| merge, outline | 1 | 6,136 | 1,221 | $0.0049 | |
| merge, Jev decisions | 116 | 798,649 | 45,173 | $0.0335 (at $0.042/M in) | |

Per call, merge plans: input 3.4k-5.9k tokens (the fixed rules are about 2.5k of that), **output 37 to 7,123 tokens, median 2.0k**; the nine largest
replies (3.6k-7.1k) are the grown topics that received the most text.

**Cause.** Not a malfunction: the reply is **the section's structure written out**, and it is about 5 to 6 times the text it describes.
(a) 62 parts of 42,251 characters (an upper bound, before repeats are removed) were filed into 18 topics; the merge plans returned 241,200
characters of JSON (5.7x); the first chat's 24,059 characters returned 128,661 (5.3x), so the ratio is the same with and without the merge's
"append only" prompt. (b) The prompt asks for it: `FIDELITY_RULE` wants every fact **in the content's own words** in a node, a concept as a
short-label node plus a linked `text` node (`explained_by`), each node `{id, type, content, stableKey, …}` and each link a relationship object,
so a point of about 100 characters costs two nodes and a link, roughly 250 characters of JSON before its own words. (c) `appendedRules` lets
the model reply **a changed existing node in full** ("the full node, keeping its id and stableKey, with the fact added and everything it said
before kept"), which re-emits the whole node. (d) The outline-made sections also get `analysisRule`: a takeaway and `origin: "analysis"` nodes (the
appended path does not). Not measurable from the log: the split between (a)-(d) per reply (the log has sizes, not bodies).

**Cap tested offline (do not set a lower output cap).** No task sets `maxTokens` today (only the Copilot provider forwards it). A reply cut off
mid-JSON is asked again once, then the section fails, and a failed section fails the whole merge (all or nothing): in the mock, 17 grown sections
cut off made **34 plan calls (each paid twice), then a rejected merge** (`layoutDReuse.test.ts`, "TRUNCATED REPLIES"). A cap would cost more, and
fail, unless something rescues the cut reply; there is no such fallback.

**Options, with estimates (list prices; nothing was changed for these).**

| Option | What it changes | Estimated saving on the merge's $0.27 list | Risk to check before shipping |
|---|---|---|---|
| A (made) no outline, no analysis for orphans | as above | about $0.03-0.04 | none seen: tested |
| B1 appended paragraphs by reference (`numbered`, `REFERENCE_RULE`, `expandSourceRefs`) in `changedInput` | the model replies refs for verbatim blocks | 10-25 % of plan output: **$0.02-0.05** | the update path does not number or expand today; the model may not follow it (cannot be tested offline); folding a fact into an existing node would no longer happen |
| B2 drop "full node" re-emission: appended text becomes new nodes only | shorter replies for grown topics | 10-20 % of the pre-outline output: **$0.01-0.02** | a fact stays a separate card instead of joining its node |
| B3 appended paragraphs as plain verbatim cards, no model call | the 15 grown-section calls disappear | up to **$0.13** | **product decision**: the new passage is a card, not drawn into the section's structure and links |
| B4 lower output cap | none safe | negative (see above) | needs a rescue path first |

**Estimated whole-run cost (labelled estimate; list prices; billed/list varied 0.79 to 0.99 between runs 2 and 3, and the per-step credit splits
are unreliable because the balance lags by minutes, so only the settled total is used).** Run 3 settled $0.4616 against $0.466 at list prices
(first chat about $0.195 + merge about $0.27). With A only: about **$0.43** (-7 % against the $0.4616 settled; the $0.45 baseline: -5 %).
With A + B1 + B2 (mid): about $0.37-0.40. With A + B3: about **$0.29-0.31** (-33 % to -36 % against $0.45): still short of -40 %
($0.27) because the first chat ($0.195 at list) and Jev ($0.034) are untouched. **No set of changes that I can verify offline reaches
-40 %.** It needs a choice about the first chat's granularity (about 5x expansion on 21 sections) or about how a merge draws new text.

### Changes made, tests, results

*Made:* `reconcile/update.ts` (orphan sections in a merge). *Tests added:* `merge/layoutDReuse.test.ts` +2 ("DENSE FIRST IMPORT", "TRUNCATED REPLIES").
*Proposed, not made:* B1, B2, B3 (above), a `plainMissed` diagnostic, and a decision on the first chat's plan granularity.
`npx vitest run`: **2,141 pass, 2 fail, 4 todo**; the 2 failures are the known `provenanceGuard` pair (only `testUtils/repoMapWorld.ts`), unchanged.
`tsc --noEmit` and `eslint src`: clean.

### Remaining uncertainty

- **Overflow-page count in run 3: unknown.** The log records tokens, not objects; the review text lists "Page: More from this section" nine times
  in its tail, which is a floor, not a count. The reproduction's 12 pages are the mock's.
- Whether the live first import's last sections are exactly the ones the merge regenerated (inferred from names and call order).
- The two unplaced parts that did not become cards.
- The split of reply tokens between nodes, links and analysis, and whether the model would follow B1 (a live check with a few saved reply bodies
  would settle it for under $0.01).
- The billed/list ratio (0.79 in run 2, about 0.99 in run 3): hidden reasoning tokens or routing; it moves every estimate by about 25 %.

## Economy mode, the 45-vs-43 gap, run diagnostics and the cost script (topic-merge session, 2026-10-10, offline, no model calls)

No live call, nothing committed, `chatShare/*` and `e2e/ai/chatShare.spec.ts` untouched. Refinement stays off by default. The "numbered" and
"drop full-node re-emission" prompt changes are **not** implemented (held, as decided).

### 1. The 45 unplaced vs 43 cards: cause not found; fixed in the way that makes it impossible; next run will say why

*What is known.* Run 3 left 45 parts unplaced (all `settled: unplaced`) but `calls.plainCards` was 43; the review lists 43 card sections. The two
without a card, "And there's a fascinating endgame" (437 characters) and "And now the really interesting part" (309), both under the last
chat's root, are in `sectionsRegenerated`: their units were sent to the model (through the outline, with the notes' orphaned sections).

*What I tried (all offline, none reproduced it).* The plain sections are found by matching the unit text to the text the merge wrote. I built
the unplaced sections with every block kind the chats use (bold titles with and without notes, bulleted and numbered lists, pipe and tab tables,
code with blank lines, a trailing user quote, `---`, a trailing bold title, a leading bold title), alone and inside the full 116-part mock:
every one matched (46 of 46). Unit-key collisions, topic-id renames (`topicIds.ts`), revisions and `withoutChoices` cannot change a unit's
text in this flow. So the cause is something in the real text or structure that the mock does not have, and I will not claim one.

*Change made (so an unplaced section can never cost a model call because its text read differently).* The merge now also tells the update
**where** each unplaced section sits in the merged text (`composeMerged` returns `unplacedSpans`, offsets) and the update takes the units that start
inside a span as that card, by position (`plainRunsBySpans`); the text match remains as a second pass. Spans are used only when the update reads
the text as it is. A test caught a real off-by-one while I wrote it (a unit's span runs on to the next heading, so membership is "starts inside"),
which would have sent the Pricing example's subsections to the model: `mergeUnplaced.test.ts` covers it.

*Diagnostic added: `plainMissed`.* `diagnostics.plainMissed` lists every unplaced section that did not become a card, with the first 60 characters
and why ("its units are covered by a stored section" or "no unit lies in it"). In the mock it is always empty
(`layoutDReuse.test.ts` "DIAGNOSTICS"; `plainCards.test.ts` for the position rule). If the next live run shows entries, the reason names the case. If
"covered by a stored section" is it, the real cause is a key collision, which would also make the card update an older section's objects: that
needs a separate fix and I did not guess at it. **Still unknown: the cause of the two.**

### 2. Economy import (opt-in, per import, off by default)

*What it does.* `MergeInput.economy` (default `false`; never global). With it on, text **appended to an existing topic** (a section that is already
drawn and whose earlier paragraphs are all still there word for word) is added to that section as **one plain verbatim card per paragraph, with no
model call**: no plan, no analysis, no links. The section keeps every node it has. New topics, unplaced parts, the orphan sections of a dense first
import (they have no drawing to extend), deduplication, provenance, conflict handling and what goes into the notes' text are unchanged and
identical with the flag on or off.
*Where.* `reconcile/plainCards.ts` (`economyCards`: card keys are a hash of the paragraph, so a passage is the same object on every later update),
`reconcile/update.ts` (the grown-section loop: appended-only sections skip `generateSection`; cards pass through the same "keep every current node"
step a model reply does), `merge/merge.ts` (flag, notice, `report.economy`), `merge/compose.ts` (`MergeReport.economy`). Economy cards are **not**
exempt from the plan's node limit (limits unchanged).
*Review and notices say it plainly.* "Economy import: N passages were added to existing topics as plain verbatim cards and were not analysed by AI —
no links or analysis were drawn for them (“A”, “B”, … and N more). Run the import without economy mode to have AI analyse them." It names the mode and
the passages; `diagnostics.economy` lists the sections and card counts. The unplaced notice is unchanged beside it.
*Not done: the switch in the UI.* `VisualizeDialog.tsx` calls `mergeIntoSource(…)` without the flag; a per-import checkbox there is the missing
step (a UI file that the chat-import session may own). Nothing turns economy on today.
*Tests* (`merge/economy.test.ts`, 6; `reconcile/plainCards.test.ts`, 4): **off = current behaviour** (flag left out and `false` give the same change set,
notices and one plan call; every earlier merge test is unchanged and passes); **on** = 0 plan, 0 analysis, 0 outline calls for the appended text,
the unplaced part still a card with no call, the notes' text identical to off, every appended paragraph present verbatim, no removal and every
first-import object kept, the notice and report present, and a second import of the same chats creates and removes nothing.

### 3. New diagnostics (no change in behaviour)

In `MergeDiagnostics` (and `validateVisualPlan(...).overflow`): **`overflow`**: per section that overflowed, how many nodes were folded, into how
many "More from this section" pages, and the cause (`"plan limit"` = the 300 content nodes of the whole plan, or `"section limit"` = 60 in one section);
the sum of pages equals the pages in the change set (tested, and 0 when nodes are roomy). **`planCalls`**: every plan call in order with its kind
(appended / regenerated / piece / new), the section it covered, the source characters it was given and, when the provider reports them, its input and
output tokens: per-section output tokens next to source characters. **`plainMissed`** and **`economy`** as above, and `calls.plainCards`. The next live
run's diagnostics note answers "how many overflow pages and why", "which section did each plan call cover and what did it return per source character".

### 4. The cost script

`node scripts/priceCalls.mjs <stats.jsonl>` prices a saved call log with the spec's constants (chat $0.30 in / $2.50 out per million, Jev $0.042 per
million input, scale 0.8; overridable by the same env vars), by step and task, and `--calls task:n:in:out` prices a hypothetical table,
`--what-if plan=0.75` scales one task's output tokens, `--settled <usd>` prints a billed/list ratio. Everything it prints is labelled ESTIMATE at list
price (and list × scale); billed cost is only the credits figures echoed from the log. Run on the saved logs it gives: run 3 **$0.4642 at list**
($0.3714 × 0.8; first chat $0.1936, merge $0.2705); run 2 (incomplete) $0.4882 at list.
**Billed ÷ list seen so far:** run 2 **0.79** ($0.3837 billed); run 3 **0.92 at the end of the run** ($0.4289) and **0.99 once settled** ($0.4616) — the
end-of-run figure lagged, so the balance should be read after the settle. The 0.8 scale fits run 2 and is about 20 % low for run 3.

### 5. Updated estimates (estimates at list price; not billed costs)

| | run 3 (measured, list) | after the accepted outline fix | + economy mode on (this workload) |
|---|---|---|---|
| First chat | $0.194 (billed about $0.11 at the end of the run) | same | same |
| Merge: Jev | $0.034 | $0.034 | $0.034 |
| Merge: grown sections (15 plan calls) | $0.130 | $0.130 | **$0** (cards) |
| Merge: orphaned late sections (12 plan calls, outline, 9 analysis cards) | $0.079 + $0.005 + $0.023 | about $0.06 (no outline, no analysis block) | about $0.06 (no drawing to extend, so still planned) |
| Merge total | **$0.2705** | about $0.23 | about **$0.10** |
| **Whole import** | **$0.464** (settled $0.4616) | about $0.42 | about **$0.29** |
| vs the $0.45 baseline, at billed/list 0.99 | -0 % | -7 % | **-35 %** |
| same, at billed/list 0.8 (the spec's scale) | | | $0.23, -48 % |

If the first chat is read at the $0.11 billed figure instead of its list price, the economy-mode import is about $0.11 + $0.08-0.10 = **$0.19-0.21
(-53 % to -58 %)**; the two readings differ because the credits balance lagged at the end of the first step. Assumptions: the 15 grown-section calls
are exactly the ones before the outline call in the run-3 log; economy skips all of them (a section that was also edited, not only appended, would
still be planned); the orphaned late sections cost what the 12 post-outline calls cost less the analysis block (about 15 %, unmeasured). The mock cannot
show real replies, so none of this is verified by a run.

### 6. Tests and checks

`npx vitest run`: **2,152 pass, 2 fail, 4 todo**; the 2 failures are the known `provenanceGuard` pair (only `testUtils/repoMapWorld.ts`), not regressions.
`tsc --noEmit` and `eslint src scripts`: clean. New: `economy.test.ts` (6), `plainCards.test.ts` (4), `layoutDReuse.test.ts` +1 (diagnostics), the
dense-first-import test kept, and the truncated-reply test kept.

### 7. Still unknown

- **Why two unplaced parts of run 3 were not cards** (see 1): `plainMissed` will say.
- The real overflow-page count and cause in a run (the diagnostics are in; no run has used them).
- What a plan reply is made of (nodes, links, analysis, retyped text): needs the approved tiny capture; the held prompt changes wait on it.
- The first chat's true billed cost (the end-of-step credits figure lagged), and the billed/list ratio (0.79 to 0.99).
- Whether economy cards read well on the canvas when a section gets many of them (they are plain text cards under the section, no links).
- Economy mode has no UI switch yet.

## Economy-mode checkbox (offline, 2026-10-10)

`VisualizeDialog.tsx`: when merging, an unchecked-by-default checkbox "Add new text as plain cards, no AI" (state reset on every open, never remembered); checked, it shows the notice "Text that joins an existing topic is kept word for word as plain cards. AI does not organise or link it, and the review says which passages were left that way. New topics are still organised by AI." and `runMerge` passes `economy: true` through `withEconomy` (`src/components/ai/economyOption.ts`; off = the very same input object). Tests: `economyOption.test.ts` (3), `e2e/local/economyImport.local.spec.ts` (3: off by default / merge-only / notice; merge without it; with it: no plan/analysis/outline call, text verbatim in the source, nothing removed, a repeat says "already in your notes" and adds nothing). The local tier has no AI, so the e2e cannot show the economy path itself (diagnostics.economy stays empty there); that path is covered by `src/ai/merge/economy.test.ts`. tsc and eslint clean; vitest 2155 passed, 2 failed (the known provenanceGuard pair), 4 todo; local e2e 7/7 across chatShare, topicMerge, economyImport.

## Benchmark run 4 (2026-10-11): economy mode ON — correctness passed, cost target MET

Same three links, Gemini 2.5 Flash + Jev, cap $0.40 (not reached), one run, no retries; data `data/benchmark-2026-10-11-run4-economy.stats.jsonl`. 194 calls, 0 failed, 2.6 min. (A first launch attempt failed before any call because of a stale Next dev cache, which was cleared; nothing was spent.)

**Billed (settled /credits delta): $0.2527** (at the end of the run $0.2218: first chat $0.1315, merge $0.0903; those under-read because of lag). Provider-reported tokens at list price: $0.253. Baseline $0.45 billed / $0.47 estimated; target under $0.28 → **met, about 44% below $0.45**.

Correctness: `removals` [], `plainMissed` [], review "+102 new · ~1 updated" (no removals), 18 existing topics extended, 640 passages left out as repeats, 14 sections reused, outline fix held (merge made 1 small outline call, $0.001, and 1 analysis call), 7 plan calls ($0.047), 6 Jev batches/116 decisions ($0.034). Economy: 12 sections got 48 passages as 466 plain verbatim cards, 0 plan calls for them.

Cost of the trade: all 12 economy sections folded their cards into one "More from this section" page each ("plan limit"; 1–121 cards per section, 12 pages). `calls.plainCards` 42 vs 43 unplaced in the toast: one-off gap, `plainMissed` empty, not explained. Whether 466 cards read well on a canvas is not assessed.

## gpt-oss-120b comparison attempt (2026-10-11): FAILED at the first chat's outline call — no comparison possible

Same workload as run 4 (economy on, Jev on), `openai/gpt-oss-120b`, cap $0.15 (conservative prices $0.15/$0.75, scale 1). Data: `data/gpt-oss-120b-2026-10-11-failed-first-outline.stats.jsonl`. Result: `find_revisions` ok (3.4 s), then `outline_document` (8.3k tokens in) got **504 after 120.7 s** (the task's 120 s limit), no retry; the app never showed the review bar and the spec waited its full timeout (15.1 min total). Billed: about $0.0017 (balance delta 5.176131 → 5.177814). Same pattern as the earlier gpt-oss-120b runs (slow outline, 504). Gemini 2.5 Flash needs about 25 s for the same call. Not established: whether a longer timeout, low reasoning effort or a pinned fast provider would complete it; routing was left to OpenRouter (provider unknown).

## Deterministic-pipeline optimization, offline phases 0–2 (2026-10-11)

No live call, nothing committed, `chatShare/*` and `e2e/ai/chatShare.spec.ts` untouched, economy and subsection-refinement defaults unchanged. **None of the savings below is measured**; each needs a live comparison before it is claimed.

**Phase 0, measurement.** `src/ai/usage/callLog.ts` (in-memory, dev only, no content) records one entry per provider call: stage, role, provider, model, attempt (1, or 2 for a schema repair / follow-up round), outcome (`ok`, `invalid`, `error`, `unsure`), reported prompt/completion/reasoning tokens, ms, and a note derived from the request (`noteOf`: a plan's kind `new|piece|appended|update|analysis_retry|regenerate|dense`; an analysis patch's gaps `takeaway|analysis|items|structure`). `createAIRuntime` takes `onCall`; typed decision-model calls (Jev) are recorded too, with an extra `unsure` entry when the chat model is asked instead. Read with `__acuteDev.callStats()`. Costs are list-price estimates (same constants as `scripts/priceCalls.mjs`); the saved Run 4 log reprices to $0.2528 with that script. Limitation: only Copilot and the typed decision models report usage in the app; other providers' tokens are only visible in the e2e network capture.

**Phase 1, analysis patch.** Run 4's 26 patch replies were 169–1,289 output tokens (about 570 on average), too large for takeaway-only patches, so the plans mostly lacked their own `origin:"analysis"` nodes. That is semantic text, so no mechanical fix was applied. Prompt-only change (`visualize/tasks.ts`): the plan prompt's JSON shape now shows the same analysis node the patch prompt shows, only where `analysisRule` is asked for (outlined section, not dense, not an update, not a piece). `analysisRule` was not moved (every other rule precedes the content, and a test pins the content as the prompt's end). Offline tests prove the prompt text and its schema consistency, **not** that the model follows it; the change may also add plan output tokens. Whether patch calls fall is unknown until a live run (the `analysis_patch:*` and `plan:*` notes will show it).

**Phase 2, appended blocks by reference.** The first-run path already numbers and expands every block kind (`[T]` tables, `[L]` lists and checklists, `[C]` code, `[P]` paragraphs; `fidelity/sourceBlocks.ts`, `REFERENCE_RULE`, `expandSourceRefs`), so no new representation was needed. The gap was the update path (this document's option B1): a section that only had paragraphs appended was planned from un-numbered text, and a `{"type":"source"}` reply there was not expanded.
- `reconcile/appendedRefs.ts`: `numberAppended` numbers the appended blocks; `resolveAppendedRefs` expands references (existing `expandSourceRefs`) and, only when the reply used a reference (or an unknown one), runs the existing content safety net `attachUncovered` on the appended text. The update path had no safety net before, so without this an unknown reference, or a reply of references that leaves a block out, would have dropped content. A reply that references nothing is handled as before (only block numbers the model copied into its text are removed).
- `reconcile/update.ts` (`updateOutlined`): for an `appended` request only, the plan call gets `numbered`. `visualize/tasks.ts`: `APPENDED_REFERENCE_NOTE` follows `REFERENCE_RULE` for appended requests: a block that adds to what an existing node already describes (another table row, another list item) is not placed by reference but replied as that node in full. `changedInput`, edited sections, the forced-template update path, economy mode, merge assignment and outline grouping are untouched.
- Tests (`merge/appendedRefs.test.ts`, 8): written first; against the old code 7 of 8 failed (the model's references were dropped, so the paragraph, list, table, checklist and code were missing from the change set). With the change all pass: the appended prompt shows `[P1] [L1] [T1] [L2] [C1]` and the note; a paragraph, a list, a table (exact columns and rows), a checklist (exact items and checked state) and a code block (language and source) each appear once, in source order, with stable keys; a node's own title is kept; the same reply gives an identical change set; every first-import object stays and no removal is proposed; an unknown reference and a block the reply leaves out are attached verbatim; a reply with no references adds nothing (`src~` absent). One existing assertion changed on purpose (`outlined.test.ts`): the appended request's content is now `[P1] <paragraph>`, not the bare paragraph.
- Results: full unit suite 2,176 passed, 2 failed (the known `provenanceGuard` pair, which flag `testUtils/repoMapWorld.ts` and predate this work), 4 todo; `tsc` and `eslint` clean.

**What is now referenced instead of retyped (when the model chooses to):** blocks of paragraphs appended to an already-drawn topic in a merge with economy off, of every kind. Still retyped: a fact that folds into an existing node, edited paragraphs (the `update` request), the forced-template update path, and anything the model chooses to retype.

**Estimate (list prices, from saved data, not a measurement).** Run 4 ran with economy ON, so its 7 merge plan calls ($0.047) were not appended requests (appended text became plain cards, 0 plan calls): **this change saves nothing in the Run 4 configuration**. In Run 3 (economy off) the merge made 27 plan calls, 69,460 output tokens, $0.2095 list ($0.174 of it output). If 10–25% of that output is retyped appended content (this document's own B1 range, never measured), the avoidable output is about 7k–17k tokens, **about $0.017–$0.043 list**, less the added input (about 330 tokens per appended call, roughly $0.002 for 17 calls). It applies only to merges with economy off; the real share is unknown until the per-note call log is read from a live run.

**Remaining limitations:** whether the model replies references (and not retyped nodes, or a node per fact) cannot be tested offline; a fact placed beside an existing node instead of folded into it would be a quality regression the mock cannot show; placed blocks arrive as one node per block (a long list is one `text` node), unlike a model's finer cards; unknown-reference warnings are not surfaced in the update review (content is kept, silently, by the safety net).

## Phase 3: Jev topic shortlist (offline, 2026-10-11) — implemented behind a flag, default off; the saved evidence does not support turning it on

No live call, nothing committed, `chatShare/*` and `e2e/ai/chatShare.spec.ts` untouched; Phase 0 call log, Phase 1 prompt change, Phase 2 reference handling and economy mode unchanged. **No saving is claimed.**

**What Jev receives today** (`assign.ts` `assignToTopicsDecision.buildRequest`): one request per part, each with `state.topics` = every topic (id `t{n}`, label, an excerpt of `clamp(16,000 / topics, 400, 3,000)` characters), `new_content` (+ `new_content_under`), and a choice over every topic plus `new`; three questions per part (`_topic`, `_relation`, `_nothing_new`). Round two (`followUp`) asks about contradictions for parts whose `_relation` says contradicts. `unsure` is not a choice: a topic answer under 0.5 confidence is `unsure`. `interpret` and `followUp` index topics by their original `t{n}` id.

**Implementation (the smallest change the plan supports: its phases 1-2).**
- `merge/topicIndex.ts`: lexical BM25 (conventional k1 1.2, b 0.75, untuned) over the part with its headings against each topic's label and text (the `bm25+ctx` variant, the best measured); k = 8 (the plan's starting value, no other supported); plus every topic tied with the k-th, the part's same-heading topic, the topic its parent heading names, and the topics of its siblings' own headings (siblings from headings only: no sibling is answered yet when requests are built). **No score threshold**: the full list is shown when no topic has any overlap, when the shortlist would cover every topic, or when there are at most k topics.
- `assign.ts`: `AssignInput.shortlist` (optional, off). A shortlisted request shows each chosen topic exactly as a full request would (excerpt length from the full topic count), with its original `t{n}` id, and a choice over those plus `new`. In `followUp`, any shortlisted part whose answer is not a confident existing topic (`new`, confidence under the existing 0.5, or no answer) is asked again with the full list; a low retrieval score is never read as "new" or "unsure". A re-asked part whose full-list answer calls for the contradiction round has no round left, so `interpret` hands the merge to the chat task (the existing "no pair" rule), which is safe but costs a chat call. `merge.ts`: `MergeInput.shortlist` passes the flag; off, every request and result is identical to before (all 131 existing merge tests pass unchanged).
- Tests: `topicShortlist.test.ts` (17): recall of the named topic, determinism, same-heading/parent/sibling inclusion (2 retrieved + 2 context-only in the fixture), widening (no overlap, ≤ k topics, shortlist = all, flat ties), a no-overlap part's request shows every topic and a choice over all plus `new`, request shape (original ids, same excerpts as a full request), off = unchanged, the re-ask rules (kept / `new` / low confidence / no answer / already-full), contradiction round kept for a confident shortlisted part, and through the runtime: a part new from the shortlist but confident from the full list ends with the full-list topic, a genuinely new part stays `new`, an uncertain one stays `unsure`, shortlist off = one request per part and no second round. `shortlistReplay.test.ts` (2): the replay below.

**Replay on the saved layout D assignment** (34 topics, 116 parts in merge's batches of 20, Jev's saved full-list answers; the saved data has headings and sizes only, so this measures a shortlist built from headings, context and the parent/sibling rules, not content retrieval):

| Measure | Result |
|---|---|
| Recall: Jev's confident topic among the topics shown | 29 of 70 confident answers (41%); all 29 are real shortlists (no part was shown the full list at once) |
| Structural candidates alone (same heading, parent, sibling heading) | 13 of 70 (19%) on layout D; 1 of 68 (1%) on the 95-topic layout: Jev's choices are mostly semantic, not heading matches |
| Fallback: shown the full list at once | 0 of 116 |
| Fallback: re-ask with the full list | at least 46 of 116 (40%, the parts Jev itself was unsure about even with every topic); up to 87 (75%) if the 41 confident parts the shortlist missed also fail |
| Assignment agreement | **not measured**: needs Jev on shortlist requests (plan phase 4). Recall is only an upper bound, and a topic being in the shortlist is not evidence Jev would pick it. The plan's bar is the same topic as the full list on at least 95% of confident answers |
| Input tokens (saved per-request tokens, scaled by the characters a shortlist request keeps: 29% of a request on average; the baseline reproduces Run 4's 798,649) | baseline 798,710; with re-asks counted: 551,577 (-31%) if only the 46 certain parts re-ask, 833,524 (+4%) if every miss also re-asks. The plan's target was -70% |

Earlier content-based measurement (`data/shortlist-recall-2026-10-10.txt`, the 95-topic layout, 78 confident answers): bm25+ctx recall @8 55%, @12 60%, @20 71%, @30 77%, median rank 6; on layout D, 9 parts that repeat one topic: 100% @1-@3.

**Findings.** (1) Lexical retrieval alone does not reach the plan's 95% bar on either measurement (41% headings-only on layout D, 55% with content on the old layout), and widening on every non-confident answer means the unsure parts (40% of parts on layout D, 71% on the old layout) pay twice. (2) The saving is therefore between about -31% and +4% of Jev input on layout D, not -70%, and Jev input is only about $0.034 of Run 4's $0.2527, so even the best case is about $0.01. (3) Enabling it is not recommended. What would change this: embedding retrieval (the plan's phase 3) with its recall measured first, or the plan's phase 0c (does Jev cache a shared topic prefix? it would save the repeated topic list with no change to answers). Neither is attempted here.

**Limitations.** The replay has no chat text (headings and sizes only), so content retrieval on layout D is unmeasured; agreement and confident-wrong answers (Jev picking the best available topic when the right one was left out, with high confidence) cannot be measured offline and are the main risk of enabling; the token model assumes tokens scale with request characters; BM25 parameters are the conventional defaults; contradiction detection for a re-asked part falls back to the chat task. Tests: full unit suite 2,195 passed, 2 failed (the known `provenanceGuard` pair: `testUtils/repoMapWorld.ts`, which predates this work), 4 todo; `tsc` and `eslint` clean.

## Phase 0c: Jev prefix-cache test (live, 2026-10-11) — no caching or billed discount found

Approved scope: the lean variant, five requests in order, no retries, cap $0.005, saved layout D fixture only (headings, sizes, filler; no real notes or chat text). `src/ai/contractTests/jevPrefixCache.contract.test.ts` (new, gated by `JEV_PREFIX_CACHE_APPROVED=1`, not part of `npm test`; no application code changed) sent raw requests with production's body (`jevRequestBody`) to `typesafe/jev-1.13` and kept the whole `usage` object. Raw data: `data/jev-prefix-cache-2026-10-11.json`. Reported spend **$0.002622** (cap $0.005; the fixture's filler words tokenize at about 12.1k input tokens per request, not the real runs' 6.9k, so it cost more than the $0.0015 estimate; the ratios below do not depend on that). Account credits were not cross-checked.

Interpretation of "lean 5": cold A, warm B, control (first topic's text changed), then a concurrent pair of A (byte-identical to the first request) and C on the warm original prefix. A burst on a *cold* prefix was not tested.

| # | Request | Input tokens | Reported cost | Cost per input token | Cache fields | Latency | Answer |
|---|---|---|---|---|---|---|---|
| 1 | cold A | 12,134 | $0.000509628 | $4.2e-8 | none | 1,050 ms (first connection) | t11, 0.79 |
| 2 | warm B (same topics) | 12,321 | $0.000517482 | $4.2e-8 | none | 531 ms | t1, 0.31 (unsure) |
| 3 | control A, first topic changed | 12,132 | $0.000509544 | $4.2e-8 | none | 552 ms | t11, 0.88 |
| 4 | burst: A repeat (identical to 1) | 12,134 | $0.000509628 | $4.2e-8 | none | 538 ms | t11, 0.89 |
| 5 | burst: C | 13,712 | $0.000575904 | $4.2e-8 | none | 705 ms | t1, 0.62 |

- **Evidence of caching: none.** `usage` holds only `input_tokens`, `output_tokens` and `cost`; no key anywhere mentions a cache (response headers: `x-generation-id`, `x-provider-name: TypeSafe`).
- **Billed cost is exactly linear in input tokens**: cost = input tokens × $0.042 per million for every request (output tokens are not billed). Warm / cold cost per input token = 1.000 (threshold: at most 0.60). Request 4, byte-identical to request 1 and sent after it finished, cost the same, so not even an exact repeat was discounted.
- **Control** (changed prefix) matches the others, so it shows no hit either; with no hits anywhere it validates nothing positive.
- **Latency**: no signal (warm 531 ms, control 552 ms; the first request carried connection set-up).
- **Answer stability**: A selected t11 in the cold run, the control and the repeat. The repeat is byte-identical to the cold request, yet its confidence differs (0.79 vs 0.89): Jev's confidences are not deterministic for identical input, by at least 0.10 here. Recorded, no threshold invented. Any later recall or agreement replay should expect this noise near the 0.5 "unsure" cut.

**Classification and recommendation.** Caching is not demonstrated, and the reported billing shows no reduction for any request, including an exact repeat, so the projected saving on this evidence is $0 against the $0.01 per import bar. Not tested: a cold concurrent burst, cache lifetime, and whether the credits balance agrees with `usage.cost`. The burst-serialization latency question is moot without a discount. Stop optimizing Jev: leave the topic shortlist off; embedding retrieval remains a later, evidence-gated option only.

**Housekeeping decision (2026-10-11).** The Phase 0c test file is kept, isolated and opt-in, as a reproducible baseline: it runs only with `JEV_PREFIX_CACHE_APPROVED=1` through `vitest.contract.config.ts`, and the default `vitest.config.ts` excludes `**/*.contract.test.ts` (checked: the default suite is unchanged at 214 files, 2,195 passed, the 2 known `provenanceGuard` failures). The raw usage data and this section stay so a future provider or endpoint change can be compared against it. What the result does and does not say: no evidence of caching, and no billed discount, on the tested endpoint under these conditions; it does not prove caching is impossible in every configuration. That uncertainty is not a reason to spend more now: no rerun, no production change, the shortlist stays off, and Jev optimization stops for now.

## Economy-mode import quality audit follow-ups (offline, 2026-10-11)

Audit result: every economy card (466 live, 479 in the offline layout D world) lives only as text in "More from this section" pages, because the first import already fills the plan's 300-node cap (283 content nodes plus 20 section titles once the plan is read back flat), so a merge has zero capacity; AI-planned appended text folds the same way. The `calls.plainCards` 42 vs toast 43 gap is a parts-versus-sections definition difference whose live cause was not reproduced offline. Decision: keep the 300-node cap; alternative budgets are deferred (`plan-node-cap-design-note.md`).

Changes (no model call, no cap change, no schema change):
- *Economy cards keep blocks whole* (`reconcile/paragraphs.ts`, `reconcile/plainCards.ts`, `content/fences.ts`): paragraphs split on blank lines outside fenced code only; `#` lines inside a fence are no longer dropped as headings (the old split deleted shell comments from the cards); a loose list is one card; the economy diagnostics count cards, not paragraphs. Tests: `reconcile/fenceSplit.test.ts` (17).
- *Overflow pages* (`visual-plan/repair.ts`): a page title names its section ("More from this section — <label>", "(2 of 3)" for several pages; a plan without sections keeps the plain title); overflow pages are chunked fence-safely so a fenced code block is not split across the 20,000-character pages. Tests: `visual-plan/overflowPages.test.ts` (9; the fold-level test fails with `fenceSafe` switched off).

Remaining limits: a single code block over one page is still cut; other `chunkText` callers are not fence-aware; passage boundaries inside a page need a notes-text marker or a schema field and were not added; the audit ran on filler text, so readability on real content is unjudged.

Tests: the full unit suite passes except the known `provenanceGuard` pair (`testUtils/repoMapWorld.ts`, predates this work). Separately, `merge/layoutDReuse.test.ts` intermittently hits the default 5 s test timeout under full-suite load (its heavy tests take about 2.8 s alone; the timing is identical with and without these changes); the timeout was deliberately not raised.

## Capacity-aware merge planning, behind economy mode (offline, 2026-10-11)

Finding (Run 4's saved `merge diagnostics`): all 7 merge plan calls were kind `new` ($0.0470, plus 1 outline $0.0009 and 1 analysis $0.0015 = $0.0494 list, about $0.0435 billed). The sections are first-import sections folded into pages (orphans: no stored section holds them, so economy mode, which needs a representation, could not treat them as appended) and new topics. The log shows 19 overflowed sections (12 economy with 466 cards, 7 AI-planned with 151 folded nodes), not 12; frames after the merge were 62 = 20 + 42 plain cards, so none of the 7 got a frame. The first import already fills the 300-node cap, so every node a merge adds folds into a page, and the model's plan for these sections only produced pages.

Change (economy mode and append-only merges only; defaults, the 300-node cap and economy-off behaviour unchanged):
- `reconcile/capacity.ts` `everyAddedNodeFolds(retained, existing)`: asks the real `foldOverflow` (limits from the new shared `NODE_CAPS` in `visual-plan/validate.ts`, same values as before) whether a probe node in a section of its own folds. Folded means no node added in any section can be kept (existing nodes are counted first, plain cards and frames never are, and the count only grows). It answers false (plan as before) for nothing retained, frames, nodes with a parent, or a probe-key clash.
- `reconcile/update.ts` `updateOutlined`: before any plan call, `noRoom` = oracle over the nodes the plan will certainly keep (the unchanged sections' and those of a section that only has paragraphs appended). Fewer nodes than the real plan keeps is safe (it can only say "room left"). If `noRoom`: (a) an orphan section that is a pure append gets the existing economy cards of its WHOLE current text (corrected in the review below: the first version added only the appended paragraphs, which lost the earlier text from the canvas); (b) new sections are added with the existing `plainCards` path, one section per unit and without the plain marker, so they fold into the section's page exactly as the planned ones did and the canvas holds no more objects than before. Regenerated sections, edited orphans, and every case with room are untouched and planned as before.
- Diagnostics: `UpdateResult.planSkips` / `MergeDiagnostics.planSkips` list each skipped section with its path (`orphan` or `added`) and units. (Corrected in the review below: skipped sections have their own notice and are not counted as economy cards.)

Offline result on the saved layout D world (dense first import, economy on, two parts called new): before, 3 plan calls and 1 outline call; after, none (only the 6 assignment calls); skipped: 2 orphans ("And this creates a potentially massive moat", "Roblox for software.") and 1 new section ("Block Runtime"). Same page count (18), plan nodes (430) and frames (66); fewer nodes folded (143 to 79) because verbatim cards replace the model's restructured nodes and analysis lines. The notes text, the merge report, conflicts and removals are identical with the oracle on or off. Roomy first import: nothing skipped. Economy off: identical change set with the oracle on or off. Tests: `merge/capacitySkip.test.ts` (9). Full unit suite: only the known `provenanceGuard` pair fails; `tsc` and `eslint` clean.

Estimated saving (not measured): at most about $0.0494 list (about 17 to 20% of Run 4) in a Run 4-like merge, less if some of the 7 sections are edited orphans or have room. What is given up: the model's restructuring, analysis lines and links for content that was folded into an unmarked page anyway. Open: the live number of calls skipped; whether re-planning an orphan's whole text had duplicated its first-import page (the skip adds only the appended paragraphs).


### Review of the capacity-aware skip (offline, 2026-10-11): two fixes, one pre-existing bug found

Fixed in the skip:
- *Unreadable charts.* Validation drops an `acute-chart` node whose data is invalid as soon as the plan holds a table, before it folds anything, so a count of exactly 300 could hide room (298 text nodes and 2 such charts: the oracle said "no room", yet a merge adding a table kept 2 new nodes). `isUnreadableChart` is now shared by validation and the oracle, which leaves those nodes out of the retained count. A schema-invalid or empty stored node cannot be dropped at fold time (a stored plan was validated already), so charts are the only pre-fold removal that matters.
- *Orphans are added whole.* The first version added only an orphan's appended paragraphs, on the premise that its earlier text was already on the canvas in the first import's page. That page is overwritten by the merge (next item), and the earlier text had 0 of 48 and 0 of 149 words left in the merged plan (the planned run kept 47/48 and 135/149, because the model re-plans the whole text). The orphan route then added the section's whole current text as verbatim cards (as planning did). After the overflow-page key fix below, the first import's page survives, so that would show the earlier text twice, and the route is back to adding only the appended paragraphs. Still only for a pure append.
- *Notices.* `report.economy` and the "Economy import" notice no longer count skipped orphans: they said "Run the import without economy mode to have AI analyse them", which is wrong when the plan is full. Skipped sections (orphan or new) have their own notice, "The plan's 300-node limit is full, so AI was not asked to plan …", and `report.planSkipped`; `planSkips` entries also carry `cards`.

Oracle evidence: over 22 real merges (first imports of 111 to 308 nodes, economy on, with and without new topics) the retained count never exceeded what the real fold counted, and whenever it said "no room" no new node survived. It is conservative, not exact: it retained 304 where the real fold counted 320 (the re-created title headings of changed sections also count), so with a first import of 284 to 299 nodes it can say "room left" when none is (a missed saving, never a wrong skip). The committed test (`merge/capacitySkip.test.ts`, 18 passing) runs 4 of those worlds.

**Found, pre-existing, not caused by the skip: a merge overwrites the first import's overflow pages.** Overflow pages are created without a key, so `ensureStableKeys` gives them positional keys (`page#0`, …), the same keys the first import's own pages have. The merge therefore *updates* those pages in place (5 `update_block` changes in the dense world, 0 removals) with other sections' content, and the old pages' content is nowhere in the plan. It happens with the skip on or off and in the planned path. It is probably the "~1 updated" in Run 4's review (Run 4's first import had folded sections). Two `it.fails` tests document it; they will start failing once overflow pages get section-scoped keys, which is the likely fix (a page's key derived from its section, as every other node's already is). Fixed in the next section (2026-10-11).

Savings, restated: the offline dense world removes 3 plan calls and 1 outline call; Run 4 had 7 plan calls, 1 outline and 1 analysis call ($0.0494 list, about $0.0435 billed). These are different measurements. The saved log cannot say how many of Run 4's 7 calls were orphans (pure-append or edited) or new sections, nor whether the oracle would have said "no room" at that point, so **$0.0494 is an upper bound, not an estimate**. The two smallest calls (811 and 427 characters) look like new sections (Run 4's single outline call was small); the five larger ones look like orphans. A live run's `planSkips`, `planCalls` and a recorded "no room" flag are needed to say; the next change to measure it should add that flag to the diagnostics.


### Overflow-page keys (offline, 2026-10-11): a merge no longer overwrites the first import's pages

Cause: `foldOverflow` created "More from this section" pages without a `stableKey`, so `ensureStableKeys` gave them positional keys (`page#0`, `page#1`, …) in plan order. The pages the first import had kept those keys in the stored plan, and the previous plan's pages are not in the plan a merge validates (an orphan's page is not reused), so nothing made the new keys unique against them. Reconciliation matches a node to an existing object by key, so the merge's first page took over the first import's `page#0` in place: 5 `update_block` changes in the dense world (0 removals) and the old content nowhere in the plan. It happened with the capacity skip on or off, in economy mode or not; probably the "~1 updated" in Run 4's review.

Fix (`visual-plan/repair.ts` `foldOverflow`; no cap, schema, or merge-logic change): a page's key is `more~<section>~<n>`. The section is the flat section's key, or a frame's key without its `§ group#0` suffix, so a section is the same section in a framed first-import plan and in a later flat one (a frame without a key falls back to its id, a plan without sections to `plan`); long keys are shortened with a hash as the ids already were. `n` continues after the highest existing page of that section (from the `existing` keys an update passes), so an update adds a page and never takes over one. The key has no `§` separator, so `unitOfKey` still reads a page as belonging to no section and frames, regrouping and orphan detection are unchanged. Stored plans: nothing is migrated; legacy `page#N` pages keep their keys and no new key can equal one. New first imports store pages under the new keys.

Offline result (dense layout D world): the 5 first-import pages are intact (same key, same content) in all three modes (economy on with the skip, economy on without it, economy off); `update_block` 5 to 0; the merge's 20 pages are `create_page`; no removals; no duplicate keys. The same input gives the same page keys and contents, and a second identical import adds or updates nothing and removes no page. Tests: `visual-plan/overflowPages.test.ts` (key scheme, numbering after existing pages, legacy keys, frame vs flat sections, determinism) and `merge/capacitySkip.test.ts` (the two former expected-fail bug tests are now ordinary regression tests, plus idempotence and the orphan duplication check). The orphan route is back to appended-only because the earlier text now survives in its page; the whole-text variant duplicated it (135 of 149 words twice), and the planned economy-off path does the same for an orphan it re-plans, which the overwrite used to hide (unchanged behaviour of that path, now visible).

The separate frame removal found here is fixed in the next section.

Test cost: the capacity tests memoize identical runs (the file takes about 26 s instead of 45). `merge/layoutDReuse.test.ts` still times out intermittently at the default 5 s under full-suite load; its timeout was not changed.


### A repeat import no longer proposes removing section frames (offline, 2026-10-11)

Symptom: an identical second import of the dense layout D world proposed removing 3 section frames (`el_g17`–`el_g19`, the sections "And this creates a potentially massive moat", "I'd actually change the original idea slightly", "A platform for creating personal software."), with economy mode on or off, with the capacity skip on or off, and with the old positional page keys: it was not caused by the page keys, the skip, or economy mode.

Trace: in the first import each of the three frames held one member, the overflow page its section's content had been folded into (linked by `parent`). A merge compares and stores its plan flat and then stores it grouped again by section (`regroupSections`), where a node becomes a member of the frame its key's section names. An overflow page names no section, so the three pages became loose and the frames were stored with no members (merge 1's stored plan: 66 frames, those three empty). Reading a stored plan drops a frame with no members, so merge 2's previous plan had no such frames, while the frames were still on the canvas and in no plan, and reconciliation proposed removing them. Merge 1 itself showed no removal, because it compared against the first import's plan, which still had them.

Fix (`visualize/outlined.ts` `regroupSections`; nothing else): a node that names no section of its own keeps the frame it was in in the previous stored plan (by its key; a frame that is no longer a section, a new page, or a node never in a frame stays loose, and a node's own section still wins). No change to page keys, the 300-node cap, or the merge logic.

Offline result: the second identical import proposes no creation, update or removal in all three modes (economy on with and without the skip, and economy off), and the stored frame count is the same after both merges (66). Merge 1 itself is unchanged: its change set, notes text, report, node count and frame count are identical with and without the fix (A/B); the only difference is that 4 more nodes keep their frame in the stored plan. Tests: `visualize/regroupSections.test.ts` (6, including the old behaviour as the root-cause demonstration) and `merge/capacitySkip.test.ts` (the former expected-fail test is now ordinary tests for the three modes, plus a check that every first-import page stays in its frame). No expected-fail tests remain in the capacity suite.


## Benchmark run 5 (2026-10-11): the cumulative offline work, measured live against run 4

Approved single run, same recipe as run 4 (Gemini 2.5 Flash on OpenRouter, Jev typed decision model, economy ON, the same three links, cap $0.40, not reached), data `data/benchmark-2026-10-11-run5-capacity-skip.stats.jsonl`. Code since run 4: the Phase 1 plan-prompt change, the fence-aware economy cards, section-named overflow pages, the capacity-aware skip, section-scoped overflow-page keys, and the frame regroup fix. The spec's hard assertions passed; 176 calls, 2.3 minutes.

| | Run 4 | Run 5 | Change |
|---|---|---|---|
| **Settled billed** | $0.2527 | **$0.2258** | -$0.0269 (-10.6%) |
| List price (provider tokens) | $0.2528 | $0.2264 | -$0.0264 (-10.4%) |
| First chat, list | $0.1699 | $0.1423 | -$0.0276 |
| Merge, list | $0.0829 | $0.0840 | +$0.0011 |

By stage (list): first-chat analysis patches 26 calls, $0.0563 to **12 calls, $0.0246** (-$0.0317); first-chat plans 30 calls / 29.4k output tokens, $0.1060 to 25 calls / 32.0k output, $0.1078 (+$0.0018); first-chat outline $0.0059 to $0.0085; merge Jev unchanged (116 requests, 798,649 input tokens, $0.0335); merge plans 7 calls $0.0470 to **9 calls $0.0494**; merge analysis 1 call to none.

Correctness: removals 0, `plainMissed` empty, "Nothing lost", key terms 31 of 37 (same), frames 20 then 62 (same), 18 existing topics extended. The merge review read "+102 new, ~1 updated" in run 4 and "+125 new" with no update in run 5: consistent with the overflow-page overwrite fix (the "~1 updated" was probably an old page being rewritten), not proven. The workload was not identical: Jev and the model are not deterministic across runs (44 passages unplaced vs 43; 635 repeats left out vs 640; 11 sections reused vs 14; 9 economy sections with 433 cards vs 12 with 466; one section regenerated that run 4 handled as economy cards), so merge-side numbers are indicative only.

What this shows (one run each; no variance is known):
- **The saving is in the first chat and fits the Phase 1 prompt change**: patches per plan call fell from 26 of 30 (87%) to 12 of 25 (48%), plan output grew only 8%. Not isolated: the first chat's outline also differed (2.4k vs 1.4k output tokens, 25 plan calls instead of 30), which alone lowers the call count, so the size of the Phase 1 effect is uncertain.
- **The capacity-aware skip did not fire**: `planSkips` is empty and the merge made 9 plan calls (8 new, 1 regenerated), so it contributed $0 here. Overflow was still "plan limit" for all 17 sections, so the plan was full; the check answered "room left" or an unsupported shape. The likely cause (unverified, no diagnostic recorded it): the oracle counts only nodes the plan will certainly keep, and a regenerated section's nodes are excluded, which with the first import at about 303 flat nodes can bring the count under 300. Offline the same conservatism showed (304 retained vs 320 counted at the fold). The next change should record the retained count and the oracle's answer, and could decide the new-section (`added`) path after the changed sections' replies are in, when the count is exact.
- Jev was identical, as expected (a deterministic request set).


### Capacity-check diagnostics (offline, 2026-10-11): what the check saw next to what the fold counted

Added after run 5, where the capacity-aware skip did not fire. Diagnostics only: the check's answer and every skip decision are unchanged (all earlier tests pass as they were).

- `reconcile/capacity.ts`: `everyAddedNodeFolds` takes an optional callback and reports a `CapacityCheck`: `answer` (`folds`, `room` or `unsupported`), `reason` when unsupported (nothing retained to count; frames or nodes with a parent in the plan; the probe key is a real key; the fold threw), `cap` (300), `retained` (nodes it was given), `unreadableCharts` (given but left out, because validation drops them once the plan holds a table), `counted` (what the real fold counted among them; plain cards and frames are not), `projected` (`counted` + 1, where the probe stands) and `probes` (1).
- `foldOverflow` and `validateVisualPlan` return `existingCounted`, the real fold's own count of existing nodes, so nothing restates its counting rule.
- `UpdateResult.capacity` / `MergeDiagnostics.capacity` (economy, append-only merges only): the check's record plus `reusedNodes`, each changed section (its stored nodes, whether the check counted them, and why: only paragraphs appended; regenerated; no stored nodes of its own), `changedTitles` (the changed sections' titles, made again under the same keys), and `actualCounted` (what the plan's real fold counted as existing).

What it shows offline (saved layout D world, economy on, tests in `merge/capacitySkip.test.ts`): the check's count never exceeds the fold's, and the difference is exactly the nodes of the changed sections it left out plus those sections' re-made titles, nothing else: first import of 305 nodes, `folds` (retained 304, actual 320, gap 16 = 16 titles); just under the cap (284), `room` although the real fold found the plan full (retained 288, actual 304, gap 16 = the titles); roomy (111), `room` (115 vs 131). A regenerated section is listed as left out with its node count and why, and the gap then equals those nodes plus the titles. Existing overflow pages are in neither count. So the cause of a missed skip is now visible in one record, and in these worlds the missing part is the re-made titles, not regenerated sections; for a live run the record will say which applies.

Not done, on purpose: counting the re-made titles (or anything else) in `retained`. The record is evidence for that change; the decision logic was not touched. A live run now answers "did the check fire, and if not, what did it miss" from `diagnostics.capacity` alone.


### Capacity check: titles counted, and a recheck after the replies (offline, 2026-10-11)

Two separate changes, each tested alone (turning one off fails only its own tests). The cap, economy defaults and the skip's scope are unchanged; the live behaviour of these two is not measured yet.

1. **Titles of counted sections** (`update.ts`, `titlesCounted` in the diagnostics). A section that only had paragraphs appended keeps every node it has, so its previous title node (`<section> § group#0`, which `wrapSections` makes again and the fold counts as existing) is added to what the check is given. A regenerated, orphan or new section's title is not: its reply may hold no nodes. Exact key lookup, so a section with no stored title adds none. The 284-node first import (nodeChars 95) goes from `room` (counted 288, real 304) to `folds`, and the new sections are skipped; the roomy world stays `room`, and across 8 first-import sizes the retained count never exceeds the real fold's.
2. **Recheck after the changed sections' replies** (`capacity.ts: planIsFull`, `capacity.afterReplies` in the diagnostics). Only when new sections are about to be planned and the first answer was not already `folds`. The plan so far (unchanged nodes plus what the replies returned, an orphan's included, since it is planned with the others) goes through the real `validateVisualPlan` with one probe, so sanitising, repair and the fold are the merge's own; nothing is assumed for a section without a reply. Edited section plus a new section, first import 300 to 306 nodes: the first check says `room` (297 counted), the recheck says `folds` with the count equal to the real fold's (306), and the new section's plan is skipped (1 call, not 2). At 299 nodes it says `room` and plans as before. Across nine first-import sizes the recheck's count equals the plan's real count every time.

Orphans are not sequenced: they are planned in the same step as the other changed sections, so after the replies their nodes exist and are counted. Offline only; whether this fires on the live three-chat workload needs `diagnostics.capacity` from one more run.

Diagnostics follow-up: `capacity.recheck` (`asked`, `not_needed_first_answer_full`, `not_needed_no_new_sections`, `not_applicable`) says why `afterReplies` is present or absent; `afterReplies` is present only when `recheck` is `asked`. A merge that is not economy and append-only has no `capacity` record at all. The skip decision is unchanged.


## Benchmark run 6 (2026-10-11): titles counted + recheck after the replies, live

Approved single run, run 4 recipe (Gemini 2.5 Flash, Jev typed, economy ON, same three links, cap $0.40, not reached). Data `data/benchmark-2026-10-11-run6-recheck.stats.jsonl`. Spec passed, 177 calls, about 2.4 minutes.

| | Run 4 | Run 5 | Run 6 |
|---|---|---|---|
| Settled billed | $0.2527 | $0.2258 | **$0.2785** (stable on two reads; list $0.2783) |
| First chat, list | $0.1699 | $0.1423 | $0.1726 (29 plan calls, 43.8k output tokens; run 5: 25 / 32.0k) |
| Merge, list | $0.0829 | $0.0840 | $0.1057 (9 plan calls, 23.9k output tokens; run 5: 15.2k) |
| Merge Jev | $0.0335 | $0.0335 | $0.0335 |

The run was the most expensive of the three, from model output size (first chat plans and merge plans wrote more tokens), not from the capacity work.

**The recheck fired.** `capacity`: first check `room` (retained 241 = 89 reused + sections it can count + 9 titles; `titlesCounted` 9 of 12 changed titles), `recheck: asked`, `afterReplies`: `folds`, counted 320 (cap 300), equal to `actualCounted` 320. `planSkips`: one `added` section ("And there's a fascinating endgame", 1 unit, text added as it is, no plan call, no analysis). The notice said so. That is one plan call avoided (a short unit; a few thousandths of a dollar).

**What it did not catch: 7 orphan plan calls (`kind: new`, 28.5k in / 19.3k out tokens, about $0.057 at list, 20% of the run) were made and all of their nodes folded into pages** (12, 37, 24, 8, 41, 28 and 15 folded; every overflow entry is "plan limit"). The orphan path is decided before the replies, from the first check (241, `room`). The first check was 79 under the real count (320): the two regenerated sections' nodes (29 + 47) and 3 titles. Orphans have no stored nodes, so they add nothing to the count; the model was asked for them in parallel with the two regenerated sections, which is what made the plan full. Deciding them exactly needs the regenerated sections' replies first (sequencing, a latency cost) or a rule that does not depend on those replies.

Correctness: removals `[]`, `plainMissed` `[]`, "Nothing lost", key terms 31/37 (same), frames 20 then 60, 18 existing topics extended, 41 passages unplaced (44, 43), 645 repeats left out, merge review +99 new, ~3 updated, 5 links changed. A second identical import is not a step of this spec; it is covered offline (second-import idempotence tests, three modes).

## Benchmark run 7 (2026-10-11): orphan hold (option C), live

Approved single run, run 4 recipe, cap $0.40 (not reached). Data `data/benchmark-2026-10-11-run7-orphan-hold.stats.jsonl`. Spec passed, 166 calls, merge 48.9 s.

| | Run 4 | Run 5 | Run 6 | Run 7 |
|---|---|---|---|---|
| Settled billed | $0.2527 | $0.2258 | $0.2785 | **$0.2401** (list $0.2407) |
| First chat, list | $0.1699 | $0.1423 | $0.1726 | $0.1267 (20 plan calls, 28.9k out) |
| Merge, list | $0.0829 | $0.0840 | $0.1057 | $0.1141 (plan 27.6k out) |

**The hold did not fire.** `capacity`: first check `room` (counted 220), `orphanExpectation` 280 (220 + the one regenerated section's 60 previous nodes) under the cap of 300, so `hold` is absent. The three orphans were all `pureAppend: true`, `held: false`, `outcome: planned`: eligibility was not the problem. After the replies the recheck said `folds` (285 existing counted, equal to `actualCounted`): the regenerated section ("Architectural Components", 12.3k in / 7.4k out tokens, 26 s) returned far more nodes than it had, and the new nodes filled the plan. All three orphans' nodes were folded into pages (24, 47 and 19), so their three plan calls were wasted: 11.7k in / 9.6k out tokens, about $0.027 at list (11% of the run). The recheck did skip two `added` sections.

The expectation counts only a regenerated section's previous nodes, so a regenerated section that grows is invisible to it (the "grow" row of the design matrix with expectation under the cap). Run 6's shape (expectation 317) would have been held; run 7's was not. Option A (wait, then decide) would have skipped all three here at no latency cost: the regenerated call (26 s) is the critical path either way, and the orphan calls took 14 to 18 s each.

Correctness: removals `[]`, `plainMissed` `[]`, "Nothing lost", first chat key terms 30/37 (31/37 earlier), frames 19 then 57, 18 existing topics extended, 40 unplaced, 645 repeats left out, merge review +105 new, ~12 updated, 28 links changed (run 6: +99, ~3, 5): the regenerated section is the larger one, which accounts for the extra updates. Second identical import: not part of the spec (covered offline).
