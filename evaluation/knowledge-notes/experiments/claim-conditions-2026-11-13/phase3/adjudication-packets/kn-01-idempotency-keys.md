# Adjudication packet: kn-01-idempotency-keys

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

## Candidates with every reading

### c1: condition units u2
- phase 1 record (session author, golden-derived; NOT blind) kn01.replay.completed: claim u2, binding claim — only for a request that already completed
- A (blind): not_a_condition, claim - (medium) — condition "If the server has already completed a request with that key" / claim "it returns the stored result instead of performing the operation again" — This is the core mechanism claim itself (its 'if' is the trigger of the behaviour), not a limit on some other claim.
- B (blind): ambiguous, claim u2 (medium) — condition "If the server has already completed a request with that key" / claim "it returns the stored result instead of performing the operation again" — Reading 1: this is the core mechanism claim itself (not a condition on anything); reading 2: 'already completed' is an intra-sentence claim condition, since the result is not returned for an unfinished request.

### c2: condition units u6, u7
- GOLDEN dataset link ku.expiry-window → ku.replay: claim u2 — Keys protect against duplicates only while the server remembers them; stored results expire after 24 hours, after which a retry is treated as a new payment.
- phase 1 record (session author, golden-derived; NOT blind) kn01.replay.window: claim u2, binding claim — only while it remembers the key: 24 hours
- A (blind): claim, claim u2 (high) — condition "Keys only protect against duplicates while the server still remembers them. In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment." / claim "If the server has already completed a request with that key, it returns the stored result instead of performing the operation again." — After 24 hours a retry with the same key is performed again, so u2's claim is false in that case.
- B (blind): claim, claim u2 (high) — condition "Keys only protect against duplicates while the server still remembers them. In this design, stored results expire after 24 hours, so a retry sent after that window is treated as a new payment." / claim "If the server has already completed a request with that key, it returns the stored result instead of performing the operation again." — After 24 hours a completed request's key no longer returns the stored result, so u2 stated alone is false for late retries.

### c3: condition units u8
- GOLDEN dataset link ku.key-reuse → ku.replay: claim u2 — A key does not make two different requests safe: a reused key with a different amount must be rejected, not answered with the old result.
- phase 1 record (session author, golden-derived; NOT blind) kn01.replay.reuse: claim u2, binding claim — a reused key with a different amount is rejected
- A (blind): claim, claim u2 (medium) — condition "if a client reuses a key with a different amount, the server must reject the request rather than return the old result" / claim "it returns the stored result instead of performing the operation again" — A same-key request with different parameters is rejected, not answered with the stored result, so u2 read alone is misleading.
- B (blind): claim, claim u2 (medium) — condition "if a client reuses a key with a different amount, the server must reject the request rather than return the old result" / claim "If the server has already completed a request with that key, it returns the stored result instead of performing the operation again." — Same key with a different payload must be rejected, contradicting an unqualified 'returns the stored result'.

### c4: condition units u9
- phase 1 record (session author, golden-derived; NOT blind) kn01.takeaway.bounded: claim u9, binding claim — within a bounded window; not a general guarantee
- A (blind): claim, claim u9 (medium) — condition "within a bounded window; they are not a general guarantee against duplicate operations" / claim "idempotency keys make retries safe" — Intra-sentence summary condition restating c2/c3; dropping 'within a bounded window' makes the summary claim false.
- B (blind): claim, claim u9 (medium) — condition "within a bounded window; they are not a general guarantee against duplicate operations" / claim "idempotency keys make retries safe" — Intra-sentence summary condition restating u6-u8; 'make retries safe' without the bound is misleading.

