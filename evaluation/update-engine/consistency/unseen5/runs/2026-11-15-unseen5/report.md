# Unseen evaluation 2026-11-15-unseen5 (approved by Gowthamraj Srinivasan (Stage 4f decision, 2026-11-16); ≤ 9 calls (no retries), ≤ 21300 tokens, ≤ $0.05; sent 9, worst-case reserved 20930 tokens / $0.0036)

Execution (per pair, §12.24): classified 86 · failed 0 · gave_up 0 · pending 0. A pair that is not classified counts as missed.

unseen — routing (truth × route)
| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 3 (y12, y57, y80) | 0 | 6 | 31 |
| compatible | 1 (y11) | 0 | 4 (y14, y18, y19, y22) | 40 |
| ambiguous | 0 | 0 | 0 | 5 |

rules only: 90 pairs · rule precision 75% · context FP 0% · recall (rules alone) 8% · possible on compatible 0% · matches 86/90
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

rules + AI, baseline routing (possible only) (rules + AI): 90 pairs · precision 75% (3/4) · context FP 0% (0/10) · recall 8% (3/40) · strict recall 8% (3/40) · routing recall 8% (3/40) · unresolved possible 0 · routed 0 (answered 0, awaiting AI 0) · ambiguous shown as conflict none
| category | n | precision | recall |
|---|---|---|---|
| exclusivity | 7 | — | 0% |
| temporal | 10 | — | 0% |
| extension | 5 | — | — |
| subject_mismatch | 8 | — | — |
| universal | 8 | — | 0% |
| modality | 6 | — | 0% |
| negation | 4 | — | 0% |
| paraphrase | 6 | 0% | 0% |
| limit | 6 | 100% | 40% |
| metric | 5 | — | 0% |
| scope | 7 | — | 0% |
| frequency_equivalence | 3 | — | 0% |
| frequency | 4 | — | 0% |
| environment | 1 | — | — |
| ambiguous_reference | 5 | — | 0% |
| numeric | 5 | 100% | 33% |
- false positive y11 (paraphrase, via rule_conflict): conflict — “7” here, “twenty-eight” there

rules + AI, near-miss routing (rules + AI): 90 pairs · precision 89% (8/9) · context FP 0% (0/10) · recall 20% (8/40) · strict recall 20% (8/40) · routing recall 23% (9/40) · unresolved possible 0 · routed 10 (answered 10, awaiting AI 0) · ambiguous shown as conflict none
| category | n | precision | recall |
|---|---|---|---|
| exclusivity | 7 | — | 0% |
| temporal | 10 | — | 0% |
| extension | 5 | — | — |
| subject_mismatch | 8 | — | — |
| universal | 8 | 100% | 17% |
| modality | 6 | — | 0% |
| negation | 4 | — | 0% |
| paraphrase | 6 | 0% | 0% |
| limit | 6 | 100% | 80% |
| metric | 5 | — | 0% |
| scope | 7 | — | 0% |
| frequency_equivalence | 3 | — | 0% |
| frequency | 4 | 100% | 33% |
| environment | 1 | — | — |
| ambiguous_reference | 5 | — | 0% |
| numeric | 5 | 100% | 67% |
- AI vs label y61: label contradiction, AI compatible_context — Statement A refers to a future change in 2025 for the whole workforce; statement B describes the current situation where only one depot has switched.
- false positive y11 (paraphrase, via rule_conflict): conflict — “7” here, “twenty-eight” there

rules + AI, §12.21 pipeline (retrieval → screen → AI → guards): 90 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 0 | 40 | 0 |
| compatible | 0 | 40 | 5 |
| ambiguous | 0 | 5 | 0 |
- candidate-generation recall 100% (40/40) · budgeted selection recall 98% (39/40)
- with recorded answers (forwarded without one = missed: 0): recall 90% (36/40) · strict 78% (31/40) · precision 100% (31/31) · context FP 0% (0/10) · unsupported y20, y45
- budget: candidates per change 1/8/22 (min/median/max) · pending 125 → 13 Retry calls · 3 day(s) at 50 calls/day
- waited: y24 ranked 12 (outranked by 11)

§12.21 pipeline, competing batches: 50 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 0 | 16 | 0 |
| compatible | 0 | 29 | 3 |
| ambiguous | 0 | 2 | 0 |
- candidate-generation recall 100% (16/16) · budgeted selection recall 100% (16/16)
- with recorded answers (forwarded without one = missed: 0): recall 88% (14/16) · strict 69% (11/16) · precision 100% (11/11) · context FP 0% (0/8) · unsupported y20, y45
- budget: candidates per change 3/5/5 (min/median/max) · pending 0 → 0 Retry calls · 1 day(s) at 50 calls/day
