# OpenUI note sets: kn-01-idempotency-keys

Saved replies of generate_openui_notes (gemini-2.5-flash, 2026-11-13). No frames or arrows: each card stands alone. Card id = <variant>:<key>.

## v1 (5 cards). Each line: id, cites (claimed sources), then the visible text (title | body | detail).
v1:g1 cites=u1,u2 :: Idempotency Keys Prevent Duplicate Operations | An idempotency key is a unique value sent with a request, allowing the server to identify and prevent duplicate operations if the request is retried.
v1:g2 cites=u3,u4,u5 :: Example of Idempotency Key Usage | If a client retries a payment request with the same idempotency key after a connection drop, the server returns the original confirmation, ensuring the customer is charged only once.
v1:g3 cites=u6,u7 :: Idempotency Key Expiration | Idempotency keys only protect against duplicates for a limited time, as stored results expire after a set period (e.g., 24 hours), after which a retry is treated as a new operation.
v1:g4 cites=u8 :: Idempotency Keys and Different Requests | Idempotency keys do not make different requests safe; if a client reuses a key with a different request (e.g., a different amount), the server must reject it.
v1:g5 cites=u9 :: Scope of Idempotency Key Protection | Idempotency keys ensure safe retries within a specific timeframe but do not provide a general guarantee against all duplicate operations.

## v2 (9 cards). Each line: id, cites (claimed sources), then the visible text (title | body | detail).
v2:g1 cites=u1 :: Idempotency Keys Prevent Duplicate Operations | An idempotency key is a unique value attached to a client request, allowing the server to identify and prevent duplicate operations.
v2:g2 cites=u2 :: Server Returns Stored Result for Duplicate Requests | If a server receives a request with an idempotency key it has already processed, it returns the previously stored result instead of re-executing the operation.
v2:g3 cites=u3 :: Example of Idempotency Key Usage | A checkout client might send `Idempotency-Key: 7f3c-91ab` with a payment request.
v2:g4 cites=u4 :: Client Retries with Same Key After Connection Drop | If a connection drops before a response, the client can safely retry the payment request using the same idempotency key.
v2:g5 cites=u5 :: Server Returns Original Confirmation for Retried Request | When a client retries a request with the key `7f3c-91ab` after a connection drop, the server retrieves the stored result and returns the original confirmation, ensuring the customer is charged only once.
v2:g6 cites=u6 :: Idempotency Key Protection is Time-Bound | Idempotency keys only protect against duplicate requests as long as the server retains the stored results.
v2:g7 cites=u7 :: Stored Results Expire After 24 Hours | In this design, stored results associated with idempotency keys expire after 24 hours; a retry sent after this period is treated as a new payment.
v2:g8 cites=u8 :: Keys Do Not Protect Against Different Requests | Idempotency keys do not make two different requests safe; if a client reuses a key with a different amount, the server must reject the request.
v2:g9 cites=u9 :: Idempotency Keys Ensure Safe Retries Within a Window | Idempotency keys ensure that retries are safe within a defined time window, but they do not provide a general guarantee against all duplicate operations.

