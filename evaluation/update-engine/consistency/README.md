# Consistency evaluation set (Stage 4c)

Sentence pairs for the cross-card consistency checker (`src/ai/consistency/rules.ts`), from
[intelligent-update-engine-plan.md §12.5 and §12.9 D](../../../.ai/docs/intelligent-update-engine-plan.md).

| File | Pairs | Use |
|---|---|---|
| `dev.json` | 56 | Tune rules (and later prompts) on these only. |
| `heldout.json` | 19 | Never used for tuning. Written before any rule; SHA-256 in plan §12.12. Run once the rules are final. |
| `adjudication.json` / `.md` | 12 | Reviewer decisions on disputed labels, stored apart (originals never edited); side by side in the `.md`. 8 await the reviewer. |
| `unseen/` | 36 | A new, unseen set (§12.16): blind `pairs.json`, frozen with the code in `FREEZE.json`; the reviewer labels `labelling-sheet.md` blind; `author-draft-key.json` is compared only afterwards. Nothing has run on it. |
| `regressions.json` | 2 | The rules' two known misses (r01 = h03 word for word; r02 from the 4e e2e). Never tuned on; `expected` is today's (missed) verdict. |

Each pair has:
- `category`;
- `truth`: `contradiction`, `compatible`, or `ambiguous` (left out of precision and recall, reported apart);
- `expected`: what the rules should say — `conflict`, `possible` (needs judgment: the AI tier, or the user), or
  `compatible`;
- a one-line `rationale`.

**Labels are provisional.** They were labelled by the assistant that wrote the rules. They are not
human-validated, and not model consensus, which needs an approved AI run.

**Metrics** (`src/ai/consistency/evaluation.test.ts`):
- **Rule precision** — of the pairs the rules call `conflict`, the share that are true contradictions.
- **Context false-positive rate** — of the `temporal`, `environment` and `scope` pairs that are compatible, the share
  called `conflict`.
- **Recall** — of the true contradictions, the share shown at all (`conflict` or `possible`).
- **Per category** — precision, recall, and the match with `expected`.

Rules alone: `evaluation.test.ts`. Rules + AI: `judgeEvaluation.test.ts` replays each recording in `recordings/` offline
(the one approved run: `2026-11-13-judge-baseline`, plan §12.14). A new recording needs its own approval
(`src/ai/contractTests/consistencyJudge.contract.test.ts` refuses without one).

**Gates**, before the AI check can even be proposed for default-on:
- rule precision ≥ 0.9;
- context false-positive rate ≤ 0.1;
- recall ≥ 0.85, for rules + AI.

Passing them never turns anything on by itself.
