# Adjudication packet: kn-08-helpdesk-answers-hld-lld

## Source units (id [heading path] text)
u1 [Helpdesk Answers: design from system to code › 1. The system] Helpdesk Answers lets support agents ask a question about a customer's problem and get a short answer drawn from the company's help articles, with a citation for every claim.
u2 [Helpdesk Answers: design from system to code › 1. The system] It depends on two external systems: the Help Center CMS, where the articles are written, and an external language model provider, which generates the answer text.
u3 [Helpdesk Answers: design from system to code › 2. Architecture] Agents use the Agent Console, a web client, which sends each question to the Answers API over HTTPS.
u4 [Helpdesk Answers: design from system to code › 2. Architecture] The Answers API checks the agent's session and forwards the question to the Orchestrator, the service that owns the answering logic.
u5 [Helpdesk Answers: design from system to code › 2. Architecture] The Orchestrator calls the Retrieval service to find candidate passages, sends those candidates to the Reranker service, and calls the Model Gateway, which is the only component allowed to talk to the external model provider.
u6 [Helpdesk Answers: design from system to code › 2. Architecture] The Retrieval service reads from the Vector store, a Postgres database with the pgvector extension.
u7 [Helpdesk Answers: design from system to code › 2. Architecture] The Orchestrator writes every answer, with its citations, to the Answer log table.
u8 [Helpdesk Answers: design from system to code › 2. Architecture] Articles reach the Vector store through the Ingestion worker, which reads published articles from the Help Center CMS every 15 minutes, splits them into passages and writes their embeddings to the Vector store.
u9 [Helpdesk Answers: design from system to code › 2. Architecture] This document does not describe the Ingestion worker's internals, and how the Vector store is partitioned has not been decided.
u10 [Helpdesk Answers: design from system to code › 3. Inside the Orchestrator] The Orchestrator has four parts.
u11 [Helpdesk Answers: design from system to code › 3. Inside the Orchestrator] The Rerank client sends candidates to the Reranker and applies its fallback rule.
u12 [Helpdesk Answers: design from system to code › 3. Inside the Orchestrator] The Context builder turns the chosen passages into a prompt.
u13 [Helpdesk Answers: design from system to code › 3. Inside the Orchestrator] The Answer composer runs the request from start to finish.
u14 [Helpdesk Answers: design from system to code › 3. Inside the Orchestrator] The Citation checker verifies that each citation in a draft answer points to one of the passages that were supplied.
u15 [Helpdesk Answers: design from system to code › 4. Inside the Retrieval service] The Retrieval service has two parts.
u16 [Helpdesk Answers: design from system to code › 4. Inside the Retrieval service] The Query embedder turns the question into a vector using the same embedding model as the Ingestion worker.
u17 [Helpdesk Answers: design from system to code › 4. Inside the Retrieval service] Vector search then asks the Vector store for the 50 passages closest to that vector.
u18 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Agent Console posts the question to `POST /v1/answers` with the ticket id.
u19 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answers API checks the session and forwards the question to the Answer composer.
u20 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answer composer asks the Retrieval service for 50 candidate passages.
u21 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Rerank client sends the 50 candidates to the Reranker and keeps the top 8.
u22 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answer composer calls `composeAnswer` with the question and the 8 passages.
u23 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Orchestrator writes the answer and its citations to the Answer log.
u24 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answers API returns the answer to the Agent Console.
u25 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] If the Reranker does not respond within 800 ms, the Rerank client skips reranking, keeps the first 8 candidates in vector-similarity order and records `rerank_skipped = true` in the Answer log.
u26 [Helpdesk Answers: design from system to code › 5. Flow: answering a question] Skipping reranking keeps the request fast, but the 8 passages may then be less relevant.
u27 [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] `composeAnswer(question, passages)` builds the prompt with the Context builder, limited to 6,000 tokens, calls the Model Gateway, and passes the draft to the Citation checker.
u28 [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] The model call has a 20-second timeout.
u29 [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] If it times out, `composeAnswer` returns an error and the API responds with HTTP 504; no partial answer is shown.
u30 [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] If the Citation checker finds a citation that does not match any supplied passage, `composeAnswer` removes the sentence that carries it and marks the answer as partial, rather than rejecting the whole answer.
u31 [Helpdesk Answers: design from system to code › 7. Where the code is] `composeAnswer` is in `services/orchestrator/src/compose.ts`, lines 40–118.
u32 [Helpdesk Answers: design from system to code › 7. Where the code is] The citation check is `checkCitations` in `services/orchestrator/src/citations.ts`.
u33 [Helpdesk Answers: design from system to code › 7. Where the code is] Vector search is `search` in `services/retrieval/src/search.ts`.
u34 [Helpdesk Answers: design from system to code › 7. Where the code is] The design does not give code locations for the Ingestion worker or the Reranker.

## Candidates with every reading

### c1: condition units u5
- R1 (phase 2 blind reviewer) r3: claim u5, binding set — The Model Gateway is the only component allowed to talk to the external model provider.
- R2 (blind): set, claim u5 (medium) — condition "which is the only component allowed to talk to the external model provider" / claim "calls the Model Gateway" — Exclusivity constraint on model access; the call claim stays true without it.

### c2: condition units u8
- R1 (phase 2 blind reviewer) r4: claim u8, binding set — It reads only published articles, every 15 minutes (so new articles can lag up to ~15 min).
- R2 (blind): set, claim u8 (medium) — condition "reads published articles from the Help Center CMS every 15 minutes" / claim "Articles reach the Vector store through the Ingestion worker" — Freshness bound and published-only scope on ingestion.

### c3: condition units u9
- R1 (phase 2 blind reviewer) r5: claim u6, binding set — How the Vector store is partitioned has not been decided (and the Ingestion worker's internals are not described).
- R2 (blind): set, claim u8+u6 (medium) — condition "This document does not describe the Ingestion worker's internals, and how the Vector store is partitioned has not been decided." / claim "The Retrieval service reads from the Vector store, a Postgres database with the pgvector extension." — Scope gap and open decision on the ingestion worker and vector store.

### c4: condition units u16
- R1 (phase 2 blind reviewer) r10: claim u16, binding set — It must use the same embedding model as the Ingestion worker.
- R2 (blind): set, claim u16 (medium) — condition "using the same embedding model as the Ingestion worker" / claim "The Query embedder turns the question into a vector" — Coupling requirement between query and ingestion embeddings.

### c5: condition units u25, u26
- GOLDEN dataset link ku.rerank-fallback → ku.flow-rerank: claim u21 — If the Reranker does not respond within 800 ms, reranking is skipped, the first 8 candidates are kept in vector-similarity order and rerank_skipped = true is logged; faster, but the 8 passages may be less relevant.
- R1 (phase 2 blind reviewer) r1: claim u21, binding claim — If the Reranker does not respond within 800 ms, reranking is skipped, the first 8 candidates in vector-similarity order are kept and rerank_skipped = true is logged.
- R1 (phase 2 blind reviewer) r2: claim u25, binding set — Skipping keeps the request fast but the 8 passages may then be less relevant.
- R2 (blind): claim, claim u21 (high) — condition "If the Reranker does not respond within 800 ms, the Rerank client skips reranking, keeps the first 8 candidates in vector-similarity order" / claim "The Rerank client sends the 50 candidates to the Reranker and keeps the top 8." — On timeout the kept 8 are not reranked, so 'keeps the top 8' is false in that case.

### c6: condition units u27
- R1 (phase 2 blind reviewer) r6: claim u27+u12, binding set — The prompt is limited to 6,000 tokens.
- R2 (blind): set, claim u27 (medium) — condition "limited to 6,000 tokens" / claim "builds the prompt with the Context builder" — Size bound on the prompt.

### c7: condition units u28
- R1 (phase 2 blind reviewer) r7: claim u27, binding set — The model call has a 20-second timeout.
- R2 (blind): set, claim u27 (medium) — condition "The model call has a 20-second timeout." / claim "calls the Model Gateway" — Timeout bound on the model call.

### c8: condition units u29
- R1 (phase 2 blind reviewer) r8: claim u24, binding claim — If the model call times out, composeAnswer returns an error, the API responds HTTP 504, and no partial answer is shown.
- R2 (blind): claim, claim u24 (medium) — condition "If it times out, `composeAnswer` returns an error and the API responds with HTTP 504; no partial answer is shown." / claim "The Answers API returns the answer to the Agent Console." — On model timeout no answer is returned, so the flow's final step is false in that case.

### c9: condition units u30
- R1 (phase 2 blind reviewer) r9: claim u14+u27, binding set — On a non-matching citation, composeAnswer removes the sentence carrying it and marks the answer partial, rather than rejecting the whole answer.
- R2 (blind): ambiguous, claim u14+u24 (low) — condition "`composeAnswer` removes the sentence that carries it and marks the answer as partial, rather than rejecting the whole answer" / claim "The Citation checker verifies that each citation in a draft answer points to one of the passages that were supplied." — Reading A (claim): the answer returned in u24 may be partial, which the flow hides; reading B (set): it is the handling detail of the citation check in u14, which stays true.

## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)

### a1: condition units u34 — from R2: set, claim u31+u32+u33 — condition "The design does not give code locations for the Ingestion worker or the Reranker." / claim "`composeAnswer` is in `services/orchestrator/src/compose.ts`, lines 40–118." — Coverage gap in the code map.

