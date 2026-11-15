# Meaning rules: evaluation against the labelled set (2026-10-19)

For [knowledge-notes-plan.md](./knowledge-notes-plan.md) §7.2, gates G0–G2. Rules: `src/ai/fidelity/meaning.ts`
(Lane C, as built in Wave 1, not retuned). Labels: rubric v2, policy **model consensus** (OD7a), see
[labelling-report.md](../../src/ai/fidelity/__fixtures__/meaning/labelling-report.md).

**These labels are provisional.** 248 of 254 final labels come from two models agreeing (ChatGPT GPT-6, and a Claude
labeller that saw only the blind sheet); 6 are the user's own decisions. Nothing here is human-validated.

## Labels (G0 under OD7a)

- 256 pairs; 254 kept; 2 excluded because the labellers disagree (`sc-10`, `cp-04`); none removed.
- Agreement between the two labellers: 249 of 254 pairs, Cohen's kappa **0.96**.
- One anchor (`sc-10`, a rubric example) was answered *partly* by the blind labeller: the rubric's example "On
  Windows hosts … → The agent runs as a Windows service" can be read as Windows-only. Worth a rubric note.
- G0 checklist: all four items met under the policy.

## Results per kind (recall on distorted / false alarms on faithful)

The estimate that counts is **held-out, not anchors**: 47 pairs written after the rules were tuned, 5–6 per kind.
It is small (3 per label per kind), so one pair moves a rate by 33 points: treat it as a warning signal, not a
precise rate.

| kind | target (recall / FA) | held-out recall | held-out FA | all pairs recall | all pairs FA | verdict |
|---|---|---|---|---|---|---|
| qualifier | ≥ 90% / ≤ 10% | 67% (2/3) | 0% (0/3) | 94% (15/16) | 0% | **fails recall (held-out)** |
| condition | ≥ 90% / ≤ 10% | 100% (3/3) | 0% | 100% | 0% | meets |
| negation | ≥ 90% / ≤ 10% | 100% (3/3) | 0% (0/2) | 94% | **25% (4/16)** | **fails false alarms (all pairs)** |
| cause | ≥ 75% / ≤ 10% | 67% (2/3) | 0% | 94% | 0% | **fails recall (held-out)** |
| quantity | ≥ 90% / ≤ 10% | 100% (3/3) | 0% | 100% | 6% (1/17) | meets |
| trade_off | ≥ 75% / ≤ 10% | **33% (1/3)** | 0% | **63% (10/16)** | 0% | **fails recall** |
| scope | — / ≤ 10% | 33% (1/3) | 0% | 88% | 0% | meets FA (no recall target) |
| compound | — / ≤ 10% | 67% (2/3) | **33% (1/3)** | 88% | **20% (3/15)** | **fails false alarms** |

**G1 (false alarms ≤ 10% per kind): not met** (negation, compound).
**G2 (recall targets per kind): not met** (trade-off; qualifier and cause on held-out).

## What fails, and why

| Kind | Failure | Pairs | Cause |
|---|---|---|---|
| Negation | False alarms | ng-03, ng-11, ng-13, h-ng-02 | Faithful paraphrases that express the negation without "not": "no longer supports" → "support has been dropped"; "cannot … more than" → "at most"; "does not reload" → "stays loaded" |
| Compound | False alarms | cp-07, cp-08, h-cp-02 | The same negation rule, plus a caveat reworded without its contrast word read as a dropped qualifier |
| Trade-off | Misses | to-20, to-21, to-24, to-25, h-to-04, h-to-06 | A cost inverted into its antonym ("arrive later" → "kept current"); word overlap can't see antonyms |
| Scope | Misses | h-sc-04, h-sc-05 | A narrowing qualifier dropped without a cue word ("on the Growth plan") |
| Qualifier, cause | One miss each | h-ql-05, h-cs-06 | Held-out phrasings the cue lists don't cover |
| Quantity | One false alarm | qt-19 | Rubric v2 rule 8 ("a requirement for N means at least N") isn't in the rules yet |

## Next

1. Retune the rules on the tuned-on pairs only (never on held-out failures): negation by meaning-preserving verbs
   and "at most" equivalence; trade-off by an antonym table for common costs; scope by dropped narrowing
   modifiers; rule 8 for requirements.
2. Measure on a **fresh** held-out set written by someone who hasn't seen the rules, since the current held-out
   misses above are now known, and labelled the same way (two blind labellers, consensus).
3. Wave 2 stays on hold until G1 and G2 hold on that fresh held-out set.

## Addendum, same day: after the retune, on a fresh held-out set

**What was done.**
- The rules were retuned on the tuned-on pairs only, without looking at any held-out pair. Eight mechanisms were
  added: negation without "not", double negation, rule 8, "-able", restated restrictions, dropped "only", inverted
  costs, and "cannot … more than" = "at most". Result on the tuned-on pairs: every kind 100% recall, 0% false alarms.
- A fresh held-out set of 96 pairs was written by an agent that never saw the rules or the other pairs.
- That set was labelled blind by two models (Claude Opus and Claude Sonnet). They agree on 94 of 96, and all 94
  match the writer's intended label. The 2 splits are excluded.
- The set was added as `h2-…` and measured once, after the retune.

**Result on the fresh set (94 pairs, provisional labels):**

| kind | recall | false alarms | target (recall / FA) |
|---|---|---|---|
| qualifier | 100% (6/6) | **40% (2/5)** | ≥ 90% / ≤ 10% |
| condition | 83% (5/6) | **67% (4/6)** | ≥ 90% / ≤ 10% |
| negation | 83% (5/6) | **33% (2/6)** | ≥ 90% / ≤ 10% |
| cause | **33% (2/6)** | 0% | ≥ 75% / ≤ 10% |
| quantity | **50% (3/6)** | **83% (5/6)** | ≥ 90% / ≤ 10% |
| trade_off | **50% (3/6)** | **83% (5/6)** | ≥ 75% / ≤ 10% |
| scope | 0% (0/6) | 17% (1/6) | — / ≤ 10% |
| compound | 60% (3/5) | **50% (3/6)** | — / ≤ 10% |

**G1 and G2 fail in almost every kind.** The labels were checked: the failures are the rules', not the labels'.
- *Faithful flagged:* "2,000 files" → "two thousand files"; "250 ms" → "0.25 seconds"; "do not have access" →
  "off-limits"; "unless the user opts in, … not uploaded" → "stays on the device for anyone who hasn't opted in".
- *Distortions missed:* "Admins in the EU region" → "Admins"; "under $1,000" dropped; "reduced costs" → "costs grew";
  "correlated with" → "lowered".

**Conclusion.**
- Word-level rules reach 100% on the text they were tuned on and fall to 0–83% on new text. They do not generalise,
  and adding more word lists would repeat the same overfitting.
- Under §3.4 ("a rule is dropped if it can't reach [the targets]"), the deterministic meaning rules can't be the
  fidelity gate.
- What is deterministic and fixable is **normalisation**: number words, unit conversion and percentile names. Those
  alone cause most quantity and trade-off false alarms.
- Judging meaning needs a semantic check: the model check of §3.4 (OD5), measured offline on this same labelled set
  before it is relied on.

## Addendum 2: the model check, measured (approved paid run)

**The run.**
- One run (`__fixtures__/meaning/model-check/2026-10-19-gemini-2-5-flash.json`): `google/gemini-2.5-flash` on
  OpenRouter, the product prompt `semanticCheck.ts` v1, temperature 0, batches of 24, 15 calls.
- Cost: **$0.042** for 352 pairs, about $0.00012 per card.
- Replayed offline by `meaning.model.eval.test.ts`; no further cost.
- The judge is a different model family from the labellers (ChatGPT, Claude), but model-labelled sets can share
  blind spots: these are provisional numbers.

| Use | Fresh held-out (94) | All final, not anchors (318) |
|---|---|---|
| **Model on every card** (flag unless "supported") | 0% false alarms in every kind; recall 100% in every kind but qualifier (83%, 5/6: missed "typically" dropped, `h2-ql-02`) | **Meets every target in every kind**: recall 95–100%, false alarms 0% |
| Model, strict (flag only "not supported") | Same as above | Meets every target; compound recall drops to 84% |
| **Rules, then model (OD5 as written)** | Fails 6 kinds: the rules' misses can't be recovered (cause 33%, scope 0%) | Fails cause and quantity |

**Conclusion.** The semantic check works; gating it behind the rules does not.
- Proposal: **OD5b**, model check on every card, one batched call per section.
- Keep the rules only as cheap explanations or hints, not as a gate.
- Keep exactness (§3.3) deterministic.
- This changes OD5 ("off by default, flagged cards only"), so it is the user's decision.
