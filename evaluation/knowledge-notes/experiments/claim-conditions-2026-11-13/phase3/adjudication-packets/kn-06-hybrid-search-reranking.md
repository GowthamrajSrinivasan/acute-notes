# Adjudication packet: kn-06-hybrid-search-reranking

## Source units (id [heading path] text)
u1 [Hybrid search and reranking in the Harbor assistant › Why retrieval decides the answer] A retrieval-augmented generation (RAG) system answers a question in two stages: it first retrieves passages from a document collection, then asks a language model to write an answer from those passages.
u2 [Hybrid search and reranking in the Harbor assistant › Why retrieval decides the answer] The model never sees the rest of the collection, so the answer can only be as good as the passages that retrieval hands it.
u3 [Hybrid search and reranking in the Harbor assistant › Why retrieval decides the answer] This note describes the retrieval design of the Harbor support assistant, an internal tool that answers questions over about 40,000 help-centre articles and release notes.
u4 [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] Keyword retrieval scores a passage by the query terms it contains, weighted so that rare terms count for more than common ones.
u5 [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] BM25 is the usual scoring function for this; it also dampens the effect of a term repeated many times and corrects for passage length.
u6 [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] BM25 needs no training and is cheap to run, which is why it remains the baseline.
u7 [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] Its strength is exact matching.
u8 [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] A query for the error code `E-4012` or the setting `sync.retry_window` finds the passages that contain those strings, even when they appear only once in the whole collection.
u9 [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] Its weakness is vocabulary mismatch: a user who asks "why does my upload stall" will not match a passage that only says "transfers pause when the connection drops".
u10 [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Vector retrieval turns the query and every passage into embeddings, lists of numbers produced by an encoder model, and returns the passages whose embeddings lie closest to the query's.
u11 [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Passages that mean the same thing end up close together even when they share no words, so the stalled-upload question can find the passage about paused transfers.
u12 [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Embeddings are weaker on exact codes and identifiers.
u13 [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] To the encoder, `E-4012` and `E-4021` look almost the same, and a rare product name may be split into fragments that carry little meaning.
u14 [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] In our tests, vector retrieval alone missed the correct passage for 31 of 50 queries that consisted mainly of an error code.
u15 [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Embeddings must also be recomputed whenever the encoder changes, which for this collection takes about 6 hours.
u16 [Hybrid search and reranking in the Harbor assistant › Combining the two signals] Hybrid search runs both retrievers on the same query and merges their result lists.
u17 [Hybrid search and reranking in the Harbor assistant › Combining the two signals] Hybrid search can improve recall when lexical and semantic signals are complementary, that is, when each retriever finds relevant passages that the other misses.
u18 [Hybrid search and reranking in the Harbor assistant › Combining the two signals] If both retrievers tend to return the same passages, or if one of them is poorly tuned for the collection, merging adds latency without adding much.
u19 [Hybrid search and reranking in the Harbor assistant › Combining the two signals] BM25 scores and vector similarities sit on different scales, so they cannot simply be added together.
u20 [Hybrid search and reranking in the Harbor assistant › Combining the two signals] We use Reciprocal Rank Fusion (RRF), which ignores the raw scores and uses only the rank of each passage in each list.
u21 [Hybrid search and reranking in the Harbor assistant › Combining the two signals] A passage receives `1/(k + rank)` from every list it appears in, and the contributions are summed.
u22 [Hybrid search and reranking in the Harbor assistant › Combining the two signals] We set `k = 60`, a common default; a larger k flattens the difference between the top ranks and the lower ones.
u23 [Hybrid search and reranking in the Harbor assistant › Candidate generation] Each retriever returns its top 50 passages, so the fused list holds at most 100 candidates, and usually fewer because some passages appear in both lists.
u24 [Hybrid search and reranking in the Harbor assistant › Candidate generation] This stage is tuned for recall rather than precision: the goal is to make sure the right passage is somewhere in the list, not that it comes first.
u25 [Hybrid search and reranking in the Harbor assistant › Candidate generation] Raising the limit to 100 per retriever put the right passage in the list slightly more often, but it roughly doubled the time spent reranking, so we kept 50.
u26 [Hybrid search and reranking in the Harbor assistant › Reranking] A reranker then rescores the fused candidates.
u27 [Hybrid search and reranking in the Harbor assistant › Reranking] We use a cross-encoder, a model that reads the query and one passage together and outputs a single relevance score.
u28 [Hybrid search and reranking in the Harbor assistant › Reranking] Because it sees both texts at once, it judges relevance far more accurately than either retriever.
u29 [Hybrid search and reranking in the Harbor assistant › Reranking] That accuracy is expensive, so the cross-encoder runs only on the fused candidates, never on the whole collection.
u30 [Hybrid search and reranking in the Harbor assistant › Reranking] After reranking we keep the top 8 passages.
u31 [Hybrid search and reranking in the Harbor assistant › Reranking] Reranking improves the precision of the top results, but it does not guarantee that the final answer is correct.
u32 [Hybrid search and reranking in the Harbor assistant › Reranking] The reranker can only reorder what retrieval found: if the right passage is not among the candidates, reranking cannot recover it.
u33 [Hybrid search and reranking in the Harbor assistant › Reranking] A passage can also be highly relevant and still out of date, which no relevance score will detect.
u34 [Hybrid search and reranking in the Harbor assistant › Generation] The language model receives the question and the top 8 passages, and is instructed to answer only from them and to cite the passages it used.
u35 [Hybrid search and reranking in the Harbor assistant › Generation] If none of the passages addresses the question, it should say so rather than answer from its general knowledge.
u36 [Hybrid search and reranking in the Harbor assistant › Generation] Citations let a reader check each claim against its passage, but they do not show whether the passage itself is current.
u37 [Hybrid search and reranking in the Harbor assistant › Generation] For example, asked "What does E-4012 mean?", the assistant retrieves the error-code table through BM25 and the article on resumable uploads through vector search, and the reranker keeps both in the top 8, so the answer can define the code and explain the fix.
u38 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Every stage buys relevance with time or money.
u39 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] On an internal test set of 400 questions, we measured:
u40 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Configuration | Correct passage in top 8 | Median latency | Cost per 1,000 queries
u41 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] BM25 only | 61% | 35 ms | $0.02
u42 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Vector only | 68% | 60 ms | $0.10
u43 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Hybrid (RRF) | 79% | 70 ms | $0.12
u44 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Hybrid + reranker | 88% | 190 ms | $0.95
u45 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Reranking adds about 120 ms per query, most of it spent running the cross-encoder over up to 100 candidates, and it accounts for most of the cost increase.
u46 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] These figures come from one collection and one query set; a collection with fewer exact identifiers may see a smaller gain from BM25, and a different reranker will have a different latency.
u47 [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Teams with a strict latency budget can rerank fewer candidates, for example the top 30 of the fused list instead of all of them, at some cost in recall.
u48 [Hybrid search and reranking in the Harbor assistant › Summary] Hybrid search widens the net, reranking sorts the catch, and generation can only work with the passages it is given.
u49 [Hybrid search and reranking in the Harbor assistant › Summary] Each step helps only under its own conditions, and none of them makes the final answer certain to be right.

## Candidates with every reading

### c1: condition units u9
- GOLDEN dataset link ku.bm25-mismatch → ku.bm25: claim u4+u5+u6+u7+u8 — Keyword retrieval's weakness is vocabulary mismatch: 'why does my upload stall' does not match a passage that only says 'transfers pause when the connection drops'.
- R2 (blind): set, claim u7 (medium) — condition "Its weakness is vocabulary mismatch" / claim "Its strength is exact matching." — A real limitation of BM25 that motivates hybrid search; the strength claim stays true without it.

### c2: condition units u12, u13, u14
- GOLDEN dataset link ku.vector-exact-weakness → ku.vector: claim u10+u11 — Embeddings are weaker on exact codes and identifiers: E-4012 and E-4021 look almost the same to the encoder, and vector retrieval alone missed the correct passage for 31 of 50 error-code queries.
- R1 (phase 2 blind reviewer) r11: claim u14, binding claim — Only for queries consisting mainly of an error code.
- R2 (blind): set, claim u11 (medium) — condition "Embeddings are weaker on exact codes and identifiers." / claim "Passages that mean the same thing end up close together even when they share no words" — Limitation of vector retrieval (31 of 50 code queries missed); the semantic-matching claim remains true but the weakness must be in the notes.

### c3: condition units u15
- R1 (phase 2 blind reviewer) r12: claim u15, binding claim — Whenever the encoder changes.
- R2 (blind): set, claim u10 (high) — condition "Embeddings must also be recomputed whenever the encoder changes, which for this collection takes about 6 hours." / claim "Vector retrieval turns the query and every passage into embeddings" — An operational cost of vector retrieval, not a falsifier of any claim.

### c4: condition units u17, u18
- GOLDEN dataset link ku.hybrid-condition → ku.hybrid: claim u16+u17 — The gain depends on the signals being complementary, each retriever finding relevant passages the other misses; if both return the same passages or one is poorly tuned, merging adds latency without adding much.
- R1 (phase 2 blind reviewer) r1: claim u17, binding claim — Only when lexical and semantic signals are complementary; if both return the same passages or one is poorly tuned, merging adds latency without much gain.
- R2 (blind): claim, claim u17 (high) — condition "when lexical and semantic signals are complementary, that is, when each retriever finds relevant passages that the other misses" / claim "Hybrid search can improve recall" — Intra-sentence condition, reinforced by u18's failure cases; 'hybrid improves recall' stated unconditionally is misleading.

### c5: condition units u23
- R1 (phase 2 blind reviewer) r2: claim u23, binding claim — At most 100 candidates, usually fewer due to overlap.
- R2 (blind): not_a_condition, claim - (medium) — condition "Each retriever returns its top 50 passages, so the fused list holds at most 100 candidates" / claim "" — A configuration parameter and its arithmetic consequence; it does not limit another claim.

### c6: condition units u29
- R1 (phase 2 blind reviewer) r3: claim u27+u28+u29, binding claim — Because it is expensive, it runs only on the fused candidates, never on the whole collection.
- R2 (blind): set, claim u28 (medium) — condition "the cross-encoder runs only on the fused candidates, never on the whole collection" / claim "it judges relevance far more accurately than either retriever" — Cost-driven scope restriction on the reranker; the accuracy claim stays true, but the scope matters (it underpins u32).

### c7: condition units u31, u32, u33, u49
- GOLDEN dataset link ku.rerank-limits → ku.rerank-precision: claim u31 — Reranking does not guarantee a correct answer: it can only reorder what retrieval found, so a right passage missing from the candidates can't be recovered, and a relevant passage may still be out of date.
- R1 (phase 2 blind reviewer) r4: claim u31, binding set — It does not guarantee that the final answer is correct.
- R1 (phase 2 blind reviewer) r5: claim u31+u28, binding claim — It can only reorder what retrieval found; if the right passage is not among the candidates, reranking cannot recover it.
- R1 (phase 2 blind reviewer) r6: claim u28, binding set — A passage can be highly relevant yet out of date, which no relevance score detects.
- R2 (blind): claim, claim u31 (medium) — condition "but it does not guarantee that the final answer is correct. The reranker can only reorder what retrieval found: if the right passage is not among the candidates, reranking cannot recover it." / claim "Reranking improves the precision of the top results" — Intra-sentence 'but' plus u32/u33 limits; stating that reranking improves results without them implies it fixes retrieval misses or ensures correct answers. u49 restates the same caveat in the summary.

### c8: condition units u35
- R1 (phase 2 blind reviewer) r7: claim u34, binding set — If none of the passages addresses the question, it should say so rather than answer from general knowledge.
- R2 (blind): set, claim u34 (medium) — condition "If none of the passages addresses the question, it should say so rather than answer from its general knowledge." / claim "is instructed to answer only from them and to cite the passages it used" — A fallback rule for the no-relevant-passage case; the generation instruction claim stays true without it.

### c9: condition units u36
- GOLDEN dataset link ku.citation-limit → ku.generation: claim u34+u35 — Citations let a reader check each claim against its passage, but do not show whether the passage itself is current.
- R1 (phase 2 blind reviewer) r8: claim u36, binding set — They do not show whether the passage itself is current.
- R2 (blind): claim, claim u36 (medium) — condition "but they do not show whether the passage itself is current" / claim "Citations let a reader check each claim against its passage" — Intra-sentence caveat; without it citations would read as a guarantee of correctness/currency.

### c10: condition units u39, u46
- R1 (phase 2 blind reviewer) r9: claim u41+u42+u43+u44, binding claim — Figures come from one collection and one 400-question query set; fewer exact identifiers may mean a smaller BM25 gain, and a different reranker has different latency.
- R2 (blind): claim, claim u43+u44 (high) — condition "These figures come from one collection and one query set; a collection with fewer exact identifiers may see a smaller gain from BM25, and a different reranker will have a different latency." / claim "Hybrid + reranker | 88% | 190 ms | $0.95" — Generalisation limit on the whole results table (u41-u45); reporting the numbers as general would be misleading.

### c11: condition units u42
- GOLDEN dataset link ku.figures-caveat → ku.rerank-latency: claim u41 — These figures come from one collection and one query set; a collection with fewer exact identifiers may gain less from BM25, and a different reranker will have a different latency.
- R2 (blind): not_a_condition, claim - (high) — condition "Vector only | 68% | 60 ms | $0.10" / claim "" — A data row of the results table, not a limit on any claim.

### c12: condition units u47
- R1 (phase 2 blind reviewer) r10: claim u47, binding set — At some cost in recall.
- R2 (blind): claim, claim u47 (medium) — condition "at some cost in recall" / claim "Teams with a strict latency budget can rerank fewer candidates" — Intra-sentence trade-off; without it reranking fewer candidates reads as a free latency saving. Could alternatively be read as a set-level option limiting u45's latency cost.

## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)

### a1: condition units u25 — from R2: set, claim u23 — condition "Raising the limit to 100 per retriever put the right passage in the list slightly more often, but it roughly doubled the time spent reranking, so we kept 50." / claim "Each retriever returns its top 50 passages" — Recall-vs-latency trade-off behind the 50-per-retriever setting.

### a2: condition units u45 — from R2: set, claim u44 — condition "Reranking adds about 120 ms per query, most of it spent running the cross-encoder over up to 100 candidates, and it accounts for most of the cost increase." / claim "Hybrid + reranker | 88% | 190 ms | $0.95" — Latency and cost price of the reranker's relevance gain; the gain stays true but the cost must be kept.

