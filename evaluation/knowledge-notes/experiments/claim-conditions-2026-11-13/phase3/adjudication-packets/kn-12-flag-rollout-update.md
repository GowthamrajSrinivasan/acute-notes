# Adjudication packet: kn-12-flag-rollout-update

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

## Candidates with every reading

### c1: condition units u3
- R1 (phase 2 blind reviewer) r12: claim u2, binding set — does not cover experiments, which follow their own process
- R2 (blind): set, claim u2 (medium) — condition "It does not cover experiments, which follow their own process." / claim "It explains how a flag goes from off to fully on" — Scope exclusion; arguably claim for experiment flags.

### c2: condition units u7
- R1 (phase 2 blind reviewer) r1: claim u7, binding claim — only for staff accounts
- R2 (blind): claim, claim u7 (medium) — condition "only for staff accounts" / claim "In the internal stage the flag is on" — Defines the internal stage's audience; without it the stage is unbounded.

### c3: condition units u8
- R1 (phase 2 blind reviewer) r2: claim u8, binding claim — usually; the guide sets no minimum
- R2 (blind): set, claim u8 (medium) — condition "but the guide sets no minimum for it" / claim "The internal stage usually lasts one working day" — Prevents reading one day as a requirement; the 'usually' claim stays true.

### c4: condition units u12
- R1 (phase 2 blind reviewer) r3: claim u12, binding claim — 5% of requests chosen at random per request, not per user
- R2 (blind): set, claim u9 (medium) — condition "5% of requests, chosen at random per request rather than per user" / claim "Canary then exposes a small share of real traffic to the change." — Specific level and sampling unit of canary.

### c5: condition units u13
- R1 (phase 2 blind reviewer) r4: claim u12+u13, binding claim — for at least 30 minutes
- R2 (blind): claim, claim u16 (medium) — condition "It must stay at that level for at least 30 minutes" / claim "A flag advances from canary to general availability only when the automated metrics check passes." — A second gate on advancing (minimum window); u16 alone implies passing the check suffices.

### c6: condition units u14
- R1 (phase 2 blind reviewer) r5: claim u13, binding set — raising the percentage by hand restarts the measurement window
- R2 (blind): set, claim u13 (medium) — condition "The owner does not raise the percentage by hand during this time, because a manual change restarts the measurement window." / claim "It must stay at that level for at least 30 minutes" — Operational rule with consequence; u13 stays true.

### c7: condition units u16, u18
- R1 (phase 2 blind reviewer) r6: claim u16, binding claim — only when the automated metrics check passes; if it fails the flag stays in canary
- R2 (blind): claim, claim u16 (high) — condition "only when the automated metrics check passes" / claim "A flag advances from canary to general availability" — Intra-sentence gate; u18 states the failure branch.

### c8: condition units u20
- R1 (phase 2 blind reviewer) r7: claim u20, binding claim — within 1 minute
- R2 (blind): set, claim u20 (medium) — condition "turns it off within 1 minute" / claim "Every flag must have a kill switch" — Required performance bound of the kill switch.

### c9: condition units u21, u22
- R1 (phase 2 blind reviewer) r8: claim u9, binding claim — a flag cannot enter canary without a kill switch tested in staging and recorded in the rollout tool
- R2 (blind): claim, claim u9 (high) — condition "A flag without a tested kill switch cannot enter canary." / claim "Canary then exposes a small share of real traffic to the change." — Prerequisite gate for entering canary; omitting it misstates the stage sequence.

### c10: condition units u24
- R1 (phase 2 blind reviewer) r9: claim u24, binding set — turning it back on restarts the rollout from the internal stage
- R2 (blind): set, claim u24 (medium) — condition "turning it back on starts the rollout again from the internal stage" / claim "Turning a flag off is always safe" — Cost of using the kill switch; 'always safe' stays true.

### c11: condition units u27
- R1 (phase 2 blind reviewer) r10: claim u25, binding claim — keeps watching until the flag has been at 100% for one hour
- R2 (blind): set, claim u25 (medium) — condition "until the flag has been at 100% for one hour" / claim "While the flag ramps up, the owner watches the error dashboard" — Extends the watch period beyond the ramp.

### c12: condition units u28
- R1 (phase 2 blind reviewer) r11: claim u28, binding claim — after it has been fully on for 30 days
- R2 (blind): claim, claim u28 (medium) — condition "that has been fully on for 30 days" / claim "is removed from the code" — Intra-sentence timing condition for removal.

## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)

### a1: condition units u30 — from R2: ambiguous, claim u28 — condition "Flags that miss the deadline are listed in the weekly stale-flag report." / claim "A flag that has been fully on for 30 days is removed from the code." — Either it shows removal is not guaranteed (claim) or it is just enforcement follow-up (set).

