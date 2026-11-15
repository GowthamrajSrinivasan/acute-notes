# Read replicas for the orders database

## What they change

Routing reports to a read replica reduces load on the primary because long scans no longer compete with checkout writes, but replica reads can be up to 5 seconds behind. Adding a second replica increases read capacity only when the replication link has spare bandwidth.

## Rules for callers

A caller must read from the primary when it has just written the same order, unless it passes the write's commit token. Stale reads are acceptable for dashboards, although they are never acceptable for refunds. Lag above 30 seconds causes the router to stop sending traffic to that replica.

## Costs

Each replica costs about the same as the primary, so two replicas roughly triple the database bill. Failover to a replica is faster than restoring from backup, but it can lose the last few transactions if the primary fails during heavy writes.
