# Clause annotation packet: kn-01-idempotency-keys
## Source units (id [heading path] text)
u1 [Idempotency keys] An idempotency key is a unique value that a client attaches to a request so that the server can recognise a retry of the same operation.
u2 [Idempotency keys] If the server has already completed a request with that key, it returns the stored result instead of performing the operation again.
u3 [Idempotency keys] For example, a checkout client sends `Idempotency-Key: 7f3c-91ab` with a payment request.
u4 [Idempotency keys] The connection drops before the response arrives, so the client retries with the same key.
u5 [Idempotency keys] The server finds the stored result for `7f3c-91ab` and returns the original confirmation, and the customer is charged once.
u6 [Idempotency keys] Keys only protect against duplicates while the server still remembers them.
u7 [Idempotency keys] In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment.
u8 [Idempotency keys] Keys also do not make two different requests safe: if a client reuses a key with a different amount, the server must reject the request rather than return the old result.
u9 [Idempotency keys] In short, idempotency keys make retries safe within a bounded window; they are not a general guarantee against duplicate operations.

## Units to examine (5)
Earlier work flagged these units as possibly condition-bearing. Examine EACH: list every limiting clause in it as its own record (EVAL-SPEC-v3 §1), or one not_a_condition record if it limits nothing. You may also add records for clauses in other units (mark them "additional": true).

u2, u6, u7, u8, u9
