# Running a shared connection pool

## Why pool connections

Opening a new database connection costs the Ledger service about 30 ms, because each one needs a TLS handshake and an authentication round trip. A pool keeps a set of connections open and lends them to requests, so most requests skip that cost entirely. The pool also caps how many connections the service can hold, which protects the database from a traffic spike.

## Operating the pool

### Sizing the pool

Each Ledger instance runs a pool of at most 20 connections. The database accepts 400 connections in total, and 40 of those are reserved for migrations and administrators. That leaves room for 18 instances at full size, so the autoscaler is capped at 18 instances. Raising the pool size only helps while requests are waiting for a connection; once the database CPU is saturated, more connections make every query slower. A pool sized for peak traffic also holds idle connections at night, which costs memory on the database but nothing else.

### Timeouts

A request waits at most 2 seconds to borrow a connection before it fails with `POOL_EXHAUSTED`. The wait limit is deliberately shorter than the 5-second request deadline, so the caller still has time to return a clear error. Each query also has a statement timeout of 3 seconds, set with `SET statement_timeout = '3s'` when the connection is opened. The statement timeout does not apply to migrations, which run on their own reserved connections without a limit. A long transaction holds its connection for its whole duration, so the team keeps transactions under 500 ms.

### Health checks and failover

Before lending a connection that has been idle for more than 60 seconds, the pool runs `SELECT 1` to check that it still works. A connection that fails the check is closed and replaced, and the request gets a fresh one. During a database failover, every open connection breaks at once, so the pool is drained and refilled from the new primary. Refilling is limited to 5 new connections per second per instance, so that 18 instances reconnecting together don't overload the new primary. Until the pool is refilled, requests may see `POOL_EXHAUSTED` errors for up to about 4 seconds.

### Connection leaks

A connection that stays borrowed for more than 10 seconds is logged as a possible leak, together with the stack trace of the code that borrowed it. The pool does not take a leaked connection back by force, because the code holding it may still be using it. Most leaks the team has found came from error paths that returned early without releasing the connection. Leak warnings are reviewed every week, and a leak that comes back gets a ticket for the team that owns the code.

### Watching the pool

The pool exports three gauges: connections in use, idle connections, and requests waiting to borrow. An alert pages the on-call engineer when requests have been waiting for more than 30 seconds in a row. A sustained queue usually means slow queries rather than a pool that is too small, so the runbook starts with the slowest statements, not with the pool size. The idle gauge drops to zero during a failover and recovers as the pool refills, which makes it a quick way to confirm that a failover has finished.

## Takeaway

A pool makes connections cheap and bounded, but its size, its timeouts and its failover behaviour have to be set together with the database's own limits.
