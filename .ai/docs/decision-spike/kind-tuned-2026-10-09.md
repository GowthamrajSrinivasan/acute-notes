# Spike, second pass — tuned questions for section kind (2026-10-09)

20 sections from 4 documents; ground truth = chat outline by `openai/gpt-oss-120b` (run A). Same sections for every variant. Jev: `typesafe/jev-1.13`.

| variant | kind agreement | …only where confident (≥ 0.6) | prominence agreement | requests per section | latency per section (avg) | input tokens (total) |
|---|---|---|---|---|---|---|
| V1 one unordered choice (original) | 45% (9/20) | 50% (5/10) of 10 | 85% (17/20) | 1 | 893 ms | 22601 |
| V2 ordered yes/no cascade, threshold 0.5 | **15% (3/20)** | 12% (2/17) of 17 | 75% (15/20) | 1 (9 questions) | 898 ms | 24881 |
| V2 threshold 0.3 / 0.7 (sensitivity) | 5% (1/20) / 30% (6/20) | | | | | |
| V3 two steps (family, then kind) | 30% (6/20) | 50% (4/8) of 8 | 70% (14/20) | 2.0 | 1391 ms | 33454 |
| Noise floor: chat vs itself (17/20 sections grouped identically) | 53% (9/17) | | | | | |

## Per section (✗ = differs from the chat outline)

| doc | section | chat A | chat B | V1 | V2 @0.5 | V3 | prom. A / V1 / V2 / V3 |
|---|---|---|---|---|---|---|---|
| cmg-verify-c | cmg-verify cheat sheet — SR3 determi | annotated | supporting | notes ✗ | notes ✗ | hierarchy ✗ | prim / supp / prim / prim |
| cmg-verify-c | Checks 0–7 | cards | comparison | cards | comparison ✗ | metrics ✗ | prim / prim / supp / supp |
| cmg-verify-c | Pass / fail examples per check | supporting | comparison | comparison ✗ | comparison ✗ | cards ✗ | supp / prim / supp / supp |
| cmg-verify-c | Hook points (the deterministic layer | cards | cards | flow ✗ | comparison ✗ | flow ✗ | prim / prim / prim / supp |
| cmg-verify-c | A1–A6 codes (what happens when a che | cards | comparison | comparison ✗ | comparison ✗ | cards | supp / supp / supp / supp |
| cmg-verify-c | The engineer file (YAML) | supporting | cards | comparison ✗ | comparison ✗ | cards ✗ | supp / prim / prim / prim |
| cmg-verify-c | submit_answer outcomes | cards | comparison | comparison ✗ | comparison ✗ | cards | prim / prim / supp / supp |
| cmg-verify-c | Other knobs | supporting | cards | cards ✗ | comparison ✗ | cards ✗ | supp / supp / supp / supp |
| handoff-stat | (lead) | notes | — | notes | hierarchy ✗ | supporting ✗ | prim / prim / prim / prim |
| handoff-stat | Tests before the hand-off | metrics | metrics | metrics | comparison ✗ | metrics | supp / supp / supp / supp |
| handoff-stat | Branches and worktrees (new worktree | hierarchy | hierarchy | hierarchy | hierarchy | hierarchy | supp / supp / supp / supp |
| handoff-stat | What's built | cards | cards | flow ✗ | comparison ✗ | metrics ✗ | supp / supp / supp / supp |
| handoff-stat | Things that differ from the plan or  | decision | — | decision | comparison ✗ | cards ✗ | prim / prim / supp / supp |
| decision-tab | Decision My proposal | decision | decision | decision | comparison ✗ | decision | prim / prim / prim / prim |
| unit-checks- | Overview | notes | notes | notes | notes | supporting ✗ | prim / prim / prim / prim |
| unit-checks- | Units and Wording Checks v3 | comparison | — | comparison | comparison | annotated ✗ | prim / prim / supp / supp |
| unit-checks- | How it stays safe | cards | supporting | comparison ✗ | comparison ✗ | supporting ✗ | supp / supp / supp / supp |
| unit-checks- | Tests | metrics | metrics | supporting ✗ | comparison ✗ | metrics | supp / supp / supp / supp |
| unit-checks- | Script, diagram and deck | supporting | supporting | comparison ✗ | comparison ✗ | cards ✗ | supp / supp / supp / supp |
| unit-checks- | Left for you | notes | notes | notes | cards ✗ | cards ✗ | supp / supp / supp / supp |