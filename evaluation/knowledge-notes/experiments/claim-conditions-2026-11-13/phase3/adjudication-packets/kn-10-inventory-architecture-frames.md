# Adjudication packet: kn-10-inventory-architecture-frames

## Source units (id [heading path] text)
u1 [Shelfwise inventory service: a tour of the codebase › Overview] Shelfwise is the service that keeps track of how much stock each warehouse holds and reserves stock for incoming orders.
u2 [Shelfwise inventory service: a tour of the codebase › Overview] It is one deployable TypeScript service with a small admin front end.
u3 [Shelfwise inventory service: a tour of the codebase › Overview] At peak it handles about 3,000 reservations per hour.
u4 [Shelfwise inventory service: a tour of the codebase › Overview] This tour walks through the code by responsibility: what each group of modules owns, which files to open first, and how the groups depend on each other.
u5 [Shelfwise inventory service: a tour of the codebase › Overview] The groups are presentation, API and orchestration, domain services, supplier integration, persistence and external systems, and observability and error handling.
u6 [Shelfwise inventory service: a tour of the codebase › Client and presentation] The admin web UI lives in `web/admin/`.
u7 [Shelfwise inventory service: a tour of the codebase › Client and presentation] Warehouse staff use it to look up stock levels, place manual holds and review failed supplier imports.
u8 [Shelfwise inventory service: a tour of the codebase › Client and presentation] It holds no stock logic of its own: every screen calls the service's REST API, and the UI never talks to the database directly.
u9 [Shelfwise inventory service: a tour of the codebase › API and orchestration] The HTTP handlers in `src/api/routes.ts` are the only entry point for requests.
u10 [Shelfwise inventory service: a tour of the codebase › API and orchestration] They validate the request body, attach a correlation ID and pass the work on; they contain no business rules.
u11 [Shelfwise inventory service: a tour of the codebase › API and orchestration] A `POST /reservations` request goes to the reservation orchestrator in `src/orders/reserve.ts`.
u12 [Shelfwise inventory service: a tour of the codebase › API and orchestration] The reservation orchestrator coordinates a reservation from start to finish.
u13 [Shelfwise inventory service: a tour of the codebase › API and orchestration] It asks the stock ledger to reserve the requested quantity, asks the pricing rules for the order's price, and, once both succeed, publishes a StockReserved event to the message broker.
u14 [Shelfwise inventory service: a tour of the codebase › API and orchestration] If the ledger cannot reserve the full quantity, the orchestrator rejects the whole order; it never makes a partial reservation.
u15 [Shelfwise inventory service: a tour of the codebase › API and orchestration] A reservation that is not confirmed within 15 minutes is released by the ledger and the stock becomes available again.
u16 [Shelfwise inventory service: a tour of the codebase › Domain services] The stock ledger in `src/ledger/ledger.ts` owns stock levels.
u17 [Shelfwise inventory service: a tour of the codebase › Domain services] It records every change as an append-only ledger entry (reserve, release, restock) and writes those entries to Postgres.
u18 [Shelfwise inventory service: a tour of the codebase › Domain services] The ledger is the only module allowed to write to the stock tables; other modules ask it to make changes.
u19 [Shelfwise inventory service: a tour of the codebase › Domain services] The pricing rules in `src/pricing/rules.ts` work out the price of an order from the supplier price lists and any active discounts.
u20 [Shelfwise inventory service: a tour of the codebase › Domain services] They read price lists from Redis, where they are cached for 300 seconds, and they never change stock.
u21 [Shelfwise inventory service: a tour of the codebase › Domain services] Neither domain module imports anything from `src/api/` or `src/orders/`.
u22 [Shelfwise inventory service: a tour of the codebase › Domain services] Dependencies point inwards: the API layer calls the orchestrator, the orchestrator calls the domain modules, and the domain modules depend only on persistence and the platform helpers.
u23 [Shelfwise inventory service: a tour of the codebase › Supplier integration] The supplier feed adapter in `src/suppliers/feedAdapter.ts` brings in restocks from suppliers.
u24 [Shelfwise inventory service: a tour of the codebase › Supplier integration] Every 10 minutes it calls the supplier API for new deliveries, converts each delivery into a restock and asks the stock ledger to record it.
u25 [Shelfwise inventory service: a tour of the codebase › Supplier integration] The adapter is the only module that knows the supplier's data format, so a change on the supplier's side stays inside this one file.
u26 [Shelfwise inventory service: a tour of the codebase › Supplier integration] A delivery the adapter cannot parse is logged and skipped; it is not retried, because sending the same bad data again would fail the same way.
u27 [Shelfwise inventory service: a tour of the codebase › Persistence and external systems] Postgres holds the ledger entries and the current stock level per warehouse and product; it is the source of truth for stock.
u28 [Shelfwise inventory service: a tour of the codebase › Persistence and external systems] Redis holds cached price lists and nothing that cannot be rebuilt from the supplier feed.
u29 [Shelfwise inventory service: a tour of the codebase › Persistence and external systems] The message broker carries StockReserved events to other services, such as fulfilment, and also hosts the dead-letter queue described below.
u30 [Shelfwise inventory service: a tour of the codebase › Persistence and external systems] Postgres schema changes live in `db/migrations/` and run on every deploy.
u31 [Shelfwise inventory service: a tour of the codebase › Persistence and external systems] The supplier API is run by the suppliers, outside our control, and is the only external system Shelfwise calls.
u32 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Every module logs through the structured logger in `src/platform/log.ts`, which writes one JSON line per event and always includes the correlation ID that the HTTP handlers attached.
u33 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The handlers log each request, and the retry helper logs each failed attempt.
u34 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Calls to the supplier API can fail, so the feed adapter wraps them in the retry helper in `src/platform/retry.ts`.
u35 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] The retry policy is:
u36 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] at most 5 attempts per delivery;
u37 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] exponential backoff that starts at 2 seconds, doubles after each failure and is capped at 60 seconds;
u38 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] after the 5th failed attempt, the delivery is published to the dead-letter queue `inventory.dlq` on the message broker, and staff review it in the admin UI.
u39 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Retries apply only to supplier calls.
u40 [Shelfwise inventory service: a tour of the codebase › Observability and error handling] Reservations are never retried automatically: a failed reservation is returned to the caller as an error.
u41 [Shelfwise inventory service: a tour of the codebase › Where to start reading] New contributors usually start with `src/orders/reserve.ts`, because it shows a whole reservation in about 120 lines and names every module it depends on.
u42 [Shelfwise inventory service: a tour of the codebase › Where to start reading] After that, `src/ledger/ledger.ts` explains how stock is counted.
u43 [Shelfwise inventory service: a tour of the codebase › Where to start reading] Each module keeps its tests next to its code.
u44 [Shelfwise inventory service: a tour of the codebase › Dependency rules] Three rules keep the structure readable.
u45 [Shelfwise inventory service: a tour of the codebase › Dependency rules] First, nothing in the domain modules may depend on the HTTP layer; the ledger and the pricing rules must stay usable from a script or a test without a web server.
u46 [Shelfwise inventory service: a tour of the codebase › Dependency rules] Second, only the ledger writes stock to Postgres; the orchestrator and the adapter go through it.
u47 [Shelfwise inventory service: a tour of the codebase › Dependency rules] Third, only the supplier feed adapter calls the supplier API.
u48 [Shelfwise inventory service: a tour of the codebase › Known gaps] The admin UI has no automated tests yet.
u49 [Shelfwise inventory service: a tour of the codebase › Known gaps] The reservation orchestrator and the feed adapter can both change the same product's stock at once, and the ledger currently relies on a database row lock to keep them consistent; whether that holds under peak load has not been measured.
u50 [Shelfwise inventory service: a tour of the codebase › Known gaps] Dead-lettered deliveries are only found when someone opens the admin UI; nothing alerts the team when `inventory.dlq` starts to fill up.

## Candidates with every reading

### c1: condition units u13
- R1 (phase 2 blind reviewer) r1: claim u13, binding claim — Only once both the ledger reservation and the pricing step succeed.
- R2 (blind): claim, claim u13 (high) — condition "once both succeed" / claim "publishes a StockReserved event to the message broker" — Intra-sentence gate: without it the event would seem to be published even when reserve or pricing fails.

### c2: condition units u14
- GOLDEN dataset link ku.no-partial → ku.orchestrator: claim u11+u12+u13 — If the ledger cannot reserve the full quantity, the orchestrator rejects the whole order and never makes a partial reservation.
- R1 (phase 2 blind reviewer) r2: claim u13, binding set — If the ledger cannot reserve the full quantity, the whole order is rejected; never a partial reservation.
- R2 (blind): set, claim u13 (medium) — condition "If the ledger cannot reserve the full quantity, the orchestrator rejects the whole order; it never makes a partial reservation." / claim "It asks the stock ledger to reserve the requested quantity" — All-or-nothing failure behaviour; u13 already says publishing waits for success, so u13 stays true without it.

### c3: condition units u15
- GOLDEN dataset link ku.hold-expiry → ku.ledger: claim u16+u17+u18+u46 — A reservation that is not confirmed within 15 minutes is released by the ledger and the stock becomes available again.
- R1 (phase 2 blind reviewer) r3: claim u13, binding set — A reservation not confirmed within 15 minutes is released and the stock becomes available again.
- R2 (blind): set, claim u13 (medium) — condition "A reservation that is not confirmed within 15 minutes is released by the ledger" / claim "It asks the stock ledger to reserve the requested quantity" — Expiry bound on a reservation; the reserve claim stays true but readers must know holds are temporary.

### c4: condition units u20
- R1 (phase 2 blind reviewer) r9: claim u20, binding set — Price lists are cached for 300 seconds.
- R2 (blind): set, claim u19+u20 (medium) — condition "where they are cached for 300 seconds" / claim "work out the price of an order from the supplier price lists and any active discounts" — Staleness bound: prices can lag supplier lists by up to 300 s.

### c5: condition units u24
- R1 (phase 2 blind reviewer) r10: claim u23, binding set — It polls the supplier API every 10 minutes.
- R2 (blind): set, claim u23 (medium) — condition "Every 10 minutes it calls the supplier API for new deliveries" / claim "brings in restocks from suppliers" — Polling interval limits how fast restocks appear.

### c6: condition units u26
- GOLDEN dataset link ku.unparseable-skipped → ku.feed-adapter: claim u23+u24+u25+u47 — A delivery the adapter cannot parse is logged and skipped, not retried, because sending the same bad data again would fail the same way.
- R1 (phase 2 blind reviewer) r6: claim u24, binding claim — A delivery it cannot parse is logged and skipped, not retried.
- R2 (blind): claim, claim u24 (medium) — condition "A delivery the adapter cannot parse is logged and skipped; it is not retried" / claim "converts each delivery into a restock and asks the stock ledger to record it" — 'each delivery' is false for unparseable ones; also an exception to the retry wrapping in u34.

### c7: condition units u36, u37, u38
- R1 (phase 2 blind reviewer) r4: claim u34, binding set — At most 5 attempts per delivery; backoff 2 s doubling capped at 60 s; after 5th failure, published to inventory.dlq for staff review.
- R2 (blind): set, claim u34 (medium) — condition "at most 5 attempts per delivery" / claim "the feed adapter wraps them in the retry helper" — Bounds of the retry policy and DLQ fallback; the wrapping claim stays true without them but they must be kept.

### c8: condition units u39, u40
- GOLDEN dataset link ku.retry-scope → ku.retry-policy: claim u36+u37+u38 — Retries apply only to supplier calls; reservations are never retried automatically and a failed reservation is returned to the caller as an error.
- R1 (phase 2 blind reviewer) r5: claim u34+u35, binding set — Retries apply only to supplier calls; reservations are never retried automatically and failures return an error to the caller.
- R2 (blind): set, claim u34 (medium) — condition "Retries apply only to supplier calls. Reservations are never retried automatically" / claim "the feed adapter wraps them in the retry helper" — Scope of the retry helper; no stated claim becomes false without it.

### c9: condition units u49
- R1 (phase 2 blind reviewer) r8: claim u18+u46, binding set — Orchestrator and adapter can change the same product at once; consistency relies on a row lock unmeasured under peak load.
- R2 (blind): ambiguous, claim u3+u27 (low) — condition "whether that holds under peak load has not been measured" / claim "At peak it handles about 3,000 reservations per hour." — Reading 1: it undermines the peak-load and stock-consistency claims (u3, u27 source of truth), so claim; reading 2: an open known-gap caveat with no single claim made false, so set.

### c10: condition units u50
- R1 (phase 2 blind reviewer) r7: claim u38+u7, binding set — They are only found when someone opens the admin UI; nothing alerts when inventory.dlq fills.
- R2 (blind): set, claim u38 (medium) — condition "Dead-lettered deliveries are only found when someone opens the admin UI; nothing alerts the team" / claim "staff review it in the admin UI" — Gap in how DLQ items are noticed; the review claim stays literally true.

## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)

### a1: condition units u48 — from R2: ambiguous, claim u43 — condition "The admin UI has no automated tests yet." / claim "Each module keeps its tests next to its code." — If the admin UI counts as a module, u43 is false for it (claim); if 'module' means only the src/ modules, it is a separate gap (set).

