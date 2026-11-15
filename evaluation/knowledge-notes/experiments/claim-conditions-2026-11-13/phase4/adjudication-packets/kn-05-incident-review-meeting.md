# Phase 4 adjudication packet: kn-05-incident-review-meeting

## Source units (id [heading path] text)
u1 [Post-incident review: checkout outage, March 14] Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
u2 [Post-incident review: checkout outage, March 14] Dana: Okay, I think everyone's here.
u3 [Post-incident review: checkout outage, March 14] Did people manage to grab coffee?
u4 [Post-incident review: checkout outage, March 14] The machine on four is broken again.
u5 [Post-incident review: checkout outage, March 14] Kenji: I brought my own.
u6 [Post-incident review: checkout outage, March 14] Lesson learned.
u7 [Post-incident review: checkout outage, March 14] Dana: Smart.
u8 [Post-incident review: checkout outage, March 14] Right, let's start.
u9 [Post-incident review: checkout outage, March 14] This is the blameless review for the checkout outage on Friday, March 14.
u10 [Post-incident review: checkout outage, March 14] Marcus, can you walk us through the timeline?
u11 [Post-incident review: checkout outage, March 14] Marcus: Sure.
u12 [Post-incident review: checkout outage, March 14] At 16:40 a config change to the payments service went out.
u13 [Post-incident review: checkout outage, March 14] It changed the gateway connection pool from 50 connections to 5.
u14 [Post-incident review: checkout outage, March 14] That was a typo; the intent was 55.
u15 [Post-incident review: checkout outage, March 14] Checkout requests started queuing for a connection and timing out almost immediately.
u16 [Post-incident review: checkout outage, March 14] Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change.
u17 [Post-incident review: checkout outage, March 14] I rolled the config back at 17:15, and checkout was fully recovered at 17:27.
u18 [Post-incident review: checkout outage, March 14] So customers saw errors for 47 minutes in total.
u19 [Post-incident review: checkout outage, March 14] Kenji: And on our side, we counted about 2,300 failed checkouts in that window.
u20 [Post-incident review: checkout outage, March 14] Support got 140 tickets before we posted the status page.
u21 [Post-incident review: checkout outage, March 14] Dana: Why did the alert take 22 minutes?
u22 [Post-incident review: checkout outage, March 14] Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
u23 [Post-incident review: checkout outage, March 14] Errors went over 10% around 16:47, so the earliest it could fire was 17:02.
u24 [Post-incident review: checkout outage, March 14] It did exactly what it was configured to do.
u25 [Post-incident review: checkout outage, March 14] Leila: Which is too slow for checkout.
u26 [Post-incident review: checkout outage, March 14] 15 minutes of sustained errors is a long time when every minute is lost revenue.
u27 [Post-incident review: checkout outage, March 14] Dana: Fair.
u28 [Post-incident review: checkout outage, March 14] What do we want instead?
u29 [Post-incident review: checkout outage, March 14] Marcus: I'd propose 5% over 5 minutes for checkout specifically.
u30 [Post-incident review: checkout outage, March 14] I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.
u31 [Post-incident review: checkout outage, March 14] Leila: Two noisy pages a month is fine for checkout.
u32 [Post-incident review: checkout outage, March 14] Dana: Anyone against? ... Okay.
u33 [Post-incident review: checkout outage, March 14] Agreed: we'll lower the checkout error-rate alert to 5% over 5 minutes. Marcus, can you own that?
u34 [Post-incident review: checkout outage, March 14] Marcus: Yes.
u35 [Post-incident review: checkout outage, March 14] I'll have it changed by Wednesday, March 19.
u36 [Post-incident review: checkout outage, March 14] Kenji: One more thing from support.
u37 [Post-incident review: checkout outage, March 14] The status page went up at 17:20, which is 40 minutes after the errors started.
u38 [Post-incident review: checkout outage, March 14] Customers were asking on social media before we said anything.
u39 [Post-incident review: checkout outage, March 14] Dana: Who posts the status page today?
u40 [Post-incident review: checkout outage, March 14] Kenji: Whoever is incident commander, when they remember.
u41 [Post-incident review: checkout outage, March 14] On Friday that was Marcus, and he was busy rolling back.
u42 [Post-incident review: checkout outage, March 14] Marcus: Honestly, it was the last thing on my mind.
u43 [Post-incident review: checkout outage, March 14] Dana: Should support be allowed to post it directly?
u44 [Post-incident review: checkout outage, March 14] Kenji: I'd like that, yes.
u45 [Post-incident review: checkout outage, March 14] Leila: No objection from me.
u46 [Post-incident review: checkout outage, March 14] Dana: Agreed: support can post a status-page update directly, without waiting for the incident commander.
u47 [Post-incident review: checkout outage, March 14] Dana: Great.
u48 [Post-incident review: checkout outage, March 14] Next, how did a config value like that get through?
u49 [Post-incident review: checkout outage, March 14] Leila: Config changes don't go through code review.
u50 [Post-incident review: checkout outage, March 14] They're edited in the deploy dashboard and applied directly.
u51 [Post-incident review: checkout outage, March 14] Code changes need two approvals; config needs none.
u52 [Post-incident review: checkout outage, March 14] Tomás: That's the real gap.
u53 [Post-incident review: checkout outage, March 14] A typo in code would have been caught by the reviewer or by a test.
u54 [Post-incident review: checkout outage, March 14] Dana: So the proposal is that payments config goes through the same review as code?
u55 [Post-incident review: checkout outage, March 14] Leila: Yes.
u56 [Post-incident review: checkout outage, March 14] Config lives in the repo, it gets a pull request, and it needs one approval from the payments team.
u57 [Post-incident review: checkout outage, March 14] Tomás: I'm fine with that.
u58 [Post-incident review: checkout outage, March 14] Marcus: Same.
u59 [Post-incident review: checkout outage, March 14] Dana: Agreed: config changes to the payments service will go through pull-request review with one payments-team approval.
u60 [Post-incident review: checkout outage, March 14] Leila, can you set that up?
u61 [Post-incident review: checkout outage, March 14] Leila: I'll move the config into the repo and add the approval rule by Friday, March 21.
u62 [Post-incident review: checkout outage, March 14] Tomás: Can I raise something else?
u63 [Post-incident review: checkout outage, March 14] I'd like us to stop deploying anything to payments after 15:00 on Fridays.
u64 [Post-incident review: checkout outage, March 14] This went out at 16:40 on a Friday, and half the team had already logged off.
u65 [Post-incident review: checkout outage, March 14] Leila: I don't agree with that.
u66 [Post-incident review: checkout outage, March 14] A freeze just moves the risk to Monday morning, when traffic is higher.
u67 [Post-incident review: checkout outage, March 14] The problem here wasn't the day, it was that nobody reviewed the change.
u68 [Post-incident review: checkout outage, March 14] Tomás: The review fixes this one cause.
u69 [Post-incident review: checkout outage, March 14] But fewer people around means slower recovery for any cause.
u70 [Post-incident review: checkout outage, March 14] Leila: Recovery took 25 minutes after the alert, and Marcus was on call.
u71 [Post-incident review: checkout outage, March 14] Being Friday didn't slow that down.
u72 [Post-incident review: checkout outage, March 14] Tomás: That's one incident.
u73 [Post-incident review: checkout outage, March 14] I think we'd see a pattern if we looked.
u74 [Post-incident review: checkout outage, March 14] Dana: I don't think we're going to settle this today.
u75 [Post-incident review: checkout outage, March 14] Let's not decide the freeze now.
u76 [Post-incident review: checkout outage, March 14] Tomás, could you pull the incidents from the last six months and see whether late-Friday deploys are over-represented?
u77 [Post-incident review: checkout outage, March 14] Bring it to the next review on April 2.
u78 [Post-incident review: checkout outage, March 14] Tomás: Sure, I can do that.
u79 [Post-incident review: checkout outage, March 14] Marcus: While we're on prevention, I'd also propose automatic rollback: if the checkout error rate doubles within 10 minutes of a deploy, the pipeline rolls back on its own.
u80 [Post-incident review: checkout outage, March 14] Leila: For config, maybe.
u81 [Post-incident review: checkout outage, March 14] For code, I'm nervous.
u82 [Post-incident review: checkout outage, March 14] If a release includes a database migration, rolling back the code without the migration can leave us worse off.
u83 [Post-incident review: checkout outage, March 14] Marcus: We could exclude releases with migrations.
u84 [Post-incident review: checkout outage, March 14] Leila: Possibly.
u85 [Post-incident review: checkout outage, March 14] I'd want to know how often we ship migrations before I agree to anything.
u86 [Post-incident review: checkout outage, March 14] Dana: Okay, so auto-rollback is an open question.
u87 [Post-incident review: checkout outage, March 14] We don't know how many releases include migrations.
u88 [Post-incident review: checkout outage, March 14] Let's leave it open.
u89 [Post-incident review: checkout outage, March 14] Kenji: Can I go back to customers?
u90 [Post-incident review: checkout outage, March 14] Do we know whether any of the 2,300 failed checkouts were retried successfully?
u91 [Post-incident review: checkout outage, March 14] If most people retried, the email we send is different.
u92 [Post-incident review: checkout outage, March 14] Marcus: I don't know.
u93 [Post-incident review: checkout outage, March 14] The payment logs would show it, but nobody has looked yet.
u94 [Post-incident review: checkout outage, March 14] Dana: That's an open question too, then.
u95 [Post-incident review: checkout outage, March 14] Kenji, can you draft the customer email either way?
u96 [Post-incident review: checkout outage, March 14] Kenji: Yes, I'll take the email draft.
u97 [Post-incident review: checkout outage, March 14] Marcus: So just to recap the timeline again for the doc: the change went out at 16:40, the alert fired at 17:02, rollback at 17:15, recovered at 17:27.
u98 [Post-incident review: checkout outage, March 14] Dana: Thanks.
u99 [Post-incident review: checkout outage, March 14] Anything else? ... Okay.
u100 [Post-incident review: checkout outage, March 14] Good review, everyone.
u101 [Post-incident review: checkout outage, March 14] And someone please report the coffee machine.

Note set(s): ../phase2/packets/kn-05-incident-review-meeting.md (distil)

## Matched pairs (X and Y found the same clause)

- X: x1 [u22] claim (general, high) clause "only fires when the checkout error rate is above 10% for 15 minutes" → claim u22 "The alert only fires"
  Y: y1 [u22] claim (general, medium) clause "only fires when the checkout error rate is above 10% for 15 minutes" → claim u22 "The alert only fires when the checkout error rate is above 10% for 15 minutes"
  context: phase3 c1 [u22] claim/agreed claim u22 outcomes {"distil":{"u0_u0_n5":"carried","u0_ax3":"carried","u0_u0_n9":"carried"}} carriers {"distil":["u0_u0_n5","u0_ax3","u0_u0_n9"]}

- X: x2 [u29] claim (R5, medium) clause "for checkout specifically" → claim u29 "I'd propose 5% over 5 minutes"
  Y: y2 [u29] claim (general, medium) clause "for checkout specifically" → claim u29 "I'd propose 5% over 5 minutes"
  context: phase3 c2 [u29] claim/agreed claim u33 outcomes {"distil":{"u0_u0_n10":"carried","u0_u0_n11":"carried","u0_ax1":"carried"}} carriers {"distil":["u0_u0_n10","u0_u0_n11","u0_ax1"]}

- X: x3 [u30] claim (R3, medium) clause "that would have paged twice on noise" → claim u33 "Agreed: we'll lower the checkout error-rate alert to 5% over 5 minutes."
  Y: y3 [u30] claim (R3, medium) clause "that would have paged twice on noise" → claim u33 "we'll lower the checkout error-rate alert to 5% over 5 minutes"
  context: phase3 c3 [u30,u31] set/agreed claim u33 outcomes {"distil":{"u0_u0_n10":"carried","u0_u0_n11":"linked","u0_ax1":"separated"}} carriers {"distil":["u0_u0_n10"]}

- X: x4 [u30] set (R2, low) clause "I checked the last 30 days" → claim u30 "that would have paged twice on noise"
  Y: y4 [u30] set (R2, medium) clause "I checked the last 30 days" → claim u30 "that would have paged twice on noise"
  context: phase3 c3 [u30,u31] set/agreed claim u33 outcomes {"distil":{"u0_u0_n10":"carried","u0_u0_n11":"linked","u0_ax1":"separated"}} carriers {"distil":["u0_u0_n10"]}

- X: x6 [u31] not_a_condition (general, medium) clause "Two noisy pages a month is fine for checkout." → claim - ""
  Y: y5 [u31] not_a_condition (general, medium) clause "Two noisy pages a month is fine for checkout." → claim - ""
  context: phase3 c3 [u30,u31] set/agreed claim u33 outcomes {"distil":{"u0_u0_n10":"carried","u0_u0_n11":"linked","u0_ax1":"separated"}} carriers {"distil":["u0_u0_n10"]}

- X: x7 [u55] not_a_condition (general, high) clause "Leila: Yes." → claim - ""
  Y: y6 [u55] not_a_condition (general, high) clause "Yes." → claim - ""
  context: phase3 c4 [u55,u56,u57,u58,u59,u60] claim/agreed claim u59 outcomes {"distil":{"u0_u1_n1":"carried","u0_ax1":"carried","u0_u0_n19":"separated"}} carriers {"distil":["u0_u1_n1","u0_ax1"]}

- X: x8 [u56] claim (R1, medium) clause "it needs one approval from the payments team" → claim u56 "Config lives in the repo, it gets a pull request"
  Y: y7 [u56] not_a_condition (general, medium) clause "it needs one approval from the payments team" → claim - ""
  context: phase3 c4 [u55,u56,u57,u58,u59,u60] claim/agreed claim u59 outcomes {"distil":{"u0_u1_n1":"carried","u0_ax1":"carried","u0_u0_n19":"separated"}} carriers {"distil":["u0_u1_n1","u0_ax1"]}

- X: x9 [u57] not_a_condition (general, high) clause "Tomás: I'm fine with that." → claim - ""
  Y: y8 [u57] not_a_condition (general, high) clause "Tomás: I'm fine with that." → claim - ""
  context: phase3 c4 [u55,u56,u57,u58,u59,u60] claim/agreed claim u59 outcomes {"distil":{"u0_u1_n1":"carried","u0_ax1":"carried","u0_u0_n19":"separated"}} carriers {"distil":["u0_u1_n1","u0_ax1"]}

- X: x10 [u58] not_a_condition (general, high) clause "Marcus: Same." → claim - ""
  Y: y9 [u58] not_a_condition (general, high) clause "Marcus: Same." → claim - ""
  context: phase3 c4 [u55,u56,u57,u58,u59,u60] claim/agreed claim u59 outcomes {"distil":{"u0_u1_n1":"carried","u0_ax1":"carried","u0_u0_n19":"separated"}} carriers {"distil":["u0_u1_n1","u0_ax1"]}

- X: x11 [u59] claim (R5, medium) clause "to the payments service" → claim u59 "config changes to the payments service will go through pull-request review"
  Y: y10 [u59] claim (general, high) clause "to the payments service" → claim u59 "config changes to the payments service will go through pull-request review with one payments-team approval"
  context: phase3 c4 [u55,u56,u57,u58,u59,u60] claim/agreed claim u59 outcomes {"distil":{"u0_u1_n1":"carried","u0_ax1":"carried","u0_u0_n19":"separated"}} carriers {"distil":["u0_u1_n1","u0_ax1"]}

- X: x12 [u59] claim (R1, high) clause "with one payments-team approval" → claim u59 "config changes to the payments service will go through pull-request review"
  Y: y11 [u59] set (general, low) clause "with one payments-team approval" → claim u59 "config changes to the payments service will go through pull-request review"
  context: phase3 c4 [u55,u56,u57,u58,u59,u60] claim/agreed claim u59 outcomes {"distil":{"u0_u1_n1":"carried","u0_ax1":"carried","u0_u0_n19":"separated"}} carriers {"distil":["u0_u1_n1","u0_ax1"]}

- X: x13 [u60] not_a_condition (general, high) clause "Leila, can you set that up?" → claim - ""
  Y: y12 [u60] not_a_condition (general, high) clause "Leila, can you set that up?" → claim - ""
  context: phase3 c4 [u55,u56,u57,u58,u59,u60] claim/agreed claim u59 outcomes {"distil":{"u0_u1_n1":"carried","u0_ax1":"carried","u0_u0_n19":"separated"}} carriers {"distil":["u0_u1_n1","u0_ax1"]}

- X: x14 [u61] set (R1, medium) clause "by Friday, March 21" → claim u61 "I'll move the config into the repo and add the approval rule"
  Y: y13 [u61] set (R1, medium) clause "by Friday, March 21" → claim u61 "I'll move the config into the repo and add the approval rule"
  context: phase3 c5 [u61,u62] not_a_condition/adjudicated claim -

- X: x15 [u62] not_a_condition (general, high) clause "Can I raise something else?" → claim - ""
  Y: y14 [u62] not_a_condition (general, high) clause "Tomás: Can I raise something else?" → claim - ""
  context: phase3 c5 [u61,u62] not_a_condition/adjudicated claim -

- X: x16 [u63] claim (general, high) clause "after 15:00 on Fridays" → claim u63 "I'd like us to stop deploying anything to payments"
  Y: y15 [u63] claim (general, high) clause "after 15:00 on Fridays" → claim u63 "I'd like us to stop deploying anything to payments"
  context: phase3 c6 [u63] claim/agreed claim u63 outcomes {"distil":{"u0_u1_n3":"carried"}} carriers {"distil":["u0_u1_n3"]}

- X: x17 [u63] claim (R5, medium) clause "to payments" → claim u63 "I'd like us to stop deploying anything"
  Y: y16 [u63] claim (general, medium) clause "to payments" → claim u63 "I'd like us to stop deploying anything"
  context: phase3 c6 [u63] claim/agreed claim u63 outcomes {"distil":{"u0_u1_n3":"carried"}} carriers {"distil":["u0_u1_n3"]}

- X: x18 [u71] not_a_condition (general, medium) clause "Being Friday didn't slow that down." → claim - ""
  Y: y17 [u71] not_a_condition (general, medium) clause "Being Friday didn't slow that down." → claim - ""
  context: phase3 c7 [u71,u72,u73] not_a_condition/adjudicated claim -

- X: x19 [u72] ambiguous (R2, low) clause "That's one incident." → claim u71 "Being Friday didn't slow that down." | A: claim: a caveat on the evidence for Leila's argument; a reader taking u71 as general evidence would conclude Friday deploys carry no extra recovery risk | B: set: the freeze is explicitly left undecided (u75), so the takeaway is unchanged; the caveat is just part of the debate | Q: Is u71 used by the source as evidence for a decision, or only as one side of an unresolved debate?
  Y: y18 [u72] ambiguous (R2, low) clause "That's one incident." → claim u71 "Being Friday didn't slow that down." | A: claim (R2): an explicit reliability warning that Leila's evidence is a single incident; a reader taking u71 as a general finding would wrongly conclude Friday deploys don't slow recovery and drop the freeze question | B: not_a_condition: a debating rejoinder by the opposing speaker in an unresolved argument, not a limit the source itself places on a claim | Q: Does a counter-speaker's rebuttal in a recorded debate count as a source caveat on the opposing claim, or only as attribution of a disagreement?
  context: phase3 c7 [u71,u72,u73] not_a_condition/adjudicated claim -

- X: x20 [u73] claim (R2, medium) clause "I think we'd see a pattern if we looked" → claim u69 "But fewer people around means slower recovery for any cause."
  Y: y19 [u73] claim (R2, medium) clause "I think we'd see a pattern if we looked" → claim u73 "we'd see a pattern"
  context: phase3 c7 [u71,u72,u73] not_a_condition/adjudicated claim -

- X: x21 [u74] not_a_condition (general, medium) clause "I don't think we're going to settle this today." → claim - ""
  Y: y20 [u74] not_a_condition (general, medium) clause "I don't think we're going to settle this today." → claim - ""
  context: phase3 c8 [u74,u75,u76] claim/agreed claim u63 outcomes {"distil":{"u0_u1_n3":"frame","u0_ax2":"carried"}} carriers {"distil":["g0","u0_u1_n6","u0_ax2"]}

- X: x22 [u75] claim (R4, high) clause "Let's not decide the freeze now." → claim u63 "I'd like us to stop deploying anything to payments after 15:00 on Fridays."
  Y: y21 [u75] claim (R4, high) clause "not decide the freeze now" → claim u63 "I'd like us to stop deploying anything to payments after 15:00 on Fridays."
  context: phase3 c8 [u74,u75,u76] claim/agreed claim u63 outcomes {"distil":{"u0_u1_n3":"frame","u0_ax2":"carried"}} carriers {"distil":["g0","u0_u1_n6","u0_ax2"]}

- X: x23 [u76] set (R1, medium) clause "from the last six months" → claim u76 "could you pull the incidents"
  Y: y22 [u76] set (R1, medium) clause "from the last six months" → claim u76 "see whether late-Friday deploys are over-represented"
  context: phase3 c8 [u74,u75,u76] claim/agreed claim u63 outcomes {"distil":{"u0_u1_n3":"frame","u0_ax2":"carried"}} carriers {"distil":["g0","u0_u1_n6","u0_ax2"]}

- X: x24 [u79] claim (general, high) clause "if the checkout error rate doubles within 10 minutes of a deploy" → claim u79 "the pipeline rolls back on its own"
  Y: y23 [u79] claim (general, high) clause "if the checkout error rate doubles within 10 minutes of a deploy" → claim u79 "the pipeline rolls back on its own"
  context: phase3 c9 [u79] claim/agreed claim u79 outcomes {"distil":{"u0_u1_n7":"carried"}} carriers {"distil":["u0_u1_n7"]}

- X: x25 [u80] claim (R4, medium) clause "For config, maybe." → claim u79 "I'd also propose automatic rollback"
  Y: y24 [u80] set (general, low) clause "For config, maybe." → claim u79 "I'd also propose automatic rollback"
  context: phase3 c10 [u80,u81,u82,u83] set/adjudicated claim u79 outcomes {"distil":{"u0_u1_n7":"linked"}} carriers {"distil":["u0_u1_n8","u0_ax2"]}

- X: x26 [u81] claim (R4, medium) clause "For code, I'm nervous." → claim u79 "I'd also propose automatic rollback"
  Y: y25 [u81] set (general, low) clause "For code, I'm nervous." → claim u79 "I'd also propose automatic rollback"
  context: phase3 c10 [u80,u81,u82,u83] set/adjudicated claim u79 outcomes {"distil":{"u0_u1_n7":"linked"}} carriers {"distil":["u0_u1_n8","u0_ax2"]}

- X: x27 [u82] claim (R4, medium) clause "If a release includes a database migration" → claim u79 "the pipeline rolls back on its own"
  Y: y26 [u82] claim (R3, medium) clause "If a release includes a database migration" → claim u79 "the pipeline rolls back on its own"
  context: phase3 c10 [u80,u81,u82,u83] set/adjudicated claim u79 outcomes {"distil":{"u0_u1_n7":"linked"}} carriers {"distil":["u0_u1_n8","u0_ax2"]}

- X: x28 [u83] ambiguous (R4, low) clause "We could exclude releases with migrations." → claim u79 "the pipeline rolls back on its own" | A: claim: the exclusion is the scope under which the proposal could be acceptable; dropping it presents auto-rollback as covering migration releases | B: set or weaker: it is only a tentative suggestion ('could', 'Possibly') that was not adopted, so the proposal's takeaway (open question) is unchanged | Q: Does the source treat the migration exclusion as part of the proposal under discussion, or only as an unadopted aside?
  Y: y27 [u83] set (general, low) clause "We could exclude releases with migrations." → claim u79 "I'd also propose automatic rollback"
  context: phase3 c10 [u80,u81,u82,u83] set/adjudicated claim u79 outcomes {"distil":{"u0_u1_n7":"linked"}} carriers {"distil":["u0_u1_n8","u0_ax2"]}

- X: x29 [u86] claim (R4, high) clause "auto-rollback is an open question" → claim u79 "I'd also propose automatic rollback"
  Y: y28 [u86] claim (general, high) clause "auto-rollback is an open question" → claim u79 "I'd also propose automatic rollback"
  context: phase3 c11 [u86,u87,u88] claim/agreed claim u79 outcomes {"distil":{"u0_u1_n7":"frame"}} carriers {"distil":["u0_u1_n9","u0_ax2","g0"]}

- X: x30 [u87] set (R2, medium) clause "We don't know how many releases include migrations." → claim u86 "auto-rollback is an open question"
  Y: y29 [u87] set (R2, medium) clause "We don't know how many releases include migrations." → claim u86 "auto-rollback is an open question"
  context: phase3 c11 [u86,u87,u88] claim/agreed claim u79 outcomes {"distil":{"u0_u1_n7":"frame"}} carriers {"distil":["u0_u1_n9","u0_ax2","g0"]}

- X: x31 [u88] claim (R4, medium) clause "Let's leave it open." → claim u79 "I'd also propose automatic rollback"
  Y: y30 [u88] not_a_condition (general, medium) clause "Let's leave it open." → claim - ""
  context: phase3 c11 [u86,u87,u88] claim/agreed claim u79 outcomes {"distil":{"u0_u1_n7":"frame"}} carriers {"distil":["u0_u1_n9","u0_ax2","g0"]}

- X: x32 [u90] not_a_condition (general, medium) clause "Do we know whether any of the 2,300 failed checkouts were retried successfully?" → claim - ""
  Y: y31 [u90] set (R2, low) clause "whether any of the 2,300 failed checkouts were retried successfully" → claim u19 "we counted about 2,300 failed checkouts in that window"
  context: phase3 c12 [u90,u91,u93,u94] set/agreed claim u95 outcomes {"distil":{"u0_u1_n11":"linked","u0_ax2":"separated"}} carriers {"distil":["u0_u1_n10"]}

- X: x33 [u91] claim (R4, medium) clause "If most people retried" → claim u95 "Kenji, can you draft the customer email either way?"
  Y: y32 [u91] set (R1, medium) clause "If most people retried" → claim u95 "can you draft the customer email either way?"
  context: phase3 c12 [u90,u91,u93,u94] set/agreed claim u95 outcomes {"distil":{"u0_u1_n11":"linked","u0_ax2":"separated"}} carriers {"distil":["u0_u1_n10"]}

- X: x34 [u93] claim (R2, medium) clause "nobody has looked yet" → claim u90 "whether any of the 2,300 failed checkouts were retried successfully"
  Y: y33 [u93] set (R2, medium) clause "nobody has looked yet" → claim u94 "That's an open question too, then."
  context: phase3 c12 [u90,u91,u93,u94] set/agreed claim u95 outcomes {"distil":{"u0_u1_n11":"linked","u0_ax2":"separated"}} carriers {"distil":["u0_u1_n10"]}

- X: x35 [u94] claim (general, medium) clause "That's an open question too" → claim u90 "whether any of the 2,300 failed checkouts were retried successfully"
  Y: y34 [u94] claim (general, medium) clause "an open question too" → claim u90 "Do we know whether any of the 2,300 failed checkouts were retried successfully?"
  context: phase3 c12 [u90,u91,u93,u94] set/agreed claim u95 outcomes {"distil":{"u0_u1_n11":"linked","u0_ax2":"separated"}} carriers {"distil":["u0_u1_n10"]}

- X: x37 [u77] set (R1, low) clause "to the next review on April 2" → claim u76 "could you pull the incidents from the last six months"
  Y: y36 [u77] set (R1, medium) clause "Bring it to the next review on April 2." → claim u76 "see whether late-Friday deploys are over-represented"

## Found by X only

- x5 [u30] not_a_condition (general, medium) clause "both during the payment provider's own maintenance" → claim - ""
  context: phase3 c3 [u30,u31] set/agreed claim u33 outcomes {"distil":{"u0_u0_n10":"carried","u0_u0_n11":"linked","u0_ax1":"separated"}} carriers {"distil":["u0_u0_n10"]}

- x36 [u19] set (R2, low) clause "about 2,300" → claim u19 "we counted about 2,300 failed checkouts in that window"

## Found by Y only

- y35 [u35] set (R1, medium) clause "by Wednesday, March 19" → claim u33 "we'll lower the checkout error-rate alert to 5% over 5 minutes"

