# Dataset card: claim–condition snapshot v3 (2026-11-14)

Companion to [EVAL-SPEC-v3.md](./EVAL-SPEC-v3.md). That file is frozen by hash and kept unchanged, so this card holds
v3's populations.
- **Snapshot:** `FREEZE-v3.json`, 41 files.
- **Earlier snapshots,** both re-verified intact on 2026-11-14: `phase2/FREEZE.json` (21 of 21 files match) and
  `phase3/FREEZE-v2.json` (29 of 29).

## Status

**Development data only.** All 12 cases (kn-01–kn-12) were inspected in earlier phases. No performance claim may rest
on them. The sealed unseen set is `sealed/MANIFEST.json`: kn-13, unopened.

## Contents

12 cases and **270 clause-level records** under rubric v3:

| | Count |
|---|---|
| claim | 168 (62%) |
| set | 75 (28%) |
| ambiguous | 7 (2.6%) |
| not_a_condition | 20 (7%) |
| Units holding 2 or more condition records | 48 |

| Status | Records |
|---|---|
| agreed | 177 |
| adjudicated | 87 (rule that decided it: R4 30, general 25, R3 11, R1 9, R2 9, R5 3) |
| unresolved | 6 (all `ambiguous`) |
| + 1 agreed ambiguous | kn-11 u33: both annotators independently gave the same two readings |

**Note sets labelled:**
- distil (kn-03–kn-12), saved 2026-10-19;
- OpenUI v1 and v2 (kn-01/kn-02), saved 2026-11-13.

## Population accounting (every record traced)

| Population | Count | Accounted |
|---|---|---|
| Units examined | 206 | The union of every earlier proposal (`units-to-examine.json`). Fixed before annotation, so annotators were anchored on which units, not on spans or labels |
| Annotator condition records | 484 | X 242, Y 242. **480 are in an adjudicated record and 4 were rejected with a reason; 0 unaccounted** |
| Annotator not_a_condition records | 37 | All 37 are in adjudicated not_a_condition records |
| Clause pairs matched by the pre-registered method | 230 | Plus 12 X-only and 12 Y-only |
| Adjudicated records | **270** | 253 drawn from both annotators, 10 from X only, 7 from Y only. 6 extra records come from splitting an annotator record that held two clauses or two claim links (kn-06, kn-08, kn-09) |

253 records "from both" is more than the 230 matched pairs because it also counts not_a_condition unit records both
annotators made, and pairs the adjudicator matched that the automatic method didn't.

Integrity and coverage counts use distil for kn-03–kn-12 and OpenUI **v2** for kn-01/kn-02, unless a row names v1.

## Provenance and process

- **Method fixed in advance.** The method and spec were hashed before any annotation was read (`PREREGISTERED.json`).
  The 24 annotation files were hashed on arrival (`ANNOTATIONS-HASH.json`).
- **Adjudicator retry.** The first kn-05–kn-08 adjudicator failed on an API timeout before writing any file. It was
  rerun as two adjudicators (kn-05/06 and kn-07/08).
- **Phase 3 incident.** The kn-03 sed slip is investigated in `INCIDENT-kn03-golden-reading.md`. Phase 4 file rules
  (explicit paths, no shell writes) were followed. No cross-file writes were reported, and every file validated.
- **All annotators and adjudicators are Claude models.** Agreement between them may overstate agreement between
  people; a human spot check is recommended before this becomes the reference.
