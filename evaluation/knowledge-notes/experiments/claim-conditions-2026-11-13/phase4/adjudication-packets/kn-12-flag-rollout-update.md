# Phase 4 adjudication packet: kn-12-flag-rollout-update

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

Note set(s): ../phase2/packets/kn-12-flag-rollout-update.md (distil)

## Matched pairs (X and Y found the same clause)

- X: x1 [u3] set (R5, high) clause "It does not cover experiments, which follow their own process." → claim u2 "It explains how a flag goes from off to fully on, and what has to be true before each step."
  Y: y1 [u3] set (R5, high) clause "It does not cover experiments, which follow their own process." → claim u2 "It explains how a flag goes from off to fully on, and what has to be true before each step."
  context: phase3 c1 [u3] set/agreed claim u2 outcomes {"distil":{"u0_n2":"separated","u0_ax1":"separated"}} carriers {"distil":["u0_n3","u0_ax2"]}

- X: x2 [u7] claim (general, high) clause "only for staff accounts" → claim u7 "In the internal stage the flag is on"
  Y: y2 [u7] claim (general, high) clause "only for staff accounts" → claim u7 "In the internal stage the flag is on"
  context: phase3 c2 [u7] claim/agreed claim u7 outcomes {"distil":{"u1_n2":"carried"}} carriers {"distil":["u1_n2"]}

- X: x3 [u8] set (R2, medium) clause "usually" → claim u8 "lasts one working day"
  Y: y3 [u8] set (R2, medium) clause "usually" → claim u8 "The internal stage usually lasts one working day"
  context: phase3 c3 [u8] ambiguous/unresolved claim u8 outcomes {"distil":{"u1_n2":"carried"}} carriers {"distil":["u1_n2"]}

- X: x4 [u8] set (R1, medium) clause "the guide sets no minimum for it" → claim u8 "The internal stage usually lasts one working day"
  Y: y4 [u8] set (general, medium) clause "but the guide sets no minimum for it" → claim u8 "The internal stage usually lasts one working day"
  context: phase3 c3 [u8] ambiguous/unresolved claim u8 outcomes {"distil":{"u1_n2":"carried"}} carriers {"distil":["u1_n2"]}

- X: x5 [u12] claim (general, medium) clause "chosen at random per request rather than per user" → claim u12 "During canary the flag is on for 5% of requests"
  Y: y5 [u12] claim (general, medium) clause "chosen at random per request rather than per user" → claim u12 "During canary the flag is on for 5% of requests"
  context: phase3 c4 [u12] ambiguous/unresolved claim u9+u12 outcomes {"distil":{"u1_n4":"carried"}} carriers {"distil":["u1_n4"]}

- X: x6 [u13] claim (R1, high) clause "for at least 30 minutes" → claim u13 "It must stay at that level"
  Y: y6 [u13] claim (R1, high) clause "for at least 30 minutes" → claim u13 "It must stay at that level"
  context: phase3 c5 [u13] claim/adjudicated claim u12+u13+u16 outcomes {"distil":{"u1_n4":"carried","u1_n6":"separated","u1_a1":"separated"}} carriers {"distil":["u1_n4"]}

- X: x7 [u14] claim (R1, high) clause "The owner does not raise the percentage by hand during this time" → claim u13 "It must stay at that level for at least 30 minutes"
  Y: y7 [u14] claim (R1, medium) clause "does not raise the percentage by hand during this time" → claim u13 "It must stay at that level for at least 30 minutes"
  context: phase3 c6 [u14] set/agreed claim u13 outcomes {"distil":{"u1_n4":"carried"}} carriers {"distil":["u1_n4"]}

- X: x8 [u16] claim (R1, high) clause "only when the automated metrics check passes" → claim u16 "A flag advances from canary to general availability"
  Y: y8 [u16] claim (R1, high) clause "only when the automated metrics check passes" → claim u16 "A flag advances from canary to general availability"
  context: phase3 c7 [u16,u18] claim/agreed claim u16 outcomes {"distil":{"u1_n6":"carried","u1_a1":"carried"}} carriers {"distil":["u1_n6","u1_a1","arrow:u1_n5->u1_n7","arrow:u1_n5->u1_n3"]}

- X: x9 [u18] claim (R1, high) clause "If the check fails" → claim u18 "the flag stays in canary"
  Y: y9 [u18] claim (general, high) clause "If the check fails" → claim u18 "the flag stays in canary and the owner investigates before trying again"
  context: phase3 c7 [u16,u18] claim/agreed claim u16 outcomes {"distil":{"u1_n6":"carried","u1_a1":"carried"}} carriers {"distil":["u1_n6","u1_a1","arrow:u1_n5->u1_n7","arrow:u1_n5->u1_n3"]}

- X: x10 [u18] claim (R1, medium) clause "the owner investigates before trying again" → claim u18 "the flag stays in canary"
  Y: y10 [u18] claim (R1, medium) clause "before trying again" → claim u18 "the owner investigates"
  context: phase3 c7 [u16,u18] claim/agreed claim u16 outcomes {"distil":{"u1_n6":"carried","u1_a1":"carried"}} carriers {"distil":["u1_n6","u1_a1","arrow:u1_n5->u1_n7","arrow:u1_n5->u1_n3"]}

- X: x11 [u20] claim (R1, high) clause "within 1 minute" → claim u20 "Every flag must have a kill switch that turns it off"
  Y: y11 [u20] claim (R1, medium) clause "within 1 minute" → claim u20 "Every flag must have a kill switch that turns it off"
  context: phase3 c8 [u20] ambiguous/unresolved claim u20 outcomes {"distil":{"u2_n1":"carried"}} carriers {"distil":["u2_n1"]}

- X: x12 [u21] claim (R1, high) clause "before the flag enters canary" → claim u21 "The kill switch is tested in staging"
  Y: y12 [u21] claim (R1, high) clause "before the flag enters canary" → claim u21 "The kill switch is tested in staging"
  context: phase3 c9 [u21,u22] claim/agreed claim u9 outcomes {"distil":{"u1_n4":"arrow_label","u1_a1":"arrow_label"}} carriers {"distil":["u2_n2","u2_n3","u2_a2","arrow:g1->g2"]}

- X: x14 [u22] claim (R1, high) clause "without a tested kill switch" → claim u22 "cannot enter canary"
  Y: y14 [u22] claim (general, high) clause "without a tested kill switch" → claim u22 "A flag without a tested kill switch cannot enter canary."
  context: phase3 c9 [u21,u22] claim/agreed claim u9 outcomes {"distil":{"u1_n4":"arrow_label","u1_a1":"arrow_label"}} carriers {"distil":["u2_n2","u2_n3","u2_a2","arrow:g1->g2"]}

- X: x15 [u24] claim (R3, high) clause "turning it back on starts the rollout again from the internal stage" → claim u24 "Turning a flag off is always safe"
  Y: y15 [u24] claim (R3, medium) clause "turning it back on starts the rollout again from the internal stage" → claim u24 "Turning a flag off is always safe"
  context: phase3 c10 [u24] set/agreed claim u24 outcomes {"distil":{"u2_n5":"carried"}} carriers {"distil":["u2_n5"]}

- X: x16 [u27] claim (R4, high) clause "until the flag has been at 100% for one hour" → claim u25 "While the flag ramps up, the owner watches the error dashboard"
  Y: y17 [u27] claim (R1, medium) clause "until the flag has been at 100% for one hour" → claim u25 "While the flag ramps up, the owner watches the error dashboard"
  context: phase3 c11 [u27] ambiguous/unresolved claim u25 outcomes {"distil":{"u1_n8":"carried"}} carriers {"distil":["u1_n8"]}

- X: x17 [u28] claim (R1, high) clause "that has been fully on for 30 days" → claim u28 "is removed from the code"
  Y: y18 [u28] claim (R1, high) clause "that has been fully on for 30 days" → claim u28 "A flag that has been fully on for 30 days is removed from the code."
  context: phase3 c12 [u28] claim/agreed claim u28 outcomes {"distil":{"u3_n2":"carried","u3_n1":"carried","u3_n5":"frame","g3":"carried"}} carriers {"distil":["u3_n1","u3_n2","u3_a2","g3","arrow:g1->g3"]}

- X: x18 [u30] ambiguous (R5, low) clause "that miss the deadline" → claim u30 "are listed in the weekly stale-flag report" | A: claim: an intra-sentence scope; without it the restatement says every flag is listed in the stale-flag report, which is false | B: not_a_condition: it only names the report's subject (flags past the 30-day cleanup deadline in u28) and limits no claim a reader would act on | Q: Would a reader act differently if told 'flags are listed in the weekly stale-flag report' without the deadline qualifier?
  Y: y19 [u30] claim (general, medium) clause "that miss the deadline" → claim u30 "Flags that miss the deadline are listed in the weekly stale-flag report."
  context: phase3 a1 [u30] ambiguous/unresolved claim u28 outcomes {"distil":{"u3_n2":"frame","u3_n5":"frame","g3":"carried"}} carriers {"distil":["u3_n7","u3_a2","u3_n6","g3","arrow:u3_n1->u3_n6"]}

- X: x19 [u25] claim (R1, medium) clause "if errors rise" → claim u25 "pages the on-call engineer"
  Y: y16 [u25] set (R1, medium) clause "if errors rise" → claim u25 "the owner watches the error dashboard and pages the on-call engineer"

## Found by X only

- x13 [u21] set (R1, medium) clause "and the test is recorded in the rollout tool" → claim u21 "The kill switch is tested in staging before the flag enters canary"
  context: phase3 c9 [u21,u22] claim/agreed claim u9 outcomes {"distil":{"u1_n4":"arrow_label","u1_a1":"arrow_label"}} carriers {"distil":["u2_n2","u2_n3","u2_a2","arrow:g1->g2"]}

## Found by Y only

- y13 [u21] set (R1, low) clause "in staging" → claim u21 "The kill switch is tested in staging before the flag enters canary"
  context: phase3 c9 [u21,u22] claim/agreed claim u9 outcomes {"distil":{"u1_n4":"arrow_label","u1_a1":"arrow_label"}} carriers {"distil":["u2_n2","u2_n3","u2_a2","arrow:g1->g2"]}

