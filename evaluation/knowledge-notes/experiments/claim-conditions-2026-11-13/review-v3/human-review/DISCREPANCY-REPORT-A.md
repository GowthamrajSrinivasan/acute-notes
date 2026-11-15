# Human spot check: discrepancy report, reviewer A (2026-11-15)

**Inputs:**
- Reviewer A's answers (`answers-A.json`, a byte-identical copy of the reviewer's `answers-R1.json`; also copied to
  `answers.json` for `compare.mjs`). All 36 items are answered.
- The frozen sample: `SAMPLE-HASH.json` checks passed.

**Output:** `discrepancies.json`.

**Status of this report:**
- **Reviewer B is pending.** Human–human agreement and `compare2.mjs` wait for `answers-B.json`.
- **Snapshot v3 is unchanged.** The causes below are **proposed** by the integrator (a Claude model) for discussion;
  `discrepancies.json`'s `cause` fields are left empty for the human decision.

**Caveats:**
- **Blindness was partial.** The reviewer has seen earlier phase reports, which named the six unresolved records and
  a few examples. They didn't see the answer key or the adjudicated files.
- **One reviewer and 36 items** give a discrepancy check, not an agreement estimate.

## Summary

| Measure | Value |
|---|---|
| Verdict agreement, all 36 | **22 / 36 (61%)** |
| … excluding the 7 reference-`ambiguous` items (6 unresolved + the 30/90-day contradiction) | **22 / 29 (76%)** |
| claim vs. set agreement (both said claim or set) | **19 / 25 (76%)** |
| Claim link disjoint (both gave a link) | 9 |
| Second link added by the human | 1 (H23) |

| Stratum | Agree | Notes |
|---|---|---|
| Clear claim | 4 / 4 | |
| R2 hedges | 3 / 3 | |
| R3 costs | 3 / 3 | |
| not_a_condition | 2 / 2 | |
| Clear set | 3 / 4 | H18: the human says not a condition |
| R1 instructions | 2 / 3 | H10: claim → set |
| Two attachments | 3 / 5 | H17 and H28: claim → set; three links disjoint |
| Changed from phase 3 | 2 / 5 | H08, H16, H21: claim → set |
| Unresolved | 0 / 6 | Reference is `ambiguous` by construction; the human chose a side, mostly at low or medium confidence, often naming the other reading |
| Source contradiction | 0 / 1 | H05: the human says not a condition |

## Findings

### 1. Systematic: the human reads `set` where rubric v3 gave `claim` (6 of 25 claim/set pairs, all in one direction)

| Item | Clause | Reference (rule) | Phase 3 | Human |
|---|---|---|---|---|
| H08 | "Its weakness is vocabulary mismatch" | claim (R3) | set | set |
| H10 | "so they still need a TTL, a purge or both" | claim (R1) | set | set |
| H16 | "not a way to make content fresher" | claim (R3) | set | set |
| H17 | "but not on live election results" | claim (R4) | set | set |
| H21 | "at most 5 attempts per delivery" | claim (general) | set | set |
| H28 | "where a minute of staleness is acceptable" | claim (R4) | set | set |

- **No item went the other way.**
- **In all six the human agrees with phase 3's reading, against rubric v3's.** The phase 4 report warned that v3
  moved the boundary towards `claim` (62% claim in v3 against 34% in phase 3). This sample suggests the move
  overshoots for:
  - **scope and usage exclusions**, where the usage claim stays literally true (H17, H28);
  - **bounds that change nothing a reader would do** (H21; H13 too, which agreed as set);
  - **contrasts and consequences** already stated by a neighbouring sentence (H10, H16).
- **The rules involved vary** (R1, R3, R4, general), so it's the general test's "misleading" threshold, not one rule.
- **Proposed cause:** `rubric_gap`. The v3 general test doesn't say whether "a reader might over-generalise" is
  enough for `claim`. The reviewer's notes repeatedly use "stays true without it, but belongs in the notes".

### 2. Attachment: the human links to the local claim where adjudication chose the section claim

- **H14, H17 and H28:** the reference links to the section claim (u21, u37); the human links to the clause's own
  sentence (u25, u40).
- **H10 and H16:** the human picks a different neighbouring claim (u49 vs. u46, u43 vs. u37).
- **H23:** the human adds a second link (u6 + u2), as phase 3 had it.
- **This supports the v3.1 two-link rule** (local link first, section link only with evidence). Under v3.1, H14,
  H17, H28 and H23 would likely have agreed on the local link.
- **Proposed cause:** `attachment_level`.

### 3. Condition or not (H18, H05, H22)

- **H18, "Every 10 minutes"** (reference `set`, clear-set stratum): the human calls it a schedule detail that limits
  nothing, at high confidence. Proposed cause: `rubric_gap` (R5 doesn't say whether frequencies and schedules are
  conditions).
- **H05, "90 days",** the 30 vs. 90 days contradiction (reference `ambiguous`): the human says it's a table value,
  not a limit, and notes the alternative reading. Proposed cause: `source_ambiguous`.
- **H22** (unresolved): `not_a_condition` at low confidence, with the alternative noted. Proposed cause:
  `source_ambiguous`.

### 4. Unresolved items: the human chose a side (H06, H12, H26, H27, H35)

- **What the human did:** gave a verdict rather than `ambiguous`, at low or medium confidence, usually naming the
  competing reading in the note.
- **Expected:** the instructions asked for `ambiguous` only when the source doesn't settle it, and a human may judge
  differently.
- **Where the human sided with one blind annotator:**
  - H26: claim, as annotator Y;
  - H12: claim, as annotator X, but linked to u54, the proposal sentence, not u56 or u59.
- **Proposed cause:** `source_ambiguous`. These stay `ambiguous` in v3.

## Recommendation

1. **Don't change v3.**
2. **Wait for reviewer B** before treating finding 1 as confirmed. If B also reads `set` on most of the six,
   propose a **v3.1 dataset**:
   - rubric text for the general test: "a scope or usage exclusion, or a bound, that leaves the stated claim literally
     true and wouldn't change what a reader does is `set`";
   - re-adjudication of the `claim` records that fall under that pattern, by documented migration with new hashes.
3. **Adopt v3.1 attachment** (already approved). This sample supports it.
4. **Clarify R5 for schedules and frequencies** (H18).

**kn-13 stays sealed.** None of this changes the plan to label it only under the approved specification.
