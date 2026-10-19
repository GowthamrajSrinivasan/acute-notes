# Proposal: product-analytics event pipeline (draft v0.3)

## Context

The growth team wants to understand how customers use the Lumen web and mobile apps. Today, product events are scattered across three logging tools, and nobody can answer a simple funnel question without exporting CSV files by hand. This proposal describes a single pipeline that collects product-analytics events, enriches them and makes them available in the warehouse. The first questions the team wants answered are how many new accounts finish onboarding, and which features paying customers use in their first month.

## Proposed design

Client SDKs in the web and mobile apps send events to a collector service over HTTPS. Clients batch events and send them every 10 seconds, or sooner when the app goes to the background. Each event carries an event name, a timestamp, an anonymous device id and, for signed-in users, an account id. The collector validates each event against the schema registry and rejects events that do not match a registered schema. Accepted events are published to the `analytics.events` topic on the message bus.

An enrichment step consumes the topic and adds account attributes, such as plan tier and region. The enrichment step uses the user service. If an account cannot be found, the event is passed on without account attributes. Enriched events are then written to the warehouse in hourly batches, where the analytics team builds dashboards on them. The first dashboards will cover the onboarding funnel and weekly active accounts per plan tier.

We expect the user service to stay lightly loaded, so enrichment should avoid adding much traffic to it.

## Schema registry

Every event type must be registered before clients can send it. Schemas are versioned, and a breaking change requires a new version rather than an edit to the existing one. Ownership of the schema registry has not been decided; the platform team and the data team have each suggested the other.

## Freshness

Product managers have asked to see feature adoption as it happens, especially during launches. Launch reviews usually happen within 2 hours of a release. With this pipeline, events reach the warehouse in real time, so launch dashboards stay current.

## Retention and privacy

Raw events will be kept for 30 days and then deleted; only aggregated tables are kept longer. Deleting raw events after a fixed period also limits what an access request has to search. How long the aggregated tables are kept is TBD. Events must not contain email addresses or free-text input from users. IP addresses are truncated by the collector before an event is published.

## Non-goals

This pipeline is not meant for operational monitoring or alerting; error logs and service metrics stay in the existing observability stack. It will not replace the billing system's records of revenue.

## Components

| Component | Owner | Retention |
|---|---|---|
| Collector | Platform team | none |
| `analytics.events` topic | Platform team | 7 days |
| Enrichment | Data team | none |
| Warehouse raw events | Data team | 90 days |
| Schema registry | TBD | indefinite |

## Rollout

Phase 1 covers the web app's sign-up and checkout events. Phase 2 adds mobile events once the mobile SDK is ready; no date has been set for it. Phase 1 is expected to take about 6 weeks for 2 engineers. The cost of running the pipeline has not been estimated yet.

## Open questions

- Who owns the schema registry?
- What happens to events the collector rejects: are they dropped, or kept somewhere for debugging?
- Should mobile events use the same schemas as web events?

## Next step

We ask for approval to start phase 1 while the open questions are settled in parallel.
