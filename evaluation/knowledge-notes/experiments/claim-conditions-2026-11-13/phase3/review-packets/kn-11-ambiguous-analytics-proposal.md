# Second review packet: kn-11-ambiguous-analytics-proposal

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

## Candidate conditions (the span to judge; its claim link and binding are YOURS to decide)
c1: units u6 :: Clients batch events and send them every 10 seconds, or sooner when the app goes to the background.
c2: units u7 :: Each event carries an event name, a timestamp, an anonymous device id and, for signed-in users, an account id.
c3: units u11 :: The enrichment step uses the user service.
c4: units u12 :: If an account cannot be found, the event is passed on without account attributes.
c5: units u13, u21 :: Enriched events are then written to the warehouse in hourly batches, where the analytics team builds dashboards on them. With this pipeline, events reach the warehouse in real time, so launch dashboards stay current.
c6: units u15 :: We expect the user service to stay lightly loaded, so enrichment should avoid adding much traffic to it.
c7: units u16 :: Every event type must be registered before clients can send it.
c8: units u17 :: Schemas are versioned, and a breaking change requires a new version rather than an edit to the existing one.
c9: units u24 :: How long the aggregated tables are kept is TBD.
c10: units u33 :: Warehouse raw events | Data team | 90 days
c11: units u36 :: Phase 2 adds mobile events once the mobile SDK is ready; no date has been set for it.
c12: units u38 :: The cost of running the pipeline has not been estimated yet.
