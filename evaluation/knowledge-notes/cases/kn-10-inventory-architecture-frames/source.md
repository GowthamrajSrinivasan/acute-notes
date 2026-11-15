# Shelfwise inventory service: a tour of the codebase

## Overview

Shelfwise is the service that keeps track of how much stock each warehouse holds and reserves stock for incoming orders. It is one deployable TypeScript service with a small admin front end. At peak it handles about 3,000 reservations per hour. This tour walks through the code by responsibility: what each group of modules owns, which files to open first, and how the groups depend on each other. The groups are presentation, API and orchestration, domain services, supplier integration, persistence and external systems, and observability and error handling.

## Client and presentation

The admin web UI lives in `web/admin/`. Warehouse staff use it to look up stock levels, place manual holds and review failed supplier imports. It holds no stock logic of its own: every screen calls the service's REST API, and the UI never talks to the database directly.

## API and orchestration

The HTTP handlers in `src/api/routes.ts` are the only entry point for requests. They validate the request body, attach a correlation ID and pass the work on; they contain no business rules. A `POST /reservations` request goes to the reservation orchestrator in `src/orders/reserve.ts`.

The reservation orchestrator coordinates a reservation from start to finish. It asks the stock ledger to reserve the requested quantity, asks the pricing rules for the order's price, and, once both succeed, publishes a StockReserved event to the message broker. If the ledger cannot reserve the full quantity, the orchestrator rejects the whole order; it never makes a partial reservation. A reservation that is not confirmed within 15 minutes is released by the ledger and the stock becomes available again.

## Domain services

The stock ledger in `src/ledger/ledger.ts` owns stock levels. It records every change as an append-only ledger entry (reserve, release, restock) and writes those entries to Postgres. The ledger is the only module allowed to write to the stock tables; other modules ask it to make changes.

The pricing rules in `src/pricing/rules.ts` work out the price of an order from the supplier price lists and any active discounts. They read price lists from Redis, where they are cached for 300 seconds, and they never change stock.

Neither domain module imports anything from `src/api/` or `src/orders/`. Dependencies point inwards: the API layer calls the orchestrator, the orchestrator calls the domain modules, and the domain modules depend only on persistence and the platform helpers.

## Supplier integration

The supplier feed adapter in `src/suppliers/feedAdapter.ts` brings in restocks from suppliers. Every 10 minutes it calls the supplier API for new deliveries, converts each delivery into a restock and asks the stock ledger to record it. The adapter is the only module that knows the supplier's data format, so a change on the supplier's side stays inside this one file. A delivery the adapter cannot parse is logged and skipped; it is not retried, because sending the same bad data again would fail the same way.

## Persistence and external systems

Postgres holds the ledger entries and the current stock level per warehouse and product; it is the source of truth for stock. Redis holds cached price lists and nothing that cannot be rebuilt from the supplier feed. The message broker carries StockReserved events to other services, such as fulfilment, and also hosts the dead-letter queue described below. Postgres schema changes live in `db/migrations/` and run on every deploy. The supplier API is run by the suppliers, outside our control, and is the only external system Shelfwise calls.

## Observability and error handling

Every module logs through the structured logger in `src/platform/log.ts`, which writes one JSON line per event and always includes the correlation ID that the HTTP handlers attached. The handlers log each request, and the retry helper logs each failed attempt.

Calls to the supplier API can fail, so the feed adapter wraps them in the retry helper in `src/platform/retry.ts`. The retry policy is:

- at most 5 attempts per delivery;
- exponential backoff that starts at 2 seconds, doubles after each failure and is capped at 60 seconds;
- after the 5th failed attempt, the delivery is published to the dead-letter queue `inventory.dlq` on the message broker, and staff review it in the admin UI.

Retries apply only to supplier calls. Reservations are never retried automatically: a failed reservation is returned to the caller as an error.

## Where to start reading

New contributors usually start with `src/orders/reserve.ts`, because it shows a whole reservation in about 120 lines and names every module it depends on. After that, `src/ledger/ledger.ts` explains how stock is counted. Each module keeps its tests next to its code.

## Dependency rules

Three rules keep the structure readable. First, nothing in the domain modules may depend on the HTTP layer; the ledger and the pricing rules must stay usable from a script or a test without a web server. Second, only the ledger writes stock to Postgres; the orchestrator and the adapter go through it. Third, only the supplier feed adapter calls the supplier API.

## Known gaps

The admin UI has no automated tests yet. The reservation orchestrator and the feed adapter can both change the same product's stock at once, and the ledger currently relies on a database row lock to keep them consistent; whether that holds under peak load has not been measured. Dead-lettered deliveries are only found when someone opens the admin UI; nothing alerts the team when `inventory.dlq` starts to fill up.
