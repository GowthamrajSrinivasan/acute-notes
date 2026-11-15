unseen — routing (truth × route)
| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 3 (y12, y57, y80) | 0 | 6 | 31 |
| compatible | 1 (y11) | 0 | 4 (y14, y18, y19, y22) | 40 |
| ambiguous | 0 | 0 | 0 | 5 |

unseen rules only: 90 pairs · rule precision 75% · context FP 0% · recall (rules alone) 8% · possible on compatible 0% · matches 86/90
| category | n | matches expected | precision (conflict) | recall (shown) |
|---|---|---|---|---|
| exclusivity | 7 | 7/7 | — | 0% |
| temporal | 10 | 10/10 | — | 0% |
| extension | 5 | 5/5 | — | — |
| subject_mismatch | 8 | 8/8 | — | — |
| universal | 8 | 8/8 | — | 0% |
| modality | 6 | 6/6 | — | 0% |
| negation | 4 | 4/4 | — | 0% |
| paraphrase | 6 | 5/6 | 0% | 0% |
| limit | 6 | 4/6 | 100% | 40% |
| metric | 5 | 5/5 | — | 0% |
| scope | 7 | 7/7 | — | 0% |
| frequency_equivalence | 3 | 3/3 | — | 0% |
| frequency | 4 | 4/4 | — | 0% |
| environment | 1 | 1/1 | — | — |
| ambiguous_reference | 5 | 5/5 | — | 0% |
| numeric | 5 | 4/5 | 100% | 33% |
- y11 (paraphrase): expected compatible, got conflict — “7” here, “twenty-eight” there
- y12 (limit): expected compatible, got conflict — “7” here, “thirty” there
- y57 (numeric): expected compatible, got conflict — “412” here, “at most 300” there
- y80 (limit): expected compatible, got conflict — “at least three” here, “two” there

pipeline (before any answer): 90 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 0 | 40 | 0 |
| compatible | 0 | 40 | 5 |
| ambiguous | 0 | 5 | 0 |
- candidate-generation recall 100% (40/40) · budgeted selection recall 98% (39/40)
- with recorded answers (forwarded without one = missed: 85): recall 0% (0/40) · strict 0% (0/40) · precision — (0/0) · context FP 0% (0/10) · unsupported none
- budget: candidates per change 1/8/22 (min/median/max) · pending 125 → 13 Retry calls · 3 day(s) at 50 calls/day
- waited: y24 ranked 12 (outranked by 11)
