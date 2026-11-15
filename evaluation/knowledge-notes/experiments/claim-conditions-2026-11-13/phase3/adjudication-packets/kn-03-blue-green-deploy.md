# Adjudication packet: kn-03-blue-green-deploy

## Source units (id [heading path] text)
u1 [Blue-green deployment for the orders service] This tutorial walks through a blue-green release of `orders-api`, a fictional web service, from a fresh build to a cleaned-up environment.
u2 [Blue-green deployment for the orders service] It assumes you already run the service behind a load balancer.
u3 [Blue-green deployment for the orders service › How blue-green works] You keep two identical production environments, called blue and green.
u4 [Blue-green deployment for the orders service › How blue-green works] One of them serves all live traffic while the other sits idle; you deploy the new version to the idle one, test it there, and then move traffic over in one step.
u5 [Blue-green deployment for the orders service › How blue-green works] Because the old environment is still running, going back is the same one-step switch.
u6 [Blue-green deployment for the orders service › How blue-green works] The cost is running twice the infrastructure during a release, which is why the idle environment is scaled down between releases.
u7 [Blue-green deployment for the orders service › Before you start] You need the following in place before the first release:
u8 [Blue-green deployment for the orders service › Before you start] Two identical environments, `orders-blue` and `orders-green`, with the same instance count, instance size and configuration.
u9 [Blue-green deployment for the orders service › Before you start] A health endpoint, `GET /healthz`, that returns `200` only when the service can reach its database and its queue.
u10 [Blue-green deployment for the orders service › Before you start] Database migrations that are backward compatible, so the old version keeps working against the new schema. This is a hard requirement: both versions share one database, and a rollback does not undo a migration.
u11 [Blue-green deployment for the orders service › Before you start] Access to the load balancer's listener rules, because the switch is a change to which target group the listener forwards to.
u12 [Blue-green deployment for the orders service › Before you start] A dashboard or query that shows the 5xx error rate per environment, so you can tell green's errors from blue's.
u13 [Blue-green deployment for the orders service › Before you start] If any migration is not backward compatible, do not use this procedure; split the migration into an additive release first and a cleanup release later.
u14 [Blue-green deployment for the orders service › Steps] In this walkthrough blue is live and green is idle.
u15 [Blue-green deployment for the orders service › Steps] **Deploy to the idle environment.** Deploy version `2.8.0` to `orders-green`, using the same build artifact that passed staging rather than a fresh build. Expected result: all green instances report the new version, and blue still serves 100% of traffic.
u16 [Blue-green deployment for the orders service › Steps] **Run the migrations.** Apply the database migrations from the new release, once, from a single job rather than from every green instance at startup. Expected result: the migration job exits with code 0, and blue keeps serving requests without new errors, which confirms the change is backward compatible.
u17 [Blue-green deployment for the orders service › Steps] **Check health on green.** Poll the health endpoint on every green instance until all of them return `200`. If any instance is still failing health checks after 10 minutes, stop here and roll back: tear down green and leave blue serving traffic. Nothing has been switched yet, so customers are unaffected.
u18 [Blue-green deployment for the orders service › Steps] **Smoke-test green.** Send the smoke-test suite to green's internal address. Expected result: all smoke tests pass. If one fails, treat it like a failed health check and stop.
u19 [Blue-green deployment for the orders service › Steps] **Switch traffic.** Point the listener at the green target group:
u20 [Blue-green deployment for the orders service › Steps] aws elbv2 modify-listener \ --listener-arn "$ORDERS_LISTENER_ARN" \ --default-actions Type=forward,TargetGroupArn="$GREEN_TG_ARN"
u21 [Blue-green deployment for the orders service › Steps] Expected result: within about 30 seconds, new requests are served by green, and blue receives no new connections.
u22 [Blue-green deployment for the orders service › Steps] **Watch the error rate.** Observe the 5xx error rate on green for 15 minutes after the switch. If the error rate rises above 2% at any point in that window, switch back: run the same command with `$BLUE_TG_ARN`, which returns all traffic to blue within about 30 seconds. If it stays at or below 2%, continue.
u23 [Blue-green deployment for the orders service › Steps] **Keep blue as a standby.** Leave blue running, unchanged, for 24 hours. It is your rollback target until then.
u24 [Blue-green deployment for the orders service › Steps] **Retire blue.** After 24 hours without a switch-back, scale blue down. Blue becomes the idle environment for the next release, with the roles reversed.
u25 [Blue-green deployment for the orders service › When things go wrong] A rollback before step 5 is cheap, because customers never saw green.
u26 [Blue-green deployment for the orders service › When things go wrong] A switch-back after step 5 is also fast, but requests that were in flight on green during the switch may fail and need a client retry.
u27 [Blue-green deployment for the orders service › When things go wrong] Neither kind of rollback reverts the database, which is why the backward-compatible migration requirement matters.
u28 [Blue-green deployment for the orders service › When things go wrong] Whichever way you roll back, record what failed before trying again, because a second attempt with the same build tends to fail the same way.
u29 [Blue-green deployment for the orders service › When things go wrong] Do not run the next release's migrations while blue is still on standby.
u30 [Blue-green deployment for the orders service › When things go wrong] If you do, the standby may no longer work against the schema, and the switch-back stops being a safe option.
u31 [Blue-green deployment for the orders service › When things go wrong] That's all there is to it. Happy deploying!

## Candidates with every reading

### c1: condition units u2
- R1 (phase 2 blind reviewer) r14: claim u1, binding set — Assumes the service already runs behind a load balancer.
- R2 (blind): set, claim u1 (medium) — condition "It assumes you already run the service behind a load balancer." / claim "This tutorial walks through a blue-green release of `orders-api`" — A prerequisite scoping the whole tutorial; no single claim becomes false without it.

### c2: condition units u6
- R1 (phase 2 blind reviewer) r13: claim u3+u4, binding set — Costs twice the infrastructure during a release; idle environment scaled down between releases.
- R2 (blind): set, claim u3+u4 (high) — condition "The cost is running twice the infrastructure during a release" / claim "You keep two identical production environments, called blue and green." — A cost of the approach; the description stays true.

### c3: condition units u9
- R1 (phase 2 blind reviewer) r3: claim u9, binding claim — Returns 200 only when the service can reach its database and its queue.
- R2 (blind): set, claim u17 (medium) — condition "returns `200` only when the service can reach its database and its queue" / claim "Poll the health endpoint on every green instance until all of them return `200`." — A prerequisite on what the health check means; the health gate relies on it, but the step itself stays true.

### c4: condition units u10, u27
- R1 (phase 2 blind reviewer) r1: claim u5, binding claim — Rollback does not revert the database; both versions share one DB, so migrations must be backward compatible for the switch-back to work.
- R2 (blind): claim, claim u5 (high) — condition "Database migrations that are backward compatible, so the old version keeps working against the new schema. This is a hard requirement: both versions share one database, and a rollback does not undo a migration." / claim "Because the old environment is still running, going back is the same one-step switch." — With a non-backward-compatible migration, switching back to blue does not restore a working service.

### c5: condition units u13
- GOLDEN dataset link ku.non-compatible → ku.prereq-migrations: claim u10 — If any migration is not backward compatible, do not use this procedure; split it into an additive release and a later cleanup release.
- R1 (phase 2 blind reviewer) r2: claim u16, binding claim — If any migration is not backward compatible, do not use this procedure; split it into an additive release and a later cleanup release.
- R2 (blind): claim, claim u4+u5 (medium) — condition "If any migration is not backward compatible, do not use this procedure" / claim "you deploy the new version to the idle one, test it there, and then move traffic over in one step" — Excludes the whole procedure in that case; overlaps c4.

### c6: condition units u15
- R1 (phase 2 blind reviewer) r4: claim u15, binding claim — Use the same build artifact that passed staging, not a fresh build.
- R2 (blind): set, claim u15 (low) — condition "using the same build artifact that passed staging rather than a fresh build" / claim "Deploy version `2.8.0` to `orders-green`" — A constraint on how to perform the step; could also be read as procedural detail (not_a_condition).

### c7: condition units u16
- R1 (phase 2 blind reviewer) r5: claim u16, binding claim — Once, from a single job, not from every green instance at startup.
- R2 (blind): set, claim u16 (medium) — condition "once, from a single job rather than from every green instance at startup" / claim "Apply the database migrations from the new release" — A constraint on running migrations; the step stays true but must carry it.

### c8: condition units u17
- R1 (phase 2 blind reviewer) r6: claim u17, binding claim — If any instance still fails after 10 minutes, stop and roll back (tear down green, blue keeps serving).
- R2 (blind): claim, claim u17 (medium) — condition "If any instance is still failing health checks after 10 minutes, stop here and roll back: tear down green and leave blue serving traffic." / claim "Poll the health endpoint on every green instance until all of them return `200`." — Without the 10-minute stop-and-roll-back rule the step implies waiting indefinitely and then proceeding to the switch.

### c9: condition units u18
- R1 (phase 2 blind reviewer) r7: claim u18, binding claim — If any smoke test fails, treat it as a failed health check and stop.
- R2 (blind): claim, claim u18 (medium) — condition "If one fails, treat it like a failed health check and stop." / claim "Send the smoke-test suite to green's internal address. Expected result: all smoke tests pass." — Gate on proceeding to the traffic switch.

### c10: condition units u22
- R1 (phase 2 blind reviewer) r8: claim u22, binding claim — If the 5xx rate exceeds 2% at any point in the 15-minute window, switch back to blue ($BLUE_TG_ARN); continue only if at or below 2%.
- R2 (blind): claim, claim u22 (medium) — condition "If the error rate rises above 2% at any point in that window, switch back" / claim "Observe the 5xx error rate on green for 15 minutes after the switch." — The threshold and window define when to roll back; 'continue' is true only if the rate stays at or below 2%.

### c11: condition units u23, u24
- R1 (phase 2 blind reviewer) r9: claim u24, binding claim — Only after 24 hours on standby without a switch-back.
- R2 (blind): claim, claim u5 (medium) — condition "Leave blue running, unchanged, for 24 hours. It is your rollback target until then." / claim "Because the old environment is still running, going back is the same one-step switch." — One-step switch-back holds only while blue is still running, i.e. for the 24-hour standby.

### c12: condition units u25
- R1 (phase 2 blind reviewer) r12: claim u25, binding claim — Only before step 5 (the traffic switch).
- R2 (blind): claim, claim u25 (low) — condition "before step 5" / claim "A rollback before step 5 is cheap, because customers never saw green." — Intra-sentence scope; the cheapness claim is false after step 5. Could also be read as just a statement, not a limit.

### c13: condition units u26
- R1 (phase 2 blind reviewer) r11: claim u22, binding set — After step 5, requests in flight on green during the switch may fail and need a client retry.
- R2 (blind): set, claim u26 (medium) — condition "requests that were in flight on green during the switch may fail and need a client retry" / claim "A switch-back after step 5 is also fast" — A cost of a late switch-back; it is still fast.

### c14: condition units u29, u30
- R1 (phase 2 blind reviewer) r10: claim u23, binding claim — Do not run the next release's migrations while blue is on standby, or the standby may not work against the schema and switch-back stops being safe.
- R2 (blind): claim, claim u23 (medium) — condition "Do not run the next release's migrations while blue is still on standby. If you do, the standby may no longer work against the schema, and the switch-back stops being a safe option." / claim "It is your rollback target until then." — Blue is not a safe rollback target if the next release's migrations run during standby.

