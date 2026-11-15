# Adjudication packet: kn-04-queue-choice

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

## Candidates with every reading

### c1: condition units u3
- R1 (phase 2 blind reviewer) r12: claim u3, binding claim — Only jobs queued but not yet started are lost.
- R2 (blind): not_a_condition, claim - (medium) — condition "Today they run in an in-process worker pool, so a deploy or a crash loses any job that was queued but not yet started." / claim "" — Context and motivation (the current problem), not a limit on any claim.

### c2: condition units u14, u15
- GOLDEN dataset link ku.cost-growth → ku.cost-table: claim u11+u12+u13 — The managed queue's figure assumes current volume; at three times today's volume it would be roughly $900 a month, while the broker's cost stays flat until the cluster needs a fourth machine.
- R2 (blind): set, claim u15 (low) — condition "Uses spare capacity on the existing primary" / claim "Database job table | $0 extra" — The u15 note qualifies '$0 extra' as relying on spare primary capacity (tied to u34's month-end risk); the u14 row is plain cost data.

### c3: condition units u16, u17
- R1 (phase 2 blind reviewer) r2: claim u13, binding claim — Figure assumes current volume; at 3x volume it would be roughly $900/month.
- R1 (phase 2 blind reviewer) r3: claim u17, binding claim — Only until the cluster needs a fourth machine.
- R2 (blind): claim, claim u13 (high) — condition "The managed queue's figure assumes current volume. At three times today's volume it would be roughly $900 a month" / claim "Managed cloud queue | $310" — The $310 figure is misleading at the 3x volume the must-have criteria plan for.

### c4: condition units u18
- R1 (phase 2 blind reviewer) r1: claim u21+u22+u23+u24+u25, binding claim — Two must-haves gate the scoring: an option failing either is out regardless of its score.
- R2 (blind): ambiguous, claim u21 (medium) — condition "an option that fails either is out regardless of its score" / claim "The remaining criteria are weighted for scoring" — Reading 1 (claim): weighted scores/rankings mislead without the gate that disqualifies regardless of score; reading 2 (set): the weighting statement stays true and the gate is a separate decision rule.

### c5: condition units u25
- GOLDEN dataset link ku.a-at-least-once → ku.a-benefits: claim u24 — The managed queue delivers each message at least once, so every job handler must be made idempotent before switching; today only the email handler is.
- R2 (blind): not_a_condition, claim - (high) — condition "Portability away from our cloud provider: 10%" / claim "" — A criterion weight, not a limit on a claim.

### c6: condition units u27, u44
- R1 (phase 2 blind reviewer) r4: claim u26, binding set — At-least-once delivery: every job handler must be made idempotent before switching; today only the email handler is.
- R2 (blind): claim, claim u26 (medium) — condition "every job handler must be made idempotent before we switch; today only the email handler is" / claim "Option A needs almost no operational work" — At-least-once delivery makes Option A unsafe until handlers are idempotent; 'almost no work' read alone misleads about adopting it.

### c7: condition units u28
- GOLDEN dataset link ku.b-effort-estimate → ku.cost-table: claim u11+u12+u13 — No one on the team has run this broker in production, so its 12 hours a month is an estimate, not a measurement.
- R1 (phase 2 blind reviewer) r5: claim u26, binding set — Local development's emulator does not support dead-lettering.
- R2 (blind): set, claim u26 (medium) — condition "It also ties us to one provider's API, and local development needs an emulator that does not support dead-lettering." / claim "failed messages move to a dead-letter queue automatically" — Lock-in and a local-dev gap in dead-lettering; the production claim stays true.

### c8: condition units u30
- R1 (phase 2 blind reviewer) r6: claim u14, binding claim — No one on the team has run this broker in production, so 12 hours is an estimate, not a measurement.
- R2 (blind): set, claim u14 (medium) — condition "the 12 hours a month is an estimate, not a measurement" / claim "Self-hosted broker | $540 | about 12 hours" — Epistemic caveat on the effort figure, which is already hedged with 'about'.

### c9: condition units u31
- GOLDEN dataset link ku.c-scope → ku.c-transactional: claim u30 — The transactional guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it.
- R2 (blind): set, claim u8 (low) — condition "Upgrades need a maintenance window." / claim "A message broker cluster of three virtual machines that we install, patch and monitor ourselves." — An operational cost of Option B; could be judged too minor.

### c10: condition units u33
- R1 (phase 2 blind reviewer) r7: claim u32, binding claim — Only for jobs created inside the billing database transaction; reporting-service jobs (own database) don't get it.
- R2 (blind): claim, claim u32 (high) — condition "That guarantee only covers jobs created inside the billing database transaction; jobs enqueued by the reporting service, which has its own database, would not get it." / claim "a job can never be lost between the commit and the enqueue" — 'Never be lost' is false for reporting-service jobs.

### c11: condition units u34
- R1 (phase 2 blind reviewer) r8: claim u15, binding set — Polling adds read load to the primary database, the main risk at month-end.
- R2 (blind): set, claim u15 (medium) — condition "Polling also adds read load to the primary database, which is the main risk at month-end." / claim "Database job table | $0 extra | about 4 hours | Uses spare capacity on the existing primary" — Main risk of Option C; the cost row stays true.

### c12: condition units u36
- GOLDEN dataset link ku.load-test-limits → ku.load-test: claim u33+u34+u35 — 1,800 jobs per minute was not tested, and the staging copy is about a quarter of production size, so the results may not carry over.
- R2 (blind): not_a_condition, claim - (medium) — condition "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms." / claim "" — A measured result (a claim), which u38 limits, not itself a condition.

### c13: condition units u38
- R1 (phase 2 blind reviewer) r9: claim u36+u37, binding claim — 1,800 jobs/min not tested and staging is about a quarter of production size, so results may not carry over.
- R2 (blind): claim, claim u36 (high) — condition "We did not test 1,800 jobs per minute, and the staging copy is about a quarter of production size, so these results may not carry over." / claim "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms." — Without this, the load-test result reads as evidence Option C meets production needs.

### c14: condition units u39, u40
- R1 (phase 2 blind reviewer) r10: claim u40, binding claim — That is the provider's figure, not ours; Options A and B were not load-tested.
- R2 (blind): set, claim u40 (medium) — condition "We have not load-tested Options A or B. ... but that is the provider's figure, not ours." / claim "The provider documents throughput far above our peak for Option A" — Evidence gap for A and B; the documented-throughput claim stays true as attributed.

### c15: condition units u42, u46
- R1 (phase 2 blind reviewer) r11: claim u41+u42, binding claim — Deferred until Option C is measured at 1,800 jobs per minute on a production-sized database.
- R2 (blind): ambiguous, claim u36+u41 (medium) — condition "The decision is deferred until Option C has been measured at 1,800 jobs per minute on a production-sized database." / claim "It sustained 1,200 jobs per minute with a p95 claim latency of 18 ms." — Reading 1 (claim): any presentation of Option C as meeting the throughput must-have is misleading until the test passes; reading 2 (set): the decision-status claim u41 ('does not recommend an option') stays true and this is the gating next step.

## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)

### a1: condition units u45 — from R2: set, claim u29 — condition "Option B: a named owner for broker on-call and upgrades." / claim "Option B gives us priority queues and delayed delivery" — Open prerequisite for Option B, parallel to c6/c15; the benefit claim stays true.

