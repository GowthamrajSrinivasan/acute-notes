# Phase 4 adjudication packet: kn-06-hybrid-search-reranking

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

Note set(s): ../phase2/packets/kn-06-hybrid-search-reranking.md (distil)

## Matched pairs (X and Y found the same clause)

- X: x1 [u9] claim (general, medium) clause "Its weakness is vocabulary mismatch" → claim u7 "Its strength is exact matching."
  Y: y1 [u9] claim (R3, medium) clause "Its weakness is vocabulary mismatch" → claim u7 "Its strength is exact matching."
  context: phase3 c1 [u9] set/adjudicated claim u7 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried","g1":"separated"}} carriers {"distil":["u2_n1","u2_a1"]}

- X: x2 [u12] claim (general, high) clause "Embeddings are weaker on exact codes and identifiers." → claim u11 "Passages that mean the same thing end up close together even when they share no words"
  Y: y2 [u12] claim (R3, high) clause "Embeddings are weaker on exact codes and identifiers." → claim u11 "Passages that mean the same thing end up close together even when they share no words"
  context: phase3 c2 [u12,u13,u14] ambiguous/unresolved claim u11+u14 outcomes {"distil":{"u2_n2":"carried","u2_a1":"carried","g1":"separated"}} carriers {"distil":["u2_n2","u2_a1"]}

- X: x3 [u13] not_a_condition (general, medium) clause "To the encoder, `E-4012` and `E-4021` look almost the same" → claim - ""
  Y: y3 [u13] not_a_condition (general, medium) clause "To the encoder, `E-4012` and `E-4021` look almost the same" → claim - ""
  context: phase3 c2 [u12,u13,u14] ambiguous/unresolved claim u11+u14 outcomes {"distil":{"u2_n2":"carried","u2_a1":"carried","g1":"separated"}} carriers {"distil":["u2_n2","u2_a1"]}

- X: x4 [u14] claim (general, high) clause "that consisted mainly of an error code" → claim u14 "vector retrieval alone missed the correct passage for 31 of 50 queries"
  Y: y4 [u14] claim (general, high) clause "that consisted mainly of an error code" → claim u14 "vector retrieval alone missed the correct passage for 31 of 50 queries"
  context: phase3 c2 [u12,u13,u14] ambiguous/unresolved claim u11+u14 outcomes {"distil":{"u2_n2":"carried","u2_a1":"carried","g1":"separated"}} carriers {"distil":["u2_n2","u2_a1"]}

- X: x5 [u14] set (R2, medium) clause "In our tests" → claim u14 "vector retrieval alone missed the correct passage for 31 of 50 queries"
  Y: y5 [u14] set (R2, medium) clause "In our tests" → claim u14 "vector retrieval alone missed the correct passage for 31 of 50 queries"
  context: phase3 c2 [u12,u13,u14] ambiguous/unresolved claim u11+u14 outcomes {"distil":{"u2_n2":"carried","u2_a1":"carried","g1":"separated"}} carriers {"distil":["u2_n2","u2_a1"]}

- X: x6 [u15] set (R3, medium) clause "Embeddings must also be recomputed whenever the encoder changes" → claim u10 "Vector retrieval turns the query and every passage into embeddings"
  Y: y6 [u15] claim (general, high) clause "whenever the encoder changes" → claim u15 "Embeddings must also be recomputed"
  context: phase3 c3 [u15] ambiguous/unresolved claim u15+u10 outcomes {"distil":{"u2_n2":"carried"}} carriers {"distil":["u2_n2"]}

- X: x7 [u15] set (R2, low) clause "for this collection takes about 6 hours" → claim u15 "Embeddings must also be recomputed whenever the encoder changes"
  Y: y7 [u15] set (R3, medium) clause "for this collection takes about 6 hours" → claim u10 "Vector retrieval turns the query and every passage into embeddings"
  context: phase3 c3 [u15] ambiguous/unresolved claim u15+u10 outcomes {"distil":{"u2_n2":"carried"}} carriers {"distil":["u2_n2"]}

- X: x8 [u17] claim (R3, high) clause "when lexical and semantic signals are complementary" → claim u17 "Hybrid search can improve recall"
  Y: y8 [u17] claim (general, high) clause "when lexical and semantic signals are complementary" → claim u17 "Hybrid search can improve recall"
  context: phase3 c4 [u17,u18] claim/agreed claim u17 outcomes {"distil":{"u3_n9":"carried","u3_ax1":"carried","u3_ax4":"carried","g2":"separated","g1":"separated","u2_a1":"separated","u7_n2":"separated"}} carriers {"distil":["u3_n9","u3_ax1","u3_ax4"]}

- X: x9 [u18] claim (R4, high) clause "If both retrievers tend to return the same passages" → claim u17 "Hybrid search can improve recall"
  Y: y9 [u18] claim (R4, high) clause "If both retrievers tend to return the same passages" → claim u17 "Hybrid search can improve recall"
  context: phase3 c4 [u17,u18] claim/agreed claim u17 outcomes {"distil":{"u3_n9":"carried","u3_ax1":"carried","u3_ax4":"carried","g2":"separated","g1":"separated","u2_a1":"separated","u7_n2":"separated"}} carriers {"distil":["u3_n9","u3_ax1","u3_ax4"]}

- X: x10 [u18] claim (R4, high) clause "if one of them is poorly tuned for the collection" → claim u17 "Hybrid search can improve recall"
  Y: y10 [u18] claim (R4, high) clause "if one of them is poorly tuned for the collection" → claim u17 "Hybrid search can improve recall"
  context: phase3 c4 [u17,u18] claim/agreed claim u17 outcomes {"distil":{"u3_n9":"carried","u3_ax1":"carried","u3_ax4":"carried","g2":"separated","g1":"separated","u2_a1":"separated","u7_n2":"separated"}} carriers {"distil":["u3_n9","u3_ax1","u3_ax4"]}

- X: x11 [u23] not_a_condition (general, medium) clause "and usually fewer because some passages appear in both lists" → claim - ""
  Y: y11 [u23] not_a_condition (general, medium) clause "and usually fewer because some passages appear in both lists" → claim - ""
  context: phase3 c5 [u23] not_a_condition/adjudicated claim -

- X: x12 [u25] claim (R3, medium) clause "but it roughly doubled the time spent reranking, so we kept 50" → claim u23 "Each retriever returns its top 50 passages"
  Y: y12 [u25] claim (R3, high) clause "but it roughly doubled the time spent reranking" → claim u25 "so we kept 50"
  context: phase3 a1 [u25] ambiguous/unresolved claim u23 outcomes {"distil":{"u3_n14":"carried","u3_ax3":"carried"}} carriers {"distil":["u3_n14","u3_ax3"]}

- X: x13 [u29] claim (general, medium) clause "only on the fused candidates, never on the whole collection" → claim u29 "the cross-encoder runs"
  Y: y13 [u29] claim (general, high) clause "only on the fused candidates, never on the whole collection" → claim u29 "the cross-encoder runs only on the fused candidates"
  context: phase3 c6 [u29] ambiguous/unresolved claim u27+u28+u29 outcomes {"distil":{"u4_n2":"carried","u4_ax2":"carried"}} carriers {"distil":["u4_n2","u4_ax2"]}

- X: x14 [u29] set (R3, medium) clause "That accuracy is expensive" → claim u28 "it judges relevance far more accurately than either retriever"
  Y: y14 [u29] set (R3, medium) clause "That accuracy is expensive" → claim u28 "it judges relevance far more accurately than either retriever"
  context: phase3 c6 [u29] ambiguous/unresolved claim u27+u28+u29 outcomes {"distil":{"u4_n2":"carried","u4_ax2":"carried"}} carriers {"distil":["u4_n2","u4_ax2"]}

- X: x15 [u31] claim (R3, high) clause "but it does not guarantee that the final answer is correct" → claim u31 "Reranking improves the precision of the top results"
  Y: y15 [u31] claim (R3, high) clause "but it does not guarantee that the final answer is correct" → claim u31 "Reranking improves the precision of the top results"
  context: phase3 c7 [u31,u32,u33,u49] claim/adjudicated claim u31+u28 outcomes {"distil":{"u4_n5":"carried","u4_ax1":"carried","g3":"carried","u7_n4":"frame","u4_n2":"frame"}} carriers {"distil":["u4_n5","g3","u4_ax1","u4_ax3","u4_n6","u7_n7","g6"]}

- X: x16 [u32] claim (R4, high) clause "if the right passage is not among the candidates, reranking cannot recover it" → claim u31 "Reranking improves the precision of the top results"
  Y: y16 [u32] claim (R4, high) clause "if the right passage is not among the candidates, reranking cannot recover it" → claim u31 "Reranking improves the precision of the top results"
  context: phase3 c7 [u31,u32,u33,u49] claim/adjudicated claim u31+u28 outcomes {"distil":{"u4_n5":"carried","u4_ax1":"carried","g3":"carried","u7_n4":"frame","u4_n2":"frame"}} carriers {"distil":["u4_n5","g3","u4_ax1","u4_ax3","u4_n6","u7_n7","g6"]}

- X: x17 [u33] claim (R3, medium) clause "A passage can also be highly relevant and still out of date, which no relevance score will detect." → claim u28 "it judges relevance far more accurately than either retriever"
  Y: y17 [u33] ambiguous (R3, medium) clause "and still out of date, which no relevance score will detect" → claim u28 "it judges relevance far more accurately than either retriever" | A: claim: without it a reader would treat a top-ranked (highly relevant) passage as trustworthy and act on stale content | B: set: u31 already says reranking does not guarantee a correct answer; staleness is one more real caveat but the takeaway about reranking accuracy is unchanged | Q: Does 'judges relevance far more accurately' lead a reader to infer that top passages are correct/current, or is relevance understood as distinct from currency?
  context: phase3 c7 [u31,u32,u33,u49] claim/adjudicated claim u31+u28 outcomes {"distil":{"u4_n5":"carried","u4_ax1":"carried","g3":"carried","u7_n4":"frame","u4_n2":"frame"}} carriers {"distil":["u4_n5","g3","u4_ax1","u4_ax3","u4_n6","u7_n7","g6"]}

- X: x18 [u35] claim (R1, medium) clause "If none of the passages addresses the question" → claim u35 "it should say so rather than answer from its general knowledge"
  Y: y18 [u35] claim (R1, high) clause "If none of the passages addresses the question" → claim u35 "it should say so rather than answer from its general knowledge"
  context: phase3 c8 [u35] set/agreed claim u34 outcomes {"distil":{"u5_n2":"separated","g4":"separated","u5_a1":"separated","u7_n6":"separated"}} carriers {"distil":["u5_n4"]}

- X: x19 [u36] claim (R3, high) clause "but they do not show whether the passage itself is current" → claim u36 "Citations let a reader check each claim against its passage"
  Y: y19 [u36] claim (R3, high) clause "but they do not show whether the passage itself is current" → claim u36 "Citations let a reader check each claim against its passage"
  context: phase3 c9 [u36] ambiguous/unresolved claim u36 outcomes {"distil":{"u5_n6":"carried","g4":"carried","u5_a1":"carried"}} carriers {"distil":["u5_n6","g4","u5_a1"]}

- X: x20 [u39] set (R2, medium) clause "On an internal test set of 400 questions" → claim u44 "Hybrid + reranker | 88% | 190 ms | $0.95"
  Y: y20 [u39] set (R2, medium) clause "On an internal test set of 400 questions" → claim u44 "Hybrid + reranker | 88% | 190 ms | $0.95"
  context: phase3 c10 [u39,u46] claim/agreed claim u41+u42+u43+u44 outcomes {"distil":{"u6_n2":"separated","u6_n3":"separated","u6_a1":"separated","g5":"separated"}} carriers {"distil":["u6_n5"]}

- X: x21 [u42] not_a_condition (general, medium) clause "Vector only | 68% | 60 ms | $0.10" → claim - ""
  Y: y21 [u42] not_a_condition (general, medium) clause "Vector only | 68% | 60 ms | $0.10" → claim - ""
  context: phase3 c11 [u42] not_a_condition/adjudicated claim -

- X: x22 [u45] claim (R3, medium) clause "Reranking adds about 120 ms per query" → claim u44 "Hybrid + reranker | 88% | 190 ms | $0.95"
  Y: y22 [u45] claim (R3, medium) clause "Reranking adds about 120 ms per query" → claim u31 "Reranking improves the precision of the top results"
  context: phase3 a2 [u45] not_a_condition/adjudicated claim -

- X: x23 [u45] claim (R3, medium) clause "it accounts for most of the cost increase" → claim u44 "Hybrid + reranker | 88% | 190 ms | $0.95"
  Y: y23 [u45] claim (R3, medium) clause "it accounts for most of the cost increase" → claim u31 "Reranking improves the precision of the top results"
  context: phase3 a2 [u45] not_a_condition/adjudicated claim -

- X: x24 [u46] claim (R2, high) clause "These figures come from one collection and one query set" → claim u39 "On an internal test set of 400 questions, we measured:"
  Y: y24 [u46] claim (R2, high) clause "These figures come from one collection and one query set" → claim u41+u42+u43+u44 "Hybrid + reranker | 88% | 190 ms | $0.95"
  context: phase3 c10 [u39,u46] claim/agreed claim u41+u42+u43+u44 outcomes {"distil":{"u6_n2":"separated","u6_n3":"separated","u6_a1":"separated","g5":"separated"}} carriers {"distil":["u6_n5"]}

- X: x25 [u46] claim (R2, medium) clause "a collection with fewer exact identifiers may see a smaller gain from BM25" → claim u43 "Hybrid (RRF) | 79% | 70 ms | $0.12"
  Y: y25 [u46] set (R2, medium) clause "a collection with fewer exact identifiers may see a smaller gain from BM25" → claim u43 "Hybrid (RRF) | 79% | 70 ms | $0.12"
  context: phase3 c10 [u39,u46] claim/agreed claim u41+u42+u43+u44 outcomes {"distil":{"u6_n2":"separated","u6_n3":"separated","u6_a1":"separated","g5":"separated"}} carriers {"distil":["u6_n5"]}

- X: x26 [u46] set (R2, medium) clause "a different reranker will have a different latency" → claim u45 "Reranking adds about 120 ms per query"
  Y: y26 [u46] set (R2, medium) clause "a different reranker will have a different latency" → claim u45 "Reranking adds about 120 ms per query"
  context: phase3 c10 [u39,u46] claim/agreed claim u41+u42+u43+u44 outcomes {"distil":{"u6_n2":"separated","u6_n3":"separated","u6_a1":"separated","g5":"separated"}} carriers {"distil":["u6_n5"]}

- X: x27 [u47] claim (R3, medium) clause "at some cost in recall" → claim u47 "can rerank fewer candidates, for example the top 30 of the fused list instead of all of them"
  Y: y28 [u47] claim (R3, high) clause "at some cost in recall" → claim u47 "can rerank fewer candidates"
  context: phase3 c12 [u47] ambiguous/unresolved claim u47 outcomes {"distil":{"u6_n6":"carried"}} carriers {"distil":["u6_n6"]}

- X: x28 [u47] set (R5, medium) clause "Teams with a strict latency budget" → claim u47 "can rerank fewer candidates, for example the top 30 of the fused list instead of all of them"
  Y: y27 [u47] set (general, medium) clause "Teams with a strict latency budget" → claim u47 "can rerank fewer candidates"
  context: phase3 c12 [u47] ambiguous/unresolved claim u47 outcomes {"distil":{"u6_n6":"carried"}} carriers {"distil":["u6_n6"]}

- X: x29 [u49] claim (general, medium) clause "Each step helps only under its own conditions" → claim u48 "Hybrid search widens the net, reranking sorts the catch"
  Y: y29 [u49] claim (general, medium) clause "Each step helps only under its own conditions" → claim u48 "Hybrid search widens the net, reranking sorts the catch"
  context: phase3 c7 [u31,u32,u33,u49] claim/adjudicated claim u31+u28 outcomes {"distil":{"u4_n5":"carried","u4_ax1":"carried","g3":"carried","u7_n4":"frame","u4_n2":"frame"}} carriers {"distil":["u4_n5","g3","u4_ax1","u4_ax3","u4_n6","u7_n7","g6"]}

- X: x30 [u49] claim (R3, high) clause "none of them makes the final answer certain to be right" → claim u48 "Hybrid search widens the net, reranking sorts the catch, and generation can only work with the passages it is given."
  Y: y30 [u49] claim (R3, high) clause "none of them makes the final answer certain to be right" → claim u48 "Hybrid search widens the net, reranking sorts the catch"
  context: phase3 c7 [u31,u32,u33,u49] claim/adjudicated claim u31+u28 outcomes {"distil":{"u4_n5":"carried","u4_ax1":"carried","g3":"carried","u7_n4":"frame","u4_n2":"frame"}} carriers {"distil":["u4_n5","g3","u4_ax1","u4_ax3","u4_n6","u7_n7","g6"]}

## Found by X only

## Found by Y only

