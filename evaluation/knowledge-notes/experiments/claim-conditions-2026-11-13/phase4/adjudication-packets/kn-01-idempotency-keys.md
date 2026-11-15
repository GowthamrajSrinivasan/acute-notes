# Phase 4 adjudication packet: kn-01-idempotency-keys

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

Note set(s): ../phase3/openui-packets/kn-01-idempotency-keys.md (openui-v1, openui-v2)

## Matched pairs (X and Y found the same clause)

- X: x1 [u2] claim (general, high) clause "If the server has already completed a request with that key" → claim u2 "it returns the stored result instead of performing the operation again"
  Y: y1 [u2] claim (general, high) clause "If the server has already completed a request with that key" → claim u2 "it returns the stored result instead of performing the operation again"
  context: phase3 c1 [u2] not_a_condition/adjudicated claim u2

- X: x2 [u6] claim (general, high) clause "while the server still remembers them" → claim u6 "Keys only protect against duplicates"
  Y: y2 [u6] claim (general, high) clause "only protect against duplicates while the server still remembers them" → claim u6 "Keys only protect against duplicates"
  context: phase3 c2 [u6,u7] claim/agreed claim u2 outcomes {"openui-v1":{"v1:g1":"separated","v1:g2":"separated"},"openui-v2":{"v2:g1":"separated","v2:g2":"separated","v2:g4":"separated"}} carriers {"openui-v1":["v1:g3","v1:g5"],"openui-v2":["v2:g6","v2:g7","v2:g9"]}

- X: x3 [u7] claim (general, high) clause "stored results expire after 24 hours, so a retry sent after that window is treated as a new payment" → claim u2 "If the server has already completed a request with that key, it returns the stored result instead of performing the operation again."
  Y: y3 [u7] claim (general, medium) clause "stored results expire after 24 hours, so a retry sent after that window is treated as a new payment" → claim u2 "If the server has already completed a request with that key, it returns the stored result instead of performing the operation again."
  context: phase3 c2 [u6,u7] claim/agreed claim u2 outcomes {"openui-v1":{"v1:g1":"separated","v1:g2":"separated"},"openui-v2":{"v2:g1":"separated","v2:g2":"separated","v2:g4":"separated"}} carriers {"openui-v1":["v1:g3","v1:g5"],"openui-v2":["v2:g6","v2:g7","v2:g9"]}

- X: x5 [u8] claim (R3, medium) clause "Keys also do not make two different requests safe" → claim u2 "If the server has already completed a request with that key, it returns the stored result instead of performing the operation again."
  Y: y4 [u8] claim (R3, high) clause "Keys also do not make two different requests safe" → claim u2 "it returns the stored result instead of performing the operation again"
  context: phase3 c3 [u8] claim/agreed claim u2 outcomes {"openui-v1":{"v1:g2":"separated"},"openui-v2":{"v2:g2":"separated"}} carriers {"openui-v1":["v1:g4"],"openui-v2":["v2:g8"]}

- X: x6 [u8] claim (R1, high) clause "if a client reuses a key with a different amount, the server must reject the request rather than return the old result" → claim u2 "it returns the stored result instead of performing the operation again"
  Y: y5 [u8] claim (R1, medium) clause "if a client reuses a key with a different amount, the server must reject the request rather than return the old result" → claim u2 "it returns the stored result instead of performing the operation again"
  context: phase3 c3 [u8] claim/agreed claim u2 outcomes {"openui-v1":{"v1:g2":"separated"},"openui-v2":{"v2:g2":"separated"}} carriers {"openui-v1":["v1:g4"],"openui-v2":["v2:g8"]}

- X: x7 [u9] claim (general, high) clause "within a bounded window" → claim u9 "idempotency keys make retries safe"
  Y: y6 [u9] claim (general, high) clause "within a bounded window" → claim u9 "idempotency keys make retries safe"
  context: phase3 c4 [u9] claim/agreed claim u9 outcomes {"openui-v1":{"v1:g5":"carried"},"openui-v2":{"v2:g9":"carried"}} carriers {"openui-v1":["v1:g5"],"openui-v2":["v2:g9"]}

- X: x8 [u9] claim (R3, high) clause "they are not a general guarantee against duplicate operations" → claim u9 "idempotency keys make retries safe within a bounded window"
  Y: y7 [u9] claim (R3, high) clause "they are not a general guarantee against duplicate operations" → claim u9 "idempotency keys make retries safe"
  context: phase3 c4 [u9] claim/agreed claim u9 outcomes {"openui-v1":{"v1:g5":"carried"},"openui-v2":{"v2:g9":"carried"}} carriers {"openui-v1":["v1:g5"],"openui-v2":["v2:g9"]}

## Found by X only

- x4 [u7] set (R5, low) clause "In this design" → claim u7 "stored results expire after 24 hours"
  context: phase3 c2 [u6,u7] claim/agreed claim u2 outcomes {"openui-v1":{"v1:g1":"separated","v1:g2":"separated"},"openui-v2":{"v2:g1":"separated","v2:g2":"separated","v2:g4":"separated"}} carriers {"openui-v1":["v1:g3","v1:g5"],"openui-v2":["v2:g6","v2:g7","v2:g9"]}

## Found by Y only

