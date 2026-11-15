# Adjudication instructions (phase 3)

Apply [PROTOCOL-v2.md](./PROTOCOL-v2.md). For each candidate (`c…`) and each additional condition (`a…`) in your
adjudication packet, you see every reading:
- the first reviewer: R1 (phase 2, blind). For kn-01/kn-02 there's a phase 1 record instead, which was **not** blind;
- the golden dataset's link, where one exists;
- the second blind reviewers: R2, or A and B for kn-01/kn-02.

## Per record

| Field | What to put |
|---|---|
| `verdict` | claim, set, ambiguous or not_a_condition |
| `claimUnits` | The claim link |
| `status` | `agreed`: both blind reviewers (R1 and R2, or A and B) gave the same verdict and overlapping claim links, and you see no reason to differ. Otherwise `adjudicated` (the source settles it; write why) or `unresolved` (it doesn't; keep the readings and set verdict `ambiguous`). **Don't force consensus** |
| `readings` | Every reviewer's verdict and claim link, copied |
| `conditionQuote`, `claimQuote` | Exact source words |
| `rationale` | One or two sentences |

**For every record whose verdict is claim, set or ambiguous, label the note sets.** Read the visible text only and
never use citations. Use the v2 visibility rules (`carried`, `frame`, `arrow_label`, `linked`, `separated`, `absent`;
PROTOCOL-v2 §2):

| Cases | Note set | Where | `notes` key |
|---|---|---|---|
| kn-03–kn-12 | The distil note set | `../phase2/packets/<case>.md`; arrows are listed with their labels at the end | `distil` |
| kn-01/kn-02 | Both OpenUI note sets | `openui-packets/<case>.md` | `openui-v1`, `openui-v2` |

kn-03–kn-12 also have the phase 2 card labels in `../phase2/labels/<case>.json`, made under v1. Use them as a starting
point, but **check each claim card again under v2**, especially `separated` ones that might now be `arrow_label` or
`linked` through a cross-frame arrow with a limiting label, and record what changed.

For each note set:
- `claimCards`: node ids whose visible text states the claim.
- `carriers`: node ids, or `arrow:<from>-><to>` for an arrow label, conveying the condition.
- `perClaimCard`: `{ id: outcome }`.
- `changedFromV1`: `{ id: "old→new: reason" }`, for kn-03–kn-12 only.

## Output

Write `adjudicated/<case>.json`:

```json
{
  "caseId": "…",
  "adjudicator": "…",
  "records": [
    {
      "id": "c1",
      "conditionUnits": ["u…"],
      "verdict": "claim|set|ambiguous|not_a_condition",
      "claimUnits": ["u…"],
      "status": "agreed|adjudicated|unresolved",
      "readings": [{ "who": "R1|R2|A|B|golden|phase1", "verdict": "…", "claimUnits": ["u…"] }],
      "conditionQuote": "…",
      "claimQuote": "…",
      "rationale": "…",
      "confidence": "high|medium|low",
      "notes": {
        "distil": {
          "claimCards": [],
          "carriers": [],
          "perClaimCard": {},
          "changedFromV1": {}
        }
      }
    }
  ],
  "notes": "…"
}
```
