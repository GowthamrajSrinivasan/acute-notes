# Claim–condition protocol v2 (2026-11-13)

Supersedes [`../phase2/PROTOCOL.md`](../phase2/PROTOCOL.md) (v1) for phase 3. **v1, its labels, `FREEZE.json` and
`report.json` are kept unchanged:** the phase 2 results stand as recorded.

Decision (user, 2026-11-13): an offline evaluation and annotation phase only.
- **Approved:** a second blind review, a visibility amendment, and coverage on the saved OpenUI output.
- **Not approved:** detector v2, model-assisted extraction, generation changes, production activation.

## 1. Relationship labels (four values)

Each candidate condition gets one verdict:

| Verdict | Meaning |
|---|---|
| `claim` | The claim's sentence becomes **false or misleading** in a case the condition describes |
| `set` | A real limit, cost, scope or caveat, but the claim stays true without it; it must be somewhere in the notes |
| `ambiguous` | A careful reader could defend either `claim` or `set`, or the claim it limits can't be pinned down. Say why |
| `not_a_condition` | An example, elaboration, cause, chronology or attribution, or a limit too minor to matter |

Each verdict comes with three things:
- **The claim link:** the unit ids stating the claim it limits. For an intra-sentence condition, these are the
  condition's own unit.
- **Source-span evidence:** an exact quote of the limiting words, and an exact quote of the claim words.
- **A confidence level.**

**Adjudication** keeps disagreement visible. Each record is marked with a status:

| Status | Meaning |
|---|---|
| `agreed` | Both reviewers gave the same verdict and overlapping claim links |
| `adjudicated` | They differed, and the source settles it; the reason is written down |
| `unresolved` | They differed, and the source does not settle it. The record keeps both readings and is scored as `ambiguous`, never forced to one side |

## 2. Visibility: what counts as the reader seeing a condition (amended)

These are reader-visible elements: a node's text, a frame's label and takeaway, and **an arrow's label** (drawn on the
canvas). An arrow's **type** (`depends_on`, `flows_to`…) is not: it shows only in the properties panel when the arrow
is selected. Citations never count.

For each card stating a claim, its outcome is the first of these that holds:

| Outcome | When |
|---|---|
| `carried` | The card's own text conveys the condition: paraphrase is fine, but the specific limit (number, bound, exception, scope) must be recognisable |
| `frame` | Its frame's label or takeaway conveys it |
| `arrow_label` | **(new)** The label of an arrow touching the card, or touching the card's frame, conveys it. Example: a frame-to-frame arrow labelled "kill switch tested before canary" |
| `linked` | An arrow that communicates the condition joins the card to a carrier (below) |
| `separated` | A carrier exists but none of the above holds |
| `absent` | No node, frame or arrow label conveys it |

**When an arrow communicates a condition (`linked`):**
1. **Card to card:** an arrow, any label or none, directly joins the claim card and a carrier node (as in v1).
2. **Cross-frame (new):** an arrow joins the claim card's **frame** (or the card itself) to a carrier node, or to a
   frame containing a carrier. It counts **only if its label expresses a limiting or dependency relation** pointing at
   the condition:

   | Counts | Doesn't count |
   |---|---|
   | requires, depends on, only if, until, unless, before, prerequisite, deferred until, blocked by, limitation, caveat, risk, exception, but | next step, leads to, outcome, example, illustrates, context for, details |

   Neither does an unlabelled frame-to-frame arrow. Sequence and illustration arrows tell a reader where to go next,
   not that the claim is limited.
3. A chain of arrows never counts. Only one arrow from the card or its frame.

Why: the purpose is that a reader at the claim, looking only at what is drawn around it, is told the claim has a
limit. An arrow labelled "next step" into a frame that happens to contain the limit doesn't tell them that.

## 3. Coverage and citations

These are reported separately, never mixed with integrity:

| Measure | Definition |
|---|---|
| **Coverage** | Per record, a carrier exists anywhere (node, frame or arrow label) |
| **Assertion coverage** (OpenUI only) | The golden coverage assertions, as the golden evaluator scores them |
| **Missing citations** | A claim card or carrier that doesn't cite the claim or condition unit. A citation finding, not a semantic failure |

## 4. Snapshot and data hygiene

- **The phase 3 adjudicated labels are frozen** in `phase3/FREEZE-v2.json` before any scoring.
- **kn-05–kn-12 are now evaluation-development data:** they were inspected to write this amendment. No performance
  claim may rest on them.
- **kn-13 is untouched** and is reserved, with any future cases, as fresh unseen data for later performance claims.
- **kn-01/kn-02 OpenUI** (the saved v1 and v2 replies) were seen in phases 1 and 2: development data too.
