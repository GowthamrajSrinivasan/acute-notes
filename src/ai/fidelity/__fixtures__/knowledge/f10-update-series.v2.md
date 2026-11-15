# Feature flag rollout

## Rollout stages

New flags start disabled in production. A flag is enabled for internal users first. After one day without errors, it is enabled for 10% of customers.

## Ownership

Each flag has one owning team.

## Monitoring

Error rates are compared with the previous day. A rise above 2% pauses the rollout automatically. The owning team removes the flag within 30 days of full rollout.
