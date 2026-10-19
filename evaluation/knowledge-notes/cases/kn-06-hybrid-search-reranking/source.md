# Hybrid search and reranking in the Harbor assistant

## Why retrieval decides the answer

A retrieval-augmented generation (RAG) system answers a question in two stages: it first retrieves passages from a document collection, then asks a language model to write an answer from those passages. The model never sees the rest of the collection, so the answer can only be as good as the passages that retrieval hands it. This note describes the retrieval design of the Harbor support assistant, an internal tool that answers questions over about 40,000 help-centre articles and release notes.

## Keyword retrieval with BM25

Keyword retrieval scores a passage by the query terms it contains, weighted so that rare terms count for more than common ones. BM25 is the usual scoring function for this; it also dampens the effect of a term repeated many times and corrects for passage length. BM25 needs no training and is cheap to run, which is why it remains the baseline. Its strength is exact matching. A query for the error code `E-4012` or the setting `sync.retry_window` finds the passages that contain those strings, even when they appear only once in the whole collection. Its weakness is vocabulary mismatch: a user who asks "why does my upload stall" will not match a passage that only says "transfers pause when the connection drops".

## Vector retrieval with embeddings

Vector retrieval turns the query and every passage into embeddings, lists of numbers produced by an encoder model, and returns the passages whose embeddings lie closest to the query's. Passages that mean the same thing end up close together even when they share no words, so the stalled-upload question can find the passage about paused transfers. Embeddings are weaker on exact codes and identifiers. To the encoder, `E-4012` and `E-4021` look almost the same, and a rare product name may be split into fragments that carry little meaning. In our tests, vector retrieval alone missed the correct passage for 31 of 50 queries that consisted mainly of an error code. Embeddings must also be recomputed whenever the encoder changes, which for this collection takes about 6 hours.

## Combining the two signals

Hybrid search runs both retrievers on the same query and merges their result lists. Hybrid search can improve recall when lexical and semantic signals are complementary, that is, when each retriever finds relevant passages that the other misses. If both retrievers tend to return the same passages, or if one of them is poorly tuned for the collection, merging adds latency without adding much. BM25 scores and vector similarities sit on different scales, so they cannot simply be added together. We use Reciprocal Rank Fusion (RRF), which ignores the raw scores and uses only the rank of each passage in each list. A passage receives `1/(k + rank)` from every list it appears in, and the contributions are summed. We set `k = 60`, a common default; a larger k flattens the difference between the top ranks and the lower ones.

## Candidate generation

Each retriever returns its top 50 passages, so the fused list holds at most 100 candidates, and usually fewer because some passages appear in both lists. This stage is tuned for recall rather than precision: the goal is to make sure the right passage is somewhere in the list, not that it comes first. Raising the limit to 100 per retriever put the right passage in the list slightly more often, but it roughly doubled the time spent reranking, so we kept 50.

## Reranking

A reranker then rescores the fused candidates. We use a cross-encoder, a model that reads the query and one passage together and outputs a single relevance score. Because it sees both texts at once, it judges relevance far more accurately than either retriever. That accuracy is expensive, so the cross-encoder runs only on the fused candidates, never on the whole collection. After reranking we keep the top 8 passages.

Reranking improves the precision of the top results, but it does not guarantee that the final answer is correct. The reranker can only reorder what retrieval found: if the right passage is not among the candidates, reranking cannot recover it. A passage can also be highly relevant and still out of date, which no relevance score will detect.

## Generation

The language model receives the question and the top 8 passages, and is instructed to answer only from them and to cite the passages it used. If none of the passages addresses the question, it should say so rather than answer from its general knowledge. Citations let a reader check each claim against its passage, but they do not show whether the passage itself is current. For example, asked "What does E-4012 mean?", the assistant retrieves the error-code table through BM25 and the article on resumable uploads through vector search, and the reranker keeps both in the top 8, so the answer can define the code and explain the fix.

## Relevance, latency and cost

Every stage buys relevance with time or money. On an internal test set of 400 questions, we measured:

| Configuration | Correct passage in top 8 | Median latency | Cost per 1,000 queries |
|---|---|---|---|
| BM25 only | 61% | 35 ms | $0.02 |
| Vector only | 68% | 60 ms | $0.10 |
| Hybrid (RRF) | 79% | 70 ms | $0.12 |
| Hybrid + reranker | 88% | 190 ms | $0.95 |

Reranking adds about 120 ms per query, most of it spent running the cross-encoder over up to 100 candidates, and it accounts for most of the cost increase. These figures come from one collection and one query set; a collection with fewer exact identifiers may see a smaller gain from BM25, and a different reranker will have a different latency. Teams with a strict latency budget can rerank fewer candidates, for example the top 30 of the fused list instead of all of them, at some cost in recall.

## Summary

Hybrid search widens the net, reranking sorts the catch, and generation can only work with the passages it is given. Each step helps only under its own conditions, and none of them makes the final answer certain to be right.
