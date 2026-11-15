# Phase 4 adjudication packet: kn-11-ambiguous-analytics-proposal

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

Note set(s): ../phase2/packets/kn-11-ambiguous-analytics-proposal.md (distil)

## Matched pairs (X and Y found the same clause)

- X: x1 [u6] set (general, high) clause "or sooner when the app goes to the background" → claim u6 "Clients batch events and send them every 10 seconds"
  Y: y1 [u6] set (general, medium) clause "or sooner when the app goes to the background" → claim u6 "Clients batch events and send them every 10 seconds"
  context: phase3 c1 [u6] ambiguous/unresolved claim u5+u6 outcomes {"distil":{"u2_n2":"carried","u2_n1":"linked"}} carriers {"distil":["u2_n2"]}

- X: x2 [u7] claim (general, high) clause "for signed-in users" → claim u7 "Each event carries an event name, a timestamp, an anonymous device id and, for signed-in users, an account id."
  Y: y2 [u7] claim (general, high) clause "for signed-in users" → claim u7 "Each event carries an event name, a timestamp, an anonymous device id and, for signed-in users, an account id."
  context: phase3 c2 [u7] claim/agreed claim u7 outcomes {"distil":{"u2_n2":"carried"}} carriers {"distil":["u2_n2"]}

- X: x3 [u11] not_a_condition (general, medium) clause "The enrichment step uses the user service." → claim - ""
  Y: y3 [u11] not_a_condition (general, medium) clause "The enrichment step uses the user service." → claim - ""
  context: phase3 c3 [u11] ambiguous/unresolved claim u10 outcomes {"distil":{"u2_n8":"carried","u2_a2":"carried"}} carriers {"distil":["u2_n8","u2_a2"]}

- X: x4 [u12] claim (general, high) clause "If an account cannot be found" → claim u10 "adds account attributes, such as plan tier and region"
  Y: y4 [u12] claim (general, high) clause "If an account cannot be found" → claim u12 "the event is passed on without account attributes"
  context: phase3 c4 [u12] claim/agreed claim u10 outcomes {"distil":{"u2_n8":"carried"}} carriers {"distil":["u2_n8"]}

- X: x5 [u13] ambiguous (R4, low) clause "in hourly batches" → claim u21+u13 "events reach the warehouse in real time, so launch dashboards stay current" | A: claim, linked to u21: hourly batching falsifies the real-time freshness claim; a reader would rely on current launch dashboards within the 2-hour review window | B: set (or mechanism), linked to u13: a description of how enriched events are loaded; the conflict with u21 is a contradiction in the source, not a condition limiting a claim | Q: Is the hourly batch interval a limit on the source's freshness claim (u21), or merely part of the design description that happens to contradict it?
  Y: y6 [u13] claim (general, high) clause "in hourly batches" → claim u13 "Enriched events are then written to the warehouse"
  context: phase3 c5 [u13,u21] claim/agreed claim u21 outcomes {"distil":{"u6_n3":"separated","u6_a1":"separated","g5":"separated"}} carriers {"distil":["u2_n10"]}

- X: x6 [u15] ambiguous (R1, low) clause "so enrichment should avoid adding much traffic to it" → claim u11 "The enrichment step uses the user service." | A: claim: a binding constraint on how enrichment may use the user service (e.g. no per-event lookups); building enrichment without it would do the wrong thing | B: set: a soft expectation ('We expect', 'should') that colours the design but does not change the takeaway that enrichment uses the user service | Q: Is 'stay lightly loaded' a requirement the design must meet, or a forecast of the user service's load?
  Y: y8 [u15] claim (R1, medium) clause "enrichment should avoid adding much traffic to it" → claim u11 "The enrichment step uses the user service."
  context: phase3 c6 [u15] set/agreed claim u11 outcomes {"distil":{"u2_n8":"separated","u2_a2":"separated"}} carriers {"distil":["u2_n11","u2_a4","arrow:u2_n7->u2_n11"]}

- X: x7 [u16] claim (R1, high) clause "before clients can send it" → claim u16 "Every event type must be registered"
  Y: y9 [u16] claim (R1, medium) clause "before clients can send it" → claim u5 "Client SDKs in the web and mobile apps send events to a collector service over HTTPS."
  context: phase3 c7 [u16] ambiguous/unresolved claim u5+u16 outcomes {"distil":{"u5_n1":"carried","u2_n2":"separated","u2_n1":"separated"}} carriers {"distil":["u5_n1","u2_n4"]}

- X: x8 [u17] claim (R1, medium) clause "a breaking change requires a new version rather than an edit to the existing one" → claim u17 "Schemas are versioned"
  Y: y10 [u17] claim (R1, high) clause "a breaking change requires a new version rather than an edit to the existing one" → claim u17 "Schemas are versioned"
  context: phase3 c8 [u17] ambiguous/unresolved claim u17 outcomes {"distil":{"u5_n2":"carried"}} carriers {"distil":["u5_n2"]}

- X: x9 [u21] not_a_condition (general, medium) clause "With this pipeline, events reach the warehouse in real time, so launch dashboards stay current." → claim - ""
  Y: y11 [u21] not_a_condition (general, medium) clause "in real time" → claim - ""
  context: phase3 c5 [u13,u21] claim/agreed claim u21 outcomes {"distil":{"u6_n3":"separated","u6_a1":"separated","g5":"separated"}} carriers {"distil":["u2_n10"]}

- X: x10 [u24] set (general, medium) clause "How long the aggregated tables are kept is TBD." → claim u22 "only aggregated tables are kept longer"
  Y: y12 [u24] set (R2, medium) clause "How long the aggregated tables are kept is TBD." → claim u22 "only aggregated tables are kept longer"
  context: phase3 c9 [u24] set/agreed claim u22 outcomes {"distil":{"u7_n1":"separated"}} carriers {"distil":["u7_n3"]}

- X: x11 [u33] ambiguous (R4, low) clause "90 days" → claim u22 "Raw events will be kept for 30 days and then deleted" | A: claim: the table's 90-day retention for warehouse raw events limits or contradicts the 30-day statement; a reader relying on 30 days would mis-handle deletion and access requests | B: not_a_condition: a conflicting figure in a component table, not a clause that limits a claim; the source is inconsistent rather than conditional | Q: Do u22 and u33 describe the same store (a contradiction) or different stores (a scope on where 30 days applies)?
  Y: y13 [u33] ambiguous (general, low) clause "90 days" → claim u22 "Raw events will be kept for 30 days and then deleted" | A: claim: the components table sets the warehouse raw-event retention at 90 days, which contradicts and limits the 30-day claim; a reader acting on 30 days would handle privacy/access requests wrongly | B: not_a_condition: a table row stating a component attribute; the 30 vs 90 mismatch is an inconsistency in the draft, not a clause limiting a claim | Q: Is the 90-day table entry the intended retention for warehouse raw events (overriding u22), or a drafting inconsistency to be resolved?
  context: phase3 c10 [u33] claim/agreed claim u22 outcomes {"distil":{"u7_n1":"separated","g6":"separated"}} carriers {"distil":["u3_n1"]}

- X: x12 [u35] ambiguous (R4, low) clause "the web app's sign-up and checkout events" → claim u14 "The first dashboards will cover the onboarding funnel and weekly active accounts per plan tier." | A: claim, linked to u14: phase 1 collects only web sign-up and checkout events, so the first dashboards (and u4's first questions) cannot be fully answered from phase 1; a reader would expect them | B: set, linked to the rollout request (u42): a scope on phase 1 that does not change the proposal's takeaway | Q: Are the first dashboards promised as a phase 1 deliverable?
  Y: y14 [u35] claim (R4, medium) clause "the web app's sign-up and checkout events" → claim u14 "The first dashboards will cover the onboarding funnel and weekly active accounts per plan tier."
  context: phase3 a1 [u35] ambiguous/unresolved claim u4 outcomes {"distil":{"u1_n4":"separated"}} carriers {"distil":["u9_n2","g8"]}

- X: x13 [u36] claim (general, medium) clause "once the mobile SDK is ready" → claim u5 "Client SDKs in the web and mobile apps send events to a collector service over HTTPS."
  Y: y15 [u36] claim (general, high) clause "once the mobile SDK is ready" → claim u36 "Phase 2 adds mobile events"
  context: phase3 c11 [u36] claim/agreed claim u5+u36 outcomes {"distil":{"u9_n5":"carried","u9_n4":"frame","u9_a1":"carried","u2_n2":"separated"}} carriers {"distil":["u9_n5","u9_a1","g8"]}

- X: x14 [u36] set (R2, medium) clause "no date has been set for it" → claim u36 "Phase 2 adds mobile events"
  Y: y16 [u36] set (R2, medium) clause "no date has been set for it" → claim u36 "Phase 2 adds mobile events"
  context: phase3 c11 [u36] claim/agreed claim u5+u36 outcomes {"distil":{"u9_n5":"carried","u9_n4":"frame","u9_a1":"carried","u2_n2":"separated"}} carriers {"distil":["u9_n5","u9_a1","g8"]}

- X: x15 [u38] set (R2, low) clause "The cost of running the pipeline has not been estimated yet." → claim u42 "We ask for approval to start phase 1"
  Y: y17 [u38] ambiguous (R3, low) clause "The cost of running the pipeline has not been estimated yet." → claim u42 "We ask for approval to start phase 1 while the open questions are settled in parallel." | A: claim: the approval request is a decision, and without the missing cost estimate an approver would believe the cost has been weighed | B: set: an open item the notes must list, but the proposal's design and phase 1 plan stand without it | Q: Does the source treat the unestimated running cost as bearing on the approval decision, or as a secondary open item?
  context: phase3 c12 [u38] set/agreed claim u42 outcomes {"distil":{"u10_n2":"separated","u10_n1":"separated","u10_a1":"separated","g9":"separated"}} carriers {"distil":["u9_n6","u9_a1","g8"]}

- X: x16 [u40] set (general, medium) clause "What happens to events the collector rejects: are they dropped, or kept somewhere for debugging?" → claim u8 "rejects events that do not match a registered schema"
  Y: y18 [u40] set (R2, medium) clause "What happens to events the collector rejects: are they dropped, or kept somewhere for debugging?" → claim u8 "rejects events that do not match a registered schema"
  context: phase3 a2 [u40] set/adjudicated claim u8 outcomes {"distil":{"u2_n4":"separated","u2_a2":"separated"}} carriers {"distil":["u4_n2"]}

## Found by X only

- x17 [u37] set (R2, medium) clause "is expected to take about" → claim u37 "6 weeks for 2 engineers"

## Found by Y only

- y5 [u12] claim (R4, medium) clause "If an account cannot be found, the event is passed on without account attributes." → claim u10 "An enrichment step consumes the topic and adds account attributes, such as plan tier and region."
  context: phase3 c4 [u12] claim/agreed claim u10 outcomes {"distil":{"u2_n8":"carried"}} carriers {"distil":["u2_n8"]}

- y7 [u15] ambiguous (general, low) clause "We expect the user service to stay lightly loaded" → claim u11 "The enrichment step uses the user service." | A: claim: it is a load constraint on the user service, so an enrichment design that queries it per event would break a stated requirement | B: not_a_condition / set: it is a forecast of the service's load (context), not a limit on what enrichment may do | Q: Does 'expect ... to stay lightly loaded' state a requirement the design must preserve, or a prediction about current traffic?
  context: phase3 c6 [u15] set/agreed claim u11 outcomes {"distil":{"u2_n8":"separated","u2_a2":"separated"}} carriers {"distil":["u2_n11","u2_a4","arrow:u2_n7->u2_n11"]}

