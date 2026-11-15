# Second review packet: kn-01-idempotency-keys

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

## Candidate conditions (the span to judge; its claim link and binding are YOURS to decide)
c1: units u2 :: If the server has already completed a request with that key, it returns the stored result instead of performing the operation again.
c2: units u6, u7 :: Keys only protect against duplicates while the server still remembers them. In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment.
c3: units u8 :: Keys also do not make two different requests safe: if a client reuses a key with a different amount, the server must reject the request rather than return the old result.
c4: units u9 :: In short, idempotency keys make retries safe within a bounded window; they are not a general guarantee against duplicate operations.
