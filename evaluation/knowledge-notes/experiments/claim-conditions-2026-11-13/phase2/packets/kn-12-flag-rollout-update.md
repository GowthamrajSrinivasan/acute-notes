# Packet kn-12-flag-rollout-update

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
subtitle [heading] (no cites) :: Feature flag rollout guide: stages, conditions, and cleanup.
g0 [group] (no cites) :: Feature flag rollout guide | grid | Guide for engineers on feature flag rollout process and prerequisites.
u0_n1 [text] in g0 cites=u1 :: This guide is for engineers managing feature flags in the Orbit platform.
u0_n2 [text] in g0 cites=u2 :: It details the process of rolling out a feature flag from off to fully on, outlining prerequisites for each step.
u0_n3 [text] in g0 cites=u3 :: This guide does not cover experiments, which have a separate process.
u0_n4 [text] in g0 cites=u4 :: Each section specifies the conditions required before advancing the flag.
u0_n5 [text] in g0 cites=u5 :: For questions regarding this guide, contact the platform team.
u0_ax1 [text] in g0 (no cites) :: This guide outlines the step-by-step process for engineers to transition a feature flag from an 'off' state to a 'fully on' state within the Orbit platform.
u0_ax2 [text] in g0 (no cites) :: The guide explicitly excludes the process for experiments, indicating a separate, undefined process.
u0_ax3 [text] in g0 (no cites) :: Each section of the guide will detail specific conditions that must be met before advancing the feature flag to the next stage of rollout.
u0_ax4 [text] in g0 (no cites) :: For any inquiries or clarifications regarding this guide, engineers should contact the platform team.
g1 [group] (no cites) :: Rollout stages | chain | Rollout stages ensure controlled feature release with checks and monitoring.
u1_n1 [shape] in g1 cites=u6 :: rectangle | 1 · Internal Stage
u1_n2 [text] in g1 cites=u7,u8,u6 :: The flag is active only for staff accounts, allowing internal identification of problems before customer exposure. This stage typically lasts one working day, with no minimum duration specified. **From the source** three
u1_n3 [shape] in g1 cites=u6 :: rectangle | 2 · Canary Stage
u1_n4 [text] in g1 cites=u9,u12,u13,u14,u15 :: A small percentage (5%) of real traffic is exposed to the change, chosen randomly per request. This stage must last at least 30 minutes to cover a full traffic cycle of the slowest endpoint. Manual percentage changes during this period restart the measurement window. Short canaries are a common cause of problematic flags reaching general availability.
u1_n5 [shape] in g1 cites=u16 :: rectangle | 3 · Automated Metrics Check
u1_n6 [text] in g1 cites=u16,u17,u18,u19 :: The flag advances from canary only if an automated metrics check passes. This check compares the error rate and p95 latency of flagged requests against the previous 7 days. If it fails, the flag remains in canary for investigation. The rollout tool automatically runs this check at the end of the canary window.
u1_n7 [shape] in g1 cites=u6 :: rectangle | 4 · General Availability
u1_n8 [text] in g1 cites=u10,u25,u26,u27 :: The flag is progressively turned on for everyone in steps of 25%, 50%, and 100%. During this ramp-up, the owner monitors the error dashboard and pages the on-call engineer if errors increase. The dashboard displays flagged and unflagged requests side-by-side to distinguish flag-related issues from platform issues. Monitoring continues until the flag has been at 100% for one hour.
u1_n9 [text] in g1 cites=u11 :: Each stage of the rollout is recorded in the rollout tool, which maintains a history of who moved the flag and when.
u1_a1 [text] in g1 (no cites) :: The rollout process is a sequential flow designed to minimize customer impact from new features. It progresses through internal testing, a controlled canary release, and finally a phased general availability. A critical automated check acts as a gatekeeper between canary and general availability, preventing problematic flags from reaching a wider audience. The process emphasizes monitoring at each stage, with specific conditions for advancement and failure.
u1_a2 [text] in g1 (no cites) :: The most common reason for a bad flag reaching general availability is a short canary stage, which can lead to insufficient metric collection and analysis.
u1_a3 [text] in g1 (no cites) :: The rollout process ensures that new features are gradually exposed to users, with safeguards and monitoring in place to detect and mitigate issues before they affect a large user base.
g2 [group] (no cites) :: Kill switch | stack | Every feature flag needs a tested kill switch for safe, rapid deactivation.
u2_n1 [text] in g2 cites=u20 :: Every feature flag must include a kill switch capable of deactivating the flag within 1 minute.
u2_n2 [text] in g2 cites=u21 :: The kill switch must be tested in the staging environment before the flag proceeds to canary. This test must be documented in the rollout tool.
u2_n3 [text] in g2 cites=u22 :: A feature flag cannot be deployed to the canary environment if its kill switch has not been tested.
u2_n4 [text] in g2 cites=u23 :: Any member of the owning team is authorized to activate the kill switch without requiring prior approval.
u2_n5 [text] in g2 cites=u24 :: Deactivating a feature flag via its kill switch is always a safe operation. Re-enabling a flag will restart its rollout process from the internal stage.
u2_a1 [text] in g2 (no cites) :: The kill switch ensures rapid deactivation of feature flags, providing a safety mechanism. This is critical for mitigating risks associated with new features.
u2_a2 [text] in g2 (no cites) :: The requirement for testing the kill switch in staging and recording it in the rollout tool prevents flags with unverified safety mechanisms from reaching production environments.
g3 [group] (no cites) :: Flag cleanup | chain | Flags fully on for 30 days are removed; missed deadlines are reported.
u3_n1 [shape] in g3 cites=u28 :: rectangle | 1 · Flag fully on for 30 days
u3_n2 [text] in g3 cites=u28 :: A flag is removed from the code after being fully on for 30 days.
u3_n3 [shape] in g3 cites=u29 :: rectangle | 2 · Owner opens cleanup ticket
u3_n4 [text] in g3 cites=u29 :: The flag owner creates a cleanup ticket when the flag reaches 100% rollout. This ticket must link to the rollout record.
u3_n5 [shape] in g3 cites=u28 :: rectangle | 3 · Flag removed from code
u3_n6 [shape] in g3 cites=u30 :: rectangle | 4 · Weekly stale-flag report
u3_n7 [text] in g3 cites=u30 :: Flags that are not removed by their deadline are included in the weekly stale-flag report.
u3_n8 [text] in g3 cites=u31 :: Keeping old flags in the codebase negatively impacts code readability and slows down future rollouts.
u3_a1 [text] in g3 (no cites) :: This flow outlines the process for removing feature flags from the codebase once they are no longer needed. The goal is to maintain code hygiene and efficiency.
u3_a2 [text] in g3 (no cites) :: If a flag is not removed within the specified timeframe (30 days after being fully on), it will be flagged in a weekly report, indicating a deviation from the cleanup process.

## Visible arrows (from -> to : label)
u0_ax1 -> u0_n1
u0_ax1 -> u0_n2
u0_ax2 -> u0_n3
u0_ax3 -> u0_n4
u0_ax4 -> u0_n5
u1_n1 -> u1_n3
u1_n3 -> u1_n5
u1_n5 -> u1_n7 : if check passes
u1_n5 -> u1_n3 : if check fails (investigate and retry)
u1_n1 -> u1_n2
u1_n3 -> u1_n4
u1_n5 -> u1_n6
u1_n7 -> u1_n8
u2_n2 -> u2_n3 : enables
u2_n1 -> u2_a1
u2_n2 -> u2_a2
u2_n3 -> u2_a2
u3_n1 -> u3_n2
u3_n1 -> u3_n3
u3_n3 -> u3_n4
u3_n3 -> u3_n5
u3_n1 -> u3_n6 : if deadline missed
u3_n6 -> u3_n7
u3_n5 -> u3_n8 : reason for
u3_n6 -> u3_n8 : consequence of not avoiding
u3_a1 -> u3_n1
u3_a2 -> u3_n6
g1 -> g2 : kill switch tested before canary
g1 -> g3 : after 100% for 30 days
