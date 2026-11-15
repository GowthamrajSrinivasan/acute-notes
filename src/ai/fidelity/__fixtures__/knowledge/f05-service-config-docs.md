# Running the ingest worker

## Configuration

The worker reads its settings from `config/ingest.yaml` at start-up. Set `batch_size` to at most 500; larger batches are rejected by the queue. The `retry.max_attempts` value defaults to 3 and must not be lowered below 1.

```yaml
queue:
  url: amqp://localhost:5672
batch_size: 200
retry:
  max_attempts: 3
  backoff_ms: 1500
```

## Starting it

Run the worker with Node 20.11 or later. On Windows hosts the worker runs as a service named `IngestWorker`; elsewhere it runs under systemd.

```bash
npm run ingest -- --config config/ingest.yaml
```

## Logs

Logs are written to `/var/log/ingest/worker.log` and rotated daily. The Grafana board "Ingest health" reads the same file through Promtail.
