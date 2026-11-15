# Human spot check: claim–condition snapshot v3

Rubric: read `phase4/EVAL-SPEC-v3.md` §2 (verdicts, R1–R5) before starting. **Do not open `SAMPLE-KEY.json`** or the
`phase4/adjudicated/` files until you have finished: they hold the model reference labels.

For each item: the highlighted clause sits in the source passage shown (its section). Record in `answers.json`
(copy `answers.template.json`):
- `verdict`: `claim` (restating the claim without the clause becomes false or misleading, or leads a reader to act
  wrongly), `set` (the takeaway is unchanged but the condition belongs somewhere in the notes), `ambiguous` (the
  source does not settle it: write both readings), or `not_a_condition`.
- `claimLinks`: the unit id(s) of the claim the clause limits, **up to two** links when it genuinely limits both
  its own sentence's claim and a broader section claim; one link otherwise. Empty for `not_a_condition`.
- `confidence`: high, medium or low; `note`: a sentence on why, especially when you hesitated.

36 items. Roughly 1–2 minutes each.

## H01 (kn-11-ambiguous-analytics-proposal)

Clause: **"The enrichment step uses the user service."** (in u11)

- `u5` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Client SDKs in the web and mobile apps send events to a collector service over HTTPS.
- `u6` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Clients batch events and send them every 10 seconds, or sooner when the app goes to the background.
- `u7` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Each event carries an event name, a timestamp, an anonymous device id and, for signed-in users, an account id.
- `u8` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The collector validates each event against the schema registry and rejects events that do not match a registered schema.
- `u9` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Accepted events are published to the `analytics.events` topic on the message bus.
- `u10` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] An enrichment step consumes the topic and adds account attributes, such as plan tier and region.
- **→** `u11` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The enrichment step uses the user service.
- `u12` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] If an account cannot be found, the event is passed on without account attributes.
- `u13` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Enriched events are then written to the warehouse in hourly batches, where the analytics team builds dashboards on them.
- `u14` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The first dashboards will cover the onboarding funnel and weekly active accounts per plan tier.
- `u15` [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] We expect the user service to stay lightly loaded, so enrichment should avoid adding much traffic to it.

## H02 (kn-12-flag-rollout-update)

Clause: **"the guide sets no minimum for it"** (in u8)

- `u6` [Feature flag rollout guide › Rollout stages] A rollout moves through three stages: internal, canary and general availability.
- `u7` [Feature flag rollout guide › Rollout stages] In the internal stage the flag is on only for staff accounts, so problems reach colleagues before they reach customers.
- **→** `u8` [Feature flag rollout guide › Rollout stages] The internal stage usually lasts one working day, but the guide sets no minimum for it.
- `u9` [Feature flag rollout guide › Rollout stages] Canary then exposes a small share of real traffic to the change.
- `u10` [Feature flag rollout guide › Rollout stages] General availability turns the flag on for everyone, in steps of 25%, 50% and 100%.
- `u11` [Feature flag rollout guide › Rollout stages] Each stage is recorded in the rollout tool, which keeps the history of who moved the flag and when.

## H03 (kn-04-queue-choice)

Clause: **"We did not test 1,800 jobs per minute"** (in u38)

- `u35` [Choosing a queue for background jobs › Evidence] We load-tested Option C on a staging copy of the database with synthetic jobs.
- `u36` [Choosing a queue for background jobs › Evidence] It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms.
- `u37` [Choosing a queue for background jobs › Evidence] At 2,000 jobs per minute, primary CPU reached 85% and p95 latency rose to 240 ms.
- **→** `u38` [Choosing a queue for background jobs › Evidence] We did not test 1,800 jobs per minute, and the staging copy is about a quarter of production size, so these results may not carry over.
- `u39` [Choosing a queue for background jobs › Evidence] We have not load-tested Options A or B.
- `u40` [Choosing a queue for background jobs › Evidence] The provider documents throughput far above our peak for Option A, but that is the provider's figure, not ours.

## H04 (kn-06-hybrid-search-reranking)

Clause: **"at some cost in recall"** (in u47)

- `u38` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Every stage buys relevance with time or money.
- `u39` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] On an internal test set of 400 questions, we measured:
- `u40` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Configuration | Correct passage in top 8 | Median latency | Cost per 1,000 queries
- `u41` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] BM25 only | 61% | 35 ms | $0.02
- `u42` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Vector only | 68% | 60 ms | $0.10
- `u43` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Hybrid (RRF) | 79% | 70 ms | $0.12
- `u44` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Hybrid + reranker | 88% | 190 ms | $0.95
- `u45` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Reranking adds about 120 ms per query, most of it spent running the cross-encoder over up to 100 candidates, and it accounts for most of the cost increase.
- `u46` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] These figures come from one collection and one query set; a collection with fewer exact identifiers may see a smaller gain from BM25, and a different reranker will have a different latency.
- **→** `u47` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Teams with a strict latency budget can rerank fewer candidates, for example the top 30 of the fused list instead of all of them, at some cost in recall.
- `u48` [Hybrid search and reranking in the Harbor assistant › Summary] Hybrid search widens the net, reranking sorts the catch, and generation can only work with the passages it is given.
- `u49` [Hybrid search and reranking in the Harbor assistant › Summary] Each step helps only under its own conditions, and none of them makes the final answer certain to be right.

## H05 (kn-11-ambiguous-analytics-proposal)

Clause: **"90 days"** (in u33)

- `u29` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Component | Owner | Retention
- `u30` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Collector | Platform team | none
- `u31` [Proposal: product-analytics event pipeline (draft v0.3) › Components] analytics.events topic | Platform team | 7 days
- `u32` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Enrichment | Data team | none
- **→** `u33` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Warehouse raw events | Data team | 90 days
- `u34` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Schema registry | TBD | indefinite
- `u35` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 1 covers the web app's sign-up and checkout events.

## H06 (kn-09-billing-codebase-map)

Clause: **"what happens to the invoice when a quote times out"** (in u35)

- `u30` [Ledgerline billing service: codebase map › Tax] The code in `billing/tax/client.ts` defines a `TaxClient` class whose `quote(draft)` method sends the draft invoice to an external tax provider, Taxwell, over HTTPS.
- `u31` [Ledgerline billing service: codebase map › Tax] The request has a timeout of 8 seconds, set on line 21.
- `u32` [Ledgerline billing service: codebase map › Tax] The API key is read from the `TAXWELL_API_KEY` environment variable when the client is constructed.
- `u33` [Ledgerline billing service: codebase map › Tax] The response carries a tax amount for each line, which `generateInvoice` adds to the draft before saving it.
- `u34` [Ledgerline billing service: codebase map › Tax] How retries work for the tax provider is not documented.
- **→** `u35` [Ledgerline billing service: codebase map › Tax] `TaxClient.quote` contains no retry code, and I could not find out whether its callers retry, whether the Taxwell client library retries on its own, or what happens to the invoice when a quote times out.
- `u36` [Ledgerline billing service: codebase map › Persistence and events] The code writes the finished invoice to two tables, `invoices` and `invoice_lines`, inside one database transaction in `billing/invoices/generate.ts`, lines 44–52.
- `u37` [Ledgerline billing service: codebase map › Persistence and events] If either insert fails, the transaction rolls back and neither row is kept.

## H07 (kn-04-queue-choice)

Clause: **"assumes current volume"** (in u16)

- `u12` [Choosing a queue for background jobs › Costs] Option | Monthly infrastructure | Monthly team effort | Notes
- `u13` [Choosing a queue for background jobs › Costs] Managed cloud queue | $310 | about 2 hours | Priced per million requests; grows with volume
- `u14` [Choosing a queue for background jobs › Costs] Self-hosted broker | $540 | about 12 hours | Three VMs plus upgrades and on-call
- `u15` [Choosing a queue for background jobs › Costs] Database job table | $0 extra | about 4 hours | Uses spare capacity on the existing primary
- **→** `u16` [Choosing a queue for background jobs › Costs] The managed queue's figure assumes current volume.
- `u17` [Choosing a queue for background jobs › Costs] At three times today's volume it would be roughly $900 a month, while the broker's cost would stay flat until the cluster needs a fourth machine.
- `u18` [Choosing a queue for background jobs › Selection criteria] Two criteria are must-haves; an option that fails either is out regardless of its score:

## H08 (kn-06-hybrid-search-reranking)

Clause: **"Its weakness is vocabulary mismatch"** (in u9)

- `u4` [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] Keyword retrieval scores a passage by the query terms it contains, weighted so that rare terms count for more than common ones.
- `u5` [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] BM25 is the usual scoring function for this; it also dampens the effect of a term repeated many times and corrects for passage length.
- `u6` [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] BM25 needs no training and is cheap to run, which is why it remains the baseline.
- `u7` [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] Its strength is exact matching.
- `u8` [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] A query for the error code `E-4012` or the setting `sync.retry_window` finds the passages that contain those strings, even when they appear only once in the whole collection.
- **→** `u9` [Hybrid search and reranking in the Harbor assistant › Keyword retrieval with BM25] Its weakness is vocabulary mismatch: a user who asks "why does my upload stall" will not match a passage that only says "transfers pause when the connection drops".
- `u10` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Vector retrieval turns the query and every passage into embeddings, lists of numbers produced by an encoder model, and returns the passages whose embeddings lie closest to the query's.
- `u11` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Passages that mean the same thing end up close together even when they share no words, so the stalled-upload question can find the passage about paused transfers.

## H09 (kn-03-blue-green-deploy)

Clause: **"once, from a single job rather than from every green instance at startup"** (in u16)

- `u14` [Blue-green deployment for the orders service › Steps] In this walkthrough blue is live and green is idle.
- `u15` [Blue-green deployment for the orders service › Steps] **Deploy to the idle environment.** Deploy version `2.8.0` to `orders-green`, using the same build artifact that passed staging rather than a fresh build. Expected result: all green instances report the new version, and blue still serves 100% of traffic.
- **→** `u16` [Blue-green deployment for the orders service › Steps] **Run the migrations.** Apply the database migrations from the new release, once, from a single job rather than from every green instance at startup. Expected result: the migration job exits with code 0, and blue keeps serving requests without new errors, which confirms the change is backward compatible.
- `u17` [Blue-green deployment for the orders service › Steps] **Check health on green.** Poll the health endpoint on every green instance until all of them return `200`. If any instance is still failing health checks after 10 minutes, stop here and roll back: tear down green and leave blue serving traffic. Nothing has been switched yet, so customers are unaffected.
- `u18` [Blue-green deployment for the orders service › Steps] **Smoke-test green.** Send the smoke-test suite to green's internal address. Expected result: all smoke tests pass. If one fails, treat it like a failed health check and stop.
- `u19` [Blue-green deployment for the orders service › Steps] **Switch traffic.** Point the listener at the green target group:
- `u20` [Blue-green deployment for the orders service › Steps] aws elbv2 modify-listener \ --listener-arn "$ORDERS_LISTENER_ARN" \ --default-actions Type=forward,TargetGroupArn="$GREEN_TG_ARN"
- `u21` [Blue-green deployment for the orders service › Steps] Expected result: within about 30 seconds, new requests are served by green, and blue receives no new connections.
- `u22` [Blue-green deployment for the orders service › Steps] **Watch the error rate.** Observe the 5xx error rate on green for 15 minutes after the switch. If the error rate rises above 2% at any point in that window, switch back: run the same command with `$BLUE_TG_ARN`, which returns all traffic to blue within about 30 seconds. If it stays at or below 2%, continue.
- `u23` [Blue-green deployment for the orders service › Steps] **Keep blue as a standby.** Leave blue running, unchanged, for 24 hours. It is your rollback target until then.
- `u24` [Blue-green deployment for the orders service › Steps] **Retire blue.** After 24 hours without a switch-back, scale blue down. Blue becomes the idle environment for the next release, with the roles reversed.

## H10 (kn-02-edge-cache-invalidation)

Clause: **"so they still need a TTL, a purge or both"** (in u50)

- `u45` [Invalidating cached content at the edge › Versioned asset URLs] For static assets, the cleanest invalidation is a new name.
- `u46` [Invalidating cached content at the edge › Versioned asset URLs] The build puts a hash of each file's contents into its name, such as `app.3f9c2e.js`, so a changed file gets a new URL and the old cached copy is simply never requested again.
- `u47` [Invalidating cached content at the edge › Versioned asset URLs] Because a versioned URL never changes its content, it can be cached for a very long time; Larkspur serves its versioned assets with `max-age=31536000`, which is one year.
- `u48` [Invalidating cached content at the edge › Versioned asset URLs] Most build tools can add the hash automatically, so the cost is a one-time change to the build configuration.
- `u49` [Invalidating cached content at the edge › Versioned asset URLs] Versioning does not help for HTML entry pages.
- **→** `u50` [Invalidating cached content at the edge › Versioned asset URLs] The home page and article pages are requested at fixed addresses such as `/` and `/story/417`, and they are the pages that point to the new asset names, so they still need a TTL, a purge or both.
- `u51` [Invalidating cached content at the edge › Versioned asset URLs] If an HTML page stays cached longer than the origin keeps the old asset files, it can send readers to files that no longer exist.
- `u52` [Invalidating cached content at the edge › Versioned asset URLs] Old asset versions should therefore stay available for at least as long as the longest HTML TTL.

## H11 (kn-03-blue-green-deploy)

Clause: **"It assumes you already run the service behind a load balancer."** (in u2)

- `u1` [Blue-green deployment for the orders service] This tutorial walks through a blue-green release of `orders-api`, a fictional web service, from a fresh build to a cleaned-up environment.
- **→** `u2` [Blue-green deployment for the orders service] It assumes you already run the service behind a load balancer.
- `u3` [Blue-green deployment for the orders service › How blue-green works] You keep two identical production environments, called blue and green.
- `u4` [Blue-green deployment for the orders service › How blue-green works] One of them serves all live traffic while the other sits idle; you deploy the new version to the idle one, test it there, and then move traffic over in one step.
- `u5` [Blue-green deployment for the orders service › How blue-green works] Because the old environment is still running, going back is the same one-step switch.
- `u6` [Blue-green deployment for the orders service › How blue-green works] The cost is running twice the infrastructure during a release, which is why the idle environment is scaled down between releases.
- `u7` [Blue-green deployment for the orders service › Before you start] You need the following in place before the first release:
- `u8` [Blue-green deployment for the orders service › Before you start] Two identical environments, `orders-blue` and `orders-green`, with the same instance count, instance size and configuration.
- `u9` [Blue-green deployment for the orders service › Before you start] A health endpoint, `GET /healthz`, that returns `200` only when the service can reach its database and its queue.
- `u10` [Blue-green deployment for the orders service › Before you start] Database migrations that are backward compatible, so the old version keeps working against the new schema. This is a hard requirement: both versions share one database, and a rollback does not undo a migration.
- `u11` [Blue-green deployment for the orders service › Before you start] Access to the load balancer's listener rules, because the switch is a change to which target group the listener forwards to.
- `u12` [Blue-green deployment for the orders service › Before you start] A dashboard or query that shows the 5xx error rate per environment, so you can tell green's errors from blue's.
- `u13` [Blue-green deployment for the orders service › Before you start] If any migration is not backward compatible, do not use this procedure; split the migration into an additive release first and a cleanup release later.
- `u14` [Blue-green deployment for the orders service › Steps] In this walkthrough blue is live and green is idle.
- `u15` [Blue-green deployment for the orders service › Steps] **Deploy to the idle environment.** Deploy version `2.8.0` to `orders-green`, using the same build artifact that passed staging rather than a fresh build. Expected result: all green instances report the new version, and blue still serves 100% of traffic.
- `u16` [Blue-green deployment for the orders service › Steps] **Run the migrations.** Apply the database migrations from the new release, once, from a single job rather than from every green instance at startup. Expected result: the migration job exits with code 0, and blue keeps serving requests without new errors, which confirms the change is backward compatible.
- `u17` [Blue-green deployment for the orders service › Steps] **Check health on green.** Poll the health endpoint on every green instance until all of them return `200`. If any instance is still failing health checks after 10 minutes, stop here and roll back: tear down green and leave blue serving traffic. Nothing has been switched yet, so customers are unaffected.
- `u18` [Blue-green deployment for the orders service › Steps] **Smoke-test green.** Send the smoke-test suite to green's internal address. Expected result: all smoke tests pass. If one fails, treat it like a failed health check and stop.
- `u19` [Blue-green deployment for the orders service › Steps] **Switch traffic.** Point the listener at the green target group:
- `u20` [Blue-green deployment for the orders service › Steps] aws elbv2 modify-listener \ --listener-arn "$ORDERS_LISTENER_ARN" \ --default-actions Type=forward,TargetGroupArn="$GREEN_TG_ARN"
- `u21` [Blue-green deployment for the orders service › Steps] Expected result: within about 30 seconds, new requests are served by green, and blue receives no new connections.
- `u22` [Blue-green deployment for the orders service › Steps] **Watch the error rate.** Observe the 5xx error rate on green for 15 minutes after the switch. If the error rate rises above 2% at any point in that window, switch back: run the same command with `$BLUE_TG_ARN`, which returns all traffic to blue within about 30 seconds. If it stays at or below 2%, continue.
- `u23` [Blue-green deployment for the orders service › Steps] **Keep blue as a standby.** Leave blue running, unchanged, for 24 hours. It is your rollback target until then.
- `u24` [Blue-green deployment for the orders service › Steps] **Retire blue.** After 24 hours without a switch-back, scale blue down. Blue becomes the idle environment for the next release, with the roles reversed.
- `u25` [Blue-green deployment for the orders service › When things go wrong] A rollback before step 5 is cheap, because customers never saw green.
- `u26` [Blue-green deployment for the orders service › When things go wrong] A switch-back after step 5 is also fast, but requests that were in flight on green during the switch may fail and need a client retry.
- `u27` [Blue-green deployment for the orders service › When things go wrong] Neither kind of rollback reverts the database, which is why the backward-compatible migration requirement matters.
- `u28` [Blue-green deployment for the orders service › When things go wrong] Whichever way you roll back, record what failed before trying again, because a second attempt with the same build tends to fail the same way.
- `u29` [Blue-green deployment for the orders service › When things go wrong] Do not run the next release's migrations while blue is still on standby.
- `u30` [Blue-green deployment for the orders service › When things go wrong] If you do, the standby may no longer work against the schema, and the switch-back stops being a safe option.
- … (1 more units in this section; see `phase4/annotation-packets/kn-03-blue-green-deploy.md`)

## H12 (kn-05-incident-review-meeting)

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

## H13 (kn-10-inventory-architecture-frames)

Clause: **"capped at 60 seconds"** (in u37)

- `u32` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Every module logs through the structured logger in `src/platform/log.ts`, which writes one JSON line per event and always includes the correlation ID that the HTTP handlers attached.
- `u33` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The handlers log each request, and the retry helper logs each failed attempt.
- `u34` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Calls to the supplier API can fail, so the feed adapter wraps them in the retry helper in `src/platform/retry.ts`.
- `u35` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The retry policy is:
- `u36` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] at most 5 attempts per delivery;
- **→** `u37` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] exponential backoff that starts at 2 seconds, doubles after each failure and is capped at 60 seconds;
- `u38` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] after the 5th failed attempt, the delivery is published to the dead-letter queue `inventory.dlq` on the message broker, and staff review it in the admin UI.
- `u39` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Retries apply only to supplier calls.
- `u40` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Reservations are never retried automatically: a failed reservation is returned to the caller as an error.

## H14 (kn-08-helpdesk-answers-hld-lld)

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

## H15 (kn-06-hybrid-search-reranking)

Clause: **"but they do not show whether the passage itself is current"** (in u36)

- `u34` [Hybrid search and reranking in the Harbor assistant › Generation] The language model receives the question and the top 8 passages, and is instructed to answer only from them and to cite the passages it used.
- `u35` [Hybrid search and reranking in the Harbor assistant › Generation] If none of the passages addresses the question, it should say so rather than answer from its general knowledge.
- **→** `u36` [Hybrid search and reranking in the Harbor assistant › Generation] Citations let a reader check each claim against its passage, but they do not show whether the passage itself is current.
- `u37` [Hybrid search and reranking in the Harbor assistant › Generation] For example, asked "What does E-4012 mean?", the assistant retrieves the error-code table through BM25 and the article on resumable uploads through vector search, and the reranker keeps both in the top 8, so the answer can define the code and explain the fix.
- `u38` [Hybrid search and reranking in the Harbor assistant › Relevance, latency and cost] Every stage buys relevance with time or money.

## H16 (kn-02-edge-cache-invalidation)

Clause: **"not a way to make content fresher"** (in u43)

- `u37` [Invalidating cached content at the edge › Serving stale on purpose] Stale-while-revalidate turns expiry from a wait into a background task.
- `u38` [Invalidating cached content at the edge › Serving stale on purpose] With `Cache-Control: max-age=300, stale-while-revalidate=60`, an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately and fetches a fresh one from the origin in the background.
- `u39` [Invalidating cached content at the edge › Serving stale on purpose] The reader gets a fast response, and the next reader gets the refreshed copy.
- `u40` [Invalidating cached content at the edge › Serving stale on purpose] Larkspur uses it on article pages, where a minute of staleness is acceptable, but not on live election results.
- `u41` [Invalidating cached content at the edge › Serving stale on purpose] The bound matters: an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss.
- `u42` [Invalidating cached content at the edge › Serving stale on purpose] A related directive, `stale-if-error=86400`, lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors.
- **→** `u43` [Invalidating cached content at the edge › Serving stale on purpose] Serving stale is a choice about tolerance, not a way to make content fresher.
- `u44` [Invalidating cached content at the edge › Serving stale on purpose] It hides a slow origin from readers, but it also means some readers see a copy that is older than the TTL alone would suggest.
- `u45` [Invalidating cached content at the edge › Versioned asset URLs] For static assets, the cleanest invalidation is a new name.

## H17 (kn-02-edge-cache-invalidation)

Clause: **"but not on live election results"** (in u40)

- `u37` [Invalidating cached content at the edge › Serving stale on purpose] Stale-while-revalidate turns expiry from a wait into a background task.
- `u38` [Invalidating cached content at the edge › Serving stale on purpose] With `Cache-Control: max-age=300, stale-while-revalidate=60`, an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately and fetches a fresh one from the origin in the background.
- `u39` [Invalidating cached content at the edge › Serving stale on purpose] The reader gets a fast response, and the next reader gets the refreshed copy.
- **→** `u40` [Invalidating cached content at the edge › Serving stale on purpose] Larkspur uses it on article pages, where a minute of staleness is acceptable, but not on live election results.
- `u41` [Invalidating cached content at the edge › Serving stale on purpose] The bound matters: an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss.
- `u42` [Invalidating cached content at the edge › Serving stale on purpose] A related directive, `stale-if-error=86400`, lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors.
- `u43` [Invalidating cached content at the edge › Serving stale on purpose] Serving stale is a choice about tolerance, not a way to make content fresher.
- `u44` [Invalidating cached content at the edge › Serving stale on purpose] It hides a slow origin from readers, but it also means some readers see a copy that is older than the TTL alone would suggest.

## H18 (kn-10-inventory-architecture-frames)

Clause: **"Every 10 minutes"** (in u24)

- `u22` [Shelfwise inventory service: a tour of the codebase › Domain services] Dependencies point inwards: the API layer calls the orchestrator, the orchestrator calls the domain modules, and the domain modules depend only on persistence and the platform helpers.
- `u23` [Shelfwise inventory service: a tour of the codebase › Supplier integration] The supplier feed adapter in `src/suppliers/feedAdapter.ts` brings in restocks from suppliers.
- **→** `u24` [Shelfwise inventory service: a tour of the codebase › Supplier integration] Every 10 minutes it calls the supplier API for new deliveries, converts each delivery into a restock and asks the stock ledger to record it.
- `u25` [Shelfwise inventory service: a tour of the codebase › Supplier integration] The adapter is the only module that knows the supplier's data format, so a change on the supplier's side stays inside this one file.
- `u26` [Shelfwise inventory service: a tour of the codebase › Supplier integration] A delivery the adapter cannot parse is logged and skipped; it is not retried, because sending the same bad data again would fail the same way.

## H19 (kn-05-incident-review-meeting)

Clause: **"Leila, can you set that up?"** (in u60)

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

## H20 (kn-05-incident-review-meeting)

Clause: **"Tomás: I'm fine with that."** (in u57)

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

## H21 (kn-10-inventory-architecture-frames)

Clause: **"at most 5 attempts per delivery"** (in u36)

- `u32` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Every module logs through the structured logger in `src/platform/log.ts`, which writes one JSON line per event and always includes the correlation ID that the HTTP handlers attached.
- `u33` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The handlers log each request, and the retry helper logs each failed attempt.
- `u34` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Calls to the supplier API can fail, so the feed adapter wraps them in the retry helper in `src/platform/retry.ts`.
- `u35` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The retry policy is:
- **→** `u36` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] at most 5 attempts per delivery;
- `u37` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] exponential backoff that starts at 2 seconds, doubles after each failure and is capped at 60 seconds;
- `u38` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] after the 5th failed attempt, the delivery is published to the dead-letter queue `inventory.dlq` on the message broker, and staff review it in the admin UI.
- `u39` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Retries apply only to supplier calls.
- `u40` [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Reservations are never retried automatically: a failed reservation is returned to the caller as an error.

## H22 (kn-10-inventory-architecture-frames)

Clause: **"The admin UI has no automated tests yet."** (in u48)

- `u46` [Shelfwise inventory service: a tour of the codebase › Dependency rules] Second, only the ledger writes stock to Postgres; the orchestrator and the adapter go through it.
- `u47` [Shelfwise inventory service: a tour of the codebase › Dependency rules] Third, only the supplier feed adapter calls the supplier API.
- **→** `u48` [Shelfwise inventory service: a tour of the codebase › Known gaps] The admin UI has no automated tests yet.
- `u49` [Shelfwise inventory service: a tour of the codebase › Known gaps] The reservation orchestrator and the feed adapter can both change the same product's stock at once, and the ledger currently relies on a database row lock to keep them consistent; whether that holds under peak load has not been measured.
- `u50` [Shelfwise inventory service: a tour of the codebase › Known gaps] Dead-lettered deliveries are only found when someone opens the admin UI; nothing alerts the team when `inventory.dlq` starts to fill up.

## H23 (kn-01-idempotency-keys)

Clause: **"while the server still remembers them"** (in u6)

- `u1` [Idempotency keys] An idempotency key is a unique value that a client attaches to a request so that the server can recognise a retry of the same operation.
- `u2` [Idempotency keys] If the server has already completed a request with that key, it returns the stored result instead of performing the operation again.
- `u3` [Idempotency keys] For example, a checkout client sends `Idempotency-Key: 7f3c-91ab` with a payment request.
- `u4` [Idempotency keys] The connection drops before the response arrives, so the client retries with the same key.
- `u5` [Idempotency keys] The server finds the stored result for `7f3c-91ab` and returns the original confirmation, and the customer is charged once.
- **→** `u6` [Idempotency keys] Keys only protect against duplicates while the server still remembers them.
- `u7` [Idempotency keys] In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment.
- `u8` [Idempotency keys] Keys also do not make two different requests safe: if a client reuses a key with a different amount, the server must reject the request rather than return the old result.
- `u9` [Idempotency keys] In short, idempotency keys make retries safe within a bounded window; they are not a general guarantee against duplicate operations.

## H24 (kn-01-idempotency-keys)

Clause: **"stored results expire after 24 hours, so a retry sent after that window is treated as a new payment"** (in u7)

- `u1` [Idempotency keys] An idempotency key is a unique value that a client attaches to a request so that the server can recognise a retry of the same operation.
- `u2` [Idempotency keys] If the server has already completed a request with that key, it returns the stored result instead of performing the operation again.
- `u3` [Idempotency keys] For example, a checkout client sends `Idempotency-Key: 7f3c-91ab` with a payment request.
- `u4` [Idempotency keys] The connection drops before the response arrives, so the client retries with the same key.
- `u5` [Idempotency keys] The server finds the stored result for `7f3c-91ab` and returns the original confirmation, and the customer is charged once.
- `u6` [Idempotency keys] Keys only protect against duplicates while the server still remembers them.
- **→** `u7` [Idempotency keys] In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment.
- `u8` [Idempotency keys] Keys also do not make two different requests safe: if a client reuses a key with a different amount, the server must reject the request rather than return the old result.
- `u9` [Idempotency keys] In short, idempotency keys make retries safe within a bounded window; they are not a general guarantee against duplicate operations.

## H25 (kn-08-helpdesk-answers-hld-lld)

Clause: **"published"** (in u8)

- `u3` [Helpdesk Answers: design from system to code › 2. Architecture] Agents use the Agent Console, a web client, which sends each question to the Answers API over HTTPS.
- `u4` [Helpdesk Answers: design from system to code › 2. Architecture] The Answers API checks the agent's session and forwards the question to the Orchestrator, the service that owns the answering logic.
- `u5` [Helpdesk Answers: design from system to code › 2. Architecture] The Orchestrator calls the Retrieval service to find candidate passages, sends those candidates to the Reranker service, and calls the Model Gateway, which is the only component allowed to talk to the external model provider.
- `u6` [Helpdesk Answers: design from system to code › 2. Architecture] The Retrieval service reads from the Vector store, a Postgres database with the pgvector extension.
- `u7` [Helpdesk Answers: design from system to code › 2. Architecture] The Orchestrator writes every answer, with its citations, to the Answer log table.
- **→** `u8` [Helpdesk Answers: design from system to code › 2. Architecture] Articles reach the Vector store through the Ingestion worker, which reads published articles from the Help Center CMS every 15 minutes, splits them into passages and writes their embeddings to the Vector store.
- `u9` [Helpdesk Answers: design from system to code › 2. Architecture] This document does not describe the Ingestion worker's internals, and how the Vector store is partitioned has not been decided.
- `u10` [Helpdesk Answers: design from system to code › 3. Inside the Orchestrator] The Orchestrator has four parts.

## H26 (kn-04-queue-choice)

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

## H27 (kn-11-ambiguous-analytics-proposal)

Clause: **"the web app's sign-up and checkout events"** (in u35)

- `u33` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Warehouse raw events | Data team | 90 days
- `u34` [Proposal: product-analytics event pipeline (draft v0.3) › Components] Schema registry | TBD | indefinite
- **→** `u35` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 1 covers the web app's sign-up and checkout events.
- `u36` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 2 adds mobile events once the mobile SDK is ready; no date has been set for it.
- `u37` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 1 is expected to take about 6 weeks for 2 engineers.
- `u38` [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] The cost of running the pipeline has not been estimated yet.

## H28 (kn-02-edge-cache-invalidation)

Clause: **"where a minute of staleness is acceptable"** (in u40)

- `u37` [Invalidating cached content at the edge › Serving stale on purpose] Stale-while-revalidate turns expiry from a wait into a background task.
- `u38` [Invalidating cached content at the edge › Serving stale on purpose] With `Cache-Control: max-age=300, stale-while-revalidate=60`, an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately and fetches a fresh one from the origin in the background.
- `u39` [Invalidating cached content at the edge › Serving stale on purpose] The reader gets a fast response, and the next reader gets the refreshed copy.
- **→** `u40` [Invalidating cached content at the edge › Serving stale on purpose] Larkspur uses it on article pages, where a minute of staleness is acceptable, but not on live election results.
- `u41` [Invalidating cached content at the edge › Serving stale on purpose] The bound matters: an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss.
- `u42` [Invalidating cached content at the edge › Serving stale on purpose] A related directive, `stale-if-error=86400`, lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors.
- `u43` [Invalidating cached content at the edge › Serving stale on purpose] Serving stale is a choice about tolerance, not a way to make content fresher.
- `u44` [Invalidating cached content at the edge › Serving stale on purpose] It hides a slow origin from readers, but it also means some readers see a copy that is older than the TTL alone would suggest.

## H29 (kn-09-billing-codebase-map)

Clause: **"How retries work for the tax provider is not documented."** (in u34)

- `u30` [Ledgerline billing service: codebase map › Tax] The code in `billing/tax/client.ts` defines a `TaxClient` class whose `quote(draft)` method sends the draft invoice to an external tax provider, Taxwell, over HTTPS.
- `u31` [Ledgerline billing service: codebase map › Tax] The request has a timeout of 8 seconds, set on line 21.
- `u32` [Ledgerline billing service: codebase map › Tax] The API key is read from the `TAXWELL_API_KEY` environment variable when the client is constructed.
- `u33` [Ledgerline billing service: codebase map › Tax] The response carries a tax amount for each line, which `generateInvoice` adds to the draft before saving it.
- **→** `u34` [Ledgerline billing service: codebase map › Tax] How retries work for the tax provider is not documented.
- `u35` [Ledgerline billing service: codebase map › Tax] `TaxClient.quote` contains no retry code, and I could not find out whether its callers retry, whether the Taxwell client library retries on its own, or what happens to the invoice when a quote times out.
- `u36` [Ledgerline billing service: codebase map › Persistence and events] The code writes the finished invoice to two tables, `invoices` and `invoice_lines`, inside one database transaction in `billing/invoices/generate.ts`, lines 44–52.

## H30 (kn-12-flag-rollout-update)

Clause: **"does not raise the percentage by hand during this time"** (in u14)

- `u12` [Feature flag rollout guide › Canary] During canary the flag is on for 5% of requests, chosen at random per request rather than per user.
- `u13` [Feature flag rollout guide › Canary] It must stay at that level for at least 30 minutes, so that the metrics cover a full traffic cycle of the slowest endpoint.
- **→** `u14` [Feature flag rollout guide › Canary] The owner does not raise the percentage by hand during this time, because a manual change restarts the measurement window.
- `u15` [Feature flag rollout guide › Canary] Short canaries are the most common reason a bad flag reaches general availability.
- `u16` [Feature flag rollout guide › Advancing from canary] A flag advances from canary to general availability only when the automated metrics check passes.

## H31 (kn-06-hybrid-search-reranking)

Clause: **"whenever the encoder changes"** (in u15)

- `u10` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Vector retrieval turns the query and every passage into embeddings, lists of numbers produced by an encoder model, and returns the passages whose embeddings lie closest to the query's.
- `u11` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Passages that mean the same thing end up close together even when they share no words, so the stalled-upload question can find the passage about paused transfers.
- `u12` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Embeddings are weaker on exact codes and identifiers.
- `u13` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] To the encoder, `E-4012` and `E-4021` look almost the same, and a rare product name may be split into fragments that carry little meaning.
- `u14` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] In our tests, vector retrieval alone missed the correct passage for 31 of 50 queries that consisted mainly of an error code.
- **→** `u15` [Hybrid search and reranking in the Harbor assistant › Vector retrieval with embeddings] Embeddings must also be recomputed whenever the encoder changes, which for this collection takes about 6 hours.
- `u16` [Hybrid search and reranking in the Harbor assistant › Combining the two signals] Hybrid search runs both retrievers on the same query and merges their result lists.
- `u17` [Hybrid search and reranking in the Harbor assistant › Combining the two signals] Hybrid search can improve recall when lexical and semantic signals are complementary, that is, when each retriever finds relevant passages that the other misses.

## H32 (kn-05-incident-review-meeting)

Clause: **"to the payments service"** (in u59)

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

## H33 (kn-04-queue-choice)

Clause: **"Upgrades need a maintenance window."** (in u31)

- `u26` [Choosing a queue for background jobs › Benefits and trade-offs] Option A needs almost no operational work, and failed messages move to a dead-letter queue automatically.
- `u27` [Choosing a queue for background jobs › Benefits and trade-offs] The catch is that the service delivers each message at least once, so every job handler must be made idempotent before we switch; today only the email handler is.
- `u28` [Choosing a queue for background jobs › Benefits and trade-offs] It also ties us to one provider's API, and local development needs an emulator that does not support dead-lettering.
- `u29` [Choosing a queue for background jobs › Benefits and trade-offs] Option B gives us priority queues and delayed delivery, which would let month-end invoices jump ahead of webhook retries.
- `u30` [Choosing a queue for background jobs › Benefits and trade-offs] No one on the team has run this broker in production, so the 12 hours a month is an estimate, not a measurement.
- **→** `u31` [Choosing a queue for background jobs › Benefits and trade-offs] Upgrades need a maintenance window.
- `u32` [Choosing a queue for background jobs › Benefits and trade-offs] Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue.
- `u33` [Choosing a queue for background jobs › Benefits and trade-offs] That guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it.
- `u34` [Choosing a queue for background jobs › Benefits and trade-offs] Polling also adds read load to the primary database, which is the main risk at month-end.

## H34 (kn-03-blue-green-deploy)

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

## H35 (kn-05-incident-review-meeting)

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

## H36 (kn-05-incident-review-meeting)

Clause: **"Let's not decide the freeze now."** (in u75)

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

