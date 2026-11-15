unseen — routing (truth × route)
| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 1 (u27) | 5 | 5 | 3 (u06, u19, u30) |
| compatible | 0 | 3 (u20, u26, u32) | 2 (u23, u29) | 14 |
| ambiguous | 1 (u35) | 0 | 0 | 2 (u16, u31) |

unseen rules only: 36 pairs · rule precision 100% · context FP 0% · recall (rules alone) 43% · possible on compatible 16% · matches 26/36
| category | n | matches expected | precision (conflict) | recall (shown) |
|---|---|---|---|---|
| frequency | 3 | 2/3 | — | 50% |
| environment | 1 | 1/1 | — | — |
| negation | 3 | 3/3 | — | 0% |
| frequency_equivalence | 2 | 2/2 | — | — |
| ambiguous | 4 | 1/4 | — | 100% |
| limit | 4 | 3/4 | 100% | 50% |
| metric | 2 | 2/2 | — | — |
| numeric | 2 | 1/2 | — | 50% |
| adversarial | 4 | 4/4 | — | — |
| value_swap | 2 | 1/2 | — | 50% |
| platform | 1 | 1/1 | — | — |
| restatement | 1 | 1/1 | — | — |
| temporal | 1 | 0/1 | — | — |
| value_diluted | 1 | 1/1 | — | 0% |
| region | 1 | 1/1 | — | — |
| scope | 1 | 1/1 | — | — |
| version | 1 | 0/1 | — | — |
| direction | 1 | 0/1 | — | 100% |
| extension | 1 | 1/1 | — | — |
- u05 (ambiguous): expected compatible, got possible — “monday” here, “friday” there — maybe a different value for the same thing
- u08 (numeric): expected compatible, got possible — “1” here, “30” there, but the context differs (no context vs until) — both may be true
- u12 (value_swap): expected compatible, got possible — “data platform” here, “growth” there — maybe a different value for the same thing
- u20 (temporal): expected compatible, got possible — “five” here, “three” there, but the context differs (before 2025, 2025, past vs no context) — both may be true
- u24 (frequency): expected compatible, got possible — “quarterly” here, “every month” there — maybe a different value for the same thing
- u26 (ambiguous): expected compatible, got possible — “postgre” here, “mongodb” there — maybe a different value for the same thing
- u27 (limit): expected compatible, got conflict — “at most 2,500” here, “4,000” there
- u32 (version): expected compatible, got possible — “3.9” here, “3.11” there, but the context differs (2 vs 3) — both may be true
- u33 (direction): expected compatible, got possible — “grow” here, “shrank” there — maybe a different value for the same thing
- u35 (ambiguous): expected compatible, got conflict — “10%” here, “4%” there
