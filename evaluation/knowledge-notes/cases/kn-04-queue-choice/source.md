# Choosing a queue for background jobs

This note was written for the billing team's architecture review and replaces the earlier draft shared in chat.

## Context

The billing service runs about 40,000 background jobs a day: rendering invoice PDFs, sending receipt emails and retrying failed webhooks. Today they run in an in-process worker pool, so a deploy or a crash loses any job that was queued but not yet started. Last quarter that lost 37 invoice emails that customers had to request again. Peak load is 600 jobs per minute, during the month-end billing run.

## Options

**Option A: managed cloud queue.** A queue service run by our cloud provider. We send messages to it and workers poll for them; the provider handles storage, scaling and redelivery.

**Option B: self-hosted broker.** A message broker cluster of three virtual machines that we install, patch and monitor ourselves.

**Option C: database job table.** A `jobs` table in the existing billing Postgres database. Workers claim rows with `SELECT ... FOR UPDATE SKIP LOCKED` and mark them done.

## Costs

| Option | Monthly infrastructure | Monthly team effort | Notes |
|---|---|---|---|
| Managed cloud queue | $310 | about 2 hours | Priced per million requests; grows with volume |
| Self-hosted broker | $540 | about 12 hours | Three VMs plus upgrades and on-call |
| Database job table | $0 extra | about 4 hours | Uses spare capacity on the existing primary |

The managed queue's figure assumes current volume. At three times today's volume it would be roughly $900 a month, while the broker's cost would stay flat until the cluster needs a fourth machine.

## Selection criteria

Two criteria are must-haves; an option that fails either is out regardless of its score:

1. No job is lost when a worker crashes or the service is deployed.
2. The queue absorbs 1,800 jobs per minute (three times today's peak) without manual intervention.

The remaining criteria are weighted for scoring:

- Operational effort: 40%
- Monthly cost: 30%
- Developer experience, including local testing: 20%
- Portability away from our cloud provider: 10%

## Benefits and trade-offs

Option A needs almost no operational work, and failed messages move to a dead-letter queue automatically. The catch is that the service delivers each message at least once, so every job handler must be made idempotent before we switch; today only the email handler is. It also ties us to one provider's API, and local development needs an emulator that does not support dead-lettering.

Option B gives us priority queues and delayed delivery, which would let month-end invoices jump ahead of webhook retries. No one on the team has run this broker in production, so the 12 hours a month is an estimate, not a measurement. Upgrades need a maintenance window.

Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue. That guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it. Polling also adds read load to the primary database, which is the main risk at month-end.

## Evidence

We load-tested Option C on a staging copy of the database with synthetic jobs. It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms. At 2,000 jobs per minute, primary CPU reached 85% and p95 latency rose to 240 ms. We did not test 1,800 jobs per minute, and the staging copy is about a quarter of production size, so these results may not carry over.

We have not load-tested Options A or B. The provider documents throughput far above our peak for Option A, but that is the provider's figure, not ours.

## Decision status

This note does not recommend an option. The decision is deferred until Option C has been measured at 1,800 jobs per minute on a production-sized database. Until then, each option carries an open requirement:

- Option A: every job handler made idempotent.
- Option B: a named owner for broker on-call and upgrades.
- Option C: a passing load test at 1,800 jobs per minute.

Priya will bring the load-test result to the next architecture review. Thanks to everyone who commented on the first draft.
