# Packet kn-03-blue-green-deploy

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
subtitle [heading] (no cites) :: Blue-green deployment for orders service: setup, steps, and rollback.
g0 [group] (no cites) :: How blue-green works | stack | Blue-green deployments use two identical environments for safe, zero-downtime releases.
u0_n1 [text] in g0 cites=u3,u4,u5,u6 :: You keep two identical production environments, called blue and green. One of them serves all live traffic while the other sits idle; you deploy the new version to the idle one, test it there, and then move traffic over in one step. Because the old environment is still running, going back is the same one-step switch. The cost is running twice the infrastructure during a release, which is why the idle environment is scaled down between releases.
u0_n2 [text] in g0 (no cites) :: These environments are identical to ensure consistency. This allows for zero-downtime deployments and easy rollback. This is a key benefit of blue-green deployments, enabling rapid recovery from issues. Scaling down helps manage costs, but the infrastructure still incurs some expense.
u0_a1 [text] in g0 (no cites) :: The annotations clarify the 'why' and 'how' behind each step of the blue-green deployment process, adding depth to the initial description. They highlight the benefits (zero-downtime, easy rollback) and trade-offs (cost of infrastructure) that are implied but not explicitly stated in the original prose.
g1 [group] (no cites) :: Before you start | grid | Ensure all prerequisites are met before the first release.
u1_n1 [text] in g1 cites=u8 :: You need two identical environments, `orders-blue` and `orders-green`, with the same instance count, size, and configuration.
u1_n2 [text] in g1 cites=u9 :: A `GET /healthz` endpoint is required that returns `200` only when the service can reach its database and queue.
u1_n3 [text] in g1 cites=u10,u13 :: Database migrations must be backward compatible, allowing the old version to function with the new schema. Both versions share one database, and a rollback does not undo a migration. If any migration is not backward compatible, do not use this procedure; instead, split the migration into an additive release first and a cleanup release later.
u1_n4 [text] in g1 cites=u11 :: You need access to the load balancer's listener rules, as the switch involves changing which target group the listener forwards to.
u1_n5 [text] in g1 cites=u12 :: A dashboard or query showing the 5xx error rate per environment is needed to differentiate errors between green and blue environments.
g2 [group] (no cites) :: Steps | chain | Blue/green deployment with rollback points and a 24-hour standby for blue.
u2_n1 [shape] in g2 cites=u15 :: rectangle | 1 · Deploy to idle environment
u2_n2 [text] in g2 cites=u15 :: Deploy version `2.8.0` to `orders-green` using the same build artifact that passed staging. All green instances should report the new version, and blue should still serve 100% of traffic.
u2_n3 [shape] in g2 cites=u16 :: rectangle | 2 · Run migrations
u2_n4 [text] in g2 cites=u16 :: Apply database migrations from the new release once, from a single job. The migration job should exit with code 0, and blue should continue serving requests without new errors, confirming backward compatibility.
u2_n5 [shape] in g2 cites=u17 :: rectangle | 3 · Check health on green
u2_n6 [text] in g2 cites=u17 :: Poll the health endpoint on every green instance until all return `200`. If any instance fails health checks after 10 minutes, stop and roll back by tearing down green, leaving blue to serve traffic.
u2_n7 [shape] in g2 cites=u18 :: rectangle | 4 · Smoke-test green
u2_n8 [text] in g2 cites=u18 :: Send the smoke-test suite to green's internal address. All smoke tests must pass. If one fails, treat it as a failed health check and stop.
u2_n9 [shape] in g2 cites=u19 :: rectangle | 5 · Switch traffic
u2_n10 [code] in g2 cites=u20 :: bash | aws elbv2 modify-listener \ --listener-arn "$ORDERS_LISTENER_ARN" \ --default-actions Type=forward,TargetGroupArn="$GREEN_TG_ARN"
u2_n11 [text] in g2 cites=u21 :: Within about 30 seconds, new requests should be served by green, and blue should receive no new connections.
u2_n12 [shape] in g2 cites=u22 :: rectangle | 6 · Watch error rate
u2_n13 [text] in g2 cites=u22 :: Observe the 5xx error rate on green for 15 minutes. If the error rate rises above 2% at any point, switch back to blue using `$BLUE_TG_ARN` (traffic returns to blue within about 30 seconds). If it stays at or below 2%, continue.
u2_n14 [shape] in g2 cites=u23 :: rectangle | 7 · Keep blue as standby
u2_n15 [text] in g2 cites=u23 :: Leave blue running, unchanged, for 24 hours as a rollback target.
u2_n16 [shape] in g2 cites=u24 :: rectangle | 8 · Retire blue
u2_n17 [text] in g2 cites=u24 :: After 24 hours without a switch-back, scale blue down. Blue then becomes the idle environment for the next release, with roles reversed.
u2_a1 [text] in g2 cites=u14 :: Blue is live, and green is idle.
u2_a2 [text] in g2 (no cites) :: The process includes explicit rollback points if health checks or smoke tests fail, or if the error rate on green exceeds 2% after traffic switch. These ensure customer impact is minimized.
u2_a3 [text] in g2 (no cites) :: The new version is deployed to green, traffic is switched, and blue is retired after a 24-hour standby period, becoming the idle environment for the next release.
g3 [group] (no cites) :: When things go wrong | stack | Understand rollback implications and avoid migrations on standby.
u3_n1 [text] in g3 cites=u25 :: Rolling back before step 5 is inexpensive as customers haven't seen the new version yet.
u3_n2 [text] in g3 cites=u26 :: Switching back after step 5 is quick, but in-flight requests might fail and require client retries.
u3_n3 [text] in g3 cites=u27 :: Neither rollback method reverts the database, emphasizing the importance of backward-compatible migrations.
u3_n4 [text] in g3 cites=u28 :: Always record what caused a failure before retrying, as the same build often fails for the same reason.
u3_n5 [text] in g3 cites=u29 :: Do not run the next release's database migrations while the blue environment is on standby.
u3_n6 [text] in g3 cites=u30 :: Running migrations on standby can make the standby incompatible with the schema, removing the safe switch-back option.
g4 [group] (no cites) :: Blue-green deployment for the orders service | grid | Tutorial for blue-green deployment of `orders-api` from fresh build to cleaned environment.
u4_n1 [text] in g4 cites=u1 :: This tutorial details a blue-green release process for the `orders-api` web service. The process starts from a fresh build and deploys to a cleaned-up environment.
u4_n2 [text] in g4 cites=u2 :: It is assumed that the `orders-api` service is already operating behind a load balancer.
u4_a1 [text] in g4 (no cites) :: This section introduces a tutorial for performing a blue-green deployment of the `orders-api` service. The key aspects covered are the starting state (fresh build) and the target environment (cleaned-up). A prerequisite for this tutorial is an existing load balancer setup for the service.

## Visible arrows (from -> to : label)
u0_n1 -> u0_n2
u2_n1 -> u2_n3
u2_n3 -> u2_n5
u2_n5 -> u2_n7
u2_n7 -> u2_n9
u2_n9 -> u2_n12
u2_n12 -> u2_n14
u2_n14 -> u2_n16
u2_a1 -> u2_n1
u2_a2 -> u2_n5
u2_a2 -> u2_n7
u2_a2 -> u2_n12
u2_a3 -> u2_n16
u3_n5 -> u3_n6 : if violated
g2 -> g3 : rollback scenarios
g4 -> g0 : introduction
