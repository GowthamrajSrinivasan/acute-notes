# Adjudication packet: kn-11-ambiguous-analytics-proposal

## Source units (id [heading path] text)
u1 [Proposal: product-analytics event pipeline (draft v0.3) › Context] The growth team wants to understand how customers use the Lumen web and mobile apps.
u2 [Proposal: product-analytics event pipeline (draft v0.3) › Context] Today, product events are scattered across three logging tools, and nobody can answer a simple funnel question without exporting CSV files by hand.
u3 [Proposal: product-analytics event pipeline (draft v0.3) › Context] This proposal describes a single pipeline that collects product-analytics events, enriches them and makes them available in the warehouse.
u4 [Proposal: product-analytics event pipeline (draft v0.3) › Context] The first questions the team wants answered are how many new accounts finish onboarding, and which features paying customers use in their first month.
u5 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Client SDKs in the web and mobile apps send events to a collector service over HTTPS.
u6 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Clients batch events and send them every 10 seconds, or sooner when the app goes to the background.
u7 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Each event carries an event name, a timestamp, an anonymous device id and, for signed-in users, an account id.
u8 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The collector validates each event against the schema registry and rejects events that do not match a registered schema.
u9 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Accepted events are published to the `analytics.events` topic on the message bus.
u10 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] An enrichment step consumes the topic and adds account attributes, such as plan tier and region.
u11 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The enrichment step uses the user service.
u12 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] If an account cannot be found, the event is passed on without account attributes.
u13 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] Enriched events are then written to the warehouse in hourly batches, where the analytics team builds dashboards on them.
u14 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] The first dashboards will cover the onboarding funnel and weekly active accounts per plan tier.
u15 [Proposal: product-analytics event pipeline (draft v0.3) › Proposed design] We expect the user service to stay lightly loaded, so enrichment should avoid adding much traffic to it.
u16 [Proposal: product-analytics event pipeline (draft v0.3) › Schema registry] Every event type must be registered before clients can send it.
u17 [Proposal: product-analytics event pipeline (draft v0.3) › Schema registry] Schemas are versioned, and a breaking change requires a new version rather than an edit to the existing one.
u18 [Proposal: product-analytics event pipeline (draft v0.3) › Schema registry] Ownership of the schema registry has not been decided; the platform team and the data team have each suggested the other.
u19 [Proposal: product-analytics event pipeline (draft v0.3) › Freshness] Product managers have asked to see feature adoption as it happens, especially during launches.
u20 [Proposal: product-analytics event pipeline (draft v0.3) › Freshness] Launch reviews usually happen within 2 hours of a release.
u21 [Proposal: product-analytics event pipeline (draft v0.3) › Freshness] With this pipeline, events reach the warehouse in real time, so launch dashboards stay current.
u22 [Proposal: product-analytics event pipeline (draft v0.3) › Retention and privacy] Raw events will be kept for 30 days and then deleted; only aggregated tables are kept longer.
u23 [Proposal: product-analytics event pipeline (draft v0.3) › Retention and privacy] Deleting raw events after a fixed period also limits what an access request has to search.
u24 [Proposal: product-analytics event pipeline (draft v0.3) › Retention and privacy] How long the aggregated tables are kept is TBD.
u25 [Proposal: product-analytics event pipeline (draft v0.3) › Retention and privacy] Events must not contain email addresses or free-text input from users.
u26 [Proposal: product-analytics event pipeline (draft v0.3) › Retention and privacy] IP addresses are truncated by the collector before an event is published.
u27 [Proposal: product-analytics event pipeline (draft v0.3) › Non-goals] This pipeline is not meant for operational monitoring or alerting; error logs and service metrics stay in the existing observability stack.
u28 [Proposal: product-analytics event pipeline (draft v0.3) › Non-goals] It will not replace the billing system's records of revenue.
u29 [Proposal: product-analytics event pipeline (draft v0.3) › Components] Component | Owner | Retention
u30 [Proposal: product-analytics event pipeline (draft v0.3) › Components] Collector | Platform team | none
u31 [Proposal: product-analytics event pipeline (draft v0.3) › Components] analytics.events topic | Platform team | 7 days
u32 [Proposal: product-analytics event pipeline (draft v0.3) › Components] Enrichment | Data team | none
u33 [Proposal: product-analytics event pipeline (draft v0.3) › Components] Warehouse raw events | Data team | 90 days
u34 [Proposal: product-analytics event pipeline (draft v0.3) › Components] Schema registry | TBD | indefinite
u35 [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 1 covers the web app's sign-up and checkout events.
u36 [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 2 adds mobile events once the mobile SDK is ready; no date has been set for it.
u37 [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] Phase 1 is expected to take about 6 weeks for 2 engineers.
u38 [Proposal: product-analytics event pipeline (draft v0.3) › Rollout] The cost of running the pipeline has not been estimated yet.
u39 [Proposal: product-analytics event pipeline (draft v0.3) › Open questions] Who owns the schema registry?
u40 [Proposal: product-analytics event pipeline (draft v0.3) › Open questions] What happens to events the collector rejects: are they dropped, or kept somewhere for debugging?
u41 [Proposal: product-analytics event pipeline (draft v0.3) › Open questions] Should mobile events use the same schemas as web events?
u42 [Proposal: product-analytics event pipeline (draft v0.3) › Next step] We ask for approval to start phase 1 while the open questions are settled in parallel.

## Candidates with every reading

### c1: condition units u6
- R1 (phase 2 blind reviewer) r1: claim u6, binding claim — or sooner when the app goes to the background
- R2 (blind): set, claim u5 (low) — condition "Clients batch events and send them every 10 seconds, or sooner when the app goes to the background." / claim "Client SDKs in the web and mobile apps send events to a collector service over HTTPS." — Batching delay is a latency limit on delivery; arguably just elaboration.

### c2: condition units u7
- R1 (phase 2 blind reviewer) r2: claim u7, binding claim — account id only for signed-in users
- R2 (blind): claim, claim u7 (high) — condition "for signed-in users" / claim "Each event carries an event name, a timestamp, an anonymous device id and, for signed-in users, an account id." — Without the qualifier every event would seem to carry an account id.

### c3: condition units u11
- GOLDEN dataset link ku.enrichment-user-service → ku.enrichment: claim u10+u12 — Enrichment 'uses' the user service, but the source doesn't say how: a call per event, a cached lookup and a read from a replica are all consistent with the text.
- R2 (blind): set, claim u10 (low) — condition "The enrichment step uses the user service." / claim "An enrichment step consumes the topic and adds account attributes, such as plan tier and region." — A dependency of enrichment (matters with u15's load concern); could also be read as plain elaboration.

### c4: condition units u12
- R1 (phase 2 blind reviewer) r4: claim u10, binding claim — if the account cannot be found, the event is passed on without account attributes
- R2 (blind): claim, claim u10 (medium) — condition "If an account cannot be found, the event is passed on without account attributes." / claim "adds account attributes, such as plan tier and region" — u10 is false for events whose account is not found.

### c5: condition units u13, u21
- GOLDEN dataset link ku.freshness-conflict → ku.warehouse-load: claim u13+u14 — The design section says enriched events are written to the warehouse in hourly batches; the freshness section says events reach the warehouse in real time. The source does not resolve which is meant.
- R1 (phase 2 blind reviewer) r5: claim u21, binding claim — enriched events are written to the warehouse in hourly batches (contradicts real time)
- R2 (blind): claim, claim u21 (high) — condition "written to the warehouse in hourly batches" / claim "events reach the warehouse in real time, so launch dashboards stay current" — Hourly batches contradict 'real time'; with launch reviews within 2 hours (u20) dashboards may lag up to an hour.

### c6: condition units u15
- R1 (phase 2 blind reviewer) r6: claim u11, binding set — user service expected to stay lightly loaded, so enrichment should avoid adding much traffic
- R2 (blind): set, claim u11 (medium) — condition "enrichment should avoid adding much traffic to it" / claim "The enrichment step uses the user service." — Design constraint on enrichment; no claim becomes false.

### c7: condition units u16
- R1 (phase 2 blind reviewer) r3: claim u16, binding claim — every event type must be registered before clients can send it
- R2 (blind): set, claim u5 (medium) — condition "Every event type must be registered before clients can send it." / claim "Client SDKs in the web and mobile apps send events to a collector service" — Prerequisite; u8 already says unregistered events are rejected.

### c8: condition units u17
- R1 (phase 2 blind reviewer) r11: claim u17, binding claim — only breaking changes require a new version
- R2 (blind): set, claim u17 (low) — condition "a breaking change requires a new version rather than an edit to the existing one" / claim "Schemas are versioned" — A rule on schema change; could be read as elaboration (not_a_condition).

### c9: condition units u24
- R1 (phase 2 blind reviewer) r8: claim u22, binding set — how long aggregated tables are kept is TBD
- R2 (blind): set, claim u22 (medium) — condition "How long the aggregated tables are kept is TBD." / claim "only aggregated tables are kept longer" — Open gap on retention; u22 stays true.

### c10: condition units u33
- R1 (phase 2 blind reviewer) r7: claim u22, binding claim — the components table lists warehouse raw events retention as 90 days (contradicts 30)
- R2 (blind): claim, claim u22 (medium) — condition "Warehouse raw events | Data team | 90 days" / claim "Raw events will be kept for 30 days and then deleted" — Table contradicts the 30-day retention; one of the two is wrong, so u22 cannot be stated alone.

### c11: condition units u36
- R1 (phase 2 blind reviewer) r9: claim u36, binding claim — once the mobile SDK is ready; no date set
- R2 (blind): claim, claim u5+u36 (medium) — condition "once the mobile SDK is ready; no date has been set for it" / claim "Client SDKs in the web and mobile apps send events to a collector service over HTTPS." — Mobile sending is conditional and unscheduled, so u5's 'web and mobile' is misleading for the near term.

### c12: condition units u38
- R1 (phase 2 blind reviewer) r10: claim u42, binding set — the cost of running the pipeline has not been estimated
- R2 (blind): set, claim u42 (medium) — condition "The cost of running the pipeline has not been estimated yet." / claim "We ask for approval to start phase 1" — Unknown-cost caveat on the approval ask; could also attach to u37's effort estimate.

## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)

### a1: condition units u35 — from R2: set, claim u4 — condition "Phase 1 covers the web app's sign-up and checkout events." / claim "which features paying customers use in their first month" — Phase 1 scope may not answer the feature-usage question.

### a2: condition units u40 — from R2: set, claim u8 — condition "What happens to events the collector rejects: are they dropped, or kept somewhere for debugging?" / claim "rejects events that do not match a registered schema" — Unresolved fate of rejected events.

