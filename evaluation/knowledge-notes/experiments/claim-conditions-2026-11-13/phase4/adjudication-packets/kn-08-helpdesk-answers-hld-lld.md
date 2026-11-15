# Phase 4 adjudication packet: kn-08-helpdesk-answers-hld-lld

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

Note set(s): ../phase2/packets/kn-08-helpdesk-answers-hld-lld.md (distil)

## Matched pairs (X and Y found the same clause)

- X: x1 [u5] claim (general, high) clause "which is the only component allowed to talk to the external model provider" → claim u5 "calls the Model Gateway"
  Y: y1 [u5] claim (general, medium) clause "which is the only component allowed to talk to the external model provider" → claim u5 "calls the Model Gateway"
  context: phase3 c1 [u5] set/agreed claim u5 outcomes {"distil":{"u2_n1":"carried","u2_a1":"separated"}} carriers {"distil":["u2_n1"]}

- X: x2 [u8] set (general, medium) clause "every 15 minutes" → claim u8 "Articles reach the Vector store through the Ingestion worker"
  Y: y2 [u8] set (general, medium) clause "every 15 minutes" → claim u8 "Articles reach the Vector store through the Ingestion worker"
  context: phase3 c2 [u8] set/agreed claim u8 outcomes {"distil":{"u2_n1":"carried","u2_n2":"carried","u2_a1":"separated"}} carriers {"distil":["u2_n1","u2_n2","u2_a2"]}

- X: x3 [u8] set (R5, low) clause "published" → claim u8 "which reads published articles from the Help Center CMS"
  Y: y3 [u8] set (R5, low) clause "published articles" → claim u8 "Articles reach the Vector store through the Ingestion worker"
  context: phase3 c2 [u8] set/agreed claim u8 outcomes {"distil":{"u2_n1":"carried","u2_n2":"carried","u2_a1":"separated"}} carriers {"distil":["u2_n1","u2_n2","u2_a2"]}

- X: x4 [u9] set (R5, medium) clause "This document does not describe the Ingestion worker's internals" → claim u8 "Articles reach the Vector store through the Ingestion worker"
  Y: y4 [u9] set (R5, high) clause "This document does not describe the Ingestion worker's internals" → claim u8 "Articles reach the Vector store through the Ingestion worker"
  context: phase3 c3 [u9] set/agreed claim u6+u8 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried","u2_n2":"carried"}} carriers {"distil":["u2_n1","u2_n2","u2_a1","u2_a2","g1"]}

- X: x5 [u9] set (general, medium) clause "how the Vector store is partitioned has not been decided" → claim u6 "The Retrieval service reads from the Vector store, a Postgres database with the pgvector extension."
  Y: y5 [u9] set (R5, medium) clause "how the Vector store is partitioned has not been decided" → claim u6 "The Retrieval service reads from the Vector store, a Postgres database with the pgvector extension."
  context: phase3 c3 [u9] set/agreed claim u6+u8 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried","u2_n2":"carried"}} carriers {"distil":["u2_n1","u2_n2","u2_a1","u2_a2","g1"]}

- X: x6 [u16] claim (general, high) clause "using the same embedding model as the Ingestion worker" → claim u16 "The Query embedder turns the question into a vector"
  Y: y6 [u16] claim (general, medium) clause "using the same embedding model as the Ingestion worker" → claim u16 "The Query embedder turns the question into a vector"
  context: phase3 c4 [u16] set/agreed claim u16 outcomes {"distil":{"u5_n4":"carried"}} carriers {"distil":["u5_n4"]}

- X: x7 [u25] claim (R4, high) clause "If the Reranker does not respond within 800 ms" → claim u21 "The Rerank client sends the 50 candidates to the Reranker and keeps the top 8."
  Y: y7 [u25] claim (R4, high) clause "If the Reranker does not respond within 800 ms" → claim u25 "the Rerank client skips reranking, keeps the first 8 candidates in vector-similarity order"
  context: phase3 c5 [u25,u26] claim/agreed claim u21 outcomes {"distil":{"u3_n8":"separated","u3_a1":"separated"}} carriers {"distil":["u3_n9","u3_a2"]}

- X: x8 [u26] claim (R3, medium) clause "but the 8 passages may then be less relevant" → claim u26 "Skipping reranking keeps the request fast"
  Y: y8 [u26] claim (R3, high) clause "but the 8 passages may then be less relevant" → claim u26 "Skipping reranking keeps the request fast"
  context: phase3 c5 [u25,u26] claim/agreed claim u21 outcomes {"distil":{"u3_n8":"separated","u3_a1":"separated"}} carriers {"distil":["u3_n9","u3_a2"]}

- X: x9 [u27] claim (general, medium) clause "limited to 6,000 tokens" → claim u27 "builds the prompt with the Context builder"
  Y: y9 [u27] claim (general, medium) clause "limited to 6,000 tokens" → claim u27 "builds the prompt with the Context builder"
  context: phase3 c6 [u27] set/agreed claim u27+u12 outcomes {"distil":{"u6_n2":"separated","u6_n4":"carried","u4_n1":"separated"}} carriers {"distil":["u6_n4"]}

- X: x10 [u28] claim (general, medium) clause "a 20-second timeout" → claim u27 "calls the Model Gateway"
  Y: y10 [u28] set (general, medium) clause "20-second timeout" → claim u27 "calls the Model Gateway"
  context: phase3 c7 [u28] set/agreed claim u27 outcomes {"distil":{"u6_n2":"separated","u6_n6":"carried"}} carriers {"distil":["u6_n6"]}

- X: x11 [u29] claim (general, high) clause "If it times out" → claim u29 "`composeAnswer` returns an error and the API responds with HTTP 504; no partial answer is shown"
  Y: y11 [u29] claim (general, high) clause "If it times out" → claim u29 "`composeAnswer` returns an error and the API responds with HTTP 504"
  context: phase3 c8 [u29] claim/agreed claim u24 outcomes {"distil":{"u3_n16":"separated","u3_a1":"separated","u3_a3":"separated"}} carriers {"distil":["u6_n7"]}

- X: x12 [u30] claim (general, high) clause "If the Citation checker finds a citation that does not match any supplied passage" → claim u30 "`composeAnswer` removes the sentence that carries it and marks the answer as partial, rather than rejecting the whole answer"
  Y: y12 [u30] claim (general, high) clause "If the Citation checker finds a citation that does not match any supplied passage" → claim u30 "`composeAnswer` removes the sentence that carries it and marks the answer as partial"
  context: phase3 c9 [u30] ambiguous/unresolved claim u14+u27+u24 outcomes {"distil":{"u4_n1":"separated","u6_n2":"separated","u6_n9":"carried","u6_a1":"carried","u3_n16":"separated","u3_a1":"separated","u3_a3":"separated"}} carriers {"distil":["u6_n9","u6_a1"]}

- X: x13 [u34] set (R5, medium) clause "The design does not give code locations for the Ingestion worker or the Reranker." → claim u31 "`composeAnswer` is in `services/orchestrator/src/compose.ts`, lines 40–118."
  Y: y13 [u34] set (R5, medium) clause "The design does not give code locations for the Ingestion worker or the Reranker." → claim u31 "`composeAnswer` is in `services/orchestrator/src/compose.ts`"
  context: phase3 a1 [u34] ambiguous/unresolved claim u31+u32+u33 outcomes {"distil":{"u7_n1":"separated","u7_n2":"separated","u7_n3":"separated"}} carriers {"distil":["u7_n4","u7_a1"]}

## Found by X only

## Found by Y only

