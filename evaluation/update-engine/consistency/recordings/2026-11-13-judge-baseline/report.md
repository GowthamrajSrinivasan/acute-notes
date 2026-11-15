# Stage 4f recording 2026-11-13-judge-baseline

```json
{
  "calls": 20,
  "skipped": 0,
  "promptTokens": 8680,
  "completionTokens": 8617,
  "costUsd": 0.024475421
}
{
  "openai/gpt-oss-120b": {
    "calls": 4,
    "ok": 4,
    "promptTokens": 1970,
    "completionTokens": 1983,
    "maxCallTokens": 1289,
    "costUsd": 0.00041,
    "latencyMs": {
      "p50": 14910,
      "max": 23964
    }
  },
  "anthropic/claude-haiku-4.5": {
    "calls": 8,
    "ok": 8,
    "promptTokens": 3501,
    "completionTokens": 3706,
    "maxCallTokens": 971,
    "costUsd": 0.022031000000000002,
    "latencyMs": {
      "p50": 3592,
      "max": 4252
    }
  },
  "deepseek/deepseek-v3.2": {
    "calls": 8,
    "ok": 8,
    "promptTokens": 3209,
    "completionTokens": 2928,
    "maxCallTokens": 809,
    "costUsd": 0.0020344210000000007,
    "latencyMs": {
      "p50": 8870,
      "max": 12007
    }
  }
}
```

dev rules only: 56 pairs · rule precision 100% · context FP 0% · recall (rules alone) 100% · possible on compatible 39% · matches 52/56
| category | n | matches expected | precision (conflict) | recall (shown) |
|---|---|---|---|---|
| numeric | 8 | 8/8 | 100% | 100% |
| negation | 5 | 5/5 | 100% | 100% |
| direction | 3 | 3/3 | 100% | 100% |
| value_swap | 4 | 4/4 | — | 100% |
| temporal | 5 | 5/5 | — | — |
| environment | 5 | 5/5 | — | — |
| scope | 6 | 4/6 | — | — |
| range | 4 | 4/4 | 100% | 100% |
| subject_mismatch | 5 | 4/5 | — | — |
| metric_mismatch | 3 | 3/3 | — | — |
| restatement | 4 | 3/4 | — | — |
| extension | 2 | 2/2 | — | — |
| ambiguous | 2 | 2/2 | — | — |
- d35 (scope): expected compatible, got possible — “30 seconds” here, “10 seconds” there, but the context differs (mobile vs web) — both may be true
- d36 (scope): expected possible, got compatible — no disagreement found
- d45 (subject_mismatch): expected compatible, got possible — “gateway” here, “ledger” there — maybe a different value for the same thing
- d51 (restatement): expected compatible, got possible — “user session” here, “access token” there — maybe a different value for the same thing

dev (rules + AI): 56 pairs · precision 100% · context FP 0% · recall 100% · unresolved possible 0 · sent to AI 19 (answered 19)
| category | n | precision | recall |
|---|---|---|---|
| numeric | 8 | 100% | 100% |
| negation | 5 | 100% | 100% |
| direction | 3 | 100% | 100% |
| value_swap | 4 | 100% | 100% |
| temporal | 5 | — | — |
| environment | 5 | — | — |
| scope | 6 | — | — |
| range | 4 | 100% | 100% |
| subject_mismatch | 5 | — | — |
| metric_mismatch | 3 | — | — |
| restatement | 4 | — | — |
| extension | 2 | — | — |
| ambiguous | 2 | — | — |

heldout rules only: 19 pairs · rule precision 100% · context FP 0% · recall (rules alone) 88% · possible on compatible 46% · matches 18/19
| category | n | matches expected | precision (conflict) | recall (shown) |
|---|---|---|---|---|
| numeric | 3 | 2/3 | 100% | 67% |
| negation | 2 | 2/2 | 100% | 100% |
| direction | 1 | 1/1 | 100% | 100% |
| value_swap | 1 | 1/1 | — | 100% |
| temporal | 2 | 2/2 | — | — |
| environment | 2 | 2/2 | — | — |
| scope | 2 | 2/2 | — | — |
| range | 2 | 2/2 | 100% | 100% |
| subject_mismatch | 1 | 1/1 | — | — |
| metric_mismatch | 1 | 1/1 | — | — |
| restatement | 1 | 1/1 | — | — |
| extension | 1 | 1/1 | — | — |
- h03 (numeric): expected conflict, got compatible — no disagreement found

heldout (rules + AI): 19 pairs · precision 100% · context FP 0% · recall 88% · unresolved possible 0 · sent to AI 6 (answered 6)
| category | n | precision | recall |
|---|---|---|---|
| numeric | 3 | 100% | 67% |
| negation | 2 | 100% | 100% |
| direction | 1 | 100% | 100% |
| value_swap | 1 | 100% | 100% |
| temporal | 2 | — | — |
| environment | 2 | — | — |
| scope | 2 | — | — |
| range | 2 | 100% | 100% |
| subject_mismatch | 1 | — | — |
| metric_mismatch | 1 | — | — |
| restatement | 1 | — | — |
| extension | 1 | — | — |

regressions rules only: 2 pairs · rule precision — · context FP — · recall (rules alone) 0% · possible on compatible — · matches 2/2
| category | n | matches expected | precision (conflict) | recall (shown) |
|---|---|---|---|---|
| numeric | 2 | 2/2 | — | 0% |

regressions (rules + AI): 2 pairs · precision — · context FP — · recall 0% · unresolved possible 0 · sent to AI 0 (answered 0)
| category | n | precision | recall |
|---|---|---|---|
| numeric | 2 | — | 0% |

## Label agreement
```json
{
  "n": 77,
  "modelsAgree": 69,
  "allThreeAgree": 65,
  "modelDisagreements": [
    {
      "id": "d01",
      "author": "contradiction",
      "x": "ambiguous",
      "y": "contradiction"
    },
    {
      "id": "d17",
      "author": "contradiction",
      "x": "contradiction",
      "y": "ambiguous"
    },
    {
      "id": "d21",
      "author": "compatible",
      "x": "compatible",
      "y": "ambiguous"
    },
    {
      "id": "h07",
      "author": "contradiction",
      "x": "contradiction",
      "y": "compatible"
    },
    {
      "id": "h08",
      "author": "compatible",
      "x": "compatible",
      "y": "ambiguous"
    },
    {
      "id": "h14",
      "author": "compatible",
      "x": "contradiction",
      "y": "ambiguous"
    },
    {
      "id": "h19",
      "author": "compatible",
      "x": "contradiction",
      "y": "compatible"
    },
    {
      "id": "r02",
      "author": "contradiction",
      "x": "contradiction",
      "y": "ambiguous"
    }
  ],
  "modelsAgainstAuthor": [
    {
      "id": "d19",
      "author": "contradiction",
      "models": "ambiguous"
    },
    {
      "id": "d37",
      "author": "compatible",
      "models": "contradiction"
    },
    {
      "id": "d55",
      "author": "ambiguous",
      "models": "contradiction"
    },
    {
      "id": "d56",
      "author": "ambiguous",
      "models": "contradiction"
    }
  ],
  "missing": []
}
```
