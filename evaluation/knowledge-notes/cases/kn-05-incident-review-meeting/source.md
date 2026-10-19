# Post-incident review: checkout outage, March 14

Attendees: Dana (facilitator), Marcus (on-call SRE), Leila (payments backend lead), Tomás (release engineering), Kenji (customer support lead)

---

Dana: Okay, I think everyone's here. Did people manage to grab coffee? The machine on four is broken again.

Kenji: I brought my own. Lesson learned.

Dana: Smart. Right, let's start. This is the blameless review for the checkout outage on Friday, March 14. Marcus, can you walk us through the timeline?

Marcus: Sure. At 16:40 a config change to the payments service went out. It changed the gateway connection pool from 50 connections to 5. That was a typo; the intent was 55. Checkout requests started queuing for a connection and timing out almost immediately.

Marcus: Our error-rate alert fired at 17:02, so 22 minutes after the change. I rolled the config back at 17:15, and checkout was fully recovered at 17:27. So customers saw errors for 47 minutes in total.

Kenji: And on our side, we counted about 2,300 failed checkouts in that window. Support got 140 tickets before we posted the status page.

Dana: Why did the alert take 22 minutes?

Marcus: The alert only fires when the checkout error rate is above 10% for 15 minutes. Errors went over 10% around 16:47, so the earliest it could fire was 17:02. It did exactly what it was configured to do.

Leila: Which is too slow for checkout. 15 minutes of sustained errors is a long time when every minute is lost revenue.

Dana: Fair. What do we want instead?

Marcus: I'd propose 5% over 5 minutes for checkout specifically. I checked the last 30 days and that would have paged twice on noise, both during the payment provider's own maintenance.

Leila: Two noisy pages a month is fine for checkout.

Dana: Anyone against? ... Okay. Agreed: we'll lower the checkout error-rate alert to 5% over 5 minutes. Marcus, can you own that?

Marcus: Yes. I'll have it changed by Wednesday, March 19.

Kenji: One more thing from support. The status page went up at 17:20, which is 40 minutes after the errors started. Customers were asking on social media before we said anything.

Dana: Who posts the status page today?

Kenji: Whoever is incident commander, when they remember. On Friday that was Marcus, and he was busy rolling back.

Marcus: Honestly, it was the last thing on my mind.

Dana: Should support be allowed to post it directly?

Kenji: I'd like that, yes.

Leila: No objection from me.

Dana: Agreed: support can post a status-page update directly, without waiting for the incident commander.

Dana: Great. Next, how did a config value like that get through?

Leila: Config changes don't go through code review. They're edited in the deploy dashboard and applied directly. Code changes need two approvals; config needs none.

Tomás: That's the real gap. A typo in code would have been caught by the reviewer or by a test.

Dana: So the proposal is that payments config goes through the same review as code?

Leila: Yes. Config lives in the repo, it gets a pull request, and it needs one approval from the payments team.

Tomás: I'm fine with that.

Marcus: Same.

Dana: Agreed: config changes to the payments service will go through pull-request review with one payments-team approval. Leila, can you set that up?

Leila: I'll move the config into the repo and add the approval rule by Friday, March 21.

Tomás: Can I raise something else? I'd like us to stop deploying anything to payments after 15:00 on Fridays. This went out at 16:40 on a Friday, and half the team had already logged off.

Leila: I don't agree with that. A freeze just moves the risk to Monday morning, when traffic is higher. The problem here wasn't the day, it was that nobody reviewed the change.

Tomás: The review fixes this one cause. But fewer people around means slower recovery for any cause.

Leila: Recovery took 25 minutes after the alert, and Marcus was on call. Being Friday didn't slow that down.

Tomás: That's one incident. I think we'd see a pattern if we looked.

Dana: I don't think we're going to settle this today. Let's not decide the freeze now. Tomás, could you pull the incidents from the last six months and see whether late-Friday deploys are over-represented? Bring it to the next review on April 2.

Tomás: Sure, I can do that.

Marcus: While we're on prevention, I'd also propose automatic rollback: if the checkout error rate doubles within 10 minutes of a deploy, the pipeline rolls back on its own.

Leila: For config, maybe. For code, I'm nervous. If a release includes a database migration, rolling back the code without the migration can leave us worse off.

Marcus: We could exclude releases with migrations.

Leila: Possibly. I'd want to know how often we ship migrations before I agree to anything.

Dana: Okay, so auto-rollback is an open question. We don't know how many releases include migrations. Let's leave it open.

Kenji: Can I go back to customers? Do we know whether any of the 2,300 failed checkouts were retried successfully? If most people retried, the email we send is different.

Marcus: I don't know. The payment logs would show it, but nobody has looked yet.

Dana: That's an open question too, then. Kenji, can you draft the customer email either way?

Kenji: Yes, I'll take the email draft.

Marcus: So just to recap the timeline again for the doc: the change went out at 16:40, the alert fired at 17:02, rollback at 17:15, recovered at 17:27.

Dana: Thanks. Anything else? ... Okay. Good review, everyone. And someone please report the coffee machine.
