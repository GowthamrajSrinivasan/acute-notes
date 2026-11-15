# Phase 4 adjudication packet: kn-04-queue-choice

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

Note set(s): ../phase2/packets/kn-04-queue-choice.md (distil)

## Matched pairs (X and Y found the same clause)

- X: x1 [u3] set (R5, medium) clause "queued but not yet started" → claim u3 "a deploy or a crash loses any job"
  Y: y1 [u3] set (general, low) clause "queued but not yet started" → claim u3 "a deploy or a crash loses any job"
  context: phase3 c1 [u3] ambiguous/unresolved claim u3 outcomes {"distil":{"u4_n3":"carried","u4_a1":"linked"}} carriers {"distil":["u4_n3"]}

- X: x3 [u15] claim (R3, medium) clause "Uses spare capacity on the existing primary" → claim u15 "Database job table | $0 extra"
  Y: y3 [u15] claim (R3, medium) clause "Uses spare capacity on the existing primary" → claim u15 "Database job table | $0 extra"
  context: phase3 c2 [u14,u15] set/adjudicated claim u15 outcomes {"distil":{"u5_n1":"carried","u5_n2":"separated"}} carriers {"distil":["u5_n1"]}

- X: x4 [u16] claim (R2, high) clause "The managed queue's figure assumes current volume." → claim u13 "Managed cloud queue | $310"
  Y: y4 [u16] claim (R2, high) clause "assumes current volume" → claim u13 "Managed cloud queue | $310"
  context: phase3 c3 [u16,u17] claim/agreed claim u13+u17 outcomes {"distil":{"u5_n1":"carried","u5_n2":"separated","u5_n3":"carried","u5_a1":"separated"}} carriers {"distil":["u5_n1","u5_n3","u5_a1"]}

- X: x5 [u17] claim (R3, medium) clause "At three times today's volume it would be roughly $900 a month" → claim u13 "Managed cloud queue | $310"
  Y: y5 [u17] claim (R3, medium) clause "At three times today's volume it would be roughly $900 a month" → claim u13 "Managed cloud queue | $310"
  context: phase3 c3 [u16,u17] claim/agreed claim u13+u17 outcomes {"distil":{"u5_n1":"carried","u5_n2":"separated","u5_n3":"carried","u5_a1":"separated"}} carriers {"distil":["u5_n1","u5_n3","u5_a1"]}

- X: x6 [u17] set (general, medium) clause "until the cluster needs a fourth machine" → claim u17 "the broker's cost would stay flat"
  Y: y6 [u17] claim (general, medium) clause "until the cluster needs a fourth machine" → claim u17 "the broker's cost would stay flat"
  context: phase3 c3 [u16,u17] claim/agreed claim u13+u17 outcomes {"distil":{"u5_n1":"carried","u5_n2":"separated","u5_n3":"carried","u5_a1":"separated"}} carriers {"distil":["u5_n1","u5_n3","u5_a1"]}

- X: x7 [u18] claim (general, medium) clause "an option that fails either is out regardless of its score" → claim u21 "The remaining criteria are weighted for scoring:"
  Y: y7 [u18] claim (R1, high) clause "an option that fails either is out regardless of its score" → claim u21 "The remaining criteria are weighted for scoring"
  context: phase3 c4 [u18] ambiguous/unresolved claim u21+u22+u23+u24+u25 outcomes {"distil":{"u1_n2":"frame","u1_a1":"carried"}} carriers {"distil":["g1","u1_a1","u1_n1"]}

- X: x8 [u25] not_a_condition (general, medium) clause "Portability away from our cloud provider: 10%" → claim - ""
  Y: y8 [u25] not_a_condition (general, medium) clause "Portability away from our cloud provider: 10%" → claim - ""
  context: phase3 c5 [u25] not_a_condition/adjudicated claim -

- X: x10 [u27] claim (R3, high) clause "every job handler must be made idempotent before we switch" → claim u26 "Option A needs almost no operational work"
  Y: y9 [u27] claim (R3, high) clause "every job handler must be made idempotent before we switch" → claim u26 "Option A needs almost no operational work"
  context: phase3 c6 [u27,u44] ambiguous/unresolved claim u26 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried"}} carriers {"distil":["u2_n1","u2_a1","u3_n3","u3_a1"]}

- X: x11 [u27] set (general, medium) clause "today only the email handler is" → claim u26 "Option A needs almost no operational work"
  Y: y10 [u27] claim (general, medium) clause "today only the email handler is" → claim u26 "Option A needs almost no operational work"
  context: phase3 c6 [u27,u44] ambiguous/unresolved claim u26 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried"}} carriers {"distil":["u2_n1","u2_a1","u3_n3","u3_a1"]}

- X: x12 [u28] set (R3, medium) clause "It also ties us to one provider's API" → claim u26 "Option A needs almost no operational work"
  Y: y11 [u28] set (R3, medium) clause "It also ties us to one provider's API" → claim u26 "Option A needs almost no operational work"
  context: phase3 c7 [u28] set/agreed claim u26 outcomes {"distil":{"u2_n1":"carried"}} carriers {"distil":["u2_n1"]}

- X: x13 [u28] claim (R4, medium) clause "local development needs an emulator that does not support dead-lettering" → claim u26 "failed messages move to a dead-letter queue automatically"
  Y: y12 [u28] claim (general, medium) clause "local development needs an emulator that does not support dead-lettering" → claim u26 "failed messages move to a dead-letter queue automatically"
  context: phase3 c7 [u28] set/agreed claim u26 outcomes {"distil":{"u2_n1":"carried"}} carriers {"distil":["u2_n1"]}

- X: x14 [u30] claim (R2, high) clause "the 12 hours a month is an estimate, not a measurement" → claim u14 "Self-hosted broker | $540 | about 12 hours"
  Y: y13 [u30] claim (R2, high) clause "the 12 hours a month is an estimate, not a measurement" → claim u14 "Self-hosted broker | $540 | about 12 hours"
  context: phase3 c8 [u30] ambiguous/unresolved claim u14 outcomes {"distil":{"u5_n1":"separated","u5_n2":"separated","u2_fs1":"linked","u2_n1":"carried"}} carriers {"distil":["u2_n1","u2_a1"]}

- X: x15 [u31] set (R3, medium) clause "Upgrades need a maintenance window." → claim u29 "Option B gives us priority queues and delayed delivery"
  Y: y14 [u31] set (R3, medium) clause "Upgrades need a maintenance window." → claim u29 "Option B gives us priority queues and delayed delivery"
  context: phase3 c9 [u31] ambiguous/unresolved claim u8 outcomes {"distil":{"u2_n1":"carried"}} carriers {"distil":["u2_n1"]}

- X: x16 [u33] claim (general, high) clause "That guarantee only covers jobs created inside the billing database transaction" → claim u32 "a job can never be lost between the commit and the enqueue"
  Y: y15 [u33] claim (general, high) clause "only covers jobs created inside the billing database transaction" → claim u32 "a job can never be lost between the commit and the enqueue"
  context: phase3 c10 [u33] claim/agreed claim u32 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried"}} carriers {"distil":["u2_n1"]}

- X: x17 [u33] claim (general, medium) clause "jobs enqueued by the reporting service, which has its own database, would not get it" → claim u32 "a job can never be lost between the commit and the enqueue"
  Y: y16 [u33] claim (general, medium) clause "jobs enqueued by the reporting service, which has its own database, would not get it" → claim u32 "a job can never be lost between the commit and the enqueue"
  context: phase3 c10 [u33] claim/agreed claim u32 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried"}} carriers {"distil":["u2_n1"]}

- X: x18 [u34] claim (R3, medium) clause "Polling also adds read load to the primary database, which is the main risk at month-end." → claim u32 "Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue."
  Y: y17 [u34] claim (R3, medium) clause "Polling also adds read load to the primary database, which is the main risk at month-end" → claim u15 "Database job table | $0 extra"
  context: phase3 c11 [u34] set/agreed claim u15 outcomes {"distil":{"u5_n1":"separated","u5_n2":"separated"}} carriers {"distil":["u2_n1","u2_a1"]}

- X: x19 [u36] not_a_condition (general, medium) clause "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms." → claim - ""
  Y: y18 [u36] not_a_condition (general, medium) clause "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms." → claim - ""
  context: phase3 c12 [u36] not_a_condition/adjudicated claim -

- X: x20 [u38] claim (R2, high) clause "We did not test 1,800 jobs per minute" → claim u36 "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms."
  Y: y19 [u38] claim (R2, high) clause "We did not test 1,800 jobs per minute" → claim u36 "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms."
  context: phase3 c13 [u38] claim/agreed claim u36+u37 outcomes {"distil":{"u6_n1":"carried"}} carriers {"distil":["u6_n1"]}

- X: x21 [u38] claim (R2, high) clause "the staging copy is about a quarter of production size, so these results may not carry over" → claim u36 "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms."
  Y: y20 [u38] claim (R2, high) clause "the staging copy is about a quarter of production size, so these results may not carry over" → claim u36 "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms."
  context: phase3 c13 [u38] claim/agreed claim u36+u37 outcomes {"distil":{"u6_n1":"carried"}} carriers {"distil":["u6_n1"]}

- X: x22 [u39] ambiguous (R2, low) clause "We have not load-tested Options A or B." → claim u40 "The provider documents throughput far above our peak for Option A" | A: claim: the caveat warns about the reliability of throughput evidence for A and B, which bears on the 1,800 jobs/minute must-have; a reader assuming they were tested would decide differently | B: set: no source sentence asserts that A or B meets the throughput criterion, and u40 carries its own hedge, so the takeaway is unchanged | Q: Does any source claim treat A's or B's throughput as established for the must-have decision?
  Y: y21 [u39] claim (R2, medium) clause "We have not load-tested Options A or B." → claim u7 "the provider handles storage, scaling and redelivery"
  context: phase3 c14 [u39,u40] ambiguous/unresolved claim u40 outcomes {"distil":{"u6_n2":"carried"}} carriers {"distil":["u6_n2","g6"]}

- X: x23 [u40] claim (R2, high) clause "but that is the provider's figure, not ours" → claim u40 "The provider documents throughput far above our peak for Option A"
  Y: y22 [u40] claim (R2, high) clause "but that is the provider's figure, not ours" → claim u40 "The provider documents throughput far above our peak for Option A"
  context: phase3 c14 [u39,u40] ambiguous/unresolved claim u40 outcomes {"distil":{"u6_n2":"carried"}} carriers {"distil":["u6_n2","g6"]}

- X: x24 [u42] claim (general, high) clause "until Option C has been measured at 1,800 jobs per minute on a production-sized database" → claim u42 "The decision is deferred"
  Y: y23 [u42] claim (general, high) clause "until Option C has been measured at 1,800 jobs per minute on a production-sized database" → claim u42 "The decision is deferred"
  context: phase3 c15 [u42,u46] ambiguous/unresolved claim u41+u42 outcomes {"distil":{"u3_n1":"linked","u3_a1":"linked"}} carriers {"distil":["u3_n7","u6_n1"]}

- X: x25 [u44] claim (R4, medium) clause "every job handler made idempotent" → claim u26 "Option A needs almost no operational work"
  Y: y24 [u44] claim (R1, medium) clause "every job handler made idempotent" → claim u26 "Option A needs almost no operational work"
  context: phase3 c6 [u27,u44] ambiguous/unresolved claim u26 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried"}} carriers {"distil":["u2_n1","u2_a1","u3_n3","u3_a1"]}

- X: x26 [u45] claim (R4, medium) clause "a named owner for broker on-call and upgrades" → claim u8 "A message broker cluster of three virtual machines that we install, patch and monitor ourselves."
  Y: y25 [u45] claim (R1, medium) clause "a named owner for broker on-call and upgrades" → claim u29 "Option B gives us priority queues and delayed delivery"
  context: phase3 a1 [u45] ambiguous/unresolved claim u29 outcomes {"distil":{"u2_n1":"linked","u2_a1":"linked"}} carriers {"distil":["u3_n5","u3_a1"]}

- X: x27 [u46] claim (R4, medium) clause "a passing load test at 1,800 jobs per minute" → claim u32 "Option C writes a job in the same transaction as the billing change that causes it, so a job can never be lost between the commit and the enqueue."
  Y: y26 [u46] claim (R1, medium) clause "a passing load test at 1,800 jobs per minute" → claim u32 "Option C writes a job in the same transaction as the billing change that causes it"
  context: phase3 c15 [u42,u46] ambiguous/unresolved claim u41+u42 outcomes {"distil":{"u3_n1":"linked","u3_a1":"linked"}} carriers {"distil":["u3_n7","u6_n1"]}

## Found by X only

- x2 [u14] not_a_condition (general, medium) clause "Three VMs plus upgrades and on-call" → claim - ""
  context: phase3 c2 [u14,u15] set/adjudicated claim u15 outcomes {"distil":{"u5_n1":"carried","u5_n2":"separated"}} carriers {"distil":["u5_n1"]}

- x9 [u27] claim (R3, medium) clause "the service delivers each message at least once" → claim u26 "Option A needs almost no operational work"
  context: phase3 c6 [u27,u44] ambiguous/unresolved claim u26 outcomes {"distil":{"u2_n1":"carried","u2_a1":"carried"}} carriers {"distil":["u2_n1","u2_a1","u3_n3","u3_a1"]}

## Found by Y only

- y2 [u14] set (R2, low) clause "about 12 hours" → claim u14 "Self-hosted broker | $540 | about 12 hours"
  context: phase3 c2 [u14,u15] set/adjudicated claim u15 outcomes {"distil":{"u5_n1":"carried","u5_n2":"separated"}} carriers {"distil":["u5_n1"]}

