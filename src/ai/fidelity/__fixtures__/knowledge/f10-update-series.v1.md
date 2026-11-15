# Feature flag rollout

## Rollout steps

New flags start disabled in production. A flag is enabled for internal users first. After one day without errors, it is enabled for 5% of customers.

## Ownership

Each flag has one owning team. The owning team removes the flag within 30 days of full rollout.

## Monitoring

Error rates are compared with the previous day. Error rates are compared with the previous day. A rise above 2% pauses the rollout automatically.

## Old process

Flags were once toggled by editing a config file by hand.
