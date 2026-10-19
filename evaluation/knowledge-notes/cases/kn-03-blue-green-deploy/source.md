# Blue-green deployment for the orders service

This tutorial walks through a blue-green release of `orders-api`, a fictional web service, from a fresh build to a cleaned-up environment. It assumes you already run the service behind a load balancer.

## How blue-green works

You keep two identical production environments, called blue and green. One of them serves all live traffic while the other sits idle; you deploy the new version to the idle one, test it there, and then move traffic over in one step. Because the old environment is still running, going back is the same one-step switch. The cost is running twice the infrastructure during a release, which is why the idle environment is scaled down between releases.

## Before you start

You need the following in place before the first release:

- Two identical environments, `orders-blue` and `orders-green`, with the same instance count, instance size and configuration.
- A health endpoint, `GET /healthz`, that returns `200` only when the service can reach its database and its queue.
- Database migrations that are backward compatible, so the old version keeps working against the new schema. This is a hard requirement: both versions share one database, and a rollback does not undo a migration.
- Access to the load balancer's listener rules, because the switch is a change to which target group the listener forwards to.
- A dashboard or query that shows the 5xx error rate per environment, so you can tell green's errors from blue's.

If any migration is not backward compatible, do not use this procedure; split the migration into an additive release first and a cleanup release later.

## Steps

In this walkthrough blue is live and green is idle.

1. **Deploy to the idle environment.** Deploy version `2.8.0` to `orders-green`, using the same build artifact that passed staging rather than a fresh build. Expected result: all green instances report the new version, and blue still serves 100% of traffic.

2. **Run the migrations.** Apply the database migrations from the new release, once, from a single job rather than from every green instance at startup. Expected result: the migration job exits with code 0, and blue keeps serving requests without new errors, which confirms the change is backward compatible.

3. **Check health on green.** Poll the health endpoint on every green instance until all of them return `200`. If any instance is still failing health checks after 10 minutes, stop here and roll back: tear down green and leave blue serving traffic. Nothing has been switched yet, so customers are unaffected.

4. **Smoke-test green.** Send the smoke-test suite to green's internal address. Expected result: all smoke tests pass. If one fails, treat it like a failed health check and stop.

5. **Switch traffic.** Point the listener at the green target group:

   ```bash
   aws elbv2 modify-listener \
     --listener-arn "$ORDERS_LISTENER_ARN" \
     --default-actions Type=forward,TargetGroupArn="$GREEN_TG_ARN"
   ```

   Expected result: within about 30 seconds, new requests are served by green, and blue receives no new connections.

6. **Watch the error rate.** Observe the 5xx error rate on green for 15 minutes after the switch. If the error rate rises above 2% at any point in that window, switch back: run the same command with `$BLUE_TG_ARN`, which returns all traffic to blue within about 30 seconds. If it stays at or below 2%, continue.

7. **Keep blue as a standby.** Leave blue running, unchanged, for 24 hours. It is your rollback target until then.

8. **Retire blue.** After 24 hours without a switch-back, scale blue down. Blue becomes the idle environment for the next release, with the roles reversed.

## When things go wrong

A rollback before step 5 is cheap, because customers never saw green. A switch-back after step 5 is also fast, but requests that were in flight on green during the switch may fail and need a client retry. Neither kind of rollback reverts the database, which is why the backward-compatible migration requirement matters. Whichever way you roll back, record what failed before trying again, because a second attempt with the same build tends to fail the same way.

Do not run the next release's migrations while blue is still on standby. If you do, the standby may no longer work against the schema, and the switch-back stops being a safe option.

That's all there is to it. Happy deploying!
