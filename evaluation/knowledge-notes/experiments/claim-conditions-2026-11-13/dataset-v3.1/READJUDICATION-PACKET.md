# Re-adjudication packet: claim–condition dataset v3.1-pre

Two humans answer **independently**, without discussing items until both have handed in. Rubric:
`phase4/EVAL-SPEC-v3.md` §2 as amended by `review-v3/EVAL-SPEC-v3.1-AMENDMENT.md` A1 (at most two links: a
`local` link first, a `section` link only with a positive evidence span). **Don't open** `READJUDICATION-QUEUE.json`,
`records/`, `phase4/adjudicated/`, `review-v3/human-review/` or the other reviewer's answers until both have finished:
they hold earlier labels.

For each item, record in a copy of `READJUDICATION-ANSWERS.template.json`:
- `verdict`: `claim`, `set`, `ambiguous` (write both readings and the deciding question in `note`) or `not_a_condition`;
- `links`: up to two, each `{ "level": "local" | "section", "units": [...], "evidence": "<exact source words>", "binding": "claim" | "set" | "ambiguous" }`; empty for `not_a_condition`;
- `secondLink` (only where the item asks a second-link question): `"add"` with an exact evidence span in that link, or `"reject"`;
- `confidence` and a one-sentence `note`.

64 items.

## R01 (kn-09-billing-codebase-map)

Clause: **"nothing stops another module from querying `price_plans` directly"** (in u49)

- `u47` [Ledgerline billing service: codebase map › Data contract] I did not read the definitions of `BillingPeriod` and `PricedLine`.
- `u48` [Ledgerline billing service: codebase map › Interpretation] My reading is that `billing/pricing` acts, in effect, as the pricing boundary: as far as I could see, no code outside it reads `price_plans`, so a pricing change should only need edits there.
- **→** `u49` [Ledgerline billing service: codebase map › Interpretation] This is an interpretation of the current structure, not a rule the code enforces; nothing stops another module from querying `price_plans` directly.
- `u50` [Ledgerline billing service: codebase map › Interpretation] In the same spirit, `generateInvoice` behaves like an orchestrator.
- `u51` [Ledgerline billing service: codebase map › Interpretation] It holds no pricing or tax logic of its own and only sequences the calls, which is why it reads so short for the work it starts.

## R02 (kn-05-incident-review-meeting)

Clause: **"that would have paged twice on noise"** (in u30)

- `u1` [Post-incident review: checkout outage, March 14] Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
- `u2` [Post-incident review: checkout outage, March 14] Dana: Okay, I think everyone's here.
- `u3` [Post-incident review: checkout outage, March 14] Did people manage to grab coffee?
- `u4` [Post-incident review: checkout outage, March 14] The machine on four is broken again.
- `u5` [Post-incident review: checkout outage, March 14] Kenji: I brought my own.
- `u6` [Post-incident review: checkout outage, March 14] Lesson learned.
- `u7` [Post-incident review: checkout outage, March 14] Dana: Smart.
- `u8` [Post-incident review: checkout outage, March 14] Right, let's start.
- `u9` [Post-incident review: checkout outage, March 14] This is the blameless review for the checkout outage on Friday, March 14.
- `u10` [Post-incident review: checkout outage, March 14] Marcus, can you walk us through the timeline?
- `u11` [Post-incident review: checkout outage, March 14] Marcus: Sure.
- `u12` [Post-incident review: checkout outage, March 14] At 16:40 a config change to the payments service went out.
- `u13` [Post-incident review: checkout outage, March 14] It changed the gateway connection pool from 50 connections to 5.
- `u14` [Post-incident review: checkout outage, March 14] That was a typo; the intent was 55.
- `u15` [Post-incident review: checkout outage, March 14] Checkout requests started queuing for a connection and timing out almost immediately.
- `u16` [Post-incident review: checkout outage, March 14] Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change.
- `u17` [Post-incident review: checkout outage, March 14] I rolled the config back at 17:15, and checkout was fully recovered at 17:27.
- `u18` [Post-incident review: checkout outage, March 14] So customers saw errors for 47 minutes in total.
- `u19` [Post-incident review: checkout outage, March 14] Kenji: And on our side, we counted about 2,300 failed checkouts in that window.
- `u20` [Post-incident review: checkout outage, March 14] Support got 140 tickets before we posted the status page.
- `u21` [Post-incident review: checkout outage, March 14] Dana: Why did the alert take 22 minutes?
- `u22` [Post-incident review: checkout outage, March 14] Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
- `u23` [Post-incident review: checkout outage, March 14] Errors went over 10% around 16:47, so the earliest it could fire was 17:02.
- `u24` [Post-incident review: checkout outage, March 14] It did exactly what it was configured to do.
- `u25` [Post-incident review: checkout outage, March 14] Leila: Which is too slow for checkout.
- `u26` [Post-incident review: checkout outage, March 14] 15 minutes of sustained errors is a long time when every minute is lost revenue.
- `u27` [Post-incident review: checkout outage, March 14] Dana: Fair.
- `u28` [Post-incident review: checkout outage, March 14] What do we want instead?
- `u29` [Post-incident review: checkout outage, March 14] Marcus: I'd propose 5% over 5 minutes for checkout specifically.
- **→** `u30` [Post-incident review: checkout outage, March 14] I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.
- … (71 more units in this section; see `phase4/annotation-packets/kn-05-incident-review-meeting.md`)

## R03 (kn-03-blue-green-deploy)

Clause: **"Do not run the next release's migrations while blue is still on standby."** (in u29)

- `u25` [Blue-green deployment for the orders service › When things go wrong] A rollback before step 5 is cheap, because customers never saw green.
- `u26` [Blue-green deployment for the orders service › When things go wrong] A switch-back after step 5 is also fast, but requests that were in flight on green during the switch may fail and need a client retry.
- `u27` [Blue-green deployment for the orders service › When things go wrong] Neither kind of rollback reverts the database, which is why the backward-compatible migration requirement matters.
- `u28` [Blue-green deployment for the orders service › When things go wrong] Whichever way you roll back, record what failed before trying again, because a second attempt with the same build tends to fail the same way.
- **→** `u29` [Blue-green deployment for the orders service › When things go wrong] Do not run the next release's migrations while blue is still on standby.
- `u30` [Blue-green deployment for the orders service › When things go wrong] If you do, the standby may no longer work against the schema, and the switch-back stops being a safe option.
- `u31` [Blue-green deployment for the orders service › When things go wrong] That's all there is to it. Happy deploying!

## R04 (kn-06-hybrid-search-reranking)

Clause: **"whenever the encoder changes"** (in u15)

- `u10` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Vector retrieval turns the query and every passage into embeddings, lists of numbers produced by an encoder model, and returns the passages whose embeddings lie closest to the query's.
- `u11` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Passages that mean the same thing end up close together even when they share no words, so the stalled-upload question can find the passage about paused transfers.
- `u12` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Embeddings are weaker on exact codes and identifiers.
- `u13` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] To the encoder, `E-4012` and `E-4021` look almost the same, and a rare product name may be split into fragments that carry little meaning.
- `u14` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] In our tests, vector retrieval alone missed the correct passage for 31 of 50 queries that consisted mainly of an error code.
- **→** `u15` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Embeddings must also be recomputed whenever the encoder changes, which for this collection takes about 6 hours.
- `u16` [Hybrid search and reranking in the Harbor assistant › Combining the two signals] Hybrid search runs both retrievers on the same query and merges their result lists.
- `u17` [Hybrid search and reranking in the Harbor assistant › Combining the two signals] Hybrid search can improve recall when lexical and semantic signals are complementary, that is, when each retriever finds relevant passages that the other misses.

**Second-link question:** does this clause materially limit the claim in u10, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R05 (kn-08-helpdesk-answers-hld-lld)

Clause: **"a 20-second timeout"** (in u28)

- `u26` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] Skipping reranking keeps the request fast, but the 8 passages may then be less relevant.
- `u27` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] `composeAnswer(question, passages)` builds the prompt with the Context builder, limited to 6,000 tokens, calls the Model Gateway, and passes the draft to the Citation checker.
- **→** `u28` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] The model call has a 20-second timeout.
- `u29` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] If it times out, `composeAnswer` returns an error and the API responds with HTTP 504; no partial answer is shown.
- `u30` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] If the Citation checker finds a citation that does not match any supplied passage, `composeAnswer` removes the sentence that carries it and marks the answer as partial, rather than rejecting the whole answer.

## R06 (kn-12-flag-rollout-update)

Clause: **"turning it back on starts the rollout again from the internal stage"** (in u24)

- `u20` [Feature flag rollout guide › Kill switch] Every flag must have a kill switch that turns it off within 1 minute.
- `u21` [Feature flag rollout guide › Kill switch] The kill switch is tested in staging before the flag enters canary, and the test is recorded in the rollout tool.
- `u22` [Feature flag rollout guide › Kill switch] A flag without a tested kill switch cannot enter canary.
- `u23` [Feature flag rollout guide › Kill switch] Anyone on the owning team may use the kill switch without asking for approval.
- **→** `u24` [Feature flag rollout guide › Kill switch] Turning a flag off is always safe; turning it back on starts the rollout again from the internal stage.
- `u25` [Feature flag rollout guide › Monitoring during general availability] While the flag ramps up, the owner watches the error dashboard and pages the on-call engineer if errors rise.
- `u26` [Feature flag rollout guide › Monitoring during general availability] The dashboard shows flagged and unflagged requests side by side, so a difference between them points at the flag rather than at the platform.

## R07 (kn-10-inventory-architecture-frames)

Clause: **"not confirmed within 15 minutes"** (in u15)

- `u9` [Shelfwise inventory service: a tour of the codebase › API and orchestration] The HTTP handlers in `src/api/routes.ts` are the only entry point for requests.
- `u10` [Shelfwise inventory service: a tour of the codebase › API and orchestration] They validate the request body, attach a correlation ID and pass the work on; they contain no business rules.
- `u11` [Shelfwise inventory service: a tour of the codebase › API and orchestration] A `POST /reservations` request goes to the reservation orchestrator in `src/orders/reserve.ts`.
- `u12` [Shelfwise inventory service: a tour of the codebase › API and orchestration] The reservation orchestrator coordinates a reservation from start to finish.
- `u13` [Shelfwise inventory service: a tour of the codebase › API and orchestration] It asks the stock ledger to reserve the requested quantity, asks the pricing rules for the order's price, and, once both succeed, publishes a StockReserved event to the message broker.
- `u14` [Shelfwise inventory service: a tour of the codebase › API and orchestration] If the ledger cannot reserve the full quantity, the orchestrator rejects the whole order; it never makes a partial reservation.
- **→** `u15` [Shelfwise inventory service: a tour of the codebase › API and orchestration] A reservation that is not confirmed within 15 minutes is released by the ledger and the stock becomes available again.
- `u16` [Shelfwise inventory service: a tour of the codebase › Domain services] The stock ledger in `src/ledger/ledger.ts` owns stock levels.
- `u17` [Shelfwise inventory service: a tour of the codebase › Domain services] It records every change as an append-only ledger entry (reserve, release, restock) and writes those entries to Postgres.

## R08 (kn-11-ambiguous-analytics-proposal)

Clause: **"If an account cannot be found"** (in u12)

- `u5` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Client SDKs in the web and mobile apps send events to a collector service over HTTPS.
- `u6` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Clients batch events and send them every 10 seconds, or sooner when the app goes to the background.
- `u7` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Each event carries an event name, a timestamp, an anonymous device id and, for signed-in users, an account id.
- `u8` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The collector validates each event against the schema registry and rejects events that do not match a registered schema.
- `u9` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Accepted events are published to the `analytics.events` topic on the message bus.
- `u10` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] An enrichment step consumes the topic and adds account attributes, such as plan tier and region.
- `u11` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The enrichment step uses the user service.
- **→** `u12` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] If an account cannot be found, the event is passed on without account attributes.
- `u13` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Enriched events are then written to the warehouse in hourly batches, where the analytics team builds dashboards on them.
- `u14` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The first dashboards will cover the onboarding funnel and weekly active accounts per plan tier.
- `u15` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] We expect the user service to stay lightly loaded, so enrichment should avoid adding much traffic to it.

**Second-link question:** does this clause materially limit the claim in u10, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R09 (kn-10-inventory-architecture-frames)

Clause: **"it never makes a partial reservation"** (in u14)

- `u9` [Shelfwise inventory service: a tour of the codebase › API and orchestration] The HTTP handlers in `src/api/routes.ts` are the only entry point for requests.
- `u10` [Shelfwise inventory service: a tour of the codebase › API and orchestration] They validate the request body, attach a correlation ID and pass the work on; they contain no business rules.
- `u11` [Shelfwise inventory service: a tour of the codebase › API and orchestration] A `POST /reservations` request goes to the reservation orchestrator in `src/orders/reserve.ts`.
- `u12` [Shelfwise inventory service: a tour of the codebase › API and orchestration] The reservation orchestrator coordinates a reservation from start to finish.
- `u13` [Shelfwise inventory service: a tour of the codebase › API and orchestration] It asks the stock ledger to reserve the requested quantity, asks the pricing rules for the order's price, and, once both succeed, publishes a StockReserved event to the message broker.
- **→** `u14` [Shelfwise inventory service: a tour of the codebase › API and orchestration] If the ledger cannot reserve the full quantity, the orchestrator rejects the whole order; it never makes a partial reservation.
- `u15` [Shelfwise inventory service: a tour of the codebase › API and orchestration] A reservation that is not confirmed within 15 minutes is released by the ledger and the stock becomes available again.
- `u16` [Shelfwise inventory service: a tour of the codebase › Domain services] The stock ledger in `src/ledger/ledger.ts` owns stock levels.

## R10 (kn-04-queue-choice)

Clause: **"today only the email handler is"** (in u27)

- `u25` [Choosing a queue for background jobs › Selection criteria] Portability away from our cloud provider: 10%
- `u26` [Choosing a queue for background jobs › Benefits and trade-offs] Option A needs almost no operational work, and failed messages move to a dead-letter queue automatically.
- **→** `u27` [Choosing a queue for background jobs › Benefits and trade-offs] The catch is that the service delivers each message at least once, so every job handler must be made idempotent before we switch; today only the email handler is.
- `u28` [Choosing a queue for background jobs › Benefits and trade-offs] It also ties us to one provider's API, and local development needs an emulator that does not support dead-lettering.
- `u29` [Choosing a queue for background jobs › Benefits and trade-offs] Option B gives us priority queues and delayed delivery, which would let month-end invoices jump ahead of webhook retries.
- `u30` [Choosing a queue for background jobs › Benefits and trade-offs] No one on the team has run this broker in production, so the 12 hours a month is an estimate, not a measurement.
- `u31` [Choosing a queue for background jobs › Benefits and trade-offs] Upgrades need a maintenance window.
- `u32` [Choosing a queue for background jobs › Benefits and trade-offs] Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue.
- `u33` [Choosing a queue for background jobs › Benefits and trade-offs] That guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it.
- `u34` [Choosing a queue for background jobs › Benefits and trade-offs] Polling also adds read load to the primary database, which is the main risk at month-end.

## R11 (kn-08-helpdesk-answers-hld-lld)

Clause: **"limited to 6,000 tokens"** (in u27)

- `u25` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] If the Reranker does not respond within 800 ms, the Rerank client skips reranking, keeps the first 8 candidates in vector-similarity order and records `rerank_skipped = true` in the Answer log.
- `u26` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] Skipping reranking keeps the request fast, but the 8 passages may then be less relevant.
- **→** `u27` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] `composeAnswer(question, passages)` builds the prompt with the Context builder, limited to 6,000 tokens, calls the Model Gateway, and passes the draft to the Citation checker.
- `u28` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] The model call has a 20-second timeout.
- `u29` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] If it times out, `composeAnswer` returns an error and the API responds with HTTP 504; no partial answer is shown.
- `u30` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] If the Citation checker finds a citation that does not match any supplied passage, `composeAnswer` removes the sentence that carries it and marks the answer as partial, rather than rejecting the whole answer.

## R12 (kn-08-helpdesk-answers-hld-lld)

Clause: **"using the same embedding model as the Ingestion worker"** (in u16)

- `u14` [Helpdesk Answers: design from system to code › 3. Inside the Orchestrator] The Citation checker verifies that each citation in a draft answer points to one of the passages that were supplied.
- `u15` [Helpdesk Answers: design from system to code › 4. Inside the Retrieval service] The Retrieval service has two parts.
- **→** `u16` [Helpdesk Answers: design from system to code › 4. Inside the Retrieval service] The Query embedder turns the question into a vector using the same embedding model as the Ingestion worker.
- `u17` [Helpdesk Answers: design from system to code › 4. Inside the Retrieval service] Vector search then asks the Vector store for the 50 passages closest to that vector.
- `u18` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Agent Console posts the question to `POST /v1/answers` with the ticket id.

## R13 (kn-02-edge-cache-invalidation)

Clause: **"it removes only the exact URL you name"** (in u19)

- `u13` [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.
- `u14` [Invalidating cached content at the edge › Purging by URL] The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin.
- `u15` [Invalidating cached content at the edge › Purging by URL] Larkspur's publishing system sends a purge for the article URL every time an editor saves a correction.
- `u16` [Invalidating cached content at the edge › Purging by URL] A purge request is accepted quickly, but it is not applied everywhere at the same moment.
- `u17` [Invalidating cached content at the edge › Purging by URL] The CDN has to deliver the purge to every edge location, and each location removes its copy on its own schedule, so for a short time some locations serve the new version while others still serve the old one.
- `u18` [Invalidating cached content at the edge › Purging by URL] Purging is eventually consistent, not instant.
- **→** `u19` [Invalidating cached content at the edge › Purging by URL] Purging by URL has a second limit: it removes only the exact URL you name.
- `u20` [Invalidating cached content at the edge › Purging by URL] A corrected headline also appears on the home page, the section page and the RSS feed, and each of those cached pages keeps the old headline until it is purged separately or expires.
- `u21` [Invalidating cached content at the edge › Purging by URL] Query strings make this worse, because `/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it.
- `u22` [Invalidating cached content at the edge › Purging by URL] Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust.
- `u23` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The origin calls the purge API with the URL. The API answers within about 150 milliseconds, but the answer only means the request was queued.
- `u24` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The CDN's control plane fans the purge out to all 90 edge locations.
- `u25` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Each location marks its cached copy invalid, so the next request there is a cache miss that goes to the origin.
- `u26` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] In Larkspur's measurements, half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds.
- `u27` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Until the last location has applied the purge, a reader routed to that location still gets the old copy.

## R14 (kn-11-ambiguous-analytics-proposal)

Clause: **"the web app's sign-up and checkout events"** (in u35)

- `u33` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Warehouse raw events | Data team | 90 days
- `u34` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Schema registry | TBD | indefinite
- **→** `u35` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 1 covers the web app's sign-up and checkout events.
- `u36` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 2 adds mobile events once the mobile SDK is ready; no date has been set for it.
- `u37` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 1 is expected to take about 6 weeks for 2 engineers.
- `u38` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] The cost of running the pipeline has not been estimated yet.

## R15 (kn-02-edge-cache-invalidation)

Clause: **"but it is not applied everywhere at the same moment"** (in u16)

- `u13` [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.
- `u14` [Invalidating cached content at the edge › Purging by URL] The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin.
- `u15` [Invalidating cached content at the edge › Purging by URL] Larkspur's publishing system sends a purge for the article URL every time an editor saves a correction.
- **→** `u16` [Invalidating cached content at the edge › Purging by URL] A purge request is accepted quickly, but it is not applied everywhere at the same moment.
- `u17` [Invalidating cached content at the edge › Purging by URL] The CDN has to deliver the purge to every edge location, and each location removes its copy on its own schedule, so for a short time some locations serve the new version while others still serve the old one.
- `u18` [Invalidating cached content at the edge › Purging by URL] Purging is eventually consistent, not instant.
- `u19` [Invalidating cached content at the edge › Purging by URL] Purging by URL has a second limit: it removes only the exact URL you name.
- `u20` [Invalidating cached content at the edge › Purging by URL] A corrected headline also appears on the home page, the section page and the RSS feed, and each of those cached pages keeps the old headline until it is purged separately or expires.
- `u21` [Invalidating cached content at the edge › Purging by URL] Query strings make this worse, because `/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it.
- `u22` [Invalidating cached content at the edge › Purging by URL] Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust.
- `u23` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The origin calls the purge API with the URL. The API answers within about 150 milliseconds, but the answer only means the request was queued.
- `u24` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The CDN's control plane fans the purge out to all 90 edge locations.
- `u25` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Each location marks its cached copy invalid, so the next request there is a cache miss that goes to the origin.
- `u26` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] In Larkspur's measurements, half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds.
- `u27` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Until the last location has applied the purge, a reader routed to that location still gets the old copy.

**Second-link question:** does this clause materially limit the claim in u14, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R16 (kn-02-edge-cache-invalidation)

Clause: **"but not on live election results"** (in u40)

- `u37` [Invalidating cached content at the edge › Serving stale on purpose] Stale-while-revalidate turns expiry from a wait into a background task.
- `u38` [Invalidating cached content at the edge › Serving stale on purpose] With `Cache-Control: max-age=300, stale-while-revalidate=60`, an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately and fetches a fresh one from the origin in the background.
- `u39` [Invalidating cached content at the edge › Serving stale on purpose] The reader gets a fast response, and the next reader gets the refreshed copy.
- **→** `u40` [Invalidating cached content at the edge › Serving stale on purpose] Larkspur uses it on article pages, where a minute of staleness is acceptable, but not on live election results.
- `u41` [Invalidating cached content at the edge › Serving stale on purpose] The bound matters: an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss.
- `u42` [Invalidating cached content at the edge › Serving stale on purpose] A related directive, `stale-if-error=86400`, lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors.
- `u43` [Invalidating cached content at the edge › Serving stale on purpose] Serving stale is a choice about tolerance, not a way to make content fresher.
- `u44` [Invalidating cached content at the edge › Serving stale on purpose] It hides a slow origin from readers, but it also means some readers see a copy that is older than the TTL alone would suggest.

**Second-link question:** does this clause materially limit the claim in u37, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R17 (kn-02-edge-cache-invalidation)

Clause: **"where a minute of staleness is acceptable"** (in u40)

- `u37` [Invalidating cached content at the edge › Serving stale on purpose] Stale-while-revalidate turns expiry from a wait into a background task.
- `u38` [Invalidating cached content at the edge › Serving stale on purpose] With `Cache-Control: max-age=300, stale-while-revalidate=60`, an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately and fetches a fresh one from the origin in the background.
- `u39` [Invalidating cached content at the edge › Serving stale on purpose] The reader gets a fast response, and the next reader gets the refreshed copy.
- **→** `u40` [Invalidating cached content at the edge › Serving stale on purpose] Larkspur uses it on article pages, where a minute of staleness is acceptable, but not on live election results.
- `u41` [Invalidating cached content at the edge › Serving stale on purpose] The bound matters: an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss.
- `u42` [Invalidating cached content at the edge › Serving stale on purpose] A related directive, `stale-if-error=86400`, lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors.
- `u43` [Invalidating cached content at the edge › Serving stale on purpose] Serving stale is a choice about tolerance, not a way to make content fresher.
- `u44` [Invalidating cached content at the edge › Serving stale on purpose] It hides a slow origin from readers, but it also means some readers see a copy that is older than the TTL alone would suggest.

**Second-link question:** does this clause materially limit the claim in u40, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R18 (kn-10-inventory-architecture-frames)

Clause: **"only found when someone opens the admin UI"** (in u50)

- `u48` [Shelfwise inventory service: a tour of the codebase › Known gaps] The admin UI has no automated tests yet.
- `u49` [Shelfwise inventory service: a tour of the codebase › Known gaps] The reservation orchestrator and the feed adapter can both change the same product's stock at once, and the ledger currently relies on a database row lock to keep them consistent; whether that holds under peak load has not been measured.
- **→** `u50` [Shelfwise inventory service: a tour of the codebase › Known gaps] Dead-lettered deliveries are only found when someone opens the admin UI; nothing alerts the team when `inventory.dlq` starts to fill up.

## R19 (kn-08-helpdesk-answers-hld-lld)

Clause: **"which is the only component allowed to talk to the external model provider"** (in u5)

- `u3` [Helpdesk Answers: design from system to code › 2. Architecture] Agents use the Agent Console, a web client, which sends each question to the Answers API over HTTPS.
- `u4` [Helpdesk Answers: design from system to code › 2. Architecture] The Answers API checks the agent's session and forwards the question to the Orchestrator, the service that owns the answering logic.
- **→** `u5` [Helpdesk Answers: design from system to code › 2. Architecture] The Orchestrator calls the Retrieval service to find candidate passages, sends those candidates to the Reranker service, and calls the Model Gateway, which is the only component allowed to talk to the external model provider.
- `u6` [Helpdesk Answers: design from system to code › 2. Architecture] The Retrieval service reads from the Vector store, a Postgres database with the pgvector extension.
- `u7` [Helpdesk Answers: design from system to code › 2. Architecture] The Orchestrator writes every answer, with its citations, to the Answer log table.
- `u8` [Helpdesk Answers: design from system to code › 2. Architecture] Articles reach the Vector store through the Ingestion worker, which reads published articles from the Help Center CMS every 15 minutes, splits them into passages and writes their embeddings to the Vector store.
- `u9` [Helpdesk Answers: design from system to code › 2. Architecture] This document does not describe the Ingestion worker's internals, and how the Vector store is partitioned has not been decided.

## R20 (kn-02-edge-cache-invalidation)

Clause: **"`/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it"** (in u21)

- `u13` [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.
- `u14` [Invalidating cached content at the edge › Purging by URL] The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin.
- `u15` [Invalidating cached content at the edge › Purging by URL] Larkspur's publishing system sends a purge for the article URL every time an editor saves a correction.
- `u16` [Invalidating cached content at the edge › Purging by URL] A purge request is accepted quickly, but it is not applied everywhere at the same moment.
- `u17` [Invalidating cached content at the edge › Purging by URL] The CDN has to deliver the purge to every edge location, and each location removes its copy on its own schedule, so for a short time some locations serve the new version while others still serve the old one.
- `u18` [Invalidating cached content at the edge › Purging by URL] Purging is eventually consistent, not instant.
- `u19` [Invalidating cached content at the edge › Purging by URL] Purging by URL has a second limit: it removes only the exact URL you name.
- `u20` [Invalidating cached content at the edge › Purging by URL] A corrected headline also appears on the home page, the section page and the RSS feed, and each of those cached pages keeps the old headline until it is purged separately or expires.
- **→** `u21` [Invalidating cached content at the edge › Purging by URL] Query strings make this worse, because `/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it.
- `u22` [Invalidating cached content at the edge › Purging by URL] Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust.
- `u23` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The origin calls the purge API with the URL. The API answers within about 150 milliseconds, but the answer only means the request was queued.
- `u24` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The CDN's control plane fans the purge out to all 90 edge locations.
- `u25` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Each location marks its cached copy invalid, so the next request there is a cache miss that goes to the origin.
- `u26` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] In Larkspur's measurements, half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds.
- `u27` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Until the last location has applied the purge, a reader routed to that location still gets the old copy.

## R21 (kn-05-incident-review-meeting)

Clause: **"That's an open question too"** (in u94)

- `u1` [Post-incident review: checkout outage, March 14] Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
- `u2` [Post-incident review: checkout outage, March 14] Dana: Okay, I think everyone's here.
- `u3` [Post-incident review: checkout outage, March 14] Did people manage to grab coffee?
- `u4` [Post-incident review: checkout outage, March 14] The machine on four is broken again.
- `u5` [Post-incident review: checkout outage, March 14] Kenji: I brought my own.
- `u6` [Post-incident review: checkout outage, March 14] Lesson learned.
- `u7` [Post-incident review: checkout outage, March 14] Dana: Smart.
- `u8` [Post-incident review: checkout outage, March 14] Right, let's start.
- `u9` [Post-incident review: checkout outage, March 14] This is the blameless review for the checkout outage on Friday, March 14.
- `u10` [Post-incident review: checkout outage, March 14] Marcus, can you walk us through the timeline?
- `u11` [Post-incident review: checkout outage, March 14] Marcus: Sure.
- `u12` [Post-incident review: checkout outage, March 14] At 16:40 a config change to the payments service went out.
- `u13` [Post-incident review: checkout outage, March 14] It changed the gateway connection pool from 50 connections to 5.
- `u14` [Post-incident review: checkout outage, March 14] That was a typo; the intent was 55.
- `u15` [Post-incident review: checkout outage, March 14] Checkout requests started queuing for a connection and timing out almost immediately.
- `u16` [Post-incident review: checkout outage, March 14] Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change.
- `u17` [Post-incident review: checkout outage, March 14] I rolled the config back at 17:15, and checkout was fully recovered at 17:27.
- `u18` [Post-incident review: checkout outage, March 14] So customers saw errors for 47 minutes in total.
- `u19` [Post-incident review: checkout outage, March 14] Kenji: And on our side, we counted about 2,300 failed checkouts in that window.
- `u20` [Post-incident review: checkout outage, March 14] Support got 140 tickets before we posted the status page.
- `u21` [Post-incident review: checkout outage, March 14] Dana: Why did the alert take 22 minutes?
- `u22` [Post-incident review: checkout outage, March 14] Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
- `u23` [Post-incident review: checkout outage, March 14] Errors went over 10% around 16:47, so the earliest it could fire was 17:02.
- `u24` [Post-incident review: checkout outage, March 14] It did exactly what it was configured to do.
- `u25` [Post-incident review: checkout outage, March 14] Leila: Which is too slow for checkout.
- `u26` [Post-incident review: checkout outage, March 14] 15 minutes of sustained errors is a long time when every minute is lost revenue.
- `u27` [Post-incident review: checkout outage, March 14] Dana: Fair.
- `u28` [Post-incident review: checkout outage, March 14] What do we want instead?
- `u29` [Post-incident review: checkout outage, March 14] Marcus: I'd propose 5% over 5 minutes for checkout specifically.
- `u30` [Post-incident review: checkout outage, March 14] I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.
- … (71 more units in this section; see `phase4/annotation-packets/kn-05-incident-review-meeting.md`)

## R22 (kn-12-flag-rollout-update)

Clause: **"chosen at random per request rather than per user"** (in u12)

- `u10` [Feature flag rollout guide › Rollout stages] General availability turns the flag on for everyone, in steps of 25%, 50% and 100%.
- `u11` [Feature flag rollout guide › Rollout stages] Each stage is recorded in the rollout tool, which keeps the history of who moved the flag and when.
- **→** `u12` [Feature flag rollout guide › Canary] During canary the flag is on for 5% of requests, chosen at random per request rather than per user.
- `u13` [Feature flag rollout guide › Canary] It must stay at that level for at least 30 minutes, so that the metrics cover a full traffic cycle of the slowest endpoint.
- `u14` [Feature flag rollout guide › Canary] The owner does not raise the percentage by hand during this time, because a manual change restarts the measurement window.
- `u15` [Feature flag rollout guide › Canary] Short canaries are the most common reason a bad flag reaches general availability.

## R23 (kn-07-photo-sharing-hld)

Clause: **"The cost is that a new photo takes a few seconds to appear in feeds."** (in u34)

- `u32` [Pinhole: high-level design for photo sharing › Main data flow: posting a photo] The worker publishes PhotoReady; the feed service adds the photo to the followers' feeds and asks the push-notification provider to alert them.
- `u33` [Pinhole: high-level design for photo sharing › Main data flow: posting a photo] Followers' clients fetch the updated feed through the gateway and load the thumbnails from the CDN.
- **→** `u34` [Pinhole: high-level design for photo sharing › Design decisions] **A queue between upload and processing.** A slow or failed thumbnail job must never block or fail an upload, so the upload service and the workers only meet through the message queue. The cost is that a new photo takes a few seconds to appear in feeds.
- `u35` [Pinhole: high-level design for photo sharing › Design decisions] **Direct upload with signed URLs.** Originals can be up to 25 MB, and routing them through the gateway would make it the bottleneck, so clients send bytes straight to object storage and the upload service only signs the URL and records the result.
- `u36` [Pinhole: high-level design for photo sharing › Design decisions] **Metadata apart from bytes.** Photo bytes live in object storage and everything we query lives in the metadata database, because the two grow at very different rates and need different backups.
- `u37` [Pinhole: high-level design for photo sharing › Design decisions] **The cache is disposable.** Feed pages are cached for speed only; the metadata database stays the source of truth, so the cache can be flushed at any time.
- `u38` [Pinhole: high-level design for photo sharing › Design decisions] **Buy delivery, don't build it.** We use a third-party CDN and push-notification provider instead of running our own, and we accept that their outages are outside our control.

## R24 (kn-02-edge-cache-invalidation)

Clause: **"until it is purged separately or expires"** (in u20)

- `u13` [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.
- `u14` [Invalidating cached content at the edge › Purging by URL] The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin.
- `u15` [Invalidating cached content at the edge › Purging by URL] Larkspur's publishing system sends a purge for the article URL every time an editor saves a correction.
- `u16` [Invalidating cached content at the edge › Purging by URL] A purge request is accepted quickly, but it is not applied everywhere at the same moment.
- `u17` [Invalidating cached content at the edge › Purging by URL] The CDN has to deliver the purge to every edge location, and each location removes its copy on its own schedule, so for a short time some locations serve the new version while others still serve the old one.
- `u18` [Invalidating cached content at the edge › Purging by URL] Purging is eventually consistent, not instant.
- `u19` [Invalidating cached content at the edge › Purging by URL] Purging by URL has a second limit: it removes only the exact URL you name.
- **→** `u20` [Invalidating cached content at the edge › Purging by URL] A corrected headline also appears on the home page, the section page and the RSS feed, and each of those cached pages keeps the old headline until it is purged separately or expires.
- `u21` [Invalidating cached content at the edge › Purging by URL] Query strings make this worse, because `/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it.
- `u22` [Invalidating cached content at the edge › Purging by URL] Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust.
- `u23` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The origin calls the purge API with the URL. The API answers within about 150 milliseconds, but the answer only means the request was queued.
- `u24` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The CDN's control plane fans the purge out to all 90 edge locations.
- `u25` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Each location marks its cached copy invalid, so the next request there is a cache miss that goes to the origin.
- `u26` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] In Larkspur's measurements, half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds.
- `u27` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Until the last location has applied the purge, a reader routed to that location still gets the old copy.

**Second-link question:** does this clause materially limit the claim in u15, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R25 (kn-03-blue-green-deploy)

Clause: **"until all of them return `200`"** (in u17)

- `u14` [Blue-green deployment for the orders service › Steps] In this walkthrough blue is live and green is idle.
- `u15` [Blue-green deployment for the orders service › Steps] **Deploy to the idle environment.** Deploy version `2.8.0` to `orders-green`, using the same build artifact that passed staging rather than a fresh build. Expected result: all green instances report the new version, and blue still serves 100% of traffic.
- `u16` [Blue-green deployment for the orders service › Steps] **Run the migrations.** Apply the database migrations from the new release, once, from a single job rather than from every green instance at startup. Expected result: the migration job exits with code 0, and blue keeps serving requests without new errors, which confirms the change is backward compatible.
- **→** `u17` [Blue-green deployment for the orders service › Steps] **Check health on green.** Poll the health endpoint on every green instance until all of them return `200`. If any instance is still failing health checks after 10 minutes, stop here and roll back: tear down green and leave blue serving traffic. Nothing has been switched yet, so customers are unaffected.
- `u18` [Blue-green deployment for the orders service › Steps] **Smoke-test green.** Send the smoke-test suite to green's internal address. Expected result: all smoke tests pass. If one fails, treat it like a failed health check and stop.
- `u19` [Blue-green deployment for the orders service › Steps] **Switch traffic.** Point the listener at the green target group:
- `u20` [Blue-green deployment for the orders service › Steps] aws elbv2 modify-listener \ --listener-arn "$ORDERS_LISTENER_ARN" \ --default-actions Type=forward,TargetGroupArn="$GREEN_TG_ARN"
- `u21` [Blue-green deployment for the orders service › Steps] Expected result: within about 30 seconds, new requests are served by green, and blue receives no new connections.
- `u22` [Blue-green deployment for the orders service › Steps] **Watch the error rate.** Observe the 5xx error rate on green for 15 minutes after the switch. If the error rate rises above 2% at any point in that window, switch back: run the same command with `$BLUE_TG_ARN`, which returns all traffic to blue within about 30 seconds. If it stays at or below 2%, continue.
- `u23` [Blue-green deployment for the orders service › Steps] **Keep blue as a standby.** Leave blue running, unchanged, for 24 hours. It is your rollback target until then.
- `u24` [Blue-green deployment for the orders service › Steps] **Retire blue.** After 24 hours without a switch-back, scale blue down. Blue becomes the idle environment for the next release, with the roles reversed.

**Second-link question:** does this clause materially limit the claim in u19, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R26 (kn-04-queue-choice)

Clause: **"Uses spare capacity on the existing primary"** (in u15)

- `u12` [Choosing a queue for background jobs › Costs] Option | Monthly infrastructure | Monthly team effort | Notes
- `u13` [Choosing a queue for background jobs › Costs] Managed cloud queue | $310 | about 2 hours | Priced per million requests; grows with volume
- `u14` [Choosing a queue for background jobs › Costs] Self-hosted broker | $540 | about 12 hours | Three VMs plus upgrades and on-call
- **→** `u15` [Choosing a queue for background jobs › Costs] Database job table | $0 extra | about 4 hours | Uses spare capacity on the existing primary
- `u16` [Choosing a queue for background jobs › Costs] The managed queue's figure assumes current volume.
- `u17` [Choosing a queue for background jobs › Costs] At three times today's volume it would be roughly $900 a month, while the broker's cost would stay flat until the cluster needs a fourth machine.

## R27 (kn-07-photo-sharing-hld)

Clause: **"never by the gateway"** (in u11)

- `u8` [Pinhole: high-level design for photo sharing › Edge and API] Every client request enters through the API gateway.
- `u9` [Pinhole: high-level design for photo sharing › Edge and API] The gateway terminates TLS, checks the caller's access token with the auth service, applies a rate limit of 120 requests per minute per account, and routes the request to the right service.
- `u10` [Pinhole: high-level design for photo sharing › Edge and API] If the auth service cannot be reached, the gateway rejects the request instead of letting it through unchecked.
- **→** `u11` [Pinhole: high-level design for photo sharing › Edge and API] Photo bytes are served to clients by the CDN, never by the gateway.
- `u12` [Pinhole: high-level design for photo sharing › Core services] The auth service issues and verifies access tokens and owns accounts and sessions.
- `u13` [Pinhole: high-level design for photo sharing › Core services] The upload service hands the client a signed upload URL, records the new photo in the metadata database with the status "processing" once the upload completes, and publishes a PhotoUploaded event to the message queue.

**Second-link question:** does this clause materially limit the claim in u11, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R28 (kn-09-billing-codebase-map)

Clause: **"I found no job that re-sends missed events"** (in u43)

- `u36` [Ledgerline billing service: codebase map › Persistence and events] The code writes the finished invoice to two tables, `invoices` and `invoice_lines`, inside one database transaction in `billing/invoices/generate.ts`, lines 44–52.
- `u37` [Ledgerline billing service: codebase map › Persistence and events] If either insert fails, the transaction rolls back and neither row is kept.
- `u38` [Ledgerline billing service: codebase map › Persistence and events] The `invoices` row is written with the status `finalized`; I found no code path that writes any other status.
- `u39` [Ledgerline billing service: codebase map › Persistence and events] After the transaction commits, `generateInvoice` calls `publishInvoiceFinalized(invoice)` in `billing/events/publish.ts`.
- `u40` [Ledgerline billing service: codebase map › Persistence and events] That function publishes an `invoice.finalized` message to the `billing-events` topic.
- `u41` [Ledgerline billing service: codebase map › Persistence and events] The payment and email services subscribe to that topic; I did not read their code.
- `u42` [Ledgerline billing service: codebase map › Persistence and events] What happens when publishing fails after the commit is unknown.
- **→** `u43` [Ledgerline billing service: codebase map › Persistence and events] The code logs the error and returns, so an invoice can exist without its event, but I found no job that re-sends missed events and no note saying whether one is planned.
- `u44` [Ledgerline billing service: codebase map › Data contract] The draft passed between the steps has this shape, defined in `billing/invoices/types.ts`:
- `u45` [Ledgerline billing service: codebase map › Data contract] export interface InvoiceDraft { accountId: string; period: BillingPeriod; lines: PricedLine[]; subtotalCents: number; taxCents?: number; }

## R29 (kn-08-helpdesk-answers-hld-lld)

Clause: **"but the 8 passages may then be less relevant"** (in u26)

- `u18` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Agent Console posts the question to `POST /v1/answers` with the ticket id.
- `u19` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answers API checks the session and forwards the question to the Answer composer.
- `u20` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answer composer asks the Retrieval service for 50 candidate passages.
- `u21` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Rerank client sends the 50 candidates to the Reranker and keeps the top 8.
- `u22` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answer composer calls `composeAnswer` with the question and the 8 passages.
- `u23` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Orchestrator writes the answer and its citations to the Answer log.
- `u24` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answers API returns the answer to the Agent Console.
- `u25` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] If the Reranker does not respond within 800 ms, the Rerank client skips reranking, keeps the first 8 candidates in vector-similarity order and records `rerank_skipped = true` in the Answer log.
- **→** `u26` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] Skipping reranking keeps the request fast, but the 8 passages may then be less relevant.
- `u27` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] `composeAnswer(question, passages)` builds the prompt with the Context builder, limited to 6,000 tokens, calls the Model Gateway, and passes the draft to the Citation checker.
- `u28` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] The model call has a 20-second timeout.

## R30 (kn-02-edge-cache-invalidation)

Clause: **"Purge APIs are also rate limited"** (in u22)

- `u13` [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.
- `u14` [Invalidating cached content at the edge › Purging by URL] The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin.
- `u15` [Invalidating cached content at the edge › Purging by URL] Larkspur's publishing system sends a purge for the article URL every time an editor saves a correction.
- `u16` [Invalidating cached content at the edge › Purging by URL] A purge request is accepted quickly, but it is not applied everywhere at the same moment.
- `u17` [Invalidating cached content at the edge › Purging by URL] The CDN has to deliver the purge to every edge location, and each location removes its copy on its own schedule, so for a short time some locations serve the new version while others still serve the old one.
- `u18` [Invalidating cached content at the edge › Purging by URL] Purging is eventually consistent, not instant.
- `u19` [Invalidating cached content at the edge › Purging by URL] Purging by URL has a second limit: it removes only the exact URL you name.
- `u20` [Invalidating cached content at the edge › Purging by URL] A corrected headline also appears on the home page, the section page and the RSS feed, and each of those cached pages keeps the old headline until it is purged separately or expires.
- `u21` [Invalidating cached content at the edge › Purging by URL] Query strings make this worse, because `/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it.
- **→** `u22` [Invalidating cached content at the edge › Purging by URL] Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust.
- `u23` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The origin calls the purge API with the URL. The API answers within about 150 milliseconds, but the answer only means the request was queued.
- `u24` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The CDN's control plane fans the purge out to all 90 edge locations.
- `u25` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Each location marks its cached copy invalid, so the next request there is a cache miss that goes to the origin.
- `u26` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] In Larkspur's measurements, half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds.
- `u27` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Until the last location has applied the purge, a reader routed to that location still gets the old copy.

## R31 (kn-06-hybrid-search-reranking)

Clause: **"but it does not guarantee that the final answer is correct"** (in u31)

- `u26` [Hybrid search and reranking in the Harbor assistant › Reranking] A reranker then rescores the fused candidates.
- `u27` [Hybrid search and reranking in the Harbor assistant › Reranking] We use a cross-encoder, a model that reads the query and one passage together and outputs a single relevance score.
- `u28` [Hybrid search and reranking in the Harbor assistant › Reranking] Because it sees both texts at once, it judges relevance far more accurately than either retriever.
- `u29` [Hybrid search and reranking in the Harbor assistant › Reranking] That accuracy is expensive, so the cross-encoder runs only on the fused candidates, never on the whole collection.
- `u30` [Hybrid search and reranking in the Harbor assistant › Reranking] After reranking we keep the top 8 passages.
- **→** `u31` [Hybrid search and reranking in the Harbor assistant › Reranking] Reranking improves the precision of the top results, but it does not guarantee that the final answer is correct.
- `u32` [Hybrid search and reranking in the Harbor assistant › Reranking] The reranker can only reorder what retrieval found: if the right passage is not among the candidates, reranking cannot recover it.
- `u33` [Hybrid search and reranking in the Harbor assistant › Reranking] A passage can also be highly relevant and still out of date, which no relevance score will detect.

## R32 (kn-03-blue-green-deploy)

Clause: **"but requests that were in flight on green during the switch may fail and need a client retry"** (in u26)

- `u24` [Blue-green deployment for the orders service › Steps] **Retire blue.** After 24 hours without a switch-back, scale blue down. Blue becomes the idle environment for the next release, with the roles reversed.
- `u25` [Blue-green deployment for the orders service › When things go wrong] A rollback before step 5 is cheap, because customers never saw green.
- **→** `u26` [Blue-green deployment for the orders service › When things go wrong] A switch-back after step 5 is also fast, but requests that were in flight on green during the switch may fail and need a client retry.
- `u27` [Blue-green deployment for the orders service › When things go wrong] Neither kind of rollback reverts the database, which is why the backward-compatible migration requirement matters.
- `u28` [Blue-green deployment for the orders service › When things go wrong] Whichever way you roll back, record what failed before trying again, because a second attempt with the same build tends to fail the same way.
- `u29` [Blue-green deployment for the orders service › When things go wrong] Do not run the next release's migrations while blue is still on standby.
- `u30` [Blue-green deployment for the orders service › When things go wrong] If you do, the standby may no longer work against the schema, and the switch-back stops being a safe option.
- `u31` [Blue-green deployment for the orders service › When things go wrong] That's all there is to it. Happy deploying!

## R33 (kn-05-incident-review-meeting)

Clause: **"If a release includes a database migration"** (in u82)

- `u1` [Post-incident review: checkout outage, March 14] Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
- `u2` [Post-incident review: checkout outage, March 14] Dana: Okay, I think everyone's here.
- `u3` [Post-incident review: checkout outage, March 14] Did people manage to grab coffee?
- `u4` [Post-incident review: checkout outage, March 14] The machine on four is broken again.
- `u5` [Post-incident review: checkout outage, March 14] Kenji: I brought my own.
- `u6` [Post-incident review: checkout outage, March 14] Lesson learned.
- `u7` [Post-incident review: checkout outage, March 14] Dana: Smart.
- `u8` [Post-incident review: checkout outage, March 14] Right, let's start.
- `u9` [Post-incident review: checkout outage, March 14] This is the blameless review for the checkout outage on Friday, March 14.
- `u10` [Post-incident review: checkout outage, March 14] Marcus, can you walk us through the timeline?
- `u11` [Post-incident review: checkout outage, March 14] Marcus: Sure.
- `u12` [Post-incident review: checkout outage, March 14] At 16:40 a config change to the payments service went out.
- `u13` [Post-incident review: checkout outage, March 14] It changed the gateway connection pool from 50 connections to 5.
- `u14` [Post-incident review: checkout outage, March 14] That was a typo; the intent was 55.
- `u15` [Post-incident review: checkout outage, March 14] Checkout requests started queuing for a connection and timing out almost immediately.
- `u16` [Post-incident review: checkout outage, March 14] Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change.
- `u17` [Post-incident review: checkout outage, March 14] I rolled the config back at 17:15, and checkout was fully recovered at 17:27.
- `u18` [Post-incident review: checkout outage, March 14] So customers saw errors for 47 minutes in total.
- `u19` [Post-incident review: checkout outage, March 14] Kenji: And on our side, we counted about 2,300 failed checkouts in that window.
- `u20` [Post-incident review: checkout outage, March 14] Support got 140 tickets before we posted the status page.
- `u21` [Post-incident review: checkout outage, March 14] Dana: Why did the alert take 22 minutes?
- `u22` [Post-incident review: checkout outage, March 14] Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
- `u23` [Post-incident review: checkout outage, March 14] Errors went over 10% around 16:47, so the earliest it could fire was 17:02.
- `u24` [Post-incident review: checkout outage, March 14] It did exactly what it was configured to do.
- `u25` [Post-incident review: checkout outage, March 14] Leila: Which is too slow for checkout.
- `u26` [Post-incident review: checkout outage, March 14] 15 minutes of sustained errors is a long time when every minute is lost revenue.
- `u27` [Post-incident review: checkout outage, March 14] Dana: Fair.
- `u28` [Post-incident review: checkout outage, March 14] What do we want instead?
- `u29` [Post-incident review: checkout outage, March 14] Marcus: I'd propose 5% over 5 minutes for checkout specifically.
- `u30` [Post-incident review: checkout outage, March 14] I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.
- … (71 more units in this section; see `phase4/annotation-packets/kn-05-incident-review-meeting.md`)

## R34 (kn-05-incident-review-meeting)

Clause: **"nobody has looked yet"** (in u93)

- `u1` [Post-incident review: checkout outage, March 14] Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
- `u2` [Post-incident review: checkout outage, March 14] Dana: Okay, I think everyone's here.
- `u3` [Post-incident review: checkout outage, March 14] Did people manage to grab coffee?
- `u4` [Post-incident review: checkout outage, March 14] The machine on four is broken again.
- `u5` [Post-incident review: checkout outage, March 14] Kenji: I brought my own.
- `u6` [Post-incident review: checkout outage, March 14] Lesson learned.
- `u7` [Post-incident review: checkout outage, March 14] Dana: Smart.
- `u8` [Post-incident review: checkout outage, March 14] Right, let's start.
- `u9` [Post-incident review: checkout outage, March 14] This is the blameless review for the checkout outage on Friday, March 14.
- `u10` [Post-incident review: checkout outage, March 14] Marcus, can you walk us through the timeline?
- `u11` [Post-incident review: checkout outage, March 14] Marcus: Sure.
- `u12` [Post-incident review: checkout outage, March 14] At 16:40 a config change to the payments service went out.
- `u13` [Post-incident review: checkout outage, March 14] It changed the gateway connection pool from 50 connections to 5.
- `u14` [Post-incident review: checkout outage, March 14] That was a typo; the intent was 55.
- `u15` [Post-incident review: checkout outage, March 14] Checkout requests started queuing for a connection and timing out almost immediately.
- `u16` [Post-incident review: checkout outage, March 14] Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change.
- `u17` [Post-incident review: checkout outage, March 14] I rolled the config back at 17:15, and checkout was fully recovered at 17:27.
- `u18` [Post-incident review: checkout outage, March 14] So customers saw errors for 47 minutes in total.
- `u19` [Post-incident review: checkout outage, March 14] Kenji: And on our side, we counted about 2,300 failed checkouts in that window.
- `u20` [Post-incident review: checkout outage, March 14] Support got 140 tickets before we posted the status page.
- `u21` [Post-incident review: checkout outage, March 14] Dana: Why did the alert take 22 minutes?
- `u22` [Post-incident review: checkout outage, March 14] Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
- `u23` [Post-incident review: checkout outage, March 14] Errors went over 10% around 16:47, so the earliest it could fire was 17:02.
- `u24` [Post-incident review: checkout outage, March 14] It did exactly what it was configured to do.
- `u25` [Post-incident review: checkout outage, March 14] Leila: Which is too slow for checkout.
- `u26` [Post-incident review: checkout outage, March 14] 15 minutes of sustained errors is a long time when every minute is lost revenue.
- `u27` [Post-incident review: checkout outage, March 14] Dana: Fair.
- `u28` [Post-incident review: checkout outage, March 14] What do we want instead?
- `u29` [Post-incident review: checkout outage, March 14] Marcus: I'd propose 5% over 5 minutes for checkout specifically.
- `u30` [Post-incident review: checkout outage, March 14] I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.
- … (71 more units in this section; see `phase4/annotation-packets/kn-05-incident-review-meeting.md`)

**Second-link question:** does this clause materially limit the claim in u90, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R35 (kn-03-blue-green-deploy)

Clause: **"a rollback does not undo a migration"** (in u10)

- `u7` [Blue-green deployment for the orders service › Before you start] You need the following in place before the first release:
- `u8` [Blue-green deployment for the orders service › Before you start] Two identical environments, `orders-blue` and `orders-green`, with the same instance count, instance size and configuration.
- `u9` [Blue-green deployment for the orders service › Before you start] A health endpoint, `GET /healthz`, that returns `200` only when the service can reach its database and its queue.
- **→** `u10` [Blue-green deployment for the orders service › Before you start] Database migrations that are backward compatible, so the old version keeps working against the new schema. This is a hard requirement: both versions share one database, and a rollback does not undo a migration.
- `u11` [Blue-green deployment for the orders service › Before you start] Access to the load balancer's listener rules, because the switch is a change to which target group the listener forwards to.
- `u12` [Blue-green deployment for the orders service › Before you start] A dashboard or query that shows the 5xx error rate per environment, so you can tell green's errors from blue's.
- `u13` [Blue-green deployment for the orders service › Before you start] If any migration is not backward compatible, do not use this procedure; split the migration into an additive release first and a cleanup release later.

## R36 (kn-10-inventory-architecture-frames)

Clause: **"it is not retried"** (in u26)

- `u23` [Shelfwise inventory service: a tour of the codebase › Supplier integration] The supplier feed adapter in `src/suppliers/feedAdapter.ts` brings in restocks from suppliers.
- `u24` [Shelfwise inventory service: a tour of the codebase › Supplier integration] Every 10 minutes it calls the supplier API for new deliveries, converts each delivery into a restock and asks the stock ledger to record it.
- `u25` [Shelfwise inventory service: a tour of the codebase › Supplier integration] The adapter is the only module that knows the supplier's data format, so a change on the supplier's side stays inside this one file.
- **→** `u26` [Shelfwise inventory service: a tour of the codebase › Supplier integration] A delivery the adapter cannot parse is logged and skipped; it is not retried, because sending the same bad data again would fail the same way.
- `u27` [Shelfwise inventory service: a tour of the codebase › Persistence and external systems] Postgres holds the ledger entries and the current stock level per warehouse and product; it is the source of truth for stock.
- `u28` [Shelfwise inventory service: a tour of the codebase › Persistence and external systems] Redis holds cached price lists and nothing that cannot be rebuilt from the supplier feed.

## R37 (kn-02-edge-cache-invalidation)

Clause: **"a missing tag produces a stale page with no error anywhere"** (in u33)

- `u28` [Invalidating cached content at the edge › Purging by tag with surrogate keys] Surrogate keys solve the listing problem by letting the origin label each response with tags.
- `u29` [Invalidating cached content at the edge › Purging by tag with surrogate keys] The origin sends a header such as `Surrogate-Key: story-417 section-politics`, and the CDN records which cached objects carry which keys.
- `u30` [Invalidating cached content at the edge › Purging by tag with surrogate keys] A single purge of the key `story-417` then removes every cached page that included that story: the article itself, the home page, the section page and the feed.
- `u31` [Invalidating cached content at the edge › Purging by tag with surrogate keys] Keys can be as coarse or as fine as you like, but every key a page carries makes the header longer, and Larkspur keeps it under 50 keys per response.
- `u32` [Invalidating cached content at the edge › Purging by tag with surrogate keys] The responsibility moves to the origin.
- **→** `u33` [Invalidating cached content at the edge › Purging by tag with surrogate keys] A page is only purged by a key if the origin tagged it with that key, and a missing tag produces a stale page with no error anywhere.
- `u34` [Invalidating cached content at the edge › Purging by tag with surrogate keys] As with purging by URL, a tag purge is delivered to each edge location separately, so for a few seconds some locations serve the updated pages while others still serve the old ones.
- `u35` [Invalidating cached content at the edge › Purging by tag with surrogate keys] Tag purges can also be large.
- `u36` [Invalidating cached content at the edge › Purging by tag with surrogate keys] Purging `section-politics` at Larkspur removes about 12,000 cached objects at once, and the origin has to absorb the burst of cache misses that follows.

## R38 (kn-05-incident-review-meeting)

Clause: **"I think we'd see a pattern if we looked"** (in u73)

- `u1` [Post-incident review: checkout outage, March 14] Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
- `u2` [Post-incident review: checkout outage, March 14] Dana: Okay, I think everyone's here.
- `u3` [Post-incident review: checkout outage, March 14] Did people manage to grab coffee?
- `u4` [Post-incident review: checkout outage, March 14] The machine on four is broken again.
- `u5` [Post-incident review: checkout outage, March 14] Kenji: I brought my own.
- `u6` [Post-incident review: checkout outage, March 14] Lesson learned.
- `u7` [Post-incident review: checkout outage, March 14] Dana: Smart.
- `u8` [Post-incident review: checkout outage, March 14] Right, let's start.
- `u9` [Post-incident review: checkout outage, March 14] This is the blameless review for the checkout outage on Friday, March 14.
- `u10` [Post-incident review: checkout outage, March 14] Marcus, can you walk us through the timeline?
- `u11` [Post-incident review: checkout outage, March 14] Marcus: Sure.
- `u12` [Post-incident review: checkout outage, March 14] At 16:40 a config change to the payments service went out.
- `u13` [Post-incident review: checkout outage, March 14] It changed the gateway connection pool from 50 connections to 5.
- `u14` [Post-incident review: checkout outage, March 14] That was a typo; the intent was 55.
- `u15` [Post-incident review: checkout outage, March 14] Checkout requests started queuing for a connection and timing out almost immediately.
- `u16` [Post-incident review: checkout outage, March 14] Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change.
- `u17` [Post-incident review: checkout outage, March 14] I rolled the config back at 17:15, and checkout was fully recovered at 17:27.
- `u18` [Post-incident review: checkout outage, March 14] So customers saw errors for 47 minutes in total.
- `u19` [Post-incident review: checkout outage, March 14] Kenji: And on our side, we counted about 2,300 failed checkouts in that window.
- `u20` [Post-incident review: checkout outage, March 14] Support got 140 tickets before we posted the status page.
- `u21` [Post-incident review: checkout outage, March 14] Dana: Why did the alert take 22 minutes?
- `u22` [Post-incident review: checkout outage, March 14] Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
- `u23` [Post-incident review: checkout outage, March 14] Errors went over 10% around 16:47, so the earliest it could fire was 17:02.
- `u24` [Post-incident review: checkout outage, March 14] It did exactly what it was configured to do.
- `u25` [Post-incident review: checkout outage, March 14] Leila: Which is too slow for checkout.
- `u26` [Post-incident review: checkout outage, March 14] 15 minutes of sustained errors is a long time when every minute is lost revenue.
- `u27` [Post-incident review: checkout outage, March 14] Dana: Fair.
- `u28` [Post-incident review: checkout outage, March 14] What do we want instead?
- `u29` [Post-incident review: checkout outage, March 14] Marcus: I'd propose 5% over 5 minutes for checkout specifically.
- `u30` [Post-incident review: checkout outage, March 14] I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.
- … (71 more units in this section; see `phase4/annotation-packets/kn-05-incident-review-meeting.md`)

**Second-link question:** does this clause materially limit the claim in u69, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R39 (kn-06-hybrid-search-reranking)

Clause: **"none of them makes the final answer certain to be right"** (in u49)

- `u47` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Teams with a strict latency budget can rerank fewer candidates, for example the top 30 of the fused list instead of all of them, at some cost in recall.
- `u48` [Hybrid search and reranking in the Harbor assistant › Summary] Hybrid search widens the net, reranking sorts the catch, and generation can only work with the passages it is given.
- **→** `u49` [Hybrid search and reranking in the Harbor assistant › Summary] Each step helps only under its own conditions, and none of them makes the final answer certain to be right.

## R40 (kn-07-photo-sharing-hld)

Clause: **"does not control when an alert arrives"** (in u27)

- `u25` [Pinhole: high-level design for photo sharing › External dependencies and system boundary] The CDN and the push-notification provider are run by third parties and sit outside the Pinhole system boundary.
- `u26` [Pinhole: high-level design for photo sharing › External dependencies and system boundary] The CDN reads photos and thumbnails from object storage and serves them to clients from locations close to the user.
- **→** `u27` [Pinhole: high-level design for photo sharing › External dependencies and system boundary] The push-notification provider delivers alerts to phones; Pinhole only sends it requests and does not control when an alert arrives.
- `u28` [Pinhole: high-level design for photo sharing › External dependencies and system boundary] Everything else in this document (the gateway, the three services, the workers, the queue and the three stores) is inside the boundary and is operated by the Pinhole team.
- `u29` [Pinhole: high-level design for photo sharing › Main data flow: posting a photo] The client asks the upload service for a signed URL and uploads the original straight to object storage.

## R41 (kn-02-edge-cache-invalidation)

Clause: **"eventually consistent, not instant"** (in u18)

- `u13` [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.
- `u14` [Invalidating cached content at the edge › Purging by URL] The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin.
- `u15` [Invalidating cached content at the edge › Purging by URL] Larkspur's publishing system sends a purge for the article URL every time an editor saves a correction.
- `u16` [Invalidating cached content at the edge › Purging by URL] A purge request is accepted quickly, but it is not applied everywhere at the same moment.
- `u17` [Invalidating cached content at the edge › Purging by URL] The CDN has to deliver the purge to every edge location, and each location removes its copy on its own schedule, so for a short time some locations serve the new version while others still serve the old one.
- **→** `u18` [Invalidating cached content at the edge › Purging by URL] Purging is eventually consistent, not instant.
- `u19` [Invalidating cached content at the edge › Purging by URL] Purging by URL has a second limit: it removes only the exact URL you name.
- `u20` [Invalidating cached content at the edge › Purging by URL] A corrected headline also appears on the home page, the section page and the RSS feed, and each of those cached pages keeps the old headline until it is purged separately or expires.
- `u21` [Invalidating cached content at the edge › Purging by URL] Query strings make this worse, because `/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it.
- `u22` [Invalidating cached content at the edge › Purging by URL] Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust.
- `u23` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The origin calls the purge API with the URL. The API answers within about 150 milliseconds, but the answer only means the request was queued.
- `u24` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The CDN's control plane fans the purge out to all 90 edge locations.
- `u25` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Each location marks its cached copy invalid, so the next request there is a cache miss that goes to the origin.
- `u26` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] In Larkspur's measurements, half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds.
- `u27` [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Until the last location has applied the purge, a reader routed to that location still gets the old copy.

## R42 (kn-04-queue-choice)

Clause: **"Polling also adds read load to the primary database, which is the main risk at month-end"** (in u34)

- `u26` [Choosing a queue for background jobs › Benefits and trade-offs] Option A needs almost no operational work, and failed messages move to a dead-letter queue automatically.
- `u27` [Choosing a queue for background jobs › Benefits and trade-offs] The catch is that the service delivers each message at least once, so every job handler must be made idempotent before we switch; today only the email handler is.
- `u28` [Choosing a queue for background jobs › Benefits and trade-offs] It also ties us to one provider's API, and local development needs an emulator that does not support dead-lettering.
- `u29` [Choosing a queue for background jobs › Benefits and trade-offs] Option B gives us priority queues and delayed delivery, which would let month-end invoices jump ahead of webhook retries.
- `u30` [Choosing a queue for background jobs › Benefits and trade-offs] No one on the team has run this broker in production, so the 12 hours a month is an estimate, not a measurement.
- `u31` [Choosing a queue for background jobs › Benefits and trade-offs] Upgrades need a maintenance window.
- `u32` [Choosing a queue for background jobs › Benefits and trade-offs] Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue.
- `u33` [Choosing a queue for background jobs › Benefits and trade-offs] That guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it.
- **→** `u34` [Choosing a queue for background jobs › Benefits and trade-offs] Polling also adds read load to the primary database, which is the main risk at month-end.
- `u35` [Choosing a queue for background jobs › Evidence] We load-tested Option C on a staging copy of the database with synthetic jobs.
- `u36` [Choosing a queue for background jobs › Evidence] It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms.

## R43 (kn-01-idempotency-keys)

Clause: **"Keys also do not make two different requests safe"** (in u8)

- `u1` [Idempotency keys] An idempotency key is a unique value that a client attaches to a request so that the server can recognise a retry of the same operation.
- `u2` [Idempotency keys] If the server has already completed a request with that key, it returns the stored result instead of performing the operation again.
- `u3` [Idempotency keys] For example, a checkout client sends `Idempotency-Key: 7f3c-91ab` with a payment request.
- `u4` [Idempotency keys] The connection drops before the response arrives, so the client retries with the same key.
- `u5` [Idempotency keys] The server finds the stored result for `7f3c-91ab` and returns the original confirmation, and the customer is charged once.
- `u6` [Idempotency keys] Keys only protect against duplicates while the server still remembers them.
- `u7` [Idempotency keys] In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment.
- **→** `u8` [Idempotency keys] Keys also do not make two different requests safe: if a client reuses a key with a different amount, the server must reject the request rather than return the old result.
- `u9` [Idempotency keys] In short, idempotency keys make retries safe within a bounded window; they are not a general guarantee against duplicate operations.

## R44 (kn-02-edge-cache-invalidation)

Clause: **"Versioning does not help for HTML entry pages."** (in u49)

- `u45` [Invalidating cached content at the edge › Versioned asset URLs] For static assets, the cleanest invalidation is a new name.
- `u46` [Invalidating cached content at the edge › Versioned asset URLs] The build puts a hash of each file's contents into its name, such as `app.3f9c2e.js`, so a changed file gets a new URL and the old cached copy is simply never requested again.
- `u47` [Invalidating cached content at the edge › Versioned asset URLs] Because a versioned URL never changes its content, it can be cached for a very long time; Larkspur serves its versioned assets with `max-age=31536000`, which is one year.
- `u48` [Invalidating cached content at the edge › Versioned asset URLs] Most build tools can add the hash automatically, so the cost is a one-time change to the build configuration.
- **→** `u49` [Invalidating cached content at the edge › Versioned asset URLs] Versioning does not help for HTML entry pages.
- `u50` [Invalidating cached content at the edge › Versioned asset URLs] The home page and article pages are requested at fixed addresses such as `/` and `/story/417`, and they are the pages that point to the new asset names, so they still need a TTL, a purge or both.
- `u51` [Invalidating cached content at the edge › Versioned asset URLs] If an HTML page stays cached longer than the origin keeps the old asset files, it can send readers to files that no longer exist.
- `u52` [Invalidating cached content at the edge › Versioned asset URLs] Old asset versions should therefore stay available for at least as long as the longest HTML TTL.

## R45 (kn-06-hybrid-search-reranking)

Clause: **"but it roughly doubled the time spent reranking"** (in u25)

- `u23` [Hybrid search and reranking in the Harbor assistant › Candidate generation] Each retriever returns its top 50 passages, so the fused list holds at most 100 candidates, and usually fewer because some passages appear in both lists.
- `u24` [Hybrid search and reranking in the Harbor assistant › Candidate generation] This stage is tuned for recall rather than precision: the goal is to make sure the right passage is somewhere in the list, not that it comes first.
- **→** `u25` [Hybrid search and reranking in the Harbor assistant › Candidate generation] Raising the limit to 100 per retriever put the right passage in the list slightly more often, but it roughly doubled the time spent reranking, so we kept 50.
- `u26` [Hybrid search and reranking in the Harbor assistant › Reranking] A reranker then rescores the fused candidates.
- `u27` [Hybrid search and reranking in the Harbor assistant › Reranking] We use a cross-encoder, a model that reads the query and one passage together and outputs a single relevance score.

**Second-link question:** does this clause materially limit the claim in u23, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R46 (kn-10-inventory-architecture-frames)

Clause: **"Reservations are never retried automatically"** (in u40)

- `u32` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Every module logs through the structured logger in `src/platform/log.ts`, which writes one JSON line per event and always includes the correlation ID that the HTTP handlers attached.
- `u33` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The handlers log each request, and the retry helper logs each failed attempt.
- `u34` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Calls to the supplier API can fail, so the feed adapter wraps them in the retry helper in `src/platform/retry.ts`.
- `u35` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The retry policy is:
- `u36` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] at most 5 attempts per delivery;
- `u37` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] exponential backoff that starts at 2 seconds, doubles after each failure and is capped at 60 seconds;
- `u38` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] after the 5th failed attempt, the delivery is published to the dead-letter queue `inventory.dlq` on the message broker, and staff review it in the admin UI.
- `u39` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Retries apply only to supplier calls.
- **→** `u40` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Reservations are never retried automatically: a failed reservation is returned to the caller as an error.
- `u41` [Shelfwise inventory service: a tour of the codebase › Where to start reading] New contributors usually start with `src/orders/reserve.ts`, because it shows a whole reservation in about 120 lines and names every module it depends on.
- `u42` [Shelfwise inventory service: a tour of the codebase › Where to start reading] After that, `src/ledger/ledger.ts` explains how stock is counted.

## R47 (kn-01-idempotency-keys)

Clause: **"they are not a general guarantee against duplicate operations"** (in u9)

- `u1` [Idempotency keys] An idempotency key is a unique value that a client attaches to a request so that the server can recognise a retry of the same operation.
- `u2` [Idempotency keys] If the server has already completed a request with that key, it returns the stored result instead of performing the operation again.
- `u3` [Idempotency keys] For example, a checkout client sends `Idempotency-Key: 7f3c-91ab` with a payment request.
- `u4` [Idempotency keys] The connection drops before the response arrives, so the client retries with the same key.
- `u5` [Idempotency keys] The server finds the stored result for `7f3c-91ab` and returns the original confirmation, and the customer is charged once.
- `u6` [Idempotency keys] Keys only protect against duplicates while the server still remembers them.
- `u7` [Idempotency keys] In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment.
- `u8` [Idempotency keys] Keys also do not make two different requests safe: if a client reuses a key with a different amount, the server must reject the request rather than return the old result.
- **→** `u9` [Idempotency keys] In short, idempotency keys make retries safe within a bounded window; they are not a general guarantee against duplicate operations.

## R48 (kn-06-hybrid-search-reranking)

Clause: **"and still out of date, which no relevance score will detect"** (in u33)

- `u26` [Hybrid search and reranking in the Harbor assistant › Reranking] A reranker then rescores the fused candidates.
- `u27` [Hybrid search and reranking in the Harbor assistant › Reranking] We use a cross-encoder, a model that reads the query and one passage together and outputs a single relevance score.
- `u28` [Hybrid search and reranking in the Harbor assistant › Reranking] Because it sees both texts at once, it judges relevance far more accurately than either retriever.
- `u29` [Hybrid search and reranking in the Harbor assistant › Reranking] That accuracy is expensive, so the cross-encoder runs only on the fused candidates, never on the whole collection.
- `u30` [Hybrid search and reranking in the Harbor assistant › Reranking] After reranking we keep the top 8 passages.
- `u31` [Hybrid search and reranking in the Harbor assistant › Reranking] Reranking improves the precision of the top results, but it does not guarantee that the final answer is correct.
- `u32` [Hybrid search and reranking in the Harbor assistant › Reranking] The reranker can only reorder what retrieval found: if the right passage is not among the candidates, reranking cannot recover it.
- **→** `u33` [Hybrid search and reranking in the Harbor assistant › Reranking] A passage can also be highly relevant and still out of date, which no relevance score will detect.
- `u34` [Hybrid search and reranking in the Harbor assistant › Generation] The language model receives the question and the top 8 passages, and is instructed to answer only from them and to cite the passages it used.
- `u35` [Hybrid search and reranking in the Harbor assistant › Generation] If none of the passages addresses the question, it should say so rather than answer from its general knowledge.

## R49 (kn-02-edge-cache-invalidation)

Clause: **"but sends more requests back to the origin"** (in u12)

- `u6` [Invalidating cached content at the edge › Letting copies expire] The simplest form of invalidation is not to invalidate at all: every cached object carries a time to live (TTL), and the edge discards or rechecks its copy once the TTL has passed.
- `u7` [Invalidating cached content at the edge › Letting copies expire] The origin sets the TTL with the `Cache-Control` header; for example, `Cache-Control: max-age=300` lets an edge location keep a copy for 300 seconds.
- `u8` [Invalidating cached content at the edge › Letting copies expire] TTL expiry needs no coordination between the origin and the edge, which is why every CDN uses it as the default.
- `u9` [Invalidating cached content at the edge › Letting copies expire] When a TTL runs out, the edge does not always download the whole object again: if the origin sent an `ETag`, the edge can ask whether the copy changed and receive a short `304 Not Modified` answer when it has not.
- `u10` [Invalidating cached content at the edge › Letting copies expire] Its weakness is that the TTL is a guess made in advance.
- `u11` [Invalidating cached content at the edge › Letting copies expire] If an editor corrects a headline 60 seconds after publishing, readers can keep seeing the old headline for up to the remaining 240 seconds of a 300-second TTL, and nothing the origin does will shorten that wait.
- **→** `u12` [Invalidating cached content at the edge › Letting copies expire] Shortening the TTL narrows the window but sends more requests back to the origin: when Larkspur dropped its article TTL from 300 to 30 seconds, origin traffic rose roughly eightfold.
- `u13` [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.
- `u14` [Invalidating cached content at the edge › Purging by URL] The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin.

## R50 (kn-10-inventory-architecture-frames)

Clause: **"Retries apply only to supplier calls."** (in u39)

- `u32` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Every module logs through the structured logger in `src/platform/log.ts`, which writes one JSON line per event and always includes the correlation ID that the HTTP handlers attached.
- `u33` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The handlers log each request, and the retry helper logs each failed attempt.
- `u34` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Calls to the supplier API can fail, so the feed adapter wraps them in the retry helper in `src/platform/retry.ts`.
- `u35` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The retry policy is:
- `u36` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] at most 5 attempts per delivery;
- `u37` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] exponential backoff that starts at 2 seconds, doubles after each failure and is capped at 60 seconds;
- `u38` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] after the 5th failed attempt, the delivery is published to the dead-letter queue `inventory.dlq` on the message broker, and staff review it in the admin UI.
- **→** `u39` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Retries apply only to supplier calls.
- `u40` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Reservations are never retried automatically: a failed reservation is returned to the caller as an error.
- `u41` [Shelfwise inventory service: a tour of the codebase › Where to start reading] New contributors usually start with `src/orders/reserve.ts`, because it shows a whole reservation in about 120 lines and names every module it depends on.

## R51 (kn-07-photo-sharing-hld)

Clause: **"we accept that their outages are outside our control"** (in u38)

- `u34` [Pinhole: high-level design for photo sharing › Design decisions] **A queue between upload and processing.** A slow or failed thumbnail job must never block or fail an upload, so the upload service and the workers only meet through the message queue. The cost is that a new photo takes a few seconds to appear in feeds.
- `u35` [Pinhole: high-level design for photo sharing › Design decisions] **Direct upload with signed URLs.** Originals can be up to 25 MB, and routing them through the gateway would make it the bottleneck, so clients send bytes straight to object storage and the upload service only signs the URL and records the result.
- `u36` [Pinhole: high-level design for photo sharing › Design decisions] **Metadata apart from bytes.** Photo bytes live in object storage and everything we query lives in the metadata database, because the two grow at very different rates and need different backups.
- `u37` [Pinhole: high-level design for photo sharing › Design decisions] **The cache is disposable.** Feed pages are cached for speed only; the metadata database stays the source of truth, so the cache can be flushed at any time.
- **→** `u38` [Pinhole: high-level design for photo sharing › Design decisions] **Buy delivery, don't build it.** We use a third-party CDN and push-notification provider instead of running our own, and we accept that their outages are outside our control.
- `u39` [Pinhole: high-level design for photo sharing › Open questions] How failed processing is retried, and when a stuck photo is cleaned up, is not decided yet.
- `u40` [Pinhole: high-level design for photo sharing › Open questions] Whether the feed service should precompute feeds for accounts with very many followers is left to the feed service's own low-level design.

## R52 (kn-02-edge-cache-invalidation)

Clause: **"nothing the origin does will shorten that wait"** (in u11)

- `u6` [Invalidating cached content at the edge › Letting copies expire] The simplest form of invalidation is not to invalidate at all: every cached object carries a time to live (TTL), and the edge discards or rechecks its copy once the TTL has passed.
- `u7` [Invalidating cached content at the edge › Letting copies expire] The origin sets the TTL with the `Cache-Control` header; for example, `Cache-Control: max-age=300` lets an edge location keep a copy for 300 seconds.
- `u8` [Invalidating cached content at the edge › Letting copies expire] TTL expiry needs no coordination between the origin and the edge, which is why every CDN uses it as the default.
- `u9` [Invalidating cached content at the edge › Letting copies expire] When a TTL runs out, the edge does not always download the whole object again: if the origin sent an `ETag`, the edge can ask whether the copy changed and receive a short `304 Not Modified` answer when it has not.
- `u10` [Invalidating cached content at the edge › Letting copies expire] Its weakness is that the TTL is a guess made in advance.
- **→** `u11` [Invalidating cached content at the edge › Letting copies expire] If an editor corrects a headline 60 seconds after publishing, readers can keep seeing the old headline for up to the remaining 240 seconds of a 300-second TTL, and nothing the origin does will shorten that wait.
- `u12` [Invalidating cached content at the edge › Letting copies expire] Shortening the TTL narrows the window but sends more requests back to the origin: when Larkspur dropped its article TTL from 300 to 30 seconds, origin traffic rose roughly eightfold.
- `u13` [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.

## R53 (kn-10-inventory-architecture-frames)

Clause: **"after the 5th failed attempt"** (in u38)

- `u32` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Every module logs through the structured logger in `src/platform/log.ts`, which writes one JSON line per event and always includes the correlation ID that the HTTP handlers attached.
- `u33` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The handlers log each request, and the retry helper logs each failed attempt.
- `u34` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Calls to the supplier API can fail, so the feed adapter wraps them in the retry helper in `src/platform/retry.ts`.
- `u35` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The retry policy is:
- `u36` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] at most 5 attempts per delivery;
- `u37` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] exponential backoff that starts at 2 seconds, doubles after each failure and is capped at 60 seconds;
- **→** `u38` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] after the 5th failed attempt, the delivery is published to the dead-letter queue `inventory.dlq` on the message broker, and staff review it in the admin UI.
- `u39` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Retries apply only to supplier calls.
- `u40` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Reservations are never retried automatically: a failed reservation is returned to the caller as an error.

## R54 (kn-05-incident-review-meeting)

Clause: **"it needs one approval from the payments team"** (in u56)

- `u1` [Post-incident review: checkout outage, March 14] Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
- `u2` [Post-incident review: checkout outage, March 14] Dana: Okay, I think everyone's here.
- `u3` [Post-incident review: checkout outage, March 14] Did people manage to grab coffee?
- `u4` [Post-incident review: checkout outage, March 14] The machine on four is broken again.
- `u5` [Post-incident review: checkout outage, March 14] Kenji: I brought my own.
- `u6` [Post-incident review: checkout outage, March 14] Lesson learned.
- `u7` [Post-incident review: checkout outage, March 14] Dana: Smart.
- `u8` [Post-incident review: checkout outage, March 14] Right, let's start.
- `u9` [Post-incident review: checkout outage, March 14] This is the blameless review for the checkout outage on Friday, March 14.
- `u10` [Post-incident review: checkout outage, March 14] Marcus, can you walk us through the timeline?
- `u11` [Post-incident review: checkout outage, March 14] Marcus: Sure.
- `u12` [Post-incident review: checkout outage, March 14] At 16:40 a config change to the payments service went out.
- `u13` [Post-incident review: checkout outage, March 14] It changed the gateway connection pool from 50 connections to 5.
- `u14` [Post-incident review: checkout outage, March 14] That was a typo; the intent was 55.
- `u15` [Post-incident review: checkout outage, March 14] Checkout requests started queuing for a connection and timing out almost immediately.
- `u16` [Post-incident review: checkout outage, March 14] Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change.
- `u17` [Post-incident review: checkout outage, March 14] I rolled the config back at 17:15, and checkout was fully recovered at 17:27.
- `u18` [Post-incident review: checkout outage, March 14] So customers saw errors for 47 minutes in total.
- `u19` [Post-incident review: checkout outage, March 14] Kenji: And on our side, we counted about 2,300 failed checkouts in that window.
- `u20` [Post-incident review: checkout outage, March 14] Support got 140 tickets before we posted the status page.
- `u21` [Post-incident review: checkout outage, March 14] Dana: Why did the alert take 22 minutes?
- `u22` [Post-incident review: checkout outage, March 14] Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
- `u23` [Post-incident review: checkout outage, March 14] Errors went over 10% around 16:47, so the earliest it could fire was 17:02.
- `u24` [Post-incident review: checkout outage, March 14] It did exactly what it was configured to do.
- `u25` [Post-incident review: checkout outage, March 14] Leila: Which is too slow for checkout.
- `u26` [Post-incident review: checkout outage, March 14] 15 minutes of sustained errors is a long time when every minute is lost revenue.
- `u27` [Post-incident review: checkout outage, March 14] Dana: Fair.
- `u28` [Post-incident review: checkout outage, March 14] What do we want instead?
- `u29` [Post-incident review: checkout outage, March 14] Marcus: I'd propose 5% over 5 minutes for checkout specifically.
- `u30` [Post-incident review: checkout outage, March 14] I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.
- … (71 more units in this section; see `phase4/annotation-packets/kn-05-incident-review-meeting.md`)

## R55 (kn-06-hybrid-search-reranking)

Clause: **"only on the fused candidates, never on the whole collection"** (in u29)

- `u26` [Hybrid search and reranking in the Harbor assistant › Reranking] A reranker then rescores the fused candidates.
- `u27` [Hybrid search and reranking in the Harbor assistant › Reranking] We use a cross-encoder, a model that reads the query and one passage together and outputs a single relevance score.
- `u28` [Hybrid search and reranking in the Harbor assistant › Reranking] Because it sees both texts at once, it judges relevance far more accurately than either retriever.
- **→** `u29` [Hybrid search and reranking in the Harbor assistant › Reranking] That accuracy is expensive, so the cross-encoder runs only on the fused candidates, never on the whole collection.
- `u30` [Hybrid search and reranking in the Harbor assistant › Reranking] After reranking we keep the top 8 passages.
- `u31` [Hybrid search and reranking in the Harbor assistant › Reranking] Reranking improves the precision of the top results, but it does not guarantee that the final answer is correct.
- `u32` [Hybrid search and reranking in the Harbor assistant › Reranking] The reranker can only reorder what retrieval found: if the right passage is not among the candidates, reranking cannot recover it.
- `u33` [Hybrid search and reranking in the Harbor assistant › Reranking] A passage can also be highly relevant and still out of date, which no relevance score will detect.

## R56 (kn-09-billing-codebase-map)

Clause: **"what happens to the invoice when a quote times out"** (in u35)

- `u30` [Ledgerline billing service: codebase map › Tax] The code in `billing/tax/client.ts` defines a `TaxClient` class whose `quote(draft)` method sends the draft invoice to an external tax provider, Taxwell, over HTTPS.
- `u31` [Ledgerline billing service: codebase map › Tax] The request has a timeout of 8 seconds, set on line 21.
- `u32` [Ledgerline billing service: codebase map › Tax] The API key is read from the `TAXWELL_API_KEY` environment variable when the client is constructed.
- `u33` [Ledgerline billing service: codebase map › Tax] The response carries a tax amount for each line, which `generateInvoice` adds to the draft before saving it.
- `u34` [Ledgerline billing service: codebase map › Tax] How retries work for the tax provider is not documented.
- **→** `u35` [Ledgerline billing service: codebase map › Tax] `TaxClient.quote` contains no retry code, and I could not find out whether its callers retry, whether the Taxwell client library retries on its own, or what happens to the invoice when a quote times out.
- `u36` [Ledgerline billing service: codebase map › Persistence and events] The code writes the finished invoice to two tables, `invoices` and `invoice_lines`, inside one database transaction in `billing/invoices/generate.ts`, lines 44–52.
- `u37` [Ledgerline billing service: codebase map › Persistence and events] If either insert fails, the transaction rolls back and neither row is kept.

## R57 (kn-02-edge-cache-invalidation)

Clause: **"but it also means some readers see a copy that is older than the TTL alone would suggest"** (in u44)

- `u37` [Invalidating cached content at the edge › Serving stale on purpose] Stale-while-revalidate turns expiry from a wait into a background task.
- `u38` [Invalidating cached content at the edge › Serving stale on purpose] With `Cache-Control: max-age=300, stale-while-revalidate=60`, an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately and fetches a fresh one from the origin in the background.
- `u39` [Invalidating cached content at the edge › Serving stale on purpose] The reader gets a fast response, and the next reader gets the refreshed copy.
- `u40` [Invalidating cached content at the edge › Serving stale on purpose] Larkspur uses it on article pages, where a minute of staleness is acceptable, but not on live election results.
- `u41` [Invalidating cached content at the edge › Serving stale on purpose] The bound matters: an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss.
- `u42` [Invalidating cached content at the edge › Serving stale on purpose] A related directive, `stale-if-error=86400`, lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors.
- `u43` [Invalidating cached content at the edge › Serving stale on purpose] Serving stale is a choice about tolerance, not a way to make content fresher.
- **→** `u44` [Invalidating cached content at the edge › Serving stale on purpose] It hides a slow origin from readers, but it also means some readers see a copy that is older than the TTL alone would suggest.
- `u45` [Invalidating cached content at the edge › Versioned asset URLs] For static assets, the cleanest invalidation is a new name.
- `u46` [Invalidating cached content at the edge › Versioned asset URLs] The build puts a hash of each file's contents into its name, such as `app.3f9c2e.js`, so a changed file gets a new URL and the old cached copy is simply never requested again.

## R58 (kn-10-inventory-architecture-frames)

Clause: **"If the ledger cannot reserve the full quantity"** (in u14)

- `u9` [Shelfwise inventory service: a tour of the codebase › API and orchestration] The HTTP handlers in `src/api/routes.ts` are the only entry point for requests.
- `u10` [Shelfwise inventory service: a tour of the codebase › API and orchestration] They validate the request body, attach a correlation ID and pass the work on; they contain no business rules.
- `u11` [Shelfwise inventory service: a tour of the codebase › API and orchestration] A `POST /reservations` request goes to the reservation orchestrator in `src/orders/reserve.ts`.
- `u12` [Shelfwise inventory service: a tour of the codebase › API and orchestration] The reservation orchestrator coordinates a reservation from start to finish.
- `u13` [Shelfwise inventory service: a tour of the codebase › API and orchestration] It asks the stock ledger to reserve the requested quantity, asks the pricing rules for the order's price, and, once both succeed, publishes a StockReserved event to the message broker.
- **→** `u14` [Shelfwise inventory service: a tour of the codebase › API and orchestration] If the ledger cannot reserve the full quantity, the orchestrator rejects the whole order; it never makes a partial reservation.
- `u15` [Shelfwise inventory service: a tour of the codebase › API and orchestration] A reservation that is not confirmed within 15 minutes is released by the ledger and the stock becomes available again.
- `u16` [Shelfwise inventory service: a tour of the codebase › Domain services] The stock ledger in `src/ledger/ledger.ts` owns stock levels.

## R59 (kn-10-inventory-architecture-frames)

Clause: **"nothing alerts the team when `inventory.dlq` starts to fill up"** (in u50)

- `u48` [Shelfwise inventory service: a tour of the codebase › Known gaps] The admin UI has no automated tests yet.
- `u49` [Shelfwise inventory service: a tour of the codebase › Known gaps] The reservation orchestrator and the feed adapter can both change the same product's stock at once, and the ledger currently relies on a database row lock to keep them consistent; whether that holds under peak load has not been measured.
- **→** `u50` [Shelfwise inventory service: a tour of the codebase › Known gaps] Dead-lettered deliveries are only found when someone opens the admin UI; nothing alerts the team when `inventory.dlq` starts to fill up.

## R60 (kn-08-helpdesk-answers-hld-lld)

Clause: **"If the Reranker does not respond within 800 ms"** (in u25)

- `u18` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Agent Console posts the question to `POST /v1/answers` with the ticket id.
- `u19` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answers API checks the session and forwards the question to the Answer composer.
- `u20` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answer composer asks the Retrieval service for 50 candidate passages.
- `u21` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Rerank client sends the 50 candidates to the Reranker and keeps the top 8.
- `u22` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answer composer calls `composeAnswer` with the question and the 8 passages.
- `u23` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Orchestrator writes the answer and its citations to the Answer log.
- `u24` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] The Answers API returns the answer to the Agent Console.
- **→** `u25` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] If the Reranker does not respond within 800 ms, the Rerank client skips reranking, keeps the first 8 candidates in vector-similarity order and records `rerank_skipped = true` in the Answer log.
- `u26` [Helpdesk Answers: design from system to code › 5. Flow: answering a question] Skipping reranking keeps the request fast, but the 8 passages may then be less relevant.
- `u27` [Helpdesk Answers: design from system to code › 6. Operation: composeAnswer] `composeAnswer(question, passages)` builds the prompt with the Context builder, limited to 6,000 tokens, calls the Model Gateway, and passes the draft to the Citation checker.

**Second-link question:** does this clause materially limit the claim in u21, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R61 (kn-05-incident-review-meeting)

Clause: **"That's one incident."** (in u72)

- `u1` [Post-incident review: checkout outage, March 14] Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
- `u2` [Post-incident review: checkout outage, March 14] Dana: Okay, I think everyone's here.
- `u3` [Post-incident review: checkout outage, March 14] Did people manage to grab coffee?
- `u4` [Post-incident review: checkout outage, March 14] The machine on four is broken again.
- `u5` [Post-incident review: checkout outage, March 14] Kenji: I brought my own.
- `u6` [Post-incident review: checkout outage, March 14] Lesson learned.
- `u7` [Post-incident review: checkout outage, March 14] Dana: Smart.
- `u8` [Post-incident review: checkout outage, March 14] Right, let's start.
- `u9` [Post-incident review: checkout outage, March 14] This is the blameless review for the checkout outage on Friday, March 14.
- `u10` [Post-incident review: checkout outage, March 14] Marcus, can you walk us through the timeline?
- `u11` [Post-incident review: checkout outage, March 14] Marcus: Sure.
- `u12` [Post-incident review: checkout outage, March 14] At 16:40 a config change to the payments service went out.
- `u13` [Post-incident review: checkout outage, March 14] It changed the gateway connection pool from 50 connections to 5.
- `u14` [Post-incident review: checkout outage, March 14] That was a typo; the intent was 55.
- `u15` [Post-incident review: checkout outage, March 14] Checkout requests started queuing for a connection and timing out almost immediately.
- `u16` [Post-incident review: checkout outage, March 14] Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change.
- `u17` [Post-incident review: checkout outage, March 14] I rolled the config back at 17:15, and checkout was fully recovered at 17:27.
- `u18` [Post-incident review: checkout outage, March 14] So customers saw errors for 47 minutes in total.
- `u19` [Post-incident review: checkout outage, March 14] Kenji: And on our side, we counted about 2,300 failed checkouts in that window.
- `u20` [Post-incident review: checkout outage, March 14] Support got 140 tickets before we posted the status page.
- `u21` [Post-incident review: checkout outage, March 14] Dana: Why did the alert take 22 minutes?
- `u22` [Post-incident review: checkout outage, March 14] Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
- `u23` [Post-incident review: checkout outage, March 14] Errors went over 10% around 16:47, so the earliest it could fire was 17:02.
- `u24` [Post-incident review: checkout outage, March 14] It did exactly what it was configured to do.
- `u25` [Post-incident review: checkout outage, March 14] Leila: Which is too slow for checkout.
- `u26` [Post-incident review: checkout outage, March 14] 15 minutes of sustained errors is a long time when every minute is lost revenue.
- `u27` [Post-incident review: checkout outage, March 14] Dana: Fair.
- `u28` [Post-incident review: checkout outage, March 14] What do we want instead?
- `u29` [Post-incident review: checkout outage, March 14] Marcus: I'd propose 5% over 5 minutes for checkout specifically.
- `u30` [Post-incident review: checkout outage, March 14] I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.
- … (71 more units in this section; see `phase4/annotation-packets/kn-05-incident-review-meeting.md`)

## R62 (kn-06-hybrid-search-reranking)

Clause: **"for this collection takes about 6 hours"** (in u15)

- `u10` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Vector retrieval turns the query and every passage into embeddings, lists of numbers produced by an encoder model, and returns the passages whose embeddings lie closest to the query's.
- `u11` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Passages that mean the same thing end up close together even when they share no words, so the stalled-upload question can find the passage about paused transfers.
- `u12` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Embeddings are weaker on exact codes and identifiers.
- `u13` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] To the encoder, `E-4012` and `E-4021` look almost the same, and a rare product name may be split into fragments that carry little meaning.
- `u14` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] In our tests, vector retrieval alone missed the correct passage for 31 of 50 queries that consisted mainly of an error code.
- **→** `u15` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Embeddings must also be recomputed whenever the encoder changes, which for this collection takes about 6 hours.
- `u16` [Hybrid search and reranking in the Harbor assistant › Combining the two signals] Hybrid search runs both retrievers on the same query and merges their result lists.
- `u17` [Hybrid search and reranking in the Harbor assistant › Combining the two signals] Hybrid search can improve recall when lexical and semantic signals are complementary, that is, when each retriever finds relevant passages that the other misses.

**Second-link question:** does this clause materially limit the claim in u10, so that a reader of that claim without this clause would act wrongly or be misled? Answer `add` with the exact evidence span, or `reject`.

## R63 (kn-04-queue-choice)

Clause: **"local development needs an emulator that does not support dead-lettering"** (in u28)

- `u26` [Choosing a queue for background jobs › Benefits and trade-offs] Option A needs almost no operational work, and failed messages move to a dead-letter queue automatically.
- `u27` [Choosing a queue for background jobs › Benefits and trade-offs] The catch is that the service delivers each message at least once, so every job handler must be made idempotent before we switch; today only the email handler is.
- **→** `u28` [Choosing a queue for background jobs › Benefits and trade-offs] It also ties us to one provider's API, and local development needs an emulator that does not support dead-lettering.
- `u29` [Choosing a queue for background jobs › Benefits and trade-offs] Option B gives us priority queues and delayed delivery, which would let month-end invoices jump ahead of webhook retries.
- `u30` [Choosing a queue for background jobs › Benefits and trade-offs] No one on the team has run this broker in production, so the 12 hours a month is an estimate, not a measurement.
- `u31` [Choosing a queue for background jobs › Benefits and trade-offs] Upgrades need a maintenance window.
- `u32` [Choosing a queue for background jobs › Benefits and trade-offs] Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue.
- `u33` [Choosing a queue for background jobs › Benefits and trade-offs] That guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it.
- `u34` [Choosing a queue for background jobs › Benefits and trade-offs] Polling also adds read load to the primary database, which is the main risk at month-end.

## R64 (kn-04-queue-choice)

Clause: **"jobs enqueued by the reporting service, which has its own database, would not get it"** (in u33)

- `u26` [Choosing a queue for background jobs › Benefits and trade-offs] Option A needs almost no operational work, and failed messages move to a dead-letter queue automatically.
- `u27` [Choosing a queue for background jobs › Benefits and trade-offs] The catch is that the service delivers each message at least once, so every job handler must be made idempotent before we switch; today only the email handler is.
- `u28` [Choosing a queue for background jobs › Benefits and trade-offs] It also ties us to one provider's API, and local development needs an emulator that does not support dead-lettering.
- `u29` [Choosing a queue for background jobs › Benefits and trade-offs] Option B gives us priority queues and delayed delivery, which would let month-end invoices jump ahead of webhook retries.
- `u30` [Choosing a queue for background jobs › Benefits and trade-offs] No one on the team has run this broker in production, so the 12 hours a month is an estimate, not a measurement.
- `u31` [Choosing a queue for background jobs › Benefits and trade-offs] Upgrades need a maintenance window.
- `u32` [Choosing a queue for background jobs › Benefits and trade-offs] Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue.
- **→** `u33` [Choosing a queue for background jobs › Benefits and trade-offs] That guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it.
- `u34` [Choosing a queue for background jobs › Benefits and trade-offs] Polling also adds read load to the primary database, which is the main risk at month-end.
- `u35` [Choosing a queue for background jobs › Evidence] We load-tested Option C on a staging copy of the database with synthetic jobs.

