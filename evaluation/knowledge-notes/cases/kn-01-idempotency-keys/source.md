# Idempotency keys

An idempotency key is a unique value that a client attaches to a request so that the server can recognise a retry of the same operation. If the server has already completed a request with that key, it returns the stored result instead of performing the operation again.

For example, a checkout client sends `Idempotency-Key: 7f3c-91ab` with a payment request. The connection drops before the response arrives, so the client retries with the same key. The server finds the stored result for `7f3c-91ab` and returns the original confirmation, and the customer is charged once.

Keys only protect against duplicates while the server still remembers them. In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment. Keys also do not make two different requests safe: if a client reuses a key with a different amount, the server must reject the request rather than return the old result.

In short, idempotency keys make retries safe within a bounded window; they are not a general guarantee against duplicate operations.
