# Live retry-guard smoke test — 2026-11-15-guard-smoke

Approved by Gowthamraj Srinivasan (Stage 4f decision review, 2026-11-15); openai/gpt-oss-120b on AICredits through the Copilot SDK host runtime (BYOK, SDK pinned), one consistency check per case through runJudgeCheck; ceilings ≤ 1 forwarded request, ≤ 4500 worst-case tokens, ≤ $0.01; one run.

Result: **PASS** — provider-bound requests: 3 arrived at the proxy, 1 forwarded, 0 refused by a ceiling; cost ≤ $0.000374.

| Case | Status | Arrivals | Forwarded | max_tokens carried / expected | temperature | providerRequests | Reserved → budget after | Ledger | Pass |
|---|---|---|---|---|---|---|---|---|---|
| inject_429 | call_error (transport) | 1 | 0 | 760 / 760 | 0 | — | 1424 → 1424 | failed | ✓ |
| inject_500 | call_error (transport) | 1 | 0 | 760 / 760 | 0 | — | 1424 → 1424 | failed | ✓ |
| live | answered | 1 | 1 | 760 / 760 | 0 | 1 | 1424 → 2201 | classified | ✓ |

Checks:
- inject_429: ✓ exactlyOneArrival, ✓ nothingForwarded, ✓ callFailed, ✓ pairFailed, ✓ reservationKept, ✓ noExtraProviderRequests
- inject_500: ✓ exactlyOneArrival, ✓ nothingForwarded, ✓ callFailed, ✓ pairFailed, ✓ reservationKept, ✓ noExtraProviderRequests
- live: ✓ exactlyOneArrival, ✓ exactlyOneForwarded, ✓ carriesMaxTokens, ✓ carriesTemperature0, ✓ answered, ✓ pairClassified, ✓ providerRequests1, ✓ usageReported, ✓ settledToUsage, ✓ lateOverwriteIgnored

Live: used 2201 tokens; request 9844 bytes; late overwrite ignored: true.
