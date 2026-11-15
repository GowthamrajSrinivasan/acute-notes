# Label adjudication — side by side

Stored apart from the evaluation set: `adjudication.json` holds the decisions; the original labels and the recording never change. Model rationales are from `recordings/2026-11-13-judge-baseline/` (the labellers never saw the original labels).

## d19 (dev, value_swap) — both models against the original label

| | Statement | Context qualifiers |
|---|---|---|
| A | Builds run on GitHub Actions. | none |
| B | Builds run on Jenkins. | none |

- **Original label:** contradiction — Value swapped.
- **anthropic/claude-haiku-4.5:** ambiguous — Builds could run on both platforms, or in different environments/stages, or at different times.
- **deepseek/deepseek-v3.2:** ambiguous — Builds might run on both systems for different projects or at different times; unclear.
- **Classifier (openai/gpt-oss-120b):** contradicts — One says builds run on GitHub Actions, the other on Jenkins, for the same builds.
- **Rules today:** possible
- **Decision (provisional, Gowthamraj Srinivasan, 2026-11-13 review):** ambiguous — Ambiguous without knowing whether both statements claim exclusivity.

## d37 (dev, range) — both models against the original label

| | Statement | Context qualifiers |
|---|---|---|
| A | Retries happen up to five times. | qualifier:up to |
| B | Retries happen three times. | none |

- **Original label:** compatible — 3 is within 'up to 5'.
- **anthropic/claude-haiku-4.5:** contradiction — One says retries happen up to five times, the other says exactly three times; they conflict on the maximum retry count.
- **deepseek/deepseek-v3.2:** contradiction — Five times and three times cannot both be true for the same retry policy.
- **Rules today:** compatible
- **Decision (provisional, Gowthamraj Srinivasan, 2026-11-13 review):** compatible — Compatible when describing a maximum versus an actual count; otherwise context-dependent.

## d55 (dev, ambiguous) — both models against the original label

| | Statement | Context qualifiers |
|---|---|---|
| A | The limit is 100. | none |
| B | The limit is 500. | none |

- **Original label:** ambiguous — Which limit? Can't tell without context.
- **anthropic/claude-haiku-4.5:** contradiction — A limit cannot be both 100 and 500 in the same context.
- **deepseek/deepseek-v3.2:** contradiction — Different numeric limits cannot both be true for same thing.
- **Classifier (openai/gpt-oss-120b):** contradicts — Both state a single limit value without any contextual distinction.
- **Rules today:** possible
- **Decision (provisional, Gowthamraj Srinivasan, 2026-11-13 review):** ambiguous — Insufficient context: stays ambiguous unless both claims unambiguously refer to the same subject, property and scope.

## d56 (dev, ambiguous) — both models against the original label

| | Statement | Context qualifiers |
|---|---|---|
| A | It takes 5 minutes. | none |
| B | It takes 2 hours. | none |

- **Original label:** ambiguous — No subject.
- **anthropic/claude-haiku-4.5:** contradiction — The same action cannot take both 5 minutes and 2 hours.
- **deepseek/deepseek-v3.2:** contradiction — 5 minutes and 2 hours are mutually exclusive durations.
- **Classifier (openai/gpt-oss-120b):** contradicts — Both give different durations for the same unspecified process.
- **Rules today:** possible
- **Decision (provisional, Gowthamraj Srinivasan, 2026-11-13 review):** ambiguous — Insufficient context: stays ambiguous unless both claims unambiguously refer to the same subject, property and scope.

## d01 (dev, numeric) — the two models disagree

| | Statement | Context qualifiers |
|---|---|---|
| A | Retries happen three times. | none |
| B | The worker retries five times. | none |

- **Original label:** contradiction — Same claim, different count.
- **anthropic/claude-haiku-4.5:** ambiguous — Unclear if 'retries' and 'worker retries' refer to the same retry mechanism or different ones.
- **deepseek/deepseek-v3.2:** contradiction — Different retry counts cannot both be true for the same worker.
- **Rules today:** conflict
- **Decision (Gowthamraj Srinivasan, 2026-11-13 review (decided on the full statements)):** ambiguous — Generic retries and worker retries are not explicitly the same mechanism. If they refer to the same retry policy, the counts contradict.

## d17 (dev, value_swap) — the two models disagree

| | Statement | Context qualifiers |
|---|---|---|
| A | The payments team owns the gateway. | none |
| B | The platform team owns the gateway. | none |

- **Original label:** contradiction — Owner swapped; rules can only call it possible.
- **anthropic/claude-haiku-4.5:** contradiction — The same gateway cannot be owned by two different teams.
- **deepseek/deepseek-v3.2:** ambiguous — Could be different teams owning different parts, or ownership changed; need more context.
- **Classifier (openai/gpt-oss-120b):** contradicts — Both statements claim ownership of the same gateway by different teams in the same context.
- **Rules today:** possible
- **Decision (Gowthamraj Srinivasan, 2026-11-13 review (decided on the full statements)):** ambiguous — Payments and platform ownership could conflict, but neither statement establishes exclusive ownership or the same organizational scope.

## d21 (dev, temporal) — the two models disagree

| | Statement | Context qualifiers |
|---|---|---|
| A | In 2023 the API allowed 100 requests per minute. | time:2023, qualifier:per minute |
| B | The API allows 500 requests per minute. | qualifier:per minute |

- **Original label:** compatible — A past value and the current one.
- **anthropic/claude-haiku-4.5:** compatible — Different time periods (2023 vs. current); API limits may have changed.
- **deepseek/deepseek-v3.2:** ambiguous — Could be about different years or contexts, but not explicitly stated.
- **Classifier (openai/gpt-oss-120b):** compatible_context — A specifies the 2023 limit, B gives an unspecified (likely later) limit.
- **Rules today:** possible
- **Decision (Gowthamraj Srinivasan, 2026-11-13 review (decided on the full statements)):** compatible — A documented 2023 limit of 100 requests/minute can coexist with a current limit of 500.

## h07 (heldout, value_swap) — the two models disagree

| | Statement | Context qualifiers |
|---|---|---|
| A | Alerts go to the on-call channel. | none |
| B | Alerts go to the platform channel. | none |

- **Original label:** contradiction — A non-numeric value swapped; rules can only call it possible.
- **anthropic/claude-haiku-4.5:** contradiction — Alerts cannot go to both the on-call channel and the platform channel simultaneously in the same context.
- **deepseek/deepseek-v3.2:** compatible — Alerts could be routed to multiple channels.
- **Classifier (openai/gpt-oss-120b):** contradicts — Both statements refer to the same alert routing without any contextual distinction, yet they assign alerts to different channels.
- **Rules today:** possible
- **Decision (Gowthamraj Srinivasan, 2026-11-13 review (decided on the full statements)):** compatible — Alerts can be delivered to multiple channels. Neither statement says they go only to its named destination.

## h08 (heldout, temporal) — the two models disagree

| | Statement | Context qualifiers |
|---|---|---|
| A | In 2022 sessions expired after 8 hours. | time:2022 |
| B | Sessions expire after 30 minutes. | none |

- **Original label:** compatible — Different time: the past value and the current one.
- **anthropic/claude-haiku-4.5:** compatible — Different time periods: 2022 had 8-hour expiry, but current expiry is 30 minutes (a change over time).
- **deepseek/deepseek-v3.2:** ambiguous — Could be a policy change over time or different environments.
- **Classifier (openai/gpt-oss-120b):** compatible_context — One statement specifies the year 2022, implying a past policy, while the other lacks a time reference and may describe the current policy.
- **Rules today:** possible
- **Decision (Gowthamraj Srinivasan, 2026-11-13 review (decided on the full statements)):** compatible — An eight-hour expiry policy in 2022 can coexist with a current 30-minute expiry.

## h14 (heldout, range) — the two models disagree

| | Statement | Context qualifiers |
|---|---|---|
| A | Sessions last up to 8 hours. | qualifier:up to |
| B | Sessions last 30 minutes. | none |

- **Original label:** compatible — 30 minutes is within 'up to 8 hours'.
- **anthropic/claude-haiku-4.5:** contradiction — Sessions cannot last both up to 8 hours and exactly 30 minutes in the same context.
- **deepseek/deepseek-v3.2:** ambiguous — 'Up to 8 hours' includes 30 minutes; unclear if 30 minutes is a fixed or maximum duration.
- **Rules today:** compatible
- **Decision (Gowthamraj Srinivasan, 2026-11-13 review (decided on the full statements)):** compatible — Thirty minutes falls within an upper limit of eight hours.

## h19 (heldout, extension) — the two models disagree

| | Statement | Context qualifiers |
|---|---|---|
| A | Alerts go to the on-call channel. | none |
| B | Alerts go to the on-call channel and to email. | none |

- **Original label:** compatible — Adds a destination; nothing contradicted.
- **anthropic/claude-haiku-4.5:** contradiction — A cannot be true if alerts also go to email; B specifies a superset of destinations.
- **deepseek/deepseek-v3.2:** compatible — B adds an additional destination; both can be true if A is a subset of B.
- **Rules today:** compatible
- **Decision (Gowthamraj Srinivasan, 2026-11-13 review (decided on the full statements)):** compatible — The second statement extends the first by adding email delivery without denying on-call delivery.

## r02 (regressions, numeric) — the two models disagree

| | Statement | Context qualifiers |
|---|---|---|
| A | Our worker retries three times before giving up. | qualifier:before giving up |
| B | Retries happen five times. | none |

- **Original label:** contradiction — Same retry count, different value; the extra clause dilutes the shared words (the Worker and Gateway cards of the 4e local e2e).
- **anthropic/claude-haiku-4.5:** contradiction — The worker cannot retry both three times and five times for the same operation.
- **deepseek/deepseek-v3.2:** ambiguous — Unclear if 'retries' refers to the same worker or a different retry policy.
- **Classifier (openai/gpt-oss-120b):** contradicts — Both statements specify the number of retry attempts for the same worker, and three vs five attempts cannot both apply simultaneously.
- **Rules today:** compatible (near-miss)
- **Decision (Gowthamraj Srinivasan, 2026-11-13 review (decided on the full statements)):** ambiguous — The worker-specific retry count is three, but the general statement about five retries does not identify that worker. The claims contradict only if they describe the same retry mechanism.
