# Decision models — plan to support dedicated decision models (Jev, OpenAI Decisions)

Status: **Phase 0 and Phase 2 (core + Jev + OpenAI adapters, Lens search as the first consumer) are built; Phase 1 spike and Phase 4 (outline) are not.** Written 2026-10-08.

## 1. What exists today (Phase 0, done)

A **chat decision model**: the user picks a connection and types one of its chat models (AI settings → "Decision model", or
`ACUTE_AI_DECISION_CONNECTION` + `ACUTE_AI_DECISION_MODEL` for the e2e suite). Tasks with `policy.preferDecisionModel`
(`outline_document`, `lens_navigate`) try it first; any failure falls through silently to the primary model.
Code: `providerManager.setDecisionProvider`, `connections.setDecisionModel`, `AIConnectionsDialog`, `e2e/aiProvider.ts`.

Measured (Example 1, AICredits): `google/gemini-2.5-flash-lite` as decision model cut the outline from 32–47 s to 3–5 s.

## 2. What a "dedicated" decision model is

Not a chat model. It is sent a `state` and typed `questions`, and returns **typed answers with probabilities** — no text, no
reasoning trace. The code branches on the answer directly.

| | Jev (TypeSafe, via OpenRouter) | OpenAI Decisions API |
|---|---|---|
| Model | `typesafe/jev-1.13` (pinned) or `~typesafe/jev-latest` | `gpt-6-luna` |
| Endpoint | `POST https://openrouter.ai/api/alpha/decisions` (verified live) | `POST https://api.openai.com/v1/decisions` (from [OpenAI's API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create); **not yet called live**) |
| Question types | `choice`, `noul` (yes/no → P(yes)), `score` (ordered scale) | predicate (yes/no), choice, score |
| Input | text/JSON `state`; context 32,000 tokens | text, JSON and images |
| Price | input tokens only; output free (~$0.00002 for 476 in-tokens) | reported $0.10 / 1M input, no output charge |
| Status | alpha API | public beta |

Verified 2026-10-08 with the project's OpenRouter key: HTTP 200 in 981 ms, `typesafe/jev-1.13-20260917`, cost $0.000019992.
(`typesafe/jev-1.13` is not in OpenRouter's chat catalogue — only `typesafe/jev-router` is — so it must be called through the
Decisions API, never chat completions.) The Vercel AI SDK already abstracts both behind `experimental_decide` with
`choice | score | boolean`, a useful reference for our normalised types.

Sources: [Jev tutorial](https://openrouter.ai/docs/guides/community/jev-tutorial), [Jev hub](https://openrouter.ai/docs/guides/community/jev),
[AI SDK Decisions](https://ai-sdk.dev/docs/ai-sdk-core/decisions), [The New Stack on OpenAI's Decision API](https://thenewstack.io/openai-decision-api-luna/).

## 3. Where decision-shaped steps exist in the product

A decision model fits a **narrow question with a closed answer**. It cannot write a plan or group parts by meaning.

| Step | Today | Decision shape | Fit |
|---|---|---|---|
| Section **kind** (9 kinds) per section | inside `outline_document` | `choice` (criteria = `SECTION_KIND_REGISTRY[k].when`) | strong |
| Section **prominence** primary/supporting | inside `outline_document` | `choice` or `score` | strong |
| `lens_navigate` (which node does the question start from) | chat, JSON | `choice` over node keys | good (limit: many nodes → long criteria) |
| `assign_to_topics` (merge: which topic does this content belong to) | chat | `choice` over topics | good |
| "Reads fine as text?" (`readsFineAsText`) | heuristic | boolean | possible |
| Is the plan only a restatement (analysis check) | deterministic `missingAnalysis` | boolean | optional upgrade, not needed |
| **Grouping parts into sections** (merge by meaning) | `outline_document` | no closed-choice form (pairwise "same concept?" only) | **weak — keep on chat model** |
| Section generation, analysis text | chat | free-form | **no** |

Consequence: a decision model **cannot replace the outline call by itself**. It can take over the *classification* inside it;
the grouping stays on a chat model. The outline's latency (3–5 s with Gemini lite already) may leave little to win — see the
Phase 1 spike, which decides whether to build the rest.

## 4. Target architecture

A **separate concept from `AIProvider`**, not a flag on it, because the request/response shapes differ.

```
DecisionQuestion  = { type: "choice" | "score" | "boolean", instructions, criteria }   // our names; adapters map noul/predicate → boolean
DecisionRequest   = { state: JSON, questions: Record<string, DecisionQuestion> }
DecisionAnswer    = { choice, probabilities, confidence } | { score, probabilities, confidence } | { probability }
DecisionProvider  = { id, kind: "decisions_api" | "chat", decide(req, {signal, timeoutMs}): Promise<{answers, usage}> }
```

- **Adapters** (one folder each, like `providers/copilot`): `decisions/openrouterJev`, `decisions/openaiDecisions`,
  and `decisions/chatEmulation` (asks a chat model to answer the same questions as JSON — lets today's Gemini-lite slot, or any
  chat model, serve a decision task, and is the fallback when a dedicated one fails).
- **Registry**: connection descriptors gain an optional `decisionAdapter` (openrouter → Jev, openai → Decisions). No component
  names a vendor (same rule as `registry.ts`).
- **Runtime**: `AIRuntime.decide(task, input)`. A **decision task** declares `buildRequest(input)` and `interpret(answers, input)`
  → typed output, plus `fallback`: the existing chat task (e.g. `outline_document`). Order: dedicated decision model → chat
  decision model → primary. Any failure, timeout or low confidence falls through silently, as `preferDecisionModel` does now.
- **Selection** (`DecisionSelection`): `{ connectionId, model, kind }`, persisted like today; `kind` defaults to `chat`.
  Settings row gets a "type" choice (chat / typed decisions) shown only for connections that have a decision adapter.
- **Transport/keys**: Jev's docs say to keep the key server-side. Calls go through the existing AI host route
  (`src/app/api/ai`), a new `decide` endpoint, never straight from the browser.
- **Usage**: record `usage.cost` / tokens into the existing usage repository (`provider`, `model`, `kind`).
- **Pinning**: default `typesafe/jev-1.13` (stable thresholds); allow `~typesafe/jev-latest` as an explicit choice.

### Env (e2e and local)

| Variable | Meaning | Status |
|---|---|---|
| `ACUTE_AI_DECISION_CONNECTION` | which connection the decision model belongs to | read now |
| `ACUTE_AI_DECISION_MODEL` | model id on that connection | read now |
| `ACUTE_AI_DECISION_KIND` | `chat` (default) or `decisions_api` | Phase 2 |

## 5. Phases (each ends with tests green and a measurable exit criterion)

**Phase 1 — Spike (no product code).** A script that, for the four fixtures (cheat sheet, hand-off, decision-table reply,
unit checks), asks Jev and OpenAI Decisions to classify each outlined section's kind/prominence, using the *chat outline's*
sections as ground truth. Measure agreement, latency, cost. **Go / no-go:** build Phases 2+ only if kind agreement ≥ 90 % and
the combined outline (chat grouping + decision classification) is no slower than today's 3–5 s with Gemini lite, *or* it is more
reliable (fewer outline fallbacks). If not, stop here — the chat decision model is already the win.

**Phase 2 — Core + Jev.** `DecisionProvider` types, `chatEmulation` adapter, `AIRuntime.decide`, the host route, Jev adapter,
settings "type" choice, usage recording, env `KIND`. First consumer: `lens_navigate` (smallest, self-contained). Tests: fake
`DecisionProvider` (unit), recorded-response adapter tests, opt-in contract test with the real OpenRouter key.

**Phase 3 — OpenAI Decisions.** Read OpenAI's API reference first (path, auth, image state, ZDR terms), then the adapter and a
contract test. Images in `state` are out of scope until a feature needs them.

**Phase 4 — Outline integration (only if Phase 1 passed).** Split `outline_document` into grouping (chat) + per-section
classification (decisions, in parallel); keep the old combined call as the fallback. Compare on the fixtures against the
benchmark numbers in §1 before keeping it.

**Phase 5 — Other steps.** `assign_to_topics`, `readsFineAsText`, only where measured better than heuristics.

## 6. Risks and open points

- **Alpha/beta APIs** can change; adapters are thin and isolated, and the chat fallback keeps features working.
- **Probabilities need thresholds** (e.g. fall back to chat when `confidence` < τ). τ must be tuned on labelled fixtures, not guessed.
- **32k-token context** (Jev): the outline's 24k-character excerpt budget fits; larger inputs must be excerpted.
- **Privacy**: content leaves to TypeSafe (via OpenRouter) or OpenAI; connection `billingWording`/data notes must say so, as for BYOK today.
- **No explanations**: a wrong decision can't be inspected — log the answers and probabilities with the run diagnostics.
- **Grouping can't be a decision** (§3): don't promise a full outline replacement.
- **Open questions**: Should kind classification be allowed to override the chat outline's kind when they disagree? Which steps
  beyond the outline matter most? Is sending note content to TypeSafe acceptable for your users?

## 7. As built (2026-10-08)

Beyond Phase 0, with the chat decision model unchanged as the fallback:

- `src/ai/decisions/` — vendor-neutral types (`DecisionRequest`, `DecisionAnswer`, `DecisionProvider`, `DecisionTask`), `wire.ts` (Jev and
  OpenAI request/response mapping, pure), `httpDecisionProvider.ts` (browser client).
- `src/ai/host/decisions/hostDecide.ts` + `src/app/api/ai/decide/route.ts` — the vendor call, server-side, with the caller's key; errors
  become fixed-text `AIError`s.
- `AIRuntime.decide(task, input)` — typed decision model if enabled and sure → otherwise the existing chat path (`task.fallbackTask`,
  through the chat decision model and the primary). Cancel propagates; anything else falls back silently with a console note.
- Registry: `decision` on the `openrouter` (Jev, `typesafe/jev-1.13`) and `openai` (`gpt-6-luna`) descriptors. Connections:
  `setTypedDecision` / `getTypedDecisionSelection` / `typedDecisionOptions`, persisted, restored on load, cleared on disconnect.
- Settings: "Typed decision model" row (only when such a connection is connected), off by default.
- First consumer: `lensNavigateDecision` (Lens search). Env for e2e: `ACUTE_AI_DECISION_KIND=typed`.

Not yet: a live OpenAI call, the Phase 1 spike, outline classification (Phase 4), `assign_to_topics` and the other steps in section 3.

## 8. Phase 1 spike result (2026-10-08) — no-go for the outline

Full data: `.ai/docs/decision-spike/spike-2026-10-08.md` (+ `.json`). Re-run: `npx vitest run --config vitest.contract.config.ts decisionSpike`.
Setup: 4 sample documents, 19 sections; ground truth = chat outline by `openai/gpt-oss-120b`; Jev (`typesafe/jev-1.13`) via the real
`hostDecide`, one request per section (kind + prominence as `choice` questions, kinds described with `SECTION_KIND_REGISTRY[k].when`).
OpenAI Decisions was not exercised (no real OpenAI key).

| | Result |
|---|---|
| Jev vs chat outline, **kind** | 53 % (10/19); 73 % (8/11) where confidence ≥ 0.6, which is only 58 % of sections |
| Jev vs chat outline, **prominence** | 74 % (14/19) |
| Noise floor: the chat model vs. itself (16/19 sections grouped identically) | kind 81 %, prominence 88 % |
| Jev latency | ~0.9 s per request (all sections in parallel ≈ 0.7–1.9 s per document); ~1.15k input tokens per section, ≈ $0.001 for all 19 |
| Chat outline time | `gpt-oss-120b` 13–55 s; Gemini lite (chat decision model) 1.6–3.5 s |

Go/no-go bar was ≥ 90 % kind agreement and no slower outline. **Not met**: 53 % is well under both 90 % and the chat model's own 81 %,
and Jev would be an *extra* call beside the grouping call, not a replacement — Gemini lite already answers the whole outline in 1.6–3.5 s.
Likely reasons (not tuned in the spike): the kinds overlap and are defined by an *ordered* "first that fits" rule, which an unordered
`choice` can't express; several "disagreements" are defensible (the chat model itself flipped hook points between `cards` and `flow`).
Conclusions: (1) don't build Phase 4; (2) the big outline win is the chat decision model (13–55 s → 2–4 s), already built; (3) keep the typed
model for genuinely closed questions (Lens search; candidates `assign_to_topics`, yes/no checks), and spike each one before building.

## 9. Second spike round (2026-10-09)

Data: `.ai/docs/decision-spike/assign-spike-2026-10-09.md`, `kind-tuned-2026-10-09.md`. Re-run: `npx vitest run --config vitest.contract.config.ts assignSpike`
(or `decisionSpikeTuned`). Helpers: `src/ai/contractTests/spikeUtil.ts`.

### 9.1 assign_to_topics — **go** (a candidate to build)

Labelled set from the 4 sample documents (34 parts: restatements, extensions that add one new fact, unrelated notes), existing notes = the document's units.

| answerer | right topic (or NEW) | "adds nothing new" right | content lost (an extension called nothing-new) | time per document | tokens |
|---|---|---|---|---|---|
| Jev (typed, 1 request per part) | 100 % (34/34) | **100 % (26/26)** | **0 % (0/13)** | ~1.0 s (all parts in parallel) | 91.7k in |
| `gpt-oss-120b` (chat, the production prompt) | 100 % | 85 % (22/26) | 8 % (1/13) | 17 s | 15.3k |
| Gemini lite (chat decision model) | 100 % | **27 % (7/26)** | **46 % (6/13)** | 1.6 s | 12.6k |
| local heuristic (`assignLocally`) | 47 % | n/a | n/a | ~0 | — |

Caveats: the set is synthetic and easy (topics are distinct sections of one document, no hard negatives such as two near-identical topics, parts
written by the same family of model as one of the baselines); Jev resends the topics with every part, hence ~6x the tokens (still ≈ $0.004).
**Warning found on the way:** `assign_to_topics` has `policy.preferDecisionModel`, so a user whose chat decision model is a small model (Gemini lite)
gets its "nothing new" judgement, which dropped 46 % of the extensions here — content silently left out of the merge. Either drop
`preferDecisionModel` from that task or route it only to the typed decision model (fallback: the primary), not the chat decision model.

### 9.2 Section kind with tuned questions — **no-go, confirmed**

Same 20 sections for every variant; ground truth = chat outline run A.

| variant | kind agreement |
|---|---|
| V1 one unordered choice (re-run of the original) | 45 % (first spike: 53 %) |
| V2 ordered yes/no cascade (one statement per kind, first kind in the outline's order at P ≥ 0.5; 0.3 / 0.7: 5 % / 30 %) | 15 % |
| V3 two steps (family, then kind) | 30 % |
| **Noise floor: the chat model vs itself** | **53 % (9/17)** |

Tuning made it worse, and the chat model agrees with itself only about half the time on a section's kind: kind is not a well-posed closed question, so
there is no stable ground truth to match. Prominence: V1 85 %, V2 75 %, V3 70 %. Conclusion stands: keep the outline on the chat decision model.

### 9.3 As built after the second round (2026-10-09)

- `assign_to_topics` is now a typed decision too: `assignToTopicsDecision` (`src/ai/merge/assign.ts`), used by `mergeIntoSource` through `AIRuntime.decide`.
  One request per part (up to 30 parts, 254 topics), in parallel; answers merged into the chat task's reply shape so `validateAssignment` is unchanged.
  A topic answer below 0.5 confidence leaves that part to the local answer; "adds nothing new" needs P >= 0.5 (changed from 0.8 on 2026-10-09, see 9.4).
  Fallback: the primary's `assign_to_topics` chat task (and the local answer), as before.
- **Content-loss fix:** `assign_to_topics` no longer has `preferDecisionModel`, so the chat decision model (Gemini lite dropped 46 % of added facts in the spike)
  is never asked for it; only the typed decision model or the primary is.
- `DecisionTask.buildRequest` may return several requests (run in parallel, answers merged, question names unique across them).
- Not yet re-measured end to end on a real merge: the spike used `hostDecide` directly with these questions; the app path adds the route and runtime around it.

### 9.4 Live check of the merge with Jev on OpenRouter (2026-10-09)

Data: `.ai/docs/decision-spike/merge-conflicts-2026-10-09.md` (re-run: `... mergeConflictSpike`). The merge's front half run for real: parse, repeats left out
before any model call, assignment through `runtime.decide` answered by Jev (the fallback primary was set to always fail, to prove Jev answered), `composeMerged`.

- **Assignment:** all 6 new parts filed correctly (4 under existing topics, 1 new topic, 1 restatement dropped), 6 Jev requests in ~0.7-1.1 s in total.
- **Duplicates:** word-for-word repeat dropped in code; restatements dropped when Jev says "adds nothing new". The first run left one restatement in because the 0.8
  threshold was too high. Measured over 20 statements: restatements score 0.63-0.86, additions and contradictions <= 0.07, so the threshold is now 0.5 and
  both restatements are dropped, with every addition and contradiction kept.
- **Contradictions:** the merge does **not** detect them. "Pro is now 15 dollars, not 12" and "Version 2 now ships in April, not March" are filed under the right topic and
  appended below the statement they contradict, with no flag. Only edits the user made to canvas objects are conflicts today (`reconcile/conflicts.ts`, "Apply update" / "Keep mine").
- **Could a typed model flag contradictions?** On 16 labelled statements (8 contradictions, 4 additions, 4 restatements): Jev 3-way choice 100 % right (8/8 caught, 0 false alarms, 0.6 s),
  `gpt-oss-120b` 100 % (2.7 s), Gemini lite 88 % (1 missed, 1 false alarm). Synthetic and easy, but a strong signal for plan §5.3 rule 7 ("only real contradictions are flagged").
  Not built: it needs the options box (G3) or at least a "conflicts with your notes" notice in the merge review.

### 9.5 Contradictions and the typed path (2026-10-09)

Another session added contradiction handling to the **chat** `assign_to_topics` path (the model quotes the topic's sentence and the part's sentence word for word, for the
user's choice; `Conflict`, `validateAssignment(...).conflicts`). A typed model can't quote text, so left alone it would have silently switched that off whenever it answered.
Now `assignToTopicsDecision` asks a third question per part (`pN_relation`: repeats / adds / contradicts); if any part filed under a topic likely contradicts it
(P >= 0.5), `interpret` returns null and the **chat task answers the whole merge**, including its conflict quotes. Live (Jev on OpenRouter): the two contradicting parts scored 0.99 and 0.92,
every other part <= 0.01, and with those parts present Jev stepped aside; without them it answered all 4 parts in ~1.1 s.
A later improvement, if wanted: let Jev pick the contradicting sentences as typed choices over the topic's and the part's own sentences (verbatim by construction), so the typed path needs no chat call for conflicts.

### 9.6 Jev picks the conflicting statements (2026-10-09, from the topic-merge session's handoff)

`assignToTopicsDecision` no longer hands the whole merge to the chat task when a part contradicts its topic. Round one is unchanged (topic, relation, "nothing new" at 0.5).
For parts that likely contradict (P >= 0.5), `DecisionTask.followUp` asks round two: a choice over the topic's numbered statements (plus `none`) and a choice over the part's statements
(`src/ai/merge/statements.ts`: sentences, list items, table rows, ids `t3.s2` / `p1.s0`). `interpret` turns the two picks into
`{ about: "<topic label>: which is current?", topicSays, partSays }` (the exact statement text) in the chat reply's shape, so `validateAssignment` / `verbatim`, `composeMerged` and the
choice drawing are unchanged. A pick below 0.6 confidence, `none`, an id outside the lists, a topic or part with more than 120 statements, or a failed round two keeps the previous behaviour:
the chat task answers the whole merge. Users without a typed decision model: nothing changes.
Limits: one conflict pair per part (a part with two contradictions gets the one Jev picks; the chat path can list several); no live run yet of this round two.
