# Hybrid retrieval for the help centre

## Why combine two signals

Keyword search finds exact product names and error codes, while vector search finds passages that use different words for the same idea. Combining the two can improve recall on support questions, but it typically adds 20 to 40 ms to each query. Some teams see little gain when their documents are short and use a fixed vocabulary.

## How the scores are merged

Each retriever returns up to 50 candidates. The candidates are merged with reciprocal rank fusion, which only uses rank positions and so does not depend on the two score scales. A reranker may reorder the top 20 when the query is longer than four words.

## When to skip the reranker

The reranker should be skipped when the latency budget is under 150 ms. It can also be skipped if the cache already holds a valid result for the same query, because the cached order was reranked when it was stored.

## Limits

Hybrid retrieval does not fix missing content: if no article answers the question, neither retriever can find one. Note that fusion weights tuned on English queries may not transfer to other languages.
