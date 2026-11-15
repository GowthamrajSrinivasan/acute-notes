# Packet kn-10-inventory-architecture-frames

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
u0_h1 [heading] (no cites) :: Shelfwise inventory service: a tour of the codebase
subtitle [heading] (no cites) :: Shelfwise inventory service: architecture, components, and interactions.
g0 [group] (no cites) :: Overview | grid | Shelfwise manages stock and reservations, structured into six functional code groups.
u1_n1 [text] in g0 cites=u1 :: Shelfwise is a service responsible for tracking warehouse stock and managing reservations for incoming orders.
u1_n2 [text] in g0 cites=u2 :: It is a deployable TypeScript service with a small admin frontend.
u1_n3 [text] in g0 cites=u3 :: At its peak, Shelfwise processes approximately 3,000 reservations per hour.
u1_n4 [text] in g0 cites=u4 :: This tour organizes the code by responsibility, detailing module ownership, key files, and inter-group dependencies.
u1_n5 [text] in g0 cites=u5 :: The code is divided into the following groups: presentation, API and orchestration, domain services, supplier integration, persistence and external systems, and observability and error handling.
u1_a1 [text] in g0 (no cites) :: This section introduces the Shelfwise service, its technical characteristics, performance, and the organizational structure of its codebase for a guided tour.
g1 [group] (no cites) :: Dependency rules | grid | Three rules ensure a readable, decoupled, and testable system structure.
u2_n1 [text] in g1 cites=u45 :: Domain modules (ledger, pricing rules) must not depend on the HTTP layer, ensuring they are usable in non-web contexts like scripts or tests.
u2_n2 [text] in g1 cites=u46 :: Only the ledger module is permitted to write stock data to Postgres. Other modules, such as the orchestrator and adapter, must interact with Postgres for stock updates through the ledger.
u2_n3 [text] in g1 cites=u47 :: The supplier feed adapter is the only component allowed to make calls to the supplier API.
u2_a1 [text] in g1 (no cites) :: These rules enforce a clear separation of concerns and maintain a structured architecture. They prevent tight coupling.
u2_fs1 [text] in g1 cites=u44 :: - Three rules keep the structure readable.
g2 [group] (no cites) :: API and orchestration | chain | API handlers delegate to a reservation orchestrator that manages atomic stock reservations with a timeout.
u3_n1 [shape] in g2 cites=u9 :: rectangle | 1 · HTTP Handlers
u3_n2 [text] in g2 cites=u9,u10 :: HTTP handlers in `src/api/routes.ts` are the sole entry point for requests. They validate the request body, attach a correlation ID, and delegate tasks without implementing business rules.
u3_n3 [shape] in g2 cites=u11,u12 :: rectangle | 2 · Reservation Orchestrator
u3_n4 [text] in g2 cites=u11,u12 :: The reservation orchestrator in `src/orders/reserve.ts` manages the entire reservation process, from initiation to completion.
u3_n5 [shape] in g2 cites=u13 :: rectangle | 3 · Request Stock Reservation
u3_n6 [shape] in g2 cites=u13 :: rectangle | 4 · Request Pricing Rules
u3_n7 [shape] in g2 cites=u13 :: rectangle | 5 · Publish StockReserved Event
u3_n8 [text] in g2 cites=u13 :: The orchestrator requests stock reservation from the stock ledger and pricing information from pricing rules. Upon successful completion of both, it publishes a `StockReserved` event to the message broker.
u3_n9 [text] in g2 cites=u14 :: If the stock ledger cannot reserve the full quantity, the orchestrator rejects the entire order; partial reservations are not allowed.
u3_n10 [text] in g2 cites=u15 :: Reservations not confirmed within 15 minutes are automatically released by the ledger, making the stock available again.
u3_a1 [text] in g2 (no cites) :: The API acts as a thin layer, delegating all business logic to the reservation orchestrator. The orchestrator ensures atomic reservations, either reserving the full quantity or rejecting the entire order. A time-based release mechanism prevents indefinite stock holding for unconfirmed reservations.
g3 [group] (no cites) :: Domain services | grid | Two independent domain services manage stock and pricing with strict dependencies.
u4_n1 [text] in g3 cites=u16,u17,u18 :: The `src/ledger/ledger.ts` module: * Manages stock levels. * Records all changes (reserve, release, restock) as append-only ledger entries. * Writes entries to Postgres. * Is the *only* module permitted to write to stock tables; other modules must request changes through it.
u4_n2 [text] in g3 cites=u19,u20 :: The `src/pricing/rules.ts` module: * Calculates order prices based on supplier price lists and active discounts. * Reads price lists from Redis, where they are cached for 300 seconds. * Does not modify stock levels.
u4_n3 [text] in g3 cites=u21,u22 :: Domain modules: * Do not import anything from `src/api/` or `src/orders/`. * Follow an inward dependency rule: API calls orchestrator, orchestrator calls domain modules. * Depend solely on persistence and platform helpers.
u4_a1 [text] in g3 (no cites) :: The two domain services, stock ledger and pricing rules, are independent and have clearly defined responsibilities. They enforce strict boundaries on data access and dependencies.
g4 [group] (no cites) :: Supplier integration | chain | Supplier feed adapter fetches, transforms, and records deliveries, logging unparsable data.
u5_n1 [shape] in g4 cites=u23 :: rectangle | 1 · Supplier Feed Adapter
u5_n2 [text] in g4 cites=u23 :: The supplier feed adapter is located at `src/suppliers/feedAdapter.ts` and is responsible for ingesting restock information from suppliers.
u5_n3 [shape] in g4 cites=u24 :: rectangle | 2 · Call Supplier API
u5_n4 [text] in g4 cites=u24 :: The adapter calls the supplier API every 10 minutes to fetch new delivery data.
u5_n5 [shape] in g4 cites=u24 :: rectangle | 3 · Convert Delivery to Restock
u5_n6 [text] in g4 cites=u24 :: Each delivery received from the supplier API is converted into a restock record.
u5_n7 [shape] in g4 cites=u24 :: rectangle | 4 · Record in Stock Ledger
u5_n8 [text] in g4 cites=u24 :: The converted restock is then sent to the stock ledger for recording.
u5_n9 [text] in g4 cites=u25 :: The adapter encapsulates knowledge of the supplier's data format, ensuring that any changes on the supplier's side are isolated to this single file.
u5_n10 [shape] in g4 cites=u26 :: rectangle | 5 · Handle Unparsable Delivery
u5_n11 [text] in g4 cites=u26 :: If the adapter cannot parse a delivery, it logs the error and skips the delivery. There are no retries for unparsable data, as repeated attempts would yield the same failure.
u5_a1 [text] in g4 (no cites) :: The supplier integration process is a scheduled task that fetches, transforms, and records supplier deliveries. It handles parsing errors by logging and skipping, without retries.
u5_a2 [text] in g4 (no cites) :: The process explicitly logs and skips unparsable deliveries, preventing infinite retries of bad data. This ensures system stability but means unparsable deliveries are not processed.
g5 [group] (no cites) :: Persistence and external systems | grid | Key systems for persistence and external interactions are defined.
u6_n1 [text] in g5 cites=u27 :: - Stores ledger entries and current stock levels. - Is the definitive source for stock information.
u6_n2 [text] in g5 cites=u28 :: - Caches price lists. - Data can be rebuilt from the supplier feed if lost.
u6_n3 [text] in g5 cites=u29 :: - Carries `StockReserved` events to other services (e.g., fulfilment). - Hosts the dead-letter queue.
u6_n4 [text] in g5 cites=u30 :: - Located in `db/migrations/`. - Executed on every deployment.
u6_n5 [text] in g5 cites=u31 :: - Operated by suppliers, outside Shelfwise control. - The only external system Shelfwise calls.
g6 [group] (no cites) :: Observability and error handling | grid | Structured logging and a specific retry policy handle API failures.
u7_n1 [text] in g6 cites=u32 :: - All modules use `src/platform/log.ts` for logging. - Each event is logged as a single JSON line. - Every log entry includes a correlation ID, added by HTTP handlers.
u7_n2 [text] in g6 cites=u33 :: - HTTP handlers log each request. - The retry helper logs every failed attempt.
u7_n3 [text] in g6 cites=u34,u35,u36,u37,u38 :: - The feed adapter uses `src/platform/retry.ts` for supplier API calls due to potential failures. - The retry policy includes: - A maximum of 5 attempts per delivery. - Exponential backoff starting at 2 seconds, doubling with each failure, and capped at 60 seconds. - After the 5th failed attempt, the delivery is published to the `inventory.dlq` dead-letter queue on the message broker for staff review in the admin UI.
u7_n4 [text] in g6 cites=u39,u40 :: - Retries are only for supplier calls. - Reservations are never automatically retried; failed reservations return an error to the caller.
g7 [group] (no cites) :: Client and presentation | grid | The admin web UI is for warehouse staff, uses a REST API, and has no direct DB access.
u8_n1 [text] in g7 cites=u6 :: The admin web UI is located in the `web/admin/` directory.
u8_n2 [text] in g7 cites=u7 :: Warehouse staff utilize the admin web UI for: * Looking up stock levels * Placing manual holds * Reviewing failed supplier imports
u8_n3 [text] in g7 cites=u8 :: The admin web UI does not contain its own stock logic. All screens interact with the service's REST API, and the UI never directly communicates with the database.
u8_ax1 [text] in g7 (no cites) :: The Admin Web UI is located in the `web/admin/` directory.
u8_ax2 [text] in g7 (no cites) :: Warehouse staff use the Admin Web UI to check stock levels, place manual holds, and review failed supplier imports.
u8_ax3 [text] in g7 (no cites) :: The Admin Web UI operates by calling the service's REST API for all screen interactions and does not directly access the database. It contains no stock logic.
g8 [group] (no cites) :: Where to start reading | grid | New contributors start with `reserve.ts`, then `ledger.ts`; tests are co-located.
u9_n1 [text] in g8 cites=u41 :: New contributors should begin by reading `src/orders/reserve.ts`.
u9_n2 [text] in g8 cites=u41 :: This file is approximately 120 lines long and demonstrates a complete reservation process, explicitly naming all its dependent modules.
u9_n3 [text] in g8 cites=u42 :: After `src/orders/reserve.ts`, the next recommended file is `src/ledger/ledger.ts`.
u9_n4 [text] in g8 cites=u42 :: This module details the stock counting mechanism.
u9_n5 [text] in g8 cites=u43 :: Each module's tests are located alongside its corresponding code.
u9_a1 [text] in g8 (no cites) :: New contributors should start with `src/orders/reserve.ts` for an overview, then proceed to `src/ledger/ledger.ts` for stock management details. Tests are co-located with their modules.
g9 [group] (no cites) :: Known gaps | grid | Critical gaps exist in admin UI testing, stock consistency, and dead-letter alerts.
u10_n1 [text] in g9 cites=u48 :: The admin UI currently lacks automated tests.
u10_n2 [text] in g9 cites=u49 :: The reservation orchestrator and feed adapter can simultaneously modify product stock. The ledger uses a database row lock for consistency, but its effectiveness under peak load is unmeasured.
u10_n3 [text] in g9 cites=u50 :: Dead-lettered deliveries are only discovered when the admin UI is manually checked. There is no alert mechanism for when the `inventory.dlq` begins to accumulate messages.
u10_a1 [text] in g9 (no cites) :: Key gaps include a lack of automated tests for the admin UI, unmeasured stock consistency under peak load, and the absence of alerts for dead-lettered deliveries.

## Visible arrows (from -> to : label)
u2_n1 -> u2_a1
u2_n2 -> u2_a1
u2_n3 -> u2_a1
u3_n1 -> u3_n2
u3_n1 -> u3_n3 : POST /reservations
u3_n3 -> u3_n4
u3_n3 -> u3_n5
u3_n3 -> u3_n6
u3_n5 -> u3_n7 : if successful
u3_n6 -> u3_n7 : if successful
u3_n7 -> u3_n8
u3_n5 -> u3_n9 : if ledger cannot reserve
u3_n3 -> u3_n10 : timeout condition
u3_a1 -> u3_n1
u3_a1 -> u3_n3
u5_n1 -> u5_n3
u5_n3 -> u5_n5
u5_n5 -> u5_n7
u5_n5 -> u5_n10 : if unparsable
u5_n1 -> u5_n9 : responsibility
u5_a1 -> u5_n1
u5_a2 -> u5_n10
u8_ax1 -> u8_n1
u8_ax2 -> u8_n2
u8_ax3 -> u8_n3
u9_n1 -> u9_n2
u9_n1 -> u9_n3
u9_n3 -> u9_n4
g0 -> g2 : groups depend on each other
g0 -> g3 : groups depend on each other
g0 -> g4 : groups depend on each other
g0 -> g5 : groups depend on each other
g0 -> g6 : groups depend on each other
g2 -> g3 : orchestrator calls domain modules
g2 -> g5 : publishes StockReserved event to message broker
g3 -> g5 : writes entries to Postgres
g3 -> g5 : reads price lists from Redis
g4 -> g3 : asks the stock ledger to record it
g4 -> g5 : calls the supplier API
g6 -> g5 : published to the dead-letter queue
