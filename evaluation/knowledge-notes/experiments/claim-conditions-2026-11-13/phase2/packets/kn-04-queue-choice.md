# Packet kn-04-queue-choice

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
subtitle [heading] (no cites) :: Choosing a queue for background jobs: options, costs, criteria, benefits, and decision.
g0 [group] (no cites) :: Choosing a queue for background jobs | grid | This note updates the billing team's architecture review.
u0_n1 [text] in g0 cites=u1 :: This note was prepared for the billing team's architecture review, superseding a previous draft.
u0_ax1 [text] in g0 (no cites) :: This note presents the chosen background job queue for the billing team's architecture review, superseding a previous draft.
g1 [group] (no cites) :: Selection criteria | grid | Options must meet mandatory criteria, then are scored by weighted factors.
u1_n1 [text] in g1 cites=u18,u19,u20 :: - **Job Resilience:** No job loss during worker crashes or service deployments. - **Queue Scalability:** Must handle 1,800 jobs/minute (3x current peak) without manual intervention. **From the source:** Two **From the source:** must-haves
u1_n2 [text] in g1 cites=u21,u22,u23,u24,u25 :: - **Operational Effort:** 40% - **Monthly Cost:** 30% - **Developer Experience (including local testing):** 20% - **Cloud Provider Portability:** 10%
u1_a1 [text] in g1 (no cites) :: The selection process prioritizes two non-negotiable criteria. Remaining options are then evaluated based on a weighted score, with operational effort and cost being the most significant factors.
g2 [group] (no cites) :: Options | compare | Each option presents distinct trade-offs in operational cost, features, and risks.
u2_n1 [table] in g2 cites=u6,u7,u8,u9,u10,u11,u26,u27,u28,u29,u30,u31,u32,u33,u34 :: Attribute | Option A: managed cloud queue | Option B: self-hosted broker | Option C: database job table | Description | A queue service run by our cloud provider. We send messages to it and workers poll for them; the provider handles storage, scaling and redelivery. | A message broker cluster of three virtual machines that we install, patch and monitor ourselves. | A `jobs` table in the existing billing Postgres database. Workers claim rows with `SELECT ... FOR UPDATE SKIP LOCKED` and mark them done. | Operational Work | Almost none. | Estimated 12 hours/month (not measured). | Adds read load to the primary database due to polling. | Message Delivery Guarantee | At least once, requires idempotent job handlers (only email handler is currently idempotent). | | Jobs created within the billing database transaction are guaranteed not to be lost between commit and enqueue. | Features | Automatic dead-letter queue. | Priority queues, delayed delivery. | | Drawbacks/Risks | Ties to one provider's API. Local development emulator does not support dead-lettering. | No team experience running this broker in production. Upgrades need a maintenance window. | Guarantee only covers jobs created inside the billing database transaction; not for jobs enqueued by the reporting service. Main risk at month-end due to read load on primary database.
u2_a1 [text] in g2 (no cites) :: Option A offers the lowest operational overhead but requires significant code changes for idempotency and has vendor lock-in. Option B provides advanced queuing features but comes with an unknown operational cost due to lack of team experience. Option C offers strong transactional guarantees for billing-related jobs but risks impacting the primary database's performance, especially during month-end.
u2_fs1 [text] in g2 cites=u30 :: 12 hours
g3 [group] (no cites) :: Decision status | grid | Decision deferred until Option C's load test results are available.
u3_n1 [text] in g3 cites=u41,u42 :: The decision on which option to pursue is deferred until Option C's performance can be measured on a production-sized database.
u3_n2 [shape] in g3 (no cites) :: rectangle | Option A
u3_n3 [text] in g3 cites=u44 :: Requires every job handler to be made idempotent.
u3_n4 [shape] in g3 (no cites) :: rectangle | Option B
u3_n5 [text] in g3 cites=u45 :: Requires a named owner for broker on-call and upgrades.
u3_n6 [shape] in g3 (no cites) :: rectangle | Option C
u3_n7 [text] in g3 cites=u42,u46 :: Requires a passing load test at 1,800 jobs per minute on a production-sized database.
u3_n8 [text] in g3 cites=u47 :: Priya will present the load-test results at the next architecture review. **From the source:** Priya will bring the load-test result to the next architecture review.
u3_a1 [text] in g3 (no cites) :: Decision deferred until Option C's load test results are available. Option A — open requirement: job handlers idempotent. Option B — open requirement: named owner for broker. Option C — blocked by: pending load test results.
u3_fs1 [text] in g3 cites=u48 :: - Thanks to everyone who commented on the first draft.
g4 [group] (no cites) :: Context | stack | The billing service's in-process job execution risks data loss during deploys/crashes.
u4_n1 [text] in g4 cites=u2 :: The billing service processes approximately 40,000 background jobs daily. These jobs include rendering invoice PDFs, sending receipt emails, and retrying failed webhooks.
u4_n2 [text] in g4 cites=u3 :: Background jobs currently execute within an in-process worker pool.
u4_n3 [text] in g4 cites=u3 :: Jobs that are queued but not yet started are lost if a deploy or crash occurs.
u4_n4 [text] in g4 cites=u4 :: Last quarter, 37 invoice emails were lost due to this issue, requiring customers to request them again.
u4_n5 [text] in g4 cites=u5 :: The billing service experiences a peak load of 600 jobs per minute during the month-end billing run.
u4_a1 [text] in g4 (no cites) :: The current in-process worker pool for billing background jobs leads to data loss during deploys or crashes, as evidenced by lost invoice emails. This is a critical issue given the high volume and peak load of jobs.
g5 [group] (no cites) :: Costs | compare | Evaluate queue options based on current and projected volume for cost efficiency.
u5_n1 [table] in g5 cites=u12,u13,u14,u15 :: Option | Monthly infrastructure | Monthly team effort | Notes | Managed cloud queue | $310 | about 2 hours | Priced per million requests; grows with volume | Self-hosted broker | $540 | about 12 hours | Three VMs plus upgrades and on-call | Database job table | $0 extra | about 4 hours | Uses spare capacity on the existing primary
u5_n2 [code] in g5 (no cites) :: acute-chart | {"chartType":"bar","categories":["Managed cloud queue","Self-hosted broker","Database job table"],"series":[{"name":"Monthly infrastructure","values":[310,540,0]},{"name":"Monthly team effort (hours)","values":[2,12,4]}]}
u5_n3 [text] in g5 cites=u16,u17 :: The managed cloud queue's infrastructure cost is based on current volume and will increase with higher request volumes. The self-hosted broker's cost remains stable until a fourth machine is required.
u5_a1 [text] in g5 cites=u17 :: At three times the current volume, the managed cloud queue's infrastructure cost would rise to approximately $900, making the self-hosted broker a more cost-effective option at higher volumes, as its infrastructure cost would remain flat.
g6 [group] (no cites) :: Evidence | stack | Option C was load-tested, but A and B were not.
u6_n1 [text] in g6 cites=u35,u36,u37,u38 :: Option C was load-tested on a staging database copy using synthetic jobs. It achieved 1,200 jobs/minute with a p95 claim latency of 18 ms. At 2,000 jobs/minute, primary CPU reached 85%, and p95 latency increased to 240 ms. These results may not be directly transferable to production due to the staging environment's smaller size (one-quarter of production) and the untested 1,800 jobs/minute scenario.
u6_n2 [text] in g6 cites=u39,u40 :: Options A and B have not been load-tested. While Option A's provider documents throughput exceeding our peak requirements, this figure is from the provider and not independently verified.

## Visible arrows (from -> to : label)
u0_ax1 -> u0_n1
u2_n1 -> u2_fs1
u3_n2 -> u3_n3
u3_n4 -> u3_n5
u3_n6 -> u3_n7
u3_n1 -> u3_n6 : deferred until
u3_n7 -> u3_n8 : results presented by
u4_n2 -> u4_n3 : implies
u4_n3 -> u4_n4 : demonstrated by
u4_n1 -> u4_a1
u4_n2 -> u4_a1
u4_n3 -> u4_a1
u4_n4 -> u4_a1
u4_n5 -> u4_a1
g0 -> g4 : context for
g2 -> g1 : evaluated by
g2 -> g5 : cost details
g2 -> g6 : tested by
g3 -> g2 : defers decision on
g3 -> g6 : requires more
