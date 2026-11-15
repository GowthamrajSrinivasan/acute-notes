# Unseen evaluation 2026-11-15-unseen4 (approved by Gowthamraj Srinivasan; ≤ 8 calls (no retries), ≤ 18000 tokens, ≤ $0.05; sent 8, worst-case reserved 17855 tokens / $0.0030)

Execution (per pair, §12.24): classified 32 · failed 40 · gave_up 0 · pending 0. A pair that is not classified counts as missed.

unseen — routing (truth × route)
| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 4 (x40, x50, x52, x67) | 0 | 4 (x33, x53, x69, x86) | 30 |
| compatible | 1 (x48) | 1 (x13) | 1 (x32) | 41 |
| ambiguous | 0 | 0 | 1 (x06) | 7 |

rules only: 90 pairs · rule precision 80% · context FP 13% · recall (rules alone) 11% · possible on compatible 2% · matches 84/90
| category | n | matches expected | precision (conflict) | recall (shown) |
|---|---|---|---|---|
| negation | 4 | 4/4 | — | 0% |
| universal | 8 | 8/8 | — | 0% |
| temporal | 10 | 10/10 | — | 0% |
| numeric | 5 | 2/5 | 100% | 50% |
| ambiguous_reference | 5 | 5/5 | — | 0% |
| frequency | 4 | 4/4 | — | 0% |
| extension | 5 | 5/5 | — | — |
| paraphrase | 6 | 6/6 | — | 0% |
| subject_mismatch | 8 | 8/8 | — | — |
| frequency_equivalence | 3 | 3/3 | — | — |
| scope | 7 | 6/7 | 0% | 0% |
| modality | 6 | 6/6 | — | 0% |
| limit | 6 | 5/6 | 100% | 33% |
| exclusivity | 7 | 6/7 | 100% | 17% |
| metric | 5 | 5/5 | — | — |
| environment | 1 | 1/1 | — | — |
- x13 (numeric): expected compatible, got possible — “310” here, “365” there, but the context differs (october vs november) — both may be true
- x40 (limit): expected compatible, got conflict — “at most 40” here, “52” there
- x48 (scope): expected compatible, got conflict — “40” here, “6” there
- x50 (numeric): expected compatible, got conflict — “21” here, “at most 15” there
- x52 (exclusivity): expected compatible, got conflict — “6” here, “5” there
- x67 (numeric): expected compatible, got conflict — “84” here, “112” there

rules + AI, baseline routing (possible only) (rules + AI): 90 pairs · precision 80% (4/5) · context FP 13% (1/8) · recall 11% (4/38) · strict recall 11% (4/38) · routing recall 11% (4/38) · unresolved possible 1 · routed 1 (answered 0, awaiting AI 0) · ambiguous shown as conflict none
| category | n | precision | recall |
|---|---|---|---|
| negation | 4 | — | 0% |
| universal | 8 | — | 0% |
| temporal | 10 | — | 0% |
| numeric | 5 | 100% | 50% |
| ambiguous_reference | 5 | — | 0% |
| frequency | 4 | — | 0% |
| extension | 5 | — | — |
| paraphrase | 6 | — | 0% |
| subject_mismatch | 8 | — | — |
| frequency_equivalence | 3 | — | — |
| scope | 7 | 0% | 0% |
| modality | 6 | — | 0% |
| limit | 6 | 100% | 33% |
| exclusivity | 7 | 100% | 17% |
| metric | 5 | — | — |
| environment | 1 | — | — |
- false positive x48 (scope, via rule_conflict): conflict — “40” here, “6” there

rules + AI, near-miss routing (rules + AI): 90 pairs · precision 88% (7/8) · context FP 13% (1/8) · recall 21% (8/38) · strict recall 18% (7/38) · routing recall 21% (8/38) · unresolved possible 2 · routed 7 (answered 5, awaiting AI 1) · ambiguous shown as conflict none
| category | n | precision | recall |
|---|---|---|---|
| negation | 4 | — | 0% |
| universal | 8 | — | 0% |
| temporal | 10 | — | 0% |
| numeric | 5 | 100% | 50% |
| ambiguous_reference | 5 | — | 0% |
| frequency | 4 | 100% | 75% |
| extension | 5 | — | — |
| paraphrase | 6 | — | 0% |
| subject_mismatch | 8 | — | — |
| frequency_equivalence | 3 | — | — |
| scope | 7 | 0% | 0% |
| modality | 6 | — | 0% |
| limit | 6 | 100% | 67% |
| exclusivity | 7 | 100% | 17% |
| metric | 5 | — | — |
| environment | 1 | — | — |
- context + AI "contradicts" x33: label contradiction, shown possible
- false positive x48 (scope, via rule_conflict): conflict — “40” here, “6” there

rules + AI, §12.21 pipeline (retrieval → screen → AI → guards): 90 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 0 | 34 | 4 (x04, x24, x60, x71) |
| compatible | 0 | 32 | 12 |
| ambiguous | 0 | 6 | 2 (x34, x84) |
- candidate-generation recall 89% (34/38) · budgeted selection recall 89% (34/38)
- with recorded answers (forwarded without one = missed: 40): recall 42% (16/38) · strict 39% (15/38) · precision 100% (15/15) · context FP 0% (0/8) · unsupported none
- false exclusion x04 (numeric, different_metrics): different named metrics
- false exclusion x24 (limit, different_metrics): different named metrics
- false exclusion x60 (numeric, values_agree): the values agree, or one sits inside the other's limit
- false exclusion x71 (ambiguous_reference, different_metrics): different named metrics
- budget: candidates per change 0/7/19 (min/median/max) · pending 82 → 9 Retry calls · 2 day(s) at 50 calls/day

§12.21 pipeline, competing batches: 50 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 0 | 17 | 3 (x04, x24, x60) |
| compatible | 0 | 17 | 8 |
| ambiguous | 0 | 4 | 1 (x84) |
- candidate-generation recall 85% (17/20) · budgeted selection recall 85% (17/20)
- with recorded answers (forwarded without one = missed: 22): recall 35% (7/20) · strict 35% (7/20) · precision 100% (7/7) · context FP 0% (0/5) · unsupported none
- false exclusion x04 (numeric, different_metrics): different named metrics
- false exclusion x24 (limit, different_metrics): different named metrics
- false exclusion x60 (numeric, values_agree): the values agree, or one sits inside the other's limit
- budget: candidates per change 0/4/5 (min/median/max) · pending 0 → 0 Retry calls · 1 day(s) at 50 calls/day
