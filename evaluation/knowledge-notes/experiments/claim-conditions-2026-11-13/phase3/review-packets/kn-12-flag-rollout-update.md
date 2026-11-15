# Second review packet: kn-12-flag-rollout-update

## Source units (id [heading path] text)
u1 [Feature flag rollout guide] This guide is for engineers who own a feature flag in the Orbit platform.
u2 [Feature flag rollout guide] It explains how a flag goes from off to fully on, and what has to be true before each step.
u3 [Feature flag rollout guide] It does not cover experiments, which follow their own process.
u4 [Feature flag rollout guide] Each section below names the condition that must hold before the flag moves on.
u5 [Feature flag rollout guide] Questions about the guide go to the platform team.
u6 [Feature flag rollout guide › Rollout stages] A rollout moves through three stages: internal, canary and general availability.
u7 [Feature flag rollout guide › Rollout stages] In the internal stage the flag is on only for staff accounts, so problems reach colleagues before they reach customers.
u8 [Feature flag rollout guide › Rollout stages] The internal stage usually lasts one working day, but the guide sets no minimum for it.
u9 [Feature flag rollout guide › Rollout stages] Canary then exposes a small share of real traffic to the change.
u10 [Feature flag rollout guide › Rollout stages] General availability turns the flag on for everyone, in steps of 25%, 50% and 100%.
u11 [Feature flag rollout guide › Rollout stages] Each stage is recorded in the rollout tool, which keeps the history of who moved the flag and when.
u12 [Feature flag rollout guide › Canary] During canary the flag is on for 5% of requests, chosen at random per request rather than per user.
u13 [Feature flag rollout guide › Canary] It must stay at that level for at least 30 minutes, so that the metrics cover a full traffic cycle of the slowest endpoint.
u14 [Feature flag rollout guide › Canary] The owner does not raise the percentage by hand during this time, because a manual change restarts the measurement window.
u15 [Feature flag rollout guide › Canary] Short canaries are the most common reason a bad flag reaches general availability.
u16 [Feature flag rollout guide › Advancing from canary] A flag advances from canary to general availability only when the automated metrics check passes.
u17 [Feature flag rollout guide › Advancing from canary] The metrics check compares the error rate and p95 latency of flagged requests with the same requests over the previous 7 days.
u18 [Feature flag rollout guide › Advancing from canary] If the check fails, the flag stays in canary and the owner investigates before trying again.
u19 [Feature flag rollout guide › Advancing from canary] The rollout tool runs the check automatically at the end of the canary window.
u20 [Feature flag rollout guide › Kill switch] Every flag must have a kill switch that turns it off within 1 minute.
u21 [Feature flag rollout guide › Kill switch] The kill switch is tested in staging before the flag enters canary, and the test is recorded in the rollout tool.
u22 [Feature flag rollout guide › Kill switch] A flag without a tested kill switch cannot enter canary.
u23 [Feature flag rollout guide › Kill switch] Anyone on the owning team may use the kill switch without asking for approval.
u24 [Feature flag rollout guide › Kill switch] Turning a flag off is always safe; turning it back on starts the rollout again from the internal stage.
u25 [Feature flag rollout guide › Monitoring during general availability] While the flag ramps up, the owner watches the error dashboard and pages the on-call engineer if errors rise.
u26 [Feature flag rollout guide › Monitoring during general availability] The dashboard shows flagged and unflagged requests side by side, so a difference between them points at the flag rather than at the platform.
u27 [Feature flag rollout guide › Monitoring during general availability] The owner keeps watching until the flag has been at 100% for one hour.
u28 [Feature flag rollout guide › Flag cleanup] A flag that has been fully on for 30 days is removed from the code.
u29 [Feature flag rollout guide › Flag cleanup] The owner opens a cleanup ticket when the flag reaches 100%, and the ticket links to the rollout record.
u30 [Feature flag rollout guide › Flag cleanup] Flags that miss the deadline are listed in the weekly stale-flag report.
u31 [Feature flag rollout guide › Flag cleanup] Old flags make the code harder to read and slow down every later rollout.

## Candidate conditions (the span to judge; its claim link and binding are YOURS to decide)
c1: units u3 :: It does not cover experiments, which follow their own process.
c2: units u7 :: In the internal stage the flag is on only for staff accounts, so problems reach colleagues before they reach customers.
c3: units u8 :: The internal stage usually lasts one working day, but the guide sets no minimum for it.
c4: units u12 :: During canary the flag is on for 5% of requests, chosen at random per request rather than per user.
c5: units u13 :: It must stay at that level for at least 30 minutes, so that the metrics cover a full traffic cycle of the slowest endpoint.
c6: units u14 :: The owner does not raise the percentage by hand during this time, because a manual change restarts the measurement window.
c7: units u16, u18 :: A flag advances from canary to general availability only when the automated metrics check passes. If the check fails, the flag stays in canary and the owner investigates before trying again.
c8: units u20 :: Every flag must have a kill switch that turns it off within 1 minute.
c9: units u21, u22 :: The kill switch is tested in staging before the flag enters canary, and the test is recorded in the rollout tool. A flag without a tested kill switch cannot enter canary.
c10: units u24 :: Turning a flag off is always safe; turning it back on starts the rollout again from the internal stage.
c11: units u27 :: The owner keeps watching until the flag has been at 100% for one hour.
c12: units u28 :: A flag that has been fully on for 30 days is removed from the code.
