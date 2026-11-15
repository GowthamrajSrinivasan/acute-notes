# Adjudication instructions v3 (phase 4)

Apply [EVAL-SPEC-v3.md](./EVAL-SPEC-v3.md): §1 clause records, §2 rubric v3, §3 visibility. Your packet
(`adjudication-packets/<case>.md`) gives:
- the source units;
- each **matched pair** of clause records from the two blind annotators X and Y;
- each **unmatched** record, found by only one of them;
- for context only, the **phase 3 records** (rubric v2, merged spans) that share units, with their note outcomes.

## Per clause record

- **One record per distinct limiting clause.** Never merge two clauses into one record; split a record if an annotator
  combined two.
- **`status`:**

  | Status | When |
  |---|---|
  | `agreed` | X and Y matched, gave the same verdict and overlapping claim links, and you see no reason to differ |
  | `adjudicated` | They differ, or only one found the clause, and the source settles it under rubric v3. Write which rule decided it |
  | `unresolved` | The source doesn't settle it. Verdict `ambiguous`, with both readings and the deciding question. **Don't force consensus** |

- **An unmatched record you reject** (not a limiting clause) goes in `rejected`, with the reason. Don't drop it
  silently.
- **`readings`:** copy X's and Y's verdict and claim link, and phase 3's if one exists. Never give a golden reading a
  verdict.

**For every record whose verdict is claim, set or ambiguous, label the note sets** under §3 visibility, at clause level.
The carrier must convey **this clause**, not a neighbouring one. kn-02 u11 is the example: "for up to the remaining 240
seconds" and "nothing the origin does will shorten that wait" are separate records with separate carriers.

| Cases | Note set | Where | Key |
|---|---|---|---|
| kn-03–kn-12 | Distil | `../phase2/packets/<case>.md` | `distil` |
| kn-01/kn-02 | Both OpenUI note sets | `../phase3/openui-packets/<case>.md` | `openui-v1`, `openui-v2` |

The phase 3 note outcomes in the packet are a starting point only. Re-check each claim card for this clause.

## File rules

Write only `phase4/adjudicated/<case>.json` for your cases, each by its full explicit path, with your Write tool. No
shell globs, no `sed`, and never another file.

```json
{
  "caseId": "…",
  "adjudicator": "…",
  "records": [
    {
      "id": "k1",
      "units": ["u…"],
      "clause": "exact quote",
      "verdict": "claim|set|ambiguous|not_a_condition",
      "rule": "general|R1|R2|R3|R4|R5",
      "claimUnits": ["u…"],
      "claimQuote": "…",
      "status": "agreed|adjudicated|unresolved",
      "from": { "X": "x3", "Y": "y5" },
      "readings": [{ "who": "X|Y|phase3", "verdict": "…", "claimUnits": ["u…"] }],
      "readingA": "",
      "readingB": "",
      "decidingQuestion": "",
      "rationale": "…",
      "confidence": "high|medium|low",
      "notes": { "distil": { "claimCards": [], "carriers": [], "perClaimCard": {} } }
    }
  ],
  "rejected": [{ "from": "x7", "clause": "…", "reason": "…" }],
  "notes": "…"
}
```
