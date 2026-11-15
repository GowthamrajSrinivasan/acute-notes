# Packet kn-11-ambiguous-analytics-proposal

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
u0_h1 [heading] (no cites) :: Proposal: product-analytics event pipeline (draft v0.3)
subtitle [heading] (no cites) :: Product analytics event pipeline: context, design, components, rollout, and open questions.
g0 [group] (no cites) :: Context | stack | A unified data pipeline is proposed to centralize scattered product event data.
u1_n1 [text] in g0 cites=u1 :: The growth team aims to understand how customers utilize the Lumen web and mobile applications.
u1_n2 [text] in g0 cites=u2 :: Product events are currently dispersed across three different logging tools, making it difficult to answer basic funnel questions without manual CSV exports.
u1_n3 [text] in g0 cites=u3 :: A single pipeline is proposed to collect, enrich, and make product-analytics events available in the data warehouse.
u1_n4 [text] in g0 cites=u4 :: The growth team's initial analytical focus is on determining the number of new accounts completing onboarding and identifying features used by paying customers within their first month.
u1_a1 [text] in g0 (no cites) :: The current scattered logging system prevents effective analysis of customer behavior. The proposed unified pipeline aims to centralize product event data to answer key growth questions.
g1 [group] (no cites) :: Proposed design | chain | A data pipeline for analytics events, from client collection to warehousing for dashboards.
u2_n1 [shape] in g1 cites=u5 :: rectangle | 1 · Client SDKs send events
u2_n2 [text] in g1 cites=u5,u6,u7 :: Client SDKs in web and mobile apps send events to a collector service over HTTPS. Events are batched and sent every 10 seconds, or sooner if the app goes to the background. Each event includes an event name, timestamp, anonymous device ID, and account ID for signed-in users.
u2_n3 [shape] in g1 cites=u8 :: rectangle | 2 · Collector validates events
u2_n4 [text] in g1 cites=u8 :: The collector validates each event against the schema registry. Events that do not match a registered schema are rejected.
u2_n5 [shape] in g1 cites=u9 :: rectangle | 3 · Publish accepted events
u2_n6 [text] in g1 cites=u9 :: Accepted events are published to the `analytics.events` topic on the message bus.
u2_n7 [shape] in g1 cites=u10 :: rectangle | 4 · Enrichment step
u2_n8 [text] in g1 cites=u10,u11,u12 :: An enrichment step consumes the `analytics.events` topic and adds account attributes, such as plan tier and region, using the user service. If an account is not found, the event is passed on without account attributes.
u2_n9 [shape] in g1 cites=u13 :: rectangle | 5 · Write to warehouse
u2_n10 [text] in g1 cites=u13,u14 :: Enriched events are written to the warehouse in hourly batches. The analytics team will build dashboards on these events, starting with the onboarding funnel and weekly active accounts per plan tier.
u2_n11 [text] in g1 cites=u15 :: The user service is expected to remain lightly loaded, so the enrichment process should not significantly increase its traffic.
u2_a1 [text] in g1 (no cites) :: The proposed design outlines a data pipeline for analytics events, from client-side collection to warehousing. The process involves event validation, enrichment with user data, and batch loading into a warehouse for dashboarding.
u2_a2 [text] in g1 (no cites) :: The flow consists of four main stages: event collection, validation, enrichment, and warehousing. The enrichment stage depends on the user service for account attributes. A potential failure point is event rejection during validation if schemas don't match.
u2_a3 [text] in g1 (no cites) :: This design aims to provide structured, enriched analytics data for the analytics team to build dashboards, specifically for the onboarding funnel and weekly active accounts per plan tier.
u2_a4 [text] in g1 (no cites) :: A key constraint is to minimize the load on the user service during the enrichment step, as it is expected to be lightly loaded.
g2 [group] (no cites) :: Components | compare | Key components, owners, and retention policies are detailed.
u3_n1 [table] in g2 cites=u29,u30,u31,u32,u33,u34 :: Component | Owner | Retention | Collector | Platform team | none | analytics.events topic | Platform team | 7 days | Enrichment | Data team | none | Warehouse raw events | Data team | 90 days | Schema registry | TBD | indefinite
u3_a1 [text] in g2 (no cites) :: This table outlines the key components, their respective owners, and data retention policies. The 'Schema registry' component currently has an unassigned owner ('TBD'), indicating a pending decision or assignment.
g3 [group] (no cites) :: Open questions | grid | Three open questions need answers to proceed with event handling and schema management.
u4_n1 [text] in g3 cites=u39 :: Who is responsible for the schema registry?
u4_n2 [text] in g3 cites=u40 :: When the collector rejects events, are they: * Dropped? * Stored for debugging?
u4_n3 [text] in g3 cites=u41 :: Should mobile events utilize the same schemas as web events?
u4_ax1 [text] in g3 (no cites) :: All three questions address critical aspects of data governance and event processing. 'Schema registry ownership' and 'Schema consistency' focus on schema management, while 'Handling rejected events' deals with data integrity and debugging. The ownership question is foundational, impacting the other two.
g4 [group] (no cites) :: Schema registry | stack | Schema registry is essential for event types, but ownership is undecided.
u5_n1 [text] in g4 cites=u16 :: All event types must be registered in the schema registry before clients can publish them.
u5_n2 [text] in g4 cites=u17 :: Schemas are versioned. Any breaking changes necessitate creating a new version instead of modifying an existing one.
u5_n3 [text] in g4 cites=u18 :: The ownership of the schema registry is currently unresolved, with both the platform team and the data team suggesting the other should manage it.
u5_a1 [text] in g4 (no cites) :: The schema registry is crucial for event management, but its ownership remains a pending decision.
g5 [group] (no cites) :: Freshness | stack | Real-time data pipeline ensures launch dashboards are current for timely feature adoption insights.
u6_n1 [text] in g5 cites=u19 :: Product managers require real-time visibility into feature adoption, particularly during product launches.
u6_n2 [text] in g5 cites=u20 :: Launch reviews are typically conducted within two hours of a release.
u6_n3 [text] in g5 cites=u21 :: The current pipeline ensures events are delivered to the data warehouse in real-time, keeping launch dashboards up-to-date.
u6_a1 [text] in g5 (no cites) :: The real-time data pipeline directly addresses the need for immediate feature adoption insights during launches, enabling timely and accurate launch reviews.
g6 [group] (no cites) :: Retention and privacy | stack | Raw events are deleted after 30 days; sensitive data is excluded or anonymized.
u7_n1 [text] in g6 cites=u22 :: Raw events are retained for 30 days and then deleted. Only aggregated tables are kept for longer periods.
u7_n2 [text] in g6 cites=u23 :: Deleting raw events after a fixed period reduces the scope of data that needs to be searched for access requests.
u7_n3 [text] in g6 cites=u24 :: The retention period for aggregated tables is currently to be determined (TBD).
u7_n4 [text] in g6 cites=u25 :: Events must not contain email addresses or free-text input from users to protect privacy.
u7_n5 [text] in g6 cites=u26 :: IP addresses are truncated by the collector before an event is published, ensuring a level of anonymization.
g7 [group] (no cites) :: Non-goals | stack | The pipeline has specific non-goals regarding operational monitoring and billing records.
u8_n1 [text] in g7 cites=u27 :: This pipeline is not designed for operational monitoring or alerting; existing error logs and service metrics will continue to be handled by the current observability stack.
u8_n2 [text] in g7 cites=u28 :: The pipeline will not replace the billing system's existing revenue records.
g8 [group] (no cites) :: Rollout | chain | Rollout in two phases, web first, mobile pending SDK; pipeline cost unknown.
u9_n1 [shape] in g8 cites=u35 :: rectangle | 1 · Phase 1: Web App Events
u9_n2 [text] in g8 cites=u35,u37 :: **Scope** This phase covers the sign-up and checkout events for the web application. **Effort and Resources** Phase 1 is estimated to take approximately 6 weeks and requires 2 engineers.
u9_n4 [shape] in g8 cites=u36 :: rectangle | 2 · Phase 2: Mobile Events
u9_n5 [text] in g8 cites=u36 :: This phase will add mobile events once the mobile SDK is ready. A start date has not yet been determined.
u9_n6 [text] in g8 cites=u38 :: The cost of running the pipeline for these phases has not yet been estimated.
u9_a1 [text] in g8 (no cites) :: The rollout is planned in two phases, starting with web app events. The second phase, for mobile events, is dependent on the mobile SDK and has no set timeline. A key unknown is the operational cost of the pipeline.
g9 [group] (no cites) :: Next step | grid | Seek approval for phase 1 while resolving open questions concurrently.
u10_n1 [shape] in g9 cites=u42 :: rectangle | Approval for Phase 1
u10_n2 [text] in g9 cites=u42 :: Requesting approval to initiate phase 1.
u10_n3 [shape] in g9 cites=u42 :: rectangle | Settle Open Questions
u10_n4 [text] in g9 cites=u42 :: Open questions will be resolved concurrently with phase 1.
u10_a1 [text] in g9 (no cites) :: Approval for Phase 1 - proposed: requested to start phase 1. Settle Open Questions - in progress: to be settled in parallel.

## Visible arrows (from -> to : label)
u1_n2 -> u1_n3 : addresses problem
u1_n1 -> u1_n4 : informs
u1_n3 -> u1_n4 : enables answering
u2_n1 -> u2_n2
u2_n1 -> u2_n3
u2_n3 -> u2_n4
u2_n3 -> u2_n5
u2_n5 -> u2_n6
u2_n5 -> u2_n7
u2_n7 -> u2_n8
u2_n7 -> u2_n9
u2_n9 -> u2_n10
u2_n7 -> u2_n11 : constraint
u4_ax1 -> u4_n1
u4_ax1 -> u4_n2
u4_ax1 -> u4_n3
u6_n1 -> u6_n3 : enabled by
u6_n2 -> u6_n3 : requires
u6_a1 -> u6_n3
u9_n1 -> u9_n2
u9_n1 -> u9_n4
u9_n4 -> u9_n5
u9_n4 -> u9_n6
u10_n1 -> u10_n2
u10_n3 -> u10_n4
u10_n1 -> u10_n3 : in parallel
g1 -> g4 : uses
g1 -> g6 : addresses
g1 -> g2 : details
g0 -> g1 : justifies
g0 -> g5 : relates to
g3 -> g4 : about
g8 -> g9 : leads to
