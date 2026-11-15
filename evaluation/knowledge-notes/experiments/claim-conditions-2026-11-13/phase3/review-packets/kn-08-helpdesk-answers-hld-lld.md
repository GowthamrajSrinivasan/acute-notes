# Second review packet: kn-08-helpdesk-answers-hld-lld

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

## Candidate conditions (the span to judge; its claim link and binding are YOURS to decide)
c1: units u5 :: The Orchestrator calls the Retrieval service to find candidate passages, sends those candidates to the Reranker service, and calls the Model Gateway, which is the only component allowed to talk to the external model provider.
c2: units u8 :: Articles reach the Vector store through the Ingestion worker, which reads published articles from the Help Center CMS every 15 minutes, splits them into passages and writes their embeddings to the Vector store.
c3: units u9 :: This document does not describe the Ingestion worker's internals, and how the Vector store is partitioned has not been decided.
c4: units u16 :: The Query embedder turns the question into a vector using the same embedding model as the Ingestion worker.
c5: units u25, u26 :: If the Reranker does not respond within 800 ms, the Rerank client skips reranking, keeps the first 8 candidates in vector-similarity order and records `rerank_skipped = true` in the Answer log. Skipping reranking keeps the request fast, but the 8 passages may then be less relevant.
c6: units u27 :: `composeAnswer(question, passages)` builds the prompt with the Context builder, limited to 6,000 tokens, calls the Model Gateway, and passes the draft to the Citation checker.
c7: units u28 :: The model call has a 20-second timeout.
c8: units u29 :: If it times out, `composeAnswer` returns an error and the API responds with HTTP 504; no partial answer is shown.
c9: units u30 :: If the Citation checker finds a citation that does not match any supplied passage, `composeAnswer` removes the sentence that carries it and marks the answer as partial, rather than rejecting the whole answer.
