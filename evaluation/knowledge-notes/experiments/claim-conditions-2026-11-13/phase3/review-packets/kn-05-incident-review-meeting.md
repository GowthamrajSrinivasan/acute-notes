# Second review packet: kn-05-incident-review-meeting

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

## Candidate conditions (the span to judge; its claim link and binding are YOURS to decide)
c1: units u22 :: Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes.
c2: units u29 :: Marcus: I'd propose 5% over 5 minutes for checkout specifically.
c3: units u30, u31 :: I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance. Leila: Two noisy pages a month is fine for checkout.
c4: units u55, u56, u57, u58, u59, u60 :: Leila: Yes. Config lives in the repo, it gets a pull request, and it needs one approval from the payments team. Tomás: I'm fine with that. Marcus: Same. Dana: Agreed: config changes to the payments service will go through pull-request review with one payments-team approval. Leila, can you set that up?
c5: units u61, u62 :: Leila: I'll move the config into the repo and add the approval rule by Friday, March 21. Tomás: Can I raise something else?
c6: units u63 :: I'd like us to stop deploying anything to payments after 15:00 on Fridays.
c7: units u71, u72, u73 :: Being Friday didn't slow that down. Tomás: That's one incident. I think we'd see a pattern if we looked.
c8: units u74, u75, u76 :: Dana: I don't think we're going to settle this today. Let's not decide the freeze now. Tomás, could you pull the incidents from the last six months and see whether late-Friday deploys are over-represented?
c9: units u79 :: Marcus: While we're on prevention, I'd also propose automatic rollback: if the checkout error rate doubles within 10 minutes of a deploy, the pipeline rolls back on its own.
c10: units u80, u81, u82, u83 :: Leila: For config, maybe. For code, I'm nervous. If a release includes a database migration, rolling back the code without the migration can leave us worse off. Marcus: We could exclude releases with migrations.
c11: units u86, u87, u88 :: Dana: Okay, so auto-rollback is an open question. We don't know how many releases include migrations. Let's leave it open.
c12: units u90, u91, u93, u94 :: Do we know whether any of the 2,300 failed checkouts were retried successfully? If most people retried, the email we send is different. The payment logs would show it, but nobody has looked yet. Dana: That's an open question too, then.
