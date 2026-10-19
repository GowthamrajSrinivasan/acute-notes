# Helpdesk Answers: design from system to code

## 1. The system

Helpdesk Answers lets support agents ask a question about a customer's problem and get a short answer drawn from the company's help articles, with a citation for every claim. It depends on two external systems: the Help Center CMS, where the articles are written, and an external language model provider, which generates the answer text.

## 2. Architecture

Agents use the Agent Console, a web client, which sends each question to the Answers API over HTTPS. The Answers API checks the agent's session and forwards the question to the Orchestrator, the service that owns the answering logic. The Orchestrator calls the Retrieval service to find candidate passages, sends those candidates to the Reranker service, and calls the Model Gateway, which is the only component allowed to talk to the external model provider. The Retrieval service reads from the Vector store, a Postgres database with the pgvector extension. The Orchestrator writes every answer, with its citations, to the Answer log table.

Articles reach the Vector store through the Ingestion worker, which reads published articles from the Help Center CMS every 15 minutes, splits them into passages and writes their embeddings to the Vector store. This document does not describe the Ingestion worker's internals, and how the Vector store is partitioned has not been decided.

## 3. Inside the Orchestrator

The Orchestrator has four parts. The Rerank client sends candidates to the Reranker and applies its fallback rule. The Context builder turns the chosen passages into a prompt. The Answer composer runs the request from start to finish. The Citation checker verifies that each citation in a draft answer points to one of the passages that were supplied.

## 4. Inside the Retrieval service

The Retrieval service has two parts. The Query embedder turns the question into a vector using the same embedding model as the Ingestion worker. Vector search then asks the Vector store for the 50 passages closest to that vector.

## 5. Flow: answering a question

1. The Agent Console posts the question to `POST /v1/answers` with the ticket id.
2. The Answers API checks the session and forwards the question to the Answer composer.
3. The Answer composer asks the Retrieval service for 50 candidate passages.
4. The Rerank client sends the 50 candidates to the Reranker and keeps the top 8.
5. The Answer composer calls `composeAnswer` with the question and the 8 passages.
6. The Orchestrator writes the answer and its citations to the Answer log.
7. The Answers API returns the answer to the Agent Console.

If the Reranker does not respond within 800 ms, the Rerank client skips reranking, keeps the first 8 candidates in vector-similarity order and records `rerank_skipped = true` in the Answer log. Skipping reranking keeps the request fast, but the 8 passages may then be less relevant.

## 6. Operation: composeAnswer

`composeAnswer(question, passages)` builds the prompt with the Context builder, limited to 6,000 tokens, calls the Model Gateway, and passes the draft to the Citation checker. The model call has a 20-second timeout. If it times out, `composeAnswer` returns an error and the API responds with HTTP 504; no partial answer is shown. If the Citation checker finds a citation that does not match any supplied passage, `composeAnswer` removes the sentence that carries it and marks the answer as partial, rather than rejecting the whole answer.

## 7. Where the code is

`composeAnswer` is in `services/orchestrator/src/compose.ts`, lines 40–118. The citation check is `checkCitations` in `services/orchestrator/src/citations.ts`. Vector search is `search` in `services/retrieval/src/search.ts`. The design does not give code locations for the Ingestion worker or the Reranker.
