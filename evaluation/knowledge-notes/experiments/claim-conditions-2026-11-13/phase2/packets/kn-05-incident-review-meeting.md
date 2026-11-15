# Packet kn-05-incident-review-meeting

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
g0 [group] (no cites) :: Post-incident review: checkout outage, March 14 | grid | Outage review: Alerting, status page, and config review improved; auto-rollback and Friday freeze open.
u0_u0_n1 [text] in g0 cites=u1 :: Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)
u0_u0_n2 [text] in g0 cites=u9 :: This is a blameless review for the checkout outage on Friday, March 14.
u0_u0_n3 [shape] in g0 (no cites) :: rectangle | Outage Timeline
u0_u0_n4 [text] in g0 cites=u12,u13,u14,u15 :: At 16:40, a configuration change was deployed to the payments service. This change incorrectly set the gateway connection pool from 50 to 5 connections, instead of the intended 55. This typo caused checkout requests to queue and time out.
u0_u0_n5 [text] in g0 cites=u16,u22,u23,u24 :: The error-rate alert for checkout fired at 17:02, 22 minutes after the config change. The alert is configured to fire when the checkout error rate exceeds 10% for 15 minutes. Errors surpassed 10% around 16:47, so the alert functioned as designed. **From the source:** 02 **From the source:** 02
u0_u0_n6 [text] in g0 cites=u17 :: The incorrect configuration was rolled back at 17:15. Checkout functionality was fully restored by 17:27.
u0_u0_n7 [text] in g0 cites=u18,u19,u20 :: Customers experienced errors for a total of 47 minutes. Approximately 2,300 checkout failures were recorded. Customer support received 140 tickets before the status page was updated.
u0_u0_n8 [shape] in g0 (no cites) :: rectangle | Alerting Threshold
u0_u0_n9 [text] in g0 cites=u25,u26 :: The current alert threshold (10% error rate for 15 minutes) is considered too slow for checkout, leading to significant lost revenue.
u0_u0_n10 [text] in g0 cites=u29,u30,u31 :: A new proposal suggests lowering the checkout error-rate alert to 5% over 5 minutes. This change would have resulted in two noisy pages in the last 30 days, both during payment provider maintenance, which is deemed acceptable. **From the source:** twice
u0_u0_n11 [todo] in g0 cites=u33,u35 :: Lower the checkout error-rate alert to 5% over 5 minutes. Owner: Marcus. Due: Wednesday, March 19.
u0_u0_n12 [shape] in g0 (no cites) :: rectangle | Status Page Updates
u0_u0_n13 [text] in g0 cites=u37,u38 :: The status page was updated at 17:20, 40 minutes after errors began. Customers were already discussing the issue on social media before an official update was posted.
u0_u0_n14 [text] in g0 cites=u40,u41,u42 :: Currently, the incident commander is responsible for posting status page updates, but this can be overlooked during critical incident response, as Marcus was busy with the rollback.
u0_u0_n15 [text] in g0 cites=u43,u44,u45 :: Support should be allowed to post status page updates directly, without waiting for the incident commander.
u0_u0_n16 [text] in g0 cites=u46 :: Support will be empowered to post status-page updates directly.
u0_u0_n17 [shape] in g0 (no cites) :: rectangle | Config Change Process
u0_u0_n18 [text] in g0 cites=u49,u50,u51,u52,u53 :: Configuration changes, unlike code changes, do not undergo code review. They are edited and applied directly via the deploy dashboard, making them susceptible to errors like typos. **From the source:** two
u0_u0_n19 [text] in g0 cites=u54 :: The proposal is to subject payments configuration changes to the same review process as code changes.
u0_u1_n1 [text] in g0 cites=u56,u59 :: Config changes to the payments service will require a pull-request review with one approval from the payments team. **From the source:** payments-team
u0_u1_n2 [todo] in g0 cites=u60,u61 :: Move config into the repo and add approval rule by Friday, March 21.
u0_u1_n3 [text] in g0 cites=u62,u63,u64,u69 :: Tomás proposes stopping deployments to payments after 15:00 on Fridays, citing that the incident occurred at 16:40 on a Friday when fewer team members were available, potentially slowing recovery. **From the source:** 00
u0_u1_n4 [text] in g0 cites=u65,u66,u67,u70,u71 :: Leila disagrees with a Friday deployment freeze, arguing it shifts risk to Monday morning when traffic is higher. She believes the issue was lack of review, not the day, and that recovery time for this incident (25 minutes) was not impacted by it being a Friday.
u0_u1_n5 [text] in g0 cites=u68,u69,u72,u73 :: Tomás suggests that while review fixes one cause, fewer people around on Fridays means slower recovery for any cause, and believes a pattern would emerge if more incidents were examined.
u0_u1_n6 [todo] in g0 cites=u74,u75,u76,u77,u78 :: Tomás to pull incidents from the last six months to see if late-Friday deploys are over-represented, and bring findings to the next review on April 2.
u0_u1_n7 [text] in g0 cites=u79 :: Marcus proposes automatic rollback: if the checkout error rate doubles within 10 minutes of a deploy, the pipeline rolls back automatically.
u0_u1_n8 [text] in g0 cites=u80,u81,u82,u83 :: Leila is nervous about automatic rollback for code, especially if a release includes a database migration, as rolling back code without the migration could worsen the situation. Marcus suggests excluding releases with migrations.
u0_u1_n9 [text] in g0 cites=u84,u85,u86,u87,u88 :: Leila wants to know the frequency of database migrations before agreeing to automatic rollback. Dana notes that auto-rollback remains an open question due to unknown migration frequency.
u0_u1_n10 [text] in g0 cites=u89,u90,u91,u92,u93 :: Kenji asks if any of the 2,300 failed checkouts were successfully retried, as this would influence the customer email. Marcus states that payment logs would show this, but no one has checked yet.
u0_u1_n11 [todo] in g0 cites=u94,u95,u96 :: Kenji to draft the customer email.
u0_u1_n12 [text] in g0 cites=u97 :: Timeline recap: change deployed at 16:40, alert at 17:02, rollback at 17:15, recovered at 17:27. **From the source:** 02
u0_ax1 [text] in g0 (no cites) :: - **Alerting Threshold:** Checkout error-rate alert lowered to 5% over 5 minutes. Marcus to implement by March 19. - **Status Page Updates:** Support can directly post status page updates. No specific owner or deadline mentioned. - **Config Change Process:** Payments service config changes require pull-request review with one payments-team approval. Leila to set up by March 21.
u0_ax2 [text] in g0 (no cites) :: - **Friday Deployment Freeze:** Tomás to analyze incidents from the last six months for late-Friday deploy over-representation. - **Automatic Rollback:** Open question due to concerns about database migrations. Leila wants to know migration frequency. - **Failed Checkout Retries:** Kenji to draft customer email; Marcus to investigate if failed checkouts were successfully retried.
u0_ax3 [text] in g0 (no cites) :: - The config change reduced the gateway connection pool from 50 to 5 (intended 55), causing checkout requests to queue and time out. - The alert fired 22 minutes after the config change because the threshold was 10% errors over 15 minutes. - The status page update was delayed by 40 minutes, as the incident commander (Marcus) was focused on rollback. - Config changes currently bypass code review, allowing typos to go unnoticed.
u0_fs1 [text] in g0 cites=u4,u21 :: - The machine on four is broken again. - Dana: Why did the alert take 22 minutes?

## Visible arrows (from -> to : label)
u0_u0_n3 -> u0_u0_n4
u0_u0_n4 -> u0_u0_n5
u0_u0_n5 -> u0_u0_n6
u0_u0_n6 -> u0_u0_n7
u0_u0_n8 -> u0_u0_n9
u0_u0_n9 -> u0_u0_n10 : proposed change
u0_u0_n10 -> u0_u0_n11
u0_u0_n12 -> u0_u0_n13
u0_u0_n13 -> u0_u0_n14
u0_u0_n14 -> u0_u0_n15 : proposed change
u0_u0_n15 -> u0_u0_n16
u0_u0_n17 -> u0_u0_n18
u0_u0_n18 -> u0_u0_n19 : proposed change
u0_u1_n1 -> u0_u1_n2 : action
u0_u1_n3 -> u0_u1_n4 : disagreement
u0_u1_n4 -> u0_u1_n5 : rebuttal
u0_u1_n3 -> u0_u1_n6 : investigation
u0_u1_n7 -> u0_u1_n8 : concerns
u0_u1_n8 -> u0_u1_n9 : dependency
u0_u1_n10 -> u0_u1_n11 : action
u0_ax1 -> u0_u0_n11
u0_ax2 -> u0_u1_n2
u0_ax2 -> u0_u1_n6
u0_ax2 -> u0_u1_n11
u0_ax3 -> u0_u0_n2
