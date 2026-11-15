unseen — routing (truth × route)
| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 4 (w02, w58, w75, w80) | 0 | 6 | 25 |
| compatible | 3 (w34, w37, w45) | 3 (w17, w24, w76) | 5 | 35 |
| ambiguous | 0 | 0 | 1 (w60) | 8 |

unseen rules only: 90 pairs · rule precision 57% · context FP 0% · recall (rules alone) 11% · possible on compatible 7% · matches 80/90
| category | n | matches expected | precision (conflict) | recall (shown) |
|---|---|---|---|---|
| exclusivity | 7 | 7/7 | — | 0% |
| numeric | 2 | 1/2 | 100% | 50% |
| subject_mismatch | 12 | 10/12 | 0% | — |
| ambiguous_reference | 6 | 6/6 | — | 0% |
| modality | 6 | 6/6 | — | 0% |
| paraphrase | 12 | 12/12 | — | 0% |
| metric | 6 | 4/6 | 50% | 100% |
| extension | 6 | 6/6 | — | — |
| limit | 6 | 5/6 | 0% | 0% |
| scope | 2 | 2/2 | — | — |
| temporal | 9 | 5/9 | 100% | 50% |
| frequency_equivalence | 4 | 4/4 | — | 0% |
| universal | 8 | 8/8 | — | 0% |
| frequency | 3 | 3/3 | — | 0% |
| environment | 1 | 1/1 | — | — |
- w02 (numeric): expected compatible, got conflict — “42” here, “55” there
- w17 (temporal): expected compatible, got possible — “31” here, “15” there, but the context differs (no context vs 2023) — both may be true
- w24 (subject_mismatch): expected compatible, got possible — “149” here, “179” there, but the context differs (uk vs no context) — both may be true
- w34 (metric): expected compatible, got conflict — “3,000” here, “400” there
- w37 (subject_mismatch): expected compatible, got conflict — “31” here, “30” there
- w45 (limit): expected compatible, got conflict — “500” here, “1,000” there
- w58 (metric): expected compatible, got conflict — “1,200” here, “400” there
- w75 (temporal): expected compatible, got conflict — “31” here, “15” there
- w76 (temporal): expected compatible, got possible — “80” here, “95” there, but the context differs (2022 vs 2023) — both may be true
- w80 (temporal): expected compatible, got conflict — “11” here, “9.50” there

pipeline (before any answer): 90 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 0 | 34 | 1 (w31) |
| compatible | 0 | 38 | 8 |
| ambiguous | 0 | 7 | 2 (w11, w25) |
- candidate-generation recall 97% (34/35) · budgeted selection recall 97% (34/35)
- with recorded answers (forwarded without one = missed: 79): recall 0% (0/35) · strict 0% (0/35) · precision — (0/0) · context FP 0% (0/6) · unsupported none
- false exclusion w31 (paraphrase, values_agree): the values agree, or one sits inside the other's limit
- budget: candidates per change 1/13/25 (min/median/max) · pending 260 → 26 Retry calls · 3 day(s) at 50 calls/day
