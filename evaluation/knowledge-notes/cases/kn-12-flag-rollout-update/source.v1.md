# Feature flag rollout guide

This guide is for engineers who own a feature flag in the Orbit platform. It explains how a flag goes from off to fully on, and what has to be true before each step. It does not cover experiments, which follow their own process. Each section below names the condition that must hold before the flag moves on. Questions about the guide go to the platform team.

## Rollout stages

A rollout moves through three stages: internal, canary and general availability. In the internal stage the flag is on only for staff accounts, so problems reach colleagues before they reach customers. The internal stage usually lasts one working day, but the guide sets no minimum for it. Canary then exposes a small share of real traffic to the change. General availability turns the flag on for everyone, in steps of 25%, 50% and 100%. Each stage is recorded in the rollout tool, which keeps the history of who moved the flag and when.

## Canary

During canary the flag is on for 5% of requests, chosen at random per request rather than per user. It must stay at that level for at least 30 minutes, so that the metrics cover a full traffic cycle of the slowest endpoint. The owner does not raise the percentage by hand during this time, because a manual change restarts the measurement window. Short canaries are the most common reason a bad flag reaches general availability.

## Advancing from canary

A flag advances from canary to general availability only when the automated metrics check passes. The metrics check compares the error rate and p95 latency of flagged requests with the same requests over the previous 7 days. If the check fails, the flag stays in canary and the owner investigates before trying again. The rollout tool runs the check automatically at the end of the canary window.

## Kill switch

Every flag must have a kill switch that turns it off within 1 minute. The kill switch is tested in staging before the flag enters canary, and the test is recorded in the rollout tool. A flag without a tested kill switch cannot enter canary. Anyone on the owning team may use the kill switch without asking for approval. Turning a flag off is always safe; turning it back on starts the rollout again from the internal stage.

## Monitoring during general availability

While the flag ramps up, the owner watches the error dashboard and pages the on-call engineer if errors rise. The dashboard shows flagged and unflagged requests side by side, so a difference between them points at the flag rather than at the platform. The owner keeps watching until the flag has been at 100% for one hour.

## Flag cleanup

A flag that has been fully on for 30 days is removed from the code. The owner opens a cleanup ticket when the flag reaches 100%, and the ticket links to the rollout record. Flags that miss the deadline are listed in the weekly stale-flag report. Old flags make the code harder to read and slow down every later rollout.
