# Second review packet: kn-10-inventory-architecture-frames

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

## Candidate conditions (the span to judge; its claim link and binding are YOURS to decide)
c1: units u13 :: It asks the stock ledger to reserve the requested quantity, asks the pricing rules for the order's price, and, once both succeed, publishes a StockReserved event to the message broker.
c2: units u14 :: If the ledger cannot reserve the full quantity, the orchestrator rejects the whole order; it never makes a partial reservation.
c3: units u15 :: A reservation that is not confirmed within 15 minutes is released by the ledger and the stock becomes available again.
c4: units u20 :: They read price lists from Redis, where they are cached for 300 seconds, and they never change stock.
c5: units u24 :: Every 10 minutes it calls the supplier API for new deliveries, converts each delivery into a restock and asks the stock ledger to record it.
c6: units u26 :: A delivery the adapter cannot parse is logged and skipped; it is not retried, because sending the same bad data again would fail the same way.
c7: units u36, u37, u38 :: at most 5 attempts per delivery; exponential backoff that starts at 2 seconds, doubles after each failure and is capped at 60 seconds; after the 5th failed attempt, the delivery is published to the dead-letter queue `inventory.dlq` on the message broker, and staff review it in the admin UI.
c8: units u39, u40 :: Retries apply only to supplier calls. Reservations are never retried automatically: a failed reservation is returned to the caller as an error.
c9: units u49 :: The reservation orchestrator and the feed adapter can both change the same product's stock at once, and the ledger currently relies on a database row lock to keep them consistent; whether that holds under peak load has not been measured.
c10: units u50 :: Dead-lettered deliveries are only found when someone opens the admin UI; nothing alerts the team when `inventory.dlq` starts to fill up.
