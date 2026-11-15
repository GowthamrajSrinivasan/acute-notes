# Clause annotation packet: kn-04-queue-choice
## Source units (id [heading path] text)
u1 [Choosing a queue for background jobs] This note was written for the billing team's architecture review and replaces the earlier draft shared in chat.
u2 [Choosing a queue for background jobs › Context] The billing service runs about 40,000 background jobs a day: rendering invoice PDFs, sending receipt emails and retrying failed webhooks.
u3 [Choosing a queue for background jobs › Context] Today they run in an in-process worker pool, so a deploy or a crash loses any job that was queued but not yet started.
u4 [Choosing a queue for background jobs › Context] Last quarter that lost 37 invoice emails that customers had to request again.
u5 [Choosing a queue for background jobs › Context] Peak load is 600 jobs per minute, during the month-end billing run.
u6 [Choosing a queue for background jobs › Options] **Option A: managed cloud queue.** A queue service run by our cloud provider.
u7 [Choosing a queue for background jobs › Options] We send messages to it and workers poll for them; the provider handles storage, scaling and redelivery.
u8 [Choosing a queue for background jobs › Options] **Option B: self-hosted broker.** A message broker cluster of three virtual machines that we install, patch and monitor ourselves.
u9 [Choosing a queue for background jobs › Options] **Option C: database job table.** A `jobs` table in the existing billing Postgres database.
u10 [Choosing a queue for background jobs › Options] Workers claim rows with `SELECT ...
u11 [Choosing a queue for background jobs › Options] FOR UPDATE SKIP LOCKED` and mark them done.
u12 [Choosing a queue for background jobs › Costs] Option | Monthly infrastructure | Monthly team effort | Notes
u13 [Choosing a queue for background jobs › Costs] Managed cloud queue | $310 | about 2 hours | Priced per million requests; grows with volume
u14 [Choosing a queue for background jobs › Costs] Self-hosted broker | $540 | about 12 hours | Three VMs plus upgrades and on-call
u15 [Choosing a queue for background jobs › Costs] Database job table | $0 extra | about 4 hours | Uses spare capacity on the existing primary
u16 [Choosing a queue for background jobs › Costs] The managed queue's figure assumes current volume.
u17 [Choosing a queue for background jobs › Costs] At three times today's volume it would be roughly $900 a month, while the broker's cost would stay flat until the cluster needs a fourth machine.
u18 [Choosing a queue for background jobs › Selection criteria] Two criteria are must-haves; an option that fails either is out regardless of its score:
u19 [Choosing a queue for background jobs › Selection criteria] No job is lost when a worker crashes or the service is deployed.
u20 [Choosing a queue for background jobs › Selection criteria] The queue absorbs 1,800 jobs per minute (three times today's peak) without manual intervention.
u21 [Choosing a queue for background jobs › Selection criteria] The remaining criteria are weighted for scoring:
u22 [Choosing a queue for background jobs › Selection criteria] Operational effort: 40%
u23 [Choosing a queue for background jobs › Selection criteria] Monthly cost: 30%
u24 [Choosing a queue for background jobs › Selection criteria] Developer experience, including local testing: 20%
u25 [Choosing a queue for background jobs › Selection criteria] Portability away from our cloud provider: 10%
u26 [Choosing a queue for background jobs › Benefits and trade-offs] Option A needs almost no operational work, and failed messages move to a dead-letter queue automatically.
u27 [Choosing a queue for background jobs › Benefits and trade-offs] The catch is that the service delivers each message at least once, so every job handler must be made idempotent before we switch; today only the email handler is.
u28 [Choosing a queue for background jobs › Benefits and trade-offs] It also ties us to one provider's API, and local development needs an emulator that does not support dead-lettering.
u29 [Choosing a queue for background jobs › Benefits and trade-offs] Option B gives us priority queues and delayed delivery, which would let month-end invoices jump ahead of webhook retries.
u30 [Choosing a queue for background jobs › Benefits and trade-offs] No one on the team has run this broker in production, so the 12 hours a month is an estimate, not a measurement.
u31 [Choosing a queue for background jobs › Benefits and trade-offs] Upgrades need a maintenance window.
u32 [Choosing a queue for background jobs › Benefits and trade-offs] Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue.
u33 [Choosing a queue for background jobs › Benefits and trade-offs] That guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it.
u34 [Choosing a queue for background jobs › Benefits and trade-offs] Polling also adds read load to the primary database, which is the main risk at month-end.
u35 [Choosing a queue for background jobs › Evidence] We load-tested Option C on a staging copy of the database with synthetic jobs.
u36 [Choosing a queue for background jobs › Evidence] It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms.
u37 [Choosing a queue for background jobs › Evidence] At 2,000 jobs per minute, primary CPU reached 85% and p95 latency rose to 240 ms.
u38 [Choosing a queue for background jobs › Evidence] We did not test 1,800 jobs per minute, and the staging copy is about a quarter of production size, so these results may not carry over.
u39 [Choosing a queue for background jobs › Evidence] We have not load-tested Options A or B.
u40 [Choosing a queue for background jobs › Evidence] The provider documents throughput far above our peak for Option A, but that is the provider's figure, not ours.
u41 [Choosing a queue for background jobs › Decision status] This note does not recommend an option.
u42 [Choosing a queue for background jobs › Decision status] The decision is deferred until Option C has been measured at 1,800 jobs per minute on a production-sized database.
u43 [Choosing a queue for background jobs › Decision status] Until then, each option carries an open requirement:
u44 [Choosing a queue for background jobs › Decision status] Option A: every job handler made idempotent.
u45 [Choosing a queue for background jobs › Decision status] Option B: a named owner for broker on-call and upgrades.
u46 [Choosing a queue for background jobs › Decision status] Option C: a passing load test at 1,800 jobs per minute.
u47 [Choosing a queue for background jobs › Decision status] Priya will bring the load-test result to the next architecture review.
u48 [Choosing a queue for background jobs › Decision status] Thanks to everyone who commented on the first draft.

## Units to examine (21)
Earlier work flagged these units as possibly condition-bearing. Examine EACH: list every limiting clause in it as its own record (EVAL-SPEC-v3 §1), or one not_a_condition record if it limits nothing. You may also add records for clauses in other units (mark them "additional": true).

u3, u14, u15, u16, u17, u18, u25, u27, u28, u30, u31, u33, u34, u36, u38, u39, u40, u42, u44, u45, u46
