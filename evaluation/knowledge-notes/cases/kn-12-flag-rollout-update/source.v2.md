# Feature flag rollout guide

This guide is for engineers who own a feature flag in the Orbit platform. It explains how a flag goes from off to fully on, and what has to be true before each step. It does not cover experiments, which follow their own process. Each section below names the condition that must hold before the flag moves on. Questions about the guide go to the platform team.

## Rollout stages

A rollout moves through three stages: internal, canary and general availability. In the internal stage the flag is on only for staff accounts, so problems reach colleagues before they reach customers. The internal stage usually lasts one working day, but the guide sets no minimum for it. Canary then exposes a small share of real traffic to the change. General availability turns the flag on for everyone, in steps of 25%, 50% and 100%. Each stage is recorded in the rollout tool, which keeps the history of who moved the flag and when.

## Canary

In the canary stage, 5% of requests see the flag, picked at random for each request instead of for each user. The flag has to remain at 5% for no less than 60 minutes, so the metrics span a complete traffic cycle of the slowest endpoint. Owners leave the percentage alone during this window, since any manual change restarts the measurement. Most bad flags that reach general availability got there through a canary that was too short.

## Advancing from canary

A flag advances from canary to general availability only when the automated metrics check passes and the on-call engineer approves the move in the rollout tool. The metrics check compares the error rate and p95 latency of flagged requests with the same requests over the previous 7 days. If the check fails, the flag stays in canary and the owner investigates before trying again. The on-call engineer may decline the move while an incident is open, even when the check passes. The rollout tool runs the check automatically at the end of the canary window.

## Kill switch

Every flag must have a kill switch that turns it off within 1 minute. The kill switch is tested in staging before the flag enters canary, and the test is recorded in the rollout tool. A flag without a tested kill switch cannot enter canary. Anyone on the owning team may use the kill switch without asking for approval. Turning a flag off is always safe; turning it back on starts the rollout again from the internal stage.

## Monitoring during general availability

While the flag ramps up, the owner watches the error dashboard. If errors rise, the owner pages the on-call engineer. The dashboard shows flagged and unflagged requests side by side, so a difference between them points at the flag rather than at the platform. The owner keeps watching until the flag has been at 100% for one hour.

## Rollback rehearsal

Before general availability, the owner rehearses a rollback once in staging: switch the flag off, confirm that the old behaviour returns, and switch it on again. The rehearsal is recorded in the rollout tool next to the staging test. It takes about 10 minutes and needs no approval.
