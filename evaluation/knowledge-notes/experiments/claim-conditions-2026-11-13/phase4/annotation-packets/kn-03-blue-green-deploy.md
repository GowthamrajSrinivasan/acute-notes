# Clause annotation packet: kn-03-blue-green-deploy
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

## Units to examine (17)
Earlier work flagged these units as possibly condition-bearing. Examine EACH: list every limiting clause in it as its own record (EVAL-SPEC-v3 §1), or one not_a_condition record if it limits nothing. You may also add records for clauses in other units (mark them "additional": true).

u2, u6, u9, u10, u13, u15, u16, u17, u18, u22, u23, u24, u25, u26, u27, u29, u30
