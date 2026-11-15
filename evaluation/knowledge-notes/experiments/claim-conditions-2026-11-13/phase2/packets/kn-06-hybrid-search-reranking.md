# Packet kn-06-hybrid-search-reranking

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
u0_h1 [heading] (no cites) :: Hybrid search and reranking in the Harbor assistant
subtitle [heading] (no cites) :: Hybrid search, reranking, and generation in Harbor assistant
g0 [group] (no cites) :: Why retrieval decides the answer | stack | Retrieval quality is paramount for RAG system answer generation.
u1_n1 [text] in g0 cites=u1 :: A retrieval-augmented generation (RAG) system operates in two stages: first, it retrieves relevant passages from a document collection, and then a language model generates an answer based on those retrieved passages.
u1_n2 [text] in g0 cites=u2 :: The quality of the answer generated by the language model is directly dependent on the quality of the passages provided by the retrieval stage, as the model only has access to these retrieved passages and not the entire document collection.
u1_n3 [text] in g0 cites=u3 :: This document focuses on the retrieval design for the Harbor support assistant, an internal tool that answers questions using approximately 40,000 help-centre articles and release notes.
u1_a1 [text] in g0 (no cites) :: Effective retrieval is crucial for RAG systems, as it directly determines answer quality.
g1 [group] (no cites) :: Hybrid Search Components | compare | Keyword retrieval is precise, vector retrieval is semantic; a hybrid approach is likely best.
u2_n1 [text] in g1 cites=u4,u5,u6,u7,u8,u9 :: Keyword retrieval scores passages based on query terms, weighting rare terms more. BM25 is the standard scoring function, dampening repeated terms and correcting for passage length. It requires no training and is efficient. Its strength lies in exact matching, effectively finding specific codes like `E-4012` or settings like `sync.retry_window` even if they appear rarely. However, it struggles with vocabulary mismatch; for example, "why does my upload stall" won't match "transfers pause when the connection drops".
u2_n2 [text] in g1 cites=u10,u11,u12,u13,u14,u15 :: Vector retrieval converts queries and passages into numerical embeddings using an encoder model, returning passages with embeddings closest to the query's. This allows matching passages with similar meanings even if they don't share words, enabling a query like "stalled-upload" to find a passage about "paused transfers". However, embeddings are less effective with exact codes and identifiers; `E-4012` and `E-4021` appear similar to the encoder, and rare product names might be fragmented. In tests, vector retrieval alone missed the correct passage for 31 out of 50 error code-centric queries. Embeddings also require recomputation (approximately 6 hours for this collection) whenever the encoder model changes.
u2_a1 [text] in g1 (no cites) :: Keyword retrieval excels at precise matches for specific terms and codes but fails with semantic variations. Vector retrieval, using embeddings, handles semantic similarity well, overcoming vocabulary mismatch. However, it struggles with the exactness of codes and identifiers, as demonstrated by the high miss rate for error code queries. This suggests that for optimal search performance, especially in technical documentation, a hybrid approach combining both methods would be beneficial to leverage their respective strengths and mitigate their weaknesses.
g2 [group] (no cites) :: Combining the two signals | chain | Hybrid search merges retriever results using RRF to maximize recall.
u3_n7 [shape] in g2 cites=u16 :: rectangle | 1 · Run both retrievers
u3_n8 [shape] in g2 cites=u16 :: rectangle | 2 · Merge result lists
u3_n9 [text] in g2 cites=u17,u18 :: Hybrid search improves recall when lexical and semantic signals are complementary, meaning each retriever finds unique relevant passages. If retrievers return similar passages or one is poorly tuned, merging adds latency without significant benefit.
u3_n10 [shape] in g2 cites=u20 :: rectangle | 3 · Use Reciprocal Rank Fusion (RRF)
u3_n11 [text] in g2 cites=u19,u20,u21,u22 :: BM25 scores and vector similarities are on different scales and cannot be directly added. RRF addresses this by using only the rank of each passage. A passage receives `1/(k + rank)` from each list it appears in, and these contributions are summed. We use `k = 60` (a common default); a larger `k` reduces the difference between top and lower ranks.
u3_n13 [shape] in g2 cites=u23 :: rectangle | 4 · Generate candidate list
u3_n14 [text] in g2 cites=u23,u24,u25 :: Each retriever returns its top 50 passages, resulting in a fused list of at most 100 candidates (often fewer due to overlaps). This stage prioritizes recall over precision; the goal is to include the correct passage, not necessarily to rank it first. Increasing the limit to 100 passages per retriever slightly improved recall but doubled reranking time, so 50 was maintained.
u3_ax1 [text] in g2 (no cites) :: The sequence aims to combine results from two different retrieval methods (lexical and semantic) to improve the overall recall of relevant passages. This is particularly effective when each retriever finds unique relevant passages.
u3_ax2 [text] in g2 (no cites) :: The core of the merging process is Reciprocal Rank Fusion (RRF). This method is chosen because it normalizes the scores from different retrievers by focusing on rank rather than raw scores, which are on different scales. The `k` parameter (set to 60) influences the weight given to higher-ranked passages.
u3_ax3 [text] in g2 (no cites) :: Each retriever contributes its top 50 passages. The final candidate list, after fusion, contains at most 100 unique passages. This stage prioritizes recall. The limit of 50 per retriever is a trade-off between recall improvement and reranking time.
u3_ax4 [text] in g2 (no cites) :: The effectiveness of hybrid search depends on the complementarity of the retrievers. If both retrievers return similar results, or if one is poorly tuned, the merging process adds latency without significant benefit.
g3 [group] (no cites) :: Reranking | chain | Reranking improves precision but is limited by initial retrieval and cannot detect outdated information.
u4_n1 [shape] in g3 cites=u26 :: rectangle | 1 · Rescore fused candidates
u4_n2 [text] in g3 cites=u27,u28,u29 :: A cross-encoder model is used for reranking. It reads the query and a passage together to output a single relevance score. This method is more accurate than retrievers because it considers both texts simultaneously. Due to the computational cost, the cross-encoder only operates on the fused candidates, not the entire collection.
u4_n4 [shape] in g3 cites=u30 :: rectangle | 2 · Keep top 8 passages
u4_n5 [text] in g3 cites=u31,u32 :: Reranking enhances the precision of top results but doesn't guarantee a correct final answer. It can only reorder existing candidates; if the relevant passage isn't retrieved, reranking cannot find it.
u4_n6 [text] in g3 cites=u33 :: A highly relevant passage might be outdated, which relevance scores cannot detect.
u4_ax1 [text] in g3 (no cites) :: This section describes the reranking process, which involves rescoring fused candidates using a cross-encoder model to improve the precision of the top results. The process is constrained by computational cost and the quality of initial retrieval.
u4_ax2 [text] in g3 (no cites) :: The cross-encoder's high computational cost limits its application to only the fused candidates, not the entire collection. This implies a trade-off between accuracy and efficiency.
u4_ax3 [text] in g3 (no cites) :: The reranking process outputs the top 8 passages. However, it cannot compensate for poor initial retrieval or detect outdated but relevant information, highlighting its inherent limitations.
g4 [group] (no cites) :: Generation | chain | Language model answers questions from provided passages, citing sources, but not their currency.
u5_n1 [shape] in g4 cites=u34 :: rectangle | 1 · Receive Question & Passages
u5_n2 [text] in g4 cites=u34 :: The language model receives the user's question and the top 8 relevant passages. It is instructed to formulate an answer *only* using the provided passages and to include citations for each passage used.
u5_n3 [shape] in g4 cites=u35 :: rectangle | 2 · Check Passage Relevance
u5_n4 [text] in g4 cites=u35 :: If none of the provided passages contain information relevant to the question, the model is instructed to state this explicitly rather than attempting to answer from its general knowledge.
u5_n5 [shape] in g4 cites=u34,u36 :: rectangle | 3 · Generate Answer with Citations
u5_n6 [text] in g4 cites=u34,u36 :: The model generates an answer, citing the passages it used. These citations allow readers to verify claims against their source passages. However, citations do not guarantee the currency of the passage content itself.
u5_n7 [text] in g4 cites=u37 :: For a query like "What does E-4012 mean?", the system retrieves the error-code table via BM25 and a resumable uploads article via vector search. The reranker ensures both are in the top 8 passages, enabling a comprehensive answer that defines the code and explains its fix.
u5_a1 [text] in g4 (no cites) :: This sequence describes how the language model generates an answer based on retrieved passages. The core achievement is providing a cited answer directly from provided context, preventing hallucination, though it doesn't guarantee source freshness.
g5 [group] (no cites) :: Relevance, latency and cost | compare | Higher relevance correlates with increased latency and cost in search configurations.
u6_n1 [text] in g5 cites=u38,u39 :: The following table presents the trade-offs between relevance, latency, and cost for different search configurations, measured on an internal test set of 400 questions.
u6_n2 [table] in g5 cites=u40,u41,u42,u43,u44 :: Configuration | Correct passage in top 8 | Median latency | Cost per 1,000 queries | BM25 only | 61% | 35 ms | $0.02 | Vector only | 68% | 60 ms | $0.10 | Hybrid (RRF) | 79% | 70 ms | $0.12 | Hybrid + reranker | 88% | 190 ms | $0.95
u6_n3 [code] in g5 (no cites) :: acute-chart | {"chartType":"bar","categories":["BM25 only","Vector only","Hybrid (RRF)","Hybrid + reranker"],"series":[{"name":"Correct passage in top 8","values":[61,68,79,88]},{"name":"Median latency","values":[35,60,70,190]},{"name":"Cost per 1,000 queries","values":[0.02,0.10,0.12,0.95]}]}
u6_n4 [text] in g5 cites=u45 :: Reranking significantly increases latency (by ~120 ms) and cost, primarily due to running a cross-encoder over up to 100 candidates.
u6_n5 [text] in g5 cites=u46 :: The reported figures are specific to one collection and query set. Performance may vary with different collections or rerankers. **From the source:** BM25
u6_n6 [text] in g5 cites=u47 :: To meet strict latency budgets, teams can reduce the number of candidates reranked (e.g., top 30 instead of 100), which may impact recall.
u6_a1 [text] in g5 (no cites) :: The 'Hybrid + reranker' configuration offers the highest relevance (88%) but also incurs the highest latency (190 ms) and cost ($0.95 per 1,000 queries). 'BM25 only' is the most cost-effective and lowest latency option, but with the lowest relevance. The data shows a clear trade-off: higher relevance comes with increased latency and cost. The most notable increase in cost and latency is observed when adding a reranker.
g6 [group] (no cites) :: Summary | grid | Each step in the search process has limitations and doesn't guarantee correctness.
u7_n1 [shape] in g6 cites=u48 :: rectangle | Hybrid Search
u7_n2 [text] in g6 cites=u48 :: Hybrid search expands the scope of results.
u7_n3 [shape] in g6 cites=u48 :: rectangle | Reranking
u7_n4 [text] in g6 cites=u48 :: Reranking organizes the retrieved results.
u7_n5 [shape] in g6 cites=u48 :: rectangle | Generation
u7_n6 [text] in g6 cites=u48 :: Generation relies solely on the provided passages.
u7_n7 [text] in g6 cites=u49 :: Each step is effective only under specific conditions, and none guarantees a correct final answer.
u7_a1 [text] in g6 (no cites) :: No explicit decisions are presented in this summary section.

## Visible arrows (from -> to : label)
u1_n1 -> u1_n2 : then
u1_n2 -> u1_a1
u1_n3 -> u1_n1 : example
u2_n1 -> u2_a1
u2_n2 -> u2_a1
u3_n7 -> u3_n8
u3_n8 -> u3_n10
u3_n10 -> u3_n13
u3_n8 -> u3_n9
u3_n10 -> u3_n11
u3_n13 -> u3_n14
u3_ax1 -> u3_n9
u3_ax2 -> u3_n10
u3_ax3 -> u3_n14
u3_ax4 -> u3_n9
u4_n1 -> u4_n2
u4_n1 -> u4_n4
u4_n1 -> u4_n5
u4_n1 -> u4_n6
u4_ax1 -> u4_n1
u4_ax2 -> u4_n2
u4_ax3 -> u4_n4
u5_n1 -> u5_n3
u5_n3 -> u5_n5
u5_n5 -> u5_n7 : illustrates
u6_n2 -> u6_n3
u6_n2 -> u6_a1
u7_n1 -> u7_n3
u7_n3 -> u7_n5
u7_n1 -> u7_n7
u7_n3 -> u7_n7
u7_n5 -> u7_n7
g0 -> g1
g1 -> g2
g2 -> g3
g3 -> g4
g4 -> g5
g5 -> g6
g4 -> g6
