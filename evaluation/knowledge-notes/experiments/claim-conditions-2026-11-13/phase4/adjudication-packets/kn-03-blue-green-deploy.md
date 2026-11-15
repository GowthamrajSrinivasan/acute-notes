# Phase 4 adjudication packet: kn-03-blue-green-deploy

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

Note set(s): ../phase2/packets/kn-03-blue-green-deploy.md (distil)

## Matched pairs (X and Y found the same clause)

- X: x1 [u2] set (R5, medium) clause "It assumes you already run the service behind a load balancer." → claim u1 "This tutorial walks through a blue-green release of `orders-api`"
  Y: y1 [u2] set (R5, medium) clause "It assumes you already run the service behind a load balancer." → claim u1 "This tutorial walks through a blue-green release of `orders-api`"
  context: phase3 c1 [u2] set/agreed claim u1 outcomes {"distil":{"u4_n1":"separated","u4_a1":"carried"}} carriers {"distil":["u4_n2","u4_a1"]}

- X: x2 [u6] set (R3, medium) clause "The cost is running twice the infrastructure during a release" → claim u3 "You keep two identical production environments, called blue and green."
  Y: y2 [u6] set (R3, medium) clause "The cost is running twice the infrastructure during a release" → claim u3 "You keep two identical production environments, called blue and green."
  context: phase3 c2 [u6] set/agreed claim u3+u4 outcomes {"distil":{"u0_n1":"carried"}} carriers {"distil":["u0_n1"]}

- X: x3 [u9] claim (R1, high) clause "only when the service can reach its database and its queue" → claim u9 "A health endpoint, `GET /healthz`, that returns `200`"
  Y: y4 [u9] claim (R1, high) clause "only when the service can reach its database and its queue" → claim u9 "A health endpoint, `GET /healthz`, that returns `200`"
  context: phase3 c3 [u9] claim/adjudicated claim u9 outcomes {"distil":{"u1_n2":"carried"}} carriers {"distil":["u1_n2"]}

- X: x4 [u10] claim (R1, high) clause "that are backward compatible" → claim u10 "Database migrations"
  Y: y5 [u10] claim (R1, high) clause "backward compatible, so the old version keeps working against the new schema" → claim u16 "Apply the database migrations from the new release"
  context: phase3 c4 [u10,u27] claim/agreed claim u5 outcomes {"distil":{"u0_n1":"separated","u0_n2":"separated"}} carriers {"distil":["u1_n3","u3_n3"]}

- X: x5 [u10] claim (R3, high) clause "a rollback does not undo a migration" → claim u5 "Because the old environment is still running, going back is the same one-step switch."
  Y: y6 [u10] claim (general, high) clause "a rollback does not undo a migration" → claim u5 "Because the old environment is still running, going back is the same one-step switch."
  context: phase3 c4 [u10,u27] claim/agreed claim u5 outcomes {"distil":{"u0_n1":"separated","u0_n2":"separated"}} carriers {"distil":["u1_n3","u3_n3"]}

- X: x6 [u13] claim (R1, medium) clause "If any migration is not backward compatible, do not use this procedure" → claim u1 "This tutorial walks through a blue-green release of `orders-api`, a fictional web service, from a fresh build to a cleaned-up environment."
  Y: y7 [u13] claim (R1, high) clause "If any migration is not backward compatible, do not use this procedure" → claim u4 "you deploy the new version to the idle one, test it there, and then move traffic over in one step"
  context: phase3 c5 [u13] claim/adjudicated claim u4+u16 outcomes {"distil":{"u0_n1":"separated","u2_n4":"separated"}} carriers {"distil":["u1_n3"]}

- X: x7 [u15] claim (R1, high) clause "using the same build artifact that passed staging rather than a fresh build" → claim u15 "Deploy version `2.8.0` to `orders-green`"
  Y: y8 [u15] claim (R1, high) clause "using the same build artifact that passed staging rather than a fresh build" → claim u15 "Deploy version `2.8.0` to `orders-green`"
  context: phase3 c6 [u15] ambiguous/unresolved claim u15 outcomes {"distil":{"u2_n2":"carried"}} carriers {"distil":["u2_n2"]}

- X: x8 [u16] claim (R1, high) clause "once, from a single job rather than from every green instance at startup" → claim u16 "Apply the database migrations from the new release"
  Y: y9 [u16] claim (R1, high) clause "once, from a single job rather than from every green instance at startup" → claim u16 "Apply the database migrations from the new release"
  context: phase3 c7 [u16] ambiguous/unresolved claim u16 outcomes {"distil":{"u2_n4":"carried"}} carriers {"distil":["u2_n4"]}

- X: x9 [u17] claim (R1, high) clause "until all of them return `200`" → claim u17 "Poll the health endpoint on every green instance"
  Y: y10 [u17] claim (R1, medium) clause "until all of them return `200`" → claim u19 "Point the listener at the green target group"
  context: phase3 c8 [u17] claim/agreed claim u17 outcomes {"distil":{"u2_n6":"carried"}} carriers {"distil":["u2_n6"]}

- X: x10 [u17] claim (R1, high) clause "If any instance is still failing health checks after 10 minutes, stop here and roll back" → claim u17 "Poll the health endpoint on every green instance until all of them return `200`."
  Y: y11 [u17] claim (R1, high) clause "If any instance is still failing health checks after 10 minutes, stop here and roll back" → claim u17 "Poll the health endpoint on every green instance until all of them return `200`."
  context: phase3 c8 [u17] claim/agreed claim u17 outcomes {"distil":{"u2_n6":"carried"}} carriers {"distil":["u2_n6"]}

- X: x11 [u18] claim (R1, high) clause "If one fails, treat it like a failed health check and stop." → claim u18 "Send the smoke-test suite to green's internal address."
  Y: y12 [u18] claim (R1, high) clause "If one fails, treat it like a failed health check and stop." → claim u19 "Point the listener at the green target group"
  context: phase3 c9 [u18] claim/agreed claim u18 outcomes {"distil":{"u2_n8":"carried"}} carriers {"distil":["u2_n8","u2_a2"]}

- X: x12 [u22] claim (R1, medium) clause "for 15 minutes after the switch" → claim u22 "Observe the 5xx error rate on green"
  Y: y13 [u22] claim (R1, medium) clause "for 15 minutes after the switch" → claim u22 "Observe the 5xx error rate on green"
  context: phase3 c10 [u22] claim/agreed claim u22 outcomes {"distil":{"u2_n13":"carried"}} carriers {"distil":["u2_n13","u2_a2"]}

- X: x13 [u22] claim (R1, high) clause "If the error rate rises above 2% at any point in that window, switch back" → claim u22 "Observe the 5xx error rate on green for 15 minutes after the switch."
  Y: y14 [u22] claim (R1, high) clause "If the error rate rises above 2% at any point in that window, switch back" → claim u22 "Observe the 5xx error rate on green for 15 minutes after the switch."
  context: phase3 c10 [u22] claim/agreed claim u22 outcomes {"distil":{"u2_n13":"carried"}} carriers {"distil":["u2_n13","u2_a2"]}

- X: x14 [u23] claim (R1, high) clause "for 24 hours" → claim u23 "Leave blue running, unchanged"
  Y: y16 [u23] claim (R1, high) clause "for 24 hours" → claim u23 "Leave blue running, unchanged"
  context: phase3 c11 [u23,u24] claim/adjudicated claim u24+u5 outcomes {"distil":{"u2_n17":"carried","u2_a3":"carried","u0_n1":"separated","u0_n2":"separated"}} carriers {"distil":["u2_n17","u2_n15","u2_a3","g2"]}

- X: x15 [u23] claim (R5, medium) clause "unchanged" → claim u23 "Leave blue running"
  Y: y17 [u23] claim (R5, medium) clause "unchanged" → claim u23 "Leave blue running"
  context: phase3 c11 [u23,u24] claim/adjudicated claim u24+u5 outcomes {"distil":{"u2_n17":"carried","u2_a3":"carried","u0_n1":"separated","u0_n2":"separated"}} carriers {"distil":["u2_n17","u2_n15","u2_a3","g2"]}

- X: x16 [u24] claim (R1, high) clause "After 24 hours without a switch-back" → claim u24 "scale blue down"
  Y: y18 [u24] claim (R1, high) clause "After 24 hours without a switch-back" → claim u24 "scale blue down"
  context: phase3 c11 [u23,u24] claim/adjudicated claim u24+u5 outcomes {"distil":{"u2_n17":"carried","u2_a3":"carried","u0_n1":"separated","u0_n2":"separated"}} carriers {"distil":["u2_n17","u2_n15","u2_a3","g2"]}

- X: x17 [u25] claim (general, high) clause "before step 5" → claim u25 "A rollback before step 5 is cheap"
  Y: y19 [u25] claim (general, high) clause "before step 5" → claim u25 "A rollback before step 5 is cheap"
  context: phase3 c12 [u25] claim/agreed claim u25 outcomes {"distil":{"u3_n1":"carried"}} carriers {"distil":["u3_n1"]}

- X: x18 [u26] claim (R3, medium) clause "but requests that were in flight on green during the switch may fail and need a client retry" → claim u26 "A switch-back after step 5 is also fast"
  Y: y20 [u26] set (R3, medium) clause "but requests that were in flight on green during the switch may fail and need a client retry" → claim u26 "A switch-back after step 5 is also fast"
  context: phase3 c13 [u26] set/adjudicated claim u26+u22 outcomes {"distil":{"u3_n2":"carried","u2_n13":"separated"}} carriers {"distil":["u3_n2"]}

- X: x19 [u27] claim (R3, high) clause "Neither kind of rollback reverts the database" → claim u5 "Because the old environment is still running, going back is the same one-step switch."
  Y: y21 [u27] claim (general, high) clause "Neither kind of rollback reverts the database" → claim u5 "going back is the same one-step switch"
  context: phase3 c4 [u10,u27] claim/agreed claim u5 outcomes {"distil":{"u0_n1":"separated","u0_n2":"separated"}} carriers {"distil":["u1_n3","u3_n3"]}

- X: x20 [u29] ambiguous (R4, medium) clause "while blue is still on standby" → claim u29+u16 "Do not run the next release's migrations" | A: claim, linked to u29 itself: without the clause the instruction becomes a blanket ban on running the next release's migrations | B: claim, linked to u16 'Apply the database migrations from the new release': the clause restricts when that step may run in the next release | Q: Is the claim the clause limits the prohibition in u29 itself, or the migration step in u16 that it gates?
  Y: y22 [u29] claim (R1, medium) clause "Do not run the next release's migrations while blue is still on standby." → claim u16 "Apply the database migrations from the new release"
  context: phase3 c14 [u29,u30] claim/agreed claim u23 outcomes {"distil":{"u2_n15":"separated"}} carriers {"distil":["u3_n5","u3_n6","g3"]}

- X: x21 [u30] claim (R4, medium) clause "If you do, the standby may no longer work against the schema, and the switch-back stops being a safe option" → claim u5 "Because the old environment is still running, going back is the same one-step switch."
  Y: y23 [u30] not_a_condition (general, medium) clause "the standby may no longer work against the schema, and the switch-back stops being a safe option" → claim - ""
  context: phase3 c14 [u29,u30] claim/agreed claim u23 outcomes {"distil":{"u2_n15":"separated"}} carriers {"distil":["u3_n5","u3_n6","g3"]}

## Found by X only

## Found by Y only

- y3 [u6] set (R1, low) clause "the idle environment is scaled down between releases" → claim u3 "You keep two identical production environments"
  context: phase3 c2 [u6] set/agreed claim u3+u4 outcomes {"distil":{"u0_n1":"carried"}} carriers {"distil":["u0_n1"]}

- y15 [u22] claim (R1, low) clause "If it stays at or below 2%, continue." → claim u23 "Leave blue running, unchanged, for 24 hours."
  context: phase3 c10 [u22] claim/agreed claim u22 outcomes {"distil":{"u2_n13":"carried"}} carriers {"distil":["u2_n13","u2_a2"]}

