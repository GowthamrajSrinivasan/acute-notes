unseen — routing (truth × route)
| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 4 (x40, x50, x52, x67) | 0 | 4 (x33, x53, x69, x86) | 30 |
| compatible | 1 (x48) | 1 (x13) | 1 (x32) | 41 |
| ambiguous | 0 | 0 | 1 (x06) | 7 |

unseen rules only: 90 pairs · rule precision 80% · context FP 13% · recall (rules alone) 11% · possible on compatible 2% · matches 84/90
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

pipeline (before any answer): 90 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 0 | 34 | 4 (x04, x24, x60, x71) |
| compatible | 0 | 32 | 12 |
| ambiguous | 0 | 6 | 2 (x34, x84) |
- candidate-generation recall 89% (34/38) · budgeted selection recall 89% (34/38)
- with recorded answers (forwarded without one = missed: 72): recall 0% (0/38) · strict 0% (0/38) · precision — (0/0) · context FP 0% (0/8) · unsupported none
- false exclusion x04 (numeric, different_metrics): different named metrics
- false exclusion x24 (limit, different_metrics): different named metrics
- false exclusion x60 (numeric, values_agree): the values agree, or one sits inside the other's limit
- false exclusion x71 (ambiguous_reference, different_metrics): different named metrics
- budget: candidates per change 0/7/19 (min/median/max) · pending 82 → 9 Retry calls · 2 day(s) at 50 calls/day
