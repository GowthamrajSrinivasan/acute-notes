# Execution-reliability check — 2026-11-15-reliability

Approved by Gowthamraj Srinivasan (Stage 4f decision review, 2026-11-15); openai/gpt-oss-120b on AICredits; ceilings ≤ 6 calls, ≤ 16800 reserved tokens, ≤ $0.02; no retries; one run.

**An execution check, not a semantic evaluation: the workload has no labels and no accuracy is computed or reported.**

Result: **PASS** — sent 6 calls / 60 pairs; classified 60, failed 0.

## Pass criteria

| | Criterion | Observed |
|---|---|---|
| ✓ | pairs classified ≥ 95 % | 60/60 (need ≥ 57) |
| ✓ | no call reached the 90 s timeout | none |
| ✓ | p95 latency ≤ 60 s | p95 40355 ms (p50 19050 ms, 6 samples) |
| ✓ | no truncated reply (finish_reason length) | none |
| ✓ | complete usage accounting | every answered call reported prompt and completion tokens; every failed call kept its whole reservation |
| ✓ | total usage within 16,800 tokens (or the overrun flagged and charged) | charged 8818, reserved 12888, reported 8818 |

## Failure-handling assertions

| | Assertion | Observed |
|---|---|---|
| ✓ | never more calls than the ceiling | 6 ≤ 6 |
| ✓ | one application call per sent call | 1,1,1,1,1,1 |
| ✓ | one physical request per call at the transport boundary | 1,1,1,1,1,1 |
| ✓ | one model request per call on the wire | 1,1,1,1,1,1 |
| ✓ | every sent pair ends classified or failed (none in flight or pending) | 0 left |
| ✓ | a failed call fails exactly its own pairs and keeps its reservation | 0 failed calls |
| ✓ | no pair classified without a validated answer | 60 classified |
| ✓ | ledger, budget and call records agree | ledger 60+0, calls 60, charged 8818 |
| ✓ | within the token and dollar ceilings (worst case) | 12888 ≤ 16800 tokens; $0.00219 ≤ $0.02 |

## Requests (application call vs physical provider requests)

Application calls 6 · transport-boundary requests 6 · wire requests 6.

## Usage

Reserved 12888 tokens · charged 8818 · reported 8818 · cost $0.000802 (worst case $0.00219).

## Latency

18526, 30068, 40355, 17973, 19050, 29023 ms. p50 19050 ms, p95 40355 ms. nearest rank over 6 end-to-end call latencies (non-streaming; queue time not separable); with 6 samples p95 is the largest value — an operational check, not a statistically robust estimate.

## Calls

| # | Status | HTTP | finish | ms | reserved | prompt | completion | reasoning | app/transport/wire |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ok | 200 | stop | 18526 | 2141 | 871 | 592 | — | 1/1/1 |
| 2 | ok | 200 | stop | 30068 | 2142 | 848 | 709 | — | 1/1/1 |
| 3 | ok | 200 | stop | 40355 | 2170 | 892 | 725 | — | 1/1/1 |
| 4 | ok | 200 | stop | 17973 | 2155 | 879 | 510 | — | 1/1/1 |
| 5 | ok | 200 | stop | 19050 | 2137 | 876 | 450 | — | 1/1/1 |
| 6 | ok | 200 | stop | 29023 | 2143 | 872 | 594 | — | 1/1/1 |
