# Meaning labelling rubric (v2, draft)

How to label the pairs in [`src/ai/fidelity/__fixtures__/meaning/pairs.json`](../../src/ai/fidelity/__fixtures__/meaning/pairs.json)
for [knowledge-notes-plan.md](./knowledge-notes-plan.md) §7.2 (OD7, gate G0). The rubric is versioned with the set:
change the version here and `version` in the file together.

Each pair is one **source unit** (a sentence from the user's content) and one **card** text (what a note says about
it). You judge one question: **would a reader of the card alone come away believing something the source does not
say?**

## Labels

| Label | Meaning | Test |
|---|---|---|
| **faithful** | The card says what the source says, in other words, possibly shorter. Nothing it claims is stronger, wider, reversed or new. | A reader who acts on the card makes the same decision as one who read the source. |
| **partly** | The card is mostly right but loses or bends one detail that a careful reader might care about, and the loss is arguable. | You'd want the author to look, but you can't point to a clearly false claim. |
| **distorted** | The card claims something the source does not: a hedge removed, a condition or scope dropped or widened, a negation flipped, cause and effect swapped or reversed, a number or unit changed, a cost dropped or inverted, or an absolute added. | You can name the false belief in one sentence ("the card says it always retries; the source says up to 3 times"). |

The file stores two labels only: `faithful` and `distorted`. **Partly** is a labeller's answer, not a stored label:
mark it in your sheet with a sentence of why. Every *partly* is a disagreement to resolve (plan §7.2, step 3) by
rewriting the pair until it is clearly one or the other, or removing it. A set with *partly* answers left is not
ready for G0.

## General rules

1. **Judge meaning, not style.** Word order, synonyms, active ↔ passive, a list instead of a sentence, dropping filler
   ("note that", "in practice") are all faithful.
2. **Shorter is fine; stronger is not.** Leaving out a detail that doesn't change the claim (an example, a reason
   repeated elsewhere) is faithful. Leaving out something that *limits* the claim is distorted.
3. **The card stands alone.** Don't fill in what the card lacks from your memory of the source.
4. **One false belief is enough.** A card that is right in four ways and wrong in one is distorted.
5. **Hedges are equivalent within their class.** *can / may / might / could / sometimes / often* soften a claim; any of
   them keeps a hedge. *Usually / typically / generally / in most cases* are interchangeable. Turning a hedge into a
   certainty is distorted; turning *often* into *sometimes* is partly (discuss).
6. **Numbers are exact.** `1,000` = `1000` = "one thousand"; `200 ms` = "200 milliseconds"; "three" = `3`. A
   different number, a different unit, or a range collapsed to one end is distorted.
7. **When unsure, write it down.** Don't guess: mark *partly* with the reason.
8. **A requirement for N means at least N** (v2). "Two approvals are required" keeps "at least two approvals are
   required", unless the source or the card states an exact count ("exactly two", "no more than two"). A *limit*
   is different: "up to 3" → "3" is still distorted (rule 6).

## Worked examples per kind

Each kind has at least 20 pairs with at least 8 of each label. `expect` on a distorted pair names the rule that
should catch it; labellers can ignore it.

### Qualifier (hedges and limits on a claim)

| Source | Card | Label | Why |
|---|---|---|---|
| Adding a reranker can improve answer quality on long documents. | A reranker may improve answer quality on long documents. | faithful | *can* → *may*: same hedge class |
| Nightly compaction usually finishes before the morning peak. | Nightly compaction finishes before the morning peak. | distorted | "usually" dropped: now a guarantee |
| Large imports may take several minutes to appear in search. | Large imports take several minutes to appear in search. | distorted | the hedge is gone; "several" is the amount, not a hedge |
| The linter often catches unused imports. | The linter sometimes catches unused imports. | partly | weaker than the source; discuss before storing |

### Condition

| Source | Card | Label | Why |
|---|---|---|---|
| The cache returns the stored answer when the request hash matches a previous query. | If a request's hash matches an earlier query, the cache serves the stored answer. | faithful | same condition, reworded |
| Deploys pause automatically if the error rate exceeds 2% for five minutes. | Deploys pause automatically whenever errors occur. | distorted | the condition is widened |
| Refunds are issued automatically unless the order has already shipped. | Refunds are issued automatically if the order has already shipped. | distorted | *unless* turned into *if* |
| Unless a reviewer objects within two days, the proposal is accepted. | The proposal is accepted if no reviewer objects within two days. | faithful | *unless X* = *if not X* |

### Negation

| Source | Card | Label | Why |
|---|---|---|---|
| The importer does not retry failed rows. | Failed rows are never retried by the importer. | faithful | *not* → *never*, same claim |
| Archived projects are not included in search results. | Search results leave out archived projects. | faithful | negation expressed by a verb |
| The SDK no longer supports Python 3.7. | The SDK supports Python 3.7. | distorted | negation dropped |
| Trial accounts cannot invite more than two teammates. | A trial account can invite at most two teammates. | faithful | "cannot … more than" = "at most" |

### Cause and effect

| Source | Card | Label | Why |
|---|---|---|---|
| Slow disk writes cause the queue to back up. | The queue backs up because disk writes are slow. | faithful | same direction |
| Slow disk writes cause the queue to back up. | A backed-up queue causes slow disk writes. | distorted | cause and effect swapped |
| Caching the product list reduces database load. | Caching the product list increases database load. | distorted | effect reversed |
| Sign-ups rose in the same month the pricing page was redesigned. | The pricing page redesign drove the rise in sign-ups. | distorted | the source states a coincidence, not a cause |

### Quantity

| Source | Card | Label | Why |
|---|---|---|---|
| The client retries up to 3 times before giving up. | The client gives up after at most three retries. | faithful | *up to* = *at most*; 3 = three |
| The client retries up to 3 times before giving up. | The client retries 3 times before giving up. | distorted | the limit became an exact count |
| Response times stay under 200 milliseconds for 95% of requests. | Response times stay under 200 seconds for 95% of requests. | distorted | unit changed |
| The plan includes 1,000 API calls per day. | The plan allows 1000 API calls a day. | faithful | formatting only |

### Trade-off

| Source | Card | Label | Why |
|---|---|---|---|
| The columnar format speeds up analytics queries but uses more disk space. | Analytics queries run faster in the columnar format, at the price of extra disk space. | faithful | benefit and cost both kept |
| The columnar format speeds up analytics queries but uses more disk space. | The columnar format speeds up analytics queries and saves disk space. | distorted | the cost is inverted |
| Strict type checking catches bugs earlier, although it slows down prototyping. | Strict type checking catches bugs earlier. | distorted | the cost is dropped |
| Higher compression levels shrink archives while using more CPU. | Stronger compression gives smaller archives and takes more CPU. | faithful | the cost is kept without a contrast word |

### Scope

| Source | Card | Label | Why |
|---|---|---|---|
| Read replicas are recommended for read-only workloads. | For read-only workloads, use read replicas. | faithful | scope kept |
| Read replicas are recommended for read-only workloads. | Read replicas are recommended. | distorted | scope dropped: now a general recommendation |
| Price alerts are sent to premium subscribers only. | Price alerts are sent to subscribers. | distorted | the narrowing word ("premium") is gone |
| On Windows hosts, the agent runs as a service. | The agent runs as a Windows service. | faithful | scope folded into the noun |

### Compound sentence (claim and caveat in one unit)

| Source | Card | Label | Why |
|---|---|---|---|
| The new search ranks recent documents higher, but it ignores files larger than 10 MB. | New search favours recent documents. Files over 10 MB are ignored. | faithful | claim and caveat both on the card |
| The new search ranks recent documents higher, but it ignores files larger than 10 MB. | The new search ranks recent documents higher. | distorted | the caveat is lost |
| Caching cut median latency by 40%, although the p99 latency did not change. | Caching reduced median latency 40%; p99 latency stayed the same. | faithful | "did not change" = "stayed the same" |
| Search indexing runs every hour, unless the queue is paused for maintenance. | Search indexing runs every hour. | distorted | the exception is lost |

## Changes

| Version | Date | Change |
|---|---|---|
| v2 | 2026-10-19 | Rule 8 (a requirement for N means at least N), from the dispute on `qt-19`. Cards of `ng-08` and `to-02` rewritten. Answers given under v1 stay valid. |
| v1 | 2026-10-19 | First draft. |

## Process (plan §7.2, OD7)

Files are in `src/ai/fidelity/__fixtures__/meaning/`; the logic is `src/ai/fidelity/meaningLabels.ts`. Nobody edits
`label` in `pairs.json` by hand: the drafted label is never the answer.

1. **Label blind.** Open `tools/meaning-labelling/index.html` in a browser (double-click; no server, nothing leaves
   the browser). Enter your name, choose `pairs.json`, and label. The page hides the drafted label, `expect`, the
   kind, the notes and the ids, and shuffles the order per person. Keys: 1 faithful, 2 partly, 3 distorted,
   4 unsure, ← →. *Partly* and *unsure* need a note; for *distorted*, write the false belief. Answers are saved in the
   browser as you go; **Export labels** writes `<name>.json`, which goes in `labels/`. To continue elsewhere, load
   that file under "Continue from a labels file".
   **Or as a Markdown sheet:** `node scripts/meaning-sheet.mjs export` writes the same blind set to
   `labelling-sheet.md` (fill the Answer and Note columns) and a key, `labelling-sheet.key.json`, which the labeller
   never sees. `node scripts/meaning-sheet.mjs import <filled.md> --labeller <name> --type human|model` writes
   `labels/<name>.json`. Use `--type human` only when you have judged every answer yourself; an AI-filled sheet is
   `--type model`, reported beside the human answers and never counted for G0 (§7.2 step 2 is the model judge).
2. **Second labeller.** A second person chooses "the 50-pair sample only" and also loads `labelling.json`. The
   sample is fixed in that file (at least 5 per kind, chosen by kind, drafted label and id order, never by content)
   and leaves out the anchors.
3. **Anchors.** 31 pairs are worked examples in this rubric (`anchors` in `labelling.json`), so they can't be
   labelled blind. They are labelled anyway, as a calibration: an answer that differs from the rubric means the rubric
   is unclear, and is discussed.
4. **Report.** `UPDATE_LABELS=1 npx vitest run src/ai/fidelity/meaningLabels.test.ts` rewrites
   `labelling-report.md`: progress per kind, every dispute with both answers and notes, anchors answered differently,
   pairs whose final label differs from the draft (their `expect` needs a look), stale answers, agreement on the sample
   (Cohen's kappa), and the G0 checklist.
5. **Resolve** every *partly*, *unsure* and disagreement, in one of three ways: an entry in `resolutions.json`
   (`faithful`, `distorted` or `remove`, with who and why); a rewrite of the pair in `pairs.json` (its old answers
   become stale and it is labelled again); or a clarification of this rubric (bump the version here and
   `rubricVersion` in `labelling.json`).
6. **Freeze.** When every kept pair has a final label, the sample is labelled twice and no dispute is open, G0 is
   met. `meaning.eval.test.ts` already measures against final labels where they exist; with none left as drafts,
   `MEANING_TARGETS=on` enforces the §7.2 targets. Only then are the rules retuned, and the held-out split is kept.

Pairs with ids `h-…` were written after the rules were tuned on the others; keep that split when relabelling, since it
is the only honest estimate of how the rules do on new text. New pairs added later should go in as held-out too.
