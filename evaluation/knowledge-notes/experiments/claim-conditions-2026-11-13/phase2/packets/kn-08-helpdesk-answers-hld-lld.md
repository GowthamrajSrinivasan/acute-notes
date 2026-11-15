# Packet kn-08-helpdesk-answers-hld-lld

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
u0_h1 [heading] (no cites) :: Helpdesk Answers: design from system to code
subtitle [heading] (no cites) :: Helpdesk Answers: system overview, architecture, and question answering flow
g0 [group] (no cites) :: 1. The system | stack | Helpdesk Answers relies on external CMS and LLM for cited answers.
u1_n1 [text] in g0 cites=u1,u2 :: Helpdesk Answers allows support agents to query customer problems and receive concise answers derived from the company's help articles, with each claim supported by a citation. It relies on two external systems: the Help Center CMS, which houses the articles, and an external language model provider, responsible for generating the answer text.
u1_n2 [text] in g0 (no cites) :: The system provides citations for every claim. The Help Center CMS is where help articles are authored. An external language model provider generates the answer text.
u1_a1 [text] in g0 (no cites) :: Helpdesk Answers functions as an intermediary, leveraging external systems to provide agents with cited answers. The key dependencies are the Help Center CMS for content and an external language model for answer generation.
g1 [group] (no cites) :: 2. Architecture | stack | The architecture details a question-answering system with an open Vector store partitioning decision.
u2_n1 [text] in g1 cites=u3,u4,u5,u6,u7,u8,u9 :: Agents use the Agent Console, a web client, which sends each question to the Answers API over HTTPS. The Answers API checks the agent's session and forwards the question to the Orchestrator, the service that owns the answering logic. The Orchestrator calls the Retrieval service to find candidate passages, sends those candidates to the Reranker service, and calls the Model Gateway, which is the only component allowed to talk to the external model provider. The Retrieval service reads from the Vector store, a Postgres database with the pgvector extension. The Orchestrator writes every answer, with its citations, to the Answer log table. Articles reach the Vector store through the Ingestion worker, which reads published articles from the Help Center CMS every 15 minutes, splits them into passages and writes their embeddings to the Vector store. This document does not describe the Ingestion worker's internals, and how the Vector store is partitioned has not been decided.
u2_n2 [text] in g1 cites=u3,u8,u9 :: The Answers API The Ingestion worker processes articles from the Help Center CMS every 15 minutes. The partitioning strategy for the Vector store is still undecided.
u2_a1 [text] in g1 cites=u3,u4,u5,u6,u7,u8,u9 :: The architecture outlines a question-answering system with several interconnected services. The core flow involves an Agent Console sending questions to the Answers API, which then orchestrates calls to Retrieval, Reranker, and Model Gateway services. The Retrieval service interacts with a Postgres-based Vector store. A separate Ingestion worker populates the Vector store with articles from the Help Center CMS. A key open item is the partitioning strategy for the Vector store.
u2_a2 [text] in g1 cites=u3,u8,u9 :: The annotations clarify that the 'HTTPS' connection is specifically to the 'Answers API', the 'Ingestion worker' operates on a 15-minute schedule, and the 'Vector store' partitioning is an open decision. These details provide crucial context that might be missed in a quick read of the prose.
g2 [group] (no cites) :: 5. Flow: answering a question | chain | The system answers questions by retrieving, reranking, composing, and logging responses.
u3_n1 [shape] in g2 cites=u18 :: rectangle | 1 · Agent Console posts question
u3_n2 [text] in g2 cites=u18 :: The Agent Console sends the user's question to the `POST /v1/answers` endpoint, including the ticket ID.
u3_n3 [shape] in g2 cites=u19 :: rectangle | 2 · Answers API processes question
u3_n4 [text] in g2 cites=u19 :: The Answers API validates the session and then forwards the question to the Answer composer.
u3_n5 [shape] in g2 cites=u20 :: rectangle | 3 · Answer composer requests candidates
u3_n6 [text] in g2 cites=u20 :: The Answer composer requests 50 candidate passages from the Retrieval service.
u3_n7 [shape] in g2 cites=u21,u25 :: rectangle | 4 · Rerank client processes candidates
u3_n8 [text] in g2 cites=u21 :: The Rerank client sends the 50 candidate passages to the Reranker. It then selects the top 8 passages.
u3_n9 [text] in g2 cites=u25 :: If the Reranker does not respond within 800 ms, the Rerank client skips the reranking step. In this case, it keeps the first 8 candidates based on vector-similarity order and records `rerank_skipped = true` in the Answer log.
u3_n10 [text] in g2 cites=u26 :: Skipping reranking ensures the request remains fast, but it may result in the 8 selected passages being less relevant to the question.
u3_n11 [shape] in g2 cites=u22 :: rectangle | 5 · Answer composer composes answer
u3_n12 [text] in g2 cites=u22 :: The Answer composer calls `composeAnswer`, providing the original question and the top 8 passages.
u3_n13 [shape] in g2 cites=u23 :: rectangle | 6 · Orchestrator logs answer
u3_n14 [text] in g2 cites=u23 :: The Orchestrator writes the generated answer and its citations to the Answer log.
u3_n15 [shape] in g2 cites=u24 :: rectangle | 7 · Answers API returns answer
u3_n16 [text] in g2 cites=u24 :: The Answers API sends the final answer back to the Agent Console.
u3_a1 [text] in g2 (no cites) :: This flow describes the process of generating an answer to a user's question, starting from the Agent Console and ending with the answer being returned. The key steps involve retrieving candidate passages, reranking them for relevance, composing the final answer, and logging the result.
u3_a2 [text] in g2 (no cites) :: The flow includes a conditional branch at the reranking stage. If the Reranker service does not respond within 800 ms, the reranking step is skipped to maintain speed, potentially at the cost of answer relevance. This is recorded in the Answer log.
u3_a3 [text] in g2 (no cites) :: The entire sequence achieves the generation and delivery of an answer to a user's question, along with logging of the answer and its citations for record-keeping and potential analysis.
g3 [group] (no cites) :: 3. Inside the Orchestrator | stack | The Orchestrator has four key components for processing requests.
u4_n1 [text] in g3 cites=u10,u11,u12,u13,u14 :: The Orchestrator consists of four main parts: * **Rerank client:** Sends candidate passages to the Reranker and applies a fallback rule. (P1.2) * **Context builder:** Converts selected passages into a prompt. (P1.3) * **Answer composer:** Manages the entire request process from beginning to end. (P1.4) * **Citation checker:** Verifies that all citations in a draft answer correctly reference supplied passages. (P1.5)
g4 [group] (no cites) :: 4. Inside the Retrieval service | stack | The Retrieval service embeds queries and performs vector search to find relevant passages.
u5_n1 [text] in g4 cites=u15 :: The Retrieval service is composed of two main components that work in sequence to process a user's query and retrieve relevant information.
u5_n2 [shape] in g4 (no cites) :: rectangle | Query Embedder
u5_n3 [shape] in g4 (no cites) :: rectangle | Vector Search
u5_n4 [text] in g4 cites=u16 :: The Query Embedder converts the user's question into a vector representation. This process uses the identical embedding model as the Ingestion worker to ensure consistency in vector space.
u5_n5 [text] in g4 cites=u17 :: Vector Search then queries the Vector Store to identify the 50 passages that are most similar to the embedded query vector.
u5_a1 [text] in g4 (no cites) :: The Retrieval service acts as an intermediary, translating user questions into a format suitable for vector-based searching and then retrieving the most relevant passages from the Vector Store. This two-step process ensures efficient and accurate information retrieval.
g5 [group] (no cites) :: 6. Operation: composeAnswer | stack | `composeAnswer` builds, calls, and validates, handling timeouts and partial citations.
u6_n1 [shape] in g5 cites=u27 :: rectangle | composeAnswer(question, passages)
u6_n2 [text] in g5 cites=u27 :: This function orchestrates the process of generating an answer by building a prompt, calling the Model Gateway, and then validating the draft with a Citation checker.
u6_n3 [shape] in g5 cites=u27 :: rectangle | Context builder
u6_n4 [text] in g5 cites=u27 :: The Context builder constructs the prompt, ensuring it adheres to a maximum token limit of 6,000.
u6_n5 [shape] in g5 cites=u27 :: rectangle | Model Gateway
u6_n6 [text] in g5 cites=u27,u28 :: The Model Gateway is called to generate a draft answer. This call has a 20-second timeout.
u6_n7 [text] in g5 cites=u29 :: If the Model Gateway call times out, `composeAnswer` returns an error, and the API responds with an HTTP 504 status. No partial answer is displayed in this scenario.
u6_n8 [shape] in g5 cites=u27 :: rectangle | Citation checker
u6_n9 [text] in g5 cites=u30 :: The Citation checker validates the draft answer. If it identifies a citation that lacks a matching supplied passage, the sentence containing that citation is removed, and the answer is marked as partial. The entire answer is not rejected.
u6_a1 [text] in g5 (no cites) :: The `composeAnswer` function follows a sequential process: prompt building, model inference, and then citation validation. Error handling for timeouts is strict, while citation issues result in partial answers rather than full rejection.
g6 [group] (no cites) :: 7. Where the code is | grid | Key code locations are identified, but some components lack specified paths.
u7_n1 [text] in g6 cites=u31 :: `composeAnswer` is located in `services/orchestrator/src/compose.ts`, spanning lines 40–118.
u7_n2 [text] in g6 cites=u32 :: The citation check is performed by `checkCitations` in `services/orchestrator/src/citations.ts`.
u7_n3 [text] in g6 cites=u33 :: Vector search functionality is implemented by `search` in `services/retrieval/src/search.ts`.
u7_n4 [text] in g6 cites=u34 :: The design document does not specify code locations for the Ingestion worker or the Reranker components.
u7_a1 [text] in g6 (no cites) :: Key functions like `composeAnswer`, `checkCitations`, and `search` have defined code paths. Locations for Ingestion worker and Reranker are not provided.

## Visible arrows (from -> to : label)
u1_n1 -> u1_n2
u2_n1 -> u2_n2
u3_n1 -> u3_n3
u3_n3 -> u3_n5
u3_n5 -> u3_n7
u3_n7 -> u3_n11
u3_n11 -> u3_n13
u3_n13 -> u3_n15
u5_n2 -> u5_n3 : processes query
u5_n2 -> u5_n4
u5_n3 -> u5_n5
u5_n1 -> u5_n2
u5_n1 -> u5_n3
u5_a1 -> u5_n1
u6_n1 -> u6_n2
u6_n1 -> u6_n3
u6_n3 -> u6_n4
u6_n3 -> u6_n5
u6_n5 -> u6_n6
u6_n5 -> u6_n7 : on timeout
u6_n5 -> u6_n8
u6_n8 -> u6_n9
u6_a1 -> u6_n1
g1 -> g0 : depends on
g2 -> g1 : uses components from
g3 -> g1 : details of
g4 -> g1 : details of
g5 -> g3 : part of
g5 -> g2 : step in
g6 -> g3 : code location
g6 -> g4 : code location
g6 -> g5 : code location
