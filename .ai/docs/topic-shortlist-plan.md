# Topic shortlist and cheaper assignment — plan

**Status:** phases 1-2 implemented offline behind a default-off flag (2026-10-11, `merge/topicIndex.ts`, `MergeInput.shortlist`); replay results in the evidence document say it is not recommended yet. Phases 0b-0d, 3 and 4 not done. Evidence: `decision-spike/chat-import-live-2026-10-09.md`.
**Owners:** `src/ai/merge/*`, `reconcile/*`, `history/*` belong to the topic-merge session; the import side (`import/chatShare/`,
the e2e spec, the stats tool, fixtures) to the chat-import session. New files below are marked with their owner.

## 1. Problem, in measured numbers

- Merge assignment sends **every topic with every part**: 237 requests × about 10.1k input tokens ≈ 2.4M tokens. Jev costs about
  $0.042 per million input tokens, so about **$0.10 of the $0.615** merge bill (77% of that input is the repeated topic list).
- A 95-way choice with little context gives **low confidence**: 168 of 237 batched answers, and 11 of 32 per-part answers, were
  below 0.5. Fragments ("Apps", "1. Data", "Free") are the weakest.
- The rest of the merge cost is the chat model: about 74–81 section plans and 50 analysis calls, mostly output tokens.

## 2. What the "embeddings + dot product" idea is, and how it maps to this product

The idea: don't give the model the whole topic list. Rank topics by similarity to the incoming part with local maths, and give the
model only the top few. The suggested NumPy and FAISS are Python and native libraries and **do not apply** (this is a TypeScript
app that runs in the browser and Electron). What carries over:

- **Brute-force cosine similarity over normalised vectors is enough**: a `Float32Array` per topic and a dot product, about ten
  lines of TypeScript, no dependency. At 500 topics × 1,536 dimensions it is 3 MB and microseconds; at 5,000 topics it is 30 MB
  and still milliseconds. FAISS is never needed here, and an index structure only matters past tens of thousands of vectors.
- **The hard part is where the vectors come from**, not the search. Options:
  1. *Lexical* (BM25 / TF-IDF / word overlap): no provider, no download, fully local and private. Weakest on paraphrase.
  2. *Embeddings from the user's own provider* (OpenAI, Gemini, OpenRouter models that offer embeddings): about $0.02 per million
     tokens, so about $0.001 for a whole three-chat merge. But it sends note text to a provider (another data egress, to be
     disclosed and redacted), and not every connection has embeddings (a Copilot subscription does not).
  3. *A small local embedding model in the browser/Electron* (WASM/ONNX, tens of MB): free per use and private, but adds a download
     and CPU cost. Later, only if lexical + provider are not enough.
- Embeddings find *topical neighbours*, not "same subject" and not contradictions (a contradiction is highly similar to what it
  contradicts). **Similarity is for retrieval only; the typed decision still decides.** Short fragments are poor for embeddings
  too, so the text embedded must include the parent heading and sibling headings, not the fragment alone.

## 3. Design

`TopicIndex` (new, `src/ai/merge/topicIndex/`, written to the topic-merge session's interface):

```ts
interface TopicIndex {
  /** The ids of the k topics closest to a part (its text with its parent and sibling headings), best first, with scores. */
  shortlist(part: { text: string; context: string[] }, k: number): { topicId: string; score: number }[];
}
```

Implementations behind it: `LexicalIndex` (default, zero cost), `EmbeddingIndex` (optional, user's provider, vectors cached in
IndexedDB by content hash and invalidated when a topic's text changes; derived from the canvas, as the topic registry already is).

How the shortlist is used in assignment (never silently dropping the right answer):
- The request holds **the shortlist (k = 8 to start) plus always**: the topic its parent was filed under, the topics its siblings
  went to, "new", and "unsure".
- **Widen, don't guess**: if the best score is low or the shortlist is flat, send the full topic list (today's behaviour) or mark
  the part unsure. A low score never becomes "new" by itself.
- Chat-model fallback gets the same shortlist, plus the full list on its own retry.
- The same index feeds the "unsure" placement rules (rule 3 today is a heading-and-wording match) and, later, retrieval of
  statements across topics for contradiction checks (today a contradiction is only looked for inside the assigned topic).

## 4. Phases (each is testable before the next; none needs a live run until phase 4)

| Phase | What | Cost | Owner |
|---|---|---|---|
| 0a | **Recall measurement, offline.** For the labelled answers we have (the 21 confident per-part answers and 69 confident batched ones, topics rebuilt from the real chats), how often is Jev's chosen topic in the lexical top 3 / 5 / 8 / 12 / 20? This decides k and whether lexical is enough. | $0 | chat-import |
| 0b | **Where the chat-model cost is.** Record reasoning and cached tokens per call (`usage` fields) in the next run's evidence; check whether Gemini's thinking tokens explain the gap between the billed $0.615 and the visible tokens, and what a low reasoning setting does. Check section size distribution of new-topic plan calls (tiny ones could use a local plan). | $0 (next run) | chat-import |
| 0c | **Jev prefix caching test**: the same topic prefix sent twice, read cached tokens. If Jev caches, restructuring the request so the topic list is the shared prefix saves most of the $0.10 without changing answers. | about $0.001 | chat-import |
| 0d | **Turn-label noise**: format imported turns so "You:" / "Assistant:" are not recovered as headings (they became catch-all topics, one of which grew past 12,000 characters). Compare topic count before/after, offline. | $0 | chat-import |
| 1 | `TopicIndex` interface + `LexicalIndex` + unit tests (including recall on the saved answers, zero-cost). | $0 | chat-import (new files) |
| 2 | Wire the shortlist into `assign.ts` `buildRequest` and the chat prompt, with the widen/unsure rules; behaviour-preserving when disabled. | $0 | topic-merge |
| 3 | `EmbeddingIndex` using the user's provider where it offers embeddings; consent and redaction; cache with explicit invalidation; falls back to lexical. Compare recall with phase 0a numbers. | about $0.001 per merge | joint |
| 4 | **One** Jev-only replay of the same 32 parts with the shortlist (estimated about $0.003 for the shorter prompts) comparing answers and confidence with the full-list baseline; then one benchmark. | under the cap | chat-import |

## 5. Acceptance (judged on correctness first, then cost)

- Agreement with the full-list answers must be high: the batched request agreed with the per-part one on only 62% of topics, which
  is **not acceptable** here. The shortlist must keep the *same topic as the full list* on at least 95% of confident answers, or
  widen automatically.
- No part is ever filed "new" because it was unsure; unsure parts are placed or shown for review.
- Duplicates, refinements and contradictions stay separate cases; similarity never decides a duplicate.
- Content is never lost on a failed index, a missing embedding provider or a model failure; the full list is the fallback.
- Cost: Jev input per merge drops by at least 70% (shortlist of 8 of 95 is about 90% less topic text); report billed credits and
  tokens, not call counts.

## 6. Risks and what we don't know

- Lexical recall on paraphrased fragments may be poor; that is what phase 0a measures before any embedding work.
- Embedding use adds a data-egress decision and a provider dependency; it should be opt-in per connection, off for users whose
  provider has none, and never required.
- Cached embeddings must be invalidated when a topic changes (key on a hash of its text plus the model id).
- Whether Jev's API caches prefixes is unknown (phase 0c).
- Reasoning-token cost on the chat model is a hypothesis until phase 0b.
