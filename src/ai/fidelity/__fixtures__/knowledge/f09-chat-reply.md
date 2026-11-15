Great question! Here's a breakdown of how to choose a message queue for your order events.

## 1. What you actually need

- **Ordering:** if events for one order must be processed in sequence, you need per-key ordering (Kafka partitions or SQS FIFO message groups).
- **Throughput:** at around 2,000 events per second, any of the options below will cope.
- **Replay:** only Kafka keeps events after they are consumed, so it is the only option here that lets you rebuild a projection from history.

## 2. Comparison

| Option | Ordering | Replay | Operations |
|---|---|---|---|
| Kafka | Per partition | Yes, retention-based | Heavy unless managed |
| SQS FIFO | Per message group | No | Fully managed |
| RabbitMQ | Per queue, single consumer | No | Moderate |

## 3. My recommendation

If you are already on AWS and don't need replay, SQS FIFO is usually the simplest choice. Choose Kafka when replay matters more than operational effort.

Hope this helps — let me know if you want a sample consumer!
