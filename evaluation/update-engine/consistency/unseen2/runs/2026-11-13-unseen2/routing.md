unseen — routing (truth × route)
| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 2 (v16, v27) | 0 | 5 | 15 |
| compatible | 2 (v40, v43) | 4 (v03, v32, v48, v50) | 1 (v38) | 22 |
| ambiguous | 0 | 0 | 0 | 5 |

unseen rules only: 56 pairs · rule precision 50% · context FP 0% · recall (rules alone) 9% · possible on compatible 14% · matches 48/56
| category | n | matches expected | precision (conflict) | recall (shown) |
|---|---|---|---|---|
| modality | 7 | 7/7 | — | 0% |
| limit | 6 | 6/6 | — | 0% |
| temporal | 7 | 5/7 | — | 0% |
| exclusivity | 6 | 6/6 | — | 0% |
| frequency_equivalence | 3 | 3/3 | — | — |
| subject_mismatch | 4 | 3/4 | 0% | — |
| extension | 4 | 4/4 | — | — |
| paraphrase | 5 | 5/5 | — | 0% |
| frequency | 4 | 4/4 | — | 0% |
| adversarial | 4 | 3/4 | 100% | 50% |
| metric | 2 | 1/2 | — | — |
| numeric | 2 | 0/2 | 50% | 100% |
| scope | 1 | 0/1 | — | — |
| environment | 1 | 1/1 | — | — |
- v03 (temporal): expected compatible, got possible — “90” here, “110” there, but the context differs (until, march, 2025 vs no context) — both may be true
- v16 (adversarial): expected compatible, got conflict — “twelve-hour” here, “eight hours” there
- v27 (numeric): expected compatible, got conflict — “4,000” here, “at least 25,000” there
- v32 (scope): expected compatible, got possible — “25 days” here, “30 days” there, but the context differs (uk vs no context) — both may be true
- v40 (numeric): expected compatible, got conflict — “120” here, “95” there
- v43 (subject_mismatch): expected compatible, got conflict — “50” here, “10” there
- v48 (metric): expected compatible, got possible — “400” here, “1,200” there, but the context differs (shift vs no context) — both may be true
- v50 (temporal): expected compatible, got possible — “40” here, “80” there, but the context differs (before 2024, 2024 vs no context) — both may be true
